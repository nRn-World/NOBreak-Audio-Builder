import {
  GlobalSettings,
  ProjectTimeline,
  QualityIssue,
  TimelineEntry,
  TrackSettings,
  TransitionSuggestion,
  VisualAsset,
} from '../types';
import * as MP4Muxer from 'mp4-muxer';
import * as lamejs from 'lamejs';

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const dbToGain = (db: number) => Math.pow(10, -Math.abs(db) / 20);

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

/**
 * The source duration is measured in the original audio file. The playback
 * duration can be different when tempo matching is active.
 */
export function getTrackSourceDuration(track: TrackSettings): number {
  if (!track.buffer) return 0;
  const startTrim = clamp(track.startTrim || 0, 0, Math.max(0, track.buffer.duration - 0.05));
  const endTrim = clamp(track.endTrim || 0, 0, Math.max(0, track.buffer.duration - startTrim - 0.05));
  return Math.max(0.05, track.buffer.duration - startTrim - endTrim);
}

export function getTrackPlaybackRate(track: TrackSettings): number {
  const ratio = track.tempoRatio || 1;
  return Number.isFinite(ratio) ? clamp(ratio, 0.7, 1.3) : 1;
}

export function getTrackPlaybackDuration(track: TrackSettings): number {
  return getTrackSourceDuration(track) / getTrackPlaybackRate(track);
}

export function getTransitionDuration(
  from: TrackSettings,
  to: TrackSettings,
  settings: GlobalSettings,
): number {
  const requested = from.transitionDuration ?? settings.crossfadeDuration;
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const safeMaximum = Math.min(getTrackPlaybackDuration(from), getTrackPlaybackDuration(to)) * 0.45;
  return clamp(requested, 0, safeMaximum);
}

/** Returns the shared project clock used by preview, chapters and export. */
export function getProjectTimeline(
  tracks: TrackSettings[],
  settings: GlobalSettings,
): ProjectTimeline {
  const validTracks = tracks.filter(track => track.buffer);
  const sequential = validTracks.filter(track => track.placement !== 'overlay');
  const overlays = validTracks.filter(track => track.placement === 'overlay');
  const transitions = sequential.map((track, index) => (
    index < sequential.length - 1
      ? getTransitionDuration(track, sequential[index + 1], settings)
      : 0
  ));

  const entries: TimelineEntry[] = [];
  let cursor = 0;

  sequential.forEach((track, index) => {
    const duration = getTrackPlaybackDuration(track);
    const previousTransition = index === 0 ? 0 : transitions[index - 1];
    const start = index === 0 ? 0 : Math.max(0, cursor - previousTransition);
    const end = start + duration;
    entries.push({
      track,
      start,
      end,
      duration,
      kind: 'sequence',
      previousTransition,
      nextTransition: transitions[index],
    });
    cursor = end;
  });

  let totalDuration = cursor;
  overlays.forEach(track => {
    const duration = getTrackPlaybackDuration(track);
    const start = Math.max(0, track.overlayStart || 0);
    const end = start + duration;
    entries.push({
      track,
      start,
      end,
      duration,
      kind: 'overlay',
      previousTransition: 0,
      nextTransition: 0,
    });
    totalDuration = Math.max(totalDuration, end);
  });

  return { entries, totalDuration: Math.max(0, totalDuration) };
}

interface EnergyWindow {
  time: number;
  energy: number;
}

function getEnergyWindows(
  buffer: AudioBuffer,
  startSeconds = 0,
  endSeconds = buffer.duration,
  windowSeconds = 0.04,
  maxWindows = 7000,
): EnergyWindow[] {
  const start = clamp(startSeconds, 0, buffer.duration);
  const end = clamp(endSeconds, start, buffer.duration);
  const requestedWindow = Math.max(0.01, windowSeconds);
  const expectedWindows = Math.ceil((end - start) / requestedWindow);
  const actualWindow = expectedWindows > maxWindows
    ? (end - start) / maxWindows
    : requestedWindow;
  const windowSamples = Math.max(1, Math.floor(actualWindow * buffer.sampleRate));
  const data = buffer.getChannelData(0);
  const first = Math.floor(start * buffer.sampleRate);
  const last = Math.floor(end * buffer.sampleRate);
  const values: EnergyWindow[] = [];

  for (let sampleStart = first; sampleStart < last; sampleStart += windowSamples) {
    const sampleEnd = Math.min(sampleStart + windowSamples, last);
    // Sample at most roughly 250 values per visual/analysis window. It keeps
    // long source files responsive without changing the musical trend.
    const stride = Math.max(1, Math.floor((sampleEnd - sampleStart) / 250));
    let sum = 0;
    let count = 0;
    for (let index = sampleStart; index < sampleEnd; index += stride) {
      const value = data[index] || 0;
      sum += value * value;
      count++;
    }
    values.push({
      time: sampleStart / buffer.sampleRate,
      energy: count ? Math.sqrt(sum / count) : 0,
    });
  }

  return values;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[index];
}

