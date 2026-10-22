"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Answers } from "@/convex/model";
import { RECORDING_KEEP_DAYS, SPEAKING_CRITERIA, WRITING_CRITERIA, writingBand, normAnswer, parseDialogue, wordCount } from "@/convex/model";
import { Rich, copyText, errMsg, sdel, sget, shuffle, signalReady, sset, stamp } from "@/lib/ui";
import { GateLogin, GateNoAccess, Loading, Missing, Swoosh, examTime } from "./parts";
import { useSite } from "./SiteShell";
import FocusGuard, { withGuardPaused } from "./FocusGuard";
import SpeakingPractice from "./SpeakingPractice";
import SpeakingRunner from "./SpeakingRunner";

type QuizData = NonNullable<FunctionReturnType<typeof api.site.quiz>>;
type OkQuiz = Extract<QuizData, { status: "ok" }>;
type Meta = QuizData["meta"];
type PubSection = OkQuiz["sections"][number];
type PubQuestion = PubSection["questions"][number];
type Submitted = FunctionReturnType<typeof api.site.submit>;

type SecAttempt = { si: number; order: number[]; opts: Record<number, number[]> };
type Attempt = {
  sections: SecAttempt[];
  answers: Answers;
  submitted: boolean;
  outcome?: Submitted;
  /** When this sitting started (drives the countdown; survives reloads via the draft). */
  startedAt: number;
  /** When the draft was last saved; a sitting resumed much later gets its clock shifted by the gap. */
  savedAt?: number;
};

/** A reload within this long keeps the clock running; a later return carries on with the time left. */
const PAUSE_AFTER_MS = 10 * 60 * 1000;

export default function QuizView({ id }: { id: string }) {
  const { token, adminToken, teacher } = useSite();
  const live = useQuery(api.site.quiz, token === undefined ? "skip" : { token: token ?? undefined, adminToken: adminToken ?? undefined, id });
  // Submitting a winning attempt flips the quiz to "mastered"; keep showing this sitting's result.
  const [sitting, setSitting] = useState<OkQuiz | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (live?.status === "ok") setSitting(live);
  }, [live]);
  // Same when an exam closes while the student is still answering: they finish within the grace period.
  const data = (live?.status === "mastered" || live?.status === "examClosed") && sitting ? sitting : live;
  // Locked out for leaving a guarded test: the session is gone, so show this instead of the login gate.
  const [lockedOut, setLockedOut] = useState(false);

  useEffect(() => {
    if (data !== undefined) signalReady();
    if (data) document.title = `${data.meta.title} · TEDU English`;
    return () => {
      document.title = "TEDU English";
    };
  }, [data]);

  if (lockedOut)
    return (
      <section className="gate guard-locked" role="alert">
        <div>
          <p className="eyebrow">Tài khoản đã bị khoá</p>
          <h2>🔒 Em đã rời khỏi bài khi đang làm</h2>
          <p className="small muted">Phần bài em làm đến lúc đó đã được gửi cho {teacher}. Em liên hệ {teacher} để được mở lại tài khoản.</p>
        </div>
        <Link className="btn btn-primary" href="/">
          Về trang chủ
        </Link>
      </section>
    );
  if (data === undefined) return <Loading />;
  if (data === null) return <Missing />;
  const m = data.meta;

  return (
    <>
      <Link className="back-link" href="/">
        ← Trang học tập
      </Link>
      <section className="banner view-enter">
        <Swoosh />
        <p className="eyebrow">{m.folderName}</p>
        <h1>{m.title}</h1>
        {m.subtitle && <p>{m.subtitle}</p>}
        <div className="banner-meta">
          <span>{m.questionCount} câu</span>
          {m.minutes > 0 && <span>{m.timer === "off" ? `Khoảng ${m.minutes} phút` : `⏱ ${m.minutes} phút${m.timer === "auto" ? " · tự nộp khi hết giờ" : ""}`}</span>}
          {m.exam && <span>🎯 Bài thi tập trung · làm 1 lần</span>}
          {m.hasSpeak ? <span>🎤 Ghi âm · {teacher} chấm band</span> : m.hasEssay ? <span>Có bài viết · {teacher} nhận xét</span> : <span>Chấm tự động</span>}
          {(m.ielts === "listening" || m.ielts === "reading") && <span>Band tham khảo</span>}
        </div>
      </section>
      {data.status === "login" && <GateLogin title="Đăng nhập để làm bài" note="Nhập mã cá nhân trước, sau đó em sẽ vào thẳng bài này." />}
      {data.status === "noaccess" && <GateNoAccess name={m.folderName} />}
      {data.status === "locked" && <UnlockGate meta={m} />}
      {data.status === "examWait" && <ExamWait opensAt={m.exam?.opensAt ?? null} />}
      {data.status === "examClosed" && (
        <section className="gate">
          <div>
            <p className="eyebrow">Bài thi</p>
            <h2>Bài thi đã đóng</h2>
            <p className="small muted">Giờ thi đã kết thúc. Nếu em có lý do vắng thi, em nhắn {teacher} nhé.</p>
          </div>
          <Link className="btn btn-primary" href="/">
            Về trang học tập
          </Link>
        </section>
      )}
      {data.status === "examDone" && <ExamDone result={data.result} sections={data.sections} ielts={!!m.ielts} />}
      {data.status === "mastered" && (
        <section className="gate">
          <div>
            <p className="eyebrow">Đã hoàn thành</p>
            <h2>
              Em đã làm bài này đạt {data.best.correct}/{data.best.total} ({Math.round((data.best.correct / data.best.total) * 100)}%) 🎉
            </h2>
            <p className="small muted">
              Bài đạt từ {m.lockAtPercent}% trở lên được khoá lại để em chuyển sang bài khác. Nếu cần làm lại, em nhắn {teacher} mở lại nhé.
            </p>
          </div>
          <Link className="btn btn-primary" href="/">
            Về trang học tập
          </Link>
        </section>
      )}
      {data.status === "ok" && data.preview && (
        <p className="alert alert-good" style={{ marginTop: 18 }}>
          <b>Chế độ xem trước của giáo viên.</b> Thầy cô làm thử và nộp bình thường để xem chấm điểm, nhưng kết quả không được lưu.
          {!m.published && " Bài này đang là bản nháp, học sinh chưa thấy."}
        </p>
      )}
      {data.status === "ok" && !data.preview && (m.hasEssay || m.hasSpeak) && <MyWriting id={m.id} speaking={m.hasSpeak} />}
      {data.status === "ok" &&
        (m.hasSpeak ? (
          <SpeakingTest key={m.id} meta={m} sections={data.sections} preview={data.preview} />
        ) : (
          <QuizRunner key={m.id} meta={m} sections={data.sections} preview={data.preview} guardUsed={data.guardUsed} onLockedOut={() => setLockedOut(true)} />
        ))}
    </>
  );
}

