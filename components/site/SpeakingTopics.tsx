"use client";

import Link from "next/link";
import { useEffect } from "react";
import { GateLogin, Loading, Swoosh, type DoneMap, type QuizMeta } from "./parts";
import { useSite } from "./SiteShell";
import { signalReady } from "@/lib/ui";

/** Status of one Speaking topic for the student. */
function topicStatus(q: QuizMeta, done: DoneMap, unfinished: Set<string>) {
  const d = done[q.id];
  if (d?.band != null) return { tone: "done", text: `Band ${d.band.toFixed(1)}` };
  if (d?.review === "done") return { tone: "done", text: "Đã chấm" };
  if (d) return { tone: "wait", text: "Đã nộp · chờ chấm" };
  if (unfinished.has(q.id)) return { tone: "draft", text: "Đang làm dở" };
  return { tone: "", text: "Chưa nộp" };
}

/** "Luyện nói, ghi âm, tự đánh giá": every Speaking topic the student can open, with what they've handed in. */
export default function SpeakingTopics() {
  const { home, token, teacher } = useSite();
  useEffect(() => {
    if (home !== undefined) signalReady();
    document.title = "IELTS Speaking · TEDU English";
  }, [home]);

  if (token === undefined || home === undefined) return <Loading />;
  const dash = home?.dashboard;
  const topics = dash ? dash.quizzes.filter((q) => q.hasSpeak) : [];
  const unfinished = new Set((dash?.unfinished ?? []).map((u) => u.id));
  const handedIn = topics.filter((q) => dash?.done[q.id]).length;

  return (
    <>
      <Link className="back-link" href="/">
        ← Trang học tập
      </Link>
      <section className="banner view-enter">
        <Swoosh />
        <p className="eyebrow">IELTS Academic · Speaking</p>
        <h1>Luyện nói, ghi âm, tự đánh giá</h1>
        <p>
          Thực hành đủ 3 phần trên {topics.length || "các"} chủ đề. Khi em nộp bài, file ghi âm và bản chép lời được gửi cho {teacher} nghe và nhận xét.
        </p>
        <div className="banner-meta">
          <span>Part 1 · Interview</span>
          <span>Part 2 · Long turn</span>
          <span>Part 3 · Discussion</span>
          <span>4 tiêu chí IELTS</span>
        </div>
      </section>
      {!home?.student ? (
        <GateLogin title="Đăng nhập để luyện nói" note="Nhập mã cá nhân trước, sau đó em chọn chủ đề để ghi âm." />
      ) : !topics.length ? (
        <p className="empty" style={{ marginTop: 18 }}>
          Chưa có chủ đề Speaking nào được giao cho em. Em nhắn {teacher} nhé.
        </p>
      ) : (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="sp-answer-head">
            <div>
              <p className="eyebrow">Chủ đề luyện tập</p>
              <h2>Chọn một chủ đề</h2>
            </div>
            <span className="count-chip">
              Đã nộp {handedIn}/{topics.length} chủ đề
            </span>
          </div>
          <div className="topic-grid">
            {topics.map((q) => {
              const st = topicStatus(q, dash!.done, unfinished);
              return (
                <Link key={q.id} className="topic-card" href={`/bai/${q.id}`}>
                  <b>{q.title}</b>
                  {q.subtitle && <span className="tiny muted">{q.subtitle}</span>}
                  <span className="tiny muted">{q.questionCount} câu</span>
                  <span className={`topic-status ${st.tone}`}>{st.text}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
