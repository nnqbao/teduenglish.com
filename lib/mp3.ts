"use client";

/*
 * Browser recordings come out as WebM/Opus (Chrome, Android) or MP4/AAC (Safari). Teachers asked for
 * MP3, which every computer plays: decode, mix down to mono 22 kHz (plenty for speech) and encode in
 * a worker. If anything fails the original recording is kept.
 */

const RATE = 22_050;
const KBPS = 48;

async function decode(blob: Blob): Promise<AudioBuffer> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close().catch(() => {});
  }
}

/** Resamples to mono 22 kHz 16-bit PCM. */
async function toPcm(buf: AudioBuffer): Promise<Int16Array> {
  const frames = Math.max(1, Math.ceil(buf.duration * RATE));
  const off = new OfflineAudioContext(1, frames, RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const f32 = (await off.startRendering()).getChannelData(0);
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

function encode(pcm: Int16Array): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mp3.worker.ts", import.meta.url), { type: "module" });
    const done = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<{ parts?: Uint8Array[]; error?: string }>) => {
      done();
      if (e.data.parts) resolve(new Blob(e.data.parts as BlobPart[], { type: "audio/mpeg" }));
      else reject(new Error(e.data.error ?? "mp3"));
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "mp3 worker"));
    };
    worker.postMessage({ pcm, rate: RATE, kbps: KBPS }, [pcm.buffer]);
  });
}

/** The recording as MP3, or the original if this browser can't convert it. */
export async function toMp3(blob: Blob): Promise<Blob> {
  if (blob.type === "audio/mpeg" || typeof OfflineAudioContext === "undefined" || typeof Worker === "undefined") return blob;
  try {
    return await encode(await toPcm(await decode(blob)));
  } catch {
    return blob;
  }
}