function UnlockGate({ meta }: { meta: Meta }) {
  const { token, teacher } = useSite();
  const unlock = useMutation(api.site.unlock);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    try {
      const r = await unlock({ token, id: meta.id, code });
      if (!r.ok) setErr(r.error);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gate">
      <div>
        <p className="eyebrow">Bài có mã riêng</p>
        <h2>Nhập mã bài</h2>
        <p className="small muted">Bài này cần thêm mã do {teacher} đọc trên lớp hoặc gửi trong nhóm.</p>
      </div>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="quiz-code">Mã bài {meta.title}</label>
          <input className="input" id="quiz-code" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Nhập mã bài" required value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <p className="alert alert-bad" role="alert" hidden={!err}>
          {err}
        </p>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Mở bài
        </button>
      </form>
    </section>
  );
}

/* ---------- scheduled exams ---------- */

/** Before the exam opens: a countdown. The page switches to the test by itself when the teacher's schedule opens it. */
function ExamWait({ opensAt }: { opensAt: number | null }) {
  const { teacher } = useSite();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = opensAt ? Math.max(0, Math.round((opensAt - now) / 1000)) : null;
  const d = left != null ? Math.floor(left / 86400) : 0;
  return (
    <section className="gate">
      <div>
        <p className="eyebrow">Bài thi tập trung</p>
        <h2>🔒 Đề thi chưa mở</h2>
        {opensAt ? (
          <>
            <p className="small muted">Đề sẽ mở lúc {examTime(opensAt)}. Em giữ nguyên trang này, đến giờ bài thi tự hiện ra.</p>
            <p className="exam-count">{left ? `${d ? `${d} ngày ` : ""}${clock(left % 86400)}` : "Đang mở đề…"}</p>
          </>
        ) : (
          <p className="small muted">{teacher} sẽ mở đề khi đến giờ thi. Em giữ nguyên trang này, bài thi sẽ tự hiện ra.</p>
        )}
        <p className="tiny muted">Mỗi em chỉ làm 1 lần. Chuẩn bị tai nghe, kiểm tra mạng và không chuyển tab khi đang thi.</p>
      </div>
    </section>
  );
}

type ExamDoneData = Extract<QuizData, { status: "examDone" }>;

