import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Download, 
  Music, 
  Settings2, 
  Volume2, 
  ChevronsRight, 
  FileAudio,
  Play,
  Pause,
  ArrowUp,
  ArrowDown,
  Waves,
  GripVertical,
  VolumeX,
  Image as ImageIcon,
  Video as VideoIcon,
  Film as MovieIcon,
  VideoOff,
  Mic,
  Square,
  Sparkles,
  Gauge,
  BadgeCheck,
  ListMusic,
  History,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Timer,
  FileText,
  Volume1,
  Headphones,
  MessageSquare,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  X
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import {
  TrackSettings,
  GlobalSettings,
  ExportFormat,
  QualityIssue,
  TransitionSuggestion,
  ProjectSnapshot,
} from './types';
import {
  decodeAudioFile,
  renderMix,
  encodeWAV,
  encodeMP3,
  calculateNormalization,
  renderVideo,
  createBeatMarkers,
  estimateTempo,
  getProjectTimeline,
  getTrackPlaybackDuration,
  getTrackPlaybackRegion,
  inspectProjectQuality,
  suggestProjectTransitions,
} from './utils/audio';

declare const __APP_VERSION__: string;

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

// Waveform Component
const WaveformCanvas = ({ 
  buffer, 
  color, 
  currentTime, 
  duration, 
  onSeek,
  loopRegion,
  onLoopRegionChange,
  startTrim = 0,
  endTrim = 0,
  beatMarkers = [],
  isVoice = false,
}: { 
  buffer: AudioBuffer, 
  color: string,
  currentTime?: number,
  duration?: number,
  onSeek?: (time: number) => void,
  loopRegion?: { start: number, end: number },
  onLoopRegionChange?: (region: { start: number, end: number } | undefined) => void,
  startTrim?: number,
  endTrim?: number,
  beatMarkers?: number[],
  isVoice?: boolean,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [loopDragStartRatio, setLoopDragStartRatio] = useState<number | null>(null);
  const [loopDragCurrentRatio, setLoopDragCurrentRatio] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const fw = canvas.clientWidth;
    const fh = canvas.clientHeight;
    
    // Check if client dimensions exist to prevent zero-size drawing errors
    if (fw === 0 || fh === 0) return;

    canvas.width = fw * dpr;
    canvas.height = fh * dpr;
    ctx.scale(dpr, dpr);

    // Clear the canvas
    ctx.clearRect(0, 0, fw, fh);

    // Draw the waveform as continuous line
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / fw);
    const amp = (fh / 2) * 0.8; // slightly padded

    ctx.beginPath();
    ctx.strokeStyle = color; // use the passed prop color which we will update to green
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < fw; i++) {
        let min = 1.0;
        let max = -1.0;
        // Optimization: Sample every N items per step for faster drawing
        const sampleRate = Math.max(1, Math.floor(step / 100));
        for (let j = 0; j < step; j += sampleRate) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        
        ctx.moveTo(i, (1 + min) * amp + fh / 2 - amp);
        ctx.lineTo(i, (1 + max) * amp + fh / 2 - amp);
    }
    ctx.stroke();

    // A light beat grid makes it easier to line music up by eye. Voice tracks
    // intentionally stay uncluttered because their phrasing matters more than beats.
    if (!isVoice && beatMarkers.length && buffer.duration > 0) {
      const markerStep = Math.max(1, Math.ceil(beatMarkers.length / 150));
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      for (let index = 0; index < beatMarkers.length; index += markerStep) {
        const x = (beatMarkers[index] / buffer.duration) * fw;
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x, fh - 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Shade material that has been trimmed so the audible part of a file is
    // immediately obvious without opening any extra controls.
    if (buffer.duration > 0 && (startTrim > 0 || endTrim > 0)) {
      const startX = (Math.min(startTrim, buffer.duration) / buffer.duration) * fw;
      const endX = fw - (Math.min(endTrim, buffer.duration) / buffer.duration) * fw;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
      if (startX > 0) ctx.fillRect(0, 0, startX, fh);
      if (endX < fw) ctx.fillRect(endX, 0, fw - endX, fh);
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.75)';
      ctx.lineWidth = 1;
      if (startX > 0) {
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, fh);
        ctx.stroke();
      }
      if (endX < fw) {
        ctx.beginPath();
        ctx.moveTo(endX, 0);
        ctx.lineTo(endX, fh);
        ctx.stroke();
      }
    }

    const displayTime = dragRatio !== null && duration ? dragRatio * duration : currentTime;

    // Draw the progress overlay if displayTime and duration are provided
    if (displayTime !== undefined && duration !== undefined && duration > 0) {
      const progressRatio = Math.min(Math.max(displayTime / duration, 0), 1);
      const progressX = progressRatio * fw;
      
      // Color the played part overlay using a light blend
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, progressX, fh);
      ctx.globalAlpha = 1.0;

      // Playhead line
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, fh);
      ctx.stroke();

      // Glowing dot at the playhead
      ctx.beginPath();
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.arc(progressX, fh / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0; // reset
    }

    // Draw loop region
    const activeLoopStart = loopDragStartRatio !== null ? Math.min(loopDragStartRatio, loopDragCurrentRatio || loopDragStartRatio) : (loopRegion && duration ? loopRegion.start / duration : null);
    const activeLoopEnd = loopDragStartRatio !== null ? Math.max(loopDragStartRatio, loopDragCurrentRatio || loopDragStartRatio) : (loopRegion && duration ? loopRegion.end / duration : null);

    if (activeLoopStart !== null && activeLoopEnd !== null) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'; // Blue tint for loop selection
      const startX = activeLoopStart * fw;
      const endX = activeLoopEnd * fw;
      ctx.fillRect(startX, 0, endX - startX, fh);

      // loop borders
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(startX, 0, 1, fh);
      ctx.fillRect(endX, 0, 1, fh);
    }
  }, [buffer, color, currentTime, duration, dragRatio, loopDragStartRatio, loopDragCurrentRatio, loopRegion, startTrim, endTrim, beatMarkers, isVoice]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onSeek || !duration) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(x / rect.width, 1));
    
    if (e.button === 2 || e.buttons === 2 || (e.ctrlKey && e.button === 0)) {
      e.preventDefault();
      setLoopDragStartRatio(ratio);
      setLoopDragCurrentRatio(ratio);
    } else {
      setDragRatio(ratio);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(x / rect.width, 1));
    
    if (loopDragStartRatio !== null) {
      setLoopDragCurrentRatio(ratio);
    } else if (dragRatio !== null) {
      setDragRatio(ratio);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }
    
    if (loopDragStartRatio !== null) {
      const start = Math.min(loopDragStartRatio, loopDragCurrentRatio || loopDragStartRatio);
      const end = Math.max(loopDragStartRatio, loopDragCurrentRatio || loopDragStartRatio);
      
      setLoopDragStartRatio(null);
      setLoopDragCurrentRatio(null);

      if (end - start < 0.01) {
        if (onLoopRegionChange) onLoopRegionChange(undefined);
      } else {
        if (onLoopRegionChange) onLoopRegionChange({ start: start * duration, end: end * duration });
      }
    } else if (dragRatio !== null) {
      onSeek(dragRatio * duration);
      setDragRatio(null);
    }
  };

  return (
    <canvas 
      ref={canvasRef} 
      className={`w-full h-full opacity-80 ${onSeek ? 'cursor-pointer hover:opacity-100 transition-opacity' : ''}`} 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};

const PROJECT_TEMPLATES = [
  {
    id: 'dj',
    title: 'DJ-set',
    description: 'Längre övergångar och jämn takt mellan låtar.',
    settings: { crossfadeDuration: 4, tempoSync: true, autoDuck: false, normalize: true, exportPreset: 'share' as const },
  },
  {
    id: 'podcast',
    title: 'Podd',
    description: 'Kort musik, tydlig berättarröst och lagom filstorlek.',
    settings: { crossfadeDuration: 1, tempoSync: false, autoDuck: true, duckAmount: 13, normalize: true, exportPreset: 'podcast' as const },
  },
  {
    id: 'calm',
    title: 'Lugn ljudbild',
    description: 'Mjuka, längre övergångar för avslappning eller miljöljud.',
    settings: { crossfadeDuration: 6, tempoSync: false, autoDuck: false, normalize: true, exportPreset: 'master' as const },
  },
  {
    id: 'store',
    title: 'Butik & event',
    description: 'Jämn nivå och stabila, diskreta övergångar hela dagen.',
    settings: { crossfadeDuration: 3, tempoSync: true, autoDuck: false, normalize: true, exportPreset: 'share' as const },
  },
] as const;

const EXPORT_PRESETS = {
  share: {
    label: 'Dela',
    description: 'MP3 i bra kvalitet för mobil och sociala medier.',
    format: 'mp3' as const,
    mp3Bitrate: 192 as const,
  },
  podcast: {
    label: 'Podd',
    description: 'Mindre MP3-fil som passar tal och publicering.',
    format: 'mp3' as const,
    mp3Bitrate: 128 as const,
  },
  master: {
    label: 'Master',
    description: 'WAV med hög kvalitet för arkiv eller vidare produktion.',
    format: 'wav' as const,
    bitDepth: 24 as const,
  },
};

const clampTempoRatio = (ratio: number) => Math.min(1.16, Math.max(0.86, ratio));

