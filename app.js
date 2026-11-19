/* =========================================================
   Simplus – Tết Trẻ Hay Tết Xưa, Vẫn Là Tết Nhà
   Cấu hình, sản phẩm, hoạt động: xem config.js
   ========================================================= */

/* ---------- 1. KẾT NỐI SERVER (Google Sheets qua Apps Script) ----------
   Có CONFIG.apiUrl: gửi dữ liệu lên Google Apps Script (apps-script/Code.gs) — lưu vào Google Sheets,
   server chặn trùng số Zalo / email cho TẤT CẢ người chơi.
   Không có apiUrl: chế độ demo, chỉ lưu tạm trên trình duyệt này.
   Sau này chuyển sang CRM: chỉ cần sửa hàm callServer, giữ nguyên dạng dữ liệu trả về. */
async function callServer(action, payload, { wait = true } = {}) {
  // Gửi dạng text/plain để trình duyệt không cần hỏi trước (CORS preflight) — Apps Script không trả lời bước đó
  const req = fetch(CONFIG.apiUrl, { method: 'POST', body: JSON.stringify({ action, ...payload }), keepalive: !wait, redirect: 'follow' });
  if (!wait) { req.catch(() => {}); return { ok: true }; }
  const res = await req;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
const useServer = () => !!CONFIG.apiUrl;

const API = {
  /** Gửi form đăng ký. Trả về { ok: true, id } hoặc { ok: false, code: 'DUPLICATE' | 'INVALID' | 'NETWORK' }. */
  async register(data) {
    if (useServer()) {
      try { return await callServer('register', data); } catch (err) { return { ok: false, code: 'NETWORK' }; }
    }
    const reg = store.get('registry', []);
    const dup = reg.some((r) => r.zalo === data.zalo || r.email === data.email);
    if (dup) return { ok: false, code: 'DUPLICATE' };
    const id = 'demo-' + Date.now();
    reg.push({ id, zalo: data.zalo, email: data.email });
    store.set('registry', reg);
    return { ok: true, id };
  },
  /** Ghi nhận người dùng đã tick đồng ý điều khoản. Đưa vào hàng đợi, gửi gộp cùng lượt chơi. */
  async logConsent(participantId) {
    if (useServer()) EventQueue.add({ type: 'consent' });
    return { ok: true };
  },
  /** Ghi log lượt chơi / bấm chia sẻ / xác nhận đã chia sẻ. Gom lại, mỗi lượt chơi chỉ gửi 1 lần:
   *  - trả lời ĐÚNG → gửi ngay (để Sheet cập nhật "Đã chọn đúng")
   *  - trả lời SAI → chờ tới khi bấm "Thử lại" (gửi chung lượt trả lời + các lần bấm chia sẻ + xác nhận)
   *  - bấm chia sẻ sau khi thắng → gửi khi người chơi rời trang / chuyển sang Facebook, Instagram */
  async logAttempt(entry) {
    if (!useServer()) return { ok: true };
    if (entry.shareClicked) {
      EventQueue.add({ type: 'share', attempt: entry.attempt, platform: entry.shareClicked });
    } else if (entry.shareConfirmed) {
      EventQueue.add({ type: 'shareConfirmed', attempt: entry.attempt });
      EventQueue.flush();
    } else {
      const act = ACTIVITIES.find((a) => a.id === entry.activityId);
      const prod = productOf(entry.chosen);
      EventQueue.add({
        type: 'answer', attempt: entry.attempt, correct: !!entry.correct,
        activityName: act ? act.name : '', chosenName: prod ? productLabel(prod) : '',
      });
      if (entry.correct) EventQueue.flush();
    }
    return { ok: true };
  },
  /** Xin 1 suất hoạt động hiếm (#4, #10). Server đếm TỔNG toàn bộ người chơi, tối đa 2 lần mỗi hoạt động. */
  async claimRareActivity(activityId) {
    if (useServer()) {
      try { return await callServer('claimRare', { activityId }); } catch (err) { return { ok: false }; }
    }
    const used = store.get('rareUsed', {});
    if ((used[activityId] || 0) >= 2) return { ok: false };
    used[activityId] = (used[activityId] || 0) + 1;
    store.set('rareUsed', used);
    return { ok: true };
  },
};

/* Hàng đợi sự kiện: gom log lại để mỗi lượt chơi chỉ gọi server 1 lần (giảm tải Google Sheets lúc đông).
   Lưu cả vào trình duyệt: nếu gửi lỗi hoặc người chơi đóng trang, lần sau mở lại sẽ gửi bù. */
const EventQueue = {
  sending: false,
  list() { return store.get('pendingEvents', []); },
  add(ev) {
    const q = this.list();
    q.push({ ...ev, at: new Date().toISOString() });
    store.set('pendingEvents', q.slice(-50));
  },
  async flush() {
    const q = this.list();
    if (!useServer() || this.sending || !q.length || !state.participantId) return;
    this.sending = true;
    try {
      const res = await callServer('events', { participantId: state.participantId, events: q });
      if (res && res.ok) {
        // Chỉ xoá những sự kiện vừa gửi (có thể đã có sự kiện mới thêm vào trong lúc chờ)
        store.set('pendingEvents', this.list().slice(q.length));
      }
    } catch (err) { /* giữ lại, gửi bù lần sau */ } finally { this.sending = false; }
  },
  // Người chơi rời trang / chuyển sang app Facebook, Instagram: gửi nốt bằng sendBeacon (trình duyệt vẫn gửi dù trang đã ẩn)
  beacon() {
    const q = this.list();
    if (!useServer() || !q.length || !state.participantId || !navigator.sendBeacon) return;
    const ok = navigator.sendBeacon(CONFIG.apiUrl, JSON.stringify({ action: 'events', participantId: state.participantId, events: q }));
    if (ok) store.set('pendingEvents', []);
  },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') EventQueue.beacon(); });
window.addEventListener('pagehide', () => EventQueue.beacon());

/* ---------- 2. LƯU TRẠNG THÁI NGƯỜI CHƠI (trên trình duyệt) ---------- */
const store = {
  key: (k) => 'simplusTet.' + k,
  get(k, fallback) {
    try { const v = localStorage.getItem(this.key(k)); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch { /* private mode */ } },
  clear() { try { Object.keys(localStorage).filter((k) => k.startsWith('simplusTet.')).forEach((k) => localStorage.removeItem(k)); } catch {} },
};
if (new URLSearchParams(location.search).has('reset')) store.clear();

// stage: 'new' → 'registered' → 'playing' → 'won'
const state = Object.assign({ stage: 'new', participantId: null, attempt: 0, activityId: null, wonProduct: null }, store.get('state', {}));
const save = () => store.set('state', state);

/* ---------- 3. TIỆN ÍCH GIAO DIỆN ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

let toastTimer;
function toast(msg, ms = 4200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

let lastFocus = null;
function openModal(id) {
  $$('.modal').forEach((m) => { m.hidden = true; });
  const m = $('#' + id);
  lastFocus = document.activeElement;
  m.hidden = false;
  document.body.classList.add('no-scroll');
  const first = m.querySelector('input, button:not(.modal__close)');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
}
function closeModal() {
  $$('.modal').forEach((m) => { m.hidden = true; });
  document.body.classList.remove('no-scroll');
  if (lastFocus) lastFocus.focus({ preventScroll: true });
}
/* Popup phụ (hướng dẫn Facebook/Instagram) mở chồng lên popup đang có */
function openSheet(id) { $('#' + id).hidden = false; }
function closeSheet(el) { el.closest('.modal--top').hidden = true; }

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) {
    if (closeBtn.closest('.modal--top')) closeSheet(closeBtn); else closeModal();
  } else if (e.target.classList.contains('modal--top')) {
    closeSheet(e.target);
  } else if (e.target.classList.contains('modal') && e.target.id !== 'modal-wrong') {
    closeModal();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = $$('.modal--top').find((m) => !m.hidden);
  if (top) { top.hidden = true; return; }
  // Popup "sai" không cho đóng: người chơi phải chia sẻ rồi bấm Thử lại
  if ($('#modal-wrong').hidden) closeModal();
});

/* ---------- 4. TABS ---------- */
function showTab(name) {
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.tab-panel').forEach((p) => {
    const on = p.id === 'tab-' + name;
    p.hidden = !on;
    p.classList.toggle('is-active', on);
  });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  showTab(t.dataset.tab);
  if (t.dataset.tab === 'join') startJoin();
}));
$$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault(); closeModal(); showTab(a.dataset.goto); window.scrollTo({ top: 0 });
}));

