import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canOpen, fail, focusGuardOn, quizBySlug, requireAdmin, saveAttempt, studentFromToken } from "./lib";
import { refreshScore, scoreOf } from "./summary";

/*
 * Guarded tests (IELTS Reading/Writing by default). Leaving the page for another tab or app:
 *   1st time: a reminder only;
 *   2nd time: a 10-second countdown, not back in time → locked;
 *   3rd time: a 5-second countdown, not back in time → locked;
 *   4th time: locked at once.
 * A lock submits what the student has done and closes the account until a teacher unlocks it.
 * The server enforces the countdown, so closing the tab doesn't escape it.
 */

/** Countdown for each time away, by how many times the student already left; past the end → locked at once. */
export const COUNTDOWNS = [0, 10, 5];
const GRACE_MS = 1500; // network delay on the way back
const limitMs = (seconds: number) => seconds * 1000 + GRACE_MS;

const answersArg = v.record(v.string(), v.union(v.string(), v.number()));

/** "away" events for this test since the student last submitted it (a reload doesn't reset the count). */
export async function awayCount(ctx: QueryCtx, studentId: Id<"students">, quiz: Doc<"quizzes">) {
  const last = (await scoreOf(ctx, studentId, quiz._id))?.lastAt ?? 0;
  return (
    await ctx.db
      .query("focusEvents")
      .withIndex("by_student_quiz", (q) => q.eq("studentId", studentId).eq("quizId", quiz._id).gt("at", last))
      .collect()
  ).length;
}

async function lockStudent(ctx: MutationCtx, student: Doc<"students">, quiz: Doc<"quizzes">, answers: Record<string, string | number>, durationSec?: number) {
  if (!student.active) return;
  await saveAttempt(ctx, quiz, student._id, answers, { durationSec, leftQuiz: true });
  await refreshScore(ctx, student._id, quiz._id);
  await ctx.db.patch(student._id, { active: false, lockedReason: `Rời bài “${quiz.title}” khi đang làm`, lockedAt: Date.now() });
  for (const s of await ctx.db.query("studentSessions").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect()) await ctx.db.delete(s._id);
}

async function guardedTest(ctx: MutationCtx, token: string, id: string) {
  const student = await studentFromToken(ctx, token);
  const quiz = await quizBySlug(ctx, id);
  if (!student || !quiz || !quiz.published || !canOpen(student, quiz.folder) || !focusGuardOn(quiz)) return null;
  return { student, quiz };
}

/**
 * The student left the test page: a reminder, then a countdown, then a lock (see above).
 * `awayMs`: how long ago they left, measured by the page (phones pause pages in the background,
 * so this call can arrive late).
 */
export const away = mutation({
  args: { token: v.string(), id: v.string(), answers: answersArg, durationSec: v.optional(v.number()), awayMs: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "off" } | { status: "reminded"; eventId: Id<"focusEvents"> } | { status: "countdown"; eventId: Id<"focusEvents">; seconds: number } | { status: "locked" }> => {
    const t = await guardedTest(ctx, args.token, args.id);
    if (!t) return { status: "off" };
    const before = await awayCount(ctx, t.student._id, t.quiz);
    const ago = Math.max(0, Math.min(args.awayMs ?? 0, 10 * 60_000));
    const now = Date.now() - ago;
    const seconds = COUNTDOWNS[before] ?? -1; // 0: reminder only, -1: no more chances
    const countdown = seconds > 0;
    const lock = seconds < 0 || (countdown && ago > limitMs(seconds));
    const eventId = await ctx.db.insert("focusEvents", {
      studentId: t.student._id,
      quizId: t.quiz._id,
      at: now,
      ...(args.durationSec != null ? { durationSec: args.durationSec } : {}),
      ...(countdown ? { countdown: true, seconds } : {}),
      ...(lock ? { locked: true } : countdown ? { answers: args.answers } : {}),
    });
    if (lock) {
      await lockStudent(ctx, t.student, t.quiz, args.answers, args.durationSec);
      return { status: "locked" };
    }
    if (!countdown) return { status: "reminded", eventId };
    await ctx.scheduler.runAfter(limitMs(seconds) - ago, internal.guard.deadline, { eventId });
    return { status: "countdown", eventId, seconds };
  },
});

/** The student came back; too late after a countdown means locked. */
export const back = mutation({
  args: { token: v.string(), eventId: v.id("focusEvents"), awayMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ status: "ok" | "locked" }> => {
    const ev = await ctx.db.get(args.eventId);
    const student = await studentFromToken(ctx, args.token);
    if (!ev || !student || ev.studentId !== student._id) return { status: "locked" };
    if (ev.locked) return { status: "locked" };
    const now = Date.now();
    const limit = limitMs(ev.seconds ?? COUNTDOWNS[1]);
    if (ev.countdown && (now - ev.at > limit || (args.awayMs ?? 0) > limit)) {
      const quiz = await ctx.db.get(ev.quizId);
      await ctx.db.patch(ev._id, { locked: true, backAt: now, answers: undefined });
      if (quiz) await lockStudent(ctx, student, quiz, ev.answers ?? {}, ev.durationSec);
      return { status: "locked" };
    }
    // The snapshot was only needed in case of a lock.
    if (!ev.backAt) await ctx.db.patch(ev._id, { backAt: now, answers: undefined });
    return { status: "ok" };
  },
});

/** Runs when the countdown ends: still away (or the tab was closed) → lock. */
export const deadline = internalMutation({
  args: { eventId: v.id("focusEvents") },
  handler: async (ctx, args) => {
    const ev = await ctx.db.get(args.eventId);
    if (!ev || !ev.countdown || ev.backAt || ev.locked) return;
    const student = await ctx.db.get(ev.studentId);
    const quiz = await ctx.db.get(ev.quizId);
    await ctx.db.patch(ev._id, { locked: true, answers: undefined });
    if (student && quiz) await lockStudent(ctx, student, quiz, ev.answers ?? {}, ev.durationSec);
  },
});

/** Teacher unlocks a student who was locked out. */
export const unlock = mutation({
  args: { token: v.string(), id: v.id("students") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const s = await ctx.db.get(args.id);
    if (!s) fail("Không tìm thấy học sinh.");
    await ctx.db.patch(s._id, { active: true, lockedReason: undefined, lockedAt: undefined });
  },
});
