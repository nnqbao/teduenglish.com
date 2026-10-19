import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const imageValidator = v.object({ storageId: v.id("_storage"), name: v.string() });

const questionBase = {
  tag: v.optional(v.string()),
  q: v.string(),
  explain: v.optional(v.string()),
  image: v.optional(imageValidator),
};

export const questionValidator = v.union(
  v.object({ type: v.literal("mcq"), ...questionBase, options: v.array(v.string()), answer: v.number() }),
  v.object({ type: v.literal("fill"), ...questionBase, answer: v.array(v.string()) }),
  // Free writing (e.g. IELTS Writing), marked by a teacher.
  v.object({ type: v.literal("essay"), ...questionBase, minWords: v.optional(v.number()) }),
  // Spoken answer, recorded in the browser and marked by a teacher (IELTS Speaking).
  v.object({ type: v.literal("speak"), ...questionBase, answerSec: v.number(), prepSec: v.optional(v.number()) }),
);

export const essayReviewValidator = v.object({
  comment: v.string(),
  band: v.optional(v.number()),
  criteria: v.optional(v.array(v.number())),
});

export const sectionValidator = v.object({
  title: v.string(),
  listen: v.optional(v.string()),
  // Recorded audio (MP3) for a listening part; played instead of the computer voice.
  audio: v.optional(v.object({ storageId: v.id("_storage"), name: v.string() })),
  passage: v.optional(v.string()),
  questions: v.array(questionValidator),
});

export const ieltsValidator = v.optional(
  v.union(v.literal("listening"), v.literal("reading"), v.literal("writing"), v.literal("speaking")),
);

export const termValidator = v.optional(v.union(v.literal("hk1"), v.literal("hk2")));
export const timerValidator = v.optional(v.union(v.literal("off"), v.literal("count"), v.literal("auto")));
export const accentValidator = v.optional(v.union(v.literal("uk"), v.literal("us")));

export const resourceKindValidator = v.union(
  v.literal("exercise"),
  v.literal("game"),
  v.literal("video"),
  v.literal("doc"),
  v.literal("audio"),
);

