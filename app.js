/* ════════════════════════════════════════════════
   PERFORMANCE DETECTION
════════════════════════════════════════════════ */
const perfLevel = (() => {
  const mem   = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'mid';
  return 'high';
})();
const pixelRatio = Math.min(window.devicePixelRatio || 1, perfLevel === 'low' ? 1 : 2);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════ */
const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

/* ────────────────────────────────────────────────
   CENTRALIZED ALERT PRIORITY SYSTEM
──────────────────────────────────────────────── */
const ALERT_PRIORITY_MAP = new Map([
  ['Particularly Dangerous Situation', 1],
  ['Tornado Emergency',                2],
  ['Tornado Warning',                  3],
  ['Flash Flood Emergency',            4],
  ['Severe Thunderstorm Warning',      5],
  ['Flash Flood Warning',              6],
  ['Tornado Watch',                    7],
  ['Severe Thunderstorm Watch',        8],
  ['Flash Flood Watch',                9],
  ['Winter Storm Warning',            10],
  ['Ice Storm Warning',               10],
  ['Blizzard Warning',                10],
  ['Winter Storm Watch',              11],
  ['Winter Weather Advisory',         12],
]);

function alertPriorityScore(eventStr) {
  if (!eventStr) return 99;
  for (const [key, score] of ALERT_PRIORITY_MAP) {
    if (eventStr.includes(key)) return score;
  }
  return 99;
}

function isTornadoLevel(eventStr) {
  return alertPriorityScore(eventStr) <= 3;
}

function isExtremeLevel(eventStr) {
  return alertPriorityScore(eventStr) <= 2;
}

/* ────────────────────────────────────────────────
   TICKER GROUPS
──────────────────────────────────────────────── */
const TICKER_GROUPS = [
  { key:'pds',      label:'Particularly Dangerous Situation', cls:'tg-pds',
    match: ev => ev.includes('Particularly Dangerous') },
  { key:'tor-warn', label:'Tornado Warning',      cls:'tg-tor-warn',
    match: ev => ev.includes('Tornado Warning') && !ev.includes('Watch') },
  { key:'tor-watch',label:'Tornado Watch',        cls:'tg-tor-watch',
    match: ev => ev.includes('Tornado Watch') },
  { key:'svr-warn', label:'Severe Thunderstorm Warning', cls:'tg-svr-warn',
    match: ev => ev.includes('Severe Thunderstorm Warning') },
  { key:'svr-watch',label:'Severe Thunderstorm Watch',   cls:'tg-svr-watch',
    match: ev => ev.includes('Severe Thunderstorm Watch') },
  { key:'ff-emerg', label:'Flash Flood Emergency', cls:'tg-ff-emerg',
    match: ev => ev.includes('Flash Flood Emergency') },
  { key:'ff-warn',  label:'Flash Flood Warning / Watch', cls:'tg-ff-warn',
    match: ev => ev.includes('Flash Flood Warning') || ev.includes('Flash Flood Watch') },
  { key:'winter',   label:'Winter / Blizzard / Ice Storm', cls:'tg-winter',
    match: ev => ev.includes('Blizzard') || ev.includes('Winter Storm') || ev.includes('Ice Storm') || ev.includes('Winter Weather') },
  { key:'other',    label:'Other Alerts', cls:'tg-other',
    match: () => true },
];

const TICKER_API_URL = `https://api.weather.gov/alerts/active`;

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */
let appLat = 43, appLon = -88;
let userCounty = '';
let lastBgMode  = 'clear';
let lastRisk    = 'low';
let sirenActive = false;
let sirenCtx = null, sirenNodes = [], sirenTimeout = null;
let activeAlertFeatures = [];
let forceStormBg = false;
let forceStormType = '';
let lastSuccessfulRefresh = null;

/* ────────────────────────────────────────────────
   PERSISTENT POPUP / ALERT DISMISSAL
   Tracks which alert UIDs the user has explicitly
   dismissed with the close button. These will NOT
   re-appear even after data refreshes.
──────────────────────────────────────────────── */
const MAX_DISMISSED = 100;
let dismissedArr = [];
const dismissedSet = new Set();

function addDismissed(uid) {
  if (dismissedSet.has(uid)) return;
  if (dismissedArr.length >= MAX_DISMISSED) {
    const oldest = dismissedArr.shift();
    dismissedSet.delete(oldest);
  }
  dismissedArr.push(uid);
  dismissedSet.add(uid);
}
function isDismissed(uid) { return dismissedSet.has(uid); }

/* ────────────────────────────────────────────────
   BOUNDED CACHES
──────────────────────────────────────────────── */
const MAX_SHOWN_ALERTS = 200;
const MAX_SEARCH_CACHE = 50;
let shownAlertsArr = [];
const shownAlertsSet = new Set();
const searchCache = new Map();

function addShownAlert(uid) {
  if (shownAlertsSet.has(uid)) return;
  if (shownAlertsArr.length >= MAX_SHOWN_ALERTS) {
    const oldest = shownAlertsArr.shift();
    shownAlertsSet.delete(oldest);
  }
  shownAlertsArr.push(uid);
  shownAlertsSet.add(uid);
}
function hasShownAlert(uid) { return shownAlertsSet.has(uid); }

function addSearchCache(key, val) {
  if (searchCache.size >= MAX_SEARCH_CACHE) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(key, val);
}

/* ════════════════════════════════════════════════
   SAFE FETCH UTILITY
════════════════════════════════════════════════ */
const activeFetchControllers = new Map();

async function safeFetch(url, {
  timeout   = 10000,
  retries   = 2,
  key       = null,
  baseDelay = 800,
} = {}) {
  if (key && activeFetchControllers.has(key)) {
    try { activeFetchControllers.get(key).abort(); } catch(_) {}
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    if (key) activeFetchControllers.set(key, controller);

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/geo+json" }
      });
      clearTimeout(timeoutId);
      if (key) activeFetchControllers.delete(key);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (key) activeFetchControllers.delete(key);
      if (err.name === 'AbortError') throw err;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 400;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/* ════════════════════════════════════════════════
   STALE DATA DETECTION
════════════════════════════════════════════════ */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function markRefreshSuccess() {
  lastSuccessfulRefresh = Date.now();
  const b = document.getElementById('staleBanner');
  if (b) b.style.display = 'none';
}

function checkStaleData() {
  if (!lastSuccessfulRefresh) return;
  const age = Date.now() - lastSuccessfulRefresh;
  if (age > STALE_THRESHOLD_MS) {
    const b = document.getElementById('staleBanner');
    if (b) b.style.display = 'block';
  }
}

