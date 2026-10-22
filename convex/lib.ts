import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  SPEAKING_REVIEW_KEY,
  writingTestBand,
  type IeltsSkill,
  MAX_ESSAY_CHARS,
  MAX_RECORDING_BYTES,
  bandFor,
  firstName,
  grade,
  hasEssay,
  hasSpeak,
  lastTwoWords,
  noMarks,
  normCode,
  questionCount,
  wordCount,
  type Answers,
} from "./model";

export const STUDENT_SESSION_MS = 180 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function fail(message: string): never {
  throw new ConvexError(message);
}

/* ---------- crypto ---------- */
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const candidate = await pbkdf2(password, fromHex(salt), Number(iter));
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function checkPasswordStrength(password: string) {
  if (password.length < 8) fail("Mật khẩu cần ít nhất 8 ký tự.");
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password))
    fail("Mật khẩu cần có cả chữ và số.");
}

/* ---------- sessions ---------- */
type Ctx = QueryCtx | MutationCtx;

export async function studentFromToken(ctx: Ctx, token: string | undefined | null) {
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await ctx.db
    .query("studentSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!row || row.expiresAt < Date.now()) return null;
  const student = await ctx.db.get(row.studentId);
  if (!student || !student.active) return null;
  return student;
}

export async function adminFromToken(ctx: Ctx, token: string | undefined | null) {
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await ctx.db
    .query("adminSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!row || row.expiresAt < Date.now()) return null;
  const admin = await ctx.db.get(row.adminId);
  if (!admin || !admin.active) return null;
  return admin;
}

/** Throws unless the token belongs to an active admin who has set their own password. */
export async function requireAdmin(ctx: Ctx, token: string, opts: { owner?: boolean } = {}) {
  const admin = await adminFromToken(ctx, token);
  if (!admin) fail("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  if (admin.mustChangePassword) fail("Bạn cần đổi mật khẩu trước khi tiếp tục.");
  if (opts.owner && admin.role !== "owner") fail("Chỉ quản trị viên chính mới làm được việc này.");
  return admin;
}

/* ---------- data helpers ---------- */
export async function getSettings(ctx: Ctx) {
  const row = await ctx.db.query("settings").first();
  return {
    centerName: row?.centerName ?? "TEDU English",
    tagline: row?.tagline ?? "Better English · Brighter Futures",
    teacher: row?.teacher ?? "thầy cô",
    contact: row?.contact ?? "",
    showDemoHint: row?.showDemoHint ?? false,
    demoCode: row?.demoCode ?? "",
    lockAtPercent: row?.lockAtPercent ?? 80,
  };
}

export async function allFolders(ctx: Ctx) {
  const rows = await ctx.db.query("folders").collect();
  return rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function canOpen(student: Doc<"students"> | null, folder: string) {
  if (!student) return false;
  return student.folders.includes("*") || student.folders.includes(folder);
}

export async function studentByCode(ctx: Ctx, code: string) {
  const c = normCode(code);
  if (!c) return null;
  return ctx.db
    .query("students")
    .withIndex("by_code", (q) => q.eq("code", c))
    .first();
}

/** From the quiz setting; otherwise Speaking/Writing for recorded or written tests in the IELTS folder. */
export function skillOf(q: Doc<"quizzes">): IeltsSkill | null {
  if (q.ielts) return q.ielts;
  if (q.folder !== "ielts") return null;
  return hasSpeak(q.sections) ? "speaking" : hasEssay(q.sections) ? "writing" : null;
}

/** Band of one attempt; Writing needs every task marked, Speaking the teacher's overall band. */
export function attemptBand(q: Doc<"quizzes">, a: Doc<"attempts">, skill: IeltsSkill): number | null {
  if (skill === "speaking") return a.essayReviews?.[SPEAKING_REVIEW_KEY]?.band ?? null;
  if (skill !== "writing") return a.band ?? bandFor(skill, a.correct, a.total);
  const tasks: (number | undefined)[] = [];
  q.sections.forEach((sec, si) =>
    sec.questions.forEach((qq, qi) => {
      if (qq.type === "essay") tasks.push(a.essayReviews?.[`${si}-${qi}`]?.band);
    }),
  );
  return writingTestBand(tasks);
}

/** Whether leaving this test (another tab or app) warns and then locks the account. */
export function focusGuardOn(quiz: Doc<"quizzes">): boolean {
  return quiz.focusGuard ?? (quiz.ielts === "reading" || quiz.ielts === "writing" || hasEssay(quiz.sections));
}

/** Keeps only answers that map to real questions (trimmed); Speaking answers must be real, small recordings. */
export async function cleanAnswers(ctx: Ctx, quiz: Doc<"quizzes">, raw: Record<string, string | number>, preview: boolean) {
  const answers: Answers = {};
  quiz.sections.forEach((sec, si) =>
    sec.questions.forEach((q, qi) => {
      const key = `${si}-${qi}`;
      const val = raw[key];
      if (q.type === "mcq" && typeof val === "number") answers[key] = val;
      if (q.type === "fill" && typeof val === "string") answers[key] = val.slice(0, 300);
      if (q.type === "essay" && typeof val === "string" && val.trim()) answers[key] = val.slice(0, MAX_ESSAY_CHARS);
      if (q.type === "speak" && !preview && typeof val === "string" && val) answers[key] = val; // checked below
    }),
  );
  let spoke = false;
  for (const [key, val] of Object.entries(answers)) {
    const [si, qi] = key.split("-").map(Number);
    if (quiz.sections[si]?.questions[qi]?.type !== "speak") continue;
    const id = ctx.db.system.normalizeId("_storage", String(val));
    const meta = id ? await ctx.db.system.get(id) : null;
    if (id && meta && (meta.contentType ?? "").startsWith("audio/") && meta.size <= MAX_RECORDING_BYTES) {
      answers[key] = id;
      spoke = true;
    } else delete answers[key];
  }
  const needsReview = spoke || quiz.sections.some((sec, si) => sec.questions.some((q, qi) => q.type === "essay" && wordCount(answers[`${si}-${qi}`]) > 0));
  return { answers, needsReview };
}

export async function deleteDrafts(ctx: MutationCtx, studentId: Id<"students">, quizId: Id<"quizzes">) {
  for (const d of await ctx.db.query("drafts").withIndex("by_student_quiz", (q) => q.eq("studentId", studentId).eq("quizId", quizId)).collect())
    await ctx.db.delete(d._id);
}

/** Grades and stores one attempt (and drops the unfinished draft it replaces). */
export async function saveAttempt(
  ctx: MutationCtx,
  quiz: Doc<"quizzes">,
  studentId: Id<"students">,
  raw: Record<string, string | number>,
  opts: {
    durationSec?: number;
    leftQuiz?: boolean;
    transcripts?: Record<string, string>;
    selfReview?: { criteria: number[]; note: string };
    speakMode?: "exam" | "practice";
  } = {},
) {
  const { answers, needsReview } = await cleanAnswers(ctx, quiz, raw, false);
  const result = grade(quiz.sections, answers);
  const band = bandFor(quiz.ielts, result.correct, result.total);
  const now = Date.now();
  await ctx.db.insert("attempts", {
    studentId,
    quizId: quiz._id,
    ...result,
    band: band ?? undefined,
    answers,
    submittedAt: now,
    ...(opts.durationSec != null ? { durationSec: Math.max(0, Math.min(86_400, Math.round(opts.durationSec))) } : {}),
    ...(needsReview ? { reviewStatus: "pending" as const } : {}),
    ...(opts.leftQuiz ? { leftQuiz: true } : {}),
    ...(opts.transcripts && Object.keys(opts.transcripts).length ? { transcripts: opts.transcripts } : {}),
    ...(opts.selfReview ? { selfReview: opts.selfReview } : {}),
    ...(opts.speakMode ? { speakMode: opts.speakMode } : {}),
  });
  await deleteDrafts(ctx, studentId, quiz._id);
  await ctx.db.patch(studentId, { lastSeenAt: now });
  return { answers, needsReview, result, band, now };
}

/** What a list needs about a quiz: a quiz card (summary.ts) or a full quiz via quizMeta. */
export type MetaSource = Pick<Doc<"quizzes">, "slug" | "folder" | "title" | "subtitle" | "minutes" | "code" | "featured" | "ielts" | "timer" | "accent" | "speakPrep" | "speakMode" | "exam" | "term"> & {
  questionCount: number;
  hasEssay: boolean;
  hasSpeak: boolean;
  guard: boolean;
};

export function metaOf(q: MetaSource) {
  return {
    id: q.slug,
    folder: q.folder,
    title: q.title,
    subtitle: q.subtitle,
    minutes: q.minutes,
    hasCode: q.code !== "",
    featured: q.featured,
    ielts: q.ielts ?? null,
    questionCount: q.questionCount,
    hasEssay: q.hasEssay,
    hasSpeak: q.hasSpeak,
    guard: q.guard,
    speakPrep: q.speakPrep ?? 15,
    // Scheduled exams are always taken as a timed test.
    speakMode: q.exam ? ("exam" as const) : (q.speakMode ?? "both"),
    exam: q.exam ? { phase: q.exam.phase, opensAt: q.exam.opensAt ?? null, closesAt: q.exam.closesAt ?? null, released: !!q.exam.releasedAt } : null,
    timer: q.timer ?? (q.minutes > 0 ? "count" : "off"),
    accent: q.accent ?? "uk",
    term: q.term ?? null,
  };
}

export function quizMeta(quiz: Doc<"quizzes">) {
  return metaOf({
    ...quiz,
    questionCount: questionCount(quiz.sections),
    hasEssay: hasEssay(quiz.sections),
    hasSpeak: hasSpeak(quiz.sections),
    guard: focusGuardOn(quiz),
  });
}

/** Quiz content for taking it: no answers; essay tips are fine to show up front. */
export async function publicSections(ctx: Ctx, quiz: Doc<"quizzes">) {
  return Promise.all(
    quiz.sections.map(async (s) => ({
      title: s.title,
      listen: s.listen ?? null,
      audio: s.audio ? { name: s.audio.name, url: await ctx.storage.getUrl(s.audio.storageId) } : null,
      passage: s.passage ?? null,
      questions: await Promise.all(
        s.questions.map(async (q) => {
          const image = q.image ? { name: q.image.name, url: await ctx.storage.getUrl(q.image.storageId) } : null;
          if (q.type === "mcq") return { type: "mcq" as const, tag: q.tag ?? "", q: q.q, image, options: q.options };
          if (q.type === "fill") return { type: "fill" as const, tag: q.tag ?? "", q: q.q, image };
          if (q.type === "speak") return { type: "speak" as const, tag: q.tag ?? "", q: q.q, image, answerSec: q.answerSec, prepSec: q.prepSec ?? 0 };
          return { type: "essay" as const, tag: q.tag ?? "", q: q.q, image, minWords: q.minWords ?? 0, tip: q.explain ?? "" };
        }),
      ),
    })),
  );
}

export function quizImageIds(sections: Doc<"quizzes">["sections"]): Id<"_storage">[] {
  return sections.flatMap((s) => s.questions.flatMap((q) => (q.image ? [q.image.storageId] : [])));
}

export function quizAudioIds(sections: Doc<"quizzes">["sections"]): Id<"_storage">[] {
  return sections.flatMap((s) => (s.audio ? [s.audio.storageId] : []));
}

/** Storage ids of an attempt's Speaking recordings, by answer key. */
export function recordingIds(quiz: Doc<"quizzes">, a: Doc<"attempts">): [string, Id<"_storage">][] {
  const out: [string, Id<"_storage">][] = [];
  quiz.sections.forEach((s, si) =>
    s.questions.forEach((q, qi) => {
      const v = a.answers[`${si}-${qi}`];
      if (q.type === "speak" && typeof v === "string" && v) out.push([`${si}-${qi}`, v as Id<"_storage">]);
    }),
  );
  return out;
}

/** Every uploaded file a quiz uses: question images and listening audio. */
export function quizFileIds(sections: Doc<"quizzes">["sections"]): Id<"_storage">[] {
  return [...quizImageIds(sections), ...quizAudioIds(sections)];
}

/** Deletes quiz images/audio no other quiz still uses (duplicated quizzes share files). */
export async function releaseFiles(ctx: MutationCtx, ids: Id<"_storage">[], exceptQuiz: Id<"quizzes">) {
  if (!ids.length) return;
  const inUse = new Set<string>();
  for (const q of await ctx.db.query("quizzes").collect()) if (q._id !== exceptQuiz) quizFileIds(q.sections).forEach((id) => inUse.add(id));
  for (const id of new Set(ids)) if (!inUse.has(id)) await ctx.storage.delete(id);
}

/** A signed-in teacher previewing the student site (no student session needed). */
export async function previewAdmin(ctx: Ctx, adminToken: string | undefined | null) {
  const admin = await adminFromToken(ctx, adminToken);
  return admin && !admin.mustChangePassword ? admin : null;
}

export type DoneRecord = {
  best: number;
  last: number;
  total: number;
  at: number;
  count: number;
  /** Essay marking state of the latest attempt with writing, if any. */
  review: "pending" | "done" | null;
  /** Best score reached the lock threshold: the quiz is closed for this student. */
  locked: boolean;
  /** Best IELTS band (teacher-marked for Writing/Speaking). */
  band: number | null;
  /** A scheduled exam whose results aren't released yet: handed in, nothing else shown. */
  hidden: boolean;
};

/** Resource as shown to a student who may open its folder. */
export async function studentResource(ctx: Ctx, r: Doc<"resources">) {
  return {
    id: r._id,
    folder: r.folder,
    kind: r.kind,
    title: r.title,
    description: r.description,
    url: r.url,
    term: r.term ?? null,
    file: r.file ? { name: r.file.name, size: r.file.size, audio: r.file.media === "audio", url: await ctx.storage.getUrl(r.file.storageId) } : null,
  };
}

export async function quizBySlug(ctx: Ctx, slug: string) {
  return ctx.db
    .query("quizzes")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

export async function folderBySlug(ctx: Ctx, slug: string) {
  return ctx.db
    .query("folders")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

/** Random readable code: first name (or the last two words of the name) + 4 digits. */
export async function generateStudentCode(ctx: Ctx, name: string, style: "first" | "lastTwo" = "first") {
  const base = (style === "lastTwo" ? lastTwoWords(name) : noMarks(firstName(name)).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)) || "hs";
  for (let i = 0; i < 50; i++) {
    const code = base + String(Math.floor(1000 + Math.random() * 9000));
    if (!(await studentByCode(ctx, code))) return code;
  }
  return base + randomToken(3);
}
