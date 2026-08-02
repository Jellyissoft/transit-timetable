/* 환승 시간표 PWA — 전체 로직 (오프라인, 서버 없음, localStorage 저장) */
'use strict';

// ────────────────────────────────────────────────────────────── 상수
const TRANSPORT = ['지하철', '버스', 'KTX', 'ITX', '일반열차', '도보', '기타'];
const SERVICE_DAY = [
  { v: 'weekday', l: '평일' },
  { v: 'saturday', l: '토요일' },
  { v: 'sunday_holiday', l: '일요일·공휴일' },
  { v: 'custom_weekdays', l: '사용자 지정 요일' },
  { v: 'specific_dates', l: '특정 날짜' },
];
const DOW = [
  { v: 1, l: '월' }, { v: 2, l: '화' }, { v: 3, l: '수' }, { v: 4, l: '목' },
  { v: 5, l: '금' }, { v: 6, l: '토' }, { v: 7, l: '일' },
];
const STORE_KEY = 'transit_tt_db_v1';
const SCHEMA_VERSION = 1;

// ────────────────────────────────────────────────────────────── 유틸
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = 'id') => `${p}-${(Math.random().toString(36).slice(2, 8))}`;
const pad2 = (n) => String(n).padStart(2, '0');

function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tt';
}

// 시간 "HH:MM"(0~47시 허용, 24+ = 자정 넘김 표기) → 분. 실패 시 NaN
function parseTime(s) {
  if (s == null) return NaN;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = +m[1], mi = +m[2];
  if (h > 47 || mi > 59) return NaN;
  return h * 60 + mi;
}
const isValidTime = (s) => !Number.isNaN(parseTime(s));
// 분 → "HH:MM" (하루 안, 24로 나눈 나머지)
const fmtMin = (min) => `${pad2(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad2((((min % 60) + 60) % 60))}`;

// 날짜 유틸 (로컬)
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime()); }
function isoDow(dateStr) { // 1=월 .. 7=일
  const d = new Date(dateStr + 'T00:00:00');
  return ((d.getDay() + 6) % 7) + 1;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ────────────────────────────────────────────────────────────── 저장소
function emptyDB() {
  return { version: SCHEMA_VERSION, templates: [], routes: [], holidays: [] };
}
let DB = emptyDB();

function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) { DB = emptyDB(); seedIfFirstRun(); return; }
    const obj = JSON.parse(raw);
    DB = Object.assign(emptyDB(), obj);
    DB.templates = DB.templates || [];
    DB.routes = DB.routes || [];
    DB.holidays = DB.holidays || [];
  } catch (e) {
    console.error('DB 로드 실패', e);
    DB = emptyDB();
  }
}
function saveDB() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
  catch (e) { console.error('DB 저장 실패', e); toast('저장 실패: 저장공간 확인'); }
}
const tplById = (id) => DB.templates.find((t) => t.id === id);

// ────────────────────────────────────────────────────────────── 입력 파서
// 1) 줄단위 / 2) 쉼표 → 시간 목록
function parseTimeList(text) {
  return String(text || '')
    .split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}
// 3) CSV 붙여넣기 → [{dep, arr}]  (dep[,arr], 헤더 자동 스킵)
function parseCSV(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cols = line.split(/[,\t]/).map((c) => c.trim());
    if (!isValidTime(cols[0])) continue; // 헤더/잡줄 스킵
    out.push({ dep: cols[0], arr: isValidTime(cols[1]) ? cols[1] : null });
  }
  return out;
}
// 4) 간격 규칙 → 시간 목록. rules: [{start,end,interval(min)}]
function generateByRules(rules) {
  const set = new Set();
  for (const r of rules) {
    const s = parseTime(r.start), e = parseTime(r.end), iv = +r.interval;
    if (Number.isNaN(s) || Number.isNaN(e) || !iv || iv <= 0 || e < s) continue;
    for (let m = s; m <= e; m += iv) set.add(fmtMin(m));
  }
  return Array.from(set).sort();
}
function sortTimes(list) {
  return [...list].sort((a, b) => parseTime(a) - parseTime(b));
}

// ────────────────────────────────────────────────────────────── 검증
function validateTemplate(t, { forSave = true } = {}) {
  const errors = [], warnings = [];
  if (!t.name || !t.name.trim()) errors.push('시간표 이름이 비어 있습니다.');
  if (!t.transportType) errors.push('교통수단 종류가 없습니다.');
  if (!t.id || !t.id.trim()) errors.push('템플릿 ID가 없습니다.');
  // ID 중복(자기 자신 제외)
  if (forSave && DB.templates.some((x) => x.id === t.id && x !== t._orig)) {
    errors.push(`템플릿 ID 중복: ${t.id}`);
  }

  if (t.scheduleType === 'simple') {
    if (!t.serviceDayType) errors.push('운행일 유형이 지정되지 않았습니다.');
    if (t.serviceDayType === 'custom_weekdays' && !(t.customDays || []).length)
      errors.push('사용자 지정 요일이 선택되지 않았습니다.');
    if (t.serviceDayType === 'specific_dates') {
      if (!(t.specificDates || []).length) errors.push('특정 날짜가 없습니다.');
      (t.specificDates || []).forEach((d) => { if (!isValidDate(d)) errors.push(`날짜 형식 오류: ${d}`); });
    }
    const deps = t.departureTimes || [];
    if (!deps.length) errors.push('출발 시각이 하나도 없습니다.');
    deps.forEach((d) => { if (!isValidTime(d)) errors.push(`잘못된 시간 형식: ${d}`); });
    // 중복 출발
    const seen = new Set(), dup = new Set();
    deps.forEach((d) => { if (seen.has(d)) dup.add(d); seen.add(d); });
    if (dup.size) errors.push(`출발 시각 중복: ${[...dup].join(', ')}`);
    // 도착/소요
    const arrs = t.arrivalTimes || [];
    if (arrs.length) {
      if (arrs.length !== deps.length) warnings.push('도착 시각 개수가 출발 시각 개수와 다릅니다(부족분은 소요시간으로 대체).');
      arrs.forEach((a, i) => {
        if (a == null || a === '') return;
        if (!isValidTime(a)) { errors.push(`잘못된 도착 시간: ${a}`); return; }
        const dv = parseTime(deps[i]), av = parseTime(a);
        if (!Number.isNaN(dv) && av < dv) warnings.push(`도착이 출발보다 빠름(자정 넘김으로 처리): ${deps[i]}→${a}`);
      });
    } else if (t.defaultTravelMinutes == null || t.defaultTravelMinutes === '') {
      warnings.push('도착 시각도, 기본 이동 소요 시간도 없습니다 — 환승 계산 시 이 구간 이후를 이을 수 없습니다.');
    }
  } else if (t.scheduleType === 'trips') {
    const trips = t.trips || [];
    if (!trips.length) errors.push('개별 운행편이 하나도 없습니다.');
    const seenId = new Set();
    trips.forEach((tr, i) => {
      const tag = tr.tripId || `#${i + 1}`;
      if (!isValidTime(tr.departureTime)) errors.push(`[${tag}] 출발 시각 형식 오류: ${tr.departureTime}`);
      if (tr.arrivalTime && !isValidTime(tr.arrivalTime)) errors.push(`[${tag}] 도착 시각 형식 오류: ${tr.arrivalTime}`);
      if (isValidTime(tr.departureTime) && isValidTime(tr.arrivalTime)) {
        const dv = parseTime(tr.departureTime), av = parseTime(tr.arrivalTime);
        if (av < dv && !tr.arrivalDayOffset)
          warnings.push(`[${tag}] 도착이 출발보다 빠른데 arrivalDayOffset 미지정 — 자동으로 +1일 처리`);
      }
      if (!(tr.operatingDays || []).length && !(tr.additionalDates || []).length)
        errors.push(`[${tag}] 운행 요일이 지정되지 않았습니다.`);
      if (tr.tripId) { if (seenId.has(tr.tripId)) errors.push(`운행편 ID 중복: ${tr.tripId}`); seenId.add(tr.tripId); }
    });
  } else {
    errors.push('시간표 종류(단순배차/개별운행편)가 없습니다.');
  }
  return { errors, warnings };
}

