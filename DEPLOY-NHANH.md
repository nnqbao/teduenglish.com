# Triển khai TEDU English

## Kiến trúc đang chạy

- Dữ liệu: **Convex tự host trên Mac mini** (Docker/colima, `~/ops/infra/teduenglish-convex`, cổng 3280).
  Chuyển từ Convex Cloud ngày 19/10/2026 vì gói miễn phí bị khoá do vượt Database I/O.
  Launchd `ai.teduenglish.convex-selfhost` tự bật lại Docker/Convex nếu bị tắt.
- Web: `node scripts/server.mjs` (Next.js production + chuyển `/_convex/*` sang Convex, kể cả websocket) ở cổng 4173,
  chạy bằng launchd (`ai.teduenglish.web`). Trình duyệt dùng `NEXT_PUBLIC_CONVEX_URL=https://teduenglish.com/_convex`.
- teduenglish.com → Cloudflare Tunnel → `localhost:4173`.
- Sao lưu: launchd `ai.teduenglish.convex-backup` lúc 01:20 mỗi đêm xuất toàn bộ dữ liệu + file vào
  `~/ops/backups/teduenglish/convex/` (giữ 30 ngày). Khôi phục: `npx convex import --replace-all <file.zip>`.
- Log: `~/ops/logs/ai.teduenglish.*.log` và `.err.log`.

## Cập nhật phiên bản mới

```bash
cd /Users/vsc_agent/projects/teduenglish
npm ci
npm run convex:deploy        # nếu có thay đổi trong convex/
npm run check                # lint, typecheck, test, build
launchctl kickstart -k gui/$(id -u)/ai.teduenglish.web
curl -s http://127.0.0.1:4173/api/health   # {"status":"ok","backend":"convex",...}
```

Cài lại dịch vụ tự khởi động: `zsh scripts/install-autostart.sh`.

## Trước khi cho học sinh dùng thật

1. Đăng nhập `/admin` bằng tài khoản quản trị chính, đổi mật khẩu.
2. **Cài đặt & tài khoản**: tắt “Hiện mã dùng thử”, điền liên hệ (Zalo lớp) nếu muốn.
3. **Học sinh**: xoá 3 học sinh mẫu, dùng “Thêm nhiều học sinh” để dán danh sách lớp thật.
4. Thêm tài khoản cho giáo viên khác (vai trò Giáo viên) nếu cần.

## Kiểm tra sau triển khai

- `/api/health` trả `status: ok`.
- Trang chủ hiện màn hình nhập mã; đăng nhập bằng một mã học sinh thấy đúng thư mục.
- Làm và nộp một bài, kết quả hiện trong `/admin/ket-qua`.