/**
 * A light-weight beat estimate. It intentionally favours dependable values in
 * the normal dance/pop range rather than pretending to be a studio analyser.
 */
export function estimateTempo(buffer: AudioBuffer): number | undefined {
  if (buffer.duration < 3) return undefined;
  const end = Math.min(buffer.duration, 120);
  const windows = getEnergyWindows(buffer, 0, end, 0.02, 6000);
  if (windows.length < 100) return undefined;

  const envelope = windows.map(item => item.energy);
  const onsets = envelope.map((value, index) => Math.max(0, value - (envelope[index - 1] || value)));
  const onsetEnergy = onsets.reduce((sum, value) => sum + value, 0);
  if (onsetEnergy < 0.002) return undefined;

  const samplesPerSecond = windows.length / Math.max(end, 0.01);
  let bestBpm = 0;
  let bestScore = -Infinity;

  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = Math.max(1, Math.round((60 / bpm) * samplesPerSecond));
    let score = 0;
    for (let index = lag; index < onsets.length; index++) {
      score += onsets[index] * onsets[index - lag];
    }
    // Prefer the lowest useful harmonic when the score is virtually tied.
    const adjustedScore = score / Math.sqrt(lag);
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestBpm = bpm;
    }
  }

  if (!bestBpm || !Number.isFinite(bestScore)) return undefined;
  return Math.round(bestBpm);
}

/** Creates a helpful beat grid for the waveform; it is not used to alter audio. */
export function createBeatMarkers(buffer: AudioBuffer, bpm?: number): number[] {
  if (!bpm || bpm < 40 || bpm > 240 || buffer.duration <= 0) return [];
  const windows = getEnergyWindows(buffer, 0, Math.min(buffer.duration, 20), 0.02, 1000);
  const energies = windows.map(item => item.energy);
  const threshold = percentile(energies, 0.78);
  const firstStrongWindow = windows.find(item => item.energy >= threshold && item.time > 0.04);
  const beatLength = 60 / bpm;
  const offset = firstStrongWindow ? firstStrongWindow.time % beatLength : 0;
  const markers: number[] = [];
  for (let time = offset; time < buffer.duration && markers.length < 400; time += beatLength) {
    markers.push(Number(time.toFixed(3)));
  }
  return markers;
}

export interface AudioStats {
  peak: number;
  leadingSilence: number;
  trailingSilence: number;
  averageEnergy: number;
}

export function getAudioStats(buffer: AudioBuffer): AudioStats {
  const windows = getEnergyWindows(buffer, 0, buffer.duration, 0.03, 7500);
  const energies = windows.map(item => item.energy);
  const maxEnergy = Math.max(...energies, 0);
  const threshold = Math.max(0.003, maxEnergy * 0.07);
  const firstAudible = windows.find(item => item.energy >= threshold);
  const lastAudibleIndex = [...windows].reverse().findIndex(item => item.energy >= threshold);
  const lastAudible = lastAudibleIndex === -1 ? undefined : windows[windows.length - 1 - lastAudibleIndex];

  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    const stride = Math.max(1, Math.floor(data.length / 1_500_000));
    for (let index = 0; index < data.length; index += stride) {
      peak = Math.max(peak, Math.abs(data[index] || 0));
    }
  }

  return {
    peak,
    leadingSilence: firstAudible ? firstAudible.time : buffer.duration,
    trailingSilence: lastAudible ? Math.max(0, buffer.duration - lastAudible.time - 0.03) : buffer.duration,
    averageEnergy: energies.length
      ? energies.reduce((sum, value) => sum + value, 0) / energies.length
      : 0,
  };
}

