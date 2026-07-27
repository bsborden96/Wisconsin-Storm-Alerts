/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Self-contained rebuild.

   Depends (optionally) on shared.js / bg-canvas.js loaded
   first for window.setBgMode / window.setDaytime and a few
   helpers (degToCompass, dewLabel, alertPriorityScore,
   isTornadoLevel, parseMovement, toggleMenu). If those
   aren't already defined by shared.js, safe fallbacks are
   provided below so this file also works on its own.

   What this builds every loop:
     1. Gets the user's location (geolocation, falls back
        to a default point if denied/unavailable).
     2. Pulls live conditions + forecast from Open-Meteo and
        alerts + city/state + forecast text from api.weather.gov.
     3. Pulls the SPC Day 1 categorical outlook and figures out
        which risk polygon (if any) covers the user's point.
     4. Builds a natural-sounding, non-repeating script (varied
        phrase banks + varied sentence templates for each data
        point) and speaks it with the browser's TTS, preferring
        a male voice.
     5. Loops: when the script finishes, it quietly refreshes
        data and builds a new script before continuing — so a
        long-running broadcast never repeats itself verbatim.
     6. Polls for newly issued watches/warnings/emergencies in
        the background and interrupts the loop immediately if
        one appears, then resumes where it left off.
════════════════════════════════════════════════ */

/* ── STATE ─────────────────────────────────────────── */
let liveLat = 43.42, liveLon = -88.71;     // fallback point (used until geolocation resolves)
let liveCityState = null;
let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;
let liveMuted = false;
let liveMusic = null;
let musicEnabled = true;
let liveBroadcastContext = null;
let broadcastLoopCount = 0;
const spokenFactMemory = new Map();

/* ── SAFE FALLBACKS FOR SHARED HELPERS ───────────────
   Only defined if shared.js / bg-canvas.js hasn't already
   provided them — never overwrites an existing one. */
