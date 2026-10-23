"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { lastTwoWords, nameKey, noMarks, normCode, parentCodeFor, parseStudentLines, phoneCode } from "@/convex/model";
import { downloadXlsx, readClassList, rowsFrom, type ClassListRow, type SheetTable } from "@/lib/excel";
import { copyText, errMsg, stamp } from "@/lib/ui";
import { Modal, useAdmin, useRun } from "./AdminShell";

type Student = FunctionReturnType<typeof api.admin.students>[number];
type Folder = FunctionReturnType<typeof api.admin.folders>[number];

export default function Students() {
  const { token, toast } = useAdmin();
  const run = useRun();
  const students = useQuery(api.admin.students, { token });
  const folders = useQuery(api.admin.folders, { token });
  const regen = useMutation(api.admin.regenerateCode);
  const fillParents = useMutation(api.stats.fillParentCodes);
  const unlock = useMutation(api.guard.unlock);
  const lockedOut = (students ?? []).filter((s) => !s.active && s.lockedReason).length;
  // Parent code = student code with "ph" before the last 4 digits; flags any that are out of step.
  const missingParent = (students ?? []).filter((s) => s.parentCode !== parentCodeFor(s.code)).length;
  const del = useMutation(api.admin.deleteStudent);
  const setFolders = useMutation(api.admin.setStudentsFolders);

  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [folder, setFolder] = useState("");
  const [status, setStatus] = useState<"" | "on" | "off">("");
  const [selected, setSelected] = useState<Set<Id<"students">>>(new Set());
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [bulk, setBulk] = useState(false);
  const [bulkFolder, setBulkFolder] = useState("");

  const classes = useMemo(() => [...new Set((students ?? []).map((s) => s.className))].sort((a, b) => a.localeCompare(b, "vi")), [students]);
  const folderName = useMemo(() => new Map((folders ?? []).map((f) => [f.slug, f.name])), [folders]);

  const list = (students ?? []).filter((s) => {
    const needle = noMarks(q).toLowerCase().trim();
    if (needle && !noMarks(`${s.name} ${s.code} ${s.className}`).toLowerCase().includes(needle)) return false;
    if (cls && s.className !== cls) return false;
    if (folder && !(s.folders.includes(folder) || s.folders.includes("*"))) return false;
    if (status === "on" && !s.active) return false;
    if (status === "off" && s.active) return false;
    return true;
  });
  const allSelected = list.length > 0 && list.every((s) => selected.has(s._id));

  function toggle(id: Id<"students">) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportList() {
    downloadXlsx(
      `hoc-sinh${cls ? "-" + cls : ""}.xlsx`,
      ["Họ tên", "Lớp", "Mã học sinh", "Mã phụ huynh", "Thư mục", "Trạng thái"],
      list.map((s) => [s.name, s.className, s.code, s.parentCode, s.folders.map((f) => (f === "*" ? "Tất cả" : folderName.get(f) ?? f)).join("; "), s.active ? "Đang mở" : "Đã khóa"]),
    );
  }

  function copyCodes() {
    const text = list
      .filter((s) => s.active)
      .map((s) => `${s.name} (${s.className}): ${s.code}${s.parentCode ? ` · phụ huynh: ${s.parentCode}` : ""}`)
      .join("\n");
    copyText(text, () => toast(`Đã sao chép mã của ${list.filter((s) => s.active).length} học sinh.`), () => toast("Trình duyệt chặn sao chép. Dùng nút Tải Excel."));
  }

  async function bulkFolderAction(add: boolean) {
    if (!bulkFolder || !selected.size) return;
    await run(() => setFolders({ token, ids: [...selected], folder: bulkFolder, add }), add ? "Đã mở thư mục cho các em đã chọn." : "Đã bỏ thư mục khỏi các em đã chọn.");
  }

  return (
    <section className="panel">
      <div className="toolbar">
        <div>
          <p className="eyebrow">Mã truy cập</p>
          <h2>Học sinh</h2>
          <p className="small muted">Mỗi em một mã cá nhân. Khóa mã hoặc đổi mã sẽ đăng xuất em đó trên mọi thiết bị.</p>
        </div>
        <div className="actions">
          {missingParent > 0 && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(() => fillParents({ token }), "Đã cập nhật mã phụ huynh.")}>
              Cập nhật mã phụ huynh ({missingParent} em)
            </button>
          )}
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setBulk(true)} disabled={!folders}>
            Thêm nhiều học sinh
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing("new")} disabled={!folders}>
            + Thêm học sinh
          </button>
        </div>
      </div>

      {lockedOut > 0 && (
        <p className="alert alert-warn">
          🚪 {lockedOut} học sinh đang bị khoá vì rời khỏi bài có giám sát.{" "}
          <button className="link-btn" type="button" onClick={() => setStatus("off")}>
            Xem danh sách
          </button>{" "}
          rồi bấm “🔓 Mở khoá” khi muốn cho em làm tiếp.
        </p>
      )}

      <div className="toolbar">
        <div className="filters">
          <input className="input" type="search" placeholder="Tìm tên, mã, lớp…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm học sinh" />
          <select className="select" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Lọc theo thư mục">
            <option value="">Mọi thư mục</option>
            {folders?.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name}
              </option>
            ))}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as "" | "on" | "off")} aria-label="Lọc theo trạng thái">
            <option value="">Mọi trạng thái</option>
            <option value="on">Đang mở</option>
            <option value="off">Đã khóa</option>
          </select>
        </div>
        <div className="actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={copyCodes} disabled={!list.length}>
            Sao chép mã
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={exportList} disabled={!list.length}>
            Tải Excel
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="toolbar alert alert-good">
          <span>Đã chọn {selected.size} học sinh</span>
          <div className="filters" style={{ flex: "0 1 auto" }}>
            <select className="select compact" value={bulkFolder} onChange={(e) => setBulkFolder(e.target.value)} aria-label="Thư mục">
              <option value="">Chọn thư mục…</option>
              {folders?.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" type="button" disabled={!bulkFolder} onClick={() => bulkFolderAction(true)}>
              Mở thư mục
            </button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={!bulkFolder} onClick={() => bulkFolderAction(false)}>
              Bỏ thư mục
            </button>
            <button className="link-btn" type="button" onClick={() => setSelected(new Set())}>
              Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {!students ? (
        <p className="empty">Đang tải…</p>
      ) : !list.length ? (
        <p className="empty">{students.length ? "Không có học sinh khớp bộ lọc." : "Chưa có học sinh nào. Bấm “Thêm nhiều học sinh” để dán danh sách lớp."}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((s) => s._id)))}
                  />
                </th>
                <th>Họ tên</th>
                <th>Lớp</th>
                <th>Mã</th>
                <th title="Mã học sinh, thêm “ph” trước 4 số cuối">Mã phụ huynh</th>
                <th>Thư mục</th>
                <th className="num">Bài đã nộp</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s._id} className={s.active ? "" : "is-off"}>
                  <td>
                    <input type="checkbox" aria-label={`Chọn ${s.name}`} checked={selected.has(s._id)} onChange={() => toggle(s._id)} />
                  </td>
                  <td>
                    <b>{s.name}</b>
                    {s.note && <span className="sub">{s.note}</span>}
                  </td>
                  <td>{s.className}</td>
                  <td>
                    <code>{s.code}</code>
                  </td>
                  <td>
                    {s.parentCode ? <code>{s.parentCode}</code> : <span className="muted tiny">Chưa có</span>}
                  </td>
                  <td>
                    {s.folders.length ? (
                      s.folders.map((f) => (
                        <span key={f} className="tag">
                          {f === "*" ? "Tất cả" : folderName.get(f) ?? f}
                        </span>
                      ))
                    ) : (
                      <span className="muted tiny">Chưa mở</span>
                    )}
                  </td>
                  <td className="num">
                    {s.attemptCount ? <Link href={`/admin/ket-qua?student=${s._id}`}>{s.attemptCount}</Link> : 0}
                    {s.lastAttemptAt && <span className="sub">{stamp(s.lastAttemptAt)}</span>}
                  </td>
                  <td>
                    {s.active ? <span className="status on">Đang mở</span> : <span className="status off">Đã khóa</span>}
                    {!s.active && s.lockedReason && (
                      <>
                        <span className="sub">
                          🚪 {s.lockedReason}
                          {s.lockedAt ? ` · ${stamp(s.lockedAt)}` : ""}
                        </span>
                        <button className="link-btn" type="button" style={{ display: "block" }} onClick={() => run(() => unlock({ token, id: s._id }), `Đã mở khoá cho ${s.name}.`)}>
                          🔓 Mở khoá
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="link-btn" type="button" onClick={() => setEditing(s)}>
                        Sửa
                      </button>
                      <button
                        className="link-btn"
                        type="button"
                        onClick={async () => {
                          if (!confirm(`Tạo mã mới cho ${s.name}? Mã cũ "${s.code}" và mã phụ huynh "${s.parentCode ?? ""}" sẽ không dùng được nữa.`)) return;
                          const code = await run(() => regen({ token, id: s._id }));
                          if (code) toast(`Mã mới của ${s.name}: ${code} · phụ huynh: ${parentCodeFor(code)}`);
                        }}
                      >
                        Đổi mã
                      </button>
                      <button
                        className="link-btn danger"
                        type="button"
                        onClick={() => {
                          if (confirm(`Xóa học sinh ${s.name} và toàn bộ kết quả bài làm của em?`)) run(() => del({ token, id: s._id }), "Đã xóa học sinh.");
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

      {editing && folders && <StudentForm student={editing === "new" ? null : editing} folders={folders} classes={classes} onClose={() => setEditing(null)} />}
      {bulk && folders && students && <BulkForm folders={folders} classes={classes} students={students} onClose={() => setBulk(false)} />}
    </section>
  );
}

function FolderChecks({ folders, value, onChange }: { folders: Folder[]; value: string[]; onChange: (v: string[]) => void }) {
  const all = value.includes("*");
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 700, fontSize: ".92rem", marginBottom: 8 }}>Thư mục được mở</legend>
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : ["*"])} />
          Tất cả thư mục
        </label>
        {folders.map((f) => (
          <label className="check" key={f.slug}>
            <input
              type="checkbox"
              disabled={all}
              checked={all || value.includes(f.slug)}
              onChange={(e) => onChange(e.target.checked ? [...value, f.slug] : value.filter((x) => x !== f.slug))}
            />
            {f.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StudentForm({
  student,
  folders,
  classes,
  presetFolders = [],
  onClose,
}: {
  student: Student | null;
  folders: Folder[];
  classes: string[];
  presetFolders?: string[];
  onClose: () => void;
}) {
  const { token, toast } = useAdmin();
  const save = useMutation(api.admin.saveStudent);
  const [name, setName] = useState(student?.name ?? "");
  const [className, setClassName] = useState(student?.className ?? "");
  const [code, setCode] = useState(student?.code ?? "");
  const [picked, setPicked] = useState<string[]>(student?.folders ?? presetFolders);
  const [active, setActive] = useState(student?.active ?? true);
  const [note, setNote] = useState(student?.note ?? "");
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked.length && !confirm("Học sinh chưa được mở thư mục nào. Vẫn lưu?")) return;
    try {
      const r = await save({ token, id: student?._id, name, className, code, folders: picked, active, note });
      if (student) {
        toast("Đã lưu học sinh.");
        onClose();
      } else setCreated(r.code);
    } catch (e2) {
      setErr(errMsg(e2));
    }
  }

  if (created)
    return (
      <Modal title="Đã tạo học sinh" onClose={onClose}>
        <p>
          Mã cá nhân của <b>{name}</b> ({className}):
        </p>
        <p className="secret">{created}</p>
        <p className="small muted">Gửi mã này cho em. Em vào trang chủ, nhập mã là thấy bài được giao.</p>
        <div className="modal-foot">
          <button className="btn btn-ghost" type="button" onClick={() => copyText(created, () => toast("Đã sao chép mã."), () => {})}>
            Sao chép mã
          </button>
          <button className="btn btn-primary" type="button" onClick={onClose}>
            Xong
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal title={student ? "Sửa học sinh" : "Thêm học sinh"} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="row-2">
          <div className="field">
            <label htmlFor="s-name">Họ và tên</label>
            <input className="input" id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn Bình" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="s-class">Lớp</label>
            <input className="input" id="s-class" list="class-list" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="8A2" />
            <datalist id="class-list">
              {classes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="row-2">
          <div className="field">
            <label htmlFor="s-code">
              Mã cá nhân <span className="hint">{student ? "" : "(để trống sẽ tự tạo)"}</span>
            </label>
            <input className="input mono" id="s-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="binh4821" autoCapitalize="off" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="s-note">
              Ghi chú <span className="hint">(chỉ giáo viên thấy)</span>
            </label>
            <input className="input" id="s-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="SĐT phụ huynh, ca học…" />
          </div>
        </div>
        <FolderChecks folders={folders} value={picked} onChange={setPicked} />
        <label className="switch">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Mã đang mở (bỏ chọn để khóa, em sẽ không đăng nhập được)
        </label>
        <p className="alert alert-bad" role="alert" hidden={!err}>
          {err}
        </p>
        <div className="modal-foot">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" type="submit">
            {student ? "Lưu" : "Tạo mã"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type CodeMode = "random" | "lastTwo" | "file";
type Preview = ClassListRow & { newCode: string | null; status: "ok" | "noclass" | "dup" | "exists" | "taken" | "badcode" | "add" | "inside" | "many"; note: string };
type NewStudent = { name: string; className: string; code: string; parentCode: string };
type BulkDone = { created: NewStudent[]; added?: NewStudent[]; already?: NewStudent[]; skipped: { name: string; className: string; reason: string }[] };

const STATUS_LABEL: Record<Preview["status"], string> = {
  ok: "Sẵn sàng",
  noclass: "Thiếu lớp",
  dup: "Trùng trong danh sách",
  exists: "Đã có học sinh này",
  taken: "Mã đã được dùng",
  badcode: "Mã không hợp lệ",
  add: "Đã có tài khoản → mở thư mục",
  inside: "Đã có trong thư mục",
  many: "Nhiều em cùng tên, thêm tay",
};

/**
 * Paste a class list or upload an Excel file; preview every row before creating codes.
 * With `intoFolder` (the folder page), a name that already has an account just gets that folder opened.
 */
export function BulkForm({
  folders,
  classes,
  students,
  intoFolder,
  onClose,
}: {
  folders: Folder[];
  classes: string[];
  students: Student[];
  intoFolder?: { slug: string; name: string };
  onClose: () => void;
}) {
  const { token, toast } = useAdmin();
  const create = useMutation(api.admin.bulkCreateStudents);
  const importTo = useMutation(api.admin.importToFolder);
  const [source, setSource] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<SheetTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [className, setClassName] = useState("");
  const [mode, setMode] = useState<CodeMode>("lastTwo");
  const [picked, setPicked] = useState<string[]>(intoFolder ? [intoFolder.slug] : []);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BulkDone | null>(null);

  const raw: ClassListRow[] =
    source === "file"
      ? (sheet ? rowsFrom(sheet) : []).map((r) => ({ ...r, className: r.className || className.trim() }))
      : parseStudentLines(text, className).map((r) => ({ ...r, code: "" }));
  const hasPhones = raw.some((r) => r.phone.replace(/\D/g, "").length >= 4);
  const hasCodes = raw.some((r) => normCode(r.code));
  // Fall back when the chosen way of making codes no longer fits the data.
  const effectiveMode: CodeMode = mode === "file" && !hasCodes ? "lastTwo" : mode;

  // Work out every row's fate before anything is created.
  const existing = new Set(students.map((s) => `${noMarks(s.name).toLowerCase()}|${s.className.toLowerCase()}`));
  const usedCodes = new Set(students.map((s) => s.code));
  const byName = new Map<string, Student[]>();
  if (intoFolder) for (const s of students) byName.set(nameKey(s.name), [...(byName.get(nameKey(s.name)) ?? []), s]);
  const seen = new Set<string>();
  const preview: Preview[] = raw.map((r) => {
    const key = intoFolder ? nameKey(r.name) : `${noMarks(r.name).toLowerCase()}|${r.className.toLowerCase()}`;
    const same = intoFolder ? byName.get(key) ?? [] : [];
    if (intoFolder && !seen.has(key) && same.length) {
      seen.add(key);
      const s = same[0];
      const status = same.length > 1 ? "many" : s.folders.includes(intoFolder.slug) || s.folders.includes("*") ? "inside" : "add";
      return { ...r, className: same.length > 1 ? r.className : s.className, newCode: same.length > 1 ? null : s.code, status, note: "" };
    }
    const code = effectiveMode === "lastTwo" ? phoneCode(r.name, r.phone) : effectiveMode === "file" ? normCode(r.code) || null : null;
    let status: Preview["status"] = "ok";
    if (!r.className) status = "noclass";
    else if (code && !/^[a-z0-9._-]{4,40}$/.test(code)) status = "badcode";
    else if (seen.has(key) || (code && seen.has(`code:${code}`))) status = "dup";
    else if (existing.has(key)) status = "exists";
    else if (code && usedCodes.has(code)) status = "taken";
    seen.add(key);
    if (code) seen.add(`code:${code}`);
    const note = effectiveMode === "file" && !code ? "Thiếu mã → tạo mới" : "";
    return { ...r, newCode: code, status, note };
  });
  const ready = preview.filter((p) => p.status === "ok" || p.status === "add");
  const fresh = preview.filter((p) => p.status === "ok").length;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErr("");
    setReading(true);
    try {
      const t = await readClassList(file);
      setSheet(t);
      setFileName(file.name);
      setMode(t.cols.code >= 0 ? "file" : "lastTwo");
    } catch (e) {
      setSheet(null);
      setErr(e instanceof Error ? e.message : "Không đọc được file Excel.");
    } finally {
      setReading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!raw.length) return setErr(source === "file" ? "Chọn file Excel danh sách lớp." : "Dán danh sách học sinh, mỗi dòng một em.");
    if (!ready.length) return setErr("Không còn dòng nào hợp lệ để tạo mã. Xem cột Trạng thái bên dưới.");
    if (!picked.length) return setErr("Chọn ít nhất một thư mục.");
    setBusy(true);
    // Rows already in the folder go along too, so the summary can count them.
    const rows = (intoFolder ? preview.filter((p) => p.status === "inside") : []).concat(ready).map((p) => ({
      name: p.name,
      className: p.className,
      ...(p.status === "add" || p.status === "inside" ? {} : p.newCode ? { code: p.newCode } : effectiveMode === "lastTwo" ? { style: "lastTwo" as const } : {}),
    }));
    try {
      setDone(intoFolder ? await importTo({ token, folder: intoFolder.slug, rows }) : await create({ token, rows, folders: picked }));
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const added = done.added ?? [];
    const already = done.already ?? [];
    const line = (s: NewStudent) => `${s.name} (${s.className}): ${s.code} · phụ huynh: ${s.parentCode}`;
    const out = [...done.created.map(line), ...(added.length ? ["", "Đã có tài khoản, vừa mở thư mục:", ...added.map(line)] : [])].join("\n").trim();
    const title = intoFolder
      ? `Đã thêm ${done.created.length + added.length} em vào “${intoFolder.name}”`
      : `Đã tạo ${done.created.length} học sinh`;
    return (
      <Modal title={title} onClose={onClose} wide>
        {intoFolder && (
          <p className="small">
            {done.created.length} em mới được tạo tài khoản · {added.length} em đã có tài khoản, vừa được mở thư mục
            {already.length ? ` · ${already.length} em đã có sẵn trong thư mục` : ""}.
          </p>
        )}
        {out && <textarea className="textarea" readOnly value={out} rows={Math.min(12, done.created.length + added.length + (added.length ? 3 : 1))} onFocus={(e) => e.currentTarget.select()} />}
        {done.skipped.length > 0 && (
          <div className="alert alert-bad">
            Bỏ qua {done.skipped.length} dòng:
            {"\n"}
            {done.skipped.map((s) => `• ${s.name || "(trống)"} (${s.className || "?"}): ${s.reason}`).join("\n")}
          </div>
        )}
        <div className="modal-foot">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={!out}
            onClick={() =>
              intoFolder
                ? downloadXlsx(
                    `ma-hoc-sinh-${intoFolder.slug}.xlsx`,
                    ["Họ tên", "Lớp", "Mã cá nhân", "Mã phụ huynh", "Ghi chú"],
                    [...done.created.map((s) => [s.name, s.className, s.code, s.parentCode, "Mới tạo"]), ...added.map((s) => [s.name, s.className, s.code, s.parentCode, "Đã có tài khoản"])],
                  )
                : downloadXlsx(
                    "ma-hoc-sinh-moi.xlsx",
                    ["Họ tên", "Lớp", "Mã cá nhân", "Mã phụ huynh"],
                    done.created.map((s) => [s.name, s.className, s.code, s.parentCode]),
                  )
            }
          >
            Tải file Excel
          </button>
          <button className="btn btn-ghost" type="button" disabled={!out} onClick={() => copyText(out, () => toast("Đã sao chép danh sách mã."), () => {})}>
            Sao chép
          </button>
          <button className="btn btn-primary" type="button" onClick={onClose}>
            Xong
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={intoFolder ? `Import học sinh vào “${intoFolder.name}”` : "Thêm nhiều học sinh"} onClose={onClose} wide>
      {intoFolder && (
        <p className="small muted">
          Em nào trùng họ và tên với học sinh đã có tài khoản thì chỉ được mở thêm thư mục này, giữ nguyên mã cũ. Tên mới thì hệ thống tạo tài khoản mới.
        </p>
      )}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="checks" role="radiogroup" aria-label="Nguồn danh sách">
          <label className="check">
            <input type="radio" name="bulk-src" checked={source === "file"} onChange={() => setSource("file")} />
            Tải file Excel (.xlsx)
          </label>
          <label className="check">
            <input type="radio" name="bulk-src" checked={source === "paste"} onChange={() => setSource("paste")} />
            Dán danh sách
          </label>
        </div>

        {source === "file" ? (
          <div className="field">
            <label htmlFor="b-file">
              File danh sách lớp <span className="hint">— cần cột “Họ và tên”; nên có “Lớp” và “Số điện thoại”. File chỉ được đọc trên máy này.</span>
            </label>
            <input className="input" id="b-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])} />
            {reading && <span className="tiny muted">Đang đọc file…</span>}
            {sheet && (
              <>
                <span className="tiny muted">
                  {fileName} · trang “{sheet.sheet}” · {raw.length} học sinh · cột tên: <b>{[sheet.headers[sheet.cols.name], sheet.cols.nameLast >= 0 ? sheet.headers[sheet.cols.nameLast] : ""].filter(Boolean).join(" + ")}</b>
                  {sheet.cols.className >= 0 ? <> · cột lớp: <b>{sheet.headers[sheet.cols.className]}</b></> : " · không có cột lớp"}
                </span>
                <div className="row-2">
                  <ColumnPick
                    id="b-col-code"
                    label="Cột mã có sẵn"
                    headers={sheet.headers}
                    value={sheet.cols.code}
                    onChange={(code) => {
                      setSheet({ ...sheet, cols: { ...sheet.cols, code } });
                      if (code >= 0) setMode("file");
                    }}
                  />
                  <ColumnPick
                    id="b-col-phone"
                    label="Cột số điện thoại"
                    headers={sheet.headers}
                    value={sheet.cols.phone}
                    onChange={(phone) => {
                      setSheet({ ...sheet, cols: { ...sheet.cols, phone } });
                      if (phone >= 0 && sheet.cols.code < 0) setMode("lastTwo");
                    }}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="b-list">
              Danh sách <span className="hint">— mỗi dòng một em: “Họ tên”, “Họ tên, Lớp” hoặc “Họ tên, Lớp, SĐT” (copy các cột từ Excel cũng được)</span>
            </label>
            <textarea className="textarea prose" id="b-list" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Nguyễn Văn Bình, 8A2\nTrần Thị Mai, 8A2\nLê Hoàng Nam"} autoFocus />
          </div>
        )}

        <div className="field">
            <label htmlFor="b-class">
              Lớp chung <span className="hint">(cho dòng không ghi lớp)</span>
            </label>
            <input className="input" id="b-class" list="class-list-bulk" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="8A2" />
            <datalist id="class-list-bulk">
              {classes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 700, fontSize: ".92rem", marginBottom: 8 }}>Cách tạo mã</legend>
          <div className="mode-picks">
            {(
              [
                ["file", "Giữ mã có sẵn trong file", "Dùng đúng mã ở cột mã của file (ví dụ mã đã cấp từ hệ thống cũ).", hasCodes, "File chưa có cột mã. Chọn cột ở ô “Cột mã có sẵn” phía trên nếu có."],
                [
                  "lastTwo",
                  "Tên lót + tên + 4 số",
                  hasPhones
                    ? "Em có SĐT lấy 4 số cuối SĐT (Trần Bảo An, …4821 → baoan4821); em không có SĐT thì 4 số ngẫu nhiên."
                    : "Ví dụ: Trần Bảo An → baoan + 4 số ngẫu nhiên. Có cột SĐT thì sẽ dùng 4 số cuối SĐT.",
                  true,
                  "",
                ],
                ["random", "Tên + 4 số ngẫu nhiên", "Ví dụ: Trần Bảo An → an7305.", true, ""],
              ] as [CodeMode, string, string, boolean, string][]
            ).map(([value, title, desc, enabled, why]) => (
              <label key={value} className={`mode-pick${effectiveMode === value ? " on" : ""}${enabled ? "" : " off"}`}>
                <input type="radio" name="b-mode" value={value} checked={effectiveMode === value} disabled={!enabled} onChange={() => setMode(value)} />
                <span>
                  <b>{title}</b>
                  <span className="tiny muted">{enabled ? desc : why}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {!intoFolder && <FolderChecks folders={folders} value={picked} onChange={setPicked} />}

        {preview.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Họ tên</th>
                  <th>Lớp</th>
                  {effectiveMode === "lastTwo" && hasPhones && <th>SĐT</th>}
                  <th>Mã</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} className={p.status === "ok" || p.status === "add" ? "" : "is-off"}>
                    <td>{i + 1}</td>
                    <td>{p.name}</td>
                    <td>{p.className || "—"}</td>
                    {effectiveMode === "lastTwo" && hasPhones && <td className="mono">{p.phone.replace(/\D/g, "").length >= 4 ? `•••${p.phone.replace(/\D/g, "").slice(-4)}` : "—"}</td>}
                    <td>
                      {p.newCode ? (
                        <code>{p.newCode}</code>
                      ) : effectiveMode === "lastTwo" ? (
                        <>
                          <code>{lastTwoWords(p.name) || "hs"}</code> <span className="muted tiny">+ 4 số ngẫu nhiên</span>
                        </>
                      ) : (
                        <span className="muted tiny">tự tạo</span>
                      )}
                      {p.note && <span className="sub">{p.note}</span>}
                    </td>
                    <td>
                      {p.status === "ok" ? (
                        <span className="status on">{intoFolder ? "Tạo mới" : "Sẵn sàng"}</span>
                      ) : p.status === "add" ? (
                        <span className="status on">{STATUS_LABEL.add}</span>
                      ) : (
                        <span className="status off">{STATUS_LABEL[p.status]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="alert alert-bad" role="alert" hidden={!err}>
          {err}
        </p>
        <div className="modal-foot">
          <span className="small muted" style={{ marginRight: "auto", alignSelf: "center" }}>
            {preview.length
              ? intoFolder
                ? `${fresh} em mới · ${ready.length - fresh} em đã có tài khoản · ${preview.length - ready.length} dòng bỏ qua`
                : `${ready.length}/${preview.length} dòng sẵn sàng`
              : ""}
          </span>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || reading}>
            {busy ? "Đang tạo mã…" : intoFolder ? `Thêm ${ready.length} em vào thư mục` : `Tạo mã cho ${ready.length} em`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Lets the teacher fix which spreadsheet column holds a value when detection guessed wrong. */
function ColumnPick({ id, label, headers, value, onChange }: { id: string; label: string; headers: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select className="select compact" id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={-1}>Không có</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );
}
