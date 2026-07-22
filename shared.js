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

// Shared shear/helicity-proxy ingredients — pulled out so both the live
// sounding math (computeTornadoEnvironment) and the Outlooks technical-
// details panel (STP/SCP/SRH proxies) derive rotation potential from
// exactly the same numbers instead of two slightly different formulas.
function computeShearIngredients(windSpd, windDeg) {
  const isBackingWind = windDeg >= 150 && windDeg <= 260;
  const shearScore = (isBackingWind ? 1 : 0) + (windSpd >= 15 ? 1 : 0) + (windSpd >= 25 ? 1 : 0);
  const srh_proxy = isBackingWind ? windSpd * 1.8 : windSpd * 0.7;
  return { shearScore, srh_proxy, isBackingWind };
}

function computeTornadoEnvironment(li, cape, dewF, windSpd, windDeg, pressure) {
  const { shearScore, srh_proxy } = computeShearIngredients(windSpd, windDeg);
  const moistureOk    = dewF >= 55;
  const liftOk        = li <= -3;
  const instabilityOk = cape >= 500;
  const deepInstability = cape >= 1500 && li <= -5;

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

/* ════════════════════════════════════════════════
   OUTLOOKS-ONLY HELPERS
   Everything below this line is only used by the Outlooks
   page (outlooks.js). Kept in shared.js so it follows the
   same "one source of truth" pattern as the hazard tiers
   above, but none of it is touched by the Home tab.
════════════════════════════════════════════════ */

/* ── Estimated sounding fields ──
   Open-Meteo's free forecast endpoint doesn't expose a full vertical
   profile, so LCL/PWAT/STP/SCP here are approximations built from surface
   fields (temp/dewpoint/wind) using well-known rule-of-thumb formulas —
   NOT the official SPC calculations. They're presented in the Outlooks
   "Technical Details" panel with that caveat so enthusiasts get a useful
   ballpark without the app claiming precision it doesn't have. ── */
function estimateLCLmeters(tempF, dewF) {
  const tC = (tempF - 32) * 5/9, tdC = (dewF - 32) * 5/9;
  return Math.max(0, Math.round(125 * (tC - tdC)));
}
function estimatePWATin(dewF) {
  // Rough surface-dewpoint-based estimate (Lawrence 2005 style rule of thumb).
  const est = 0.027 * dewF - 0.35;
  return Math.max(0.1, Math.round(est * 100) / 100);
}
function estimateSTP(cape, li, dewF, windSpd, windDeg) {
  const { shearScore, srh_proxy } = computeShearIngredients(windSpd, windDeg);
  const lclM = estimateLCLmeters((li <= -2 ? 75 : 70), dewF); // rough sfc temp assumption when not passed directly
  const capeTerm  = Math.min(2, cape / 1500);
  const srhTerm   = Math.min(2, srh_proxy / 150);
  const shearTerm = Math.min(1.5, shearScore / 2);
  const lclTerm   = lclM < 1000 ? 1 : lclM < 1500 ? 0.6 : 0.2;
  return Math.round(capeTerm * srhTerm * shearTerm * lclTerm * 10) / 10;
}
function estimateSCP(cape, windSpd, windDeg) {
  const { shearScore, srh_proxy } = computeShearIngredients(windSpd, windDeg);
  const capeTerm  = Math.min(2, cape / 1000);
  const srhTerm   = Math.min(2, srh_proxy / 100);
  const shearTerm = Math.min(2, shearScore / 2);
  return Math.round(capeTerm * srhTerm * shearTerm * 10) / 10;
}

/* ── Forecast history (localStorage) ──
   Powers three related features honestly from the SAME real signal
   (how this location's outlook has changed across recent page loads),
   rather than fabricating multi-model comparisons the app has no access
   to:
     • Model Agreement   — has the risk category held steady across recent updates?
     • Why It Changed    — what specifically shifted since the last update?
   Forecast Confidence is a separate, independent signal (see below) based
   on hour-to-hour stability WITHIN today's model run, not run-to-run history. ── */
const OUTLOOK_HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function outlookHistoryKey(lat, lon) {
  return `outlookHistory:${lat.toFixed(2)},${lon.toFixed(2)}`;
}
function loadOutlookHistory(lat, lon) {
  try {
    const raw = localStorage.getItem(outlookHistoryKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.fetchedAt || Date.now() - Date.parse(parsed.fetchedAt) > OUTLOOK_HISTORY_MAX_AGE_MS) return null;
    return parsed;
  } catch(_) { return null; }
}
function saveOutlookHistory(lat, lon, days) {
  try {
    const snapshot = {
      fetchedAt: new Date().toISOString(),
      days: days.map(d => ({
        dateStr: d.date.toISOString().slice(0,10),
        tiers: d.tiers,
        maxCape: d.maxCape, minLi: d.minLi, maxWindGust: d.maxWindGust, snowfall: d.snowfall,
      })),
    };
    localStorage.setItem(outlookHistoryKey(lat, lon), JSON.stringify(snapshot));
  } catch(_) {}
}
function findHistoryDay(history, dateStr) {
  if (!history) return null;
  return history.days.find(d => d.dateStr === dateStr) || null;
}

function overallTier(tiers) { return Math.max(tiers.tornado, tiers.wind, tiers.hail, tiers.snow); }

function computeModelAgreement(prevDay, currDay) {
  if (!prevDay) return { level:'unknown', label:'Not Enough History', why:'This location doesn\u2019t have a recent forecast on record yet — check back after the next update to see how stable the outlook is.' };
  const diff = Math.abs(overallTier(prevDay.tiers) - overallTier(currDay.tiers));
  if (diff === 0) return { level:'excellent', label:'Excellent Agreement', why:'The risk category for this day has held steady since the last update.' };
  if (diff === 1) return { level:'good', label:'Good Agreement', why:'The outlook has shifted slightly since the last update, but the overall picture is similar.' };
  if (diff === 2) return { level:'mixed', label:'Mixed Solutions', why:'The outlook has changed noticeably since the last update — treat the details as less settled.' };
  return { level:'poor', label:'Poor Agreement', why:'The outlook has swung a lot since the last update. Confidence in the specifics is low right now.' };
}

function computeForecastChange(prevDay, currDay) {
  if (!prevDay) return null;
  const prevTierIdx = overallTier(prevDay.tiers), currTierIdx = overallTier(currDay.tiers);
  if (prevTierIdx === currTierIdx) return null;
  const capeDelta = currDay.maxCape - prevDay.maxCape;
  const liDelta = currDay.minLi - prevDay.minLi;
  const gustDelta = currDay.maxWindGust - prevDay.maxWindGust;
  let reason;
  if (capeDelta > 400 && liDelta < -0.5) reason = 'More instability and moisture moved into the forecast, increasing severe potential.';
  else if (capeDelta < -400) reason = 'Instability dropped compared to the last update, lowering severe potential.';
  else if (liDelta > 0.75) reason = 'Lift weakened compared to the last update, which lowered the risk.';
  else if (liDelta < -0.75) reason = 'Lift strengthened compared to the last update, which raised the risk.';
  else if (gustDelta > 10) reason = 'Peak wind gusts increased from the previous forecast.';
  else if (gustDelta < -10) reason = 'Peak wind gusts decreased from the previous forecast.';
  else if (Math.abs(currDay.snowfall - prevDay.snowfall) >= 1) reason = currDay.snowfall > prevDay.snowfall ? 'Modeled snowfall totals increased from the previous forecast.' : 'Modeled snowfall totals decreased from the previous forecast.';
  else reason = 'The overall model picture shifted since the last update.';
  return { prevTierIdx, currTierIdx, reason };
}

/* ── Forecast Confidence ──
   Independent of the history above: measures how much CAPE/LI swing
   hour-to-hour WITHIN today's convective window. A jumpy hourly profile
   means the timing/strength of storms is genuinely less certain even if
   the forecast hasn't changed run-to-run. ── */
function computeForecastConfidence(hourlyCape, hourlyLi) {
  if (!hourlyCape || hourlyCape.length < 2) return { level:'moderate', label:'Moderate', why:'Not enough hourly model data to judge stability — treating this as a moderate-confidence forecast.' };
  const capeRange = Math.max(...hourlyCape) - Math.min(...hourlyCape);
  const liRange = Math.max(...hourlyLi) - Math.min(...hourlyLi);
  if (capeRange < 400 && liRange < 2) return { level:'high', label:'High', why:'Most forecast hours agree on today\u2019s atmosphere, so the forecast is unlikely to change much.' };
  if (capeRange < 1200 && liRange < 4) return { level:'moderate', label:'Moderate', why:'The model shows some hour-to-hour disagreement, so storms could end up somewhat stronger or weaker than expected.' };
  return { level:'low', label:'Low', why:'The model swings a lot within the day — small atmospheric changes could significantly change today\u2019s forecast.' };
}

/* ── Plain-language hazard descriptions (spec §3) ── */
const HAZARD_PLAIN_LANGUAGE = {
  tornado: 'Isolated tornadoes are possible if strong thunderstorms develop.',
  wind:    'Some storms could produce damaging winds capable of knocking down trees and power lines.',
  hail:    'The strongest storms may produce hail large enough to damage vehicles.',
  snow:    'Snow may reduce visibility and make roads slippery.',
};

/* ── "What Should I Do?" action lists (spec §14), only shown for hazards
   with tier > 0 for the selected day. ── */
const HAZARD_ACTIONS = {
  tornado: ['Know where you\u2019ll shelter — lowest floor, interior room, away from windows.', 'Enable weather alerts on your phone.', 'Be ready to act quickly if a warning is issued.'],
  wind:    ['Secure loose outdoor items like furniture and trash cans.', 'Charge phones and other electronics in case of a power outage.', 'Park vehicles away from large trees if possible.'],
  hail:    ['Move vehicles under cover if you can.', 'Bring pets indoors.', 'Stay away from windows and skylights during storms.'],
  snow:    ['Slow down and leave extra distance while traveling.', 'Carry emergency supplies (blanket, water, phone charger) if driving.', 'Watch for icy patches on bridges and overpasses.'],
};

/* ── "Why This Risk?" dynamic generator (spec §13) ──
   Picks the most relevant plain-English explanation from the combination
   of ingredients rather than a single canned sentence per tier. ── */
function whyThisRisk(day) {
  const { cape, li, maxDew, maxWindGust, maxWindSpd } = { cape: day.maxCape, li: day.minLi, maxDew: day.maxDew, maxWindGust: day.maxWindGust, maxWindSpd: day.maxWindSpd };
  const strongCape = cape >= 1500, weakCape = cape < 500;
  const strongShear = maxWindSpd >= 25, weakShear = maxWindSpd < 12;
  const dry = maxDew < 50;
  const weakLift = li > 0;

  if (dry) return 'Dry air is limiting storm development, even with other ingredients present.';
  if (weakLift && cape < 1000) return 'There is little lift available to trigger thunderstorms today.';
  if (strongCape && weakShear) return 'The atmosphere has plenty of energy, but storms are unlikely to stay organized without stronger winds aloft.';
  if (weakCape && strongShear) return 'Winds favor organized storms, but limited energy reduces severe potential.';
  if (strongCape && strongShear) return 'Both instability and wind patterns support organized severe thunderstorms.';
  if (cape >= 800 && maxWindGust >= 45) return 'Enough instability and wind energy are present for isolated strong-to-severe storms.';
  return 'A mix of modest instability and typical wind patterns keeps today\u2019s severe potential limited.';
}

/* ── Expected Timeline (spec §18) ──
   Buckets the day's hourly profile into rough time-of-day windows and
   labels each relative to the day's peak instability, instead of a
   hardcoded schedule. ── */
const TIMELINE_BUCKETS = [
  { key:'overnight', label:'12 AM – 6 AM', startH:0,  endH:6  },
  { key:'morning',    label:'6 AM – 9 AM',  startH:6,  endH:9  },
  { key:'midday',     label:'9 AM – 12 PM', startH:9,  endH:12 },
  { key:'afternoon',  label:'12 PM – 4 PM', startH:12, endH:16 },
  { key:'evening',    label:'4 PM – 8 PM',  startH:16, endH:20 },
  { key:'night',      label:'8 PM – 12 AM', startH:20, endH:24 },
];
function computeTimeline(hourlyCapeByHour) {
  // hourlyCapeByHour: array of 24 CAPE values (local hours 0-23) for the selected day.
  if (!hourlyCapeByHour || hourlyCapeByHour.length < 24) return null;
  const bucketVals = TIMELINE_BUCKETS.map(b => {
    const slice = hourlyCapeByHour.slice(b.startH, b.endH);
    const avg = slice.reduce((s,v) => s+v, 0) / (slice.length || 1);
    return { ...b, avgCape: avg };
  });
  const peak = Math.max(...bucketVals.map(b => b.avgCape), 1);
  return bucketVals.map(b => {
    const frac = b.avgCape / peak;
    let status;
    if (peak < 300) status = 'Quiet';
    else if (frac >= 0.85) status = 'Highest Risk';
    else if (frac >= 0.5) status = b.startH < 13 ? 'Storm Development' : 'Storms Weaken';
    else status = 'Quiet';
    return { label: b.label, status };
  });
}