function findExitSuggestion(track: TrackSettings): { trim: number; energy: number } {
  const buffer = track.buffer!;
  const start = clamp(track.startTrim || 0, 0, buffer.duration);
  const end = clamp(buffer.duration - (track.endTrim || 0), start + 0.05, buffer.duration);
  const duration = end - start;
  const searchStart = Math.max(start + duration * 0.55, end - Math.min(18, duration * 0.35));
  const searchEnd = Math.max(searchStart + 0.05, end - 0.25);
  const windows = getEnergyWindows(buffer, searchStart, searchEnd, 0.35, 120);
  if (!windows.length) return { trim: track.endTrim || 0, energy: 0 };

  const average = windows.reduce((sum, item) => sum + item.energy, 0) / windows.length || 1;
  let winner = windows[windows.length - 1];
  let bestScore = Infinity;
  for (const window of windows) {
    // A small distance cost avoids cutting a long, surprising section off a song.
    const distanceFromEnd = (end - window.time) / Math.max(1, end - searchStart);
    const score = (window.energy / average) + distanceFromEnd * 0.28;
    if (score < bestScore) {
      bestScore = score;
      winner = window;
    }
  }

  const desiredExit = clamp(winner.time + 0.18, start + 0.2, end - 0.12);
  return { trim: Number(Math.max(0, buffer.duration - desiredExit).toFixed(2)), energy: winner.energy };
}

function findEntrySuggestion(track: TrackSettings): { trim: number; energy: number } {
  const buffer = track.buffer!;
  const start = clamp(track.startTrim || 0, 0, buffer.duration);
  const end = clamp(buffer.duration - (track.endTrim || 0), start + 0.05, buffer.duration);
  const searchEnd = Math.min(end - 0.2, start + Math.min(12, (end - start) * 0.3));
  const windows = getEnergyWindows(buffer, start, searchEnd, 0.18, 120);
  if (!windows.length) return { trim: track.startTrim || 0, energy: 0 };

  const energies = windows.map(item => item.energy);
  const silenceThreshold = Math.max(0.004, percentile(energies, 0.35));
  const firstAudible = windows.find(item => item.energy >= silenceThreshold && item.time > start + 0.04);
  if (!firstAudible) return { trim: track.startTrim || 0, energy: 0 };

  // Only remove a clearly quiet lead-in. Musical intros are kept intact.
  const suggestedStart = firstAudible.time - start > 0.45
    ? Math.min(firstAudible.time, start + 8)
    : start;
  return { trim: Number(suggestedStart.toFixed(2)), energy: firstAudible.energy };
}

export function suggestProjectTransitions(
  tracks: TrackSettings[],
  settings: GlobalSettings,
): TransitionSuggestion[] {
  const sequence = tracks.filter(track => track.placement !== 'overlay' && track.buffer);
  const suggestions: TransitionSuggestion[] = [];

  for (let index = 0; index < sequence.length - 1; index++) {
    const from = sequence[index];
    const to = sequence[index + 1];
    const exit = findExitSuggestion(from);
    const entry = findEntrySuggestion(to);
    const outgoingDuration = Math.max(0.1, (from.buffer!.duration - (from.startTrim || 0) - exit.trim) / getTrackPlaybackRate(from));
    const incomingDuration = Math.max(0.1, (to.buffer!.duration - entry.trim - (to.endTrim || 0)) / getTrackPlaybackRate(to));
    const bpmDifference = from.detectedBpm && to.detectedBpm
      ? Math.abs(from.detectedBpm - to.detectedBpm)
      : undefined;
    const base = bpmDifference === undefined ? settings.crossfadeDuration : bpmDifference <= 3 ? 4 : bpmDifference <= 8 ? 3 : 2;
    const suggestedCrossfade = Number(clamp(base, 0.5, Math.min(6, outgoingDuration * 0.42, incomingDuration * 0.42)).toFixed(1));
    const confidence: TransitionSuggestion['confidence'] = bpmDifference === undefined
      ? 'medium'
      : bpmDifference <= 6 ? 'high' : 'low';
    const note = bpmDifference === undefined
      ? 'Hittade en lugn övergångspunkt och tar bort en tyst inledning om den finns.'
      : bpmDifference <= 6
        ? 'Liknande tempo – en längre, mjuk övergång bör fungera väl.'
        : 'Olika tempo – en kortare övergång håller bytet tydligt.';

    suggestions.push({
      id: `${from.id}-${to.id}`,
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      suggestedEndTrim: exit.trim,
      suggestedStartTrim: entry.trim,
      suggestedCrossfade,
      confidence,
      note,
    });
  }

  return suggestions;
}

