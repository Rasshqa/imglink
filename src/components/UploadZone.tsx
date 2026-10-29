import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  UploadCloud,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileUp,
  X,
  Sparkles,
  Lock,
  ArrowRight,
  Crown,
  Sliders,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type {
  ImageRecord,
  UploadProgress,
  AuthUser,
  SupportedOutputFormat,
} from '../types';
import { getStoredUser } from '../utils/auth';
import { formatBytes } from '../utils/formatters';
import {
  ACCEPT_ALL_IMAGE_FORMATS,
  DEFAULT_CONVERSION_SETTINGS,
  OUTPUT_FORMATS,
  convertImageFile,
  isSupportedImageFile,
  normalizeUploadMimeType,
} from '../utils/imageConverter';

interface UploadZoneProps {
  user: AuthUser | null;
  onOpenAuth: () => void;
  onOpenProModal: () => void;
  onUploadSuccess: (image: ImageRecord) => void;
  isUploading: boolean;
  setIsUploading: (uploading: boolean) => void;
  onSwitchToConverter?: (file?: File) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const UploadZone: React.FC<UploadZoneProps> = ({
  user,
  onOpenAuth,
  onOpenProModal,
  onUploadSuccess,
  isUploading,
  setIsUploading,
  onSwitchToConverter,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-Upload Conversion & Optimization State
  const [enablePreConvert, setEnablePreConvert] = useState<boolean>(false);
  const [preTargetFormat, setPreTargetFormat] = useState<SupportedOutputFormat>('webp');
  const [preQuality, setPreQuality] = useState<number>(85);
  const [preMaxWidth, setPreMaxWidth] = useState<number | null>(null);

  const effectiveUser = user || getStoredUser();
  const isPro = Boolean(effectiveUser?.tier === 'pro' || effectiveUser?.role === 'admin');
  const isFreeTier = Boolean(effectiveUser && !isPro);
  const hasReachedFreeLimit = Boolean(isFreeTier && (effectiveUser?.imageCount ?? 0) >= 3);

  const validateFile = (file: File): string | null => {
    if (!isSupportedImageFile(file)) {
      return `UNSUPPORTED FORMAT "${
        file.type || file.name
      }". ALLOWED: PNG, JPG, JFIF, WEBP, AVIF, GIF, SVG, BMP, ICO, TIFF.`;
    }
    if (!enablePreConvert && file.size > MAX_FILE_SIZE) {
      return `FILE SIZE (${formatBytes(
        file.size
      )}) EXCEEDS THE 10MB LIMIT. ENABLE PRE-UPLOAD COMPRESSION BELOW TO SHRINK IT AUTOMATICALLY.`;
    }
    return null;
  };

  const processUpload = useCallback(
    async (rawFile: File) => {
      setValidationError(null);

      if (!effectiveUser) {
        onOpenAuth();
        return;
      }

      if (hasReachedFreeLimit) {
        onOpenProModal();
        return;
      }

      const error = validateFile(rawFile);
      if (error) {
        setValidationError(error);
        return;
      }

      setIsUploading(true);
      setSelectedFileName(rawFile.name);

      try {
        let uploadFile = rawFile;
        let finalMimeType = normalizeUploadMimeType(rawFile);

        // Optional Step 0: Run Pre-Upload Format Conversion & Compression
        if (enablePreConvert) {
          setProgress({
            stage: 'converting',
            percent: 8,
            loadedBytes: 0,
            totalBytes: rawFile.size,
            statusText: `CONVERTING TO .${preTargetFormat.toUpperCase()} (${preQuality}% QUALITY)...`,
          });

          const converted = await convertImageFile(rawFile, {
            ...DEFAULT_CONVERSION_SETTINGS,
            targetFormat: preTargetFormat,
            quality: preQuality,
            width: preMaxWidth,
            height: null,
            lockAspectRatio: true,
          });

          URL.revokeObjectURL(converted.url);
          uploadFile = new File([converted.blob], converted.fileName, {
            type: converted.mimeType,
          });
          finalMimeType = converted.mimeType;
          setSelectedFileName(uploadFile.name);
        }

        if (uploadFile.size > MAX_FILE_SIZE) {
          throw new Error(
            `File size (${formatBytes(uploadFile.size)}) exceeds the 10MB storage limit.`
          );
        }

        setProgress({
          stage: 'requesting-url',
          percent: 15,
          loadedBytes: 0,
          totalBytes: uploadFile.size,
          statusText: '1/3 GETTING DIRECT UPLOAD LINK...',
        });

        // Step 1: Request Presigned PUT URL from backend
        const urlResponse = await axios.post<{ uploadUrl: string; fileKey: string }>(
          '/api/upload-url',
          {
            fileName: uploadFile.name,
            mimeType: finalMimeType,
            sizeBytes: uploadFile.size,
          }
        );

        const { uploadUrl, fileKey } = urlResponse.data;

        // Step 2: Upload directly to Storage using PUT
        setProgress({
          stage: 'uploading',
          percent: 25,
          loadedBytes: 0,
          totalBytes: uploadFile.size,
          statusText: '2/3 STREAMING IMAGE FILE...',
        });

        await axios.put(uploadUrl, uploadFile, {
          headers: {
            'Content-Type': finalMimeType,
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const uploadFraction = progressEvent.loaded / progressEvent.total;
              const currentPercent = Math.min(88, Math.round(25 + uploadFraction * 63));
              setProgress({
                stage: 'uploading',
                percent: currentPercent,
                loadedBytes: progressEvent.loaded,
                totalBytes: progressEvent.total,
                statusText: `2/3 UPLOADING... ${Math.round(uploadFraction * 100)}% (${formatBytes(
                  progressEvent.loaded
                )} / ${formatBytes(progressEvent.total)})`,
              });
            }
          },
        });

        // Step 3: Save metadata to Database
        setProgress({
          stage: 'saving-metadata',
          percent: 94,
          loadedBytes: uploadFile.size,
          totalBytes: uploadFile.size,
          statusText: '3/3 FINALIZING RECORD...',
        });

        const metadataResponse = await axios.post<ImageRecord>('/api/images', {
          fileKey,
          originalName: uploadFile.name,
          mimeType: finalMimeType,
          sizeBytes: uploadFile.size,
        });

        setProgress({
          stage: 'completed',
          percent: 100,
          loadedBytes: uploadFile.size,
          totalBytes: uploadFile.size,
          statusText: 'UPLOAD COMPLETE!',
        });

        setTimeout(() => {
          setIsUploading(false);
          setProgress(null);
          onUploadSuccess(metadataResponse.data);
        }, 450);
      } catch (err: unknown) {
        setIsUploading(false);
        let detailMessage = 'AN ERROR OCCURRED DURING UPLOAD.';
        if (axios.isAxiosError(err)) {
          if (err.response?.status === 401) {
            detailMessage = 'SESSION EXPIRED OR UNAUTHORIZED. PLEASE SIGN IN.';
            onOpenAuth();
          } else if (err.response?.status === 403 && err.response?.data?.limitReached) {
            detailMessage = 'FREE TIER LIMIT REACHED (MAX 3 IMAGES). UPGRADE TO PRO!';
            onOpenProModal();
          } else if (err.response?.data) {
            const data = err.response.data;
            if (typeof data === 'string') {
              detailMessage = data;
            } else if (typeof data.error === 'string') {
              detailMessage = data.error;
            } else if (
              data.error &&
              typeof data.error === 'object' &&
              typeof data.error.message === 'string'
            ) {
              detailMessage = data.error.message;
            } else if (typeof data.message === 'string') {
              detailMessage = data.message;
            } else if (typeof data.details === 'string') {
              detailMessage = data.details;
            } else {
              detailMessage = err.message || 'UPLOAD FAILED';
            }
          } else if (err.message && err.message.includes('Network Error')) {
            detailMessage = 'NETWORK ERROR CONNECTING TO STORAGE.';
          } else if (err.message) {
            detailMessage = err.message;
          }
        } else if (err instanceof Error) {
          detailMessage = err.message;
        }

        setProgress({
          stage: 'error',
          percent: 0,
          loadedBytes: 0,
          totalBytes: rawFile.size,
          statusText: 'UPLOAD FAILED',
          error: detailMessage,
        });
      }
    },
    [
      user,
      hasReachedFreeLimit,
      enablePreConvert,
      preTargetFormat,
      preQuality,
      preMaxWidth,
      setIsUploading,
      onOpenAuth,
      onOpenProModal,
      onUploadSuccess,
    ]
  );

  // Global Clipboard Paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')
      ) {
        return;
      }

