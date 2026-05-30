// Minimal browser-side WAV to MP3 conversion using lamejs
// https://github.com/zhuker/lamejs
import lamejs from './lame.min.js';

export function wavToMp3(wavBuffer) {
  const view = new DataView(wavBuffer);
  // WAV header parsing
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const dataOffset = 44;
  const samples = new Int16Array(wavBuffer, dataOffset);

  // MP3 encoding
  const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
  const mp3Data = [];
  const maxSamples = 1152;

  if (numChannels === 2) {
    // De-interleave stereo channels
    const left = new Int16Array(samples.length / 2);
    const right = new Int16Array(samples.length / 2);
    for (let i = 0, j = 0; i < samples.length; i += 2, j++) {
      left[j] = samples[i];
      right[j] = samples[i + 1];
    }

    let remaining = left.length;
    for (let i = 0; remaining >= maxSamples; i += maxSamples) {
      const leftChunk = left.subarray(i, i + maxSamples);
      const rightChunk = right.subarray(i, i + maxSamples);
      const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
      remaining -= maxSamples;
    }
  } else {
    let remaining = samples.length;
    for (let i = 0; remaining >= maxSamples; i += maxSamples) {
      const mono = samples.subarray(i, i + maxSamples);
      const mp3buf = mp3encoder.encodeBuffer(mono);
      if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
      remaining -= maxSamples;
    }
  }
  const d = mp3encoder.flush();
  if (d.length > 0) mp3Data.push(new Int8Array(d));
  // Concatenate
  let length = 0;
  mp3Data.forEach(arr => length += arr.length);
  const mp3 = new Uint8Array(length);
  let offset = 0;
  mp3Data.forEach(arr => { mp3.set(arr, offset); offset += arr.length; });
  return mp3.buffer;
}