(function installFallbacks() {
  const set = (name, fn) => { if (typeof window[name] !== 'function') window[name] = fn; };

  set('setBgMode', function () {});
  set('setDaytime', function () {});

  set('degToCompass', function (deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return '';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  });

  set('dewLabel', function (dewF) {
    if (dewF === null || dewF === undefined) return '';
    if (dewF < 50) return 'very comfortable';
    if (dewF < 60) return 'comfortable';
    if (dewF < 65) return 'a bit sticky';
    if (dewF < 70) return 'muggy';
    if (dewF < 75) return 'oppressive';
    return 'brutally humid';
  });

  set('alertPriorityScore', function (event) {
    const e = String(event || '').toLowerCase();
    const table = [
      ['tornado emergency', 0], ['tornado warning', 1], ['flash flood emergency', 2],
      ['severe thunderstorm warning', 3], ['flash flood warning', 4], ['tornado watch', 5],
      ['severe thunderstorm watch', 6], ['flood warning', 7], ['winter storm warning', 8],
      ['ice storm warning', 9], ['blizzard warning', 10], ['high wind warning', 11],
      ['excessive heat warning', 12], ['winter weather advisory', 13], ['wind advisory', 14],
      ['heat advisory', 15], ['flood advisory', 16], ['dense fog advisory', 17]
    ];
    for (const [needle, score] of table) if (e.includes(needle)) return score;
    return 50;
  });

  set('isTornadoLevel', function (event) { return /tornado/i.test(event || ''); });

  set('parseMovement', function (desc) {
    const m = /moving\s+([nsew]{1,3})\s+at\s+(\d+)\s*mph/i.exec(desc || '');
    if (!m) return null;
    return { dir: m[1].toUpperCase(), spd: m[2] };
  });

  set('toggleMenu', function () {
    const panel = document.getElementById('menuPanel');
    const btn = document.getElementById('menuBtn');
    if (!panel) return;
    const willOpen = panel.style.display !== 'block';
    panel.style.display = willOpen ? 'block' : 'none';
    if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
})();

/* ── SMALL UTILITIES ──────────────────────────────── */
async function safeFetch(url, opts = {}) {
  const { timeout = 10000, ...rest } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

function timeAgo(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'moments ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

function cToF(c) { return c === null || c === undefined ? null : Math.round(c * 9 / 5 + 32); }

/* ── PERSONALITY / PHRASE BANKS ──────────────────────
   Vector's "voice." Pools of interchangeable phrasing so
   the continuously-looping broadcast doesn't sound like a
   script being re-read. pickPhrase() cycles a pool without
   repeating an entry until every entry has been used once,
   then reshuffles. */
const phraseHistory = {};
function pickPhrase(pool, category) {
  if (!pool || pool.length === 0) return '';
  if (!phraseHistory[category]) phraseHistory[category] = new Set();
  const used = phraseHistory[category];
  let choices = pool.map((_, i) => i).filter(i => !used.has(i));
  if (choices.length === 0) { used.clear(); choices = pool.map((_, i) => i); }
  const chosen = choices[Math.floor(Math.random() * choices.length)];
  used.add(chosen);
  return pool[chosen];
}
function fill(tpl, vals) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vals[k] !== undefined ? vals[k] : ''));
}
function pickFilled(pool, category, vals) {
  return fill(pickPhrase(pool, category), vals);
}

const PHRASES = {
  liveOpeners: [
    "You're watching StormVector Live.",
    "This is StormVector Live, with Vector on weather.",
    "StormVector Live is on the air.",
    "You're tuned to StormVector Live weather coverage."
  ],
  transitions: [
    "Looking ahead,", "Later today,", "Moving into tonight,",
    "As we head toward tomorrow,", "Here's what comes next —",
    "Switching gears,", "Now, here's something worth watching —",
    "Meanwhile,"
  ],
  quietObservations: [
    "Looks like another beautiful day out there.",
    "If you're headed outside later, today is a great day to enjoy it.",
    "Nothing but calm skies to report right now.",
    "It's the kind of day that makes forecasting easy.",
    "Can't complain about weather like this.",
    "A quiet stretch like this is worth soaking up."
  ],
  gloomyObservations: [
    "It's a gray one out there today.",
    "Keep the umbrella handy — it's a soggy stretch.",
    "Not the prettiest day, but nothing dangerous either.",
    "A little dreary, but that's about it."
  ],
  closers: [
    "That's your StormVector update. I'll be back with the latest as conditions change. Stay weather-aware.",
    "That wraps up this update — I'll keep watching and update you as soon as anything changes.",
    "That's where things stand for now. I'll be right back with any changes.",
    "I'll leave it there for now — back shortly with the latest."
  ],
  greetingsQuiet: [
    "Good to have you with us.",
    "Thanks for tuning in.",
    "Glad you're here."
  ],
  greetingsNormal: [
    "Hi, I'm Vector.",
    "Welcome back, I'm Vector.",
    "Vector here with your latest."
  ],
  currentConditions: [
    "Right now it's {tempF} degrees{feelsClause}.",
    "Taking a look outside, we're at {tempF} degrees{feelsClause}.",
    "Current temperature is sitting at {tempF} degrees{feelsClause}.",
    "As of this moment it's {tempF} out there{feelsClause}."
  ],
  radarQuiet: [
    "Radar is clear across the area right now.",
    "Nothing showing up on radar at the moment.",
    "Radar's quiet — no precipitation in sight locally.",
    "Scanning radar now, and it's a clean picture."
  ],
  radarActive: [
    "On radar, {radarDesc} moving through the area.",
    "Radar is picking up {radarDesc} nearby.",
    "Taking a look at radar, {radarDesc} in the vicinity.",
    "Radar shows {radarDesc} right now."
  ],
  windDiscussion: [
    "Wind is out of the {windDir} at {windSpd} miles per hour{gustClause}.",
    "We've got a {windDir} wind running {windSpd} miles per hour{gustClause}.",
    "Winds are blowing from the {windDir} at {windSpd} miles per hour{gustClause}.",
    "Breezy out there — {windDir} winds around {windSpd} miles per hour{gustClause}."
  ],
  humidityDiscussion: [
    "Humidity is at {humidity} percent, so it feels {dewLabel} outside.",
    "Dew point's at {dewF}, which makes the air feel {dewLabel}.",
    "It's {dewLabel} out there, with humidity holding around {humidity} percent.",
    "The moisture in the air is {dewLabel} right now, dew point near {dewF}."
  ],
  confidence: [
    "Confidence in this forecast is good — we're not expecting any surprises.",
    "Models are in solid agreement on where things are headed.",
    "This one's a fairly high-confidence forecast.",
    "There's a bit of spread in the guidance, so we'll keep watching it closely."
  ],
  safety: [
    "As always, keep a way to get weather alerts handy in case anything changes quickly.",
    "If you've got outdoor plans, keep an eye on the sky and have a backup plan ready.",
    "Good time for a quick reminder — know where you'd shelter if severe weather popped up.",
    "Nothing urgent right now, but it never hurts to have your weather app notifications on."
  ],
  sunTimes: [
    "Sunrise was at {sunrise} this morning, and sunset comes at {sunset} tonight.",
    "We'll lose daylight around {sunset} this evening — sunrise tomorrow near {sunriseTomorrow}.",
    "Today's daylight runs from {sunrise} to {sunset}."
  ],
  trivia: [
    "A bit of weather trivia for you — lightning can strike the same spot more than once, and often does.",
    "Fun fact — no two snowflakes are truly identical, right down to the molecular structure.",
    "Here's one for you — the fastest wind gust ever recorded was 253 miles per hour, during a tropical cyclone.",
    "Weather trivia — a 'sun dog' is a bright spot near the sun caused by ice crystals in the air, and it's more common than you'd think.",
    "Did you know — thunder is never heard more than about 10 miles from its lightning strike."
  ]
};

function weatherCodePhrase(wcode) {
  if ([95, 96, 99].includes(wcode)) return 'thunderstorms';
  if ([71, 73, 75, 77, 85, 86].includes(wcode)) return 'snow';
  if ([61, 63, 65, 80, 81, 82].includes(wcode)) return 'rain showers';
  if ([56, 57, 66, 67].includes(wcode)) return 'freezing precipitation';
  if ([45, 48].includes(wcode)) return 'fog';
  return null;
}

/* ── PRODUCER "WHAT CHANGED" TRACKING ────────────────
   Lets Vector reference what's different since the last
   loop instead of re-reading identical numbers. */
function rememberFact(key, value) {
  const previous = spokenFactMemory.get(key);
  spokenFactMemory.set(key, value);
  return previous;
}
function changedPhrase(key, value, formatter) {
  const previous = rememberFact(key, value);
  if (previous === undefined || previous === value) return '';
  return formatter(previous, value);
}
function renderForSpeech(text) {
  return String(text || '')
    .replace(/StormVector Live/g, 'StormVector Lyve')
    .replace(/\blive\b/g, 'lyve')
    .replace(/\bSPC\b/g, 'S P C')
    .replace(/\bNWS\b/g, 'National Weather Service')
    .replace(/\bENS\b/g, 'E N S')
    .replace(/\bmph\b/g, 'miles per hour');
}
function polishSegments(segs) {
  const seen = new Set();
  return segs
    .map(s => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(s => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function addProducerBrief(segs, ctx, plan) {
  const tempTrend = changedPhrase('tempF', ctx.tempF, (oldVal, newVal) =>
    `Producer note: temperatures have ${newVal > oldVal ? 'climbed' : 'dropped'} from ${oldVal} to ${newVal} degrees since our last update.`);
  const alertTrend = changedPhrase('alertCount', ctx.alerts.length, (oldVal, newVal) =>
    `Producer update: active alerts have changed from ${oldVal} to ${newVal}.`);
  if (alertTrend) { segs.push(alertTrend); return; }
  if (tempTrend && broadcastLoopCount > 0) { segs.push(tempTrend); return; }
  if (plan.priority === 'quiet') {
    segs.push(`The producer is seeing ${weatherCodePhrase(ctx.wcode) ? weatherCodePhrase(ctx.wcode) + ' around' : 'quiet conditions'}, so we'll keep this one conversational.`);
    return;
  }
  segs.push(`We're leading with ${plan.lead === 'conditions' ? 'current conditions' : plan.lead} this time through, then the rest of the forecast.`);
}

/* ── SEGMENT BUILDERS ─────────────────────────────── */
function addCurrentConditions(segs, ctx) {
  const feelsClause = (ctx.feelsF !== null && Math.abs(ctx.feelsF - ctx.tempF) >= 3)
    ? `, feeling more like ${ctx.feelsF}`
    : '';
  segs.push(pickFilled(PHRASES.currentConditions, 'currentConditions', { tempF: ctx.tempF, feelsClause }));

  const rd = weatherCodePhrase(ctx.wcode);
  if (rd) segs.push(pickFilled(PHRASES.radarActive, 'radar', { radarDesc: rd }));
  else segs.push(pickPhrase(PHRASES.radarQuiet, 'radar'));
}

function addWindDiscussion(segs, ctx) {
  const gustClause = (ctx.windG && ctx.windG > ctx.windSpd + 5) ? `, gusting to ${ctx.windG}` : '';
  segs.push(pickFilled(PHRASES.windDiscussion, 'wind', {
    windDir: window.degToCompass(ctx.windDeg), windSpd: ctx.windSpd, gustClause
  }));
  if (ctx.windSpd >= 30 || ctx.windG >= 45) {
    segs.push("That's strong enough to snap small branches and make travel a little dicey in high-profile vehicles — secure anything loose outside.");
  }
}

function addHumidityDiscussion(segs, ctx) {
  if (ctx.dewF === null) return;
  segs.push(pickFilled(PHRASES.humidityDiscussion, 'humidity', {
    humidity: ctx.humidity, dewF: ctx.dewF, dewLabel: window.dewLabel(ctx.dewF)
  }));
}

function addShortForecast(segs, forecast) {
  if (!forecast || !forecast.today) return;
  segs.push(`${pickPhrase(PHRASES.transitions, 'transitions')} ${forecast.today}`);
}

function addTonightForecast(segs, forecast) {
  if (!forecast || !forecast.tonight) return;
  segs.push(`Tonight, ${forecast.tonight.replace(/^tonight,?\s*/i, '').toLowerCase()}`);
}

function addAlerts(segs, alerts) {
  if (!alerts || alerts.length === 0) return;
  const sorted = [...alerts].sort((a, b) =>
    window.alertPriorityScore(a.properties?.event || '') - window.alertPriorityScore(b.properties?.event || ''));
  sorted.slice(0, 2).forEach(a => {
    const p = a.properties || {};
    const area = (p.areaDesc || 'your area').split(';')[0];
    const until = p.expires ? new Date(p.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    const hazardBits = [];
    const desc = p.description || '';
    const hailM = /([\d.]+)\s*inch(?:es)?\s*hail/i.exec(desc);
    const windM = /(\d+)\s*mph/i.exec(desc);
    if (hailM) hazardBits.push(`hail up to ${hailM[1]} inches`);
    if (windM) hazardBits.push(`wind gusts near ${windM[1]} miles per hour`);
    const hazardClause = hazardBits.length ? ` The main threats are ${hazardBits.join(' and ')}.` : '';
    segs.push(`A ${p.event || 'weather alert'} is in effect for ${area}${until ? `, until ${until}` : ''}.${hazardClause}`);
  });
  if (alerts.length > sorted.slice(0, 2).length) {
    segs.push(`There ${alerts.length - 2 === 1 ? 'is' : 'are'} ${alerts.length - 2} additional alert${alerts.length - 2 === 1 ? '' : 's'} posted for the area as well.`);
  }
}

function addSpcOutlook(segs, spc) {
  if (!spc) return;
  const labels = {
    TSTM: 'a general thunderstorm risk',
    MRGL: 'a marginal severe weather risk',
    SLGT: 'a slight severe weather risk',
    ENH: 'an enhanced severe weather risk',
    MDT: 'a moderate severe weather risk',
    HIGH: 'a high — and rare — severe weather risk'
  };
  const label = labels[spc];
  if (!label) return;
  segs.push(`The Storm Prediction Center has your area under ${label} today. Worth keeping an eye on as the afternoon develops.`);
}

function addSunTimes(segs, ctx) {
  if (!ctx.sunrise || !ctx.sunset) return;
  segs.push(pickFilled(PHRASES.sunTimes, 'sun', { sunrise: ctx.sunrise, sunset: ctx.sunset, sunriseTomorrow: ctx.sunrise }));
}

function addSeasonalTrivia(segs) {
  segs.push(pickPhrase(PHRASES.trivia, 'trivia'));
}

function addForecastConfidence(segs) {
  segs.push(pickPhrase(PHRASES.confidence, 'confidence'));
}

function addSafetyReminder(segs) {
  segs.push(pickPhrase(PHRASES.safety, 'safety'));
}

/* ── BROADCAST PLAN ───────────────────────────────── */
function createBroadcastPlan({ alerts, tempF, windSpd, windG, dewF, wcode, spc }) {
  const hasWarning = alerts.some(a => /Warning|Emergency/i.test(a.properties?.event || ''));
  const hasWatch = alerts.some(a => /Watch/i.test(a.properties?.event || ''));
  const windy = windSpd >= 20 || windG >= 30;
  const hot = tempF !== null && tempF >= 92;
  const cold = [71, 73, 75, 77, 85, 86, 56, 57, 66, 67].includes(wcode);
  const wet = weatherCodePhrase(wcode) !== null;

  let intro = 'normal';
  let priority = 'active';
  let lead = 'conditions';

  if (hasWarning) { intro = 'breaking'; priority = 'severe'; lead = 'alerts'; }
  else if (hasWatch) { intro = 'normal'; priority = 'severe'; lead = 'alerts'; }
  else if (windy) { intro = 'wind'; lead = 'wind'; }
  else if (hot) { intro = 'heat'; lead = 'heat'; }
  else if (!wet && !cold && !hasWatch && windSpd < 12) { intro = 'quiet'; priority = 'quiet'; lead = 'conditions'; }

  const personality = priority === 'quiet' || priority === 'active' ? 'full' : 'reduced';

  const segments = [];
  if (priority === 'severe') segments.push('alerts');
  segments.push('currentConditions');
  if (windy) segments.push('windDiscussion');
  if (dewF !== null && (dewF >= 65 || hot)) segments.push('humidity');
  segments.push('shortForecast', 'tonight');
  if (spc) segments.push('spcOutlook');

  // Rotate in one "flavor" segment per loop so it never feels canned.
  const flavorPool = ['sunTimes', 'trivia', 'confidence'];
  const flavor = flavorPool[broadcastLoopCount % flavorPool.length];
  segments.push(flavor);

  if (priority === 'severe') segments.push('safety');
  segments.push('closing');

  return { intro, priority, lead, personality, segments };
}

/* ── DATA FETCHING ────────────────────────────────── */
async function fetchAlerts(lat, lon) {
  try {
    const res = await safeFetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { timeout: 10000 });
    const data = await res.json();
    return data.features || [];
  } catch (_) { return []; }
}

async function fetchNwsContext(lat, lon) {
  try {
    const res = await safeFetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { timeout: 10000 });
    const data = await res.json();
    const props = data.properties || {};
    const cityState = props.relativeLocation?.properties
      ? `${props.relativeLocation.properties.city}, ${props.relativeLocation.properties.state}`
      : null;
    let today = null, tonight = null;
    if (props.forecast) {
      try {
        const fRes = await safeFetch(props.forecast, { timeout: 10000 });
        const fData = await fRes.json();
        const periods = fData.properties?.periods || [];
        const dayPeriod = periods.find(p => p.isDaytime) || periods[0];
        const nightPeriod = periods.find(p => !p.isDaytime);
        today = dayPeriod?.detailedForecast || dayPeriod?.shortForecast || null;
        tonight = nightPeriod?.detailedForecast || nightPeriod?.shortForecast || null;
      } catch (_) { /* forecast text optional */ }
    }
    return { cityState, forecast: { today, tonight } };
  } catch (_) {
    return { cityState: null, forecast: { today: null, tonight: null } };
  }
}

async function fetchOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
  const res = await safeFetch(url, { timeout: 10000 });
  const data = await res.json();
  const c = data.current || {};
  const d = data.daily || {};
  const fmt = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  return {
    tempF: c.temperature_2m !== undefined ? Math.round(c.temperature_2m) : null,
    feelsF: c.apparent_temperature !== undefined ? Math.round(c.apparent_temperature) : null,
    humidity: c.relative_humidity_2m !== undefined ? Math.round(c.relative_humidity_2m) : null,
    dewF: c.dew_point_2m !== undefined ? Math.round(c.dew_point_2m) : null,
    wcode: c.weather_code !== undefined ? c.weather_code : null,
    windSpd: c.wind_speed_10m !== undefined ? Math.round(c.wind_speed_10m) : 0,
    windDeg: c.wind_direction_10m !== undefined ? c.wind_direction_10m : 0,
    windG: c.wind_gusts_10m !== undefined ? Math.round(c.wind_gusts_10m) : 0,
    sunrise: fmt(d.sunrise?.[0]),
    sunset: fmt(d.sunset?.[0])
  };
}

/* SPC Day 1 categorical outlook — point-in-polygon lookup. */
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygonCoords(pt, coords) {
  if (!coords || !coords[0] || !pointInRing(pt, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) if (pointInRing(pt, coords[i])) return false;
  return true;
}
function pointInGeometry(pt, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygonCoords(pt, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => pointInPolygonCoords(pt, poly));
  return false;
}
const SPC_RANK = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };
async function fetchSpcOutlook(lat, lon) {
  try {
    const res = await safeFetch('https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson', { timeout: 8000 });
    const data = await res.json();
    const pt = [lon, lat];
    let best = null;
    for (const feature of data.features || []) {
      const label = String(feature.properties?.LABEL || feature.properties?.label || '').toUpperCase();
      if (!SPC_RANK[label]) continue;
      if (pointInGeometry(pt, feature.geometry)) {
        if (!best || SPC_RANK[label] > SPC_RANK[best]) best = label;
      }
    }
    return best;
  } catch (_) { return null; }
}

function renderConditionsRow({ tempF, feelsF, windSpd, windDeg, windG, dewF, humidity }) {
  const el = document.getElementById('liveConditionsRow');
  if (!el) return;
  const chip = (label, val) => `<div class="live-chip"><span class="live-chip-label">${label}</span><span class="live-chip-val">${val}</span></div>`;
  el.innerHTML = [
    tempF !== null ? chip('Temp', `${tempF}°F`) : '',
    feelsF !== null ? chip('Feels', `${feelsF}°F`) : '',
    dewF !== null ? chip('Dew Point', `${dewF}°F`) : '',
    humidity !== null && humidity !== undefined ? chip('Humidity', `${humidity}%`) : '',
    chip('Wind', `${window.degToCompass(windDeg)} ${windSpd} mph`),
    windG > windSpd + 5 ? chip('Gusts', `${windG} mph`) : '',
  ].join('');
}

function setBroadcastBg({ wcode, alerts }) {
  const hasTornado = alerts.some(a => window.isTornadoLevel(a.properties?.event || ''));
  if (hasTornado) { window.setBgMode('tornado'); return; }
  if ([95, 96, 99].includes(wcode)) window.setBgMode('storm');
  else if ([71, 73, 75, 77, 85, 86].includes(wcode)) window.setBgMode('snow');
  else if ([45, 48].includes(wcode)) window.setBgMode('fog');
  else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(wcode)) window.setBgMode('rain');
  else if (wcode === 1) window.setBgMode('partlycloudy');
  else window.setBgMode('clear');
}

/* ── SCRIPT BUILDING ──────────────────────────────── */
function buildScript(ctx) {
  const { cityState, tempF, feelsF, windSpd, windDeg, windG, wcode, dewF, humidity, alerts, forecast, spc } = ctx;
  const segs = [];
  const plan = createBroadcastPlan({ alerts, tempF, windSpd, windG, dewF, wcode, spc });

  let lastVisit = null;
  try { lastVisit = localStorage.getItem('stormvectorLastVisit'); } catch (_) {}
  const greetName = cityState ? `for ${cityState}` : 'for your area';

  segs.push(pickPhrase(PHRASES.liveOpeners, 'liveOpeners'));

  let intro;
  switch (plan.intro) {
    case 'breaking': intro = 'This is StormVector Breaking Weather.'; break;
    case 'wind': intro = "Let's begin with today's windy conditions."; break;
    case 'heat': intro = "Let's take a look at today's heat."; break;
    case 'quiet': intro = pickPhrase(PHRASES.greetingsQuiet, 'greetQuiet'); break;
    default: intro = pickPhrase(PHRASES.greetingsNormal, 'greetNormal');
  }

  if (lastVisit && Date.now() - parseInt(lastVisit, 10) < 6 * 3600 * 1000) {
    segs.push(`${intro} Since your last visit ${timeAgo(Date.now() - parseInt(lastVisit, 10))}, here's what's changed ${greetName}.`);
  } else {
    segs.push(`${intro} Here's your live StormVector forecast ${greetName}.`);
  }

  if (plan.personality === 'full') {
    const isGloomy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 45, 48].includes(wcode);
    segs.push(pickPhrase(isGloomy ? PHRASES.gloomyObservations : PHRASES.quietObservations, 'observation'));
  }

  addProducerBrief(segs, ctx, plan);

  const segmentBuilders = {
    currentConditions: () => addCurrentConditions(segs, ctx),
    shortForecast: () => addShortForecast(segs, forecast),
    tonight: () => addTonightForecast(segs, forecast),
    alerts: () => addAlerts(segs, alerts),
    windDiscussion: () => addWindDiscussion(segs, ctx),
    humidity: () => addHumidityDiscussion(segs, ctx),
    spcOutlook: () => addSpcOutlook(segs, spc),
    sunTimes: () => addSunTimes(segs, ctx),
    trivia: () => addSeasonalTrivia(segs),
    confidence: () => addForecastConfidence(segs),
    safety: () => addSafetyReminder(segs),
    closing: () => {}
  };
  for (const id of plan.segments) { const fn = segmentBuilders[id]; if (fn) fn(); }

  segs.push(pickPhrase(PHRASES.closers, 'closers'));
  liveSegments = polishSegments(segs);
  liveBroadcastContext = { ...ctx, plan };
  liveSegIdx = 0;
}

