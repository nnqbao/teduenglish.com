"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { parseDialogue, parseStudentLines } from "@/convex/model";
import { Rich, sget, sset } from "@/lib/ui";
import { Swoosh } from "@/components/site/parts";
import { useAdmin } from "./AdminShell";
import RichInput from "./RichInput";

/* ---------- small building blocks ---------- */

const ICONS = {
  key: "M2.6 17.4A2 2 0 0 0 2 18.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.2a2 2 0 0 0 1.4-.6l.8-.8a6.5 6.5 0 1 0-4-4Z M16.5 7.5h.01",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.75",
  pencil: "M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Zm9.5-13.5 4 4",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.07-.4.1-.8.1-1.2Z",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h2",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.5-13a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01",
  check: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
};
type IconName = keyof typeof ICONS;

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function Pin({ n }: { n: number }) {
  return (
    <span className="pin" aria-label={`Bước ${n}`}>
      {n}
    </span>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="g-steps">
      {items.map((x, i) => (
        <li key={i}>
          <Pin n={i + 1} />
          <div>{x}</div>
        </li>
      ))}
    </ol>
  );
}

function Note({ kind, children }: { kind: "tip" | "warn" | "owner" | "info"; children: React.ReactNode }) {
  const icon = { tip: "💡", warn: "⚠️", owner: "🔑", info: "ℹ️" }[kind];
  return (
    <div className={`g-note ${kind}`}>
      <i aria-hidden="true">{icon}</i>
      <div>{children}</div>
    </div>
  );
}

