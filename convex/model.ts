/*
 * Pure helpers shared by Convex functions and the Next.js client.
 * No Convex imports here so the browser bundle can use them too.
 */

/** Picture shown with a question (e.g. an IELTS Task 1 chart), kept in Convex storage. */
export type QuestionImage = { storageId: string; name: string };
type QuestionBase = { tag?: string; q: string; explain?: string; image?: QuestionImage };
export type McqQuestion = QuestionBase & { type: "mcq"; options: string[]; answer: number };
export type FillQuestion = QuestionBase & { type: "fill"; answer: string[] };
/** Free writing marked by a teacher; `explain` is a tip shown with the prompt. */
export type EssayQuestion = QuestionBase & { type: "essay"; minWords?: number };
/** Spoken answer (IELTS Speaking): the question is read aloud, then the student is recorded for `answerSec`. */
export type SpeakQuestion = QuestionBase & { type: "speak"; answerSec: number; prepSec?: number };
export type Question = McqQuestion | FillQuestion | EssayQuestion | SpeakQuestion;
export type Section = {
  title: string;
  listen?: string;
  /** Recorded MP3 for a listening part, kept in Convex storage. */
  audio?: QuestionImage;
  passage?: string;
  questions: Question[];
};
export type IeltsKind = "listening" | "reading";
export type IeltsSkill = IeltsKind | "writing" | "speaking";
export type AnswerValue = string | number;
export type Answers = Record<string, AnswerValue>;

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
/** One recorded Speaking answer (a few minutes of compressed speech is well under this). */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
/** Recordings are deleted this long after submission; marks and comments are kept. */
export const RECORDING_KEEP_DAYS = 5;
/** essayReviews key holding the teacher's single review of a Speaking test. */
export const SPEAKING_REVIEW_KEY = "speaking";

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function normCode(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export function normAnswer(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.!?;,]+$/g, "")
    .trim();
}