/* ── LOCATION + DATA REFRESH ──────────────────────── */
function initLocation() {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) { resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { liveLat = pos.coords.latitude; liveLon = pos.coords.longitude; resolve(); },
      () => resolve(),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

async function prepareBroadcast() {
  const card = document.getElementById('liveLocationCard');
  const [nws, om, alerts, spc] = await Promise.all([
    fetchNwsContext(liveLat, liveLon),
    fetchOpenMeteo(liveLat, liveLon).catch(() => ({})),
    fetchAlerts(liveLat, liveLon),
    fetchSpcOutlook(liveLat, liveLon)
  ]);

  liveCityState = nws.cityState;
  if (card) card.textContent = liveCityState || `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`;

  const ctx = {
    cityState: liveCityState,
    tempF: om.tempF ?? null,
    feelsF: om.feelsF ?? null,
    windSpd: om.windSpd ?? 0,
    windDeg: om.windDeg ?? 0,
    windG: om.windG ?? 0,
    wcode: om.wcode ?? null,
    dewF: om.dewF ?? null,
    humidity: om.humidity ?? null,
    sunrise: om.sunrise ?? null,
    sunset: om.sunset ?? null,
    alerts,
    forecast: nws.forecast,
    spc
  };

  renderConditionsRow(ctx);
  setBroadcastBg(ctx);
  buildScript(ctx);
}

/* ── VOICE / MUSIC ────────────────────────────────── */
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  liveVoice =
    voices.find(v => /en-US/i.test(v.lang) &&
      /(David|Daniel|Aaron|Microsoft David|Google US English Male|Alex|Tom)/i.test(v.name)) ||
    voices.find(v => /Male/i.test(v.name)) ||
    voices.find(v => /en-US/i.test(v.lang)) ||
    voices[0] || null;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = pickVoice;
  pickVoice();
}

