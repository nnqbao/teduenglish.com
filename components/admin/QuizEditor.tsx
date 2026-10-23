"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { MAX_AUDIO_BYTES, formatBytes, slugify, validateSections, type Section } from "@/convex/model";
import { parseLoose } from "@/lib/loose-json";
import { errMsg } from "@/lib/ui";
import { Modal, useAdmin } from "./AdminShell";
import RichInput from "./RichInput";

/* ---------- editor state ---------- */
let uidSeq = 0;
const uid = () => `u${++uidSeq}`;

type EImage = { storageId: Id<"_storage">; name: string; url: string };
type EQ = {
  uid: string;
  type: "mcq" | "fill" | "essay" | "speak";
  tag: string;
  q: string;
  options: string[];
  answer: number;
  answerText: string; // fill: accepted answers, one per line
  explain: string; // essay: tip shown with the prompt
  minWords: number; // essay only
  answerSec: number; // speak: recording time
  prepSec: number; // speak: thinking time after the question (IELTS Part 2 cue card: 60)
  image: EImage | null;
};
type QuizSections = Doc<"quizzes">["sections"];
type ES = { uid: string; title: string; kind: "plain" | "listen" | "passage"; media: string; audio: EImage | null; questions: EQ[] };
type Draft = {
  slug: string;
  folder: string;
  title: string;
  subtitle: string;
  minutes: number;
  code: string;
  featured: boolean;
  ielts: "" | "listening" | "reading" | "writing" | "speaking";
  timer: "off" | "count" | "auto";
  accent: "uk" | "us";
  speakPrep: 15 | 30;
  speakMode: "both" | "practice" | "exam";
  /** Scheduled exam: open/close as datetime-local strings in the teacher's time zone ("" = by hand). */
  examOn: boolean;
  opensAt: string;
  closesAt: string;
  /** null = automatic (on for IELTS Reading/Writing and tests with essays). */
  focusGuard: boolean | null;
  term: "" | "hk1" | "hk2";
  published: boolean;
  sections: ES[];
};

const blankQ = (type: EQ["type"]): EQ => ({ uid: uid(), type, tag: "", q: "", options: ["", "", "", ""], answer: -1, answerText: "", explain: "", minWords: 0, answerSec: 30, prepSec: 0, image: null });

const speakQ = (q: string, tag: string, answerSec: number, prepSec = 0): EQ => ({ ...blankQ("speak"), q, tag, answerSec, prepSec });

/** Starter for an IELTS Speaking test: Part 1 interview, Part 2 cue card, Part 3 discussion. */
function ieltsSpeakingTemplate(): ES[] {
  const part = (title: string, questions: EQ[]): ES => ({ uid: uid(), title, kind: "plain", media: "", audio: null, questions });
  return [
    part("Part 1 · Introduction & interview", [
      speakQ("Let's talk about your hometown. Where is your hometown?", "Part 1", 30),
      speakQ("What do you like most about your hometown?", "Part 1", 30),
      speakQ("Do you work or are you a student?", "Part 1", 30),
      speakQ("What do you usually do at the weekend?", "Part 1", 30),
    ]),
    part("Part 2 · Long turn", [
      speakQ(
        "Describe a book you have read recently.\nYou should say:\n• what the book was\n• who wrote it\n• what it was about\nand explain why you liked or disliked it.",
        "Part 2 · cue card",
        120,
        60,
      ),
    ]),
    part("Part 3 · Discussion", [
      speakQ("Do people in your country read as much as they used to?", "Part 3", 45),
      speakQ("What are the advantages of reading books compared with watching films?", "Part 3", 45),
      speakQ("How do you think reading habits will change in the future?", "Part 3", 45),
    ]),
  ];
}

/** Starter for an IELTS Academic Writing test: Task 1 (with a chart image) and Task 2. */
function ieltsWritingTemplate(): ES[] {
  return [
    {
      uid: uid(),
      title: "Writing Task 1",
      kind: "plain",
      media: "",
      audio: null,
      questions: [
        {
          ...blankQ("essay"),
          tag: "Task 1 · 20 minutes",
          q: "The chart below shows … \n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.",
          minWords: 150,
          explain: "Overview first, then group the key features; no personal opinion.",
        },
      ],
    },
    {
      uid: uid(),
      title: "Writing Task 2",
      kind: "plain",
      media: "",
      audio: null,
      questions: [
        {
          ...blankQ("essay"),
          tag: "Task 2 · 40 minutes",
          q: "Some people believe that … Others think that …\n\nDiscuss both views and give your own opinion.\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.",
          minWords: 250,
          explain: "Plan 4–5 paragraphs: introduction, two body paragraphs, conclusion.",
        },
      ],
    },
  ];
}
const blankS = (): ES => ({ uid: uid(), title: "", kind: "plain", media: "", audio: null, questions: [blankQ("mcq")] });