export function inspectProjectQuality(
  tracks: TrackSettings[],
  settings: GlobalSettings,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const timeline = getProjectTimeline(tracks, settings);
  const sequence = timeline.entries.filter(entry => entry.kind === 'sequence');

  if (!tracks.length) {
    return [{
      id: 'no-tracks',
      severity: 'error',
      title: 'Inga ljudfiler',
      detail: 'Lägg till minst en ljudfil innan du exporterar.',
    }];
  }

  tracks.forEach(track => {
    if (!track.buffer) {
      issues.push({
        id: `missing-${track.id}`,
        severity: 'error',
        title: `${track.name} är inte redo`,
        detail: 'Filen kunde inte läsas in ännu. Vänta en stund eller lägg till den igen.',
        trackId: track.id,
      });
      return;
    }

    const sourceDuration = getTrackSourceDuration(track);
    if (sourceDuration < 1) {
      issues.push({
        id: `short-${track.id}`,
        severity: 'warning',
        title: `${track.name} är mycket kort`,
        detail: 'Beskärningen lämnar mindre än en sekund ljud.',
        trackId: track.id,
      });
    }

    const stats = getAudioStats(track.buffer);
    if ((track.startTrim || 0) < 0.1 && stats.leadingSilence > 0.75) {
      issues.push({
        id: `lead-silence-${track.id}`,
        severity: 'warning',
        title: `Tyst start i ${track.name}`,
        detail: `Cirka ${stats.leadingSilence.toFixed(1)} sekunder kan beskäras eller lämnas medvetet.`,
        trackId: track.id,
      });
    }
    if ((track.endTrim || 0) < 0.1 && stats.trailingSilence > 0.75) {
      issues.push({
        id: `tail-silence-${track.id}`,
        severity: 'warning',
        title: `Tyst slut i ${track.name}`,
        detail: `Cirka ${stats.trailingSilence.toFixed(1)} sekunder kan göra nästa övergång långsam.`,
        trackId: track.id,
      });
    }
    if (stats.peak * track.volume >= 0.995 && !settings.normalize) {
      issues.push({
        id: `peak-${track.id}`,
        severity: 'warning',
        title: `Hög nivå i ${track.name}`,
        detail: 'Slå på jämn ljudnivå eller sänk spårets nivå för att minska risken för störande ljud.',
        trackId: track.id,
      });
    }
    if (track.role === 'voice' && track.placement === 'overlay' && !settings.autoDuck) {
      issues.push({
        id: `voice-duck-${track.id}`,
        severity: 'warning',
        title: `Berättarröst kan döljas`,
        detail: 'Automatisk sänkning av musiken är avstängd medan rösten ligger ovanpå musiken.',
        trackId: track.id,
      });
    }
  });

  for (let index = 0; index < sequence.length - 1; index++) {
    const current = sequence[index];
    const next = sequence[index + 1];
    const transition = current.nextTransition || 0;
    if (transition > Math.min(current.duration, next.duration) * 0.4) {
      issues.push({
        id: `long-transition-${current.track.id}`,
        severity: 'warning',
        title: `Lång övergång efter ${current.track.name}`,
        detail: 'Överlappningen tar en stor del av ett kort spår och kan låta onaturlig.',
        trackId: current.track.id,
      });
    }
    const firstBpm = current.track.detectedBpm;
    const secondBpm = next.track.detectedBpm;
    if (!settings.tempoSync && firstBpm && secondBpm && Math.abs(firstBpm - secondBpm) > 8) {
      issues.push({
        id: `tempo-${current.track.id}-${next.track.id}`,
        severity: 'warning',
        title: 'Tempon skiljer sig',
        detail: `${current.track.name} (${firstBpm} BPM) och ${next.track.name} (${secondBpm} BPM) kan behöva tempomatchning eller en kortare övergång.`,
        trackId: current.track.id,
      });
    }
  }

  if (!timeline.totalDuration) {
    issues.push({
      id: 'empty-timeline',
      severity: 'error',
      title: 'Mixen saknar spelbar längd',
      detail: 'Kontrollera att filerna har lästs in och att beskärningen inte är för stor.',
    });
  }

  return issues;
}

interface TimeRange {
  start: number;
  end: number;
}

