import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { fail, requireAdmin } from "./lib";
import type { ExamInfo } from "./model";
import { syncCard } from "./summary";

/*
 * Scheduled exams (e.g. the November IELTS mock test). A quiz with `exam` set is listed but locked
 * until it opens, then closes again; each student gets one attempt, and results stay hidden until the
 * teacher releases them. Opening and closing on time is done by scheduled functions that change the
 * quiz's `phase`: queries can't watch the clock, but they do re-run when data changes, so every open
 * page unlocks at the right moment.
 */

/** Phase implied by the schedule at `now` (manual mode stays as it is). */
export function phaseAt(e: { opensAt?: number; closesAt?: number; phase?: ExamInfo["phase"] }, now: number): ExamInfo["phase"] {
  if (e.opensAt == null) return e.phase ?? "upcoming";
  if (now < e.opensAt) return "upcoming";
  if (e.closesAt != null && now >= e.closesAt) return "ended";
  return "open";
}

/** Queues the open/close switches for a quiz's schedule (stale ones check the time and do nothing). */
export async function scheduleExam(ctx: MutationCtx, quizId: Id<"quizzes">, e: ExamInfo) {
  const now = Date.now();
  if (e.opensAt != null && e.opensAt > now) await ctx.scheduler.runAt(e.opensAt, internal.exam.tick, { quizId, kind: "open", at: e.opensAt });
  if (e.closesAt != null && e.closesAt > now) await ctx.scheduler.runAt(e.closesAt, internal.exam.tick, { quizId, kind: "close", at: e.closesAt });
}

async function setExam(ctx: MutationCtx, q: Doc<"quizzes">, patch: Partial<ExamInfo>) {
  if (!q.exam) fail("Bài này không phải bài thi tập trung.");
  const next = { ...q.exam, ...patch };
  // Nested objects can't hold undefined: drop cleared fields.
  for (const k of Object.keys(next) as (keyof ExamInfo)[]) if (next[k] === undefined) delete next[k];
  await ctx.db.patch(q._id, { exam: next });
  await syncCard(ctx, q._id);
}

export const tick = internalMutation({
  args: { quizId: v.id("quizzes"), kind: v.union(v.literal("open"), v.literal("close")), at: v.number() },
  handler: async (ctx, args) => {
    const q = await ctx.db.get(args.quizId);
    if (!q?.exam) return;
    // Only if the schedule still says so and nobody changed the phase by hand meanwhile.
    if (args.kind === "open" && q.exam.opensAt === args.at && q.exam.phase === "upcoming") await setExam(ctx, q, { phase: "open" });
    if (args.kind === "close" && q.exam.closesAt === args.at && q.exam.phase === "open") await setExam(ctx, q, { phase: "ended", endedAt: Date.now() });
  },
});

/** Teacher's buttons: open now, close now, or put back to "not open yet". */
export const setPhase = mutation({
  args: { token: v.string(), id: v.id("quizzes"), phase: v.union(v.literal("upcoming"), v.literal("open"), v.literal("ended")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const q = await ctx.db.get(args.id);
    if (!q) fail("Không tìm thấy bài.");
    await setExam(ctx, q, { phase: args.phase, ...(args.phase === "ended" ? { endedAt: Date.now() } : {}) });
  },
});

/** Shows (or hides again) scores, bands and answers to the students who took the exam. */
export const release = mutation({
  args: { token: v.string(), id: v.id("quizzes"), released: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const q = await ctx.db.get(args.id);
    if (!q) fail("Không tìm thấy bài.");
    await setExam(ctx, q, { releasedAt: args.released ? Date.now() : undefined });
  },
});