/** After handing in: wait for the results, then the score, band and the answers to what the student did. */
function ExamDone({ result, sections, ielts }: { result: ExamDoneData["result"]; sections: ExamDoneData["sections"]; ielts: boolean }) {
  const { teacher } = useSite();
  if (!result)
    return (
      <section className="gate">
        <div>
          <p className="eyebrow">Bài thi tập trung</p>
          <h2>✓ Em đã nộp bài thi</h2>
          <p className="small muted">Kết quả sẽ hiện ở đây khi {teacher} công bố. Mỗi em chỉ làm 1 lần nên em không cần làm lại.</p>
        </div>
        <Link className="btn btn-primary" href="/">
          Về trang học tập
        </Link>
      </section>
    );
  const pct = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  let num = 0;
  return (
    <div className="quiz-wrap">
      <section className="result">
        <div className="score-dial" style={{ "--p": result.total ? pct : 100 } as React.CSSProperties}>
          <div className="inner">
            {result.total ? (
              <>
                <b>
                  {result.correct}/{result.total}
                </b>
                <small>{pct}%</small>
              </>
            ) : (
              <b style={{ fontSize: "2.2rem" }}>✓</b>
            )}
          </div>
        </div>
        <div>
          <p className="eyebrow">Kết quả bài thi</p>
          <h2>{ielts && result.band != null ? `Band ${result.band.toFixed(1)}` : "Đã có kết quả"}</h2>
          <p className="r-msg">Nộp lúc {stamp(result.submittedAt)}. Đáp án chỉ hiện cho những câu em đã làm.</p>
        </div>
      </section>
      {sections?.map((sec, si) => (
        <section className="q-section" key={si}>
          <h2 className="q-section-title">{sec.title || "Câu hỏi"}</h2>
          {sec.questions.map((q, qi) => {
            num++;
            const key = `${si}-${qi}`;
            const r = result.review[key];
            if (!r || r.essay) return null;
            const given = result.answers[key];
            const shown = (v: unknown) => (q.type === "mcq" && typeof v === "number" ? q.options[v] ?? "" : String(v ?? ""));
            return (
              <article key={key} className={`q-card${r.ok ? " ok" : r.answered ? " no" : ""}`}>
                <div className="q-head">
                  <span>Câu {num}</span>
                  {r.ok ? <span className="state-ok">Đúng</span> : <span className="state-no">{r.answered ? "Chưa đúng" : "Chưa làm"}</span>}
                </div>
                <p className="q-text">
                  <Rich text={q.q} />
                </p>
                <p className="explain">
                  {r.answered ? (
                    <>
                      Em trả lời: <b>{shown(given)}</b> · Đáp án: <b>{shown(r.answer)}</b>
                      {r.explain ? ` · ${r.explain}` : ""}
                    </>
                  ) : (
                    "🔒 Em chưa làm câu này nên đáp án được ẩn."
                  )}
                </p>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/* ---------- Speaking: practice at your own pace, or a timed mock test ---------- */

function SpeakingTest({ meta, sections, preview }: { meta: Meta; sections: PubSection[]; preview: boolean }) {
  const { token } = useSite();
  // A practice session saved earlier goes straight back to practice.
  const draft = useQuery(api.drafts.get, !preview && token && meta.speakMode === "both" ? { token, id: meta.id } : "skip");
  const [picked, setPicked] = useState<"practice" | "exam" | null>(null);
  // Latch it: submitting deletes the draft, which must not send the student back to the chooser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (draft && !picked) setPicked("practice");
  }, [draft, picked]);
  const mode = meta.speakMode === "both" ? (picked ?? (draft ? "practice" : null)) : meta.speakMode;
  const both = meta.speakMode === "both";

  if (mode === "practice")
    return <SpeakingPractice meta={meta} sections={sections} preview={preview} onExam={both ? () => setPicked("exam") : undefined} />;
  if (mode === "exam") return <SpeakingRunner meta={meta} sections={sections} preview={preview} onPractice={both ? () => setPicked("practice") : undefined} />;
  if (!preview && token && draft === undefined) return <Loading />;
  return (
    <section className="panel speak-panel">
      <div>
        <p className="eyebrow">IELTS Speaking</p>
        <h2>Em muốn làm theo cách nào?</h2>
      </div>
      <div className="sp-modes">
        <button className="sp-mode" type="button" onClick={() => setPicked("practice")}>
          <span className="sp-mode-icon">🎙️</span>
          <b>Luyện tập</b>
          <span className="small muted">Tự ghi âm từng câu, nghe lại và ghi lại thoải mái, có bản chép lời và phiếu tự đánh giá 4 tiêu chí.</span>
        </button>
        <button className="sp-mode" type="button" onClick={() => setPicked("exam")}>
          <span className="sp-mode-icon">⏱</span>
          <b>Thi thử</b>
          <span className="small muted">Như phòng thi: máy đọc câu hỏi, kêu “tít”, tính giờ và tự chuyển câu.</span>
        </button>
      </div>
    </section>
  );
}

/* ---------- attempt ---------- */

const FIXED = /^(true|false|not given|yes|no)$/i;

function newAttempt(sections: PubSection[], mix: boolean): Attempt {
  return {
    answers: {},
    submitted: false,
    startedAt: Date.now(),
    sections: sections.map((sec, si) => {
      const keep = !mix || !!(sec.listen || sec.audio || sec.passage) || sec.questions.some((q) => q.type === "essay");
      const order = sec.questions.map((_, i) => i);
      const opts: Record<number, number[]> = {};
      sec.questions.forEach((q, qi) => {
        if (q.type === "mcq") {
          const o = q.options.map((_, i) => i);
          opts[qi] = keep || q.options.every((x) => FIXED.test(x)) ? o : shuffle(o);
        }
      });
      return { si, order: keep ? order : shuffle(order), opts };
    }),
  };
}

function draftFits(d: Attempt | null, sections: PubSection[]): d is Attempt {
  return (
    !!d &&
    !d.submitted &&
    Array.isArray(d.sections) &&
    d.sections.length === sections.length &&
    d.sections.every((s, i) => s.order.length === sections[i].questions.length)
  );
}

function answeredCount(sections: PubSection[], answers: Answers) {
  let n = 0;
  sections.forEach((sec, si) =>
    sec.questions.forEach((q, qi) => {
      const v = answers[`${si}-${qi}`];
      if (q.type === "essay" ? wordCount(v) > 0 : q.type === "fill" ? normAnswer(v) !== "" : typeof v === "number") n++;
    }),
  );
  return n;
}

function QuizRunner({
  meta,
  sections: liveSections,
  preview,
  guardUsed,
  onLockedOut,
}: {
  meta: Meta;
  sections: PubSection[];
  preview: boolean;
  guardUsed: number;
  onLockedOut: () => void;
}) {
  const { token, adminToken, teacher, home, toast, signOut } = useSite();
  const router = useRouter();
  const submitMut = useMutation(api.site.submit);
  const saveDraftMut = useMutation(api.drafts.save);
  const discardDraftMut = useMutation(api.drafts.discard);
  // The copy saved on the server, so an unfinished test can be continued on any device.
  const serverDraft = useQuery(api.drafts.get, !preview && token ? { token, id: meta.id } : "skip");
  const restored = useRef(false);
  const [resumed, setResumed] = useState(false);
  // Leaving a guarded test counts, unless it is because the student just submitted it.
  const guardArmed = useRef(true);
  // Freeze the questions for this sitting, even if a teacher edits the quiz meanwhile.
  const [sections] = useState(liveSections);
  // Long essays must survive a closed tab, so drafts live in localStorage, per student.
  const who = preview ? "preview" : `${home?.student?.name ?? ""}|${home?.student?.className ?? ""}`;
  const draftKey = `tedu.draft.${who}.${meta.id}`;
  const limitSec = meta.timer !== "off" && meta.minutes > 0 ? meta.minutes * 60 : 0;
  const [att, setAtt] = useState<Attempt>(() => newAttempt(sections, false));
  const [busy, setBusy] = useState(false);
  const [showCopy, setShowCopy] = useState<string | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Restore an unfinished sitting: the newer of this browser's copy and the server's.
  useEffect(() => {
    if (restored.current) return;
    if (!preview && token && serverDraft === undefined) return; // wait for the server copy
    restored.current = true;
    const local = sget<Attempt | null>("localStorage", draftKey, null);
    let remote: Attempt | null = null;
    if (serverDraft)
      try {
        const p = JSON.parse(serverDraft.state) as Pick<Attempt, "sections" | "answers">;
        remote = { ...p, submitted: false, savedAt: serverDraft.updatedAt, startedAt: serverDraft.updatedAt - serverDraft.elapsedSec * 1000 };
      } catch {
        /* unreadable copy: start fresh */
      }
    const pick = [local, remote].filter((d): d is Attempt => draftFits(d, sections)).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
    if (!pick) return;
    // Back after a while: carry on with the time that was left, not the time that passed.
    const gap = pick.savedAt ? Date.now() - pick.savedAt : 0;
    const startedAt = !pick.savedAt ? Date.now() : gap > PAUSE_AFTER_MS ? pick.startedAt + gap : pick.startedAt;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAtt({ ...pick, startedAt });
    if (answeredCount(sections, pick.answers) > 0) setResumed(true);
  }, [draftKey, sections, serverDraft, preview, token]);

  useEffect(() => {
    // Saved even before the first answer so a reload can't restart the clock
    // (but not before the saved copy is read, or it would be overwritten).
    if (restored.current && !att.submitted) sset("localStorage", draftKey, { ...att, savedAt: Date.now() });
  }, [att, draftKey]);

  /* ---------- countdown ---------- */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!limitSec || att.submitted) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [limitSec, att.submitted]);
  const remaining = limitSec ? Math.max(0, Math.ceil(limitSec - (now - att.startedAt) / 1000)) : null;
  const autoSubmitted = useRef(false);

  const total = meta.questionCount;
  const answered = answeredCount(sections, att.answers);

  /* ---------- saving the unfinished test on the server ---------- */
  const pushDraft = useCallback(async () => {
    if (preview || !token || att.submitted || !restored.current || answeredCount(sections, att.answers) === 0) return false;
    return saveDraftMut({
      token,
      id: meta.id,
      state: JSON.stringify({ sections: att.sections, answers: att.answers }),
      answered: answeredCount(sections, att.answers),
      total,
      elapsedSec: (Date.now() - att.startedAt) / 1000,
    });
  }, [preview, token, att, sections, saveDraftMut, meta.id, total]);
  const pushRef = useRef(pushDraft);
  useEffect(() => {
    pushRef.current = pushDraft;
  });
  // A few seconds after each change, and right away when the page is hidden (phone locked, app switched).
  useEffect(() => {
    const t = setTimeout(() => pushRef.current().catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [att.answers]);
  useEffect(() => {
    const flush = () => document.visibilityState === "hidden" && pushRef.current().catch(() => {});
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  async function saveAndLeave() {
    try {
      await pushDraft();
      toast("Đã lưu bài. Lần sau em vào trang học tập, bấm “Em vào làm tiếp nhé” để làm tiếp.");
      router.push("/");
    } catch (e) {
      toast(errMsg(e, "Chưa lưu được bài. Em kiểm tra mạng rồi thử lại."));
    }
  }

  async function startOver() {
    if (!withGuardPaused(() => window.confirm("Xoá phần đã làm và làm lại bài này từ đầu?"))) return;
    if (token) await discardDraftMut({ token, id: meta.id }).catch(() => {});
    sdel("localStorage", draftKey);
    autoSubmitted.current = false;
    setAtt(newAttempt(sections, false));
    setResumed(false);
  }

  function setAnswer(key: string, value: string | number) {
    setAtt((a) => (a.submitted ? a : { ...a, answers: { ...a.answers, [key]: value } }));
  }

  /* ---------- listening (browser text-to-speech) ---------- */
  const [tts, setTts] = useState<{ sec: number | null; playing: boolean; paused: boolean; msg: string }>({ sec: null, playing: false, paused: false, msg: "" });
  const [rate, setRate] = useState(0.9);
  const [accent, setAccent] = useState<"uk" | "us">(meta.accent);
  const ttsToken = useRef(0);

  const ttsStop = useCallback(() => {
    ttsToken.current++;
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.getVoices(); // voices load asynchronously
    } catch {
      /* ignore */
    }
    return ttsStop;
  }, [ttsStop]);

  function ttsPlay(si: number, r = rate, acc = accent) {
    const sec = sections[si];
    if (!sec?.listen) return;
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      setTts({ sec: si, playing: false, paused: false, msg: "Trình duyệt này chưa hỗ trợ đọc audio. Em thử mở bằng Chrome, Edge hoặc Safari bản mới nhé." });
      return;
    }
    ttsStop();
    const synth = window.speechSynthesis;
    const voices = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    const regional = voices.filter((v) => (acc === "us" ? /us/i : /gb/i).test(v.lang));
    const pool = regional.length ? regional : voices;
    const speakers: Record<string, number> = {};
    let count = 0;
    const lines = parseDialogue(sec.listen);
    const tok = ++ttsToken.current;

    lines.forEach((line, i) => {
      const who = line.speaker ?? "_";
      if (!(who in speakers)) speakers[who] = count++;
      const u = new window.SpeechSynthesisUtterance(line.text);
      u.lang = acc === "us" ? "en-US" : "en-GB";
      u.rate = r;
      if (pool.length) u.voice = pool[speakers[who] % pool.length];
      if (pool.length < 2) u.pitch = speakers[who] % 2 ? 1.15 : 0.92; // tell speakers apart with one voice
      if (i === lines.length - 1) {
        u.onend = () => {
          if (ttsToken.current !== tok) return;
          setTts({ sec: si, playing: false, paused: false, msg: "Đã phát xong. Em có thể phát lại hoặc nộp bài." });
        };
      }
      u.onerror = (e) => {
        if (ttsToken.current !== tok || e.error === "canceled" || e.error === "interrupted") return;
        setTts({ sec: si, playing: false, paused: false, msg: "Không phát được audio trên thiết bị này. Em kiểm tra âm lượng hoặc thử trình duyệt khác." });
      };
      synth.speak(u);
    });
    setTts({ sec: si, playing: true, paused: false, msg: "Đang phát… Nghe và trả lời các câu bên dưới." });
  }

  /* ---------- submit / retry ---------- */
  async function submit(auto = false) {
    if (busy || (!token && !preview)) return;
    const short = sections.flatMap((sec, si) =>
      sec.questions.flatMap((q, qi) => {
        if (q.type !== "essay" || !q.minWords) return [];
        const n = wordCount(att.answers[`${si}-${qi}`]);
        return n < q.minWords ? [`${n}/${q.minWords} từ`] : [];
      }),
    );
    if (!auto && short.length && !withGuardPaused(() => window.confirm(`Bài viết chưa đủ số từ tối thiểu (${short.join(", ")}). Em vẫn muốn nộp?`))) return;
    ttsStop();
    setTts((t) => ({ ...t, playing: false, paused: false }));
    setBusy(true);
    guardArmed.current = false;
    try {
      const outcome = await submitMut({ token: token ?? undefined, adminToken: preview ? adminToken ?? undefined : undefined, id: meta.id, answers: att.answers, durationSec: (Date.now() - att.startedAt) / 1000 });
      setAtt((a) => ({ ...a, submitted: true, outcome }));
      sdel("localStorage", draftKey);
    } catch (e) {
      guardArmed.current = true;
      toast(errMsg(e, "Chưa nộp được bài. Em thử lại nhé."));
    } finally {
      setBusy(false);
    }
  }

  // Time is up on an auto-submit quiz.
  useEffect(() => {
    if (remaining !== 0 || meta.timer !== "auto" || att.submitted || autoSubmitted.current) return;
    autoSubmitted.current = true;
    toast("Hết giờ! Bài của em đã được nộp tự động.");
    submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  useEffect(() => {
    if (!att.submitted || !resultRef.current) return;
    resultRef.current.scrollIntoView({ block: "start" });
    try {
      resultRef.current.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, [att.submitted]);

  function retry() {
    ttsStop();
    setTts({ sec: null, playing: false, paused: false, msg: "" });
    setShowCopy(null);
    guardArmed.current = true;
    // Keep the essays so the student can revise and resubmit them.
    setAtt((prev) => {
      autoSubmitted.current = false;
      const next = newAttempt(sections, true);
      sections.forEach((sec, si) =>
        sec.questions.forEach((q, qi) => {
          const v = prev.answers[`${si}-${qi}`];
          if (q.type === "essay" && typeof v === "string") next.answers[`${si}-${qi}`] = v;
        }),
      );
      return next;
    });
    rootRef.current?.scrollIntoView({ block: "start" });
  }

  function copyResult() {
    const o = att.outcome;
    const st = home?.student;
    if (!o || !st) return;
    const r = o.result;
    const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
    const text = [
      "TEDU English · Kết quả bài làm",
      `Học sinh: ${st.name} (${st.className})`,
      `Bài: ${meta.folderName} · ${meta.title}`,
      r.total ? `Điểm: ${r.correct}/${r.total} (${pct}%)${r.band != null ? ` · Band tham khảo ${r.band.toFixed(1)}` : ""}` : "",
      o.essayPending ? `Bài viết: đã nộp, chờ ${teacher} nhận xét` : "",
      `Thời gian: ${stamp(o.submittedAt)}`,
    ]
      .filter(Boolean)
      .join("\n");
    copyText(text, () => toast(`Đã sao chép. Em dán vào nhóm Zalo lớp để gửi ${teacher} nhé.`), () => setShowCopy(text));
  }

  /* ---------- render ---------- */
  let num = 0;
  return (
    <div className="quiz-wrap" ref={rootRef}>
      {meta.guard && !preview && token && !att.submitted && (
        <FocusGuard
          id={meta.id}
          token={token}
          used={guardUsed}
          snapshot={() => ({ answers: att.answers, durationSec: (Date.now() - att.startedAt) / 1000 })}
          onLocked={() => {
            sdel("localStorage", draftKey);
            onLockedOut();
          }}
          onSignOut={signOut}
          armed={guardArmed}
        />
      )}
      {resumed && !att.submitted && (
        <p className="alert alert-good resume-note">
          📌 Em đang làm tiếp bài đã lưu (đã làm {answered}/{total} câu
          {limitSec ? `, đồng hồ chạy tiếp từ chỗ em dừng` : ""}).{" "}
          <button className="link-btn" type="button" onClick={startOver}>
            Làm lại từ đầu
          </button>
        </p>
      )}
      {att.submitted && att.outcome?.examHidden && <p className="alert alert-good">✓ Em đã nộp bài thi. Kết quả sẽ hiện khi thầy cô công bố.</p>}
      {att.submitted && att.outcome && !att.outcome.examHidden && (
        <ResultBlock
          outcome={att.outcome}
          ielts={!!meta.ielts}
          teacher={teacher}
          preview={preview}
          lockAt={meta.lockAtPercent}
          resultRef={resultRef}
          onRetry={retry}
          onCopy={copyResult}
          copyFallback={showCopy}
        />
      )}
      {att.sections.map((sa) => {
        const sec = sections[sa.si];
        const cards = sa.order.map((qi) => {
          num++;
          const key = `${sa.si}-${qi}`;
          return (
            <QuestionCard
              key={key}
              k={key}
              q={sec.questions[qi]}
              num={num}
              optOrder={sa.opts[qi]}
              value={att.answers[key]}
              review={att.submitted ? att.outcome?.review[key] : undefined}
              onAnswer={setAnswer}
            />
          );
        });
        const title = (
          <h2 className="q-section-title">
            {sec.title || "Câu hỏi"}
            <small>{sec.questions.length} câu</small>
          </h2>
        );
        if (sec.passage) {
          const lines = sec.passage.split("\n");
          const body = lines.slice(1).join("\n").replace(/^\n+/, "");
          return (
            <section className="q-section" key={sa.si}>
              {title}
              <div className="reading-layout">
                <article className="passage" aria-label="Bài đọc">
                  <p className="p-title">{lines[0]}</p>
                  {body}
                </article>
                <div className="q-col">{cards}</div>
              </div>
            </section>
          );
        }
        if (sec.audio?.url) {
          return (
            <section className="q-section" key={sa.si}>
              {title}
              <div className="listen-box">
                <SectionAudio url={sec.audio.url} onPlay={ttsStop} />
                <p className="listen-status">Bấm ▶ để nghe. Em có thể tua lại và nghe nhiều lần.</p>
                {att.submitted && sec.listen && (
                  <details>
                    <summary>Xem lời thoại (transcript)</summary>
                    <div className="transcript">{sec.listen}</div>
                  </details>
                )}
              </div>
              {cards}
            </section>
          );
        }
        if (sec.listen) {
          const active = tts.sec === sa.si && tts.playing;
          return (
            <section className="q-section" key={sa.si}>
              {title}
              <div className="listen-box">
                <div className="listen-controls">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => ttsPlay(sa.si)}>
                    {active ? "↺ Phát lại từ đầu" : "▶ Phát audio"}
                  </button>
                  {active && !tts.paused && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => {
                        try {
                          window.speechSynthesis.pause();
                        } catch {
                          /* ignore */
                        }
                        setTts((t) => ({ ...t, paused: true, msg: "Đã tạm dừng." }));
                      }}
                    >
                      Tạm dừng
                    </button>
                  )}
                  {active && tts.paused && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => {
                        try {
                          window.speechSynthesis.resume();
                        } catch {
                          /* ignore */
                        }
                        setTts((t) => ({ ...t, paused: false, msg: "Đang phát…" }));
                      }}
                    >
                      Tiếp tục
                    </button>
                  )}
                  {active && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => {
                        ttsStop();
                        setTts({ sec: sa.si, playing: false, paused: false, msg: "Đã dừng. Bấm Phát audio để nghe lại từ đầu." });
                      }}
                    >
                      Dừng
                    </button>
                  )}
                  <span className="speed" role="group" aria-label="Giọng đọc">
                    {(
                      [
                        ["uk", "🇬🇧 Anh"],
                        ["us", "🇺🇸 Mỹ"],
                      ] as const
                    ).map(([acc, label]) => (
                      <button
                        key={acc}
                        type="button"
                        aria-pressed={accent === acc}
                        onClick={() => {
                          setAccent(acc);
                          if (tts.playing && tts.sec != null) ttsPlay(tts.sec, rate, acc);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                  <span className="speed" role="group" aria-label="Tốc độ đọc">
                    {[
                      [0.75, "Chậm"],
                      [0.9, "Chuẩn"],
                    ].map(([r, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={rate === r}
                        onClick={() => {
                          setRate(r as number);
                          if (tts.playing && tts.sec != null) ttsPlay(tts.sec, r as number);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                  <span className={`eq${active && !tts.paused ? " on" : ""}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <p className="listen-status">
                  {tts.sec === sa.si && tts.msg ? tts.msg : "Audio được đọc bằng giọng tiếng Anh có sẵn trên thiết bị. Em có thể nghe lại nhiều lần."}
                </p>
                {att.submitted && (
                  <details>
                    <summary>Xem lời thoại (transcript)</summary>
                    <div className="transcript">{sec.listen}</div>
                  </details>
                )}
              </div>
              {cards}
            </section>
          );
        }
        return (
          <section className="q-section" key={sa.si}>
            {title}
            {cards}
          </section>
        );
      })}
      {!att.submitted && (
        <div className="submit-bar">
          <div className="progress-row">
            {remaining != null && (
              <span className={`timer${remaining === 0 ? " over" : remaining <= 60 ? " low" : remaining <= 300 ? " warn" : ""}`} role="timer" aria-live={remaining <= 60 ? "polite" : "off"}>
                ⏱ {remaining === 0 ? "Hết giờ" : clock(remaining)}
              </span>
            )}
            <span>
              Đã làm {answered}/{total} câu
            </span>
            <span className="progress" aria-hidden="true">
              <i style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
            </span>
          </div>
          {remaining === 0 && meta.timer !== "auto" && <p className="alert alert-bad">Đã hết giờ làm bài. Em kiểm tra lại rồi bấm nộp bài nhé.</p>}
          <button className="btn btn-primary btn-block" type="button" onClick={() => submit()} disabled={busy}>
            {busy ? "Đang chấm bài…" : answered >= total ? "Nộp bài và xem kết quả" : `Nộp bài (${total - answered} câu chưa làm)`}
          </button>
          {!preview && token && !meta.guard && (
            <button className="btn btn-ghost btn-block" type="button" onClick={saveAndLeave} disabled={busy || answered === 0}>
              💾 Lưu bài, lần sau làm tiếp
            </button>
          )}
          <p className="tiny muted" style={{ textAlign: "center" }}>
            {meta.guard && !preview
              ? "Bài được tự động lưu; nếu mất mạng hay tắt máy, em vào lại sẽ làm tiếp được. Câu bỏ trống được tính là chưa làm."
              : "Em có thể nộp bất cứ lúc nào; câu bỏ trống được tính là chưa làm. Bài được tự động lưu để lần sau làm tiếp."}
          </p>
        </div>
      )}
    </div>
  );
}

/** Teacher-uploaded recording for a listening part, with a speed switch. */
function SectionAudio({ url, onPlay }: { url: string; onPlay: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  return (
    <div className="listen-controls">
      <audio
        ref={ref}
        className="section-audio"
        controls
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        src={url}
        onPlay={(e) => {
          onPlay(); // stop the computer voice
          document.querySelectorAll("audio").forEach((a) => a !== e.currentTarget && a.pause()); // one recording at a time
        }}
      />
      <span className="speed" role="group" aria-label="Tốc độ nghe">
        {[
          [0.75, "Chậm"],
          [1, "Chuẩn"],
        ].map(([r, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={rate === r}
            onClick={() => {
              setRate(r as number);
              if (ref.current) ref.current.playbackRate = r as number;
            }}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

type Review = Submitted["review"][string];

function QuestionCard({
  k,
  q,
  num,
  optOrder,
  value,
  review,
  onAnswer,
}: {
  k: string;
  q: PubQuestion;
  num: number;
  optOrder?: number[];
  value: string | number | undefined;
  review?: Review;
  onAnswer: (key: string, v: string | number) => void;
}) {
  if (q.type === "speak") return null; // Speaking tests use SpeakingRunner
  const done = !!review;
  const ok = !!review?.ok;
  const image = q.image?.url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="q-image" src={q.image.url} alt={q.image.name} loading="lazy" />
  ) : null;

  if (q.type === "essay") {
    const text = typeof value === "string" ? value : "";
    const words = wordCount(text);
    const enough = !q.minWords || words >= q.minWords;
    return (
      <article className="q-card essay-card" id={`q-${k}`}>
        <div className="q-head">
          <span>Câu {num}</span>
          {q.tag && <span>{q.tag}</span>}
          <span>Bài viết</span>
          {done && <span className="state-ok">{review!.answered ? "Đã nộp" : "Chưa viết"}</span>}
        </div>
        <div className="essay-prompt">
          <Rich text={q.q} />
        </div>
        {image}
        {q.tip && (
          <p className="essay-tip">
            <b>Gợi ý:</b> <Rich text={q.tip} />
          </p>
        )}
        <textarea
          className="textarea essay-input"
          id={`ans-${k}`}
          value={text}
          onChange={(e) => onAnswer(k, e.target.value)}
          placeholder="Write your response here…"
          rows={12}
          spellCheck={false}
          aria-label={`Bài viết câu ${num}`}
          disabled={done}
        />
        <div className="essay-meta">
          <span className={`wc${q.minWords ? (enough ? " ok" : " low") : ""}`}>
            {words} từ{q.minWords ? ` / tối thiểu ${q.minWords}` : ""}
            {q.minWords && enough ? " ✓" : ""}
          </span>
          <span className="muted">{done ? "Bài viết đã gửi cho giáo viên nhận xét." : "Bài được lưu nháp tự động trên máy này."}</span>
        </div>
      </article>
    );
  }

  const state = done ? (ok ? " ok" : " no") : "";
  let body: React.ReactNode;
  if (q.type === "fill") {
    body = (
      <input
        className={`input fill-input${state}`}
        id={`ans-${k}`}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onAnswer(k, e.target.value)}
        placeholder="Nhập đáp án"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={`Đáp án câu ${num}`}
        disabled={done}
      />
    );
  } else {
    body = (
      <div className={`opts${done ? " locked" : ""}`} role="radiogroup" aria-label={`Câu ${num}`}>
        {(optOrder ?? q.options.map((_, i) => i)).map((oi, pos) => {
          const sel = value === oi;
          let c = "";
          if (done) c = oi === review!.answer ? " right" : sel ? " wrong" : "";
          else if (sel) c = " sel";
          return (
            <label className={`opt${c}`} key={oi}>
              <input type="radio" name={`q-${k}`} value={oi} checked={sel} disabled={done} onChange={() => onAnswer(k, oi)} />
              <span className="letter">{String.fromCharCode(65 + pos)}</span>
              <span className="o-text">
                <Rich text={q.options[oi]} />
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  let explain: React.ReactNode = null;
  if (review && review.answer == null) {
    explain = <p className="explain hidden-answer">🔒 Em chưa làm câu này nên đáp án được ẩn. Đáp án chỉ hiện cho những câu em đã làm và nộp bài.</p>;
  } else if (review) {
    const right = q.type === "fill" ? String(review.answer) : <Rich text={q.options[review.answer as number] ?? ""} />;
    const given = q.type === "fill" ? (typeof value === "string" ? value : "") : typeof value === "number" ? <Rich text={q.options[value]} /> : "";
    explain = (
      <p className="explain">
        {!ok && given ? (
          <>
            Em trả lời: <b>{given}</b> ·{" "}
          </>
        ) : null}
        Đáp án: <b>{right}</b>
        {review.explain ? (
          <>
            {" · "}
            <Rich text={review.explain} />
          </>
        ) : null}
      </p>
    );
  }

  return (
    <article className={`q-card${state}`} id={`q-${k}`}>
      <div className="q-head">
        <span>Câu {num}</span>
        {q.tag && <span>{q.tag}</span>}
        {done && (ok ? <span className="state-ok">Đúng</span> : <span className="state-no">{review!.answered ? "Chưa đúng" : "Chưa làm"}</span>)}
      </div>
      <p className="q-text">
        <Rich text={q.q} />
      </p>
      {image}
      {body}
      {explain}
    </article>
  );
}

function ResultBlock({
  outcome,
  ielts,
  teacher,
  preview,
  lockAt,
  resultRef,
  onRetry,
  onCopy,
  copyFallback,
}: {
  outcome: Submitted;
  ielts: boolean;
  teacher: string;
  preview: boolean;
  lockAt: number;
  resultRef: React.RefObject<HTMLElement | null>;
  onRetry: () => void;
  onCopy: () => void;
  copyFallback: string | null;
}) {
  const r = outcome.result;
  const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  const band = ielts ? r.band : null;
  let head: string;
  let msg: string;
  const writingOnly = r.total === 0;
  // Reaching the threshold closes the quiz for this student (not in teacher preview).
  const locksNow = !preview && !writingOnly && lockAt > 0 && pct >= lockAt;
  if (writingOnly) {
    head = "Đã nộp bài viết!";
    msg = preview ? "Chế độ xem trước: bài viết không được gửi đi." : `Bài đã đến tay ${teacher}. Nhận xét sẽ hiện ở đầu trang bài này khi ${teacher} chấm xong.`;
  } else if (pct >= 85) {
    head = "Excellent work!";
    msg = "Em làm rất tốt. Giữ vững phong độ nhé!";
  } else if (pct >= 60) {
    head = "Good progress!";
    msg = "Xem lại các câu sai bên dưới rồi làm lại để nhớ lâu hơn.";
  } else {
    head = "Keep going!";
    msg = "Mỗi lần làm là một lần tiến bộ. Đọc phần giải thích và thử lại nhé.";
  }
  return (
    <section className="result" id="result" tabIndex={-1} ref={resultRef}>
      <div className="score-dial" style={{ "--p": writingOnly ? 100 : pct } as React.CSSProperties}>
        <div className="inner">
          {writingOnly ? (
            <b style={{ fontSize: "2.6rem" }}>✓</b>
          ) : (
            <>
              <b>
                {r.correct}/{r.total}
              </b>
              <small>{pct}%</small>
            </>
          )}
        </div>
      </div>
      <div>
        <p className="eyebrow">Kết quả</p>
        <h2>{head}</h2>
        <p className="r-msg">{msg}</p>
        {!writingOnly && (
        <div className="result-stats">
          <span className="stat">
            Đúng <b>{r.correct}</b>
          </span>
          <span className="stat">
            Sai <b>{r.wrong}</b>
          </span>
          <span className="stat">
            Chưa làm <b>{r.unanswered}</b>
          </span>
          {band != null && (
            <span className="stat band">
              Band tham khảo <b>{band.toFixed(1)}</b>
            </span>
          )}
        </div>
        )}
        {!writingOnly && !preview && r.unanswered > 0 && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            🔒 Đáp án của {r.unanswered} câu em chưa làm được ẩn. Đáp án chỉ hiện cho những câu em đã làm.
          </p>
        )}
        <div className="result-actions">
          {locksNow ? (
            <span className="stat band">🔒 Bài đã hoàn thành và được khoá</span>
          ) : (
            <button className="btn btn-primary btn-sm" type="button" onClick={onRetry}>
              {writingOnly ? "Sửa và nộp lại" : "Làm lại (xáo trộn câu hỏi)"}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCopy}>
            Sao chép kết quả gửi {teacher}
          </button>
          <Link className="btn btn-ghost btn-sm" href="/">
            Về trang học tập
          </Link>
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          {preview
            ? "Chế độ xem trước của giáo viên: kết quả không được lưu."
            : outcome.essayPending && !writingOnly
              ? `Điểm phần trắc nghiệm đã được lưu; phần bài viết đang chờ ${teacher} nhận xét.`
              : `Kết quả đã được lưu, ${teacher} xem được điểm của em trong khu vực giáo viên.`}
        </p>
        {copyFallback && (
          <div className="copy-fallback">
            <label className="tiny muted" htmlFor="copy-text">
              Chọn và sao chép đoạn này:
            </label>
            <textarea className="textarea" id="copy-text" readOnly value={copyFallback} autoFocus onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        {band != null && (
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Band ước tính bằng cách quy đổi số câu đúng sang thang 40 câu; đây không phải điểm IELTS chính thức.
          </p>
        )}
      </div>
    </section>
  );
}

/** Writing the student already handed in for this quiz, with the teacher's comments. */
function MyWriting({ id, speaking }: { id: string; speaking?: boolean }) {
  const { token, teacher } = useSite();
  const rows = useQuery(api.site.writing, token ? { token, id } : "skip");
  if (!rows?.length) return null;
  return (
    <section className="panel my-writing" style={{ marginTop: 18 }}>
      <div>
        <p className="eyebrow">{speaking ? "Bài nói đã nộp" : "Bài viết đã nộp"}</p>
        <h2>Nhận xét của {teacher}</h2>
      </div>
      {rows.map((a, i) => (
        <details key={a.id} open={i === 0} className="mw-item">
          <summary>
            <span>Lần nộp {stamp(a.submittedAt)}</span>
            {a.status === "done" ? <span className="status on">Đã nhận xét</span> : <span className="status draft">Chờ nhận xét</span>}
          </summary>
          {a.speaking && (
            <div className="mw-essay">
              {a.speaking.purged ? (
                <p className="tiny muted">Ghi âm đã được xoá sau {RECORDING_KEEP_DAYS} ngày; điểm và nhận xét vẫn được giữ.</p>
              ) : (
                <div className="speak-replay">
                  {a.speaking.recordings.map((r, i) => (
                    <div key={r.key} className="speak-replay-row">
                      <span className="tiny">
                        <b>Câu {i + 1}.</b> {r.q.split("\n")[0]}
                      </span>
                      {r.url && <audio controls preload="none" src={r.url} />}
                      {r.transcript && <p className="tiny muted mw-transcript">“{r.transcript}”</p>}
                    </div>
                  ))}
                </div>
              )}
              {a.speaking.selfReview && (
                <p className="tiny muted">
                  Em tự đánh giá: band <b>{writingBand(a.speaking.selfReview.criteria)?.toFixed(1)}</b>
                  {a.speaking.selfReview.note ? ` · “${a.speaking.selfReview.note}”` : ""}
                </p>
              )}
              {a.status === "done" && a.speaking.review ? (
                <div className="mw-review">
                  {a.speaking.review.band != null && (
                    <p className="mw-band">
                      Band Speaking <b>{a.speaking.review.band.toFixed(1)}</b>
                    </p>
                  )}
                  {a.speaking.review.criteria && (
                    <div className="mw-criteria">
                      {SPEAKING_CRITERIA.map((c, i) => (
                        <span key={c}>
                          {c} <b>{a.speaking!.review!.criteria![i].toFixed(1)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {a.speaking.review.comment && <p className="mw-comment">{a.speaking.review.comment}</p>}
                  {a.reviewedBy && <p className="tiny muted">— {a.reviewedBy}</p>}
                </div>
              ) : a.status === "done" ? null : (
                <p className="tiny muted">Bài đang chờ {teacher} chấm. Em quay lại trang này sau nhé.</p>
              )}
            </div>
          )}
          {a.essays.map((e) => (
            <div key={e.key} className="mw-essay">
              <p className="tiny muted">
                <Rich text={e.prompt.split("\n")[0]} /> · {e.words} từ
              </p>
              <div className="mw-text">{e.text || "(bỏ trống)"}</div>
              {a.status === "done" && (e.comment || e.band != null) ? (
                <div className="mw-review">
                  {e.band != null && (
                    <p className="mw-band">
                      Band <b>{e.band.toFixed(1)}</b>
                    </p>
                  )}
                  {e.criteria && (
                    <div className="mw-criteria">
                      {WRITING_CRITERIA.map((c, i) => (
                        <span key={c}>
                          {c} <b>{e.criteria![i].toFixed(1)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {e.comment && <p className="mw-comment">{e.comment}</p>}
                  {a.reviewedBy && <p className="tiny muted">— {a.reviewedBy}</p>}
                </div>
              ) : a.status === "done" ? null : (
                <p className="tiny muted">Bài đang chờ {teacher} chấm. Em quay lại trang này sau nhé.</p>
              )}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

function clock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
