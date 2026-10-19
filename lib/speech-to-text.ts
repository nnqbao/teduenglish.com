"use client";

/*
 * Live transcript of a spoken answer with the browser's own speech recognition (Chrome, Edge, Safari;
 * not Firefox). It runs next to the recorder, so students don't have to type what they said.
 * Chrome sends the audio to Google's recogniser; Safari to Apple's. When the browser has no recogniser,
 * or it refuses to work (Brave, Safari with Siri off…), the feature is switched off for the session
 * so the button disappears instead of failing.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

let broken = false;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Phones and tablets share one microphone between the recogniser and the recorder, which can leave
 * the recording silent; transcripts are only offered on computers, where both work together.
 */
function isMobile(): boolean {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Whether to offer automatic transcripts at all. */
export function sttSupported(): boolean {
  return !broken && !!ctor() && !isMobile();
}

const FATAL = new Set(["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported"]);

export type Transcriber = { stop: () => Promise<string> };

/**
 * Starts transcribing; `onText(final, interim)` reports progress. Recognition stops by itself after
 * silences, so it restarts until `stop()`. `onUnsupported` fires once if the browser can't do it.
 */
export function startTranscriber(lang: string, onText: (finalText: string, interim: string) => void, onUnsupported: () => void): Transcriber | null {
  const C = ctor();
  if (!C || !sttSupported()) return null;
  let finalText = "";
  let active = true;
  let rec: Recognition | null = null;
  let settle: (() => void) | null = null;

  const begin = () => {
    rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText = `${finalText} ${r[0].transcript}`.replace(/\s+/g, " ").trim();
        else interim += r[0].transcript;
      }
      onText(finalText, interim.trim());
    };
    rec.onerror = (e) => {
      if (FATAL.has(e.error)) {
        broken = true;
        active = false;
        onUnsupported();
      }
    };
    rec.onend = () => {
      if (active) {
        try {
          begin();
        } catch {
          active = false;
        }
      } else settle?.();
    };
    rec.start();
  };

  try {
    begin();
  } catch {
    broken = true;
    onUnsupported();
    return null;
  }

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        if (!active || !rec) return resolve(finalText);
        active = false;
        // Give the recogniser a moment to deliver its last words.
        const t = setTimeout(() => resolve(finalText), 1500);
        settle = () => {
          clearTimeout(t);
          resolve(finalText);
        };
        try {
          rec.stop();
        } catch {
          resolve(finalText);
        }
      }),
  };
}
