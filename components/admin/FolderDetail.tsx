"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { noMarks } from "@/convex/model";
import { examTime } from "@/components/site/parts";
import { downloadXlsx } from "@/lib/excel";
import { Modal, useAdmin, useRun } from "./AdminShell";
import { BulkForm, StudentForm } from "./Students";

type Detail = NonNullable<FunctionReturnType<typeof api.admin.folderDetail>>;
type Quiz = Detail["quizzes"][number];

/** One folder: its quizzes (show/hide in one click), resources, and the students who can see it. */
export default function FolderDetail({ slug }: { slug: string }) {
  const { token } = useAdmin();
  const run = useRun();
  const data = useQuery(api.admin.folderDetail, { token, slug });
  const setPublished = useMutation(api.admin.setQuizPublished);
  const setResourceHidden = useMutation(api.admin.setResourceHidden);
  const setFolders = useMutation(api.admin.setStudentsFolders);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<"pick" | "new" | "import" | null>(null);

  if (data === undefined) return <p className="empty">Đang tải…</p>;
  if (data === null)
    return (
      <section className="panel">
        <p className="empty">Không tìm thấy thư mục này.</p>
        <Link className="btn btn-ghost btn-sm" href="/admin/thu-muc">
          ← Về danh sách thư mục
        </Link>
      </section>
    );

  const { folder, quizzes, resources, students } = data;
  const hidden = quizzes.filter((x) => !x.published);
  const needle = noMarks(q).toLowerCase().trim();
  const list = students.filter((s) => !needle || noMarks(`${s.name} ${s.code} ${s.className}`).toLowerCase().includes(needle));

  function show(x: Quiz) {
    if (x.exam && !confirm(`“${x.title}” là bài thi tập trung. Học sinh sẽ thấy bài (mờ) nhưng chỉ làm được khi đến giờ mở đề. Hiện bài?`)) return;
    run(() => setPublished({ token, id: x._id, published: true }), `Học sinh đã thấy “${x.title}”.`);
  }

  function hide(x: Quiz) {
    if (!confirm(`Ẩn “${x.title}”? Học sinh sẽ không thấy bài này nữa (kết quả đã nộp vẫn giữ nguyên).`)) return;
    run(() => setPublished({ token, id: x._id, published: false }), `Đã ẩn “${x.title}”.`);
  }

  async function showAll() {
    if (!confirm(`Hiện cả ${hidden.length} bài đang ẩn cho học sinh?`)) return;
    await run(async () => {
      for (const x of hidden) await setPublished({ token, id: x._id, published: true });
    }, `Đã hiện ${hidden.length} bài.`);
  }

  function exportList() {
    downloadXlsx(
      `hoc-sinh-${folder.slug}.xlsx`,
      ["Họ tên", "Lớp", "Mã học sinh", "Mã phụ huynh", `Bài đã làm (/${quizzes.length})`, "Trạng thái"],
      list.map((s) => [s.name, s.className, s.code, s.parentCode, s.done, s.active ? "Đang mở" : "Đã khóa"]),
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="toolbar">
          <div>
            <p className="eyebrow">
              <Link href="/admin/thu-muc">← Thư mục</Link>
            </p>
            <h2>
              <span className="tag">{folder.badge}</span> {folder.name}
            </h2>
            <p className="small muted">
              {folder.detail ? `${folder.detail} · ` : ""}
              <code>{folder.slug}</code> · {quizzes.length} bài làm{hidden.length ? ` (${hidden.length} đang ẩn)` : ""} · {resources.length} tài liệu · {students.length} học sinh
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h2>Bài làm</h2>
            <p className="small muted">Bài đang ẩn thì học sinh chưa thấy. Bấm “Hiện ngay” là các em thấy bài liền.</p>
          </div>
          <div className="actions">
            {hidden.length > 1 && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={showAll}>
                Hiện tất cả bài đang ẩn ({hidden.length})
              </button>
            )}
            <Link className="btn btn-primary btn-sm" href={`/admin/bai-lam/moi?thu-muc=${encodeURIComponent(folder.slug)}`}>
              + Soạn bài mới
            </Link>
          </div>
        </div>
        {!quizzes.length ? (
          <p className="empty">Thư mục chưa có bài làm nào.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bài</th>
                  <th className="num">Số câu</th>
                  <th>Trạng thái</th>
                  <th className="num">Đã làm</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quizzes.map((x) => (
                  <tr key={x._id}>
                    <td>
                      <Link href={`/admin/bai-lam/${x._id}`}>
                        <b>{x.title}</b>
                      </Link>
                      <span className="sub">
                        {x.subtitle}
                        {x.subtitle && x.ielts ? " · " : ""}
                        {x.ielts ? `IELTS ${x.ielts[0].toUpperCase() + x.ielts.slice(1)}` : ""}
                      </span>
                    </td>
                    <td className="num">{x.questionCount}</td>
                    <td>
                      {x.published ? <span className="status on">Đang hiện</span> : <span className="status draft">Đang ẩn</span>}
                      {x.exam && (
                        <span className="sub">
                          🎯 Thi ·{" "}
                          {x.exam.phase === "open" ? "đang mở" : x.exam.phase === "ended" ? "đã đóng" : x.exam.opensAt ? `mở ${examTime(x.exam.opensAt)}` : "chưa mở"}
                          {x.exam.releasedAt ? " · đã công bố" : ""}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {x.studentCount ? <Link href={`/admin/ket-qua?quiz=${x._id}`}>{x.studentCount} em</Link> : 0}
                      {x.attemptCount > x.studentCount && <span className="sub">{x.attemptCount} lượt nộp</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {x.published ? (
                          <button className="link-btn" type="button" onClick={() => hide(x)}>
                            Ẩn đi
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" type="button" onClick={() => show(x)}>
                            👁 Hiện ngay
                          </button>
                        )}
                        <Link className="link-btn" href={`/admin/bai-lam/${x._id}`}>
                          Sửa
                        </Link>
                        <a className="link-btn" href={`/bai/${x.slug}`} target="_blank" rel="noopener noreferrer">
                          Xem trước
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resources.length > 0 && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h2>Tài liệu</h2>
              <p className="small muted">PDF, MP3 và liên kết trong thư mục này.</p>
            </div>
            <Link className="btn btn-ghost btn-sm" href="/admin/tai-lieu">
              Quản lý tài liệu
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {resources.map((r) => (
                  <tr key={r._id} className={r.hidden ? "is-off" : ""}>
                    <td>
                      {r.audio ? "🎧 " : ""}
                      <b>{r.title}</b>
                    </td>
                    <td>{r.hidden ? <span className="status draft">Đang ẩn</span> : <span className="status on">Đang hiện</span>}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className={r.hidden ? "btn btn-primary btn-sm" : "link-btn"}
                          type="button"
                          onClick={() => run(() => setResourceHidden({ token, id: r._id, hidden: !r.hidden }), r.hidden ? `Học sinh đã thấy “${r.title}”.` : `Đã ẩn “${r.title}”.`)}
                        >
                          {r.hidden ? "👁 Hiện ngay" : "Ẩn đi"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h2>Học sinh thấy thư mục này</h2>
            <p className="small muted">Các em trong danh sách này đăng nhập là thấy bài và tài liệu đang hiện của thư mục.</p>
          </div>
          <div className="actions">
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setModal("import")}>
              Import Excel
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setModal("pick")}>
              + Thêm học sinh
            </button>
          </div>
        </div>
        <div className="toolbar">
          <div className="filters">
            <input className="input" type="search" placeholder="Tìm tên, mã, lớp…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm học sinh" />
          </div>
          <div className="actions">
            <span className="count-chip">{list.length} em</span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={exportList} disabled={!list.length}>
              Tải Excel
            </button>
          </div>
        </div>
        {!students.length ? (
          <p className="empty">Chưa có học sinh nào thấy thư mục này. Bấm “+ Thêm học sinh” hoặc “Import Excel”.</p>
        ) : !list.length ? (
          <p className="empty">Không có học sinh khớp “{q}”.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Họ tên</th>
                  <th>Lớp</th>
                  <th>Mã</th>
                  <th>Mã phụ huynh</th>
                  <th className="num">Bài đã làm</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s._id} className={s.active ? "" : "is-off"}>
                    <td>
                      <b>{s.name}</b>
                      {!s.active && <span className="sub">Mã đang khóa</span>}
                    </td>
                    <td>{s.className}</td>
                    <td>
                      <code>{s.code}</code>
                    </td>
                    <td>{s.parentCode ? <code>{s.parentCode}</code> : <span className="muted tiny">Chưa có</span>}</td>
                    <td className="num">
                      {s.done ? <Link href={`/admin/ket-qua?student=${s._id}`}>{s.done}</Link> : 0}/{quizzes.length}
                    </td>
                    <td>
                      {s.allFolders ? (
                        <span className="muted tiny" title="Em được mở tất cả thư mục. Đổi ở trang Học sinh.">
                          Mở tất cả thư mục
                        </span>
                      ) : (
                        <button
                          className="link-btn danger"
                          type="button"
                          onClick={() => {
                            if (confirm(`Bỏ ${s.name} khỏi thư mục “${folder.name}”? Em sẽ không thấy bài của thư mục này nữa (kết quả đã nộp vẫn giữ).`))
                              run(() => setFolders({ token, ids: [s._id], folder: folder.slug, add: false }), `Đã bỏ ${s.name} khỏi thư mục.`);
                          }}
                        >
                          Bỏ khỏi thư mục
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && <StudentModals kind={modal} folder={folder} inside={new Set(students.map((s) => s._id))} setKind={setModal} />}
    </div>
  );
}

/** "Thêm học sinh" (tick students who already have codes, or create one) and "Import Excel". */
function StudentModals({
  kind,
  folder,
  inside,
  setKind,
}: {
  kind: "pick" | "new" | "import";
  folder: Detail["folder"];
  inside: Set<Id<"students">>;
  setKind: (k: "pick" | "new" | "import" | null) => void;
}) {
  const { token } = useAdmin();
  const students = useQuery(api.admin.students, { token });
  const folders = useQuery(api.admin.folders, { token });
  const classes = useMemo(() => [...new Set((students ?? []).map((s) => s.className))].sort((a, b) => a.localeCompare(b, "vi")), [students]);
  const close = () => setKind(null);

  if (!students || !folders)
    return (
      <Modal title="Thêm học sinh" onClose={close}>
        <p className="empty">Đang tải…</p>
      </Modal>
    );
  if (kind === "new") return <StudentForm student={null} folders={folders} classes={classes} presetFolders={[folder.slug]} onClose={close} />;
  if (kind === "import") return <BulkForm folders={folders} classes={classes} students={students} intoFolder={{ slug: folder.slug, name: folder.name }} onClose={close} />;
  return <PickStudents folder={folder} students={students.filter((s) => !inside.has(s._id))} classes={classes} onNew={() => setKind("new")} onClose={close} />;
}

function PickStudents({
  folder,
  students,
  classes,
  onNew,
  onClose,
}: {
  folder: Detail["folder"];
  students: FunctionReturnType<typeof api.admin.students>;
  classes: string[];
  onNew: () => void;
  onClose: () => void;
}) {
  const { token } = useAdmin();
  const run = useRun();
  const setFolders = useMutation(api.admin.setStudentsFolders);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [picked, setPicked] = useState<Set<Id<"students">>>(new Set());
  const needle = noMarks(q).toLowerCase().trim();
  const list = students.filter((s) => (!cls || s.className === cls) && (!needle || noMarks(`${s.name} ${s.code} ${s.className}`).toLowerCase().includes(needle)));
  const allPicked = list.length > 0 && list.every((s) => picked.has(s._id));

  function toggle(id: Id<"students">) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const ok = await run(async () => {
      await setFolders({ token, ids: [...picked], folder: folder.slug, add: true });
      return true;
    }, `Đã mở “${folder.name}” cho ${picked.size} em.`);
    if (ok) onClose();
  }

  return (
    <Modal title={`Thêm học sinh vào “${folder.name}”`} onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">
          Tick các em đã có mã để mở thư mục này. Em chưa có tài khoản thì bấm{" "}
          <button className="link-btn" type="button" onClick={onNew}>
            + Tạo học sinh mới
          </button>
          .
        </p>
        <div className="toolbar">
          <div className="filters">
            <input className="input" type="search" placeholder="Tìm tên, mã…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm học sinh" autoFocus />
            <select className="select" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Lọc theo lớp">
              <option value="">Tất cả lớp</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!list.length ? (
          <p className="empty">{students.length ? "Không có học sinh khớp." : "Mọi học sinh đều đã thấy thư mục này."}</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả"
                      checked={allPicked}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          for (const s of list) {
                            if (allPicked) next.delete(s._id);
                            else next.add(s._id);
                          }
                          return next;
                        })
                      }
                    />
                  </th>
                  <th>Họ tên</th>
                  <th>Lớp</th>
                  <th>Mã</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s._id} className={s.active ? "" : "is-off"} onClick={() => toggle(s._id)} style={{ cursor: "pointer" }}>
                    <td>
                      <input type="checkbox" aria-label={`Chọn ${s.name}`} checked={picked.has(s._id)} onChange={() => toggle(s._id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td>
                      <b>{s.name}</b>
                    </td>
                    <td>{s.className}</td>
                    <td>
                      <code>{s.code}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-foot">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" type="button" disabled={!picked.size} onClick={save}>
            Mở thư mục cho {picked.size} em
          </button>
        </div>
      </div>
    </Modal>
  );
}
