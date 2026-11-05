import assert from 'node:assert/strict';
import test from 'node:test';

// audio.ts creates a decoding context at module load time. Timeline tests only
// need a tiny stand-in; no real browser audio is rendered in this test file.
class TestAudioContext {
  async decodeAudioData(): Promise<AudioBuffer> {
    throw new Error('Not used by timeline tests');
  }
}

(globalThis as any).window = { AudioContext: TestAudioContext };

const {
  getProjectTimeline,
  getTrackPlaybackRegion,
  getTransitionDuration,
} = await import('./audio.ts');

type FakeBufferOptions = {
  duration: number;
  leadingSilence?: number;
  trailingSilence?: number;
};

function makeBuffer({
  duration,
  leadingSilence = 0,
  trailingSilence = 0,
}: FakeBufferOptions): AudioBuffer {
  const sampleRate = 1_000;
  const samples = new Float32Array(Math.round(duration * sampleRate));
  const start = Math.round(leadingSilence * sampleRate);
  const end = Math.round((duration - trailingSilence) * sampleRate);
  samples.fill(0.35, start, Math.max(start, end));

  return {
    duration,
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

function makeTrack(id: string, buffer: AudioBuffer) {
  return {
    id,
    name: id,
    file: new File([''], `${id}.wav`, { type: 'audio/wav' }),
    buffer,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    role: 'music' as const,
    placement: 'sequence' as const,
  };
}

const baseSettings = {
  format: 'mp3' as const,
  crossfadeDuration: 0,
  normalize: true,
  visualAssets: [],
};

test('removes only clear edge padding from a song', () => {
  const track = makeTrack('first', makeBuffer({
    duration: 10,
    leadingSilence: 1,
    trailingSilence: 2,
  }));

  const region = getTrackPlaybackRegion(track);

  assert.ok(Math.abs(region.sourceStart - 1) < 0.06);
  assert.ok(Math.abs(region.sourceEnd - 8) < 0.06);
  assert.ok(Math.abs(region.sourceDuration - 7) < 0.1);
  assert.ok(region.autoLeadingSilence >= 0.95);
  assert.ok(region.autoTrailingSilence >= 1.95);
});

test('keeps a protection overlap between music tracks even at zero seconds', () => {
  const first = makeTrack('first', makeBuffer({ duration: 10, trailingSilence: 1 }));
  const second = makeTrack('second', makeBuffer({ duration: 10, leadingSilence: 1 }));

  const overlap = getTransitionDuration(first, second, baseSettings);
  const timeline = getProjectTimeline([first, second], baseSettings);

  assert.ok(overlap >= 0.34, 'music tracks should receive a short NOBREAK overlap');
  assert.equal(timeline.entries.length, 2);
  assert.ok(
    timeline.entries[1].start < timeline.entries[0].end,
    'the next song must start before the previous playable region ends',
  );
  assert.ok(
    Math.abs((timeline.entries[0].end - timeline.entries[1].start) - overlap) < 0.01,
    'the timeline overlap should match the planned crossfade',
  );
});
