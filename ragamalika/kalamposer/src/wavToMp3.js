// Minimal browser-side WAV to MP3 conversion using lamejs
// https://github.com/zhuker/lamejs
import lamejs from 'lamejs';

export function wavToMp3(wavBuffer) {
  // Decode WAV header
  function readInt16LE(buffer, offset) {
    return buffer[offset] | (buffer[offset + 1] << 8);
  }
  function readInt32LE(buffer, offset) {
    return (buffer[offset]) | (buffer[offset+1]<<8) | (buffer[offset+2]<<16) | (buffer[offset+3]<<24);
  }
  const view = new DataView(wavBuffer);
  // WAV header parsing
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataOffset = 44;
  const samples = new Int16Array(wavBuffer, dataOffset);

  // MP3 encoding
  const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
  const mp3Data = [];
  let remaining = samples.length;
  const maxSamples = 1152;
  for (let i = 0; remaining >= maxSamples; i += maxSamples) {
    const mono = samples.subarray(i, i + maxSamples);
    const mp3buf = mp3encoder.encodeBuffer(mono);
    if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
    remaining -= maxSamples;
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
