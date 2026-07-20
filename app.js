/* ════════════════════════════════════════════════
   HOME PAGE — depends on shared.js (loaded first)
   and bg-canvas.js (loaded second) for window.setBgMode/setDaytime
════════════════════════════════════════════════ */

const TICKER_GROUPS = [
  { key:'pds',      label:'Particularly Dangerous Situation', cls:'tg-pds',      match: ev => ev.includes('Particularly Dangerous') },
  { key:'tor-warn', label:'Tornado Warning',      cls:'tg-tor-warn',  match: ev => ev.includes('Tornado Warning') && !ev.includes('Watch') },
  { key:'tor-watch',label:'Tornado Watch',        cls:'tg-tor-watch', match: ev => ev.includes('Tornado Watch') },
  { key:'svr-warn', label:'Severe Thunderstorm Warning', cls:'tg-svr-warn',  match: ev => ev.includes('Severe Thunderstorm Warning') },
  { key:'svr-watch',label:'Severe Thunderstorm Watch',   cls:'tg-svr-watch', match: ev => ev.includes('Severe Thunderstorm Watch') },
  { key:'ff-emerg', label:'Flash Flood Emergency', cls:'tg-ff-emerg', match: ev => ev.includes('Flash Flood Emergency') },
  { key:'ff-warn',  label:'Flash Flood Warning / Watch', cls:'tg-ff-warn', match: ev => ev.includes('Flash Flood Warning') || ev.includes('Flash Flood Watch') },
  { key:'winter',   label:'Winter / Blizzard / Ice Storm', cls:'tg-winter', match: ev => ev.includes('Blizzard') || ev.includes('Winter Storm') || ev.includes('Ice Storm') || ev.includes('Winter Weather') },
  { key:'other',    label:'Other Alerts', cls:'tg-other', match: () => true },
];
const TICKER_API_URL = `https://api.weather.gov/alerts/active`;

/* ── STATE ── */
let appLat = 43, appLon = -88;
let userCounty = '';
let lastBgMode = 'clear';
let lastRisk = 'low';
let sirenActive = false;
let sirenCtx = null, sirenNodes = [], sirenTimeout = null;
let activeAlertFeatures = [];
let forceStormBg = false, forceStormType = '';
let lastSuccessfulRefresh = null;

const MAX_DISMISSED = 100;
let dismissedArr = []; const dismissedSet = new Set();
function addDismissed(uid) {
  if (dismissedSet.has(uid)) return;
  if (dismissedArr.length >= MAX_DISMISSED) { const oldest = dismissedArr.shift(); dismissedSet.delete(oldest); }
  dismissedArr.push(uid); dismissedSet.add(uid);
}
function isDismissed(uid) { return dismissedSet.has(uid); }

const MAX_SHOWN_ALERTS = 200, MAX_SEARCH_CACHE = 50;
let shownAlertsArr = []; const shownAlertsSet = new Set();
const searchCache = new Map();
function addShownAlert(uid) {
  if (shownAlertsSet.has(uid)) return;
  if (shownAlertsArr.length >= MAX_SHOWN_ALERTS) { const oldest = shownAlertsArr.shift(); shownAlertsSet.delete(oldest); }
  shownAlertsArr.push(uid); shownAlertsSet.add(uid);
}
function hasShownAlert(uid) { return shownAlertsSet.has(uid); }
function addSearchCache(key, val) {
  if (searchCache.size >= MAX_SEARCH_CACHE) { const firstKey = searchCache.keys().next().value; searchCache.delete(firstKey); }
  searchCache.set(key, val);
}

/* ── SAFE FETCH ── */
const activeFetchControllers = new Map();
async function safeFetch(url, { timeout = 10000, retries = 2, key = null, baseDelay = 800 } = {}) {
  if (key && activeFetchControllers.has(key)) { try { activeFetchControllers.get(key).abort(); } catch(_) {} }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    if (key) activeFetchControllers.set(key, controller);
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/geo+json" } });
      clearTimeout(timeoutId);
      if (key) activeFetchControllers.delete(key);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (key) activeFetchControllers.delete(key);
      if (err.name === 'AbortError') throw err;
      if (attempt < retries) { const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 400; await new Promise(r => setTimeout(r, delay)); continue; }
      throw err;
    }
  }
}

/* ── STALE DATA ── */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
function markRefreshSuccess() { lastSuccessfulRefresh = Date.now(); const b = document.getElementById('staleBanner'); if (b) b.style.display = 'none'; }
function checkStaleData() {
  if (!lastSuccessfulRefresh) return;
  if (Date.now() - lastSuccessfulRefresh > STALE_THRESHOLD_MS) { const b = document.getElementById('staleBanner'); if (b) b.style.display = 'block'; }
}

