import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { canOpen, quizBySlug, studentFromToken } from "./lib";
import type { Id } from "./_generated/dataModel";
import { MAX_RECORDING_BYTES, hasSpeak } from "./model";

/* Unfinished tests, saved as the student works so they can carry on later from any device. */

const MAX_STATE_CHARS = 300_000;
/** Drafts nobody came back to are dropped after this long (see crons). */
export const DRAFT_KEEP_DAYS = 60;

async function sitting(ctx: QueryCtx, token: string | undefined, id: string) {
  const student = await studentFromToken(ctx, token);
  const quiz = await quizBySlug(ctx, id);
  if (!student || !quiz || !quiz.published || !canOpen(student, quiz.folder)) return null;
  return { student, quiz };
}

export const get = query({
  args: { token: v.optional(v.string()), id: v.string() },
  handler: async (ctx, args) => {
    const s = await sitting(ctx, args.token, args.id);
    if (!s) return null;
    const d = await ctx.db
      .query("drafts")
      .withIndex("by_student_quiz", (q) => q.eq("studentId", s.student._id).eq("quizId", s.quiz._id))
      .first();
    if (!d) return null;
    // Speaking: playable links for the recordings already made.
    const fileUrls: Record<string, string> = {};
    for (const f of d.files ?? []) {
      const url = await ctx.storage.getUrl(f);
      if (url) fileUrls[f] = url;
    }
    return { state: d.state, elapsedSec: d.elapsedSec, updatedAt: d.updatedAt, fileUrls };
  },
});

export const save = mutation({
  args: {
    token: v.string(),
    id: v.string(),
    state: v.string(),
    answered: v.number(),
    total: v.number(),
    elapsedSec: v.number(),
    // Speaking: uploaded recordings this draft refers to (kept until it is submitted or dropped).
    files: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const s = await sitting(ctx, args.token, args.id);
    if (!s || args.state.length > MAX_STATE_CHARS || (args.files?.length ?? 0) > 100) return false;
    const files: Id<"_storage">[] = [];
    if (hasSpeak(s.quiz.sections))
      for (const f of args.files ?? []) {
        const id = ctx.db.system.normalizeId("_storage", f);
        const meta = id ? await ctx.db.system.get(id) : null;
        if (id && meta && (meta.contentType ?? "").startsWith("audio/") && meta.size <= MAX_RECORDING_BYTES) files.push(id);
      }
    const data = {
      state: args.state,
      answered: Math.max(0, Math.round(args.answered)),
      total: Math.max(0, Math.round(args.total)),
      elapsedSec: Math.max(0, Math.min(86_400, Math.round(args.elapsedSec))),
      updatedAt: Date.now(),
      ...(files.length ? { files } : {}),
    };
    const prev = await ctx.db
      .query("drafts")
      .withIndex("by_student_quiz", (q) => q.eq("studentId", s.student._id).eq("quizId", s.quiz._id))
      .first();
    if (prev) await ctx.db.replace(prev._id, { studentId: s.student._id, quizId: s.quiz._id, ...data });
    else await ctx.db.insert("drafts", { studentId: s.student._id, quizId: s.quiz._id, ...data });
    return true;
  },
});

/** "Làm lại từ đầu": forget the unfinished sitting. */
export const discard = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const s = await sitting(ctx, args.token, args.id);
    if (!s) return;
    for (const d of await ctx.db
      .query("drafts")
      .withIndex("by_student_quiz", (q) => q.eq("studentId", s.student._id).eq("quizId", s.quiz._id))
      .collect())
      await ctx.db.delete(d._id);
  },
});
