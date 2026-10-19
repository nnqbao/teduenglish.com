/* Content of /need-clarify: what is built, what is not, and the questions for the teacher.
 * Pure data, shared by the page and the Convex functions (which validate question ids). */

export type ClarifyQuestion = {
  id: string;
  group: string;
  title: string;
  context?: string;
  options?: string[];
  /** Several options may be ticked. */
  multi?: boolean;
  placeholder?: string;
  files?: string; // when set, the question accepts attachments; the text explains what to attach
};

export const DONE: { area: string; icon: string; items: string[] }[] = [
  {
    area: "Trang học sinh",
    icon: "🎒",
    items: [
      "Đăng nhập bằng mã cá nhân, chỉ thấy thư mục được giao",
      "Trắc nghiệm, điền từ, viết lại câu: chấm tự động, có đáp án và giải thích sau khi nộp",
      "Phần nghe đọc bằng giọng tiếng Anh, mỗi nhân vật một giọng, có tốc độ chậm/chuẩn",
      "Phần đọc hiểu: bài đọc nằm cạnh câu hỏi",
      "Band IELTS Listening/Reading tham khảo",
      "Bài có mã riêng (ví dụ TS10)",
      "Làm lại với câu hỏi xáo trộn; bài đang làm được lưu nháp",
      "Tài liệu PDF: xem ngay trên web (chia đôi màn hình) hoặc tải về",
      "Bài viết (IELTS Writing): viết trên web, đếm từ, xem nhận xét của thầy",
      "Đếm giờ làm bài; bài nào cài “tự nộp” thì hết giờ tự nộp",
      "Phần nghe chọn được giọng Anh (UK) hoặc Mỹ (US)",
      "Bài và tài liệu chia theo Học kỳ 1 / Học kỳ 2 trong mỗi thư mục",
      "Bài đạt từ 80% mờ đi, không làm lại được (chống cho mượn tài khoản)",
      "Dùng tốt trên điện thoại",
    ],
  },
  {
    area: "Khu vực giáo viên",
    icon: "🧑‍🏫",
    items: [
      "Tài khoản riêng cho từng giáo viên (quản trị chính / giáo viên)",
      "Học sinh: thêm từng em, dán danh sách, tải file Excel; giữ mã có sẵn trong file hoặc tạo mã tên lót + tên + 4 số (dùng 4 số cuối SĐT nếu có)",
      "Khoá bài khi học sinh đạt từ 80% (chỉnh được %), giáo viên mở lại bằng nút “Cho làm lại”",
      "Khóa mã, đổi mã, mở thư mục cho cả lớp một lần",
      "Thư mục bài học: thêm, sửa, sắp xếp",
      "Trình soạn bài: trắc nghiệm, điền từ, bài viết, phần nghe, phần đọc, ảnh minh hoạ, mẫu IELTS Writing, nhập từ data.js/JSON",
      "Xem trước bài như học sinh (không cần mã, không lưu điểm)",
      "Tài liệu & PDF: tải lên, ẩn/hiện, sắp xếp",
      "Kết quả: lọc theo lớp/bài/học sinh, xem từng câu, tải Excel",
      "Chấm bài viết theo 4 tiêu chí IELTS (mặc định), học sinh thấy band từng tiêu chí",
      "Kết quả ghi thời gian làm bài của từng em",
      "Thống kê → Xếp hạng IELTS (Listening, Reading, Writing): lọc theo lớp, kỹ năng, từng bài; ẩn tên dạng Xxxxx + 4 số",
      "Thống kê → Chuyên cần: tỷ lệ bài đã làm / bài được giao của từng em, theo thư mục",
      "Mã phụ huynh = mã học sinh thêm “ph” trước 4 số cuối (thanhtoan3580 → thanhtoanph3580); phụ huynh chỉ xem kết quả của con (tiến độ, % hoàn thành, bài chưa làm, điểm IELTS & Global Success) tại /phu-huynh, không thấy bảng xếp hạng",
      "Học sinh xem thứ hạng IELTS của mình trong lớp ngay trên trang học tập (tên các bạn khác được ẩn)",
      "Đáp án chỉ hiện cho những câu học sinh đã làm và nộp; câu bỏ trống không hiện đáp án",
      "Speaking luyện tập theo mockup của thầy: trang chủ đề /speaking (đã nộp x/y), tab Part 1–3, tự ghi âm/ghi lại từng câu, bản chép lời tự động (máy tính dùng Chrome/Edge/Safari; trình duyệt không hỗ trợ thì ẩn nút), phiếu tự đánh giá 4 tiêu chí, file MP3, lưu bài làm dở",
      "IELTS Speaking: kiểm tra micro, chuẩn bị 15/30 giây, máy đọc câu hỏi + tiếng “tít” + thu âm từng câu; thầy nghe và chấm band 4 tiêu chí; ghi âm tự xoá sau 5 ngày (đủ để thầy chấm)",
      "Làm bài dở được tự lưu lên máy chủ; lần sau đăng nhập (máy nào cũng được) bấm “Em vào làm tiếp nhé”, đồng hồ chạy tiếp từ chỗ dừng",
      "Chống chuyển tab (Reading/Writing): lần 1 nhắc nhở, lần 2 đếm ngược 10 giây, lần 3 đếm ngược 5 giây (quá giờ thì khoá), lần 4 tự nộp bài và khoá tài khoản ngay; thầy mở khoá ở trang Học sinh",
      "Tài liệu: thêm bài nghe MP3 (cạnh PDF và link), học sinh nghe ngay trong danh sách hoặc tải về",
      "Phần nghe: thêm file MP3 của thầy (tối đa 40 MB), học sinh nghe bằng trình phát có chỉnh tốc độ; vẫn dùng được giọng máy đọc lời thoại",
      "Trang hướng dẫn sử dụng có hình minh hoạ",
    ],
  },
  {
    area: "Hệ thống & bảo mật",
    icon: "🔒",
    items: [
      "Chạy trên teduenglish.com, dữ liệu lưu trên Convex Cloud",
      "Đáp án nằm trên máy chủ, học sinh không xem trước được",
      "Mật khẩu giáo viên được mã hoá; khoá 15 phút sau 5 lần nhập sai",
      "Bắt đổi mật khẩu tạm ở lần đăng nhập đầu",
    ],
  },
  {
    area: "Đã chốt theo ý thầy",
    icon: "🤝",
    items: [
      "Mã học sinh: tên lót + tên + 4 số cuối điện thoại (không có SĐT thì 4 số ngẫu nhiên); tra lại được",
      "Không cần mã bài theo khối / xoay vòng mã (mỗi em một khối)",
      "Phần nghe dùng giọng đọc của máy (Anh hoặc Mỹ), không cần MP3",
      "Không cần AI (thầy đã có trợ giảng)",
      "Chia nội dung theo Học kỳ 1 / Học kỳ 2 thay cho phân quyền theo Unit",
    ],
  },
];