      if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              e.preventDefault();
              processUpload(file);
              return;
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [processUpload]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isUploading) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ALL_IMAGE_FORMATS}
        className="hidden"
        onChange={handleFileSelect}
        disabled={isUploading || !effectiveUser || hasReachedFreeLimit}
      />

      {/* Validation / Error Banner */}
      {validationError && (
        <div className="flex items-start gap-3 p-4 bg-neo-pink/20 border-[3px] border-black shadow-brutal text-black animate-fadeIn">
          <div className="p-1 bg-neo-pink border-2 border-black flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-black stroke-[2.5]" />
          </div>
          <div className="flex-1 font-mono font-bold text-xs uppercase leading-relaxed pt-0.5">
            {validationError}
          </div>
          <button
            onClick={() => setValidationError(null)}
            className="w-6 h-6 bg-white border-2 border-black flex items-center justify-center font-black hover:bg-black hover:text-white transition-colors"
            title="Dismiss error"
          >
            <X className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      )}

      {/* Upload Progress Error Notice */}
      {progress?.stage === 'error' && progress.error && (
        <div className="flex items-start gap-3 p-4 bg-neo-pink/25 border-[3px] border-black shadow-brutal text-black animate-fadeIn">
          <div className="p-1 bg-neo-pink border-2 border-black flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-black stroke-[2.5]" />
          </div>
          <div className="flex-1 font-mono font-bold text-xs uppercase leading-relaxed pt-0.5">
            {progress.error}
          </div>
          <button
            onClick={() => setProgress(null)}
            className="w-6 h-6 bg-white border-2 border-black flex items-center justify-center font-black hover:bg-black hover:text-white transition-colors"
          >
            <X className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      )}

      {/* Auth Gate Banner (If not logged in) */}
      {!effectiveUser ? (
        <div className="p-5 sm:p-8 md:p-10 bg-white border-[4px] border-black shadow-brutal-xl text-center space-y-5 sm:space-y-6 relative overflow-hidden">
          <div className="inline-block p-3 sm:p-4 bg-neo-yellow border-[3px] border-black shadow-brutal -rotate-2 hover:rotate-2 transition-transform">
            <Lock className="w-8 h-8 sm:w-10 sm:h-10 text-black stroke-[2.5]" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <div className="inline-block px-3 py-1 bg-neo-pink border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm rotate-1">
              CLOUD STORAGE ACCESS
            </div>
            <h3 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight text-black">
              Sign In To Host Images On Cloud
            </h3>
            <p className="font-mono text-xs text-black/80 font-bold leading-relaxed">
              Sign in with your Google account to get instant high-speed image uploads, shareable short URLs, embed codes, and your private gallery.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
            <button
              onClick={onOpenAuth}
              className="w-full sm:w-auto min-h-[48px] px-7 py-3 bg-neo-yellow hover:bg-neo-lime active:translate-x-1 active:translate-y-1 border-[3px] border-black font-black uppercase text-xs sm:text-sm tracking-wider text-black shadow-brutal transition-all flex items-center justify-center gap-2"
            >
              <span>Continue with Google</span>
              <ArrowRight className="w-4 h-4 stroke-[3]" />
            </button>

            {onSwitchToConverter && (
              <button
                onClick={() => onSwitchToConverter()}
                className="w-full sm:w-auto min-h-[48px] px-6 py-3 bg-neo-cyan hover:bg-white active:translate-x-1 active:translate-y-1 border-[3px] border-black font-mono font-black uppercase text-xs text-black shadow-brutal transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4 stroke-[2.5]" />
                <span>Use Free Format Converter (No Sign-In)</span>
              </button>
            )}
          </div>
        </div>
      ) : hasReachedFreeLimit ? (
        /* Free Limit Reached Card */
        <div className="p-6 sm:p-8 md:p-10 bg-neo-yellow border-[4px] border-black shadow-brutal-xl text-center space-y-5 relative overflow-hidden">
          <div className="inline-block p-3 sm:p-4 bg-neo-lime border-[3px] border-black shadow-brutal -rotate-2">
            <Crown className="w-8 h-8 sm:w-10 sm:h-10 text-black stroke-[3]" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <div className="inline-block px-3 py-1 bg-neo-pink border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm rotate-1">
              FREE QUOTA FULL · 3 OF 3 IMAGES
            </div>
            <h3 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight text-black">
              Free Cloud Limit Reached!
            </h3>
            <p className="font-mono text-xs text-black/80 font-bold leading-relaxed">
              Free tier accounts can host up to 3 cloud images. Submit a quick upgrade request to unlock{' '}
              <span className="font-black">UNLIMITED PRO UPLOADS</span>, or use the local Converter Studio anytime!
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onOpenProModal}
              className="w-full sm:w-auto min-h-[48px] px-8 py-3 bg-neo-lime hover:bg-white active:translate-x-1 active:translate-y-1 border-[3px] border-black font-black uppercase text-sm tracking-wider text-black shadow-brutal transition-all flex items-center justify-center gap-2"
            >
              <Crown className="w-4 h-4 stroke-[3]" />
              <span>Upgrade to Pro (Free)</span>
            </button>

            {onSwitchToConverter && (
              <button
                onClick={() => onSwitchToConverter()}
                className="w-full sm:w-auto min-h-[48px] px-6 py-3 bg-white hover:bg-neo-cyan border-[3px] border-black font-mono font-black uppercase text-xs text-black shadow-brutal transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4 stroke-[2.5]" />
                <span>Open Format Converter Studio</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Active Cloud Dropzone + Pre-Upload Format Conversion Bar */
        <div className="space-y-4">
          {/* Integrated Pre-Upload Conversion & Optimization Bar */}
          <div className="bg-white border-[3px] border-black shadow-brutal p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-neo-cyan border-2 border-black flex items-center justify-center shadow-brutal-sm flex-shrink-0">
                  <Sliders className="w-4 h-4 text-black stroke-[2.5]" />
                </div>
                <div className="min-w-0">
                  <span className="font-black text-xs sm:text-sm uppercase text-black block leading-tight">
                    Pre-Upload Format Converter & Optimizer
                  </span>
                  <span className="font-mono text-[11px] font-bold text-black/70 block">
                    Automatically convert format, compress size, and strip EXIF before cloud upload
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 self-start sm:self-center flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setEnablePreConvert((prev) => !prev)}
                  className={`min-h-[36px] px-3 py-1.5 border-2 border-black font-mono font-black text-xs uppercase transition-all ${
                    enablePreConvert
                      ? 'bg-neo-lime text-black shadow-brutal-sm'
                      : 'bg-neo-bg hover:bg-neo-yellow text-black'
                  }`}
                >
                  {enablePreConvert
                    ? `AUTO-CONVERT: .${preTargetFormat.toUpperCase()}`
                    : 'KEEP ORIGINAL'}
                </button>

                {onSwitchToConverter && (
                  <button
                    type="button"
                    onClick={() => onSwitchToConverter()}
                    className="min-h-[36px] px-3 py-1.5 bg-white hover:bg-neo-cyan border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                    <span>Studio</span>
                  </button>
                )}
              </div>
            </div>

            {enablePreConvert && (
              <div className="pt-3 border-t-2 border-black grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs animate-fadeIn">
                {/* Target Format Selector */}
                <div className="space-y-1">
                  <label className="font-black text-[11px] uppercase text-black block">
                    Convert Upload To:
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {OUTPUT_FORMATS.map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setPreTargetFormat(fmt.id)}
                        className={`px-2 py-1 border-2 border-black font-black text-[11px] uppercase transition-all ${
                          preTargetFormat === fmt.id
                            ? 'bg-neo-yellow text-black shadow-brutal-sm'
                            : 'bg-neo-bg hover:bg-white text-black/80'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quality Slider */}
                <div className="space-y-1">
                  <div className="flex justify-between font-black text-[11px] uppercase text-black">
                    <span>Compression Quality:</span>
                    <span className="tabular-nums">{preQuality}%</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={preQuality}
                    onChange={(e) => setPreQuality(Number(e.target.value))}
                    className="w-full accent-black cursor-pointer"
                  />
                  <div className="flex items-center gap-1 text-[10px] text-black/70 font-bold">
                    <ShieldCheck className="w-3 h-3 stroke-[2.5]" />
                    <span>Strips GPS & EXIF metadata automatically</span>
                  </div>
                </div>

                {/* Max Dimension Cap */}
                <div className="space-y-1">
                  <label className="font-black text-[11px] uppercase text-black block">
                    Max Width Limit:
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { label: 'Original', val: null },
                      { label: '1920px', val: 1920 },
                      { label: '1280px', val: 1280 },
                      { label: '800px', val: 800 },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setPreMaxWidth(opt.val)}
                        className={`py-1 px-1.5 border-2 border-black font-black text-[11px] uppercase ${
                          preMaxWidth === opt.val
                            ? 'bg-neo-cyan text-black shadow-brutal-sm'
                            : 'bg-neo-bg hover:bg-white text-black'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Neo-Brutalist Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`relative group bg-white border-[4px] border-black p-4 sm:p-8 md:p-12 transition-all duration-200 text-center select-none cursor-pointer overflow-hidden ${
              isDragging
                ? 'bg-neo-cyan/20 shadow-brutal-xl scale-[1.01]'
                : isUploading
                ? 'bg-neo-bg cursor-wait shadow-brutal'
                : 'shadow-brutal-lg hover:shadow-brutal-xl hover:-translate-x-0.5 hover:-translate-y-0.5'
            }`}
          >
            {/* Retro Window Header Bar */}
            <div className="bg-neo-yellow border-b-[3px] border-black px-3 sm:px-4 py-2 flex items-center justify-between text-black font-mono font-black text-xs uppercase -mt-4 -mx-4 mb-4 sm:-mt-8 sm:-mx-8 sm:mb-6 md:-mt-12 md:-mx-12">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-neo-red border-2 border-black rounded-full inline-block" />
                <span className="w-3 h-3 bg-neo-yellow border-2 border-black rounded-full inline-block" />
                <span className="w-3 h-3 bg-neo-lime border-2 border-black rounded-full inline-block" />
                <span className="ml-1 sm:ml-2 tracking-wider hidden xs:inline">
                  IMGLINK CLOUD ·{' '}
                  {isPro ? 'PRO TIER' : `FREE TIER (${effectiveUser?.imageCount ?? 0}/3 USED)`}
                </span>
                <span className="ml-1 tracking-wider xs:hidden">
                  {isPro ? 'PRO' : `${effectiveUser?.imageCount ?? 0}/3 USED`}
                </span>
              </div>
              <span className="px-2 py-0.5 bg-black text-white text-[10px] tracking-widest font-black">
                {isUploading
                  ? 'PROCESSING'
                  : enablePreConvert
                  ? `CONVERT TO .${preTargetFormat.toUpperCase()}`
                  : 'READY'}
              </span>
            </div>

            {isUploading && progress && progress.stage !== 'error' ? (
              /* Uploading Progress State */
              <div className="py-4 px-2 max-w-lg mx-auto space-y-6">
                <div className="flex justify-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-neo-cyan border-[3px] border-black shadow-brutal flex items-center justify-center text-black">
                    {progress.stage === 'completed' ? (
                      <CheckCircle2 className="w-8 h-8 sm:w-9 sm:h-9 text-black stroke-[3]" />
                    ) : (
                      <Loader2 className="w-8 h-8 sm:w-9 sm:h-9 animate-spin text-black stroke-[3]" />
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-black truncate px-2 sm:px-4">
                    {selectedFileName || 'UPLOADING FILE...'}
                  </h3>
                  <p className="font-mono font-bold text-xs uppercase text-black/80">
                    {progress.statusText}
                  </p>
                </div>

                {/* Chunky Brutalist Progress Bar */}
                <div className="w-full bg-white border-[3px] border-black h-7 sm:h-8 p-1 shadow-brutal overflow-hidden">
                  <div
                    className={`h-full border-r-2 border-black transition-all duration-200 ${
                      progress.stage === 'completed' ? 'bg-neo-lime' : 'bg-neo-cyan'
                    }`}
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-xs font-mono font-black text-black tabular-nums">
                  <span className="truncate max-w-[220px]">
                    {progress.loadedBytes > 0
                      ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`
                      : 'INITIALIZING'}
                  </span>
                  <span className="px-2 py-0.5 bg-black text-white flex-shrink-0">
                    {progress.percent}%
                  </span>
                </div>
              </div>
            ) : (
              /* Ready to Upload State */
              <div className="flex flex-col items-center justify-center gap-4 sm:gap-5 py-2">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-neo-yellow group-hover:bg-neo-pink border-[3px] border-black shadow-brutal flex items-center justify-center text-black group-hover:rotate-6 group-hover:scale-105 transition-all">
                  <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10 stroke-[2.5]" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight text-black leading-snug">
                    <span className="hidden sm:inline">Drag & Drop Any Image Here, or </span>
                    <span className="sm:hidden">Tap to Upload or </span>
                    <span className="bg-neo-cyan px-2 py-0.5 border-2 border-black shadow-brutal-sm inline-block -rotate-1">
                      Browse
                    </span>
                  </h3>
                  <p className="hidden sm:block font-mono text-xs font-bold text-black/80">
                    Clipboard paste supported:{' '}
                    <kbd className="px-2 py-1 bg-neo-pink text-black border-2 border-black text-xs font-mono font-black shadow-brutal-sm">
                      CTRL + V
                    </kbd>{' '}
                    or{' '}
                    <kbd className="px-2 py-1 bg-neo-cyan text-black border-2 border-black text-xs font-mono font-black shadow-brutal-sm">
                      ⌘ + V
                    </kbd>
                  </p>
                  <p className="sm:hidden font-mono text-xs font-bold text-black/80">
                    Tap to select from photos, files, or camera
                  </p>
                </div>

                {/* Supported Formats Badges */}
                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 pt-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-neo-yellow border-2 border-black font-mono font-black text-[11px] sm:text-xs uppercase text-black shadow-brutal-sm -rotate-1">
                    <ImageIcon className="w-3.5 h-3.5" />
                    PNG, JPG, JFIF, WEBP, AVIF, GIF, SVG, BMP, ICO
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-neo-lime border-2 border-black font-mono font-black text-[11px] sm:text-xs uppercase text-black shadow-brutal-sm rotate-1">
                    <FileUp className="w-3.5 h-3.5" />
                    MAX 10MB
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 bg-neo-cyan border-2 border-black font-mono font-black text-[11px] sm:text-xs uppercase text-black shadow-brutal-sm -rotate-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    {enablePreConvert
                      ? `AUTO-CONVERT TO .${preTargetFormat.toUpperCase()}`
                      : 'INSTANT DIRECT CLOUD'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
