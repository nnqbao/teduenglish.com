import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  ADMIN_SESSION_MS,
  adminFromToken,
  allFolders,
  checkPasswordStrength,
  fail,
  folderBySlug,
  generateStudentCode,
  getSettings,
  hashPassword,
  quizBySlug,
  quizAudioIds,
  quizFileIds,
  quizImageIds,
  recordingIds,
  releaseFiles,
  randomToken,
  requireAdmin,
  sha256,
  studentByCode,
  verifyPassword,
} from "./lib";
import { accentValidator, essayReviewValidator, ieltsValidator, resourceKindValidator, sectionValidator, termValidator, timerValidator, speakModeValidator } from "./schema";
import { cardByQuiz, refreshScore, syncCard } from "./summary";
import { MAX_AUDIO_BYTES, MAX_PDF_BYTES, SPEAKING_REVIEW_KEY, formatBytes, hasSpeak, isCorrect, normCode, parentCodeFor, slugify, validateSections, wordCount, writingBand, viCompare } from "./model";

const tokenArg = { token: v.string() };

function cleanEmail(email: string) {
  return email.trim().toLowerCase();
}

/* ======================= auth ======================= */

const ADMIN_FAILS_LIMIT = 5;
const ADMIN_LOCK_MS = 15 * 60 * 1000;

// Expected failures are returned, not thrown, so the failed-attempt row is kept.
export const login = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    const email = cleanEmail(args.email);
    const now = Date.now();
    const fails = await ctx.db
      .query("loginAttempts")
      .withIndex("by_kind_key_at", (q) => q.eq("kind", "admin").eq("key", email).gt("at", now - ADMIN_LOCK_MS))
      .filter((q) => q.eq(q.field("ok"), false))
      .collect();
    if (fails.length >= ADMIN_FAILS_LIMIT)
      return { ok: false, error: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút." };

    const admin = await ctx.db.query("admins").withIndex("by_email", (q) => q.eq("email", email)).unique();
    const ok = !!admin && admin.active && (await verifyPassword(args.password, admin.passwordHash));
    await ctx.db.insert("loginAttempts", { kind: "admin", key: email, ok, at: now });
    if (!ok || !admin) return { ok: false, error: "Email hoặc mật khẩu chưa đúng." };

    const tok = randomToken();
    await ctx.db.insert("adminSessions", { adminId: admin._id, tokenHash: await sha256(tok), expiresAt: now + ADMIN_SESSION_MS });
    await ctx.db.patch(admin._id, { lastLoginAt: now });
    return { ok: true, token: tok };
  },
});

export const logout = mutation({
  args: tokenArg,
  handler: async (ctx, args) => {
    const tokenHash = await sha256(args.token);
    const row = await ctx.db.query("adminSessions").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const me = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    const admin = await adminFromToken(ctx, args.token);
    if (!admin) return null;
    return { id: admin._id, email: admin.email, name: admin.name, role: admin.role, mustChangePassword: admin.mustChangePassword };
  },
});

export const changePassword = mutation({
  args: { token: v.string(), current: v.string(), next: v.string() },
  handler: async (ctx, args) => {
    const admin = await adminFromToken(ctx, args.token);
    if (!admin) fail("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    if (!(await verifyPassword(args.current, admin.passwordHash))) fail("Mật khẩu hiện tại chưa đúng.");
    if (args.current === args.next) fail("Mật khẩu mới phải khác mật khẩu hiện tại.");
    checkPasswordStrength(args.next);
    await ctx.db.patch(admin._id, { passwordHash: await hashPassword(args.next), mustChangePassword: false });
    // Sign out other devices.
    const keep = await sha256(args.token);
    for (const s of await ctx.db.query("adminSessions").withIndex("by_admin", (q) => q.eq("adminId", admin._id)).collect())
      if (s.tokenHash !== keep) await ctx.db.delete(s._id);
  },
});

/* ======================= overview ======================= */

export const overview = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const students = await ctx.db.query("students").collect();
    const quizzes = await ctx.db.query("quizCards").collect();
    const resources = await ctx.db.query("resources").collect();
    const folders = await ctx.db.query("folders").collect();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = await ctx.db.query("attempts").withIndex("by_submittedAt", (q) => q.gt("submittedAt", weekAgo)).order("desc").collect();
    const latest = recent.slice(0, 12);
    const look = rowLookups(ctx);
    const pending = await ctx.db.query("attempts").withIndex("by_reviewStatus", (q) => q.eq("reviewStatus", "pending")).collect();
    return {
      counts: {
        students: students.filter((s) => s.active).length,
        studentsLocked: students.filter((s) => !s.active).length,
        folders: folders.length,
        quizzes: quizzes.length,
        quizzesDraft: quizzes.filter((q) => !q.published).length,
        resources: resources.length,
        attemptsWeek: recent.length,
        activeStudentsWeek: new Set(recent.map((a) => a.studentId)).size,
        pendingReviews: pending.length,
      },
      latest: await Promise.all(latest.map((a) => attemptRow(ctx, a, look))),
    };
  },
});

