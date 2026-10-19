"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { MAX_SELF_NOTE_CHARS, MAX_TRANSCRIPT_CHARS, SPEAKING_CRITERIA, writingBand } from "@/convex/model";
import { toMp3 } from "@/lib/mp3";
import { plainText } from "@/lib/rich";
import { sttSupported, startTranscriber, type Transcriber } from "@/lib/speech-to-text";
import { Rich, errMsg } from "@/lib/ui";
import { withGuardPaused } from "./FocusGuard";
import { useSite } from "./SiteShell";

type QuizData = NonNullable<FunctionReturnType<typeof api.site.quiz>>;
type OkQuiz = Extract<QuizData, { status: "ok" }>;
type Meta = QuizData["meta"];
type PubSection = OkQuiz["sections"][number];

type Item = { key: string; q: string; tag: string; imageUrl: string | null; answerSec: number; prepSec: number };
type Part = { title: string; items: Item[] };
/** One recorded answer: a local or server URL to play, and the uploaded file once it's stored. */
type Rec = { url: string; storageId: string | null; status: "saving" | "saved" | "error"; seconds: number };

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const MAX_RECORD_SEC = 300;
const BANDS = Array.from({ length: 19 }, (_, i) => (i / 2).toFixed(1));
const CRITERIA_HELP = [
  "Nói liền mạch, phát triển ý và dùng liên kết tự nhiên.",
  "Dùng từ phù hợp, linh hoạt và biết diễn đạt lại.",
  "Dùng cấu trúc đơn và phức với độ chính xác phù hợp.",
  "Độ rõ, trọng âm, nhịp điệu và ngữ điệu.",
];

function partsOf(sections: PubSection[]): Part[] {
  return sections
    .map((s, si) => ({
      title: s.title,
      items: s.questions.flatMap((q, qi) =>
        q.type === "speak" ? [{ key: `${si}-${qi}`, q: q.q, tag: q.tag, imageUrl: q.image?.url ?? null, answerSec: q.answerSec, prepSec: q.prepSec }] : [],
      ),
    }))
    .filter((p) => p.items.length);
}

/** Current time, for event handlers (recording start, timers). */
const nowMs = () => Date.now();

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * IELTS Speaking practice at the student's own pace (the teacher's "Luyện nói, ghi âm, tự đánh giá"):
 * pick a part, record each answer (again if needed), get a transcript, mark yourself on the four
 * criteria, then hand it all in for the teacher to listen to.
 */
