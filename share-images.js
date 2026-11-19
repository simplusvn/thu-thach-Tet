/* =========================================================
   Tạo ảnh kết quả và ảnh xem trước (Facebook) bằng canvas.
   Dùng chung cho website (dự phòng) và tools/generate-share.html.
   Cần config.js được nạp trước.
   ========================================================= */

const SHARE_ASSET_BASE = (typeof window !== 'undefined' && window.SHARE_ASSET_BASE) || '';

function loadImg(src) {
  const full = /^(blob:|data:|https?:)/.test(src) ? src : SHARE_ASSET_BASE + src;
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = full; });
}
const toBlob = (c, q = 0.9) => new Promise((res) => c.toBlob(res, 'image/jpeg', q));

function eraseRows(ctx, x0, x1, y0, y1, rightSampleUntilY, freezeFromY) {
  // Tô lại từng hàng bằng màu nội suy giữa 2 điểm mẫu ở mép trái/phải vùng cần xoá.
  // Từ hàng freezeFromY trở xuống dùng lại màu mẫu của hàng sạch cuối cùng (tránh lấy nhầm màu hoa mai).
  const W = ctx.canvas.width;
  const data = ctx.getImageData(0, y0, W, y1 - y0);
  const px = (x, y) => { const i = (y * W + x) * 4; return [data.data[i], data.data[i + 1], data.data[i + 2]]; };
  for (let y = 0; y < y1 - y0; y++) {
    const sy = freezeFromY != null ? Math.min(y, freezeFromY - y0 - 1) : y;
    const L = px(x0 - 4, sy);
    const R = (rightSampleUntilY == null || y0 + sy < rightSampleUntilY) ? px(x1 + 4, sy) : L;
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / (x1 - x0);
      const i = (y * W + x) * 4;
      data.data[i] = L[0] + (R[0] - L[0]) * t;
      data.data[i + 1] = L[1] + (R[1] - L[1]) * t;
      data.data[i + 2] = L[2] + (R[2] - L[2]) * t;
    }
  }
  ctx.putImageData(data, 0, y0);
}

function trimWhite(img) {
  // Tìm khung bao quanh phần không phải nền trắng của ảnh sản phẩm
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let yy = 0; yy < c.height; yy += 2) {
    for (let xx = 0; xx < c.width; xx += 2) {
      const i = (yy * c.width + xx) * 4;
      if (d[i] < 238 || d[i + 1] < 238 || d[i + 2] < 238) {
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
      }
    }
  }
  if (maxX <= minX) return { x: 0, y: 0, w: img.width, h: img.height };
  return { x: minX, y: minY, w: maxX - minX + 2, h: maxY - minY + 2 };
}

function fitText(ctx, text, maxW, size, weight, family) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 18);
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function loadShareFonts() {
  await Promise.all([
    document.fonts.load('800 40px "Be Vietnam Pro"'),
    document.fonts.load('600 24px "Be Vietnam Pro"'),
    document.fonts.load('500 24px "Be Vietnam Pro"'),
    document.fonts.load('italic 600 54px "Playfair Display"'),
    document.fonts.load('700 30px "Playfair Display"'),
  ]);
}

/* Ảnh kết quả (1024x1536): dùng poster "Kết quả chương trình", xoá chữ mẫu
   và nồi chiên mẫu, rồi vẽ tên + ảnh sản phẩm người chơi nhận được. */