/** Bấm tab 1 hoặc nút "Tham gia ngay": đưa người dùng tới đúng bước họ đang dở. */
function startJoin() {
  if (state.stage === 'new') openModal('modal-register');
  else if (state.stage === 'registered') openModal('modal-consent');
  else if (state.stage === 'playing') $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (state.stage === 'won') openClaim();
}
$('#cta-join').addEventListener('click', startJoin);

/* ---------- 5. FORM ĐĂNG KÝ ---------- */
const validators = {
  name: (v) => v.trim() ? '' : 'Vui lòng nhập tên người tham gia.',
  zalo: (v) => /^(0|\+?84)(3|5|7|8|9)\d{8}$/.test(v.replace(/[\s.\-]/g, '')) ? '' : 'Số Zalo chưa đúng định dạng số điện thoại Việt Nam.',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Email chưa đúng định dạng.',
  province: (v) => v ? '' : 'Vui lòng chọn Tỉnh/Thành phố.',
  ward: (v) => v ? '' : 'Vui lòng chọn Phường/Xã.',
  street: (v) => v.trim().length >= 3 ? '' : 'Vui lòng nhập số nhà, tên đường.',
  social: (v) => /^(https?:\/\/)?([\w-]+\.)?(facebook\.com|fb\.com|fb\.me|instagram\.com)\/\S+/i.test(v.trim()) ? '' : 'Vui lòng nhập link Facebook hoặc Instagram hợp lệ.',
};
const form = $('#form-register');