function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.18) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function getVoiceActivityRanges(entry: TimelineEntry): TimeRange[] {
  const { track } = entry;
  if (!track.buffer) return [];
  const buffer = track.buffer;
  const trimStart = clamp(track.startTrim || 0, 0, buffer.duration);
  const trimEnd = clamp(buffer.duration - (track.endTrim || 0), trimStart, buffer.duration);
  const windows = getEnergyWindows(buffer, trimStart, trimEnd, 0.035, 5000);
  if (!windows.length) return [];

  const values = windows.map(window => window.energy);
  const noiseFloor = percentile(values, 0.18);
  const speakingLevel = percentile(values, 0.82);
  const threshold = Math.max(0.006, noiseFloor + (speakingLevel - noiseFloor) * 0.22);
  const rate = getTrackPlaybackRate(track);
  const ranges: TimeRange[] = [];
  let activeStart: number | null = null;
  let lastActiveEnd = 0;

  for (const window of windows) {
    const localStart = (window.time - trimStart) / rate;
    const localEnd = localStart + 0.035 / rate;
    if (window.energy >= threshold) {
      if (activeStart === null) activeStart = localStart;
      lastActiveEnd = localEnd;
    } else if (activeStart !== null && localStart - lastActiveEnd > 0.12) {
      if (lastActiveEnd - activeStart >= 0.08) {
        ranges.push({ start: entry.start + activeStart, end: entry.start + lastActiveEnd });
      }
      activeStart = null;
    }
  }

  if (activeStart !== null && lastActiveEnd - activeStart >= 0.08) {
    ranges.push({ start: entry.start + activeStart, end: entry.start + lastActiveEnd });
  }

  return mergeTimeRanges(ranges);
}

function scheduleDucking(gain: GainNode, ranges: TimeRange[], amountDb: number, totalDuration: number) {
  const duckedValue = dbToGain(amountDb);
  const attack = 0.07;
  const release = 0.18;
  gain.gain.setValueAtTime(1, 0);

  for (const range of mergeTimeRanges(ranges)) {
    const start = clamp(range.start, 0, totalDuration);
    const end = clamp(range.end, start, totalDuration);
    if (end <= start) continue;
    gain.gain.setValueAtTime(1, Math.max(0, start - attack));
    gain.gain.linearRampToValueAtTime(duckedValue, start);
    gain.gain.setValueAtTime(duckedValue, end);
    gain.gain.linearRampToValueAtTime(1, Math.min(totalDuration, end + release));
  }
}

export async function renderMix(
  tracks: TrackSettings[],
  globalSettings: GlobalSettings,
  _onProgress?: (progress: number) => void,
): Promise<AudioBuffer> {
  if (tracks.length === 0) throw new Error('Inga spår att mixa');
  const timeline = getProjectTimeline(tracks, globalSettings);
  if (!timeline.entries.length || !timeline.totalDuration) {
    throw new Error('Inga avkodade spår hittades');
  }

  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil((timeline.totalDuration + 0.1) * sampleRate)),
    sampleRate,
  );

  const voiceRanges = globalSettings.autoDuck
    ? mergeTimeRanges(
      timeline.entries
        .filter(entry => entry.track.role === 'voice')
        .flatMap(entry => getVoiceActivityRanges(entry)),
    )
    : [];

  for (const entry of timeline.entries) {
    const { track } = entry;
    const buffer = track.buffer!;
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(getTrackPlaybackRate(track), entry.start);

    let lastNode: AudioNode = source;

    if (track.bass && track.bass !== 0) {
      const bassNode = offlineCtx.createBiquadFilter();
      bassNode.type = 'lowshelf';
      bassNode.frequency.value = 200;
      bassNode.gain.value = track.bass;
      lastNode.connect(bassNode);
      lastNode = bassNode;
    }

    if (track.treble && track.treble !== 0) {
      const trebleNode = offlineCtx.createBiquadFilter();
      trebleNode.type = 'highshelf';
      trebleNode.frequency.value = 3000;
      trebleNode.gain.value = track.treble;
      lastNode.connect(trebleNode);
      lastNode = trebleNode;
    }

    const fadeGain = offlineCtx.createGain();
    const baseGain = clamp(track.volume, 0, 2);
    const fadeIn = Math.min(
      entry.previousTransition || track.fadeIn || 0,
      entry.duration * 0.45,
    );
    const fadeOut = Math.min(
      entry.nextTransition || track.fadeOut || 0,
      entry.duration * 0.45,
    );
    const fadeOutStart = Math.max(entry.start + fadeIn, entry.end - fadeOut);

    fadeGain.gain.setValueAtTime(fadeIn > 0 ? 0 : baseGain, entry.start);
    if (fadeIn > 0) {
      fadeGain.gain.linearRampToValueAtTime(baseGain, entry.start + fadeIn);
    }
    fadeGain.gain.setValueAtTime(baseGain, fadeOutStart);
    if (fadeOut > 0) {
      fadeGain.gain.linearRampToValueAtTime(0, entry.end);
    }

    lastNode.connect(fadeGain);

    if (globalSettings.autoDuck && track.role !== 'voice') {
      const duckGain = offlineCtx.createGain();
      scheduleDucking(duckGain, voiceRanges, globalSettings.duckAmount ?? 12, timeline.totalDuration);
      fadeGain.connect(duckGain);
      duckGain.connect(offlineCtx.destination);
    } else {
      fadeGain.connect(offlineCtx.destination);
    }

    const startTrim = clamp(track.startTrim || 0, 0, buffer.duration);
    source.start(entry.start, startTrim, getTrackSourceDuration(track));
  }

  return await offlineCtx.startRendering();
}

