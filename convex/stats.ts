import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { allFolders, attemptBand, canOpen, requireAdmin, skillOf } from "./lib";
import { allCards, scoresOf, type Card } from "./summary";
import { maskedName, normCode, parentCodeFor, percent, rankBy, type IeltsSkill, viCompare } from "./model";

type Ctx = QueryCtx | MutationCtx;

/* ======================= IELTS bands ======================= */

export { skillOf, attemptBand };

export type IeltsTest = { id: string; title: string; skill: IeltsSkill; folder: string };

/**
 * Best band per student per IELTS test (from the small score rows, not the attempts).
 * Scheduled exams count only once their results are released, unless `withUnreleased` (teachers).
 */
export async function ieltsBoard(ctx: Ctx, withUnreleased = false) {
  const tests: IeltsTest[] = [];
  const scores: Record<string, Record<string, number>> = {};
  for (const c of await allCards(ctx)) {
    if (!c.skill || (c.exam && !c.exam.releasedAt && !withUnreleased)) continue;
    tests.push({ id: c.slug, title: c.title, skill: c.skill, folder: c.folder });
    for (const s of await ctx.db.query("scores").withIndex("by_quiz", (x) => x.eq("quizId", c.quizId)).collect())
      if (s.band != null) (scores[s.studentId] ??= {})[c.slug] = s.band;
  }
  return { tests, scores };
}

export type RankScope = "all" | IeltsSkill;
export type RankRow = { rank: number; label: string; me: boolean; average: number; tests: number };

/**
 * IELTS ranking inside the student's class, shown to the student only (parents never see it).
 * Classmates appear as masked names; tables keep the top 10 plus the student's own row.
 */
export async function classRanking(ctx: Ctx, student: Doc<"students">) {
  const { tests, scores } = await ieltsBoard(ctx);
  const mine = scores[student._id] ?? {};
  const classmates = (await ctx.db.query("students").withIndex("by_class", (q) => q.eq("className", student.className)).collect()).filter(
    (s) => s.active || s._id === student._id,
  );

  const perTest = tests
    .filter((t) => mine[t.id] != null)
    .map((t) => {
      const ranked = rankBy(
        classmates.filter((s) => scores[s._id]?.[t.id] != null),
        (s) => scores[s._id][t.id],
      );
      return { id: t.id, title: t.title, skill: t.skill, band: mine[t.id], rank: ranked.find((r) => r.item._id === student._id)!.rank, of: ranked.length };
    });

  const scopes: { scope: RankScope; myRank: number | null; of: number; table: RankRow[] }[] = [];
  for (const scope of ["all", "listening", "reading", "writing", "speaking"] as RankScope[]) {
    const ids = tests.filter((t) => scope === "all" || t.skill === scope).map((t) => t.id);
    const avg = (id: string) => {
      const vals = ids.map((t) => scores[id]?.[t]).filter((x): x is number => x != null);
      return vals.length ? { average: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, tests: vals.length } : null;
    };
    const rows = classmates.map((s) => ({ s, a: avg(s._id) })).filter((x): x is { s: Doc<"students">; a: { average: number; tests: number } } => !!x.a);
    if (!rows.length) continue;
    const table = rankBy(rows, (x) => x.a.average).map((r) => ({
      rank: r.rank,
      label: r.item.s._id === student._id ? student.name : maskedName(r.item.s._id),
      me: r.item.s._id === student._id,
      average: r.item.a.average,
      tests: r.item.a.tests,
    }));
    scopes.push({ scope, myRank: table.find((r) => r.me)?.rank ?? null, of: table.length, table: table.filter((r, i) => i < 10 || r.me) });
  }
  return { className: student.className, perTest, scopes };
}

/* ======================= completion (chuyên cần) ======================= */

export type Progress = {
  total: number;
  done: number;
  rate: number;
  byFolder: { id: string; name: string; total: number; done: number; rate: number }[];
  pending: { id: string; title: string; folder: string }[];
};

type ProgressQuiz = Pick<Card, "quizId" | "slug" | "title" | "folder" | "published">;

/** Assigned = published web quizzes in the student's open folders; done = submitted at least once. */
export function progressOf(student: Doc<"students">, folders: Doc<"folders">[], quizzes: ProgressQuiz[], doneQuizIds: Set<Id<"quizzes">>): Progress {
  const byFolder: Progress["byFolder"] = [];
  const pending: Progress["pending"] = [];
  let total = 0;
  let done = 0;
  for (const f of folders) {
    if (!canOpen(student, f.slug)) continue;
    const list = quizzes.filter((q) => q.published && q.folder === f.slug);
    if (!list.length) continue;
    const d = list.filter((q) => doneQuizIds.has(q.quizId)).length;
    byFolder.push({ id: f.slug, name: f.name, total: list.length, done: d, rate: percent(d, list.length) });
    pending.push(...list.filter((q) => !doneQuizIds.has(q.quizId)).map((q) => ({ id: q.slug, title: q.title, folder: f.name })));
    total += list.length;
    done += d;
  }
  return { total, done, rate: percent(done, total), byFolder, pending };
}

export async function progressFor(ctx: Ctx, student: Doc<"students">) {
  const scores = await scoresOf(ctx, student._id);
  return progressOf(student, await allFolders(ctx), await allCards(ctx), new Set(scores.map((s) => s.quizId)));
}

/* ======================= admin views ======================= */

export const leaderboard = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const { tests, scores } = await ieltsBoard(ctx, true);
    const students = (await ctx.db.query("students").collect()).filter((s) => scores[s._id]);
    return {
      tests,
      rows: students.map((s) => ({ id: s._id, name: s.name, className: s.className, code: s.code, scores: scores[s._id] })),
    };
  },
});

export const attendance = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const folders = await allFolders(ctx);
    const quizzes = await allCards(ctx);
    const doneBy = new Map<string, Set<Id<"quizzes">>>();
    for (const s of await ctx.db.query("scores").collect()) (doneBy.get(s.studentId) ?? doneBy.set(s.studentId, new Set()).get(s.studentId)!).add(s.quizId);
    const students = (await ctx.db.query("students").collect()).filter((s) => s.active);
    return students
      .map((s) => {
        const p = progressOf(s, folders, quizzes, doneBy.get(s._id) ?? new Set());
        return { id: s._id, name: s.name, className: s.className, code: s.code, total: p.total, done: p.done, rate: p.rate, byFolder: p.byFolder, pending: p.pending.length };
      })
      .sort((a, b) => viCompare(a.className, b.className) || viCompare(a.name, b.name));
  },
});

/* ======================= parent codes ======================= */

export async function parentByCode(ctx: Ctx, code: string) {
  const c = normCode(code);
  if (!c) return null;
  return ctx.db.query("students").withIndex("by_parentCode", (q) => q.eq("parentCode", c)).first();
}

/** Keeps a student's parent code in step with their student code; returns true when it changed. */
export async function syncParentCode(ctx: MutationCtx, s: Doc<"students">) {
  const parentCode = parentCodeFor(s.code);
  if (s.parentCode === parentCode) return false;
  await ctx.db.patch(s._id, { parentCode });
  return true;
}

/** Recomputes every parent code from the student code (e.g. after the format changed). */
async function syncAll(ctx: MutationCtx) {
  let n = 0;
  for (const s of await ctx.db.query("students").collect()) if (await syncParentCode(ctx, s)) n++;
  return n;
}

export const fillParentCodes = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return syncAll(ctx);
  },
});

/** npx convex run stats:syncParentCodes */
export const syncParentCodes = internalMutation({ args: {}, handler: (ctx) => syncAll(ctx) });
