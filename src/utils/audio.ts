import { TrackSettings, GlobalSettings, VisualAsset } from '../types';
import * as MP4Muxer from 'mp4-muxer';

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

export async function renderMix(
  tracks: TrackSettings[], 
  globalSettings: GlobalSettings,
  onProgress?: (progress: number) => void
): Promise<AudioBuffer> {
  if (tracks.length === 0) throw new Error('Inga spår att mixa');

  // Filter out tracks without buffers
  const validTracks = tracks.filter(t => t.buffer);
  if (validTracks.length === 0) throw new Error('Inga avkodade spår hittades');

  // Calculate start times first with TRIM taken into account
  const startTimes: number[] = [];
  let totalDuration = 0;
  for (let i = 0; i < validTracks.length; i++) {
    const track = validTracks[i];
    const startTrim = track.startTrim || 0;
    const endTrim = track.endTrim || 0;
    const effectiveDuration = Math.max(0.1, track.buffer!.duration - startTrim - endTrim);
    
    startTimes.push(totalDuration);
    const isLast = i === validTracks.length - 1;
    totalDuration += effectiveDuration - (isLast ? 0 : globalSettings.crossfadeDuration);
  }

  // Ensure totalDuration is positive
  totalDuration = Math.max(totalDuration, 0.1);

  const offlineCtx = new OfflineAudioContext(
    2, // Stereo
    Math.ceil(totalDuration * 44100),
    44100
  );

  for (let i = 0; i < validTracks.length; i++) {
    const track = validTracks[i];
    const buffer = track.buffer!;
    const startTimeAt = startTimes[i];
    
    // Effective durations with TRIM
    const startTrim = track.startTrim || 0;
    const endTrim = track.endTrim || 0;
    const effectiveDuration = Math.max(0.1, buffer.duration - startTrim - endTrim);

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    let lastNode: AudioNode = source;

    // EQ - Bass
    if (track.bass && track.bass !== 0) {
      const bassNode = offlineCtx.createBiquadFilter();
      bassNode.type = 'lowshelf';
      bassNode.frequency.value = 200;
      bassNode.gain.value = track.bass;
      lastNode.connect(bassNode);
      lastNode = bassNode;
    }

    // EQ - Treble
    if (track.treble && track.treble !== 0) {
      const trebleNode = offlineCtx.createBiquadFilter();
      trebleNode.type = 'highshelf';
      trebleNode.frequency.value = 3000;
      trebleNode.gain.value = track.treble;
      lastNode.connect(trebleNode);
      lastNode = trebleNode;
    }

    const gainNode = offlineCtx.createGain();
    const defaultGain = track.volume;
    
    // Initial state
    gainNode.gain.setValueAtTime(0, startTimeAt);
    
    // FADE IN LOGIC
    if (i === 0) {
      const fadeInDur = Math.min(track.fadeIn, effectiveDuration / 2);
      gainNode.gain.linearRampToValueAtTime(defaultGain, startTimeAt + fadeInDur);
    } else {
      const crossfadeDur = Math.min(globalSettings.crossfadeDuration, effectiveDuration / 2);
      gainNode.gain.linearRampToValueAtTime(defaultGain, startTimeAt + crossfadeDur);
    }

    // FADE OUT LOGIC
    const isLast = i === validTracks.length - 1;
    if (isLast) {
      const fadeOutDur = Math.min(track.fadeOut, effectiveDuration / 2);
      const fadeOutStart = startTimeAt + effectiveDuration - fadeOutDur;
      gainNode.gain.setValueAtTime(defaultGain, fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, startTimeAt + effectiveDuration);
    } else {
      const crossfadeDur = Math.min(globalSettings.crossfadeDuration, effectiveDuration / 2);
      const fadeOutStart = startTimeAt + effectiveDuration - crossfadeDur;
      gainNode.gain.setValueAtTime(defaultGain, fadeOutStart);
      gainNode.gain.linearRampToValueAtTime(0, startTimeAt + effectiveDuration);
    }

    lastNode.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    source.start(startTimeAt, startTrim, effectiveDuration);
  }

  return await offlineCtx.startRendering();
}

