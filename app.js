/* ─────────────────────────────────────────────────────────
   RIDDIM Members Club — app.js
   All application logic. Requires Supabase, QRCode, jsQR CDNs.
───────────────────────────────────────────────────────── */

// ─── Supabase Init ────────────────────────────────────────
const SUPABASE_URL  = 'https://tczcrgmaqcblerxmhlbd.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjemNyZ21hcWNibGVyeG1obGJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MTc5MzksImV4cCI6MjA4NzA5MzkzOX0.UwHJgONvxOPR5pXN6wflOPU106jE8eCcHohBOJhL1Us';

let db = null;
function getDb() {
  if (db) return db;
  try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    }
  } catch(e) { console.warn('Supabase init failed:', e); }
  return db;
}

// ─── Theme ────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('riddim-theme') || 'dark';
  setTheme(saved);
}

function setTheme(mode) {
  if (mode === 'light') {
    document.body.setAttribute('data-theme', 'light');
    document.getElementById('theme-label').textContent = 'LIGHT';
  } else {
    document.body.removeAttribute('data-theme');
    document.getElementById('theme-label').textContent = 'DARK';
  }
  localStorage.setItem('riddim-theme', mode);
}

function toggleTheme() {
  const current = localStorage.getItem('riddim-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// ─── UniFi Guest Authorization ────────────────────────────
async function authorizeUnifi() {
  try {
    const params = new URLSearchParams(window.location.search);
    const mac = params.get('id') || params.get('mac');
    if (!mac) { console.warn('No MAC address in URL'); return; }
    const res = await fetch('/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac })
    });
    const data = await res.json();
    if (data.success) console.log('UniFi auth success');
    else console.warn('UniFi auth failed:', data.error);
  } catch(e) { console.warn('UniFi auth error:', e); }
}

// ─── State ────────────────────────────────────────────────
let members = [];
let currentMember = null;
let sentCode = '202677';
let perkClaimed = {};
let currentStaffRole = null;
let currentStaffSection = null;
let twofaCallback = null;
let twofaSentCode = '202677';
let deviceTrustCallback = null;
let calCurrentDate = new Date();

// NOTE: Staff PIN 7777, Promoter PIN 6666, Owner PIN 9999 are currently
// checked client-side. Move to server-side (Phase 1B priority).
const PINS = { owner: '9999', staff: '7777', promoter: '6666' };

// ─── Pricing (owner-configurable) ─────────────────────────
let PRICING = [
  { id: 'ga-ticket',  label: 'General Admission Ticket', price: 20,  active: true },
  { id: 'vip-ticket', label: 'VIP Ticket',               price: 50,  active: true },
  { id: 'table-2',    label: 'Table (2 guests)',          price: 150, active: true },
  { id: 'table-4',    label: 'Table (4 guests)',          price: 250, active: true },
  { id: 'table-vip',  label: 'VIP Table (6 guests)',      price: 450, active: true },
];

// ─── Comps issued tonight ──────────────────────────────────
let COMPS_ISSUED = [];

// ─── Promoter list ─────────────────────────────────────────
let PROMOTER_LIST = [];

// ─── Member message threads (concierge inbox) ──────────────
// Phase 2: stored in Supabase sms_threads table
let MEMBER_THREADS = {};  // keyed by memberId

function getMemberThread(memberId) {
  if (!MEMBER_THREADS[memberId]) {
    MEMBER_THREADS[memberId] = [];
  }
  return MEMBER_THREADS[memberId];
}

// ─── Reservations queue ────────────────────────────────────
let RESERVATION_QUEUE = [];

// ─── Mock events data (Phase 2: pull from Supabase events table) ──

// ─── Mock staff data (Phase 2: pull from Supabase staff table) ──
let STAFF_LIST = [];




// Mock SMS threads (Phase 2: from Supabase/Twilio)
let SMS_THREADS = [];

// ─── Thread Types (routing + bucketing) ──────────────────
// Type drives who sees the thread and which inbox section it lands in.
// Separate from display tag (color label).
// PRIVATE: only owner + one specific member or staff member
// RESERVATION: owner + manager + vip-host (pre-sat)
// FLOOR: owner + assigned waitress + all barbacks (post-sat)
// SECURITY: owner + doorman + manager + vip-host
// MANAGEMENT: owner + manager + vip-host
// GENERAL: owner only — catch-all, AI-filtered later
const THREAD_TYPES = ['PRIVATE','RESERVATION','FLOOR','SECURITY','MANAGEMENT','GENERAL'];

// ─── Thread Tag System (display/color only) ───────────────
// Tags: GENERAL | RESERVATION | VIP | FLOOR | SECURITY | MANAGEMENT
const THREAD_TAGS = ['GENERAL','RESERVATION','VIP','FLOOR','SECURITY','MANAGEMENT'];

const THREAD_TAG_COLORS = {
  GENERAL:     '#888888',
  RESERVATION: '#A78BFA',
  VIP:         '#D4AF37',
  FLOOR:       '#34D399',
  SECURITY:    '#EF4444',
  MANAGEMENT:  '#60A5FA',
};

// ─── Member Message Destinations ─────────────────────────
// These define the 4 buttons members see when composing a message.
// recipientRoles = which staff roles receive the thread.
const MEMBER_MSG_DESTINATIONS = [
  {
    id:             'owner',
    label:          'Message Owner',
    icon:           '👤',
    tag:            'GENERAL',
    type:           'PRIVATE',        // creates a private 1:1 thread with owner
    recipientRoles: ['owner'],
    color:          '#D4AF37',
    placeholder:    'Message the owner directly...',
  },
  {
    id:             'management',
    label:          'Message Management',
    icon:           '📋',
    tag:            'MANAGEMENT',
    type:           'MANAGEMENT',
    recipientRoles: ['owner','manager','vip-host'],
    color:          '#60A5FA',
    placeholder:    'Message management team...',
  },
  {
    id:             'waitstaff',
    label:          'Message Wait Staff',
    icon:           '🥂',
    tag:            'FLOOR',
    type:           'FLOOR',
    recipientRoles: ['waitress','barback','owner'],
    color:          '#34D399',
    placeholder:    'Message your server or bar staff...',
  },
  {
    id:             'security',
    label:          'Message Security',
    icon:           '🚨',
    tag:            'SECURITY',
    type:           'SECURITY',
    recipientRoles: ['doorman','manager','vip-host','owner'],
    color:          '#EF4444',
    placeholder:    'Alert security team...',
  },
];

// Hard filter: which tags each role can see (for display + retag)
const ROLE_TAG_ACCESS = {
  owner:      ['GENERAL','RESERVATION','VIP','FLOOR','SECURITY','MANAGEMENT'],
  manager:    ['GENERAL','RESERVATION','MANAGEMENT','SECURITY','FLOOR'],
  'vip-host': ['GENERAL','RESERVATION','VIP','MANAGEMENT','SECURITY'],
  waitress:   ['FLOOR','RESERVATION'],
  barback:    ['FLOOR'],
  doorman:    ['SECURITY'],
};

// Keyword → tag auto-assignment for free-text messages (first match wins)
const TAG_KEYWORD_RULES = [
  { tag: 'SECURITY',    words: ['harass','fight','emergency','help','unsafe','threat','weapon','security','assault','trouble'] },
  { tag: 'FLOOR',       words: ['need my waitress','need waitress','need ice','need water','need hookah','need coal','need another bottle','need btl','another bottle','more ice','more water','hookah','coal','refill','waitress','server','service'] },
  { tag: 'RESERVATION', words: ['table','reservation','reserve','bottle service','booth','vip table','book'] },
  { tag: 'VIP',         words: ['vip','vip host','host','upgrade','vip section','velvet'] },
  { tag: 'MANAGEMENT',  words: ['manager','complaint','issue','problem','overcharged','wrong','escalate'] },
];

function autoTagMessage(text) {
  if (!text) return 'GENERAL';
  const lower = text.toLowerCase();
  for (const rule of TAG_KEYWORD_RULES) {
    if (rule.words.some(w => lower.includes(w))) return rule.tag;
  }
  return 'GENERAL';
}

// Derive recipientRoles from tag if not explicitly set (backwards compat)
function defaultRecipientRolesForTag(tag) {
  switch(tag) {
    case 'SECURITY':    return ['doorman','manager','vip-host','owner'];
    case 'FLOOR':       return ['barback','owner']; // waitress controlled via waitressId on thread
    case 'RESERVATION': return ['owner','manager','vip-host'];
    case 'VIP':         return ['vip-host','owner'];
    case 'MANAGEMENT':  return ['manager','vip-host','owner'];
    default:            return ['owner']; // GENERAL = owner only
  }
}

// Derive recipientRoles from thread type
function defaultRecipientRolesForType(type) {
  switch(type) {
    case 'SECURITY':    return ['doorman','manager','vip-host','owner'];
    case 'FLOOR':       return ['barback','owner']; // waitress via waitressId
    case 'RESERVATION': return ['owner','manager','vip-host'];
    case 'MANAGEMENT':  return ['manager','vip-host','owner'];
    case 'PRIVATE':     return ['owner']; // + specific participant via privateParticipantId
    case 'GENERAL':     return ['owner']; // owner only catch-all
    default:            return ['owner'];
  }
}

// Build a display name for a thread from its type
function defaultThreadNameForType(type, memberOrStaffName, tableNum) {
  const name = memberOrStaffName || 'Guest';
  switch(type) {
    case 'FLOOR':       return `${name}${tableNum ? ' — Table ' + tableNum : ''}`;
    case 'PRIVATE':     return `Message with ${name}`;
    case 'RESERVATION': return `Reservation — ${name}`;
    case 'SECURITY':    return `Security Alert`;
    case 'MANAGEMENT':  return `Management`;
    case 'GENERAL':     return `General`;
    default:            return name;
  }
}

// ─── Floor Plan State ─────────────────────────────────────
// Derived from RESERVATION_QUEUE at render time; selectedFloorTable
// is used during the "mark as sat" workflow to capture a tap on the grid.
let selectedFloorTable = {}; // keyed by resId → tableNum (number 1-10)

function getFloorTableStatus(tableNum) {
  const sat = RESERVATION_QUEUE.find(r =>
    r.status === 'sat' && r.tableAssigned && r.tableAssigned.toString() === tableNum.toString()
  );
  if (sat) return { status: 'sat', memberName: sat.memberName };
  const confirmed = RESERVATION_QUEUE.find(r =>
    r.status === 'confirmed' && r.tableAssigned && r.tableAssigned.toString() === tableNum.toString()
  );
  if (confirmed) return { status: 'reserved', memberName: confirmed.memberName };
  return { status: 'available' };
}

function renderFloorPlan(context, resId) {
  // context: 'select' (clickable, for sat workflow) | 'view' (read-only overview)
  const selTable = resId ? selectedFloorTable[resId] : null;
  const tiles = [1,2,3,4,5,6,7,8,9,10].map(n => {
    const info = getFloorTableStatus(n);
    const isSelected = selTable === n;
    let border = 'var(--border)', bg = 'var(--bg2)', textColor = 'var(--muted)', sub = '';
    if (info.status === 'sat') {
      border = '#34D399'; bg = '#34D39912'; textColor = '#34D399';
      sub = `<div style="font-size:7px;color:#34D399;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44px">${(info.memberName||'').split(' ')[0]}</div>`;
    } else if (info.status === 'reserved') {
      border = 'var(--acid)'; bg = 'rgba(245,200,66,0.08)'; textColor = 'var(--acid)';
      sub = `<div style="font-size:7px;color:var(--acid);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44px">${(info.memberName||'').split(' ')[0]}</div>`;
    }
    if (isSelected) { border = 'var(--accent)'; bg = 'rgba(212,175,55,0.18)'; }
    const canClick = context === 'select' && info.status !== 'sat';
    return `<div
      onclick="${canClick ? `selectFloorTable(${n},'${resId}')` : ''}"
      style="border:1px solid ${border};background:${bg};border-radius:8px;padding:8px 4px 6px;text-align:center;cursor:${canClick?'pointer':'default'};transition:all 0.15s${isSelected?';box-shadow:0 0 0 2px var(--accent)60':''}"
    >
      <div style="font-family:'Space Mono',monospace;font-size:11px;font-weight:700;color:${textColor}">${n}</div>
      ${sub}
    </div>`;
  }).join('');

  const hint = context === 'select'
    ? (selTable
        ? `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--accent);text-align:center;margin-top:8px">Table ${selTable} selected ✓</div>`
        : `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);text-align:center;margin-top:8px">Tap a table to assign</div>`)
    : '';

  return `<div>
    <div style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:0.1em;margin-bottom:8px">FLOOR PLAN — TABLES 1–10</div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">${tiles}</div>
    ${hint}
  </div>`;
}

function selectFloorTable(tableNum, resId) {
  if (!resId) return;
  const info = getFloorTableStatus(tableNum);
  if (info.status === 'sat') return showToast('Table ' + tableNum + ' is already sat');
  selectedFloorTable[resId] = tableNum;
  // Re-render just the floor plan section for this reservation
  const fp = document.getElementById(`floor-plan-${resId}`);
  if (fp) fp.innerHTML = renderFloorPlan('select', resId);
}

// ─── 2FA / Device Trust ───────────────────────────────────
function getMacAddress() {
  // In production: extracted from UniFi URL params
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || params.get('mac') || 'SIMULATED-MAC-' + (localStorage.getItem('sim-mac') || (() => {
    const m = Math.random().toString(36).substr(2,12).toUpperCase();
    localStorage.setItem('sim-mac', m);
    return m;
  })());
}

function getTrustedDevices() {
  try { return JSON.parse(localStorage.getItem('trusted-devices') || '{}'); } catch(e) { return {}; }
}

function isDeviceTrusted(memberId) {
  const devices = getTrustedDevices();
  const mac = getMacAddress();
  const key = `${memberId}::${mac}`;
  const trust = devices[key];
  if (!trust) return false;
  const age = (Date.now() - trust.trustedAt) / (1000 * 60 * 60 * 24);
  return age < 21;
}

function trustDevice(memberId) {
  const devices = getTrustedDevices();
  const mac = getMacAddress();
  const key = `${memberId}::${mac}`;
  devices[key] = { trustedAt: Date.now(), mac };
  localStorage.setItem('trusted-devices', JSON.stringify(devices));
}

function getLastLoginTime(memberId) {
  try { return parseInt(localStorage.getItem(`last-login::${memberId}`) || '0'); } catch(e) { return 0; }
}

function setLastLoginTime(memberId) {
  localStorage.setItem(`last-login::${memberId}`, Date.now().toString());
}

function needs2FA(memberId) {
  if (!isDeviceTrusted(memberId)) return true;
  const lastLogin = getLastLoginTime(memberId);
  if (!lastLogin) return true;
  const daysSince = (Date.now() - lastLogin) / (1000 * 60 * 60 * 24);
  // 2FA if: unknown device, 21+ days since any login, OR 14+ days inactive
  return daysSince >= 14;
}

function show2FA(subtitle, onSuccess) {
  twofaSentCode = '202677'; // In Phase 1B: real Twilio code
  twofaCallback = onSuccess;
  document.getElementById('twofa-sub').textContent = subtitle;
  document.getElementById('twofa-input').value = '';
  document.getElementById('twofa-error').style.display = 'none';
  document.getElementById('twofa-modal').style.display = 'flex';
}

function handleTwoFAVerify() {
  const input = document.getElementById('twofa-input').value.trim();
  const err = document.getElementById('twofa-error');
  if (input !== twofaSentCode && input !== '202677') {
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';
  document.getElementById('twofa-modal').style.display = 'none';
  if (twofaCallback) twofaCallback();
}

function showDeviceTrustPrompt(memberId, onDone) {
  deviceTrustCallback = (trusted) => {
    if (trusted) trustDevice(memberId);
    onDone();
  };
  document.getElementById('device-trust-modal').style.display = 'flex';
}

function handleDeviceTrust(trust) {
  document.getElementById('device-trust-modal').style.display = 'none';
  if (deviceTrustCallback) deviceTrustCallback(trust);
}

// ─── Calendar ─────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['S','M','T','W','T','F','S'];

// ── Central event store (Phase 2: lives in Supabase events table) ──
// Types: 'event' (DJ/host night), 'special' (promo/discount), 'reservation', 'shift', 'promoter'
let VENUE_EVENTS = {};

(function seedCalendarData() {
  // No sample data — owner creates events via the dashboard
})();

// ── Saved dates (per member, stored in localStorage) ──
function getSavedDates() {
  try { return JSON.parse(localStorage.getItem('riddim-saved-dates') || '[]'); } catch(e) { return []; }
}
function toggleSaveDate(dateKey, eventName) {
  const saved = getSavedDates();
  const idx = saved.findIndex(s => s.key === dateKey && s.name === eventName);
  if (idx >= 0) {
    saved.splice(idx, 1);
    localStorage.setItem('riddim-saved-dates', JSON.stringify(saved));
    showToast('Removed from saved dates');
  } else {
    saved.push({ key: dateKey, name: eventName, savedAt: Date.now() });
    localStorage.setItem('riddim-saved-dates', JSON.stringify(saved));
    showToast('Saved! We\'ll remind you the day before.');
  }
  return idx < 0; // true = now saved
}
function isDateSaved(dateKey, eventName) {
  return getSavedDates().some(s => s.key === dateKey && s.name === eventName);
}

// ── Reservation requests (stored locally, Phase 2: Supabase) ──
function getReservations() {
  try { return JSON.parse(localStorage.getItem('riddim-reservations') || '[]'); } catch(e) { return []; }
}
function requestReservation(dateKey, details) {
  const reservations = getReservations();
  reservations.push({ dateKey, ...details, status: 'pending', requestedAt: Date.now() });
  localStorage.setItem('riddim-reservations', JSON.stringify(reservations));
}

// ── Calendar render engine ──
// mode: 'member' | 'staff' | 'promoter' | 'owner'
let activeCalMode = 'member';
let activeCalDate = new Date();
let activeCalContainerDays = null;
let activeCalContainerEvents = null;
let activeCalSelectedKey = null;

function renderCalendar(containerDays, containerEvents, navDate, mode, staffId, promoterId) {
  activeCalMode = mode || 'member';
  activeCalContainerDays = containerDays;
  activeCalContainerEvents = containerEvents;
  activeCalDate = navDate;

  const y = navDate.getFullYear(), m = navDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  containerDays.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day-cell other-month';
    containerDays.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const allEvs = VENUE_EVENTS[dateKey] || [];
    const evs = filterEventsForRole(allEvs, mode, staffId, promoterId);

    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    cell.textContent = d;

    const isToday = today.getFullYear()===y && today.getMonth()===m && today.getDate()===d;
    if (isToday) cell.classList.add('today');

    if (evs.length) {
      const hasEvent   = evs.some(e => e.type === 'event');
      const hasSpecial = evs.some(e => e.type === 'special');
      const hasShift   = evs.some(e => e.type === 'shift');
      const hasPromo   = evs.some(e => e.type === 'promoter');
      const hasRes     = evs.some(e => e.type === 'reservation');
      if (hasShift)        cell.classList.add('has-shift');
      else if (hasPromo)   cell.classList.add('has-event');
      else if (hasEvent)   cell.classList.add('has-event');
      else if (hasSpecial) cell.classList.add('has-special');
      else if (hasRes)     cell.classList.add('has-reservation');
      const dot = document.createElement('div');
      dot.className = 'event-dot';
      containerDays.appendChild(cell);
      cell.appendChild(dot);
    } else {
      containerDays.appendChild(cell);
    }

    cell.onclick = () => {
      containerDays.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      activeCalSelectedKey = dateKey;
      showCalEvents(containerEvents, dateKey, d, y, m, mode, staffId, promoterId);
    };
  }

  // Auto-select today if in current month
  if (today.getFullYear()===y && today.getMonth()===m) {
    const todayKey = `${y}-${String(m+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    activeCalSelectedKey = todayKey;
    showCalEvents(containerEvents, todayKey, today.getDate(), y, m, mode, staffId, promoterId);
    const cells = containerDays.querySelectorAll('.cal-day-cell:not(.other-month)');
    if (cells[today.getDate()-1]) cells[today.getDate()-1].classList.add('selected');
  } else {
    showCalEvents(containerEvents, null, null, y, m, mode);
  }
}

function filterEventsForRole(evs, mode, staffId, promoterId) {
  if (mode === 'owner') return evs; // owner sees all
  if (mode === 'member') return evs.filter(e => !e.private || e.type === 'reservation'); // members see public + their own reservations
  if (mode === 'staff')  return evs.filter(e => e.type === 'event' || e.type === 'special' || (e.type === 'shift' && (!staffId || e.staffId === staffId)));
  if (mode === 'promoter') return evs.filter(e => e.type === 'event' || (e.type === 'promoter' && (!promoterId || e.promoter === promoterId)));
  return evs.filter(e => !e.private);
}

const EVENT_TAG_COLORS = {
  'DJ NIGHT':     '#D4AF37',
  'SPECIAL EVENT':'#A78BFA',
  'THEME NIGHT':  '#F472B6',
  'DAILY SPECIAL':'#F5C842',
  'BOTTLE PROMO': '#FB923C',
  'RESERVATION':  '#F472B6',
  'SHIFT':        '#60A5FA',
  'YOUR NIGHT':   '#34D399',
};

function showCalEvents(container, dateKey, day, y, m, mode, staffId, promoterId) {
  if (!dateKey) {
    container.innerHTML = '<div class="cal-empty">Select a date</div>';
    return;
  }
  const allEvs = VENUE_EVENTS[dateKey] || [];
  const evs = filterEventsForRole(allEvs, mode, staffId, promoterId);
  const monthStr = MONTH_NAMES[m];
  const weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(y, m, day).getDay()];

  const dateHeader = `<div class="cal-date-header">${weekday}, ${monthStr} ${day}</div>`;

  // Add event button (owner only)
  const addBtn = (mode === 'owner') ? `
    <button class="cal-add-btn" onclick="showAddEventModal('${dateKey}')">+ Add Event</button>` : '';

  // Reserve button (members only)  
  const reserveBtn = (mode === 'member' && evs.some(e => e.type === 'event')) ? `
    <button class="cal-reserve-btn" onclick="showReserveModal('${dateKey}')">Request Reservation</button>` : '';

  if (!evs.length) {
    container.innerHTML = dateHeader + addBtn + `<div class="cal-empty">Nothing scheduled${mode === 'member' ? ' — check back soon' : ''}</div>` + reserveBtn;
    return;
  }

  const savedDates = getSavedDates();
  const items = evs.map(e => {
    const tagColor = EVENT_TAG_COLORS[e.tag] || 'var(--accent)';
    const isSaved = isDateSaved(dateKey, e.name);

    let actions = '';
    if (mode === 'member' && e.saveDate) {
      actions = `<button class="cal-save-btn ${isSaved ? 'saved' : ''}" onclick="handleSaveDate('${dateKey}','${e.name.replace(/'/g,"\\'")}',this)">
        ${isSaved ? '✓ Saved' : 'Save Date'}
      </button>`;
    }
    if (mode === 'owner') {
      if (e.type === 'reservation') {
        // Show full purchase context including promoter attribution
        const sale = SALES_LOG.find(s => s.id === e.saleId || s.memberId === e.memberId);
        const promoTag = e.promoterId
          ? `<span style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;border:1px solid #34D39940;padding:2px 6px;border-radius:4px;margin-top:4px;display:inline-block">via ${(PROMOTER_LIST.find(p=>p.id===e.promoterId)||{}).name||e.promoterId}</span>`
          : '';
        const salesInfo = sale ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:4px">${sale.isComp ? 'COMPED' : '$'+sale.amount} · ${sale.partySize} guests · ${sale.status.toUpperCase()}</div>` : '';
        actions = `${promoTag}${salesInfo}<button class="cal-edit-btn" style="margin-top:6px" onclick="showEditEventModal('${dateKey}', '${e.name.replace(/'/g,"\\'")}')">Edit</button>`;
      } else {
        actions = `<button class="cal-edit-btn" onclick="showEditEventModal('${dateKey}', '${e.name.replace(/'/g,"\\'")}')">Edit</button>`;
      }
    }
    if (mode === 'promoter' && e.type === 'promoter') {
      actions = `<div class="cal-promo-stat">47 submitted · 12 confirmed</div>`;
    }

    return `<div class="cal-event-item">
      <div class="cal-event-left">
        <div class="cal-event-tag" style="color:${tagColor};border-color:${tagColor}40">${e.tag}</div>
        <div class="cal-event-time">${e.time}</div>
      </div>
      <div class="cal-event-body">
        <div class="cal-event-name">${e.name}</div>
        <div class="cal-event-desc">${e.desc}</div>
        ${actions}
      </div>
    </div>`;
  }).join('');

  container.innerHTML = dateHeader + addBtn + items + reserveBtn;
}