function startMusic() {
  if (!musicEnabled) return;
  if (!liveMusic) liveMusic = document.getElementById('liveMusic');
  if (!liveMusic) return;
  liveMusic.volume = 0.35;
  liveMusic.loop = true;
  liveMusic.play().catch(() => {});
}
function stopMusic() {
  if (!liveMusic) return;
  liveMusic.pause();
  liveMusic.currentTime = 0;
}

/* ── BREAKING WEATHER BANNER STYLES ──────────────── */
(function injectBreakingBannerStyles() {
  const style = document.createElement('style');
  style.textContent = `
.live-breaking-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  background: repeating-linear-gradient(45deg, #ff2d2d, #ff2d2d 14px, #b40000 14px, #b40000 28px);
  color: #fff; font-family: 'Share Tech Mono', monospace; letter-spacing: .08em;
  text-align: center; padding: 10px 12px; font-weight: 700;
  box-shadow: 0 4px 18px rgba(0,0,0,.4);
  animation: breakingFlash 1s steps(2, start) infinite;
}
@keyframes breakingFlash { 50% { filter: brightness(1.25); } }
`;
  document.head.appendChild(style);
})();

/* ── SEVERE WEATHER INTERRUPTION ─────────────────────
   While a broadcast is running, poll for newly-issued
   watch/warning/emergency alerts. If one appears, cancel
   whatever's being said, sound the tone, deliver Breaking
   Weather Mode immediately, then resume the normal loop. */
