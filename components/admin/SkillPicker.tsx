"use client";

import Link from "next/link";

/** Which editor a quiz is written in: one per skill, plus the old all-in-one editor for grammar/vocabulary tests. */
export type Skill = "listening" | "speaking" | "reading" | "writing" | "general";

export const SKILL_META: Record<Skill, { name: string; icon: string; tone: string; what: string; points: string[] }> = {
  listening: {
    name: "Listening",
    icon: "🎧",
    tone: "sk-listening",
    what: "Bài nghe: tải file MP3 hoặc dán lời thoại cho máy đọc, rồi đặt câu hỏi.",
    points: ["Từng Part có file nghe riêng", "Hoặc dán lời thoại cho máy đọc", "Trắc nghiệm, điền từ"],
  },
  speaking: {
    name: "Speaking",
    icon: "🎤",
    tone: "sk-speaking",
    what: "Bài nói: máy đọc câu hỏi, học sinh ghi âm câu trả lời để thầy cô nghe và chấm.",
    points: ["Part 1, 2, 3 có sẵn mẫu", "Thời gian chuẩn bị, trả lời", "Luyện tập hoặc thi thử"],
  },
  reading: {
    name: "Reading",
    icon: "📖",
    tone: "sk-reading",
    what: "Bài đọc: dán đoạn văn, đặt câu hỏi bên cạnh; học sinh đọc và làm cùng lúc.",
    points: ["Từng Passage một bài đọc", "Trắc nghiệm, True / False / Not Given", "Điền từ, Guided Cloze"],
  },
  writing: {
    name: "Writing",
    icon: "✍️",
    tone: "sk-writing",
    what: "Bài viết: đề Task 1, Task 2 kèm ảnh biểu đồ; thầy cô chấm và nhận xét theo 4 tiêu chí.",
    points: ["Mẫu IELTS Task 1 & 2", "Số từ tối thiểu, gợi ý dàn ý", "Ảnh biểu đồ cho Task 1"],
  },
  general: {
    name: "Bài tổng hợp",
    icon: "🧩",
    tone: "",
    what: "Ngữ pháp, từ vựng, đề nhiều dạng câu trong một bài.",
    points: [],
  },
};

/** Big "what do you want to write?" cards, one per skill. */
export default function SkillPicker({ folder }: { folder?: string }) {
  const href = (s: Skill) => `/admin/bai-lam/moi?ky-nang=${s}${folder ? `&thu-muc=${encodeURIComponent(folder)}` : ""}`;

  return (
    <section className="panel skill-picker">
      <div>
        <p className="eyebrow">Soạn bài mới</p>
        <h2>Thầy cô muốn soạn bài gì?</h2>
        <p className="small muted">Chọn kỹ năng, hệ thống mở giao diện soạn riêng cho dạng bài đó.</p>
      </div>
      <div className="skill-grid">
        {(["listening", "speaking", "reading", "writing"] as const).map((s) => {
          const m = SKILL_META[s];
          return (
            <Link key={s} className={`skill-card ${m.tone}`} href={href(s)}>
              <span className="skill-icon" aria-hidden="true">
                {m.icon}
              </span>
              <span className="skill-name">{m.name}</span>
              <span className="skill-what">{m.what}</span>
              <span className="skill-points">
                {m.points.map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </span>
              <span className="skill-go">Soạn bài →</span>
            </Link>
          );
        })}
      </div>
      <p className="small muted">
        Bài ngữ pháp, từ vựng hay đề nhiều dạng câu?{" "}
        <Link className="link-btn" href={href("general")}>
          🧩 Soạn bài tổng hợp
        </Link>
      </p>
    </section>
  );
}
