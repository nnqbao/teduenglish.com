// Encodes 16-bit mono PCM to MP3 off the main thread (see lib/mp3.ts).
import { Mp3Encoder } from "@breezystack/lamejs";

self.onmessage = (e: MessageEvent<{ pcm: Int16Array; rate: number; kbps: number }>) => {
  try {
    const { pcm, rate, kbps } = e.data;
    const enc = new Mp3Encoder(1, rate, kbps);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < pcm.length; i += 1152) {
      const out = enc.encodeBuffer(pcm.subarray(i, i + 1152));
      if (out.length) parts.push(new Uint8Array(out));
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    (self as unknown as Worker).postMessage({ parts });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};
