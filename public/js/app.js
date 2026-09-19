import { normalizePlate } from './plate.js';
import { recognizePlate, warmupOcr } from './ocr.js';

// 촬영 가이드 박스(중앙) 비율 — 이 영역만 잘라 인식
const CROP_FRAC = { wf: 0.86, hf: 0.30 };

// ── 상태 & API ────────────────────────────────────────────────
const state = { token: localStorage.getItem('token') || null, user: null };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

const $ = (id) => document.getElementById(id);
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2500);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 로그인 ────────────────────────────────────────────────────
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { username: $('loginUser').value.trim(), password: $('loginPass').value },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    enterApp();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  state.token = null;
  state.user = null;
  stopCamera();
  $('appView').hidden = true;
  $('loginView').hidden = false;
});

function enterApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('whoami').textContent = `${state.user.name || state.user.username} (${state.user.role === 'admin' ? '관리자' : '운영진'})`;
  document.querySelectorAll('.admin-only').forEach((el) => (el.hidden = state.user.role !== 'admin'));
  switchTab('scan');
}

async function restore() {
  if (!state.token) return;
  try {
    const { user } = await api('/auth/me');
    state.user = user;
    enterApp();
  } catch {
    localStorage.removeItem('token');
    state.token = null;
  }
}

// ── 탭 네비게이션 ─────────────────────────────────────────────
$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) switchTab(btn.dataset.tab);
});
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  if (name === 'vehicles') loadVehicles();
  if (name === 'logs') loadLogs();
  if (name === 'users') loadUsers();
}

// ── 단속: 카메라 & OCR ────────────────────────────────────────
let stream = null;
const video = $('video'), canvas = $('canvas'), preview = $('preview'), ph = $('cameraPlaceholder');

const guide = $('camGuide');

$('startCamBtn').addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    await video.play();
    video.hidden = false; guide.hidden = false; ph.hidden = true; preview.hidden = true;
    $('startCamBtn').hidden = true; $('captureBtn').hidden = false; $('stopCamBtn').hidden = false;
    warmupOcr((m) => ($('ocrStatus').textContent = m)).catch(() => {}); // 미리 엔진 준비
  } catch {
    toast('카메라를 열 수 없습니다. 권한을 확인하거나 사진 업로드를 사용하세요.');
  }
});
$('stopCamBtn').addEventListener('click', stopCamera);
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.hidden = true; guide.hidden = true;
  $('startCamBtn').hidden = false; $('captureBtn').hidden = true; $('stopCamBtn').hidden = true;
  if (!preview.src) ph.hidden = false;
}

$('captureBtn').addEventListener('click', () => {
  // 미리보기: 전체 프레임
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  preview.src = canvas.toDataURL('image/jpeg', 0.9);
  preview.hidden = false; video.hidden = true; guide.hidden = true; ph.hidden = true;
  $('clearBtn').hidden = false;
  // 인식: 가이드 영역만 크롭
  runOcr(canvas, { cropFrac: CROP_FRAC });
  stopCamera();
});

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    preview.hidden = false; ph.hidden = true;
    $('clearBtn').hidden = false;
    const img = new Image();
    img.onload = () => runOcr(img, {}); // 업로드 사진은 전체 인식
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// 사진 지우기 → 초기화 후 바로 다음 차량 촬영/업로드 가능
$('clearBtn').addEventListener('click', resetScan);
function resetScan() {
  stopCamera();
  preview.src = ''; preview.hidden = true;
  ph.hidden = false;
  $('plateInput').value = '';
  $('scanResult').hidden = true;
  $('ocrStatus').textContent = '';
  $('fileInput').value = ''; // 같은 파일 재업로드 가능하도록 초기화
  $('clearBtn').hidden = true;
}

