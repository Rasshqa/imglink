import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  RefreshCw,
  Download,
  UploadCloud,
  Sliders,
  Maximize2,
  Crop,
  ShieldCheck,
  Sparkles,
  Check,
  Copy,
  Trash2,
  Plus,
  Lock,
  Unlock,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Archive,
  Crown,
  Eye,
  ArrowRight,
  Layers,
  FileCheck2,
  AlertCircle,
  Loader2,
  Wand2,
} from 'lucide-react';
import type {
  AuthUser,
  ConversionSettings,
  ConverterQueueItem,
  CropPreset,
  ImageRecord,
  SupportedOutputFormat,
} from '../types';
import {
  ACCEPT_ALL_IMAGE_FORMATS,
  DEFAULT_CONVERSION_SETTINGS,
  DEFAULT_FILTERS,
  OUTPUT_FORMATS,
  buildZipArchive,
  convertImageFile,
  detectFileFormatLabel,
  getFormatMeta,
  inspectImageMetadata,
  isSupportedImageFile,
  loadImageElement,
} from '../utils/imageConverter';
import { formatBytes } from '../utils/formatters';
import { getStoredUser } from '../utils/auth';

interface ImageConverterStudioProps {
  user: AuthUser | null;
  onOpenAuth: () => void;
  onOpenProModal: () => void;
  onUploadConvertedSuccess: (record: ImageRecord) => void;
  initialFile?: File | null;
  onClearInitialFile?: () => void;
}

type StudioToolTab = 'format' | 'resize' | 'adjust' | 'exif';

const CROP_PRESETS: { id: CropPreset; label: string }[] = [
  { id: 'free', label: 'Original' },
  { id: '1:1', label: '1:1 Square' },
  { id: '16:9', label: '16:9 Wide' },
  { id: '4:3', label: '4:3 Photo' },
  { id: '9:16', label: '9:16 Vertical' },
  { id: '3:2', label: '3:2 Classic' },
];

const SCALE_PRESETS = [25, 50, 75, 100, 150, 200];

const BG_COLOR_PRESETS = [
  '#FFFFFF',
  '#FAF8F0',
  '#000000',
  '#FFE600',
  '#00E5FF',
  '#FF5CAA',
  '#A3E635',
];