function checkField(input) {
  const msg = validators[input.name](input.value);
  const field = input.closest('.field');
  field.classList.toggle('is-invalid', !!msg);
  field.querySelector('.field__error').textContent = msg;
  return !msg;
}
$$('input', form).forEach((inp) => {
  inp.addEventListener('blur', () => { if (inp.value) checkField(inp); });
  inp.addEventListener('input', () => { if (inp.closest('.field').classList.contains('is-invalid')) checkField(inp); });
});

/* Địa chỉ: chọn Tỉnh/Thành phố → danh sách Phường/Xã của tỉnh đó (dữ liệu trong diachi.js) */
const selProvince = form.elements.province, selWard = form.elements.ward;
const ADDR = (window.VN_ADDR || []).slice().sort((a, b) => a.n.localeCompare(b.n, 'vi'));
const fillOptions = (sel, items, placeholder) => {
  sel.innerHTML = `<option value="">${placeholder}</option>` + items.map((t) => `<option>${t}</option>`).join('');
};
fillOptions(selProvince, ADDR.map((p) => p.n), 'Tỉnh/Thành phố *');
selProvince.addEventListener('change', () => {
  const p = ADDR.find((x) => x.n === selProvince.value);
  fillOptions(selWard, p ? p.w.slice().sort((a, b) => a.localeCompare(b, 'vi')) : [], 'Phường/Xã *');
  selWard.disabled = !p;
  checkField(selProvince);
  selWard.closest('.field').classList.remove('is-invalid');
  selWard.closest('.field').querySelector('.field__error').textContent = '';
});
selWard.addEventListener('change', () => checkField(selWard));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputs = $$('input, select', form);
  const okAll = inputs.map(checkField).every(Boolean);
  const errBox = $('#reg-error');
  errBox.hidden = true;
  if (!okAll) { inputs.find((i) => i.closest('.field').classList.contains('is-invalid')).focus(); return; }

  const d = Object.fromEntries(new FormData(form));
  const social = /^https?:\/\//i.test(d.social.trim()) ? d.social.trim() : 'https://' + d.social.trim();
  const data = {
    name: d.name.trim(),
    zalo: d.zalo.replace(/[\s.\-]/g, '').replace(/^\+?84/, '0'),
    email: d.email.trim().toLowerCase(),
    // Gửi CRM cả từng phần lẫn địa chỉ đầy đủ (dùng để giao quà và kiểm tra trùng)
    street: d.street.trim(),
    ward: d.ward,
    province: (ADDR.find((p) => p.n === d.province) || {}).f || d.province,
    address: `${d.street.trim()}, ${d.ward}, ${(ADDR.find((p) => p.n === d.province) || {}).f || d.province}`,
    social,
  };

  const btn = form.querySelector('[type=submit]');
  const btnHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Đang gửi…';
  try {
    const res = await API.register(data);
    if (!res.ok) {
      errBox.textContent = {
        DUPLICATE: 'Thông tin này đã được sử dụng để tham gia. Mỗi người chỉ được tham gia một lần.',
        INVALID: 'Thông tin chưa hợp lệ, vui lòng kiểm tra lại các ô đã điền.',
        NETWORK: 'Chưa kết nối được tới hệ thống. Vui lòng kiểm tra mạng và bấm Đăng ký lại.',
        BUSY: 'Hệ thống đang có nhiều người đăng ký cùng lúc. Vui lòng đợi vài giây rồi bấm Đăng ký lại.',
      }[res.code] || 'Có lỗi xảy ra, vui lòng thử lại.';
      errBox.hidden = false;
      return;
    }
    state.stage = 'registered';
    state.participantId = res.id;
    state.name = data.name;
    save();
    openModal('modal-consent');
  } finally {
    btn.disabled = false;
    btn.innerHTML = btnHtml;
  }
});