async function renderCorrectImage(product) {
  await loadShareFonts();
  const [bg, prod] = await Promise.all([loadImg('poster-correct.jpg'), loadImg(`sanpham-${product.code}.jpg`)]);
  const c = document.createElement('canvas');
  c.width = bg.width; c.height = bg.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bg, 0, 0);

  // 1) Xoá "01 [TÊN SẢN PHẨM]" + 3 dòng hướng dẫn
  eraseRows(ctx, 160, 864, 458, 632);
  // 2) Xoá nồi chiên mẫu (giữ hộp quà bên phải), rồi vẽ lại mặt bục kem
  eraseRows(ctx, 366, 594, 645, 890, 735, 790);
  const plate = ctx.createLinearGradient(0, 838, 0, 892);
  plate.addColorStop(0, '#fffaf1');
  plate.addColorStop(1, '#efd6a8');
  ctx.fillStyle = plate;
  ctx.beginPath(); ctx.ellipse(470, 864, 150, 28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(214, 167, 74, .7)'; ctx.lineWidth = 2; ctx.stroke();

  // 3) Tên sản phẩm
  ctx.fillStyle = '#173c9c'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const title = `01 ${product.name.toUpperCase()}`;
  ctx.font = '800 50px "Be Vietnam Pro"';
  if (ctx.measureText(title).width <= 700) {
    ctx.fillText(title, 512, 520);
  } else {
    const words = title.split(' ');
    let line1 = '';
    while (words.length && ctx.measureText((line1 + ' ' + words[0]).trim()).width <= 700) line1 = (line1 + ' ' + words.shift()).trim();
    const line2 = words.join(' ');
    fitText(ctx, line1, 700, 42, 800, '"Be Vietnam Pro"'); ctx.fillText(line1, 512, 494);
    fitText(ctx, line2, 700, 42, 800, '"Be Vietnam Pro"'); ctx.fillText(line2, 512, 542);
  }
  ctx.font = '700 26px "Be Vietnam Pro"';
  ctx.fillText(product.code, 512, 578);

  // 4) Dòng hướng dẫn
  ctx.fillStyle = '#2347a8';
  const note = `Chụp màn hình bài đăng, gửi Zalo ${CONFIG.zaloNumber} của BTC Simplus`;
  fitText(ctx, note, 660, 22, 500, '"Be Vietnam Pro"');
  ctx.fillText(note, 512, 612);

  // 5) Ảnh sản phẩm: cắt viền trắng, đặt trên mặt bục, chế độ multiply để nền trắng hoà vào poster
  const b = trimWhite(prod);
  const scale = Math.min(250 / b.w, 230 / b.h);
  const w = b.w * scale, h = b.h * scale;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(prod, b.x, b.y, b.w, b.h, 470 - w / 2, 868 - h, w, h);
  ctx.restore();

  return toBlob(c);
}

/* Ảnh xem trước khi chia sẻ link lên Facebook (tỉ lệ 1.91:1 đúng khung Facebook).
   Vẽ theo khung 1200x630 nhưng xuất ở độ phân giải gấp đôi (2400x1260) để ảnh vẫn nét
   trên màn hình điện thoại và sau khi Facebook nén lại.
   kind: 'correct' | 'wrong'. posterSrc: ảnh poster đặt bên trái. */