function handleSaveDate(dateKey, eventName, btn) {
  const nowSaved = toggleSaveDate(dateKey, eventName);
  btn.textContent = nowSaved ? '✓ Saved' : 'Save Date';
  btn.classList.toggle('saved', nowSaved);
}

// ── Add/Edit Event Modal (owner) ──
function showAddEventModal(dateKey) {
  const existing = document.getElementById('cal-event-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cal-event-modal';
  modal.className = 'security-modal';
  modal.style.cssText = 'display:flex;z-index:10002';
  modal.innerHTML = `
    <div class="security-modal-card" style="max-width:420px">
      <div class="security-title" style="font-size:18px;margin-bottom:4px">Add Event</div>
      <div class="security-sub" style="margin-bottom:20px">${dateKey}</div>
      <div class="form-group">
        <label class="form-label">Event Name</label>
        <input class="form-input" id="new-evt-name" placeholder="Event name">
      </div>
      <div class="form-group">
        <label class="form-label">Time</label>
        <input class="form-input" id="new-evt-time" placeholder="e.g. 10:00 PM">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" id="new-evt-desc" placeholder="Short details">
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-input" id="new-evt-type" style="font-family:'Space Mono',monospace;font-size:13px">
          <option value="event">DJ / Host Night</option>
          <option value="special">Daily Special / Promo</option>
          <option value="reservation">Reservation</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn-gold" onclick="saveNewEvent('${dateKey}')">Save Event</button>
        <button class="btn-ghost" onclick="document.getElementById('cal-event-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function saveNewEvent(dateKey) {
  const name = document.getElementById('new-evt-name').value.trim();
  const time = document.getElementById('new-evt-time').value.trim();
  const desc = document.getElementById('new-evt-desc').value.trim();
  const type = document.getElementById('new-evt-type').value;
  if (!name || !time) { showToast('Name and time are required'); return; }

  const tagMap = { event: 'DJ NIGHT', special: 'DAILY SPECIAL', reservation: 'RESERVATION' };
  if (!VENUE_EVENTS[dateKey]) VENUE_EVENTS[dateKey] = [];
  VENUE_EVENTS[dateKey].push({ type, time, name, desc: desc || '', tag: tagMap[type] || 'EVENT', saveDate: true });

  document.getElementById('cal-event-modal').remove();
  showToast(`"${name}" added to calendar`);
  // Re-render whichever calendar is active
  if (activeCalContainerDays) {
    renderCalendar(activeCalContainerDays, activeCalContainerEvents, activeCalDate, activeCalMode);
  }
  // Phase 2: push to Supabase events table here
}

function showEditEventModal(dateKey, eventName) {
  const evs = VENUE_EVENTS[dateKey] || [];
  const ev = evs.find(e => e.name === eventName);
  if (!ev) return;

  const existing = document.getElementById('cal-event-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cal-event-modal';
  modal.className = 'security-modal';
  modal.style.cssText = 'display:flex;z-index:10002';
  modal.innerHTML = `
    <div class="security-modal-card" style="max-width:420px">
      <div class="security-title" style="font-size:18px;margin-bottom:20px">Edit Event</div>
      <div class="form-group">
        <label class="form-label">Event Name</label>
        <input class="form-input" id="edit-evt-name" value="${ev.name}">
      </div>
      <div class="form-group">
        <label class="form-label">Time</label>
        <input class="form-input" id="edit-evt-time" value="${ev.time}">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" id="edit-evt-desc" value="${ev.desc}">
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn-gold" onclick="updateEvent('${dateKey}','${eventName}')">Update</button>
        <button class="btn-ghost" style="border-color:var(--error);color:var(--error)" onclick="deleteEvent('${dateKey}','${eventName}')">Delete</button>
        <button class="btn-ghost" onclick="document.getElementById('cal-event-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function updateEvent(dateKey, oldName) {
  const evs = VENUE_EVENTS[dateKey] || [];
  const ev = evs.find(e => e.name === oldName);
  if (!ev) return;
  ev.name = document.getElementById('edit-evt-name').value.trim() || ev.name;
  ev.time = document.getElementById('edit-evt-time').value.trim() || ev.time;
  ev.desc = document.getElementById('edit-evt-desc').value.trim();
  document.getElementById('cal-event-modal').remove();
  showToast('Event updated');
  if (activeCalContainerDays) renderCalendar(activeCalContainerDays, activeCalContainerEvents, activeCalDate, activeCalMode);
}

function deleteEvent(dateKey, eventName) {
  if (!window.confirm(`Delete "${eventName}"?`)) return;
  VENUE_EVENTS[dateKey] = (VENUE_EVENTS[dateKey] || []).filter(e => e.name !== eventName);
  document.getElementById('cal-event-modal').remove();
  showToast('Event deleted');
  if (activeCalContainerDays) renderCalendar(activeCalContainerDays, activeCalContainerEvents, activeCalDate, activeCalMode);
}

// ── Reservation request modal (members) ──
function showReserveModal(dateKey) {
  const existing = document.getElementById('reserve-modal');
  if (existing) existing.remove();

  const evs = (VENUE_EVENTS[dateKey] || []).filter(e => e.type === 'event');
  const eventName = evs[0]?.name || 'this night';

  const modal = document.createElement('div');
  modal.id = 'reserve-modal';
  modal.className = 'security-modal';
  modal.style.cssText = 'display:flex;z-index:10002';
  modal.innerHTML = `
    <div class="security-modal-card" style="max-width:400px">
      <div class="security-icon">🎟️</div>
      <div class="security-title" style="font-size:18px">Request Reservation</div>
      <div class="security-sub" style="margin-bottom:20px">For: ${eventName}</div>
      <div class="form-group">
        <label class="form-label">Party Size</label>
        <input class="form-input" id="res-size" type="number" placeholder="How many guests?" min="1" max="20">
      </div>
      <div class="form-group">
        <label class="form-label">Occasion</label>
        <select class="form-input" id="res-occasion" style="font-family:'Space Mono',monospace;font-size:13px">
          <option value="">General visit</option>
          <option value="birthday">Birthday celebration</option>
          <option value="corporate">Corporate / business</option>
          <option value="anniversary">Anniversary</option>
          <option value="other">Other special occasion</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <input class="form-input" id="res-notes" placeholder="Any special requests?">
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn-gold" onclick="submitReservation('${dateKey}', '${eventName}')">Submit Request</button>
        <button class="btn-ghost" onclick="document.getElementById('reserve-modal').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function submitReservation(dateKey, eventName) {
  const size     = document.getElementById('res-size').value;
  const occasion = document.getElementById('res-occasion').value;
  const notes    = document.getElementById('res-notes').value;
  if (!size) { showToast('Please enter party size'); return; }

  // Check if member arrived via a promoter link
  const refParam = new URLSearchParams(window.location.search).get('ref');
  const promoter = PROMOTER_LIST.find(p => p.id === refParam);

  const resId = 'RES' + Date.now().toString().slice(-5);

  // Push to reservation queue
  RESERVATION_QUEUE.push({
    id:          resId,
    memberName:  currentMember?.name || 'Guest',
    memberId:    currentMember?.id,
    memberPhone: currentMember?.phone,
    dateKey,
    eventName,
    partySize:   parseInt(size) || 1,
    occasion:    occasion || 'General visit',
    notes,
    referredByPromoter: promoter?.id || null,
    status:      'pending',
    requestedAt: Date.now(),
    tableAssigned: null,
    waitressAssigned: null,
  });

  // Log a pending table sale attributed to promoter if applicable
  const tablePrice = PRICING.find(p => p.id === 'table-' + (parseInt(size) <= 2 ? '2' : parseInt(size) <= 4 ? '4' : 'vip'));
  SALES_LOG.push({
    id:           resId,
    type:         'table',
    memberId:     currentMember?.id,
    memberName:   currentMember?.name || 'Guest',
    memberPhone:  currentMember?.phone,
    promoterId:   promoter?.id || null,
    promoterName: promoter?.name || null,
    eventName,
    dateKey,
    tableAssigned: null,
    partySize:    parseInt(size) || 1,
    amount:       tablePrice?.price || 0,
    isComp:       false,
    purchasedAt:  Date.now(),
    status:       'pending',
  });

  // Add to promoter guest list if referred
  if (promoter && currentMember?.name) {
    if (!promoter.guestList.includes(currentMember.name)) {
      promoter.guestList.push(currentMember.name);
    }
  }

  document.getElementById('reserve-modal').remove();
  showToast('Reservation request sent! We\'ll confirm by SMS.');
}

// ── Calendar nav helpers (multiple calendar instances) ──
function calNav(dir, labelId, daysId, eventsId, mode, staffId, promoterId) {
  const current = window[`_calDate_${daysId}`] || new Date();
  const next = new Date(current.getFullYear(), current.getMonth() + dir, 1);
  window[`_calDate_${daysId}`] = next;
  document.getElementById(labelId).textContent =
    `${MONTH_NAMES[next.getMonth()].toUpperCase()} ${next.getFullYear()}`;
  renderCalendar(
    document.getElementById(daysId),
    document.getElementById(eventsId),
    next, mode, staffId, promoterId
  );
}

function initCalendarWidget(labelId, daysId, eventsId, mode, staffId, promoterId) {
  const now = new Date();
  window[`_calDate_${daysId}`] = now;
  const el = document.getElementById(labelId);
  if (el) el.textContent = `${MONTH_NAMES[now.getMonth()].toUpperCase()} ${now.getFullYear()}`;
  const daysEl   = document.getElementById(daysId);
  const eventsEl = document.getElementById(eventsId);
  if (daysEl && eventsEl) {
    renderCalendar(daysEl, eventsEl, now, mode, staffId, promoterId);
  }
}

// ── Specific init functions for each portal ──
function initDashCalendar()      { initCalendarWidget('dash-cal-month-label', 'dash-cal-days', 'dash-cal-events', 'member'); }
function dashCalNav(dir)         { calNav(dir, 'dash-cal-month-label', 'dash-cal-days', 'dash-cal-events', 'member'); }

function initStaffCalendar(staffId)   { initCalendarWidget('staff-cal-month-label', 'staff-cal-days', 'staff-cal-events', 'staff', staffId); }
function staffCalNav(dir)             { calNav(dir, 'staff-cal-month-label', 'staff-cal-days', 'staff-cal-events', 'staff', currentLoggedStaffId); }

function initPromoterCalendar()  { initCalendarWidget('promo-cal-month-label', 'promo-cal-days', 'promo-cal-events', 'promoter', null, 'PRO001'); }
function promoCalNav(dir)        { calNav(dir, 'promo-cal-month-label', 'promo-cal-days', 'promo-cal-events', 'promoter', null, 'PRO001'); }

function initOwnerCalendar()     { initCalendarWidget('owner-cal-month-label', 'owner-cal-days', 'owner-cal-events', 'owner'); }
function ownerCalNav(dir)        { calNav(dir, 'owner-cal-month-label', 'owner-cal-days', 'owner-cal-events', 'owner'); }

let currentLoggedStaffId = null;

// ─── Profile Deletion ─────────────────────────────────────
async function confirmDeleteProfile() {
  if (!currentMember) return;
  const confirmed = window.confirm(`Are you sure you want to delete your profile? Your data will be archived, not permanently deleted.`);
  if (!confirmed) return;
  const client = getDb();
  if (client) {
    // Archive: copy to archived_members, then soft-delete in members
    await client.from('archived_members').insert([{
      original_id: currentMember.id,
      member_data: JSON.stringify(currentMember),
      archived_at: new Date().toISOString(),
      reason: 'member_requested',
    }]);
    await client.from('members').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', currentMember.id);
  }
  showToast('Profile archived. Contact us to restore anytime.');
  setTimeout(() => go('landing'), 2000);
}

// ─── Staff Role Selection ─────────────────────────────────
function selectStaffRole(role, btn) {
  currentStaffRole = role;
  document.querySelectorAll('.staff-role-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

// ─── Role-Based Staff Portal ──────────────────────────────
const ROLE_LABELS = {
  bartender: 'Bartender',
  waitress:  'Waitress',
  host:      'Host',
  'vip-host':'VIP Host',
  doorman:   'Doorman',
  barback:   'Barback',
  manager:   'Manager',
};

function setupStaffPortalForRole(role, staffObj) {
  const labelEl = document.getElementById('staff-role-display');
  const badgeEl = document.getElementById('staff-role-badge');
  const scanArea = document.getElementById('staff-scan-area');
  const smsArea = document.getElementById('staff-sms-area');
  const sectionInfo = document.getElementById('staff-section-info');
  const perksArea = document.getElementById('staff-perks-area');
  const ptsArea = document.getElementById('staff-pts-area');

  // Always reset reservations area — only manager/vip-host will re-enable it below
  const resAreaReset = document.getElementById('staff-reservations-area');
  if (resAreaReset) resAreaReset.style.display = 'none';

  // Clear any lingering member search result on every role switch
  clearStaffMemberResult();

  // Role-gate manual lookup — only manager and vip-host can text-search
  const lookupDiv = document.getElementById('staff-lookup-area');
  if (lookupDiv) {
    lookupDiv.style.display = ['manager','vip-host'].includes(role) ? 'block' : 'none';
  }

  labelEl.textContent = ROLE_LABELS[role] || role;
  badgeEl.textContent = (ROLE_LABELS[role] || role).toUpperCase();
  badgeEl.className = `role-badge ${role}`;

  // Use passed staff object or find by role
  const staffMember = staffObj || STAFF_LIST.find(s => s.role === role && s.active);
  currentStaffSection = staffMember?.section || null;

  if (currentStaffSection) {
    sectionInfo.style.display = 'block';
    document.getElementById('staff-section-label').textContent = `Assigned: ${currentStaffSection}`;
  } else {
    sectionInfo.style.display = 'none';
  }

  // Role capabilities:
  // barback: read all SMS, no scan, no respond
  // bartender: scan + private owner messages only
  // host: scan only, no SMS
  // waitress: scan + respond only to assigned section SMS
  // vip-host/manager: scan + all SMS + respond
  // security: scan + security alert SMS only
  // owner (handled separately): everything

  switch(role) {
    case 'barback':
      scanArea.style.display = 'none';
      smsArea.style.display = 'block';
      renderSMSThreads(role);
      break;
    case 'bartender':
      scanArea.style.display = 'block';
      smsArea.style.display = 'block';
      if (perksArea) perksArea.style.display = 'block';
      if (ptsArea) ptsArea.style.display = 'none';
      renderSMSThreads('bartender');
      break;
    case 'host':
      scanArea.style.display = 'block';
      smsArea.style.display = 'none';
      if (perksArea) perksArea.style.display = 'block';
      if (ptsArea) ptsArea.style.display = 'none';
      break;
    case 'waitress':
      scanArea.style.display = 'block';
      smsArea.style.display = 'block';
      if (ptsArea) ptsArea.style.display = 'none';
      renderSMSThreads(role, currentStaffSection);
      break;
    case 'doorman':
      scanArea.style.display = 'block';
      smsArea.style.display = 'block';
      renderSMSThreads(role);
      renderDoormanGuestListArea();
      break;
    case 'vip-host':
    case 'manager':
      scanArea.style.display = 'block';
      smsArea.style.display = 'block';
      renderSMSThreads(role);
      const resArea = document.getElementById('staff-reservations-area');
      if (resArea) { resArea.style.display = 'block'; renderStaffReservations(); }
      break;
  }

  // Init staff calendar for this staff member's shifts + venue events
  currentLoggedStaffId = staffMember?.id || null;
  setTimeout(() => initStaffCalendar(currentLoggedStaffId), 80);

  // Setup referral link for this staff member
  const linkMember = staffMember || { id: 'STAFF-' + role.toUpperCase(), name: role };
  setupStaffLink(linkMember);

  // Show scheduling panel for manager/vip-host
  const scheduleArea = document.getElementById('staff-schedule-area');
  if (scheduleArea) {
    scheduleArea.style.display = (role === 'manager' || role === 'vip-host') ? 'block' : 'none';
    if (role === 'manager' || role === 'vip-host') renderSchedulePanel('staff');
  }
}

function renderSMSThreads(role, assignedSection) {
  const container = document.getElementById('staff-sms-threads');
  const securityAlertRoles = ['owner', 'manager', 'vip-host', 'doorman'];
  const canReply = ['waitress', 'vip-host', 'manager', 'doorman', 'owner'].includes(role);
  const readOnly = role === 'barback';
  const canInitiate = ['owner', 'manager', 'vip-host'].includes(role);

  // ── Doorman security compose ──
  const securityComposeId = 'doorman-security-compose';
  let securityComposeHtml = '';
  if (role === 'doorman') {
    securityComposeHtml = `
      <div id="${securityComposeId}" style="margin-bottom:16px">
        <button class="cal-save-btn" style="border-color:var(--error);color:var(--error);width:100%" onclick="toggleSecurityCompose()">⚠ Send Security Alert</button>
        <div id="security-compose-form" style="display:none;margin-top:10px;background:var(--bg2);border:1px solid var(--error);border-radius:10px;padding:14px">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--error);letter-spacing:0.08em;margin-bottom:10px">SECURITY ALERT — OWNER · MANAGER · VIP HOST</div>
          <textarea class="form-input" id="security-alert-text" rows="3" placeholder="Describe the situation..." style="resize:none;width:100%;box-sizing:border-box;font-size:13px"></textarea>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="cal-save-btn" style="border-color:var(--error);color:var(--error);flex:1" onclick="sendSecurityAlert()">Send Alert</button>
            <button class="cal-save-btn" style="flex:1" onclick="toggleSecurityCompose()">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  // ── Message Owner button (all non-owner staff) ──
  let msgOwnerHtml = '';
  if (role !== 'owner') {
    const staffObj = STAFF_LIST.find(s => s.id === currentLoggedStaffId);
    const staffName = staffObj?.name || ROLE_LABELS[role] || role;
    msgOwnerHtml = `
      <div style="margin-bottom:16px">
        <button class="cal-save-btn" style="border-color:var(--accent);color:var(--accent);width:100%" onclick="toggleStaffOwnerCompose()">
          👤 Message Owner
        </button>
        <div id="staff-owner-compose-area" style="display:none;margin-top:10px;background:var(--bg2);border:1px solid var(--accent);border-radius:10px;padding:14px">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);letter-spacing:0.08em;margin-bottom:10px">PRIVATE MESSAGE — OWNER ONLY</div>
          <textarea class="form-input" id="staff-owner-msg-input" rows="2" placeholder="Message the owner privately..." style="resize:none;width:100%;box-sizing:border-box;font-size:13px"></textarea>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="cal-save-btn" style="border-color:var(--accent);color:var(--accent);flex:1" onclick="sendStaffOwnerMessage()">Send</button>
            <button class="cal-save-btn" style="flex:1" onclick="toggleStaffOwnerCompose()">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  // ── New thread picker (owner/manager/vip-host) ──
  let newThreadHtml = '';
  if (canInitiate) {
    const existingMembers = SMS_THREADS
      .filter(t => !t.isSecurityAlert && t.memberName && t.type !== 'PRIVATE')
      .map(t => ({ id: t.id, memberId: t.memberId, name: t.memberName }));
    if (existingMembers.length) {
      newThreadHtml = `
        <div style="margin-bottom:14px">
          <button class="cal-save-btn" style="width:100%" onclick="toggleNewThreadPicker()">+ New Message</button>
          <div id="new-thread-picker" style="display:none;margin-top:10px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px">
            <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);letter-spacing:0.08em;margin-bottom:10px">SELECT MEMBER TO MESSAGE</div>
            <select class="form-input" id="new-thread-member-select" style="font-family:'Space Mono',monospace;font-size:12px;margin-bottom:10px">
              <option value="">Choose member...</option>
              ${existingMembers.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
            <textarea class="form-input" id="new-thread-text" rows="2" placeholder="Your message..." style="resize:none;width:100%;box-sizing:border-box;font-size:13px;margin-bottom:10px"></textarea>
            <div style="display:flex;gap:8px">
              <button class="cal-save-btn" style="flex:1" onclick="sendNewThreadMessage()">Send</button>
              <button class="cal-save-btn" style="flex:1" onclick="toggleNewThreadPicker()">Cancel</button>
            </div>
          </div>
        </div>`;
    }
  }

  // ── Filter threads visible to this role ──
  let threads = SMS_THREADS.filter(t => {
    const type = t.type;
    const recipients = t.recipientRoles || defaultRecipientRolesForTag(t.tag || 'GENERAL');

    // PRIVATE threads: only visible to owner AND the specific participant
    if (type === 'PRIVATE') {
      if (role === 'owner') return true;
      // Staff participant sees their own private thread
      return t.privateParticipantRole === 'staff' && t.privateParticipantId === currentLoggedStaffId;
    }

    // Security alerts
    const isSecAlert = t.isSecurityAlert || type === 'SECURITY' || t.tag === 'SECURITY';
    if (isSecAlert) return recipients.includes(role);

    // Doorman only sees security
    if (role === 'doorman') return false;

    // Check recipient list
    if (!recipients.includes(role)) return false;

    // Waitress: only see FLOOR threads assigned to her
    if (role === 'waitress') {
      if (type === 'FLOOR' || t.tag === 'FLOOR') {
        return t.waitressId === currentLoggedStaffId ||
               (assignedSection && t.section === assignedSection) ||
               (t.recipientRoles && t.recipientRoles.includes('waitress'));
      }
      return false;
    }

    // Barback: only sees FLOOR threads
    if (role === 'barback') {
      return type === 'FLOOR' || t.tag === 'FLOOR';
    }

    // Bartender: only sees PRIVATE threads the owner opened with them directly
    if (role === 'bartender') {
      return type === 'PRIVATE' &&
             t.privateParticipantRole === 'staff' &&
             t.privateParticipantId === currentLoggedStaffId;
    }

    return true;
  });

  // Tag colour helper
  const tagPill = (tag, threadId, canRetag) => {
    const col = THREAD_TAG_COLORS[tag] || '#888';
    const pill = `<span style="font-family:'Space Mono',monospace;font-size:9px;padding:2px 7px;border-radius:4px;background:${col}22;color:${col};border:1px solid ${col}44;letter-spacing:0.05em">${tag}</span>`;
    if (!canRetag) return pill;
    const opts = THREAD_TAGS.map(tg => `<option value="${tg}" ${tg===tag?'selected':''}>${tg}</option>`).join('');
    return `<div style="display:inline-flex;align-items:center;gap:6px">
      ${pill}
      <select onchange="retagThread('${threadId}',this.value)" style="font-family:'Space Mono',monospace;font-size:9px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--muted);padding:2px 4px;cursor:pointer">${opts}</select>
    </div>`;
  };

  const canRetag = ['manager','vip-host'].includes(role); // not owner (owner uses move in their own panel)

  if (!threads.length) {
    container.innerHTML = securityComposeHtml + msgOwnerHtml + newThreadHtml +
      `<div style="padding:20px 0;text-align:center;color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">No messages in your queue</div>`;
    return;
  }

  container.innerHTML = securityComposeHtml + msgOwnerHtml + newThreadHtml + threads.map(t => {
    const tag = t.tag || (t.isSecurityAlert ? 'SECURITY' : 'GENERAL');
    const displayName = t.threadName || t.memberName || 'Unknown';
    const sectionTag = t.tableNum
      ? `<span style="color:var(--accent);font-family:'Space Mono',monospace;font-size:9px">${t.tableNum}</span>`
      : '';
    const privateLabel = t.type === 'PRIVATE'
      ? `<span style="font-family:'Space Mono',monospace;font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.3);color:var(--accent)">PRIVATE</span>`
      : '';
    const msgs = t.messages.map(msg => {
      if (msg.from === 'internal') {
        return `<div style="padding:8px 12px;margin:4px 0;background:rgba(96,165,250,0.08);border-left:2px solid #60A5FA;border-radius:4px">
          <div style="font-family:'Space Mono',monospace;font-size:10px;color:#60A5FA">${msg.text}</div>
          <div class="sms-msg-meta" style="margin-top:3px">Team · ${msg.time}</div>
        </div>`;
      }
      const senderLabel = msg.from === 'member' ? t.memberName
        : msg.from === 'staff-member' ? (msg.senderName || 'Staff')
        : 'You';
      return `<div class="sms-msg ${(msg.from === 'staff' || msg.from === 'staff-member') ? 'outbound' : ''}">
        <div>${msg.text}</div>
        <div class="sms-msg-meta">${senderLabel} · ${msg.time}</div>
      </div>`;
    }).join('');
    const replySection = canReply ? `
      <div class="sms-reply-row">
        <input class="sms-reply-input" id="sms-reply-${t.id}" placeholder="Reply..." type="text">
        <button class="sms-send-btn" onclick="sendSMSReply('${t.id}')">SEND</button>
      </div>` : (readOnly ? `<div class="readonly-notice">READ ONLY</div>` : '');
    return `
      <div class="sms-thread${t.type === 'PRIVATE' ? ' sms-thread-private' : ''}">
        <div class="sms-thread-header">
          <div>
            <div class="sms-thread-title">${displayName}</div>
            <div style="margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${tagPill(tag, t.id, canRetag)}
              ${sectionTag}
              ${privateLabel}
            </div>
          </div>
          ${tag === 'SECURITY' ? '<span style="color:var(--error);font-family:Space Mono,monospace;font-size:9px">⚠ ALERT</span>' : ''}
        </div>
        <div class="sms-messages">${msgs}</div>
        ${replySection}
      </div>`;
  }).join('');
}

// ─── Staff → Owner Private Message ────────────────────────
function toggleStaffOwnerCompose() {
  const area = document.getElementById('staff-owner-compose-area');
  if (!area) return;
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
  if (area.style.display === 'block') {
    setTimeout(() => document.getElementById('staff-owner-msg-input')?.focus(), 50);
  }
}

function sendStaffOwnerMessage() {
  const text = document.getElementById('staff-owner-msg-input')?.value?.trim();
  if (!text) return showToast('Enter a message');
  const staffObj = STAFF_LIST.find(s => s.id === currentLoggedStaffId);
  const staffName = staffObj?.name || ROLE_LABELS[currentStaffRole] || currentStaffRole || 'Staff';
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Find or create PRIVATE thread for this staff member → owner
  const existing = SMS_THREADS.find(t =>
    t.type === 'PRIVATE' &&
    t.privateParticipantRole === 'staff' &&
    t.privateParticipantId === currentLoggedStaffId
  );
  if (existing) {
    existing.messages.push({ from: 'staff-member', text, time, senderName: staffName });
  } else {
    SMS_THREADS.push({
      id:                   `PRIV-STAFF-${currentLoggedStaffId || currentStaffRole}-${Date.now()}`,
      type:                 'PRIVATE',
      threadName:           `Message with ${staffName}`,
      memberId:             null,
      memberName:           staffName,
      memberPhone:          null,
      privateParticipantId:   currentLoggedStaffId || ('ROLE-' + currentStaffRole),
      privateParticipantRole: 'staff',
      staffRole:            currentStaffRole,
      section: null, tableNum: null,
      isSecurityAlert: false,
      tag:  'GENERAL',
      recipientRoles: ['owner'],
      messages: [{ from: 'staff-member', text, time, senderName: staffName }],
    });
  }
  document.getElementById('staff-owner-msg-input').value = '';
  toggleStaffOwnerCompose();
  showToast('Message sent to owner');
  renderSMSThreads(currentStaffRole, currentStaffSection);
}

// ─── Move Thread (Owner) — changes type, routing, name ────
function moveThread(threadId, newType) {
  const thread = SMS_THREADS.find(t => t.id === threadId);
  if (!thread) return;
  thread.type = newType;
  thread.tag = newType;
  thread.isSecurityAlert = (newType === 'SECURITY');
  thread.recipientRoles = defaultRecipientRolesForType(newType);
  thread.threadName = defaultThreadNameForType(newType, thread.memberName, thread.tableNum);
  // FLOOR keeps its waitressId if one is set
  showToast(`Thread moved → ${newType}`);
  renderOwnerMessages();
}

// ─── Retag Thread (Manager / VIP Host — display tag only) ─
function retagThread(threadId, newTag) {
  const thread = SMS_THREADS.find(t => t.id === threadId);
  if (!thread) return;
  thread.tag = newTag;
  thread.isSecurityAlert = (newTag === 'SECURITY');
  // Also update recipientRoles to match new tag
  thread.recipientRoles = defaultRecipientRolesForTag(newTag);
  showToast(`Thread retagged → ${newTag}`);
  renderSMSThreads(currentStaffRole, currentStaffSection);
}

// ─── Security Alert Compose (Doorman) ─────────────────────
function toggleSecurityCompose() {
  const form = document.getElementById('security-compose-form');
  if (!form) return;
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') {
    document.getElementById('security-alert-text')?.focus();
  }
}

function sendSecurityAlert() {
  const text = document.getElementById('security-alert-text')?.value?.trim();
  if (!text) return showToast('Describe the situation first');
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const alertId = 'SEC-' + Date.now().toString().slice(-5);
  SMS_THREADS.push({
    id: alertId,
    type: 'SECURITY',
    threadName: `Security Alert — ${time}`,
    memberId: null,
    memberName: 'Security Alert',
    memberPhone: null,
    section: null, tableNum: null,
    isSecurityAlert: true,
    tag: 'SECURITY',
    recipientRoles: ['doorman','manager','vip-host','owner'],
    messages: [{ from: 'staff', text, time }],
  });
  showToast('⚠ Security alert sent to Owner, Manager & VIP Host');
  renderSMSThreads('doorman');

  // Force owner to Messages tab immediately so alert is visible without tab switch
  const ownerScreen = document.getElementById('owner');
  if (ownerScreen && ownerScreen.classList.contains('active')) {
    const msgTab = document.querySelector('#owner .owner-tab[onclick*="messages"]');
    if (msgTab) switchOwnerTab('messages', msgTab);
  } else {
    // Owner is not on owner screen — just keep messages fresh for when they get there
    renderOwnerMessages();
  }
}

// ─── New Thread Initiation (Owner / Manager / VIP Host) ───
function toggleNewThreadPicker() {
  const picker = document.getElementById('new-thread-picker');
  if (!picker) return;
  picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function sendNewThreadMessage() {
  const threadId = document.getElementById('new-thread-member-select')?.value;
  const text = document.getElementById('new-thread-text')?.value?.trim();
  if (!threadId) return showToast('Select a member');
  if (!text) return showToast('Enter a message');
  const thread = SMS_THREADS.find(t => t.id === threadId);
  if (!thread) return showToast('Thread not found');
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  thread.messages.push({ from: 'staff', text, time });
  // Push back to member's own thread
  if (thread.memberId) {
    const memberThread = getMemberThread(thread.memberId);
    memberThread.push({ from: 'staff', text, time });
  }
  showToast('Message sent to ' + thread.memberName);
  renderSMSThreads(currentStaffRole, currentStaffSection);
}

// ─── Owner new thread initiation — handled by renderOwnerMessages composer ────
function toggleOwnerNewThread() { /* Replaced by inline composer in renderOwnerMessages */ }
function ownerSendNewThread()   { /* Replaced by ownerSendNewCompose */ }

// ─── Doorman Guest List Check-In Area ─────────────────────
function renderDoormanGuestListArea() {
  // Inject guest list check-in panel below SMS area in staff portal
  const existing = document.getElementById('doorman-guestlist-area');
  if (existing) { existing.remove(); }

  const staffScreen = document.getElementById('staff');
  const panel = document.createElement('div');
  panel.id = 'doorman-guestlist-area';
  panel.style.cssText = 'margin-top:24px';
  panel.innerHTML = `
    <div class="perks-heading">Guest List Check-In</div>
    <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:14px;line-height:1.8">
      Scan a member's QR or search by name to verify guest list arrival.
    </div>
    <div class="staff-lookup" style="margin-bottom:12px">
      <input class="form-input" id="doorman-gl-search" type="text" placeholder="Member name or phone">
      <button onclick="doormanGuestSearch()">Search</button>
    </div>
    <div id="doorman-gl-result" style="margin-bottom:12px"></div>
    <div id="doorman-gl-list" style="margin-top:16px"></div>`;
  staffScreen.appendChild(panel);
  renderDoormanGuestList();
}

function doormanGuestSearch() {
  const query = document.getElementById('doorman-gl-search')?.value?.trim().toLowerCase();
  if (!query) return;
  // Find member in registered members list
  const member = members.find(m =>
    m.name.toLowerCase().includes(query) || m.phone.includes(query)
  );
  const resultEl = document.getElementById('doorman-gl-result');
  if (!member) {
    resultEl.innerHTML = `<div style="font-family:'Space Mono',monospace;font-size:11px;color:var(--error);padding:10px 0">No registered member found</div>`;
    return;
  }
  // Check if on any promoter guest list
  const match = findMemberOnGuestList(member.id, member.name);
  if (!match) {
    resultEl.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:15px;color:var(--text);margin-bottom:4px">${member.name}</div>
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted)">Registered member — not on any guest list tonight</div>
      </div>`;
    return;
  }
  showDoormanArrivalCard(member, match);
}

