import crypto from 'crypto';

// In-memory sliding rate limiting store
interface RateRecord {
  count: number;
  resetAt: number;
  failedAttempts: number;
  lockedUntil: number;
}

const rateLimitStore = new Map<string, RateRecord>();

// Periodic cleanup every 5 minutes to prevent memory leak
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetAt && now > record.lockedUntil) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

/**
 * Get client IP address accurately from standard reverse proxy headers
 */
export function getClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  // Prioritize trusted reverse-proxy headers from Vercel edge
  const vercelIp = req.headers['x-vercel-ip'];
  if (typeof vercelIp === 'string' && vercelIp.trim()) return vercelIp.trim();

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const clientIp = forwarded.split(',')[0].trim();
    if (clientIp) return clientIp;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }

  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Rate Limiter to prevent DDoS, brute-force attacks, and credential stuffing
 */
export function checkRateLimit(
  ip: string,
  bucket: 'auth' | 'upload' | 'general'
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${bucket}:${ip}`;
  let record = rateLimitStore.get(key);

  if (!record) {
    const windowMs =
      bucket === 'auth'
        ? 15 * 60 * 1000
        : bucket === 'upload'
        ? 60 * 1000
        : 60 * 1000;

    record = {
      count: 0,
      resetAt: now + windowMs,
      failedAttempts: 0,
      lockedUntil: 0,
    };
    rateLimitStore.set(key, record);
  }

  // Check if IP is currently under lockout
  if (record.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
    };
  }

  // Reset window if expired
  if (now > record.resetAt) {
    const windowMs =
      bucket === 'auth'
        ? 15 * 60 * 1000
        : bucket === 'upload'
        ? 60 * 1000
        : 60 * 1000;
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  record.count += 1;

  const maxRequests =
    bucket === 'auth' ? 10 : bucket === 'upload' ? 25 : 120;

  if (record.count > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Record a failed authentication attempt to enforce progressive lockout
 */
export function recordFailedAuthAttempt(ip: string): { remainingAttempts: number } {
  const key = `auth:${ip}`;
  const now = Date.now();
  let record = rateLimitStore.get(key);

  if (!record) {
    record = {
      count: 1,
      resetAt: now + 15 * 60 * 1000,
      failedAttempts: 1,
      lockedUntil: 0,
    };
    rateLimitStore.set(key, record);
    return { remainingAttempts: 4 };
  }

  record.failedAttempts += 1;

  // If 5 failed attempts occur within 15 minutes, lock IP for 15 minutes
  if (record.failedAttempts >= 5) {
    record.lockedUntil = now + 15 * 60 * 1000;
    return { remainingAttempts: 0 };
  }

  return { remainingAttempts: Math.max(0, 5 - record.failedAttempts) };
}

/**
 * Reset failed authentication count after successful clearance
 */
export function resetFailedAuthAttempts(ip: string): void {
  const key = `auth:${ip}`;
  const record = rateLimitStore.get(key);
  if (record) {
    record.failedAttempts = 0;
    record.lockedUntil = 0;
  }
}

/**
 * Constant-time string comparison to prevent side-channel timing attacks
 */
export function timingSafeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function getAdminJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Server configuration error: JWT_SECRET environment variable is missing.'
      );
    }
    return 'imglink-dev-ephemeral-jwt-secret';
  }
  return secret;
}

/**
 * Verify administrative clearance key using timing-safe comparison on the server
 */
export function verifyAdminSecret(providedKey: string): boolean {
  if (!providedKey || typeof providedKey !== 'string') return false;
  const adminSecret =
    process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET_PIN;
  if (!adminSecret) {
    console.error(
      '[SECURITY]: ADMIN_SECRET_KEY or ADMIN_SECRET_PIN environment variable is not configured.'
    );
    return false;
  }
  return timingSafeEqual(providedKey.trim(), adminSecret.trim());
}

/**
 * Create a cryptographically signed, short-lived Admin Authorization Token (JWT)
 */
export function createAdminToken(): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');

  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin_gate',
      exp: Math.floor(Date.now() / 1000) + 7200, // 2-hour lifespan
      iat: Math.floor(Date.now() / 1000),
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', getAdminJwtSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify if the presented Admin Authorization Token is valid and non-expired
 */
export function verifyAdminToken(token: string): boolean {
  try {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [header, payload, signature] = parts;
    const expected = crypto
      .createHmac('sha256', getAdminJwtSecret())
      .update(`${header}.${payload}`)
      .digest('base64url');

    if (!timingSafeEqual(signature, expected)) return false;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }

    return data.role === 'admin_gate';
  } catch {
    return false;
  }
}

/**
 * Apply robust OWASP defensive headers to API responses
 */
export function applySecurityHeaders(res: any): void {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  } catch {}
}

/**
 * Sanitize untrusted filenames to prevent directory traversal and injection
 */
export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== 'string') return 'image';
  return name
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
}

/**
 * Strict image MIME type whitelist
 */
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/jfif',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/tiff',
]);

/**
 * Validate that an S3 storage file key is safe, contains no path traversal sequences,
 * and matches the UUID/alphanumeric naming convention.
 */
export function isValidFileKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('..') || key.includes('/') || key.includes('\\')) return false;
  return /^[a-zA-Z0-9_-]{1,64}\.[a-zA-Z0-9]{1,10}$/.test(key.trim());
}

/**
 * Apply safe, whitelisted CORS headers.
 * Prevents arbitrary origin reflection with credentials (CORS credential theft vulnerability).
 */
export function applyCorsHeaders(req: any, res: any): void {
  const origin = req.headers?.origin;
  const appUrl = (process.env.APP_URL || 'https://imglink.web.id').replace(/\/$/, '');

  let allowedOrigin: string | null = null;

  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const parsedApp = new URL(appUrl);

      const isDomainMatch =
        parsedOrigin.hostname === 'imglink.web.id' ||
        parsedOrigin.hostname.endsWith('.imglink.web.id') ||
        parsedOrigin.hostname === parsedApp.hostname ||
        parsedOrigin.hostname.endsWith(`.${parsedApp.hostname}`);
      const isLocalhost =
        parsedOrigin.hostname === 'localhost' ||
        parsedOrigin.hostname === '127.0.0.1';
      const isVercelPreview =
        parsedOrigin.hostname.endsWith('.vercel.app') &&
        (parsedApp.hostname.includes('imglink') || parsedOrigin.hostname.includes('imglink'));

      if (isDomainMatch || isLocalhost || isVercelPreview) {
        allowedOrigin = origin;
      }
    } catch {
      allowedOrigin = null;
    }
  }

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // Same-origin non-browser request (e.g. server-to-server or curl)
    res.setHeader('Access-Control-Allow-Origin', appUrl);
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS,PATCH,DELETE,POST,PUT'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Admin-Key, x-admin-key, X-Admin-Secret, x-admin-secret, X-Admin-Token, x-admin-token'
  );
}

