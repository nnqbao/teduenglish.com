"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { firstName, formatBytes } from "@/convex/model";
import { downloadFile, errMsg, safeUrl } from "@/lib/ui";
import { useSite } from "./SiteShell";

type Dashboard = NonNullable<FunctionReturnType<typeof api.site.home>["dashboard"]>;
export type QuizMeta = Dashboard["quizzes"][number];
export type ResourceRow = Dashboard["resources"][number];
export type DoneMap = Dashboard["done"];
export type FolderInfo = { id: string; badge: string; name: string; detail: string };

export const KIND: Record<string, string> = { exercise: "Bài tập", game: "Trò chơi", video: "Video", doc: "Tài liệu", audio: "Bài nghe" };
export const TONES = ["t1", "", "t2"];

/** The rising arrow from the logo, drawn as a soft arc. */
export function Swoosh() {
  return (
    <svg className="swoosh" viewBox="0 0 600 400" aria-hidden="true" focusable="false">
      <circle cx="470" cy="150" r="120" fill="none" style={{ stroke: "var(--cover-chip)" }} strokeWidth="30" />
      <path d="M10 390 C 200 380, 400 290, 540 80" fill="none" style={{ stroke: "var(--amber-400)" }} strokeOpacity=".45" strokeWidth="12" strokeLinecap="round" />
      <path d="M40 400 C 230 392, 430 305, 566 112" fill="none" style={{ stroke: "var(--sand-200)" }} strokeOpacity=".18" strokeWidth="6" strokeLinecap="round" />
      <path d="M559 52 L550 94 L523 76 Z" style={{ fill: "var(--amber-400)" }} fillOpacity=".85" />
    </svg>
  );
}

export function LoginForm({ ctx }: { ctx: string }) {
  const { settings, signIn, toast } = useSite();
  const login = useMutation(api.site.login);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `code-${ctx}`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setErr("Em nhập mã cá nhân trước nhé.");
    setBusy(true);
    try {
      const r = await login({ code });
      if (!r.ok) return setErr(r.error);
      setErr("");
      signIn(r.token);
      toast(`Chào ${firstName(r.name)}! Chúc em học vui.`);
      window.scrollTo(0, 0);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={id}>Mã truy cập</label>
        <input
          className="input"
          id={id}
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={`Nhập mã ${settings.teacher} đã cấp`}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <p className="alert alert-bad" role="alert" hidden={!err}>
        {err}
      </p>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? "Đang kiểm tra…" : "Vào khu vực học tập"}
      </button>
      {settings.demoCode && (
        <div className="demo-hint">
          <span>
            Mã dùng thử: <code>{settings.demoCode}</code>
          </span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => {
              setCode(settings.demoCode);
              document.getElementById(id)?.focus();
            }}
          >
            Điền mã
          </button>
        </div>
      )}
    </form>
  );
}

/** "8/10", or the essay marking state for writing-only quizzes. */
export function doneLabel(rec: DoneMap[string]): string {
  if (rec.review === "done") return rec.total ? `${rec.best}/${rec.total} · Có nhận xét ✓` : "Có nhận xét ✓";
  if (rec.review === "pending") return rec.total ? `${rec.best}/${rec.total} · Chờ nhận xét` : "Đã nộp · chờ nhận xét";
  return `${rec.best}/${rec.total}`;
}