async function jumpToLocation(areaText) {
  if (!areaText) return;
  const first = areaText.split(/[;,]/)[0].trim();
  try {
    const res = await safeFetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(first)}&countrycodes=us&limit=1&addressdetails=1`, { key:'nominatim-jump' });
    const data = await res.json();
    if (data && data[0]) { appLat = parseFloat(data[0].lat); appLon = parseFloat(data[0].lon); loadAll(); }
  } catch(e) { console.warn('jumpToLocation failed:', e); }
}

/* ── UI HELPERS ── */
function toggleExpand(el) {
  const isOpen = el.classList.contains('open');
  document.querySelectorAll('.card-expandable.open').forEach(c => { if (c !== el) { c.classList.remove('open'); c.setAttribute('aria-expanded','false'); } });
  el.classList.toggle('open', !isOpen);
  el.setAttribute('aria-expanded', String(!isOpen));
}
document.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ') && e.target.matches('.card-expandable')) { e.preventDefault(); toggleExpand(e.target); } });

function toggleMenu() {
  const panel = document.getElementById('menuPanel'), btn = document.getElementById('menuBtn');
  const open = panel.classList.contains('open');
  panel.classList.toggle('open', !open);
  btn.setAttribute('aria-expanded', String(!open));
}
document.addEventListener('click', e => {
  if (!e.target.closest('#menuPanel') && !e.target.closest('#menuBtn')) {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) { panel.classList.remove('open'); document.getElementById('menuBtn').setAttribute('aria-expanded','false'); }
  }
});

const riskOrder = { low:0, medium:1, high:2 };
function setRiskDisplay(risk, label, why) {
  const box = document.getElementById('riskBox'), txt = document.getElementById('riskText'), whyEl = document.getElementById('riskWhy');
  if (!box || !txt || !whyEl) return;
  const wasOpen = box.classList.contains('open');
  const classMap = { low:'risk-low', medium:'risk-medium', high:'risk-high' };
  const defaultLabel = { low:'LOW', medium:'ELEVATED', high:'HIGH' };
  box.className = `risk-box ${classMap[risk]} card-expandable${wasOpen?' open':''}`;
  box.setAttribute('aria-expanded', wasOpen ? 'true' : 'false');
  txt.textContent = label || defaultLabel[risk];
  whyEl.textContent = why || (risk==='low' ? 'No significant threats detected.' : risk==='medium' ? 'Favorable conditions for storm development.' : 'Active severe weather threat.');
  lastRisk = risk;
}

function announceAlert(message) {
  const el = document.getElementById('ariaLive'); if (!el) return;
  el.textContent = ''; requestAnimationFrame(() => { el.textContent = message; });
}

/* ── POPUP SYSTEM ── */
const POPUP_CONFIG = [
  { match: ev => ev.includes('Particularly Dangerous Situation') && ev.includes('Tornado'), badge:'🚨 PDS TORNADO WARNING', badgeBg:'#cc0000', badgeTx:'#fff', title:'🌪 PARTICULARLY DANGEROUS SITUATION — TORNADO WARNING', body:'A PARTICULARLY DANGEROUS SITUATION (PDS) Tornado Warning has been issued. This warning is reserved for rare events involving a violent, long-track tornado capable of catastrophic and potentially historic damage. Confirmed by trained spotters and/or Doppler radar. Extremely life-threatening conditions exist in and near the warned area.', instruction:'TAKE SHELTER IMMEDIATELY in the lowest level of a sturdy structure — a basement, storm shelter, or interior room away from all windows. Do not wait. If you are in the path of this storm, your life is in imminent danger.' },
  { match: ev => ev.includes('Tornado Emergency'), badge:'🚨 TORNADO EMERGENCY', badgeBg:'#aa0000', badgeTx:'#fff', title:'🌪 TORNADO EMERGENCY', body:'A TORNADO EMERGENCY has been declared. A confirmed, violent tornado is moving through a densely populated area. Catastrophic and life-threatening damage is occurring or will occur shortly. This is an exceedingly rare and extremely dangerous situation.', instruction:'SEEK SHELTER IMMEDIATELY in a basement or the lowest interior room of the most substantial structure available. Protect your head and neck. Do not attempt to outrun this tornado by vehicle.' },
  { match: ev => ev.includes('Tornado Warning'), badge:'⚠ TORNADO WARNING', badgeBg:'#990000', badgeTx:'#fff', title:'🌪 TORNADO WARNING', body:'A Tornado Warning has been issued by the National Weather Service. A tornado has been confirmed by Doppler radar or a trained weather spotter. The warned area should take protective action immediately.', instruction:'Move to the lowest floor of a substantial building. Go to an interior hallway or room away from windows and exterior walls. If in a mobile home or vehicle, abandon it immediately for a sturdier structure or a low-lying ditch away from trees.' },
  { match: ev => ev.includes('Flash Flood Emergency'), badge:'🌊 FLASH FLOOD EMERGENCY', badgeBg:'#003388', badgeTx:'#fff', title:'🌊 FLASH FLOOD EMERGENCY', body:'A Flash Flood Emergency has been issued. This is an exceedingly rare situation involving life-threatening flash flooding of catastrophic proportions.', instruction:"Move immediately to higher ground. Do not attempt to walk, swim, or drive through floodwaters. Turn Around, Don't Drown." },
  { match: ev => ev.includes('Severe Thunderstorm Warning'), badge:'⛈ SEVERE THUNDERSTORM WARNING', badgeBg:'#774400', badgeTx:'#fff', title:'⛈ SEVERE THUNDERSTORM WARNING', body:'A Severe Thunderstorm Warning has been issued. Large hail and/or wind gusts of 58 mph or greater are occurring or are imminent.', instruction:'Move indoors immediately. Stay away from windows. Be aware that any severe thunderstorm can produce a tornado with little or no warning.' },
  { match: ev => ev.includes('Tornado Watch'), badge:'🌀 TORNADO WATCH', badgeBg:'#552200', badgeTx:'#ffe0c0', title:'🌪 TORNADO WATCH', body:'A Tornado Watch has been issued. Conditions are highly favorable for tornado development.', instruction:'Be prepared to act immediately if a Tornado Warning is issued. Review your shelter plan now.' },
  { match: ev => ev.includes('Severe Thunderstorm Watch'), badge:'⛈ SVR THUNDERSTORM WATCH', badgeBg:'#443300', badgeTx:'#ffe090', title:'⛈ SEVERE THUNDERSTORM WATCH', body:'A Severe Thunderstorm Watch is in effect. Conditions are favorable for severe thunderstorms.', instruction:'Stay weather-aware. Have a plan ready if warnings are issued for your location.' },
];
function getPopupConfig(ev) { return POPUP_CONFIG.find(c => c.match(ev)) || null; }

let currentPopupUid = null;
function showPopup(ev, movement, uid) {
  const cfg = getPopupConfig(ev); if (!cfg) return;
  const badge = document.getElementById('popupBadge'); if (!badge) return;
  currentPopupUid = uid || null;
  badge.textContent = cfg.badge; badge.style.background = cfg.badgeBg; badge.style.color = cfg.badgeTx;
  document.getElementById('popupTitle').textContent = cfg.title;
  document.getElementById('popupBody').textContent = cfg.body;
  const instr = document.getElementById('popupInstruction');
  instr.textContent = cfg.instruction; instr.style.display = cfg.instruction ? 'block' : 'none';
  const movEl = document.getElementById('popupMovement');
  if (movement) { movEl.textContent = `📍 Storm movement: ${movement.dir} at ${movement.spd} mph`; movEl.style.display = 'block'; }
  else movEl.style.display = 'none';
  document.getElementById('popup').style.display = 'block';
  requestAnimationFrame(() => { const closeBtn = document.getElementById('popupClose'); if (closeBtn) closeBtn.focus(); });
  announceAlert(cfg.title);
}
function closePopup() {
  if (currentPopupUid) { addDismissed(currentPopupUid); addShownAlert(currentPopupUid); }
  document.getElementById('popup').style.display = 'none';
  currentPopupUid = null;
}
const popupCloseBtn = document.getElementById('popupClose');
if (popupCloseBtn) popupCloseBtn.addEventListener('click', closePopup);
document.addEventListener('keydown', e => { const popup = document.getElementById('popup'); if (e.key === 'Escape' && popup && popup.style.display !== 'none') closePopup(); });

/* ── SIREN AUDIO ── */
document.addEventListener('click', () => {
  if (window.AudioContext || window.webkitAudioContext) { const ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume().then(() => ctx.close()); }
}, { once: true });
function startSiren() {
  if (sirenActive) return;
  sirenActive = true;
  const banner = document.getElementById('sirenBanner'); if (banner) banner.style.display = 'block';
  try { sirenCtx = new (window.AudioContext || window.webkitAudioContext)(); playSirenLoop(); } catch(_) {}
}
function playSirenLoop() {
  if (!sirenActive || !sirenCtx) return;
  const now = sirenCtx.currentTime, duration = 4.2;
  const osc = sirenCtx.createOscillator(), gain = sirenCtx.createGain(), filter = sirenCtx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.setValueAtTime(800, now); filter.Q.value = 0.8;
  osc.connect(filter); filter.connect(gain); gain.connect(sirenCtx.destination);
  osc.type = 'sawtooth';
  gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.22, now + 0.3);
  gain.gain.setValueAtTime(0.22, now + duration - 0.4); gain.gain.linearRampToValueAtTime(0, now + duration);
  osc.frequency.setValueAtTime(450, now); osc.frequency.linearRampToValueAtTime(1020, now + duration * 0.5); osc.frequency.linearRampToValueAtTime(450, now + duration);
  const osc2 = sirenCtx.createOscillator(), gain2 = sirenCtx.createGain();
  osc2.connect(gain2); gain2.connect(sirenCtx.destination);
  osc2.type = 'sine';
  gain2.gain.setValueAtTime(0, now); gain2.gain.linearRampToValueAtTime(0.07, now + 0.4);
  gain2.gain.setValueAtTime(0.07, now + duration - 0.4); gain2.gain.linearRampToValueAtTime(0, now + duration);
  osc2.frequency.setValueAtTime(225, now); osc2.frequency.linearRampToValueAtTime(510, now + duration * 0.5); osc2.frequency.linearRampToValueAtTime(225, now + duration);
  osc.start(now); osc.stop(now + duration); osc2.start(now); osc2.stop(now + duration);
  sirenNodes = [osc, osc2, gain, gain2, filter];
  clearTimeout(sirenTimeout);
  sirenTimeout = setTimeout(() => { if (sirenActive) playSirenLoop(); }, duration * 1000);
}
function stopSiren() {
  sirenActive = false;
  const banner = document.getElementById('sirenBanner'); if (banner) banner.style.display = 'none';
  clearTimeout(sirenTimeout);
  sirenNodes.forEach(n => { try { n.disconnect(); } catch(_) {} });
  sirenNodes = [];
  if (sirenCtx) { sirenCtx.close(); sirenCtx = null; }
}

/* ── TICKER drag guard ── */
(function initTickerDragGuard() {
  const scroll = document.getElementById('tickerScroll'); if (!scroll) return;
  let pointerStartX = 0, pointerStartY = 0, didDrag = false;
  const DRAG_THRESHOLD = 6;
  scroll.addEventListener('pointerdown', e => { pointerStartX = e.clientX; pointerStartY = e.clientY; didDrag = false; }, { passive: true });
  scroll.addEventListener('pointermove', e => { const dx = Math.abs(e.clientX - pointerStartX), dy = Math.abs(e.clientY - pointerStartY); if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) didDrag = true; }, { passive: true });
  scroll.addEventListener('click', e => { if (didDrag) { e.stopImmediatePropagation(); e.preventDefault(); didDrag = false; } }, true);
})();

/* ── SUN/DAY-NIGHT ── */
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

/* ── WEATHER CODE → BG MODE ── */
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

/* ── GEOLOCATION + LOAD ── */
navigator.geolocation.getCurrentPosition(
  p => { appLat=p.coords.latitude; appLon=p.coords.longitude; loadAll(); },
  () => loadAll(),
  { timeout: 8000 }
);

function loadAll() {
  forceStormBg = false;
  loadLocation(); loadWeather(); loadAlerts(); loadTicker(); updateFooter();
}
function updateFooter() {
  const el = document.getElementById('footerTime');
  if (el) el.textContent = `Data: NWS · Open-Meteo · Updated ${new Date().toLocaleTimeString()}`;
}

/* ── LOCATION ── */
async function loadLocation() {
  try {
    const res = await safeFetch(`https://api.weather.gov/points/${appLat.toFixed(4)},${appLon.toFixed(4)}`, { key:'location', timeout:8000 });
    const data = await res.json();
    const props = data.properties;
    const city = props.relativeLocation?.properties?.city || '';
    const state = props.relativeLocation?.properties?.state || '';
    const countyRes = await safeFetch(props.county, { key:'county', timeout:6000 });
    const countyData = await countyRes.json();
    userCounty = countyData.properties?.name || '';
    const el = document.getElementById('locationCard');
    if (el) el.innerHTML = `<b>${userCounty || 'Unknown'} County</b><span>${city}${city&&state?', ':''}${state}</span>`;
  } catch(e) {
    if (e.name === 'AbortError') return;
    console.warn('Location fetch failed:', e);
    const el = document.getElementById('locationCard'); if (el) el.textContent = 'Location unavailable';
  }
}