function fromSections(sections: Section[], imageUrls: Record<string, string> = {}): ES[] {
  return sections.map((s) => ({
    uid: uid(),
    title: s.title,
    kind: s.listen || s.audio ? "listen" : s.passage ? "passage" : "plain",
    media: s.listen ?? s.passage ?? "",
    audio: s.audio ? { storageId: s.audio.storageId as Id<"_storage">, name: s.audio.name, url: imageUrls[s.audio.storageId] ?? "" } : null,
    questions: s.questions.map((q): EQ => {
      const base = {
        ...blankQ(q.type),
        tag: q.tag ?? "",
        q: q.q,
        explain: q.explain ?? "",
        image: q.image ? { storageId: q.image.storageId as Id<"_storage">, name: q.image.name, url: imageUrls[q.image.storageId] ?? "" } : null,
      };
      if (q.type === "mcq") return { ...base, options: [...q.options], answer: q.answer, answerText: q.options[q.answer] ?? "" };
      if (q.type === "fill") return { ...base, answerText: q.answer.join("\n") };
      if (q.type === "speak") return { ...base, answerSec: q.answerSec, prepSec: q.prepSec ?? 0 };
      return { ...base, minWords: q.minWords ?? 0 };
    }),
  }));
}

function toSections(es: ES[]): QuizSections {
  return es.map((s) => ({
    title: s.title,
    ...(s.kind === "listen" ? { listen: s.media } : {}),
    ...(s.kind === "listen" && s.audio ? { audio: { storageId: s.audio.storageId, name: s.audio.name } } : {}),
    ...(s.kind === "passage" ? { passage: s.media } : {}),
    questions: s.questions.map((q) => {
      const base = {
        q: q.q,
        ...(q.tag.trim() ? { tag: q.tag } : {}),
        ...(q.explain.trim() ? { explain: q.explain } : {}),
        ...(q.image ? { image: { storageId: q.image.storageId, name: q.image.name } } : {}),
      };
      if (q.type === "mcq") return { type: "mcq" as const, ...base, options: q.options, answer: q.answer };
      if (q.type === "fill") return { type: "fill" as const, ...base, answer: q.answerText.split("\n").map((x) => x.trim()).filter(Boolean) };
      if (q.type === "speak") return { type: "speak" as const, ...base, answerSec: q.answerSec, ...(q.prepSec > 0 ? { prepSec: q.prepSec } : {}) };
      return { type: "essay" as const, ...base, ...(q.minWords > 0 ? { minWords: q.minWords } : {}) };
    }),
  }));
}

function fromDoc(d: Doc<"quizzes"> & { fileUrls: Record<string, string> }): Draft {
  return {
    slug: d.slug,
    folder: d.folder,
    title: d.title,
    subtitle: d.subtitle,
    minutes: d.minutes,
    code: d.code,
    featured: d.featured,
    ielts: d.ielts ?? "",
    timer: d.timer ?? (d.minutes > 0 ? "count" : "off"),
    accent: d.accent ?? "uk",
    speakPrep: d.speakPrep === 30 ? 30 : 15,
    speakMode: d.speakMode ?? "both",
    examOn: !!d.exam,
    opensAt: toLocalInput(d.exam?.opensAt),
    closesAt: toLocalInput(d.exam?.closesAt),
    focusGuard: d.focusGuard ?? null,
    term: d.term ?? "",
    published: d.published,
    sections: fromSections(d.sections, d.fileUrls),
  };
}

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const a = arr.slice();
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