/** Memoised student and quiz-card lookups, so a list of attempts reads each student/quiz once (and no questions). */
function rowLookups(ctx: QueryCtx) {
  const students = new Map<Id<"students">, Promise<Doc<"students"> | null>>();
  const cards = new Map<Id<"quizzes">, Promise<Doc<"quizCards"> | null>>();
  return {
    student: (id: Id<"students">) => students.get(id) ?? (students.set(id, ctx.db.get(id)), students.get(id)!),
    card: (id: Id<"quizzes">) => cards.get(id) ?? (cards.set(id, cardByQuiz(ctx, id)), cards.get(id)!),
  };
}

async function attemptRow(ctx: QueryCtx, a: Doc<"attempts">, look = rowLookups(ctx)) {
  const student = await look.student(a.studentId);
  const quiz = await look.card(a.quizId);
  return {
    id: a._id,
    studentId: a.studentId,
    studentName: student?.name ?? "(đã xóa)",
    className: student?.className ?? "",
    quizId: quiz?.slug ?? "",
    quizTitle: quiz?.title ?? "(đã xóa)",
    folder: quiz?.folder ?? "",
    correct: a.correct,
    total: a.total,
    wrong: a.wrong,
    unanswered: a.unanswered,
    band: a.band ?? null,
    submittedAt: a.submittedAt,
    reviewStatus: a.reviewStatus ?? null,
    reopened: !!a.reopened,
    durationSec: a.durationSec ?? null,
    leftQuiz: !!a.leftQuiz,
  };
}

/* ======================= settings ======================= */

export const settings = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return getSettings(ctx);
  },
});

export const saveSettings = mutation({
  args: {
    token: v.string(),
    centerName: v.string(),
    tagline: v.string(),
    teacher: v.string(),
    contact: v.string(),
    showDemoHint: v.boolean(),
    demoCode: v.string(),
    lockAtPercent: v.number(),
  },
  handler: async (ctx, { token, ...data }) => {
    await requireAdmin(ctx, token);
    const clean = {
      centerName: data.centerName.trim() || "TEDU English",
      tagline: data.tagline.trim(),
      teacher: data.teacher.trim() || "thầy cô",
      contact: data.contact.trim(),
      showDemoHint: data.showDemoHint,
      demoCode: normCode(data.demoCode),
      lockAtPercent: Math.max(0, Math.min(100, Math.round(data.lockAtPercent))),
      updatedAt: Date.now(),
    };
    if (clean.showDemoHint && clean.demoCode && !(await studentByCode(ctx, clean.demoCode)))
      fail("Mã dùng thử chưa trùng với mã học sinh nào.");
    const row = await ctx.db.query("settings").first();
    if (row) await ctx.db.patch(row._id, clean);
    else await ctx.db.insert("settings", clean);
  },
});

/* ======================= folders ======================= */

export const folders = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const quizzes = await ctx.db.query("quizCards").collect();
    const resources = await ctx.db.query("resources").collect();
    const students = await ctx.db.query("students").collect();
    return (await allFolders(ctx)).map((f) => ({
      _id: f._id,
      slug: f.slug,
      badge: f.badge,
      name: f.name,
      detail: f.detail,
      order: f.order,
      quizCount: quizzes.filter((q) => q.folder === f.slug).length,
      resourceCount: resources.filter((r) => r.folder === f.slug).length,
      studentCount: students.filter((s) => s.active && (s.folders.includes(f.slug) || s.folders.includes("*"))).length,
    }));
  },
});

export const saveFolder = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.id("folders")),
    slug: v.string(),
    badge: v.string(),
    name: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const name = args.name.trim();
    if (!name) fail("Nhập tên thư mục.");
    const data = { badge: args.badge.trim().slice(0, 3) || name.slice(0, 2).toUpperCase(), name, detail: args.detail.trim() };
    if (args.id) {
      await ctx.db.patch(args.id, data);
      return args.id;
    }
    const slug = slugify(args.slug || name);
    if (!slug) fail("Mã thư mục chỉ gồm chữ không dấu, số và dấu gạch ngang.");
    if (slug === "*") fail("Mã thư mục không hợp lệ.");
    if (await folderBySlug(ctx, slug)) fail(`Đã có thư mục với mã "${slug}".`);
    const all = await ctx.db.query("folders").collect();
    return ctx.db.insert("folders", { ...data, slug, order: all.reduce((m, f) => Math.max(m, f.order), 0) + 1 });
  },
});

export const moveFolder = mutation({
  args: { token: v.string(), id: v.id("folders"), dir: v.union(v.literal(-1), v.literal(1)) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const list = await allFolders(ctx);
    const i = list.findIndex((f) => f._id === args.id);
    const j = i + args.dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) if (list[k].order !== k + 1) await ctx.db.patch(list[k]._id, { order: k + 1 });
  },
});

export const deleteFolder = mutation({
  args: { token: v.string(), id: v.id("folders") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const f = await ctx.db.get(args.id);
    if (!f) return;
    const hasQuiz = await ctx.db.query("quizzes").withIndex("by_folder", (q) => q.eq("folder", f.slug)).first();
    const hasRes = await ctx.db.query("resources").withIndex("by_folder", (q) => q.eq("folder", f.slug)).first();
    if (hasQuiz || hasRes) fail("Thư mục còn bài làm hoặc tài liệu. Chuyển hoặc xóa chúng trước.");
    for (const s of await ctx.db.query("students").collect())
      if (s.folders.includes(f.slug)) await ctx.db.patch(s._id, { folders: s.folders.filter((x) => x !== f.slug) });
    await ctx.db.delete(f._id);
  },
});