/* ── WEATHER ── */
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
      `&temperature_unit=fahrenheit&windspeed_unit=mph&forecast_days=2&timezone=auto`,
    ].join('');
    const res = await safeFetch(url, { key:'weather', timeout:10000 });
    const d = await res.json();
    const c = d.current;

    const tempF = Math.round(c.temperature_2m), feelsF = Math.round(c.apparent_temperature);
    const hum = Math.round(c.relative_humidity_2m), dewF = Math.round(c.dew_point_2m);
    const windSpd = Math.round(c.wind_speed_10m), windG = Math.round(c.wind_gusts_10m);
    const windDeg = c.wind_direction_10m, pressHpa = Math.round(c.surface_pressure), wcode = c.weather_code || 0;

    // ── ACCURATE CURRENT-INSTANT CAPE/LI ──
    // Open-Meteo's `hourly.time` values are naive local-time strings for the
    // requested location (timezone=auto). Previously this indexed into that
    // array using the *device's* local hour, which silently pulled the wrong
    // hour's CAPE/LI whenever the searched location's timezone differed from
    // the device's timezone. We now locate the two bracketing hourly samples
    // using the location's actual utc_offset_seconds, then linearly
    // interpolate between them so the value reflects "right now" instead of
    // snapping to the top of whichever hour happens to match a Math.round.
    const hourlyTimes = d.hourly.time || [];
    const utcOffsetSec = d.utc_offset_seconds || 0;
    const nowLocalMs = Date.now() + utcOffsetSec * 1000;
    const idx0 = findClosestHourIndex(hourlyTimes, utcOffsetSec);
    const t0 = Date.parse(hourlyTimes[idx0] + ':00Z');
    let idxA, idxB;
    if (nowLocalMs >= t0) { idxA = idx0; idxB = Math.min(idx0 + 1, hourlyTimes.length - 1); }
    else { idxA = Math.max(idx0 - 1, 0); idxB = idx0; }
    const tA = Date.parse(hourlyTimes[idxA] + ':00Z'), tB = Date.parse(hourlyTimes[idxB] + ':00Z');
    const frac = tB > tA ? Math.min(1, Math.max(0, (nowLocalMs - tA) / (tB - tA))) : 0;
    const capeA = Math.max(0, d.hourly.cape?.[idxA] ?? 0), capeB = Math.max(0, d.hourly.cape?.[idxB] ?? 0);
    const liA = d.hourly.lifted_index?.[idxA] ?? 5, liB = d.hourly.lifted_index?.[idxB] ?? 5;
    const cape = capeA + (capeB - capeA) * frac;
    const li = liA + (liB - liA) * frac;

    const tc = tempClass(tempF);
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

    setHTML('temp', `<span class="${tc}">${tempF}°F</span>`);
    setEl('tempSub', feelsF !== tempF ? `Feels ${feelsF}°F` : '');
    setEl('feels', `${feelsF}°F`);
    setEl('pressure', `${pressHpa} mb`);

    const hl = humLabel(hum);
    setEl('humidity', hum+'%'); setEl('humSub', hl.feel); setEl('moistureLevel', hl.level); setEl('humidityFeel', hl.feel);

    setHTML('dew', `<span class="${tc}">${dewF}°F</span>`);
    setEl('dewSub', dewLabel(dewF).replace(/^[🟢🟠🔴🟡]\s/,''));
    setEl('stormFuel', dewLabel(dewF));
    setEl('wind', windSpd+' mph'); setEl('windSub', degToCompass(windDeg));
    setEl('windDir', `${degToCompass(windDeg)} (${windDeg}°)`); setEl('gusts', windG+' mph');

    const cl = capeLabel(cape);
    setHTML('cape', `<span style="color:${cl.color}">${Math.round(cape)} J/kg — ${cl.txt}</span>`);
    setEl('instability', liLabel(li));
    setEl('sndMoisture', dewLabel(dewF));
    setEl('sndLift', li<=0?`⬆ Active lift (LI ${li.toFixed(1)})`:` ⬇ Capping (LI +${li.toFixed(1)})`);
    setEl('sndWind', windEnergyLabel(windSpd));

    const torEnv = computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressHpa);
    setEl('sndShear', torEnv==='high' ? '🔴 Strong backing winds — favorable rotation' : torEnv==='moderate' ? '🟠 Some backing — moderate shear' : '🟢 Limited organized shear');

    let torRiskTxt, sevRiskTxt;
    if      (li<=-6&&cape>2000)  { torRiskTxt='🔴 High'; sevRiskTxt='🔴 High'; }
    else if (li<=-5&&cape>1500)  { torRiskTxt='🟠 Moderate–High'; sevRiskTxt='🔴 High'; }
    else if (li<=-4&&cape>1000)  { torRiskTxt='🟠 Moderate'; sevRiskTxt='🔴 High'; }
    else if (li<=-3&&cape>500)   { torRiskTxt='🟡 Low–Moderate'; sevRiskTxt='🟠 Moderate'; }
    else if (li<=-2&&cape>200)   { torRiskTxt='🟡 Marginal'; sevRiskTxt='🟡 Low'; }
    else if (li<=0)              { torRiskTxt='🟢 Low'; sevRiskTxt='🟡 Marginal'; }
    else                          { torRiskTxt='🟢 Minimal'; sevRiskTxt='🟢 Minimal'; }
    setEl('torRisk', torRiskTxt); setEl('sevRisk', sevRiskTxt);

    let capeExplain;
    if      (cape>2500) capeExplain='⚠ Extreme instability: explosive storm development possible.';
    else if (cape>1500) capeExplain='⚠ Significant instability: organized severe storms possible.';
    else if (cape>500)  capeExplain='Moderate instability: storms possible if triggered.';
    else if (cape>100)  capeExplain='Weak instability: only isolated storms.';
    else                  capeExplain='Very little instability: storm development unlikely.';
    setEl('capeWhy', `CAPE: ${Math.round(cape)} J/kg · LI: ${li.toFixed(1)} · Dew: ${dewF}°F · Wind: ${windSpd} mph (interpolated to current local time)\n${capeExplain}`);

    const hasActiveTornadoAlert = forceStormBg && forceStormType === 'tornado';
    const mode = weatherCodeToMode(wcode, cape, li, windSpd, dewF, windDeg, pressHpa, hasActiveTornadoAlert);
    if (mode !== lastBgMode) { window.setBgMode(mode); lastBgMode = mode; }
    updateDayNight();

    const soundingRisk = computeWeatherRisk(li, cape, dewF, windSpd, windDeg, pressHpa);
    if (riskOrder[soundingRisk] > riskOrder[lastRisk]) {
      const why = soundingRisk==='high' ? `Strong instability (LI ${li.toFixed(1)}) with ${Math.round(cape)} J/kg CAPE — organized severe weather possible.` : 'Elevated instability with moisture — watch conditions possible.';
      setRiskDisplay(soundingRisk, undefined, why);
    } else if (lastRisk === 'low') {
      setRiskDisplay('low', undefined, 'No significant atmospheric threat detected.');
    }
  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Weather error:', e);
    const el = document.getElementById('temp'); if (el) el.textContent = 'N/A';
  } finally { weatherFetchInProgress = false; }
}