let knownPriorityAlertIds = new Set();
let breakingWeatherActive = false;
let severeWatchTimer = null;
let resumeSegIdxAfterBreak = 0;

function startSevereWatch() {
  stopSevereWatch();
  severeWatchTimer = setInterval(checkForBreakingWeather, 60000);
}
function stopSevereWatch() {
  if (severeWatchTimer) { clearInterval(severeWatchTimer); severeWatchTimer = null; }
}

async function checkForBreakingWeather() {
  if (liveMuted || breakingWeatherActive) return;
  try {
    const res = await safeFetch(`https://api.weather.gov/alerts/active?point=${liveLat.toFixed(4)},${liveLon.toFixed(4)}`, { timeout: 10000 });
    const data = await res.json();
    const alerts = data.features || [];
    const priorityAlerts = alerts
      .filter(a => /Warning|Watch|Emergency/i.test(a.properties?.event || ''))
      .sort((a, b) => window.alertPriorityScore(a.properties?.event || '') - window.alertPriorityScore(b.properties?.event || ''));
    const newOnes = priorityAlerts.filter(a => !knownPriorityAlertIds.has(a.id));
    priorityAlerts.forEach(a => knownPriorityAlertIds.add(a.id));
    if (newOnes.length > 0) interruptForBreakingWeather(newOnes[0]);
  } catch (_) { /* never let a failed check disrupt the live broadcast */ }
}

