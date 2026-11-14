/* Web Worker for real-time PCM -> 192kbps MP3 encoding (Zero server ffmpeg needed) */
importScripts('lamejs.iife.js');

let encoder = null;
let pendingChunks = [];
let pendingBytes = 0;
const FLUSH_THRESHOLD_BYTES = 7200; // ~300ms of 192kbps MP3 audio (reduces HTTP churn & prevents buffer underrun)

function floatToInt16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    let s = floatArr[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return out;
}

function flushPending(force = false) {
  if (pendingBytes === 0) return;
  if (!force && pendingBytes < FLUSH_THRESHOLD_BYTES) return;

  const merged = new Uint8Array(pendingBytes);
  let offset = 0;
  for (const part of pendingChunks) {
    merged.set(part, offset);
    offset += part.length;
  }
  pendingChunks = [];
  pendingBytes = 0;

  self.postMessage({ type: 'mp3', data: merged.buffer }, [merged.buffer]);
}

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    const sampleRate = msg.sampleRate || 44100;
    const bitrate = msg.bitrate || 192;
    encoder = new lamejs.Mp3Encoder(2, sampleRate, bitrate);
    pendingChunks = [];
    pendingBytes = 0;
    return;
  }

  if (msg.type === 'pcm' && encoder) {
    const left = floatToInt16(new Float32Array(msg.left));
    const right = floatToInt16(new Float32Array(msg.right));
    const mp3buf = encoder.encodeBuffer(left, right);
    if (mp3buf && mp3buf.length > 0) {
      const u8 = new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.byteLength);
      const copy = new Uint8Array(u8.length);
      copy.set(u8);
      pendingChunks.push(copy);
      pendingBytes += copy.length;
      flushPending(false);
    }
    return;
  }

  if (msg.type === 'stop') {
    if (encoder) {
      const tail = encoder.flush();
      if (tail && tail.length > 0) {
        const copy = new Uint8Array(tail.length);
        copy.set(new Uint8Array(tail.buffer, tail.byteOffset, tail.byteLength));
        pendingChunks.push(copy);
        pendingBytes += copy.length;
      }
      flushPending(true);
    }
    encoder = null;
  }
};
