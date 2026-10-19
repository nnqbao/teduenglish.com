import { noMarks } from "@/convex/model";

/*
 * Clear names for downloaded Speaking answers, so a teacher can mark from the files alone:
 *   BaiNoi_Tran-Bao-An_10A1_IELTS-Speaking-Technology_2026-10-17.zip
 *     00_Danh-sach-cau-hoi.txt
 *     Cau01_Part1_Do-you-use-a-digital-device-soon-after.webm
 */

/** Accent-free, file-system safe words joined by "-". */
export function fileSlug(text: string, max = 48): string {
  const s = noMarks(text)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf("-") > max / 2 ? cut.lastIndexOf("-") : max);
}

/** Extension for a recorded file's type. */
export function audioExt(type: string): string {
  const t = type.split(";")[0].trim().toLowerCase();
  if (t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/aac") return ".m4a";
  if (t === "audio/mpeg") return ".mp3";
  if (t === "audio/ogg") return ".ogg";
  if (t === "audio/wav" || t === "audio/x-wav") return ".wav";
  return ".webm";
}

/** "Part 1 — Introduction…" → "Part1"; other section titles are shortened. */
function partTag(section: string): string {
  const m = /part\s*(\d)/i.exec(section);
  return m ? `Part${m[1]}` : fileSlug(section, 16) || "Phan";
}

export type SpeakingItem = { num: number; section: string; q: string; answerSec: number; transcript?: string };
export type SpeakingAttempt = { studentName: string; className: string; quizTitle: string; submittedAt: number };

const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Name of one answer without the extension: "Cau01_Part1_Do-you-use-a-digital-device". */
export function answerBaseName(it: SpeakingItem, width = 2): string {
  const firstLine = it.q.split("\n")[0];
  return `Cau${String(it.num).padStart(width, "0")}_${partTag(it.section)}_${fileSlug(firstLine, 40)}`;
}

/** Folder / zip name: "BaiNoi_Tran-Bao-An_10A1_IELTS-Speaking-Technology_2026-10-17". */
export function attemptBaseName(a: SpeakingAttempt): string {
  return ["BaiNoi", fileSlug(a.studentName, 30), fileSlug(a.className, 20), fileSlug(a.quizTitle, 40), day(a.submittedAt)].filter(Boolean).join("_");
}

/** The question list that goes in the zip next to the recordings. */
export function questionList(a: SpeakingAttempt, rows: { it: SpeakingItem; file: string | null }[]): string {
  const when = new Date(a.submittedAt).toLocaleString("vi-VN");
  const lines = [
    `Học sinh: ${a.studentName}${a.className ? ` (${a.className})` : ""}`,
    `Bài: ${a.quizTitle}`,
    `Nộp lúc: ${when}`,
    "",
    ...rows.flatMap(({ it, file }) => [
      `Câu ${it.num} · ${it.section} · ${it.answerSec} giây`,
      `  ${it.q.replace(/\n/g, "\n  ")}`,
      `  → ${file ?? "(không có ghi âm)"}`,
      ...(it.transcript ? [`  Bản chép lời: ${it.transcript}`] : []),
      "",
    ]),
  ];
  return lines.join("\r\n"); // opens cleanly in Notepad too
}
