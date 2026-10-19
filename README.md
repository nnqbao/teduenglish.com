# TEDU English — góc luyện tập cho học sinh

Next.js (App Router) + **Convex tự host** trên Mac mini (trước 19/10/2026: Convex Cloud).
Giao diện lấy từ bản thiết kế tĩnh `tedu-english` (đăng nhập bằng mã cá nhân, thư mục bài học,
bài làm chấm tự động, nghe/đọc IELTS), có thêm backend thật và trang quản trị `/admin`.

## Cấu trúc

```
app/(site)/            trang học sinh: /, /thu-muc/[id], /bai/[id]
app/admin/             khu vực giáo viên: học sinh, thư mục, bài làm, tài liệu, kết quả, cài đặt
components/site/       giao diện học sinh (port từ app.js gốc)
components/admin/      giao diện quản trị
convex/schema.ts       bảng dữ liệu
convex/site.ts         API cho học sinh (đăng nhập bằng mã, làm bài, chấm điểm trên server)
convex/admin.ts        API quản trị (mọi hàm đều kiểm tra phiên đăng nhập admin)
convex/model.ts        logic chấm điểm, band IELTS, chuẩn hoá đáp án (dùng chung client/server)
convex/seed.ts         lệnh nội bộ: nạp dữ liệu mẫu, tạo/xoá admin, xoá tiến độ một học sinh
app/site.css           CSS gốc của bản thiết kế (giữ nguyên)
```

## Bảo mật

- Đáp án và giải thích chỉ nằm trên Convex; học sinh chỉ nhận đáp án sau khi nộp bài.
- Mã bài (ví dụ `TS10`) được kiểm tra trên server.
- File PDF lưu trong Convex Storage (tối đa 50 MB/file). Link file chỉ được trả về cho học sinh có quyền vào thư mục;
  học sinh xem bằng pdf.js (`components/site/DocReader.tsx`, worker được chép vào `public/` khi chạy dev/build).
  Xoá tài liệu là xoá luôn file; file tải lên nhưng không lưu sẽ được cron dọn sau 1 ngày.
- Admin đăng nhập bằng email + mật khẩu (PBKDF2-SHA256, 100k vòng), phiên 7 ngày, khoá 15 phút sau 5 lần sai.
- Đăng nhập học sinh có giới hạn chung 40 lần sai/phút để chống dò mã.
- Tài khoản mới tạo luôn dùng mật khẩu tạm và bắt buộc đổi ở lần đăng nhập đầu.

## Lệnh thường dùng

```bash
npm install
npm run dev                 # http://localhost:4173 (dùng Convex trong .env.local)
npm run convex:deploy       # đẩy thay đổi trong convex/ lên production
npm run check               # lint + typecheck + test + build
```

`.env.local` (không commit) cần:

```
NEXT_PUBLIC_CONVEX_URL=https://teduenglish.com/_convex   # trình duyệt → scripts/server.mjs → Convex
APP_URL=https://teduenglish.com
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3280            # Convex tự host (Docker)
CONVEX_SELF_HOSTED_ADMIN_KEY='teduenglish-local|...'      # ./generate_admin_key.sh trong container
```

Dashboard, danh sách và xếp hạng đọc hai bảng tóm tắt nhỏ (`quizCards`, `scores`, xem `convex/summary.ts`)
thay vì toàn bộ câu hỏi và bài nộp. Sau khi nạp dữ liệu từ nơi khác: `npx convex run summary:rebuild`.

Lệnh vận hành (chạy trong thư mục dự án):

```bash
# Tạo hoặc cấp lại tài khoản quản trị chính (mật khẩu tạm, phải đổi khi đăng nhập)
npx convex run seed:bootstrapAdmin '{"email":"ten@example.com","name":"Tên","password":"MatKhauTam123"}'
# Xoá một tài khoản admin
npx convex run seed:removeAdmin '{"email":"ten@example.com"}'
# Xoá điểm + mã bài đã mở của một học sinh (ví dụ mã dùng thử)
npx convex run seed:resetStudentProgress '{"code":"demo2026"}'
```

Chi tiết triển khai: `DEPLOY-NHANH.md`.