/* ---------- 6. ĐỒNG Ý ĐIỀU KHOẢN ---------- */
$('#consent-check').addEventListener('change', (e) => { $('#btn-consent').disabled = !e.target.checked; });
$('#btn-consent').addEventListener('click', async () => {
  await API.logConsent(state.participantId);
  state.stage = 'playing';
  save();
  closeModal();
  renderStage();
  $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await newRound();
});

/* ---------- 7. GAME ---------- */
let selected = null;

function renderProducts() {
  const list = $('#product-list');
  list.innerHTML = '';
  PRODUCTS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'product';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.code = p.code;
    b.innerHTML = `<img src="sanpham-${p.code}.jpg" alt="" loading="lazy">
      <span><span class="product__name">${p.name}</span><span class="product__code">${p.code}</span></span>
      <span class="product__radio" aria-hidden="true"></span>`;
    b.addEventListener('click', () => selectProduct(p.code));
    list.appendChild(b);
  });
}
function selectProduct(code) {
  selected = code;
  $$('.product').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.code === code)));
  $('#btn-answer').disabled = false;
}

async function pickActivity() {
  const prev = state.activityId;
  if (Math.random() < CONFIG.rareChance) {
    const rare = ACTIVITIES.filter((a) => a.rare && a.id !== prev);
    const cand = rare[Math.floor(Math.random() * rare.length)];
    if (cand && (await API.claimRareActivity(cand.id)).ok) return cand;
  }
  const normal = ACTIVITIES.filter((a) => !a.rare && a.id !== prev);
  return normal[Math.floor(Math.random() * normal.length)];
}

/* Vòng quay may mắn: hoạt động được chọn trước (giữ đúng giới hạn hoạt động hiếm),
   vòng quay chỉ quay tới đúng ô đó. Người chơi bấm QUAY, vòng dừng, rồi mới hiện hoạt động. */
const WHEEL_COLORS = [
  ['#1d4fbf', '#fff'], ['#fff6e6', '#0e2a73'], ['#3b74e6', '#fff'], ['#f2d595', '#0e2a73'], ['#163a96', '#fff'],
  ['#fff6e6', '#0e2a73'], ['#1d4fbf', '#fff'], ['#f2d595', '#0e2a73'], ['#3b74e6', '#fff'], ['#fff6e6', '#0e2a73'],
];
let wheelTurn = 0;
function wheelLines(name) {
  const words = name.split(' ');
  if (name.length <= 14) return [name];
  let best = 1, diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) { diff = d; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}
function buildWheel() {
  const n = ACTIVITIES.length, step = 360 / n, R = 156;
  const pt = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
  let svg = '';
  ACTIVITIES.forEach((a, i) => {
    const [x1, y1] = pt(i * step, R), [x2, y2] = pt((i + 1) * step, R);
    const [bg, fg] = WHEEL_COLORS[i % WHEEL_COLORS.length];
    const mid = i * step + step / 2;
    const lines = wheelLines(a.name);
    const tspans = lines.map((l, k) => `<tspan x="0" dy="${k === 0 ? (lines.length === 1 ? 4 : -2) : 12}">${l}</tspan>`).join('');
    svg += `<path d="M0 0L${x1.toFixed(2)} ${y1.toFixed(2)}A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z" fill="${bg}" stroke="#fff" stroke-width="1.5"/>`;
    // Chữ chạy dọc theo bán kính, từ tâm ra mép
    svg += `<g transform="rotate(${mid - 90}) translate(98 0)${mid > 180 ? ' rotate(180)' : ''}"><text text-anchor="middle" fill="${fg}" font-size="10.5" font-weight="700" font-family="Be Vietnam Pro, sans-serif">${tspans}</text></g>`;
  });
  for (let i = 0; i < n; i++) { const [x, y] = pt(i * step, R - 5); svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.2" fill="#e2ac3f"/>`; }
  $('#wheel-disc').innerHTML = svg;
}

/* Vòng quay nằm ngay chỗ thẻ hoạt động, cạnh danh sách sản phẩm (đang khoá).
   Quay xong → vòng quay biến mất → hiện thẻ hoạt động như bình thường. */
function spinWheel(act) {
  return new Promise((resolve) => {
    const disc = $('#wheel-disc'), hub = $('#btn-spin'), wheel = $('.wheel'), spin = $('#spin');
    $('.activity').hidden = true;
    $('.products').classList.add('is-locked');
    $('#btn-answer').disabled = true;
    spin.classList.remove('is-leaving');
    spin.hidden = false;
    $('#wheel-hint').innerHTML = 'Bấm <b>QUAY</b> để vòng quay chọn hoạt động cho bạn';
    hub.disabled = false;
    wheel.classList.add('is-ready');

    hub.onclick = () => {
      hub.disabled = true;
      wheel.classList.remove('is-ready');
      $('#wheel-hint').textContent = 'Đang quay…';
      const step = 360 / ACTIVITIES.length;
      const idx = ACTIVITIES.findIndex((a) => a.id === act.id);
      const jitter = (Math.random() - 0.5) * step * 0.6;
      // Quay thêm ít nhất 6 vòng, dừng sao cho ô của hoạt động nằm dưới kim (đỉnh vòng quay)
      const target = 360 - (idx * step + step / 2) + jitter;
      const current = ((wheelTurn % 360) + 360) % 360;
      wheelTurn += 360 * 6 + ((target - current + 360) % 360);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      disc.style.transitionDuration = reduce ? '0.01s' : '';
      disc.style.transform = `rotate(${wheelTurn}deg)`;

      let done = false;
      const finish = () => {
        if (done) return; done = true;
        $('#wheel-hint').innerHTML = `Hoạt động của bạn: <b>${act.name}</b>`;
        setTimeout(() => {
          spin.classList.add('is-leaving');
          setTimeout(() => {
            spin.hidden = true;
            $('.activity').hidden = false;
            $('.products').classList.remove('is-locked');
            resolve();
          }, reduce ? 0 : 350);
        }, reduce ? 0 : 900);
      };
      disc.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, reduce ? 50 : 5600); // dự phòng nếu transitionend không chạy
    };
  });
}

