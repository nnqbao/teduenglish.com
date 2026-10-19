"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { plainText } from "@/lib/rich";
import { toMp3 } from "@/lib/mp3";
import { startTranscriber, sttSupported, type Transcriber } from "@/lib/speech-to-text";
import { Rich, errMsg } from "@/lib/ui";
import { useSite } from "./SiteShell";

type QuizData = NonNullable<FunctionReturnType<typeof api.site.quiz>>;
type OkQuiz = Extract<QuizData, { status: "ok" }>;
type Meta = QuizData["meta"];
type PubSection = OkQuiz["sections"][number];

type Item = { key: string; part: string; tag: string; q: string; imageUrl: string | null; answerSec: number; prepSec: number };
type Stage = "asking" | "thinking" | "recording" | "gap";
type Phase = "check" | "prep" | "run" | "sending" | "done";

/** Container types the browser can record; the first supported one wins. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function itemsOf(sections: PubSection[]): Item[] {
  const out: Item[] = [];
  sections.forEach((s, si) =>
    s.questions.forEach((q, qi) => {
      if (q.type === "speak") out.push({ key: `${si}-${qi}`, part: s.title, tag: q.tag, q: q.q, imageUrl: q.image?.url ?? null, answerSec: q.answerSec, prepSec: q.prepSec });
    }),
  );
  return out;
}

function clock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Plain text for the voice: drops Markdown-ish marks and bullet symbols. */
function speakable(text: string) {
  return plainText(text).replace(/[*_#>`]/g, "").replace(/^[•\-–]\s*/gm, "").replace(/\s+/g, " ").trim();
}

/**
 * IELTS Speaking practice: microphone check, a short get-ready countdown, then for every question
 * the computer reads it aloud, beeps, and records the answer for a fixed time. Recordings go to the
 * teacher, who marks the four Speaking criteria.
 */
export default function SpeakingRunner({ meta, sections, preview, onPractice }: { meta: Meta; sections: PubSection[]; preview: boolean; onPractice?: () => void }) {
  const { token, teacher } = useSite();
  const uploadUrl = useMutation(api.site.speakUploadUrl);
  const submit = useMutation(api.site.submit);
  const items = useRef(itemsOf(sections)).current;
  const totalSec = items.reduce((n, i) => n + i.answerSec + i.prepSec + 8, 0);

  const [phase, setPhase] = useState<Phase>("check");
  const [mic, setMic] = useState<"off" | "asking" | "on" | "error">("off");
  const [micMsg, setMicMsg] = useState("");
  const [level, setLevel] = useState(0);
  const [trial, setTrial] = useState<"idle" | "recording" | string>("idle"); // object URL when done
  const [voiceOk, setVoiceOk] = useState<boolean | null>(null);
  const [step, setStep] = useState<{ i: number; stage: Stage }>({ i: 0, stage: "asking" });
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [clips, setClips] = useState<(string | null)[]>([]); // local playback URLs
  const [sendErr, setSendErr] = useState("");
  const [sent, setSent] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const runId = useRef(0);
  const skip = useRef<(() => void) | null>(null);
  const uploads = useRef<Map<string, Promise<string>>>(new Map());
  const blobs = useRef<Map<string, Blob>>(new Map());
  // Transcripts made by the browser while each answer is recorded (computers only; see lib/speech-to-text).
  const transcripts = useRef<Record<string, string>>({});
  const pendingTexts = useRef<Promise<unknown>[]>([]);
  const startedAt = useRef(0);

  /* ---------- devices ---------- */

  const stopAll = useCallback(() => {
    runId.current++;
    skip.current?.();
    try {
      if (recorder.current?.state === "recording") recorder.current.stop();
    } catch {
      /* ignore */
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }, []);

  useEffect(() => stopAll, [stopAll]);

  // Live microphone level for the meter.
  useEffect(() => {
    if (mic !== "on") return;
    let raf = 0;
    const buf = new Uint8Array(512);
    const tick = () => {
      const a = analyser.current;
      if (a) {
        a.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mic]);

  // Countdown clock.
  useEffect(() => {
    if (deadline == null) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadline]);

  // Leaving mid-test loses the recordings: ask first.
  useEffect(() => {
    if (phase !== "prep" && phase !== "run" && phase !== "sending") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  async function enableMic() {
    setMicMsg("");
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
      setMic("error");
      setMicMsg("Trình duyệt này chưa thu âm được. Em mở bài bằng Chrome, Edge hoặc Safari bản mới nhé.");
      return;
    }
    setMic("asking");
    audioCtx.current?.close().catch(() => {});
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(node);
      audioCtx.current = ctx;
      analyser.current = node;
      setMic("on");
    } catch (e) {
      setMic("error");
      const name = e instanceof DOMException ? e.name : "";
      setMicMsg(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Em chưa cho phép dùng micro. Bấm biểu tượng ổ khoá (hoặc “Aa”) cạnh địa chỉ web → cho phép Micro, rồi bấm lại nút này."
          : name === "NotFoundError"
            ? "Không tìm thấy micro. Em cắm tai nghe có micro hoặc dùng điện thoại, rồi thử lại."
            : "Chưa bật được micro. Em đóng các ứng dụng khác đang dùng micro (Zoom, Meet…) rồi thử lại.",
      );
    }
  }

  function newRecorder() {
    const mime = MIME_TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t)) ?? "";
    return new window.MediaRecorder(stream.current!, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
  }

  /** Records until `until` resolves; returns the audio. */
  function record(until: Promise<void>): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = newRecorder();
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const type = (rec.mimeType || "audio/webm").split(";")[0].replace(/^video\//, "audio/");
        resolve(new Blob(chunks, { type }));
      };
      rec.onerror = () => reject(new Error("recorder"));
      recorder.current = rec;
      rec.start(1000);
      until.then(() => rec.state !== "inactive" && rec.stop());
    });
  }

  async function trialRecord() {
    setTrial("recording");
    const blob = await record(new Promise((r) => setTimeout(r, 3000)));
    setTrial(URL.createObjectURL(blob));
  }

  function voices(accent: "uk" | "us") {
    const all = window.speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    const regional = all.filter((v) => (accent === "us" ? /us/i : /gb/i).test(v.lang));
    return regional.length ? regional : all;
  }

  /** Reads text aloud; resolves when done (or after a reasonable time if the voice never reports back). */
  function say(text: string, id: number): Promise<void> {
    const words = text.split(/\s+/).length;
    const fallback = new Promise<void>((r) => setTimeout(r, Math.max(3000, words * 520 + 2000)));
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") return fallback;
    const spoken = new Promise<void>((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const u = new window.SpeechSynthesisUtterance(speakable(text));
        u.lang = meta.accent === "us" ? "en-US" : "en-GB";
        u.rate = 0.92;
        const v = voices(meta.accent)[0];
        if (v) u.voice = v;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      } catch {
        resolve();
      }
    });
    return Promise.race([spoken, fallback]).then(() => {
      if (runId.current !== id) throw new Error("stopped");
    });
  }

  function testVoice() {
    setVoiceOk(null);
    say("Hello! Can you hear me clearly? Let's start the speaking test.", runId.current).then(
      () => setVoiceOk(true),
      () => {},
    );
  }

  function beep() {
    const ctx = audioCtx.current;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  }

  /** Waits `sec` seconds (shown as a countdown); "skip" ends it early. */
  function countdown(sec: number, id: number, skippable: boolean): Promise<void> {
    const end = Date.now() + sec * 1000;
    setDeadline(end);
    setNow(Date.now());
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, sec * 1000);
      function done() {
        clearTimeout(t);
        skip.current = null;
        resolve();
      }
      skip.current = skippable ? done : null;
    }).then(() => {
      setDeadline(null);
      if (runId.current !== id) throw new Error("stopped");
    });
  }

  /* ---------- the test ---------- */

  function upload(key: string, original: Blob): Promise<string> {
    const p = (async () => {
      const blob = await toMp3(original);
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const url = await uploadUrl({ token: token ?? undefined, id: meta.id });
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          if (!res.ok) throw new Error(String(res.status));
          const { storageId } = (await res.json()) as { storageId: string };
          setSent((n) => n + 1);
          return storageId;
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      throw last;
    })();
    p.catch(() => {}); // reported when sending
    uploads.current.set(key, p);
    return p;
  }

  async function start() {
    // Unlock speech and sound inside the click (iPhone/iPad need this).
    try {
      window.speechSynthesis?.speak(new window.SpeechSynthesisUtterance(" "));
    } catch {
      /* ignore */
    }
    await audioCtx.current?.resume().catch(() => {});
    const id = ++runId.current;
    startedAt.current = Date.now();
    setClips(items.map(() => null));
    setPhase("prep");
    try {
      await countdown(meta.speakPrep, id, true);
      setPhase("run");
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setStep({ i, stage: "asking" });
        await say(it.q, id);
        if (it.prepSec > 0) {
          setStep({ i, stage: "thinking" });
          await countdown(it.prepSec, id, true);
        }
        beep();
        await new Promise((r) => setTimeout(r, 450));
        setStep({ i, stage: "recording" });
        const tr: Transcriber | null = sttSupported() ? startTranscriber(meta.accent === "us" ? "en-US" : "en-GB", () => {}, () => {}) : null;
        const blob = await record(countdown(it.answerSec, id, true).catch(() => {}));
        if (tr) pendingTexts.current.push(tr.stop().then((t) => t && (transcripts.current[it.key] = t)));
        if (runId.current !== id) return;
        blobs.current.set(it.key, blob);
        setClips((c) => c.map((x, j) => (j === i ? URL.createObjectURL(blob) : x)));
        if (!preview) upload(it.key, blob);
        setStep({ i, stage: "gap" });
        await new Promise((r) => setTimeout(r, 700));
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      await send();
    } catch {
      /* stopped */
    }
  }

  async function send() {
    if (preview) {
      setPhase("done");
      return;
    }
    setPhase("sending");
    setSendErr("");
    // Retry any upload that failed.
    for (const [key, blob] of blobs.current) {
      const p = uploads.current.get(key);
      if (!p || (await p.then(() => false, () => true))) upload(key, blob);
    }
    try {
      const answers: Record<string, string> = {};
      for (const [key, p] of uploads.current) answers[key] = await p;
      await Promise.all(pendingTexts.current);
      await submit({
        token: token ?? undefined,
        id: meta.id,
        answers,
        transcripts: transcripts.current,
        mode: "exam",
        durationSec: (Date.now() - startedAt.current) / 1000,
      });
      setPhase("done");
    } catch (e) {
      setSendErr(errMsg(e, "Chưa gửi được bài nói. Kiểm tra mạng rồi bấm Gửi lại."));
    }
  }

  /* ---------- view ---------- */

  const left = deadline != null ? (deadline - now) / 1000 : 0;
  const cur = items[step.i];
  const meter = (
    <span className="level-meter" aria-hidden="true">
      <i style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );

  if (!items.length) return <p className="empty">Bài này chưa có câu hỏi Speaking.</p>;

  if (phase === "check")
    return (
      <section className="panel speak-panel">
        <div>
          <p className="eyebrow">IELTS Speaking · ghi âm</p>
          <h2>Kiểm tra thiết bị trước khi thi</h2>
          <p className="small muted">
            Bài gồm {items.length} câu, khoảng {Math.ceil(totalSec / 60)} phút. Máy đọc câu hỏi, kêu “tít” rồi thu âm em trả lời. Hết giờ máy tự chuyển câu; em nói xong sớm thì bấm “Xong,
            sang câu tiếp”. Bài nói được gửi cho {teacher} chấm band.
          </p>
        </div>
        <ol className="speak-checks">
          <li className={mic === "on" ? "ok" : ""}>
            <b>1. Bật micro</b>
            {mic === "on" ? (
              <span className="speak-row">
                {meter}
                <span className="tiny muted">Nói thử, thanh màu phải nhảy theo giọng em.</span>
              </span>
            ) : (
              <button className="btn btn-primary btn-sm" type="button" onClick={enableMic} disabled={mic === "asking"}>
                {mic === "asking" ? "Đang chờ em cho phép…" : "🎤 Bật micro"}
              </button>
            )}
            {micMsg && <p className="alert alert-bad">{micMsg}</p>}
          </li>
          <li className={trial !== "idle" && trial !== "recording" ? "ok" : ""}>
            <b>2. Thu thử 3 giây và nghe lại</b>
            <span className="speak-row">
              <button className="btn btn-ghost btn-sm" type="button" onClick={trialRecord} disabled={mic !== "on" || trial === "recording"}>
                {trial === "recording" ? "🔴 Đang thu…" : "Thu thử"}
              </button>
              {trial !== "idle" && trial !== "recording" && <audio controls src={trial} />}
            </span>
          </li>
          <li className={voiceOk ? "ok" : ""}>
            <b>3. Nghe thử giọng đọc câu hỏi</b>
            <span className="speak-row">
              <button className="btn btn-ghost btn-sm" type="button" onClick={testVoice}>
                🔊 Nghe thử
              </button>
              <span className="tiny muted">Không nghe thấy? Tăng âm lượng, tắt chế độ im lặng.</span>
            </span>
          </li>
        </ol>
        {preview && <p className="alert alert-good">Chế độ xem trước: thầy cô thi thử được, ghi âm chỉ phát lại trên máy này, không gửi đi.</p>}
        <button className="btn btn-primary btn-block" type="button" onClick={start} disabled={mic !== "on"}>
          Bắt đầu thi · chuẩn bị {meta.speakPrep} giây
        </button>
        {onPractice && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={onPractice}>
            ← Về chế độ luyện tập
          </button>
        )}
      </section>
    );

  if (phase === "prep")
    return (
      <section className="panel speak-panel speak-live">
        <p className="eyebrow">Chuẩn bị</p>
        <div className="big-count">{clock(left)}</div>
        <p className="small muted">Ngồi thẳng, để micro gần miệng. Bài thi bắt đầu khi hết giờ.</p>
        <span className="speak-row">{meter}</span>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => skip.current?.()}>
          Em sẵn sàng, bắt đầu ngay
        </button>
      </section>
    );

  if (phase === "run" && cur)
    return (
      <section className="panel speak-panel speak-live">
        <div className="speak-progress">
          <span>
            Câu {step.i + 1}/{items.length} · {cur.part}
          </span>
          <span className="progress" aria-hidden="true">
            <i style={{ width: `${(step.i / items.length) * 100}%` }} />
          </span>
        </div>
        <div className={`speak-stage ${step.stage}`} role="status" aria-live="polite">
          {step.stage === "asking" && <b>🔊 Đang đọc câu hỏi…</b>}
          {step.stage === "thinking" && (
            <>
              <b>💭 Thời gian suy nghĩ</b>
              <span className="big-count">{clock(left)}</span>
              <span className="tiny muted">Em có thể ghi chú ý chính ra giấy.</span>
            </>
          )}
          {step.stage === "recording" && (
            <>
              <b>
                <span className="rec-dot" aria-hidden="true" /> Đang thu âm · còn {clock(left)}
              </b>
              {meter}
            </>
          )}
          {step.stage === "gap" && <b>✓ Đã lưu câu trả lời</b>}
        </div>
        <div className="speak-card">
          {cur.tag && <p className="eyebrow">{cur.tag}</p>}
          <div className="essay-prompt">
            <Rich text={cur.q} />
          </div>
          {cur.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="q-image" src={cur.imageUrl} alt="" />
          )}
        </div>
        {(step.stage === "recording" || step.stage === "thinking") && (
          <button className="btn btn-primary" type="button" onClick={() => skip.current?.()}>
            {step.stage === "recording" ? "Xong, sang câu tiếp →" : "Em sẵn sàng, bắt đầu nói"}
          </button>
        )}
      </section>
    );

  if (phase === "sending")
    return (
      <section className="panel speak-panel speak-live">
        <p className="eyebrow">Đang gửi bài</p>
        <h2>
          Đã gửi {Math.min(sent, items.length)}/{items.length} câu…
        </h2>
        <p className="small muted">Em giữ nguyên trang này đến khi gửi xong nhé.</p>
        {sendErr && (
          <>
            <p className="alert alert-bad">{sendErr}</p>
            <button className="btn btn-primary" type="button" onClick={send}>
              Gửi lại
            </button>
          </>
        )}
      </section>
    );

  return (
    <section className="panel speak-panel">
      <div>
        <p className="eyebrow">Hoàn thành</p>
        <h2>{preview ? "Đã thi thử xong" : "Đã nộp bài nói! 🎉"}</h2>
        <p className="small muted">
          {preview
            ? "Chế độ xem trước: các câu trả lời không được gửi đi."
            : `${teacher} sẽ nghe và chấm band theo 4 tiêu chí IELTS Speaking. Nhận xét hiện ở đầu trang bài này khi ${teacher} chấm xong.`}
        </p>
      </div>
      <div className="speak-replay">
        {items.map((it, i) => (
          <div key={it.key} className="speak-replay-row">
            <span className="tiny">
              <b>Câu {i + 1}.</b> {it.q.split("\n")[0]}
            </span>
            {clips[i] ? <audio controls preload="none" src={clips[i]!} /> : <span className="tiny muted">(không có ghi âm)</span>}
          </div>
        ))}
      </div>
      <div className="result-actions">
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => {
            uploads.current.clear();
            blobs.current.clear();
            transcripts.current = {};
            pendingTexts.current = [];
            setSent(0);
            setTrial("idle");
            setMic("off");
            setPhase("check");
          }}
        >
          Thi lại
        </button>
        <Link className="btn btn-ghost btn-sm" href="/">
          Về trang học tập
        </Link>
      </div>
    </section>
  );
}