/* ── ALERTS ── */
let alertsFetchInProgress = false;
async function loadAlerts() {
  if (alertsFetchInProgress) return;
  alertsFetchInProgress = true;
  try {
    const res = await safeFetch(`https://api.weather.gov/alerts/active?point=${appLat.toFixed(4)},${appLon.toFixed(4)}`, { key:'alerts', timeout:10000, retries:2 });
    const data = await res.json();
    const deduped = deduplicateAlerts(data.features || []);
    activeAlertFeatures = sortAlerts(deduped);
    markRefreshSuccess();

    const hasTornadoWarn = activeAlertFeatures.some(a => isTornadoLevel(a.properties?.event || ''));
    if (hasTornadoWarn) {
      forceStormBg = true; forceStormType = 'tornado';
      if (lastBgMode !== 'tornado') { window.setBgMode('tornado'); lastBgMode = 'tornado'; }
    } else { forceStormBg = false; forceStormType = ''; }

    let alertRisk = 'low', alertRiskLabel = '', alertRiskWhy = '';
    let needsSiren = false, popupShown = false;

    let spatialAlert = null;
    for (const a of activeAlertFeatures) { const score = alertPriorityScore(a.properties?.event || ''); if (score <= 6) { spatialAlert = a; break; } }

    let lastSectionLabel = '', html = '';
    for (let idx = 0; idx < activeAlertFeatures.length; idx++) {
      const a = activeAlertFeatures[idx];
      const ev = a.properties?.event || '', desc = a.properties?.description || '', inst = a.properties?.instruction || '', areaDesc = a.properties?.areaDesc || '';
      const score = alertPriorityScore(ev), cls = alertCssClass(ev), movement = parseMovement(desc), uid = alertStableId(a);

      if (score <= 6 && alertRisk !== 'high') {
        alertRisk = 'high'; alertRiskLabel = 'HIGH';
        alertRiskWhy = isTornadoLevel(ev) ? 'Tornado Warning in effect.' : ev.includes('Flash Flood') ? 'Flash Flood Warning in effect.' : 'Severe Warning in effect.';
      } else if (score <= 9 && alertRisk === 'low') { alertRisk = 'medium'; alertRiskLabel = 'ELEVATED'; alertRiskWhy = 'Watch in effect — conditions favorable for severe weather.'; }
      else if (alertRisk === 'low') { alertRisk = 'medium'; alertRiskLabel = 'ELEVATED'; alertRiskWhy = 'Advisory or statement in effect.'; }

      const inMyCounty = countyMatchesArea(userCounty, areaDesc);
      if (inMyCounty && isTornadoLevel(ev)) needsSiren = true;

      if (!popupShown && !hasShownAlert(uid) && !isDismissed(uid) && getPopupConfig(ev)) { addShownAlert(uid); showPopup(ev, movement, uid); popupShown = true; }

      const sLabel = alertSectionLabel(score);
      if (sLabel !== lastSectionLabel) { html += `<div class="alert-section-header">${sLabel}</div>`; lastSectionLabel = sLabel; }

      const areas = areaDesc.split(';').slice(0,3).map(s=>s.trim()).filter(Boolean);
      const areaLinks = areas.map(area => `<span class="area-link" onclick="jumpToLocation('${area.replace(/'/g,"\\'")}')">📍 ${area}</span>`).join(' · ');
      const movText = movement ? `<div class="alert-movement">📍 Moving ${movement.dir} at ${movement.spd} mph</div>` : '';
      const shortDesc = desc.replace(/\*/g,'').replace(/\n\n/g,'<br><br>').replace(/\n/g,' ');
      const shortInst = inst ? `<div class="alert-instruction">${inst.replace(/\n/g,'<br>')}</div>` : '';
      const dismissedClass = isDismissed(uid) ? ' alert-dismissed' : '';

      html += `
        <div class="alert-card ${cls}${dismissedClass} card-expandable" onclick="toggleExpand(this)" role="button" tabindex="0" aria-expanded="false">
          <div class="alert-card-header">
            <div><span class="alert-title">${ev}</span><span class="alert-meta">${areaLinks}</span>${movText}</div>
            <span class="alert-chevron">▼</span>
          </div>
          <div class="expand-details"><div class="alert-detail-text">${shortDesc}</div>${shortInst}</div>
        </div>`;
    }

    const alertsEl = document.getElementById('alertsContainer');
    if (alertsEl) alertsEl.innerHTML = html || '<div style="color:#2a7a5a;padding:16px 0;font-size:14px;text-align:left">✓ No active alerts for this location</div>';

    const spatialCard = document.getElementById('spatialCard');
    if (spatialCard) {
      if (spatialAlert) {
        const dist = alertCentroidDistance(spatialAlert);
        const mov = parseMovement(spatialAlert.properties?.description || '');
        const setEl = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
        setEl('spNearestAlert', spatialAlert.properties?.event || '');
        setEl('spDirection', dist < 9999 ? `~${Math.round(dist)} miles away` : 'Unknown');
        setEl('spMovement', mov ? `${mov.dir} at ${mov.spd} mph` : 'Not reported');
        spatialCard.classList.add('visible');
      } else spatialCard.classList.remove('visible');
    }

    if (needsSiren && !sirenActive) startSiren();
    else if (!needsSiren && sirenActive) stopSiren();

    if (activeAlertFeatures.length > 0 && riskOrder[alertRisk] >= riskOrder[lastRisk]) setRiskDisplay(alertRisk, alertRiskLabel, alertRiskWhy);
    if (activeAlertFeatures.length > 0) { const topEv = activeAlertFeatures[0]?.properties?.event || ''; if (topEv) announceAlert(`Active alert: ${topEv}`); }
  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Alerts error:', e);
    const el = document.getElementById('alertsContainer'); if (el) el.textContent = 'Failed to load alerts.';
    checkStaleData();
  } finally { alertsFetchInProgress = false; }
}