async function playEASTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const dur = 3.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    gain.connect(ctx.destination);
    [853, 960].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    });
    await new Promise(resolve => setTimeout(resolve, dur * 1000 + 150));
    try { ctx.close(); } catch (_) {}
  } catch (_) { /* tone is decorative — never block the warning on it */ }
}

async function interruptForBreakingWeather(priorityAlert) {
  breakingWeatherActive = true;
  resumeSegIdxAfterBreak = liveSegIdx;
  speechSynthesis.cancel();
  setLiveBadge('BREAKING');
  showBreakingBanner(true);

  await playEASTone();

  const event = priorityAlert.properties?.event || 'weather alert';
  const mv = window.parseMovement(priorityAlert.properties?.description || '');
  const isWarning = /Warning|Emergency/i.test(event);
  const breakingSegs = [
    'This is the StormVector interruption tone. Stand by for urgent weather information.',
    `A ${event} is in effect for ${(priorityAlert.properties?.areaDesc || 'your area').split(';')[0]}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ''} ${isWarning ? 'Move to a safe place now if you are in the warned area.' : 'Review your safety plan and be ready to act if warnings are issued.'}`,
    'I am returning to the broadcast, but this alert stays at the top of the rundown.'
  ];

  await speakSequential(breakingSegs);

  breakingWeatherActive = false;
  showBreakingBanner(false);
  if (!liveMuted) speakSegment(resumeSegIdxAfterBreak);
}

