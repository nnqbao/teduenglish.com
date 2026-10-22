"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { examTime } from "@/components/site/parts";
import { stamp } from "@/lib/ui";
import { useAdmin, useRun } from "./AdminShell";

export default function Quizzes() {
  const { token } = useAdmin();
  const run = useRun();
  const quizzes = useQuery(api.admin.quizzes, { token });
  const folders = useQuery(api.admin.folders, { token });
  const dup = useMutation(api.admin.duplicateQuiz);
  const del = useMutation(api.admin.deleteQuiz);
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");

  const folderName = useMemo(() => new Map((folders ?? []).map((f) => [f.slug, f.name])), [folders]);
  const order = useMemo(() => new Map((folders ?? []).map((f, i) => [f.slug, i])), [folders]);
  const list = (quizzes ?? [])
    .filter((x) => (!folder || x.folder === folder) && (!q || `${x.title} ${x.subtitle}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (order.get(a.folder) ?? 99) - (order.get(b.folder) ?? 99));

  return (
    <section className="panel">
      <div className="toolbar">
        <div>
          <p className="eyebrow">Làm trên web · chấm tự động</p>
          <h2>Bài làm trên web</h2>
          <p className="small muted">Trắc nghiệm, điền từ, viết lại câu, IELTS Listening/Reading. Đáp án chỉ lưu trên máy chủ, học sinh không xem được trước khi nộp.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-primary btn-sm" href="/admin/bai-lam/moi">
            + Soạn bài mới
          </Link>
        </div>
      </div>
      <div className="toolbar">
        <div className="filters">
          <input className="input" type="search" placeholder="Tìm bài…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm bài" />
          <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Lọc theo thư mục">
            <option value="">Tất cả thư mục</option>
            {folders?.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <span className="count-chip">{list.length} bài</span>
      </div>
      {!quizzes ? (
        <p className="empty">Đang tải…</p>
      ) : !list.length ? (
        <p className="empty">Chưa có bài nào.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bài</th>
                <th>Thư mục</th>
                <th className="num">Số câu</th>
                <th>Mã bài</th>
                <th>Trạng thái</th>
                <th className="num">Lượt nộp</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x._id}>
                  <td>
                    <Link href={`/admin/bai-lam/${x._id}`}>
                      <b>{x.title}</b>
                    </Link>
                    <span className="sub">
                      {x.subtitle}
                      {x.subtitle ? " · " : ""}
                      <span className="mono">/bai/{x.slug}</span>
                    </span>
                  </td>
                  <td>{folderName.get(x.folder) ?? x.folder}</td>
                  <td className="num">{x.questionCount}</td>
                  <td>{x.code ? <code>{x.code}</code> : <span className="muted">Không cần</span>}</td>
                  <td>
                    {x.published ? <span className="status on">Đang hiện</span> : <span className="status draft">Bản nháp</span>}
                    {x.featured && <span className="sub">★ Nổi bật</span>}
                    {x.ielts && <span className="sub">IELTS {x.ielts[0].toUpperCase() + x.ielts.slice(1)}</span>}
                    {x.exam && (
                      <span className="sub">
                        🎯 Thi ·{" "}
                        {x.exam.phase === "open" ? "đang mở" : x.exam.phase === "ended" ? "đã đóng" : x.exam.opensAt ? `mở ${examTime(x.exam.opensAt)}` : "chưa mở"}
                        {x.exam.releasedAt ? " · đã công bố" : ""}
                      </span>
                    )}
                    {x.hasEssay && <span className="sub">✍️ Có bài viết</span>}
                    {x.term && <span className="sub">{x.term === "hk1" ? "Học kỳ 1" : "Học kỳ 2"}</span>}
                  </td>
                  <td className="num">
                    {x.attemptCount ? <Link href={`/admin/ket-qua?quiz=${x._id}`}>{x.attemptCount}</Link> : 0}
                    {x.avgPct != null && !x.hasEssay && <span className="sub">TB {x.avgPct}%</span>}
                    {x.pendingCount > 0 && (
                      <Link className="sub" href={`/admin/ket-qua?quiz=${x._id}&cho=1`}>
                        ✍️ {x.pendingCount} chờ nhận xét
                      </Link>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <Link className="link-btn" href={`/admin/bai-lam/${x._id}`}>
                        Sửa
                      </Link>
                      <a className="link-btn" href={`/bai/${x.slug}`} target="_blank" rel="noopener noreferrer">
                        Xem trước
                      </a>
                      <button className="link-btn" type="button" onClick={() => run(() => dup({ token, id: x._id }), "Đã tạo bản sao (đang là bản nháp).")}>
                        Nhân bản
                      </button>
                      <button
                        className="link-btn danger"
                        type="button"
                        onClick={() => {
                          if (confirm(`Xóa bài "${x.title}" và ${x.attemptCount} lượt nộp của học sinh?`)) run(() => del({ token, id: x._id }), "Đã xóa bài.");
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                    <span className="sub">Sửa {stamp(x.updatedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