function alertCentroidDistance(alert) {
  const c = alertCentroid(alert);
  if (!c) return 9999;
  return haversineDistance(appLat, appLon, c.lat, c.lon);
}
function sortAlerts(features) {
  return [...features].sort((a, b) => {
    const pa = alertPriorityScore(a.properties?.event || ''), pb = alertPriorityScore(b.properties?.event || '');
    if (pa !== pb) return pa - pb;
    return alertCentroidDistance(a) - alertCentroidDistance(b);
  });
}

/* ── TICKER ── */
const tickerOverflowByGroup = {};
let currentOverflowGroup = null;

function positionOverflowPortal() {
  const wrap = document.getElementById('tickerWrap'), portal = document.getElementById('tickerOverflowPortal');
  if (!wrap || !portal) return;
  const rect = wrap.getBoundingClientRect();
  portal.style.top = `${rect.bottom}px`;
}

function openTickerOverflow(groupKey, event) {
  event.stopPropagation();
  const portal = document.getElementById('tickerOverflowPortal'), innerEl = document.getElementById('tickerOverflowInner');
  if (!portal || !innerEl) return;
  const items = tickerOverflowByGroup[groupKey];
  if (currentOverflowGroup === groupKey && portal.classList.contains('open')) { portal.classList.remove('open'); currentOverflowGroup = null; return; }
  if (!items || items.length === 0) return;
  positionOverflowPortal();
  const groupDef = TICKER_GROUPS.find(g => g.key === groupKey);
  const list = items.map(({ ev, area }) => {
    const cleanArea = area.split(';').slice(0,3).map(s=>s.trim()).filter(Boolean).join(' · ');
    return `<div class="ticker-overflow-item" onclick="jumpToLocation('${area.split(';')[0].trim().replace(/'/g,"\\'")}')"><span class="oi-ev">${ev}</span><span class="oi-area">📍 ${cleanArea}</span></div>`;
  }).join('');
  innerEl.innerHTML = `<div class="ticker-overflow-title">${groupDef?.label||''} — All Alerts (${items.length})</div>${list}`;
  currentOverflowGroup = groupKey;
  portal.classList.add('open');
}
function closeTickerOverflow() {
  const portal = document.getElementById('tickerOverflowPortal'); if (portal) portal.classList.remove('open');
  currentOverflowGroup = null;
}
document.addEventListener('click', e => { if (!e.target.closest('#tickerWrap') && !e.target.closest('#tickerOverflowPortal')) closeTickerOverflow(); });
window.addEventListener('scroll', positionOverflowPortal, { passive: true });
window.addEventListener('resize', positionOverflowPortal, { passive: true });

