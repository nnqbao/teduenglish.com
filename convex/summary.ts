import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { attemptBand, focusGuardOn, requireAdmin, skillOf, type DoneRecord } from "./lib";
import { hasEssay, hasSpeak, questionCount } from "./model";
import { mutation } from "./_generated/server";

/*
 * Small summary tables so lists, dashboards and rankings don't read every quiz (with all its
 * questions) and every attempt (with all its answers) on each refresh:
 *   quizCards: a quiz's settings without the questions;
 *   scores:    one row per student and quiz with their best result, band and review state.
 * They are rebuilt from the source rows whenever those change.
 */

type Ctx = QueryCtx | MutationCtx;
export type Card = Doc<"quizCards">;
export type Score = Doc<"scores">;

function cardOf(q: Doc<"quizzes">) {
  return {
    quizId: q._id,
    slug: q.slug,
    folder: q.folder,
    title: q.title,
    subtitle: q.subtitle,
    minutes: q.minutes,
    code: q.code,
    featured: q.featured,
    ielts: q.ielts,
    published: q.published,
    timer: q.timer,
    accent: q.accent,
    speakPrep: q.speakPrep,
    term: q.term,
    order: q.order,
    updatedAt: q.updatedAt,
    questionCount: questionCount(q.sections),
    hasEssay: hasEssay(q.sections),
    hasSpeak: hasSpeak(q.sections),
    guard: focusGuardOn(q),
    skill: skillOf(q) ?? undefined,
  };
}

/** Call after a quiz is created, changed or deleted. */
export async function syncCard(ctx: MutationCtx, quizId: Id<"quizzes">) {
  const q = await ctx.db.get(quizId);
  const card = await ctx.db.query("quizCards").withIndex("by_quiz", (x) => x.eq("quizId", quizId)).first();
  if (!q) {
    if (card) await ctx.db.delete(card._id);
    for (const s of await ctx.db.query("scores").withIndex("by_quiz", (x) => x.eq("quizId", quizId)).collect()) await ctx.db.delete(s._id);
    return;
  }
  const data = cardOf(q);
  const skillChanged = (card?.skill ?? null) !== (data.skill ?? null);
  if (card) await ctx.db.replace(card._id, data);
  else await ctx.db.insert("quizCards", data);
  // Bands depend on the skill: recompute everyone's for this quiz.
  if (skillChanged) for (const s of await ctx.db.query("scores").withIndex("by_quiz", (x) => x.eq("quizId", quizId)).collect()) await refreshScore(ctx, s.studentId, quizId);
}

/** Call after an attempt is added, reviewed, reopened or deleted. */
export async function refreshScore(ctx: MutationCtx, studentId: Id<"students">, quizId: Id<"quizzes">) {
  const row = await ctx.db.query("scores").withIndex("by_student_quiz", (x) => x.eq("studentId", studentId).eq("quizId", quizId)).first();
  const attempts = (await ctx.db.query("attempts").withIndex("by_student", (x) => x.eq("studentId", studentId)).collect())
    .filter((a) => a.quizId === quizId)
    .sort((a, b) => a.submittedAt - b.submittedAt);
  const quiz = await ctx.db.get(quizId);
  if (!attempts.length || !quiz) {
    if (row) await ctx.db.delete(row._id);
    return;
  }
  const pct = (a: Doc<"attempts">) => (a.total ? (a.correct / a.total) * 100 : 0);
  const skill = skillOf(quiz);
  const bands = skill ? attempts.map((a) => attemptBand(quiz, a, skill)).filter((b): b is number => b != null) : [];
  const last = attempts[attempts.length - 1];
  const reviewed = attempts.filter((a) => a.reviewStatus);
  const data = {
    studentId,
    quizId,
    count: attempts.length,
    lastAt: last.submittedAt,
    last: last.correct,
    total: last.total,
    best: Math.max(...attempts.map((a) => a.correct)),
    bestPct: Math.max(...attempts.map(pct)),
    openPct: Math.max(0, ...attempts.filter((a) => !a.reopened).map(pct)),
    sumPct: attempts.filter((a) => a.total > 0).reduce((s, a) => s + pct(a), 0),
    ...(reviewed.length ? { review: reviewed[reviewed.length - 1].reviewStatus } : {}),
    ...(bands.length ? { band: Math.max(...bands) } : {}),
  };
  if (row) await ctx.db.replace(row._id, data);
  else await ctx.db.insert("scores", data);
}

/** All quiz cards, in folder order. */
export async function allCards(ctx: Ctx): Promise<Card[]> {
  return (await ctx.db.query("quizCards").collect()).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export async function cardByQuiz(ctx: Ctx, quizId: Id<"quizzes">) {
  return ctx.db.query("quizCards").withIndex("by_quiz", (x) => x.eq("quizId", quizId)).first();
}

export async function scoresOf(ctx: Ctx, studentId: Id<"students">) {
  return ctx.db.query("scores").withIndex("by_student_quiz", (x) => x.eq("studentId", studentId)).collect();
}

export const isLocked = (s: Score | undefined | null, lockAtPercent: number) => !!s && lockAtPercent > 0 && s.openPct >= lockAtPercent;

export async function scoreOf(ctx: Ctx, studentId: Id<"students">, quizId: Id<"quizzes">) {
  return ctx.db.query("scores").withIndex("by_student_quiz", (x) => x.eq("studentId", studentId).eq("quizId", quizId)).first();
}

/** The student's results by quiz slug, for the dashboard and folder pages. */
export function doneMap(scores: Score[], cards: Card[], lockAtPercent: number): Record<string, DoneRecord> {
  const slugOf = new Map(cards.map((c) => [c.quizId, c.slug]));
  const map: Record<string, DoneRecord> = {};
  for (const s of scores) {
    const slug = slugOf.get(s.quizId);
    if (!slug) continue;
    map[slug] = { best: s.best, last: s.last, total: s.total, at: s.lastAt, count: s.count, review: s.review ?? null, locked: isLocked(s, lockAtPercent) };
  }
  return map;
}

async function rebuildAll(ctx: MutationCtx) {
  for (const c of await ctx.db.query("quizCards").collect()) await ctx.db.delete(c._id);
  for (const s of await ctx.db.query("scores").collect()) await ctx.db.delete(s._id);
  for (const q of await ctx.db.query("quizzes").collect()) await ctx.db.insert("quizCards", cardOf(q));
  const pairs = new Set<string>();
  for (const a of await ctx.db.query("attempts").collect()) pairs.add(`${a.studentId}|${a.quizId}`);
  for (const p of pairs) {
    const [studentId, quizId] = p.split("|") as [Id<"students">, Id<"quizzes">];
    await refreshScore(ctx, studentId, quizId);
  }
  return { cards: (await ctx.db.query("quizCards").collect()).length, scores: pairs.size };
}

/** npx convex run summary:rebuild — rebuilds both tables from scratch (after an import or a fix). */
export const rebuild = internalMutation({ args: {}, handler: (ctx) => rebuildAll(ctx) });

/** Same, from the admin area (Cài đặt). */
export const rebuildFromAdmin = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token, { owner: true });
    return rebuildAll(ctx);
  },
});