function speakSequential(list) {
  return new Promise(resolve => {
    let idx = 0;
    const next = () => {
      if (idx >= list.length) { resolve(); return; }
      const utter = new SpeechSynthesisUtterance(renderForSpeech(list[idx]));
      if (liveVoice) utter.voice = liveVoice;
      utter.rate = 0.94; utter.pitch = 1.0;
      utter.onstart = () => {
        const cap = document.getElementById('liveCaptionText');
        if (cap) cap.textContent = list[idx];
        announce(list[idx]);
      };
      utter.onend = () => { idx++; next(); };
      utter.onerror = () => { idx++; next(); };
      speechSynthesis.speak(utter);
    };
    next();
  });
}

function showBreakingBanner(show) {
  const el = document.getElementById('liveBreakingBanner');
  if (!el) return;
  el.hidden = !show;
}

/* ── ANDROID / MOBILE RELIABILITY ────────────────────
   Chrome on Android has a known bug where speechSynthesis
   silently stops after ~15s on a long utterance queue.
   Nudging it with pause()/resume() periodically fixes it. */
let speechKeepAlive = null;
function startSpeechKeepAlive() {
  stopSpeechKeepAlive();
  if (!/Android/i.test(navigator.userAgent)) return;
  speechKeepAlive = setInterval(() => {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      speechSynthesis.resume();
    }
  }, 10000);
}
function stopSpeechKeepAlive() {
  if (speechKeepAlive) { clearInterval(speechKeepAlive); speechKeepAlive = null; }
}