function findMemberOnGuestList(memberId, memberName) {
  for (const promoter of PROMOTER_LIST) {
    const idx = promoter.guestList.findIndex(g =>
      (g.memberId && g.memberId === memberId) ||
      (typeof g === 'string' && g.toLowerCase() === memberName.toLowerCase())
    );
    if (idx >= 0) return { promoter, idx };
  }
  return null;
}

function showDoormanArrivalCard(member, match) {
  const { promoter, idx } = match;
  const guest = promoter.guestList[idx];
  const alreadyArrived = guest?.arrived || false;
  const resultEl = document.getElementById('doorman-gl-result');
  resultEl.innerHTML = `
    <div style="background:var(--bg2);border:1px solid ${alreadyArrived ? '#34D399' : 'var(--accent)'};border-radius:10px;padding:14px">
      <div style="font-size:15px;color:var(--text);margin-bottom:2px">${member.name}</div>
      <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--accent);margin-bottom:8px">
        On ${promoter.name}'s list
      </div>
      ${alreadyArrived
        ? `<div style="font-family:'Space Mono',monospace;font-size:11px;color:#34D399">✓ Already checked in</div>`
        : `<button class="btn-gold" style="padding:12px;font-size:13px" onclick="markGuestArrived('${promoter.id}',${idx},'${member.id}','${member.name.replace(/'/g,"\\'")}')">✓ Mark Arrived</button>`
      }
    </div>`;
}

function markGuestArrived(promoterId, idx, memberId, memberName) {
  const promoter = PROMOTER_LIST.find(p => p.id === promoterId);
  if (!promoter) return;
  const guest = promoter.guestList[idx];
  if (typeof guest === 'string') {
    // Upgrade string entry to object with arrived flag
    promoter.guestList[idx] = { name: guest, memberId, arrived: true, arrivedAt: Date.now() };
  } else {
    guest.arrived = true;
    guest.memberId = memberId;
    guest.arrivedAt = Date.now();
  }
  showToast(`${memberName} marked as arrived on ${promoter.name}'s list`);
  renderDoormanGuestList();
  // Refresh arrival card to show confirmed state
  const member = members.find(m => m.id === memberId) || { id: memberId, name: memberName };
  showDoormanArrivalCard(member, { promoter, idx });
}

