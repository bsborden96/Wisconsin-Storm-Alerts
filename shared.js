/* ════════════════════════════════════════════════
   SHARED CORE — constants, alert logic, hazard math
   Used by app.js (Home) and outlooks.js (Outlooks)
════════════════════════════════════════════════ */

const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

/* ── Performance detection (shared so both pages tune the canvas the same way) ── */
const perfLevel = (() => {
  const mem   = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'mid';
  return 'high';
})();
const pixelRatio = Math.min(window.devicePixelRatio || 1, perfLevel === 'low' ? 1 : 2);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Shared refresh scheduler (jittered so multiple timers don't all fire
   on the same tick) — used by both the Home ticker/alert loop and the
   Outlooks auto-refresh loop. ── */
function jitteredInterval(fn, baseMs, jitterMs) {
  const tick = () => { fn(); const next = baseMs + Math.random() * jitterMs; setTimeout(tick, next); };
  setTimeout(tick, baseMs + Math.random() * jitterMs);
}

/* ── Find the hourly-forecast index closest to "right now" in the
   forecast's OWN timezone (not the device's). Open-Meteo's `hourly.time`
   entries are naive local-time strings like "2026-07-20T14:00" for the
   requested location when timezone=auto is used. To compare them against
   "now" without any timezone mixups, both sides are converted using the
   same trick: parse/format as if they were UTC, using the location's
   utc_offset_seconds to shift "now" into that same local frame. This keeps
   current-conditions math (e.g. CAPE) correct even when the viewed
   location is in a different timezone than the device. ── */
function findClosestHourIndex(hourlyTimes, utcOffsetSeconds) {
  if (!hourlyTimes || hourlyTimes.length === 0) return 0;
  const nowLocalMs = Date.now() + (utcOffsetSeconds || 0) * 1000;
  let bestIdx = 0, bestDiff = Infinity;
  for (let i = 0; i < hourlyTimes.length; i++) {
    const tMs = Date.parse(hourlyTimes[i] + ':00Z');
    const diff = Math.abs(tMs - nowLocalMs);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

/* ── Alert priority ── */
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
function isTornadoLevel(eventStr) { return alertPriorityScore(eventStr) <= 3; }
function isExtremeLevel(eventStr) { return alertPriorityScore(eventStr) <= 2; }

function degToCompass(deg) { return COMPASS_DIRS[Math.round(deg / 22.5) % 16]; }

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
      return { lat: coords.reduce((s,c) => s+c[1], 0) / coords.length, lon: coords.reduce((s,c) => s+c[0], 0) / coords.length };
    }
    if (geo?.type === 'MultiPolygon') {
      const all = geo.coordinates.flat(2);
      return { lat: all.reduce((s,c) => s+c[1], 0) / all.length, lon: all.reduce((s,c) => s+c[0], 0) / all.length };
    }
  } catch(_) {}
  return null;
}

function normalizeCountyName(name) {
  return (name || '').replace(/\b(county|parish|borough|census area|municipality)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function countyMatchesArea(userCty, areaDesc) {
  if (!userCty || !areaDesc) return false;
  const normalUser = normalizeCountyName(userCty);
  if (!normalUser) return false;
  const areaParts = areaDesc.split(/[;,]/).map(normalizeCountyName);
  return areaParts.some(part => part.includes(normalUser) || normalUser.includes(part));
}

function alertStableId(feature) {
  const id = feature.id || feature.properties?.id;
  if (id) return id;
  const ev = feature.properties?.event || '', area = feature.properties?.areaDesc || '', sent = feature.properties?.sent || '';
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

function parseMovement(desc) {
  if (!desc) return null;
  const m = desc.match(/moving?\s+(?:toward[s]?\s+the\s+)?([NSEW]+(?:EAST|WEST|NORTH|SOUTH|northeast|northwest|southeast|southwest|north|south|east|west)?)\s+at\s+(\d+)\s*mph/i);
  if (m) return { dir: m[1].toUpperCase(), spd: parseInt(m[2]) };
  const m2 = desc.match(/(\d+)\s*mph?\s+(?:toward[s]?\s+the\s+)?([NSEW]+(?:EAST|WEST|NORTH|SOUTH)?)/i);
  if (m2) return { dir: m2[2].toUpperCase(), spd: parseInt(m2[1]) };
  return null;
}

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

/* ── Hazard environment math (used for both live sounding + multi-day outlooks) ── */
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

/* ── 5-tier SPC-style category scale, reused by Outlooks tab ──
   0 none · 1 marginal · 2 slight · 3 enhanced · 4 high        */
const RISK_TIERS = [
  { key:'none',     label:'No Concern',  color:'#2a7a5a' },
  { key:'marginal', label:'Marginal',    color:'#6eff8a' },
  { key:'slight',   label:'Slight',      color:'#ffe066' },
  { key:'enhanced', label:'Enhanced',    color:'#ff8c00' },
  { key:'high',     label:'High',        color:'#ff3b3b' },
];
function tierAt(i) { return RISK_TIERS[Math.max(0, Math.min(RISK_TIERS.length - 1, i))]; }

function tornadoTier(li, cape, dewF, windSpd, windDeg) {
  const env = computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, 1000);
  if (env === 'high') return cape >= 2500 && li <= -6 ? 4 : 3;
  if (env === 'moderate') return 2;
  if (env === 'marginal') return 1;
  return 0;
}
function windTier(gustMph) {
  if (gustMph >= 70) return 4;
  if (gustMph >= 58) return 3;
  if (gustMph >= 45) return 2;
  if (gustMph >= 35) return 1;
  return 0;
}
function hailTier(cape, precipProb) {
  // Proxy only — no direct hail-size model input available.
  if (cape >= 2500 && precipProb >= 60) return 3;
  if (cape >= 1500 && precipProb >= 50) return 2;
  if (cape >= 700  && precipProb >= 40) return 1;
  return 0;
}
function snowTier(snowfallIn, minTempF) {
  if (snowfallIn >= 8) return 4;
  if (snowfallIn >= 4) return 3;
  if (snowfallIn >= 1.5) return 2;
  if (snowfallIn >= 0.3 || (minTempF <= 20 && snowfallIn > 0)) return 1;
  return 0;
}