/* ======================= students ======================= */

export const students = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("students").collect();
    const stats = new Map<Id<"students">, { count: number; last: number }>();
    for (const sc of await ctx.db.query("scores").collect()) {
      const s = stats.get(sc.studentId) ?? { count: 0, last: 0 };
      s.count += sc.count;
      s.last = Math.max(s.last, sc.lastAt);
      stats.set(sc.studentId, s);
    }
    return rows
      .sort((a, b) => viCompare(a.className, b.className) || viCompare(a.name, b.name))
      .map((s) => ({
        _id: s._id,
        code: s.code,
        name: s.name,
        className: s.className,
        folders: s.folders,
        active: s.active,
        note: s.note ?? "",
        parentCode: s.parentCode ?? "",
        lockedReason: s.lockedReason ?? null,
        lockedAt: s.lockedAt ?? null,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt ?? null,
        attemptCount: stats.get(s._id)?.count ?? 0,
        lastAttemptAt: stats.get(s._id)?.last || null,
      }));
  },
});

async function assertFolders(ctx: MutationCtx, folders: string[]) {
  if (folders.includes("*")) return ["*"];
  const known = new Set((await ctx.db.query("folders").collect()).map((f) => f.slug));
  const clean = [...new Set(folders)].filter((f) => known.has(f));
  return clean;
}

async function assertCodeFree(ctx: MutationCtx, code: string, self?: Id<"students">) {
  if (!/^[a-z0-9._-]{4,40}$/.test(code)) fail("Mã học sinh cần 4–40 ký tự: chữ không dấu, số, dấu chấm hoặc gạch.");
  const other = await studentByCode(ctx, code);
  if (other && other._id !== self) fail(`Mã "${code}" đã được dùng cho ${other.name}.`);
}

export const saveStudent = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.id("students")),
    name: v.string(),
    className: v.string(),
    code: v.string(),
    folders: v.array(v.string()),
    active: v.boolean(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const name = args.name.trim().replace(/\s+/g, " ");
    const className = args.className.trim();
    if (!name) fail("Nhập họ tên học sinh.");
    if (!className) fail("Nhập lớp của học sinh.");
    const folders = await assertFolders(ctx, args.folders);
    const code = normCode(args.code) || (await generateStudentCode(ctx, name));
    await assertCodeFree(ctx, code, args.id);
    const data = { name, className, code, folders, active: args.active, note: args.note.trim() };
    if (args.id) {
      const prev = await ctx.db.get(args.id);
      if (!prev) fail("Không tìm thấy học sinh.");
      await ctx.db.patch(args.id, { ...data, parentCode: parentCodeFor(code), ...(args.active ? { lockedReason: undefined, lockedAt: undefined } : {}) });
      // Changing the code or locking the student signs them out everywhere.
      if (prev.code !== code || !args.active) await clearStudentSessions(ctx, args.id);
      if (prev.code !== code) await clearParentSessions(ctx, args.id);
      return { id: args.id, code };
    }
    const id = await ctx.db.insert("students", { ...data, parentCode: parentCodeFor(code), createdAt: Date.now() });
    return { id, code };
  },
});

export const bulkCreateStudents = mutation({
  args: {
    token: v.string(),
    // `code` is optional: when given (e.g. name + phone digits) it must be free.
    // `style: "lastTwo"` makes random codes from the last two words of the name (baoan + 4 digits).
    rows: v.array(v.object({ name: v.string(), className: v.string(), code: v.optional(v.string()), style: v.optional(v.literal("lastTwo")) })),
    folders: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (args.rows.length > 300) fail("Mỗi lần thêm tối đa 300 học sinh.");
    const folders = await assertFolders(ctx, args.folders);
    const created: { name: string; className: string; code: string; parentCode: string }[] = [];
    const skipped: { name: string; className: string; reason: string }[] = [];
    for (const r of args.rows) {
      const name = r.name.trim().replace(/\s+/g, " ");
      const className = r.className.trim();
      if (!name || !className) {
        skipped.push({ name, className, reason: "Thiếu tên hoặc lớp" });
        continue;
      }
      let code = normCode(r.code);
      if (code) {
        if (!/^[a-z0-9._-]{4,40}$/.test(code)) {
          skipped.push({ name, className, reason: `Mã "${code}" không hợp lệ` });
          continue;
        }
        const other = await studentByCode(ctx, code);
        if (other) {
          skipped.push({ name, className, reason: `Mã "${code}" đã dùng cho ${other.name}` });
          continue;
        }
      } else code = await generateStudentCode(ctx, name, r.style ?? "first");
      const parentCode = parentCodeFor(code);
      await ctx.db.insert("students", { name, className, code, parentCode, folders, active: true, note: "", createdAt: Date.now() });
      created.push({ name, className, code, parentCode });
    }
    return { created, skipped };
  },
});