// ────────────────────────────────────────────────────────────── 운행일 판정 / 운행편 전개
function isHoliday(dateStr) { return DB.holidays.includes(dateStr); }

function simpleRunsOn(t, dateStr) {
  const iso = isoDow(dateStr), hol = isHoliday(dateStr);
  switch (t.serviceDayType) {
    case 'weekday': return iso >= 1 && iso <= 5 && !hol;
    case 'saturday': return iso === 6 && !hol;
    case 'sunday_holiday': return iso === 7 || hol;
    case 'custom_weekdays': return (t.customDays || []).includes(iso);
    case 'specific_dates': return (t.specificDates || []).includes(dateStr);
    default: return false;
  }
}

// 특정 날짜의 출발편 목록 → [{depMin, arrFromMid(절대분, 자정넘김이면 >1440), tripId, label}]
function expandDepartures(t, dateStr) {
  const out = [];
  if (!t) return out;
  if (t.scheduleType === 'simple') {
    if (!simpleRunsOn(t, dateStr)) return out;
    const deps = t.departureTimes || [], arrs = t.arrivalTimes || [];
    deps.forEach((d, i) => {
      const depMin = parseTime(d);
      if (Number.isNaN(depMin)) return;
      let arrFromMid = null;
      const a = arrs[i];
      if (a != null && a !== '' && isValidTime(a)) {
        let av = parseTime(a);
        if (av < depMin) av += 1440; // 자정 넘김
        arrFromMid = av;
      } else if (t.defaultTravelMinutes != null && t.defaultTravelMinutes !== '') {
        arrFromMid = depMin + Number(t.defaultTravelMinutes);
      }
      out.push({ depMin, arrFromMid, tripId: null, label: fmtMin(depMin) });
    });
  } else if (t.scheduleType === 'trips') {
    const iso = isoDow(dateStr);
    for (const tr of (t.trips || [])) {
      let runs = (tr.operatingDays || []).includes(iso);
      if ((tr.excludedDates || []).includes(dateStr)) runs = false;
      if ((tr.additionalDates || []).includes(dateStr)) runs = true;
      if (!runs) continue;
      const depMin = parseTime(tr.departureTime);
      if (Number.isNaN(depMin)) continue;
      let arrFromMid = null;
      if (tr.arrivalTime && isValidTime(tr.arrivalTime)) {
        let av = parseTime(tr.arrivalTime);
        const off = tr.arrivalDayOffset != null ? Number(tr.arrivalDayOffset) : (av < depMin ? 1 : 0);
        arrFromMid = av + off * 1440;
      } else if (t.defaultTravelMinutes != null && t.defaultTravelMinutes !== '') {
        arrFromMid = depMin + Number(t.defaultTravelMinutes);
      }
      out.push({ depMin, arrFromMid, tripId: tr.tripId || null, label: fmtMin(depMin) });
    }
  }
  out.sort((a, b) => a.depMin - b.depMin);
  return out;
}

// ────────────────────────────────────────────────────────────── 환승 계산 엔진
// route, 시작날짜, 출발 시간창(분) → journeys[]
function computeJourneys(route, startDate, winFrom, winTo, maxResults = 6) {
  const segs = (route.segments || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!segs.length) return { error: '경로에 구간이 없습니다.', journeys: [] };
  const t0 = tplById(segs[0].timetableId);
  if (!t0) return { error: '첫 구간의 시간표 템플릿을 찾을 수 없습니다.', journeys: [] };

  const firstDeps = expandDepartures(t0, startDate).filter((d) => d.depMin >= winFrom && d.depMin <= winTo);
  const journeys = [];
  for (const fd of firstDeps) {
    const j = buildJourney(segs, startDate, fd);
    if (j) journeys.push(j);
    if (journeys.length >= maxResults) break;
  }
  return { error: null, journeys, firstCount: firstDeps.length };
}

// 환승 1회에 허용할 최대 대기(분). 이보다 오래 기다려야 하면 '막차 이후'로 보고 연결 실패 처리.
const MAX_CONNECT_WAIT = 240;
function findNextDeparture(t, startDate, readyAbs) {
  // readyAbs: 시작날짜 00:00 기준 절대분. 이후 최속 출발편 탐색(자정 넘김 대비 +2일까지)
  const baseDay = Math.floor(readyAbs / 1440);
  for (let od = baseDay; od <= baseDay + 2; od++) {
    const dateStr = addDays(startDate, od);
    const deps = expandDepartures(t, dateStr);
    for (const d of deps) {
      const absDep = od * 1440 + d.depMin;
      if (absDep >= readyAbs) {
        if (absDep - readyAbs > MAX_CONNECT_WAIT) return null; // 막차 이후 — 이 여정은 버림
        const arrAbs = d.arrFromMid != null ? od * 1440 + d.arrFromMid : null;
        return { absDep, arrAbs, tripId: d.tripId };
      }
    }
  }
  return null;
}

function buildJourney(segs, startDate, firstDep) {
  const legs = [];
  let prevArrAbs = null;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const t = tplById(seg.timetableId);
    if (!t) return null;
    let absDep, arrAbs, tripId;
    if (i === 0) {
      absDep = firstDep.depMin;
      arrAbs = firstDep.arrFromMid != null ? firstDep.arrFromMid : null;
      tripId = firstDep.tripId;
    } else {
      const prevSeg = segs[i - 1];
      const buffer = (Number(prevSeg.transferMinutes) || 0) + (Number(prevSeg.extraBufferMinutes) || 0);
      if (prevArrAbs == null) return null; // 이전 구간 도착 불명 → 연결 불가
      const readyAbs = prevArrAbs + buffer;
      const nx = findNextDeparture(t, startDate, readyAbs);
      if (!nx) return null;
      absDep = nx.absDep; arrAbs = nx.arrAbs; tripId = nx.tripId;
    }
    // 중간 구간인데 도착 불명이면 다음 연결 불가
    if (arrAbs == null && i < segs.length - 1) return null;
    const waitBefore = i === 0 ? 0 : (absDep - prevArrAbs);
    legs.push({ seg, t, absDep, arrAbs, tripId, waitBefore });
    prevArrAbs = arrAbs != null ? arrAbs : absDep;
  }
  const firstBoard = legs[0].absDep;
  const lastArr = legs[legs.length - 1].arrAbs != null ? legs[legs.length - 1].arrAbs : legs[legs.length - 1].absDep;
  const totalWait = legs.reduce((s, l) => s + (l.waitBefore || 0), 0);
  const rideTime = legs.reduce((s, l) => s + (l.arrAbs != null ? (l.arrAbs - l.absDep) : 0), 0);
  return { legs, firstBoard, lastArr, totalDuration: lastArr - firstBoard, totalWait, rideTime, startDate };
}