export default function SpeakingPractice({ meta, sections, preview, onExam }: { meta: Meta; sections: PubSection[]; preview: boolean; onExam?: () => void }) {
  const { token, teacher, toast } = useSite();
  // Frozen for this sitting, even if a teacher edits the quiz meanwhile.
  const [parts] = useState(() => partsOf(sections));
  const items = parts.flatMap((p) => p.items);
  const uploadUrl = useMutation(api.site.speakUploadUrl);
  const submit = useMutation(api.site.submit);
  const saveDraft = useMutation(api.drafts.save);
  const discardDraft = useMutation(api.drafts.discard);
  const draft = useQuery(api.drafts.get, !preview && token ? { token, id: meta.id } : "skip");

  const [part, setPart] = useState(0);
  const [idx, setIdx] = useState(0);
  const [recs, setRecs] = useState<Record<string, Rec>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [self, setSelf] = useState<string[]>(["", "", "", ""]);
  const [note, setNote] = useState("");
  const [recording, setRecording] = useState<{ key: string; startedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState("");
  const [auto, setAuto] = useState(true);
  const [canAuto, setCanAuto] = useState(false);
  const [micErr, setMicErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [restored, setRestored] = useState(false);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const transcriber = useRef<Transcriber | null>(null);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cur = parts[part]?.items[idx];
  const recorded = items.filter((it) => recs[it.key]?.storageId || (preview && recs[it.key])).length;
  const saving = Object.values(recs).some((r) => r.status === "saving");
  const selfBand = self.every((x) => x !== "") ? writingBand(self.map(Number)) : null;

  // Feature check after mount (no window during server rendering).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanAuto(sttSupported());
  }, []);

  // Carry on from a saved draft (any device).
  useEffect(() => {
    if (restored || preview || !token) return;
    if (draft === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
    if (!draft) return;
    try {
      const st = JSON.parse(draft.state) as { files?: Record<string, string>; texts?: Record<string, string>; self?: string[]; note?: string };
      const r: Record<string, Rec> = {};
      for (const [key, id] of Object.entries(st.files ?? {})) if (draft.fileUrls[id]) r[key] = { url: draft.fileUrls[id], storageId: id, status: "saved", seconds: 0 };
      setRecs(r);
      setTexts(st.texts ?? {});
      if (Array.isArray(st.self) && st.self.length === 4) setSelf(st.self);
      setNote(st.note ?? "");
    } catch {
      /* unreadable draft: start fresh */
    }
  }, [draft, restored, preview, token]);

  // Save the draft a moment after each change, so nothing is lost if the tab closes.
  useEffect(() => {
    if (preview || !token || !restored || done) return;
    const files: Record<string, string> = {};
    for (const [k, r] of Object.entries(recs)) if (r.storageId) files[k] = r.storageId;
    if (!Object.keys(files).length && !Object.values(texts).some(Boolean)) return;
    const t = setTimeout(() => {
      saveDraft({
        token,
        id: meta.id,
        state: JSON.stringify({ files, texts, self, note }),
        answered: Object.keys(files).length,
        total: items.length,
        elapsedSec: 0,
        files: Object.values(files),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [recs, texts, self, note, restored, done, preview, token, meta.id, items.length, saveDraft]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(
    () => () => {
      try {
        if (recorder.current?.state === "recording") recorder.current.stop();
      } catch {
        /* ignore */
      }
      transcriber.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
    },
    [],
  );

  async function micStream() {
    if (stream.current?.active) return stream.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined")
      throw new Error("Trình duyệt này chưa thu âm được. Em mở bài bằng Chrome, Edge hoặc Safari bản mới nhé.");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      return stream.current;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      throw new Error(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Em chưa cho phép dùng micro. Bấm biểu tượng ổ khoá cạnh địa chỉ web → cho phép Micro, rồi bấm ghi âm lại."
          : name === "NotFoundError"
            ? "Không tìm thấy micro. Em cắm tai nghe có micro hoặc dùng máy khác."
            : "Chưa bật được micro. Em đóng các ứng dụng khác đang dùng micro rồi thử lại.",
      );
    }
  }

  async function upload(key: string, blob: Blob) {
    try {
      const mp3 = await toMp3(blob);
      let storageId: string | null = null;
      if (!preview) {
        const url = await uploadUrl({ token: token ?? undefined, id: meta.id });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": mp3.type }, body: mp3 });
        if (!res.ok) throw new Error(String(res.status));
        storageId = ((await res.json()) as { storageId: string }).storageId;
      }
      setRecs((r) => (r[key] ? { ...r, [key]: { ...r[key], storageId, status: "saved" } } : r));
    } catch {
      setRecs((r) => (r[key] ? { ...r, [key]: { ...r[key], status: "error" } } : r));
    }
  }

  async function startRecording(key: string) {
    setMicErr("");
    let s: MediaStream;
    try {
      s = await micStream();
    } catch (e) {
      setMicErr(errMsg(e));
      return;
    }
    window.speechSynthesis?.cancel();
    const mime = MIME_TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t)) ?? "";
    const rec = new window.MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
    const chunks: Blob[] = [];
    const startedAt = nowMs();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const type = (rec.mimeType || "audio/webm").split(";")[0].replace(/^video\//, "audio/");
      const blob = new Blob(chunks, { type });
      const said = transcriber.current ? await transcriber.current.stop() : "";
      transcriber.current = null;
      setLive("");
      if (said) setTexts((t) => ({ ...t, [key]: [t[key], said].filter(Boolean).join(" ").slice(0, MAX_TRANSCRIPT_CHARS) }));
      setRecs((r) => ({ ...r, [key]: { url: URL.createObjectURL(blob), storageId: null, status: "saving", seconds: (Date.now() - startedAt) / 1000 } }));
      upload(key, blob);
    };
    recorder.current = rec;
    rec.start(1000);
    setRecording({ key, startedAt });
    setNow(nowMs());
    if (auto && canAuto) {
      transcriber.current = startTranscriber(
        meta.accent === "us" ? "en-US" : "en-GB",
        (fin, interim) => setLive([fin, interim].filter(Boolean).join(" ")),
        () => setCanAuto(false),
      );
    }
    autoStop.current = setTimeout(() => stopRecording(), MAX_RECORD_SEC * 1000);
  }

  function stopRecording() {
    if (autoStop.current) clearTimeout(autoStop.current);
    try {
      if (recorder.current?.state === "recording") recorder.current.stop();
    } catch {
      /* ignore */
    }
    setRecording(null);
  }

  function readQuestion(q: string) {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(plainText(q).replace(/[•*_#>`]/g, "").replace(/\s+/g, " "));
      u.lang = meta.accent === "us" ? "en-US" : "en-GB";
      u.rate = 0.92;
      const v = synth.getVoices().find((x) => x.lang.replace("_", "-").toLowerCase() === u.lang.toLowerCase());
      if (v) u.voice = v;
      synth.speak(u);
    } catch {
      toast("Máy này chưa đọc được câu hỏi.");
    }
  }

  function go(p: number, i: number) {
    if (recording) stopRecording();
    setPart(p);
    setIdx(i);
  }

  async function handIn() {
    if (busy || saving) return;
    const missing = items.length - recorded;
    if (missing > 0 && !withGuardPaused(() => window.confirm(`Còn ${missing} câu chưa ghi âm. Em vẫn muốn nộp bài?`))) return;
    if (preview) {
      setDone(true);
      return;
    }
    setBusy(true);
    try {
      const answers: Record<string, string> = {};
      for (const [k, r] of Object.entries(recs)) if (r.storageId) answers[k] = r.storageId;
      const transcripts: Record<string, string> = {};
      for (const [k, t] of Object.entries(texts)) if (t.trim()) transcripts[k] = t.trim();
      await submit({
        token: token ?? undefined,
        id: meta.id,
        answers,
        transcripts,
        mode: "practice",
        ...(self.every((x) => x !== "") ? { selfReview: { criteria: self.map(Number), note } } : {}),
      });
      setDone(true);
    } catch (e) {
      toast(errMsg(e, "Chưa nộp được bài. Kiểm tra mạng rồi thử lại."));
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    if (!withGuardPaused(() => window.confirm("Xoá các câu đã ghi và làm lại chủ đề này từ đầu?"))) return;
    if (token && !preview) await discardDraft({ token, id: meta.id }).catch(() => {});
    setRecs({});
    setTexts({});
    setSelf(["", "", "", ""]);
    setNote("");
    setDone(false);
    go(0, 0);
  }

  if (!parts.length) return <p className="empty">Bài này chưa có câu hỏi Speaking.</p>;

  if (done)
    return (
      <section className="panel speak-panel">
        <p className="eyebrow">Đã nộp</p>
        <h2>{preview ? "Đã luyện thử xong" : "Đã nộp bài nói! 🎉"}</h2>
        <p className="small muted">
          {preview
            ? "Chế độ xem trước: bài không được gửi đi."
            : `${recorded} câu ghi âm${Object.values(texts).some(Boolean) ? ", bản chép lời" : ""}${selfBand != null ? ` và band tự đánh giá ${selfBand.toFixed(1)}` : ""} đã được gửi cho ${teacher}. Nhận xét hiện ở đầu trang này khi ${teacher} chấm xong.`}
        </p>
        <div className="result-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={startOver}>
            Luyện lại chủ đề này
          </button>
        </div>
      </section>
    );

  const r = cur ? recs[cur.key] : undefined;
  const isRec = recording?.key === cur?.key;
  const elapsed = recording ? (now - recording.startedAt) / 1000 : 0;

  return (
    <div className="sp-wrap">
      <div className="sp-grid">
        <section className="panel sp-question">
          <div className="sp-tabs" role="tablist" aria-label="Phần thi">
            {parts.map((p, pi) => (
              <button key={pi} type="button" role="tab" aria-selected={pi === part} className={pi === part ? "on" : ""} onClick={() => go(pi, 0)}>
                {/part\s*\d/i.exec(p.title)?.[0] ?? `Phần ${pi + 1}`}
              </button>
            ))}
          </div>
          {cur && (
            <>
              <div className="sp-card">
                <p className="eyebrow">{cur.tag || parts[part].title}</p>
                <div className="sp-q">
                  <Rich text={cur.q} />
                </div>
                {cur.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="q-image" src={cur.imageUrl} alt="" />
                )}
                <p className="tiny muted">
                  {cur.prepSec > 0 ? `Chuẩn bị khoảng ${cur.prepSec} giây, rồi nói khoảng ${Math.round(cur.answerSec / 60) || 1}–2 phút.` : `Nói khoảng ${cur.answerSec} giây.`}{" "}
                  <button className="link-btn" type="button" onClick={() => readQuestion(cur.q)}>
                    🔊 Nghe câu hỏi
                  </button>
                </p>
              </div>
              <div className="sp-nav">
                <span className="tiny muted">
                  Câu {idx + 1} / {parts[part].items.length}
                </span>
                <span className="sp-nav-btns">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={part === 0 && idx === 0}
                    onClick={() => (idx > 0 ? go(part, idx - 1) : go(part - 1, parts[part - 1].items.length - 1))}
                  >
                    ← Câu trước
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={part === parts.length - 1 && idx === parts[part].items.length - 1}
                    onClick={() => (idx < parts[part].items.length - 1 ? go(part, idx + 1) : go(part + 1, 0))}
                  >
                    Câu tiếp →
                  </button>
                </span>
              </div>
            </>
          )}
        </section>

        <section className="panel sp-answer">
          <div className="sp-answer-head">
            <div>
              <p className="eyebrow">Your response</p>
              <h2>Phần trả lời</h2>
            </div>
            <span className={`status ${isRec ? "off" : r?.status === "saved" ? "on" : "draft"}`}>
              {isRec ? "Đang ghi" : r?.status === "saving" ? "Đang lưu…" : r?.status === "error" ? "Lưu lỗi" : r ? "Đã ghi" : "Sẵn sàng"}
            </span>
          </div>
          <button
            className={`sp-record${isRec ? " on" : ""}`}
            type="button"
            onClick={() => (isRec ? stopRecording() : cur && startRecording(cur.key))}
            disabled={!!recording && !isRec}
            aria-label={isRec ? "Dừng ghi âm" : r ? "Ghi lại câu này" : "Bắt đầu ghi âm"}
          >
            <span />
          </button>
          <p className="sp-clock">{clock(isRec ? elapsed : r?.seconds ?? 0)}</p>
          <p className="tiny muted" style={{ textAlign: "center" }}>
            {isRec ? "Bấm nút đỏ để dừng." : r ? "Bấm nút đỏ để ghi lại câu này." : "Bấm nút đỏ để bắt đầu nói."}
          </p>
          {micErr && <p className="alert alert-bad">{micErr}</p>}
          {r && !isRec && <audio className="section-audio" controls src={r.url} />}
          {r?.status === "error" && <p className="alert alert-bad">Chưa lưu được câu này. Em kiểm tra mạng rồi bấm nút đỏ để ghi lại.</p>}
        </section>
      </div>

      {cur && (
        <section className="panel">
          <div className="sp-answer-head">
            <div>
              <p className="eyebrow">Bản chép lời · câu {items.findIndex((it) => it.key === cur.key) + 1}</p>
              <h2>Phần em đã nói</h2>
            </div>
            {canAuto && (
              <label className="switch" title="Trình duyệt tự chuyển giọng nói của em thành chữ trong lúc ghi âm">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!!recording} />
                ✨ Tự chép lời khi ghi âm
              </label>
            )}
          </div>
          <p className="tiny muted">
            {canAuto && auto
              ? "Em nói, máy tự chép thành chữ; em sửa lại chỗ sai nếu cần. Bản chép lời được gửi cùng bài nộp để thầy cô xem."
              : "Gõ hoặc dán lại phần em đã nói. Bản chép lời được gửi cùng bài nộp để thầy cô xem."}{" "}
            Không nhập thông tin cá nhân vào đây.
          </p>
          {isRec && live && <p className="sp-live">🎙️ {live}</p>}
          <textarea
            className="textarea prose"
            rows={4}
            value={texts[cur.key] ?? ""}
            maxLength={MAX_TRANSCRIPT_CHARS}
            onChange={(e) => setTexts((t) => ({ ...t, [cur.key]: e.target.value }))}
            placeholder="Type or paste your spoken answer here…"
            aria-label="Bản chép lời"
          />
          <p className="tiny muted" style={{ textAlign: "right" }}>
            {(texts[cur.key] ?? "").length.toLocaleString("vi-VN")}/{MAX_TRANSCRIPT_CHARS.toLocaleString("vi-VN")} ký tự
          </p>
        </section>
      )}

      <section className="panel">
        <div className="sp-answer-head">
          <div>
            <p className="eyebrow">Self review</p>
            <h2>Phiếu tự đánh giá theo 4 tiêu chí</h2>
            <p className="small muted">Chọn band theo cảm nhận của em. Đây là điểm luyện tập, không phải điểm IELTS chính thức.</p>
          </div>
          <div className="sp-selfband">
            <span className="tiny">Band tự đánh giá</span>
            <b>{selfBand != null ? selfBand.toFixed(1) : "—"}</b>
          </div>
        </div>
        <div className="sp-criteria">
          {SPEAKING_CRITERIA.map((c, i) => (
            <label key={c} className="sp-criterion">
              <b>{c}</b>
              <span className="tiny muted">{CRITERIA_HELP[i]}</span>
              <select className="select compact" value={self[i]} onChange={(e) => setSelf((s) => s.map((x, j) => (j === i ? e.target.value : x)))}>
                <option value="">Chọn band</option>
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="field">
          <label htmlFor="sp-note">
            Nhận xét hoặc mục tiêu lần sau <span className="hint">(không bắt buộc)</span>
          </label>
          <textarea
            id="sp-note"
            className="textarea prose"
            rows={2}
            maxLength={MAX_SELF_NOTE_CHARS}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: Dùng thêm ví dụ cụ thể và nối ý tự nhiên hơn…"
          />
        </div>
        <div className="sp-submit">
          <button className="btn btn-primary" type="button" onClick={handIn} disabled={busy || saving || recorded === 0 || !!recording}>
            {busy ? "Đang nộp…" : saving ? "Đang lưu ghi âm…" : recorded === 0 ? "Ghi âm trước khi nộp" : `Nộp bài (${recorded}/${items.length} câu đã ghi)`}
          </button>
          {onExam && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={onExam} disabled={!!recording}>
              ⏱ Chuyển sang thi thử
            </button>
          )}
          {(recorded > 0 || Object.values(texts).some(Boolean)) && (
            <button className="link-btn" type="button" onClick={startOver}>
              Làm lại từ đầu
            </button>
          )}
        </div>
        <p className="tiny muted">
          Band tự chấm theo rubric chỉ để em luyện tập. {teacher} nghe file ghi âm để nhận xét phát âm và độ trôi chảy chính xác hơn. Bài được tự lưu, lần sau em vào là làm
          tiếp được.
        </p>
      </section>
    </div>
  );
}