export function encodeWAV(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob {
  const numOfChan = audioBuffer.numberOfChannels;
  const bytesPerSample = bitDepth / 8;
  const formatCode = bitDepth === 32 ? 3 : 1; // 3 is IEEE Float, 1 is PCM
  
  const length = audioBuffer.length * numOfChan * bytesPerSample + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i, sample, offset = 0, pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(formatCode);                         // PCM (1) or Float (3)
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * bytesPerSample * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * bytesPerSample);         // block-align
  setUint16(bitDepth);                           // bit-depth

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < audioBuffer.numberOfChannels; i++)
    channels.push(audioBuffer.getChannelData(i));

  while(pos < length) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      
      if (bitDepth === 16) {
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
        view.setInt16(pos, sample, true);
        pos += 2;
      } else if (bitDepth === 24) {
        sample = (0.5 + sample < 0 ? sample * 8388608 : sample * 8388607) | 0;
        view.setInt8(pos, sample & 0xFF);
        view.setInt8(pos + 1, (sample >> 8) & 0xFF);
        view.setInt8(pos + 2, (sample >> 16) & 0xFF);
        pos += 3;
      } else if (bitDepth === 32) {
        view.setFloat32(pos, sample, true);
        pos += 4;
      }
    }
    offset++;                                     // next source sample
  }

  return new Blob([buffer], {type: "audio/wav"});

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export async function encodeMP3(audioBuffer: AudioBuffer, onProgress?: (progress: number) => void): Promise<Blob> {
  // Use the global lamejs object loaded via script tag in index.html
  const lib = (window as any).lamejs;
  
  if (!lib) {
    throw new Error('MP3-motorn kunde inte laddas. Kontrollera din internetanslutning eller använd WAV.');
  }

  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  
  // Use 320kbps for professional high quality
  const kbps = 320;
  const mp3encoder = new lib.Mp3Encoder(channels, sampleRate, kbps); 
  const mp3Data = [];

  const left = audioBuffer.getChannelData(0);
  const right = channels > 1 ? audioBuffer.getChannelData(1) : left;
  
  // Larger chunk for reasonable performance while yielding
  const sampleBlockSize = 11520; 

  // Convert float to 16-bit PCM
  const leftInt = new Int16Array(left.length);
  const rightInt = new Int16Array(right.length);
  for (let i = 0; i < left.length; i++) {
    let sL = left[i];
    let sR = right[i];
    // Clipping protection
    sL = Math.max(-1, Math.min(1, sL));
    sR = Math.max(-1, Math.min(1, sR));
    leftInt[i] = sL < 0 ? sL * 32768 : sL * 32767;
    rightInt[i] = sR < 0 ? sR * 32768 : sR * 32767;
  }

  for (let i = 0; i < leftInt.length; i += sampleBlockSize) {
    const leftChunk = leftInt.subarray(i, i + sampleBlockSize);
    const rightChunk = rightInt.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
    
    if (i % (sampleBlockSize * 10) === 0) { // yield every ~2.5 seconds of audio
        if (onProgress) onProgress(Math.floor((i / leftInt.length) * 100));
        await new Promise(r => setTimeout(r, 0));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  if (onProgress) onProgress(100);
  return new Blob(mp3Data, { type: 'audio/mp3' });
}

export function calculateNormalization(buffer: AudioBuffer): number {
    let max = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]);
            if (abs > max) max = abs;
        }
    }
    return max > 0 ? 0.95 / max : 1.0;
}