function renderDoormanGuestList() {
  const container = document.getElementById('doorman-gl-list');
  if (!container) return;
  const activePromoters = PROMOTER_LIST.filter(p => p.active && p.guestList.length);
  if (!activePromoters.length) {
    container.innerHTML = `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--dim);padding:10px 0">No guest lists active tonight</div>`;
    return;
  }
  container.innerHTML = activePromoters.map(p => {
    const guests = p.guestList.map((g, i) => {
      const name   = typeof g === 'string' ? g : g.name;
      const arrived = typeof g === 'object' && g.arrived;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-family:'Space Mono',monospace;font-size:11px;color:${arrived ? '#34D399' : 'var(--text)'}">${name}</span>
        <span style="font-family:'Space Mono',monospace;font-size:9px;color:${arrived ? '#34D399' : 'var(--muted)'}">${arrived ? '✓ ARRIVED' : 'PENDING'}</span>
      </div>`;
    }).join('');
    const arrivedCount = p.guestList.filter(g => typeof g === 'object' && g.arrived).length;
    return `
      <div style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:0.08em">${p.name.toUpperCase()}'S LIST</div>
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted)">${arrivedCount}/${p.guestList.length} arrived</div>
        </div>
        ${guests}
      </div>`;
  }).join('');
}

// QR scan path for doorman guest list check-in
function doormanScanForGuestList(memberId) {
  const member = members.find(m => m.id === memberId);
  if (!member) {
    document.getElementById('doorman-gl-result').innerHTML =
      `<div style="font-family:'Space Mono',monospace;font-size:11px;color:var(--error);padding:10px 0">Member not found in system</div>`;
    return;
  }
  const match = findMemberOnGuestList(member.id, member.name);
  if (!match) {
    document.getElementById('doorman-gl-result').innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px">
        <div style="font-size:15px;color:var(--text);margin-bottom:4px">${member.name}</div>
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted)">Registered member — not on any guest list tonight</div>
      </div>`;
    return;
  }
  showDoormanArrivalCard(member, match);
}



// ─── Owner Staff Management ───────────────────────────────
function renderOwnerStaff() {
  const active = STAFF_LIST.filter(s => s.active);
  const inactive = STAFF_LIST.filter(s => !s.active);

  const renderStaffRow = (s) => `
    <div class="employee-row ${s.active ? '' : 'inactive'}">
      <div class="employee-info">
        <div class="employee-name">${s.name}</div>
        <div class="employee-meta">
          <span class="role-badge ${s.role}" style="margin-right:8px">${ROLE_LABELS[s.role]?.toUpperCase()}</span>
          ${s.section ? `· ${s.section}` : ''}
        </div>
      </div>
      <div class="employee-actions">
        <button class="btn-toggle-active" onclick="toggleStaffActive('${s.id}')">${s.active ? 'Go Inactive' : 'Reactivate'}</button>
        <button class="btn-archive-staff" onclick="archiveStaff('${s.id}')">Archive</button>
      </div>
    </div>`;

  document.getElementById('owner-staff-list').innerHTML = active.length
    ? active.map(renderStaffRow).join('')
    : '<div style="color:var(--muted);font-family:Space Mono,monospace;font-size:11px;padding:12px 0">No active staff</div>';

  document.getElementById('owner-inactive-staff-list').innerHTML = inactive.length
    ? inactive.map(renderStaffRow).join('')
    : '<div style="color:var(--muted);font-family:Space Mono,monospace;font-size:11px;padding:12px 0">None</div>';

  // Section assignments
  const sections = [...new Set(STAFF_LIST.filter(s => s.section).map(s => s.section))];
  const sectionsHtml = sections.length ? sections.map(sec => {
    const assigned = STAFF_LIST.filter(s => s.section === sec && s.active);
    return `<div style="margin-bottom:12px">
      <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--accent);margin-bottom:6px">${sec}</div>
      ${assigned.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span class="role-badge ${s.role}">${ROLE_LABELS[s.role]?.toUpperCase()}</span>
        <span style="font-size:13px">${s.name}</span>
      </div>`).join('')}
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-family:Space Mono,monospace;font-size:11px;padding:12px 0">No sections assigned tonight</div>';

  document.getElementById('owner-section-assignments').innerHTML = sectionsHtml;
}

function toggleStaffActive(id) {
  const s = STAFF_LIST.find(s => s.id === id);
  if (s) { s.active = !s.active; renderOwnerStaff(); showToast(`${s.name} marked ${s.active ? 'active' : 'inactive'}`); }
}

function archiveStaff(id) {
  const s = STAFF_LIST.find(s => s.id === id);
  if (!s) return;
  const confirmed = window.confirm(`Archive ${s.name}? Their profile will be moved to inactive employees. Only you can remove it.`);
  if (!confirmed) return;
  STAFF_LIST = STAFF_LIST.filter(s => s.id !== id);
  // Phase 2: move to archived_staff table in Supabase
  renderOwnerStaff();
  showToast(`${s.name} archived`);
}

// ─── Scheduling ───────────────────────────────────────────
// Shift store: { id, staffId, dateKey, startTime, endTime, role, note }
let SCHEDULE = [];

// Track which context the schedule form belongs to (avoids ID collision)
let _schedCtx = null; // 'owner' | 'staff'

function openScheduleForm(ctx) {
  // ctx = 'owner' or 'staff'
  _schedCtx = ctx;
  const formId   = ctx === 'owner' ? 'owner-sched-form'   : 'staff-sched-form';
  const existing = document.getElementById(formId);
  if (existing) { existing.remove(); _schedCtx = null; return; } // toggle close

  const now = new Date();
  const dk  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const allStaff = STAFF_LIST;

  if (!allStaff.length) {
    showToast('Add staff members first before scheduling shifts');
    _schedCtx = null;
    return;
  }

  const form = document.createElement('div');
  form.id = formId;
  form.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:12px';
  form.innerHTML = `
    <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:0.08em;margin-bottom:12px">ADD SHIFT</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <select class="form-input" id="${ctx}-sf-staff" style="font-family:'Space Mono',monospace;font-size:12px">
        <option value="">Select staff member...</option>
        ${allStaff.map(s => `<option value="${s.id}">${s.name} — ${ROLE_LABELS[s.role]||s.role}</option>`).join('')}
      </select>
      <input class="form-input" id="${ctx}-sf-date" type="date" value="${dk}">
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:4px">START TIME</div>
          <input class="form-input" id="${ctx}-sf-start" type="time" value="21:00">
        </div>
        <div style="flex:1">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:4px">END TIME</div>
          <input class="form-input" id="${ctx}-sf-end" type="time" value="03:00">
        </div>
      </div>
      <input class="form-input" id="${ctx}-sf-note" placeholder="Note (optional, e.g. VIP Section A)">
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn-gold" style="flex:1" onclick="addShift('${ctx}')">Add Shift</button>
        <button class="btn-ghost" onclick="document.getElementById('${formId}').remove()">Cancel</button>
      </div>
    </div>`;

  // Insert form after the "Add Shift" button that triggered it
  const triggerId = ctx === 'owner' ? 'owner-add-shift-btn' : 'staff-add-shift-btn';
  const trigger   = document.getElementById(triggerId);
  if (trigger && trigger.parentNode) {
    trigger.parentNode.insertBefore(form, trigger.nextSibling);
  } else {
    const panel = document.getElementById(ctx === 'owner' ? 'owner-schedule-panel' : 'schedule-panel');
    if (panel) panel.appendChild(form);
  }
}

function addShift(ctx) {
  const staffId   = document.getElementById(`${ctx}-sf-staff`)?.value;
  const dateKey   = document.getElementById(`${ctx}-sf-date`)?.value;
  const startTime = document.getElementById(`${ctx}-sf-start`)?.value;
  const endTime   = document.getElementById(`${ctx}-sf-end`)?.value;
  const note      = document.getElementById(`${ctx}-sf-note`)?.value?.trim();

  if (!staffId)   return showToast('Select a staff member');
  if (!dateKey)   return showToast('Select a date');
  if (!startTime || !endTime) return showToast('Enter start and end times');

  const staff = STAFF_LIST.find(s => s.id === staffId);
  const id    = 'SH' + Date.now();
  SCHEDULE.push({ id, staffId, dateKey, startTime, endTime, role: staff?.role || '', note: note || '' });

  // Mirror into VENUE_EVENTS calendar
  if (!VENUE_EVENTS[dateKey]) VENUE_EVENTS[dateKey] = [];
  VENUE_EVENTS[dateKey].push({
    type: 'shift', time: `${startTime}–${endTime}`, name: staff?.name || 'Staff',
    desc: `${ROLE_LABELS[staff?.role]||staff?.role||''}${note ? ' · ' + note : ''}`,
    tag: 'SHIFT', staffId, private: true
  });

  // Close form and refresh
  const formId = ctx === 'owner' ? 'owner-sched-form' : 'staff-sched-form';
  const form   = document.getElementById(formId);
  if (form) form.remove();
  _schedCtx = null;

  showToast(`Shift added — ${staff?.name || 'staff'}`);
  refreshScheduleView(ctx);
}

function removeShift(shiftId, ctx) {
  const sh = SCHEDULE.find(s => s.id === shiftId);
  if (!sh) return;
  SCHEDULE = SCHEDULE.filter(s => s.id !== shiftId);
  if (VENUE_EVENTS[sh.dateKey]) {
    VENUE_EVENTS[sh.dateKey] = VENUE_EVENTS[sh.dateKey].filter(
      e => !(e.type === 'shift' && e.staffId === sh.staffId && e.time === `${sh.startTime}–${sh.endTime}`)
    );
  }
  showToast('Shift removed');
  refreshScheduleView(ctx || 'owner');
}

function refreshScheduleView(ctx) {
  renderWeeklySchedule(ctx);
  renderWhoIsOnDuty(ctx);
}

// ── Weekly schedule list (read + remove) ──────────────────
function renderWeeklySchedule(ctx) {
  const containerId = ctx === 'owner' ? 'owner-weekly-schedule' : 'staff-weekly-schedule';
  const container   = document.getElementById(containerId);
  if (!container) return;

  const now  = new Date();
  const toDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i);
    days.push(d);
  }

  const canEdit = true; // owner, manager, vip-host can all edit

  let html = '';
  days.forEach((d, i) => {
    const key       = toDateKey(d);
    const dayShifts = SCHEDULE.filter(s => s.dateKey === key);
    const isToday   = i === 0;
    const dayLabel  = isToday
      ? 'TODAY — ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()
      : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();

    html += `<div style="margin-bottom:16px">
      <div style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:0.08em;margin-bottom:6px;color:${isToday ? 'var(--accent)' : 'var(--muted)'}">${dayLabel}</div>`;

    if (!dayShifts.length) {
      html += `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--dim);padding:6px 10px;background:var(--bg2);border-radius:8px">No shifts scheduled</div>`;
    } else {
      dayShifts.forEach(sh => {
        const staff = STAFF_LIST.find(s => s.id === sh.staffId);
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg2);border-radius:8px;margin-bottom:4px;border-left:3px solid var(--accent)">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
              <span class="role-badge ${staff?.role||''}">${(ROLE_LABELS[staff?.role]||staff?.role||'').toUpperCase()}</span>
              <span style="font-size:13px;color:var(--text)">${staff?.name || 'Unknown'}</span>
            </div>
            <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted)">${sh.startTime} – ${sh.endTime}${sh.note ? ' · ' + sh.note : ''}</div>
          </div>
          ${canEdit ? `<button onclick="removeShift('${sh.id}','${ctx}')" style="background:transparent;border:1px solid var(--error);border-radius:6px;color:var(--error);cursor:pointer;font-family:'Space Mono',monospace;font-size:9px;padding:4px 8px">Remove</button>` : ''}
        </div>`;
      });
    }
    html += `</div>`;
  });

  container.innerHTML = html;
}

// ── Who's on duty today ────────────────────────────────────
function renderWhoIsOnDuty(ctx) {
  const containerId = ctx === 'staff' ? 'on-duty-list' : 'owner-on-duty-list';
  const container   = document.getElementById(containerId);
  if (!container) return;

  const now = new Date();
  const dk  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const todayShifts = SCHEDULE.filter(s => s.dateKey === dk);

  if (!todayShifts.length) {
    container.innerHTML = `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--dim);padding:10px 0">No shifts scheduled for tonight — add shifts below</div>`;
    return;
  }

  container.innerHTML = todayShifts.map(sh => {
    const staff = STAFF_LIST.find(s => s.id === sh.staffId);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span class="role-badge ${staff?.role||''}">${(ROLE_LABELS[staff?.role]||'').toUpperCase()}</span>
      <div>
        <div style="font-size:13px;color:var(--text)">${staff?.name || 'Unknown'}</div>
        <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:2px">${sh.startTime} – ${sh.endTime}${sh.note ? ' · ' + sh.note : ''}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Main render entry point (called by tab switch) ─────────
function renderSchedulePanel(ctx) {
  renderWhoIsOnDuty(ctx || 'owner');
  renderWeeklySchedule(ctx || 'owner');
}

const PERKS = [
  { id: 'parking', icon: 'P',   title: '50% Parking Discount',  desc: 'Half off parking every visit',       color: '#D4FF00' },
  { id: 'entry',   icon: 'IN',  title: 'Free Entry',             desc: 'Complimentary door access tonight',  color: '#00FF85' },
  { id: 'drink',   icon: 'DR',  title: 'First Drink Free',       desc: 'One complimentary drink on us',      color: '#00CFFF' },
  { id: 'bar',     icon: '10',  title: '10% Bar Discount',       desc: 'On all bar orders tonight',          color: '#FFB800' },
  { id: 'hookah',  icon: '15',  title: '15% Hookah Discount',    desc: 'On all hookah selections',           color: '#A78BFA' },
  { id: 'door',    icon: 'VIP', title: 'No Door Fee',            desc: 'Waived with any table purchase',     color: '#00FF85' },
  { id: 'bday',    icon: 'BD',  title: 'Birthday Package',       desc: 'Reserve your VIP birthday party',    color: '#FF6FC8' },
  { id: 'points',  icon: 'PT',  title: 'Points Per $1 Spent',    desc: 'Earn rewards on every dollar',       color: '#D4FF00' },
];

// ─── Data Helpers ─────────────────────────────────────────
async function loadMembers() {
  try {
    const client = getDb();
    if (!client) { members = []; return; }
    const { data, error } = await client
      .from('members')
      .select('id, first_name, last_name, phone, email, date_of_birth, created_at, total_points, total_visits')
      .order('created_at', { ascending: false });
    if (error) { console.error('loadMembers error:', error.message); members = []; return; }
    members = (data || []).map(normalizeRow);
  } catch(e) { console.error('loadMembers exception:', e); members = []; }
}

function normalizeRow(r) {
  return {
    id:     r.id,
    name:   `${r.first_name} ${r.last_name}`.trim(),
    phone:  r.phone,
    email:  r.email,
    dob:    r.date_of_birth || '',
    joined: r.created_at,
    points: r.total_points  || 0,
    visits: r.total_visits  || 0,
  };
}

function qrUrl(data, size = 160) {
  const isDark = !document.body.hasAttribute('data-theme');
  const bg  = isDark ? '111111' : 'F0EEEB';
  const fg  = isDark ? 'D4AF37' : 'B8960C';
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=${bg}&color=${fg}&margin=8`;
}

// ─── UI Helpers ───────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function go(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen).classList.add('active');
  if (screen === 'admin') renderAdmin();
  if (screen === 'dashboard' || screen === 'returning') {
    // Ensure calendar is always rendered when these screens activate
    setTimeout(initDashCalendar, 50);
  }
}

// ─── Registration ─────────────────────────────────────────
function handleRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  if (!name || !phone || !email) return showToast('Please fill in all required fields');
  sentCode = '202677';
  document.getElementById('sms-phone').textContent = phone;
  showToast(`Verification code sent to ${phone}`);
  go('sms');
}

async function handleVerify() {
  const input = document.getElementById('sms-input').value.trim();
  if (input !== sentCode && input !== '202677') return showToast('Invalid code. Try again.');

  const btn = document.querySelector('#sms .btn-gold');
  if (btn) { btn.textContent = 'Creating account...'; btn.disabled = true; }

  const raw = {
    name:  document.getElementById('reg-name').value.trim(),
    phone: document.getElementById('reg-phone').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    dob:   document.getElementById('reg-dob').value,
  };

  function makeLocalMember() {
    return {
      id: 'LOCAL-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      name: raw.name, phone: raw.phone, email: raw.email, dob: raw.dob,
      joined: new Date().toISOString(), points: 0, visits: 1,
    };
  }

  if (!db && typeof supabase !== 'undefined') {
    try { db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } catch(e) {}
  }
  const client = getDb();

  if (!client) {
    console.warn('Supabase unavailable — running offline');
    currentMember = makeLocalMember();
    perkClaimed = {};
    renderDashboard(currentMember);
    await authorizeUnifi();
    go('dashboard');
    showToast('Welcome to Riddim!');
    if (btn) { btn.textContent = 'Verify & Enter →'; btn.disabled = false; }
    return;
  }

  try {
    const { data: existing, error: lookupErr } = await client
      .from('members')
      .select('id, first_name, last_name, phone, email, date_of_birth, created_at, total_points, total_visits')
      .eq('phone', raw.phone)
      .maybeSingle();
    if (lookupErr) console.warn('Lookup error:', lookupErr.message);

    if (existing) {
      currentMember = normalizeRow(existing);
      showToast('Welcome back to Riddim!');
    } else {
      const nameParts = raw.name.trim().split(' ');
      const first = nameParts[0];
      const last  = nameParts.slice(1).join(' ') || '-';
      const { data: inserted, error: insertErr } = await client
        .from('members')
        .insert([{ first_name: first, last_name: last, phone: raw.phone, email: raw.email, date_of_birth: raw.dob || null, total_points: 0, total_visits: 1, status: 'active' }])
        .select()
        .single();

      if (insertErr) {
        console.warn('Insert error:', insertErr.message);
        if (insertErr.code === '23505' || insertErr.message.includes('duplicate') || insertErr.message.includes('unique')) {
          const { data: found } = await client.from('members').select('*').or(`phone.eq.${raw.phone},email.eq.${raw.email}`).maybeSingle();
          currentMember = found ? normalizeRow(found) : makeLocalMember();
          showToast('Welcome back to Riddim!');
        } else {
          currentMember = makeLocalMember();
          showToast('Welcome to Riddim!');
        }
      } else {
        currentMember = normalizeRow(inserted);
        members.unshift(currentMember);
        showToast('Welcome to Riddim!');
      }
    }

    perkClaimed = {};
    renderDashboard(currentMember);
    await authorizeUnifi();
    go('dashboard');

  } catch(e) {
    console.error('Verify error:', e);
    currentMember = makeLocalMember();
    perkClaimed = {};
    renderDashboard(currentMember);
    await authorizeUnifi();
    go('dashboard');
    showToast('Welcome to Riddim!');
  } finally {
    if (btn) { btn.textContent = 'Verify & Enter →'; btn.disabled = false; }
  }
}

// ─── Member Dashboard ─────────────────────────────────────
function renderDashboard(m) {
  document.getElementById('dash-name').textContent       = m.name;
  document.getElementById('dash-id').textContent         = `ID: ${m.id}`;
  document.getElementById('dash-pts').textContent        = m.points;
  document.getElementById('dash-member-num').textContent = `Member #${m.id}`;
  const qrData = `RIDDIM-MEMBER-${m.id}`;
  document.getElementById('dash-qr-small').src = qrUrl(qrData, 80);
  document.getElementById('dash-qr-large').src = qrUrl(qrData, 164);
  const bday = document.getElementById('bday-banner');
  if (m.dob && new Date(m.dob).getMonth() === new Date().getMonth()) {
    bday.style.display = 'block';
    document.getElementById('bday-name').textContent = m.name.split(' ')[0];
  } else {
    bday.style.display = 'none';
  }
  renderPerks();
  initDashCalendar();
}

function renderPerks() {
  const list = document.getElementById('perks-list');
  list.innerHTML = PERKS.map(p => {
    const claimed = perkClaimed[p.id];
    return `<div class="perk-card ${claimed ? 'claimed' : ''}" id="perk-${p.id}">
      <div class="perk-icon-wrap" style="background:${p.color}18;color:${p.color};font-family:'Space Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.02em">${p.icon}</div>
      <div class="perk-info">
        <div class="perk-title" style="color:${claimed ? 'var(--muted)' : 'var(--text)'}">${p.title}</div>
        <div class="perk-desc">${p.desc}</div>
      </div>
      ${claimed
        ? `<div class="perk-claimed-txt">✓ Claimed</div>`
        : `<button class="perk-claim-btn" style="color:${p.color};border-color:${p.color}" onclick="claimPerk('${p.id}')">Claim</button>`
      }
    </div>`;
  }).join('');
}

function claimPerk(id) {
  perkClaimed[id] = true;
  renderPerks();
  showToast('Perk claimed! Show this to staff');
}

// ─── Admin ────────────────────────────────────────────────
function handleAdminAuth() {
  const pin = document.getElementById('admin-pin').value;
  const err = document.getElementById('admin-error');
  if (pin === '2026') {
    err.style.display = 'none';
    go('admin');
  } else {
    err.style.display = 'block';
  }
}

async function renderAdmin() {
  if (!db && typeof supabase !== 'undefined') {
    try { db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } catch(e) {}
  }
  document.getElementById('stat-total').textContent = '...';
  document.getElementById('stat-pts').textContent   = '...';
  document.getElementById('stat-month').textContent = '...';
  document.getElementById('admin-members-list').innerHTML =
    `<div style="color:var(--muted);font-family:'Space Mono',monospace;font-size:12px;text-align:center;padding:48px 0">Loading...</div>`;
  await loadMembers();
  const total = members.length;
  const pts   = members.reduce((s, m) => s + m.points, 0);
  const month = members.filter(m => new Date(m.joined) > new Date(Date.now() - 30 * 24 * 3600 * 1000)).length;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pts').textContent   = pts;
  document.getElementById('stat-month').textContent = month;
  document.getElementById('admin-members-label').textContent = `All Members (${total})`;
  const list = document.getElementById('admin-members-list');
  if (!total) {
    list.innerHTML = `<div style="color:var(--muted);font-family:'Space Mono',monospace;font-size:12px;text-align:center;padding:48px 0">No members yet</div>`;
    return;
  }
  list.innerHTML = members.map(m => {
    const qr = qrUrl(`RIDDIM-MEMBER-${m.id}`, 60);
    const shortId = m.id.split('-')[0].toUpperCase();
    return `<div class="member-row">
      <img class="member-row-qr" src="${qr}" alt="QR">
      <div class="member-row-info">
        <div class="member-row-name">${m.name}</div>
        <div class="member-row-contact">${m.phone} · ${m.email}</div>
        <div class="member-row-contact" style="margin-top:2px">ID: ${shortId}</div>
      </div>
      <div>
        <div class="member-row-pts">${m.points}pts</div>
        <div class="member-row-date">${new Date(m.joined).toLocaleDateString()}</div>
      </div>
    </div>`;
  }).join('');
}

function exportCSV() {
  const headers = ['ID', 'Name', 'Phone', 'Email', 'DOB', 'Joined', 'Points', 'Visits'];
  const rows = members.map(m => [m.id, m.name, m.phone, m.email, m.dob, m.joined, m.points, m.visits]);
  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `riddim_members_${Date.now()}.csv`;
  a.click();
  showToast('Export complete ✓');
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(members, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `riddim_members_${Date.now()}.json`;
  a.click();
  showToast('JSON export complete');
}

// ─── Returning Member ─────────────────────────────────────
async function handleReturningLogin() {
  const phone = document.getElementById('ret-phone').value.trim();
  const err   = document.getElementById('ret-error');
  if (!phone) return showToast('Please enter your phone number');
  err.style.display = 'none';
  if (!db && typeof supabase !== 'undefined') {
    try { db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } catch(e) {}
  }
  const client = getDb();
  if (!client) return showToast('Connection unavailable');
  const { data, error } = await client.from('members').select('*').eq('phone', phone).maybeSingle();
  if (error || !data) { err.style.display = 'block'; return; }

  const member = normalizeRow(data);

  const proceed = async () => {
    currentMember = member;
    perkClaimed   = {};
    setLastLoginTime(member.id);
    renderReturningDashboard(currentMember);
    await authorizeUnifi();
    go('returning');
    initReturningPortal(currentMember);
  };

  if (needs2FA(member.id)) {
    show2FA(`We sent a 6-digit code to ${phone} to verify your identity.`, () => {
      // After 2FA success, check device trust
      if (!isDeviceTrusted(member.id)) {
        showDeviceTrustPrompt(member.id, proceed);
      } else {
        proceed();
      }
    });
  } else {
    proceed();
  }
}

function renderReturningDashboard(m) {
  document.getElementById('ret-name').textContent = m.name;
  document.getElementById('ret-id').textContent   = 'ID: ' + m.id.split('-')[0].toUpperCase();
  document.getElementById('ret-pts').textContent  = m.points;
  document.getElementById('ret-qr').src = qrUrl('RIDDIM-MEMBER-' + m.id, 80);
  renderRetPerks();
}

function renderRetPerks() {
  const list = document.getElementById('ret-perks-list');
  list.innerHTML = PERKS.map(p => {
    const claimed = perkClaimed[p.id];
    return `<div class="perk-card ${claimed ? 'claimed' : ''}">
      <div class="perk-icon-wrap" style="background:${p.color}18;color:${p.color};font-family:'Space Mono',monospace;font-size:10px;font-weight:700">${p.icon}</div>
      <div class="perk-info">
        <div class="perk-title" style="color:${claimed ? 'var(--muted)' : 'var(--text)'}">${p.title}</div>
        <div class="perk-desc">${p.desc}</div>
      </div>
      ${claimed
        ? `<div class="perk-claimed-txt">✓ Claimed</div>`
        : `<button class="perk-claim-btn" style="color:${p.color};border-color:${p.color}" onclick="claimPerk('${p.id}')">Claim</button>`
      }
    </div>`;
  }).join('');
}

function switchRetTab(tab, el) {
  document.querySelectorAll('#returning .owner-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#returning .owner-tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('ret-tab-' + tab).classList.add('active');
  if (tab === 'message') renderMemberMessageThread();
  if (tab === 'perks')   renderRetPerks();
  if (tab === 'events')  setTimeout(() => initRetCalendar(), 50);
  if (tab === 'visits')  renderRetVisits();
}

// ─── Staff Portal ─────────────────────────────────────────
function handleStaffAuth() {
  const pin = document.getElementById('staff-pin').value;
  const err = document.getElementById('staff-error');
  if (!currentStaffRole) { err.style.display = 'block'; return; }
  if (pin === PINS.staff || pin === PINS.owner) {
    err.style.display = 'none';
    go('staff');
    setupStaffPortalForRole(currentStaffRole);
  } else {
    err.style.display = 'block';
  }
}

async function staffLookup() {
  const query = document.getElementById('staff-search').value.trim();
  if (!query) return showToast('Enter a name or phone number');
  if (!db && typeof supabase !== 'undefined') {
    try { db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } catch(e) {}
  }
  const client = getDb();
  if (!client) return showToast('Connection unavailable');
  const { data, error } = await client
    .from('members')
    .select('*')
    .or(`phone.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .limit(1)
    .maybeSingle();
  if (error || !data) return showToast('No member found');
  showStaffMember(normalizeRow(data));
}

function clearStaffMemberResult() {
  const result = document.getElementById('staff-member-result');
  if (result) result.style.display = 'none';
  const search = document.getElementById('staff-search');
  if (search) search.value = '';
  currentMember = null;
}

let staffResultTimer = null;

function showStaffMember(m) {
  currentMember = m;
  document.getElementById('staff-result-name').textContent = m.name;
  document.getElementById('staff-result-id').textContent   = 'ID: ' + m.id.split('-')[0].toUpperCase();
  document.getElementById('staff-result-pts').textContent  = m.points;
  const list = document.getElementById('staff-perks-list');
  list.innerHTML = PERKS.map(p => {
    const redeemed = perkClaimed[p.id];
    return `<div class="staff-perk-row">
      <div>
        <div style="font-size:14px">${p.title}</div>
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);margin-top:2px">${p.desc}</div>
      </div>
      ${redeemed
        ? `<div class="btn-redeemed">Redeemed</div>`
        : `<button class="btn-redeem" onclick="staffRedeemPerk('${p.id}')">Redeem</button>`
      }
    </div>`;
  }).join('');
  document.getElementById('staff-member-result').style.display = 'block';

  // Auto-clear after 15 seconds so profile doesn't linger across staff sessions
  if (staffResultTimer) clearTimeout(staffResultTimer);
  staffResultTimer = setTimeout(() => clearStaffMemberResult(), 15000);
}

function staffRedeemPerk(id) {
  perkClaimed[id] = true;
  showStaffMember(currentMember);
  showToast('Perk redeemed for ' + currentMember.name.split(' ')[0]);
}

async function staffAddPoints() {
  const pts = parseInt(document.getElementById('staff-pts-input').value);
  if (!pts || pts <= 0) return showToast('Enter a valid point amount');
  if (!currentMember) return showToast('No member selected');
  const client = getDb();
  if (client) {
    await client.from('members').update({ total_points: (currentMember.points + pts) }).eq('id', currentMember.id);
    await client.from('points_ledger').insert([{
      member_id: currentMember.id,
      amount: pts,
      balance_after: currentMember.points + pts,
      type: 'spend',
      note: 'Manual staff addition',
    }]);
  }
  currentMember.points += pts;
  document.getElementById('staff-result-pts').textContent = currentMember.points;
  document.getElementById('staff-pts-input').value = '';
  showToast(`+${pts} points added to ${currentMember.name.split(' ')[0]}`);
}

// ─── QR Scanner ───────────────────────────────────────────
let scannerStream = null, scannerInterval = null;

async function startScanner() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    scannerStream = stream;
    const video = document.getElementById('scanner-video');
    video.srcObject = stream;
    video.style.display = 'block';
    document.getElementById('scan-box').style.display = 'none';
    document.getElementById('stop-scanner-btn').style.display = 'block';
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    scannerInterval = setInterval(async () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (window.jsQR) {
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data.startsWith('RIDDIM-MEMBER-')) {
              const memberId = code.data.replace('RIDDIM-MEMBER-', '');
              stopScanner();
              if (currentStaffRole === 'doorman' && document.getElementById('doorman-guestlist-area')) {
                await lookupMemberById(memberId);
                doormanScanForGuestList(memberId);
              } else {
                await lookupMemberById(memberId);
              }
            }
          }
        } catch(e) {}
      }
    }, 300);
  } catch(e) {
    showToast('Camera access denied');
  }
}

function stopScanner() {
  if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
  if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; }
  document.getElementById('scanner-video').style.display   = 'none';
  document.getElementById('scan-box').style.display        = 'block';
  document.getElementById('stop-scanner-btn').style.display = 'none';
}

async function lookupMemberById(id) {
  const client = getDb();
  if (!client) return showToast('Connection unavailable');
  const { data } = await client.from('members').select('*').eq('id', id).maybeSingle();
  if (data) {
    showStaffMember(normalizeRow(data));
    showToast('Member found: ' + data.first_name);
  } else {
    showToast('Member not found');
  }
}

// ─── Owner Dashboard ──────────────────────────────────────
function handleOwnerAuth() {
  const pin = document.getElementById('owner-pin').value;
  const err = document.getElementById('owner-error');
  if (pin === PINS.owner) {
    err.style.display = 'none';
    renderOwnerDashboard();
    go('owner');
  } else {
    err.style.display = 'block';
  }
}

function switchOwnerTab(tab, el) {
  document.querySelectorAll('#owner .owner-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#owner .owner-tab-content').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('owner-tab-' + tab).classList.add('active');
  if (tab === 'members')  renderOwnerMembers();
  if (tab === 'growth')   renderGrowthCharts();
  if (tab === 'staff')    { renderOwnerStaff(); setTimeout(renderWhoIsOnDuty, 50); }
  if (tab === 'messages') renderOwnerMessages();
  if (tab === 'tickets')  { renderOwnerPricing(); renderOwnerComps(); }
  if (tab === 'calendar') { setTimeout(initOwnerCalendar, 50); renderOwnerReservations(); renderOwnerSalesLog(); }
  if (tab === 'schedule') { renderSchedulePanel('owner'); }
}

function renderOwnerMessages() {
  const container = document.getElementById('owner-sms-threads');

  // ── Composer area ──
  const composerArea = document.getElementById('owner-new-thread-area');
  if (composerArea) {
    composerArea.innerHTML = `
      <div style="margin-bottom:18px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px">
        <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);letter-spacing:0.1em;margin-bottom:12px">NEW MESSAGE — OWNER</div>
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:10px">Search member (phone / name) or staff name</div>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input class="form-input" id="owner-compose-search" placeholder="Phone, name, or staff..." style="flex:1;font-size:13px" oninput="ownerComposeSearch()">
          <button class="cal-save-btn" onclick="ownerComposeSearch()">Search</button>
        </div>
        <div id="owner-compose-results" style="margin-bottom:10px"></div>
        <div id="owner-compose-recipient" style="display:none;margin-bottom:10px">
          <div id="owner-compose-recipient-label" style="font-family:'Space Mono',monospace;font-size:10px;color:#34D399;margin-bottom:8px"></div>
          <textarea class="form-input" id="owner-compose-text" rows="2" placeholder="Your message..." style="resize:none;width:100%;box-sizing:border-box;font-size:13px;margin-bottom:8px"></textarea>
          <button class="cal-save-btn" style="width:100%" onclick="ownerSendNewCompose()">Send Private Message</button>
        </div>
      </div>`;
  }

  // ── Build section config ──
  const sections = [
    { key: 'FLOOR',       label: '🪑 Tables Sat',       color: '#34D399' },
    { key: 'RESERVATION', label: '📋 Reservations',      color: '#A78BFA' },
    { key: 'SECURITY',    label: '🔒 Security',           color: '#EF4444' },
    { key: 'PRIVATE',     label: '💬 Private Messages',  color: '#D4AF37' },
    { key: 'MANAGEMENT',  label: '🏢 Management',         color: '#60A5FA' },
    { key: 'GENERAL',     label: '📁 General',            color: '#888888' },
  ];

  // ── Categorize threads ──
  const byType = {
    FLOOR:       SMS_THREADS.filter(t => t.type === 'FLOOR'),
    RESERVATION: SMS_THREADS.filter(t => t.type === 'RESERVATION'),
    SECURITY:    SMS_THREADS.filter(t => t.type === 'SECURITY' || t.isSecurityAlert),
    PRIVATE:     SMS_THREADS.filter(t => t.type === 'PRIVATE'),
    MANAGEMENT:  SMS_THREADS.filter(t => t.type === 'MANAGEMENT'),
    GENERAL:     SMS_THREADS.filter(t => !t.type || t.type === 'GENERAL'),
  };

  if (!SMS_THREADS.length) {
    container.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">No messages yet tonight</div>`;
    return;
  }

  // ── Move-to dropdown (owner control) ──
  const moveOpts = THREAD_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');

  // ── Thread card renderer ──
  const renderThreadCard = (t) => {
    const displayName = t.threadName || t.memberName || 'Unknown';
    const tableLabel = t.tableNum ? `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);margin-right:4px">${t.tableNum}</span>` : '';
    const waitressLabel = t.waitressName ? `<span style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399">👤 ${t.waitressName}</span>` : '';
    const promoterLabel = t.promoterId
      ? `<span style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;border:1px solid #34D39940;padding:1px 5px;border-radius:4px">via ${(PROMOTER_LIST.find(p=>p.id===t.promoterId)||{}).name||t.promoterId}</span>`
      : '';
    const privateLabel = t.type === 'PRIVATE'
      ? `<span style="font-family:'Space Mono',monospace;font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.3);color:var(--accent)">PRIVATE</span>`
      : '';
    const msgs = t.messages.map(msg => {
      if (msg.from === 'internal') {
        return `<div style="padding:8px 12px;margin:4px 0;background:rgba(96,165,250,0.08);border-left:2px solid #60A5FA;border-radius:4px">
          <div style="font-family:'Space Mono',monospace;font-size:10px;color:#60A5FA">${msg.text}</div>
          <div class="sms-msg-meta" style="margin-top:3px">Team · ${msg.time}</div>
        </div>`;
      }
      const senderLabel = msg.from === 'member' ? t.memberName
        : msg.from === 'staff-member' ? (msg.senderName || 'Staff')
        : 'You';
      return `<div class="sms-msg ${(msg.from === 'staff' || msg.from === 'staff-member') ? 'outbound' : ''}">
        <div>${msg.text}</div>
        <div class="sms-msg-meta">${senderLabel} · ${msg.time}</div>
      </div>`;
    }).join('');

    return `
      <div class="sms-thread${t.type === 'PRIVATE' ? ' sms-thread-private' : ''}">
        <div class="sms-thread-header">
          <div style="flex:1;min-width:0">
            <div class="sms-thread-title">${displayName}</div>
            <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
              ${tableLabel}${waitressLabel}${promoterLabel}${privateLabel}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
            ${t.type === 'SECURITY' ? '<span style="color:var(--error);font-family:Space Mono,monospace;font-size:9px">⚠ ALERT</span>' : ''}
            <select onchange="moveThread('${t.id}',this.value)"
              style="font-family:'Space Mono',monospace;font-size:9px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--muted);padding:2px 4px;cursor:pointer">
              <option value="">Move to...</option>
              ${THREAD_TYPES.filter(tp => tp !== t.type).map(tp =>
                `<option value="${tp}">${tp}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="sms-messages">${msgs}</div>
        <div class="sms-reply-row">
          <input class="sms-reply-input" id="owner-sms-reply-${t.id}" placeholder="Reply as owner..." type="text"
            onkeydown="if(event.key==='Enter')ownerSendReply('${t.id}')">
          <button class="sms-send-btn" onclick="ownerSendReply('${t.id}')">SEND</button>
        </div>
      </div>`;
  };

  // ── Render sections ──
  let html = '';
  sections.forEach(sec => {
    const threads = byType[sec.key] || [];
    const count = threads.length;
    const sectionId = `owner-inbox-section-${sec.key}`;
    const bodyId = `owner-inbox-body-${sec.key}`;
    const isOpen = count > 0; // default: open if has threads

    html += `
      <div class="owner-inbox-section" id="${sectionId}" style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div onclick="toggleOwnerInboxSection('${bodyId}')"
          style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--bg2);cursor:pointer">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-family:'Space Mono',monospace;font-size:10px;color:${sec.color}">${sec.label}</span>
            <span style="font-family:'Space Mono',monospace;font-size:9px;padding:1px 7px;border-radius:10px;background:${sec.color}20;color:${sec.color};border:1px solid ${sec.color}40">${count}</span>
          </div>
          <span id="${bodyId}-caret" style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted)">${isOpen ? '▲' : '▼'}</span>
        </div>
        <div id="${bodyId}" style="display:${isOpen ? 'block' : 'none'};padding:${count ? '12px' : '0'}">
          ${count
            ? threads.map(renderThreadCard).join('')
            : `<div style="padding:12px;text-align:center;color:var(--dim);font-family:'Space Mono',monospace;font-size:10px">Empty</div>`
          }
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function toggleOwnerInboxSection(bodyId) {
  const body = document.getElementById(bodyId);
  const caret = document.getElementById(bodyId + '-caret');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (caret) caret.textContent = isOpen ? '▼' : '▲';
}

let ownerComposeTarget = null; // { memberId, memberName, memberPhone } or { isStaff, staffId, staffName }

function ownerComposeSearch() {
  const query = document.getElementById('owner-compose-search')?.value?.trim().toLowerCase();
  if (!query || query.length < 2) return;
  const results = [];

  // Search members
  members.filter(m =>
    m.name.toLowerCase().includes(query) || m.phone.includes(query)
  ).slice(0, 4).forEach(m => results.push({ type: 'member', id: m.id, label: m.name, sub: m.phone }));

  // Search staff
  STAFF_LIST.filter(s =>
    s.name.toLowerCase().includes(query) || (s.role||'').includes(query)
  ).slice(0, 3).forEach(s => results.push({ type: 'staff', id: s.id, label: s.name, sub: ROLE_LABELS[s.role] || s.role }));

  const container = document.getElementById('owner-compose-results');
  if (!container) return;
  if (!results.length) {
    container.innerHTML = `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted)">No matches found</div>`;
    return;
  }
  container.innerHTML = results.map(r =>
    `<div onclick="ownerSelectComposeTarget('${r.type}','${r.id}','${r.label.replace(/'/g,"\\'")}','${r.sub}')"
       style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;background:var(--bg2);display:flex;justify-content:space-between;align-items:center">
      <div>
        <span style="font-size:13px;color:var(--text)">${r.label}</span>
        <span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-left:8px">${r.sub}</span>
      </div>
      <span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--accent)">${r.type.toUpperCase()}</span>
    </div>`
  ).join('');
}

function ownerSelectComposeTarget(type, id, name, sub) {
  ownerComposeTarget = { type, id, name, phone: type === 'member' ? sub : null };
  document.getElementById('owner-compose-results').innerHTML = '';
  document.getElementById('owner-compose-search').value = '';
  const recipientArea = document.getElementById('owner-compose-recipient');
  const label = document.getElementById('owner-compose-recipient-label');
  if (recipientArea) recipientArea.style.display = 'block';
  if (label) label.textContent = `✓ To: ${name} (${sub})`;
}

function ownerSendNewCompose() {
  if (!ownerComposeTarget) return showToast('Search and select a recipient first');
  const text = document.getElementById('owner-compose-text')?.value?.trim();
  if (!text) return showToast('Enter a message');
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  if (ownerComposeTarget.type === 'member') {
    const member = members.find(m => m.id === ownerComposeTarget.id) ||
      { id: ownerComposeTarget.id, name: ownerComposeTarget.name, phone: ownerComposeTarget.phone };

    // Always PRIVATE when owner initiates with a member
    getMemberThread(member.id).push({ from: 'staff', text, time });
    pushToStaffThread(member, text, 'GENERAL', ['owner'], time, 'staff', 'PRIVATE');
    showToast(`Private message sent to ${ownerComposeTarget.name}`);

  } else {
    // Staff: create PRIVATE thread
    const staffObj = STAFF_LIST.find(s => s.id === ownerComposeTarget.id);
    const staffName = staffObj?.name || ownerComposeTarget.name;
    const existing = SMS_THREADS.find(t =>
      t.type === 'PRIVATE' &&
      t.privateParticipantRole === 'staff' &&
      t.privateParticipantId === ownerComposeTarget.id
    );
    if (existing) {
      existing.messages.push({ from: 'staff', text, time }); // 'staff' here = owner reply
    } else {
      SMS_THREADS.push({
        id:                   `PRIV-STAFF-${ownerComposeTarget.id}-${Date.now()}`,
        type:                 'PRIVATE',
        threadName:           `Message with ${staffName}`,
        memberId:             null,
        memberName:           staffName,
        memberPhone:          null,
        privateParticipantId:   ownerComposeTarget.id,
        privateParticipantRole: 'staff',
        staffRole:            staffObj?.role || null,
        section: null, tableNum: null,
        isSecurityAlert: false,
        tag: 'GENERAL',
        recipientRoles: ['owner'],
        messages: [{ from: 'staff', text, time }],
      });
    }
    showToast(`Private message sent to ${staffName}`);
  }

  // Reset
  ownerComposeTarget = null;
  document.getElementById('owner-compose-recipient').style.display = 'none';
  document.getElementById('owner-compose-text').value = '';
  document.getElementById('owner-compose-recipient-label').textContent = '';
  renderOwnerMessages();
}

function ownerSendReply(threadId) {
  const input = document.getElementById(`owner-sms-reply-${threadId}`);
  if (!input || !input.value.trim()) return;
  const thread = SMS_THREADS.find(t => t.id === threadId);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (thread) {
    thread.messages.push({ from: 'staff', text: input.value.trim(), time });
    // Push reply back to member's concierge thread if this is a member thread
    if (thread.memberId && thread.privateParticipantRole !== 'staff') {
      getMemberThread(thread.memberId).push({ from: 'staff', text: input.value.trim(), time });
    }
    showToast('Message sent');
  }
  input.value = '';
  renderOwnerMessages();
}

async function renderOwnerDashboard() {
  if (!db && typeof supabase !== 'undefined') {
    try { db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } catch(e) {}
  }
  await loadMembers();
  const now = new Date();
  const tonight   = members.filter(m => new Date(m.joined).toDateString() === now.toDateString()).length;
  const thisMonth = members.filter(m => new Date(m.joined) > new Date(now.getFullYear(), now.getMonth(), 1)).length;
  const totalPts  = members.reduce((s, m) => s + m.points, 0);
  const bdayCount = members.filter(m => m.dob && new Date(m.dob).getMonth() === now.getMonth()).length;
  document.getElementById('ow-total').textContent   = members.length;
  document.getElementById('ow-pts').textContent     = totalPts;
  document.getElementById('ow-tonight').textContent = tonight;
  document.getElementById('ow-bday').textContent    = bdayCount;
  document.getElementById('ow-new').textContent     = '+' + thisMonth + ' this month';
}

function renderOwnerMembers(filter) {
  const query    = (filter || '').toLowerCase();
  const list     = document.getElementById('owner-members-list');
  const filtered = query
    ? members.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.phone.includes(query) ||
        m.email.toLowerCase().includes(query))
    : members;
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:32px 0;text-align:center;color:var(--muted);font-family:Space Mono,monospace;font-size:12px">No members found</div>';
    return;
  }
  list.innerHTML = filtered.map(m =>
    `<div class="member-row">
      <img class="member-row-qr" src="${qrUrl('RIDDIM-MEMBER-' + m.id, 60)}" alt="QR">
      <div class="member-row-info">
        <div class="member-row-name">${m.name}</div>
        <div class="member-row-contact">${m.phone}</div>
        <div class="member-row-contact">${m.email}</div>
      </div>
      <div>
        <div class="member-row-pts">${m.points}pts</div>
        <div class="member-row-date">${new Date(m.joined).toLocaleDateString()}</div>
      </div>
    </div>`
  ).join('');
}

function ownerSearch() {
  renderOwnerMembers(document.getElementById('owner-search').value);
}

function renderGrowthCharts() {
  const now  = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayCounts = Array(7).fill(0);
  members.forEach(m => {
    const diff = Math.floor((now - new Date(m.joined)) / 86400000);
    if (diff < 7) dayCounts[6 - diff]++;
  });
  const maxDay = Math.max(...dayCounts, 1);
  const dayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (6 - i)); return days[d.getDay()];
  });
  document.getElementById('growth-chart').innerHTML = dayCounts
    .map((c, i) => `<div class="chart-bar-row">
      <div class="chart-bar-label">${dayLabels[i]}</div>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(c / maxDay * 100).toFixed(0)}%"></div></div>
      <div class="chart-bar-val">${c}</div>
    </div>`).join('');
  const monthCounts = Array(6).fill(0);
  const monthNames  = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthNames.push(d.toLocaleString('default', { month: 'short' }));
    members.forEach(m => {
      const md = new Date(m.joined);
      if (md.getMonth() === d.getMonth() && md.getFullYear() === d.getFullYear()) monthCounts[5 - i]++;
    });
  }
  const maxMonth = Math.max(...monthCounts, 1);
  document.getElementById('monthly-chart').innerHTML = monthCounts
    .map((c, i) => `<div class="chart-bar-row">
      <div class="chart-bar-label">${monthNames[i]}</div>
      <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(c / maxMonth * 100).toFixed(0)}%"></div></div>
      <div class="chart-bar-val">${c}</div>
    </div>`).join('');
}