async function newRound() {
  const act = await pickActivity();
  state.activityId = act.id;
  state.attempt += 1;
  save();
  await spinWheel(act);
  renderActivity();
}
function renderActivity() {
  const act = ACTIVITIES.find((a) => a.id === state.activityId);
  if (!act) return;
  $('#activity-img').src = `hoatdong-${pad2(act.id)}.jpg`;
  $('#activity-img').alt = act.name;
  $('#activity-name').textContent = act.name;
  $('#attempt-no').textContent = state.attempt;
  selected = null;
  $$('.product').forEach((b) => b.setAttribute('aria-checked', 'false'));
  $('#btn-answer').disabled = true;
  const card = $('.activity');
  card.classList.remove('is-swap'); void card.offsetWidth; card.classList.add('is-swap');
}

$('#btn-answer').addEventListener('click', async () => {
  if (!selected) return;
  const act = ACTIVITIES.find((a) => a.id === state.activityId);
  const correct = selected === act.product;
  await API.logAttempt({ participantId: state.participantId, attempt: state.attempt, activityId: act.id, chosen: selected, correct });
  if (correct) {
    state.stage = 'won';
    state.wonProduct = act.product;
    save();
    fillProductText();
    renderStage();
    openModal('modal-correct');
  } else {
    $('#shared-check').checked = false;
    $('#btn-retry').disabled = true;
    openModal('modal-wrong');
    prepareShareFile('wrong');
  }
});

/* Sai: phải chia sẻ (tick xác nhận) rồi mới được chơi lại */
$('#shared-check').addEventListener('change', (e) => { $('#btn-retry').disabled = !e.target.checked; });
$('#btn-retry').addEventListener('click', async () => {
  await API.logAttempt({ participantId: state.participantId, attempt: state.attempt, shareConfirmed: true });
  closeModal();
  $('#game').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await newRound();
});

/* ---------- 8. KẾT QUẢ ĐÚNG ---------- */
function fillProductText() {
  const p = productOf(state.wonProduct);
  if (!p) return;
  $$('.js-product').forEach((el) => { el.textContent = productLabel(p); });
  $('#done-product').textContent = productLabel(p);
}
$('#btn-correct-next').addEventListener('click', openClaim);
$('#btn-open-claim').addEventListener('click', openClaim);

function openClaim() {
  fillProductText();
  openModal('modal-claim');
  prepareShareFile('correct');
  const img = $('#claim-img');
  const box = img.parentElement;
  const src = SHARE.poster('correct', state.wonProduct);
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  box.classList.remove('is-ready');
  img.onload = () => box.classList.add('is-ready');
  // Ảnh tạo sẵn chưa có (chưa chạy tools/generate-share.html) → tự vẽ trên trình duyệt
  img.onerror = async () => {
    img.onerror = null;
    try { img.src = URL.createObjectURL(await renderCorrectImage(productOf(state.wonProduct))); }
    catch { img.src = 'poster-correct.jpg'; }
  };
  img.src = src;
}