/* ════════════════════════════════════════════════
   NORMALIZED COUNTY MATCHING
════════════════════════════════════════════════ */
function normalizeCountyName(name) {
  return (name || '')
    .replace(/\b(county|parish|borough|census area|municipality)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function countyMatchesArea(userCty, areaDesc) {
  if (!userCty || !areaDesc) return false;
  const normalUser = normalizeCountyName(userCty);
  if (!normalUser) return false;
  const areaParts = areaDesc.split(/[;,]/).map(normalizeCountyName);
  return areaParts.some(part => part.includes(normalUser) || normalUser.includes(part));
}

/* ════════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════ */
function degToCompass(deg) {
  return COMPASS_DIRS[Math.round(deg / 22.5) % 16];
}
function tempClass(f) {
  if (f < 32) return 'tc-cold';
  if (f < 50) return 'tc-cool';
  if (f < 70) return 'tc-mild';
  if (f < 90) return 'tc-warm';
  return 'tc-hot';
}
function dewLabel(f) {
  if (f < 35) return '🟢 Dry';
  if (f < 50) return '🟢 Comfortable';
  if (f < 55) return '🟡 Moderate';
  if (f < 60) return '🟠 Elevated';
  if (f < 65) return '🟠 Elevated — some storm fuel';
  return           '🔴 High — significant storm fuel';
}
function humLabel(h) {
  if (h < 30) return { level:'Very Dry',  feel:'Parched' };
  if (h < 50) return { level:'Low',       feel:'Comfortable' };
  if (h < 70) return { level:'Moderate',  feel:'Slightly humid' };
  if (h < 85) return { level:'High',      feel:'Muggy' };
  return             { level:'Very High', feel:'Oppressive' };
}
function liLabel(li) {
  if (li >  3) return '🟢 Very Stable';
  if (li >  0) return '🟢 Stable';
  if (li > -2) return '🟡 Slightly unstable';
  if (li > -4) return '🟠 Unstable — scattered severe possible';
  if (li > -6) return '🔴 Very unstable — organized severe risk';
  return             '🔴🔴 Extremely unstable — significant tornado risk';
}
function capeLabel(c) {
  if (c < 300)  return { txt:'Weak / None', color:'#6eff8a' };
  if (c < 1000) return { txt:'Marginal',    color:'#aaee55' };
  if (c < 2000) return { txt:'Moderate',    color:'#ffcc00' };
  if (c < 3000) return { txt:'Strong',      color:'#ff8800' };
  return              { txt:'Extreme',      color:'#ff3333' };
}
function windEnergyLabel(spd) {
  if (spd < 10) return '🍃 Light';
  if (spd < 20) return '🌬 Moderate';
  if (spd < 30) return '💨 Elevated shear';
  return             '⚡ Strong shear';
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function alertCentroid(alert) {
  try {
    const geo = alert.geometry;
    if (geo?.type === 'Polygon') {
      const coords = geo.coordinates[0];
      return {
        lat: coords.reduce((s,c) => s+c[1], 0) / coords.length,
        lon: coords.reduce((s,c) => s+c[0], 0) / coords.length,
      };
    }
    if (geo?.type === 'MultiPolygon') {
      const all = geo.coordinates.flat(2);
      return {
        lat: all.reduce((s,c) => s+c[1], 0) / all.length,
        lon: all.reduce((s,c) => s+c[0], 0) / all.length,
      };
    }
  } catch(_) {}
  return null;
}

function alertCentroidDistance(alert) {
  const c = alertCentroid(alert);
  if (!c) return 9999;
  return haversineDistance(appLat, appLon, c.lat, c.lon);
}

function sortAlerts(features) {
  return [...features].sort((a, b) => {
    const pa = alertPriorityScore(a.properties?.event || '');
    const pb = alertPriorityScore(b.properties?.event || '');
    if (pa !== pb) return pa - pb;
    return alertCentroidDistance(a) - alertCentroidDistance(b);
  });
}

/* ────────────────────────────────────────────────
   ROBUST ALERT DEDUPLICATION
──────────────────────────────────────────────── */
function alertStableId(feature) {
  const id = feature.id || feature.properties?.id;
  if (id) return id;
  const ev   = feature.properties?.event    || '';
  const area = feature.properties?.areaDesc || '';
  const sent = feature.properties?.sent     || '';
  return `${ev}|${area}|${sent}`;
}

function deduplicateAlerts(features) {
  const seen = new Set();
  return features.filter(f => {
    const key = alertStableId(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressure) {
  const isBackingWind = windDeg >= 150 && windDeg <= 260;
  const shearScore = (isBackingWind ? 1 : 0) + (windSpd >= 15 ? 1 : 0) + (windSpd >= 25 ? 1 : 0);
  const moistureOk    = dewF >= 55;
  const liftOk        = li <= -3;
  const instabilityOk = cape >= 500;
  const deepInstability = cape >= 1500 && li <= -5;
  const srh_proxy = isBackingWind ? windSpd * 1.8 : windSpd * 0.7;

  if (deepInstability && moistureOk && shearScore >= 2 && srh_proxy >= 30) return 'high';
  if (liftOk && instabilityOk && moistureOk && shearScore >= 1) return 'moderate';
  if (li <= -2 && cape >= 300 && dewF >= 50) return 'marginal';
  return 'none';
}

function computeWeatherRisk(li, cape, dewF, windSpd, windDeg, pressure) {
  const torEnv = computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressure);
  if (torEnv === 'high') return 'high';
  if (li <= -4 && cape > 1000) return 'high';
  if (torEnv === 'moderate') return 'medium';
  if (li <= -3 && cape > 500 && dewF >= 55) return 'medium';
  if (li <= -2 && cape > 1500) return 'medium';
  return 'low';
}

function parseMovement(desc) {
  if (!desc) return null;
  const m = desc.match(/moving?\s+(?:toward[s]?\s+the\s+)?([NSEW]+(?:EAST|WEST|NORTH|SOUTH|northeast|northwest|southeast|southwest|north|south|east|west)?)\s+at\s+(\d+)\s*mph/i);
  if (m) return { dir: m[1].toUpperCase(), spd: parseInt(m[2]) };
  const m2 = desc.match(/(\d+)\s*mph?\s+(?:toward[s]?\s+the\s+)?([NSEW]+(?:EAST|WEST|NORTH|SOUTH)?)/i);
  if (m2) return { dir: m2[2].toUpperCase(), spd: parseInt(m2[1]) };
  return null;
}

async function jumpToLocation(areaText) {
  if (!areaText) return;
  const first = areaText.split(/[;,]/)[0].trim();
  try {
    const res  = await safeFetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(first)}&countrycodes=us&limit=1&addressdetails=1`, { key:'nominatim-jump' });
    const data = await res.json();
    if (data && data[0]) {
      appLat = parseFloat(data[0].lat);
      appLon = parseFloat(data[0].lon);
      loadAll();
    }
  } catch(e) { console.warn('jumpToLocation failed:', e); }
}

/* ════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════ */
function toggleExpand(el) {
  const isOpen = el.classList.contains('open');
  document.querySelectorAll('.card-expandable.open').forEach(c => {
    if (c !== el) { c.classList.remove('open'); c.setAttribute('aria-expanded','false'); }
  });
  el.classList.toggle('open', !isOpen);
  el.setAttribute('aria-expanded', String(!isOpen));
}
document.addEventListener('keydown', e => {
  if ((e.key==='Enter'||e.key===' ') && e.target.matches('.card-expandable')) {
    e.preventDefault(); toggleExpand(e.target);
  }
});

function toggleMenu() {
  const panel = document.getElementById('menuPanel');
  const btn   = document.getElementById('menuBtn');
  const open  = panel.classList.contains('open');
  panel.classList.toggle('open', !open);
  btn.setAttribute('aria-expanded', String(!open));
}
document.addEventListener('click', e => {
  if (!e.target.closest('#menuPanel') && !e.target.closest('#menuBtn')) {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) {
      panel.classList.remove('open');
      document.getElementById('menuBtn').setAttribute('aria-expanded','false');
    }
  }
});

const riskOrder = { low:0, medium:1, high:2 };

function setRiskDisplay(risk, label, why) {
  const box = document.getElementById('riskBox');
  const txt = document.getElementById('riskText');
  const whyEl = document.getElementById('riskWhy');
  if (!box || !txt || !whyEl) return;
  const wasOpen = box.classList.contains('open');
  const classMap = { low:'risk-low', medium:'risk-medium', high:'risk-high' };
  const defaultLabel = { low:'LOW', medium:'ELEVATED', high:'HIGH' };
  box.className = `risk-box ${classMap[risk]} card-expandable${wasOpen?' open':''}`;
  box.setAttribute('aria-expanded', wasOpen ? 'true' : 'false');
  txt.textContent = label || defaultLabel[risk];
  whyEl.textContent = why || (
    risk==='low'    ? 'No significant threats detected.' :
    risk==='medium' ? 'Favorable conditions for storm development.' :
                      'Active severe weather threat.'
  );
  lastRisk = risk;
}

/* ════════════════════════════════════════════════
   ARIA LIVE ANNOUNCEMENT
════════════════════════════════════════════════ */
function announceAlert(message) {
  const el = document.getElementById('ariaLive');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = message; });
}

/* ════════════════════════════════════════════════
   POPUP SYSTEM — with persistent dismissal
════════════════════════════════════════════════ */
const POPUP_CONFIG = [
  {
    match: ev => ev.includes('Particularly Dangerous Situation') && ev.includes('Tornado'),
    badge:'🚨 PDS TORNADO WARNING', badgeBg:'#cc0000', badgeTx:'#fff',
    title:'🌪 PARTICULARLY DANGEROUS SITUATION — TORNADO WARNING',
    body:'A PARTICULARLY DANGEROUS SITUATION (PDS) Tornado Warning has been issued. This warning is reserved for rare events involving a violent, long-track tornado capable of catastrophic and potentially historic damage. Confirmed by trained spotters and/or Doppler radar. Extremely life-threatening conditions exist in and near the warned area.',
    instruction:'TAKE SHELTER IMMEDIATELY in the lowest level of a sturdy structure — a basement, storm shelter, or interior room away from all windows. Do not wait. If you are in the path of this storm, your life is in imminent danger.',
  },
  {
    match: ev => ev.includes('Tornado Emergency'),
    badge:'🚨 TORNADO EMERGENCY', badgeBg:'#aa0000', badgeTx:'#fff',
    title:'🌪 TORNADO EMERGENCY',
    body:'A TORNADO EMERGENCY has been declared. A confirmed, violent tornado is moving through a densely populated area. Catastrophic and life-threatening damage is occurring or will occur shortly. This is an exceedingly rare and extremely dangerous situation.',
    instruction:'SEEK SHELTER IMMEDIATELY in a basement or the lowest interior room of the most substantial structure available. Protect your head and neck. Do not attempt to outrun this tornado by vehicle.',
  },
  {
    match: ev => ev.includes('Tornado Warning'),
    badge:'⚠ TORNADO WARNING', badgeBg:'#990000', badgeTx:'#fff',
    title:'🌪 TORNADO WARNING',
    body:'A Tornado Warning has been issued by the National Weather Service. A tornado has been confirmed by Doppler radar or a trained weather spotter. The warned area should take protective action immediately.',
    instruction:'Move to the lowest floor of a substantial building. Go to an interior hallway or room away from windows and exterior walls. If in a mobile home or vehicle, abandon it immediately for a sturdier structure or a low-lying ditch away from trees.',
  },
  {
    match: ev => ev.includes('Flash Flood Emergency'),
    badge:'🌊 FLASH FLOOD EMERGENCY', badgeBg:'#003388', badgeTx:'#fff',
    title:'🌊 FLASH FLOOD EMERGENCY',
    body:'A Flash Flood Emergency has been issued. This is an exceedingly rare situation involving life-threatening flash flooding of catastrophic proportions.',
    instruction:"Move immediately to higher ground. Do not attempt to walk, swim, or drive through floodwaters. Turn Around, Don't Drown.",
  },
  {
    match: ev => ev.includes('Severe Thunderstorm Warning'),
    badge:'⛈ SEVERE THUNDERSTORM WARNING', badgeBg:'#774400', badgeTx:'#fff',
    title:'⛈ SEVERE THUNDERSTORM WARNING',
    body:'A Severe Thunderstorm Warning has been issued. Large hail and/or wind gusts of 58 mph or greater are occurring or are imminent.',
    instruction:'Move indoors immediately. Stay away from windows. Be aware that any severe thunderstorm can produce a tornado with little or no warning.',
  },
  {
    match: ev => ev.includes('Tornado Watch'),
    badge:'🌀 TORNADO WATCH', badgeBg:'#552200', badgeTx:'#ffe0c0',
    title:'🌪 TORNADO WATCH',
    body:'A Tornado Watch has been issued. Conditions are highly favorable for tornado development.',
    instruction:'Be prepared to act immediately if a Tornado Warning is issued. Review your shelter plan now.',
  },
  {
    match: ev => ev.includes('Severe Thunderstorm Watch'),
    badge:'⛈ SVR THUNDERSTORM WATCH', badgeBg:'#443300', badgeTx:'#ffe090',
    title:'⛈ SEVERE THUNDERSTORM WATCH',
    body:'A Severe Thunderstorm Watch is in effect. Conditions are favorable for severe thunderstorms.',
    instruction:'Stay weather-aware. Have a plan ready if warnings are issued for your location.',
  },
];

function getPopupConfig(ev) {
  return POPUP_CONFIG.find(c => c.match(ev)) || null;
}

/* Current popup alert UID — so close button knows what to dismiss */
let currentPopupUid = null;

function showPopup(ev, movement, uid) {
  const cfg = getPopupConfig(ev);
  if (!cfg) return;
  const badge = document.getElementById('popupBadge');
  if (!badge) return;

  currentPopupUid = uid || null;

  badge.textContent    = cfg.badge;
  badge.style.background = cfg.badgeBg;
  badge.style.color    = cfg.badgeTx;
  document.getElementById('popupTitle').textContent = cfg.title;
  document.getElementById('popupBody').textContent  = cfg.body;
  const instr = document.getElementById('popupInstruction');
  instr.textContent  = cfg.instruction;
  instr.style.display = cfg.instruction ? 'block' : 'none';
  const movEl = document.getElementById('popupMovement');
  if (movement) {
    movEl.textContent   = `📍 Storm movement: ${movement.dir} at ${movement.spd} mph`;
    movEl.style.display = 'block';
  } else {
    movEl.style.display = 'none';
  }
  document.getElementById('popup').style.display = 'block';
  requestAnimationFrame(() => {
    const closeBtn = document.getElementById('popupClose');
    if (closeBtn) closeBtn.focus();
  });
  announceAlert(cfg.title);
}

function closePopup() {
  // Mark this alert UID as dismissed so it never re-appears
  if (currentPopupUid) {
    addDismissed(currentPopupUid);
    // Also add to shownAlerts so the card stays collapsed by default
    addShownAlert(currentPopupUid);
  }
  document.getElementById('popup').style.display = 'none';
  currentPopupUid = null;
}

const popupCloseBtn = document.getElementById('popupClose');
if (popupCloseBtn) {
  popupCloseBtn.addEventListener('click', closePopup);
}
document.addEventListener('keydown', e => {
  const popup = document.getElementById('popup');
  if (e.key === 'Escape' && popup && popup.style.display !== 'none') {
    closePopup();
  }
});

/* ════════════════════════════════════════════════
   SIREN AUDIO
════════════════════════════════════════════════ */
document.addEventListener('click', () => {
  if (window.AudioContext || window.webkitAudioContext) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().then(() => ctx.close());
  }
}, { once: true });

function startSiren() {
  if (sirenActive) return;
  sirenActive = true;
  const banner = document.getElementById('sirenBanner');
  if (banner) banner.style.display = 'block';
  try {
    sirenCtx = new (window.AudioContext || window.webkitAudioContext)();
    playSirenLoop();
  } catch(_) {}
}

function playSirenLoop() {
  if (!sirenActive || !sirenCtx) return;
  const now = sirenCtx.currentTime;
  const duration = 4.2;

  const osc    = sirenCtx.createOscillator();
  const gain   = sirenCtx.createGain();
  const filter = sirenCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800, now);
  filter.Q.value = 0.8;
  osc.connect(filter); filter.connect(gain); gain.connect(sirenCtx.destination);
  osc.type = 'sawtooth';
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.3);
  gain.gain.setValueAtTime(0.22, now + duration - 0.4);
  gain.gain.linearRampToValueAtTime(0, now + duration);
  osc.frequency.setValueAtTime(450, now);
  osc.frequency.linearRampToValueAtTime(1020, now + duration * 0.5);
  osc.frequency.linearRampToValueAtTime(450, now + duration);

  const osc2  = sirenCtx.createOscillator();
  const gain2 = sirenCtx.createGain();
  osc2.connect(gain2); gain2.connect(sirenCtx.destination);
  osc2.type = 'sine';
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(0.07, now + 0.4);
  gain2.gain.setValueAtTime(0.07, now + duration - 0.4);
  gain2.gain.linearRampToValueAtTime(0, now + duration);
  osc2.frequency.setValueAtTime(225, now);
  osc2.frequency.linearRampToValueAtTime(510, now + duration * 0.5);
  osc2.frequency.linearRampToValueAtTime(225, now + duration);

  osc.start(now);  osc.stop(now + duration);
  osc2.start(now); osc2.stop(now + duration);
  sirenNodes = [osc, osc2, gain, gain2, filter];

  clearTimeout(sirenTimeout);
  sirenTimeout = setTimeout(() => { if (sirenActive) playSirenLoop(); }, duration * 1000);
}

function stopSiren() {
  sirenActive = false;
  const banner = document.getElementById('sirenBanner');
  if (banner) banner.style.display = 'none';
  clearTimeout(sirenTimeout);
  sirenNodes.forEach(n => { try { n.disconnect(); } catch(_) {} });
  sirenNodes = [];
  if (sirenCtx) { sirenCtx.close(); sirenCtx = null; }
}

/* ════════════════════════════════════════════════
   TICKER — Drag without accidental taps
════════════════════════════════════════════════ */
(function initTickerDragGuard() {
  const scroll = document.getElementById('tickerScroll');
  if (!scroll) return;
  let pointerStartX = 0, pointerStartY = 0, didDrag = false;
  const DRAG_THRESHOLD = 6;

  scroll.addEventListener('pointerdown', e => {
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    didDrag = false;
  }, { passive: true });

  scroll.addEventListener('pointermove', e => {
    const dx = Math.abs(e.clientX - pointerStartX);
    const dy = Math.abs(e.clientY - pointerStartY);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) didDrag = true;
  }, { passive: true });

  scroll.addEventListener('click', e => {
    if (didDrag) {
      e.stopImmediatePropagation();
      e.preventDefault();
      didDrag = false;
    }
  }, true);
})();

/* ════════════════════════════════════════════════
   ANIMATED BACKGROUND — fixed position, realistic tornado
   The canvas is position:fixed in CSS so it never
   moves with scroll. We only need to handle resize.
════════════════════════════════════════════════ */
(function initBackground() {
  if (prefersReducedMotion) return;

  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d', { alpha: false });

  let W, H;
  let bgMode    = 'clear';
  let isDaytime = true;
  let sunProgress  = 0.5;
  let nightProgress = 0.5;
  let clouds = [], drops = [], snowflakes = [], fogParticles = [], stars = null;
  let bolts = [], boltTimer = 0;

  /* ── REALISTIC TORNADO STATE ── */
  let tornadoAge = 0;
  let tornadoRotation = 0;
  let tornadoWobble = 0;
  let tornadoDebris = [];
  let tornadoRopePhase = false;
  let tornadoGroundDust = [];
  let tornadoIntensity = 0; // 0→1 ramp-in for smooth appearance

  let lastFrameTime = 0;
  const targetFPS  = perfLevel === 'low' ? 24 : perfLevel === 'mid' ? 40 : 60;
  const frameTarget = 1000 / targetFPS;

  const PARTICLE = {
    cloud: perfLevel === 'low' ? 3 : perfLevel === 'mid' ? 5 : 8,
    rain:  perfLevel === 'low' ? 45 : perfLevel === 'mid' ? 80 : 120,
    snow:  perfLevel === 'low' ? 45 : perfLevel === 'mid' ? 70 : 100,
    fog:   perfLevel === 'low' ? 6 : 10,
  };

  /* ── RESIZE — canvas is fixed, just match viewport ── */
  let resizeTimer;
  function resize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const dpr = pixelRatio;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.scale(dpr, dpr);
      stars = null;
      initTornadoDebris();
    }, 150);
  }
  window.addEventListener('resize', resize, { passive: true });

  // Initial size
  const dpr0 = pixelRatio;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width  = W * dpr0;
  canvas.height = H * dpr0;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr0, dpr0);

  /* ════════════════════════════════════════════
     REALISTIC TORNADO
  ════════════════════════════════════════════ */
  function initTornadoDebris() {
    tornadoDebris = [];
    tornadoGroundDust = [];
    tornadoIntensity = 0;

    const debrisCount = perfLevel === 'low' ? 50 : perfLevel === 'mid' ? 100 : 180;
    for (let i = 0; i < debrisCount; i++) {
      const t = Math.random();
      const orbitRadius = Math.max(8, t < 0.5
        ? t * t * 2 * 130 + 8
        : (1 - t) * 90 + 18);
      tornadoDebris.push({
        t,
        angle: Math.random() * Math.PI * 2,
        orbitRadius,
        angularSpeed: (1.8 + Math.random() * 2.8) * (Math.random() > 0.5 ? 1 : -1),
        vertSpeed: 0.0006 + Math.random() * 0.0018,
        size: 1 + Math.random() * (t > 0.7 ? 6 : 3),
        type: Math.random() > 0.55 ? 'plank' : Math.random() > 0.5 ? 'chunk' : 'dust',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.18,
        opacity: 0.35 + Math.random() * 0.6,
        color: `hsl(${22 + Math.random()*25},${28+Math.random()*22}%,${18+Math.random()*22}%)`,
      });
    }

    // Ground dust vortex
    const dustCount = perfLevel === 'low' ? 16 : 30;
    for (let i = 0; i < dustCount; i++) {
      tornadoGroundDust.push({
        angle: Math.random() * Math.PI * 2,
        radius: 15 + Math.random() * 160,
        angularSpeed: (0.5 + Math.random() * 1.0) * (Math.random() > 0.5 ? 1 : -1),
        opacity: 0.08 + Math.random() * 0.28,
        size: 20 + Math.random() * 70,
        yOffset: Math.random() * 50,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /* Funnel profile: width in px at yFrac (0=cloud top, 1=ground) */
  function getTornadoProfile(yFrac) {
    const wobbleAmt = Math.sin(tornadoWobble + yFrac * 3.5) * 10;
    if (tornadoRopePhase) {
      const rope = 5 + Math.sin(yFrac * Math.PI * 5 + tornadoAge * 0.06) * 12;
      return Math.max(2, rope + wobbleAmt * 0.25);
    }
    // Realistic EF3+ wedge tornado profile
    // Narrow at top, widest at 70% down, tapers to contact point
    let w;
    if (yFrac < 0.15) {
      w = yFrac / 0.15 * 18; // initial narrow stem from cloud
    } else if (yFrac < 0.70) {
      w = 18 + ((yFrac - 0.15) / 0.55) * 110; // widening cone
    } else {
      w = 128 + ((yFrac - 0.70) / 0.30) * 30; // slight widening at base
    }
    return Math.max(2, w + wobbleAmt);
  }

  /* Horizontal position with realistic tilt/lean */
  function getTornadoX(yFrac) {
    const lean = Math.sin(tornadoAge * 0.006) * 40 * yFrac;  // tilts as it moves
    const wobX  = Math.sin(tornadoWobble * 0.5 + yFrac * 2.2) * 18 * yFrac;
    return W / 2 + lean + wobX;
  }

  /* Multi-layer funnel rendering */
  function buildFunnelPath(points, widthMult) {
    const path = new Path2D();
    const n = points.length;
    // Left edge top→bottom
    path.moveTo(points[0].cx - points[0].hw * widthMult, points[0].cy);
    for (let i = 1; i < n; i++) {
      const p = points[i], pp = points[i - 1];
      const cpx = (pp.cx + p.cx) / 2 - (pp.hw + p.hw) / 2 * widthMult;
      const cpy = (pp.cy + p.cy) / 2;
      path.quadraticCurveTo(pp.cx - pp.hw * widthMult, pp.cy, cpx, cpy);
    }
    path.lineTo(points[n-1].cx - points[n-1].hw * widthMult, points[n-1].cy);
    // Right edge bottom→top
    for (let i = n - 1; i >= 0; i--) {
      const p = points[i];
      const pi = Math.max(0, i - 1);
      const pp = points[pi];
      const cpx = (pp.cx + p.cx) / 2 + (pp.hw + p.hw) / 2 * widthMult;
      const cpy = (pp.cy + p.cy) / 2;
      if (i === n - 1) {
        path.lineTo(p.cx + p.hw * widthMult, p.cy);
      } else {
        path.quadraticCurveTo(p.cx + p.hw * widthMult, p.cy, cpx, cpy);
      }
    }
    path.closePath();
    return path;
  }

  function drawTornado() {
    tornadoAge += 1;
    tornadoRotation += 0.032;
    tornadoWobble += 0.013;
    // Smooth intensity ramp-in
    if (tornadoIntensity < 1) tornadoIntensity = Math.min(1, tornadoIntensity + 0.008);

    // Rope phase cycles
    tornadoRopePhase = (tornadoAge % 900) < 90;

    const groundY = H * 0.88;
    const cloudY  = H * 0.06;
    const steps   = perfLevel === 'low' ? 28 : 56;

    ctx.save();
    ctx.globalAlpha = tornadoIntensity;

    // ── 1. Greenish pressure-drop sky haze ──
    const skyHaze = ctx.createRadialGradient(W/2, H * 0.3, 0, W/2, H * 0.5, W * 0.7);
    skyHaze.addColorStop(0, 'rgba(28,55,8,0.22)');
    skyHaze.addColorStop(0.5, 'rgba(10,28,4,0.12)');
    skyHaze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = skyHaze;
    ctx.fillRect(0, 0, W, H);

    // ── 2. Build point array ──
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const yFrac = i / steps;
      const cy = cloudY + yFrac * (groundY - cloudY);
      const cx = getTornadoX(yFrac);
      const hw = getTornadoProfile(yFrac);
      points.push({ cx, cy, hw });
    }

    // ── 3. Draw funnel layers (outer glow → inner core) ──
    const layers = [
      { mult: 1.55, alphaTop: 0.04, alphaBot: 0.08, color: '45,30,10' },
      { mult: 1.25, alphaTop: 0.10, alphaBot: 0.18, color: '58,42,16' },
      { mult: 1.00, alphaTop: 0.20, alphaBot: 0.38, color: '75,55,22' },
      { mult: 0.75, alphaTop: 0.28, alphaBot: 0.50, color: '92,68,28' },
      { mult: 0.50, alphaTop: 0.18, alphaBot: 0.32, color: '55,40,16' },
    ];

    layers.forEach(l => {
      const path = buildFunnelPath(points, l.mult);
      const grad = ctx.createLinearGradient(0, cloudY, 0, groundY);
      grad.addColorStop(0.0, `rgba(${l.color},${l.alphaTop * 0.4})`);
      grad.addColorStop(0.25, `rgba(${l.color},${l.alphaTop})`);
      grad.addColorStop(0.65, `rgba(${l.color},${l.alphaBot})`);
      grad.addColorStop(0.85, `rgba(${l.color},${l.alphaBot * 1.2})`);
      grad.addColorStop(1.0, `rgba(${l.color},${l.alphaBot * 0.5})`);
      ctx.fillStyle = grad;
      ctx.fill(path);
    });

    // ── 4. Interior rotation banding — makes it look like it's spinning ──
    const bandCount = perfLevel === 'low' ? 10 : 22;
    for (let b = 0; b < bandCount; b++) {
      const yFrac = (b + 0.5) / bandCount;
      const cy = cloudY + yFrac * (groundY - cloudY);
      const cx = getTornadoX(yFrac);
      const hw = getTornadoProfile(yFrac);
      if (hw < 5) continue;

      // Rotating elliptical highlight band
      const bandAngle = tornadoRotation * (2.5 - yFrac) + b * 0.55;
      const highlightX = cx + Math.cos(bandAngle) * hw * 0.45;
      const highlightY = cy + Math.sin(bandAngle * 0.5) * hw * 0.12;

      const hg = ctx.createRadialGradient(highlightX, highlightY, 0, cx, cy, hw * 0.95);
      hg.addColorStop(0, 'rgba(140,110,50,0.0)');
      hg.addColorStop(0.35, 'rgba(95,70,24,0.12)');
      hg.addColorStop(0.70, 'rgba(62,44,14,0.22)');
      hg.addColorStop(0.90, 'rgba(35,22,6,0.28)');
      hg.addColorStop(1, 'rgba(10,6,2,0.0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw * 0.95, hw * 0.20, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 5. Sub-vortices (2 inner rotating columns) ──
    const vCount = 2;
    for (let v = 0; v < vCount; v++) {
      const vBaseAngle = tornadoRotation * 3.2 + v * Math.PI;
      for (let s = 3; s < steps - 2; s += 2) {
        const yFrac = s / steps;
        const cy = cloudY + yFrac * (groundY - cloudY);
        const cx = getTornadoX(yFrac);
        const hw = getTornadoProfile(yFrac);
        if (hw < 8) continue;
        const orbitR = hw * (0.52 + 0.18 * Math.sin(yFrac * Math.PI));
        const vAngle = vBaseAngle + yFrac * 1.8;
        const vx = cx + Math.cos(vAngle) * orbitR;
        const vy = cy;
        const vs = Math.max(3, hw * 0.22);
        const vg = ctx.createRadialGradient(vx, vy, 0, vx, vy, vs * 3);
        vg.addColorStop(0, 'rgba(175,135,65,0.38)');
        vg.addColorStop(0.35, 'rgba(110,80,28,0.20)');
        vg.addColorStop(0.7, 'rgba(65,44,14,0.10)');
        vg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = vg;
        ctx.beginPath();
        ctx.arc(vx, vy, vs * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── 6. Ground contact — condensation disc + massive dust bowl ──
    const groundX = getTornadoX(1);
    const groundW = getTornadoProfile(1);

    // Condensation impact disc
    const discGrad = ctx.createRadialGradient(groundX, groundY, 0, groundX, groundY, groundW * 3.5);
    discGrad.addColorStop(0, 'rgba(120,90,38,0.7)');
    discGrad.addColorStop(0.3, 'rgba(90,65,24,0.45)');
    discGrad.addColorStop(0.6, 'rgba(55,38,12,0.22)');
    discGrad.addColorStop(0.85, 'rgba(28,18,5,0.10)');
    discGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = discGrad;
    ctx.beginPath();
    ctx.ellipse(groundX, groundY, groundW * 3.5, groundW * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rotating dust halo at ground
    tornadoGroundDust.forEach(d => {
      d.angle += d.angularSpeed * 0.014;
      d.phase += 0.018;
      const dx = groundX + Math.cos(d.angle) * d.radius;
      const dy = groundY - d.yOffset + Math.sin(d.phase) * 10;
      const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, d.size);
      dg.addColorStop(0, `rgba(118,88,35,${d.opacity})`);
      dg.addColorStop(0.45, `rgba(85,60,20,${d.opacity * 0.55})`);
      dg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.ellipse(dx, dy, d.size, d.size * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── 7. Flying debris ──
    tornadoDebris.forEach(d => {
      d.angle += d.angularSpeed * 0.020 * (0.8 + d.t * 0.8);
      d.t += d.vertSpeed;
      if (d.t > 1.02) d.t = 0.02 + Math.random() * 0.05;
      d.rotation += d.rotSpeed;

      const yFrac = Math.min(1, d.t);
      const cy = cloudY + yFrac * (groundY - cloudY);
      const cx = getTornadoX(yFrac);
      const hw = getTornadoProfile(yFrac);
      const orbitR = Math.min(d.orbitRadius, hw * 0.92);

      const dx = cx + Math.cos(d.angle + tornadoRotation * d.angularSpeed * 0.4) * orbitR;
      const dy = cy + Math.sin(d.angle * 0.7) * orbitR * 0.15;

      const fadeIn  = Math.min(1, d.t * 8);
      const fadeOut = Math.min(1, (1 - d.t) * 8);

      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(d.rotation);
      ctx.globalAlpha = d.opacity * fadeIn * fadeOut;
      ctx.fillStyle = d.color;

      if (d.type === 'plank') {
        const pw = d.size * 3.5, ph = d.size * 0.55;
        ctx.fillRect(-pw/2, -ph/2, pw, ph);
      } else if (d.type === 'chunk') {
        ctx.beginPath();
        ctx.arc(0, 0, d.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Soft dust puff
        const dg2 = ctx.createRadialGradient(0, 0, 0, 0, 0, d.size * 2);
        dg2.addColorStop(0, d.color);
        dg2.addColorStop(0.6, d.color.replace('hsl', 'hsla').replace(')', ',0.4)'));
        dg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = dg2;
        ctx.beginPath();
        ctx.arc(0, 0, d.size * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // ── 8. Mesocyclone cloud base ──
    const cloudBaseX = W / 2;

    // Dark rotating wall cloud
    const wallGrad = ctx.createRadialGradient(cloudBaseX, cloudY, 0, cloudBaseX, cloudY, W * 0.40);
    wallGrad.addColorStop(0, 'rgba(12,6,2,0.80)');
    wallGrad.addColorStop(0.25, 'rgba(20,12,4,0.55)');
    wallGrad.addColorStop(0.55, 'rgba(12,7,2,0.30)');
    wallGrad.addColorStop(0.80, 'rgba(5,3,1,0.12)');
    wallGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wallGrad;
    ctx.beginPath();
    ctx.ellipse(cloudBaseX, cloudY, W * 0.40, H * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rotating lowering/wall cloud lobes
    const wallCount = perfLevel === 'low' ? 5 : 8;
    for (let w = 0; w < wallCount; w++) {
      const wa = tornadoRotation * 0.55 + w * (Math.PI * 2 / wallCount);
      const wr = W * (0.10 + Math.sin(wa * 2 + tornadoAge * 0.01) * 0.04);
      const wx = cloudBaseX + Math.cos(wa) * wr;
      const wy = cloudY + H * 0.045 + Math.sin(wa * 0.7) * H * 0.025;
      const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, 60 + w * 10);
      wg.addColorStop(0, 'rgba(35,22,8,0.48)');
      wg.addColorStop(0.55, 'rgba(22,14,4,0.24)');
      wg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.ellipse(wx, wy, 60 + w * 10, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /* ─── CLOUD / RAIN / SNOW / FOG helpers (unchanged) ─── */
  function buildCloud(x, y, scale, dark) {
    const lobes = [];
    const bodyCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bodyCount; i++) {
      const angle = (i / bodyCount) * Math.PI * 2;
      const dist  = (0.12 + Math.random() * 0.35) * scale;
      lobes.push({ ox: Math.cos(angle)*dist*1.1, oy: Math.sin(angle)*dist*0.4, rx: (0.45+Math.random()*0.5)*scale, ry: (0.28+Math.random()*0.3)*scale, layer:'body' });
    }
    const topCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < topCount; i++) {
      const angle = -Math.PI/2 + (i/(topCount-1) - 0.5)*Math.PI*0.8;
      lobes.push({ ox: Math.cos(angle)*scale*0.28, oy: Math.sin(angle)*scale*0.42 - scale*0.22, rx: (0.28+Math.random()*0.42)*scale, ry: (0.28+Math.random()*0.42)*scale, layer:'top' });
    }
    return { x, y, scale, dark, lobes, speed: 0.07 + Math.random() * 0.15 };
  }

  function initClouds(count, dark) {
    clouds = [];
    const n = Math.min(count, PARTICLE.cloud * (dark ? 1 : 0.6));
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W * 1.4 - W * 0.2;
      const y = H * 0.04 + Math.random() * H * 0.24;
      clouds.push(buildCloud(x, y, 65 + Math.random() * 100, dark));
    }
  }

  function drawCloud(cloud) {
    const { x, y, lobes, dark } = cloud;
    let topColor, midColor, shadowColor;
    if (dark)          { topColor='rgba(70,76,95,1)';    midColor='rgba(44,49,64,1)';   shadowColor='rgba(20,22,32,1)'; }
    else if (isDaytime){ topColor='rgba(255,255,255,1)'; midColor='rgba(228,236,248,1)'; shadowColor='rgba(168,185,210,1)'; }
    else               { topColor='rgba(46,56,84,1)';    midColor='rgba(32,40,62,1)';   shadowColor='rgba(16,20,36,1)'; }
    ctx.save();
    ctx.fillStyle = shadowColor;
    lobes.forEach(l => { ctx.beginPath(); ctx.ellipse(x+l.ox+4, y+l.oy+5, l.rx*0.94, l.ry*0.94, 0, 0, Math.PI*2); ctx.fill(); });
    ctx.fillStyle = midColor;
    lobes.filter(l=>l.layer==='body').forEach(l => { ctx.beginPath(); ctx.ellipse(x+l.ox, y+l.oy, l.rx, l.ry, 0, 0, Math.PI*2); ctx.fill(); });
    ctx.fillStyle = topColor;
    lobes.filter(l=>l.layer==='top').forEach(l => { ctx.beginPath(); ctx.ellipse(x+l.ox, y+l.oy, l.rx, l.ry, 0, 0, Math.PI*2); ctx.fill(); });
    lobes.filter(l=>l.layer==='top').forEach(l => {
      const hlGrd = ctx.createRadialGradient(x+l.ox-l.rx*0.2, y+l.oy-l.ry*0.26, l.rx*0.04, x+l.ox, y+l.oy, l.rx);
      if (dark)          { hlGrd.addColorStop(0,'rgba(95,105,128,0.38)'); hlGrd.addColorStop(1,'rgba(0,0,0,0)'); }
      else if (isDaytime){ hlGrd.addColorStop(0,'rgba(255,255,255,0.62)'); hlGrd.addColorStop(0.5,'rgba(255,255,255,0.1)'); hlGrd.addColorStop(1,'rgba(255,255,255,0)'); }
      else               { hlGrd.addColorStop(0,'rgba(75,95,145,0.28)'); hlGrd.addColorStop(1,'rgba(0,0,0,0)'); }
      ctx.save(); ctx.beginPath(); ctx.ellipse(x+l.ox, y+l.oy, l.rx, l.ry, 0, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = hlGrd; ctx.fill(); ctx.restore();
    });
    ctx.restore();
  }

  function initRain(count, angled) {
    drops = [];
    for (let i = 0; i < count; i++) {
      drops.push({ x:Math.random()*W*1.4, y:Math.random()*H, len:7+Math.random()*16, speed:7+Math.random()*10, angle:angled?0.22+Math.random()*0.15:0, opacity:0.07+Math.random()*0.18 });
    }
  }
  function initSnow(count) {
    snowflakes = [];
    for (let i = 0; i < count; i++) {
      snowflakes.push({ x:Math.random()*W, y:Math.random()*H, r:1+Math.random()*2.8, speed:0.4+Math.random()*1.3, drift:(Math.random()-0.5)*0.45, opacity:0.32+Math.random()*0.5 });
    }
  }
  function initFog() {
    fogParticles = [];
    for (let i = 0; i < PARTICLE.fog; i++) {
      fogParticles.push({ x:Math.random()*W, y:H*0.28+Math.random()*H*0.62, r:100+Math.random()*200, speed:0.05+Math.random()*0.1, opacity:0.022+Math.random()*0.045 });
    }
  }

  function buildBoltPath(x1,y1,x2,y2,depth) {
    if (depth===0) return [{x:x1,y:y1},{x:x2,y:y2}];
    const mx=(x1+x2)/2+(Math.random()-0.5)*(Math.abs(x2-x1)+70)*(0.75/depth);
    const my=(y1+y2)/2+(Math.random()-0.5)*35;
    return [...buildBoltPath(x1,y1,mx,my,depth-1),...buildBoltPath(mx,my,x2,y2,depth-1)];
  }
  function generateBranches(segments) {
    const branches=[];
    const step = perfLevel==='low' ? 8 : 4;
    for (let i=2;i<segments.length-2;i+=step) {
      if (Math.random()<0.35) {
        const seg=segments[i];
        const len=35+Math.random()*80;
        const angle=(Math.random()-0.5)*1.3+Math.PI/2;
        branches.push({ segs:buildBoltPath(seg.x,seg.y,seg.x+Math.cos(angle)*len,seg.y+Math.sin(angle)*len,3), opacity:0.4+Math.random()*0.38 });
      }
    }
    return branches;
  }
  function spawnBolt() {
    const x=W*0.15+Math.random()*W*0.7;
    const segments=buildBoltPath(x,0,x+(Math.random()-0.5)*160,H*(0.35+Math.random()*0.44),7);
    bolts.push({segments,life:1.0,decay:0.042+Math.random()*0.038,bright:0.68+Math.random()*0.3,branches:generateBranches(segments)});
    if (bolts.length > 4) bolts.splice(0, bolts.length - 4);
  }
  function drawBoltPath(segs,alpha,lineWidth,color) {
    if(segs.length<2)return;
    ctx.beginPath(); ctx.moveTo(segs[0].x,segs[0].y);
    for(let i=1;i<segs.length;i++) ctx.lineTo(segs[i].x,segs[i].y);
    ctx.lineWidth=lineWidth*4; ctx.strokeStyle=`rgba(${color},${alpha*0.06})`; ctx.shadowBlur=0; ctx.stroke();
    ctx.lineWidth=lineWidth*2; ctx.strokeStyle=`rgba(${color},${alpha*0.16})`; ctx.stroke();
    ctx.lineWidth=lineWidth;   ctx.strokeStyle=`rgba(${color},${alpha})`;
    ctx.shadowBlur=14; ctx.shadowColor=`rgba(${color},0.9)`; ctx.stroke();
    ctx.lineWidth=Math.max(0.35,lineWidth*0.3); ctx.strokeStyle=`rgba(255,255,255,${alpha*0.75})`;
    ctx.shadowBlur=5; ctx.shadowColor='white'; ctx.stroke();
    ctx.shadowBlur=0;
  }

  function drawSun(progress) {
    const sx=W*0.1+W*0.8*progress;
    const sy=H*0.44-Math.sin(Math.PI*progress)*H*0.37;
    const sunR=34, glowR=sunR*4.2;
    const lowLight=progress<0.15||progress>0.85;
    const grd=ctx.createRadialGradient(sx,sy,sunR*0.5,sx,sy,glowR);
    grd.addColorStop(0,lowLight?'rgba(255,215,100,0.88)':'rgba(255,255,220,0.75)');
    grd.addColorStop(0.3,lowLight?'rgba(255,140,40,0.32)':'rgba(255,240,150,0.2)');
    grd.addColorStop(1,lowLight?'rgba(255,80,0,0)':'rgba(255,255,200,0)');
    ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(sx,sy,glowR,0,Math.PI*2); ctx.fill();
    const disk=ctx.createRadialGradient(sx-sunR*0.2,sy-sunR*0.2,sunR*0.1,sx,sy,sunR);
    disk.addColorStop(0,lowLight?'rgba(255,228,118,1)':'rgba(255,255,228,1)');
    disk.addColorStop(1,lowLight?'rgba(255,155,38,1)':'rgba(255,232,115,1)');
    ctx.fillStyle=disk; ctx.beginPath(); ctx.arc(sx,sy,sunR,0,Math.PI*2); ctx.fill();
  }

  function drawMoon(progress) {
    const mx=W*0.1+W*0.8*progress, my=H*0.38-Math.sin(Math.PI*progress)*H*0.3;
    const moonR=18;
    const grd=ctx.createRadialGradient(mx,my,moonR*0.3,mx,my,moonR*3);
    grd.addColorStop(0,'rgba(200,220,255,0.14)'); grd.addColorStop(1,'rgba(150,180,255,0)');
    ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(mx,my,moonR*3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(218,228,255,0.94)'; ctx.beginPath(); ctx.arc(mx,my,moonR,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(18,28,55,0.7)'; ctx.beginPath(); ctx.arc(mx+moonR*0.32,my,moonR*0.84,0,Math.PI*2); ctx.fill();
  }

  function initStars() {
    stars=[];
    const count = perfLevel==='low' ? 80 : 180;
    for(let i=0;i<count;i++) {
      stars.push({x:Math.random()*W,y:Math.random()*H*0.65,r:0.3+Math.random()*1.2,flicker:Math.random()*Math.PI*2,twinkle:Math.random()*0.42+0.55});
    }
  }

  function getSkyColors() {
    switch(bgMode) {
      case 'tornado': return ['#0a0500','#060300'];
      case 'storm':   return isDaytime?['#141000','#070900']:['#070000','#000408'];
      case 'rain':    return isDaytime?['#26303c','#364050']:['#060b16','#0a1420'];
      case 'snow':    return isDaytime?['#c2d2e2','#dce8f4']:['#08101a','#161e2c'];
      case 'fog':     return isDaytime?['#7a8c9c','#9aaab8']:['#0b0e16','#181e2e'];
      case 'cloudy':  return isDaytime?['#354558','#455668']:['#050810','#0c141c'];
      default:
        if(isDaytime){
          const blend=Math.sin(Math.PI*sunProgress);
          if(sunProgress<0.15||sunProgress>0.85) return['#170506','#5e2610'];
          return [`rgb(${Math.round(16+blend*14)},${Math.round(75+blend*55)},${Math.round(132+blend*76)})`,
                  `rgb(${Math.round(70+blend*92)},${Math.round(130+blend*72)},${Math.round(192+blend*25)})`];
        }
        return ['#010408','#010608'];
    }
  }

  function draw(timestamp) {
    requestAnimationFrame(draw);
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < frameTarget - 2) return;
    lastFrameTime = timestamp;

    ctx.clearRect(0,0,W,H);

    const [skyTop,skyBot]=getSkyColors();
    const grad=ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,skyTop); grad.addColorStop(1,skyBot);
    ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

    if(bgMode==='clear'&&isDaytime&&(sunProgress<0.22||sunProgress>0.78)){
      const intense=sunProgress<0.22?sunProgress/0.22:(1-sunProgress)/0.22;
      const hg=ctx.createLinearGradient(0,H*0.46,0,H);
      hg.addColorStop(0,`rgba(255,95,18,0)`);
      hg.addColorStop(0.5,`rgba(255,115,28,${0.2*intense})`);
      hg.addColorStop(1,`rgba(255,55,8,${0.13*intense})`);
      ctx.fillStyle=hg; ctx.fillRect(0,H*0.46,W,H*0.54);
    }

    const showStars=!isDaytime||bgMode==='storm'||bgMode==='tornado';
    if(showStars){
      if(!stars)initStars();
      const sa=isDaytime?0.1:1;
      stars.forEach(s=>{
        s.flicker+=0.015;
        const a=(0.28+Math.sin(s.flicker)*0.26*s.twinkle)*sa;
        if(a<=0)return;
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(195,215,255,${Math.max(0,a)})`; ctx.fill();
      });
    }

    if(isDaytime&&bgMode!=='storm'&&bgMode!=='tornado'&&bgMode!=='rain') drawSun(sunProgress);
    else if(!isDaytime&&bgMode==='clear') drawMoon(nightProgress);

    clouds.forEach(cloud=>{
      cloud.x+=cloud.speed;
      if(cloud.x-cloud.scale*1.5>W) cloud.x=-cloud.scale*1.5;
      drawCloud(cloud);
    });

    if(bgMode==='rain'||bgMode==='storm'||bgMode==='tornado'){
      const rainCol=bgMode==='storm'||bgMode==='tornado'?'185,195,240':'125,188,248';
      drops.forEach(d=>{
        d.y+=d.speed; d.x-=d.speed*d.angle;
        if(d.y>H){d.y=-d.len;d.x=Math.random()*W*1.3;}
        ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-d.len*d.angle*1.3,d.y+d.len);
        ctx.strokeStyle=`rgba(${rainCol},${d.opacity})`; ctx.lineWidth=0.7; ctx.stroke();
      });
    }

    if(bgMode==='snow'){
      snowflakes.forEach(s=>{
        s.y+=s.speed; s.x+=s.drift;
        if(s.y>H){s.y=-5;s.x=Math.random()*W;}
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(215,228,255,${s.opacity})`; ctx.fill();
      });
    }

    if(bgMode==='fog'){
      fogParticles.forEach(fp=>{
        fp.x+=fp.speed;
        if(fp.x-fp.r>W)fp.x=-fp.r;
        const fc=isDaytime?'172,192,202':'112,132,155';
        const fg=ctx.createRadialGradient(fp.x,fp.y,0,fp.x,fp.y,fp.r);
        fg.addColorStop(0,`rgba(${fc},${fp.opacity})`); fg.addColorStop(1,`rgba(${fc},0)`);
        ctx.fillStyle=fg; ctx.beginPath(); ctx.arc(fp.x,fp.y,fp.r,0,Math.PI*2); ctx.fill();
      });
    }

    if(bgMode==='tornado') drawTornado();

    const stormModes=bgMode==='storm'||bgMode==='tornado';
    const boltInterval = perfLevel==='low' ? 140 : 85;
    if(stormModes){
      boltTimer++;
      if(boltTimer>=boltInterval){if(Math.random()>0.2)spawnBolt();boltTimer=0;}
    } else if(bgMode==='rain'){
      boltTimer++;
      if(boltTimer>=260){if(Math.random()>0.5)spawnBolt();boltTimer=0;}
    }

    bolts=bolts.filter(b=>b.life>0);
    bolts.forEach(b=>{
      const boltColor=bgMode==='tornado'?'255,172,70':'195,215,255';
      if(b.life>0.85){const fa=(b.life-0.85)/0.15*0.05;ctx.fillStyle=`rgba(195,215,255,${fa})`;ctx.fillRect(0,0,W,H);}
      drawBoltPath(b.segments,b.life*b.bright,1.6,boltColor);
      b.branches.forEach(br=>drawBoltPath(br.segs,b.life*b.bright*br.opacity,0.7,boltColor));
      b.life-=b.decay;
    });

    if(perfLevel==='high'){
      ctx.fillStyle='rgba(0,0,0,0.014)';
      for(let y=0;y<H;y+=5) ctx.fillRect(0,y,W,2);
    }
  }
  requestAnimationFrame(draw);

  window.setBgMode = function(mode) {
    if(bgMode===mode)return;
    bgMode=mode; stars=null;
    switch(mode){
      case 'storm':        initClouds(8,true);  initRain(PARTICLE.rain,true);  snowflakes=[]; fogParticles=[]; break;
      case 'rain':         initClouds(6,true);  initRain(Math.round(PARTICLE.rain*0.58),false); snowflakes=[]; fogParticles=[]; break;
      case 'tornado':
        initClouds(10,true);
        initRain(PARTICLE.rain,true);
        snowflakes=[]; fogParticles=[];
        tornadoAge=0; tornadoRotation=0; tornadoWobble=0;
        tornadoRopePhase=false; tornadoIntensity=0;
        initTornadoDebris();
        break;
      case 'snow':         initClouds(4,false); drops=[]; initSnow(PARTICLE.snow); fogParticles=[]; break;
      case 'fog':          initClouds(3,false); drops=[]; snowflakes=[]; initFog(); break;
      case 'cloudy':       initClouds(7,true);  drops=[]; snowflakes=[]; fogParticles=[]; break;
      case 'partlycloudy': initClouds(3,false); drops=[]; snowflakes=[]; fogParticles=[]; break;
      default:             initClouds(2,false); drops=[]; snowflakes=[]; fogParticles=[]; break;
    }
  };
  window.setDaytime = function(isDay,sp,np) {
    isDaytime=isDay;
    if(sp!==undefined)sunProgress=sp;
    if(np!==undefined)nightProgress=np;
    stars=null;
  };
})();

if (!window.setBgMode)  window.setBgMode  = () => {};
if (!window.setDaytime) window.setDaytime = () => {};

/* ════════════════════════════════════════════════
   SUN/DAY-NIGHT
════════════════════════════════════════════════ */
function getSunTimes(lat,lon) {
  const now=new Date();
  const JD=Math.floor(now/86400000)+2440587.5;
  const n=Math.round(JD-2451545.0);
  const L=(280.46+0.9856474*n)%360;
  const g=((357.528+0.9856003*n)%360)*Math.PI/180;
  const lambda=L+1.915*Math.sin(g)+0.02*Math.sin(2*g);
  const eps=23.439-0.0000004*n;
  const sinDec=Math.sin(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180);
  const cosDec=Math.sqrt(1-sinDec*sinDec);
  const cosH=(-Math.tan(lat*Math.PI/180)*sinDec/cosDec)-0.01454/(cosDec*Math.cos(lat*Math.PI/180));
  if(cosH>1||cosH<-1)return{sunrise:null,sunset:null};
  const H=Math.acos(cosH)*180/Math.PI;
  const RA=(Math.atan2(Math.cos(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180),Math.cos(lambda*Math.PI/180))*180/Math.PI)/15;
  const transit=12-lon/15+(RA-L/15);
  const tzOff=new Date().getTimezoneOffset()/60;
  return{sunrise:transit-H/15-tzOff,sunset:transit+H/15-tzOff};
}
function updateDayNight() {
  const now=new Date();
  const h=now.getHours()+now.getMinutes()/60;
  const st=getSunTimes(appLat,appLon);
  let isDay=true,sunProg=0.5,nightProg=0.5;
  if(st.sunrise&&st.sunset){
    isDay=h>=st.sunrise&&h<=st.sunset;
    if(isDay) sunProg=Math.max(0,Math.min(1,(h-st.sunrise)/(st.sunset-st.sunrise)));
    else {
      const nightLen=(24-st.sunset)+st.sunrise;
      const nightH=h<st.sunrise?h+(24-st.sunset):h-st.sunset;
      nightProg=Math.max(0,Math.min(1,nightH/nightLen));
    }
  }
  window.setDaytime(isDay,sunProg,nightProg);
}

/* ════════════════════════════════════════════════
   WEATHER CODE → BG MODE
════════════════════════════════════════════════ */
function weatherCodeToMode(code, cape, li, windSpd, dewF, windDeg, pressure, hasActiveTornadoAlert) {
  if (hasActiveTornadoAlert) return 'tornado';
  const torEnv = computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressure);
  if (torEnv === 'high') return 'tornado';
  if ([71,73,75,77,85,86].includes(code)) return 'snow';
  if ([45,48].includes(code)) return 'fog';
  if ([95,96,99].includes(code)) return 'storm';
  if ([51,53,55,61,63,65,80,81,82].includes(code)) return 'rain';
  if (li <= -4 && cape > 800 && dewF >= 55) return 'storm';
  if (code===1) return 'partlycloudy';
  if ([2,3].includes(code)) return 'cloudy';
  return 'clear';
}

/* ════════════════════════════════════════════════
   ALERT CSS CLASS
════════════════════════════════════════════════ */
function alertCssClass(ev) {
  if (ev.includes('Particularly Dangerous Situation')) return 'alert-pds';
  if (ev.includes('Tornado Emergency'))                return 'alert-pds';
  if (ev.includes('Tornado Warning'))                  return 'alert-tor-warn';
  if (ev.includes('Tornado Watch'))                    return 'alert-tor-watch';
  if (ev.includes('Severe Thunderstorm Warning'))      return 'alert-svr-warn';
  if (ev.includes('Severe Thunderstorm Watch'))        return 'alert-svr-watch';
  if (ev.includes('Flash Flood'))                      return 'alert-flood';
  if (ev.includes('Blizzard')||ev.includes('Winter')||ev.includes('Ice Storm')) return 'alert-winter';
  return 'alert-other';
}

function alertSectionLabel(score) {
  if (score <= 3)  return 'Highest Priority';
  if (score <= 6)  return 'Warnings';
  if (score <= 9)  return 'Watches';
  return                  'Advisories & Other';
}

/* ════════════════════════════════════════════════
   GEOLOCATION + LOAD
════════════════════════════════════════════════ */
navigator.geolocation.getCurrentPosition(
  p => { appLat=p.coords.latitude; appLon=p.coords.longitude; loadAll(); },
  ()  => loadAll(),
  { timeout: 8000 }
);

function loadAll() {
  forceStormBg = false;
  loadLocation();
  loadWeather();
  loadAlerts();
  loadTicker();
  updateFooter();
}

function updateFooter() {
  const el = document.getElementById('footerTime');
  if (el) el.textContent = `Data: NWS · Open-Meteo · Updated ${new Date().toLocaleTimeString()}`;
}

/* ════════════════════════════════════════════════
   LOCATION
════════════════════════════════════════════════ */
async function loadLocation() {
  try {
    const res  = await safeFetch(`https://api.weather.gov/points/${appLat.toFixed(4)},${appLon.toFixed(4)}`, { key:'location', timeout:8000 });
    const data = await res.json();
    const props = data.properties;
    const city  = props.relativeLocation?.properties?.city  || '';
    const state = props.relativeLocation?.properties?.state || '';
    const countyRes  = await safeFetch(props.county, { key:'county', timeout:6000 });
    const countyData = await countyRes.json();
    userCounty = countyData.properties?.name || '';
    const el = document.getElementById('locationCard');
    if (el) el.innerHTML =
      `<b>${userCounty || 'Unknown'} County</b><span>${city}${city&&state?', ':''}${state}</span>`;
  } catch(e) {
    if (e.name === 'AbortError') return;
    console.warn('Location fetch failed:', e);
    const el = document.getElementById('locationCard');
    if (el) el.textContent = 'Location unavailable';
  }
}

/* ════════════════════════════════════════════════
   WEATHER
════════════════════════════════════════════════ */
let weatherFetchInProgress = false;
async function loadWeather() {
  if (weatherFetchInProgress) return;
  weatherFetchInProgress = true;
  try {
    updateDayNight();
    const url = [
      `https://api.open-meteo.com/v1/forecast?`,
      `latitude=${appLat}&longitude=${appLon}`,
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,`,
      `dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,weather_code`,
      `&hourly=cape,lifted_index`,
      `&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=1&timezone=auto`,
    ].join('');
    const res = await safeFetch(url, { key:'weather', timeout:10000 });
    const d   = await res.json();
    const c   = d.current;

    const tempF   = Math.round(c.temperature_2m);
    const feelsF  = Math.round(c.apparent_temperature);
    const hum     = Math.round(c.relative_humidity_2m);
    const dewF    = Math.round(c.dew_point_2m);
    const windSpd = Math.round(c.wind_speed_10m);
    const windG   = Math.round(c.wind_gusts_10m);
    const windDeg = c.wind_direction_10m;
    const pressHpa= Math.round(c.surface_pressure);
    const wcode   = c.weather_code || 0;

    const hourIdx = new Date().getHours();
    const cape = Math.max(0, d.hourly.cape?.[hourIdx] ?? 0);
    const li   = d.hourly.lifted_index?.[hourIdx] ?? 5;

    const tc = tempClass(tempF);
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

    setHTML('temp', `<span class="${tc}">${tempF}°F</span>`);
    setEl('tempSub', feelsF !== tempF ? `Feels ${feelsF}°F` : '');
    setEl('feels', `${feelsF}°F`);
    setEl('pressure', `${pressHpa} mb`);

    const hl = humLabel(hum);
    setEl('humidity', hum+'%');
    setEl('humSub', hl.feel);
    setEl('moistureLevel', hl.level);
    setEl('humidityFeel', hl.feel);

    setHTML('dew', `<span class="${tc}">${dewF}°F</span>`);
    setEl('dewSub', dewLabel(dewF).replace(/^[🟢🟠🔴🟡]\s/,''));
    setEl('stormFuel', dewLabel(dewF));
    setEl('wind', windSpd+' mph');
    setEl('windSub', degToCompass(windDeg));
    setEl('windDir', `${degToCompass(windDeg)} (${windDeg}°)`);
    setEl('gusts', windG+' mph');

    const cl = capeLabel(cape);
    setHTML('cape', `<span style="color:${cl.color}">${Math.round(cape)} J/kg — ${cl.txt}</span>`);
    setEl('instability', liLabel(li));
    setEl('sndMoisture', dewLabel(dewF));
    setEl('sndLift', li<=0?`⬆ Active lift (LI ${li.toFixed(1)})`:` ⬇ Capping (LI +${li.toFixed(1)})`);
    setEl('sndWind', windEnergyLabel(windSpd));

    const torEnv = computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressHpa);
    setEl('sndShear',
      torEnv==='high'     ? '🔴 Strong backing winds — favorable rotation' :
      torEnv==='moderate' ? '🟠 Some backing — moderate shear' :
                            '🟢 Limited organized shear');

    let torRiskTxt, sevRiskTxt;
    if      (li<=-6&&cape>2000)  { torRiskTxt='🔴 High'; sevRiskTxt='🔴 High'; }
    else if (li<=-5&&cape>1500)  { torRiskTxt='🟠 Moderate–High'; sevRiskTxt='🔴 High'; }
    else if (li<=-4&&cape>1000)  { torRiskTxt='🟠 Moderate'; sevRiskTxt='🔴 High'; }
    else if (li<=-3&&cape>500)   { torRiskTxt='🟡 Low–Moderate'; sevRiskTxt='🟠 Moderate'; }
    else if (li<=-2&&cape>200)   { torRiskTxt='🟡 Marginal'; sevRiskTxt='🟡 Low'; }
    else if (li<=0)              { torRiskTxt='🟢 Low'; sevRiskTxt='🟡 Marginal'; }
    else                         { torRiskTxt='🟢 Minimal'; sevRiskTxt='🟢 Minimal'; }
    setEl('torRisk', torRiskTxt);
    setEl('sevRisk', sevRiskTxt);

    let capeExplain;
    if      (cape>2500) capeExplain='⚠ Extreme instability: explosive storm development possible.';
    else if (cape>1500) capeExplain='⚠ Significant instability: organized severe storms possible.';
    else if (cape>500)  capeExplain='Moderate instability: storms possible if triggered.';
    else if (cape>100)  capeExplain='Weak instability: only isolated storms.';
    else                 capeExplain='Very little instability: storm development unlikely.';
    setEl('capeWhy',
      `CAPE: ${Math.round(cape)} J/kg · LI: ${li.toFixed(1)} · Dew: ${dewF}°F · Wind: ${windSpd} mph\n${capeExplain}`);

    const hasActiveTornadoAlert = forceStormBg && forceStormType === 'tornado';
    const mode = weatherCodeToMode(wcode, cape, li, windSpd, dewF, windDeg, pressHpa, hasActiveTornadoAlert);
    if (mode !== lastBgMode) { window.setBgMode(mode); lastBgMode = mode; }
    updateDayNight();

    const soundingRisk = computeWeatherRisk(li, cape, dewF, windSpd, windDeg, pressHpa);
    if (riskOrder[soundingRisk] > riskOrder[lastRisk]) {
      const why = soundingRisk==='high'
        ? `Strong instability (LI ${li.toFixed(1)}) with ${Math.round(cape)} J/kg CAPE — organized severe weather possible.`
        : 'Elevated instability with moisture — watch conditions possible.';
      setRiskDisplay(soundingRisk, undefined, why);
    } else if (lastRisk === 'low') {
      setRiskDisplay('low', undefined, 'No significant atmospheric threat detected.');
    }

  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Weather error:', e);
    const el = document.getElementById('temp');
    if (el) el.textContent = 'N/A';
  } finally {
    weatherFetchInProgress = false;
  }
}

/* ════════════════════════════════════════════════
   ALERTS — with persistent dismissal check
════════════════════════════════════════════════ */
let alertsFetchInProgress = false;
async function loadAlerts() {
  if (alertsFetchInProgress) return;
  alertsFetchInProgress = true;
  try {
    const res = await safeFetch(
      `https://api.weather.gov/alerts/active?point=${appLat.toFixed(4)},${appLon.toFixed(4)}`,
      { key:'alerts', timeout:10000, retries:2 }
    );
    const data = await res.json();

    const deduped = deduplicateAlerts(data.features || []);
    activeAlertFeatures = sortAlerts(deduped);

    markRefreshSuccess();

    const hasTornadoWarn = activeAlertFeatures.some(a => isTornadoLevel(a.properties?.event || ''));
    if (hasTornadoWarn) {
      forceStormBg = true; forceStormType = 'tornado';
      if (lastBgMode !== 'tornado') { window.setBgMode('tornado'); lastBgMode = 'tornado'; }
    } else {
      forceStormBg = false; forceStormType = '';
    }

    let alertRisk = 'low', alertRiskLabel = '', alertRiskWhy = '';
    let needsSiren  = false;
    let popupShown  = false;

    let spatialAlert = null;
    for (const a of activeAlertFeatures) {
      const score = alertPriorityScore(a.properties?.event || '');
      if (score <= 6) { spatialAlert = a; break; }
    }

    let lastSectionLabel = '';
    let html = '';

    for (let idx = 0; idx < activeAlertFeatures.length; idx++) {
      const a        = activeAlertFeatures[idx];
      const ev       = a.properties?.event       || '';
      const desc     = a.properties?.description  || '';
      const inst     = a.properties?.instruction  || '';
      const areaDesc = a.properties?.areaDesc     || '';
      const score    = alertPriorityScore(ev);
      const cls      = alertCssClass(ev);
      const movement = parseMovement(desc);
      const uid      = alertStableId(a);

      if (score <= 6 && alertRisk !== 'high') {
        alertRisk = 'high'; alertRiskLabel = 'HIGH';
        alertRiskWhy =
          isTornadoLevel(ev)         ? 'Tornado Warning in effect.' :
          ev.includes('Flash Flood') ? 'Flash Flood Warning in effect.' :
                                       'Severe Warning in effect.';
      } else if (score <= 9 && alertRisk === 'low') {
        alertRisk = 'medium'; alertRiskLabel = 'ELEVATED';
        alertRiskWhy = 'Watch in effect — conditions favorable for severe weather.';
      } else if (alertRisk === 'low') {
        alertRisk = 'medium'; alertRiskLabel = 'ELEVATED';
        alertRiskWhy = 'Advisory or statement in effect.';
      }

      const inMyCounty = countyMatchesArea(userCounty, areaDesc);
      if (inMyCounty && isTornadoLevel(ev)) needsSiren = true;

      // Only show popup if:
      // 1. Not already shown this session (shownAlertsSet)
      // 2. Not explicitly dismissed by user (dismissedSet)
      // 3. Has a popup config
      if (!popupShown && !hasShownAlert(uid) && !isDismissed(uid) && getPopupConfig(ev)) {
        addShownAlert(uid);
        showPopup(ev, movement, uid);
        popupShown = true;
      }

      const sLabel = alertSectionLabel(score);
      if (sLabel !== lastSectionLabel) {
        html += `<div class="alert-section-header">${sLabel}</div>`;
        lastSectionLabel = sLabel;
      }

      const areas = areaDesc.split(';').slice(0,3).map(s=>s.trim()).filter(Boolean);
      const areaLinks = areas.map(area =>
        `<span class="area-link" onclick="jumpToLocation('${area.replace(/'/g,"\\'")}')">📍 ${area}</span>`
      ).join(' · ');

      const movText = movement
        ? `<div class="alert-movement">📍 Moving ${movement.dir} at ${movement.spd} mph</div>` : '';

      const shortDesc = desc.replace(/\*/g,'').replace(/\n\n/g,'<br><br>').replace(/\n/g,' ');
      const shortInst = inst ? `<div class="alert-instruction">${inst.replace(/\n/g,'<br>')}</div>` : '';

      // Dismissed alerts get a subtle visual indicator
      const dismissedClass = isDismissed(uid) ? ' alert-dismissed' : '';

      html += `
        <div class="alert-card ${cls}${dismissedClass} card-expandable" onclick="toggleExpand(this)" role="button" tabindex="0" aria-expanded="false">
          <div class="alert-card-header">
            <div>
              <span class="alert-title">${ev}</span>
              <span class="alert-meta">${areaLinks}</span>
              ${movText}
            </div>
            <span class="alert-chevron">▼</span>
          </div>
          <div class="expand-details">
            <div class="alert-detail-text">${shortDesc}</div>
            ${shortInst}
          </div>
        </div>`;
    }

    const alertsEl = document.getElementById('alertsContainer');
    if (alertsEl) {
      alertsEl.innerHTML = html ||
        '<div style="color:#2a7a5a;padding:16px 0;font-size:14px;text-align:left">✓ No active alerts for this location</div>';
    }

    const spatialCard = document.getElementById('spatialCard');
    if (spatialCard) {
      if (spatialAlert) {
        const dist = alertCentroidDistance(spatialAlert);
        const mov  = parseMovement(spatialAlert.properties?.description || '');
        const setEl = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
        setEl('spNearestAlert', spatialAlert.properties?.event || '');
        setEl('spDirection', dist < 9999 ? `~${Math.round(dist)} miles away` : 'Unknown');
        setEl('spMovement', mov ? `${mov.dir} at ${mov.spd} mph` : 'Not reported');
        spatialCard.classList.add('visible');
      } else {
        spatialCard.classList.remove('visible');
      }
    }

    if (needsSiren && !sirenActive)   startSiren();
    else if (!needsSiren && sirenActive) stopSiren();

    if (activeAlertFeatures.length > 0 && riskOrder[alertRisk] >= riskOrder[lastRisk]) {
      setRiskDisplay(alertRisk, alertRiskLabel, alertRiskWhy);
    }

    if (activeAlertFeatures.length > 0) {
      const topEv = activeAlertFeatures[0]?.properties?.event || '';
      if (topEv) announceAlert(`Active alert: ${topEv}`);
    }

  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Alerts error:', e);
    const el = document.getElementById('alertsContainer');
    if (el) el.textContent = 'Failed to load alerts.';
    checkStaleData();
  } finally {
    alertsFetchInProgress = false;
  }
}

/* ════════════════════════════════════════════════
   TICKER
════════════════════════════════════════════════ */
const tickerOverflowByGroup = {};
let currentOverflowGroup    = null;

function positionOverflowPortal() {
  const wrap   = document.getElementById('tickerWrap');
  const portal = document.getElementById('tickerOverflowPortal');
  if (!wrap || !portal) return;
  const rect   = wrap.getBoundingClientRect();
  // Position dropdown just below the ticker bar
  portal.style.top  = `${rect.bottom}px`;
}

function openTickerOverflow(groupKey, event) {
  event.stopPropagation();
  const portal  = document.getElementById('tickerOverflowPortal');
  const innerEl = document.getElementById('tickerOverflowInner');
  if (!portal || !innerEl) return;
  const items   = tickerOverflowByGroup[groupKey];

  if (currentOverflowGroup === groupKey && portal.classList.contains('open')) {
    portal.classList.remove('open');
    currentOverflowGroup = null;
    return;
  }
  if (!items || items.length === 0) return;

  // Position before opening
  positionOverflowPortal();

  const groupDef = TICKER_GROUPS.find(g => g.key === groupKey);
  const list = items.map(({ ev, area }) => {
    const cleanArea = area.split(';').slice(0,3).map(s=>s.trim()).filter(Boolean).join(' · ');
    return `<div class="ticker-overflow-item" onclick="jumpToLocation('${area.split(';')[0].trim().replace(/'/g,"\\'")}')">
      <span class="oi-ev">${ev}</span>
      <span class="oi-area">📍 ${cleanArea}</span>
    </div>`;
  }).join('');

  innerEl.innerHTML = `<div class="ticker-overflow-title">${groupDef?.label||''} — All Alerts (${items.length})</div>${list}`;
  currentOverflowGroup = groupKey;
  portal.classList.add('open');
}

function closeTickerOverflow() {
  const portal = document.getElementById('tickerOverflowPortal');
  if (portal) portal.classList.remove('open');
  currentOverflowGroup = null;
}

document.addEventListener('click', e => {
  if (!e.target.closest('#tickerWrap') && !e.target.closest('#tickerOverflowPortal')) {
    closeTickerOverflow();
  }
});
window.addEventListener('scroll',  positionOverflowPortal, { passive: true });
window.addEventListener('resize',  positionOverflowPortal, { passive: true });

const TICKER_RELEVANT_EVENTS = new Set([
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Flash Flood Warning',
  'Flash Flood Watch',
  'Flash Flood Emergency',
  'Blizzard Warning',
  'Winter Storm Warning',
  'Ice Storm Warning',
  'Winter Storm Watch',
  'Winter Weather Advisory',
  'Particularly Dangerous Situation',
  'Tornado Emergency',
]);

function isTickerRelevant(ev) {
  if (!ev) return false;
  for (const t of TICKER_RELEVANT_EVENTS) {
    if (ev.includes(t)) return true;
  }
  return false;
}

let tickerFetchInProgress = false;
async function loadTicker() {
  if (tickerFetchInProgress) return;
  tickerFetchInProgress = true;

  const scrollEl = document.getElementById('tickerScroll');
  if (!scrollEl) { tickerFetchInProgress = false; return; }

  try {
    const res  = await safeFetch(TICKER_API_URL, { key:'ticker', timeout:15000, retries:2 });
    const data = await res.json();

    if (!data || !data.features) {
      scrollEl.innerHTML = '<div class="ticker-none">✓ No major severe weather alerts nationwide</div>';
      return;
    }

    const relevant = (data.features || []).filter(a => isTickerRelevant(a.properties?.event || ''));
    const deduped  = deduplicateAlerts(relevant);
    const features = sortAlerts(deduped);

    if (features.length === 0) {
      scrollEl.innerHTML = '<div class="ticker-none">✓ No major severe weather alerts nationwide</div>';
      return;
    }

    const buckets = {};
    TICKER_GROUPS.forEach(g => { buckets[g.key] = []; });
    features.forEach(a => {
      const ev   = a.properties?.event    || '';
      const area = a.properties?.areaDesc || '';
      for (const g of TICKER_GROUPS) {
        if (g.match(ev)) { buckets[g.key].push({ ev, area }); break; }
      }
    });
    TICKER_GROUPS.forEach(g => { tickerOverflowByGroup[g.key] = buckets[g.key] || []; });

    const MAX_INLINE = 3;
    let groupsHTML = '';
    TICKER_GROUPS.forEach(g => {
      const items = buckets[g.key];
      if (!items || items.length === 0) return;
      const inline   = items.slice(0, MAX_INLINE);
      const overflow = items.length - MAX_INLINE;

      groupsHTML += `<div class="ticker-group ${g.cls}">`;
      groupsHTML += `<span class="ticker-group-label">${g.label} <span class="ticker-group-count">${items.length}</span></span>`;
      inline.forEach(({ ev, area }) => {
        const parts = area.split(';')[0].split(',').slice(0,2).join(',').trim();
        const label = parts.length > 34 ? parts.slice(0,32)+'…' : parts;
        groupsHTML += `<span class="ticker-item" onclick="jumpToLocation('${parts.replace(/'/g,"\\'")}')">📍 ${label}</span>`;
      });
      if (overflow > 0) {
        groupsHTML += `<span class="ticker-more" onclick="openTickerOverflow('${g.key}',event)" role="button" tabindex="0" aria-label="Show ${overflow} more ${g.label} alerts">+${overflow} more ▼</span>`;
      }
      groupsHTML += `</div>`;
    });

    scrollEl.innerHTML = groupsHTML || '<div class="ticker-none">✓ No major alerts</div>';

    scrollEl.querySelectorAll('.ticker-more').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key==='Enter'||e.key===' ') { e.preventDefault(); el.click(); }
      });
    });

    // Position the portal after rendering (ticker's position may shift)
    requestAnimationFrame(positionOverflowPortal);

  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Ticker error:', e);
    if (scrollEl) scrollEl.innerHTML = '<div class="ticker-none" style="color:#ff6060">⚠ Ticker unavailable</div>';
  } finally {
    tickerFetchInProgress = false;
  }
}