export async function renderVideo(
  audioBuffer: AudioBuffer,
  visualAssets: VisualAsset[],
  onProgress?: (progress: number) => void
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
    video: {
      codec: 'avc',
      width,
      height
    },
    audio: {
      codec: 'aac',
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels
    },
    fastStart: 'in-memory'
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;

  // Pre-load all assets
  const loadedAssets = await Promise.all(visualAssets.map(async (asset) => {
    let element: HTMLImageElement | HTMLVideoElement;
    if (asset.type === 'image') {
      element = new Image();
      element.src = asset.url;
      await new Promise((r) => (element as HTMLImageElement).onload = r);
    } else {
      element = document.createElement('video');
      element.src = asset.url;
      element.muted = true;
      element.setAttribute('playsinline', '');
      element.crossOrigin = 'anonymous';
      await new Promise((r) => (element as HTMLVideoElement).onloadeddata = r);
    }
    return { ...asset, element };
  }));

  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (e) => {
      console.error('VideoEncoder Error:', e);
      throw new Error(`Videokodningsfel: ${e.message}`);
    }
  });

  videoEncoder.configure({
    codec: 'avc1.4d001f',
    width,
    height,
    bitrate: 5_000_000,
    framerate: fps,
    hardwareAcceleration: 'prefer-software'
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
    error: (e) => console.error('AudioEncoder error:', e)
  });

  audioEncoder.configure({
    codec: 'mp4a.40.2',
    numberOfChannels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate,
    bitrate: 192_000
  });

  // Encode Audio
  const samplesPerChunk = 2048;
  let chunkCount = 0;
  for (let i = 0; i < audioBuffer.length; i += samplesPerChunk) {
    const chunkLength = Math.min(samplesPerChunk, audioBuffer.length - i);
    const data = new Float32Array(chunkLength * audioBuffer.numberOfChannels);
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      data.set(audioBuffer.getChannelData(c).subarray(i, i + chunkLength), c * chunkLength);
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: audioBuffer.sampleRate,
      numberOfFrames: chunkLength,
      numberOfChannels: audioBuffer.numberOfChannels,
      timestamp: Math.floor((i / audioBuffer.sampleRate) * 1_000_000),
      data: data
    });
    audioEncoder.encode(audioData);
    audioData.close();
    
    chunkCount++;
    if (chunkCount % 500 === 0) {
      if (onProgress) onProgress(Math.floor((i / audioBuffer.length) * 20)); // Audio takes 0-20%
      await new Promise(r => setTimeout(r, 0));
    }
  }
  await audioEncoder.flush();

  // Encode Video Frames
  for (let frame = 0; frame < totalFrames; frame++) {
    const timestamp = Math.floor((frame / fps) * 1_000_000);
    const timeInSec = frame / fps;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Pick asset based on time
    const assetIndex = Math.floor(timeInSec / (duration / loadedAssets.length)) % loadedAssets.length;
    const asset = loadedAssets[assetIndex];
    const assetElement = asset.element;

    if (asset.type === 'image') {
      const img = assetElement as HTMLImageElement;
      const scale = Math.max(width / img.width, height / img.height);
      const x = (width - img.width * scale) / 2;
      const y = (height - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    } else {
      const vid = assetElement as HTMLVideoElement;
      vid.currentTime = timeInSec % vid.duration;
      await new Promise(r => {
        const onSeeked = () => {
          vid.removeEventListener('seeked', onSeeked);
          r(null);
        };
        vid.addEventListener('seeked', onSeeked);
      });
      
      const scale = Math.max(width / vid.videoWidth, height / vid.videoHeight);
      const x = (width - vid.videoWidth * scale) / 2;
      const y = (height - vid.videoHeight * scale) / 2;
      ctx.drawImage(vid, x, y, vid.videoWidth * scale, vid.videoHeight * scale);
    }

    const videoFrame = new VideoFrame(canvas, { timestamp });
    videoEncoder.encode(videoFrame, { keyFrame: frame % 60 === 0 });
    videoFrame.close();

    if (frame % 30 === 0) {
      if (onProgress) onProgress(20 + Math.floor((frame / totalFrames) * 80));
      await new Promise(r => setTimeout(r, 0));
    }
  }

  await videoEncoder.flush();
  muxer.finalize();

  const { buffer } = muxer.target as MP4Muxer.ArrayBufferTarget;
  return new Blob([buffer], { type: 'video/mp4' });
}