// ─── Wallet Card ──────────────────────────────────────────
async function generateWalletCard() {
  if (!currentMember) return;
  const btn = document.getElementById('wallet-btn');
  btn.innerHTML = 'Generating...'; btn.disabled = true;
  await _buildAndShowWalletCard(currentMember, 'wallet-canvas');
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Add to Wallet`;
  btn.disabled = false;
}

async function generateWalletCardFor(m) {
  if (!m) return;
  const btn = document.getElementById('ret-wallet-btn');
  if (btn) { btn.innerHTML = 'Generating...'; btn.disabled = true; }
  await _buildAndShowWalletCard(m, 'ret-wallet-canvas');
  if (btn) {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Add to Wallet`;
    btn.disabled = false;
  }
}

async function _buildAndShowWalletCard(m, canvasId) {
  // Generate QR off-screen
  const qrContainer = document.createElement('div');
  qrContainer.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:200px;height:200px;background:#111;';
  document.body.appendChild(qrContainer);
  const isDark    = !document.body.hasAttribute('data-theme');
  const qrDark    = isDark ? '#D4AF37' : '#B8960C';
  const qrLight   = isDark ? '#111111' : '#F0EEEB';
  await new Promise(resolve => {
    new QRCode(qrContainer, { text: `RIDDIM-MEMBER-${m.id}`, width: 200, height: 200, colorDark: qrDark, colorLight: qrLight, correctLevel: QRCode.CorrectLevel.M });
    setTimeout(resolve, 300);
  });
  const qrCanvas  = qrContainer.querySelector('canvas');
  const qrDataUrl = qrCanvas ? qrCanvas.toDataURL() : null;
  document.body.removeChild(qrContainer);

  // Draw card
  const canvas = document.getElementById(canvasId);
  const W = 800, H = 440;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  if (isDark) {
    ctx.fillStyle = '#0A0A0A';
  } else {
    ctx.fillStyle = '#F0EEEB';
  }
  ctx.fillRect(0, 0, W, H);

  // Grain
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = isDark
      ? `rgba(255,255,255,${Math.random() * 0.03})`
      : `rgba(0,0,0,${Math.random() * 0.015})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }

  // Accent strip (left + top)
  const accentColor = isDark ? '#D4AF37' : '#B8960C';
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 4, H);
  ctx.fillRect(0, 0, W, 4);

  // Glow
  const glow = ctx.createRadialGradient(120, 100, 0, 120, 100, 320);
  glow.addColorStop(0, isDark ? 'rgba(212,175,55,0.07)' : 'rgba(184,150,12,0.06)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const lx = 56;
  const textColor     = isDark ? '#F0F0F0' : '#1A1A1A';
  const mutedColor    = isDark ? '#666666' : '#888888';
  const dimColor      = isDark ? '#3A3A3A' : '#CCCCCC';
  const subTextColor  = isDark ? '#2A2A2A' : '#DDDDDD';

  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = accentColor;
  ctx.fillText('RIDDIM MEMBERS CLUB', lx, 62);

  ctx.strokeStyle = dimColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, 76); ctx.lineTo(490, 76); ctx.stroke();

  ctx.font = '300 50px Georgia, serif'; ctx.fillStyle = textColor;
  ctx.fillText(m.name, lx, 148);

  ctx.font = 'bold 9px "Courier New", monospace'; ctx.fillStyle = mutedColor;
  ctx.fillText('MEMBER ID', lx, 188);
  ctx.font = 'bold 20px "Courier New", monospace'; ctx.fillStyle = accentColor;
  ctx.fillText(m.id, lx, 214);

  ctx.fillStyle = dimColor;
  for (let i = 0; i < 8; i++) { ctx.fillRect(lx + i * 52, 234, 36, 1); }

  ctx.font = 'bold 9px "Courier New", monospace'; ctx.fillStyle = mutedColor;
  ctx.fillText('MEMBER SINCE', lx, 262);
  ctx.font = '400 13px "Courier New", monospace'; ctx.fillStyle = mutedColor;
  ctx.fillText(new Date(m.joined).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), lx, 284);

  ctx.font = 'bold 9px "Courier New", monospace'; ctx.fillStyle = mutedColor;
  ctx.fillText('REWARD POINTS', lx, 330);
  ctx.font = '300 40px Georgia, serif'; ctx.fillStyle = accentColor;
  ctx.fillText(m.points.toString(), lx, 370);

  ctx.fillStyle = accentColor; ctx.globalAlpha = 0.12;
  ctx.fillRect(lx, 404, 390, 1); ctx.globalAlpha = 1;

  ctx.font = 'bold 9px "Courier New", monospace'; ctx.fillStyle = subTextColor;
  ctx.fillText('PRESENT THIS CARD AT ENTRY · RIDDIM', lx, 424);

  const qrSize = 190, qrX = W - qrSize - 52, qrY = Math.round((H - qrSize) / 2);
  ctx.fillStyle = isDark ? '#111111' : '#F2F0EC';
  roundRect(ctx, qrX - 22, qrY - 22, qrSize + 44, qrSize + 60, 14); ctx.fill();
  ctx.strokeStyle = isDark ? '#1E1E1E' : '#DDD9D0'; ctx.lineWidth = 1;
  roundRect(ctx, qrX - 22, qrY - 22, qrSize + 44, qrSize + 60, 14); ctx.stroke();
  if (qrDataUrl) {
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, qrX, qrY, qrSize, qrSize); resolve(); };
      img.onerror = resolve;
      img.src = qrDataUrl;
    });
  }
  ctx.font = 'bold 9px "Courier New", monospace'; ctx.fillStyle = mutedColor;
  ctx.textAlign = 'center';
  ctx.fillText('SCAN AT ENTRY', qrX + qrSize / 2, qrY + qrSize + 28);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  const existing = document.getElementById('wallet-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'wallet-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;animation:fadeIn 0.3s ease;';
  modal.innerHTML = `
    <div style="width:100%;max-width:420px;text-align:center;">
      <div style="font-family:'Space Mono',monospace;font-size:10px;letter-spacing:0.4em;color:${accentColor};margin-bottom:16px;">YOUR WALLET CARD</div>
      <img src="${dataUrl}" style="width:100%;border-radius:12px;box-shadow:0 8px 40px rgba(0,255,133,0.15);display:block;">
      <div style="font-family:'Space Mono',monospace;font-size:11px;color:#888;margin-top:20px;line-height:1.8;letter-spacing:0.05em;">PRESS &amp; HOLD IMAGE TO SAVE TO PHOTOS</div>
      <a href="${dataUrl}" download="riddim-card-${m.id}.png" style="display:block;margin-top:16px;padding:14px;background:${accentColor};border-radius:10px;color:#080808;font-family:'Space Mono',monospace;font-size:13px;font-weight:700;letter-spacing:0.08em;text-decoration:none;">Download Card</a>
      <button onclick="document.getElementById('wallet-modal').remove()" style="margin-top:12px;width:100%;padding:13px;background:transparent;border:1px solid #222;border-radius:10px;color:#555;font-family:'Space Mono',monospace;font-size:12px;cursor:pointer;letter-spacing:0.08em;">Close</button>
    </div>`;
  document.body.appendChild(modal);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Init ─────────────────────────────────────────────────
window.addEventListener('load', async () => {
  initTheme();
  try {
    const client = getDb();
    if (!client) { console.warn('Supabase not available'); return; }
    const { error } = await client.from('members').select('id').limit(1);
    if (error) console.warn('Supabase connection issue:', error.message);
    else console.log('Supabase connected successfully');
  } catch(e) { console.warn('Supabase init error:', e); }
});

// ─── Member Messaging (Concierge) ─────────────────────────

// Track which destination the member has selected
let currentMsgDestination = null;

function renderMemberMessageComposer() {
  const composerEl = document.getElementById('member-msg-composer');
  if (!composerEl) return;

  composerEl.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);letter-spacing:0.1em;margin-bottom:10px">WHO WOULD YOU LIKE TO REACH?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${MEMBER_MSG_DESTINATIONS.map(d => `
          <button
            id="msg-dest-btn-${d.id}"
            onclick="selectMsgDestination('${d.id}')"
            style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;background:var(--bg2);border:1px solid ${d.id === currentMsgDestination?.id ? d.color : 'var(--border)'};border-radius:10px;cursor:pointer;transition:all 0.2s;text-align:left;${d.id === currentMsgDestination?.id ? `background:${d.color}12;` : ''}">
            <div style="font-size:16px;line-height:1">${d.icon}</div>
            <div style="font-family:'Space Mono',monospace;font-size:9px;color:${d.id === currentMsgDestination?.id ? d.color : 'var(--text)'};letter-spacing:0.04em;line-height:1.4">${d.label}</div>
          </button>`).join('')}
      </div>
    </div>
    <div id="member-msg-input-area" style="${currentMsgDestination ? '' : 'display:none'}">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <textarea
          class="form-input"
          id="member-msg-input"
          rows="2"
          placeholder="${currentMsgDestination?.placeholder || 'Type a message...'}"
          style="flex:1;resize:none;font-size:13px;box-sizing:border-box"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMemberMessage();}"
        ></textarea>
        <button class="sms-send-btn" onclick="sendMemberMessage()" style="align-self:flex-end">SEND</button>
      </div>
      <div id="member-quick-btns" style="display:flex;flex-wrap:wrap;gap:6px"></div>
    </div>`;

  renderMemberQuickButtons();
}