/* ════════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════════ */
let searchDebounce;
const searchInput   = document.getElementById('searchInput');
const suggestionsEl = document.getElementById('searchSuggestions');

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      if (suggestionsEl) { suggestionsEl.innerHTML = ''; suggestionsEl.style.display = 'none'; }
      return;
    }
    searchDebounce = setTimeout(async () => {
      if (searchCache.has(q)) { renderSuggestions(searchCache.get(q)); return; }
      try {
        const res  = await safeFetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=20&addressdetails=1`,
          { key:'search', timeout:6000 }
        );
        const data = await res.json();
        addSearchCache(q, data);
        renderSuggestions(data);
      } catch(e) {
        if (e.name !== 'AbortError') console.warn('Search error:', e);
      }
    }, 280);
  });
}

function renderSuggestions(data) {
  if (!suggestionsEl) return;
  suggestionsEl.innerHTML = '';
  if (!data || data.length === 0) { suggestionsEl.style.display='none'; return; }
  suggestionsEl.style.display = 'block';
  const frag = document.createDocumentFragment();
  data.slice(0,8).forEach(p => {
    if (!p.lat || !p.lon) return;
    const div = document.createElement('div');
    div.textContent = p.display_name;
    div.setAttribute('role','option');
    div.setAttribute('tabindex','0');
    const pick = () => {
      appLat = parseFloat(p.lat);
      appLon = parseFloat(p.lon);
      if (searchInput) searchInput.value = p.display_name;
      suggestionsEl.innerHTML = '';
      suggestionsEl.style.display = 'none';
      loadAll();
    };
    div.addEventListener('click', pick);
    div.addEventListener('keydown', e => { if(e.key==='Enter') pick(); });
    frag.appendChild(div);
  });
  suggestionsEl.appendChild(frag);
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap') && suggestionsEl) {
    suggestionsEl.innerHTML = '';
    suggestionsEl.style.display = 'none';
  }
});

/* ════════════════════════════════════════════════
   REFRESH INTERVALS
════════════════════════════════════════════════ */
function jitteredInterval(fn, baseMs, jitterMs) {
  const tick = () => {
    fn();
    const next = baseMs + Math.random() * jitterMs;
    setTimeout(tick, next);
  };
  setTimeout(tick, baseMs + Math.random() * jitterMs);
}

jitteredInterval(() => { loadAlerts(); updateFooter(); checkStaleData(); },  15_000,  3_000);
jitteredInterval(() => { loadWeather(); },                                   300_000, 30_000);
jitteredInterval(() => { loadTicker(); },                                     30_000,  5_000);
jitteredInterval(() => { updateDayNight(); },                                600_000, 60_000);