async function runOcr(src, opts) {
  const status = (m) => ($('ocrStatus').textContent = m);
  try {
    const r = await recognizePlate(src, opts, status);
    if (r.plate) {
      $('plateInput').value = r.plate;
      status(
        r.valid
          ? `✓ 인식됨: ${r.plate} — 자동 조회합니다.`
          : `인식 결과: "${r.raw.replace(/\s+/g, ' ').slice(0, 30)}" — 자동 조회하니 필요 시 수정하세요.`
      );
      doScan(false); // 인식되면 바로 자동 조회
    } else {
      status('번호를 인식하지 못했습니다. 번호판이 가이드 박스를 꽉 채우도록 다시 촬영하거나 직접 입력하세요.');
    }
  } catch {
    status('OCR 처리 실패 — 번호를 직접 입력하세요.');
  }
}

// ── 단속: 조회 & 저장 ─────────────────────────────────────────
$('lookupBtn').addEventListener('click', () => doScan(false));
$('saveScanBtn').addEventListener('click', () => doScan(true));

async function doScan(save) {
  const plate = normalizePlate($('plateInput').value);
  if (!plate) return toast('차량번호를 입력하세요.');
  try {
    const c = save
      ? await api('/scans', { method: 'POST', body: { plate } })
      : await api('/scans/lookup?plate=' + encodeURIComponent(plate));
    renderScanResult(c, save);
  } catch (err) {
    toast(err.message);
  }
}

function resultClass(result) {
  if (result === 'resident') return 'ok';
  if (result === 'visitor_valid') return 'ok';
  if (result === 'visitor_expired' || result === 'visitor_notyet') return 'warn';
  return 'danger';
}
function renderScanResult(c, saved) {
  const box = $('scanResult');
  box.hidden = false;
  box.className = 'result-box ' + resultClass(c.result);
  const v = c.vehicle;
  let detail = '';
  if (v) {
    const parts = [];
    if (v.owner_name) parts.push(`소유자: ${esc(v.owner_name)}`);
    if (v.dong || v.ho) parts.push(`${esc(v.dong || '')}동 ${esc(v.ho || '')}호`);
    if (v.phone) parts.push(`연락처: ${esc(v.phone)}`);
    if (v.type === 'visitor' && (v.visit_start || v.visit_end)) {
      parts.push(`방문기간: ${fmt(v.visit_start)} ~ ${fmt(v.visit_end)}`);
    }
    if (v.memo) parts.push(`메모: ${esc(v.memo)}`);
    detail = `<div class="result-detail">${parts.join('<br>')}</div>`;
  }
  box.innerHTML = `
    <div class="result-plate">${esc(c.plate)}</div>
    <div class="result-label">${esc(c.label)}</div>
    ${detail}
    ${saved ? '<div class="result-saved">✓ 단속 기록에 저장되었습니다.</div>' : ''}
  `;
}

// ── 차량 관리 ─────────────────────────────────────────────────
let vehSearchTimer;
$('vehSearch').addEventListener('input', () => {
  clearTimeout(vehSearchTimer);
  vehSearchTimer = setTimeout(loadVehicles, 250);
});
$('vehTypeFilter').addEventListener('change', loadVehicles);
$('addVehicleBtn').addEventListener('click', () => vehicleForm(null));

async function loadVehicles() {
  const q = $('vehSearch').value.trim();
  const type = $('vehTypeFilter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  const rows = await api('/vehicles?' + params);
  const list = $('vehicleList');
  if (!rows.length) { list.innerHTML = '<p class="empty">등록된 차량이 없습니다.</p>'; return; }
  const isAdmin = state.user.role === 'admin';
  list.innerHTML = rows.map((v) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title">
          <span class="badge ${v.type}">${v.type === 'resident' ? '입주민' : '방문객'}</span>
          <b>${esc(v.plate_raw || v.plate)}</b>
        </div>
        <div class="item-sub">
          ${[v.owner_name, (v.dong || v.ho) ? `${esc(v.dong||'')}동 ${esc(v.ho||'')}호` : '', v.phone].filter(Boolean).map(esc).join(' · ')}
          ${v.type === 'visitor' && (v.visit_start || v.visit_end) ? `<br><span class="muted">방문: ${fmt(v.visit_start)} ~ ${fmt(v.visit_end)}</span>` : ''}
        </div>
      </div>
      <div class="item-actions">
        ${(isAdmin || v.type === 'visitor') ? `<button class="btn ghost small" data-edit="${v.id}">수정</button>` : ''}
        ${isAdmin ? `<button class="btn danger small" data-del="${v.id}">삭제</button>` : ''}
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => vehicleForm(rows.find((r) => r.id == b.dataset.edit))));
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('이 차량을 삭제할까요?')) return;
      await api('/vehicles/' + b.dataset.del, { method: 'DELETE' });
      toast('삭제되었습니다.'); loadVehicles();
    }));
}