const TICKER_RELEVANT_EVENTS = new Set(['Tornado Warning','Tornado Watch','Severe Thunderstorm Warning','Severe Thunderstorm Watch','Flash Flood Warning','Flash Flood Watch','Flash Flood Emergency','Blizzard Warning','Winter Storm Warning','Ice Storm Warning','Winter Storm Watch','Winter Weather Advisory','Particularly Dangerous Situation','Tornado Emergency']);
function isTickerRelevant(ev) { if (!ev) return false; for (const t of TICKER_RELEVANT_EVENTS) if (ev.includes(t)) return true; return false; }

let tickerFetchInProgress = false;
async function loadTicker() {
  if (tickerFetchInProgress) return;
  tickerFetchInProgress = true;
  const scrollEl = document.getElementById('tickerScroll');
  if (!scrollEl) { tickerFetchInProgress = false; return; }
  try {
    const res = await safeFetch(TICKER_API_URL, { key:'ticker', timeout:15000, retries:2 });
    const data = await res.json();
    if (!data || !data.features) { scrollEl.innerHTML = '<div class="ticker-none">✓ No major severe weather alerts nationwide</div>'; return; }
    const relevant = (data.features || []).filter(a => isTickerRelevant(a.properties?.event || ''));
    const deduped = deduplicateAlerts(relevant);
    const features = sortAlerts(deduped);
    if (features.length === 0) { scrollEl.innerHTML = '<div class="ticker-none">✓ No major severe weather alerts nationwide</div>'; return; }

    const buckets = {};
    TICKER_GROUPS.forEach(g => { buckets[g.key] = []; });
    features.forEach(a => {
      const ev = a.properties?.event || '', area = a.properties?.areaDesc || '';
      for (const g of TICKER_GROUPS) { if (g.match(ev)) { buckets[g.key].push({ ev, area }); break; } }
    });
    TICKER_GROUPS.forEach(g => { tickerOverflowByGroup[g.key] = buckets[g.key] || []; });

    const MAX_INLINE = 3;
    let groupsHTML = '';
    TICKER_GROUPS.forEach(g => {
      const items = buckets[g.key];
      if (!items || items.length === 0) return;
      const inline = items.slice(0, MAX_INLINE), overflow = items.length - MAX_INLINE;
      groupsHTML += `<div class="ticker-group ${g.cls}">`;
      groupsHTML += `<span class="ticker-group-label">${g.label} <span class="ticker-group-count">${items.length}</span></span>`;
      inline.forEach(({ ev, area }) => {
        const parts = area.split(';')[0].split(',').slice(0,2).join(',').trim();
        const label = parts.length > 34 ? parts.slice(0,32)+'…' : parts;
        groupsHTML += `<span class="ticker-item" onclick="jumpToLocation('${parts.replace(/'/g,"\\'")}')">📍 ${label}</span>`;
      });
      if (overflow > 0) groupsHTML += `<span class="ticker-more" onclick="openTickerOverflow('${g.key}',event)" role="button" tabindex="0" aria-label="Show ${overflow} more ${g.label} alerts">+${overflow} more ▼</span>`;
      groupsHTML += `</div>`;
    });

    scrollEl.innerHTML = groupsHTML || '<div class="ticker-none">✓ No major alerts</div>';
    scrollEl.querySelectorAll('.ticker-more').forEach(el => { el.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); el.click(); } }); });
    requestAnimationFrame(positionOverflowPortal);
  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Ticker error:', e);
    if (scrollEl) scrollEl.innerHTML = '<div class="ticker-none" style="color:#ff6060">⚠ Ticker unavailable</div>';
  } finally { tickerFetchInProgress = false; }
}

