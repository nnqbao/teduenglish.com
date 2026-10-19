import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { quizFileIds, recordingIds } from "./lib";
import { DRAFT_KEEP_DAYS } from "./drafts";
import { RECORDING_KEEP_DAYS, hasSpeak } from "./model";

/** Removes expired sessions and login attempts older than a day. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oldStudent = await ctx.db.query("studentSessions").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(500);
    for (const s of oldStudent) await ctx.db.delete(s._id);
    const oldAdmin = await ctx.db.query("adminSessions").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(500);
    for (const s of oldAdmin) await ctx.db.delete(s._id);
    const oldParent = await ctx.db.query("parentSessions").withIndex("by_expiresAt", (q) => q.lt("expiresAt", now)).take(500);
    for (const s of oldParent) await ctx.db.delete(s._id);
    // Speaking recordings older than the keep period: delete the audio, keep marks and comments.
    const used = new Set<string>();
    const keepFrom = now - RECORDING_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const q of await ctx.db.query("quizzes").collect()) {
      if (!hasSpeak(q.sections)) continue;
      for (const a of await ctx.db.query("attempts").withIndex("by_quiz", (x) => x.eq("quizId", q._id)).collect()) {
        const recs = recordingIds(q, a);
        if (!recs.length) continue;
        if (a.submittedAt >= keepFrom) {
          recs.forEach(([, id]) => used.add(id));
          continue;
        }
        const answers = { ...a.answers };
        for (const [key, id] of recs) {
          answers[key] = "";
          await ctx.storage.delete(id).catch(() => {});
        }
        await ctx.db.patch(a._id, { answers, recordingsPurged: true });
      }
    }
    // Uploads that never got attached to a resource, quiz or attempt (form closed before saving, abandoned test).
    for (const r of await ctx.db.query("resources").collect()) if (r.file) used.add(r.file.storageId);
    for (const d of await ctx.db.query("drafts").collect()) d.files?.forEach((id) => used.add(id));
    for (const q of await ctx.db.query("quizzes").collect()) quizFileIds(q.sections).forEach((id) => used.add(id));
    for (const a of await ctx.db.query("clarifyAnswers").collect()) a.files.forEach((f) => used.add(f.storageId));
    const files = await ctx.db.system.query("_storage").collect();
    for (const f of files) if (!used.has(f._id) && f._creationTime < now - 24 * 60 * 60 * 1000) await ctx.storage.delete(f._id);
    // Unfinished tests nobody came back to.
    const oldDrafts = await ctx.db.query("drafts").withIndex("by_updatedAt", (q) => q.lt("updatedAt", now - DRAFT_KEEP_DAYS * 24 * 60 * 60 * 1000)).take(500);
    for (const d of oldDrafts) await ctx.db.delete(d._id);
    for (const kind of ["student", "admin"] as const) {
      const old = await ctx.db.query("loginAttempts").withIndex("by_kind_at", (q) => q.eq("kind", kind).lt("at", now - 24 * 60 * 60 * 1000)).take(1000);
      for (const a of old) await ctx.db.delete(a._id);
    }
  },
});

const crons = cronJobs();
crons.daily("cleanup sessions", { hourUTC: 19, minuteUTC: 0 }, internal.crons.cleanup);
export default crons;