function selectMsgDestination(destId) {
  currentMsgDestination = MEMBER_MSG_DESTINATIONS.find(d => d.id === destId) || null;
  renderMemberMessageComposer();
  // Focus input
  setTimeout(() => document.getElementById('member-msg-input')?.focus(), 50);
}

function renderMemberQuickButtons() {
  const container = document.getElementById('member-quick-btns');
  if (!container || !currentMsgDestination) return;

  // Quick buttons vary by destination
  const quickMap = {
    waitstaff: [
      'Need my waitress',
      'Need ice',
      'Need water',
      'Need hookah',
      'Need coal',
      'Another bottle',
      'Need refill',
      'Need check',
    ],
    security: [
      'Someone is bothering me',
      'I need security',
      'I feel unsafe',
    ],
    management: [
      'Question about my bill',
      'Request an upgrade',
      'Need a manager',
    ],
    owner: [
      'Special request for the owner',
    ],
  };

  const btns = quickMap[currentMsgDestination.id] || [];
  if (!btns.length) { container.innerHTML = ''; return; }
  container.innerHTML = btns.map(t =>
    `<button onclick="setQuickMsg('${t.replace(/'/g,"\\'")}',true)" style="font-family:'Space Mono',monospace;font-size:9px;padding:5px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;white-space:nowrap">${t}</button>`
  ).join('');
}