export default function App() {
  const [tracks, setTracks] = useState<TrackSettings[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(() => {
    const saved = localStorage.getItem('no-break-settings');
    let baseSettings: GlobalSettings = {
      format: 'mp3',
      crossfadeDuration: 2,
      normalize: true,
      visualAssets: [],
      accentColor: '#ec4899', // Professional Pink default
      tempoSync: false,
      tempoTarget: 120,
      autoDuck: true,
      duckAmount: 12,
      exportPreset: 'share',
      mp3Bitrate: 192,
      exportName: 'NoBreak_Project'
    };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...baseSettings, ...parsed, visualAssets: parsed.visualAssets || [] }; 
      } catch (e) {}
    }
    return baseSettings;
  });

  // PERSISTENCE (Feature 10)
  useEffect(() => {
    const dataToSave = {
      global: { ...globalSettings, visualAssets: [] }, // Don't persist BLOB URLs
      tracks: tracks.map(t => ({
        id: t.id,
        name: t.name,
        volume: t.volume,
        fadeIn: t.fadeIn,
        fadeOut: t.fadeOut,
        bass: t.bass,
        treble: t.treble,
        startTrim: t.startTrim,
        endTrim: t.endTrim,
        detectedBpm: t.detectedBpm,
        tempoRatio: t.tempoRatio,
        transitionDuration: t.transitionDuration,
        role: t.role,
        placement: t.placement,
        overlayStart: t.overlayStart,
        chapterTitle: t.chapterTitle,
        includeInChapters: t.includeInChapters
      }))
    };
    localStorage.setItem('no-break-project', JSON.stringify(dataToSave));
    localStorage.setItem('no-break-settings', JSON.stringify(dataToSave.global));
  }, [tracks, globalSettings]);
  // Apply dynamic theme color
  useEffect(() => {
    document.documentElement.style.setProperty('--color-brand-orange', globalSettings.accentColor || '#ec4899');
  }, [globalSettings.accentColor]);

  const [isRendering, setIsRendering] = useState(false);
  const [isRenderingMinimized, setIsRenderingMinimized] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewBuffer, setPreviewBuffer] = useState<AudioBuffer | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Smart workflow state: tempo, suggested joins, pre-export checks and version history.
  const [transitionSuggestions, setTransitionSuggestions] = useState<TransitionSuggestion[]>([]);
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[]>([]);
  const [qualityCheckedAt, setQualityCheckedAt] = useState<number | null>(null);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [isAnalysingTransitions, setIsAnalysingTransitions] = useState(false);
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Voice recording state.
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingName, setRecordingName] = useState('Berättarröst');
  const [recordingError, setRecordingError] = useState<string | null>(null);

  // ── Auto-Updater state ────────────────────────────────────────────────────
  const [updateAvailableVersion, setUpdateAvailableVersion] = useState<string | null>(null);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number>(0);
  const [updateReadyVersion, setUpdateReadyVersion] = useState<string | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [updateState, setUpdateState] = useState<'idle' | 'available' | 'downloading' | 'ready'>('idle');

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewMixSignatureRef = useRef<string>('');
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const progressIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (playingId) {
      let duration = 0;
      if (playingId === 'full-mix' && previewBuffer) {
        duration = previewBuffer.duration;
      } else {
        const t = tracks.find(x => x.id === playingId);
        if (t?.buffer) duration = t.buffer.duration;
      }

      if (duration > 0) {
        const interval = window.setInterval(() => {
          if (activeSourceRef.current) {
            const elapsed = audioCtx.currentTime - startTimeRef.current;
            const t = playingId === 'full-mix' ? null : tracks.find(x => x.id === playingId);
            // The waveform is measured in the source file's seconds, so its
            // playhead follows the selected tempo ratio for a single track.
            let currentElapsed = t ? elapsed * (t.tempoRatio || 1) : elapsed;
            
            if (t?.loopRegion && t.loopRegion.end > t.loopRegion.start) {
              if (currentElapsed >= t.loopRegion.start) {
                const loopLength = t.loopRegion.end - t.loopRegion.start;
                if (loopLength > 0) {
                  currentElapsed = t.loopRegion.start + ((currentElapsed - t.loopRegion.start) % loopLength);
                }
              }
              setCurrentTime(currentElapsed);
            } else {
              if (currentElapsed >= duration) {
                stopPlayback();
              } else {
                setCurrentTime(currentElapsed);
              }
            }
          }
        }, 50);
        progressIntervalRef.current = interval;
      }
    } else {
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }

    return () => {
      if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
    };
  }, [playingId, previewBuffer, tracks]);

  useEffect(() => {
    return () => stopPlayback();
  }, []);

  // ── Auto-Updater IPC listeners (only active in packaged .exe) ─────────────
  useEffect(() => {
    const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
    if (!ipcRenderer) return; // Not in Electron / not packaged

    const onUpdateAvailable = (_: unknown, version: string) => {
      setUpdateAvailableVersion(version);
      setUpdateState('downloading');
      setShowUpdateBanner(true);
    };

    const onDownloadProgress = (_: unknown, percent: number) => {
      setUpdateDownloadProgress(percent);
    };

    const onUpdateDownloaded = (_: unknown, version: string) => {
      setUpdateReadyVersion(version);
      setUpdateState('ready');
      setShowUpdateBanner(true);
    };

    const onUpdateError = () => {
      setUpdateState('idle');
    };

    ipcRenderer.on('update-available', onUpdateAvailable);
    ipcRenderer.on('update-download-progress', onDownloadProgress);
    ipcRenderer.on('update-downloaded', onUpdateDownloaded);
    ipcRenderer.on('update-error', onUpdateError);

    return () => {
      ipcRenderer.removeListener('update-available', onUpdateAvailable);
      ipcRenderer.removeListener('update-download-progress', onDownloadProgress);
      ipcRenderer.removeListener('update-downloaded', onUpdateDownloaded);
      ipcRenderer.removeListener('update-error', onUpdateError);
    };
  }, []);

  // Time formatting helper
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) {
      return (mb / 1024).toFixed(2) + ' GB';
    }
    return mb.toFixed(1) + ' MB';
  };

  const getEstimatedSize = () => {
    let bytesPerSec = 0;
    if (globalSettings.format === 'mp3') {
      bytesPerSec = (globalSettings.mp3Bitrate || 192) * 125;
    } else if (globalSettings.format === 'wav') {
      const depth = globalSettings.bitDepth || 16;
      bytesPerSec = 44100 * (depth / 8) * 2; 
    } else if (globalSettings.format === 'mp4') {
      // Audio: 192 kbps (24,000 bytes/sec)
      // Video: VBR optimized for mostly static/looping backgrounds averages ~216 kbps (27,000 bytes/sec)
      // Total average: ~51,000 bytes/sec
      bytesPerSec = 51000; 
    }
    return formatBytes(totalDuration * bytesPerSec);
  };

  const scanFiles = useCallback(async (item: FileSystemEntry): Promise<File[]> => {
    if (item.isFile) {
      return new Promise((resolve) => {
        (item as FileSystemFileEntry).file((file) => resolve([file]));
      });
    } else if (item.isDirectory) {
      const dirReader = (item as FileSystemDirectoryEntry).createReader();
      const entries = await new Promise<FileSystemEntry[]>((resolve) => {
        dirReader.readEntries((results) => resolve(results));
      });
      const files = await Promise.all(entries.map((entry) => scanFiles(entry)));
      return files.flat();
    }
    return [];
  }, []);

  const addAudioFile = useCallback(async (
    file: File,
    overrides: Partial<TrackSettings> = {},
    paletteIndex = tracks.length,
  ) => {
    const id = Math.random().toString(36).slice(2, 10);
    const role = overrides.role || 'music';
    const hue = role === 'voice' ? 190 : (paletteIndex * 137.508) % 360;
    const fallbackName = file.name.replace(/\.[^/.]+$/, '') || 'Nytt ljudspår';
    const track: TrackSettings = {
      name: file.name,
      volume: 1,
      fadeIn: role === 'voice' ? 0.08 : 0.5,
      fadeOut: role === 'voice' ? 0.15 : 0.5,
      color: `hsl(${hue}, 75%, 65%)`,
      role,
      placement: role === 'voice' ? 'overlay' : 'sequence',
      overlayStart: role === 'voice' ? 0 : undefined,
      chapterTitle: fallbackName,
      includeInChapters: role !== 'voice',
      ...overrides,
      id,
      file,
      buffer: null,
    };

    setTracks(previous => [...previous, track]);

    try {
      const buffer = await decodeAudioFile(file);
      const bpm = role === 'music' ? estimateTempo(buffer) : undefined;
      const targetTempo = globalSettings.tempoTarget || bpm || 120;
      const tempoRatio = globalSettings.tempoSync && bpm
        ? clampTempoRatio(targetTempo / bpm)
        : 1;
      setTracks(previous => previous.map(item => item.id === id ? {
        ...item,
        buffer,
        volume: globalSettings.normalize ? Math.min(2, calculateNormalization(buffer)) : item.volume,
        detectedBpm: bpm,
        tempoRatio,
        beatMarkers: role === 'music' ? createBeatMarkers(buffer, bpm) : [],
      } : item));
    } catch (error) {
      console.error(`Failed to decode ${file.name}:`, error);
    }
  }, [globalSettings.normalize, globalSettings.tempoSync, globalSettings.tempoTarget, tracks.length]);

  const handleFileUpload = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const baseIndex = tracks.length;
    fileArray.forEach((file, index) => {
      if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac|webm)$/i.test(file.name)) {
        void addAudioFile(file, {}, baseIndex + index);
      } else if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        handleVisualUpload(file);
      }
    });
  }, [addAudioFile, tracks.length]);

  const handleVisualUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    setGlobalSettings(s => ({
      ...s,
      visualAssets: [...s.visualAssets, { file, type, url }],
      format: 'mp4' // Auto switch to mp4 if visual added
    }));
  };

  const removeVisual = (index: number) => {
    const asset = globalSettings.visualAssets[index];
    if (asset) {
      URL.revokeObjectURL(asset.url);
    }
    setGlobalSettings(s => {
      const newAssets = [...s.visualAssets];
      newAssets.splice(index, 1);
      return { 
        ...s, 
        visualAssets: newAssets,
        format: newAssets.length === 0 ? 'mp3' : s.format
      };
    });
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const items = Array.from(e.dataTransfer.items);
    const filesPromises = items.map(item => {
      const entry = (item as any).webkitGetAsEntry();
      return entry ? scanFiles(entry) : [];
    });
    
    const allFiles = (await Promise.all(filesPromises)).flat();
    handleFileUpload(allFiles);
  }, [handleFileUpload, scanFiles]);

  const removeTrack = (id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
  };

  const updateTrack = (id: string, updates: Partial<TrackSettings>) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const pausePlayback = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch (e) {}
      activeSourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const stopPlayback = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch (e) {}
      activeSourceRef.current = null;
    }
    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setPlayingId(null);
    setIsPreviewing(false);
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const startTrackAt = (track: TrackSettings, time: number) => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch(e){}
    }
    
    if (!track.buffer) return;

    const source = audioCtx.createBufferSource();
    source.buffer = track.buffer;
    source.playbackRate.value = track.tempoRatio || 1;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = track.volume;
    
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    source.onended = () => {
      if (activeSourceRef.current === source) {
        setIsPlaying(false);
      }
    };

    if (track.loopRegion && track.loopRegion.end > track.loopRegion.start) {
      source.loop = true;
      source.loopStart = track.loopRegion.start;
      source.loopEnd = track.loopRegion.end;
    }

    const offset = Math.max(0, Math.min(time, track.buffer.duration));
    source.start(0, offset);
    activeSourceRef.current = source;
    startTimeRef.current = audioCtx.currentTime - (offset / (track.tempoRatio || 1));
    setCurrentTime(offset);
    setPlayingId(track.id);
    setIsPlaying(true);
  };

  const handleSeekTrack = (track: TrackSettings, time: number) => {
    if (isPlaying && playingId === track.id) {
      startTrackAt(track, time);
    } else {
      setCurrentTime(Math.max(0, Math.min(time, track.buffer?.duration || 0)));
      setPlayingId(track.id);
    }
  };

  const playTrack = (track: TrackSettings) => {
    const hasLoop = track.loopRegion && track.loopRegion.end > track.loopRegion.start;
    if (playingId === track.id) {
      if (isPlaying) {
        pausePlayback();
      } else {
        const outOfBounds = hasLoop && (currentTime < track.loopRegion!.start || currentTime >= track.loopRegion!.end);
        startTrackAt(track, outOfBounds ? track.loopRegion!.start : currentTime);
      }
      return;
    }
    stopPlayback();
    startTrackAt(track, hasLoop ? track.loopRegion!.start : 0);
  };

  const startPreviewAt = (buffer: AudioBuffer, time: number) => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch(e){}
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    source.onended = () => {
      if (activeSourceRef.current === source) {
        setIsPlaying(false);
      }
    };

    const offset = Math.max(0, Math.min(time, buffer.duration));
    source.start(0, offset);
    activeSourceRef.current = source;
    startTimeRef.current = audioCtx.currentTime - offset;
    setCurrentTime(offset);
    setPlayingId('full-mix');
    setIsPreviewing(true);
    setIsPlaying(true);
  };

  const handleSeekPreview = (buffer: AudioBuffer, time: number) => {
    if (isPlaying && playingId === 'full-mix') {
      startPreviewAt(buffer, time);
    } else {
      setCurrentTime(Math.max(0, Math.min(time, buffer.duration)));
      setPlayingId('full-mix');
      setIsPreviewing(true);
    }
  };

  const getMixSignature = () => JSON.stringify({
    crossfade: globalSettings.crossfadeDuration,
    normalize: globalSettings.normalize,
    duck: globalSettings.autoDuck,
    duckAmount: globalSettings.duckAmount,
    tracks: tracks.map(track => ({
      id: track.id,
      duration: track.buffer?.duration || 0,
      volume: track.volume,
      fadeIn: track.fadeIn,
      fadeOut: track.fadeOut,
      startTrim: track.startTrim,
      endTrim: track.endTrim,
      bass: track.bass,
      treble: track.treble,
      tempoRatio: track.tempoRatio,
      transitionDuration: track.transitionDuration,
      role: track.role,
      placement: track.placement,
      overlayStart: track.overlayStart,
    })),
  });

  const previewMix = async () => {
    const mixSignature = getMixSignature();
    const hasCurrentPreview = previewBuffer && previewMixSignatureRef.current === mixSignature;
    if (playingId === 'full-mix' && hasCurrentPreview) {
      if (isPlaying) {
        pausePlayback();
      } else if (previewBuffer) {
        startPreviewAt(previewBuffer, currentTime);
      }
      return;
    }

    stopPlayback();
    setIsPreviewing(true);
    
    try {
      const buffer = await renderMix(tracks, globalSettings);
      previewMixSignatureRef.current = mixSignature;
      setPreviewBuffer(buffer);
      startPreviewAt(buffer, 0);
    } catch (err) {
      console.error('Preview failed:', err);
      setIsPreviewing(false);
      setPlayingId(null);
    }
  };

  const seekPreview = (time: number) => {
    if (previewBuffer && playingId === 'full-mix') {
      startPreviewAt(previewBuffer, time);
    } else if (previewBuffer) {
      setCurrentTime(time);
      startPreviewAt(previewBuffer, time);
    }
  };

  const moveTrack = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= tracks.length) return;
    
    const newTracks = [...tracks];
    const item = newTracks.splice(index, 1)[0];
    newTracks.splice(newIndex, 0, item);
    setTracks(newTracks);
  };

  const captureSnapshot = (label: string) => {
    if (!tracks.length) return;
    const snapshot: ProjectSnapshot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      createdAt: Date.now(),
      tracks: tracks.map(track => ({
        ...track,
        beatMarkers: track.beatMarkers ? [...track.beatMarkers] : [],
        loopRegion: track.loopRegion ? { ...track.loopRegion } : undefined,
      })),
      globalSettings: {
        ...globalSettings,
        visualAssets: [...globalSettings.visualAssets],
      },
    };
    setSnapshots(previous => [snapshot, ...previous].slice(0, 12));
  };

  const restoreSnapshot = (snapshotId: string) => {
    const snapshot = snapshots.find(item => item.id === snapshotId);
    if (!snapshot) return;
    const currentSnapshot: ProjectSnapshot = {
      id: `${Date.now()}-before-restore`,
      label: 'Före återställning',
      createdAt: Date.now(),
      tracks: tracks.map(track => ({ ...track, beatMarkers: track.beatMarkers ? [...track.beatMarkers] : [] })),
      globalSettings: { ...globalSettings, visualAssets: [...globalSettings.visualAssets] },
    };
    stopPlayback();
    setTracks(snapshot.tracks.map(track => ({
      ...track,
      beatMarkers: track.beatMarkers ? [...track.beatMarkers] : [],
      loopRegion: track.loopRegion ? { ...track.loopRegion } : undefined,
    })));
    setGlobalSettings({
      ...snapshot.globalSettings,
      // Object URLs may have been released after a visual was removed. Rebuild
      // them from the original File so a restored version is fully usable.
      visualAssets: snapshot.globalSettings.visualAssets.map(asset => ({
        ...asset,
        url: URL.createObjectURL(asset.file),
      })),
    });
    setSnapshots(previous => [currentSnapshot, ...previous.filter(item => item.id !== snapshotId)].slice(0, 12));
    setTransitionSuggestions([]);
    setQualityIssues([]);
    setShowHistory(false);
  };

  const applyTempoTarget = (target: number, saveVersion = false) => {
    const safeTarget = Math.round(Math.min(200, Math.max(70, target || 120)));
    if (saveVersion) captureSnapshot('Före tempomatchning');
    setGlobalSettings(settings => ({ ...settings, tempoSync: true, tempoTarget: safeTarget }));
    setTracks(previous => previous.map(track => ({
      ...track,
      tempoRatio: track.detectedBpm ? clampTempoRatio(safeTarget / track.detectedBpm) : 1,
    })));
  };

  const toggleTempoSync = () => {
    if (globalSettings.tempoSync) {
      captureSnapshot('Före avstängd tempomatchning');
      setGlobalSettings(settings => ({ ...settings, tempoSync: false }));
      setTracks(previous => previous.map(track => ({ ...track, tempoRatio: 1 })));
      return;
    }
    const suggestedTarget = globalSettings.tempoTarget
      || tracks.find(track => track.detectedBpm)?.detectedBpm
      || 120;
    applyTempoTarget(suggestedTarget, true);
  };

  const analyseTransitions = async () => {
    if (tracks.filter(track => track.placement !== 'overlay' && track.buffer).length < 2) return;
    setIsAnalysingTransitions(true);
    await new Promise(resolve => window.setTimeout(resolve, 20));
    try {
      setTransitionSuggestions(suggestProjectTransitions(tracks, globalSettings));
    } finally {
      setIsAnalysingTransitions(false);
    }
  };

  const applyTransitionSuggestions = () => {
    if (!transitionSuggestions.length) return;
    captureSnapshot('Före smarta övergångar');
    const fromSuggestions = new Map<string, TransitionSuggestion>(transitionSuggestions.map(suggestion => [suggestion.fromId, suggestion]));
    const toSuggestions = new Map<string, TransitionSuggestion>(transitionSuggestions.map(suggestion => [suggestion.toId, suggestion]));
    setTracks(previous => previous.map(track => {
      const from = fromSuggestions.get(track.id);
      const to = toSuggestions.get(track.id);
      return {
        ...track,
        endTrim: from ? from.suggestedEndTrim : track.endTrim,
        transitionDuration: from ? from.suggestedCrossfade : track.transitionDuration,
        startTrim: to ? to.suggestedStartTrim : track.startTrim,
      };
    }));
  };

  const runQualityCheck = () => {
    const report = inspectProjectQuality(tracks, globalSettings);
    setQualityIssues(report);
    setQualityCheckedAt(Date.now());
    return report;
  };

  const applyExportPreset = (presetKey: keyof typeof EXPORT_PRESETS) => {
    const preset = EXPORT_PRESETS[presetKey];
    setGlobalSettings(settings => ({
      ...settings,
      exportPreset: presetKey,
      format: preset.format,
      mp3Bitrate: 'mp3Bitrate' in preset ? preset.mp3Bitrate : settings.mp3Bitrate,
      bitDepth: 'bitDepth' in preset ? preset.bitDepth : settings.bitDepth,
    }));
  };

  const applyTemplate = (templateId: typeof PROJECT_TEMPLATES[number]['id']) => {
    const template = PROJECT_TEMPLATES.find(item => item.id === templateId);
    if (!template) return;
    captureSnapshot(`Före mallen ${template.title}`);
    const exportPreset = EXPORT_PRESETS[template.settings.exportPreset];
    const targetTempo = globalSettings.tempoTarget || tracks.find(track => track.detectedBpm)?.detectedBpm || 120;
    setGlobalSettings(settings => ({
      ...settings,
      ...template.settings,
      tempoTarget: targetTempo,
      format: exportPreset.format,
      mp3Bitrate: 'mp3Bitrate' in exportPreset ? exportPreset.mp3Bitrate : settings.mp3Bitrate,
      bitDepth: 'bitDepth' in exportPreset ? exportPreset.bitDepth : settings.bitDepth,
    }));
    setTracks(previous => previous.map(track => ({
      ...track,
      tempoRatio: template.settings.tempoSync && track.detectedBpm
        ? clampTempoRatio(targetTempo / track.detectedBpm)
        : 1,
    })));
  };

  const downloadChapters = () => {
    const timeline = getProjectTimeline(tracks, globalSettings);
    const chapters = timeline.entries
      .filter(entry => entry.kind === 'sequence' && entry.track.includeInChapters !== false)
      .sort((a, b) => a.start - b.start);
    if (!chapters.length) return;
    const formatChapterTime = (seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      return hours > 0
        ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        : `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    const title = globalSettings.exportName?.trim() || 'NoBreak Project';
    const contents = `${title}\n${'='.repeat(title.length)}\n\n${chapters
      .map(entry => `${formatChapterTime(entry.start)}  ${entry.track.chapterTitle?.trim() || entry.track.name}`)
      .join('\n')}\n`;
    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9-_]+/gi, '_') || 'NoBreak_Project'}_kapitel.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingError('Din webbläsare har inte stöd för inspelning från mikrofonen.');
      return;
    }
    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        stream.getTracks().forEach(track => track.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (!blob.size) {
          setRecordingError('Inspelningen blev tom. Kontrollera mikrofonen och försök igen.');
          return;
        }
        const cleanName = recordingName.trim() || 'Berättarröst';
        const file = new File([blob], `${cleanName}.webm`, { type: mimeType });
        const mixLength = getProjectTimeline(tracks, globalSettings).totalDuration;
        const overlayStart = Math.min(Math.max(currentTime || 0, 0), mixLength || 0);
        captureSnapshot('Före röstinspelning');
        await addAudioFile(file, {
          name: cleanName,
          role: 'voice',
          placement: 'overlay',
          overlayStart,
          includeInChapters: false,
          chapterTitle: cleanName,
        }, tracks.length);
      };
      recorder.start(250);
      setRecordingSeconds(0);
      setIsRecording(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mikrofonen kunde inte startas.';
      setRecordingError(`Kunde inte starta mikrofonen: ${message}`);
    }
  };

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    setIsRecording(false);
  };

  useEffect(() => {
    if (!isRecording) {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      return;
    }
    recordingTimerRef.current = window.setInterval(() => setRecordingSeconds(seconds => seconds + 1), 1000);
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [isRecording]);

  useEffect(() => () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const handleExport = async (force = false) => {
    if (tracks.length === 0) return;
    if (!force) {
      runQualityCheck();
      setShowQualityModal(true);
      return;
    }
    setIsRendering(true);
    setIsRenderingMinimized(false);
    setRenderProgress(0);
    
    try {
      console.log('Starting audio render...');
      const resultBuffer = await renderMix(tracks, globalSettings);
      
      let blob: Blob;
      const isVideoExport = globalSettings.format === 'mp4' && globalSettings.visualAssets.length > 0;
      if (isVideoExport) {
        console.log('Starting video render...');
        blob = await renderVideo(resultBuffer, globalSettings.visualAssets, (p) => setRenderProgress(p));
      } else {
        console.log('Encoding audio...');
        if (globalSettings.format === 'wav') {
          blob = encodeWAV(resultBuffer, globalSettings.bitDepth || 16);
        } else {
          blob = await encodeMP3(resultBuffer, globalSettings.mp3Bitrate || 192, (p) => setRenderProgress(p));
        }
      }
      
      console.log('Export complete, triggering download...');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      const safeProjectName = (globalSettings.exportName || 'NoBreak_Project')
        .trim()
        .replace(/[^a-z0-9-_]+/gi, '_')
        .replace(/^_+|_+$/g, '') || 'NoBreak_Project';
      const extension = isVideoExport ? 'mp4' : globalSettings.format === 'wav' ? 'wav' : 'mp3';
      a.download = `${safeProjectName}_${new Date().getTime()}.${extension}`;
      
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`Exporten misslyckades: ${err instanceof Error ? err.message : 'Okänt fel'}. Dubbelkolla att din webbläsare stöder VideoEncoder (Chrome/Edge rekommenderas för MP4).`);
    } finally {
      setIsRendering(false);
      setRenderProgress(0);
    }
  };

  const projectTimeline = getProjectTimeline(tracks, globalSettings);
  const totalDuration = projectTimeline.totalDuration;
  const chapterEntries = projectTimeline.entries
    .filter(entry => entry.kind === 'sequence' && entry.track.includeInChapters !== false)
    .sort((a, b) => a.start - b.start);

  return (
    <div className="min-h-screen bg-brand-bg text-[#E0E2E6] font-sans flex flex-col overflow-x-hidden">
      {/* Header Bar */}
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-brand-panel/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="relative group cursor-default flex items-center gap-2">
             <div className="absolute -inset-1 bg-gradient-to-r from-[#ec4899] via-[#a855f7] to-[#06b6d4] rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200 pointer-events-none"></div>
             <div className="relative flex items-center gap-3 bg-brand-bg px-4 py-2 rounded-lg border border-white/10" id="main-logo-container">
                <div className="flex flex-col items-center justify-center space-y-[-4px]">
                   <Waves className="text-[#ec4899]" size={20} />
                   <Waves className="text-[#06b6d4] rotate-180" size={20} />
                </div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-black tracking-tighter leading-none bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                    NOBREAK
                  </h1>
                   <div className="flex items-center gap-2">
                     <span className="text-[9px] font-black uppercase tracking-[.25em] text-[#a855f7]">Audio Builder</span>
                     <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-white/30 border border-white/5 leading-none">v{__APP_VERSION__}</span>
                   </div>
                </div>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex flex-col items-end border-r border-white/10 pr-6">
             <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Est. File Size</span>
             <span className="font-mono text-sm text-[#06b6d4]">{getEstimatedSize()}</span>
          </div>
          <div className="hidden md:flex flex-col items-end">
             <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Total Mix Length</span>
             <span className="font-mono text-sm">{formatTime(totalDuration)}</span>
          </div>
          <button
            onClick={() => { runQualityCheck(); setShowQualityModal(true); }}
            disabled={tracks.length === 0 || isRendering}
            className="hidden xl:flex px-3 py-2 border border-white/10 rounded font-black text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30 transition-all items-center gap-2"
            title="Kontrollera mixen före export"
          >
            <BadgeCheck size={14} className="text-[#a855f7]" />
            Kontroll
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="hidden lg:flex p-2 border border-white/10 rounded text-white/60 hover:bg-white/10 hover:text-white transition-all"
            title="Tidigare versioner"
          >
            <History size={16} />
          </button>
          <button 
            onClick={previewMix}
            disabled={isRendering || tracks.length === 0}
            className={`px-4 py-2 border rounded font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${
              isPlaying && playingId === 'full-mix' 
                ? 'bg-[#ec4899] text-white border-[#ec4899] shadow-[0_0_20px_rgba(236,72,153,0.3)]' 
                : 'bg-white/5 border-white/10 hover:bg-white/10 text-white'
            }`}
          >
            {isPlaying && playingId === 'full-mix' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
            {isPreviewing && !isPlaying ? 'Prep...' : 'Preview Mix'}
          </button>
          <button 
            onClick={handleExport}
            disabled={isRendering || tracks.length === 0}
            className="px-6 py-2 bg-[#06b6d4] hover:bg-[#06b6d4]/90 disabled:bg-white/5 disabled:text-white/20 text-black font-black text-xs rounded shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all uppercase tracking-widest flex items-center gap-2"
          >
            {isRendering ? (
              <div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" />
            ) : <Download size={14} />}
            {isRendering ? 'Exporting...' : 'Export Master'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-8 flex flex-col gap-8">
        {/* Project Metadata */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h2 className="text-5xl font-black italic uppercase tracking-tighter text-white">Project Timeline</h2>
            <p className="text-white/40 text-sm mt-1 flex items-center gap-2">
              <Waves size={14} className="text-[#ec4899]" />
              Mixing {tracks.length} sources • High Fidelity Mode • 44.1kHz / 16-bit
            </p>
          </div>
          <div className="flex gap-4">
            <div className="bg-white/5 border border-white/10 p-3 rounded-lg flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-[#06b6d4] font-bold uppercase mb-1">Format</span>
              <span className="text-lg font-bold">{globalSettings.format.toUpperCase()}</span>
            </div>
            <div className="bg-white/5 border border-white/10 p-3 rounded-lg flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-[#a855f7] font-bold uppercase mb-1">Quality</span>
              <span className="text-lg font-bold">{globalSettings.format === 'wav' ? `${globalSettings.bitDepth || 16}-BIT` : globalSettings.format === 'mp3' ? `${globalSettings.mp3Bitrate || 192}K` : 'VIDEO'}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Timeline Column */}
          <div className="lg:col-span-3 space-y-6">
            {/* Ready-made starting points */}
            <section className="rounded-2xl border border-white/5 bg-brand-panel/70 p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <Sparkles size={16} className="text-[#a855f7]" />
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.18em]">Börja med en mall</h3>
                    <p className="text-[10px] text-white/40 mt-1">Välj en färdig grund och justera sedan fritt.</p>
                  </div>
                </div>
                <button
                  onClick={() => captureSnapshot('Manuell version')}
                  disabled={!tracks.length}
                  className="px-3 py-2 rounded border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30 flex items-center gap-2"
                >
                  <Save size={13} /> Spara version
                </button>
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                {PROJECT_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    onClick={() => applyTemplate(template.id)}
                    className="text-left rounded-xl border border-white/5 bg-white/[0.03] p-3 hover:border-[#a855f7]/50 hover:bg-[#a855f7]/10 transition-all"
                  >
                    <span className="block text-[10px] font-black uppercase tracking-wider text-white">{template.title}</span>
                    <span className="block text-[9px] leading-relaxed text-white/40 mt-1">{template.description}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Voiceover recorder */}
            <section className="rounded-2xl border border-cyan-400/15 bg-gradient-to-r from-cyan-400/[0.06] to-transparent p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isRecording ? 'bg-red-500/20 text-red-300 animate-pulse' : 'bg-cyan-400/10 text-cyan-300'}`}>
                    <Mic size={19} />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.18em]">Spela in berättarröst</h3>
                    <p className="text-[10px] text-white/45 mt-1">Rösten placeras över musiken vid aktuell tid och kan automatiskt sänka bakgrundsmusiken.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={recordingName}
                    onChange={event => setRecordingName(event.target.value)}
                    disabled={isRecording}
                    maxLength={50}
                    aria-label="Namn på röstinspelning"
                    className="w-36 sm:w-44 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
                    placeholder="Berättarröst"
                  />
                  {isRecording ? (
                    <button
                      onClick={stopVoiceRecording}
                      className="px-4 py-2 rounded-lg bg-red-500 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                    >
                      <Square size={12} fill="currentColor" /> Stoppa {formatTime(recordingSeconds).slice(0, 5)}
                    </button>
                  ) : (
                    <button
                      onClick={startVoiceRecording}
                      className="px-4 py-2 rounded-lg bg-cyan-300 text-[#051013] text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-cyan-200"
                    >
                      <Mic size={13} /> Spela in
                    </button>
                  )}
                </div>
              </div>
              {recordingError && <p className="mt-3 text-[10px] font-semibold text-red-300">{recordingError}</p>}
            </section>

            {/* Drop Zone */}
            <div 
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`
                relative p-12 rounded-2xl border-2 border-dashed transition-all duration-300 group
                ${dragActive ? 'border-[#ec4899] bg-[#ec4899]/5' : 'border-white/5 bg-brand-panel/50 hover:border-white/20'}
              `}
            >
              <div className="flex flex-col items-center text-center">
                <div className="p-4 bg-white/5 text-white/40 rounded-xl mb-4 group-hover:bg-[#ec4899]/10 group-hover:text-[#ec4899] transition-colors">
                  <Plus size={32} />
                </div>
                <h3 className="text-lg font-bold uppercase tracking-tight">Drop Files or Folders</h3>
                <p className="text-xs text-white/30 mt-1 uppercase tracking-[0.1em] mb-6">WAV or MP3 Supported</p>
                
                <div className="flex gap-4 relative z-20">
                  <button className="relative px-6 py-2 bg-white/5 hover:bg-white/10 rounded font-bold text-[10px] uppercase tracking-widest transition-all">
                    Choose Files
                    <input 
                      type="file" multiple accept="audio/*" 
                      onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </button>
                  <button className="relative px-6 py-2 bg-white/5 hover:bg-white/10 rounded font-bold text-[10px] uppercase tracking-widest transition-all">
                    Choose Folder
                    <input 
                      type="file" 
                      // @ts-ignore
                      webkitdirectory="" 
                      multiple 
                      onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* List of tracks */}
            <Reorder.Group axis="y" values={tracks} onReorder={setTracks} className="space-y-3">
              {tracks.map((track, index) => (
                  <Reorder.Item
                    key={track.id}
                    value={track}
                    className="flex flex-col bg-brand-panel border border-white/5 rounded-xl overflow-hidden group hover:border-white/15 transition-all cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex flex-col justify-center px-6 py-4 gap-3">
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-4">
                          <div className="text-white/20 group-hover:text-white/40 transition-colors">
                            <GripVertical size={20} />
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); playTrack(track); }}
                            disabled={!track.buffer}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                              isPlaying && playingId === track.id
                                ? 'bg-[#ec4899] text-white'
                                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            {isPlaying && playingId === track.id ? <Pause size={18} fill="currentColor" /> : <Play size={18} className="translate-x-0.5" fill="currentColor" />}
                          </button>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-base tracking-tight truncate uppercase italic">{track.name}</h4>
                            <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-white/40 font-mono">
                              {track.buffer ? `${getTrackPlaybackDuration(track).toFixed(1)}s` : '...'}
                            </span>
                            {track.role === 'voice' ? (
                              <span className="text-[8px] px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-200 border border-cyan-400/20 font-black uppercase tracking-wider">Röst</span>
                            ) : track.detectedBpm ? (
                              <span className="text-[8px] px-2 py-0.5 rounded bg-[#a855f7]/10 text-[#d8b4fe] border border-[#a855f7]/20 font-black uppercase tracking-wider">
                                {track.detectedBpm} BPM{globalSettings.tempoSync && track.tempoRatio && Math.abs(track.tempoRatio - 1) > 0.005 ? ` · ${Math.round(track.tempoRatio * 100)}%` : ''}
                              </span>
                            ) : null
                            }
                            {track.placement === 'overlay' && <span className="text-[8px] px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-200 font-black uppercase tracking-wider">Ovanpå mixen</span>}
                            {track.buffer && (() => {
                              const playable = getTrackPlaybackRegion(track);
                              const removed = playable.autoLeadingSilence + playable.autoTrailingSilence;
                              return removed > 0 ? (
                                <span className="text-[8px] px-2 py-0.5 rounded bg-green-400/10 text-green-200 border border-green-400/20 font-black uppercase tracking-wider">
                                  Tystnad bort {removed.toFixed(1)}s
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </div>

                        <div className="flex gap-1 border-l border-white/5 pl-4">
                          <button onClick={(e) => { e.stopPropagation(); moveTrack(index, 'up'); }} disabled={index === 0} className="p-2 hover:bg-white/5 rounded text-white/40 hover:text-white disabled:opacity-0 transition-all">
                            <ArrowUp size={16} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); moveTrack(index, 'down'); }} disabled={index === tracks.length - 1} className="p-2 hover:bg-white/5 rounded text-white/40 hover:text-white disabled:opacity-0 transition-all">
                            <ArrowDown size={16} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }} className="p-2 hover:bg-white/5 rounded text-white/40 hover:text-red-500 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Professional Controls Row (Features 3 & 4) */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-1">
                        {/* Trim Controls */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                            <span>Start Trim</span>
                            <span>{track.startTrim || 0}s</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max={track.buffer ? track.buffer.duration / 2 : 10} 
                            step="0.1" 
                            value={track.startTrim || 0} 
                            onChange={(e) => updateTrack(track.id, { startTrim: parseFloat(e.target.value) })} 
                            onPointerDown={(e) => e.stopPropagation()} 
                            className="w-full h-1 bg-white/10 rounded-full appearance-none"
                            style={{ accentColor: track.color }}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                            <span>End Trim</span>
                            <span>{track.endTrim || 0}s</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max={track.buffer ? track.buffer.duration / 2 : 10} 
                            step="0.1" 
                            value={track.endTrim || 0} 
                            onChange={(e) => updateTrack(track.id, { endTrim: parseFloat(e.target.value) })} 
                            onPointerDown={(e) => e.stopPropagation()} 
                            className="w-full h-1 bg-white/10 rounded-full appearance-none"
                            style={{ accentColor: track.color }}
                          />
                        </div>

                        {/* EQ Controls */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                            <span>Bass Boost</span>
                            <span style={track.bass && track.bass !== 0 ? { color: track.color } : {}}>{track.bass || 0}dB</span>
                          </div>
                          <input 
                            type="range" 
                            min="-10" 
                            max="10" 
                            step="1" 
                            value={track.bass || 0} 
                            onChange={(e) => updateTrack(track.id, { bass: parseInt(e.target.value) })} 
                            onPointerDown={(e) => e.stopPropagation()} 
                            className="w-full h-1 bg-white/10 rounded-full appearance-none"
                            style={{ accentColor: track.color }}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                            <span>Treble</span>
                            <span style={track.treble && track.treble !== 0 ? { color: track.color } : {}}>{track.treble || 0}dB</span>
                          </div>
                          <input 
                            type="range" 
                            min="-10" 
                            max="10" 
                            step="1" 
                            value={track.treble || 0} 
                            onChange={(e) => updateTrack(track.id, { treble: parseInt(e.target.value) })} 
                            onPointerDown={(e) => e.stopPropagation()} 
                            className="w-full h-1 bg-white/10 rounded-full appearance-none"
                            style={{ accentColor: track.color }}
                          />
                        </div>
                      </div>

                      {/* Gain/Fade row */}
                      <div className="flex gap-6 mt-2 border-t border-white/5 pt-3">
                        <div className="flex-1 flex gap-4">
                           <div className="flex-1 space-y-1">
                             <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                                <span>Fade In</span>
                                <span>{track.fadeIn}s</span>
                             </div>
                             <input 
                               type="range" 
                               min="0" 
                               max="5" 
                               step="0.1" 
                               value={track.fadeIn} 
                               onChange={(e) => updateTrack(track.id, { fadeIn: parseFloat(e.target.value) })} 
                               onPointerDown={(e) => e.stopPropagation()} 
                               className="w-full h-1 bg-white/5 rounded-full appearance-none"
                               style={{ accentColor: track.color }}
                             />
                           </div>
                           <div className="flex-1 space-y-1">
                             <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                                <span>Fade Out</span>
                                <span>{track.fadeOut}s</span>
                             </div>
                             <input 
                               type="range" 
                               min="0" 
                               max="5" 
                               step="0.1" 
                               value={track.fadeOut} 
                               onChange={(e) => updateTrack(track.id, { fadeOut: parseFloat(e.target.value) })} 
                               onPointerDown={(e) => e.stopPropagation()} 
                               className="w-full h-1 bg-white/5 rounded-full appearance-none"
                               style={{ accentColor: track.color }}
                             />
                           </div>
                        </div>
                        <div className="flex-1 space-y-1">
                           <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                              <span>Local Gain</span>
                              <span style={{ color: track.color }}>{Math.round(track.volume * 100)}%</span>
                           </div>
                           <input 
                              type="range" 
                              min="0" 
                              max="2" 
                              step="0.05" 
                              value={track.volume} 
                              onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })} 
                              onPointerDown={(e) => e.stopPropagation()} 
                              className="w-full h-1 bg-white/10 rounded-full appearance-none"
                              style={{ accentColor: track.color }}
                           />
                        </div>
                      </div>

                      {/* Smart per-track controls: voice placement, chapters and an optional custom join. */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 border-t border-white/5 pt-3">
                        <div className="space-y-1">
                          <span className="block text-[7px] font-black uppercase tracking-widest text-white/20">Spårtyp</span>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              const becomesVoice = track.role !== 'voice';
                              updateTrack(track.id, {
                                role: becomesVoice ? 'voice' : 'music',
                                placement: becomesVoice ? 'overlay' : 'sequence',
                                includeInChapters: !becomesVoice,
                                overlayStart: becomesVoice ? Math.min(currentTime || 0, totalDuration) : undefined,
                              });
                            }}
                            className={`w-full rounded px-2 py-1.5 text-left text-[9px] font-black uppercase tracking-wider border transition-all ${track.role === 'voice' ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
                          >
                            {track.role === 'voice' ? 'Berättarröst' : 'Musik / ljud'}
                          </button>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                            <span>{track.role === 'voice' ? 'Placering' : 'Övergång till nästa'}</span>
                            {track.role !== 'voice' && <span>{track.transitionDuration ?? globalSettings.crossfadeDuration}s</span>}
                          </div>
                          {track.role === 'voice' ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                updateTrack(track.id, { placement: track.placement === 'overlay' ? 'sequence' : 'overlay' });
                              }}
                              className="w-full rounded px-2 py-1.5 text-left text-[9px] font-black uppercase tracking-wider border border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100 hover:bg-cyan-400/10"
                            >
                              {track.placement === 'overlay' ? 'Ovanpå musik' : 'Eget avsnitt'}
                            </button>
                          ) : (
                            <input
                              type="range"
                              min="0"
                              max="8"
                              step="0.5"
                              value={track.transitionDuration ?? globalSettings.crossfadeDuration}
                              onChange={event => updateTrack(track.id, { transitionDuration: parseFloat(event.target.value) })}
                              onPointerDown={event => event.stopPropagation()}
                              className="w-full h-5 accent-[#a855f7]"
                            />
                          )}
                        </div>

                        {track.role === 'voice' && track.placement === 'overlay' ? (
                          <div className="space-y-1">
                            <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                              <span>Start i mixen</span>
                              <span>{formatTime(track.overlayStart || 0).slice(0, 5)}</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max={Math.max(totalDuration, 1)}
                              step="0.1"
                              value={Math.min(track.overlayStart || 0, Math.max(totalDuration, 1))}
                              onChange={event => updateTrack(track.id, { overlayStart: parseFloat(event.target.value) })}
                              onPointerDown={event => event.stopPropagation()}
                              className="w-full h-5 accent-cyan-300"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex justify-between text-[7px] font-black uppercase tracking-widest text-white/20">
                              <span>Tempo</span>
                              <span>{track.detectedBpm ? `${track.detectedBpm} BPM` : '–'}</span>
                            </div>
                            <p className="text-[9px] leading-4 text-white/35">{globalSettings.tempoSync && track.detectedBpm ? `Matchas till ${globalSettings.tempoTarget || 120} BPM` : 'Taktlinjer visas i vågformen'}</p>
                          </div>
                        )}

                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[7px] font-black uppercase tracking-widest text-white/20">
                            <span>Kapitelrubrik</span>
                            <button
                              onClick={event => { event.stopPropagation(); updateTrack(track.id, { includeInChapters: !(track.includeInChapters !== false) }); }}
                              className={`text-[7px] ${track.includeInChapters !== false ? 'text-green-300' : 'text-white/30'}`}
                            >
                              {track.includeInChapters !== false ? 'Med' : 'Utanför'}
                            </button>
                          </div>
                          <input
                            value={track.chapterTitle ?? track.name}
                            onChange={event => updateTrack(track.id, { chapterTitle: event.target.value })}
                            onPointerDown={event => event.stopPropagation()}
                            className="w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[9px] text-white outline-none focus:border-[#a855f7]/60"
                            aria-label={`Kapitelrubrik för ${track.name}`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Waveform Row */}
                    <div className="w-full bg-black/20 border-t border-white/5 pointer-events-auto h-14 relative flex flex-col">
                      {track.buffer ? (
                        <div className="w-full h-full relative" onPointerDown={(e) => e.stopPropagation()}>
                          <WaveformCanvas 
                            buffer={track.buffer} 
                            color={track.color || "rgba(74,222,128,0.4)"}
                            currentTime={playingId === track.id ? currentTime : undefined}
                            duration={track.buffer.duration}
                            onSeek={(t) => handleSeekTrack(track, t)}
                            loopRegion={track.loopRegion}
                            onLoopRegionChange={(region) => updateTrack(track.id, { loopRegion: region })}
                            startTrim={track.startTrim}
                            endTrim={track.endTrim}
                            beatMarkers={track.beatMarkers}
                            isVoice={track.role === 'voice'}
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-r from-[#ec4899]/10 to-transparent pointer-events-none" />
                      )}
                      {track.buffer && (
                        <span className="pointer-events-none absolute bottom-1 left-3 rounded bg-black/40 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-widest text-white/35">
                          {track.role === 'voice' ? 'Röstvågform' : 'Vågform · taktrutor'}{(track.startTrim || track.endTrim) ? ' · rött beskärs' : ''}
                        </span>
                      )}
                    </div>
                  </Reorder.Item>
              ))}
            </Reorder.Group>
          </div>

          {/* Sidebar Controls */}
          <div className="space-y-6">
            <div className="bg-brand-panel p-6 rounded-2xl border border-white/5 space-y-8">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#a855f7] shadow-[0_0_10px_rgba(168,85,247,0.8)]" />
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white">Mixing Engine</h3>
              </div>

              {/* Format */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Output Format</label>
                  <span className="text-[10px] font-mono text-[#06b6d4]">~{getEstimatedSize()}</span>
                </div>
                <div className="flex gap-2">
                  {(['mp3', 'wav'] as ExportFormat[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setGlobalSettings(s => ({ ...s, format: f }))}
                      className={`
                        flex-1 py-2 rounded text-[10px] font-black tracking-widest uppercase transition-all
                        ${globalSettings.format === f 
                          ? 'bg-[#ec4899] text-white shadow-lg' 
                          : 'bg-white/5 text-white/40 hover:bg-white/10'}
                      `}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {globalSettings.format === 'wav' && (
                  <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-white/5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#a855f7]">Bit Depth</span>
                    <div className="flex gap-2">
                      {[16, 24, 32].map(bd => (
                        <button 
                          key={bd}
                          onClick={() => setGlobalSettings(s => ({ ...s, bitDepth: bd as any }))}
                          className={`flex-1 py-1.5 text-[9px] font-bold rounded border uppercase tracking-wider transition-all ${
                            (globalSettings.bitDepth || 16) === bd
                              ? 'border-[#a855f7] text-[#a855f7] bg-[#a855f7]/10' 
                              : 'border-white/10 text-white/40 hover:bg-white/5'
                          }`}
                        >
                          {bd}-BIT
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* NOBREAK overlap */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">NOBREAK-ÖVERLAPPNING</label>
                  <span className="font-mono text-sm text-[#ec4899]">{globalSettings.crossfadeDuration}s</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white/60 transition-all duration-300"
                      style={{ width: `${(globalSettings.crossfadeDuration / 10) * 100}%` }}
                    />
                  </div>
                </div>
                <input 
                  type="range" min="0" max="10" step="0.5" 
                  value={globalSettings.crossfadeDuration} 
                  onChange={(e) => setGlobalSettings(s => ({ ...s, crossfadeDuration: parseFloat(e.target.value) }))}
                  className="w-full mt-[-16px] h-4 opacity-0 cursor-pointer absolute z-10"
                />
                <p className="text-[9px] font-bold italic text-white/20 uppercase">Jämn överlappning mellan alla musikspår</p>
                <div className="flex items-start gap-2 rounded-lg border border-green-400/10 bg-green-400/[0.035] px-3 py-2">
                  <BadgeCheck size={13} className="mt-0.5 shrink-0 text-green-300" />
                  <p className="text-[8px] leading-4 text-green-100/75"><strong className="font-black uppercase tracking-wider">NoBreak Guard aktiv.</strong> Tydlig tystnad i början och slutet av låtar tas bort automatiskt. Musikspår behåller alltid en kort säker överlappning.</p>
                </div>
              </div>

              {/* Smart tempo and transition assistant */}
              <div className="space-y-5 border-t border-white/5 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <Gauge size={15} className="mt-0.5 text-[#a855f7]" />
                    <div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest">Automatisk taktpassning</h4>
                      <p className="text-[9px] leading-4 text-white/35 mt-1">Anpassar uppspelningstakten försiktigt för ett jämnare byte mellan låtar.</p>
                    </div>
                  </div>
                  <button
                    onClick={toggleTempoSync}
                    className={`w-9 h-5 rounded-full relative transition-all flex-shrink-0 ${globalSettings.tempoSync ? 'bg-[#a855f7]' : 'bg-white/10'}`}
                    aria-label="Slå på eller av automatisk taktpassning"
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${globalSettings.tempoSync ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-white/35 whitespace-nowrap">Måltempo</label>
                  <input
                    type="number"
                    min="70"
                    max="200"
                    value={globalSettings.tempoTarget || 120}
                    onChange={event => {
                      const target = Math.max(70, Math.min(200, Number(event.target.value) || 120));
                      setGlobalSettings(settings => ({ ...settings, tempoTarget: target }));
                      if (globalSettings.tempoSync) {
                        setTracks(previous => previous.map(track => ({ ...track, tempoRatio: track.detectedBpm ? clampTempoRatio(target / track.detectedBpm) : 1 })));
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs font-mono text-white outline-none focus:border-[#a855f7]/60"
                  />
                  <span className="text-[9px] font-bold text-white/40">BPM</span>
                  <button
                    onClick={() => applyTempoTarget(globalSettings.tempoTarget || 120, true)}
                    disabled={!tracks.some(track => track.detectedBpm)}
                    className="rounded bg-[#a855f7]/15 px-2 py-1.5 text-[8px] font-black uppercase tracking-wider text-[#d8b4fe] hover:bg-[#a855f7]/25 disabled:opacity-30"
                  >
                    Matcha
                  </button>
                </div>
                <p className="text-[8px] text-white/25">{tracks.filter(track => track.detectedBpm).length} av {tracks.length} musikspår har ett hittat tempo.</p>

                <div className="pt-4 border-t border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <Wand2 size={15} className="mt-0.5 text-[#ec4899]" />
                      <div>
                        <h4 className="text-[10px] font-black uppercase tracking-widest">Smarta övergångar</h4>
                        <p className="text-[9px] leading-4 text-white/35 mt-1">Letar efter lugna slut och tydliga starter i angränsande spår.</p>
                      </div>
                    </div>
                    <button
                      onClick={analyseTransitions}
                      disabled={isAnalysingTransitions || tracks.length < 2}
                      className="rounded bg-[#ec4899]/15 px-2 py-1.5 text-[8px] font-black uppercase tracking-wider text-pink-200 hover:bg-[#ec4899]/25 disabled:opacity-30"
                    >
                      {isAnalysingTransitions ? 'Letar…' : 'Föreslå'}
                    </button>
                  </div>
                  {transitionSuggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {transitionSuggestions.slice(0, 2).map(suggestion => (
                        <div key={suggestion.id} className="rounded-lg border border-white/5 bg-black/20 px-2 py-2">
                          <p className="text-[8px] font-bold text-white/70 truncate">{suggestion.fromName} <span className="text-[#ec4899]">→</span> {suggestion.toName}</p>
                          <p className="text-[8px] text-white/35 mt-1">{suggestion.suggestedCrossfade}s övergång · {suggestion.confidence === 'high' ? 'hög träff' : suggestion.confidence === 'medium' ? 'rimlig träff' : 'prova i förhandslyssning'}</p>
                        </div>
                      ))}
                      {transitionSuggestions.length > 2 && <p className="text-[8px] text-white/30">+ {transitionSuggestions.length - 2} fler förslag</p>}
                      <button
                        onClick={applyTransitionSuggestions}
                        className="w-full rounded border border-[#ec4899]/30 bg-[#ec4899]/10 px-2 py-2 text-[8px] font-black uppercase tracking-wider text-pink-100 hover:bg-[#ec4899]/20"
                      >
                        Använd alla förslag
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Automatic music ducking for voiceovers */}
              <div
                className="rounded-lg border border-cyan-400/10 bg-cyan-400/[0.035] p-4 cursor-pointer hover:border-cyan-400/30 transition-all"
                onClick={() => setGlobalSettings(settings => ({ ...settings, autoDuck: !settings.autoDuck }))}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-3">
                    <Volume1 size={15} className="mt-0.5 text-cyan-300" />
                    <div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest">Sänk musik under röst</h4>
                      <p className="text-[9px] text-white/35 mt-1">Bakgrunden blir lägre medan en berättarröst hörs.</p>
                    </div>
                  </div>
                  <div className={`w-8 h-4 rounded-full relative transition-all ${globalSettings.autoDuck ? 'bg-cyan-400' : 'bg-white/10'}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${globalSettings.autoDuck ? 'left-4.5' : 'left-0.5'}`} />
                  </div>
                </div>
                <div className="mt-3" onClick={event => event.stopPropagation()}>
                  <div className="flex justify-between text-[8px] font-bold uppercase tracking-wider text-white/30 mb-1">
                    <span>Hur mycket musiken sänks</span><span>{globalSettings.duckAmount || 12} dB</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="24"
                    step="1"
                    value={globalSettings.duckAmount || 12}
                    onChange={event => setGlobalSettings(settings => ({ ...settings, duckAmount: Number(event.target.value) }))}
                    className="w-full accent-cyan-300"
                  />
                </div>
              </div>

              {/* Normalization */}
              <div 
                onClick={() => setGlobalSettings(s => ({ ...s, normalize: !s.normalize }))}
                className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5 cursor-pointer hover:border-[#a855f7]/30 transition-all"
              >
                <div className="space-y-1">
                  <h4 className="text-[11px] font-black uppercase tracking-widest">Auto Gain</h4>
                  <p className="text-[9px] text-white/30 uppercase font-bold tracking-wider text-[#a855f7]">Normalization Engine</p>
                </div>
                <div className={`w-8 h-4 rounded-full relative transition-all ${globalSettings.normalize ? 'bg-[#a855f7]' : 'bg-white/10'}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${globalSettings.normalize ? 'left-4.5' : 'left-0.5'}`} />
                </div>
              </div>

              {/* Export profile */}
              <div className="space-y-4 pt-6 border-t border-white/5">
                <div className="flex items-center gap-3">
                  <FileText size={14} className="text-[#06b6d4]" />
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Exportval</h3>
                    <p className="text-[9px] text-white/35 mt-1">Välj vad filen främst ska användas till.</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(EXPORT_PRESETS) as Array<keyof typeof EXPORT_PRESETS>).map(key => {
                    const preset = EXPORT_PRESETS[key];
                    return (
                      <button
                        key={key}
                        onClick={() => applyExportPreset(key)}
                        className={`rounded-lg border px-2 py-2 text-left transition-all ${globalSettings.exportPreset === key ? 'border-[#06b6d4]/60 bg-[#06b6d4]/10 text-white' : 'border-white/5 bg-white/[0.03] text-white/55 hover:bg-white/10'}`}
                      >
                        <span className="block text-[8px] font-black uppercase tracking-wider">{preset.label}</span>
                        <span className="block mt-1 text-[7px] leading-3 text-white/35">{preset.description}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-bold uppercase tracking-widest text-white/35">Filnamn</label>
                  <input
                    value={globalSettings.exportName || ''}
                    onChange={event => setGlobalSettings(settings => ({ ...settings, exportName: event.target.value }))}
                    placeholder="NoBreak_Project"
                    maxLength={80}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-[#06b6d4]/60"
                  />
                </div>
                {globalSettings.format === 'mp3' && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-white/35">MP3-kvalitet</span>
                    <div className="flex gap-1">
                      {([128, 192, 320] as const).map(rate => (
                        <button
                          key={rate}
                          onClick={() => setGlobalSettings(settings => ({ ...settings, mp3Bitrate: rate, exportPreset: undefined }))}
                          className={`rounded px-2 py-1 text-[8px] font-black ${globalSettings.mp3Bitrate === rate ? 'bg-[#06b6d4] text-black' : 'bg-white/5 text-white/45 hover:bg-white/10'}`}
                        >
                          {rate}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Visuals Selection */}
              <div className="space-y-4 pt-6 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <VideoIcon size={14} className="text-[#06b6d4]" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Visuals ({globalSettings.visualAssets.length})</h3>
                  </div>
                  <div className="relative group">
                    <button className="p-1 px-2 bg-white/5 hover:bg-white/10 rounded text-[8px] font-black uppercase text-white/60">
                      Add +
                    </button>
                    <input 
                      type="file" 
                      accept="image/*,video/*" 
                      multiple
                      onChange={(e) => {
                        if (e.target.files) {
                          Array.from(e.target.files).forEach((f: File) => handleVisualUpload(f));
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                  {globalSettings.visualAssets.length === 0 ? (
                    <div className="h-20 rounded-xl border-2 border-dashed border-white/5 bg-white/5 flex flex-col items-center justify-center gap-2">
                       <span className="text-[9px] font-bold text-white/30 uppercase">No visuals added</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {globalSettings.visualAssets.map((asset, idx) => (
                        <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-white/10">
                          {asset.type === 'image' ? (
                            <img src={asset.url} className="w-full h-full object-cover" />
                          ) : (
                            <video src={asset.url} className="w-full h-full object-cover" muted />
                          )}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                            <button onClick={() => removeVisual(idx)} className="p-1.5 bg-red-500/20 text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-all">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <p className="text-[9px] font-bold italic text-white/20 uppercase">
                  {globalSettings.visualAssets.length > 1 ? 'Images will cycle throughout the video' : 'Video will loop for export'}
                </p>
                
                {globalSettings.visualAssets.length > 0 && (
                   <div className="flex gap-2">
                      {(['mp3', 'wav', 'mp4'] as ExportFormat[]).map(f => (
                        <button
                          key={f}
                          onClick={() => setGlobalSettings(s => ({ ...s, format: f }))}
                          className={`
                            flex-1 py-1.5 rounded text-[9px] font-black tracking-widest uppercase transition-all
                            ${globalSettings.format === f 
                              ? 'bg-[#06b6d4] text-black shadow-lg shadow-[#06b6d4]/20' 
                              : 'bg-white/5 text-white/40 hover:bg-white/10'}
                          `}
                        >
                          {f}
                        </button>
                      ))}
                   </div>
                )}
              </div>

              {/* Engine Status */}
              <div className="pt-6 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Engine Ready</span>
                </div>
              </div>
            </div>

            {/* Chapters and pre-export report */}
            <section className="rounded-2xl border border-white/5 bg-brand-panel p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ListMusic size={15} className="text-[#06b6d4]" />
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Kapitel & låtlista</h3>
                    <p className="text-[9px] text-white/35 mt-1">Tider följer den färdiga mixen.</p>
                  </div>
                </div>
                <button
                  onClick={downloadChapters}
                  disabled={!chapterEntries.length}
                  className="rounded bg-white/5 px-2 py-1.5 text-[8px] font-black uppercase tracking-wider text-white/65 hover:bg-white/10 disabled:opacity-30 flex items-center gap-1"
                >
                  <Download size={11} /> TXT
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {chapterEntries.length ? chapterEntries.map(entry => (
                  <div key={entry.track.id} className="flex gap-2 text-[9px] leading-4">
                    <span className="font-mono text-[#06b6d4]">{formatTime(entry.start).slice(0, 5)}</span>
                    <span className="truncate text-white/60">{entry.track.chapterTitle?.trim() || entry.track.name}</span>
                  </div>
                )) : <p className="text-[9px] text-white/30">Lägg till musikspår och välj ”Med” på respektive spår.</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-white/5 bg-brand-panel p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <BadgeCheck size={15} className={qualityIssues.some(issue => issue.severity === 'error') ? 'text-red-300' : qualityIssues.length ? 'text-amber-300' : 'text-green-300'} />
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-white">Kontroll före export</h3>
                    <p className="text-[9px] text-white/35 mt-1">Hittar tystnad, nivåer, tempo och röstöverlägg innan filen sparas.</p>
                  </div>
                </div>
                <button
                  onClick={() => { runQualityCheck(); setShowQualityModal(true); }}
                  disabled={!tracks.length}
                  className="rounded bg-[#a855f7]/15 px-2 py-1.5 text-[8px] font-black uppercase tracking-wider text-[#d8b4fe] hover:bg-[#a855f7]/25 disabled:opacity-30"
                >
                  Kontrollera
                </button>
              </div>
              {qualityCheckedAt && (
                <p className={`mt-3 text-[9px] ${qualityIssues.length ? 'text-amber-200/80' : 'text-green-200/80'}`}>
                  {qualityIssues.length ? `${qualityIssues.length} sak${qualityIssues.length === 1 ? '' : 'er'} att titta på` : 'Allt ser klart ut för export.'}
                </p>
              )}
            </section>
            
            <div className="flex flex-col gap-1 px-4 text-center">
               <div className="text-sm font-black italic uppercase tracking-tighter bg-[linear-gradient(90deg,white_48%,#ec4899_50%,white_52%)] bg-clip-text text-transparent animate-shimmer">Professional Audio Seamless</div>
               <div className="text-xs font-bold uppercase tracking-[0.3em] bg-[linear-gradient(90deg,white_48%,#06b6d4_50%,white_52%)] bg-clip-text text-transparent animate-shimmer-reverse">Created by nRn World</div>
               <div className="text-[10px] font-medium uppercase tracking-widest bg-[linear-gradient(90deg,white_48%,#ec4899_50%,white_52%)] bg-clip-text text-transparent animate-shimmer">Copyright (c) 2026 NoBreak Audio Builder</div>
            </div>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {(playingId === 'full-mix' || isPreviewing) && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 h-24 bg-brand-panel border-t border-[#ec4899]/20 z-[90] px-8 flex items-center gap-8"
          >
             <div className="flex flex-col items-center">
                <button 
                  onClick={stopPlayback}
                  className="w-12 h-12 rounded-full bg-[#ec4899] text-white flex items-center justify-center hover:scale-105 transition-transform shadow-[0_0_20px_rgba(236,72,153,0.4)]"
                >
                  <Pause fill="currentColor" />
                </button>
             </div>
             
             <div className="flex-1 flex flex-col gap-2">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                   <div className="flex items-center gap-2">
                      <Waves size={12} className="text-[#ec4899]" />
                      <span>{isPreviewing && !previewBuffer ? 'Rendering Master...' : 'Mix Preview'}</span>
                   </div>
                   <div className="font-mono">
                      <span className="text-[#ec4899]">{formatTime(currentTime)}</span>
                      <span className="mx-1">/</span>
                      <span>{formatTime(previewBuffer?.duration || totalDuration)}</span>
                   </div>
                </div>
                
                <div className="relative h-10 w-full flex items-center group">
                   {previewBuffer ? (
                      <div className="absolute inset-0 flex flex-col justify-center">
                         <WaveformCanvas 
                           buffer={previewBuffer}
                           color="#ec4899"
                           currentTime={currentTime}
                           duration={previewBuffer.duration}
                           onSeek={(t) => handleSeekPreview(previewBuffer, t)}
                         />
                      </div>
                   ) : (
                      <div className="absolute inset-0 h-1.5 my-auto bg-white/5 rounded-full overflow-hidden">
                         <div 
                           className="h-full bg-[#ec4899] shadow-[0_0_15px_rgba(236,72,153,0.5)]"
                           style={{ width: `${((currentTime || 0) / (totalDuration || 1)) * 100}%` }}
                         />
                      </div>
                   )}
                   
                   {/* Track Markers */}
                   <div className="absolute inset-0 h-1.5 my-auto pointer-events-none">
                      {projectTimeline.entries.filter(entry => entry.kind === 'sequence' && entry.start > 0).map(entry => {
                         const x = (entry.start / (previewBuffer?.duration || totalDuration || 1)) * 100;
                         return (
                            <div
                              key={entry.track.id}
                              title={entry.track.chapterTitle || entry.track.name}
                              className="absolute h-4 w-px bg-white/40 top-1/2 -translate-y-1/2 z-10"
                              style={{ left: `${x}%` }}
                            />
                         );
                      })}
                      {projectTimeline.entries.filter(entry => entry.kind === 'overlay').map(entry => {
                        const x = (entry.start / (previewBuffer?.duration || totalDuration || 1)) * 100;
                        return <div key={entry.track.id} className="absolute h-2 w-2 rounded-full bg-cyan-300 top-1/2 -translate-y-1/2 z-10" style={{ left: `${x}%` }} title={`Röst: ${entry.track.name}`} />;
                      })}
                   </div>

                   <input 
                      type="range" 
                      min="0" 
                      max={previewBuffer?.duration || totalDuration || 1} 
                      step="0.1" 
                      value={currentTime}
                      onChange={(e) => seekPreview(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                   />
                </div>
             </div>
             
             <div className="flex flex-col items-end min-w-[200px]">
                <span className="text-[10px] text-white/40 uppercase font-bold">Now Playing</span>
                <span className="text-sm font-black italic truncate max-w-[200px]">
                   {projectTimeline.entries
                     .filter(entry => entry.kind === 'overlay' && currentTime >= entry.start && currentTime < entry.end)
                     .map(entry => `Röst: ${entry.track.name}`)[0]
                     || projectTimeline.entries
                       .filter(entry => entry.kind === 'sequence')
                       .find(entry => currentTime >= entry.start && currentTime < entry.end)?.track.name
                     || tracks[tracks.length - 1]?.name
                     || 'Mix Output'}
                </span>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quality check and version history */}
      <AnimatePresence>
        {showQualityModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onMouseDown={() => setShowQualityModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              onMouseDown={event => event.stopPropagation()}
              className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#12141C] shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-white/5 p-6">
                <div className="flex gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${qualityIssues.some(issue => issue.severity === 'error') ? 'bg-red-400/10 text-red-300' : qualityIssues.length ? 'bg-amber-400/10 text-amber-200' : 'bg-green-400/10 text-green-300'}`}>
                    {qualityIssues.length ? <AlertTriangle size={19} /> : <CheckCircle2 size={19} />}
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Kontroll före export</h3>
                    <p className="mt-1 text-xs text-white/45">
                      {qualityIssues.length ? 'Gå gärna igenom punkterna innan du sparar den färdiga filen.' : 'Allt ser bra ut. Mixen är klar att exportera.'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowQualityModal(false)} className="rounded p-1 text-white/35 hover:bg-white/5 hover:text-white" aria-label="Stäng kontrollen"><X size={18} /></button>
              </div>
              <div className="max-h-[50vh] space-y-2 overflow-y-auto p-6">
                {qualityIssues.length ? qualityIssues.map(issue => (
                  <div key={issue.id} className={`rounded-xl border p-3 ${issue.severity === 'error' ? 'border-red-400/20 bg-red-400/[0.06]' : 'border-amber-400/15 bg-amber-400/[0.04]'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${issue.severity === 'error' ? 'bg-red-400/15 text-red-200' : 'bg-amber-400/15 text-amber-100'}`}>{issue.severity === 'error' ? 'Viktigt' : 'Tips'}</span>
                      <h4 className="text-xs font-bold text-white">{issue.title}</h4>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/50">{issue.detail}</p>
                  </div>
                )) : (
                  <div className="rounded-xl border border-green-400/15 bg-green-400/[0.04] p-5 text-center">
                    <CheckCircle2 className="mx-auto mb-2 text-green-300" size={22} />
                    <p className="text-xs font-semibold text-green-100">Inga tydliga problem hittades.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-white/5 p-5 sm:flex-row sm:justify-end">
                <button onClick={() => setShowQualityModal(false)} className="rounded-lg bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white/65 hover:bg-white/10">Tillbaka till mixen</button>
                <button
                  onClick={() => { setShowQualityModal(false); void handleExport(true); }}
                  disabled={qualityIssues.some(issue => issue.severity === 'error')}
                  className="rounded-lg bg-[#06b6d4] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/25"
                >
                  {qualityIssues.some(issue => issue.severity === 'error') ? 'Åtgärda viktiga punkter' : qualityIssues.length ? 'Exportera ändå' : 'Exportera nu'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onMouseDown={() => setShowHistory(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              onMouseDown={event => event.stopPropagation()}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#12141C] shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-white/5 p-6">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#a855f7]/10 text-[#d8b4fe]"><History size={19} /></div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Tidigare versioner</h3>
                    <p className="mt-1 text-xs text-white/45">Spara ett läge före större ändringar och gå tillbaka när du vill.</p>
                  </div>
                </div>
                <button onClick={() => setShowHistory(false)} className="rounded p-1 text-white/35 hover:bg-white/5 hover:text-white" aria-label="Stäng versionshistoriken"><X size={18} /></button>
              </div>
              <div className="max-h-[50vh] overflow-y-auto p-5">
                <button
                  onClick={() => captureSnapshot('Manuell version')}
                  disabled={!tracks.length}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#a855f7]/30 bg-[#a855f7]/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#e9d5ff] hover:bg-[#a855f7]/20 disabled:opacity-30"
                >
                  <Save size={14} /> Spara aktuell version
                </button>
                {snapshots.length ? <div className="space-y-2">
                  {snapshots.map(snapshot => (
                    <div key={snapshot.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-white">{snapshot.label}</p>
                        <p className="mt-1 text-[9px] text-white/35">{new Date(snapshot.createdAt).toLocaleString('sv-SE')} · {snapshot.tracks.length} spår</p>
                      </div>
                      <button
                        onClick={() => restoreSnapshot(snapshot.id)}
                        className="shrink-0 rounded-lg bg-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/75 hover:bg-white/10 flex items-center gap-1"
                      >
                        <RotateCcw size={12} /> Återställ
                      </button>
                    </div>
                  ))}
                </div> : <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-white/35">Inga sparade versioner ännu.</p>}
              </div>
              <p className="border-t border-white/5 px-6 py-4 text-[9px] leading-relaxed text-white/35">Versionerna behåller dina uppladdade filer under den här öppna arbetsstunden. Inställningarna sparas också lokalt för nästa gång.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Render Toast */}
      <AnimatePresence>
        {isRendering && !isRenderingMinimized && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 w-full max-w-sm px-6 z-[100]"
          >
            <div className="bg-brand-panel border border-[#ec4899]/30 p-8 rounded-2xl shadow-2xl shadow-[#ec4899]/20 relative">
               <button 
                 onClick={() => setIsRenderingMinimized(true)}
                 className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
               >
                 <span className="text-[9px] border border-white/20 px-2 py-1 rounded font-black uppercase tracking-widest">Background</span>
               </button>
               <div className="flex items-center gap-4 mb-6 mt-2">
                 <div className="w-12 h-12 bg-[#ec4899]/10 rounded flex items-center justify-center text-[#ec4899]">
                   <Waves className="animate-pulse" />
                 </div>
                 <div>
                   <h4 className="text-sm font-black uppercase tracking-tighter">
                     {globalSettings.format === 'mp4' ? 'Baking Video Mix' : 'Baking Audio Master'}
                   </h4>
                   <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">
                      {renderProgress > 0 ? `Encoding: ${renderProgress}%` : 'Mixing Audio Channels...'}
                   </p>
                 </div>
               </div>
               <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                 <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: renderProgress > 0 ? `${renderProgress}%` : '95%' }}
                    transition={{ duration: renderProgress > 0 ? 0.2 : 10, ease: renderProgress > 0 ? "easeOut" : "linear" }}
                    className="h-full bg-gradient-to-r from-[#ec4899] to-[#a855f7] shadow-[0_0_15px_rgba(236,72,153,0.5)]"
                 />
               </div>
            </div>
          </motion.div>
        )}
        {isRendering && isRenderingMinimized && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed bottom-12 right-12 z-[100]"
          >
             <button
               onClick={() => setIsRenderingMinimized(false)} 
               className="bg-[#111111] border border-[#a855f7] text-[#a855f7] px-4 py-2 rounded shadow-2xl flex items-center gap-3 hover:bg-[#a855f7]/10 transition-colors"
             >
                <div className="w-2 h-2 rounded-full bg-[#a855f7] animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest">
                  {renderProgress > 0 ? `${renderProgress}%` : 'Exporting...'}
                </span>
             </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Auto-Update Notification Banner ─────────────────────────────── */}
      <AnimatePresence>
        {showUpdateBanner && updateState !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: 80, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 80, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[200] w-80"
          >
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f10]/95 backdrop-blur-xl shadow-2xl">
              {/* Glow border */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#a855f7]/20 via-transparent to-[#06b6d4]/20 pointer-events-none" />

              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[#a855f7]/15">
                      {updateState === 'ready' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" style={{ animationDuration: '2s' }}>
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-white">
                        {updateState === 'ready' ? 'Uppdatering Klar!' : 'Laddar Ned Uppdatering'}
                      </p>
                      <p className="text-[10px] text-white/40 mt-0.5">
                        {updateState === 'ready'
                          ? `v${updateReadyVersion} är redo att installeras`
                          : `v${updateAvailableVersion} laddar ned i bakgrunden...`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUpdateBanner(false)}
                    className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 mt-0.5"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Download progress bar (only while downloading) */}
                {updateState === 'downloading' && (
                  <div className="mb-4">
                    <div className="flex justify-between text-[10px] text-white/40 mb-1.5">
                      <span className="uppercase tracking-widest">Laddar ned</span>
                      <span className="font-mono">{updateDownloadProgress}%</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        animate={{ width: `${updateDownloadProgress}%` }}
                        transition={{ duration: 0.3 }}
                        className="h-full bg-gradient-to-r from-[#a855f7] to-[#06b6d4] rounded-full"
                      />
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                {updateState === 'ready' && (
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => {
                        const { ipcRenderer } = (window as any).require('electron');
                        ipcRenderer.send('restart-and-install');
                      }}
                      className="flex-1 py-2 rounded-lg bg-[#a855f7] hover:bg-[#a855f7]/90 text-white text-[10px] font-black uppercase tracking-widest transition-colors shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                    >
                      Starta Om & Installera
                    </button>
                    <button
                      onClick={() => setShowUpdateBanner(false)}
                      className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                      Senare
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
