"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { firstName } from "@/convex/model";
import { stamp } from "@/lib/ui";
import { FolderCard, Loading, LoginForm, Swoosh, doneLabel, examLock, type DoneMap, type FolderInfo, type QuizMeta, type ResourceRow } from "./parts";
import { useSite, type HomeData } from "./SiteShell";

export default function HomeView() {
  const { home, token } = useSite();
  if (token === undefined || !home) return <Loading />;
  if (home.student && home.dashboard) return <Dashboard home={home} />;
  return <Hero folders={home.folders} />;
}

/** Small label + big text for the grade grid ("Lớp 6", "Chuyên Anh"...). */
function gradeLabel(f: FolderInfo): [string, string] {
  if (/^\d+$/.test(f.badge)) return ["Lớp", f.badge];
  const words = f.name.trim().split(/\s+/);
  if (words.length === 2) return [words[0], words[1]];
  return ["Thư mục", f.badge];
}

function Hero({ folders }: { folders: FolderInfo[] }) {
  const { teacher } = useSite();
  const grades = folders.filter((f) => f.id !== "ielts");
  const ielts = folders.find((f) => f.id === "ielts");
  return (
    <section className="hero view-enter">
      <div className="cover">
        <Swoosh />
        <div>
          <span className="pill">Lớp học thêm · Luyện tập mỗi ngày</span>
          <h1>
            Better English.<span className="hl">Brighter futures.</span>
          </h1>
          <p className="lead">Góc luyện tập tiếng Anh dành riêng cho học sinh TEDU English. Mỗi em một mã, mở đúng bài {teacher} đã giao.</p>
        </div>
        <div className="skill-chips">
          <span>Vocabulary</span>
          <span>Grammar</span>
          <span>Listening</span>
          <span>Reading</span>
          <span>Quizzes</span>
        </div>
      </div>
      <div className="page">
        <div>
          <p className="eyebrow">Student access</p>
          <h2>Nhập mã cá nhân</h2>
          <p className="small muted">Mỗi mã chỉ mở lớp và bài luyện tập được giao cho học sinh đó.</p>
        </div>
        <LoginForm ctx="home" />
        <p className="tiny muted">Không chia sẻ mã cá nhân. Nếu mã không hoạt động, em nhắn {teacher} để được cấp lại.</p>
        <Link className="track-link" href="/phu-huynh">
          <span>
            Phụ huynh theo dõi kết quả của con<small>Tiến độ, điểm số, chuyên cần · cần mã phụ huynh</small>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        <hr className="divider" />
        <div className="stack">
          <div>
            <p style={{ fontWeight: 700 }}>Mở bài theo khối</p>
            <p className="tiny muted">Chọn khối để xem thư mục. Em cần đăng nhập bằng mã cá nhân để làm bài.</p>
          </div>
          <div className="grade-grid">
            {grades.map((f) => {
              const [small, big] = gradeLabel(f);
              return (
                <Link key={f.id} className="grade-link" href={`/thu-muc/${f.id}`}>
                  <span>{small}</span>
                  <b>{big}</b>
                </Link>
              );
            })}
          </div>
          {ielts && (
            <Link className="track-link" href="/thu-muc/ielts">
              <span>
                IELTS · Listening &amp; Reading<small>Bài nghe, đọc có band tham khảo</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function Dashboard({ home }: { home: HomeData }) {
  const { teacher } = useSite();
  const st = home.student!;
  const dash = home.dashboard!;
  const folders = home.folders.filter((f) => dash.openFolders.includes(f.id));
  const done: DoneMap = dash.done;
  const myQuizzes = dash.quizzes;
  const progress = dash.progress;
  const featured = myQuizzes.filter((q) => q.featured);
  const folderName = (id: string) => home.folders.find((f) => f.id === id)?.name ?? "";
  const quizzesIn = (id: string): QuizMeta[] => myQuizzes.filter((q) => q.folder === id);
  const resourcesIn = (id: string): ResourceRow[] => dash.resources.filter((r) => r.folder === id);

  return (
    <>
      <section className="banner view-enter">
        <Swoosh />
        <p className="eyebrow">Welcome back</p>
        <h1>Xin chào, {firstName(st.name)}!</h1>
        <p>Lớp {st.className} · Đây là những nội dung được giao cho em.</p>
        <div className="banner-meta">
          <span>{folders.length} thư mục</span>
          <span>{myQuizzes.length} bài làm trên web</span>
          <span>
            Đã làm {progress.done}/{progress.total} bài
          </span>
          <span>Chuyên cần {progress.rate}%</span>
        </div>
      </section>

      {dash.unfinished.length > 0 && (
        <section className="resume-list" aria-label="Bài em đang làm dở">
          <p className="eyebrow">Bài em đang làm dở</p>
          {dash.unfinished.map((u) => (
            <Link key={u.id} className="resume-card" href={`/bai/${u.id}`}>
              <span className="resume-text">
                <span className="tiny muted">{folderName(u.folder)}</span>
                <b>{u.title}</b>
                <span className="resume-progress">
                  <span className="progress" aria-hidden="true">
                    <i style={{ width: `${u.total ? (u.answered / u.total) * 100 : 0}%` }} />
                  </span>
                  <span className="tiny">
                    Đã làm {u.answered}/{u.total} câu · lưu lúc {stamp(u.updatedAt)}
                  </span>
                </span>
              </span>
              <span className="btn btn-primary go">Em vào làm tiếp nhé →</span>
            </Link>
          ))}
        </section>
      )}

      {myQuizzes.some((q) => q.hasSpeak) && (
        <Link className="resume-card speak-entry" href="/speaking">
          <span className="resume-text">
            <span className="tiny muted">IELTS Speaking</span>
            <b>🎤 Luyện nói, ghi âm, tự đánh giá</b>
            <span className="tiny">
              Đã nộp {myQuizzes.filter((q) => q.hasSpeak && done[q.id]).length}/{myQuizzes.filter((q) => q.hasSpeak).length} chủ đề
            </span>
          </span>
          <span className="btn btn-primary go">Vào luyện nói →</span>
        </Link>
      )}

      {featured.length > 0 && (
        <div className="featured">
          {featured.map((q) => {
            const rec = done[q.id];
            const exam = examLock(q, rec);
            if (exam)
              return (
                <div key={q.id} className="feature-card locked" aria-disabled="true">
                  <div className="ft-text">
                    <p className="eyebrow">{folderName(q.folder)}</p>
                    <h3>{exam.title}</h3>
                    <p>{exam.meta}</p>
                  </div>
                </div>
              );
            if (rec?.locked)
              return (
                <div key={q.id} className="feature-card locked" aria-disabled="true">
                  <div className="ft-text">
                    <p className="eyebrow">{folderName(q.folder)}</p>
                    <h3>{q.title}</h3>
                    <p>Em đã hoàn thành bài này · {doneLabel(rec)}</p>
                  </div>
                  <span className="btn btn-ghost go">✓ Hoàn thành</span>
                </div>
              );
            return (
              <Link key={q.id} className="feature-card" href={`/bai/${q.id}`}>
                <div className="ft-text">
                  <p className="eyebrow">
                    {folderName(q.folder)}
                    {q.ielts === "listening" || q.ielts === "reading" ? " · Band tham khảo" : ""}
                  </p>
                  <h3>{q.title}</h3>
                  <p>
                    {q.questionCount} câu{q.minutes ? ` · khoảng ${q.minutes} phút` : ""}
                    {q.subtitle ? ` · ${q.subtitle}` : ""}
                  </p>
                </div>
                <span className={`btn ${rec ? "btn-ghost" : "btn-primary"} go`}>{rec ? (rec.review ? doneLabel(rec) : `Làm lại · ${doneLabel(rec)}`) : "Vào làm bài →"}</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="section-head">
        <div>
          <p className="eyebrow">My practice</p>
          <h2>Thư mục bài học</h2>
          <p className="small muted">Chọn bài trong thư mục được giao cho em.</p>
        </div>
        <span className="count-chip">{folders.length} thư mục</span>
      </div>
      {folders.length ? (
        <div className={`folder-grid${folders.length % 3 === 0 ? " three" : ""}`}>
          {folders.map((f) => (
            <FolderCard
              key={f.id}
              f={f}
              tone={home.folders.indexOf(f)}
              quizzes={quizzesIn(f.id)}
              resources={resourcesIn(f.id)}
              done={done}
              progress={progress.byFolder.find((p) => p.id === f.id)}
            />
          ))}
        </div>
      ) : (
        <p className="empty">Mã của em chưa được mở thư mục nào. Em nhắn {teacher} để được giao bài nhé.</p>
      )}
      <MyRanking />
    </>
  );
}

const SCOPE_LABEL = { all: "Tổng", listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" } as const;
const SKILL_LABEL = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" } as const;

/** The student's IELTS place in class. Only students see this; the parent page has no ranking. */
function MyRanking() {
  const { token } = useSite();
  const data = useQuery(api.site.ranking, token ? { token } : "skip");
  const [pick, setPick] = useState<keyof typeof SCOPE_LABEL>("all");
  if (!data || !data.scopes.length) return null;
  const cur = data.scopes.find((x) => x.scope === pick) ?? data.scopes[0];

  return (
    <section className="panel rank-panel">
      <div className="section-head" style={{ margin: 0 }}>
        <div>
          <p className="eyebrow">IELTS ranking</p>
          <h2>Thứ hạng của em trong lớp</h2>
          <p className="small muted">
            Lớp {data.className} · xếp theo band trung bình các đề IELTS, tên các bạn khác được ẩn.
          </p>
        </div>
        {cur.myRank != null && (
          <span className="count-chip">
            Hạng {cur.myRank}/{cur.of}
          </span>
        )}
      </div>
      {data.scopes.length > 1 && (
        <span className="speed" role="group" aria-label="Kỹ năng">
          {data.scopes.map((x) => (
            <button key={x.scope} type="button" aria-pressed={cur.scope === x.scope} onClick={() => setPick(x.scope)}>
              {SCOPE_LABEL[x.scope]}
            </button>
          ))}
        </span>
      )}
      {cur.myRank == null && <p className="small muted">Em chưa có bài {cur.scope === "all" ? "IELTS" : SCOPE_LABEL[cur.scope]} nào được tính band.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Hạng</th>
              <th>Học sinh</th>
              <th className="num">Band TB</th>
            </tr>
          </thead>
          <tbody>
            {cur.table.map((row) => (
              <tr key={row.label + row.rank} className={row.me ? "ph-me" : ""}>
                <td className="num">{["🥇", "🥈", "🥉"][row.rank - 1] ?? row.rank}</td>
                <td>
                  {row.me ? <b>{row.label} (em)</b> : <span className="mono">{row.label}</span>}
                  <span className="sub">{row.tests} bài</span>
                </td>
                <td className="num">
                  <b>{row.average.toFixed(1)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.perTest.some((t) => cur.scope === "all" || t.skill === cur.scope) && (
        <details>
          <summary className="small">Hạng của em ở từng đề</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Đề</th>
                  <th className="num">Band</th>
                  <th className="num">Hạng</th>
                </tr>
              </thead>
              <tbody>
                {data.perTest
                  .filter((t) => cur.scope === "all" || t.skill === cur.scope)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>
                        <b>{SKILL_LABEL[t.skill]}</b>
                        <span className="sub">{t.title}</span>
                      </td>
                      <td className="num">
                        <b>{t.band.toFixed(1)}</b>
                      </td>
                      <td className="num">
                        {t.rank}/{t.of}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
