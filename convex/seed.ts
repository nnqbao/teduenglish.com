import { v } from "convex/values";
import { syncCard } from "./summary";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { fail, hashPassword } from "./lib";
import { seedData } from "./seedData";

/**
 * Loads the starter content (folders, sample students, links, quizzes).
 * Run once on an empty deployment:
 *   npx convex run seed:content '{"withSampleStudents": true}'
 */
export const content = internalMutation({
  args: { withSampleStudents: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (await ctx.db.query("folders").first()) fail("Đã có dữ liệu, bỏ qua seed.");
    const now = Date.now();
    const c = seedData.center;
    const demo = args.withSampleStudents ? seedData.students[0]?.code ?? "" : "";
    await ctx.db.insert("settings", {
      centerName: c.name,
      tagline: c.tagline,
      teacher: c.teacher,
      contact: c.contact,
      showDemoHint: !!demo,
      demoCode: demo,
      updatedAt: now,
    });
    for (const f of seedData.folders) await ctx.db.insert("folders", f);
    if (args.withSampleStudents)
      for (const s of seedData.students) await ctx.db.insert("students", { ...s, active: true, note: "Học sinh mẫu", createdAt: now });
    for (const r of seedData.resources)
      await ctx.db.insert("resources", { ...r, kind: r.kind as "exercise" | "game" | "video" | "doc" });
    for (const q of seedData.quizzes) {
      const id = await ctx.db.insert("quizzes", {
        ...q,
        ielts: "ielts" in q ? (q.ielts as "listening" | "reading") : undefined,
        sections: q.sections as Doc<"quizzes">["sections"],
        updatedAt: now,
      });
      await syncCard(ctx, id);
    }
    return {
      folders: seedData.folders.length,
      students: args.withSampleStudents ? seedData.students.length : 0,
      resources: seedData.resources.length,
      quizzes: seedData.quizzes.length,
    };
  },
});

/**
 * Creates (or resets) an owner account with a one-time password that must be changed at first login.
 *   npx convex run seed:bootstrapAdmin '{"email":"...","name":"...","password":"..."}'
 */
export const bootstrapAdmin = internalMutation({
  args: { email: v.string(), name: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (args.password.length < 8) fail("Mật khẩu tạm cần ít nhất 8 ký tự.");
    const passwordHash = await hashPassword(args.password);
    const existing = await ctx.db.query("admins").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { passwordHash, active: true, role: "owner", mustChangePassword: true });
      return { email, reset: true };
    }
    await ctx.db.insert("admins", {
      email,
      name: args.name.trim() || email,
      passwordHash,
      role: "owner",
      active: true,
      mustChangePassword: true,
      createdAt: Date.now(),
    });
    return { email, reset: false };
  },
});

/** Removes an admin account and its sessions (e.g. a lost or temporary account). */
export const removeAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const admin = await ctx.db.query("admins").withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase())).unique();
    if (!admin) return { removed: false };
    for (const s of await ctx.db.query("adminSessions").withIndex("by_admin", (q) => q.eq("adminId", admin._id)).collect()) await ctx.db.delete(s._id);
    await ctx.db.delete(admin._id);
    return { removed: true };
  },
});

/** Clears one student's attempts and unlocked quiz codes (e.g. after testing with the demo code). */
export const resetStudentProgress = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const student = await ctx.db.query("students").withIndex("by_code", (q) => q.eq("code", args.code.trim().toLowerCase())).first();
    if (!student) return { found: false };
    const attempts = await ctx.db.query("attempts").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect();
    for (const a of attempts) await ctx.db.delete(a._id);
    for (const s of await ctx.db.query("scores").withIndex("by_student_quiz", (q) => q.eq("studentId", student._id)).collect()) await ctx.db.delete(s._id);
    const unlocks = await ctx.db.query("quizUnlocks").withIndex("by_student_quiz", (q) => q.eq("studentId", student._id)).collect();
    for (const u of unlocks) await ctx.db.delete(u._id);
    return { found: true, attempts: attempts.length, unlocks: unlocks.length };
  },
});