export const NOT_DONE: { title: string; note: string; question: string }[] = [
  { title: "AI tự chấm band Speaking", note: "Đã có thu âm và thầy chấm. AI chấm (chuyển giọng thành chữ + chấm 4 tiêu chí) làm sau khi có API key và chốt chi phí.", question: "ai" },
  { title: "Dạng đề Chuyên Anh: open cloze trong đoạn văn, tìm lỗi sai…", note: "Chờ thầy gửi định dạng & nguồn đề.", question: "chuyen-anh-formats" },
  { title: "Kiểm tra với file danh sách lớp thật", note: "Chưa nhận được file thầy đính kèm.", question: "excel-sample" },
  { title: "Tên hiển thị trên web", note: "Thầy chưa chốt: “TEDU English” hay “Toàn English Lab”.", question: "brand" },
  { title: "Lưu số điện thoại phụ huynh", note: "Thầy chưa chốt có lưu hay không.", question: "store-phone" },
];

export const QUESTIONS: ClarifyQuestion[] = [
  {
    id: "brand",
    group: "Thương hiệu",
    title: "Tên hiển thị trên web là gì, và học sinh gọi giáo viên thế nào?",
    context: "Web đang dùng “TEDU English” và “thầy cô”. Bản demo của thầy dùng “Toàn English Lab” và “thầy Toàn”.",
    options: ["TEDU English", "Toàn English Lab", "Tên khác (ghi bên dưới)"],
    placeholder: "Cách gọi giáo viên, ví dụ: thầy Toàn",
  },
  {
    id: "writing-scoring",
    group: "IELTS Writing",
    title: "Thầy muốn chấm bài Writing theo kiểu nào?",
    context: "Hiện có thể chỉ nhận xét, chấm 1 band, hoặc chấm 4 tiêu chí để tự tính band.",
    options: ["Chỉ nhận xét", "Nhận xét + 1 band", "Luôn chấm đủ 4 tiêu chí", "Cần thêm band Writing tổng (Task 2 tính gấp đôi)"],
    multi: true,
    placeholder: "Ghi chú thêm (không bắt buộc)",
  },
  {
    id: "timer",
    group: "IELTS Writing",
    title: "Có cần đếm giờ và tự nộp khi hết giờ như thi thật không?",
    options: ["Có, tự nộp khi hết giờ", "Có đếm giờ nhưng không tự nộp", "Không cần"],
    placeholder: "Áp dụng cho bài nào? (Writing, Listening, Reading…)",
  },
  {
    id: "writing-prompts",
    group: "IELTS Writing",
    title: "Thầy có sẵn đề Writing và ảnh biểu đồ Task 1 không?",
    options: ["Có, em gửi kèm bên dưới", "Chưa có, nhờ soạn vài đề mẫu", "Chưa cần"],
    files: "Đề Writing, ảnh biểu đồ (Word, PDF, ảnh…)",
  },
  {
    id: "content",
    group: "Nội dung đề",
    title: "Thầy gửi giúp các bộ đề trong bản demo để nhập vào web",
    context: "GS8 Trắc nghiệm Unit 1–3 (50 câu), Chuyên Anh (55 câu), IELTS Practice 1 & 2 (Listening + Reading 40 câu).",
    options: ["Đề tự soạn / có quyền sử dụng", "Lấy từ sách có bản quyền (Cambridge…)", "Không rõ nguồn"],
    placeholder: "Nguồn đề, ghi chú…",
    files: "File đề: Word, Excel, PDF đều được",
  },
  {
    id: "audio",
    group: "Nội dung đề",
    title: "Phần nghe: dùng giọng đọc của máy hay file MP3 thật?",
    options: ["Giọng đọc của máy là đủ", "Có file MP3, muốn tải lên", "Muốn giọng AI tự nhiên (có chi phí nhỏ)"],
    files: "File MP3 (nếu có)",
  },
  {
    id: "excel-sample",
    group: "Học sinh & mã",
    title: "Thầy gửi giúp một file Excel danh sách lớp thật để kiểm tra",
    context: "Có thể che bớt tên / số điện thoại, chỉ cần giữ đúng các cột như file thầy hay dùng.",
    files: "File .xlsx danh sách lớp",
    placeholder: "Ghi chú về file (không bắt buộc)",
  },
  {
    id: "code-style",
    group: "Học sinh & mã",
    title: "Thầy thích mã học sinh kiểu nào?",
    options: ["Tên + 4 số cuối SĐT (vd: baoan4821)", "Tên + 4 số ngẫu nhiên (vd: an7305)", "Kiểu khác (ghi bên dưới)"],
  },
  {
    id: "store-phone",
    group: "Học sinh & mã",
    title: "Có muốn lưu số điện thoại phụ huynh vào hệ thống không?",
    context: "Hiện chỉ dùng 4 số cuối để tạo mã, không lưu số điện thoại.",
    options: ["Không lưu (như hiện tại)", "Có, lưu để liên hệ phụ huynh"],
  },
  {
    id: "code-visibility",
    group: "Học sinh & mã",
    title: "Mã học sinh nên tra lại được hay chỉ hiện một lần?",
    context: "Tra lại được: em quên mã thì giáo viên xem lại ngay. Chỉ hiện một lần: an toàn hơn nhưng quên là phải tạo mã mới.",
    options: ["Tra lại được (như hiện tại)", "Chỉ hiện một lần"],
  },
  {
    id: "unit-permissions",
    group: "Tính năng chưa làm",
    title: "Có cần giới hạn từng bài / tài liệu theo Unit hoặc lớp không?",
    options: ["Cần", "Không, mở theo thư mục là đủ"],
    placeholder: "Nếu cần: thầy chia Unit thế nào? Ví dụ lớp 8A1 mới học đến Unit 3…",
  },
  {
    id: "rotating-codes",
    group: "Tính năng chưa làm",
    title: "Có cần mã bài theo khối có xoay vòng hoặc hết hạn không?",
    context: "Đổi mã thì khoá lại cả những em đã mở trước đó, hoặc mã tự hết hạn sau X ngày.",
    options: ["Cần xoay vòng (đổi mã là khoá lại)", "Cần mã tự hết hạn", "Không cần"],
    multi: true,
  },
  {
    id: "chuyen-anh-formats",
    group: "Tính năng chưa làm",
    title: "Dạng đề Chuyên Anh cần thêm",
    options: ["Open cloze: chỗ trống nằm ngay trong đoạn văn", "Tìm lỗi sai (gạch chân A/B/C/D trong câu)", "Mỗi lần làm rút ngẫu nhiên từ kho đề", "Không cần thêm"],
    multi: true,
  },
  {
    id: "ai",
    group: "Tính năng chưa làm",
    title: "Thầy muốn dùng AI vào việc gì?",
    context: "Cần tài khoản dịch vụ AI và có chi phí; bài làm của học sinh sẽ được gửi sang dịch vụ đó để xử lý.",
    options: ["Gợi ý nhận xét bài viết để thầy duyệt", "Chấm sơ bộ band Writing", "Soạn đề / câu hỏi", "Chưa cần AI"],
    multi: true,
    placeholder: "Mong muốn cụ thể…",
  },
  {
    id: "other",
    group: "Góp ý khác",
    title: "Thầy có góp ý hoặc yêu cầu nào khác không?",
    placeholder: "Bất cứ điều gì thầy muốn thêm, sửa hoặc bỏ…",
    files: "File tham khảo (nếu có)",
  },
];

export const QUESTION_IDS = new Set(QUESTIONS.map((q) => q.id));
export const MAX_CLARIFY_FILE_BYTES = 100 * 1024 * 1024;
