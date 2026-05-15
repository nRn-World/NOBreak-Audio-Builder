export type ExportFormat = 'mp3' | 'wav' | 'mp4';
export type BitDepth = 16 | 24 | 32;

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
  startTrim?: number; // seconds
  endTrim?: number; // seconds
  loopRegion?: { start: number, end: number };
  color?: string; // hex color for different tracks
}

export interface GlobalSettings {
  format: ExportFormat;
  bitDepth?: BitDepth;
  crossfadeDuration: number; // seconds
  normalize: boolean;
  visualAssets: VisualAsset[];
  accentColor?: string;
}