export const regenerateCode = mutation({
  args: { token: v.string(), id: v.id("students") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const s = await ctx.db.get(args.id);
    if (!s) fail("Không tìm thấy học sinh.");
    const code = await generateStudentCode(ctx, s.name);
    await ctx.db.patch(s._id, { code, parentCode: parentCodeFor(code) });
    await clearStudentSessions(ctx, s._id);
    await clearParentSessions(ctx, s._id);
    return code;
  },
});

export const setStudentsFolders = mutation({
  args: {
    token: v.string(),
    ids: v.array(v.id("students")),
    folder: v.string(),
    add: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    if (!(await folderBySlug(ctx, args.folder))) fail("Không tìm thấy thư mục.");
    for (const id of args.ids) {
      const s = await ctx.db.get(id);
      if (!s || s.folders.includes("*")) continue;
      const has = s.folders.includes(args.folder);
      if (args.add && !has) await ctx.db.patch(id, { folders: [...s.folders, args.folder] });
      if (!args.add && has) await ctx.db.patch(id, { folders: s.folders.filter((f) => f !== args.folder) });
    }
  },
});

async function clearStudentSessions(ctx: MutationCtx, id: Id<"students">) {
  for (const s of await ctx.db.query("studentSessions").withIndex("by_student", (q) => q.eq("studentId", id)).collect())
    await ctx.db.delete(s._id);
}

async function clearParentSessions(ctx: MutationCtx, id: Id<"students">) {
  for (const p of await ctx.db.query("parentSessions").withIndex("by_student", (q) => q.eq("studentId", id)).collect()) await ctx.db.delete(p._id);
}

export const deleteStudent = mutation({
  args: { token: v.string(), id: v.id("students") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    await clearStudentSessions(ctx, args.id);
    await clearParentSessions(ctx, args.id);
    for (const a of await ctx.db.query("attempts").withIndex("by_student", (q) => q.eq("studentId", args.id)).collect())
      await ctx.db.delete(a._id);
    for (const u of await ctx.db.query("quizUnlocks").withIndex("by_student_quiz", (q) => q.eq("studentId", args.id)).collect())
      await ctx.db.delete(u._id);
    for (const d of await ctx.db.query("drafts").withIndex("by_student_quiz", (q) => q.eq("studentId", args.id)).collect()) await ctx.db.delete(d._id);
    for (const s of await ctx.db.query("scores").withIndex("by_student_quiz", (q) => q.eq("studentId", args.id)).collect()) await ctx.db.delete(s._id);
    for (const e of await ctx.db.query("focusEvents").withIndex("by_student_quiz", (q) => q.eq("studentId", args.id)).collect()) await ctx.db.delete(e._id);
    await ctx.db.delete(args.id);
  },
});

/* ======================= resources ======================= */

export const resources = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = (await ctx.db.query("resources").collect()).sort((a, b) => a.folder.localeCompare(b.folder) || a.order - b.order);
    return Promise.all(rows.map(async (r) => ({ ...r, fileUrl: r.file ? await ctx.storage.getUrl(r.file.storageId) : null })));
  },
});

export const generateUploadUrl = mutation({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    return ctx.storage.generateUploadUrl();
  },
});

function cleanFileName(name: string, ext: RegExp = /\.pdf$/i, fallbackExt = ".pdf") {
  const base = name.split(/[\\/]/).pop()?.trim().replace(/[\u0000-\u001f"]/g, "").slice(0, 120) || "tai-lieu";
  return ext.test(base) ? base : `${base}${fallbackExt}`;
}

export const saveResource = mutation({
  args: {
    token: v.string(),
    id: v.optional(v.id("resources")),
    folder: v.string(),
    kind: resourceKindValidator,
    title: v.string(),
    description: v.string(),
    // "file" = PDF, "audio" = MP3 (or another audio format) lesson.
    source: v.union(v.literal("url"), v.literal("file"), v.literal("audio")),
    url: v.string(),
    // A freshly uploaded file; omit to keep the current one.
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    hidden: v.optional(v.boolean()),
    term: termValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const title = args.title.trim();
    if (!title) fail("Nhập tên bài.");
    if (!(await folderBySlug(ctx, args.folder))) fail("Chọn thư mục.");
    const prev = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && !prev) fail("Không tìm thấy tài liệu.");

    let url = "";
    let file: Doc<"resources">["file"];
    if (args.source === "url") {
      url = args.url.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) fail("Đường link cần bắt đầu bằng https://");
    } else if (args.storageId) {
      const meta = await ctx.db.system.get(args.storageId);
      if (!meta) fail("File vừa tải lên không còn, vui lòng chọn lại file.");
      if (args.source === "audio") {
        if (!(meta.contentType ?? "").startsWith("audio/")) fail("Chỉ nhận file âm thanh (MP3, M4A, WAV…).");
        if (meta.size > MAX_AUDIO_BYTES) fail(`File quá lớn (tối đa ${formatBytes(MAX_AUDIO_BYTES)}).`);
        const name = cleanFileName(args.fileName ?? "", /\.(mp3|m4a|wav|ogg|aac|oga|webm)$/i, ".mp3");
        file = { storageId: args.storageId, name, size: meta.size, media: "audio" };
      } else {
        if (!(meta.contentType ?? "").includes("pdf")) fail("Chỉ nhận file PDF.");
        if (meta.size > MAX_PDF_BYTES) fail(`File quá lớn (tối đa ${formatBytes(MAX_PDF_BYTES)}).`);
        file = { storageId: args.storageId, name: cleanFileName(args.fileName ?? ""), size: meta.size };
      }
    } else if (prev?.file && (prev.file.media === "audio") === (args.source === "audio")) {
      file = prev.file;
    } else {
      fail(args.source === "audio" ? "Chọn file MP3 để tải lên." : "Chọn file PDF để tải lên.");
    }

    const data = { folder: args.folder, kind: args.kind, title, description: args.description.trim(), url, ...(file ? { file } : {}), ...(args.hidden ? { hidden: true } : {}), ...(args.term ? { term: args.term } : {}) };
    if (prev) {
      if (prev.file && prev.file.storageId !== file?.storageId) await ctx.storage.delete(prev.file.storageId);
      await ctx.db.replace(prev._id, { ...data, order: prev.order });
      return prev._id;
    }
    const inFolder = await ctx.db.query("resources").withIndex("by_folder", (q) => q.eq("folder", args.folder)).collect();
    return ctx.db.insert("resources", { ...data, order: inFolder.reduce((m, r) => Math.max(m, r.order), 0) + 1 });
  },
});

