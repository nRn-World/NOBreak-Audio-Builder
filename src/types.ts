export type ExportFormat = 'mp3' | 'wav' | 'mp4';
export type BitDepth = 16 | 24 | 32;
export type ExportPreset = 'share' | 'podcast' | 'master';
export type TrackRole = 'music' | 'voice';
export type TrackPlacement = 'sequence' | 'overlay';

export interface VisualAsset {
  file: File;
  type: 'image' | 'video';
  url: string;
}

export interface TrackSettings {
  id: string;
  name: string;
  file: File;
  buffer: AudioBuffer | null;
  volume: number; // 0.0 to 2.0
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  bass?: number; // -10 to 10 dB
  treble?: number; // -10 to 10 dB
  startTrim?: number; // seconds in the original file
  endTrim?: number; // seconds in the original file
  loopRegion?: { start: number; end: number };
  color?: string; // hex/hsl color for different tracks

  // Smart mix helpers
  detectedBpm?: number;
  tempoRatio?: number; // Playback speed used when tempo matching is enabled
  beatMarkers?: number[]; // Seconds in the original file, used by the waveform grid
  transitionDuration?: number; // Crossfade from this track into the next one

  // Voiceover and chapters
  role?: TrackRole;
  placement?: TrackPlacement;
  overlayStart?: number; // Project time for a voiceover placed over the music
  chapterTitle?: string;
  includeInChapters?: boolean;
}

export interface GlobalSettings {
  format: ExportFormat;
  bitDepth?: BitDepth;
  crossfadeDuration: number; // seconds
  normalize: boolean;
  visualAssets: VisualAsset[];
  accentColor?: string;

  // Smart mix controls
  tempoSync?: boolean;
  tempoTarget?: number;
  autoDuck?: boolean;
  duckAmount?: number; // dB to lower music while a voiceover is active

  // Export controls
  exportPreset?: ExportPreset;
  mp3Bitrate?: 128 | 192 | 320;
  exportName?: string;
}

export interface TransitionSuggestion {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  suggestedEndTrim: number;
  suggestedStartTrim: number;
  suggestedCrossfade: number;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

export interface QualityIssue {
  id: string;
  severity: 'warning' | 'error';
  title: string;
  detail: string;
  trackId?: string;
}

export interface TimelineEntry {
  track: TrackSettings;
  start: number;
  end: number;
  duration: number;
  kind: TrackPlacement;
  previousTransition?: number;
  nextTransition?: number;
}

export interface ProjectTimeline {
  entries: TimelineEntry[];
  totalDuration: number;
}

export interface ProjectSnapshot {
  id: string;
  label: string;
  createdAt: number;
  tracks: TrackSettings[];
  globalSettings: GlobalSettings;
}