const OG_SCALE = 2;
const OG_SIZE = { w: 1200 * OG_SCALE, h: 630 * OG_SCALE };
async function renderOgImage(kind, product, posterSrc) {
  await loadShareFonts();
  const [poster, logo] = await Promise.all([loadImg(posterSrc), loadImg('logo.webp')]);
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = OG_SIZE.w; c.height = OG_SIZE.h;
  const ctx = c.getContext('2d');
  ctx.scale(OG_SCALE, OG_SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Nền
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#eef4ff'); bg.addColorStop(.55, '#d4e3fc'); bg.addColorStop(1, '#a9c6f5');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(900, 120, 10, 900, 120, 520);
  glow.addColorStop(0, 'rgba(255,255,255,.85)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // Poster bên trái, bo góc + đổ bóng
  const ph = 560, pw = Math.round(poster.width * ph / poster.height);
  const px = 48, py = (H - ph) / 2, r = 22;
  const rr = (x, y, w, h, rad) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); };
  ctx.save();
  ctx.shadowColor = 'rgba(14,42,115,.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  rr(px, py, pw, ph, r); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
  ctx.save(); rr(px, py, pw, ph, r); ctx.clip(); ctx.drawImage(poster, px, py, pw, ph); ctx.restore();

  // Cột chữ bên phải
  const x0 = px + pw + 56, maxW = W - x0 - 56;
  let y = 92;
  // logo (ảnh logo có viền trắng: cắt vùng chữ)
  const lw = 190, lh = lw * 425 / 1640;
  ctx.drawImage(logo, 188, 255, 1640, 425, x0, y - lh + 6, lw, lh);
  y += 74;

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#163a96';
  fitText(ctx, 'Tết Trẻ Hay Tết Xưa', maxW, 56, 'italic 600', '"Playfair Display"');
  ctx.fillText('Tết Trẻ Hay Tết Xưa', x0, y);
  y += 42;
  ctx.fillStyle = '#0e2a73';
  ctx.font = '700 30px "Playfair Display"';
  ctx.fillText('Vẫn Là Tết Nhà', x0, y);
  y += 30;
  ctx.fillStyle = '#e2ac3f'; ctx.fillRect(x0, y, 90, 4);
  y += 58;

  if (kind === 'correct') {
    ctx.fillStyle = '#c4302b';
    ctx.font = '800 22px "Be Vietnam Pro"';
    ctx.fillText('MÌNH VỪA NHẬN ĐƯỢC', x0, y);
    y += 50;
    ctx.fillStyle = '#0e2a73';
    ctx.font = '800 40px "Be Vietnam Pro"';
    const lines = wrapLines(ctx, product.name, maxW).slice(0, 2);
    lines.forEach((l) => { ctx.fillText(l, x0, y); y += 48; });
    ctx.fillStyle = '#5b6687';
    ctx.font = '700 24px "Be Vietnam Pro"';
    ctx.fillText(product.code + ' · miễn phí từ Simplus', x0, y);
    y += 30;
  } else {
    ctx.fillStyle = '#0e2a73';
    ctx.font = '800 38px "Be Vietnam Pro"';
    wrapLines(ctx, 'Bạn có chọn đúng trợ thủ Simplus?', maxW).forEach((l) => { ctx.fillText(l, x0, y); y += 46; });
    ctx.fillStyle = '#2c3758';
    ctx.font = '500 23px "Be Vietnam Pro"';
    wrapLines(ctx, 'Chơi thử thách Tết cùng Simplus – chọn đúng là rinh quà miễn phí.', maxW).forEach((l) => { ctx.fillText(l, x0, y); y += 32; });
  }

  // Nút kêu gọi
  y = Math.max(y + 24, H - 148);
  ctx.font = '800 24px "Be Vietnam Pro"';
  const cta = 'Tham gia đều được quà  →';
  const bw = ctx.measureText(cta).width + 56;
  const btn = ctx.createLinearGradient(0, y, 0, y + 58);
  btn.addColorStop(0, '#2a62d8'); btn.addColorStop(1, '#163a96');
  ctx.fillStyle = btn; rr(x0, y, bw, 58, 29); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(cta, x0 + 28, y + 38);

  ctx.fillStyle = '#163a96';
  ctx.font = '700 21px "Be Vietnam Pro"';
  ctx.fillText(CONFIG.hashtags, x0, H - 44);

  return toBlob(c, 0.93);
}

/* Trang chia sẻ: chứa thẻ og:* để Facebook hiện ảnh xem trước, người bấm vào thì được chuyển về trang chủ. */
function buildSharePage(kind, product, slug) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const title = kind === 'correct'
    ? `Mình vừa nhận được ${productLabel(product)} từ Simplus!`
    : 'Thử thách Tết cùng Simplus – Tham gia đều được quà!';
  const desc = 'Tết Trẻ Hay Tết Xưa – Vẫn Là Tết Nhà. Chọn đúng trợ thủ Simplus cho việc Tết, rinh quà miễn phí! ' + CONFIG.hashtags;
  const pageUrl = SHARE.abs(SHARE.page(slug));
  const img = SHARE.abs(SHARE.og(slug));
  // Đường dẫn tương đối: trang chia sẻ luôn quay về đúng trang chủ, dù website đặt ở đâu
  const home = './';
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="vi_VN">
<meta property="og:site_name" content="Simplus Việt Nam">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="${OG_SIZE.w}">
<meta property="og:image:height" content="${OG_SIZE.h}">
<meta property="og:image:type" content="image/jpeg">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${esc(pageUrl)}">
<script>location.replace(${JSON.stringify(home)});</script>
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px">
<p><a href="${esc(home)}">Tham gia thử thách Tết cùng Simplus</a></p>
</body>
</html>
`;
}
