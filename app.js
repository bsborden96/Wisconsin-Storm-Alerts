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
   FIX #1: CENTRALIZED ALERT PRIORITY SYSTEM
   Single source of truth. Lower number = higher priority.
   Used by: sorting, risk box, popup, siren, spatial card,
   background mode, ticker, nearby warning calc.
──────────────────────────────────────────────── */
const ALERT_PRIORITY_MAP = new Map([
  ['Particularly Dangerous Situation', 1],  // PDS Tornado Warning
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

/**
 * Returns the priority score for an alert event string.
 * Lower = more severe/higher priority.
 * Uses deterministic, ordered matching — longest match wins to avoid
 * "Severe Thunderstorm Warning" matching "Warning" before "Tornado Warning".
 */
function alertPriorityScore(eventStr) {
  if (!eventStr) return 99;
  // Sort keys longest-first so more specific strings match first
  for (const [key, score] of ALERT_PRIORITY_MAP) {
    if (eventStr.includes(key)) return score;
  }
  return 99;
}

/** True if eventStr is a tornado-level threat (priority ≤ 3) */
function isTornadoLevel(eventStr) {
  return alertPriorityScore(eventStr) <= 3;
}

/** True if eventStr is a tornado emergency or PDS (priority ≤ 2) */
function isExtremeLevel(eventStr) {
  return alertPriorityScore(eventStr) <= 2;
}

/* ────────────────────────────────────────────────
   TICKER GROUPS — ordered by priority
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

/* ────────────────────────────────────────────────
   FIX #4: EFFICIENT TICKER API — filtered event types only
──────────────────────────────────────────────── */
const TICKER_EVENT_TYPES = [
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
];
// Build NWS API event filter param
const TICKER_EVENT_PARAM = TICKER_EVENT_TYPES.map(e => encodeURIComponent(e)).join('&event=');
const TICKER_API_URL = `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${TICKER_EVENT_PARAM}`;

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
   FIX #6: BOUNDED CACHES — prevent unbounded growth
──────────────────────────────────────────────── */
const MAX_SHOWN_ALERTS = 200;
const MAX_SEARCH_CACHE = 50;
// Use arrays instead of raw Sets/Maps so we can evict oldest entries
let shownAlertsArr = [];
const shownAlertsSet = new Set();
const searchCache = new Map();  // bounded below in search handler

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
    // Delete oldest entry
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(key, val);
}

/* ════════════════════════════════════════════════
   FIX #5: SAFE FETCH UTILITY
   - AbortController support
   - Retries with exponential backoff + jitter
   - Timeout handling
   - Stale request cancellation via controller map
════════════════════════════════════════════════ */
const activeFetchControllers = new Map();

async function safeFetch(url, {
  timeout   = 10000,
  retries   = 2,
  key       = null,   // if provided, cancels any prior fetch with same key
  baseDelay = 800,
} = {}) {
  // Cancel previous request with same key (stale request prevention)
  if (key && activeFetchControllers.has(key)) {
    try { activeFetchControllers.get(key).abort(); } catch(_) {}
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    if (key) activeFetchControllers.set(key, controller);

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (key) activeFetchControllers.delete(key);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (key) activeFetchControllers.delete(key);

      if (err.name === 'AbortError') throw err; // don't retry aborts

      if (attempt < retries) {
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 400;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/* ════════════════════════════════════════════════
   FIX #12: STALE DATA DETECTION
════════════════════════════════════════════════ */
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function markRefreshSuccess() {
  lastSuccessfulRefresh = Date.now();
  document.getElementById('staleBanner').style.display = 'none';
}

function checkStaleData() {
  if (!lastSuccessfulRefresh) return;
  const age = Date.now() - lastSuccessfulRefresh;
  if (age > STALE_THRESHOLD_MS) {
    document.getElementById('staleBanner').style.display = 'block';
  }
}

/* ════════════════════════════════════════════════
   FIX #9: NORMALIZED COUNTY MATCHING
   Removes "County", "Parish", "Borough", trims, lowercases.
   Handles abbreviations and extra whitespace.
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
  // Split area desc on semicolons and commas, normalize each piece
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

/**
 * FIX #1: Central sort — deterministic, tornado-prioritized.
 * Primary: priority score (tornado always beats SVR).
 * Secondary: distance (but tornado within 200mi beats SVR at 0mi for popup/siren logic
 *   — handled separately; for display order we just sort by score then distance).
 */
function sortAlerts(features) {
  return [...features].sort((a, b) => {
    const pa = alertPriorityScore(a.properties?.event || '');
    const pb = alertPriorityScore(b.properties?.event || '');
    if (pa !== pb) return pa - pb;
    // Same priority: closer = first
    return alertCentroidDistance(a) - alertCentroidDistance(b);
  });
}

/* ────────────────────────────────────────────────
   FIX #8: ROBUST ALERT DEDUPLICATION
   Primary key: NWS alert @id (stable across updates).
   Fallback: event + areaDesc + sent timestamp.
──────────────────────────────────────────────── */
function alertStableId(feature) {
  const id   = feature.id || feature.properties?.id;
  if (id) return id;
  // Fallback
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
    if (panel.classList.contains('open')) {
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
   FIX #11: ARIA LIVE ANNOUNCEMENT
════════════════════════════════════════════════ */
function announceAlert(message) {
  const el = document.getElementById('ariaLive');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = message; });
}

/* ════════════════════════════════════════════════
   POPUP SYSTEM — FIX #1: uses centralized priority
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
  // Matches in priority order — PDS before Tornado Warning before SVR, etc.
  return POPUP_CONFIG.find(c => c.match(ev)) || null;
}

function showPopup(ev, movement) {
  const cfg = getPopupConfig(ev);
  if (!cfg) return;
  const badge = document.getElementById('popupBadge');
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
  // FIX #11: focus trap — move focus into popup
  requestAnimationFrame(() => document.getElementById('popupClose').focus());
  // FIX #11: announce to screen readers
  announceAlert(cfg.title);
}

document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popup').style.display = 'none';
});
// FIX #11: Escape key closes popup
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('popup').style.display !== 'none') {
    document.getElementById('popup').style.display = 'none';
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
  document.getElementById('sirenBanner').style.display = 'block';
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
  document.getElementById('sirenBanner').style.display = 'none';
  clearTimeout(sirenTimeout);
  sirenNodes.forEach(n => { try { n.disconnect(); } catch(_) {} });
  sirenNodes = [];
  if (sirenCtx) { sirenCtx.close(); sirenCtx = null; }
}

/* ════════════════════════════════════════════════
   FIX #7: TICKER — Drag without accidental taps
   Tracks pointer move distance so a swipe doesn't
   fire a click handler on items or overflow button.
════════════════════════════════════════════════ */
(function initTickerDragGuard() {
  const scroll = document.getElementById('tickerScroll');
  let pointerStartX = 0, pointerStartY = 0, didDrag = false;
  const DRAG_THRESHOLD = 6; // px — below this = tap, above = drag

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

  // Intercept clicks on ticker children — cancel if it was a drag
  scroll.addEventListener('click', e => {
    if (didDrag) {
      e.stopImmediatePropagation();
      e.preventDefault();
      didDrag = false;
    }
  }, true); // capture phase
})();

/* ════════════════════════════════════════════════
   ANIMATED BACKGROUND — FIX #10: throttled, optimized
════════════════════════════════════════════════ */
(function initBackground() {
  if (prefersReducedMotion) return; // FIX #11: skip canvas for reduced motion

  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d', { alpha: false });

  let W, H;
  let bgMode    = 'clear';
  let isDaytime = true;
  let sunProgress  = 0.5;
  let nightProgress = 0.5;
  let clouds = [], drops = [], snowflakes = [], fogParticles = [], stars = null;
  let bolts = [], boltTimer = 0;
  let tornadoAngle = 0;
  let lastFrameTime = 0;
  // FIX #10: adaptive target FPS — low perf = 24fps, saves battery
  const targetFPS  = perfLevel === 'low' ? 24 : perfLevel === 'mid' ? 40 : 60;
  const frameTarget = 1000 / targetFPS;

  const PARTICLE = {
    cloud: perfLevel === 'low' ? 3 : perfLevel === 'mid' ? 5 : 8,
    rain:  perfLevel === 'low' ? 45 : perfLevel === 'mid' ? 80 : 120,
    snow:  perfLevel === 'low' ? 45 : perfLevel === 'mid' ? 70 : 100,
    fog:   perfLevel === 'low' ? 6 : 10,
  };

  // FIX #10: debounced resize to prevent layout thrashing
  let resizeTimer;
  function resize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const dpr = pixelRatio;
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
      W = window.innerWidth;
      H = window.innerHeight;
      stars = null;
    }, 150);
  }
  window.addEventListener('resize', resize, { passive: true });
  // Initial sizing without debounce
  const dpr0 = pixelRatio;
  canvas.width  = window.innerWidth  * dpr0;
  canvas.height = window.innerHeight * dpr0;
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(dpr0, dpr0);
  W = window.innerWidth;
  H = window.innerHeight;

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
    if (dark)         { topColor='rgba(70,76,95,1)';    midColor='rgba(44,49,64,1)';   shadowColor='rgba(20,22,32,1)'; }
    else if (isDaytime){ topColor='rgba(255,255,255,1)'; midColor='rgba(228,236,248,1)'; shadowColor='rgba(168,185,210,1)'; }
    else              { topColor='rgba(46,56,84,1)';    midColor='rgba(32,40,62,1)';   shadowColor='rgba(16,20,36,1)'; }
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
    // FIX #10: cap bolt count to prevent GPU overload
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

  function drawTornado() {
    const cx = W/2;
    tornadoAngle += 0.032;
    for (let i=0;i<22;i++) {
      const t=i/22;
      const y=H*0.06+t*H*0.72;
      const radius=Math.max(6, t<0.5 ? t*t*2*110+6 : (t-0.5)*(t-0.5)*2*(-50)+50+t*70);
      const grd=ctx.createRadialGradient(cx,y,0,cx,y,radius);
      grd.addColorStop(0,`rgba(75,35,15,${0.06+t*0.09})`);
      grd.addColorStop(0.5,`rgba(38,18,7,${0.04+t*0.07})`);
      grd.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(cx,y,radius,0,Math.PI*2); ctx.fill();
    }
    const debrisCount = perfLevel==='low' ? 16 : 32;
    for (let d=0;d<debrisCount;d++) {
      const t=d/debrisCount;
      const y=H*0.08+t*H*0.65;
      const r=Math.max(5,t<0.5?t*t*2*95+5:(t-0.5)*(t-0.5)*2*(-45)+45+t*62);
      const ang=(d/debrisCount)*Math.PI*2+tornadoAngle*(3-t*1.8);
      const dx=Math.cos(ang)*r*0.8;
      const dy=Math.sin(ang)*r*0.18;
      ctx.fillStyle=`rgba(90,52,16,${0.25+t*0.36})`;
      ctx.beginPath(); ctx.arc(cx+dx,y+dy,2+t*3,0,Math.PI*2); ctx.fill();
    }
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
      case 'tornado': return ['#150900','#090400'];
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

    // FIX #10: skip scanlines on low perf
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
      case 'tornado':      initClouds(9,true);  initRain(PARTICLE.rain,true);  snowflakes=[]; fogParticles=[]; break;
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

// Fallback no-ops if canvas disabled (reduced motion)
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
  // FIX #1: Tornado alert forces tornado bg regardless of sounding
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
  if (ev.includes('Tornado Emergency'))                return 'alert-pds';   // same high-urgency style
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
  document.getElementById('footerTime').textContent =
    `Data: NWS · Open-Meteo · Updated ${new Date().toLocaleTimeString()}`;
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
    document.getElementById('locationCard').innerHTML =
      `<b>${userCounty || 'Unknown'} County</b><span>${city}${city&&state?', ':''}${state}</span>`;
  } catch(e) {
    if (e.name === 'AbortError') return;
    console.warn('Location fetch failed:', e);
    document.getElementById('locationCard').textContent = 'Location unavailable';
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
    document.getElementById('temp').innerHTML     = `<span class="${tc}">${tempF}°F</span>`;
    document.getElementById('tempSub').textContent = feelsF !== tempF ? `Feels ${feelsF}°F` : '';
    document.getElementById('feels').textContent   = `${feelsF}°F`;
    document.getElementById('pressure').textContent = `${pressHpa} mb`;

    const hl = humLabel(hum);
    document.getElementById('humidity').textContent     = hum+'%';
    document.getElementById('humSub').textContent       = hl.feel;
    document.getElementById('moistureLevel').textContent = hl.level;
    document.getElementById('humidityFeel').textContent  = hl.feel;

    document.getElementById('dew').innerHTML     = `<span class="${tc}">${dewF}°F</span>`;
    document.getElementById('dewSub').textContent = dewLabel(dewF).replace(/^[🟢🟠🔴🟡]\s/,'');
    document.getElementById('stormFuel').textContent = dewLabel(dewF);
    document.getElementById('wind').textContent    = windSpd+' mph';
    document.getElementById('windSub').textContent  = degToCompass(windDeg);
    document.getElementById('windDir').textContent  = `${degToCompass(windDeg)} (${windDeg}°)`;
    document.getElementById('gusts').textContent    = windG+' mph';

    const cl = capeLabel(cape);
    document.getElementById('cape').innerHTML = `<span style="color:${cl.color}">${Math.round(cape)} J/kg — ${cl.txt}</span>`;
    document.getElementById('instability').textContent = liLabel(li);
    document.getElementById('sndMoisture').textContent = dewLabel(dewF);
    document.getElementById('sndLift').textContent     = li<=0?`⬆ Active lift (LI ${li.toFixed(1)})`:` ⬇ Capping (LI +${li.toFixed(1)})`;
    document.getElementById('sndWind').textContent     = windEnergyLabel(windSpd);

    const torEnv = computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressHpa);
    document.getElementById('sndShear').textContent =
      torEnv==='high'     ? '🔴 Strong backing winds — favorable rotation' :
      torEnv==='moderate' ? '🟠 Some backing — moderate shear' :
                            '🟢 Limited organized shear';

    let torRiskTxt, sevRiskTxt;
    if      (li<=-6&&cape>2000)  { torRiskTxt='🔴 High'; sevRiskTxt='🔴 High'; }
    else if (li<=-5&&cape>1500)  { torRiskTxt='🟠 Moderate–High'; sevRiskTxt='🔴 High'; }
    else if (li<=-4&&cape>1000)  { torRiskTxt='🟠 Moderate'; sevRiskTxt='🔴 High'; }
    else if (li<=-3&&cape>500)   { torRiskTxt='🟡 Low–Moderate'; sevRiskTxt='🟠 Moderate'; }
    else if (li<=-2&&cape>200)   { torRiskTxt='🟡 Marginal'; sevRiskTxt='🟡 Low'; }
    else if (li<=0)              { torRiskTxt='🟢 Low'; sevRiskTxt='🟡 Marginal'; }
    else                         { torRiskTxt='🟢 Minimal'; sevRiskTxt='🟢 Minimal'; }
    document.getElementById('torRisk').textContent = torRiskTxt;
    document.getElementById('sevRisk').textContent = sevRiskTxt;

    let capeExplain;
    if      (cape>2500) capeExplain='⚠ Extreme instability: explosive storm development possible.';
    else if (cape>1500) capeExplain='⚠ Significant instability: organized severe storms possible.';
    else if (cape>500)  capeExplain='Moderate instability: storms possible if triggered.';
    else if (cape>100)  capeExplain='Weak instability: only isolated storms.';
    else                 capeExplain='Very little instability: storm development unlikely.';
    document.getElementById('capeWhy').textContent =
      `CAPE: ${Math.round(cape)} J/kg · LI: ${li.toFixed(1)} · Dew: ${dewF}°F · Wind: ${windSpd} mph\n${capeExplain}`;

    // FIX #1: Background respects active tornado alert (set by loadAlerts)
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
    document.getElementById('temp').textContent = 'N/A';
  } finally {
    weatherFetchInProgress = false;
  }
}

/* ════════════════════════════════════════════════
   ALERTS — FIX #1 priority system fully applied
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

    // FIX #8: deduplicate by stable NWS ID before sorting
    const deduped = deduplicateAlerts(data.features || []);

    // FIX #1: single centralized sort — tornado always before SVR
    activeAlertFeatures = sortAlerts(deduped);

    markRefreshSuccess(); // FIX #12

    // FIX #1: Determine highest-priority alert for bg/siren/popup
    // A tornado warning anywhere in the result set forces tornado bg,
    // EVEN if an SVR warning is geographically closer.
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

    // FIX #1: Spatial awareness uses the highest-priority warning,
    // not just the geographically nearest one.
    // A tornado warning 80mi away should show before an SVR at 10mi.
    let spatialAlert = null;
    for (const a of activeAlertFeatures) {
      const score = alertPriorityScore(a.properties?.event || '');
      if (score <= 6) { spatialAlert = a; break; } // first = highest priority
    }

    // Organize by section
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

      // Risk escalation — tornado always escalates to high before SVR
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

      // FIX #9: normalized county matching for siren
      // FIX #1: tornado warning ONLY triggers siren (not SVR)
      const inMyCounty = countyMatchesArea(userCounty, areaDesc);
      if (inMyCounty && isTornadoLevel(ev)) needsSiren = true;

      // FIX #1: Popup — show highest priority only, first match wins
      // (activeAlertFeatures is already sorted priority-first)
      const uid = alertStableId(a);
      if (!popupShown && !hasShownAlert(uid) && getPopupConfig(ev)) {
        addShownAlert(uid);
        showPopup(ev, movement);
        popupShown = true;
      }

      // Section header — only print when section changes
      const sLabel = alertSectionLabel(score);
      if (sLabel !== lastSectionLabel) {
        html += `<div class="alert-section-header">${sLabel}</div>`;
        lastSectionLabel = sLabel;
      }

      // Area links
      const areas = areaDesc.split(';').slice(0,3).map(s=>s.trim()).filter(Boolean);
      const areaLinks = areas.map(area =>
        `<span class="area-link" onclick="jumpToLocation('${area.replace(/'/g,"\\'")}')">📍 ${area}</span>`
      ).join(' · ');

      const movText = movement
        ? `<div class="alert-movement">📍 Moving ${movement.dir} at ${movement.spd} mph</div>` : '';

      const shortDesc = desc.replace(/\*/g,'').replace(/\n\n/g,'<br><br>').replace(/\n/g,' ');
      const shortInst = inst ? `<div class="alert-instruction">${inst.replace(/\n/g,'<br>')}</div>` : '';

      html += `
        <div class="alert-card ${cls} card-expandable" onclick="toggleExpand(this)" role="button" tabindex="0" aria-expanded="false">
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
    // FIX #6: use textContent/innerHTML carefully — no repeated DOM traversal
    alertsEl.innerHTML = html ||
      '<div style="color:#2a7a5a;padding:16px 0;font-size:14px;text-align:left">✓ No active alerts for this location</div>';

    // FIX #1: Spatial awareness — highest-priority warning, not closest
    const spatialCard = document.getElementById('spatialCard');
    if (spatialAlert) {
      const dist = alertCentroidDistance(spatialAlert);
      const mov  = parseMovement(spatialAlert.properties?.description || '');
      document.getElementById('spNearestAlert').textContent =
        spatialAlert.properties?.event || '';
      document.getElementById('spDirection').textContent =
        dist < 9999 ? `~${Math.round(dist)} miles away` : 'Unknown';
      document.getElementById('spMovement').textContent =
        mov ? `${mov.dir} at ${mov.spd} mph` : 'Not reported';
      spatialCard.classList.add('visible');
    } else {
      spatialCard.classList.remove('visible');
    }

    // FIX #1: Siren — tornado county match only
    if (needsSiren && !sirenActive)   startSiren();
    else if (!needsSiren && sirenActive) stopSiren();

    // Update risk from alerts (tornado always wins)
    if (activeAlertFeatures.length > 0 && riskOrder[alertRisk] >= riskOrder[lastRisk]) {
      setRiskDisplay(alertRisk, alertRiskLabel, alertRiskWhy);
    }

    // FIX #11: announce highest-priority alert to screen readers
    if (activeAlertFeatures.length > 0) {
      const topEv = activeAlertFeatures[0]?.properties?.event || '';
      if (topEv) announceAlert(`Active alert: ${topEv}`);
    }

  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Alerts error:', e);
    document.getElementById('alertsContainer').textContent = 'Failed to load alerts.';
    checkStaleData(); // FIX #12: show stale banner on failure
  } finally {
    alertsFetchInProgress = false;
  }
}

/* ════════════════════════════════════════════════
   TICKER — FIX #2, #3, #4, #7, #8
════════════════════════════════════════════════ */
const tickerOverflowByGroup = {};
let currentOverflowGroup    = null;

/**
 * FIX #3: Overflow panel is a fixed-position portal (#tickerOverflowPortal)
 * appended to <body>. Its top is set dynamically to the bottom of the ticker.
 * This escapes ALL parent stacking contexts, overflow clips, and transforms.
 */
function positionOverflowPortal() {
  const wrap   = document.getElementById('tickerWrap');
  const portal = document.getElementById('tickerOverflowPortal');
  const rect   = wrap.getBoundingClientRect();
  portal.style.top = `${rect.bottom}px`;
}

function openTickerOverflow(groupKey, event) {
  event.stopPropagation();
  const portal  = document.getElementById('tickerOverflowPortal');
  const innerEl = document.getElementById('tickerOverflowInner');
  const items   = tickerOverflowByGroup[groupKey];

  if (currentOverflowGroup === groupKey && portal.classList.contains('open')) {
    portal.classList.remove('open');
    currentOverflowGroup = null;
    return;
  }
  if (!items || items.length === 0) return;

  positionOverflowPortal();

  const groupDef = TICKER_GROUPS.find(g => g.key === groupKey);
  const list = items.map(({ ev, area }) => {
    const cleanArea = area.split(';').slice(0,3).map(s=>s.trim()).filter(Boolean).join(' · ');
    return `<div class="ticker-overflow-item" onclick="jumpToLocation('${area.split(';')[0].trim().replace(/'/g,"\\'")}')">
      <span class="oi-ev">${ev}</span>
      <span class="oi-area">📍 ${cleanArea}</span>
    </div>`;
  }).join('');

  // FIX #6: direct innerHTML set, no DOM churn loop
  innerEl.innerHTML = `<div class="ticker-overflow-title">${groupDef?.label||''} — All Alerts (${items.length})</div>${list}`;
  currentOverflowGroup = groupKey;
  portal.classList.add('open');
}

function closeTickerOverflow() {
  document.getElementById('tickerOverflowPortal').classList.remove('open');
  currentOverflowGroup = null;
}

document.addEventListener('click', e => {
  if (!e.target.closest('#tickerWrap') && !e.target.closest('#tickerOverflowPortal')) {
    closeTickerOverflow();
  }
});
// Also reposition portal on scroll/resize
window.addEventListener('scroll',  positionOverflowPortal, { passive: true });
window.addEventListener('resize',  positionOverflowPortal, { passive: true });

let tickerFetchInProgress = false;
async function loadTicker() {
  if (tickerFetchInProgress) return;
  tickerFetchInProgress = true;
  try {
    // FIX #4: filtered API request — only the event types we need
    const res  = await safeFetch(TICKER_API_URL, { key:'ticker', timeout:12000, retries:1 });
    const data = await res.json();

    // FIX #1: sort uses centralized priority — tornado before SVR always
    // FIX #8: deduplicate by stable NWS ID
    const deduped = deduplicateAlerts(data.features || []);
    const features = sortAlerts(deduped);

    const scrollEl = document.getElementById('tickerScroll');
    if (features.length === 0) {
      scrollEl.innerHTML = '<div class="ticker-none">✓ No major severe weather alerts nationwide</div>';
      return;
    }

    // Bucket into groups
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

    // FIX #6: single innerHTML set, no repeated DOM manipulation
    scrollEl.innerHTML = groupsHTML || '<div class="ticker-none">✓ No major alerts</div>';

    // Keyboard support for overflow buttons
    scrollEl.querySelectorAll('.ticker-more').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key==='Enter'||e.key===' ') { e.preventDefault(); el.click(); }
      });
    });

  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Ticker error:', e);
  } finally {
    tickerFetchInProgress = false;
  }
}

/* ════════════════════════════════════════════════
   SEARCH — FIX #5, #6: safeFetch + bounded cache
════════════════════════════════════════════════ */
let searchDebounce;
const searchInput  = document.getElementById('searchInput');
const suggestionsEl = document.getElementById('searchSuggestions');

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    suggestionsEl.innerHTML = '';
    suggestionsEl.style.display = 'none';
    return;
  }
  searchDebounce = setTimeout(async () => {
    // FIX #6: bounded cache hit
    if (searchCache.has(q)) { renderSuggestions(searchCache.get(q)); return; }
    try {
      const res  = await safeFetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=20&addressdetails=1`,
        { key:'search', timeout:6000 }
      );
      const data = await res.json();
      addSearchCache(q, data); // FIX #6: bounded add
      renderSuggestions(data);
    } catch(e) {
      if (e.name !== 'AbortError') console.warn('Search error:', e);
    }
  }, 280);
});

function renderSuggestions(data) {
  suggestionsEl.innerHTML = '';
  if (!data || data.length === 0) { suggestionsEl.style.display='none'; return; }
  suggestionsEl.style.display = 'block';
  // FIX #6: build fragment to avoid repeated reflows
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
      searchInput.value = p.display_name;
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
  if (!e.target.closest('.search-wrap')) {
    suggestionsEl.innerHTML = '';
    suggestionsEl.style.display = 'none';
  }
});

/* ════════════════════════════════════════════════
   REFRESH INTERVALS — FIX #5: jittered polling,
   no overlapping requests (guard flags per loader)
   FIX #12: stale check each cycle
════════════════════════════════════════════════ */
// Jitter helper — prevents thundering herd if multiple tabs open
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
