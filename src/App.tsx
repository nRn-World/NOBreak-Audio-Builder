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
  VideoOff
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { TrackSettings, GlobalSettings, ExportFormat, VisualAsset } from './types';
import { decodeAudioFile, renderMix, encodeWAV, encodeMP3, calculateNormalization, renderVideo } from './utils/audio';

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
  onLoopRegionChange
}: { 
  buffer: AudioBuffer, 
  color: string,
  currentTime?: number,
  duration?: number,
  onSeek?: (time: number) => void,
  loopRegion?: { start: number, end: number },
  onLoopRegionChange?: (region: { start: number, end: number } | undefined) => void
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
  }, [buffer, color, currentTime, duration, dragRatio, loopDragStartRatio, loopDragCurrentRatio, loopRegion]);

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
        endTrim: t.endTrim
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

  // ── Auto-Updater state ────────────────────────────────────────────────────
  const [updateAvailableVersion, setUpdateAvailableVersion] = useState<string | null>(null);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number>(0);
  const [updateReadyVersion, setUpdateReadyVersion] = useState<string | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [updateState, setUpdateState] = useState<'idle' | 'available' | 'downloading' | 'ready'>('idle');

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const progressIntervalRef = useRef<number | null>(null);

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
            let currentElapsed = elapsed;
            
            if (t?.loopRegion && t.loopRegion.end > t.loopRegion.start) {
              if (elapsed >= t.loopRegion.start) {
                const loopLength = t.loopRegion.end - t.loopRegion.start;
                if (loopLength > 0) {
                  currentElapsed = t.loopRegion.start + ((elapsed - t.loopRegion.start) % loopLength);
                }
              }
              setCurrentTime(currentElapsed);
            } else {
              if (elapsed >= duration) {
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
      bytesPerSec = 40000; // 320kbps
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

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const newTracks: TrackSettings[] = [];
    const fileArray = Array.from(files);
    
    // Get the base index for color generation to ensure uniqueness relative to existing tracks
    const baseIndex = tracks.length;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      // Audio files
      if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav')) {
        const id = Math.random().toString(36).substring(7);
        
        // Generate a unique color using Golden Angle distribution in HSL space
        const hue = ((baseIndex + i) * 137.508) % 360;
        const trackColor = `hsl(${hue}, 75%, 65%)`;

        const track: TrackSettings = {
          id,
          name: file.name,
          file,
          buffer: null,
          volume: 1.0,
          fadeIn: 0.5,
          fadeOut: 0.5,
          color: trackColor
        };
        newTracks.push(track);
        
        decodeAudioFile(file).then(buffer => {
          setTracks(prev => prev.map(t => t.id === id ? { 
            ...t, 
            buffer,
            volume: globalSettings.normalize ? calculateNormalization(buffer) : 1.0
          } : t));
        }).catch(err => {
          console.error(`Failed to decode ${file.name}:`, err);
        });
      } 
      // Visual files (if dropped on main area)
      else if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
         handleVisualUpload(file);
      }
    }
    setTracks(prev => [...prev, ...newTracks]);
  }, [globalSettings.normalize, tracks.length]);

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
    startTimeRef.current = audioCtx.currentTime - offset;
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

  const previewMix = async () => {
    if (playingId === 'full-mix') {
      if (isPlaying) {
        pausePlayback();
      } else {
        if (previewBuffer) {
           startPreviewAt(previewBuffer, currentTime);
        } else {
           // Shouldn't happen if paused
        }
      }
      return;
    }

    stopPlayback();
    setIsPreviewing(true);
    
    try {
      const buffer = await renderMix(tracks, globalSettings);
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

  const handleExport = async () => {
    if (tracks.length === 0) return;
    setIsRendering(true);
    setIsRenderingMinimized(false);
    setRenderProgress(0);
    
    try {
      console.log('Starting audio render...');
      const resultBuffer = await renderMix(tracks, globalSettings);
      
      let blob: Blob;
      if (globalSettings.format === 'mp4' && globalSettings.visualAssets.length > 0) {
        console.log('Starting video render...');
        blob = await renderVideo(resultBuffer, globalSettings.visualAssets, (p) => setRenderProgress(p));
      } else {
        console.log('Encoding audio...');
        if (globalSettings.format === 'wav') {
          blob = encodeWAV(resultBuffer, globalSettings.bitDepth || 16);
        } else {
          blob = await encodeMP3(resultBuffer, (p) => setRenderProgress(p));
        }
      }
      
      console.log('Export complete, triggering download...');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `NoBreak_Project_${new Date().getTime()}.${globalSettings.format === 'mp4' ? 'mp4' : globalSettings.format}`;
      
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

  const totalDuration = (() => {
    if (tracks.length === 0) return 0;
    let dur = 0;
    tracks.forEach((t, i) => {
      const trackDur = t.buffer?.duration || 0;
      if (i === 0) dur = trackDur;
      else dur = (dur - globalSettings.crossfadeDuration) + trackDur;
    });
    return Math.max(dur, 0);
  })();

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
              <span className="text-lg font-bold">{globalSettings.format === 'wav' ? `${globalSettings.bitDepth || 16}-BIT` : 'MAX'}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Timeline Column */}
          <div className="lg:col-span-3 space-y-6">
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
                              {track.buffer ? `${(track.buffer.duration - (track.startTrim || 0) - (track.endTrim || 0)).toFixed(1)}s` : '...'}
                            </span>
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
                    </div>

                    {/* Waveform Row */}
                    <div className="w-full bg-black/20 border-t border-white/5 pointer-events-auto h-12 relative flex flex-col">
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
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-r from-[#ec4899]/10 to-transparent pointer-events-none" />
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

              {/* Crossfade */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Crossfade Length</label>
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
                <p className="text-[9px] font-bold italic text-white/20 uppercase">Smooth transition between all sources</p>
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
                      {tracks.map((t, idx) => {
                         if (idx === 0) return null;
                         
                         let acc = 0;
                         for(let j=0; j<idx; j++) {
                            const dur = tracks[j].buffer?.duration || 0;
                            const start = j === 0 ? 0 : acc - globalSettings.crossfadeDuration;
                            acc = start + dur;
                         }
                         const trackStartTime = acc - globalSettings.crossfadeDuration;
                         
                         const x = (trackStartTime / (previewBuffer?.duration || totalDuration || 1)) * 100;
                         return (
                            <div 
                              key={t.id} 
                              className="absolute h-4 w-px bg-white/40 top-1/2 -translate-y-1/2 z-10" 
                              style={{ left: `${x}%` }}
                            />
                         );
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
                   {(() => {
                      let acc = 0;
                      for (let i = 0; i < tracks.length; i++) {
                        const dur = tracks[i].buffer?.duration || 0;
                        const start = i === 0 ? 0 : acc - globalSettings.crossfadeDuration;
                        const end = start + dur;
                        if (currentTime >= start && currentTime < end) {
                           return tracks[i].name;
                        }
                        acc = end;
                      }
                      return tracks[tracks.length-1]?.name || "Mix Output";
                   })()}
                </span>
             </div>
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
