"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { slugify } from "@/convex/model";
import { errMsg } from "@/lib/ui";
import { Modal, useAdmin, useRun } from "./AdminShell";

type Folder = FunctionReturnType<typeof api.admin.folders>[number];

export default function Folders() {
  const { token } = useAdmin();
  const run = useRun();
  const folders = useQuery(api.admin.folders, { token });
  const move = useMutation(api.admin.moveFolder);
  const del = useMutation(api.admin.deleteFolder);
  const [editing, setEditing] = useState<Folder | "new" | null>(null);
  const router = useRouter();
  const open = (f: Folder) => router.push(`/admin/thu-muc/${encodeURIComponent(f.slug)}`);

  return (
    <section className="panel">
      <div className="toolbar">
        <div>
          <p className="eyebrow">Cấu trúc bài học</p>
          <h2>Thư mục</h2>
          <p className="small muted">Mỗi học sinh được mở một hoặc nhiều thư mục. Thứ tự ở đây là thứ tự hiện trên trang học sinh. Bấm vào một thư mục để xem bài làm và học sinh của thư mục đó.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing("new")}>
            + Thêm thư mục
          </button>
        </div>
      </div>
      {!folders ? (
        <p className="empty">Đang tải…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thứ tự</th>
                <th>Thư mục</th>
                <th>Mã</th>
                <th className="num">Bài làm</th>
                <th className="num">Tài liệu</th>
                <th className="num">Học sinh</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {folders.map((f, i) => (
                <tr
                  key={f._id}
                  className="row-link"
                  onClick={(e) => {
                    // Whole row opens the folder, except its own buttons and links.
                    if (!(e.target as HTMLElement).closest("button, a")) open(f);
                  }}
                >
                  <td>
                    <div className="row-actions">
                      <button className="link-btn" type="button" disabled={i === 0} onClick={() => run(() => move({ token, id: f._id, dir: -1 }))} aria-label="Lên">
                        ↑
                      </button>
                      <button className="link-btn" type="button" disabled={i === folders.length - 1} onClick={() => run(() => move({ token, id: f._id, dir: 1 }))} aria-label="Xuống">
                        ↓
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className="tag">{f.badge}</span>{" "}
                    <Link href={`/admin/thu-muc/${encodeURIComponent(f.slug)}`}>
                      <b>{f.name}</b>
                    </Link>
                    <span className="sub">{f.detail}</span>
                  </td>
                  <td>
                    <code>{f.slug}</code>
                  </td>
                  <td className="num">{f.quizCount}</td>
                  <td className="num">{f.resourceCount}</td>
                  <td className="num">{f.studentCount}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="link-btn" href={`/admin/thu-muc/${encodeURIComponent(f.slug)}`}>
                        Mở
                      </Link>
                      <button className="link-btn" type="button" onClick={() => setEditing(f)}>
                        Sửa
                      </button>
                      <button
                        className="link-btn danger"
                        type="button"
                        onClick={() => {
                          if (confirm(`Xóa thư mục "${f.name}"?`)) run(() => del({ token, id: f._id }), "Đã xóa thư mục.");
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <FolderForm folder={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function FolderForm({ folder, onClose }: { folder: Folder | null; onClose: () => void }) {
  const { token, toast } = useAdmin();
  const save = useMutation(api.admin.saveFolder);
  const [name, setName] = useState(folder?.name ?? "");
  const [badge, setBadge] = useState(folder?.badge ?? "");
  const [detail, setDetail] = useState(folder?.detail ?? "");
  const [slug, setSlug] = useState(folder?.slug ?? "");
  const [err, setErr] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save({ token, id: folder?._id as Id<"folders"> | undefined, name, badge, detail, slug });
      toast(folder ? "Đã lưu thư mục." : "Đã thêm thư mục.");
      onClose();
    } catch (e2) {
      setErr(errMsg(e2));
    }
  }

  return (
    <Modal title={folder ? "Sửa thư mục" : "Thêm thư mục"} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="row-2">
          <div className="field">
            <label htmlFor="f-name">Tên thư mục</label>
            <input className="input" id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Global Success 10" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="f-badge">
              Nhãn <span className="hint">(1–3 ký tự)</span>
            </label>
            <input className="input" id="f-badge" value={badge} maxLength={3} onChange={(e) => setBadge(e.target.value)} placeholder="10" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="f-detail">Mô tả ngắn</label>
          <input className="input" id="f-detail" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Tài liệu và bài luyện tập lớp 10" />
        </div>
        <div className="field">
          <label htmlFor="f-slug">
            Mã thư mục (đường link) <span className="hint">{folder ? "— không đổi được sau khi tạo" : "(để trống sẽ tự tạo từ tên)"}</span>
          </label>
          <input className="input mono" id="f-slug" value={slug} disabled={!!folder} onChange={(e) => setSlug(e.target.value)} placeholder={slugify(name) || "gs10"} />
        </div>
        <p className="alert alert-bad" role="alert" hidden={!err}>
          {err}
        </p>
        <div className="modal-foot">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" type="submit">
            Lưu
          </button>
        </div>
      </form>
    </Modal>
  );
}
