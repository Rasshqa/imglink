import axios from 'axios';
import type { AuthUser } from '../types';

const TOKEN_KEY = 'imglink_auth_token';
const USER_KEY = 'imglink_auth_user';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('snaplink_auth_token');
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY) || localStorage.getItem('snaplink_auth_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('snaplink_auth_token');
    localStorage.removeItem('snaplink_auth_user');
  } catch (err) {
    console.error('Failed to clear session:', err);
  }
}

export function initializeAuth(): AuthUser | null {
  const token = getStoredToken();
  const user = getStoredUser();
  if (token && user) {
    return user;
  }
  return null;
}

export function isInternalApiUrl(url?: string): boolean {
  if (!url) return false;
  if (url.startsWith('/api/') || url.startsWith('api/')) return true;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://imglink.web.id';
    const parsed = new URL(url, origin);
    const isDomain =
      parsed.hostname === 'imglink.web.id' ||
      parsed.hostname.endsWith('.imglink.web.id') ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1';
    return isDomain && parsed.pathname.startsWith('/api');
  } catch {
    return false;
  }
}

// Axios Request Interceptor:
// Automatically attaches Bearer token to internal /api/* endpoints.
// Storage uploads (S3 / presigned URLs) never receive Authorization header.
axios.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token && isInternalApiUrl(config.url)) {
    if (config.headers && typeof config.headers.set === 'function') {
      config.headers.set('Authorization', `Bearer ${token}`);
    } else {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return config;
});