/* ---------- 9. CHIA SẺ ----------
   Facebook: mở hộp thoại chia sẻ của Facebook với link trang kết quả. Facebook tự
             hiện ảnh kết quả làm ảnh xem trước, người chơi chỉ cần bấm "Đăng".
   Instagram: Instagram không cho website đăng bài. Trên điện thoại, mở bảng chia sẻ
             của máy với ảnh đính kèm sẵn → chọn Instagram. Trên máy tính, hiện mã QR
             để chuyển sang điện thoại.                                             */
function captionFor(kind, platform) {
  const tag = platform === 'instagram' ? CONFIG.igTag : CONFIG.fbTag;
  // Facebook đã tự điền #SimplusYoungTet → caption chỉ cần hashtag còn lại, tránh bị lặp
  const hashtags = platform === 'facebook'
    ? CONFIG.hashtags.split(' ').filter((h) => h !== FB_AUTO_HASHTAG).join(' ')
    : CONFIG.hashtags;
  if (kind === 'correct') {
    const p = productOf(state.wonProduct);
    return `Tết Trẻ Hay Tết Xưa – Vẫn Là Tết Nhà 🧧\nMình vừa chọn đúng ${p ? productLabel(p) : 'sản phẩm'} cùng Simplus! Tham gia ngay để nhận quà Tết nhé.\n${hashtags} ${tag}`;
  }
  return `Tết Trẻ Hay Tết Xưa – Vẫn Là Tết Nhà 🧧\nMình đang chơi thử thách Tết cùng Simplus, tham gia đều được quà!\n${hashtags} ${tag}`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}
async function getShareBlob(kind) {
  const src = SHARE.poster(kind, state.wonProduct);
  const r = await fetch(src);
  if (r.ok) return r.blob();
  return renderCorrectImage(productOf(state.wonProduct));
}
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileName = (kind) => (kind === 'correct' ? 'simplus-tet-ket-qua.jpg' : 'simplus-tet-thu-lai.jpg');

/* Facebook chỉ cho điền sẵn đúng 1 hashtag → tự điền #SimplusYoungTet.
   Hashtag thứ 2 và tag @Simplus_VN nằm trong caption đã sao chép để người chơi dán. */
const FB_AUTO_HASHTAG = '#SimplusYoungTet';
function facebookShareUrl(kind) {
  const href = encodeURIComponent(SHARE.abs(SHARE.page(SHARE.slug(kind, state.wonProduct))));
  const tag = encodeURIComponent(FB_AUTO_HASHTAG);
  if (CONFIG.fbAppId) {
    return `https://www.facebook.com/dialog/share?app_id=${CONFIG.fbAppId}&display=${isMobile ? 'touch' : 'popup'}&href=${href}&hashtag=${tag}`;
  }
  return `https://www.facebook.com/sharer/sharer.php?u=${href}&hashtag=${tag}`;
}
// Facebook chỉ lấy được ảnh xem trước khi website ở địa chỉ công khai (domain thật hoặc link tunnel)
const isPublicSite = () => !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(CONFIG.siteUrl).hostname);

/* Chép ẢNH kết quả vào bộ nhớ tạm (dạng PNG) để dán thẳng vào ô đăng bài Facebook bằng Ctrl+V */
async function pngBlob(kind) {
  const bmp = await createImageBitmap(await getShareBlob(kind));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
async function copyImage(kind) {
  if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(kind) })]);
    return true;
  } catch (err) {
    console.warn('Không chép được ảnh:', err);
    return false;
  }
}