/* ── SEARCH ── */
let searchDebounce;
const searchInput = document.getElementById('searchInput');
const suggestionsEl = document.getElementById('searchSuggestions');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) { if (suggestionsEl) { suggestionsEl.innerHTML = ''; suggestionsEl.style.display = 'none'; } return; }
    searchDebounce = setTimeout(async () => {
      if (searchCache.has(q)) { renderSuggestions(searchCache.get(q)); return; }
      try {
        const res = await safeFetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=20&addressdetails=1`, { key:'search', timeout:6000 });
        const data = await res.json();
        addSearchCache(q, data);
        renderSuggestions(data);
      } catch(e) { if (e.name !== 'AbortError') console.warn('Search error:', e); }
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
    div.textContent = p.display_name; div.setAttribute('role','option'); div.setAttribute('tabindex','0');
    const pick = () => {
      appLat = parseFloat(p.lat); appLon = parseFloat(p.lon);
      if (searchInput) searchInput.value = p.display_name;
      suggestionsEl.innerHTML = ''; suggestionsEl.style.display = 'none';
      loadAll();
    };
    div.addEventListener('click', pick);
    div.addEventListener('keydown', e => { if(e.key==='Enter') pick(); });
    frag.appendChild(div);
  });
  suggestionsEl.appendChild(frag);
}
document.addEventListener('click', e => { if (!e.target.closest('.search-wrap') && suggestionsEl) { suggestionsEl.innerHTML = ''; suggestionsEl.style.display = 'none'; } });

/* ── REFRESH INTERVALS ── */
jitteredInterval(() => { loadAlerts(); updateFooter(); checkStaleData(); }, 15_000, 3_000);
jitteredInterval(() => { loadWeather(); }, 300_000, 30_000);
jitteredInterval(() => { loadTicker(); }, 30_000, 5_000);
jitteredInterval(() => { updateDayNight(); }, 600_000, 60_000);