export function noMarks(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function firstName(full: unknown): string {
  const parts = String(full ?? "").trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

export function slugify(s: unknown): string {
  return noMarks(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** One student per line: "Name", "Name, Class" or "Name, Class, Phone"; tab/semicolon separated works too (pasted from Excel). */
export function parseStudentLines(text: string, defaultClass = ""): { name: string; className: string; phone: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [n, c, ph] = l.split(/\t|,|;/).map((x) => x.trim());
      return { name: n ?? "", className: c || defaultClass.trim(), phone: ph ?? "" };
    });
}

/** Listening script: each line "Speaker: words"; lines without a speaker are narration. */
export function parseDialogue(text: string): { speaker: string | null; text: string }[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([A-Za-z][\w .'-]{0,24}):\s+(.+)$/);
      return m ? { speaker: m[1], text: m[2] } : { speaker: null, text: line };
    });
}

export function questionCount(sections: { questions: unknown[] }[]): number {
  return sections.reduce((n, s) => n + s.questions.length, 0);
}

export const MAX_ESSAY_CHARS = 20_000;

export function wordCount(text: unknown): number {
  return String(text ?? "")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function isAnswered(q: Question, v: AnswerValue | undefined): boolean {
  if (q.type === "essay") return wordCount(v) > 0;
  if (q.type === "speak") return typeof v === "string" && v !== "";
  return q.type === "fill" ? normAnswer(v) !== "" : typeof v === "number";
}

export function isCorrect(q: Question, v: AnswerValue | undefined): boolean {
  if (q.type === "essay" || q.type === "speak") return false;
  if (q.type === "fill") {
    const a = normAnswer(v);
    return a !== "" && q.answer.some((x) => normAnswer(x) === a);
  }
  return v === q.answer;
}

export type GradeResult = {
  correct: number;
  total: number;
  wrong: number;
  unanswered: number;
};

export function grade(sections: Section[], answers: Answers): GradeResult {
  let correct = 0;
  let total = 0;
  let unanswered = 0;
  sections.forEach((sec, si) => {
    sec.questions.forEach((q, qi) => {
      if (q.type === "essay" || q.type === "speak") return; // marked by the teacher, not auto-graded
      const v = answers[`${si}-${qi}`];
      total++;
      if (!isAnswered(q, v)) unanswered++;
      else if (isCorrect(q, v)) correct++;
    });
  });
  return { correct, total, unanswered, wrong: total - correct - unanswered };
}

// Approximate IELTS conversion after scaling the score to 40 questions.
const BANDS: Record<IeltsKind, [number, number][]> = {
  listening: [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [11, 4], [8, 3.5], [6, 3], [4, 2.5], [0, 0]],
  reading: [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [0, 0]],
};

export function bandFor(kind: IeltsSkill | undefined | null, correct: number, total: number): number | null {
  const table = kind === "listening" || kind === "reading" ? BANDS[kind] : undefined;
  if (!table || !total) return null;
  const scaled = Math.round((correct / total) * 40);
  for (const [min, band] of table) if (scaled >= min) return band;
  return 0;
}

export function hasEssay(sections: { questions: { type: string }[] }[]): boolean {
  return sections.some((s) => s.questions.some((q) => q.type === "essay"));
}

export function hasSpeak(sections: { questions: { type: string }[] }[]): boolean {
  return sections.some((s) => s.questions.some((q) => q.type === "speak"));
}

export const SPEAKING_CRITERIA = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];

export const WRITING_CRITERIA = ["Task Achievement / Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];

/** IELTS rounding of the four criteria (Writing or Speaking): .25 rounds up to .5, .75 rounds up to the next band. */
export function writingBand(criteria: number[]): number | null {
  if (criteria.length !== 4 || criteria.some((c) => !Number.isFinite(c) || c < 0 || c > 9)) return null;
  const avg = criteria.reduce((a, b) => a + b, 0) / 4;
  const base = Math.floor(avg);
  const frac = avg - base;
  return frac < 0.25 ? base : frac < 0.75 ? base + 0.5 : base + 1;
}

/** The last two words of a name without accents: "Trần Bảo An" → "baoan". */
export function lastTwoWords(name: string): string {
  const words = noMarks(name).toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.slice(-2).join("").slice(0, 20);
}

/** IELTS rounding to the nearest half band: .25 → .5, .75 → next band. */
export function roundBand(x: number): number {
  const base = Math.floor(x);
  const frac = x - base;
  return frac < 0.25 ? base : frac < 0.75 ? base + 0.5 : base + 1;
}

/** One Writing band for a test: Task 2 counts double when there are two tasks; null until every task is marked. */
export function writingTestBand(taskBands: (number | null | undefined)[]): number | null {
  if (!taskBands.length || taskBands.some((b) => b == null)) return null;
  const b = taskBands as number[];
  return roundBand(b.length === 2 ? (b[0] + 2 * b[1]) / 3 : b.reduce((s, x) => s + x, 0) / b.length);
}

/** Competition ranking (1, 2, 2, 4) by value, highest first. */
export function rankBy<T>(items: T[], value: (t: T) => number): { item: T; rank: number }[] {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  let rank = 0;
  return sorted.map((item, i) => {
    if (i === 0 || value(item) !== value(sorted[i - 1])) rank = i + 1;
    return { item, rank };
  });
}

/**
 * "Xxxxx" + 4 digits derived from the student's id, for rankings shown to others.
 * Not the end of the login code: with a classmate's name that would give the code away.
 */
export function maskedName(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return "Xxxxx" + String((h >>> 0) % 10000).padStart(4, "0");
}

export function percent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

/**
 * Parent code = the student's code with "ph" before the last 4 digits:
 * "thanhtoan3580" → "thanhtoanph3580". Codes without 4 trailing digits just get "ph" appended.
 */
export function parentCodeFor(studentCode: string): string {
  const m = /^(.*?)(\d{4})$/.exec(studentCode);
  return m ? `${m[1]}ph${m[2]}` : `${studentCode}ph`;
}

/** Code from the last two words of the name + last 4 phone digits: "Trần Bảo An", 0912 344 821 → "baoan4821". */
export function phoneCode(name: string, phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  const base = lastTwoWords(name);
  return base ? base + digits.slice(-4) : null;
}

/** Returns a list of problems with a quiz definition; empty when valid. */
export function validateSections(sections: Section[]): string[] {
  const errors: string[] = [];
  if (!sections.length) errors.push("Bài cần ít nhất một phần (section).");
  let num = 0;
  sections.forEach((sec, si) => {
    if (!sec.questions.length) errors.push(`Phần ${si + 1} chưa có câu hỏi.`);
    sec.questions.forEach((q) => {
      num++;
      if (!q.q.trim()) errors.push(`Câu ${num}: chưa nhập nội dung câu hỏi.`);
      if (q.type === "mcq") {
        const opts = q.options.filter((o) => o.trim());
        if (opts.length < 2) errors.push(`Câu ${num}: cần ít nhất 2 lựa chọn.`);
        if (opts.length !== q.options.length) errors.push(`Câu ${num}: có lựa chọn đang để trống.`);
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length)
          errors.push(`Câu ${num}: chưa chọn đáp án đúng.`);
      } else if (q.type === "essay") {
        if (q.minWords != null && (!Number.isInteger(q.minWords) || q.minWords < 0 || q.minWords > 2000))
          errors.push(`Câu ${num}: số từ tối thiểu phải từ 0 đến 2000.`);
      } else if (q.type === "speak") {
        if (!Number.isInteger(q.answerSec) || q.answerSec < 5 || q.answerSec > 300) errors.push(`Câu ${num}: thời gian trả lời phải từ 5 đến 300 giây.`);
        if (q.prepSec != null && (!Number.isInteger(q.prepSec) || q.prepSec < 0 || q.prepSec > 120)) errors.push(`Câu ${num}: thời gian chuẩn bị phải từ 0 đến 120 giây.`);
      } else if (!q.answer.some((a) => normAnswer(a))) {
        errors.push(`Câu ${num}: cần ít nhất một đáp án được chấp nhận.`);
      }
    });
  });
  if (hasSpeak(sections) && sections.some((s) => s.questions.some((q) => q.type !== "speak")))
    errors.push("Bài Speaking chỉ gồm câu hỏi dạng “Nói (thu âm)”. Tách các câu khác sang bài riêng.");
  return errors;
}

/**
 * Vietnamese alphabetical order. One shared collator, created on first use: making one per
 * comparison is very slow, and making it while the code loads would slow down every function.
 */
let viCollator: Intl.Collator | null = null;
export function viCompare(a: string, b: string): number {
  viCollator ??= new Intl.Collator("vi");
  return viCollator.compare(a, b);
}