async function shareFacebook(kind) {
  API.logAttempt({ participantId: state.participantId, attempt: state.attempt, shareClicked: 'facebook' });

  const url = facebookShareUrl(kind);

  // Website đã ở địa chỉ công khai: mở thẳng Facebook (điện thoại: ứng dụng/trang Facebook; máy tính: cửa sổ nhỏ).
  // Facebook tự hiện ảnh kết quả trong bài đăng, người chơi không cần dán ảnh.
  if (isPublicSite()) {
    const w = 640, h = 680;
    const win = isMobile
      ? window.open(url, '_blank')
      : window.open(url, 'fb-share', `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`);
    if (!win) location.href = url; // trình duyệt chặn cửa sổ mới → mở ngay trong tab này
    const copied = await copyText(captionFor(kind, 'facebook'));
    $('#fb-step-img').innerHTML = 'Facebook đã mở sẵn bài đăng có <b>ảnh kết quả</b> của bạn.';
    $('#fb-step-caption').innerHTML = copied
      ? 'Bấm vào ô nội dung và <b>dán</b> caption đã được sao chép sẵn (có #SimplusTetTre và tag @Simplus_VN; #SimplusYoungTet đã có sẵn trong bài).'
      : 'Bấm <b>Sao chép caption</b> bên dưới rồi dán vào ô nội dung (có #SimplusTetTre và tag @Simplus_VN; #SimplusYoungTet đã có sẵn trong bài).';
    $('#fb-popup-note').hidden = true;
    openSheet('sheet-fb');
    return;
  }

  // Chạy trên máy (localhost): Facebook không đọc được ảnh xem trước → chép ảnh để dán bằng Ctrl+V
  const imgCopied = await copyImage(kind);
  const w = 640, h = 680;
  const win = window.open(url, 'fb-share', `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`);
  if (!imgCopied) download(await getShareBlob(kind), fileName(kind));
  $('#fb-step-img').innerHTML = imgCopied
    ? 'Ảnh kết quả <b>đã được sao chép</b>. Bấm vào ô nội dung trong cửa sổ Facebook và nhấn <b>Ctrl+V</b> để dán ảnh vào bài.'
    : 'Ảnh kết quả đã được tải về máy. Trong cửa sổ Facebook, bấm biểu tượng <b>Ảnh/video</b> và chọn file <b>' + fileName(kind) + '</b>.';
  $('#fb-step-caption').innerHTML = 'Bấm <b>Sao chép caption</b> bên dưới, rồi dán tiếp vào bài (có #SimplusTetTre và tag @Simplus_VN; #SimplusYoungTet đã có sẵn trong bài).';
  $('#fb-popup-note').hidden = !!win;
  openSheet('sheet-fb');
}

/* Ảnh chia sẻ được chuẩn bị SẴN ngay khi popup kết quả mở ra.
   Lý do: trình duyệt điện thoại (nhất là Safari iPhone) chỉ cho mở bảng chia sẻ ngay lúc người chơi bấm.
   Nếu bấm xong mới đi tải ảnh thì "lượt bấm" hết hạn → bảng chia sẻ bị chặn. */
const shareFiles = {};
function prepareShareFile(kind) {
  const key = kind + ':' + (kind === 'correct' ? state.wonProduct : '');
  if (!shareFiles[key]) {
    const entry = { file: null };
    entry.promise = getShareBlob(kind)
      .then((blob) => (entry.file = new File([blob], fileName(kind), { type: 'image/jpeg' })))
      .catch(() => { delete shareFiles[key]; return null; });
    shareFiles[key] = entry;
  }
  return shareFiles[key];
}
const canShareFile = (file) => !!(file && navigator.canShare && navigator.canShare({ files: [file] }));

// Mở ứng dụng Instagram (không phải trang web)
function instagramAppUrl() {
  if (/Android/i.test(navigator.userAgent)) {
    return 'intent://instagram.com/#Intent;scheme=https;package=com.instagram.android;S.browser_fallback_url=https%3A%2F%2Fwww.instagram.com%2F;end';
  }
  return 'instagram://camera';
}

function igSheetMobile(text, { shareFile = null, download: dl = null, openApp = false, copied }) {
  $('#ig-title').textContent = 'Chia sẻ lên Instagram';
  $('#ig-desktop').hidden = true;
  $('#ig-mobile').hidden = false;
  $('#ig-mobile-text').innerHTML = text;
  $('#ig-copied').hidden = !copied;
  $('#ig-download').hidden = !dl;
  if (dl) $('#ig-download').onclick = dl;
  $('#ig-share-now').hidden = !shareFile;
  $('#ig-share-now').onclick = shareFile ? () => {
    navigator.share({ files: [shareFile] })
      .then(() => { $('#sheet-ig').hidden = true; toast('Nhớ dán caption đã sao chép vào bài đăng Instagram nhé!', 6000); })
      .catch(() => {});
  } : null;
  $('#ig-open-app').hidden = !openApp;
  $('#ig-open-app').href = instagramAppUrl();
  $('#ig-ok').hidden = !!(shareFile || openApp);
  openSheet('sheet-ig');
}