/** "08:00 · 15/11" in the student's local time. */
export function examTime(ms: number | null) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} · ${d.getDate()}/${d.getMonth() + 1}`;
}

/** What a scheduled exam's card says, or null when it can be opened like any quiz. */
export function examLock(quiz: QuizMeta, rec: DoneMap[string] | undefined): { title: string; meta: string } | null {
  const e = quiz.exam;
  if (!e) return null;
  if (rec) return { title: `✓ ${quiz.title}`, meta: rec.hidden ? "Đã nộp bài thi · chờ công bố kết quả" : `Đã nộp bài thi · ${doneLabel(rec)}` };
  if (e.phase === "upcoming") return { title: `🔒 ${quiz.title}`, meta: e.opensAt ? `Bài thi · mở lúc ${examTime(e.opensAt)}` : "Bài thi · chưa mở" };
  if (e.phase === "ended") return { title: quiz.title, meta: "Bài thi đã đóng" };
  return null;
}

export function QuizButton({ quiz, done }: { quiz: QuizMeta; done: DoneMap }) {
  const rec = done[quiz.id];
  const exam = examLock(quiz, rec);
  if (exam)
    return (
      <span className={`quiz-btn locked exam-locked${rec ? " done" : ""}`} aria-disabled="true">
        <span className="q-title">{exam.title}</span>
        <span className="q-meta">{exam.meta}</span>
      </span>
    );
  if (quiz.exam)
    return (
      <Link className="quiz-btn exam-open" href={`/bai/${quiz.id}`}>
        <span className="q-title">🎯 {quiz.title}</span>
        <span className="q-meta">Đang mở · vào thi →</span>
      </Link>
    );
  if (rec?.locked)
    return (
      <span className="quiz-btn done locked" aria-disabled="true" title="Em đã hoàn thành bài này, bài đã được khoá">
        <span className="q-title">✓ {quiz.title}</span>
        <span className="q-meta">Hoàn thành · {doneLabel(rec)}</span>
      </span>
    );
  return (
    <Link className={`quiz-btn${rec ? " done" : ""}`} href={`/bai/${quiz.id}`}>
      <span className="q-title">
        {rec && <span aria-label="Đã làm">✓ </span>}
        {quiz.title}
        {quiz.hasCode && !rec && <span className="lock">· cần mã bài</span>}
      </span>
      <span className="q-meta">{rec ? (rec.review ? doneLabel(rec) : `Đã làm · ${doneLabel(rec)}`) : quiz.hasEssay ? "Bài viết →" : `${quiz.questionCount} câu →`}</span>
    </Link>
  );
}

export function ResourceRowLink({ r }: { r: ResourceRow }) {
  const { docId, openDoc, toast } = useSite();
  if (r.file?.audio) {
    const file = r.file;
    return (
      <div className="res-row res-audio">
        <span className="res-main">
          <span className="kind">
            {KIND[r.kind] || "Bài nghe"} · 🎧 {formatBytes(file.size)}
          </span>
          <span className="r-title">{r.title}</span>
          {r.description && <span className="r-desc">{r.description}</span>}
        </span>
        {file.url && (
          <span className="res-audio-player">
            <audio
              controls
              preload="none"
              src={file.url}
              aria-label={`Nghe ${r.title}`}
              onPlay={(e) => document.querySelectorAll("audio").forEach((x) => x !== e.currentTarget && x.pause())}
            />
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                toast("Đang tải file về…");
                downloadFile(file.url!, file.name);
              }}
            >
              Tải về
            </button>
          </span>
        )}
      </div>
    );
  }
  if (r.file) {
    const file = r.file;
    return (
      <div className={`res-row res-file${docId === r.id ? " active" : ""}`}>
        <button className="res-main" type="button" onClick={() => openDoc(r.id)}>
          <span className="kind">
            {KIND[r.kind] || "Tài liệu"} · PDF · {formatBytes(file.size)}
          </span>
          <span className="r-title">{r.title}</span>
          {r.description && <span className="r-desc">{r.description}</span>}
        </button>
        <span className="res-actions">
          <button className="btn btn-primary" type="button" onClick={() => openDoc(r.id)}>
            Xem
          </button>
          {file.url && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                toast("Đang tải file về…");
                downloadFile(file.url!, file.name);
              }}
            >
              Tải về
            </button>
          )}
        </span>
      </div>
    );
  }
  return (
    <a className="res-row" href={safeUrl(r.url)} target="_blank" rel="noopener noreferrer">
      <span>
        <span className="kind">{KIND[r.kind] || "Bài học"}</span>
        <span className="r-title">{r.title}</span>
        {r.description && <span className="r-desc">{r.description}</span>}
      </span>
      <span className="arrow" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

export const TERM_LABEL: Record<string, string> = { hk1: "Học kỳ 1", hk2: "Học kỳ 2" };

/** Splits items into Học kỳ 1 / Học kỳ 2 / the rest; a single unlabeled group when nothing has a term. */
export function byTerm<T extends { term: string | null }>(items: T[]): [string | null, T[]][] {
  if (!items.some((i) => i.term)) return [[null, items]];
  return (["hk1", "hk2", null] as (string | null)[])
    .map((t): [string | null, T[]] => [t, items.filter((i) => (i.term ?? null) === t)])
    .filter(([, list]) => list.length > 0);
}

function TermHead({ term, grouped }: { term: string | null; grouped: boolean }) {
  if (!grouped) return null;
  return <p className="term-head">{term ? TERM_LABEL[term] : "Bài chung"}</p>;
}

export function FolderCard({
  f,
  tone,
  quizzes,
  resources,
  done,
  progress,
}: {
  f: FolderInfo;
  tone: number;
  quizzes: QuizMeta[];
  resources: ResourceRow[];
  done: DoneMap;
  progress?: { done: number; total: number; rate: number };
}) {
  const total = quizzes.length + resources.length;
  return (
    <article className="folder">
      <div className="folder-top">
        <span className={`badge ${TONES[tone % 3]}`} aria-hidden="true">
          {f.badge}
        </span>
        <div className="folder-title">
          <h3>
            <Link href={`/thu-muc/${f.id}`}>{f.name}</Link>
          </h3>
          <p>{f.detail}</p>
        </div>
        <span className="count-chip">{progress ? `${progress.done}/${progress.total} bài · ${progress.rate}%` : `${total} bài`}</span>
      </div>
      {progress && (
        <span className="progress folder-progress" title={`Chuyên cần ${progress.rate}%`} aria-hidden="true">
          <i style={{ width: `${progress.rate}%` }} />
        </span>
      )}
      {byTerm([...quizzes.map((q) => ({ term: q.term, quiz: q })), ...resources.map((r) => ({ term: r.term, res: r }))]).map(([term, items], _, all) => (
        <div className="term-group" key={term ?? "all"}>
          <TermHead term={term} grouped={all.length > 1 || term != null} />
          {items.some((i) => "quiz" in i) && (
            <div className="quiz-list">
              {items.flatMap((i) => ("quiz" in i && i.quiz ? [<QuizButton key={i.quiz.id} quiz={i.quiz} done={done} />] : []))}
            </div>
          )}
          {items.some((i) => "res" in i) && (
            <div className="res-list">
              {items.flatMap((i) => ("res" in i && i.res ? [<ResourceRowLink key={i.res.id} r={i.res} />] : []))}
            </div>
          )}
        </div>
      ))}
      {!total && <p className="empty">Chưa có bài được giao trong thư mục này.</p>}
    </article>
  );
}

export function GateLogin({ title, note }: { title: string; note: string }) {
  return (
    <section className="gate">
      <div>
        <p className="eyebrow">Student access</p>
        <h2>{title}</h2>
        <p className="small muted">{note}</p>
      </div>
      <LoginForm ctx="gate" />
    </section>
  );
}

export function GateNoAccess({ name }: { name?: string }) {
  const { teacher } = useSite();
  return (
    <section className="gate">
      <div>
        <p className="eyebrow">Chưa được mở</p>
        <h2>Thư mục này chưa được giao cho em</h2>
        <p className="small muted">
          Mã hiện tại chưa có quyền vào {name || "thư mục này"}. Nếu em cần học nội dung này, hãy nhắn {teacher}.
        </p>
      </div>
      <Link className="btn btn-ghost" href="/">
        Về trang học tập
      </Link>
    </section>
  );
}

export function Missing() {
  return (
    <section className="gate">
      <div>
        <p className="eyebrow">Không tìm thấy</p>
        <h2>Trang này không tồn tại</h2>
        <p className="small muted">Có thể đường link đã cũ hoặc bài đã được đổi tên.</p>
      </div>
      <Link className="btn btn-primary" href="/">
        Về trang học tập
      </Link>
    </section>
  );
}

export function Loading() {
  return <p className="empty" aria-busy="true">Đang tải…</p>;
}
