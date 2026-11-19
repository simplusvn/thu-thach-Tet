/* =========================================================
   CẤU HÌNH CHIẾN DỊCH – sửa tại đây
   ========================================================= */
const CONFIG = {
  // Địa chỉ website khi đã có domain, ví dụ 'https://tet.simplus.vn'.
  // Facebook đọc ảnh xem trước từ địa chỉ này, nên phải là domain công khai.
  // Mặc định = thư mục đang chứa trang (chạy đúng cả khi website nằm ở đường dẫn con,
  // ví dụ https://ten.github.io/simplus-tet/).
  siteUrl: new URL('.', location.href).href.replace(/\/$/, ''),
  // (Không bắt buộc) Facebook App ID của Simplus. Có App ID thì cửa sổ chia sẻ
  // Facebook mở gọn hơn và tự điền sẵn hashtag.
  fbAppId: '',
  // URL Ứng dụng web Google Apps Script (lưu người tham gia vào Google Sheets, chặn trùng Zalo/email).
  // Để trống = chế độ demo, chỉ lưu tạm trên trình duyệt. Xem apps-script/HUONG-DAN.md
  apiUrl: 'https://script.google.com/macros/s/AKfycbyDbkbtP4jzqZtpD82zw6gpHpO5fj6h-h4py_aEVSHlrjvmSJhfSE2GpdNdqpr1ACiT/exec',
  zaloNumber: '[Số Zalo BTC]',        // ví dụ: '0901234567'
  fbTag: '@Simplus_VN',
  igTag: '@simplusvietnam',
  hashtags: '#SimplusYoungTet #SimplusTetTre',
  rareChance: 0.08,                   // xác suất thử bốc hoạt động "hiếm" mỗi lượt
};

const PRODUCTS = [
  { code: 'XCQH018-V', name: 'Máy hút bụi cầm tay không dây' },
  { code: 'XCQH011', name: 'Máy hút bụi có dây' },
  { code: 'KQZG017', name: 'Nồi chiên không dầu' },
  { code: 'BYJH006FZ', name: 'Máy giặt thảm, sofa' },
  { code: 'DZGH012', name: 'Nồi đa năng 2 ngăn' },
  { code: 'DZEG003', name: 'Nồi hấp đa năng 3 tầng' },
  { code: 'GTJH020', name: 'Bàn ủi hơi nước cầm tay' },
  { code: 'JFBA012', name: 'Máy uốn duỗi tóc 2 trong 1' },
  { code: 'DRSH006', name: 'Ấm siêu tốc cổ điển' },
  { code: 'KQKX002', name: 'Nồi chiên không dầu có chức năng nướng' },
];

const ACTIVITIES = [
  { id: 1,  name: 'Lau dọn bàn thờ gia tiên', product: 'XCQH018-V' },
  { id: 2,  name: 'Tổng vệ sinh nhà cửa',     product: 'XCQH011' },
  { id: 3,  name: 'Rán bánh chưng',           product: 'KQZG017' },
  { id: 4,  name: 'Giặt thảm và bộ sofa',     product: 'BYJH006FZ', rare: true },
  { id: 5,  name: 'Nấu canh măng',            product: 'DZGH012' },
  { id: 6,  name: 'Hâm nóng thức ăn',         product: 'DZEG003' },
  { id: 7,  name: 'Ủi áo dài đi chúc Tết',    product: 'GTJH020' },
  { id: 8,  name: 'Làm tóc đón năm mới',      product: 'JFBA012' },
  { id: 9,  name: 'Pha trà đãi khách',        product: 'DRSH006' },
  { id: 10, name: 'Nướng thịt, nướng cá',     product: 'KQKX002', rare: true },
];

const productOf = (code) => PRODUCTS.find((p) => p.code === code);
const productLabel = (p) => `${p.name} ${p.code}`;
const pad2 = (n) => String(n).padStart(2, '0');

/* Đường dẫn ảnh/trang chia sẻ (được tạo sẵn bằng tools/generate-share.html) */
const SHARE = {
  slug: (kind, code) => (kind === 'correct' ? code : 'thu-lai'),
  poster: (kind, code) => (kind === 'correct' ? `ketqua-${code}.jpg` : 'poster-wrong.jpg'),
  // Tên có "hd": ảnh xem trước độ phân giải cao. Đổi tên để Facebook lấy ảnh mới thay vì ảnh cũ đã lưu.
  og: (slug) => `og-hd-${slug}.jpg`,
  page: (slug) => `chiase-hd-${slug}.html`,
  abs: (path) => CONFIG.siteUrl.replace(/\/$/, '') + '/' + path,
};