export const setResourceHidden = mutation({
  args: { token: v.string(), id: v.id("resources"), hidden: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    await ctx.db.patch(args.id, { hidden: args.hidden || undefined });
  },
});

export const moveResource = mutation({
  args: { token: v.string(), id: v.id("resources"), dir: v.union(v.literal(-1), v.literal(1)) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const r = await ctx.db.get(args.id);
    if (!r) return;
    const list = (await ctx.db.query("resources").withIndex("by_folder", (q) => q.eq("folder", r.folder)).collect()).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x._id === r._id);
    const j = i + args.dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) if (list[k].order !== k + 1) await ctx.db.patch(list[k]._id, { order: k + 1 });
  },
});

export const deleteResource = mutation({
  args: { token: v.string(), id: v.id("resources") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const r = await ctx.db.get(args.id);
    if (!r) return;
    if (r.file) await ctx.storage.delete(r.file.storageId);
    await ctx.db.delete(r._id);
  },
});

/* ======================= quizzes ======================= */

export const quizzes = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("quizCards").collect();
    const byQuiz = new Map<Id<"quizzes">, { count: number; sumPct: number; scored: number }>();
    for (const s of await ctx.db.query("scores").collect()) {
      const b = byQuiz.get(s.quizId) ?? { count: 0, sumPct: 0, scored: 0 };
      b.count += s.count;
      b.sumPct += s.sumPct;
      if (s.total > 0) b.scored += s.count;
      byQuiz.set(s.quizId, b);
    }
    const pending = await ctx.db.query("attempts").withIndex("by_reviewStatus", (q) => q.eq("reviewStatus", "pending")).collect();
    return rows
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.order - b.order || a.title.localeCompare(b.title))
      .map((q) => {
        const b = byQuiz.get(q.quizId);
        return {
          _id: q.quizId,
          slug: q.slug,
          folder: q.folder,
          title: q.title,
          subtitle: q.subtitle,
          code: q.code,
          featured: q.featured,
          ielts: q.ielts ?? null,
          term: q.term ?? null,
          published: q.published,
          questionCount: q.questionCount,
          hasEssay: q.hasEssay,
          pendingCount: pending.filter((a) => a.quizId === q.quizId).length,
          attemptCount: b?.count ?? 0,
          avgPct: b?.scored ? Math.round(b.sumPct / b.scored) : null,
          updatedAt: q.updatedAt,
        };
      });
  },
});