function absLabel(startDate, abs) {
  const od = Math.floor(abs / 1440);
  const hhmm = fmtMin(abs);
  return od > 0 ? `${hhmm} (+${od}일)` : hhmm;
}
function humanDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}시간 ${m}분` : `${m}분`;
}

// ────────────────────────────────────────────────────────────── 탭 라우팅
let currentTab = 'search';
function showTab(name) {
  currentTab = name;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  ({ search: renderSearch, routes: renderRoutes, templates: renderTemplates, data: renderData }[name])();
}

// ────────────────────────────────────────────────────────────── 뷰: 환승 검색
const searchState = { routeId: null, date: null, from: null, to: null };
function renderSearch() {
  const el = $('#view-search');
  if (!DB.routes.length) {
    el.innerHTML = `<div class="empty">아직 경로가 없습니다.<br><br>
      <button class="btn primary" data-go="routes">🧭 경로 만들러 가기</button></div>`;
    el.querySelector('[data-go]').onclick = () => showTab('routes');
    return;
  }
  if (!searchState.routeId || !DB.routes.some(r => r.routeId === searchState.routeId))
    searchState.routeId = DB.routes[0].routeId;
  if (!searchState.date) searchState.date = todayStr();
  if (searchState.from == null) { searchState.from = fmtMin(nowMin()); searchState.to = fmtMin(Math.min(nowMin() + 180, 1439)); }

  el.innerHTML = `
    <div class="card">
      <label class="field"><span>경로</span>
        <select id="s_route">${DB.routes.map(r => `<option value="${r.routeId}" ${r.routeId === searchState.routeId ? 'selected' : ''}>${esc(r.routeName)}</option>`).join('')}</select>
      </label>
      <label class="field"><span>날짜</span><input type="date" id="s_date" value="${searchState.date}"></label>
      <div class="two">
        <label class="field"><span>출발 희망 시작</span><input type="time" id="s_from" value="${searchState.from}"></label>
        <label class="field"><span>출발 희망 끝</span><input type="time" id="s_to" value="${searchState.to}"></label>
      </div>
      <button class="btn primary block" id="s_go">🔎 환승 조회</button>
    </div>
    <div id="s_results"></div>`;

  $('#s_route').onchange = (e) => { searchState.routeId = e.target.value; };
  $('#s_date').onchange = (e) => { searchState.date = e.target.value; };
  $('#s_from').onchange = (e) => { searchState.from = e.target.value; };
  $('#s_to').onchange = (e) => { searchState.to = e.target.value; };
  $('#s_go').onclick = runSearch;
}

function runSearch() {
  const route = DB.routes.find((r) => r.routeId === searchState.routeId);
  const box = $('#s_results');
  if (!route) { box.innerHTML = ''; return; }
  const date = $('#s_date').value, from = parseTime($('#s_from').value), to = parseTime($('#s_to').value);
  if (!isValidDate(date)) { box.innerHTML = `<div class="errs">날짜를 확인하세요.</div>`; return; }
  const { error, journeys, firstCount } = computeJourneys(route, date, from, to);
  if (error) { box.innerHTML = `<div class="errs">${esc(error)}</div>`; return; }
  if (!journeys.length) {
    box.innerHTML = `<div class="empty">이 시간창에 운행하는 편을 못 찾았습니다.<br>
      <span class="small">해당 날짜(${esc(date)})에 첫 구간 운행편 ${firstCount}개. 날짜·시간창·운행일 설정을 확인하세요.</span></div>`;
    return;
  }
  const iso = isoDow(date), dn = DOW.find(d => d.v === iso).l;
  box.innerHTML = `<div class="small muted" style="margin:2px 4px 8px">${esc(date)} (${dn})${isHoliday(date) ? ' · 공휴일' : ''} · ${journeys.length}개 결과</div>` +
    journeys.map((j) => renderJourney(j)).join('');
}

function renderJourney(j) {
  const legsHtml = j.legs.map((l, i) => {
    const t = l.t;
    const dep = absLabel(j.startDate, l.absDep);
    const arr = l.arrAbs != null ? absLabel(j.startDate, l.arrAbs) : '—';
    const wait = l.waitBefore > 0 ? `<span class="wait">↕ 환승 대기 ${humanDur(l.waitBefore)}</span>` : '';
    const boardStop = l.seg.boardStop ? esc(l.seg.boardStop) : esc(t.origin || '');
    const alightStop = l.seg.alightStop ? esc(l.seg.alightStop) : esc(t.destination || '');
    const trip = l.tripId ? ` <span class="badge">${esc(l.tripId)}</span>` : '';
    return `<div class="leg">
      ${wait}
      <div class="sp"><div><span class="badge tag-mode">${esc(t.transportType)}</span> <b>${esc(t.lineName || t.name)}</b>${trip}</div></div>
      <div class="small muted">${boardStop} → ${alightStop}${t.direction ? ' · ' + esc(t.direction) : ''}</div>
      <div class="time">${dep} <span class="muted">→</span> ${arr}</div>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="hdr-metrics">
      <div class="metric"><div class="k">출발</div><div class="v">${absLabel(j.startDate, j.firstBoard)}</div></div>
      <div class="metric"><div class="k">도착</div><div class="v">${absLabel(j.startDate, j.lastArr)}</div></div>
      <div class="metric"><div class="k">총 소요</div><div class="v">${humanDur(j.totalDuration)}</div></div>
    </div>
    <div class="small muted" style="margin:2px 2px 8px">환승 대기 합계 ${humanDur(j.totalWait)} · 환승 ${j.legs.length - 1}회</div>
    <div class="result">${legsHtml}</div>
  </div>`;
}

// ────────────────────────────────────────────────────────────── 뷰: 경로
let routeDraft = null;
function renderRoutes() {
  const el = $('#view-routes');
  el.innerHTML = `<div class="sp" style="margin-bottom:10px">
      <h2 style="margin:0">경로</h2>
      <button class="btn primary sm" id="r_new">+ 새 경로</button>
    </div>
    <div id="r_list">${DB.routes.length ? DB.routes.map(routeItem).join('') : `<div class="empty">등록된 경로가 없습니다.</div>`}</div>`;
  $('#r_new').onclick = () => openRouteEditor(null);
  $$('#r_list [data-edit]').forEach((b) => b.onclick = () => openRouteEditor(b.dataset.edit));
  $$('#r_list [data-clone]').forEach((b) => b.onclick = () => cloneRoute(b.dataset.clone));
  $$('#r_list [data-del]').forEach((b) => b.onclick = () => delRoute(b.dataset.del));
}
function routeItem(r) {
  const chain = (r.segments || []).map((s) => {
    const t = tplById(s.timetableId);
    return t ? esc(t.transportType) : '⚠️';
  }).join(' → ');
  return `<div class="item">
    <div class="sp"><div class="t">${esc(r.routeName)}</div></div>
    <div class="s">${chain || '구간 없음'} · ${(r.segments || []).length}개 구간</div>
    <div class="row wrap" style="margin-top:10px">
      <button class="btn sm" data-edit="${r.routeId}">수정</button>
      <button class="btn sm" data-clone="${r.routeId}">복제</button>
      <button class="btn sm bad" data-del="${r.routeId}">삭제</button>
    </div>
  </div>`;
}
function cloneRoute(id) {
  const r = DB.routes.find((x) => x.routeId === id); if (!r) return;
  const c = JSON.parse(JSON.stringify(r));
  c.routeId = uid(slugify(r.routeName) + '-copy'); c.routeName = r.routeName + ' (복제)';
  DB.routes.push(c); saveDB(); renderRoutes(); toast('경로를 복제했습니다.');
}
function delRoute(id) {
  const r = DB.routes.find((x) => x.routeId === id); if (!r) return;
  if (!confirm(`경로 "${r.routeName}" 를 삭제할까요?`)) return;
  DB.routes = DB.routes.filter((x) => x.routeId !== id); saveDB(); renderRoutes(); toast('삭제했습니다.');
}

function openRouteEditor(id) {
  const existing = id ? DB.routes.find((r) => r.routeId === id) : null;
  routeDraft = existing ? JSON.parse(JSON.stringify(existing))
    : { routeId: uid('route'), routeName: '', segments: [] };
  drawRouteEditor();
  openModal();
}
function drawRouteEditor() {
  const r = routeDraft;
  const segsHtml = r.segments.length ? r.segments.map((s, i) => {
    const t = tplById(s.timetableId);
    return `<div class="item">
      <div class="sp"><div class="t">${i + 1}. ${t ? esc(t.name) : '⚠️ 없는 템플릿'}</div>
        <div class="row">
          <button class="btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn sm" data-down="${i}" ${i === r.segments.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn sm bad" data-rm="${i}">✕</button>
        </div></div>
      <div class="s">${t ? `${esc(t.transportType)} · ${esc(t.lineName || '')} ${esc(t.direction || '')}` : esc(s.timetableId)}</div>
      <div class="two" style="margin-top:8px">
        <label class="field" style="margin:0"><span>승차 장소</span><input data-f="boardStop" data-i="${i}" value="${esc(s.boardStop || '')}" placeholder="${esc(t ? t.origin : '')}"></label>
        <label class="field" style="margin:0"><span>하차 장소</span><input data-f="alightStop" data-i="${i}" value="${esc(s.alightStop || '')}" placeholder="${esc(t ? t.destination : '')}"></label>
      </div>
      <div class="two" style="margin-top:8px">
        <label class="field" style="margin:0"><span>최소 환승(분)</span><input type="number" min="0" data-f="transferMinutes" data-i="${i}" value="${s.transferMinutes ?? 0}"></label>
        <label class="field" style="margin:0"><span>추가 여유(분)</span><input type="number" min="0" data-f="extraBufferMinutes" data-i="${i}" value="${s.extraBufferMinutes ?? 0}"></label>
      </div>
      <div class="hint">환승 시간은 <b>이 구간에서 내려 다음 구간을 타기까지</b> 필요한 시간입니다(마지막 구간은 무시).</div>
    </div>`;
  }).join('') : `<div class="empty small">아직 구간이 없습니다. 아래에서 시간표를 검색해 추가하세요.</div>`;

  $('#modalBody').innerHTML = `
    <h2>${routeDraft._new === false ? '경로 수정' : '경로'}</h2>
    <label class="field"><span>경로 이름</span><input id="rd_name" value="${esc(r.routeName)}" placeholder="예: 오류동에서 춘천 가기"></label>
    <div class="divider"></div>
    <h3>구간 (순서대로)</h3>
    <div id="rd_segs">${segsHtml}</div>
    <button class="btn block" id="rd_add">+ 시간표 검색해서 구간 추가</button>
    <div class="divider"></div>
    <div class="row"><button class="btn grow" id="rd_cancel">취소</button>
      <button class="btn primary grow" id="rd_save">저장</button></div>`;

  $('#rd_name').oninput = (e) => { r.routeName = e.target.value; };
  $('#rd_add').onclick = openTemplatePicker;
  $('#rd_cancel').onclick = closeModal;
  $('#rd_save').onclick = saveRoute;
  $$('#rd_segs [data-rm]').forEach((b) => b.onclick = () => { r.segments.splice(+b.dataset.rm, 1); reorder(r); drawRouteEditor(); });
  $$('#rd_segs [data-up]').forEach((b) => b.onclick = () => { const i = +b.dataset.up;[r.segments[i - 1], r.segments[i]] = [r.segments[i], r.segments[i - 1]]; reorder(r); drawRouteEditor(); });
  $$('#rd_segs [data-down]').forEach((b) => b.onclick = () => { const i = +b.dataset.down;[r.segments[i + 1], r.segments[i]] = [r.segments[i], r.segments[i + 1]]; reorder(r); drawRouteEditor(); });
  $$('#rd_segs [data-f]').forEach((inp) => inp.oninput = () => {
    const i = +inp.dataset.i, f = inp.dataset.f;
    r.segments[i][f] = inp.type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value;
  });
}
function reorder(r) { r.segments.forEach((s, i) => s.order = i); }
function saveRoute() {
  const r = routeDraft;
  if (!r.routeName.trim()) { toast('경로 이름을 입력하세요.'); return; }
  if (!r.segments.length) { toast('구간을 하나 이상 추가하세요.'); return; }
  reorder(r);
  const idx = DB.routes.findIndex((x) => x.routeId === r.routeId);
  if (idx >= 0) DB.routes[idx] = r; else DB.routes.push(r);
  saveDB(); closeModal(); renderRoutes(); toast('경로를 저장했습니다.');
}

// 구간 추가용 시간표 검색 모달(경로 편집 위에 겹침)
function openTemplatePicker() {
  const body = document.createElement('div');
  body.className = 'modal-back'; body.id = 'pickBack';
  body.innerHTML = `<div class="modal"><div class="grab"></div><div id="pickBody"></div></div>`;
  document.body.appendChild(body);
  const state = { q: '', transport: '', day: '' };
  function draw() {
    const res = searchTemplates(state);
    $('#pickBody').innerHTML = `
      <h2>시간표 검색</h2>
      <input id="pk_q" placeholder="이름·노선·출발·도착 검색" value="${esc(state.q)}">
      <div class="two" style="margin-top:8px">
        <select id="pk_tp"><option value="">교통수단 전체</option>${TRANSPORT.map(t => `<option ${state.transport === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <select id="pk_day"><option value="">운행일 전체</option>${SERVICE_DAY.map(d => `<option value="${d.v}" ${state.day === d.v ? 'selected' : ''}>${d.l}</option>`).join('')}</select>
      </div>
      <div class="divider"></div>
      <div>${res.length ? res.map(t => `<div class="item" data-pick="${t.id}">
          <div class="t">${esc(t.name)}</div>
          <div class="s">${esc(t.transportType)} · ${esc(t.lineName || '')} ${esc(t.direction || '')} · ${esc(t.origin || '')}→${esc(t.destination || '')} · ${dayTypeLabel(t)}</div>
        </div>`).join('') : `<div class="empty small">검색 결과 없음</div>`}</div>
      <button class="btn block" id="pk_close" style="margin-top:8px">닫기</button>`;
    $('#pk_q').oninput = (e) => { state.q = e.target.value; draw(); };
    $('#pk_tp').onchange = (e) => { state.transport = e.target.value; draw(); };
    $('#pk_day').onchange = (e) => { state.day = e.target.value; draw(); };
    $('#pk_close').onclick = () => body.remove();
    $$('#pickBody [data-pick]').forEach((it) => it.onclick = () => {
      routeDraft.segments.push({ timetableId: it.dataset.pick, boardStop: '', alightStop: '', transferMinutes: 0, extraBufferMinutes: 0, order: routeDraft.segments.length });
      body.remove(); drawRouteEditor();
    });
  }
  draw();
}
function searchTemplates({ q = '', transport = '', day = '' }) {
  const kw = q.trim().toLowerCase();
  return DB.templates.filter((t) => {
    if (transport && t.transportType !== transport) return false;
    if (day && t.scheduleType === 'simple' && t.serviceDayType !== day) return false;
    if (!kw) return true;
    return [t.name, t.lineName, t.origin, t.destination, t.direction, t.operator]
      .some((f) => String(f || '').toLowerCase().includes(kw));
  });
}
function dayTypeLabel(t) {
  if (t.scheduleType === 'trips') return '개별운행편';
  const base = (SERVICE_DAY.find((d) => d.v === t.serviceDayType) || {}).l || '';
  if (t.serviceDayType === 'custom_weekdays') return base + '(' + (t.customDays || []).map(v => DOW.find(d => d.v === v).l).join('') + ')';
  return base;
}

// ────────────────────────────────────────────────────────────── 뷰: 시간표(관리)
let tplFilter = '';
function renderTemplates() {
  const el = $('#view-templates');
  const list = DB.templates.filter((t) => {
    if (!tplFilter) return true;
    const kw = tplFilter.toLowerCase();
    return [t.name, t.lineName, t.origin, t.destination, t.transportType].some((f) => String(f || '').toLowerCase().includes(kw));
  });
  el.innerHTML = `<div class="sp" style="margin-bottom:10px">
      <h2 style="margin:0">시간표</h2>
      <button class="btn primary sm" id="t_new">+ 새 시간표</button>
    </div>
    <input id="t_filter" placeholder="검색(이름·노선·출발·도착)" value="${esc(tplFilter)}" style="margin-bottom:10px">
    <div id="t_list">${list.length ? list.map(tplItem).join('') : `<div class="empty">시간표가 없습니다.</div>`}</div>`;
  $('#t_new').onclick = () => openTemplateEditor(null);
  const f = $('#t_filter'); f.oninput = (e) => { tplFilter = e.target.value; const l = $('#t_list'); const ls = DB.templates.filter((t) => { const kw = tplFilter.toLowerCase(); return !tplFilter || [t.name, t.lineName, t.origin, t.destination, t.transportType].some((x) => String(x || '').toLowerCase().includes(kw)); }); l.innerHTML = ls.length ? ls.map(tplItem).join('') : `<div class="empty">결과 없음</div>`; bindTplItems(); };
  bindTplItems();
}
function bindTplItems() {
  $$('#t_list [data-edit]').forEach((b) => b.onclick = () => openTemplateEditor(b.dataset.edit));
  $$('#t_list [data-clone]').forEach((b) => b.onclick = () => cloneTpl(b.dataset.clone));
  $$('#t_list [data-del]').forEach((b) => b.onclick = () => delTpl(b.dataset.del));
  $$('#t_list [data-prev]').forEach((b) => b.onclick = () => previewTpl(b.dataset.prev));
}
function tplItem(t) {
  const count = t.scheduleType === 'simple' ? (t.departureTimes || []).length + '편' : (t.trips || []).length + '개 운행편';
  return `<div class="item">
    <div class="sp"><div class="t">${esc(t.name)}</div><span class="badge tag-mode">${t.scheduleType === 'simple' ? '단순배차' : '개별편'}</span></div>
    <div class="s">${esc(t.transportType)} · ${esc(t.lineName || '')} ${esc(t.direction || '')} · ${esc(t.origin || '')}→${esc(t.destination || '')}<br>${dayTypeLabel(t)} · ${count} · <code class="mono">${esc(t.id)}</code></div>
    <div class="row wrap" style="margin-top:10px">
      <button class="btn sm" data-edit="${t.id}">수정</button>
      <button class="btn sm" data-prev="${t.id}">미리보기</button>
      <button class="btn sm" data-clone="${t.id}">복제</button>
      <button class="btn sm bad" data-del="${t.id}">삭제</button>
    </div></div>`;
}
function cloneTpl(id) {
  const t = tplById(id); if (!t) return;
  const c = JSON.parse(JSON.stringify(t));
  c.id = uid(slugify(t.name) + '-copy'); c.name = t.name + ' (복제)';
  DB.templates.push(c); saveDB(); renderTemplates(); toast('시간표를 복제했습니다.');
}
function delTpl(id) {
  const t = tplById(id); if (!t) return;
  const used = DB.routes.filter((r) => (r.segments || []).some((s) => s.timetableId === id));
  let msg = `시간표 "${t.name}" 를 삭제할까요?`;
  if (used.length) msg += `\n\n⚠️ 이 시간표를 쓰는 경로 ${used.length}개(${used.map(r => r.routeName).join(', ')})의 해당 구간이 깨집니다.`;
  if (!confirm(msg)) return;
  DB.templates = DB.templates.filter((x) => x.id !== id); saveDB(); renderTemplates(); toast('삭제했습니다.');
}
function previewTpl(id) {
  const t = tplById(id); if (!t) return;
  const { errors, warnings } = validateTemplate(t, { forSave: false });
  let body = `<h2>${esc(t.name)} 미리보기</h2>
    <div class="small muted">${esc(t.transportType)} · ${esc(t.lineName || '')} ${esc(t.direction || '')} · ${esc(t.origin || '')}→${esc(t.destination || '')} · ${dayTypeLabel(t)}</div>
    <div class="divider"></div>`;
  if (t.scheduleType === 'simple') {
    const arrs = t.arrivalTimes || [];
    body += `<div class="preview-times">${(t.departureTimes || []).map((d, i) => `<span class="t">${esc(d)}${arrs[i] ? '→' + esc(arrs[i]) : ''}</span>`).join('')}</div>
      <div class="hint">${(t.departureTimes || []).length}편${t.defaultTravelMinutes != null && t.defaultTravelMinutes !== '' ? ' · 기본 소요 ' + t.defaultTravelMinutes + '분' : ''}</div>`;
  } else {
    body += `<div class="preview-times">${(t.trips || []).map((tr) => `<span class="t">${esc(tr.tripId || '')} ${esc(tr.departureTime)}→${esc(tr.arrivalTime || '?')}${tr.arrivalDayOffset ? '(+' + tr.arrivalDayOffset + '일)' : ''}</span>`).join('')}</div>`;
  }
  if (errors.length) body += `<div class="errs"><b>오류 ${errors.length}</b><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  if (warnings.length) body += `<div class="errs warnbox"><b>경고 ${warnings.length}</b><ul>${warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  if (!errors.length && !warnings.length) body += `<div class="ok-note small">✓ 오류 없음</div>`;
  body += `<div class="divider"></div><button class="btn block" id="pv_close">닫기</button>`;
  $('#modalBody').innerHTML = body; $('#pv_close').onclick = closeModal; openModal();
}

// ── 템플릿 편집기 ─────────────────────────────────────────────
let tplDraft = null, tplRules = [];
function openTemplateEditor(id) {
  const existing = id ? tplById(id) : null;
  if (existing) {
    tplDraft = JSON.parse(JSON.stringify(existing));
    tplDraft._orig = existing;
  } else {
    tplDraft = {
      id: '', name: '', transportType: '지하철', operator: '', lineName: '', direction: '',
      origin: '', destination: '', scheduleType: 'simple', serviceDayType: 'weekday',
      customDays: [], specificDates: [], departureTimes: [], arrivalTimes: [],
      defaultTravelMinutes: '', trips: [], note: '',
    };
  }
  tplRules = [{ start: '', end: '', interval: '' }];
  drawTemplateEditor();
  openModal();
}

function drawTemplateEditor() {
  const t = tplDraft;
  const inputMethod = t._method || 'lines';
  $('#modalBody').innerHTML = `
    <h2>${t._orig ? '시간표 수정' : '새 시간표'}</h2>
    <label class="field"><span>시간표 이름 *</span><input id="td_name" value="${esc(t.name)}" placeholder="예: 1호선 오류동→용산 평일"></label>
    <div class="two">
      <label class="field"><span>교통수단 *</span><select id="td_tp">${TRANSPORT.map(x => `<option ${t.transportType === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field"><span>운영기관</span><input id="td_op" value="${esc(t.operator)}" placeholder="예: 코레일"></label>
    </div>
    <div class="two">
      <label class="field"><span>노선명/번호</span><input id="td_line" value="${esc(t.lineName)}" placeholder="예: 1호선 / 101"></label>
      <label class="field"><span>운행 방향</span><input id="td_dir" value="${esc(t.direction)}" placeholder="예: 상행 / 춘천행"></label>
    </div>
    <div class="two">
      <label class="field"><span>출발지</span><input id="td_org" value="${esc(t.origin)}" placeholder="예: 오류동"></label>
      <label class="field"><span>도착지</span><input id="td_dst" value="${esc(t.destination)}" placeholder="예: 용산"></label>
    </div>
    <label class="field"><span>템플릿 ID ${t._orig ? '' : '(비우면 자동 생성)'}</span><input id="td_id" value="${esc(t.id)}" placeholder="자동 생성됨"></label>
    <div class="divider"></div>
    <div class="chips" style="margin-bottom:10px">
      <span class="chip ${t.scheduleType === 'simple' ? 'sel' : ''}" data-st="simple">단순 배차</span>
      <span class="chip ${t.scheduleType === 'trips' ? 'sel' : ''}" data-st="trips">개별 운행편(KTX·ITX·열차)</span>
    </div>
    <div id="td_body">${t.scheduleType === 'simple' ? simpleEditor(t, inputMethod) : tripsEditor(t)}</div>
    <label class="field" style="margin-top:10px"><span>비고</span><input id="td_note" value="${esc(t.note)}"></label>
    <div id="td_errs"></div>
    <div class="divider"></div>
    <div class="row"><button class="btn grow" id="td_cancel">취소</button>
      <button class="btn primary grow" id="td_save">저장</button></div>`;

  // 공통 필드 바인딩
  const bind = (sel, key, num) => { const e = $(sel); if (e) e.oninput = () => { t[key] = num ? (e.value === '' ? '' : e.value) : e.value; }; };
  bind('#td_name', 'name'); bind('#td_op', 'operator'); bind('#td_line', 'lineName');
  bind('#td_dir', 'direction'); bind('#td_org', 'origin'); bind('#td_dst', 'destination');
  bind('#td_id', 'id'); bind('#td_note', 'note');
  $('#td_tp').onchange = (e) => { t.transportType = e.target.value; };
  $$('#modalBody [data-st]').forEach((c) => c.onclick = () => { t.scheduleType = c.dataset.st; drawTemplateEditor(); });
  $('#td_cancel').onclick = closeModal;
  $('#td_save').onclick = saveTemplate;
  if (t.scheduleType === 'simple') bindSimpleEditor(t);
  else bindTripsEditor(t);
}

function simpleEditor(t, method) {
  const sd = t.serviceDayType;
  return `
    <label class="field"><span>운행일 유형 *</span>
      <select id="td_sd">${SERVICE_DAY.map(d => `<option value="${d.v}" ${sd === d.v ? 'selected' : ''}>${d.l}</option>`).join('')}</select></label>
    ${sd === 'custom_weekdays' ? `<div class="chips" id="td_days" style="margin-bottom:10px">${DOW.map(d => `<span class="chip ${(t.customDays || []).includes(d.v) ? 'sel' : ''}" data-day="${d.v}">${d.l}</span>`).join('')}</div>` : ''}
    ${sd === 'specific_dates' ? `<label class="field"><span>특정 날짜(줄단위 YYYY-MM-DD)</span><textarea id="td_sdates" placeholder="2026-01-01">${esc((t.specificDates || []).join('\n'))}</textarea></label>` : ''}
    <div class="divider"></div>
    <h3>출발 시각 입력</h3>
    <div class="chips" style="margin-bottom:8px">
      ${[['lines', '줄단위'], ['comma', '쉼표'], ['csv', 'CSV(도착포함)'], ['rules', '간격 생성'], ['json', 'JSON']].map(([v, l]) => `<span class="chip ${method === v ? 'sel' : ''}" data-method="${v}">${l}</span>`).join('')}
    </div>
    <div id="td_method">${methodEditor(t, method)}</div>
    <label class="field" style="margin-top:10px"><span>기본 이동 소요 시간(분) — 도착시각 없을 때 사용</span><input type="number" min="0" id="td_travel" value="${t.defaultTravelMinutes ?? ''}" placeholder="예: 42"></label>
    <div class="divider"></div>
    <div class="sp"><h3 style="margin:0">현재 출발 시각 <span class="muted small" id="td_count"></span></h3>
      <button class="btn sm" id="td_sort">시간순 정렬</button></div>
    <div class="preview-times" id="td_preview" style="margin-top:8px"></div>`;
}
function methodEditor(t, method) {
  if (method === 'rules') {
    return `<div id="td_rules">${tplRules.map((r, i) => `<div class="three" style="margin-bottom:6px">
        <input placeholder="시작 05:00" data-r="start" data-i="${i}" value="${esc(r.start)}">
        <input placeholder="종료 06:00" data-r="end" data-i="${i}" value="${esc(r.end)}">
        <input placeholder="간격(분)" data-r="interval" data-i="${i}" value="${esc(r.interval)}">
      </div>`).join('')}</div>
      <div class="row"><button class="btn sm" id="td_addrule">+ 규칙</button>
        <button class="btn sm primary" id="td_genrule">생성 → 목록 반영</button></div>
      <div class="hint">예: 05:00~06:00 15분, 06:00~09:00 8분 처럼 시간대별 배차를 여러 규칙으로.</div>`;
  }
  if (method === 'csv') {
    return `<textarea id="td_csv" placeholder="출발,도착&#10;05:18,06:00&#10;05:35,06:17"></textarea>
      <button class="btn sm primary" id="td_applycsv" style="margin-top:6px">적용(도착 시각 포함)</button>`;
  }
  if (method === 'json') {
    return `<textarea id="td_json" placeholder='["05:18","05:35"] 또는 전체 템플릿 JSON'></textarea>
      <button class="btn sm primary" id="td_applyjson" style="margin-top:6px">가져오기</button>`;
  }
  // lines / comma 공용 textarea
  return `<textarea id="td_list" placeholder="${method === 'comma' ? '05:18, 05:35, 05:49' : '05:18\n05:35\n05:49'}">${esc((t.departureTimes || []).join(method === 'comma' ? ', ' : '\n'))}</textarea>
    <button class="btn sm primary" id="td_applylist" style="margin-top:6px">적용</button>`;
}
function refreshPreview(t) {
  const p = $('#td_preview'); if (!p) return;
  const arrs = t.arrivalTimes || [];
  p.innerHTML = (t.departureTimes || []).map((d, i) => `<span class="t">${esc(d)}${arrs[i] ? '→' + esc(arrs[i]) : ''}</span>`).join('') || '<span class="muted small">없음</span>';
  const c = $('#td_count'); if (c) c.textContent = `(${(t.departureTimes || []).length}편)`;
}
function bindSimpleEditor(t) {
  $('#td_sd').onchange = (e) => { t.serviceDayType = e.target.value; drawTemplateEditor(); };
  $$('#td_days [data-day]').forEach((c) => c.onclick = () => {
    const v = +c.dataset.day; t.customDays = t.customDays || [];
    t.customDays.includes(v) ? t.customDays = t.customDays.filter((x) => x !== v) : t.customDays.push(v);
    c.classList.toggle('sel');
  });
  const sdates = $('#td_sdates'); if (sdates) sdates.oninput = () => { t.specificDates = parseTimeList(sdates.value).filter(Boolean); };
  $$('#modalBody [data-method]').forEach((c) => c.onclick = () => { t._method = c.dataset.method; drawTemplateEditor(); });
  const travel = $('#td_travel'); if (travel) travel.oninput = () => { t.defaultTravelMinutes = travel.value === '' ? '' : Number(travel.value); };
  $('#td_sort') && ($('#td_sort').onclick = () => { t.departureTimes = sortTimes(t.departureTimes || []); refreshPreview(t); toast('시간순 정렬'); });

  const applyList = $('#td_applylist');
  if (applyList) applyList.onclick = () => { t.departureTimes = parseTimeList($('#td_list').value); t.arrivalTimes = []; refreshPreview(t); toast(`${t.departureTimes.length}편 적용`); };
  const applyCsv = $('#td_applycsv');
  if (applyCsv) applyCsv.onclick = () => {
    const rows = parseCSV($('#td_csv').value);
    t.departureTimes = rows.map((r) => r.dep);
    t.arrivalTimes = rows.some((r) => r.arr) ? rows.map((r) => r.arr || '') : [];
    refreshPreview(t); toast(`${rows.length}편 적용`);
  };
  const applyJson = $('#td_applyjson');
  if (applyJson) applyJson.onclick = () => {
    try {
      const obj = JSON.parse($('#td_json').value);
      if (Array.isArray(obj)) { t.departureTimes = obj.map(String); t.arrivalTimes = []; }
      else if (obj && typeof obj === 'object') { Object.assign(t, obj); toast('템플릿 JSON 반영'); drawTemplateEditor(); return; }
      refreshPreview(t); toast('가져왔습니다.');
    } catch (e) { toast('JSON 파싱 실패'); }
  };
  const addRule = $('#td_addrule');
  if (addRule) addRule.onclick = () => { tplRules.push({ start: '', end: '', interval: '' }); drawTemplateEditor(); };
  $$('#td_rules [data-r]').forEach((inp) => inp.oninput = () => { tplRules[+inp.dataset.i][inp.dataset.r] = inp.value; });
  const genRule = $('#td_genrule');
  if (genRule) genRule.onclick = () => { const g = generateByRules(tplRules); t.departureTimes = g; t.arrivalTimes = []; refreshPreview(t); toast(`${g.length}편 생성`); };
  refreshPreview(t);
}

function tripsEditor(t) {
  const sample = `[
  {"tripId":"itx-2001","departureTime":"07:52","arrivalTime":"09:07","operatingDays":[1,2,3,4,5],"excludedDates":[],"additionalDates":[]},
  {"tripId":"itx-2003","departureTime":"08:52","arrivalTime":"10:07","operatingDays":[1,2,3,4,5]}
]`;
  return `<div class="hint">개별 운행편은 JSON 배열로 입력합니다. 요일은 1=월 … 7=일. 자정 넘김은 <code class="mono">arrivalDayOffset</code>.</div>
    <textarea id="td_trips" style="min-height:180px">${esc(JSON.stringify(t.trips && t.trips.length ? t.trips : JSON.parse(sample), null, 2))}</textarea>
    <button class="btn sm primary" id="td_applytrips" style="margin-top:6px">적용/검사</button>
    <div id="td_tripcount" class="hint"></div>`;
}
function bindTripsEditor(t) {
  const btn = $('#td_applytrips');
  if (btn) btn.onclick = () => {
    try {
      const arr = JSON.parse($('#td_trips').value);
      if (!Array.isArray(arr)) throw 0;
      t.trips = arr; $('#td_tripcount').textContent = `${arr.length}개 운행편 반영됨`;
      toast(`${arr.length}개 운행편`);
    } catch (e) { toast('JSON 파싱 실패'); }
  };
}

function saveTemplate() {
  const t = tplDraft;
  if (t.scheduleType === 'trips') { // 저장 시 최신 textarea 반영 시도
    const ta = $('#td_trips'); if (ta) { try { t.trips = JSON.parse(ta.value); } catch (e) { toast('운행편 JSON 오류'); return; } }
  }
  if (!t.id || !t.id.trim()) t.id = uid(slugify(t.name || t.transportType));
  const { errors, warnings } = validateTemplate(t, { forSave: true });
  const box = $('#td_errs');
  if (errors.length) {
    box.innerHTML = `<div class="errs"><b>저장 불가 — 오류 ${errors.length}</b><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (t.scheduleType === 'simple') t.departureTimes = sortTimes(t.departureTimes || []);
  const orig = t._orig; delete t._orig; delete t._method;
  const idx = DB.templates.findIndex((x) => x === orig || x.id === t.id);
  if (idx >= 0) DB.templates[idx] = t; else DB.templates.push(t);
  saveDB(); closeModal(); renderTemplates();
  toast(warnings.length ? `저장됨 (경고 ${warnings.length})` : '저장했습니다.');
}

// ────────────────────────────────────────────────────────────── 뷰: 데이터
function renderData() {
  const el = $('#view-data');
  el.innerHTML = `
    <div class="card"><h3>백업 / 내보내기</h3>
      <p class="small muted">전체 데이터(시간표·경로·공휴일)를 JSON으로 저장합니다. 다른 폰에 옮길 때도 이 파일을 씁니다.</p>
      <div class="row wrap"><button class="btn primary" id="d_export">⬇ JSON 내보내기(다운로드)</button>
        <button class="btn" id="d_copy">복사</button></div>
      <textarea id="d_json" readonly style="margin-top:10px;min-height:120px"></textarea>
    </div>
    <div class="card"><h3>가져오기 / 복원</h3>
      <p class="small muted">파일을 고르거나 JSON을 붙여넣어 복원합니다.</p>
      <input type="file" id="d_file" accept="application/json,.json">
      <textarea id="d_import" placeholder="여기에 JSON 붙여넣기" style="margin-top:8px"></textarea>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn primary" id="d_merge">병합 가져오기</button>
        <button class="btn bad" id="d_replace">전체 교체 복원</button>
      </div>
    </div>
    <div class="card"><h3>공휴일</h3>
      <p class="small muted">‘일요일·공휴일’ 운행일 판정에 쓰입니다. 줄단위 YYYY-MM-DD.</p>
      <textarea id="d_hol" placeholder="2026-01-01">${esc((DB.holidays || []).join('\n'))}</textarea>
      <button class="btn sm primary" id="d_holsave" style="margin-top:6px">공휴일 저장</button>
    </div>
    <div class="card"><h3>기타</h3>
      <div class="row wrap">
        <button class="btn" id="d_seed">샘플 데이터 넣기</button>
        <button class="btn bad" id="d_clear">전체 삭제</button>
      </div>
      <div class="hint">시간표 ${DB.templates.length}개 · 경로 ${DB.routes.length}개 · 공휴일 ${DB.holidays.length}일</div>
    </div>`;

  $('#d_json').value = JSON.stringify(DB, null, 2);
  $('#d_export').onclick = exportJSON;
  $('#d_copy').onclick = () => { $('#d_json').select(); navigator.clipboard?.writeText($('#d_json').value); toast('복사됨'); };
  $('#d_file').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $('#d_import').value = rd.result; toast('파일을 읽었습니다. 아래 버튼으로 가져오기'); }; rd.readAsText(f); };
  $('#d_merge').onclick = () => importJSON(false);
  $('#d_replace').onclick = () => importJSON(true);
  $('#d_holsave').onclick = () => { DB.holidays = parseTimeList($('#d_hol').value).filter(isValidDate); saveDB(); toast(`공휴일 ${DB.holidays.length}일 저장`); renderData(); };
  $('#d_seed').onclick = () => { seedSample(true); saveDB(); toast('샘플을 넣었습니다.'); renderData(); };
  $('#d_clear').onclick = () => { if (confirm('모든 데이터를 삭제할까요? 되돌릴 수 없습니다.')) { DB = emptyDB(); saveDB(); toast('전체 삭제'); renderData(); } };
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `transit-timetable-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('내보냈습니다.');
}
function importJSON(replace) {
  const raw = $('#d_import').value.trim(); if (!raw) { toast('JSON을 입력하세요.'); return; }
  let obj; try { obj = JSON.parse(raw); } catch (e) { toast('JSON 파싱 실패'); return; }
  if (!obj || (!obj.templates && !obj.routes)) { toast('형식이 올바르지 않습니다.'); return; }
  if (replace) {
    if (!confirm('현재 데이터를 모두 지우고 교체할까요?')) return;
    DB = Object.assign(emptyDB(), obj);
  } else {
    const byId = new Map(DB.templates.map((t) => [t.id, t]));
    (obj.templates || []).forEach((t) => byId.set(t.id, t));
    DB.templates = Array.from(byId.values());
    const rById = new Map(DB.routes.map((r) => [r.routeId, r]));
    (obj.routes || []).forEach((r) => rById.set(r.routeId, r));
    DB.routes = Array.from(rById.values());
    DB.holidays = Array.from(new Set([...(DB.holidays || []), ...(obj.holidays || [])]));
  }
  DB.templates = DB.templates || []; DB.routes = DB.routes || []; DB.holidays = DB.holidays || [];
  saveDB(); toast(replace ? '복원 완료' : '병합 완료'); renderData();
}

// ────────────────────────────────────────────────────────────── 모달
function openModal() { $('#modalBack').hidden = false; }
function closeModal() { $('#modalBack').hidden = true; $('#modalBody').innerHTML = ''; }

// ────────────────────────────────────────────────────────────── 샘플 데이터
function seedIfFirstRun() {
  if (!DB.templates.length && !DB.routes.length) { seedSample(false); saveDB(); }
}
function seedSample(force) {
  if (!force && (DB.templates.length || DB.routes.length)) return;
  const t1 = {
    id: 'subway-line1-oryudong-yongsan-weekday', name: '1호선 오류동→용산 (평일)',
    transportType: '지하철', operator: '코레일', lineName: '1호선', direction: '용산 방면',
    origin: '오류동', destination: '용산', scheduleType: 'simple', serviceDayType: 'weekday',
    customDays: [], specificDates: [],
    departureTimes: generateByRules([{ start: '05:30', end: '09:00', interval: 6 }, { start: '09:00', end: '23:30', interval: 10 }]),
    arrivalTimes: [], defaultTravelMinutes: 28, trips: [], note: '',
  };
  const t2 = {
    id: 'itx-yongsan-namchuncheon-weekday', name: 'ITX-청춘 용산→남춘천 (평일)',
    transportType: 'ITX', operator: '코레일', lineName: 'ITX-청춘', direction: '춘천행',
    origin: '용산', destination: '남춘천', scheduleType: 'trips', serviceDayType: 'weekday',
    customDays: [], specificDates: [], departureTimes: [], arrivalTimes: [], defaultTravelMinutes: '',
    trips: [
      { tripId: 'itx-2001', departureTime: '07:52', arrivalTime: '09:07', operatingDays: [1, 2, 3, 4, 5], excludedDates: [], additionalDates: [] },
      { tripId: 'itx-2003', departureTime: '08:52', arrivalTime: '10:07', operatingDays: [1, 2, 3, 4, 5], excludedDates: [], additionalDates: [] },
      { tripId: 'itx-2005', departureTime: '09:52', arrivalTime: '11:07', operatingDays: [1, 2, 3, 4, 5], excludedDates: [], additionalDates: [] },
    ], note: '',
  };
  const t3 = {
    id: 'bus-101-namchuncheon-weekday', name: '101번 남춘천→시내 (평일)',
    transportType: '버스', operator: '춘천시내버스', lineName: '101', direction: '시내 방면',
    origin: '남춘천역', destination: '춘천터미널', scheduleType: 'simple', serviceDayType: 'weekday',
    customDays: [], specificDates: [],
    departureTimes: generateByRules([{ start: '06:00', end: '23:00', interval: 15 }]),
    arrivalTimes: [], defaultTravelMinutes: 18, trips: [], note: '',
  };
  const r = {
    routeId: 'oryudong-chuncheon', routeName: '오류동에서 춘천 가기',
    segments: [
      { timetableId: t1.id, boardStop: '오류동', alightStop: '용산', transferMinutes: 15, extraBufferMinutes: 0, order: 0 },
      { timetableId: t2.id, boardStop: '용산', alightStop: '남춘천', transferMinutes: 10, extraBufferMinutes: 0, order: 1 },
      { timetableId: t3.id, boardStop: '남춘천역', alightStop: '춘천터미널', transferMinutes: 0, extraBufferMinutes: 0, order: 2 },
    ],
  };
  DB.templates.push(t1, t2, t3);
  DB.routes.push(r);
}

// ────────────────────────────────────────────────────────────── 부트
function boot() {
  loadDB();
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
  $('#modalBack').addEventListener('click', (e) => { if (e.target.id === 'modalBack') closeModal(); });
  $('#btnInstallHint').onclick = showInstallHint;
  showTab('search');
}
function showInstallHint() {
  $('#modalBody').innerHTML = `<h2>아이폰에 설치</h2>
    <ol class="small" style="line-height:1.8;padding-left:18px">
      <li>사파리(Safari)에서 이 페이지를 엽니다.</li>
      <li>하단 <b>공유 버튼</b>(□↑)을 누릅니다.</li>
      <li><b>‘홈 화면에 추가’</b>를 선택합니다.</li>
      <li>홈 화면 아이콘으로 실행하면 전체화면·오프라인으로 동작합니다.</li>
    </ol>
    <div class="hint">데이터는 이 기기 안에 저장됩니다. 다른 폰으로 옮기려면 [데이터] 탭에서 JSON 내보내기 → 그 폰에서 가져오기.</div>
    <div class="divider"></div><button class="btn block" id="ih_close">닫기</button>`;
  $('#ih_close').onclick = closeModal; openModal();
}

document.addEventListener('DOMContentLoaded', boot);