/* ---------- component ---------- */
export default function QuizEditor({ id }: { id: string }) {
  const isNew = id === "moi";
  const router = useRouter();
  const { token, toast } = useAdmin();
  const doc = useQuery(api.admin.quiz, isNew ? "skip" : { token, id: id as Id<"quizzes"> });
  const folders = useQuery(api.admin.folders, { token });
  const save = useMutation(api.admin.saveQuiz);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  // Initialise once from the loaded quiz (or a blank one).
  useEffect(() => {
    if (draft) return;
    if (isNew && folders) {
      // "Soạn bài mới" on a folder's page passes that folder as ?thu-muc=…
      const preset = new URLSearchParams(window.location.search).get("thu-muc");
      const folder = folders.find((f) => f.slug === preset)?.slug ?? folders[0]?.slug ?? "";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft({ slug: "", folder, title: "", subtitle: "", minutes: 10, code: "", featured: false, ielts: "", published: true, timer: "count", accent: "uk", speakPrep: 15, speakMode: "both", examOn: false, opensAt: "", closesAt: "", focusGuard: null, term: "", sections: [blankS()] });
    } else if (doc) setDraft(fromDoc(doc));
  }, [doc, folders, isNew, draft]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!isNew && doc === null) return <p className="empty">Không tìm thấy bài này.</p>;
  if (!draft || !folders) return <p className="empty">Đang tải…</p>;

  const d = draft;
  const update = (patch: Partial<Draft>) => {
    setDraft({ ...d, ...patch });
    setDirty(true);
  };
  const setSections = (sections: ES[]) => update({ sections });
  const setSection = (si: number, patch: Partial<ES>) => setSections(d.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const setQuestion = (si: number, qi: number, patch: Partial<EQ>) =>
    setSection(si, { questions: d.sections[si].questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)) });
  const total = d.sections.reduce((n, s) => n + s.questions.length, 0);
  const hasSpeakQ = d.sections.some((s) => s.questions.some((q) => q.type === "speak"));
  const guardOn = d.focusGuard ?? (d.ielts === "reading" || d.ielts === "writing" || d.sections.some((s) => s.questions.some((q) => q.type === "essay")));

  async function onSave() {
    const sections = toSections(d.sections);
    const errs = [...(d.title.trim() ? [] : ["Nhập tên bài."]), ...validateSections(sections)];
    setErrors(errs);
    if (errs.length) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusy(true);
    try {
      const r = await save({
        token,
        id: isNew ? undefined : (id as Id<"quizzes">),
        slug: d.slug,
        folder: d.folder,
        title: d.title,
        subtitle: d.subtitle,
        minutes: Number(d.minutes) || 0,
        code: d.code,
        featured: d.featured,
        ielts: d.ielts || undefined,
        timer: d.timer,
        accent: d.accent,
        speakPrep: d.speakPrep,
        speakMode: d.speakMode,
        exam: d.examOn
          ? { ...(fromLocalInput(d.opensAt) ? { opensAt: fromLocalInput(d.opensAt)! } : {}), ...(fromLocalInput(d.closesAt) ? { closesAt: fromLocalInput(d.closesAt)! } : {}) }
          : undefined,
        focusGuard: d.focusGuard ?? undefined,
        term: d.term || undefined,
        published: d.published,
        sections,
      });
      setDirty(false);
      setDraft({ ...d, slug: r.slug });
      toast("Đã lưu bài.");
      if (isNew) router.replace(`/admin/bai-lam/${r.id}`);
    } catch (e) {
      setErrors(errMsg(e).split("\n"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="q-editor">
      <Link className="back-link" href="/admin/bai-lam">
        ← Danh sách bài
      </Link>

      <section className="panel">
        <div className="toolbar">
          <div>
            <p className="eyebrow">{isNew ? "Soạn bài mới" : "Sửa bài"}</p>
            <h2>{d.title || "Bài chưa đặt tên"}</h2>
          </div>
          <div className="actions">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                const empty = d.sections.every((x) => x.questions.every((q) => !q.q.trim()));
                if (!empty && !confirm("Thay toàn bộ câu hỏi hiện tại bằng mẫu IELTS Writing Task 1 & 2?")) return;
                update({ sections: ieltsWritingTemplate(), minutes: 60, ...(d.title.trim() ? {} : { title: "IELTS Writing Practice", subtitle: "Task 1 & Task 2 · Academic" }) });
              }}
            >
              Dùng mẫu IELTS Writing
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                const empty = d.sections.every((x) => x.questions.every((q) => !q.q.trim()));
                if (!empty && !confirm("Thay toàn bộ câu hỏi hiện tại bằng mẫu IELTS Speaking Part 1, 2, 3?")) return;
                update({
                  sections: ieltsSpeakingTemplate(),
                  ielts: "speaking",
                  minutes: 14,
                  timer: "off",
                  ...(d.title.trim() ? {} : { title: "IELTS Speaking Practice", subtitle: "Part 1, 2 & 3 · ghi âm" }),
                });
              }}
            >
              🎤 Dùng mẫu IELTS Speaking
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setJsonOpen(true)}>
              Nhập / xuất JSON
            </button>
            {!isNew && (
              <a className="btn btn-ghost btn-sm" href={`/bai/${d.slug}`} target="_blank" rel="noopener noreferrer">
                Xem trước như học sinh ↗
              </a>
            )}
          </div>
        </div>
        {errors.length > 0 && (
          <div className="alert alert-bad" role="alert">
            {errors.slice(0, 8).join("\n")}
            {errors.length > 8 ? `\n… và ${errors.length - 8} lỗi khác` : ""}
          </div>
        )}
        <div className="row-2">
          <div className="field">
            <label htmlFor="qz-title">Tên bài</label>
            <input
              className="input"
              id="qz-title"
              value={d.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Trắc nghiệm Unit 4–5"
            />
          </div>
          <div className="field">
            <label htmlFor="qz-sub">
              Mô tả ngắn <span className="hint">(không bắt buộc)</span>
            </label>
            <input className="input" id="qz-sub" value={d.subtitle} onChange={(e) => update({ subtitle: e.target.value })} placeholder="Vocabulary · Grammar" />
          </div>
        </div>
        <div className="row-3">
          <div className="field">
            <label htmlFor="qz-folder">Thư mục</label>
            <select className="select" id="qz-folder" value={d.folder} onChange={(e) => update({ folder: e.target.value })}>
              {folders.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="qz-min">Thời gian gợi ý (phút)</label>
            <input className="input" id="qz-min" type="number" min={0} max={300} value={d.minutes} onChange={(e) => update({ minutes: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="qz-code">
              Mã bài <span className="hint">(để trống nếu không cần)</span>
            </label>
            <input className="input mono" id="qz-code" value={d.code} onChange={(e) => update({ code: e.target.value })} placeholder="TS10" autoCapitalize="off" spellCheck={false} />
          </div>
        </div>
        <div className="row-3">
          <div className="field">
            <label htmlFor="qz-ielts">
              Kỹ năng IELTS <span className="hint">(để xếp hạng)</span>
            </label>
            <select className="select" id="qz-ielts" value={d.ielts} onChange={(e) => update({ ielts: e.target.value as Draft["ielts"] })}>
              <option value="">Không hiện band</option>
              <option value="listening">IELTS Listening</option>
              <option value="reading">IELTS Reading</option>
              <option value="writing">IELTS Writing (band do giáo viên chấm)</option>
              <option value="speaking">IELTS Speaking (band do giáo viên chấm)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="qz-slug">
              Đường link <span className="hint">(/bai/…)</span>
            </label>
            <input className="input mono" id="qz-slug" value={d.slug} onChange={(e) => update({ slug: e.target.value })} placeholder={slugify(d.title) || "gs8-unit-4"} autoCapitalize="off" spellCheck={false} />
          </div>
        </div>
        <div className="row-3">
          <div className="field">
            <label htmlFor="qz-timer">
              Đếm giờ <span className="hint">(theo số phút ở trên)</span>
            </label>
            <select className="select" id="qz-timer" value={d.timer} onChange={(e) => update({ timer: e.target.value as Draft["timer"] })}>
              <option value="count">Đếm ngược, hết giờ nhắc nộp</option>
              <option value="auto">Đếm ngược, hết giờ tự nộp</option>
              <option value="off">Không đếm giờ</option>
            </select>
          </div>
          {d.sections.some((s) => s.questions.some((q) => q.type === "speak")) && (
            <div className="field">
              <label htmlFor="qz-speakprep">
                Speaking: chuẩn bị <span className="hint">(kiểm tra micro xong mới đếm)</span>
              </label>
              <select className="select" id="qz-speakprep" value={d.speakPrep} onChange={(e) => update({ speakPrep: Number(e.target.value) === 30 ? 30 : 15 })}>
                <option value={15}>15 giây trước khi bắt đầu</option>
                <option value={30}>30 giây trước khi bắt đầu</option>
              </select>
            </div>
          )}
          {d.sections.some((s) => s.questions.some((q) => q.type === "speak")) && (
            <div className="field">
              <label htmlFor="qz-speakmode">Speaking: cách làm bài</label>
              <select className="select" id="qz-speakmode" value={d.speakMode} onChange={(e) => update({ speakMode: e.target.value as Draft["speakMode"] })}>
                <option value="both">Học sinh chọn: luyện tập hoặc thi thử</option>
                <option value="practice">Chỉ luyện tập (tự ghi âm từng câu, tự đánh giá)</option>
                <option value="exam">Chỉ thi thử (máy đọc câu hỏi, tính giờ)</option>
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="qz-accent">Giọng đọc phần nghe / câu hỏi Speaking</label>
            <select className="select" id="qz-accent" value={d.accent} onChange={(e) => update({ accent: e.target.value as Draft["accent"] })}>
              <option value="uk">🇬🇧 Anh (UK)</option>
              <option value="us">🇺🇸 Mỹ (US)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="qz-term">Học kỳ</label>
            <select className="select" id="qz-term" value={d.term} onChange={(e) => update({ term: e.target.value as Draft["term"] })}>
              <option value="">Không chia học kỳ</option>
              <option value="hk1">Học kỳ 1</option>
              <option value="hk2">Học kỳ 2</option>
            </select>
          </div>
        </div>
        <div className="row-3">
          <div className="field" style={{ justifyContent: "flex-end", gap: 10 }}>
            <label className="switch">
              <input type="checkbox" checked={d.published} onChange={(e) => update({ published: e.target.checked })} />
              Hiện cho học sinh
            </label>
            {!hasSpeakQ && (
              <label className="switch" title="Rời bài lần 1: nhắc nhở. Lần 2: 10 giây để quay lại. Lần 3: 5 giây. Quá giờ thì khoá. Lần 4: nộp bài và khoá tài khoản ngay.">
                <input type="checkbox" checked={guardOn} onChange={(e) => update({ focusGuard: e.target.checked })} />
                🔒 Chống chuyển tab (lần 1 nhắc, lần 2 đếm 10 giây, lần 3 đếm 5 giây, lần 4 khoá tài khoản)
              </label>
            )}
            <label className="switch">
              <input type="checkbox" checked={d.featured} onChange={(e) => update({ featured: e.target.checked })} />
              Nổi bật đầu trang học sinh
            </label>
          </div>
        </div>
        <ExamSettings d={d} update={update} live={isNew ? null : (doc?.exam ?? null)} quizId={isNew ? null : (id as Id<"quizzes">)} dirty={dirty} />
      </section>

      {d.sections.map((s, si) => (
        <section className="sec-edit" key={s.uid}>
          <div className="sec-head">
            <b className="eyebrow">
              Phần {si + 1} · {s.questions.length} câu
            </b>
            <div className="row-actions">
              <button className="link-btn" type="button" disabled={si === 0} onClick={() => setSections(move(d.sections, si, -1))}>
                ↑ Lên
              </button>
              <button className="link-btn" type="button" disabled={si === d.sections.length - 1} onClick={() => setSections(move(d.sections, si, 1))}>
                ↓ Xuống
              </button>
              <button
                className="link-btn danger"
                type="button"
                disabled={d.sections.length === 1}
                onClick={() => confirm(`Xóa phần ${si + 1} và ${s.questions.length} câu hỏi?`) && setSections(d.sections.filter((_, i) => i !== si))}
              >
                Xóa phần
              </button>
            </div>
          </div>
          <div className="row-2">
            <div className="field">
              <label htmlFor={`s-title-${s.uid}`}>Tiêu đề phần</label>
              <input className="input compact" id={`s-title-${s.uid}`} value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} placeholder="Vocabulary & Grammar" />
            </div>
            <div className="field">
              <label htmlFor={`s-kind-${s.uid}`}>Dạng phần</label>
              <select className="select compact" id={`s-kind-${s.uid}`} value={s.kind} onChange={(e) => setSection(si, { kind: e.target.value as ES["kind"] })}>
                <option value="plain">Câu hỏi thường</option>
                <option value="listen">Nghe (file MP3 hoặc máy đọc lời thoại)</option>
                <option value="passage">Đọc hiểu (có bài đọc)</option>
              </select>
            </div>
          </div>
          {s.kind === "listen" && (
            <div className="field">
              <span className="label-like">
                File nghe MP3 <span className="hint">— có file thì học sinh nghe file này thay cho giọng máy đọc.</span>
              </span>
              <AudioField audio={s.audio} onChange={(audio) => setSection(si, { audio })} />
            </div>
          )}
          {s.kind !== "plain" && (
            <div className="field">
              <label htmlFor={`s-media-${s.uid}`}>
                {s.kind === "listen" ? (s.audio ? "Lời thoại (không bắt buộc)" : "Lời thoại") : "Bài đọc"}{" "}
                <span className="hint">
                  {s.kind === "listen"
                    ? s.audio
                      ? "— dán lời thoại của file MP3 nếu có; học sinh xem được sau khi nộp bài."
                      : "— mỗi dòng một câu, dạng “Tên: lời nói”; mỗi người một giọng. Học sinh xem được lời thoại sau khi nộp."
                    : "— dòng đầu là tiêu đề, để trống một dòng rồi viết các đoạn."}
                </span>
              </label>
              <textarea className="textarea prose" id={`s-media-${s.uid}`} rows={8} value={s.media} onChange={(e) => setSection(si, { media: e.target.value })} />
            </div>
          )}

          {s.questions.map((q, qi) => (
            <div className="qe" key={q.uid}>
              <div className="qe-head">
                <b>Câu {qi + 1}</b>
                <div className="row-actions">
                  <select
                    className="select compact"
                    style={{ width: "auto" }}
                    value={q.type}
                    aria-label="Dạng câu hỏi"
                    onChange={(e) => {
                      const type = e.target.value as EQ["type"];
                      if (type === "fill" && q.type === "mcq" && !q.answerText && q.options[q.answer]) setQuestion(si, qi, { type, answerText: q.options[q.answer] });
                      else setQuestion(si, qi, { type });
                    }}
                  >
                    <option value="mcq">Trắc nghiệm</option>
                    <option value="fill">Điền từ / viết lại câu</option>
                    <option value="essay">Bài viết (giáo viên chấm)</option>
                    <option value="speak">Nói (thu âm, giáo viên chấm)</option>
                  </select>
                  <button className="link-btn" type="button" disabled={qi === 0} onClick={() => setSection(si, { questions: move(s.questions, qi, -1) })} aria-label="Lên">
                    ↑
                  </button>
                  <button className="link-btn" type="button" disabled={qi === s.questions.length - 1} onClick={() => setSection(si, { questions: move(s.questions, qi, 1) })} aria-label="Xuống">
                    ↓
                  </button>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => setSection(si, { questions: [...s.questions.slice(0, qi + 1), { ...q, uid: uid(), options: [...q.options] }, ...s.questions.slice(qi + 1)] })}
                  >
                    Nhân bản
                  </button>
                  <button className="link-btn danger" type="button" disabled={s.questions.length === 1} onClick={() => setSection(si, { questions: s.questions.filter((_, i) => i !== qi) })}>
                    Xóa
                  </button>
                </div>
              </div>
              <div className="row-2" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(0,1fr)" }}>
                <div className="field">
                  <span className="label-like">
                    Câu hỏi <span className="hint">— bôi đen chữ rồi bấm B (in đậm) hoặc U (gạch chân)</span>
                  </span>
                  <RichInput
                    id={`q-${q.uid}`}
                    label={`Câu hỏi ${qi + 1}`}
                    rows={q.type === "essay" || q.type === "speak" ? 4 : 2}
                    value={q.q}
                    onChange={(v) => setQuestion(si, qi, { q: v })}
                    placeholder={q.type === "speak" ? "Câu hỏi máy sẽ đọc to, ví dụ: Where is your hometown?" : "Ví dụ: She ___ to school every day."}
                    blank={q.type === "mcq" || q.type === "fill"}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`tag-${q.uid}`}>
                    Nhãn <span className="hint">(tuỳ chọn)</span>
                  </label>
                  <input className="input compact" id={`tag-${q.uid}`} value={q.tag} onChange={(e) => setQuestion(si, qi, { tag: e.target.value })} placeholder="Unit 1" />
                </div>
              </div>
              <ImageField image={q.image} onChange={(image) => setQuestion(si, qi, { image })} />
              {q.type === "speak" ? (
                <div className="row-2">
                  <div className="field">
                    <label htmlFor={`as-${q.uid}`}>
                      Thời gian trả lời <span className="hint">(giây; Part 1 ≈ 30, Part 3 ≈ 45, Part 2 = 120)</span>
                    </label>
                    <input
                      className="input compact"
                      id={`as-${q.uid}`}
                      type="number"
                      min={5}
                      max={300}
                      value={q.answerSec || ""}
                      onChange={(e) => setQuestion(si, qi, { answerSec: Math.round(Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ps-${q.uid}`}>
                      Thời gian suy nghĩ <span className="hint">(giây, sau khi đọc câu hỏi; thẻ đề Part 2 = 60)</span>
                    </label>
                    <input
                      className="input compact"
                      id={`ps-${q.uid}`}
                      type="number"
                      min={0}
                      max={120}
                      value={q.prepSec || ""}
                      placeholder="0 = trả lời ngay"
                      onChange={(e) => setQuestion(si, qi, { prepSec: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    />
                  </div>
                </div>
              ) : q.type === "essay" ? (
                <div className="row-2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,3fr)" }}>
                  <div className="field">
                    <label htmlFor={`mw-${q.uid}`}>Số từ tối thiểu</label>
                    <input
                      className="input compact"
                      id={`mw-${q.uid}`}
                      type="number"
                      min={0}
                      max={2000}
                      value={q.minWords || ""}
                      placeholder="0 = không yêu cầu"
                      onChange={(e) => setQuestion(si, qi, { minWords: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    />
                  </div>
                  <div className="field">
                    <span className="label-like">
                      Gợi ý cho học sinh <span className="hint">(hiện cùng đề, ví dụ dàn ý)</span>
                    </span>
                    <RichInput id={`ex-${q.uid}`} label="Gợi ý cho học sinh" multiline={false} blank={false} value={q.explain} onChange={(v) => setQuestion(si, qi, { explain: v })} />
                  </div>
                </div>
              ) : q.type === "mcq" ? (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="tiny muted">Các lựa chọn — chọn nút tròn ở đáp án đúng:</span>
                  {q.options.map((o, oi) => (
                    <div className="opt-edit" key={oi}>
                      <input type="radio" name={`ans-${q.uid}`} checked={q.answer === oi} onChange={() => setQuestion(si, qi, { answer: oi })} aria-label={`Đáp án đúng là ${String.fromCharCode(65 + oi)}`} />
                      <span className="letter">{String.fromCharCode(65 + oi)}</span>
                      <RichInput
                        label={`Lựa chọn ${String.fromCharCode(65 + oi)}`}
                        multiline={false}
                        blank={false}
                        value={o}
                        onChange={(v) => setQuestion(si, qi, { options: q.options.map((x, i) => (i === oi ? v : x)) })}
                      />
                      <button
                        className="link-btn danger"
                        type="button"
                        disabled={q.options.length <= 2}
                        onClick={() =>
                          setQuestion(si, qi, {
                            options: q.options.filter((_, i) => i !== oi),
                            answer: q.answer === oi ? -1 : q.answer > oi ? q.answer - 1 : q.answer,
                          })
                        }
                        aria-label="Bỏ lựa chọn"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="row-actions">
                    {q.options.length < 6 && (
                      <button className="link-btn" type="button" onClick={() => setQuestion(si, qi, { options: [...q.options, ""] })}>
                        + Thêm lựa chọn
                      </button>
                    )}
                    <button className="link-btn" type="button" onClick={() => setQuestion(si, qi, { options: ["True", "False", "Not Given"], answer: -1 })}>
                      Dùng True / False / Not Given
                    </button>
                  </div>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor={`fa-${q.uid}`}>
                    Đáp án được chấp nhận <span className="hint">— mỗi dòng một cách viết đúng; không phân biệt hoa/thường</span>
                  </label>
                  <textarea className="textarea compact" id={`fa-${q.uid}`} rows={2} style={{ minHeight: 0 }} value={q.answerText} onChange={(e) => setQuestion(si, qi, { answerText: e.target.value })} />
                </div>
              )}
              {(q.type === "mcq" || q.type === "fill") && (
                <div className="field">
                  <span className="label-like">
                    Giải thích <span className="hint">(hiện sau khi nộp, chỉ ở câu em đã làm)</span>
                  </span>
                  <RichInput id={`ex-${q.uid}`} label="Giải thích" multiline={false} blank={false} value={q.explain} onChange={(v) => setQuestion(si, qi, { explain: v })} />
                </div>
              )}
            </div>
          ))}
          <div className="row-actions">
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSection(si, { questions: [...s.questions, blankQ("mcq")] })}>
              + Câu trắc nghiệm
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSection(si, { questions: [...s.questions, blankQ("fill")] })}>
              + Câu điền từ
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSection(si, { questions: [...s.questions, blankQ("essay")] })}>
              + Bài viết
            </button>
          </div>
        </section>
      ))}

      <div>
        <button className="btn btn-ghost" type="button" onClick={() => setSections([...d.sections, blankS()])}>
          + Thêm phần mới
        </button>
      </div>

      <div className="editor-bar">
        <span className="small muted">
          {d.sections.length} phần · {total} câu{dirty ? " · có thay đổi chưa lưu" : ""}
        </span>
        <div className="row-actions">
          <Link className="btn btn-ghost btn-sm" href="/admin/bai-lam">
            Đóng
          </Link>
          <button className="btn btn-primary btn-sm" type="button" onClick={onSave} disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu bài"}
          </button>
        </div>
      </div>

      {jsonOpen && (
        <JsonDialog
          draft={d}
          onClose={() => setJsonOpen(false)}
          onApply={(next) => {
            update(next);
            setJsonOpen(false);
            toast("Đã nạp nội dung. Kiểm tra rồi bấm Lưu bài.");
          }}
        />
      )}
    </div>
  );
}

function JsonDialog({ draft, onClose, onApply }: { draft: Draft; onClose: () => void; onApply: (d: Partial<Draft>) => void }) {
  const exported = JSON.stringify(
    {
      id: draft.slug,
      folder: draft.folder,
      title: draft.title,
      subtitle: draft.subtitle,
      minutes: draft.minutes,
      code: draft.code,
      featured: draft.featured,
      ...(draft.ielts ? { ielts: draft.ielts } : {}),
      sections: toSections(draft.sections),
    },
    null,
    2,
  );
  const [text, setText] = useState(exported);
  const [err, setErr] = useState("");

  function apply() {
    try {
      const raw = parseLoose(text) as Record<string, unknown> | unknown[];
      const obj = (Array.isArray(raw) ? { sections: raw } : raw) as Record<string, unknown>;
      if (!Array.isArray(obj.sections)) throw new Error("Thiếu mục sections.");
      const sections = (obj.sections as Record<string, unknown>[]).map((s) => ({
        title: String(s.title ?? ""),
        ...(s.listen ? { listen: String(s.listen) } : {}),
        // Keeps an uploaded MP3 when the teacher edits the exported JSON and loads it back.
        ...(s.audio && typeof s.audio === "object" && "storageId" in s.audio
          ? { audio: { storageId: String((s.audio as { storageId: unknown }).storageId), name: String((s.audio as { name?: unknown }).name ?? "audio.mp3") } }
          : {}),
        ...(s.passage ? { passage: String(s.passage) } : {}),
        questions: ((s.questions as Record<string, unknown>[]) ?? []).map((q) =>
          q.type === "speak"
            ? { type: "speak" as const, tag: q.tag ? String(q.tag) : undefined, q: String(q.q ?? ""), answerSec: Number(q.answerSec) || 30, prepSec: q.prepSec ? Number(q.prepSec) : undefined }
            : q.type === "essay"
            ? { type: "essay" as const, tag: q.tag ? String(q.tag) : undefined, q: String(q.q ?? ""), minWords: q.minWords ? Number(q.minWords) : undefined, explain: q.explain ? String(q.explain) : undefined }
            : q.type === "fill"
            ? { type: "fill" as const, tag: q.tag ? String(q.tag) : undefined, q: String(q.q ?? ""), answer: (Array.isArray(q.answer) ? q.answer : [q.answer]).map(String), explain: q.explain ? String(q.explain) : undefined }
            : { type: "mcq" as const, tag: q.tag ? String(q.tag) : undefined, q: String(q.q ?? ""), options: ((q.options as unknown[]) ?? []).map(String), answer: Number(q.answer), explain: q.explain ? String(q.explain) : undefined },
        ),
      }));
      const patch: Partial<Draft> = { sections: fromSections(sections) };
      if (typeof obj.title === "string") patch.title = obj.title;
      if (typeof obj.subtitle === "string") patch.subtitle = obj.subtitle;
      if (typeof obj.minutes === "number") patch.minutes = obj.minutes;
      if (typeof obj.code === "string") patch.code = obj.code;
      if (typeof obj.featured === "boolean") patch.featured = obj.featured;
      if (obj.ielts === "listening" || obj.ielts === "reading" || obj.ielts === "writing" || obj.ielts === "speaking") patch.ielts = obj.ielts;
      if (typeof obj.id === "string" && !draft.slug) patch.slug = obj.id;
      onApply(patch);
    } catch (e) {
      setErr(`Không đọc được nội dung: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Modal title="Nhập / xuất JSON" onClose={onClose} wide>
      <p className="small muted">
        Dán một bài theo định dạng của file <code>data.js</code> cũ (một mục trong <code>quizzes</code>) hoặc JSON. Nội dung hiện tại của bài đang hiện sẵn bên dưới để sao chép.
      </p>
      <textarea className="textarea" rows={18} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <p className="alert alert-bad" role="alert" hidden={!err}>
        {err}
      </p>
      <div className="modal-foot">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Hủy
        </button>
        <button className="btn btn-primary" type="button" onClick={apply}>
          Nạp vào trình soạn
        </button>
      </div>
    </Modal>
  );
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Optional picture for a question (charts, maps for IELTS Task 1…), uploaded to Convex storage. */
function ImageField({ image, onChange }: { image: EImage | null; onChange: (img: EImage | null) => void }) {
  const { token, toast } = useAdmin();
  const getUploadUrl = useMutation(api.admin.generateUploadUrl);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Chỉ nhận file ảnh (PNG, JPG, GIF, WebP).");
    if (file.size > MAX_IMAGE_BYTES) return toast("Ảnh quá lớn, tối đa 8 MB.");
    setBusy(true);
    try {
      const res = await fetch(await getUploadUrl({ token }), { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(String(res.status));
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      onChange({ storageId, name: file.name, url: URL.createObjectURL(file) });
    } catch (e) {
      toast(errMsg(e, "Tải ảnh chưa thành công, thử lại nhé."));
    } finally {
      setBusy(false);
    }
  }

  if (image)
    return (
      <div className="img-field">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image.url && <img src={image.url} alt={image.name} />}
        <span className="tiny muted">{image.name}</span>
        <button className="link-btn danger" type="button" onClick={() => onChange(null)}>
          Bỏ ảnh
        </button>
      </div>
    );
  return (
    <label className="img-field add">
      <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
      <span className="link-btn">{busy ? "Đang tải ảnh…" : "+ Thêm ảnh minh hoạ"}</span>
      <span className="tiny muted">(biểu đồ IELTS Task 1, tranh, bản đồ…)</span>
    </label>
  );
}

/** Recorded MP3 for a listening part, uploaded to Convex storage. */
function AudioField({ audio, onChange }: { audio: EImage | null; onChange: (a: EImage | null) => void }) {
  const { token, toast } = useAdmin();
  const getUploadUrl = useMutation(api.admin.generateUploadUrl);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    const type = file.type || (/\.mp3$/i.test(file.name) ? "audio/mpeg" : "");
    if (!type.startsWith("audio/")) return toast("Chỉ nhận file âm thanh (MP3, M4A, WAV…).");
    if (file.size > MAX_AUDIO_BYTES) return toast(`File nghe quá lớn (${formatBytes(file.size)}), tối đa ${formatBytes(MAX_AUDIO_BYTES)}.`);
    setBusy(true);
    try {
      const res = await fetch(await getUploadUrl({ token }), { method: "POST", headers: { "Content-Type": type }, body: file });
      if (!res.ok) throw new Error(String(res.status));
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      onChange({ storageId, name: file.name, url: URL.createObjectURL(file) });
    } catch (e) {
      toast(errMsg(e, "Tải file nghe chưa thành công, thử lại nhé."));
    } finally {
      setBusy(false);
    }
  }

  if (audio)
    return (
      <div className="audio-field">
        {audio.url && <audio controls preload="metadata" src={audio.url} />}
        <span className="tiny muted">🎧 {audio.name}</span>
        <button className="link-btn danger" type="button" onClick={() => onChange(null)}>
          Bỏ file nghe
        </button>
      </div>
    );
  return (
    <label className="img-field add">
      <input type="file" accept="audio/*,.mp3" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
      <span className="btn btn-ghost btn-sm">{busy ? "Đang tải file nghe…" : "🎧 Thêm file MP3"}</span>
      <span className="tiny muted">tối đa {formatBytes(MAX_AUDIO_BYTES)}</span>
    </label>
  );
}

/** datetime-local value ("2026-11-15T08:00") ↔ timestamp, in the teacher's own time zone. */
function toLocalInput(ms: number | undefined) {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const PHASE_LABEL = { upcoming: "🔒 Chưa mở (học sinh thấy mờ)", open: "🟢 Đang mở cho học sinh làm", ended: "⏹ Đã đóng" } as const;

/** Scheduled exam: on/off, open and close times, and the teacher's open / close / release buttons. */
function ExamSettings({
  d,
  update,
  live,
  quizId,
  dirty,
}: {
  d: Draft;
  update: (patch: Partial<Draft>) => void;
  live: Doc<"quizzes">["exam"] | null;
  quizId: Id<"quizzes"> | null;
  dirty: boolean;
}) {
  const { token, toast } = useAdmin();
  const setPhase = useMutation(api.exam.setPhase);
  const release = useMutation(api.exam.release);
  const run = async (p: Promise<unknown>, msg: string) => {
    try {
      await p;
      toast(msg);
    } catch (e) {
      toast(errMsg(e));
    }
  };
  return (
    <div className={`exam-box${d.examOn ? " on" : ""}`}>
      <label className="switch">
        <input type="checkbox" checked={d.examOn} onChange={(e) => update({ examOn: e.target.checked })} />
        <b>🎯 Bài thi tập trung</b>
        <span className="hint">— học sinh thấy bài mờ đến giờ mở đề, mỗi em làm 1 lần, kết quả chỉ hiện khi thầy cô công bố</span>
      </label>
      {d.examOn && (
        <>
          <div className="row-2">
            <div className="field">
              <label htmlFor="qz-opens">
                Mở đề lúc <span className="hint">(để trống nếu muốn tự bấm “Mở ngay”)</span>
              </label>
              <input className="input" id="qz-opens" type="datetime-local" value={d.opensAt} onChange={(e) => update({ opensAt: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="qz-closes">
                Đóng đề lúc <span className="hint">(em đang làm dở được thêm 15 phút để nộp)</span>
              </label>
              <input className="input" id="qz-closes" type="datetime-local" value={d.closesAt} onChange={(e) => update({ closesAt: e.target.value })} />
            </div>
          </div>
          {!d.published && <p className="alert alert-warn">Bài đang ẩn: bật “Hiện cho học sinh” để các em thấy bài thi (mờ) trước giờ thi.</p>}
          {live && quizId ? (
            <div className="exam-controls">
              <span>
                Trạng thái: <b>{PHASE_LABEL[live.phase]}</b>
                {live.releasedAt ? " · ✅ Đã công bố kết quả" : ""}
              </span>
              <span className="row-actions">
                {live.phase !== "open" && (
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => run(setPhase({ token, id: quizId, phase: "open" }), "Đã mở đề cho học sinh.")}>
                    Mở ngay
                  </button>
                )}
                {live.phase === "open" && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => confirm("Đóng đề? Em nào đang làm dở được thêm 15 phút để nộp.") && run(setPhase({ token, id: quizId, phase: "ended" }), "Đã đóng đề.")}>
                    Đóng đề
                  </button>
                )}
                {live.phase !== "upcoming" && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(setPhase({ token, id: quizId, phase: "upcoming" }), "Đã đưa bài về trạng thái chưa mở.")}>
                    Đưa về “chưa mở”
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => run(release({ token, id: quizId, released: !live.releasedAt }), live.releasedAt ? "Đã ẩn kết quả." : "Đã công bố kết quả cho học sinh.")}
                >
                  {live.releasedAt ? "Ẩn kết quả" : "📣 Công bố kết quả"}
                </button>
              </span>
              {dirty && <span className="tiny muted">Nhớ bấm “Lưu bài” để lưu giờ mở/đóng mới.</span>}
            </div>
          ) : (
            <p className="tiny muted">Lưu bài để có các nút Mở ngay / Đóng đề / Công bố kết quả.</p>
          )}
        </>
      )}
    </div>
  );
}