export default defineSchema({
  // Single row: center name, contact, demo hint...
  settings: defineTable({
    centerName: v.string(),
    tagline: v.string(),
    teacher: v.string(),
    contact: v.string(),
    showDemoHint: v.boolean(),
    demoCode: v.string(),
    // Lock a quiz for a student once their best score reaches this %; 0 turns it off (default 80).
    lockAtPercent: v.optional(v.number()),
    updatedAt: v.number(),
  }),

  folders: defineTable({
    slug: v.string(),
    badge: v.string(),
    name: v.string(),
    detail: v.string(),
    order: v.number(),
  }).index("by_slug", ["slug"]),

  students: defineTable({
    code: v.string(), // normalized (lowercase, no spaces)
    name: v.string(),
    className: v.string(),
    folders: v.array(v.string()), // folder slugs, or ["*"] for all
    active: v.boolean(),
    note: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    // Read-only code for parents (/phu-huynh).
    parentCode: v.optional(v.string()),
    // Why the account was locked automatically (left a guarded test); cleared when a teacher unlocks it.
    lockedReason: v.optional(v.string()),
    lockedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_parentCode", ["parentCode"])
    .index("by_class", ["className"]),

  // Light copy of each quiz's settings (no questions), for lists and dashboards. Kept by summary.syncCard.
  quizCards: defineTable({
    quizId: v.id("quizzes"),
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
    term: termValidator,
    order: v.number(),
    updatedAt: v.number(),
    questionCount: v.number(),
    hasEssay: v.boolean(),
    hasSpeak: v.boolean(),
    guard: v.boolean(),
    skill: v.optional(v.union(v.literal("listening"), v.literal("reading"), v.literal("writing"), v.literal("speaking"))),
  })
    .index("by_quiz", ["quizId"])
    .index("by_folder", ["folder", "order"]),

  // One row per student and quiz summarising their attempts. Kept by summary.refreshScore.
  scores: defineTable({
    studentId: v.id("students"),
    quizId: v.id("quizzes"),
    count: v.number(),
    lastAt: v.number(),
    last: v.number(), // correct answers in the latest attempt
    total: v.number(), // auto-graded questions
    best: v.number(), // most correct answers in one attempt
    bestPct: v.number(),
    openPct: v.number(), // best % among attempts the teacher hasn't reopened (drives the lock)
    sumPct: v.number(), // for class averages
    review: v.optional(v.union(v.literal("pending"), v.literal("done"))), // latest writing/speaking review state
    band: v.optional(v.number()), // best IELTS band
  })
    .index("by_student_quiz", ["studentId", "quizId"])
    .index("by_quiz", ["quizId"]),

  // An unfinished test, saved as the student works so they can carry on later (any device).
  drafts: defineTable({
    studentId: v.id("students"),
    quizId: v.id("quizzes"),
    state: v.string(), // the page's sitting (question order, answers) as JSON
    answered: v.number(),
    total: v.number(),
    elapsedSec: v.number(), // time already used, so a timed test resumes where it stopped
    updatedAt: v.number(),
  })
    .index("by_student_quiz", ["studentId", "quizId"])
    .index("by_updatedAt", ["updatedAt"]),

  // A student leaving a guarded test: "away" (with the answers at that moment), then back or locked.
  focusEvents: defineTable({
    studentId: v.id("students"),
    quizId: v.id("quizzes"),
    at: v.number(),
    backAt: v.optional(v.number()),
    // This time away had a countdown (2nd and 3rd time); coming back late locks the account.
    countdown: v.optional(v.boolean()),
    seconds: v.optional(v.number()), // length of that countdown
    locked: v.optional(v.boolean()),
    answers: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
    durationSec: v.optional(v.number()),
  })
    .index("by_student_quiz", ["studentId", "quizId", "at"])
    .index("by_at", ["at"]),

  studentSessions: defineTable({
    studentId: v.id("students"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_student", ["studentId"])
    .index("by_expiresAt", ["expiresAt"]),

  parentSessions: defineTable({
    studentId: v.id("students"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_student", ["studentId"])
    .index("by_expiresAt", ["expiresAt"]),

  resources: defineTable({
    folder: v.string(),
    kind: resourceKindValidator,
    title: v.string(),
    description: v.string(),
    url: v.string(), // "" when the resource is an uploaded file
    // Uploaded PDF, or an audio lesson (MP3…) when media is "audio".
    file: v.optional(v.object({ storageId: v.id("_storage"), name: v.string(), size: v.number(), media: v.optional(v.literal("audio")) })),
    hidden: v.optional(v.boolean()),
    term: termValidator,
    order: v.number(),
  }).index("by_folder", ["folder"]),

  quizzes: defineTable({
    slug: v.string(),
    folder: v.string(),
    title: v.string(),
    subtitle: v.string(),
    minutes: v.number(),
    code: v.string(), // optional unlock code; "" means none
    featured: v.boolean(),
    ielts: ieltsValidator,
    published: v.boolean(),
    // "count": countdown only; "auto": submit when time is up. Unset → "count" when minutes > 0.
    timer: timerValidator,
    accent: accentValidator, // listening voice, default "uk"
    speakPrep: v.optional(v.number()), // Speaking: seconds to get ready before the first question (15 or 30)
    // Leaving the test (other tab/app) warns once, then locks the account. Unset → on for IELTS Reading/Writing and essays.
    focusGuard: v.optional(v.boolean()),
    term: termValidator, // semester group inside the folder
    order: v.number(),
    sections: v.array(sectionValidator),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_folder", ["folder"]),

  quizUnlocks: defineTable({
    studentId: v.id("students"),
    quizId: v.id("quizzes"),
  }).index("by_student_quiz", ["studentId", "quizId"]),

  attempts: defineTable({
    studentId: v.id("students"),
    quizId: v.id("quizzes"),
    correct: v.number(),
    total: v.number(),
    wrong: v.number(),
    unanswered: v.number(),
    band: v.optional(v.number()),
    answers: v.record(v.string(), v.union(v.string(), v.number())),
    submittedAt: v.number(),
    durationSec: v.optional(v.number()),
    // Only for attempts that contain essays.
    reviewStatus: v.optional(v.union(v.literal("pending"), v.literal("done"))),
    // Set when a teacher lets the student retake a quiz they had mastered.
    reopened: v.optional(v.boolean()),
    // Speaking recordings were deleted after the keep period (answers then hold "").
    recordingsPurged: v.optional(v.boolean()),
    // Submitted automatically because the student left a guarded test and was locked out.
    leftQuiz: v.optional(v.boolean()),
    essayReviews: v.optional(v.record(v.string(), essayReviewValidator)),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.string()),
  })
    .index("by_student", ["studentId", "submittedAt"])
    .index("by_quiz", ["quizId", "submittedAt"])
    .index("by_submittedAt", ["submittedAt"])
    .index("by_reviewStatus", ["reviewStatus", "submittedAt"]),

  admins: defineTable({
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("owner"), v.literal("teacher")),
    active: v.boolean(),
    mustChangePassword: v.boolean(),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  adminSessions: defineTable({
    adminId: v.id("admins"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_admin", ["adminId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Answers from the teacher on /need-clarify (one row per question).
  clarifyAnswers: defineTable({
    qid: v.string(),
    choices: v.array(v.string()),
    text: v.string(),
    files: v.array(v.object({ storageId: v.id("_storage"), name: v.string(), size: v.number() })),
    by: v.string(),
    updatedAt: v.number(),
  }).index("by_qid", ["qid"]),

  loginAttempts: defineTable({
    kind: v.union(v.literal("student"), v.literal("admin")),
    key: v.string(),
    ok: v.boolean(),
    at: v.number(),
  })
    .index("by_kind_at", ["kind", "at"])
    .index("by_kind_key_at", ["kind", "key", "at"]),
});