let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
  catch (_) { /* wake lock is a nicety, not a requirement */ }
}
function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch (_) {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!liveMuted) requestWakeLock();
    if (!liveMuted && !breakingWeatherActive && 'speechSynthesis' in window && !speechSynthesis.speaking) {
      speakSegment(liveSegIdx);
    }
  }
});

/* ── PLAYBACK CONTROL ─────────────────────────────── */
function startBroadcast() {
  document.body.classList.add('broadcast-active');
  const overlay = document.getElementById('liveStartOverlay');
  if (overlay) overlay.style.display = 'none';
  startMusic();
  try { localStorage.setItem('stormvectorLastVisit', String(Date.now())); } catch (_) {}
  requestWakeLock();
  startSevereWatch();
  startSpeechKeepAlive();
  speakSegment(0);
}
function replaySegment() { speakSegment(liveSegIdx); }
function toggleMute() {
  liveMuted = !liveMuted;
  const btn = document.getElementById('liveMuteBtn');
  if (liveMuted) {
    speechSynthesis.cancel();
    stopMusic();
    setLiveBadge('MUTED');
    if (btn) btn.textContent = '🔊 Resume';
    stopSpeechKeepAlive();
    stopSevereWatch();
    releaseWakeLock();
  } else {
    setLiveBadge('LIVE');
    if (btn) btn.textContent = '🔇 Stop';
    startMusic();
    requestWakeLock();
    startSevereWatch();
    startSpeechKeepAlive();
    speakSegment(liveSegIdx);
  }
}
function setLiveBadge(text) {
  const el = document.getElementById('liveBadge'); if (!el) return;
  el.innerHTML = `<span class="live-dot"></span>${text}`;
  el.classList.toggle('live-badge-on', text === 'LIVE');
}

function speakSegment(i) {
  if (breakingWeatherActive) return;

  if (liveMuted || !('speechSynthesis' in window)) {
    const cap = document.getElementById('liveCaptionText');
    if (cap && liveSegments[i]) cap.textContent = liveSegments[i];
    return;
  }

  if (i >= liveSegments.length) {
    setLiveBadge('CHECKING WEATHER');
    setTimeout(async () => {
      broadcastLoopCount++;
      try { await prepareBroadcast(); } catch (_) { /* keep looping even if a refresh fails */ }
      speechSynthesis.cancel();
      setTimeout(() => speakSegment(0), 500);
    }, 3000);
    return;
  }

  liveSegIdx = i;
  speechSynthesis.cancel();
  const isAndroid = /Android/i.test(navigator.userAgent);
  const utter = new SpeechSynthesisUtterance(renderForSpeech(liveSegments[i]));
  if (liveVoice) utter.voice = liveVoice;
  utter.rate = isAndroid ? 0.92 : 0.96;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  utter.onstart = () => {
    setLiveBadge('LIVE');
    document.getElementById('liveAvatar')?.classList.add('speaking');
    const cap = document.getElementById('liveCaptionText');
    if (cap) cap.textContent = liveSegments[i];
    announce(liveSegments[i]);
  };
  utter.onend = () => {
    document.getElementById('liveAvatar')?.classList.remove('speaking');
    if (!liveMuted) speakSegment(i + 1);
  };
  utter.onerror = () => { document.getElementById('liveAvatar')?.classList.remove('speaking'); };
  setTimeout(() => speechSynthesis.speak(utter), isAndroid ? 60 : 0);
}

function announce(msg) {
  const el = document.getElementById('ariaLive'); if (!el) return;
  el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; });
}

/* ── BOOT ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('liveStartBtn');
  const card = document.getElementById('liveLocationCard');
  if (card) card.textContent = 'Locating…';

  await initLocation();
  try {
    await prepareBroadcast();
  } catch (_) {
    if (card) card.textContent = 'Using default location';
  }

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = '▶ Go Live';
  }
});