function vehicleForm(v) {
  const isAdmin = state.user.role === 'admin';
  const editing = !!v;
  const t = v?.type || (isAdmin ? 'resident' : 'visitor');
  openModal(editing ? '차량 수정' : '차량 등록', `
    <form id="vForm" class="modal-form">
      <label>구분
        <select id="vType" ${isAdmin ? '' : 'disabled'}>
          <option value="resident" ${t === 'resident' ? 'selected' : ''}>입주민</option>
          <option value="visitor" ${t === 'visitor' ? 'selected' : ''}>방문객</option>
        </select>
        ${isAdmin ? '' : '<small class="muted">운영진은 방문객 차량만 등록 가능합니다.</small>'}
      </label>
      <label>차량번호<input id="vPlate" value="${esc(v?.plate_raw || v?.plate || '')}" placeholder="예: 21다2312" required /></label>
      <label>소유자/방문자명<input id="vOwner" value="${esc(v?.owner_name || '')}" /></label>
      <div class="grid2">
        <label>동<input id="vDong" value="${esc(v?.dong || '')}" /></label>
        <label>호<input id="vHo" value="${esc(v?.ho || '')}" /></label>
      </div>
      <label>연락처<input id="vPhone" value="${esc(v?.phone || '')}" /></label>
      <div id="visitFields" class="grid2" ${t === 'visitor' ? '' : 'hidden'}>
        <label>방문 시작<input id="vStart" type="datetime-local" value="${toLocalInput(v?.visit_start)}" /></label>
        <label>방문 종료<input id="vEnd" type="datetime-local" value="${toLocalInput(v?.visit_end)}" /></label>
      </div>
      <label>메모<textarea id="vMemo" rows="2">${esc(v?.memo || '')}</textarea></label>
      <button class="btn primary block" type="submit">${editing ? '수정 저장' : '등록'}</button>
    </form>
  `);
  $('vType').addEventListener('change', (e) => {
    $('visitFields').hidden = e.target.value !== 'visitor';
  });
  $('vForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      type: $('vType').value,
      plate: $('vPlate').value,
      owner_name: $('vOwner').value,
      dong: $('vDong').value,
      ho: $('vHo').value,
      phone: $('vPhone').value,
      memo: $('vMemo').value,
      visit_start: $('vStart') && !$('visitFields').hidden ? fromLocalInput($('vStart').value) : null,
      visit_end: $('vEnd') && !$('visitFields').hidden ? fromLocalInput($('vEnd').value) : null,
    };
    try {
      if (editing) await api('/vehicles/' + v.id, { method: 'PUT', body });
      else await api('/vehicles', { method: 'POST', body });
      closeModal(); toast('저장되었습니다.'); loadVehicles();
    } catch (err) { toast(err.message); }
  });
}

// ── 단속 기록 ─────────────────────────────────────────────────
let logTimer;
$('logSearch').addEventListener('input', () => { clearTimeout(logTimer); logTimer = setTimeout(loadLogs, 250); });
$('logResultFilter').addEventListener('change', loadLogs);