function Mock({ title, children, caption }: { title: string; children: React.ReactNode; caption?: string }) {
  return (
    <figure className="mock">
      <div className="mock-bar">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      <div className="mock-body">{children}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function Section({ id, icon, title, lead, children }: { id: string; icon: IconName; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className="g-sec" id={id}>
      <header>
        <span className="ic">
          <Icon name={icon} size={26} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{lead}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div>
      <Link className="btn btn-ghost btn-sm" href={href}>
        {children} →
      </Link>
    </div>
  );
}

const TOC: [string, IconName, string][] = [
  ["tai-khoan", "key", "Đăng nhập & mật khẩu"],
  ["thu-muc", "folder", "Thư mục bài học"],
  ["hoc-sinh", "users", "Học sinh & mã"],
  ["bai-lam", "pencil", "Soạn bài làm"],
  ["tai-lieu", "file", "Tài liệu & PDF"],
  ["ket-qua", "chart", "Xem kết quả"],
  ["cai-dat", "gear", "Cài đặt & tài khoản"],
  ["hoc-sinh-thay-gi", "phone", "Học sinh thấy gì"],
  ["hoi-dap", "help", "Hỏi đáp nhanh"],
  ["checklist", "check", "Việc cần làm"],
];

/* ---------- page ---------- */

export default function Guide() {
  const { me } = useAdmin();
  const [active, setActive] = useState(TOC[0][0]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    TOC.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <div className="guide">
      <section className="banner view-enter">
        <Swoosh />
        <p className="eyebrow">Hướng dẫn sử dụng</p>
        <h1>Dạy cùng TEDU English trong 5 phút</h1>
        <p>
          Chào {me.name}! Trang này chỉ thầy cô từng bước: tạo mã cho học sinh, soạn bài chấm tự động, gửi tài liệu PDF và xem điểm cả lớp. Mọi thay đổi trong khu vực giáo viên hiện ngay
          trên máy của học sinh, không cần tải lại gì cả.
        </p>
        <div className="banner-meta">
          <span>Đọc khoảng 8 phút</span>
          <span>Có khu vực thử trực tiếp</span>
          <span>Dùng tốt trên điện thoại</span>
        </div>
      </section>

      <div className="g-flow">
        {(
          [
            ["thu-muc", "folder", "Tạo thư mục", "Mỗi khối lớp, khóa học là một thư mục."],
            ["hoc-sinh", "users", "Thêm học sinh", "Dán danh sách lớp, hệ thống tự tạo mã."],
            ["bai-lam", "pencil", "Giao bài", "Soạn bài trắc nghiệm, tải PDF, dán link."],
            ["ket-qua", "chart", "Xem kết quả", "Điểm tự về, lọc theo lớp, tải Excel."],
          ] as [string, IconName, string, string][]
        ).map(([id, icon, title, d], i) => (
          <a key={id} href={`#${id}`}>
            <span className="num">{i + 1}</span>
            <span className="ic">
              <Icon name={icon} />
            </span>
            <b>{title}</b>
            <span className="d">{d}</span>
            <span className="go">Xem cách làm ↓</span>
          </a>
        ))}
      </div>

      <div className="g-layout">
        <nav className="g-toc" aria-label="Mục lục hướng dẫn">
          {TOC.map(([id, icon, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? "on" : undefined}>
              <i>
                <Icon name={icon} size={16} />
              </i>
              {label}
            </a>
          ))}
        </nav>

        <div className="g-main">
          {/* ---------------- account ---------------- */}
          <Section id="tai-khoan" icon="key" title="Đăng nhập & mật khẩu" lead="Mỗi thầy cô có một tài khoản riêng để biết ai đã sửa gì và giữ an toàn cho dữ liệu lớp.">
            <div className="g-split">
              <Steps
                items={[
                  <>
                    Vào <span className="g-code">teduenglish.com/admin</span> (hoặc bấm <b>Khu vực giáo viên</b> ở cuối trang chủ).
                  </>,
                  <>Nhập email và mật khẩu được cấp.</>,
                  <>
                    Lần đầu đăng nhập, hệ thống yêu cầu <b>đặt mật khẩu mới</b> (ít nhất 8 ký tự, có cả chữ và số).
                  </>,
                  <>
                    Đổi mật khẩu sau này ở <b>Cài đặt &amp; tài khoản → Đổi mật khẩu</b>.
                  </>,
                ]}
              />
              <Mock title="teduenglish.com/admin">
                <span className="m-label">Email</span>
                <div className="m-row">
                  <div className="m-input">co.lan@teduenglish.com</div>
                  <Pin n={2} />
                </div>
                <span className="m-label">Mật khẩu</span>
                <div className="m-row">
                  <div className="m-input focus">••••••••••</div>
                </div>
                <span className="m-btn primary block">Đăng nhập</span>
              </Mock>
            </div>
            <Note kind="warn">
              Nhập sai mật khẩu <b>5 lần</b> thì tài khoản bị tạm khóa <b>15 phút</b> để chống dò mật khẩu. Quên mật khẩu? Nhờ <b>quản trị chính</b> bấm “Cấp lại mật khẩu” để nhận mật
              khẩu tạm.
            </Note>
          </Section>

          {/* ---------------- folders ---------------- */}
          <Section id="thu-muc" icon="folder" title="Thư mục bài học" lead="Thư mục giống những ngăn kéo: mỗi khối lớp hoặc khóa học một ngăn. Học sinh chỉ thấy ngăn được mở cho mình.">
            <div className="g-split">
              <div className="stack">
                <Steps
                  items={[
                    <>
                      Vào <b>Thư mục</b> → bấm <span className="kbd">+ Thêm thư mục</span>.
                    </>,
                    <>
                      Điền <b>tên</b> (ví dụ “Global Success 10”), <b>nhãn</b> 1–3 ký tự hiện trong ô vuông màu (ví dụ “10”) và một dòng mô tả.
                    </>,
                    <>
                      Dùng mũi tên <span className="kbd">↑</span> <span className="kbd">↓</span> để sắp thứ tự hiển thị trên trang học sinh.
                    </>,
                  ]}
                />
                <Note kind="info">Đã có sẵn 9 thư mục: Global Success 6–12, Chuyên Anh và IELTS. Thầy cô có thể dùng ngay hoặc đổi tên.</Note>
              </div>
              <Mock title="Thư mục">
                {[
                  ["8", "Global Success 8", "2 bài · 2 tài liệu · 14 học sinh"],
                  ["9", "Global Success 9", "1 bài · 1 tài liệu · 22 học sinh"],
                  ["IE", "IELTS", "2 bài · 3 tài liệu · 9 học sinh"],
                ].map(([b, n, d], i) => (
                  <div className="m-row" key={n}>
                    <span className="m-tag" style={{ flex: "none", fontSize: ".8rem", padding: "4px 8px" }}>
                      {b}
                    </span>
                    <div>
                      <b>{n}</b>
                      <div className="tiny muted">{d}</div>
                    </div>
                    {i === 0 && <Pin n={3} />}
                  </div>
                ))}
              </Mock>
            </div>
            <Note kind="warn">Thư mục còn bài làm hoặc tài liệu thì không xóa được. Hãy chuyển hoặc xóa chúng trước.</Note>
            <Go href="/admin/thu-muc">Mở trang Thư mục</Go>
          </Section>

          {/* ---------------- students ---------------- */}
          <Section id="hoc-sinh" icon="users" title="Học sinh & mã cá nhân" lead="Mỗi em có một mã riêng để vào học, không cần email hay mật khẩu. Mã quyết định em thấy những thư mục nào.">
            <h3>Thêm cả lớp một lần</h3>
            <Note kind="tip">
              Có sẵn file Excel danh sách lớp? Chọn <b>Tải file Excel (.xlsx)</b>: hệ thống tự tìm cột <b>Họ và tên</b>, <b>Lớp</b>, <b>Số điện thoại</b> (kể cả file tách cột “Họ” và
              “Tên”), hiện bảng xem trước, đánh dấu dòng trùng hoặc thiếu lớp. File đã có cột mã (từ hệ thống cũ) thì chọn <b>Giữ mã có sẵn trong file</b>. Hoặc tạo mã kiểu{" "}
              <span className="m-code">tên lót + tên + 4 số</span>: em có SĐT thì lấy 4 số cuối (“Trần Bảo An”, …4821 → <span className="m-code">baoan4821</span>), em không có SĐT thì 4 số
              ngẫu nhiên. File chỉ được đọc trên máy thầy cô; số điện thoại không được lưu lên hệ thống. Xong thì bấm{" "}
              <b>Tải file Excel</b> để có danh sách mã.
            </Note>
            <div className="g-split">
              <Steps
                items={[
                  <>
                    Vào <b>Học sinh</b> → <span className="kbd">Thêm nhiều học sinh</span>.
                  </>,
                  <>
                    Chọn <b>Tải file Excel</b>, hoặc <b>Dán danh sách</b> mỗi dòng một em (ghi <span className="g-code">Họ tên, Lớp</span> hoặc copy 2 cột từ Excel).
                  </>,
                  <>
                    Dòng nào không ghi lớp sẽ dùng <b>Lớp chung</b>.
                  </>,
                  <>
                    Tick các <b>thư mục được mở</b> rồi bấm <b>Tạo mã</b>. Hệ thống tạo mã dạng <span className="m-code">binh4821</span> (tên + 4 số).
                  </>,
                  <>
                    Kiểm tra bảng xem trước, rồi bấm <b>Tải file Excel</b> hoặc <b>Sao chép</b> để gửi mã cho từng em (qua Zalo, giấy phát tay…).
                  </>,
                ]}
              />
              <div className="stack" style={{ gap: 10 }}>
                <Mock title="Học sinh → Thêm nhiều học sinh">
                  <span className="m-label">Danh sách</span>
                  <div className="m-row">
                    <div className="m-area">{"Nguyễn Văn Bình, 8A2\nTrần Thị Mai, 8A2\nLê Hoàng Nam"}</div>
                    <Pin n={2} />
                  </div>
                  <div className="m-row">
                    <div className="m-input">Lớp chung: 8A2</div>
                    <Pin n={3} />
                  </div>
                  <div className="m-row">
                    <div className="m-chips">
                      <span className="m-chip on">✓ Global Success 8</span>
                      <span className="m-chip">IELTS</span>
                    </div>
                    <Pin n={4} />
                  </div>
                  <span className="m-btn primary">Tạo mã cho 3 em</span>
                </Mock>
                <div className="m-arrow" aria-hidden="true">
                  ↓
                </div>
                <Mock title="Đã tạo 3 học sinh">
                  {[
                    ["Nguyễn Văn Bình", "binh4821"],
                    ["Trần Thị Mai", "mai7305"],
                    ["Lê Hoàng Nam", "nam1962"],
                  ].map(([n, c]) => (
                    <div className="m-row" key={c}>
                      <span>{n} (8A2)</span>
                      <span className="m-code" style={{ flex: "none" }}>
                        {c}
                      </span>
                    </div>
                  ))}
                </Mock>
              </div>
            </div>
            <BulkPlayground />

            <h3>Việc hằng ngày với mã học sinh</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thầy cô muốn…</th>
                    <th>Làm thế này</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Em quên mã</td>
                    <td>Gõ tên em vào ô tìm kiếm, mã hiện ngay trong cột “Mã”.</td>
                  </tr>
                  <tr>
                    <td>Mã bị lộ, có bạn khác dùng ké</td>
                    <td>
                      Bấm <b>Đổi mã</b>. Mã cũ hết hiệu lực và em bị đăng xuất trên mọi máy.
                    </td>
                  </tr>
                  <tr>
                    <td>Em nghỉ học hoặc chưa đóng học phí</td>
                    <td>
                      Bấm <b>Sửa</b> → bỏ chọn “Mã đang mở”. Điểm cũ vẫn được giữ, mở lại bất cứ lúc nào.
                    </td>
                  </tr>
                  <tr>
                    <td>Mở thêm thư mục cho cả lớp</td>
                    <td>
                      Lọc theo lớp → tick ô đầu bảng để chọn tất cả → chọn thư mục → <b>Mở thư mục</b>.
                    </td>
                  </tr>
                  <tr>
                    <td>Ghi chú số phụ huynh, ca học</td>
                    <td>
                      Ô <b>Ghi chú</b> khi sửa học sinh. Chỉ giáo viên nhìn thấy.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Note kind="tip">
              Mã không phân biệt chữ hoa/thường và bỏ qua khoảng trắng: <span className="m-code">BINH 4821</span> cũng đăng nhập được như <span className="m-code">binh4821</span>.
            </Note>
            <Go href="/admin/hoc-sinh">Mở trang Học sinh</Go>
          </Section>

          {/* ---------------- quizzes ---------------- */}
          <Section id="bai-lam" icon="pencil" title="Soạn bài làm trên web" lead="Học sinh làm ngay trên điện thoại, nộp là có điểm, đáp án và giải thích. Đáp án nằm trên máy chủ nên em không xem trộm được.">
            <div className="g-split">
              <div className="stack">
                <Steps
                  items={[
                    <>
                      Vào <b>Bài làm trên web</b> → <span className="kbd">+ Soạn bài mới</span>.
                    </>,
                    <>
                      Đặt <b>tên bài</b>, chọn <b>thư mục</b>, thời gian gợi ý.
                    </>,
                    <>
                      Với mỗi câu trắc nghiệm: gõ câu hỏi, gõ các lựa chọn, bấm <b>nút tròn</b> cạnh đáp án đúng (chuyển màu xanh).
                    </>,
                    <>
                      Ghi <b>giải thích</b> để em hiểu vì sao sai. Phần này chỉ hiện sau khi nộp. Cần ảnh (biểu đồ, tranh)? Bấm <b>+ Thêm ảnh minh hoạ</b> ở câu đó.
                    </>,
                    <>
                      Bấm <span className="kbd">Lưu bài</span> rồi <b>Xem trước như học sinh</b> để làm thử. Chế độ xem trước không cần mã học sinh, xem được cả bản nháp và không lưu điểm.
                    </>,
                  ]}
                />
              </div>
              <Mock title="Soạn bài → Phần 1 → Câu 1">
                <div className="m-row">
                  <div className="m-input">I don&apos;t mind ___ my mum with the housework.</div>
                  <Pin n={3} />
                </div>
                {["help", "to help", "helping", "helped"].map((o, i) => (
                  <div className={`m-opt${i === 2 ? " right" : ""}`} key={o}>
                    <span className="dot" />
                    <span className="l">{"ABCD"[i]}</span>
                    <span>{o}</span>
                    {i === 2 && <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--good)" }}>✓ đáp án đúng</span>}
                  </div>
                ))}
                <div className="m-row">
                  <div className="m-input">Giải thích: don&apos;t mind + V-ing</div>
                  <Pin n={4} />
                </div>
              </Mock>
            </div>

            <h3>Các dạng câu hỏi</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Dạng</th>
                    <th>Dùng cho</th>
                    <th>Cách nhập</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <b>Trắc nghiệm</b>
                    </td>
                    <td>Ngữ pháp, từ vựng, phát âm, trọng âm</td>
                    <td>2–6 lựa chọn, chọn 1 đáp án đúng. Có nút tạo nhanh True / False / Not Given.</td>
                  </tr>
                  <tr>
                    <td>
                      <b>Điền từ / viết lại câu</b>
                    </td>
                    <td>Word form, viết lại câu, điền chỗ trống IELTS</td>
                    <td>
                      Mỗi dòng một cách viết đúng, ví dụ <span className="g-code">6.5</span> và <span className="g-code">six point five</span>. Không phân biệt hoa/thường, dấu chấm cuối câu.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Bài viết</b>
                    </td>
                    <td>IELTS Writing Task 1 &amp; 2, viết đoạn, viết thư</td>
                    <td>
                      Đề bài, số từ tối thiểu, gợi ý, ảnh biểu đồ (nếu có). Học sinh viết ngay trên web, có đếm từ; thầy cô <b>nhận xét và chấm band</b> ở trang Kết quả. Nút{" "}
                      <b>Dùng mẫu IELTS Writing</b> tạo sẵn Task 1 (150 từ) và Task 2 (250 từ).
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Nói (thu âm)</b>
                    </td>
                    <td>IELTS Speaking Part 1, 2, 3</td>
                    <td>
                      Nút <b>🎤 Dùng mẫu IELTS Speaking</b> tạo sẵn cả 3 phần. Mỗi câu có thời gian trả lời (Part 1 ≈ 30 giây, Part 3 ≈ 45 giây) và thời gian suy nghĩ (thẻ đề Part 2: 60
                      giây chuẩn bị, 2 phút nói). Học sinh kiểm tra micro, chuẩn bị 15 hoặc 30 giây, rồi máy tự đọc từng câu, kêu “tít” và thu âm. Thầy cô nghe lại ở trang Kết quả và chấm
                      band 4 tiêu chí Speaking. Ô <b>“Speaking: cách làm bài”</b> cho học sinh chọn <b>Luyện tập</b> (tự ghi âm từng câu, nghe lại, ghi lại, có
                      bản chép lời tự động và phiếu tự đánh giá 4 tiêu chí) hoặc <b>Thi thử</b> (máy đọc câu hỏi, tính giờ). Học sinh vào nhanh qua trang
                      <b> Luyện nói</b> (/speaking). File ghi âm được đổi sang MP3. Ghi âm tự xoá sau 5 ngày nên thầy cô nhớ chấm trong thời gian này;
                      điểm, bản chép lời và nhận xét vẫn giữ.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Phần nghe</b>
                    </td>
                    <td>Listening, hội thoại</td>
                    <td>
                      Chọn dạng phần “Nghe”, rồi <b>🎧 Thêm file MP3</b> (bài nghe thầy cô có sẵn, tối đa 40 MB) hoặc gõ lời thoại để máy đọc bằng giọng tiếng Anh, mỗi nhân vật một giọng. Có file MP3 thì học sinh nghe file; lời thoại khi đó chỉ để em xem sau khi nộp.
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <b>Phần đọc hiểu</b>
                    </td>
                    <td>Reading, đoạn văn dài</td>
                    <td>Chọn dạng phần “Đọc hiểu”. Dòng đầu là tiêu đề, bài đọc hiện cạnh câu hỏi.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <FormatPlayground />
            <ListenPlayground />

            <h3>Tùy chọn hữu ích</h3>
            <div className="g-split">
              <ul className="g-steps">
                <li>
                  <span className="pin">🔒</span>
                  <div>
                    <b>Mã bài</b>: bài kiểm tra trên lớp? Đặt mã như <span className="m-code">TS10</span>, đến giờ mới đọc mã cho cả lớp. Em nhập mã một lần là mở được bài đó.
                  </div>
                </li>
                <li>
                  <span className="pin">★</span>
                  <div>
                    <b>Nổi bật</b>: bài được đưa lên đầu trang học sinh với nút “Vào làm bài” to rõ.
                  </div>
                </li>
                <li>
                  <span className="pin">👁</span>
                  <div>
                    <b>Hiện cho học sinh</b>: bỏ chọn để giữ bài ở dạng <b>bản nháp</b>, soạn dần rồi mới giao.
                  </div>
                </li>
                <li>
                  <span className="pin">⏱</span>
                  <div>
                    <b>Đếm giờ</b>: học sinh thấy đồng hồ đếm ngược theo số phút của bài. Chọn “hết giờ tự nộp” cho bài kiểm tra, hoặc “hết giờ nhắc nộp” cho bài luyện. Trang Kết quả ghi
                    thời gian làm của từng em.
                  </div>
                </li>
                <li>
                  <span className="pin">🇬🇧</span>
                  <div>
                    <b>Giọng đọc</b>: chọn giọng Anh (UK) hoặc Mỹ (US) cho phần nghe; học sinh cũng tự đổi được khi nghe.
                  </div>
                </li>
                <li>
                  <span className="pin">HK</span>
                  <div>
                    <b>Học kỳ</b>: gắn bài (và tài liệu) vào Học kỳ 1 hoặc Học kỳ 2, trang học sinh tự chia thành hai nhóm trong mỗi thư mục.
                  </div>
                </li>
                <li>
                  <span className="pin">IE</span>
                  <div>
                    <b>Band IELTS tham khảo</b>: quy đổi điểm sang band Listening/Reading (ước tính theo thang 40 câu).
                  </div>
                </li>
                <li>
                  <span className="pin">⧉</span>
                  <div>
                    <b>Nhân bản</b>: tạo đề 02 từ đề 01 rồi sửa vài câu, đỡ phải gõ lại.
                  </div>
                </li>
              </ul>
              <Note kind="tip">
                Có sẵn đề trong file <span className="g-code">data.js</span> cũ hoặc nhờ AI soạn? Bấm <b>Nhập / xuất JSON</b> trong trình soạn bài và dán vào. Hệ thống đọc được đúng định dạng
                cũ, thầy cô chỉ cần kiểm tra rồi bấm Lưu.
              </Note>
            </div>
            <Note kind="info">
              Học sinh được làm lại nhiều lần; khi bấm “Làm lại”, câu hỏi và lựa chọn được xáo trộn (trừ phần nghe và đọc). Mọi lượt nộp đều được lưu. Sửa đáp án sau khi học sinh đã làm thì điểm cũ
              giữ nguyên, các lượt sau chấm theo đáp án mới.
            </Note>
            <Go href="/admin/bai-lam">Mở trang Bài làm trên web</Go>
          </Section>

          {/* ---------------- resources ---------------- */}
          <Section id="tai-lieu" icon="file" title="Tài liệu & file PDF" lead="Gửi phiếu bài tập, đề in, sách PDF hoặc link Quizlet, Wordwall, YouTube vào đúng thư mục cho học sinh.">
            <div className="g-split">
              <div className="stack">
                <Steps
                  items={[
                    <>
                      Vào <b>Tài liệu &amp; liên kết</b> → <span className="kbd">+ Thêm tài liệu</span>.
                    </>,
                    <>
                      Chọn <b>Tải file PDF lên</b> (tối đa 50 MB), <b>Tải file MP3 lên</b> (bài nghe, tối đa 40 MB; học sinh bấm ▶ nghe ngay trong danh sách) hoặc <b>Dán đường link</b>.
                    </>,
                    <>Chọn thư mục, đặt tên (tên file được điền sẵn), thêm mô tả nếu cần.</>,
                    <>
                      Bấm <b>Lưu</b> và chờ thanh tải lên chạy đến 100%. Chưa muốn giao ngay? Tick <b>Tạm ẩn</b>, hoặc bấm <b>Ẩn / Hiện</b> trong danh sách bất cứ lúc nào.
                    </>,
                  ]}
                />
                <Note kind="tip">
                  Học sinh bấm <b>Xem</b> thì màn hình chia đôi: <b>PDF bên phải</b>, trang học tập thu nhỏ <b>bên trái</b>. Em vừa xem đề vừa làm bài trên web được. Trên điện thoại, PDF
                  mở toàn màn hình. Nút <b>Tải về</b> giữ nguyên tên file.
                </Note>
              </div>
              <Mock title="Học sinh xem PDF trên máy tính" caption="Bên trái: trang học tập dạng điện thoại · Bên phải: tài liệu (3/4 màn hình)">
                <div className="m-split" aria-hidden="true">
                  <div className="l">
                    <span style={{ width: "70%" }} />
                    <span className="card" />
                    <span className="card on" />
                    <span className="card" />
                    <span style={{ width: "50%" }} />
                  </div>
                  <div className="r">
                    <div className="tb">
                      <span />
                      <span className="p" />
                      <span />
                    </div>
                    <div className="page">
                      <span className="h" />
                      <span />
                      <span />
                      <span style={{ width: "80%" }} />
                      <span />
                      <span style={{ width: "65%" }} />
                    </div>
                  </div>
                </div>
              </Mock>
            </div>
            <Note kind="warn">
              Chỉ học sinh được mở thư mục đó mới thấy file. Tuy vậy nếu một em chia sẻ đường link file cho người ngoài thì người đó vẫn mở được, nên đừng tải lên tài liệu cần bảo mật tuyệt đối.
            </Note>
            <Go href="/admin/tai-lieu">Mở trang Tài liệu &amp; liên kết</Go>
          </Section>

          {/* ---------------- results ---------------- */}
          <Section id="ket-qua" icon="chart" title="Xem kết quả" lead="Không cần học sinh chụp màn hình gửi Zalo: mỗi lần nộp bài, điểm tự về đây.">
            <div className="g-split">
              <Steps
                items={[
                  <>
                    Vào <b>Kết quả</b>. Mỗi dòng là một lượt nộp, mới nhất ở trên.
                  </>,
                  <>
                    Lọc theo <b>bài</b>, <b>lớp</b> hoặc <b>học sinh</b>. Bật <b>Chỉ lần cao nhất</b> để mỗi em chỉ còn một dòng.
                  </>,
                  <>
                    Bấm <b>Chi tiết</b> để xem em chọn gì ở từng câu, câu nào sai, câu nào bỏ trống.
                  </>,
                  <>
                    Bấm <b>Tải Excel</b> để mở bằng Excel hoặc Google Sheets, nhập vào sổ điểm.
                  </>,
                ]}
              />
              <Mock title="Kết quả · lọc: lớp 8A2 · chỉ lần cao nhất">
                <table className="m-table">
                  <thead>
                    <tr>
                      <th>Học sinh</th>
                      <th>Điểm</th>
                      <th>Tỉ lệ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Trần Thị Mai", 12, 12],
                      ["Nguyễn Văn Bình", 10, 12],
                      ["Lê Hoàng Nam", 7, 12],
                    ].map(([n, c, t]) => (
                      <tr key={n as string}>
                        <td>{n}</td>
                        <td>
                          <b>
                            {c}/{t}
                          </b>
                        </td>
                        <td>
                          <div className="m-bar">
                            <i style={{ width: `${((c as number) / (t as number)) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="m-row">
                  <span className="m-btn" style={{ flex: "none" }}>
                    Chi tiết
                  </span>
                  <Pin n={3} />
                  <span className="m-btn" style={{ flex: "none", marginLeft: "auto" }}>
                    Tải Excel
                  </span>
                  <Pin n={4} />
                </div>
              </Mock>
            </div>
            <h3>Chấm bài viết</h3>
            <div className="g-split">
              <Steps
                items={[
                  <>
                    Khi có bài viết mới, trang <b>Tổng quan</b> báo “✍️ … bài viết chờ nhận xét”. Bấm vào, hoặc ở <b>Kết quả</b> tick <b>Chỉ bài viết chờ nhận xét</b>.
                  </>,
                  <>
                    Bấm <b>Chấm bài viết</b>: xem đề, bài của em và số từ.
                  </>,
                  <>
                    Viết <b>nhận xét</b>. Có thể chấm một band, hoặc bật <b>4 tiêu chí IELTS</b> (TA, CC, LR, GRA) để hệ thống tự tính band tổng theo cách làm tròn của IELTS.
                  </>,
                  <>
                    Bấm <b>Lưu nhận xét &amp; trả bài</b>. Học sinh thấy nhận xét ngay ở đầu trang bài đó, và có thể sửa bài rồi nộp lại.
                  </>,
                ]}
              />
              <Mock title="Kết quả → Chấm bài viết">
                <div className="m-area">{"In conclusion, I believe that the benefits of studying abroad outweigh…"}</div>
                <span className="tiny muted">268 từ · yêu cầu tối thiểu 250</span>
                <div className="m-row">
                  <div className="m-area">Bài có quan điểm rõ ràng. Cần thêm ví dụ cụ thể ở đoạn 2…</div>
                  <Pin n={3} />
                </div>
                <div className="m-chips">
                  <span className="m-chip on">TA 6.5</span>
                  <span className="m-chip on">CC 6.0</span>
                  <span className="m-chip on">LR 6.5</span>
                  <span className="m-chip on">GRA 6.0</span>
                  <span className="m-chip">Band tổng 6.5</span>
                </div>
                <span className="m-btn primary">Lưu nhận xét &amp; trả bài</span>
              </Mock>
            </div>
            <Note kind="tip">
              Trang <b>Tổng quan</b> có ô “Bài vừa nộp” để thầy cô liếc nhanh mỗi ngày. Ở trang <b>Học sinh</b>, bấm vào số lượt nộp của một em để xem riêng điểm của em đó.
            </Note>
            <Go href="/admin/ket-qua">Mở trang Kết quả</Go>
          </Section>

          {/* ---------------- settings ---------------- */}
          <Section id="cai-dat" icon="gear" title="Cài đặt & tài khoản giáo viên" lead="Thông tin hiện trên trang học sinh và danh sách người được vào khu vực giáo viên.">
            <div className="g-split">
              <Steps
                items={[
                  <>
                    <b>Thông tin trung tâm</b>: tên, khẩu hiệu, cách gọi giáo viên (“thầy cô”, “cô Lan”…), dòng liên hệ cuối trang như Zalo lớp.
                  </>,
                  <>
                    <b>Mã dùng thử</b>: hiện một mã mẫu trên trang chủ để khách xem thử. <b>Nên tắt</b> khi đã dạy thật.
                  </>,
                  <>
                    <b>Tài khoản giáo viên</b>: thêm người, chọn vai trò. Người mới nhận <b>mật khẩu tạm</b> và phải đổi ở lần đầu đăng nhập.
                  </>,
                ]}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Được làm</th>
                      <th>Giáo viên</th>
                      <th>Quản trị chính</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Học sinh, thư mục, bài, tài liệu", "✓", "✓"],
                      ["Xem và xóa kết quả", "✓", "✓"],
                      ["Cài đặt trung tâm", "✓", "✓"],
                      ["Thêm / khóa / cấp lại mật khẩu cho giáo viên khác", "—", "✓"],
                    ].map(([a, b, c]) => (
                      <tr key={a}>
                        <td>{a}</td>
                        <td style={{ textAlign: "center" }}>{b}</td>
                        <td style={{ textAlign: "center" }}>{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {me.role === "owner" ? (
              <Note kind="owner">
                Thầy cô đang là <b>quản trị chính</b>. Mật khẩu tạm chỉ hiện <b>một lần</b> khi tạo hoặc cấp lại, hãy gửi ngay cho người nhận qua kênh riêng.
              </Note>
            ) : (
              <Note kind="owner">
                Thầy cô đang dùng vai trò <b>Giáo viên</b>. Cần thêm tài khoản hay quên mật khẩu, hãy nhờ quản trị chính.
              </Note>
            )}
            <Go href="/admin/cai-dat">Mở trang Cài đặt &amp; tài khoản</Go>
          </Section>

          {/* ---------------- student view ---------------- */}
          <Section id="hoc-sinh-thay-gi" icon="phone" title="Học sinh thấy gì?" lead="Để hướng dẫn các em ngày đầu: chỉ cần 3 bước, không cài app, mở bằng trình duyệt trên điện thoại.">
            <div className="g-phones">
              <div>
                <div className="phone">
                  <div className="phone-screen">
                    <div className="p-cover">
                      <b>Better English.</b>
                      <small>Mỗi em một mã, mở đúng bài được giao.</small>
                    </div>
                    <span className="m-label">Mã truy cập</span>
                    <div className="m-input focus">binh4821</div>
                    <span className="m-btn primary block">Vào khu vực học tập</span>
                  </div>
                </div>
                <p className="phone-cap">① Vào teduenglish.com, nhập mã</p>
              </div>
              <div>
                <div className="phone">
                  <div className="phone-screen">
                    <div className="p-cover">
                      <b>Xin chào, Bình!</b>
                      <small>Lớp 8A2 · Đã hoàn thành 1/3</small>
                    </div>
                    <b style={{ color: "var(--brand-ink)" }}>Global Success 8</b>
                    <div className="p-quiz done">
                      <span>Trắc nghiệm Unit 1–3</span>
                      <span>10/12</span>
                    </div>
                    <div className="p-quiz">
                      <span>Word Formation</span>
                      <span>8 câu →</span>
                    </div>
                    <div className="m-opt">
                      <span>📄 Worksheet Unit 4</span>
                      <span className="m-btn" style={{ marginLeft: "auto", padding: "4px 8px" }}>
                        Xem
                      </span>
                    </div>
                  </div>
                </div>
                <p className="phone-cap">② Chọn bài trong thư mục được giao</p>
              </div>
              <div>
                <div className="phone">
                  <div className="phone-screen">
                    <div className="p-dial">
                      <b>10/12</b>
                    </div>
                    <b style={{ textAlign: "center", color: "var(--brand-ink)", fontFamily: "var(--font-display)", fontSize: "1.1rem" }}>Excellent work!</b>
                    <div className="m-opt right">
                      <span className="l">C</span>
                      <span>helping</span>
                    </div>
                    <span className="tiny muted">Đáp án: helping · don&apos;t mind + V-ing</span>
                    <span className="m-btn primary block">Làm lại (xáo trộn câu hỏi)</span>
                  </div>
                </div>
                <p className="phone-cap">③ Nộp bài: có điểm, đáp án, giải thích</p>
              </div>
            </div>
            <Note kind="tip">
              Muốn xem đúng như học sinh? Mở trang chủ ở cửa sổ ẩn danh và đăng nhập bằng mã của một học sinh thử, hoặc bấm <b>Xem trước như học sinh</b> trong trình soạn bài (hoặc <b>Xem trước</b> ở danh sách bài).
            </Note>
          </Section>

          {/* ---------------- FAQ ---------------- */}
          <Section id="hoi-dap" icon="help" title="Hỏi đáp nhanh" lead="Những câu thầy cô hay hỏi nhất.">
            <div className="g-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>
                    <b>{q}</b>
                  </summary>
                  <div>{a}</div>
                </details>
              ))}
            </div>
          </Section>

          {/* ---------------- checklist ---------------- */}
          <Section id="checklist" icon="check" title="Việc cần làm trước buổi học đầu tiên" lead="Đánh dấu từng việc khi xong. Danh sách được nhớ trên máy này.">
            <Checklist />
          </Section>
        </div>
      </div>
    </div>
  );
}

const FAQ: [string, React.ReactNode][] = [
  ["Học sinh có xem trước được đáp án không?", "Không. Đáp án và giải thích chỉ nằm trên máy chủ. Sau khi bấm Nộp bài, em chỉ thấy đáp án của những câu em đã làm; câu bỏ trống vẫn ẩn đáp án (chế độ xem trước của giáo viên thì hiện hết)."],
  [
    "Phần nghe không phát được âm thanh?",
    <>
      Bài có file MP3 thì phát như nhạc bình thường. Bài dùng lời thoại thì âm thanh được đọc bằng giọng tiếng Anh có sẵn trên máy của em. Nhắc em: tăng âm lượng, tắt chế độ im lặng, dùng Chrome hoặc Safari bản mới. Điện thoại Android thiếu giọng tiếng
      Anh thì cài thêm “Google Text-to-Speech” (Speech Services by Google) trên Play Store.
    </>,
  ],
  [
    "Phụ huynh theo dõi con thế nào?",
    "Mã phụ huynh là mã học sinh thêm chữ “ph” trước 4 số cuối, ví dụ học sinh thanhtoan3580 thì phụ huynh là thanhtoanph3580 (cột “Mã phụ huynh” ở trang Học sinh, có trong file Excel tải về). Đổi mã học sinh thì mã phụ huynh tự đổi theo. Phụ huynh vào teduenglish.com/phu-huynh, nhập mã là xem được kết quả riêng của con: tiến độ, tỷ lệ hoàn thành, các bài chưa làm, điểm IELTS theo kỹ năng và điểm Global Success, cùng nhận xét bài viết. Phụ huynh không thấy bảng xếp hạng. Mã phụ huynh chỉ để xem, không làm bài được.",
  ],
  [
    "Xem bảng xếp hạng và chuyên cần ở đâu?",
    "Trang Thống kê: thẻ “Chuyên cần” (tỷ lệ bài đã làm / bài được giao, lọc theo lớp và thư mục) và thẻ “Xếp hạng IELTS” (lọc theo lớp, kỹ năng, từng bài; bật “Ẩn tên” khi chiếu cho cả lớp). Cả hai đều tải Excel được. Học sinh tự xem thứ hạng IELTS của mình trong lớp ở trang học tập (tên các bạn khác được ẩn); phụ huynh không thấy bảng này. Muốn bài Writing vào bảng xếp hạng: đặt bài trong thư mục IELTS hoặc chọn “IELTS Writing” ở ô Kỹ năng IELTS, và chấm band cho từng Task.",
  ],
  [
    "Học sinh làm chưa xong bài thì sao?",
    "Bài được tự động lưu lên máy chủ trong lúc em làm (câu đã chọn, bài viết, thời gian đã dùng). Lần sau đăng nhập, kể cả trên máy khác, trang học tập có mục “Bài em đang làm dở” với nút “Em vào làm tiếp nhé”; bài có đếm giờ chạy tiếp với số phút còn lại. Bài thường có thêm nút “💾 Lưu bài, lần sau làm tiếp”. Bài có chống chuyển tab vẫn tự lưu, nhưng rời trang bài (kể cả về trang học tập) vẫn bị tính là rời bài. Bài làm dở quá 60 ngày tự xoá.",
  ],
  [
    "Chống chuyển tab khi làm bài hoạt động thế nào?",
    "Bài IELTS Reading, IELTS Writing và bài có phần viết tự bật “🔒 Chống chuyển tab” (thầy cô bật/tắt từng bài trong trình soạn). Khi đang làm, nếu em chuyển tab, mở ứng dụng hay trình duyệt khác, hoặc rời trang bài: lần 1 chỉ nhắc nhở (tên tab nhấp nháy, kêu bíp); lần 2 đếm ngược 10 giây và lần 3 đếm ngược 5 giây để quay lại; quá giờ, hoặc rời bài lần 4, phần bài em đã làm được tự nộp (có nhãn “🚪 Tự nộp” ở trang Kết quả) và tài khoản bị khoá. Mở lại: trang Học sinh → “🔓 Mở khoá”. Lưu ý: hệ thống không biết em dùng thêm máy thứ hai, và cuộc gọi đến hay tắt màn hình điện thoại cũng bị tính là rời bài.",
  ],
  [
    "Vì sao có bài bị mờ đi, học sinh không bấm vào được?",
    "Bài trắc nghiệm, điền từ mà em làm đúng từ 80% trở lên sẽ tự khoá (mờ đi) để tránh cho bạn mượn tài khoản làm hộ hoặc chép đáp án. Đổi mức % hoặc tắt (đặt 0) ở Cài đặt & tài khoản. Muốn cho một em làm lại: vào Kết quả, bấm “🔓 Cho làm lại” ở dòng bài đó, điểm cũ vẫn giữ.",
  ],
  ["Em làm một bài nhiều lần thì tính điểm nào?", "Mọi lượt đều được lưu. Ở trang Kết quả, bật “Chỉ lần cao nhất” để xem điểm tốt nhất của mỗi em; tắt đi để xem cả quá trình."],
  ["Tôi muốn ẩn một bài tạm thời?", "Bài làm: mở bài, bỏ chọn “Hiện cho học sinh” rồi Lưu (thành bản nháp, điểm cũ vẫn còn). Tài liệu, PDF: bấm “Ẩn” trong danh sách, bấm “Hiện” để giao lại."],
  ["Gõ sai đáp án và đã có em làm rồi?", "Sửa đáp án rồi Lưu. Các lượt đã nộp giữ điểm cũ; nếu cần công bằng, hãy xóa các lượt đó ở trang Kết quả và nhờ các em làm lại."],
  ["Bài có mã riêng hoạt động thế nào?", "Mỗi em nhập mã bài một lần là mở được bài đó trên tài khoản của mình. Đổi mã bài không khóa lại những em đã mở trước đó."],
  ["File PDF quá 50 MB?", "Nén file trước khi tải lên (ví dụ dùng ilovepdf.com hoặc smallpdf.com → Compress), hoặc tách thành nhiều phần nhỏ theo Unit."],
  [
    "Học sinh xem nhận xét bài viết ở đâu?",
    "Ở chính trang bài đó: phần “Bài viết đã nộp” nằm trên đầu, có nhận xét, band và tên người chấm. Ngoài trang chủ, nút của bài hiện “Chờ nhận xét” hoặc “Có nhận xét ✓”. Bài viết đang làm dở được lưu nháp trên máy nên lỡ đóng trình duyệt cũng không mất.",
  ],
  ["Học sinh đổi điện thoại thì sao?", "Chỉ cần nhập lại mã trên máy mới. Điểm và bài đã làm vẫn còn vì được lưu trên máy chủ."],
  ["Nhiều thầy cô dùng chung một tài khoản được không?", "Được nhưng không nên. Quản trị chính có thể tạo tài khoản riêng cho từng người ở Cài đặt & tài khoản, vừa an toàn vừa dễ khóa khi có người nghỉ."],
];

/* ---------- interactive bits ---------- */

function BulkPlayground() {
  const [text, setText] = useState("Nguyễn Văn Bình, 8A2\nTrần Thị Mai\t8A2\nLê Hoàng Nam");
  const [cls, setCls] = useState("8A3");
  const rows = parseStudentLines(text, cls);
  return (
    <div className="g-play">
      <p className="eyebrow">Thử ngay: hệ thống đọc danh sách thế nào?</p>
      <div className="row-2">
        <div className="field">
          <label htmlFor="pg-list">Dán danh sách (không lưu gì cả)</label>
          <textarea className="textarea prose compact" id="pg-list" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pg-cls">Lớp chung</label>
          <input className="input compact" id="pg-cls" value={cls} onChange={(e) => setCls(e.target.value)} />
          <span className="tiny muted">Dòng nào thiếu lớp sẽ lấy lớp này.</span>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Họ tên</th>
              <th>Lớp</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td>{r.className || <span className="status off">Thiếu lớp</span>}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="muted">
                  Chưa có dòng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormatPlayground() {
  const [text, setText] = useState("Choose the word whose underlined part is pronounced differently: want[u]ed[/u] · [b]watch[/b][u]ed[/u] · I ___ English every day.");
  return (
    <div className="g-play">
      <p className="eyebrow">Thử ngay: định dạng chữ trong câu hỏi</p>
      <p className="small">
        <b>Bôi đen</b> chữ cần làm nổi bật rồi bấm nút <b>B</b> để <b>in đậm</b> hoặc <b>U</b> để <u>gạch chân</u> (câu phát âm). Bấm <b>___</b> để chèn chỗ trống. Dán chữ từ Word cũng giữ
        được in đậm và gạch chân.
      </p>
      <RichInput label="Câu hỏi thử" value={text} onChange={setText} />
      <div className="g-preview" aria-live="polite">
        <span className="tiny muted" style={{ display: "block", fontWeight: 700 }}>
          Học sinh sẽ thấy:
        </span>
        <Rich text={text} />
      </div>
    </div>
  );
}

function ListenPlayground() {
  const [text, setText] = useState("Receptionist: Good morning, Riverside Language Centre.\nCaller: Hi, I'd like to sign up for an evening course.\nReceptionist: Of course. Can I have your name?");
  const [playing, setPlaying] = useState(false);
  const lines = parseDialogue(text);
  const speakers = [...new Set(lines.map((l) => l.speaker).filter(Boolean))] as string[];

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function play() {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== "function") return alert("Trình duyệt này chưa hỗ trợ đọc audio.");
    synth.cancel();
    if (playing) return setPlaying(false);
    const voices = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    lines.forEach((l, i) => {
      const u = new window.SpeechSynthesisUtterance(l.text);
      const idx = l.speaker ? speakers.indexOf(l.speaker) : speakers.length;
      u.lang = "en-GB";
      u.rate = 0.9;
      if (voices.length) u.voice = voices[idx % voices.length];
      if (voices.length < 2) u.pitch = idx % 2 ? 1.15 : 0.92;
      if (i === lines.length - 1) u.onend = () => setPlaying(false);
      synth.speak(u);
    });
    setPlaying(true);
  }

  return (
    <div className="g-play">
      <p className="eyebrow">Thử ngay: viết lời thoại cho phần nghe</p>
      <p className="small">
        Mỗi dòng một câu, dạng <span className="g-code">Tên: lời nói</span> (tên viết không dấu). Mỗi nhân vật được đọc bằng một giọng khác nhau. Dòng không có tên là lời dẫn.
      </p>
      <textarea className="textarea prose compact" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Lời thoại thử" />
      <div className="g-lines" aria-live="polite">
        {lines.map((l, i) => (
          <div className="g-line" key={i}>
            <span className={`who ${l.speaker ? `s${speakers.indexOf(l.speaker) % 4}` : "n"}`}>{l.speaker ?? "lời dẫn"}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
      <div>
        <button className="btn btn-primary btn-sm" type="button" onClick={play} disabled={!lines.length}>
          {playing ? "■ Dừng" : "▶ Nghe thử"}
        </button>
        <span className="tiny muted" style={{ marginLeft: 10 }}>
          {speakers.length} nhân vật · {lines.length} câu
        </span>
      </div>
    </div>
  );
}

const CHECKLIST: [string, string][] = [
  ["Đổi mật khẩu tài khoản của mình", "/admin/cai-dat"],
  ["Điền tên trung tâm, liên hệ Zalo lớp", "/admin/cai-dat"],
  ["Tắt “Hiện mã dùng thử” trên trang chủ", "/admin/cai-dat"],
  ["Xóa 3 học sinh mẫu (ghi chú “Học sinh mẫu”)", "/admin/hoc-sinh"],
  ["Kiểm tra / tạo thư mục cho các lớp đang dạy", "/admin/thu-muc"],
  ["Dán danh sách lớp, tạo mã học sinh", "/admin/hoc-sinh"],
  ["Soạn hoặc kiểm tra bài đầu tiên (Xem trước như học sinh)", "/admin/bai-lam"],
  ["Tải lên một phiếu bài tập PDF", "/admin/tai-lieu"],
  ["Gửi mã cho từng em và hướng dẫn 3 bước đăng nhập", "#hoc-sinh-thay-gi"],
  ["Làm thử một bài bằng mã học sinh, xem điểm ở trang Kết quả", "/admin/ket-qua"],
];

function Checklist() {
  const KEY = "tedu.guide.checklist";
  const [done, setDone] = useState<number[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDone(sget<number[]>("localStorage", KEY, []));
  }, []);
  function toggle(i: number) {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    sset("localStorage", KEY, next);
  }
  const pct = Math.round((done.length / CHECKLIST.length) * 100);
  return (
    <>
      <div className="progress-row">
        <span>
          Đã xong {done.length}/{CHECKLIST.length}
        </span>
        <span className="progress" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
        <b style={{ color: pct === 100 ? "var(--good)" : "var(--brand-ink)" }}>{pct === 100 ? "Sẵn sàng! 🎉" : `${pct}%`}</b>
      </div>
      <div className="g-check">
        {CHECKLIST.map(([label, href], i) => (
          <label key={label}>
            <input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} />
            <span className="t">{label}</span>
            {href.startsWith("#") ? <a href={href}>Xem →</a> : <Link href={href}>Mở →</Link>}
          </label>
        ))}
      </div>
    </>
  );
}
