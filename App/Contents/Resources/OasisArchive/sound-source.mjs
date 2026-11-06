import {fsb5ToWav} from 'unity-asset-reader-audio';
// Read the wallpaper's own PCM. The visualizer does not need a microphone,
// an audio-session permission, or a second player with independent volume.
function spectrum(pcm) {
  const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleRate = data.getUint32(24, true),
    channels = data.getUint16(22, true),
    stride = data.getUint16(32, true);
  const rate = 12,
    size = 512,
    bands = 64;
  if (
    data.getUint16(20, true) !== 1 ||
    data.getUint16(34, true) !== 16 ||
    !sampleRate ||
    stride !== 2 * channels
  )
    return null;
  let chunk = 12;
  while (chunk + 8 <= data.byteLength && data.getUint32(chunk) !== 0x64617461)
    chunk += 8 + ((data.getUint32(chunk + 4, true) + 1) & ~1);
  if (chunk + 8 > data.byteLength) return null;
  const start = chunk + 8,
    samples = Math.floor(Math.min(data.getUint32(chunk + 4, true), data.byteLength - start) / stride);
  const frames = Math.ceil((samples / sampleRate) * rate),
    out = new Uint8Array(frames * bands);
  const re = new Float32Array(size),
    im = new Float32Array(size),
    window = new Float32Array(size),
    rev = new Uint16Array(size);
  const cos = new Float32Array(size / 2),
    sin = new Float32Array(size / 2);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    rev[i] = (rev[i >> 1] >> 1) | ((i & 1) * (size >> 1));
    if (i < size / 2) {
      cos[i] = Math.cos((-2 * Math.PI * i) / size);
      sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }
  for (let frame = 0; frame < frames; frame++) {
    const at = Math.floor((frame * sampleRate) / rate);
    im.fill(0);
    for (let i = 0; i < size; i++)
      re[rev[i]] =
        at + i < samples ? (data.getInt16(start + (at + i) * stride, true) * window[i]) / 32768 : 0;
    for (let length = 2; length <= size; length *= 2) {
      const half = length / 2,
        step = size / length;
      for (let first = 0; first < size; first += length)
        for (let j = 0; j < half; j++) {
          const l = first + j,
            r = l + half,
            k = j * step,
            x = re[r] * cos[k] - im[r] * sin[k],
            y = re[r] * sin[k] + im[r] * cos[k];
          re[r] = re[l] - x;
          im[r] = im[l] - y;
          re[l] += x;
          im[l] += y;
        }
    }
    for (let b = 0; b < bands; b++) {
      const first = Math.min(size / 2 - 1, Math.floor((1 + b / bands) ** 8)),
        end = Math.min(size / 2, Math.max(first + 1, Math.floor((1 + (b + 1) / bands) ** 8)));
      let peak = 0;
      for (let i = first; i < end; i++) peak = Math.max(peak, Math.hypot(re[i], im[i]) / size);
      out[frame * bands + b] = Math.min(255, Math.round(255 * Math.sqrt(peak * 2)));
    }
  }
  return {values: out, rate, bands};
}
self.onmessage = async (event) => {
  try {
    const response = await fetch(event.data);
    if (!response.ok) throw Error('audio');
    const pcm = fsb5ToWav(new Uint8Array(await response.arrayBuffer()));
    const levels = spectrum(pcm);
    self.postMessage(
      {pcm: pcm.buffer, levels},
      levels ? [pcm.buffer, levels.values.buffer] : [pcm.buffer]
    );
  } catch {
    self.postMessage(null);
  }
};