function renderMemberMessageThread() {
  if (!currentMember) return;
  const thread = getMemberThread(currentMember.id);
  const container = document.getElementById('member-msg-thread');
  if (!container) return;
  if (!thread.length) {
    container.innerHTML = `<div style="text-align:center;padding:20px 0;font-family:'Space Mono',monospace;font-size:10px;color:var(--dim)">Choose who you'd like to reach below</div>`;
  } else {
    container.innerHTML = thread.map(msg => {
      if (msg.type === 'followup-prompt') {
        return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;margin:8px 0">
          <div style="font-size:13px;color:var(--text);margin-bottom:10px">${msg.text}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="respondToFollowUp('positive')" style="flex:1;padding:10px;background:#34D39918;border:1px solid #34D399;border-radius:8px;color:#34D399;font-family:'Space Mono',monospace;font-size:11px;cursor:pointer">👍 Leave Positive Feedback</button>
            <button onclick="respondToFollowUp('owner')" style="flex:1;padding:10px;background:var(--bg2);border:1px solid var(--accent);border-radius:8px;color:var(--accent);font-family:'Space Mono',monospace;font-size:11px;cursor:pointer">✍️ Message the Owner</button>
          </div>
        </div>`;
      }
      return `<div class="sms-msg ${msg.from === 'member' ? 'outbound' : ''}">
        <div>${msg.text}</div>
        <div class="sms-msg-meta">${msg.from === 'member' ? 'You' : 'Riddim Concierge'} · ${msg.time}</div>
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  }

  // Render or update composer below thread
  renderMemberMessageComposer();
}

function respondToFollowUp(type) {
  if (!currentMember) return;
  const thread = getMemberThread(currentMember.id);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  if (type === 'positive') {
    thread.push({ from: 'member', text: '⭐ Positive feedback — had a great time!', time });
    // Route to management thread
    pushToStaffThread(currentMember, 'Positive experience feedback from member — no action needed.', 'MANAGEMENT', ['owner','manager','vip-host'], time);
    thread.push({ from: 'staff', text: 'Thank you so much! Your kind words mean everything to us. We look forward to seeing you again soon. 🥂', time });
    showToast('Thank you for your feedback!');
  } else {
    // Open owner compose
    currentMsgDestination = MEMBER_MSG_DESTINATIONS.find(d => d.id === 'owner');
    thread.push({ from: 'staff', text: 'Of course — the owner is here to listen. Please share what\'s on your mind and we\'ll make it right.', time });
    showToast('Owner message channel opened');
  }
  renderMemberMessageThread();
}

function sendMemberMessage() {
  if (!currentMember) return;
  if (!currentMsgDestination) { showToast('Please select who to message first'); return; }
  const input = document.getElementById('member-msg-input');
  const text = input?.value?.trim();
  if (!text) return;

  const thread = getMemberThread(currentMember.id);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  thread.push({ from: 'member', text, time, destination: currentMsgDestination.id });
  input.value = '';

  // Push to staff SMS_THREADS with type from destination
  pushToStaffThread(
    currentMember, text,
    currentMsgDestination.tag,
    currentMsgDestination.recipientRoles,
    time,
    'member',
    currentMsgDestination.type  // pass explicit type (PRIVATE for owner dest)
  );

  renderMemberMessageThread();
  showToast(`Message sent to ${currentMsgDestination.label}`);
}

// Central helper: push a message into the correct SMS_THREADS entry for staff
function pushToStaffThread(member, text, tag, recipientRoles, time, fromType, forceType) {
  const from = fromType || 'member';

  // Determine thread type
  let type = forceType || (() => {
    if (tag === 'SECURITY')    return 'SECURITY';
    if (tag === 'FLOOR')       return 'FLOOR';
    if (tag === 'RESERVATION') return 'RESERVATION';
    if (tag === 'MANAGEMENT')  return 'MANAGEMENT';
    return 'GENERAL';
  })();

  const isSecAlert = type === 'SECURITY';

  // ── PRIVATE threads: never merge with other threads ────
  if (type === 'PRIVATE') {
    const existing = SMS_THREADS.find(t =>
      t.type === 'PRIVATE' &&
      t.memberId === member.id &&
      t.privateParticipantRole === 'member'
    );
    if (existing) {
      existing.messages.push({ from, text, time });
    } else {
      SMS_THREADS.push({
        id:                   `PRIV-${member.id}-${Date.now()}`,
        type:                 'PRIVATE',
        threadName:           `Message with ${member.name}`,
        memberId:             member.id,
        memberName:           member.name,
        memberPhone:          member.phone || '',
        privateParticipantId:   member.id,
        privateParticipantRole: 'member',
        section: null, tableNum: null,
        isSecurityAlert: false,
        tag:  'GENERAL',
        recipientRoles: ['owner'],
        messages: [{ from, text, time }],
      });
    }
    return;
  }

  // ── All other types: find or create keyed by memberId + type ──
  const existing = SMS_THREADS.find(t =>
    t.memberId === member.id &&
    !t.isSecurityAlert &&
    ((t.type === type) || (!t.type && t.tag === tag))
  );
  if (existing) {
    existing.messages.push({ from, text, time });
    if (!existing.type) {
      existing.type = type;
      existing.threadName = defaultThreadNameForType(type, member.name, existing.tableNum);
    }
    // Expand recipientRoles if needed
    if (recipientRoles) {
      recipientRoles.forEach(r => {
        if (!existing.recipientRoles.includes(r)) existing.recipientRoles.push(r);
      });
    }
  } else {
    const roles = recipientRoles || defaultRecipientRolesForType(type);
    SMS_THREADS.push({
      id:             `M-${member.id}-${type}-${Date.now()}`,
      type,
      threadName:     defaultThreadNameForType(type, member.name, null),
      memberId:       member.id,
      memberName:     member.name,
      memberPhone:    member.phone || '',
      section:        null,
      tableNum:       null,
      isSecurityAlert: isSecAlert,
      tag:            tag || type,
      recipientRoles: roles,
      messages:       [{ from, text, time }],
    });
  }
}

function setQuickMsg(text, send) {
  const input = document.getElementById('member-msg-input');
  if (input) {
    input.value = text;
    input.focus();
    if (send) sendMemberMessage();
  }
}

// ─── 9 AM Follow-Up Scheduler ─────────────────────────────
function scheduleFollowUp(member, eventName) {
  if (!member) return;
  const now = new Date();
  const next9am = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  const msUntil = next9am - now;

  setTimeout(() => {
    const thread = getMemberThread(member.id);
    const time = '9:00 AM';
    const firstName = member.name?.split(' ')[0] || 'there';
    const followUpMsg = `Good morning, ${firstName}! 🌟 We hope you had an incredible time with us${eventName && eventName !== 'tonight' ? ` at ${eventName}` : ' last night'}. It was truly a pleasure having you. We'd love to hear about your experience — your feedback means the world to us. How was your evening?`;
    thread.push({ from: 'staff', type: 'followup-prompt', text: followUpMsg, time });

    // If the member is currently viewing their thread, re-render
    if (currentMember && currentMember.id === member.id) {
      renderMemberMessageThread();
    }
  }, msUntil);
}

// ─── Staff sendSMSReply — pushes reply back to member thread ──
function sendSMSReply(threadId) {
  const input = document.getElementById(`sms-reply-${threadId}`);
  if (!input || !input.value.trim()) return;
  const thread = SMS_THREADS.find(t => t.id === threadId);
  if (!thread) return;
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const text = input.value.trim();
  thread.messages.push({ from: 'staff', text, time });
  input.value = '';
  // Push reply back into the member's own thread (not for staff-to-staff PRIVATE threads)
  if (thread.memberId && thread.privateParticipantRole !== 'staff') {
    const memberThread = getMemberThread(thread.memberId);
    memberThread.push({ from: 'staff', text, time });
  }
  showToast('Reply sent');
  renderSMSThreads(currentStaffRole, currentStaffSection);
}

// ─── Returning portal calendar ─────────────────────────────
function initRetCalendar() { initCalendarWidget('ret-cal-month-label', 'ret-cal-days', 'ret-cal-events', 'member'); }
function retCalNav(dir)    { calNav(dir, 'ret-cal-month-label', 'ret-cal-days', 'ret-cal-events', 'member'); }

// ─── Returning portal perks & visits ──────────────────────
function renderRetPerks() {
  const list = document.getElementById('ret-perks-list');
  if (!list || !currentMember) return;
  const available = PERKS.filter(p => !perkClaimed[p.id]);
  if (!available.length) {
    list.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">All perks claimed tonight</div>`;
  } else {
    list.innerHTML = available.map(p => `
      <div class="perk-card" id="ret-perk-${p.id}">
        <div class="perk-icon-wrap" style="background:${p.color}18;color:${p.color};font-family:'Space Mono',monospace;font-size:10px;font-weight:700">${p.icon}</div>
        <div class="perk-info">
          <div class="perk-title">${p.title}</div>
          <div class="perk-desc">${p.desc}</div>
        </div>
        <button class="perk-claim-btn" style="color:${p.color};border-color:${p.color}" onclick="claimPerk('${p.id}')">Claim</button>
      </div>`).join('');
  }
  // Tier progress
  const prog = document.getElementById('ret-tier-progress');
  if (prog && currentMember) {
    const pts = currentMember.points || 0;
    const tiers = [{ name: 'Silver', at: 100 }, { name: 'Gold', at: 300 }, { name: 'Platinum', at: 600 }];
    const next = tiers.find(t => pts < t.at) || tiers[tiers.length - 1];
    const prev = tiers[tiers.indexOf(next) - 1];
    const from = prev?.at || 0;
    const pct = Math.min(100, Math.round(((pts - from) / (next.at - from)) * 100));
    prog.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:8px">
        <span>${pts} pts</span><span>${next.name} at ${next.at} pts</span>
      </div>
      <div style="height:6px;background:var(--bg2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;transition:width 0.5s"></div>
      </div>
      <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:6px">${next.at - pts} points to ${next.name}</div>`;
  }
}

function renderRetVisits() {
  // Phase 2: pull from Supabase visits table
}

// ─── Returning portal: init all tabs on load ──────────────
function initReturningPortal(m) {
  const nameEl = document.getElementById('ret-name');
  const idEl   = document.getElementById('ret-id');
  const ptsEl  = document.getElementById('ret-pts');
  const qrEl   = document.getElementById('ret-qr');
  if (nameEl) nameEl.textContent = m.name;
  if (idEl)   idEl.textContent   = `ID: ${m.id}`;
  if (ptsEl)  ptsEl.textContent  = m.points;
  if (qrEl)   qrEl.src           = qrUrl(`RIDDIM-MEMBER-${m.id}`, 80);
  // Switch to message tab by default
  const msgTab = document.querySelector('#returning .owner-tab');
  if (msgTab) switchRetTab('message', msgTab);
  renderMemberMessageThread();
}

// ─── Staff Referral Link & QR ──────────────────────────────
let currentStaffMember = null;

function getStaffLink(staffMember) {
  // Local-friendly referral link using current page URL
  const base = window.location.origin + window.location.pathname;
  return `${base}?ref=${staffMember.id}`;
}

function setupStaffLink(staffMember) {
  const urlEl = document.getElementById('staff-link-url');
  if (urlEl) urlEl.textContent = getStaffLink(staffMember);
  currentStaffMember = staffMember;
}

function copyStaffLink() {
  if (!currentStaffMember) return;
  navigator.clipboard?.writeText(getStaffLink(currentStaffMember))
    .then(() => showToast('Link copied!'))
    .catch(() => showToast('Copy: ' + getStaffLink(currentStaffMember)));
}

function showStaffLinkQR() {
  if (!currentStaffMember) return;
  const modal = document.getElementById('staff-qr-modal');
  const display = document.getElementById('staff-qr-display');
  if (!modal || !display) return;
  display.innerHTML = '';
  new QRCode(display, {
    text: getStaffLink(currentStaffMember),
    width: 180, height: 180,
    colorDark: document.body.hasAttribute('data-theme') ? '#111111' : '#D4AF37',
    colorLight: document.body.hasAttribute('data-theme') ? '#F0EEEB' : '#111111',
    correctLevel: QRCode.CorrectLevel.M
  });
  modal.style.display = 'flex';
}

// ─── Promoter Portal ───────────────────────────────────────
let currentPromoter = null;

function setupPromoterPortal(promoter) {
  currentPromoter = promoter;
  const scanArea = document.getElementById('staff-scan-area');
  const smsArea  = document.getElementById('staff-sms-area');
  const promoArea = document.getElementById('staff-promoter-area');
  if (scanArea)  scanArea.style.display = 'none';
  if (smsArea)   smsArea.style.display  = 'none';
  if (promoArea) promoArea.style.display = 'block';

  // My Nights
  const evList = document.getElementById('promoter-events-list');
  if (evList) {
    evList.innerHTML = promoter.nights.length
      ? promoter.nights.map(n => `
          <div class="sms-thread" style="padding:12px;margin-bottom:10px">
            <div class="sms-thread-title">${n}</div>
            <div class="sms-msg-meta" style="margin-top:4px">Guest list · ${promoter.guestList.length} submitted</div>
          </div>`).join('')
      : `<div style="color:var(--dim);font-family:'Space Mono',monospace;font-size:10px;padding:12px 0">No nights assigned yet</div>`;
  }

  renderPromoterGuestList();
  renderPromoterStats();
  setTimeout(() => initCalendarWidget('staff-cal-month-label', 'staff-cal-days', 'staff-cal-events', 'promoter', null, promoter.id), 80);
}

function renderPromoterGuestList() {
  if (!currentPromoter) return;
  const container = document.getElementById('promoter-guestlist');
  if (!container) return;
  if (!currentPromoter.guestList.length) {
    container.innerHTML = `<div style="color:var(--dim);font-family:'Space Mono',monospace;font-size:10px;padding:8px 0">No guests added yet — search by registered member name or phone</div>`;
    return;
  }
  container.innerHTML = currentPromoter.guestList.map((g, i) => {
    const name    = typeof g === 'string' ? g : g.name;
    const arrived = typeof g === 'object' && g.arrived;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-family:'Space Mono',monospace;font-size:11px">
        <div>
          <span style="color:${arrived ? '#34D399' : 'var(--text)'};">${name}</span>
          ${arrived ? `<span style="font-size:9px;color:#34D399;margin-left:8px">✓ ARRIVED</span>` : ''}
        </div>
        <button onclick="removePromoterGuest(${i})" style="background:transparent;border:none;color:var(--error);cursor:pointer;font-size:12px">✕</button>
      </div>`;
  }).join('');
}

function addPromoterGuest() {
  if (!currentPromoter) return;
  const input = document.getElementById('promoter-guest-input');
  const query = input?.value?.trim().toLowerCase();
  if (!query) return;

  // Require a registered member — search by name or phone
  const member = members.find(m =>
    m.name.toLowerCase() === query ||
    m.phone.replace(/\D/g,'').includes(query.replace(/\D/g,''))
  );

  if (!member) {
    showToast('No registered member found — guest must be a registered Riddim member');
    return;
  }

  // Prevent duplicates
  const already = currentPromoter.guestList.find(g =>
    (typeof g === 'object' && g.memberId === member.id) ||
    (typeof g === 'string' && g.toLowerCase() === member.name.toLowerCase())
  );
  if (already) {
    showToast(`${member.name} is already on your list`);
    return;
  }

  // Store as object with memberId for later QR verification
  currentPromoter.guestList.push({ name: member.name, memberId: member.id, arrived: false });
  input.value = '';
  renderPromoterGuestList();
  renderPromoterStats();
  showToast(`${member.name} added to guest list`);
}

function removePromoterGuest(idx) {
  if (!currentPromoter) return;
  currentPromoter.guestList.splice(idx, 1);
  renderPromoterGuestList();
  renderPromoterStats();
}

function renderPromoterStats() {
  if (!currentPromoter) return;
  const container = document.getElementById('promoter-stats');
  if (!container) return;
  const submitted = currentPromoter.guestList.length;
  const arrived   = currentPromoter.guestList.filter(g => typeof g === 'object' && g.arrived).length;
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="metric-card">
        <div class="metric-val" style="font-size:24px">${submitted}</div>
        <div class="metric-label">SUBMITTED</div>
      </div>
      <div class="metric-card">
        <div class="metric-val" style="font-size:24px;color:#34D399">${arrived}</div>
        <div class="metric-label">ARRIVED</div>
      </div>
    </div>`;
}

// ─── Staff Auth — passcode-based login ─────────────────────
function handleStaffAuth() {
  const pin = document.getElementById('staff-pin').value.trim();
  const err = document.getElementById('staff-error');

  // Find staff member by their personal 4-digit passcode
  const staffMatch   = STAFF_LIST.find(s => s.passcode === pin && s.active);
  const promoterMatch = PROMOTER_LIST.find(p => p.passcode === pin && p.active);
  // Owner override (owner can still enter their PIN to access staff portal)
  const isOwnerOverride = pin === PINS.owner;

  if (!staffMatch && !promoterMatch && !isOwnerOverride) {
    err.style.display = 'block';
    return;
  }

  err.style.display = 'none';
  go('staff');

  if (promoterMatch) {
    currentStaffRole = 'promoter';
    setupPromoterPortal(promoterMatch);
    document.getElementById('staff-role-display').textContent = 'Promoter';
    const badge = document.getElementById('staff-role-badge');
    badge.textContent = 'PROMOTER'; badge.className = 'role-badge promoter';
    setupStaffLink({ id: promoterMatch.id, name: promoterMatch.name });
  } else if (staffMatch) {
    currentStaffRole = staffMatch.role;
    currentLoggedStaffId = staffMatch.id;
    setupStaffPortalForRole(staffMatch.role, staffMatch);
  } else {
    // Owner override — pick selected role or default to manager
    const role = currentStaffRole || 'manager';
    setupStaffPortalForRole(role);
  }
}

// ─── Sales Log — tickets & table purchases ────────────────
// Each entry: { id, type, memberId, memberName, memberPhone,
//   promoterId, promoterName, eventName, dateKey,
//   tableAssigned, partySize, amount, isComp, purchasedAt, status }
let SALES_LOG = [];

// ─── Central purchase pipeline ────────────────────────────
function logSaleAndFireThread(sale) {
  // 1. Stamp calendar
  if (sale.dateKey) {
    if (!VENUE_EVENTS[sale.dateKey]) VENUE_EVENTS[sale.dateKey] = [];
    const calTag   = sale.type === 'table' ? 'TABLE' : 'TICKET';
    const promoCredit = sale.promoterName ? ` · via ${sale.promoterName}` : '';
    const saleLabel   = sale.isComp ? 'COMPED' : `$${sale.amount}`;
    // Remove stale entry for this sale
    VENUE_EVENTS[sale.dateKey] = VENUE_EVENTS[sale.dateKey].filter(e =>
      !(e.saleId === sale.id)
    );
    VENUE_EVENTS[sale.dateKey].push({
      type:      'reservation',
      time:      '—',
      name:      `${sale.tableAssigned || (sale.type === 'table' ? 'Table TBD' : 'Ticket')} — ${sale.memberName}`,
      desc:      `${sale.partySize || 1} guest${(sale.partySize||1)>1?'s':''} · ${sale.eventName}${promoCredit} · ${saleLabel}${sale.waitressName ? ' · '+sale.waitressName : ''}`,
      tag:       calTag,
      memberId:  sale.memberId,
      saleId:    sale.id,
      promoterId: sale.promoterId,
      private:   true,
      saveDate:  false,
    });
  }

  // 2. Fire concierge message thread to member
  if (sale.memberId) {
    const thread = getMemberThread(sale.memberId);
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const promoLine = sale.promoterName
      ? `\n\nYou were added via ${sale.promoterName}'s guest list — priority entry is set.`
      : '';
    const tableLine = sale.tableAssigned
      ? `\n\nYour table: ${sale.tableAssigned}.` : (sale.type === 'table' ? '\n\nYour table assignment is coming shortly.' : '');
    const waitressLine = sale.waitressName ? ` Your server tonight is ${sale.waitressName}.` : '';
    const compLine = sale.isComp ? ' (Complimentary — on the house)' : ` — $${sale.amount} confirmed`;

    const msg = sale.type === 'table'
      ? `🥂 Table confirmed for ${sale.eventName}${compLine}.${tableLine}${waitressLine}${promoLine}\n\nReply here anytime if you need anything tonight.`
      : `🎟️ Your${sale.isComp ? ' complimentary' : ''} ticket for ${sale.eventName} is confirmed${sale.isComp ? '' : ` — $${sale.amount}`}.${promoLine}\n\nSee you tonight!`;

    thread.push({ from: 'staff', text: msg, time });

    // Mirror into SMS_THREADS so staff can reply
    const existingThread = SMS_THREADS.find(t => t.memberId === sale.memberId && t.type === 'RESERVATION');
    if (existingThread) {
      existingThread.messages.push({ from: 'staff', text: msg, time });
      if (sale.tableAssigned) existingThread.tableNum = sale.tableAssigned;
      existingThread.promoterId = sale.promoterId || existingThread.promoterId;
    } else {
      SMS_THREADS.push({
        id:             `M-${sale.memberId}-RES`,
        type:           'RESERVATION',
        threadName:     `Reservation — ${sale.memberName}`,
        memberId:       sale.memberId,
        memberName:     sale.memberName,
        memberPhone:    sale.memberPhone,
        section:        null,
        tableNum:       sale.tableAssigned || null,
        isSecurityAlert: false,
        tag:            'RESERVATION',
        recipientRoles: ['owner','manager','vip-host'],
        promoterId:     sale.promoterId,
        messages:       [{ from: 'staff', text: msg, time }],
      });
    }
  }
}

// ─── Reservation System ────────────────────────────────────
function renderOwnerReservations() {
  const container = document.getElementById('owner-reservations-list');
  if (!container) return;

  const pending   = RESERVATION_QUEUE.filter(r => r.status === 'pending');
  const confirmed = RESERVATION_QUEUE.filter(r => r.status === 'confirmed');
  const sat       = RESERVATION_QUEUE.filter(r => r.status === 'sat');

  if (!RESERVATION_QUEUE.length) {
    container.innerHTML = `<div style="padding:16px 0;text-align:center;color:var(--dim);font-family:'Space Mono',monospace;font-size:10px">No reservation requests</div>`;
    return;
  }

  const waitresses = STAFF_LIST.filter(s => s.role === 'waitress' && s.active);

  // Floor plan overview — read-only at top
  const floorOverview = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
      ${renderFloorPlan('view', null)}
      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:var(--bg2);border:1px solid var(--border)"></div><span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted)">AVAILABLE</span></div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:rgba(245,200,66,0.08);border:1px solid var(--acid)"></div><span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--acid)">RESERVED</span></div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#34D39912;border:1px solid #34D399"></div><span style="font-family:'Space Mono',monospace;font-size:8px;color:#34D399">SAT</span></div>
      </div>
    </div>`;

  const renderRes = (r) => {
    const statusColor = r.status === 'sat' ? '#34D399' : r.status === 'confirmed' ? '#60A5FA' : 'var(--acid)';
    const selTable = selectedFloorTable[r.id];
    return `
    <div class="sms-thread" style="margin-bottom:12px">
      <div class="sms-thread-header">
        <div>
          <div class="sms-thread-title">${r.memberName}</div>
          <div class="sms-msg-meta" style="margin-top:3px">${r.partySize} guests · ${r.occasion} · ${r.eventName || 'General'}</div>
          ${r.tableAssigned ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);margin-top:2px">📍 Table ${r.tableAssigned}</div>` : ''}
          ${r.waitressAssigned ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;margin-top:2px">👤 ${STAFF_LIST.find(s=>s.id===r.waitressAssigned)?.name || 'Server assigned'}</div>` : ''}
        </div>
        <span style="font-family:'Space Mono',monospace;font-size:9px;padding:3px 8px;border-radius:4px;background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}40">${r.status.toUpperCase()}</span>
      </div>
      ${r.notes ? `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);margin-top:6px">"${r.notes}"</div>` : ''}

      ${r.status === 'pending' ? `
        <div style="margin-top:12px">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:6px">Optionally pre-assign a table:</div>
          <input class="form-input" style="padding:8px;font-size:11px;margin-bottom:10px" id="res-table-${r.id}" placeholder="Table # (optional)" value="${r.tableAssigned||''}">
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="cal-save-btn" onclick="acceptReservation('${r.id}')">Accept &amp; Notify Team</button>
          <button class="cal-save-btn" style="border-color:var(--error);color:var(--error)" onclick="declineReservation('${r.id}')">Decline</button>
        </div>` : ''}

      ${r.status === 'confirmed' ? `
        <div style="margin-top:12px">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);letter-spacing:0.08em;margin-bottom:8px">ASSIGN TABLE — TAP TO SELECT</div>
          <div id="floor-plan-${r.id}" style="margin-bottom:12px">
            ${renderFloorPlan('select', r.id)}
          </div>
          <select class="form-input" style="padding:8px;font-size:11px;font-family:'Space Mono',monospace;margin-bottom:10px" id="res-waitress-${r.id}">
            <option value="">Assign waitress...</option>
            ${waitresses.map(w => `<option value="${w.id}" ${r.waitressAssigned===w.id?'selected':''}>${w.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="cal-save-btn" style="border-color:#34D399;color:#34D399" onclick="markTableSat('${r.id}')">🪑 Table Sat — Add Server</button>
        </div>` : ''}

      ${r.status === 'sat' ? `
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:#34D399;margin-top:8px">✓ Party seated · Server in thread</div>` : ''}
    </div>`;
  };

  let html = floorOverview;
  if (pending.length)   html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--acid);letter-spacing:0.08em;margin-bottom:8px">PENDING (${pending.length})</div>` + pending.map(renderRes).join('');
  if (confirmed.length) html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#60A5FA;letter-spacing:0.08em;margin:16px 0 8px">CONFIRMED — AWAITING SEAT (${confirmed.length})</div>` + confirmed.map(renderRes).join('');
  if (sat.length)       html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;letter-spacing:0.08em;margin:16px 0 8px">SEATED (${sat.length})</div>` + sat.map(renderRes).join('');
  container.innerHTML = html;
}

function acceptReservation(resId) {
  const res = RESERVATION_QUEUE.find(r => r.id === resId);
  if (!res) return;
  res.tableAssigned = document.getElementById(`res-table-${resId}`)?.value?.trim() || null;
  res.status = 'confirmed';

  // Notify the member via concierge thread
  if (res.memberId) {
    const thread = getMemberThread(res.memberId);
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const tableNote = res.tableAssigned ? ` Your table: ${res.tableAssigned}.` : ' Your table assignment will follow shortly.';
    const confirmMsg = `🥂 Your reservation for ${res.eventName || 'tonight'} is confirmed — ${res.partySize} guest${res.partySize>1?'s':''}!${tableNote} We're looking forward to having you. See you soon!`;
    thread.push({ from: 'staff', text: confirmMsg, time });

    // Mirror to SMS_THREADS with owner + manager + vip-host access
    const existing = SMS_THREADS.find(t => t.memberId === res.memberId && t.type === 'RESERVATION');
    if (existing) {
      existing.tableNum = res.tableAssigned || existing.tableNum;
      existing.threadName = `Reservation — ${res.memberName}`;
      existing.messages.push({ from: 'staff', text: confirmMsg, time });
      existing.recipientRoles = ['owner','manager','vip-host'];
    } else {
      SMS_THREADS.push({
        id: `M-${res.memberId}-RES`, memberId: res.memberId,
        type: 'RESERVATION',
        threadName: `Reservation — ${res.memberName}`,
        memberName: res.memberName, memberPhone: res.memberPhone,
        section: null, tableNum: res.tableAssigned || null,
        isSecurityAlert: false,
        tag: 'RESERVATION',
        recipientRoles: ['owner','manager','vip-host'],
        reservationId: resId,
        messages: [{ from: 'staff', text: confirmMsg, time }]
      });
    }
  }

  // Add internal team notification
  const vipHosts = STAFF_LIST.filter(s => s.role === 'vip-host' && s.active);
  const managers  = STAFF_LIST.filter(s => s.role === 'manager'  && s.active);
  const notified  = [...vipHosts, ...managers].map(s => s.name).join(', ');

  const sThread = SMS_THREADS.find(t => t.memberId === res.memberId && t.tag === 'RESERVATION');
  if (sThread) {
    const time2 = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const internalMsg = `📋 TEAM: Reservation accepted for ${res.memberName} — ${res.partySize} pax${res.tableAssigned ? ', ' + res.tableAssigned : ''}. ${res.occasion !== 'General visit' ? 'Occasion: ' + res.occasion + '.' : ''} VIP Host & Manager notified.${res.notes ? ' Notes: "' + res.notes + '"' : ''}`;
    sThread.messages.push({ from: 'internal', text: internalMsg, time: time2 });
  }

  showToast(`Reservation accepted${notified ? ' · ' + notified + ' notified' : ''}`);
  renderOwnerReservations();
}

function markTableSat(resId) {
  const res = RESERVATION_QUEUE.find(r => r.id === resId);
  if (!res) return;

  // Table must be selected from the floor plan
  const tableNum = selectedFloorTable[resId];
  if (!tableNum) { showToast('Select a table from the floor plan first'); return; }

  const waitressId = document.getElementById(`res-waitress-${resId}`)?.value;
  if (!waitressId) { showToast('Assign a waitress before marking as sat'); return; }

  // Check the table isn't already sat by someone else
  const alreadySat = RESERVATION_QUEUE.find(r =>
    r.id !== resId && r.status === 'sat' &&
    r.tableAssigned && r.tableAssigned.toString() === tableNum.toString()
  );
  if (alreadySat) { showToast(`Table ${tableNum} is already sat — pick another table`); return; }

  res.waitressAssigned = waitressId;
  res.tableAssigned    = tableNum.toString();
  res.status           = 'sat';

  const waitress = STAFF_LIST.find(s => s.id === waitressId);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Fire the full pipeline
  const promoterEntry = SALES_LOG.find(s => s.memberId === res.memberId && s.type === 'table');
  logSaleAndFireThread({
    id: res.id, type: 'table',
    memberId: res.memberId, memberName: res.memberName, memberPhone: res.memberPhone,
    promoterId:    promoterEntry?.promoterId || res.referredByPromoter || null,
    promoterName:  promoterEntry?.promoterName || null,
    eventName:     res.eventName || 'tonight',
    dateKey:       res.dateKey,
    tableAssigned: res.tableAssigned,
    waitressName:  waitress?.name || null,
    partySize:     res.partySize,
    amount:        promoterEntry?.amount || 0,
    isComp:        promoterEntry?.isComp || false,
  });

  // Transition thread: RESERVATION → FLOOR
  // Replace recipientRoles entirely: owner + barbacks only (waitress via waitressId)
  const sThread = SMS_THREADS.find(t => t.memberId === res.memberId && t.type === 'RESERVATION');
  if (sThread && waitress) {
    sThread.type         = 'FLOOR';
    sThread.tag          = 'FLOOR';
    sThread.threadName   = `${res.memberName} — Table ${res.tableAssigned}`;
    sThread.tableNum     = res.tableAssigned;
    sThread.waitressId   = waitress.id;
    sThread.waitressName = waitress.name;
    // FLOOR recipientRoles: owner + all barbacks (specific IDs for barbacks, role for fallback)
    sThread.recipientRoles = ['owner', 'barback'];
    sThread.messages.push({
      from: 'internal',
      text: `🪑 Table ${res.tableAssigned} sat. ${waitress.name} is assigned as server. Barbacks notified.`,
      time
    });
  }

  // Schedule 9 AM follow-up
  const memberObj = members.find(m => m.id === res.memberId) || { id: res.memberId, name: res.memberName };
  scheduleFollowUp(memberObj, res.eventName);

  // Clear the floor plan selection for this res
  delete selectedFloorTable[resId];

  showToast(`Table ${res.tableAssigned} sat — ${waitress?.name || 'server'} in thread · Follow-up at 9 AM`);
  renderOwnerReservations();
  renderStaffReservations();
}

function declineReservation(resId) {
  const idx = RESERVATION_QUEUE.findIndex(r => r.id === resId);
  if (idx >= 0) { RESERVATION_QUEUE.splice(idx, 1); showToast('Reservation declined'); renderOwnerReservations(); }
}

// ─── Manual Reservation Creation (Owner + Manager/VIP-Host) ──────────────
function buildManualReservation(nameId, phoneId, sizeId, occasionId, notesId) {
  const name     = document.getElementById(nameId)?.value?.trim();
  const phone    = document.getElementById(phoneId)?.value?.trim() || null;
  const size     = parseInt(document.getElementById(sizeId)?.value) || 0;
  const occasion = document.getElementById(occasionId)?.value || 'General visit';
  const notes    = document.getElementById(notesId)?.value?.trim() || '';
  if (!name)    { showToast('Enter a guest name'); return null; }
  if (size < 1) { showToast('Enter party size'); return null; }

  const resId  = 'RES' + Date.now().toString().slice(-5);
  const today  = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // Try to find an existing member by phone or name
  const existing = members.find(m =>
    (phone && m.phone === phone) ||
    m.name.toLowerCase() === name.toLowerCase()
  );

  return {
    id:               resId,
    memberName:       name,
    memberId:         existing?.id || null,
    memberPhone:      phone || existing?.phone || null,
    dateKey,
    eventName:        'Tonight',
    partySize:        size,
    occasion,
    notes,
    referredByPromoter: null,
    status:           'confirmed',   // manual = already confirmed, skip pending
    requestedAt:      Date.now(),
    tableAssigned:    null,
    waitressAssigned: null,
  };
}

function ownerAddReservation() {
  const res = buildManualReservation('owner-res-name','owner-res-phone','owner-res-size','owner-res-occasion','owner-res-notes');
  if (!res) return;
  RESERVATION_QUEUE.push(res);
  // Clear form
  ['owner-res-name','owner-res-phone','owner-res-size','owner-res-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  showToast(`${res.memberName} — party of ${res.partySize} added`);
  renderOwnerReservations();
}

function staffAddReservation() {
  const res = buildManualReservation('staff-res-name','staff-res-phone','staff-res-size','staff-res-occasion','staff-res-notes');
  if (!res) return;
  RESERVATION_QUEUE.push(res);
  ['staff-res-name','staff-res-phone','staff-res-size','staff-res-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  showToast(`${res.memberName} — party of ${res.partySize} added`);
  renderStaffReservations();
  renderOwnerReservations(); // keep owner view in sync
}

// ─── Staff Reservation Queue (manager & vip-host — confirmed + sat only) ──
function renderStaffReservations() {
  const container = document.getElementById('staff-reservations-list');
  if (!container) return;

  const confirmed = RESERVATION_QUEUE.filter(r => r.status === 'confirmed');
  const sat       = RESERVATION_QUEUE.filter(r => r.status === 'sat');

  if (!confirmed.length && !sat.length) {
    container.innerHTML = `<div style="padding:16px 0;text-align:center;color:var(--dim);font-family:'Space Mono',monospace;font-size:10px">No confirmed reservations</div>`;
    return;
  }

  const waitresses = STAFF_LIST.filter(s => s.role === 'waitress' && s.active);

  const floorOverview = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
      ${renderFloorPlan('view', null)}
      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:var(--bg2);border:1px solid var(--border)"></div><span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--muted)">AVAILABLE</span></div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:rgba(245,200,66,0.08);border:1px solid var(--acid)"></div><span style="font-family:'Space Mono',monospace;font-size:8px;color:var(--acid)">RESERVED</span></div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:3px;background:#34D39912;border:1px solid #34D399"></div><span style="font-family:'Space Mono',monospace;font-size:8px;color:#34D399">SAT</span></div>
      </div>
    </div>`;

  const renderRes = (r) => {
    const statusColor = r.status === 'sat' ? '#34D399' : '#60A5FA';
    const selTable = selectedFloorTable[r.id];
    return `
    <div class="sms-thread" style="margin-bottom:12px">
      <div class="sms-thread-header">
        <div>
          <div class="sms-thread-title">${r.memberName}</div>
          <div class="sms-msg-meta" style="margin-top:3px">${r.partySize} guests · ${r.occasion} · ${r.eventName || 'General'}</div>
          ${r.tableAssigned ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);margin-top:2px">📍 Table ${r.tableAssigned}</div>` : ''}
          ${r.waitressAssigned ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;margin-top:2px">👤 ${STAFF_LIST.find(s=>s.id===r.waitressAssigned)?.name || 'Server assigned'}</div>` : ''}
        </div>
        <span style="font-family:'Space Mono',monospace;font-size:9px;padding:3px 8px;border-radius:4px;background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}40">${r.status.toUpperCase()}</span>
      </div>
      ${r.notes ? `<div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--muted);margin-top:6px">"${r.notes}"</div>` : ''}

      ${r.status === 'confirmed' ? `
        <div style="margin-top:12px">
          <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);letter-spacing:0.08em;margin-bottom:8px">ASSIGN TABLE — TAP TO SELECT</div>
          <div id="staff-floor-plan-${r.id}" style="margin-bottom:12px">
            ${renderFloorPlan('select', r.id, 'staff')}
          </div>
          <select class="form-input" style="padding:8px;font-size:11px;font-family:'Space Mono',monospace;margin-bottom:10px" id="staff-res-waitress-${r.id}">
            <option value="">Assign waitress...</option>
            ${waitresses.map(w => `<option value="${w.id}" ${r.waitressAssigned===w.id?'selected':''}>${w.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="cal-save-btn" style="border-color:#34D399;color:#34D399" onclick="markTableSatStaff('${r.id}')">🪑 Table Sat — Add Server</button>
        </div>` : ''}

      ${r.status === 'sat' ? `
        <div style="font-family:'Space Mono',monospace;font-size:10px;color:#34D399;margin-top:8px">✓ Party seated · Server in thread</div>` : ''}
    </div>`;
  };

  let html = floorOverview;
  if (confirmed.length) html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#60A5FA;letter-spacing:0.08em;margin-bottom:8px">CONFIRMED — AWAITING SEAT (${confirmed.length})</div>` + confirmed.map(renderRes).join('');
  if (sat.length)       html += `<div style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;letter-spacing:0.08em;margin:16px 0 8px">SEATED (${sat.length})</div>` + sat.map(renderRes).join('');
  container.innerHTML = html;
}

// Staff version of markTableSat — reads from staff-prefixed element IDs
function markTableSatStaff(resId) {
  const res = RESERVATION_QUEUE.find(r => r.id === resId);
  if (!res) return;

  const tableNum = selectedFloorTable[resId];
  if (!tableNum) { showToast('Select a table from the floor plan first'); return; }

  const waitressId = document.getElementById(`staff-res-waitress-${resId}`)?.value;
  if (!waitressId) { showToast('Assign a waitress before marking as sat'); return; }

  const alreadySat = RESERVATION_QUEUE.find(r =>
    r.id !== resId && r.status === 'sat' &&
    r.tableAssigned && r.tableAssigned.toString() === tableNum.toString()
  );
  if (alreadySat) { showToast(`Table ${tableNum} is already sat — pick another table`); return; }

  res.waitressAssigned = waitressId;
  res.tableAssigned    = tableNum.toString();
  res.status           = 'sat';

  const waitress = STAFF_LIST.find(s => s.id === waitressId);
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const promoterEntry = SALES_LOG.find(s => s.memberId === res.memberId && s.type === 'table');
  logSaleAndFireThread({
    id: res.id, type: 'table',
    memberId: res.memberId, memberName: res.memberName, memberPhone: res.memberPhone,
    promoterId:    promoterEntry?.promoterId || res.referredByPromoter || null,
    promoterName:  promoterEntry?.promoterName || null,
    eventName:     res.eventName || 'tonight',
    dateKey:       res.dateKey,
    tableAssigned: res.tableAssigned,
    waitressName:  waitress?.name || null,
    partySize:     res.partySize,
    amount:        promoterEntry?.amount || 0,
    isComp:        promoterEntry?.isComp || false,
  });

  const sThread = SMS_THREADS.find(t => t.memberId === res.memberId && t.type === 'RESERVATION');
  if (sThread && waitress) {
    sThread.type           = 'FLOOR';
    sThread.tag            = 'FLOOR';
    sThread.threadName     = `${res.memberName} — Table ${res.tableAssigned}`;
    sThread.tableNum       = res.tableAssigned;
    sThread.waitressId     = waitress.id;
    sThread.waitressName   = waitress.name;
    sThread.recipientRoles = ['owner', 'barback'];
    sThread.messages.push({
      from: 'internal',
      text: `🪑 Table ${res.tableAssigned} sat. ${waitress.name} is assigned as server. Barbacks notified.`,
      time
    });
  }

  const memberObj = members.find(m => m.id === res.memberId) || { id: res.memberId, name: res.memberName };
  scheduleFollowUp(memberObj, res.eventName);

  delete selectedFloorTable[resId];

  showToast(`Table ${res.tableAssigned} sat — ${waitress?.name || 'server'} in thread · Follow-up at 9 AM`);

  // Re-render both owner and staff reservation views so status is in sync
  renderOwnerReservations();
  renderStaffReservations();
}

// ─── Tickets & Pricing (Owner) ────────────────────────────
function renderOwnerPricing() {
  const container = document.getElementById('owner-pricing-list');
  if (!container) return;
  container.innerHTML = PRICING.map(p => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;font-size:13px;color:var(--text)">${p.label}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-family:'Space Mono',monospace;font-size:11px;color:var(--muted)">$</span>
        <input class="form-input" style="width:80px;padding:6px 8px;text-align:center;font-size:13px" id="price-${p.id}" value="${p.price}" type="number" min="0">
      </div>
      <button class="cal-save-btn" onclick="savePrice('${p.id}')">Save</button>
    </div>`).join('');
}

function savePrice(priceId) {
  const item = PRICING.find(p => p.id === priceId);
  if (!item) return;
  const val = parseFloat(document.getElementById(`price-${priceId}`)?.value);
  if (isNaN(val) || val < 0) return showToast('Enter a valid price');
  item.price = val;
  showToast(`${item.label} set to $${val}`);
}

function renderOwnerComps() {
  const container = document.getElementById('owner-comps-list');
  if (!container) return;
  if (!COMPS_ISSUED.length) {
    container.innerHTML = `<div style="padding:12px 0;color:var(--dim);font-family:'Space Mono',monospace;font-size:10px">No comps issued tonight</div>`;
    return;
  }
  container.innerHTML = COMPS_ISSUED.map(c => `
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;color:var(--text)">${c.recipient}</div>
        <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:2px">${c.type} · ${c.note || 'No note'} · ${c.time}</div>
      </div>
      <div style="font-family:'Space Mono',monospace;font-size:10px;color:#34D399">COMPED</div>
    </div>`).join('');
}

function issueComp() {
  const type      = document.getElementById('comp-type')?.value;
  const recipient = document.getElementById('comp-recipient')?.value?.trim();
  const note      = document.getElementById('comp-note')?.value?.trim();
  if (!recipient) return showToast('Enter a recipient name or phone');

  const typeLabels = { 'ticket': 'GA Ticket', 'vip-ticket': 'VIP Ticket', 'table': 'Table Reservation' };
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Find member by name or phone
  const member = members.find(m => m.name === recipient || m.phone === recipient);
  const saleId = 'COMP' + Date.now().toString().slice(-5);

  // Log comp
  COMPS_ISSUED.push({ type: typeLabels[type] || type, recipient, note, time, issuedBy: 'owner' });
  document.getElementById('comp-recipient').value = '';
  document.getElementById('comp-note').value = '';
  showToast(`Comp issued to ${recipient}`);
  renderOwnerComps();

  // If we have a member record, fire the pipeline
  if (member) {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    logSaleAndFireThread({
      id:           saleId,
      type:         type === 'table' ? 'table' : 'ticket',
      memberId:     member.id,
      memberName:   member.name,
      memberPhone:  member.phone,
      promoterId:   null,
      promoterName: null,
      eventName:    'tonight',
      dateKey,
      tableAssigned: null,
      waitressName:  null,
      partySize:    1,
      amount:       0,
      isComp:       true,
      purchasedAt:  Date.now(),
      status:       'confirmed',
    });
  }
}

// ─── Owner Staff — separated by role type ─────────────────
function renderOwnerStaff() {
  const floorRoles = ['bartender','waitress','host','vip-host','doorman','barback','manager'];
  const floorActive   = STAFF_LIST.filter(s => floorRoles.includes(s.role) && s.active);
  const floorInactive = STAFF_LIST.filter(s => floorRoles.includes(s.role) && !s.active);
  const promoActive   = PROMOTER_LIST.filter(p => p.active);
  const promoInactive = PROMOTER_LIST.filter(p => !p.active);

  const renderFloor = (list, inactive) => list.map(s => `
    <div class="employee-row">
      <div>
        <span class="role-badge ${s.role}">${(ROLE_LABELS[s.role]||s.role).toUpperCase()}</span>
        <span style="font-size:14px;color:var(--text);margin-left:10px">${s.name}</span>
        ${s.section ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">📍 ${s.section}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px">
        ${inactive
          ? `<button class="cal-save-btn" onclick="toggleStaffActive('${s.id}',true)">Reactivate</button>`
          : `<button class="cal-save-btn" onclick="toggleStaffActive('${s.id}',false)">Day Off</button>`}
        <button class="cal-save-btn" style="border-color:var(--error);color:var(--error)" onclick="archiveStaff('${s.id}')">Archive</button>
      </div>
    </div>`).join('') || `<div style="color:var(--dim);font-family:'Space Mono',monospace;font-size:10px;padding:10px 0">None</div>`;

  const renderPromo = (list, inactive) => list.map(p => `
    <div class="employee-row">
      <div>
        <span class="role-badge promoter">PROMOTER</span>
        <span style="font-size:14px;color:var(--text);margin-left:10px">${p.name}</span>
        <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">${p.guestList.length} on list · ${p.nights.length} night(s)</div>
      </div>
      <div style="display:flex;gap:8px">
        ${inactive
          ? `<button class="cal-save-btn" onclick="togglePromoterActive('${p.id}',true)">Activate</button>`
          : `<button class="cal-save-btn" onclick="togglePromoterActive('${p.id}',false)">Deactivate</button>`}
      </div>
    </div>`).join('') || `<div style="color:var(--dim);font-family:'Space Mono',monospace;font-size:10px;padding:10px 0">None</div>`;

  const fa  = document.getElementById('owner-staff-floor-active');
  const fi  = document.getElementById('owner-staff-floor-inactive');
  const pa  = document.getElementById('owner-staff-promoters-active');
  const pi  = document.getElementById('owner-staff-promoters-inactive');
  const sec = document.getElementById('owner-section-assignments');

  if (fa)  fa.innerHTML  = renderFloor(floorActive, false);
  if (fi)  fi.innerHTML  = renderFloor(floorInactive, true);
  if (pa)  pa.innerHTML  = renderPromo(promoActive, false);
  if (pi)  pi.innerHTML  = renderPromo(promoInactive, true);
  if (sec) {
    const assigned = STAFF_LIST.filter(s => s.section && s.active);
    sec.innerHTML = assigned.length
      ? assigned.map(s => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-family:'Space Mono',monospace;font-size:11px"><span style="color:var(--text)">${s.name}</span><span style="color:var(--muted)">${s.section}</span></div>`).join('')
      : `<div style="color:var(--dim);font-family:'Space Mono',monospace;font-size:10px;padding:10px 0">No sections assigned tonight</div>`;
  }
}

function togglePromoterActive(id, active) {
  const p = PROMOTER_LIST.find(p => p.id === id);
  if (p) { p.active = active; renderOwnerStaff(); showToast(`${p.name} ${active ? 'activated' : 'deactivated'}`); }
}

function addStaffMember() {
  const name     = document.getElementById('new-staff-name')?.value?.trim();
  const role     = document.getElementById('new-staff-role')?.value;
  const passcode = document.getElementById('new-staff-passcode')?.value?.trim();
  if (!name || !role) return showToast('Enter name and select role');
  if (!passcode || !/^\d{4}$/.test(passcode)) return showToast('Enter a 4-digit passcode');
  // Check for passcode collision
  const collision = STAFF_LIST.find(s => s.passcode === passcode) || PROMOTER_LIST.find(p => p.passcode === passcode);
  if (collision) return showToast('Passcode already in use — choose a different one');

  const id = 'S' + String(Date.now()).slice(-6);
  if (role === 'promoter') {
    PROMOTER_LIST.push({ id, name, passcode, active: true, guestList: [], nights: [] });
  } else {
    STAFF_LIST.push({ id, name, role, passcode, active: true, section: null });
  }
  document.getElementById('new-staff-name').value = '';
  document.getElementById('new-staff-role').value = '';
  document.getElementById('new-staff-passcode').value = '';
  renderOwnerStaff();
  showToast(`${name} added — passcode set`);
}

function renderOwnerSalesLog() {
  const container = document.getElementById('owner-sales-log');
  if (!container) return;
  if (!SALES_LOG.length) {
    container.innerHTML = `<div style="padding:12px 0;color:var(--dim);font-family:'Space Mono',monospace;font-size:10px">No sales logged yet</div>`;
    return;
  }
  container.innerHTML = SALES_LOG.map(s => {
    const promoter = PROMOTER_LIST.find(p => p.id === s.promoterId);
    const statusColor = s.status === 'confirmed' ? '#34D399' : s.status === 'pending' ? 'var(--acid)' : 'var(--muted)';
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:14px;color:var(--text)">${s.memberName}</div>
            <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">
              ${s.type.toUpperCase()} · ${s.partySize} guest${s.partySize>1?'s':''} · ${s.eventName}
            </div>
            ${promoter ? `<div style="margin-top:4px"><span style="font-family:'Space Mono',monospace;font-size:9px;color:#34D399;border:1px solid #34D39940;padding:2px 6px;border-radius:4px">via ${promoter.name}</span></div>` : ''}
            ${s.tableAssigned ? `<div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--accent);margin-top:3px">${s.tableAssigned}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;color:${s.isComp?'#34D399':'var(--accent)'};font-family:'Space Mono',monospace">${s.isComp ? 'COMP' : '$'+s.amount}</div>
            <div style="font-family:'Space Mono',monospace;font-size:9px;color:${statusColor};margin-top:2px">${s.status.toUpperCase()}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ─── Wire returning portal init ───────────────────────────
// initReturningPortal is called directly from handleReturningLogin after go('returning')
