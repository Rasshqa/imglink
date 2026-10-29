import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { UploadZone } from './components/UploadZone';
import { ResultCard } from './components/ResultCard';
import { RecentUploads } from './components/RecentUploads';
import { ImageConverterStudio } from './components/ImageConverterStudio';
import { AuthModal } from './components/AuthModal';
import { ProUpgradeModal } from './components/ProUpgradeModal';
import { LegalAgreementModal } from './components/LegalAgreementModal';
import { SecretAdminGate } from './components/SecretAdminGate';
import type { ImageRecord, AuthUser } from './types';
import { initializeAuth, clearAuthSession, setAuthSession } from './utils/auth';
import { computeSha256, ADMIN_GATE_FINGERPRINT } from './utils/security';
import {
  Sparkles,
  ArrowDown,
  ShieldCheck,
  Zap,
  UploadCloud,
  RefreshCw,
} from 'lucide-react';

export type WorkspaceMode = 'cloud-upload' | 'converter-studio';

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isProModalOpen, setIsProModalOpen] = useState<boolean>(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState<boolean>(false);
  const [isSecretRouteActive, setIsSecretRouteActive] = useState<boolean>(false);

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('cloud-upload');
  const [converterInitialFile, setConverterInitialFile] = useState<File | null>(null);

  const [images, setImages] = useState<ImageRecord[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState<boolean>(true);
  const [activeResult, setActiveResult] = useState<ImageRecord | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // Initialize Auth & Handle OAuth Redirects
  useEffect(() => {
    const existing = initializeAuth();
    if (existing) {
      setUser(existing);
    }

    const searchParams = new URLSearchParams(window.location.search);
    const verifier =
      searchParams.get('neon_auth_session_verifier') || searchParams.get('verifier');
    const tokenParam = searchParams.get('token');

    // 1. If returning from OAuth with session verifier
    if (verifier) {
      axios
        .post<{ user: AuthUser; token: string }>('/api/auth', {
          action: 'exchange',
          verifier,
        })
        .then((res) => {
          if (res.data.user && res.data.token) {
            setAuthSession(res.data.token, res.data.user);
            setUser(res.data.user);
            setActionNotice({
              message: `WELCOME, ${res.data.user.name.toUpperCase()}!`,
              type: 'success',
            });
            setTimeout(() => setActionNotice(null), 3500);
          }
        })
        .catch((err) => {
          console.error('Verifier exchange error:', err);
        })
        .finally(() => {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('neon_auth_session_verifier');
          cleanUrl.searchParams.delete('verifier');
          cleanUrl.searchParams.delete('login');
          window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        });
      return;
    }

    // 2. If returning from OAuth redirect with token
    if (tokenParam) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('token');
      cleanUrl.searchParams.delete('login');
      window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);

      try {
        localStorage.setItem('imglink_auth_token', tokenParam);
      } catch {}
      axios

        .get<{ user: AuthUser | null; token?: string }>('/api/auth')
        .then((res) => {
          if (res.data.user) {
            setAuthSession(res.data.token || tokenParam, res.data.user);
            setUser(res.data.user);
            setActionNotice({
              message: `WELCOME, ${res.data.user.name.toUpperCase()}!`,
              type: 'success',
            });
            setTimeout(() => setActionNotice(null), 3500);
          }
        })
        .catch((err) => {
          console.error('Token validation error:', err);
        });
      return;
    }

    // 3. Normal initial session verification
    axios
      .get<{ user: AuthUser | null; token?: string }>('/api/auth')
      .then((res) => {
        if (res.data.user) {
          setUser(res.data.user);
          if (res.data.token) {
            setAuthSession(res.data.token, res.data.user);
          }
        } else if (!existing) {
          clearAuthSession();
          setUser(null);
        }
      })
      .catch(() => {
        if (!existing) {
          clearAuthSession();
          setUser(null);
        }
      });
  }, []);

  // Listen to browser navigation to detect secret admin route via cryptographic fingerprint
  useEffect(() => {
    const checkRoute = async () => {
      const cleanPath = window.location.pathname
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .toLowerCase();

      if (!cleanPath) {
        setIsSecretRouteActive(false);
        return;
      }

      try {
        const hash = await computeSha256(cleanPath);
        setIsSecretRouteActive(hash === ADMIN_GATE_FINGERPRINT);
      } catch {
        setIsSecretRouteActive(false);
      }
    };

    checkRoute();
    window.addEventListener('popstate', checkRoute);
    return () => window.removeEventListener('popstate', checkRoute);
  }, []);

  const fetchRecentImages = useCallback(async () => {
    setIsLoadingImages(true);
    try {
      const response = await axios.get<ImageRecord[]>('/api/images');
      if (Array.isArray(response.data)) {
        setImages(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch recent images:', err);
    } finally {
      setIsLoadingImages(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentImages();
  }, [fetchRecentImages]);

  const handleOpenAuth = () => {
    setIsAuthModalOpen(true);
  };

  const handleAuthSuccess = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser);
    setActionNotice({
      message: `WELCOME, ${authenticatedUser.name.toUpperCase()}!`,
      type: 'success',
    });
    setTimeout(() => setActionNotice(null), 3500);
    fetchRecentImages();
  };

  const handleLogout = () => {
    clearAuthSession();
    setUser(null);
    axios.post('/api/auth', { action: 'logout' }).catch(() => {});
    setActionNotice({
      message: 'LOGGED OUT SUCCESSFULLY.',
      type: 'success',
    });
    setTimeout(() => setActionNotice(null), 3500);
    fetchRecentImages();
  };

  const handleUploadSuccess = (newImage: ImageRecord) => {
    setWorkspaceMode('cloud-upload');
    setActiveResult(newImage);
    setImages((prev) => [newImage, ...prev.filter((img) => img.id !== newImage.id)]);
    setUser((prev) => (prev ? { ...prev, imageCount: (prev.imageCount ?? 0) + 1 } : null));

    setActionNotice({
      message: `UPLOAD COMPLETE: "${newImage.originalName.toUpperCase()}"`,
      type: 'success',
    });
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handleOpenInConverter = (file?: File) => {
    if (file) {
      setConverterInitialFile(file);
    }
    setWorkspaceMode('converter-studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteImage = async (id: string, fileKey: string) => {
    try {
      await axios.delete('/api/images', {
        params: { id, fileKey },
      });

      setImages((prev) => prev.filter((img) => img.id !== id));
      if (activeResult?.id === id) {
        setActiveResult(null);
      }
      setUser((prev) =>
        prev ? { ...prev, imageCount: Math.max(0, (prev.imageCount ?? 1) - 1) } : null
      );

      setActionNotice({
        message: 'IMAGE DELETED SUCCESSFULLY.',
        type: 'success',
      });
      setTimeout(() => setActionNotice(null), 3500);
    } catch (err: unknown) {
      let detail = 'FAILED TO DELETE IMAGE.';
      if (axios.isAxiosError(err) && err.response?.data) {
        const data = err.response.data;
        if (typeof data.error === 'string') {
          detail = data.error.toUpperCase();
        } else if (
          data.error &&
          typeof data.error === 'object' &&
          typeof data.error.message === 'string'
        ) {
          detail = data.error.message.toUpperCase();
        } else if (typeof data.message === 'string') {
          detail = data.message.toUpperCase();
        }
      }
      setActionNotice({
        message: detail,
        type: 'error',
      });
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-neo-yellow selection:text-black">
      <Header
        user={user}
        onOpenAuth={handleOpenAuth}
        onLogout={handleLogout}
        onOpenProModal={() => setIsProModalOpen(true)}
      />

      {/* Neo-brutalist Ticker Tape */}
      <div className="bg-neo-yellow border-b-[3px] border-black overflow-hidden py-2 select-none">
        <div className="flex w-max animate-marquee space-x-6 text-xs font-mono font-black uppercase tracking-wider text-black">
          {[1, 2].map((k) => (
            <div key={k} className="flex items-center space-x-6">
              <span className="inline-flex items-center px-2.5 py-0.5 bg-neo-pink text-black border-2 border-black shadow-brutal-sm rotate-1">
                UNIVERSAL IMAGE CONVERTER
              </span>
              <span className="font-bold">·</span>
              <span className="inline-flex items-center px-2.5 py-0.5 bg-neo-cyan text-black border-2 border-black shadow-brutal-sm -rotate-1">
                PNG · JPG · JFIF · WEBP · AVIF · GIF · SVG · BMP · ICO
              </span>
              <span className="font-bold">·</span>
              <span className="inline-flex items-center px-2.5 py-0.5 bg-neo-lime text-black border-2 border-black shadow-brutal-sm rotate-2">
                DIRECT HIGH SPEED CLOUD HOSTING
              </span>
              <span className="font-bold">·</span>
              <span className="inline-flex items-center px-2.5 py-0.5 bg-neo-purple text-white border-2 border-black shadow-brutal-sm -rotate-1">
                EXIF & GPS PRIVACY STRIPPER
              </span>
              <span className="font-bold">·</span>
              <span className="inline-flex items-center px-2.5 py-0.5 bg-neo-orange text-black border-2 border-black shadow-brutal-sm rotate-1">
                SHORT AND EMBED URLS
              </span>
              <span className="font-bold">·</span>
              <span className="inline-flex items-center px-2.5 py-0.5 bg-white text-black border-2 border-black shadow-brutal-sm -rotate-2">
                BATCH ZIP DOWNLOADS
              </span>
              <span className="font-bold">·</span>
            </div>
          ))}
        </div>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-10 space-y-8 sm:space-y-10">
        {/* Floating Neo-Brutalist Toast */}
        {actionNotice && (
          <div
            className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-50 px-4 py-3 sm:px-5 sm:py-3.5 border-[3px] border-black font-mono font-black text-xs uppercase shadow-brutal-lg animate-fadeIn flex items-center gap-2.5 ${
              actionNotice.type === 'success'
                ? 'bg-neo-lime text-black'
                : 'bg-neo-pink text-black'
            }`}
          >
            <span>{actionNotice.message}</span>
          </div>
        )}

        {/* Hero Section */}
        <section className="text-center space-y-4 sm:space-y-5 pt-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 sm:px-4 sm:py-1.5 bg-neo-cyan border-[3px] border-black font-mono font-black text-[10px] sm:text-xs uppercase text-black shadow-brutal-sm sm:shadow-brutal -rotate-1">
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-black" />
            <span>CLOUD IMAGE-TO-URL & UNIVERSAL FORMAT CONVERTER</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-black leading-tight sm:leading-none max-w-4xl mx-auto px-1">
            {workspaceMode === 'cloud-upload' ? (
              <>
                Convert Any Image into a{' '}
                <span className="bg-neo-yellow px-2 py-0.5 border-[3px] border-black inline-block shadow-brutal-sm sm:shadow-brutal my-1 -rotate-1">
                  Shareable URL
                </span>{' '}
                <span className="bg-neo-pink px-2 py-0.5 border-[3px] border-black inline-block shadow-brutal-sm sm:shadow-brutal my-1 rotate-1">
                  Instantly.
                </span>
              </>
            ) : (
              <>
                Convert & Optimize{' '}
                <span className="bg-neo-cyan px-2 py-0.5 border-[3px] border-black inline-block shadow-brutal-sm sm:shadow-brutal my-1 -rotate-1">
                  Any Image Format
                </span>{' '}
                <span className="bg-neo-lime px-2 py-0.5 border-[3px] border-black inline-block shadow-brutal-sm sm:shadow-brutal my-1 rotate-1">
                  In Browser.
                </span>
              </>
            )}
          </h1>

          <p className="font-mono text-xs sm:text-sm font-bold text-black/80 max-w-2xl mx-auto leading-relaxed px-2">
            {workspaceMode === 'cloud-upload'
              ? 'Ultra-fast direct cloud hosting with optional pre-upload format conversion, instant short URLs, Markdown & HTML embed snippets, and your private gallery.'
              : 'Convert between PNG, JPG, JFIF, WEBP, AVIF, GIF, SVG, BMP, ICO, and TIFF with real-time compression, resize, crop/rotate, color filters, and EXIF privacy stripping.'}
          </p>

          {/* Primary Workspace Mode Switcher */}
          <div className="pt-2 flex justify-center w-full px-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 bg-white border-[3px] border-black shadow-brutal w-full max-w-xl">
              <button
                type="button"
                onClick={() => setWorkspaceMode('cloud-upload')}
                className={`min-h-[46px] min-w-0 overflow-hidden px-4 py-2.5 font-mono font-black text-xs sm:text-sm uppercase flex items-center justify-center gap-2 border-2 transition-all ${
                  workspaceMode === 'cloud-upload'
                    ? 'bg-neo-yellow border-black text-black shadow-brutal-sm'
                    : 'bg-transparent border-transparent text-black/75 hover:bg-neo-bg'
                }`}
              >
                <UploadCloud className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
                <span className="truncate">Cloud Image-to-URL</span>
              </button>

              <button
                type="button"
                onClick={() => setWorkspaceMode('converter-studio')}
                className={`min-h-[46px] min-w-0 overflow-hidden px-4 py-2.5 font-mono font-black text-xs sm:text-sm uppercase flex items-center justify-center gap-2 border-2 transition-all ${
                  workspaceMode === 'converter-studio'
                    ? 'bg-neo-cyan border-black text-black shadow-brutal-sm'
                    : 'bg-transparent border-transparent text-black/75 hover:bg-neo-bg'
                }`}
              >
                <RefreshCw className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
                <span className="truncate">Converter Studio</span>
                <span className="px-1.5 py-0.5 bg-neo-lime border border-black text-[10px] font-black flex-shrink-0">
                  FREE
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 pt-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1 bg-neo-lime border-2 border-black font-mono font-black text-[11px] sm:text-xs uppercase text-black shadow-brutal-sm -rotate-1">
              <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-black" />9 FORMATS SUPPORTED
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1 bg-neo-cyan border-2 border-black font-mono font-black text-[11px] sm:text-xs uppercase text-black shadow-brutal-sm rotate-1">
              <ShieldCheck className="w-3 h-3 sm:w-3.5 sm:h-3.5 stroke-[2.5]" />
              EXIF PRIVACY SCRUBBER
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1 bg-neo-purple border-2 border-black font-mono font-black text-[11px] sm:text-xs uppercase text-white shadow-brutal-sm -rotate-1">
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-white" />
              INSTANT EMBED CODES
            </span>
          </div>
        </section>

        {/* Active Workspace Stage */}
        <section className="space-y-6">
          {workspaceMode === 'converter-studio' ? (
            <ImageConverterStudio
              user={user}
              onOpenAuth={handleOpenAuth}
              onOpenProModal={() => setIsProModalOpen(true)}
              onUploadConvertedSuccess={handleUploadSuccess}
              initialFile={converterInitialFile}
              onClearInitialFile={() => setConverterInitialFile(null)}
            />
          ) : activeResult ? (
            <ResultCard
              image={activeResult}
              onUploadAnother={() => setActiveResult(null)}
              onOpenInConverter={(file) => handleOpenInConverter(file)}
            />
          ) : (
            <UploadZone
              user={user}
              onOpenAuth={handleOpenAuth}
              onOpenProModal={() => setIsProModalOpen(true)}
              onUploadSuccess={handleUploadSuccess}
              isUploading={isUploading}
              setIsUploading={setIsUploading}
              onSwitchToConverter={(file) => handleOpenInConverter(file)}
            />
          )}
        </section>

        {/* Divider with Neo-brutalist Tag */}
        <div className="relative py-3 sm:py-4 flex items-center justify-center">
          <div className="w-full border-t-[3px] border-black" />
          <div className="absolute px-3.5 py-1 sm:px-5 sm:py-1.5 bg-neo-pink border-[3px] border-black font-mono font-black text-[11px] sm:text-xs uppercase text-black shadow-brutal-sm sm:shadow-brutal flex items-center gap-2 -rotate-1">
            <ArrowDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[3]" />
            <span>PRIVATE ASSET VAULT</span>
          </div>
        </div>

        {/* Private Asset History */}
        <section>
          <RecentUploads
            images={images}
            isLoading={isLoadingImages}
            onRefresh={fetchRecentImages}
            onDelete={handleDeleteImage}
            user={user}
            onOpenAuth={handleOpenAuth}
            onOpenInConverter={(file) => handleOpenInConverter(file)}
            onSelectImage={(img) => {
              setActiveResult(img);
              setWorkspaceMode('cloud-upload');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </section>
      </main>

      <Footer onOpenLegal={() => setIsLegalModalOpen(true)} />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
        onOpenLegal={() => setIsLegalModalOpen(true)}
      />

      {/* Legal Agreement Modal */}
      <LegalAgreementModal
        isOpen={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
      />

      {/* Secret Route Admin Gate */}
      {isSecretRouteActive && (
        <SecretAdminGate
          currentUserEmail={user?.email || 'admin@imglink.web.id'}
          onExit={() => {
            window.history.pushState({}, '', '/');
            setIsSecretRouteActive(false);
            fetchRecentImages();
          }}
        />
      )}

      {/* Pro Upgrade Modal */}
      <ProUpgradeModal
        isOpen={isProModalOpen}
        onClose={() => setIsProModalOpen(false)}
        user={user}
        onUserUpdated={(updatedUser) => {
          setUser(updatedUser);
        }}
        onOpenAuth={handleOpenAuth}
      />
    </div>
  );
};

export default App;