function shareInstagram(kind) {
  API.logAttempt({ participantId: state.participantId, attempt: state.attempt, shareClicked: 'instagram' });
  const caption = captionFor(kind, 'instagram');
  const entry = prepareShareFile(kind);

  if (isMobile) {
    // Gọi bảng chia sẻ NGAY (không chờ gì trước đó), chỉ gửi ảnh: Instagram bỏ qua chữ đi kèm
    if (canShareFile(entry.file)) {
      const copying = copyText(caption);
      navigator.share({ files: [entry.file] })
        .then(async () => toast((await copying)
          ? 'Caption đã được sao chép – dán vào bài đăng Instagram nhé!'
          : 'Nhớ thêm hashtag và tag @simplusvietnam vào bài đăng nhé!', 6000))
        .catch(async (err) => {
          if (err.name === 'AbortError') return; // người chơi tự đóng bảng chia sẻ
          // Trình duyệt chặn → cho bấm lại 1 lần nữa trong bảng hướng dẫn
          igSheetMobile('Bấm nút bên dưới, rồi chọn biểu tượng <b>Instagram</b> trong bảng chia sẻ. Ảnh kết quả sẽ được đính kèm sẵn.',
            { shareFile: entry.file, copied: await copying });
        });
      return;
    }
    // Ảnh chưa tải xong hoặc trình duyệt không hỗ trợ (vd. trình duyệt trong Zalo/Messenger/Facebook)
    (async () => {
      const copied = await copyText(caption);
      const file = entry.file || (await entry.promise);
      if (canShareFile(file)) {
        igSheetMobile('Bấm nút bên dưới, rồi chọn biểu tượng <b>Instagram</b> trong bảng chia sẻ. Ảnh kết quả sẽ được đính kèm sẵn.',
          { shareFile: file, copied });
        return;
      }
      if (file) download(file, fileName(kind));
      igSheetMobile('Trình duyệt này không gửi ảnh thẳng sang Instagram được nên ảnh kết quả <b>đã được lưu về máy</b>. '
        + 'Bấm <b>Mở Instagram</b>, chọn dấu <b>+</b> và chọn ảnh vừa lưu.<br><small>Mẹo: mở website bằng Chrome hoặc Safari để chia sẻ nhanh hơn.</small>',
        { openApp: true, copied, download: file ? () => download(file, fileName(kind)) : null });
    })();
    return;
  }

  // Máy tính: mã QR để đăng từ điện thoại
  (async () => {
    const copied = await copyText(caption);
    const imgUrl = SHARE.abs(SHARE.poster(kind, state.wonProduct));
    $('#ig-title').textContent = 'Đăng lên Instagram từ điện thoại';
    $('#ig-desktop').hidden = false;
    $('#ig-mobile').hidden = true;
    $('#ig-share-now').hidden = true;
    $('#ig-open-app').hidden = true;
    $('#ig-ok').hidden = false;
    $('#ig-qr').innerHTML = '';
    if (window.QRCode) new QRCode($('#ig-qr'), { text: imgUrl, width: 180, height: 180, colorDark: '#0e2a73' });
    $('#ig-copied').hidden = !copied;
    $('#ig-download').hidden = false;
    $('#ig-download').onclick = async () => download(entry.file || (await getShareBlob(kind)), fileName(kind));
    openSheet('sheet-ig');
  })();
}

$$('[data-share]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.share === 'facebook') shareFacebook(b.dataset.kind); else shareInstagram(b.dataset.kind);
}));
$$('[data-download]').forEach((b) => b.addEventListener('click', async () => {
  const kind = b.dataset.download;
  download(await getShareBlob(kind), fileName(kind));
}));
$('#fb-recopy').addEventListener('click', async () => {
  const kind = $('#modal-wrong').hidden ? 'correct' : 'wrong';
  if (await copyText(captionFor(kind, 'facebook'))) toast('Đã sao chép caption – dán vào bài đăng (Ctrl+V).');
});

/* ---------- 10. KHỞI TẠO ---------- */
function renderStage() {
  $('#intro').hidden = state.stage === 'playing' || state.stage === 'won';
  $('#game').hidden = state.stage !== 'playing';
  $('#done').hidden = state.stage !== 'won';
}
function init() {
  $$('.js-zalo').forEach((el) => { el.textContent = CONFIG.zaloNumber; });
  const zaloDigits = CONFIG.zaloNumber.replace(/\D/g, '');
  const zl = $('#zalo-link');
  if (zaloDigits) zl.href = 'https://zalo.me/' + zaloDigits; else zl.hidden = true;

  renderProducts();
  buildWheel();
  // Chưa có file video trên hosting → ẩn khung video, khối mạng xã hội/đối tác vẫn hiện
  const kol = $('#kol-video');
  if (kol) {
    const hideVideo = () => $('.extras').classList.add('no-video');
    kol.addEventListener('error', hideVideo);
    // Video chỉ tải khi bấm phát (preload="none"), nên hỏi trước xem file có trên hosting không
    fetch(kol.getAttribute('src'), { method: 'HEAD' }).then((r) => { if (!r.ok) hideVideo(); }).catch(() => {});
  }
  if (state.stage === 'playing') renderActivity();
  if (state.stage === 'won') fillProductText();
  renderStage();
  EventQueue.flush(); // gửi bù log còn sót từ lần trước (nếu có)
  // Không tự mở popup khi mới vào: người xem bấm "Tham gia ngay" hoặc tab 1 thì mới hiện form đăng ký.
}
init();