export const quiz = query({
  args: { token: v.string(), id: v.id("quizzes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const q = await ctx.db.get(args.id);
    if (!q) return null;
    const fileUrls: Record<string, string> = {};
    for (const id of quizFileIds(q.sections)) {
      const url = await ctx.storage.getUrl(id);
      if (url) fileUrls[id] = url;
    }
    return { ...q, fileUrls };
  },
});

const quizFields = {
  slug: v.string(),
  folder: v.string(),
  title: v.string(),
  subtitle: v.string(),
  minutes: v.number(),
  code: v.string(),
  featured: v.boolean(),
  ielts: ieltsValidator,
  published: v.boolean(),
  timer: timerValidator,
  accent: accentValidator,
  speakPrep: v.optional(v.number()),
  speakMode: speakModeValidator,
  term: termValidator,
  focusGuard: v.optional(v.boolean()),
  sections: v.array(sectionValidator),
};

export const saveQuiz = mutation({
  args: { token: v.string(), id: v.optional(v.id("quizzes")), ...quizFields },
  handler: async (ctx, { token, id, ...args }) => {
    await requireAdmin(ctx, token);
    const title = args.title.trim();
    if (!title) fail("Nhập tên bài.");
    if (!(await folderBySlug(ctx, args.folder))) fail("Chọn thư mục cho bài.");
    const sections = args.sections.map((s) => ({
      title: s.title.trim() || "Câu hỏi",
      ...(s.listen?.trim() ? { listen: s.listen.trim() } : {}),
      ...(s.audio ? { audio: { storageId: s.audio.storageId, name: s.audio.name.slice(0, 200) } } : {}),
      ...(s.passage?.trim() ? { passage: s.passage.trim() } : {}),
      questions: s.questions.map((q) => {
        const base = {
          q: q.q.trim(),
          ...(q.tag?.trim() ? { tag: q.tag.trim() } : {}),
          ...(q.explain?.trim() ? { explain: q.explain.trim() } : {}),
          ...(q.image ? { image: q.image } : {}),
        };
        if (q.type === "mcq") return { type: "mcq" as const, ...base, options: q.options.map((o) => o.trim()), answer: q.answer };
        if (q.type === "fill") return { type: "fill" as const, ...base, answer: q.answer.map((a) => a.trim()).filter(Boolean) };
        if (q.type === "speak")
          return { type: "speak" as const, ...base, answerSec: Math.round(q.answerSec), ...(q.prepSec ? { prepSec: Math.round(q.prepSec) } : {}) };
        return { type: "essay" as const, ...base, ...(q.minWords ? { minWords: Math.round(q.minWords) } : {}) };
      }),
    }));
    const errors = validateSections(sections);
    if (errors.length) fail(errors.slice(0, 5).join("\n"));
    for (const id of quizImageIds(sections)) {
      const meta = await ctx.db.system.get(id);
      if (!meta || !(meta.contentType ?? "").startsWith("image/")) fail("Có ảnh trong bài không hợp lệ hoặc đã bị xoá. Hãy chọn lại ảnh.");
    }
    for (const id of quizAudioIds(sections)) {
      const meta = await ctx.db.system.get(id);
      if (!meta || !(meta.contentType ?? "").startsWith("audio/")) fail("Có file nghe trong bài không hợp lệ hoặc đã bị xoá. Hãy chọn lại file MP3.");
      if (meta.size > MAX_AUDIO_BYTES) fail(`File nghe quá lớn, tối đa ${formatBytes(MAX_AUDIO_BYTES)}.`);
    }

    const slug = slugify(args.slug || title);
    if (!slug) fail("Mã bài (đường link) chỉ gồm chữ không dấu, số và dấu gạch ngang.");
    const clash = await quizBySlug(ctx, slug);
    if (clash && clash._id !== id) fail(`Đã có bài khác dùng đường link "${slug}".`);

    const data = {
      slug,
      folder: args.folder,
      title,
      subtitle: args.subtitle.trim(),
      minutes: Math.max(0, Math.min(300, Math.round(args.minutes || 0))),
      code: args.code.trim(),
      featured: args.featured,
      ielts: args.ielts,
      published: args.published,
      ...(args.timer ? { timer: args.timer } : {}),
      ...(args.accent ? { accent: args.accent } : {}),
      ...(hasSpeak(sections) ? { speakPrep: args.speakPrep === 30 ? 30 : 15, ...(args.speakMode ? { speakMode: args.speakMode } : {}) } : {}),
      ...(args.focusGuard != null ? { focusGuard: args.focusGuard } : {}),
      ...(args.term ? { term: args.term } : {}),
      sections,
      updatedAt: Date.now(),
    };
    if (id) {
      const prev = await ctx.db.get(id);
      if (!prev) fail("Không tìm thấy bài.");
      await ctx.db.replace(id, { ...data, order: prev.order });
      await syncCard(ctx, id);
      const kept = new Set<string>(quizFileIds(sections));
      await releaseFiles(ctx, quizFileIds(prev.sections).filter((x) => !kept.has(x)), id);
      return { id, slug };
    }
    const inFolder = await ctx.db.query("quizzes").withIndex("by_folder", (q) => q.eq("folder", args.folder)).collect();
    const newId = await ctx.db.insert("quizzes", { ...data, order: inFolder.reduce((m, q) => Math.max(m, q.order), 0) + 1 });
    await syncCard(ctx, newId);
    return { id: newId, slug };
  },
});

export const duplicateQuiz = mutation({
  args: { token: v.string(), id: v.id("quizzes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const q = await ctx.db.get(args.id);
    if (!q) fail("Không tìm thấy bài.");
    let slug = `${q.slug}-ban-sao`;
    for (let i = 2; await quizBySlug(ctx, slug); i++) slug = `${q.slug}-ban-sao-${i}`;
    const { _id, _creationTime, ...rest } = q;
    void _id;
    void _creationTime;
    const copy = await ctx.db.insert("quizzes", { ...rest, slug, title: `${q.title} (bản sao)`, published: false, featured: false, order: q.order + 0.5, updatedAt: Date.now() });
    await syncCard(ctx, copy);
    return copy;
  },
});

export const deleteQuiz = mutation({
  args: { token: v.string(), id: v.id("quizzes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    for (const a of await ctx.db.query("attempts").withIndex("by_quiz", (q) => q.eq("quizId", args.id)).collect())
      await ctx.db.delete(a._id);
    for (const u of await ctx.db.query("quizUnlocks").collect()) if (u.quizId === args.id) await ctx.db.delete(u._id);
    for (const d of await ctx.db.query("drafts").collect()) if (d.quizId === args.id) await ctx.db.delete(d._id);
    for (const e of await ctx.db.query("focusEvents").collect()) if (e.quizId === args.id) await ctx.db.delete(e._id);
    const quiz = await ctx.db.get(args.id);
    if (!quiz) return;
    await ctx.db.delete(args.id);
    await syncCard(ctx, args.id); // drops its card and scores
    await releaseFiles(ctx, quizFileIds(quiz.sections), args.id);
  },
});

/* ======================= results ======================= */

export const attempts = query({
  args: {
    token: v.string(),
    quizId: v.optional(v.id("quizzes")),
    studentId: v.optional(v.id("students")),
    pendingOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const limit = Math.min(args.limit ?? 500, 2000);
    let rows: Doc<"attempts">[];
    if (args.studentId) {
      const sid = args.studentId;
      rows = await ctx.db.query("attempts").withIndex("by_student", (q) => q.eq("studentId", sid)).order("desc").take(limit);
      if (args.quizId) rows = rows.filter((r) => r.quizId === args.quizId);
    } else if (args.quizId) {
      const qid = args.quizId;
      rows = await ctx.db.query("attempts").withIndex("by_quiz", (q) => q.eq("quizId", qid)).order("desc").take(limit);
    } else if (args.pendingOnly) {
      rows = await ctx.db.query("attempts").withIndex("by_reviewStatus", (q) => q.eq("reviewStatus", "pending")).order("desc").take(limit);
    } else {
      rows = await ctx.db.query("attempts").withIndex("by_submittedAt").order("desc").take(limit);
    }
    if (args.pendingOnly) rows = rows.filter((r) => r.reviewStatus === "pending");
    const look = rowLookups(ctx);
    return Promise.all(rows.map((a) => attemptRow(ctx, a, look)));
  },
});

export const attemptDetail = query({
  args: { token: v.string(), id: v.id("attempts") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const a = await ctx.db.get(args.id);
    if (!a) return null;
    const quiz = await ctx.db.get(a.quizId);
    const row = await attemptRow(ctx, a);
    const meta = { reviewedAt: a.reviewedAt ?? null, reviewedBy: a.reviewedBy ?? null };
    if (!quiz) return { ...row, ...meta, questions: [], essays: [], speaking: null };
    const questions: { num: number; section: string; q: string; given: string; right: string; ok: boolean }[] = [];
    const essays: {
      num: number;
      key: string;
      section: string;
      q: string;
      text: string;
      words: number;
      minWords: number;
      imageUrl: string | null;
      review: { comment: string; band: number | null; criteria: number[] | null } | null;
    }[] = [];
    let num = 0;
    for (const [si, sec] of quiz.sections.entries())
      for (const [qi, q] of sec.questions.entries()) {
        num++;
        const key = `${si}-${qi}`;
        const val = a.answers[key];
        if (q.type === "speak") continue; // listed under `speaking` below
        if (q.type === "essay") {
          const r = a.essayReviews?.[key];
          essays.push({
            num,
            key,
            section: sec.title,
            q: q.q,
            text: String(val ?? ""),
            words: wordCount(val),
            minWords: q.minWords ?? 0,
            imageUrl: q.image ? await ctx.storage.getUrl(q.image.storageId) : null,
            review: r ? { comment: r.comment, band: r.band ?? null, criteria: r.criteria ?? null } : null,
          });
          continue;
        }
        const given = q.type === "mcq" ? (typeof val === "number" ? q.options[val] ?? "" : "") : String(val ?? "");
        const right = q.type === "mcq" ? q.options[q.answer] ?? "" : q.answer.join(" / ");
        questions.push({ num, section: sec.title, q: q.q, given, right, ok: isCorrect(q, val) });
      }
    // Speaking: every question with its recording, and one review for the whole test.
    let speaking = null;
    if (hasSpeak(quiz.sections)) {
      const recs = new Map(recordingIds(quiz, a));
      const items = [];
      let n = 0;
      for (const [si, sec] of quiz.sections.entries())
        for (const [qi, q] of sec.questions.entries()) {
          n++;
          if (q.type !== "speak") continue;
          const id = recs.get(`${si}-${qi}`);
          items.push({
            num: n,
            key: `${si}-${qi}`,
            section: sec.title,
            q: q.q,
            answerSec: q.answerSec,
            url: id ? await ctx.storage.getUrl(id) : null,
            transcript: a.transcripts?.[`${si}-${qi}`] ?? "",
          });
        }
      const r = a.essayReviews?.[SPEAKING_REVIEW_KEY];
      speaking = {
        purged: !!a.recordingsPurged,
        items,
        review: r ? { comment: r.comment, band: r.band ?? null, criteria: r.criteria ?? null } : null,
        selfReview: a.selfReview ?? null,
        mode: a.speakMode ?? null,
      };
    }
    return { ...row, ...meta, questions, essays, speaking };
  },
});

/** Saves the teacher's comments (and optional IELTS bands) on an attempt's essays. */
export const reviewAttempt = mutation({
  args: { token: v.string(), id: v.id("attempts"), reviews: v.record(v.string(), essayReviewValidator) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    const a = await ctx.db.get(args.id);
    if (!a || !a.reviewStatus) fail("Không tìm thấy bài viết.");
    const essayReviews: Record<string, { comment: string; band?: number; criteria?: number[] }> = {};
    for (const [key, r] of Object.entries(args.reviews)) {
      const comment = r.comment.trim().slice(0, 5000);
      let band = r.band;
      let criteria = r.criteria;
      if (criteria) {
        if (criteria.length !== 4 || criteria.some((c) => c < 0 || c > 9 || (c * 2) % 1 !== 0)) fail("Mỗi tiêu chí chấm từ 0 đến 9, bước 0.5.");
        band = writingBand(criteria) ?? undefined;
      } else criteria = undefined;
      if (band != null && (band < 0 || band > 9 || (band * 2) % 1 !== 0)) fail("Band từ 0 đến 9, bước 0.5.");
      if (!comment && band == null) continue;
      essayReviews[key] = { comment, ...(band != null ? { band } : {}), ...(criteria ? { criteria } : {}) };
    }
    if (!Object.keys(essayReviews).length) fail("Viết nhận xét hoặc chấm band trước khi lưu.");
    await ctx.db.patch(a._id, { essayReviews, reviewStatus: "done", reviewedAt: Date.now(), reviewedBy: admin.name });
    await refreshScore(ctx, a.studentId, a.quizId);
  },
});

/** Lets a student retake a quiz they had mastered; their scores are kept. */
export const reopenQuiz = mutation({
  args: { token: v.string(), studentId: v.id("students"), quizSlug: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const quiz = await quizBySlug(ctx, args.quizSlug);
    if (!quiz) fail("Không tìm thấy bài.");
    for (const a of await ctx.db.query("attempts").withIndex("by_student", (q) => q.eq("studentId", args.studentId)).collect())
      if (a.quizId === quiz._id && !a.reopened) await ctx.db.patch(a._id, { reopened: true });
    await refreshScore(ctx, args.studentId, quiz._id);
  },
});

export const deleteAttempt = mutation({
  args: { token: v.string(), id: v.id("attempts") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const a = await ctx.db.get(args.id);
    if (!a) return;
    await ctx.db.delete(args.id);
    await refreshScore(ctx, a.studentId, a.quizId);
  },
});

/* ======================= admin accounts ======================= */

export const admins = query({
  args: tokenArg,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const rows = await ctx.db.query("admins").collect();
    return rows.map((a) => ({
      _id: a._id,
      email: a.email,
      name: a.name,
      role: a.role,
      active: a.active,
      mustChangePassword: a.mustChangePassword,
      lastLoginAt: a.lastLoginAt ?? null,
    }));
  },
});

function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  const letters = Array.from(buf.slice(0, 7), (b) => alphabet[b % alphabet.length]).join("");
  const nums = Array.from(buf.slice(7), (b) => digits[b % digits.length]).join("");
  return `Tedu-${letters}${nums}`;
}

export const createAdmin = mutation({
  args: { token: v.string(), email: v.string(), name: v.string(), role: v.union(v.literal("owner"), v.literal("teacher")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token, { owner: true });
    const email = cleanEmail(args.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Email chưa hợp lệ.");
    if (await ctx.db.query("admins").withIndex("by_email", (q) => q.eq("email", email)).unique()) fail("Email này đã có tài khoản.");
    const password = tempPassword();
    await ctx.db.insert("admins", {
      email,
      name: args.name.trim() || email,
      role: args.role,
      active: true,
      mustChangePassword: true,
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
    });
    return { password };
  },
});

export const resetAdminPassword = mutation({
  args: { token: v.string(), id: v.id("admins") },
  handler: async (ctx, args) => {
    const me = await requireAdmin(ctx, args.token, { owner: true });
    if (me._id === args.id) fail("Dùng mục Đổi mật khẩu cho tài khoản của chính bạn.");
    const password = tempPassword();
    await ctx.db.patch(args.id, { passwordHash: await hashPassword(password), mustChangePassword: true });
    for (const s of await ctx.db.query("adminSessions").withIndex("by_admin", (q) => q.eq("adminId", args.id)).collect())
      await ctx.db.delete(s._id);
    return { password };
  },
});

export const setAdminActive = mutation({
  args: { token: v.string(), id: v.id("admins"), active: v.boolean() },
  handler: async (ctx, args) => {
    const me = await requireAdmin(ctx, args.token, { owner: true });
    if (me._id === args.id) fail("Không thể tự khóa tài khoản của mình.");
    await ctx.db.patch(args.id, { active: args.active });
    if (!args.active)
      for (const s of await ctx.db.query("adminSessions").withIndex("by_admin", (q) => q.eq("adminId", args.id)).collect())
        await ctx.db.delete(s._id);
  },
});

export const deleteAdmin = mutation({
  args: { token: v.string(), id: v.id("admins") },
  handler: async (ctx, args) => {
    const me = await requireAdmin(ctx, args.token, { owner: true });
    if (me._id === args.id) fail("Không thể tự xóa tài khoản của mình.");
    for (const s of await ctx.db.query("adminSessions").withIndex("by_admin", (q) => q.eq("adminId", args.id)).collect())
      await ctx.db.delete(s._id);
    await ctx.db.delete(args.id);
  },
});