export const ImageConverterStudio: React.FC<ImageConverterStudioProps> = ({
  user,
  onOpenAuth,
  onOpenProModal,
  onUploadConvertedSuccess,
  initialFile,
  onClearInitialFile,
}) => {
  const [queue, setQueue] = useState<ConverterQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConversionSettings>(DEFAULT_CONVERSION_SETTINGS);
  const [activeToolTab, setActiveToolTab] = useState<StudioToolTab>('format');
  const [compareMode, setCompareMode] = useState<'converted' | 'original' | 'split'>('converted');
  const [splitPosition, setSplitPosition] = useState<number>(50);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [proBatchNotice, setProBatchNotice] = useState<boolean>(false);
  const [isConvertingAll, setIsConvertingAll] = useState<boolean>(false);
  const [isBuildingZip, setIsBuildingZip] = useState<boolean>(false);
  const [isUploadingCloud, setIsUploadingCloud] = useState<boolean>(false);
  const [cloudUploadStatus, setCloudUploadStatus] = useState<string | null>(null);
  const [copiedClipboard, setCopiedClipboard] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const effectiveUser = user || getStoredUser();
  const isPro = Boolean(effectiveUser?.tier === 'pro' || effectiveUser?.role === 'admin');
  const hasReachedFreeCloudLimit = Boolean(effectiveUser && !isPro && (effectiveUser.imageCount ?? 0) >= 3);

  const activeItem = queue.find((item) => item.id === selectedId) || queue[0] || null;
  const currentFormatMeta = getFormatMeta(settings.targetFormat);

  // Add one or more files to the converter studio queue
  const ingestFiles = useCallback(
    async (fileList: File[] | FileList) => {
      setErrorBanner(null);
      setProBatchNotice(false);

      const incoming = Array.from(fileList).filter((f) => isSupportedImageFile(f));
      if (incoming.length === 0) {
        setErrorBanner(
          'Unsupported file selected. Supported formats: PNG, JPG, JPEG, JFIF, WEBP, AVIF, GIF, SVG, BMP, ICO, TIFF.'
        );
        return;
      }

      // Check batch gate: Free / unauthenticated users convert 1 file at a time; Pro users can batch up to 20 files
      let filesToProcess = incoming;
      if (!isPro && (incoming.length > 1 || queue.length >= 1)) {
        setProBatchNotice(true);
        filesToProcess = [incoming[0]];
      } else if (isPro && queue.length + incoming.length > 20) {
        filesToProcess = incoming.slice(0, Math.max(1, 20 - queue.length));
      }

      const newItems: ConverterQueueItem[] = [];

      for (const file of filesToProcess) {
        try {
          const { objectUrl, width, height } = await loadImageElement(file);
          const exif = await inspectImageMetadata(file, width, height);
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          newItems.push({
            id,
            file,
            originalUrl: objectUrl,
            originalWidth: width,
            originalHeight: height,
            exif,
            status: 'idle',
          });
        } catch (err) {
          setErrorBanner(
            err instanceof Error ? err.message : `Failed to decode image "${file.name}".`
          );
        }
      }

      if (newItems.length === 0) return;

      setQueue((prev) => {
        if (!isPro) {
          // Clean up previous URLs in single-file mode
          prev.forEach((old) => {
            URL.revokeObjectURL(old.originalUrl);
            if (old.convertedUrl) URL.revokeObjectURL(old.convertedUrl);
          });
          return [newItems[0]];
        }
        return [...prev, ...newItems];
      });

      setSelectedId(newItems[0].id);

      // Reset custom pixel overrides when loading a fresh single file so dimensions match the new image
      if (!isPro || queue.length === 0) {
        setSettings((prev) => ({
          ...prev,
          width: null,
          height: null,
          scalePercent: 100,
        }));
      }
    },
    [isPro, queue.length]
  );

  // Load initialFile if passed from Vault or ResultCard
  useEffect(() => {
    if (initialFile) {
      ingestFiles([initialFile]);
      onClearInitialFile?.();
    }
  }, [initialFile, ingestFiles, onClearInitialFile]);

  // Run live conversion on activeItem whenever settings or activeItem.id changes
  useEffect(() => {
    if (!activeItem) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setQueue((prev) =>
        prev.map((it) => (it.id === activeItem.id ? { ...it, status: 'processing' } : it))
      );

      try {
        const result = await convertImageFile(activeItem.file, settings);
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }

        setQueue((prev) =>
          prev.map((it) => {
            if (it.id !== activeItem.id) return it;
            if (it.convertedUrl) {
              URL.revokeObjectURL(it.convertedUrl);
            }
            return {
              ...it,
              status: 'done',
              convertedBlob: result.blob,
              convertedUrl: result.url,
              convertedFileName: result.fileName,
              convertedMimeType: result.mimeType,
              convertedSize: result.sizeBytes,
              convertedWidth: result.width,
              convertedHeight: result.height,
              processingTimeMs: result.processingTimeMs,
              error: undefined,
            };
          })
        );
      } catch (err) {
        if (cancelled) return;
        setQueue((prev) =>
          prev.map((it) =>
            it.id === activeItem.id
              ? {
                  ...it,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Conversion failed',
                }
              : it
          )
        );
      }
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeItem?.id, activeItem?.file, settings]);

  // Global clipboard paste support when inside Converter Studio
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

      if (e.clipboardData?.items) {
        const pastedFiles: File[] = [];
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) pastedFiles.push(f);
          }
        }
        if (pastedFiles.length > 0) {
          e.preventDefault();
          ingestFiles(pastedFiles);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [ingestFiles]);

  // Generate a vibrant procedural Neo-Brutalist test image for instant 1-click testing
  const handleLoadSampleImage = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Neo-brutalist geometric poster pattern
    ctx.fillStyle = '#FAF8F0';
    ctx.fillRect(0, 0, 1200, 800);

    // Grid lines
    ctx.strokeStyle = '#E2DDD0';
    ctx.lineWidth = 2;
    for (let x = 0; x < 1200; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 800);
      ctx.stroke();
    }
    for (let y = 0; y < 800; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1200, y);
      ctx.stroke();
    }

    // Offset shadow blocks
    const drawBlock = (
      x: number,
      y: number,
      w: number,
      h: number,
      fill: string
    ) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + 12, y + 12, w, h);
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 8;
      ctx.strokeRect(x, y, w, h);
    };

    drawBlock(90, 90, 460, 290, '#FFE600');
    drawBlock(610, 110, 490, 270, '#00E5FF');
    drawBlock(120, 430, 960, 270, '#FF5CAA');

    // Center badge
    drawBlock(380, 260, 440, 240, '#A3E635');

    ctx.fillStyle = '#000000';
    ctx.font = '900 54px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IMGLINK STUDIO', 600, 365);
    ctx.font = '700 26px JetBrains Mono, monospace';
    ctx.fillText('1200×800 RGB TEST PATTERN', 600, 425);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const sampleFile = new File([blob], 'imglink-studio-sample.png', {
        type: 'image/png',
      });
      ingestFiles([sampleFile]);
    }, 'image/png');
  };

  // Convert all items in batch queue (for Pro multi-file queues)
  const handleConvertAllBatch = async () => {
    if (queue.length === 0) return;
    setIsConvertingAll(true);
    try {
      for (const item of queue) {
        setQueue((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'processing' } : it))
        );
        try {
          const res = await convertImageFile(item.file, settings);
          setQueue((prev) =>
            prev.map((it) => {
              if (it.id !== item.id) return it;
              if (it.convertedUrl) URL.revokeObjectURL(it.convertedUrl);
              return {
                ...it,
                status: 'done',
                convertedBlob: res.blob,
                convertedUrl: res.url,
                convertedFileName: res.fileName,
                convertedMimeType: res.mimeType,
                convertedSize: res.sizeBytes,
                convertedWidth: res.width,
                convertedHeight: res.height,
                processingTimeMs: res.processingTimeMs,
              };
            })
          );
        } catch (err) {
          setQueue((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: 'error', error: 'Batch item conversion failed' }
                : it
            )
          );
        }
      }
    } finally {
      setIsConvertingAll(false);
    }
  };

  // Download single converted file
  const handleDownloadItem = (item: ConverterQueueItem) => {
    if (!item.convertedUrl || !item.convertedFileName) return;
    const a = document.createElement('a');
    a.href = item.convertedUrl;
    a.download = item.convertedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Download all converted files as a single .ZIP archive
  const handleDownloadBatchZip = async () => {
    setIsBuildingZip(true);
    try {
      // Ensure every item in queue has been converted with current settings
      const readyFiles: { fileName: string; blob: Blob }[] = [];
      for (const item of queue) {
        if (item.convertedBlob && item.convertedFileName) {
          readyFiles.push({ fileName: item.convertedFileName, blob: item.convertedBlob });
        } else {
          const res = await convertImageFile(item.file, settings);
          readyFiles.push({ fileName: res.fileName, blob: res.blob });
        }
      }

      if (readyFiles.length === 0) return;
      const zipBlob = await buildZipArchive(readyFiles);
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `imglink-converted-${settings.targetFormat}-${readyFiles.length}files.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(zipUrl), 5000);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to build ZIP archive.');
    } finally {
      setIsBuildingZip(false);
    }
  };

  // Copy converted image to clipboard
  const handleCopyConvertedImage = async () => {
    if (!activeItem?.convertedBlob) return;
    try {
      if (
        navigator.clipboard &&
        typeof ClipboardItem !== 'undefined' &&
        activeItem.convertedBlob.type === 'image/png'
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': activeItem.convertedBlob }),
        ]);
      } else if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        // Convert to PNG blob for universal OS clipboard compatibility
        const pngRes = await convertImageFile(activeItem.file, {
          ...settings,
          targetFormat: 'png',
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngRes.blob })]);
        URL.revokeObjectURL(pngRes.url);
      }
      setCopiedClipboard(true);
      setTimeout(() => setCopiedClipboard(false), 2200);
    } catch {
      // Fallback: copy data URL string
      if (activeItem.convertedUrl) {
        await navigator.clipboard.writeText(activeItem.convertedUrl);
        setCopiedClipboard(true);
        setTimeout(() => setCopiedClipboard(false), 2200);
      }
    }
  };

  // Upload the converted image directly to ImgLink Cloud Storage & generate shareable short URL
  const handleUploadConvertedToCloud = async () => {
    if (!activeItem?.convertedBlob || !activeItem.convertedFileName) return;

    if (!effectiveUser) {
      onOpenAuth();
      return;
    }

    if (hasReachedFreeCloudLimit) {
      onOpenProModal();
      return;
    }

    setIsUploadingCloud(true);
    setCloudUploadStatus('1/3 REQUESTING CLOUD LINK...');
    setErrorBanner(null);

    try {
      const convertedFile = new File(
        [activeItem.convertedBlob],
        activeItem.convertedFileName,
        { type: activeItem.convertedMimeType || 'image/png' }
      );

      const urlResponse = await axios.post<{ uploadUrl: string; fileKey: string }>(
        '/api/upload-url',
        {
          fileName: convertedFile.name,
          mimeType: convertedFile.type,
          sizeBytes: convertedFile.size,
        }
      );

      const { uploadUrl, fileKey } = urlResponse.data;
      setCloudUploadStatus('2/3 STREAMING CONVERTED IMAGE...');

      await axios.put(uploadUrl, convertedFile, {
        headers: { 'Content-Type': convertedFile.type },
      });

      setCloudUploadStatus('3/3 GENERATING SHORT URL...');
      const metadataResponse = await axios.post<ImageRecord>('/api/images', {
        fileKey,
        originalName: convertedFile.name,
        mimeType: convertedFile.type,
        sizeBytes: convertedFile.size,
      });

      setCloudUploadStatus(null);
      setIsUploadingCloud(false);
      onUploadConvertedSuccess(metadataResponse.data);
    } catch (err) {
      setIsUploadingCloud(false);
      setCloudUploadStatus(null);
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        onOpenAuth();
        return;
      }
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        onOpenProModal();
        return;
      }
      setErrorBanner(
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to upload converted image to cloud storage.'
      );
    }
  };

  const handleRemoveQueueItem = (id: string) => {
    setQueue((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) {
        URL.revokeObjectURL(target.originalUrl);
        if (target.convertedUrl) URL.revokeObjectURL(target.convertedUrl);
      }
      const next = prev.filter((it) => it.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id || null);
      }
      return next;
    });
  };

  const handleClearQueue = () => {
    queue.forEach((it) => {
      URL.revokeObjectURL(it.originalUrl);
      if (it.convertedUrl) URL.revokeObjectURL(it.convertedUrl);
    });
    setQueue([]);
    setSelectedId(null);
    setProBatchNotice(false);
  };

  const handleWidthChange = (newWidthStr: string) => {
    const val = parseInt(newWidthStr, 10);
    if (isNaN(val) || val <= 0) {
      setSettings((prev) => ({ ...prev, width: null, height: null }));
      return;
    }
    if (settings.lockAspectRatio && activeItem) {
      const ratio = activeItem.originalHeight / activeItem.originalWidth;
      setSettings((prev) => ({
        ...prev,
        width: val,
        height: Math.max(1, Math.round(val * ratio)),
      }));
    } else {
      setSettings((prev) => ({ ...prev, width: val }));
    }
  };

  const handleHeightChange = (newHeightStr: string) => {
    const val = parseInt(newHeightStr, 10);
    if (isNaN(val) || val <= 0) {
      setSettings((prev) => ({ ...prev, width: null, height: null }));
      return;
    }
    if (settings.lockAspectRatio && activeItem) {
      const ratio = activeItem.originalWidth / activeItem.originalHeight;
      setSettings((prev) => ({
        ...prev,
        height: val,
        width: Math.max(1, Math.round(val * ratio)),
      }));
    } else {
      setSettings((prev) => ({ ...prev, height: val }));
    }
  };

  const applyResolutionPreset = (w: number, h: number) => {
    if (!activeItem) {
      setSettings((prev) => ({ ...prev, width: w, height: h }));
      return;
    }
    if (settings.lockAspectRatio) {
      const scale = Math.min(w / activeItem.originalWidth, h / activeItem.originalHeight);
      setSettings((prev) => ({
        ...prev,
        width: Math.max(1, Math.round(activeItem.originalWidth * scale)),
        height: Math.max(1, Math.round(activeItem.originalHeight * scale)),
        scalePercent: 100,
      }));
    } else {
      setSettings((prev) => ({ ...prev, width: w, height: h, scalePercent: 100 }));
    }
  };

  const applyFilterPreset = (
    preset: 'normal' | 'vivid' | 'noir' | 'vintage' | 'contrast' | 'invert'
  ) => {
    if (preset === 'normal') {
      setSettings((prev) => ({ ...prev, filters: { ...DEFAULT_FILTERS } }));
    } else if (preset === 'vivid') {
      setSettings((prev) => ({
        ...prev,
        filters: { ...DEFAULT_FILTERS, contrast: 115, saturation: 145, brightness: 104 },
      }));
    } else if (preset === 'noir') {
      setSettings((prev) => ({
        ...prev,
        filters: { ...DEFAULT_FILTERS, grayscale: 100, contrast: 125 },
      }));
    } else if (preset === 'vintage') {
      setSettings((prev) => ({
        ...prev,
        filters: { ...DEFAULT_FILTERS, sepia: 75, contrast: 108, brightness: 96, saturation: 85 },
      }));
    } else if (preset === 'contrast') {
      setSettings((prev) => ({
        ...prev,
        filters: { ...DEFAULT_FILTERS, contrast: 140, brightness: 102 },
      }));
    } else if (preset === 'invert') {
      setSettings((prev) => ({
        ...prev,
        filters: { ...DEFAULT_FILTERS, invert: true },
      }));
    }
  };

  // Calculate size delta percentage
  const sizeSavingsInfo = (() => {
    if (!activeItem || !activeItem.convertedSize) return null;
    const orig = activeItem.file.size;
    const conv = activeItem.convertedSize;
    const diff = orig - conv;
    const pct = orig > 0 ? Math.round((diff / orig) * 100) : 0;
    return {
      diffBytes: diff,
      percent: pct,
      isSmaller: diff >= 0,
    };
  })();

  return (
    <div className="w-full space-y-6 animate-fadeIn">
      {/* Hidden File Input supporting single or multi-file selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ALL_IMAGE_FORMATS}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Error Notice */}
      {errorBanner && (
        <div className="p-4 bg-neo-pink/30 border-[3px] border-black shadow-brutal flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 font-mono text-xs font-bold text-black">
            <AlertCircle className="w-5 h-5 stroke-[2.5] flex-shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="px-2.5 py-1 bg-white border-2 border-black font-mono font-black text-xs hover:bg-black hover:text-white transition-colors"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Pro Batch Gate Notice (When Guest/Free user drops multiple files) */}
      {proBatchNotice && !isPro && (
        <div className="p-4 bg-neo-yellow border-[3px] border-black shadow-brutal flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 bg-neo-lime border-2 border-black shadow-brutal-sm flex-shrink-0">
              <Crown className="w-5 h-5 text-black stroke-[2.5]" />
            </div>
            <div>
              <h4 className="font-black text-xs sm:text-sm uppercase text-black">
                Single File Loaded · Batch Multi-File Conversion is a Pro Feature
              </h4>
              <p className="font-mono text-xs text-black/80 font-bold">
                Free mode converts 1 image at a time without sign-in. Upgrade to Pro for 20-file batch queues and 1-click ZIP downloads.
              </p>
            </div>
          </div>
          <button
            onClick={() => (effectiveUser ? onOpenProModal() : onOpenAuth())}
            className="px-4 py-2 bg-neo-lime hover:bg-white border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all"
          >
            <Crown className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{effectiveUser ? 'Unlock Batch Pro' : 'Sign In for Batch Pro'}</span>
          </button>
        </div>
      )}

      {/* Empty State Dropzone (When no file is loaded yet) */}
      {!activeItem ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              ingestFiles(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`bg-white border-[4px] border-black p-5 sm:p-10 md:p-12 text-center cursor-pointer transition-all select-none ${
            isDragging
              ? 'bg-neo-cyan/20 shadow-brutal-xl scale-[1.01]'
              : 'shadow-brutal-lg hover:shadow-brutal-xl'
          }`}
        >
          {/* Window Header */}
          <div className="bg-neo-cyan border-b-[3px] border-black px-4 py-2.5 flex items-center justify-between text-black font-mono font-black text-xs uppercase -mt-5 -mx-5 mb-6 sm:-mt-10 sm:-mx-10 sm:mb-8 md:-mt-12 md:-mx-12">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-neo-red border-2 border-black rounded-full inline-block" />
              <span className="w-3 h-3 bg-neo-yellow border-2 border-black rounded-full inline-block" />
              <span className="w-3 h-3 bg-neo-lime border-2 border-black rounded-full inline-block" />
              <span className="ml-1 tracking-wider">
                UNIVERSAL FORMAT CONVERTER STUDIO · {isPro ? 'PRO BATCH ENABLED' : 'FREE INSTANT MODE'}
              </span>
            </div>
            <span className="px-2 py-0.5 bg-black text-white text-[10px] tracking-widest">
              100% LOCAL & PRIVATE
            </span>
          </div>

          <div className="max-w-2xl mx-auto space-y-5 py-2">
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto bg-neo-cyan border-[3px] border-black shadow-brutal flex items-center justify-center text-black -rotate-2">
              <RefreshCw className="w-8 h-8 sm:w-10 sm:h-10 stroke-[2.5]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black uppercase tracking-tight text-black">
                Drop Any Image to{' '}
                <span className="bg-neo-yellow px-2 py-0.5 border-2 border-black shadow-brutal-sm inline-block -rotate-1">
                  Convert & Optimize
                </span>
              </h2>
              <p className="font-mono text-xs sm:text-sm font-bold text-black/80 max-w-xl mx-auto leading-relaxed">
                Convert between <span className="font-black text-black">PNG, JPG, JFIF, WEBP, AVIF, GIF, SVG, BMP, ICO, TIFF</span> with live compression, resize, crop/rotate, filters, and EXIF privacy stripping. No sign-in required.
              </p>
            </div>

            {/* Supported Formats Matrix Preview */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 pt-1">
              {OUTPUT_FORMATS.map((fmt) => (
                <span
                  key={fmt.id}
                  className={`px-2.5 py-1 ${fmt.badgeColor} border-2 border-black font-mono font-black text-xs uppercase shadow-brutal-sm`}
                >
                  .{fmt.extension}
                </span>
              ))}
            </div>

            {/* Action Buttons */}
            <div
              className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto min-h-[46px] px-6 py-3 bg-neo-yellow hover:bg-neo-lime border-[3px] border-black font-black uppercase text-xs sm:text-sm tracking-wider text-black shadow-brutal flex items-center justify-center gap-2 transition-all active:translate-x-0.5 active:translate-y-0.5"
              >
                <UploadCloud className="w-4 h-4 stroke-[2.5]" />
                <span>Select Image{isPro ? 's (Batch Ready)' : ''}</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSampleImage}
                className="w-full sm:w-auto min-h-[46px] px-5 py-3 bg-white hover:bg-neo-cyan border-[3px] border-black font-mono font-black uppercase text-xs text-black shadow-brutal flex items-center justify-center gap-2 transition-all active:translate-x-0.5 active:translate-y-0.5"
              >
                <Wand2 className="w-4 h-4 stroke-[2.5]" />
                <span>Load Sample Test Image</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Active Converter Studio Workspace */
        <div className="bg-white border-[4px] border-black shadow-brutal-xl overflow-hidden">
          {/* Studio Top Window Bar */}
          <div className="bg-neo-cyan border-b-[3px] border-black px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="w-3 h-3 bg-neo-red border-2 border-black rounded-full inline-block flex-shrink-0" />
              <span className="w-3 h-3 bg-neo-yellow border-2 border-black rounded-full inline-block flex-shrink-0" />
              <span className="w-3 h-3 bg-neo-lime border-2 border-black rounded-full inline-block flex-shrink-0" />
              <span className="font-mono font-black text-xs uppercase tracking-wider text-black ml-1 truncate">
                CONVERTER STUDIO · {detectFileFormatLabel(activeItem.file)} →{' '}
                {currentFormatMeta.label}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[34px] px-2.5 sm:px-3 py-1 bg-neo-yellow hover:bg-neo-lime border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm flex items-center gap-1.5 transition-all"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3] flex-shrink-0" />
                <span>{isPro ? 'Add Files' : 'New Image'}</span>
              </button>

              <button
                type="button"
                onClick={handleClearQueue}
                className="min-h-[34px] px-2.5 sm:px-3 py-1 bg-white hover:bg-neo-pink border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm flex items-center gap-1 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Main 12-Column Studio Grid */}
          <div className="p-3 sm:p-5 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
            {/* LEFT 5 COLUMNS: Live Preview, Before/After Inspector & Batch Queue */}
            <div className="lg:col-span-5 flex flex-col gap-4 min-w-0">
              {/* View Switcher Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-neo-bg border-2 border-black">
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {(['converted', 'original', 'split'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCompareMode(mode)}
                      className={`px-2.5 py-1 font-mono font-black text-[11px] uppercase border transition-all ${
                        compareMode === mode
                          ? 'bg-neo-yellow border-black text-black shadow-brutal-sm'
                          : 'bg-transparent border-transparent text-black/70 hover:text-black'
                      }`}
                    >
                      {mode === 'converted'
                        ? 'Converted'
                        : mode === 'original'
                        ? 'Original'
                        : 'Split'}
                    </button>
                  ))}
                </div>

                {activeItem.processingTimeMs && (
                  <span className="font-mono text-[11px] font-bold text-black/70 tabular-nums flex-shrink-0">
                    {activeItem.status === 'processing'
                      ? 'ENCODING...'
                      : `${activeItem.processingTimeMs}ms`}
                  </span>
                )}
              </div>

              {/* Interactive Canvas Viewport (Checkerboard transparency backdrop) */}
              <div
                className="relative aspect-[4/3] w-full border-[3px] border-black shadow-brutal overflow-hidden flex items-center justify-center bg-[#eee]"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #dcdcdc 25%, transparent 25%), linear-gradient(-45deg, #dcdcdc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #dcdcdc 75%), linear-gradient(-45deg, transparent 75%, #dcdcdc 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                }}
              >
                {activeItem.status === 'processing' && (
                  <div className="absolute top-3 left-3 z-20 px-2.5 py-1 bg-neo-yellow border-2 border-black font-mono font-black text-[10px] uppercase flex items-center gap-1.5 shadow-brutal-sm">
                    <Loader2 className="w-3 h-3 animate-spin stroke-[3]" />
                    <span>ENCODING {currentFormatMeta.label}...</span>
                  </div>
                )}

                {compareMode === 'original' ? (
                  <img
                    src={activeItem.originalUrl}
                    alt={activeItem.file.name}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : compareMode === 'split' && activeItem.convertedUrl ? (
                  <div className="relative w-full h-full flex items-center justify-center select-none">
                    {/* Base: Converted Image */}
                    <img
                      src={activeItem.convertedUrl}
                      alt="Converted preview"
                      className="max-w-full max-h-full object-contain"
                    />
                    {/* Clipped Overlay: Original Image */}
                    <div
                      className="absolute inset-0 flex items-center justify-center overflow-hidden"
                      style={{ clipPath: `inset(0 ${100 - splitPosition}% 0 0)` }}
                    >
                      <img
                        src={activeItem.originalUrl}
                        alt="Original preview"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    {/* Vertical Split Divider Line */}
                    <div
                      className="absolute top-0 bottom-0 w-1 bg-neo-yellow border-x border-black z-10 pointer-events-none"
                      style={{ left: `${splitPosition}%` }}
                    />
                    {/* Split Slider Control */}
                    <input
                      type="range"
                      min={5}
                      max={95}
                      value={splitPosition}
                      onChange={(e) => setSplitPosition(Number(e.target.value))}
                      className="absolute bottom-3 left-4 right-4 z-20 accent-black cursor-ew-resize"
                      title="Drag to compare Original (left) vs Converted (right)"
                    />
                  </div>
                ) : (
                  <img
                    src={activeItem.convertedUrl || activeItem.originalUrl}
                    alt={activeItem.convertedFileName || activeItem.file.name}
                    className="max-w-full max-h-full object-contain"
                  />
                )}

                {/* Format Transformation Badge */}
                <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 bg-white border-2 border-black font-mono font-black text-xs uppercase shadow-brutal-sm flex items-center gap-1.5">
                  <span>{detectFileFormatLabel(activeItem.file)}</span>
                  <ArrowRight className="w-3 h-3 stroke-[3]" />
                  <span className="px-1.5 py-0.5 bg-neo-lime border border-black">
                    {currentFormatMeta.label}
                  </span>
                </div>
              </div>

              {/* Before vs After Telemetry Comparison Card */}
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 gap-3 p-3 bg-neo-bg border-[3px] border-black shadow-brutal-sm font-mono">
                <div className="space-y-1 xs:border-r-2 sm:border-r-2 border-black xs:pr-2 sm:pr-2 min-w-0">
                  <span className="text-[10px] font-bold uppercase text-black/60 block truncate">
                    SOURCE ({detectFileFormatLabel(activeItem.file)})
                  </span>
                  <div className="text-sm font-black text-black tabular-nums truncate">
                    {formatBytes(activeItem.file.size)}
                  </div>
                  <div className="text-[11px] font-bold text-black/80 tabular-nums truncate">
                    {activeItem.originalWidth} × {activeItem.originalHeight} px
                  </div>
                </div>

                <div className="space-y-1 xs:pl-1 sm:pl-1 min-w-0 border-t-2 xs:border-t-0 sm:border-t-0 border-black pt-2 xs:pt-0 sm:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase text-black/60 truncate">
                      OUTPUT ({currentFormatMeta.label})
                    </span>
                    {sizeSavingsInfo && (
                      <span
                        className={`px-1.5 py-0.5 border border-black text-[10px] font-black tabular-nums flex-shrink-0 ${
                          sizeSavingsInfo.isSmaller ? 'bg-neo-lime' : 'bg-neo-yellow'
                        }`}
                      >
                        {sizeSavingsInfo.isSmaller
                          ? `-${sizeSavingsInfo.percent}%`
                          : `+${Math.abs(sizeSavingsInfo.percent)}%`}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-black text-black tabular-nums truncate">
                    {activeItem.convertedSize ? formatBytes(activeItem.convertedSize) : '...'}
                  </div>
                  <div className="text-[11px] font-bold text-black/80 tabular-nums truncate">
                    {activeItem.convertedWidth || activeItem.originalWidth} ×{' '}
                    {activeItem.convertedHeight || activeItem.originalHeight} px
                  </div>
                </div>
              </div>

              {/* Batch Queue List */}
              <div className="border-[3px] border-black bg-white p-3 space-y-2.5 shadow-brutal-sm min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-black text-xs uppercase text-black flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                    <span>
                      QUEUE ({queue.length} {queue.length === 1 ? 'FILE' : 'FILES'})
                    </span>
                  </span>

                  {!isPro ? (
                    <button
                      type="button"
                      onClick={() => (effectiveUser ? onOpenProModal() : onOpenAuth())}
                      className="px-2 py-0.5 bg-neo-yellow hover:bg-neo-lime border border-black font-mono font-black text-[10px] uppercase text-black flex items-center gap-1"
                    >
                      <Crown className="w-3 h-3 stroke-[2.5] flex-shrink-0" />
                      <span>Unlock Batch</span>
                    </button>
                  ) : (
                    queue.length > 1 && (
                      <button
                        type="button"
                        onClick={handleConvertAllBatch}
                        disabled={isConvertingAll}
                        className="px-2.5 py-0.5 bg-neo-lime hover:bg-neo-yellow border border-black font-mono font-black text-[10px] uppercase text-black flex items-center gap-1"
                      >
                        <RefreshCw
                          className={`w-3 h-3 flex-shrink-0 ${
                            isConvertingAll ? 'animate-spin' : ''
                          }`}
                        />
                        <span>Convert All ({queue.length})</span>
                      </button>
                    )
                  )}
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {queue.map((item) => {
                    const isSelected = item.id === activeItem.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={`p-2 border-2 border-black flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                          isSelected ? 'bg-neo-yellow/40' : 'bg-neo-bg hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <img
                            src={item.originalUrl}
                            alt={item.file.name}
                            className="w-8 h-8 object-cover border border-black bg-white flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono font-black text-xs text-black truncate">
                              {item.file.name}
                            </div>
                            <div className="font-mono text-[10px] text-black/70 tabular-nums truncate">
                              {formatBytes(item.file.size)}
                              {item.convertedSize
                                ? ` → ${formatBytes(item.convertedSize)} (.${currentFormatMeta.extension})`
                                : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          {item.convertedUrl && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadItem(item);
                              }}
                              className="p-1.5 bg-neo-lime border border-black text-black hover:bg-neo-cyan"
                              title="Download converted file"
                            >
                              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                            </button>
                          )}
                          {queue.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveQueueItem(item.id);
                              }}
                              className="p-1.5 bg-white border border-black text-black hover:bg-neo-pink"
                              title="Remove from queue"
                            >
                              <Trash2 className="w-3.5 h-3.5 stroke-[2.5]" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT 7 COLUMNS: Format Matrix, Enhancement Tools & Output Actions */}
            <div className="lg:col-span-7 flex flex-col justify-between gap-5 min-w-0">
              <div className="space-y-5 min-w-0">
                {/* Studio Tool Category Tabs — Responsive Grid with Contained Truncation */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-neo-bg border-[3px] border-black shadow-brutal-sm">
                  <button
                    type="button"
                    onClick={() => setActiveToolTab('format')}
                    className={`min-h-[42px] min-w-0 overflow-hidden px-2 py-1.5 font-mono font-black text-[11px] sm:text-xs uppercase flex items-center justify-center gap-1.5 border-2 transition-all ${
                      activeToolTab === 'format'
                        ? 'bg-neo-yellow border-black text-black shadow-brutal-sm'
                        : 'border-transparent text-black/75 hover:bg-white'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                    <span className="truncate">1. Format</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveToolTab('resize')}
                    className={`min-h-[42px] min-w-0 overflow-hidden px-2 py-1.5 font-mono font-black text-[11px] sm:text-xs uppercase flex items-center justify-center gap-1.5 border-2 transition-all ${
                      activeToolTab === 'resize'
                        ? 'bg-neo-cyan border-black text-black shadow-brutal-sm'
                        : 'border-transparent text-black/75 hover:bg-white'
                    }`}
                  >
                    <Maximize2 className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                    <span className="truncate">2. Resize</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveToolTab('adjust')}
                    className={`min-h-[42px] min-w-0 overflow-hidden px-2 py-1.5 font-mono font-black text-[11px] sm:text-xs uppercase flex items-center justify-center gap-1.5 border-2 transition-all ${
                      activeToolTab === 'adjust'
                        ? 'bg-neo-lime border-black text-black shadow-brutal-sm'
                        : 'border-transparent text-black/75 hover:bg-white'
                    }`}
                  >
                    <Crop className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                    <span className="truncate">3. Adjust</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveToolTab('exif')}
                    className={`min-h-[42px] min-w-0 overflow-hidden px-2 py-1.5 font-mono font-black text-[11px] sm:text-xs uppercase flex items-center justify-center gap-1.5 border-2 transition-all ${
                      activeToolTab === 'exif'
                        ? 'bg-neo-pink border-black text-black shadow-brutal-sm'
                        : 'border-transparent text-black/75 hover:bg-white'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                    <span className="truncate">4. EXIF</span>
                  </button>
                </div>

                {/* TAB 1: TARGET FORMAT MATRIX & QUALITY / COMPRESSION */}
                {activeToolTab === 'format' && (
                  <div className="space-y-4 animate-fadeIn min-w-0">
                    <div className="space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <label className="font-mono font-black text-xs uppercase text-black">
                          Select Output Image Format
                        </label>
                        <span className="font-mono text-[11px] font-bold text-black/70">
                          {currentFormatMeta.description}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {OUTPUT_FORMATS.map((fmt) => {
                          const isSelected = settings.targetFormat === fmt.id;
                          return (
                            <button
                              key={fmt.id}
                              type="button"
                              onClick={() =>
                                setSettings((prev) => ({ ...prev, targetFormat: fmt.id }))
                              }
                              className={`min-h-[50px] min-w-0 overflow-hidden p-2 border-[3px] border-black font-mono flex flex-col items-center justify-center transition-all ${
                                isSelected
                                  ? `${fmt.badgeColor} text-black shadow-brutal -translate-y-0.5`
                                  : 'bg-white hover:bg-neo-bg text-black shadow-brutal-sm'
                              }`}
                            >
                              <span className="font-black text-xs sm:text-sm tracking-tight truncate max-w-full">
                                {fmt.label}
                              </span>
                              <span className="text-[10px] font-bold opacity-75 truncate max-w-full">
                                .{fmt.extension}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Quality & Compression Slider */}
                    {currentFormatMeta.supportsQuality ? (
                      <div className="p-3.5 sm:p-4 bg-neo-bg border-[3px] border-black space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                          <label className="text-xs font-black uppercase text-black">
                            Compression & Quality
                          </label>
                          <span className="px-2.5 py-0.5 bg-neo-yellow border-2 border-black font-black text-xs text-black tabular-nums">
                            {settings.quality}% QUALITY
                          </span>
                        </div>

                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={settings.quality}
                          onChange={(e) =>
                            setSettings((prev) => ({
                              ...prev,
                              quality: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-black cursor-pointer h-2 bg-white border border-black"
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          {[
                            { label: '50% Compact', q: 50 },
                            { label: '75% Web', q: 75 },
                            { label: '88% Balanced', q: 88 },
                            { label: '98% Best', q: 98 },
                          ].map((preset) => (
                            <button
                              key={preset.q}
                              type="button"
                              onClick={() =>
                                setSettings((prev) => ({ ...prev, quality: preset.q }))
                              }
                              className={`min-w-0 overflow-hidden px-2 py-1.5 border-2 border-black font-mono font-black text-[11px] uppercase transition-all truncate ${
                                settings.quality === preset.q
                                  ? 'bg-neo-cyan text-black shadow-brutal-sm'
                                  : 'bg-white hover:bg-neo-yellow text-black'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3.5 bg-neo-bg border-2 border-black font-mono text-xs flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black uppercase text-black">
                          {currentFormatMeta.label} Uses Lossless / Indexed Encoding
                        </span>
                        <span className="px-2 py-0.5 bg-neo-lime border border-black font-black text-[11px]">
                          100% PIXEL ACCURATE
                        </span>
                      </div>
                    )}

                    {/* Transparency / Background Fill Color */}
                    <div className="p-3.5 sm:p-4 bg-white border-[3px] border-black space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="min-w-0">
                          <span className="font-mono font-black text-xs uppercase text-black block">
                            Background Matte Color
                          </span>
                          <span className="font-mono text-[11px] text-black/70 block leading-relaxed">
                            {!currentFormatMeta.supportsTransparency
                              ? `${currentFormatMeta.label} requires a solid background color behind transparent pixels.`
                              : 'Optional solid background fill behind transparent PNG/SVG/WEBP layers.'}
                          </span>
                        </div>

                        {currentFormatMeta.supportsTransparency && (
                          <button
                            type="button"
                            onClick={() =>
                              setSettings((prev) => ({
                                ...prev,
                                fillBackground: !prev.fillBackground,
                              }))
                            }
                            className={`px-3 py-1.5 border-2 border-black font-mono font-black text-xs uppercase flex-shrink-0 self-start sm:self-center ${
                              settings.fillBackground
                                ? 'bg-neo-lime text-black shadow-brutal-sm'
                                : 'bg-neo-bg text-black'
                            }`}
                          >
                            {settings.fillBackground ? 'Fill Active' : 'Keep Transparent'}
                          </button>
                        )}
                      </div>

                      {(!currentFormatMeta.supportsTransparency || settings.fillBackground) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {BG_COLOR_PRESETS.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              onClick={() =>
                                setSettings((prev) => ({ ...prev, backgroundColor: hex }))
                              }
                              className={`w-8 h-8 border-2 border-black transition-transform ${
                                settings.backgroundColor.toUpperCase() === hex
                                  ? 'scale-110 shadow-brutal-sm ring-2 ring-black'
                                  : ''
                              }`}
                              style={{ backgroundColor: hex }}
                              title={hex}
                            />
                          ))}
                          <input
                            type="color"
                            value={settings.backgroundColor}
                            onChange={(e) =>
                              setSettings((prev) => ({
                                ...prev,
                                backgroundColor: e.target.value,
                              }))
                            }
                            className="w-10 h-8 border-2 border-black cursor-pointer bg-white p-0.5"
                            title="Custom background hex color"
                          />
                          <span className="font-mono font-black text-xs uppercase text-black">
                            {settings.backgroundColor.toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: CUSTOM RESIZE & DIMENSION SCALING */}
                {activeToolTab === 'resize' && (
                  <div className="space-y-4 animate-fadeIn min-w-0">
                    <div className="p-3.5 sm:p-4 bg-neo-bg border-[3px] border-black space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-black text-xs uppercase text-black">
                          Target Dimensions (Width × Height)
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSettings((prev) => ({
                              ...prev,
                              lockAspectRatio: !prev.lockAspectRatio,
                            }))
                          }
                          className={`px-2.5 py-1 border-2 border-black font-mono font-black text-xs uppercase flex items-center gap-1.5 ${
                            settings.lockAspectRatio
                              ? 'bg-neo-lime text-black shadow-brutal-sm'
                              : 'bg-white text-black'
                          }`}
                        >
                          {settings.lockAspectRatio ? (
                            <>
                              <Lock className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                              <span>Ratio Locked</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                              <span>Free Ratio</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-mono font-bold text-[11px] uppercase text-black/80 mb-1">
                            Width (px)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={8192}
                            placeholder={String(activeItem.originalWidth)}
                            value={settings.width ?? ''}
                            onChange={(e) => handleWidthChange(e.target.value)}
                            className="w-full brutal-input text-sm tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block font-mono font-bold text-[11px] uppercase text-black/80 mb-1">
                            Height (px)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={8192}
                            placeholder={String(activeItem.originalHeight)}
                            value={settings.height ?? ''}
                            onChange={(e) => handleHeightChange(e.target.value)}
                            className="w-full brutal-input text-sm tabular-nums"
                          />
                        </div>
                      </div>

                      {/* Percentage Scale Buttons */}
                      <div className="space-y-1.5">
                        <span className="font-mono font-bold text-[11px] uppercase text-black/80 block">
                          Quick Percentage Scale
                        </span>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {SCALE_PRESETS.map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() =>
                                setSettings((prev) => ({
                                  ...prev,
                                  width: null,
                                  height: null,
                                  scalePercent: pct,
                                }))
                              }
                              className={`py-1.5 px-2 border-2 border-black font-mono font-black text-xs tabular-nums transition-all ${
                                settings.width === null && settings.scalePercent === pct
                                  ? 'bg-neo-yellow text-black shadow-brutal-sm'
                                  : 'bg-white hover:bg-neo-cyan text-black'
                              }`}
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Standard Resolution Presets */}
                      <div className="space-y-1.5 pt-1">
                        <span className="font-mono font-bold text-[11px] uppercase text-black/80 block">
                          Standard Web & Icon Presets
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {[
                            { label: '1920×1080 FHD', w: 1920, h: 1080 },
                            { label: '1280×720 HD', w: 1280, h: 720 },
                            { label: '1080×1080 Square', w: 1080, h: 1080 },
                            { label: '512×512 Icon', w: 512, h: 512 },
                            { label: '256×256 Favicon', w: 256, h: 256 },
                            {
                              label: 'Reset Original',
                              w: activeItem.originalWidth,
                              h: activeItem.originalHeight,
                            },
                          ].map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => applyResolutionPreset(p.w, p.h)}
                              className="min-w-0 overflow-hidden px-2 py-2 bg-white hover:bg-neo-yellow border-2 border-black font-mono font-black text-[11px] sm:text-xs text-black shadow-brutal-sm text-center truncate"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 3: CROP, ROTATE, FLIP & COLOR FILTERS */}
                {activeToolTab === 'adjust' && (
                  <div className="space-y-4 animate-fadeIn min-w-0">
                    {/* Geometric Orientation & Aspect Crop */}
                    <div className="p-3.5 sm:p-4 bg-neo-bg border-[3px] border-black space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="font-mono font-black text-xs uppercase text-black">
                          Rotate & Flip Orientation
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSettings((prev) => ({
                                ...prev,
                                rotation: ((prev.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                              }))
                            }
                            className="px-2.5 py-1.5 bg-white hover:bg-neo-yellow border-2 border-black font-mono font-black text-xs uppercase flex items-center gap-1.5 shadow-brutal-sm"
                          >
                            <RotateCw className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                            <span>Rotate ({settings.rotation}°)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setSettings((prev) => ({
                                ...prev,
                                flipHorizontal: !prev.flipHorizontal,
                              }))
                            }
                            className={`px-2.5 py-1.5 border-2 border-black font-mono font-black text-xs uppercase flex items-center gap-1 shadow-brutal-sm ${
                              settings.flipHorizontal ? 'bg-neo-cyan' : 'bg-white'
                            }`}
                          >
                            <FlipHorizontal className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                            <span>Flip H</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setSettings((prev) => ({
                                ...prev,
                                flipVertical: !prev.flipVertical,
                              }))
                            }
                            className={`px-2.5 py-1.5 border-2 border-black font-mono font-black text-xs uppercase flex items-center gap-1 shadow-brutal-sm ${
                              settings.flipVertical ? 'bg-neo-cyan' : 'bg-white'
                            }`}
                          >
                            <FlipVertical className="w-3.5 h-3.5 stroke-[2.5] flex-shrink-0" />
                            <span>Flip V</span>
                          </button>
                        </div>
                      </div>

                      {/* Aspect Crop Presets */}
                      <div className="space-y-1.5 pt-1">
                        <span className="font-mono font-bold text-[11px] uppercase text-black/80 block">
                          Center Crop Aspect Ratio
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5">
                          {CROP_PRESETS.map((cp) => (
                            <button
                              key={cp.id}
                              type="button"
                              onClick={() =>
                                setSettings((prev) => ({ ...prev, cropPreset: cp.id }))
                              }
                              className={`min-w-0 overflow-hidden py-1.5 px-2 border-2 border-black font-mono font-black text-[11px] uppercase transition-all truncate ${
                                settings.cropPreset === cp.id
                                  ? 'bg-neo-yellow text-black shadow-brutal-sm'
                                  : 'bg-white hover:bg-neo-cyan/30 text-black'
                              }`}
                            >
                              {cp.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Filter Presets & Sliders */}
                    <div className="p-3.5 sm:p-4 bg-white border-[3px] border-black space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="font-mono font-black text-xs uppercase text-black">
                          Color Grading & Filters
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              { id: 'normal', label: 'Normal' },
                              { id: 'vivid', label: 'Vivid' },
                              { id: 'noir', label: 'Noir B&W' },
                              { id: 'vintage', label: 'Sepia' },
                              { id: 'contrast', label: 'Contrast' },
                              { id: 'invert', label: 'Invert' },
                            ] as const
                          ).map((fp) => (
                            <button
                              key={fp.id}
                              type="button"
                              onClick={() => applyFilterPreset(fp.id)}
                              className="px-2 py-0.5 bg-neo-bg hover:bg-neo-yellow border border-black font-mono font-black text-[10px] uppercase text-black"
                            >
                              {fp.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                        <div>
                          <div className="flex justify-between font-bold text-[11px]">
                            <span>BRIGHTNESS</span>
                            <span className="tabular-nums">{settings.filters.brightness}%</span>
                          </div>
                          <input
                            type="range"
                            min={50}
                            max={150}
                            value={settings.filters.brightness}
                            onChange={(e) =>
                              setSettings((prev) => ({
                                ...prev,
                                filters: { ...prev.filters, brightness: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-black cursor-pointer"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between font-bold text-[11px]">
                            <span>CONTRAST</span>
                            <span className="tabular-nums">{settings.filters.contrast}%</span>
                          </div>
                          <input
                            type="range"
                            min={50}
                            max={150}
                            value={settings.filters.contrast}
                            onChange={(e) =>
                              setSettings((prev) => ({
                                ...prev,
                                filters: { ...prev.filters, contrast: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-black cursor-pointer"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between font-bold text-[11px]">
                            <span>SATURATION</span>
                            <span className="tabular-nums">{settings.filters.saturation}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={200}
                            value={settings.filters.saturation}
                            onChange={(e) =>
                              setSettings((prev) => ({
                                ...prev,
                                filters: { ...prev.filters, saturation: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-black cursor-pointer"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between font-bold text-[11px]">
                            <span>GRAYSCALE / SEPIA</span>
                            <span className="tabular-nums">
                              G:{settings.filters.grayscale}% · S:{settings.filters.sepia}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={settings.filters.grayscale}
                            onChange={(e) =>
                              setSettings((prev) => ({
                                ...prev,
                                filters: { ...prev.filters, grayscale: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-black cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 4: EXIF METADATA VIEWER & PRIVACY STRIPPER */}
                {activeToolTab === 'exif' && (
                  <div className="space-y-4 animate-fadeIn min-w-0">
                    <div className="p-3.5 sm:p-4 bg-neo-lime/30 border-[3px] border-black flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="font-mono font-black text-xs uppercase text-black flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
                          <span>EXIF & GPS Privacy Scrubber Active</span>
                        </div>
                        <p className="font-mono text-xs text-black/80 font-bold leading-relaxed">
                          Re-encoding through the Canvas pipeline automatically strips embedded camera serials, GPS coordinates, and editing history from the output file.
                        </p>
                      </div>
                      <span className="px-3 py-1 bg-neo-lime border-2 border-black font-mono font-black text-xs uppercase text-black shadow-brutal-sm flex-shrink-0 self-start sm:self-center">
                        CLEAN OUTPUT
                      </span>
                    </div>

                    {/* Binary Header & EXIF Table */}
                    <div className="border-[3px] border-black bg-white overflow-hidden">
                      <div className="bg-neo-bg border-b-2 border-black px-3.5 py-2 font-mono font-black text-xs uppercase text-black flex flex-wrap items-center justify-between gap-2">
                        <span>Binary & EXIF Inspection</span>
                        <span className="tabular-nums">
                          {activeItem.exif.megapixels} MP · {activeItem.exif.aspectRatioLabel}
                        </span>
                      </div>

                      <div className="divide-y divide-black/15 font-mono text-xs max-h-48 overflow-y-auto">
                        <div className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="font-bold text-black/70">Magic Bytes Signature</span>
                          <span className="font-black text-black tabular-nums break-all sm:text-right">
                            {activeItem.exif.formatSignature}
                          </span>
                        </div>
                        <div className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="font-bold text-black/70">Dimensions & Ratio</span>
                          <span className="font-black text-black tabular-nums sm:text-right">
                            {activeItem.originalWidth} × {activeItem.originalHeight} px (
                            {activeItem.exif.aspectRatioLabel})
                          </span>
                        </div>
                        <div className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="font-bold text-black/70">GPS Location Data</span>
                          <span
                            className={`px-2 py-0.5 border border-black font-black text-[10px] self-start sm:self-auto ${
                              activeItem.exif.hasGpsData ? 'bg-neo-pink' : 'bg-neo-lime'
                            }`}
                          >
                            {activeItem.exif.hasGpsData
                              ? 'DETECTED (STRIPPED ON EXPORT)'
                              : 'NONE DETECTED'}
                          </span>
                        </div>
                        {activeItem.exif.rawTags.map((tag, idx) => (
                          <div
                            key={`${tag.key}-${idx}`}
                            className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4"
                          >
                            <span className="font-bold text-black/70">{tag.key}</span>
                            <span className="font-black text-black sm:text-right break-words">
                              {tag.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* PRIMARY OUTPUT ACTIONS BAR */}
              <div className="pt-4 border-t-[3px] border-black space-y-3 min-w-0">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
                  {/* Primary Download Converted Button */}
                  <button
                    type="button"
                    onClick={() => handleDownloadItem(activeItem)}
                    disabled={!activeItem.convertedUrl || activeItem.status === 'processing'}
                    className="flex-1 min-h-[48px] min-w-0 px-4 py-3 bg-neo-yellow hover:bg-neo-lime active:translate-x-0.5 active:translate-y-0.5 border-[3px] border-black font-black uppercase text-xs sm:text-sm tracking-wider text-black shadow-brutal flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    <Download className="w-4 h-4 stroke-[3] flex-shrink-0" />
                    <span className="truncate">
                      Download .{currentFormatMeta.extension.toUpperCase()} (
                      {activeItem.convertedSize ? formatBytes(activeItem.convertedSize) : '...'})
                    </span>
                  </button>

                  {/* Copy Image to Clipboard */}
                  <button
                    type="button"
                    onClick={handleCopyConvertedImage}
                    disabled={!activeItem.convertedBlob}
                    className={`min-h-[48px] px-4 py-3 border-[3px] border-black font-mono font-black uppercase text-xs text-black shadow-brutal flex items-center justify-center gap-1.5 transition-all active:translate-x-0.5 active:translate-y-0.5 flex-shrink-0 ${
                      copiedClipboard ? 'bg-neo-lime' : 'bg-white hover:bg-neo-cyan'
                    }`}
                  >
                    {copiedClipboard ? (
                      <>
                        <Check className="w-4 h-4 stroke-[3] flex-shrink-0" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
                        <span>Copy Image</span>
                      </>
                    )}
                  </button>

                  {/* Pro Batch ZIP Download (When 2+ files are in queue) */}
                  {queue.length > 1 && (
                    <button
                      type="button"
                      onClick={handleDownloadBatchZip}
                      disabled={isBuildingZip}
                      className="min-h-[48px] px-4 py-3 bg-neo-pink hover:bg-neo-yellow border-[3px] border-black font-mono font-black uppercase text-xs text-black shadow-brutal flex items-center justify-center gap-1.5 transition-all flex-shrink-0"
                    >
                      <Archive className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
                      <span>{isBuildingZip ? 'Packing ZIP...' : `ZIP All (${queue.length})`}</span>
                    </button>
                  )}
                </div>

                {/* Secondary Action: Upload Converted File Directly to Cloud URL */}
                <button
                  type="button"
                  onClick={handleUploadConvertedToCloud}
                  disabled={isUploadingCloud || !activeItem.convertedBlob}
                  className="w-full min-h-[46px] min-w-0 px-4 py-2.5 bg-neo-cyan hover:bg-neo-lime active:translate-x-0.5 active:translate-y-0.5 border-[3px] border-black font-mono font-black uppercase text-xs tracking-wider text-black shadow-brutal flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isUploadingCloud ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin stroke-[3] flex-shrink-0" />
                      <span className="truncate">
                        {cloudUploadStatus || 'UPLOADING CONVERTED IMAGE...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 stroke-[2.5] flex-shrink-0" />
                      <span className="truncate">
                        Host Converted .{currentFormatMeta.extension.toUpperCase()} on Cloud & Get URL
                      </span>
                      <ArrowRight className="w-4 h-4 stroke-[3] flex-shrink-0" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