async function loadLogs() {
  const params = new URLSearchParams();
  if ($('logSearch').value.trim()) params.set('q', $('logSearch').value.trim());
  if ($('logResultFilter').value) params.set('result', $('logResultFilter').value);
  const rows = await api('/scans?' + params);
  const list = $('logList');
  if (!rows.length) { list.innerHTML = '<p class="empty">단속 기록이 없습니다.</p>'; return; }
  const isAdmin = state.user.role === 'admin';
  list.innerHTML = rows.map((r) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title"><span class="badge ${resultClass(r.result)}">${resultLabel(r.result)}</span> <b>${esc(r.plate)}</b></div>
        <div class="item-sub muted">${fmt(r.scanned_at)} · ${esc(r.scanned_by_name || '')} ${r.location ? '· ' + esc(r.location) : ''}</div>
      </div>
      ${isAdmin ? `<div class="item-actions"><button class="btn danger small" data-dellog="${r.id}">삭제</button></div>` : ''}
    </div>`).join('');
  list.querySelectorAll('[data-dellog]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('/scans/' + b.dataset.dellog, { method: 'DELETE' });
      toast('삭제되었습니다.'); loadLogs();
    }));
}
function resultLabel(r) {
  return { resident: '입주민', visitor_valid: '방문객(유효)', visitor_expired: '방문객(만료)', visitor_notyet: '방문객(이전)', unknown: '미인식' }[r] || r;
}

// ── 사용자 관리 ───────────────────────────────────────────────
$('addUserBtn').addEventListener('click', () => userForm());
async function loadUsers() {
  const rows = await api('/users');
  const list = $('userList');
  list.innerHTML = rows.map((u) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title"><span class="badge ${u.role}">${u.role === 'admin' ? '관리자' : '운영진'}</span> <b>${esc(u.username)}</b> ${u.active ? '' : '<span class="muted">(비활성)</span>'}</div>
        <div class="item-sub muted">${esc(u.name || '')} · 생성 ${fmt(u.created_at)}</div>
      </div>
      <div class="item-actions">
        <button class="btn ghost small" data-edituser="${u.id}">수정</button>
        ${u.id !== state.user.id ? `<button class="btn danger small" data-deluser="${u.id}">삭제</button>` : ''}
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-edituser]').forEach((b) =>
    b.addEventListener('click', () => userForm(rows.find((r) => r.id == b.dataset.edituser))));
  list.querySelectorAll('[data-deluser]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('이 계정을 삭제할까요?')) return;
      await api('/users/' + b.dataset.deluser, { method: 'DELETE' });
      toast('삭제되었습니다.'); loadUsers();
    }));
}
function userForm(u) {
  const editing = !!u;
  openModal(editing ? '계정 수정' : '계정 추가', `
    <form id="uForm" class="modal-form">
      <label>아이디<input id="uName" value="${esc(u?.username || '')}" ${editing ? 'disabled' : ''} required /></label>
      <label>이름<input id="uDisplay" value="${esc(u?.name || '')}" /></label>
      <label>권한
        <select id="uRole">
          <option value="operator" ${u?.role === 'operator' ? 'selected' : ''}>운영진</option>
          <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>관리자</option>
        </select>
      </label>
      <label>${editing ? '새 비밀번호 (변경 시에만 입력)' : '비밀번호'}<input id="uPass" type="password" ${editing ? '' : 'required'} /></label>
      ${editing ? `<label class="checkbox"><input id="uActive" type="checkbox" ${u.active ? 'checked' : ''}/> 활성 계정</label>` : ''}
      <button class="btn primary block" type="submit">${editing ? '저장' : '추가'}</button>
    </form>
  `);
  $('uForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const body = { role: $('uRole').value, name: $('uDisplay').value, active: $('uActive').checked };
        if ($('uPass').value) body.password = $('uPass').value;
        await api('/users/' + u.id, { method: 'PUT', body });
      } else {
        await api('/users', { method: 'POST', body: {
          username: $('uName').value.trim(), password: $('uPass').value,
          role: $('uRole').value, name: $('uDisplay').value } });
      }
      closeModal(); toast('저장되었습니다.'); loadUsers();
    } catch (err) { toast(err.message); }
  });
}

// ── 비밀번호 변경 ─────────────────────────────────────────────
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: $('curPw').value, newPassword: $('newPw').value } });
    $('pwMsg').textContent = '비밀번호가 변경되었습니다.';
    $('curPw').value = ''; $('newPw').value = '';
  } catch (err) { $('pwMsg').textContent = err.message; }
});

// ── 모달 & 유틸 ───────────────────────────────────────────────
function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; }
$('modalClose').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function fmt(iso) {
  if (!iso) return '-';
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  return d.toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

restore();
