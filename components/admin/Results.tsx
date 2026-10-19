"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RECORDING_KEEP_DAYS, SPEAKING_CRITERIA, SPEAKING_REVIEW_KEY, WRITING_CRITERIA, writingBand } from "@/convex/model";
import { downloadXlsx } from "@/lib/excel";
import { answerBaseName, attemptBaseName, audioExt, fileSlug, questionList } from "@/lib/speaking-files";
import { Rich, errMsg, stamp } from "@/lib/ui";
import { Modal, useAdmin, useRun } from "./AdminShell";

export default function Results() {
  const { token } = useAdmin();
  const run = useRun();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const quizId = (params.get("quiz") || undefined) as Id<"quizzes"> | undefined;
  const studentId = (params.get("student") || undefined) as Id<"students"> | undefined;
  const pendingOnly = params.get("cho") === "1";

  const rows = useQuery(api.admin.attempts, { token, quizId, studentId, pendingOnly });
  const quizzes = useQuery(api.admin.quizzes, { token });
  const students = useQuery(api.admin.students, { token });
  const del = useMutation(api.admin.deleteAttempt);
  const reopen = useMutation(api.admin.reopenQuiz);
  const settings = useQuery(api.admin.settings, { token });
  const lockAt = settings?.lockAtPercent ?? 0;
  const [cls, setCls] = useState("");
  const [bestOnly, setBestOnly] = useState(false);
  const [detail, setDetail] = useState<Id<"attempts"> | null>(null);

  const classes = useMemo(() => [...new Set((students ?? []).map((s) => s.className))].sort((a, b) => a.localeCompare(b, "vi")), [students]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  let list = (rows ?? []).filter((r) => !cls || r.className === cls);
  if (bestOnly) {
    const best = new Map<string, (typeof list)[number]>();
    for (const r of list) {
      const k = `${r.studentId}|${r.quizId}`;
      const prev = best.get(k);
      if (!prev || r.correct / (r.total || 1) > prev.correct / (prev.total || 1)) best.set(k, r);
    }
    list = list.filter((r) => best.get(`${r.studentId}|${r.quizId}`) === r);
  }
  const scored = list.filter((r) => r.total > 0);
  const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.correct / r.total, 0) / scored.length) * 100) : null;

  function exportXlsx() {
    downloadXlsx(
      "ket-qua-tedu.xlsx",
      ["Thời gian", "Học sinh", "Lớp", "Bài", "Đúng", "Tổng", "Phần trăm", "Band", "Bài viết"],
      list.map((r) => [
        stamp(r.submittedAt),
        r.studentName,
        r.className,
        r.quizTitle,
        r.total ? r.correct : "",
        r.total || "",
        r.total ? Math.round((r.correct / r.total) * 100) : "",
        r.band != null ? r.band.toFixed(1) : "",
        r.reviewStatus === "pending" ? "Chờ nhận xét" : r.reviewStatus === "done" ? "Đã nhận xét" : "",
      ]),
    );
  }

  return (
    <section className="panel">
      <div className="toolbar">
        <div>
          <p className="eyebrow">Điểm cả lớp</p>
          <h2>Kết quả bài làm</h2>
          <p className="small muted">Mỗi lần học sinh nộp bài là một dòng. Bấm vào dòng để xem em đã trả lời từng câu thế nào.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={exportXlsx} disabled={!list.length}>
            Tải Excel
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="filters">
          <select className="select" value={quizId ?? ""} onChange={(e) => setParam("quiz", e.target.value)} aria-label="Lọc theo bài">
            <option value="">Tất cả bài</option>
            {quizzes?.map((q) => (
              <option key={q._id} value={q._id}>
                {q.title}
              </option>
            ))}
          </select>
          <select className="select" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="select" value={studentId ?? ""} onChange={(e) => setParam("student", e.target.value)} aria-label="Lọc theo học sinh">
            <option value="">Tất cả học sinh</option>
            {students
              ?.filter((s) => !cls || s.className === cls)
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} · {s.className}
                </option>
              ))}
          </select>
          <label className="switch">
            <input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} />
            Chỉ lần cao nhất
          </label>
          <label className="switch">
            <input type="checkbox" checked={pendingOnly} onChange={(e) => setParam("cho", e.target.checked ? "1" : "")} />
            ✍️ Chỉ bài viết chờ nhận xét
          </label>
        </div>
        <span className="count-chip">
          {list.length} lượt{avg != null ? ` · TB ${avg}%` : ""}
        </span>
      </div>
      {!rows ? (
        <p className="empty">Đang tải…</p>
      ) : !list.length ? (
        <p className="empty">Chưa có kết quả nào khớp bộ lọc.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lúc nộp</th>
                <th>Học sinh</th>
                <th>Bài</th>
                <th className="num">Điểm</th>
                <th>Tỉ lệ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
                return (
                  <tr key={r.id}>
                    <td className="tiny">
                      {stamp(r.submittedAt)}
                      {r.durationSec != null && <span className="sub">⏱ làm {fmtDuration(r.durationSec)}</span>}
                    </td>
                    <td>
                      <b>{r.studentName}</b>
                      <span className="sub">{r.className}</span>
                    </td>
                    <td>{r.quizTitle}</td>
                    <td className="num">
                      {r.total > 0 ? (
                        <b>
                          {r.correct}/{r.total}
                        </b>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {r.band != null && <span className="sub">Band {r.band.toFixed(1)}</span>}
                      {r.total > 0 && r.unanswered > 0 && <span className="sub">{r.unanswered} câu bỏ trống</span>}
                      {r.reviewStatus === "pending" && <span className="status draft">✍️ Chờ nhận xét</span>}
                      {r.reviewStatus === "done" && <span className="status on">✍️ Đã nhận xét</span>}
                      {lockAt > 0 && r.total > 0 && !r.reopened && (r.correct / r.total) * 100 >= lockAt && <span className="sub">🔒 Đã khoá bài</span>}
                      {r.leftQuiz && <span className="sub state-low">🚪 Tự nộp: em rời bài, tài khoản bị khoá</span>}
                    </td>
                    <td style={{ minWidth: 110 }}>
                      {r.total > 0 && (
                        <>
                          <div className="bar" title={`${pct}%`}>
                            <i style={{ width: `${pct}%` }} />
                          </div>
                          <span className="sub">{pct}%</span>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="link-btn" type="button" onClick={() => setDetail(r.id)}>
                          {r.reviewStatus === "pending" ? "Chấm bài viết" : "Chi tiết"}
                        </button>
                        {lockAt > 0 && r.total > 0 && !r.reopened && (r.correct / r.total) * 100 >= lockAt && (
                          <button
                            className="link-btn"
                            type="button"
                            title={`Bài đã khoá vì đạt từ ${lockAt}%`}
                            onClick={() => {
                              if (confirm(`Cho ${r.studentName} làm lại “${r.quizTitle}”? Điểm cũ vẫn được giữ.`))
                                run(() => reopen({ token, studentId: r.studentId, quizSlug: r.quizId }), "Đã mở lại bài cho học sinh.");
                            }}
                          >
                            🔓 Cho làm lại
                          </button>
                        )}
                        <button
                          className="link-btn danger"
                          type="button"
                          onClick={() => {
                            if (confirm(`Xóa lượt nộp này của ${r.studentName}?`)) run(() => del({ token, id: r.id }), "Đã xóa lượt nộp.");
                          }}
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {detail && <AttemptDetail id={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

function AttemptDetail({ id, onClose }: { id: Id<"attempts">; onClose: () => void }) {
  const { token } = useAdmin();
  const a = useQuery(api.admin.attemptDetail, { token, id });
  return (
    <Modal title={a ? `${a.studentName} · ${a.quizTitle}` : "Chi tiết bài làm"} onClose={onClose} wide>
      {!a ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <>
          <p className="small muted">
            {a.className} · nộp lúc {stamp(a.submittedAt)}
            {a.total > 0 && (
              <>
                {" "}
                ·{" "}
                <b>
                  {a.correct}/{a.total}
                </b>{" "}
                đúng
              </>
            )}
            {a.band != null ? ` · Band ${a.band.toFixed(1)}` : ""}
          </p>
          {a.speaking && <SpeakingReview key={a.id + (a.reviewedAt ?? "")} attempt={a} onDone={onClose} />}
          {a.essays.length > 0 && <EssayReview key={a.id + (a.reviewedAt ?? "")} attempt={a} onDone={onClose} />}
          {a.questions.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Câu</th>
                    <th>Câu hỏi</th>
                    <th>Em trả lời</th>
                    <th>Đáp án</th>
                  </tr>
                </thead>
                <tbody>
                  {a.questions.map((q) => (
                    <tr key={q.num}>
                      <td>
                        {q.num} {q.ok ? <span className="status on">Đúng</span> : <span className="status off">{q.given ? "Sai" : "Bỏ trống"}</span>}
                      </td>
                      <td>
                        <Rich text={q.q} />
                        <span className="sub">{q.section}</span>
                      </td>
                      <td>{q.given ? <Rich text={q.given} /> : <span className="muted">—</span>}</td>
                      <td>
                        <Rich text={q.right} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

type Detail = NonNullable<FunctionReturnType<typeof api.admin.attemptDetail>>;
type ReviewDraft = { comment: string; band: string; useCriteria: boolean; criteria: string[] };
const BAND_STEPS = Array.from({ length: 19 }, (_, i) => (i / 2).toFixed(1));

/** Teacher marking for the essays in an attempt: a comment, plus an optional band or the four IELTS criteria. */
function EssayReview({ attempt, onDone }: { attempt: Detail; onDone: () => void }) {
  const { token, toast } = useAdmin();
  const save = useMutation(api.admin.reviewAttempt);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>(() =>
    Object.fromEntries(
      attempt.essays.map((e) => [
        e.key,
        {
          comment: e.review?.comment ?? "",
          band: e.review?.band != null && !e.review.criteria ? e.review.band.toFixed(1) : "",
          // IELTS criteria by default; an older plain-band review keeps its own mode.
          useCriteria: e.review ? !!e.review.criteria : true,
          criteria: e.review?.criteria?.map((c) => c.toFixed(1)) ?? ["", "", "", ""],
        },
      ]),
    ),
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, patch: Partial<ReviewDraft>) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  async function submit() {
    const reviews: Record<string, { comment: string; band?: number; criteria?: number[] }> = {};
    for (const e of attempt.essays) {
      const d = drafts[e.key];
      if (d.useCriteria) {
        if (d.criteria.some((c) => c === "")) return setErr(`Câu ${e.num}: chấm đủ 4 tiêu chí hoặc tắt chấm theo tiêu chí.`);
        reviews[e.key] = { comment: d.comment, criteria: d.criteria.map(Number) };
      } else reviews[e.key] = { comment: d.comment, ...(d.band ? { band: Number(d.band) } : {}) };
    }
    setBusy(true);
    try {
      await save({ token, id: attempt.id, reviews });
      toast("Đã lưu nhận xét. Học sinh thấy ngay ở trang bài làm.");
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {attempt.reviewedAt && (
        <p className="alert alert-good">
          Đã nhận xét lúc {stamp(attempt.reviewedAt)}
          {attempt.reviewedBy ? ` bởi ${attempt.reviewedBy}` : ""}. Thầy cô có thể sửa rồi lưu lại.
        </p>
      )}
      {attempt.essays.map((e) => {
        const d = drafts[e.key];
        const overall = d.useCriteria && d.criteria.every((c) => c !== "") ? writingBand(d.criteria.map(Number)) : null;
        return (
          <section key={e.key} className="essay-review">
            <p className="eyebrow">
              Câu {e.num} · {e.section}
            </p>
            <div className="essay-prompt small">
              <Rich text={e.q} />
            </div>
            {e.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="q-image" src={e.imageUrl} alt="" style={{ maxHeight: 220 }} />
            )}
            <div className="mw-text">{e.text || "(Học sinh để trống)"}</div>
            <p className={`tiny ${e.minWords && e.words < e.minWords ? "state-low" : "muted"}`}>
              {e.words} từ{e.minWords ? ` · yêu cầu tối thiểu ${e.minWords}` : ""}
            </p>
            <div className="field">
              <label htmlFor={`rv-${e.key}`}>Nhận xét cho học sinh</label>
              <textarea
                className="textarea prose"
                id={`rv-${e.key}`}
                rows={5}
                value={d.comment}
                onChange={(ev) => set(e.key, { comment: ev.target.value })}
                placeholder="Điểm mạnh, lỗi cần sửa, gợi ý nâng band…"
              />
            </div>
            <label className="switch">
              <input type="checkbox" checked={d.useCriteria} onChange={(ev) => set(e.key, { useCriteria: ev.target.checked })} />
              Chấm theo 4 tiêu chí IELTS Writing
            </label>
            {d.useCriteria ? (
              <div className="criteria-grid">
                {WRITING_CRITERIA.map((c, i) => (
                  <label key={c} className="field">
                    <span className="tiny" style={{ fontWeight: 700 }}>
                      {c}
                    </span>
                    <select
                      className="select compact"
                      value={d.criteria[i]}
                      onChange={(ev) => set(e.key, { criteria: d.criteria.map((x, j) => (j === i ? ev.target.value : x)) })}
                    >
                      <option value="">—</option>
                      {BAND_STEPS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="field">
                  <span className="tiny" style={{ fontWeight: 700 }}>
                    Band tổng
                  </span>
                  <b className="overall-band">{overall != null ? overall.toFixed(1) : "—"}</b>
                </div>
              </div>
            ) : (
              <div className="field" style={{ maxWidth: 220 }}>
                <label htmlFor={`bd-${e.key}`}>
                  Band / điểm <span className="hint">(không bắt buộc)</span>
                </label>
                <select className="select compact" id={`bd-${e.key}`} value={d.band} onChange={(ev) => set(e.key, { band: ev.target.value })}>
                  <option value="">Không chấm band</option>
                  {BAND_STEPS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>
        );
      })}
      <p className="alert alert-bad" role="alert" hidden={!err}>
        {err}
      </p>
      <div className="modal-foot">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
          {busy ? "Đang lưu…" : attempt.reviewedAt ? "Cập nhật nhận xét" : "Lưu nhận xét & trả bài"}
        </button>
      </div>
    </div>
  );
}

/** Teacher marking for a Speaking test: listen to each answer, then one comment and the four IELTS Speaking criteria. */
function SpeakingReview({ attempt, onDone }: { attempt: Detail; onDone: () => void }) {
  const { token, toast } = useAdmin();
  const save = useMutation(api.admin.reviewAttempt);
  const sp = attempt.speaking!;
  const [comment, setComment] = useState(sp.review?.comment ?? "");
  const [criteria, setCriteria] = useState<string[]>(sp.review?.criteria?.map((c) => c.toFixed(1)) ?? ["", "", "", ""]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const overall = criteria.every((c) => c !== "") ? writingBand(criteria.map(Number)) : null;
  const answered = sp.items.filter((i) => i.url).length;
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);
  const base = attemptBaseName(attempt);

  /** All recordings in one .zip, named by question, with the question list alongside. */
  async function downloadAll() {
    const items = sp.items.filter((i) => i.url);
    setZipping({ done: 0, total: items.length });
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      const names = new Map<string, string>();
      let done = 0;
      await Promise.all(
        items.map(async (it) => {
          const res = await fetch(it.url!);
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          const name = answerBaseName(it) + audioExt(blob.type);
          files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]; // audio is already compressed
          names.set(it.key, name);
          setZipping({ done: ++done, total: items.length });
        }),
      );
      const list = questionList(
        attempt,
        sp.items.map((it) => ({ it, file: names.get(it.key) ?? null })),
      );
      // Question order inside the zip, whatever order the downloads finished in.
      const ordered = Object.fromEntries(Object.keys(files).sort().map((n) => [n, files[n]]));
      const zip = zipSync({ [base]: { "00_Danh-sach-cau-hoi.txt": strToU8("\ufeff" + list), ...ordered } });
      saveBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${base}.zip`);
      toast(`Đã tải ${items.length} câu trả lời của ${attempt.studentName}.`);
    } catch (e) {
      toast(errMsg(e, "Chưa tải được bài nói. Kiểm tra mạng rồi thử lại."));
    } finally {
      setZipping(null);
    }
  }

  async function downloadOne(it: (typeof sp.items)[number]) {
    try {
      const res = await fetch(it.url!);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      saveBlob(blob, `${fileSlug(attempt.studentName, 30)}_${answerBaseName(it)}${audioExt(blob.type)}`);
    } catch (e) {
      toast(errMsg(e, "Chưa tải được câu này, thử lại nhé."));
    }
  }

  async function submit() {
    if (criteria.some((c) => c === "") && criteria.some((c) => c !== "")) return setErr("Chấm đủ 4 tiêu chí, hoặc để trống cả 4 nếu chỉ nhận xét.");
    setBusy(true);
    try {
      const all = criteria.every((c) => c !== "");
      await save({ token, id: attempt.id, reviews: { [SPEAKING_REVIEW_KEY]: { comment, ...(all ? { criteria: criteria.map(Number) } : {}) } } });
      toast("Đã lưu nhận xét. Học sinh thấy ngay ở trang bài làm.");
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {attempt.reviewedAt && (
        <p className="alert alert-good">
          Đã chấm lúc {stamp(attempt.reviewedAt)}
          {attempt.reviewedBy ? ` bởi ${attempt.reviewedBy}` : ""}. Thầy cô có thể sửa rồi lưu lại.
        </p>
      )}
      <section className="essay-review">
        <p className="eyebrow">
          Bài nói · {answered}/{sp.items.length} câu có ghi âm
          {sp.mode ? ` · ${sp.mode === "practice" ? "luyện tập" : "thi thử"}` : ""}
        </p>
        {sp.selfReview && (
          <div className="sp-self-view">
            <b>Em tự đánh giá: band {writingBand(sp.selfReview.criteria)?.toFixed(1) ?? "—"}</b>
            <span className="tiny">
              {SPEAKING_CRITERIA.map((c, i) => `${c} ${sp.selfReview!.criteria[i].toFixed(1)}`).join(" · ")}
            </span>
            {sp.selfReview.note && <span className="small">“{sp.selfReview.note}”</span>}
          </div>
        )}
        {sp.purged ? (
          <p className="small muted">Ghi âm đã tự xoá sau {RECORDING_KEEP_DAYS} ngày; điểm và nhận xét vẫn còn.</p>
        ) : (
          answered > 0 && (
            <p className="alert alert-warn">
              ⏳ Ghi âm tự xoá từ {stamp(attempt.submittedAt + RECORDING_KEEP_DAYS * 24 * 60 * 60 * 1000)} ({RECORDING_KEEP_DAYS} ngày sau khi nộp). Thầy cô nhớ chấm trước thời điểm này.
            </p>
          )
        )}
        {answered > 0 && (
          <div className="speak-download">
            <button className="btn btn-primary btn-sm" type="button" onClick={downloadAll} disabled={!!zipping}>
              {zipping ? `Đang tải ${zipping.done}/${zipping.total} câu…` : `⬇️ Tải toàn bộ bài nói (${answered} câu, file .zip)`}
            </button>
            <span className="tiny muted">
              Tên file theo thứ tự câu, ví dụ <code>Cau01_Part1_….webm</code>, kèm danh sách câu hỏi. Mở bằng Chrome hoặc VLC nếu máy không phát được.
            </span>
          </div>
        )}
        <div className="speak-replay">
          {sp.items.map((it) => (
            <div key={it.key} className="speak-replay-row">
              <span className="small">
                <b>Câu {it.num}.</b> {it.q.split("\n")[0]} <span className="tiny muted">· {it.section} · {it.answerSec}s</span>
                {it.url && (
                  <button className="link-btn" type="button" onClick={() => downloadOne(it)} style={{ marginLeft: 8 }}>
                    ⬇️ Tải câu này
                  </button>
                )}
              </span>
              {it.url ? <audio controls preload="none" src={it.url} /> : <span className="tiny muted">{sp.purged ? "(đã xoá)" : "(không có ghi âm)"}</span>}
              {it.transcript && (
                <p className="sp-transcript">
                  <span className="tiny muted">Bản chép lời:</span> {it.transcript}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="rv-speaking">Nhận xét cho học sinh</label>
          <textarea
            className="textarea prose"
            id="rv-speaking"
            rows={5}
            value={comment}
            onChange={(ev) => setComment(ev.target.value)}
            placeholder="Độ trôi chảy, từ vựng, ngữ pháp, phát âm; gợi ý nâng band…"
          />
        </div>
        <div className="criteria-grid">
          {SPEAKING_CRITERIA.map((c, i) => (
            <label key={c} className="field">
              <span className="tiny" style={{ fontWeight: 700 }}>
                {c}
              </span>
              <select className="select compact" value={criteria[i]} onChange={(ev) => setCriteria(criteria.map((x, j) => (j === i ? ev.target.value : x)))}>
                <option value="">—</option>
                {BAND_STEPS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="field">
            <span className="tiny" style={{ fontWeight: 700 }}>
              Band Speaking
            </span>
            <b className="overall-band">{overall != null ? overall.toFixed(1) : "—"}</b>
          </div>
        </div>
      </section>
      <p className="alert alert-bad" role="alert" hidden={!err}>
        {err}
      </p>
      <div className="modal-foot">
        <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
          {busy ? "Đang lưu…" : attempt.reviewedAt ? "Cập nhật nhận xét" : "Lưu & trả bài"}
        </button>
      </div>
    </div>
  );
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const ss = Math.round(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : m ? `${m} phút ${ss} giây` : `${ss} giây`;
}