export function encodeWAV(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob {
  const numOfChan = audioBuffer.numberOfChannels;
  const bytesPerSample = bitDepth / 8;
  const formatCode = bitDepth === 32 ? 3 : 1;
  const length = audioBuffer.length * numOfChan * bytesPerSample + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels: Float32Array[] = [];
  let sample: number;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  setUint32(0x46464952);
  setUint32(length - 8);
  setUint32(0x45564157);
  setUint32(0x20746d66);
  setUint32(16);
  setUint16(formatCode);
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * bytesPerSample * numOfChan);
  setUint16(numOfChan * bytesPerSample);
  setUint16(bitDepth);
  setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (let channel = 0; channel < numOfChan; channel++) {
    channels.push(audioBuffer.getChannelData(channel));
  }

  while (pos < length) {
    for (let channel = 0; channel < numOfChan; channel++) {
      sample = Math.max(-1, Math.min(1, channels[channel][offset] || 0));
      if (bitDepth === 16) {
        view.setInt16(pos, sample < 0 ? sample * 32768 : sample * 32767, true);
        pos += 2;
      } else if (bitDepth === 24) {
        const value = (sample < 0 ? sample * 8388608 : sample * 8388607) | 0;
        view.setInt8(pos, value & 0xFF);
        view.setInt8(pos + 1, (value >> 8) & 0xFF);
        view.setInt8(pos + 2, (value >> 16) & 0xFF);
        pos += 3;
      } else {
        view.setFloat32(pos, sample, true);
        pos += 4;
      }
    }
    offset++;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function encodeMP3(
  audioBuffer: AudioBuffer,
  bitrate: 128 | 192 | 320 = 320,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  // Prefer the bundled encoder so exported MP3 files also work offline and in
  // the packaged desktop app. The window fallback keeps older loaded projects
  // compatible with the former CDN setup.
  const lib: any = (window as any).lamejs || lamejs;
  if (!lib?.Mp3Encoder) {
    throw new Error('MP3-motorn kunde inte laddas. Prova WAV i stället.');
  }

  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const mp3encoder = new lib.Mp3Encoder(channels, sampleRate, bitrate);
  const mp3Data: Int8Array[] = [];
  const left = audioBuffer.getChannelData(0);
  const right = channels > 1 ? audioBuffer.getChannelData(1) : left;
  const sampleBlockSize = 11520;
  const leftInt = new Int16Array(left.length);
  const rightInt = new Int16Array(right.length);

  for (let index = 0; index < left.length; index++) {
    const leftSample = Math.max(-1, Math.min(1, left[index]));
    const rightSample = Math.max(-1, Math.min(1, right[index]));
    leftInt[index] = leftSample < 0 ? leftSample * 32768 : leftSample * 32767;
    rightInt[index] = rightSample < 0 ? rightSample * 32768 : rightSample * 32767;
  }

  for (let index = 0; index < leftInt.length; index += sampleBlockSize) {
    const encoded = mp3encoder.encodeBuffer(
      leftInt.subarray(index, index + sampleBlockSize),
      rightInt.subarray(index, index + sampleBlockSize),
    );
    if (encoded.length > 0) mp3Data.push(encoded);
    if (index % (sampleBlockSize * 10) === 0) {
      onProgress?.(Math.floor((index / leftInt.length) * 100));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const tail = mp3encoder.flush();
  if (tail.length > 0) mp3Data.push(tail);
  onProgress?.(100);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

export function calculateNormalization(buffer: AudioBuffer): number {
  let max = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      max = Math.max(max, Math.abs(data[index]));
    }
  }
  return max > 0 ? 0.95 / max : 1.0;
}

export async function renderVideo(
  audioBuffer: AudioBuffer,
  visualAssets: VisualAsset[],
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Din webbläsare stöder inte videoskapande (VideoEncoder). Vänligen använd en modern version av Chrome eller Edge.');
  }

  const width = 1280;
  const height = 720;
  const fps = 30;
  const duration = audioBuffer.duration;
  const totalFrames = Math.ceil(duration * fps);
  const muxer = new MP4Muxer.Muxer({
    target: new MP4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    audio: {
      codec: 'aac',
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
    },
    fastStart: 'in-memory',
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;

  const loadedAssets = await Promise.all(visualAssets.map(async asset => {
    let element: HTMLImageElement | HTMLVideoElement;
    if (asset.type === 'image') {
      element = new Image();
      element.src = asset.url;
      await new Promise<void>((resolve, reject) => {
        (element as HTMLImageElement).onload = () => resolve();
        (element as HTMLImageElement).onerror = () => reject(new Error(`Kunde inte läsa bilden ${asset.file.name}`));
      });
    } else {
      element = document.createElement('video');
      element.src = asset.url;
      element.muted = true;
      element.setAttribute('playsinline', '');
      element.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        (element as HTMLVideoElement).onloadeddata = () => resolve();
        (element as HTMLVideoElement).onerror = () => reject(new Error(`Kunde inte läsa videon ${asset.file.name}`));
      });
    }
    return { ...asset, element };
  }));

  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: error => { throw new Error(`Videokodningsfel: ${error.message}`); },
  });
  videoEncoder.configure({
    codec: 'avc1.4d001f',
    width,
    height,
    bitrate: 5_000_000,
    framerate: fps,
    hardwareAcceleration: 'prefer-software',
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
    error: error => console.error('AudioEncoder error:', error),
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2',
    numberOfChannels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
    bitrate: 192_000,
  });

  const samplesPerChunk = 2048;
  for (let index = 0; index < audioBuffer.length; index += samplesPerChunk) {
    const chunkLength = Math.min(samplesPerChunk, audioBuffer.length - index);
    const data = new Float32Array(chunkLength * audioBuffer.numberOfChannels);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      data.set(audioBuffer.getChannelData(channel).subarray(index, index + chunkLength), channel * chunkLength);
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: audioBuffer.sampleRate,
      numberOfFrames: chunkLength,
      numberOfChannels: audioBuffer.numberOfChannels,
      timestamp: Math.floor((index / audioBuffer.sampleRate) * 1_000_000),
      data,
    });
    audioEncoder.encode(audioData);
    audioData.close();
    if (index % (samplesPerChunk * 500) === 0) {
      onProgress?.(Math.floor((index / audioBuffer.length) * 20));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  await audioEncoder.flush();

  for (let frame = 0; frame < totalFrames; frame++) {
    const timestamp = Math.floor((frame / fps) * 1_000_000);
    const timeInSec = frame / fps;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const assetIndex = Math.floor(timeInSec / (duration / loadedAssets.length)) % loadedAssets.length;
    const asset = loadedAssets[assetIndex];
    const assetElement = asset.element;
    if (asset.type === 'image') {
      const image = assetElement as HTMLImageElement;
      const scale = Math.min(width / image.width, height / image.height);
      ctx.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
    } else {
      const video = assetElement as HTMLVideoElement;
      video.currentTime = timeInSec % Math.max(video.duration || 1, 0.01);
      await new Promise<void>(resolve => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      ctx.drawImage(video, (width - video.videoWidth * scale) / 2, (height - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale);
    }

    const videoFrame = new VideoFrame(canvas, { timestamp });
    videoEncoder.encode(videoFrame, { keyFrame: frame % 60 === 0 });
    videoFrame.close();
    if (frame % 30 === 0) {
      onProgress?.(20 + Math.floor((frame / totalFrames) * 80));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  await videoEncoder.flush();
  muxer.finalize();
  const { buffer } = muxer.target as MP4Muxer.ArrayBufferTarget;
  return new Blob([buffer], { type: 'video/mp4' });
}
