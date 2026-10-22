"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Swoosh } from "@/components/site/parts";
import { errMsg, sdel, sget, sset, stamp } from "@/lib/ui";

const TOKEN_KEY = "tedu.parent";
const SKILL: Record<string, string> = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };

export default function ParentPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const data = useQuery(api.parent.overview, token ? { token } : "skip");
  const logout = useMutation(api.parent.logout);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(sget<string | null>("localStorage", TOKEN_KEY, null));
    document.title = "Phụ huynh theo dõi · TEDU English";
  }, []);

  useEffect(() => {
    if (token && data === null) {
      sdel("localStorage", TOKEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToken(null);
    }
  }, [data, token]);

  function signOut() {
    if (token) logout({ token }).catch(() => {});
    sdel("localStorage", TOKEN_KEY);
    setToken(null);
  }

  return (
    <div className="site-cq">
      <div className="shell parent">
        <header className="site-header">
          <Link className="brand" href="/" aria-label="TEDU English">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-mark" src="/tedu-mark.png" alt="" width={58} height={46} />
            <span className="brand-text">
              <span className="wordmark">
                <span className="a">TEDU</span>
                <span className="b">ENGLISH</span>
              </span>
              <span className="tagline">Phụ huynh theo dõi</span>
            </span>
          </Link>
          {data && (
            <div className="header-actions">
              <span className="who">
                <span className="avatar" aria-hidden="true">
                  👪
                </span>
                <span>
                  <b>PH em {data.child.name}</b>
                </span>
              </span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={signOut}>
                Đăng xuất
              </button>
            </div>
          )}
        </header>
        <main>
          {token === undefined || (token && data === undefined) ? (
            <p className="empty">Đang tải…</p>
          ) : !token || !data ? (
            <ParentLogin
              onDone={(t) => {
                sset("localStorage", TOKEN_KEY, t);
                setToken(t);
              }}
            />
          ) : (
            <Dashboard data={data} />
          )}
        </main>
        <footer className="site-footer">
          <span>TEDU English · Better English, Brighter Futures</span>
          <nav aria-label="Liên kết cuối trang">
            <Link href="/">Trang học sinh</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

function ParentLogin({ onDone }: { onDone: (token: string) => void }) {
  const login = useMutation(api.parent.login);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await login({ code });
      if (r.ok) onDone(r.token);
      else setErr(r.error);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero view-enter">
      <div className="cover">
        <Swoosh />
        <div>
          <span className="pill">Dành cho phụ huynh</span>
          <h1>
            Theo dõi con học.<span className="hl">Không cần hỏi thầy.</span>
          </h1>
          <p className="lead">Xem tiến độ học tập, tỷ lệ hoàn thành, các bài con chưa làm và điểm số từng kỹ năng của con, cập nhật ngay khi con nộp bài.</p>
        </div>
        <div className="skill-chips">
          <span>Tiến độ</span>
          <span>Điểm số</span>
          <span>Chuyên cần</span>
          <span>Nhận xét</span>
        </div>
      </div>
      <div className="page">
        <div>
          <p className="eyebrow">Parent access</p>
          <h2>Nhập mã phụ huynh</h2>
          <p className="small muted">Mã phụ huynh là mã học sinh của con, thêm chữ “ph” trước 4 số cuối: con dùng baoan7305 thì phụ huynh nhập baoanph7305. Mã này chỉ để xem, không làm bài được.</p>
        </div>
        <form className="stack" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="ph-code">Mã phụ huynh</label>
            <input className="input" id="ph-code" autoCapitalize="off" spellCheck={false} placeholder="Ví dụ: baoanph7305" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <p className="alert alert-bad" role="alert" hidden={!err}>
            {err}
          </p>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Đang kiểm tra…" : "Xem kết quả của con"}
          </button>
        </form>
        <p className="tiny muted">Chưa có mã? Phụ huynh vui lòng liên hệ giáo viên của lớp.</p>
      </div>
    </section>
  );
}

type Overview = NonNullable<FunctionReturnType<typeof api.parent.overview>>;

function Dashboard({ data }: { data: Overview }) {
  const p = data.progress;
  const sk = data.skills;
  return (
    <>
      <section className="banner view-enter">
        <Swoosh />
        <p className="eyebrow">Kết quả học tập của con</p>
        <h1>{data.child.name}</h1>
        <p>Lớp {data.child.className} · số liệu cập nhật tự động mỗi khi con nộp bài.</p>
        <div className="banner-meta">
          <span>Chuyên cần {p.rate}%</span>
          <span>
            Đã làm {p.done}/{p.total} bài
          </span>
        </div>
      </section>

      <div className="t-grid two">
        <section className="panel">
          <div>
            <p className="eyebrow">Mức độ chăm chỉ</p>
            <h2>Chuyên cần</h2>
          </div>
          <div className="ph-att">
            <div className="score-dial" style={{ "--p": p.rate } as React.CSSProperties}>
              <div className="inner">
                <b>{p.rate}%</b>
                <small>chuyên cần</small>
              </div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <p>
                ✅ Đã làm <b>{p.done}</b> bài
              </p>
              <p>
                ⏳ Chưa làm <b>{p.total - p.done}</b> bài
              </p>
              <p className="tiny muted">Tính trên {p.total} bài làm trên web thầy cô đã giao.</p>
            </div>
          </div>
          {p.byFolder.map((f) => (
            <div key={f.id}>
              <div className="progress-row">
                <span style={{ minWidth: 0, flex: "0 1 auto" }}>
                  <b>{f.name}</b>
                </span>
                <span className="progress" aria-hidden="true">
                  <i style={{ width: `${f.rate}%` }} />
                </span>
                <span>
                  {f.done}/{f.total} · {f.rate}%
                </span>
              </div>
            </div>
          ))}
          {p.pending.length > 0 && (
            <details className="ph-pending">
              <summary>Xem {p.pending.length} bài con chưa làm</summary>
              <ul>
                {p.pending.map((q) => (
                  <li key={q.id}>
                    {q.title} <span className="muted tiny">· {q.folder}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="panel">
          <div>
            <p className="eyebrow">Kết quả riêng của con</p>
            <h2>Điểm theo kỹ năng</h2>
          </div>
          {!sk.ielts.length && !sk.folders.length ? (
            <p className="empty">Con chưa có bài nào được chấm điểm.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kỹ năng / thư mục</th>
                    <th className="num">Trung bình</th>
                    <th className="num">Cao nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {sk.ielts.map((x) => (
                    <tr key={x.skill}>
                      <td>
                        <b>IELTS {SKILL[x.skill]}</b>
                        <span className="sub">{x.tests} bài có band</span>
                      </td>
                      <td className="num">
                        <b>Band {x.average.toFixed(1)}</b>
                      </td>
                      <td className="num">{x.best.toFixed(1)}</td>
                    </tr>
                  ))}
                  {sk.folders.map((x) => (
                    <tr key={x.name}>
                      <td>
                        <b>{x.name}</b>
                        <span className="sub">{x.quizzes} bài đã làm</span>
                      </td>
                      <td className="num">
                        <b>{x.average}%</b>
                      </td>
                      <td className="num muted">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="tiny muted">IELTS tính theo band cao nhất của mỗi đề; các thư mục khác tính theo điểm cao nhất của mỗi bài.</p>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <div>
          <p className="eyebrow">Điểm cao nhất của con ở mỗi bài</p>
          <h2>Kết quả từng bài</h2>
        </div>
        {!data.results.length ? (
          <p className="empty">Con chưa nộp bài nào.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bài</th>
                  <th className="num">Điểm</th>
                  <th className="num">Band</th>
                  <th className="num">Số lần làm</th>
                  <th>Lần gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <b>{x.title}</b>
                      <span className="sub">
                        {x.folder}
                        {x.skill ? ` · IELTS ${SKILL[x.skill]}` : ""}
                        {x.held ? " · bài thi, chờ thầy cô công bố kết quả" : ""}
                      </span>
                      {x.writing && (
                        <details className="ph-writing">
                          <summary>{x.writing.status === "done" ? "✍️ Xem nhận xét của thầy cô" : "✍️ Bài đang chờ thầy cô chấm"}</summary>
                          {x.writing.essays.map((e, i) => (
                            <div key={i} className="mw-review" style={{ marginTop: 8 }}>
                              <p className="tiny muted">{e.prompt}</p>
                              {e.band != null && (
                                <p className="mw-band">
                                  Band <b>{e.band.toFixed(1)}</b>
                                </p>
                              )}
                              {e.criteria.length > 0 && (
                                <div className="mw-criteria">
                                  {e.criteria.map((c) => (
                                    <span key={c.name}>
                                      {c.name} <b>{c.band.toFixed(1)}</b>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {e.comment && <p className="mw-comment">{e.comment}</p>}
                            </div>
                          ))}
                        </details>
                      )}
                    </td>
                    <td className="num">
                      {x.best ? (
                        <>
                          <b>
                            {x.best.correct}/{x.best.total}
                          </b>
                          <span className="sub">{x.best.pct}%</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num">{x.band != null ? <b>{x.band.toFixed(1)}</b> : <span className="muted">—</span>}</td>
                    <td className="num">{x.attempts}</td>
                    <td className="tiny">{stamp(x.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 18 }}>
        Có thắc mắc về kết quả, phụ huynh vui lòng liên hệ {data.teacher} của lớp.
      </p>
    </>
  );
}
