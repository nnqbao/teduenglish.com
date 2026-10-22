import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { folderBySlug, getSettings, randomToken, sha256 } from "./lib";
import { SPEAKING_CRITERIA, SPEAKING_REVIEW_KEY, WRITING_CRITERIA, hasSpeak, normCode, percent, type IeltsSkill } from "./model";
import { attemptBand, parentByCode, progressFor, skillOf } from "./stats";

/*
 * /phu-huynh: parents follow their child with a read-only parent code.
 * Only the child's own results: no ranking or classmates, to keep the pressure off.
 */

const PARENT_SESSION_MS = 180 * 24 * 60 * 60 * 1000;
const FAILS_PER_MINUTE = 40;

async function childFromToken(ctx: QueryCtx, token: string | undefined) {
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await ctx.db.query("parentSessions").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
  if (!row || row.expiresAt < Date.now()) return null;
  const s = await ctx.db.get(row.studentId);
  return s && s.active ? s : null;
}

export const login = mutation({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    const code = normCode(args.code);
    if (!code) return { ok: false, error: "Nhập mã phụ huynh do giáo viên cấp." };
    const now = Date.now();
    const fails = await ctx.db
      .query("loginAttempts")
      .withIndex("by_kind_at", (q) => q.eq("kind", "student").gt("at", now - 60_000))
      .filter((q) => q.eq(q.field("ok"), false))
      .collect();
    if (fails.length >= FAILS_PER_MINUTE) return { ok: false, error: "Hệ thống đang bận, vui lòng thử lại sau 1 phút." };
    const s = await parentByCode(ctx, code);
    if (!s || !s.active) {
      await ctx.db.insert("loginAttempts", { kind: "student", key: `ph:${code}`.slice(0, 40), ok: false, at: now });
      return { ok: false, error: "Mã phụ huynh chưa đúng. Vui lòng kiểm tra lại hoặc liên hệ giáo viên." };
    }
    const tok = randomToken();
    await ctx.db.insert("parentSessions", { studentId: s._id, tokenHash: await sha256(tok), expiresAt: now + PARENT_SESSION_MS });
    return { ok: true, token: tok };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256(args.token);
    const row = await ctx.db.query("parentSessions").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const overview = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const child = await childFromToken(ctx, args.token);
    if (!child) return null;
    const settings = await getSettings(ctx);
    const progress = await progressFor(ctx, child);

    // Results: best score per quiz the child has submitted.
    const attempts = await ctx.db.query("attempts").withIndex("by_student", (q) => q.eq("studentId", child._id)).collect();
    const byQuiz = new Map<string, Doc<"attempts">[]>();
    for (const a of attempts) (byQuiz.get(a.quizId) ?? byQuiz.set(a.quizId, []).get(a.quizId)!).push(a);
    const results: {
      id: string;
      title: string;
      folder: string;
      skill: IeltsSkill | null;
      attempts: number;
      lastAt: number;
      best: { correct: number; total: number; pct: number } | null;
      band: number | null;
      writing: { status: "pending" | "done"; essays: { prompt: string; band: number | null; criteria: { name: string; band: number }[]; comment: string }[] } | null;
      /** A scheduled exam whose results the teacher hasn't released yet. */
      held: boolean;
    }[] = [];
    for (const [quizId, list] of byQuiz) {
      const q = await ctx.db.get(quizId as Doc<"quizzes">["_id"]);
      if (!q) continue;
      const skill = skillOf(q);
      if (q.exam && !q.exam.releasedAt) {
        results.push({
          id: q.slug,
          title: q.title,
          folder: (await folderBySlug(ctx, q.folder))?.name ?? q.folder,
          skill,
          attempts: list.length,
          lastAt: Math.max(...list.map((a) => a.submittedAt)),
          best: null,
          band: null,
          writing: null,
          held: true,
        });
        continue;
      }
      const scored = list.filter((a) => a.total > 0);
      const best = scored.sort((a, b) => b.correct / b.total - a.correct / a.total)[0];
      const bands = skill ? list.map((a) => attemptBand(q, a, skill)).filter((b): b is number => b != null) : [];
      const lastWriting = list.filter((a) => a.reviewStatus).sort((a, b) => b.submittedAt - a.submittedAt)[0];
      const essays: { prompt: string; band: number | null; criteria: { name: string; band: number }[]; comment: string }[] = [];
      if (lastWriting)
        q.sections.forEach((sec, si) =>
          sec.questions.forEach((qq, qi) => {
            if (qq.type !== "essay") return;
            const r = lastWriting.essayReviews?.[`${si}-${qi}`];
            essays.push({
              prompt: qq.tag || qq.q.split("\n")[0].slice(0, 80),
              band: r?.band ?? null,
              criteria: (r?.criteria ?? []).map((b, i) => ({ name: WRITING_CRITERIA[i], band: b })),
              comment: r?.comment ?? "",
            });
          }),
        );
      const spoken = lastWriting?.essayReviews?.[SPEAKING_REVIEW_KEY];
      if (lastWriting && hasSpeak(q.sections))
        essays.push({
          prompt: "Bài nói (Speaking)",
          band: spoken?.band ?? null,
          criteria: (spoken?.criteria ?? []).map((b, i) => ({ name: SPEAKING_CRITERIA[i], band: b })),
          comment: spoken?.comment ?? "",
        });
      results.push({
        id: q.slug,
        title: q.title,
        folder: (await folderBySlug(ctx, q.folder))?.name ?? q.folder,
        skill,
        attempts: list.length,
        lastAt: Math.max(...list.map((a) => a.submittedAt)),
        best: best ? { correct: best.correct, total: best.total, pct: percent(best.correct, best.total) } : null,
        band: bands.length ? Math.max(...bands) : null,
        writing: lastWriting ? { status: lastWriting.reviewStatus!, essays } : null,
        held: false,
      });
    }
    results.sort((a, b) => b.lastAt - a.lastAt);

    // Score summary: IELTS by skill (band), other folders such as Global Success by average best %.
    const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
    const ielts = (["listening", "reading", "writing", "speaking"] as IeltsSkill[]).flatMap((skill) => {
      const bands = results.filter((r) => r.skill === skill && r.band != null).map((r) => r.band!);
      return bands.length ? [{ skill, tests: bands.length, average: avg(bands), best: Math.max(...bands) }] : [];
    });
    const byFolder = new Map<string, number[]>();
    for (const r of results) if (!r.skill && r.best) (byFolder.get(r.folder) ?? byFolder.set(r.folder, []).get(r.folder)!).push(r.best.pct);
    const folders = [...byFolder].map(([name, pcts]) => ({ name, quizzes: pcts.length, average: Math.round(avg(pcts)) }));

    return {
      child: { name: child.name, className: child.className },
      teacher: settings.teacher,
      centerName: settings.centerName,
      progress,
      results,
      skills: { ielts, folders },
    };
  },
});
