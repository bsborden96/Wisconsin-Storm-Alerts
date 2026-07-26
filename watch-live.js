/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Depends on shared.js (loaded first) and bg-canvas.js
   (loaded second) for window.setBgMode/setDaytime and
   the shared helper functions (degToCompass, dewLabel,
   alertPriorityScore, isTornadoLevel, parseMovement, etc).

   MVP scope: this builds one real broadcast script per
   page load from live NWS + Open-Meteo data and speaks it
   with the browser's built-in TTS, with synced captions.
   The AI Producer / Director / multi-segment engine
   described in the vision doc is the natural next step —
   this establishes the page, the nav entry, and a working
   speech + caption pipeline it can plug into.
════════════════════════════════════════════════ */

let liveLat = 43, liveLon = -88;
let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;
let liveMuted = false;
let liveMusic = null;
let musicEnabled = true;

/* ── PERSONALITY / PHRASE BANKS ──────────────────────
   Vector's "voice." Pools of interchangeable phrasing so
   the continuously-looping broadcast doesn't sound like a
   script being re-read. pickPhrase() cycles a pool without
   repeating an entry until every entry in that pool has
   been used once, then reshuffles — this satisfies "never
   repeat the same phrases every broadcast" without needing
   any external state. */
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

const PHRASES = {
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
  ]
};

function startMusic() {
  if (!musicEnabled) return;

  if (!liveMusic) {
    liveMusic = document.getElementById("liveMusic");
  }

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

(function injectBreakingBannerStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .live-breaking-banner {
      position: sticky; top: 0; z-index: 50;
      background: #b30000; color: #fff;
      font-family: 'Bebas Neue', sans-serif;
      letter-spacing: 0.06em;
      text-align: center;
      padding: 10px 12px;
      font-size: 1.1rem;
      animation: sv-breaking-flash 1s step-start infinite;
    }
    @keyframes sv-breaking-flash {
      50% { background: #7a0000; }
    }
  `;
  document.head.appendChild(style);
})();

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

async function safeFetch(url, { timeout = 10000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/geo+json" } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) { clearTimeout(t); throw e; }
}

navigator.geolocation.getCurrentPosition(
  p => { liveLat = p.coords.latitude; liveLon = p.coords.longitude; prepareBroadcast(); },
  () => prepareBroadcast(),
  { timeout: 8000 }
);

function timeAgo(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins===1?'':'s'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs===1?'':'s'} ago`;
  return `${Math.round(hrs/24)} day${Math.round(hrs/24)===1?'':'s'} ago`;
}

/* ── SPC CONVECTIVE OUTLOOK ──────────────────────────
   Fetches SPC's public categorical-outlook GeoJSON layers
   for Day 1-3 and does a simple point-in-polygon test to
   find which risk category (if any) covers the broadcast
   location. Fails silently — SPC integration is a bonus,
   not a dependency, so a network hiccup should never break
   the rest of the broadcast. */
const SPC_RISK_LABELS = {
  TSTM: 'a general thunderstorm risk',
  MRGL: 'a marginal risk',
  SLGT: 'a slight risk',
  ENH: 'an enhanced risk',
  MDT: 'a moderate risk',
  HIGH: 'a high risk'
};
const SPC_RISK_RANK = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInGeometry(lat, lon, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.length > 0 && pointInRing(lat, lon, geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => pointInRing(lat, lon, poly[0]));
  }
  return false;
}

async function fetchSpcOutlookDay(day) {
  try {
    const res = await safeFetch(`https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.lyr.geojson`, { timeout: 8000 });
    const data = await res.json();
    let best = null;
    for (const f of (data.features || [])) {
      const label = (f.properties?.LABEL || f.properties?.DN || '').toString().toUpperCase();
      if (!SPC_RISK_RANK[label]) continue;
      if (pointInGeometry(liveLat, liveLon, f.geometry)) {
        if (!best || SPC_RISK_RANK[label] > SPC_RISK_RANK[best]) best = label;
      }
    }
    return best; // e.g. 'SLGT', or null if not in any outlook area
  } catch (_) { return null; }
}
async function fetchSpcOutlooks() {
  const [day1, day2, day3] = await Promise.all([
    fetchSpcOutlookDay(1), fetchSpcOutlookDay(2), fetchSpcOutlookDay(3)
  ]);
  return { day1, day2, day3 };
}

/* ── ASTRONOMY / SEASONAL CONTENT ── */
function moonPhaseName() {
  // Days since a known new moon (2000-01-06), synodic month ≈ 29.53 days.
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14);
  const days = (Date.now() - known) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const frac = phase / synodic;
  if (frac < 0.03 || frac > 0.97) return 'a new moon';
  if (frac < 0.22) return 'a waxing crescent moon';
  if (frac < 0.28) return 'a first quarter moon';
  if (frac < 0.47) return 'a waxing gibbous moon';
  if (frac < 0.53) return 'a full moon';
  if (frac < 0.72) return 'a waning gibbous moon';
  if (frac < 0.78) return 'a last quarter moon';
  return 'a waning crescent moon';
}

const SEASONAL_TRIVIA = {
  winter: [
    "Cold air is denser, which is part of why winter days often feel calmer once the wind dies down.",
    "This is typically the driest stretch of the year for a lot of the country, air-quality-wise."
  ],
  spring: [
    "Spring is peak season for the clash of warm and cool air masses — that's exactly what fuels severe weather.",
    "Temperature swings are usually at their widest this time of year."
  ],
  summer: [
    "Afternoon heating is the big driver of pop-up storms this time of year.",
    "Humidity does a lot of the work in how the heat actually feels outside."
  ],
  fall: [
    "Fall often brings some of the most stable, pleasant stretches of weather all year.",
    "Nights start cooling off faster than days this time of year as the sun angle drops."
  ]
};
function currentSeason() {
  const m = new Date().getMonth(); // 0=Jan
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}

async function prepareBroadcast() {
  setLiveBadge("UPDATING");
  const locEl = document.getElementById('liveLocationCard');
  let cityState = '', county = '';
let forecastUrl = null;
  try {
    const res = await safeFetch(
  `https://api.weather.gov/points/${liveLat.toFixed(4)},${liveLon.toFixed(4)}`,
  { timeout: 8000 }
);
const data = await res.json();

forecastUrl = data.properties?.forecast;

const city = data.properties?.relativeLocation?.properties?.city || '';
    const state = data.properties?.relativeLocation?.properties?.state || '';
    cityState = `${city}${city&&state?', ':''}${state}`;
    try {
      const cRes = await safeFetch(data.properties.county, { timeout: 6000 });
      const cData = await cRes.json();
      county = cData.properties?.name || '';
    } catch(_) {}
    if (locEl) locEl.innerHTML = `<b>${county ? county+' County' : 'Your Area'}</b><span>${cityState}</span>`;
  } catch(_) {
    if (locEl) locEl.textContent = 'Location unavailable';
  }

  let tempF = null, feelsF = null, windSpd = 0, windDeg = 0, windG = 0, wcode = 0, dewF = null, humidity = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${liveLat}&longitude=${liveLon}&current=temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`;
    const res = await safeFetch(url, { timeout: 10000 });
    const d = await res.json();
    const c = d.current;
    tempF = Math.round(c.temperature_2m); feelsF = Math.round(c.apparent_temperature);
    dewF = Math.round(c.dew_point_2m);
    humidity = c.relative_humidity_2m !== undefined ? Math.round(c.relative_humidity_2m) : null;
    windSpd = Math.round(c.wind_speed_10m); windDeg = c.wind_direction_10m; windG = Math.round(c.wind_gusts_10m);
    wcode = c.weather_code || 0;
  } catch(_) {}

  let alerts = [];
try {
  const res = await safeFetch(`https://api.weather.gov/alerts/active?point=${liveLat.toFixed(4)},${liveLon.toFixed(4)}`, { timeout: 10000 });
  const data = await res.json();
  alerts = (data.features || []).sort((a,b) =>
    alertPriorityScore(a.properties?.event||'') -
    alertPriorityScore(b.properties?.event||'')
  );
} catch(_) {}

// ADD THIS HERE
let forecast = null;

if (forecastUrl) {
  try {
    const res = await safeFetch(forecastUrl, { timeout: 10000 });
    const data = await res.json();
    forecast = data.properties?.periods || [];
  } catch (_) {}
}

// SPC convective outlooks (Day 1-3) — fetched in parallel, fails silently
const spc = await fetchSpcOutlooks();

// Build the broadcast script
buildScript({
  cityState,
  tempF,
  feelsF,
  windSpd,
  windDeg,
  windG,
  wcode,
  dewF,
  humidity,
  alerts,
  forecast,
  spc
});

// Update the conditions row
renderConditionsRow({
  tempF,
  feelsF,
  windSpd,
  windDeg,
  windG,
  dewF,
  humidity
});

// Update the animated background
setBroadcastBg({
  wcode,
  alerts
});

// Enable the Start Broadcast button
const btn = document.getElementById("liveStartBtn");
if (btn) {
  btn.disabled = false;
  btn.textContent = "▶ Start Broadcast";
}

}

/* ── PRODUCER / AI DIRECTOR ──────────────────────────
   createBroadcastPlan() is Vector's producer. It still
   returns the original {priority, intro, lead,
   includeDewPoint} contract so nothing downstream breaks,
   but it now also decides mood (calm / energetic / urgent),
   a personality level, and which optional segments earn
   airtime this loop — the "director" layer from the brief.
   Breaking weather always wins and short-circuits everything
   else, same as before. */
function createBroadcastPlan({ alerts, tempF, windSpd, dewF, wcode, spc }) {

  const plan = {
  priority: "normal",
  intro: "normal",
  includeDewPoint: true,
  lead: "conditions",
  mood: "calm",
  personality: "normal",
  segments: []
};

  const tornadoAlerts = alerts.filter(a => isTornadoLevel(a.properties?.event || ""));

  if (tornadoAlerts.length > 0) {
    plan.priority = "breaking";
    plan.intro = "breaking";
    plan.lead = "tornado";
    plan.mood = "urgent";
    plan.personality = "none";
    // Breaking weather overrides everything: alerts + bare conditions only.
    plan.segments = ["alerts", "currentConditions", "safety"];
    return plan;
  }

  const stormy = [95, 96, 99].includes(wcode);
  const spcElevated = spc && ["ENH", "MDT", "HIGH"].includes(spc.day1);

  if (windSpd >= 20) {
    plan.priority = "wind";
    plan.intro = "wind";
    plan.lead = "wind";
  }

  if (tempF >= 90 && dewF >= 72) {
    plan.priority = "heat";
    plan.intro = "heat";
    plan.lead = "heat";
  }

  if (alerts.length === 0) {
    plan.priority = "quiet";
    plan.intro = "quiet";
    plan.includeDewPoint = false;
    plan.lead = "conditions";
  }

  if (stormy || alerts.length > 0 || spcElevated) {
    plan.mood = "energetic";
    plan.personality = "light";
  } else if (plan.priority === "quiet") {
    plan.mood = "calm";
    plan.personality = "full";
  } else {
    plan.mood = "calm";
    plan.personality = "normal";
  }

  // Director picks the segment lineup. Core segments always run;
  // a rotating pool of "extras" fills out the rest of the broadcast
  // so no two loops feel identical and not everything airs every time.
  const core = ["currentConditions", "shortForecast", "alerts"];
  const extrasPool = ["tonight", "windDiscussion", "dewPoint", "humidity",
    "spcOutlook", "sunTimes", "astronomy", "trivia", "confidence"];
  if (plan.priority === "wind") extrasPool.unshift("windDiscussion");
  if (plan.priority === "heat") extrasPool.unshift("humidity", "dewPoint");
  if (spcElevated) extrasPool.unshift("spcOutlook", "safety");
  if (alerts.length > 0) extrasPool.unshift("safety");

  const seen = new Set();
  const extras = [];
  for (const id of extrasPool) {
    if (seen.has(id)) continue;
    seen.add(id);
    extras.push(id);
  }
  const extraCount = plan.personality === "full" ? 4 : plan.personality === "light" ? 2 : 3;
  const chosenExtras = [];
  const historyKey = 'segmentRotation';
  if (!phraseHistory[historyKey]) phraseHistory[historyKey] = new Set();
  const used = phraseHistory[historyKey];
  let pool = extras.filter(id => !used.has(id));
  while (chosenExtras.length < Math.min(extraCount, extras.length)) {
    if (pool.length === 0) { used.clear(); pool = extras.filter(id => !chosenExtras.includes(id)); }
    const idx = Math.floor(Math.random() * pool.length);
    const id = pool.splice(idx, 1)[0];
    used.add(id);
    chosenExtras.push(id);
  }

  plan.segments = [...core, ...chosenExtras, "closing"];
  return plan;
}

function addCurrentConditions(segs, { tempF, feelsF, windSpd, windDeg, windG }) {

  if (tempF !== null) {

    let tempLine = `Right now it's ${tempF} degrees`;

    if (feelsF !== null && feelsF !== tempF) {
      tempLine += `, feeling like ${feelsF}`;
    }

    tempLine += ".";

    if (windSpd >= 15) {
      tempLine += ` Winds are out of the ${degToCompass(windDeg)} at ${windSpd} miles per hour${windG > windSpd + 5 ? `, gusting to ${windG}` : ""}.`;
    }

    segs.push(tempLine);

  } else {

    segs.push("I'm having trouble reaching live current conditions right now — bear with me.");

  }

}
function addAlerts(segs, alerts) {

  const tornadoAlerts = alerts.filter(a =>
    isTornadoLevel(a.properties?.event || "")
  );

  if (tornadoAlerts.length > 0) {

    const a = tornadoAlerts[0];
    const mv = parseMovement(a.properties?.description || "");

    segs.push(
      `This is a StormVector Breaking Weather update. A ${a.properties.event} is in effect for ${(a.properties.areaDesc || "your area").split(";")[0]}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ""} Take shelter now if you are in the warned area.`
    );

  } else if (alerts.length > 0) {

    const a = alerts[0];

    segs.push(
      `There ${alerts.length === 1 ? "is" : "are"} currently ${alerts.length} active weather alert${alerts.length === 1 ? "" : "s"} for your area. The highest priority is a ${a.properties.event} covering ${(a.properties.areaDesc || "").split(";")[0]}.`
    );

  } else {

    segs.push(
      "There are no active weather alerts for your location at this time."
    );

  }

}
function addShortForecast(segs, forecast) {

  if (!forecast || forecast.length === 0) {
    return;
  }

  const next = forecast[0];

  if (!next || !next.detailedForecast) {
    return;
  }

  segs.push(
    `${pickPhrase(PHRASES.transitions, 'transitions')} ${next.detailedForecast}`
  );

}
function addTonightForecast(segs, forecast) {
  if (!forecast || forecast.length < 2) return;
  const tonight = forecast.find(p => /tonight/i.test(p.name || '')) || forecast[1];
  if (!tonight || !tonight.detailedForecast) return;
  segs.push(`For ${tonight.name || 'tonight'}, ${tonight.detailedForecast}`);
}
function addWindDiscussion(segs, { windSpd, windDeg, windG }) {
  if (windSpd < 10) return;
  let line = `Wind's worth a closer look — out of the ${degToCompass(windDeg)} around ${windSpd} miles per hour`;
  if (windG > windSpd + 5) line += `, with gusts up to ${windG}`;
  line += windSpd >= 25 ? ". That's strong enough to knock down loose branches, so secure anything that could blow around."
    : windSpd >= 20 ? ". Breezy enough to notice if you're outside for a while."
    : ".";
  segs.push(line);
}
function addDewPointDiscussion(segs, { dewF }) {
  if (dewF === null) return;
  if (dewF >= 65) segs.push(`Dew points are muggy at ${dewF} degrees — that thick, sticky air is fuel if storms fire up.`);
  else if (dewF >= 60) segs.push(`Dew points are running high at ${dewF} degrees, which means plenty of moisture is available if storms fire later.`);
  else if (dewF <= 35) segs.push(`Dew points are low at ${dewF} degrees — expect a dry air mass overall.`);
  else segs.push(`Dew points are sitting at a comfortable ${dewF} degrees.`);
}
function addHumidityDiscussion(segs, { humidity }) {
  if (humidity === null || humidity === undefined) return;
  if (humidity >= 80) segs.push(`Relative humidity is up around ${humidity} percent — the air feels heavy out there.`);
  else if (humidity <= 30) segs.push(`Relative humidity is fairly low at ${humidity} percent, so the air will feel drier than the temperature alone suggests.`);
}
function addSpcOutlook(segs, spc) {
  if (!spc) return;
  // Only worth mentioning when there's an active, non-trivial risk somewhere in the next few days.
  const label = spc.day1 && SPC_RISK_RANK[spc.day1] >= 2 ? { day: 'Today', code: spc.day1 }
    : spc.day2 && SPC_RISK_RANK[spc.day2] >= 2 ? { day: 'Tomorrow', code: spc.day2 }
    : spc.day3 && SPC_RISK_RANK[spc.day3] >= 2 ? { day: 'In two days', code: spc.day3 }
    : null;
  if (!label) return;
  const desc = SPC_RISK_LABELS[label.code] || 'an elevated risk';
  let line = `The Storm Prediction Center has your area under ${desc} for severe weather ${label.day.toLowerCase() === 'today' ? 'today' : label.day.toLowerCase()}.`;
  if (SPC_RISK_RANK[label.code] >= 4) line += ' Damaging wind, large hail, and a tornado or two are all possible — worth keeping an eye on the sky.';
  else line += " Nothing imminent, but it's a good day to stay weather-aware.";
  segs.push(line);
}
function addSunTimes(segs) {
  const st = getSunTimes(liveLat, liveLon);
  if (!st.sunrise || !st.sunset) return;
  const fmt = h => {
    const hh = Math.floor(h) % 24; const mm = Math.round((h % 1) * 60);
    const period = hh >= 12 ? 'PM' : 'AM'; const h12 = ((hh + 11) % 12) + 1;
    return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
  };
  segs.push(`Sunrise was at ${fmt(st.sunrise)} this morning, and sunset comes at ${fmt(st.sunset)} this evening.`);
}
function addAstronomy(segs) {
  segs.push(`Tonight's sky features ${moonPhaseName()}.`);
}
function addSeasonalTrivia(segs) {
  const season = currentSeason();
  const line = pickPhrase(SEASONAL_TRIVIA[season], 'trivia-' + season);
  if (line) segs.push(line);
}
function addForecastConfidence(segs, { alerts, wcode }) {
  const active = [95, 96, 99, 71, 73, 75].includes(wcode) || alerts.length > 0;
  segs.push(active
    ? "Confidence in this forecast is good, but timing on fast-moving weather like this can shift, so check back for updates."
    : "Confidence in today's forecast is high — no major surprises expected.");
}
function addSafetyReminder(segs, { alerts }) {
  const hasSevere = alerts.some(a => /Warning/i.test(a.properties?.event || ''));
  segs.push(hasSevere
    ? "Make sure you have a way to get warnings even if you're away from a screen — a weather radio or phone alerts both work well."
    : "As always, a good habit is knowing where you'd go if severe weather did develop.");
}

/* ── SCRIPT ASSEMBLY ── */
function buildScript({
  cityState,
  tempF,
  feelsF,
  windSpd,
  windDeg,
  windG,
  wcode,
  dewF,
  humidity,
  alerts,
  forecast,
  spc
}) {

  const segs = [];

  const plan = createBroadcastPlan({
    alerts,
    tempF,
    windSpd,
    dewF,
    wcode,
    spc
  });

  let lastVisit = null;
  try { lastVisit = localStorage.getItem('stormvectorLastVisit'); } catch(_) {}
  const greetName = cityState ? `for ${cityState}` : 'for your area';

  segs.push("You're watching StormVector Live.");

  let intro;
  switch (plan.intro) {
    case "breaking":
      intro = "This is StormVector Breaking Weather.";
      break;
    case "wind":
      intro = "Let's begin with today's windy conditions.";
      break;
    case "heat":
      intro = "Let's take a look at today's heat and humidity.";
      break;
    case "quiet":
      intro = pickPhrase(PHRASES.greetingsQuiet, 'greetQuiet');
      break;
    default:
      intro = pickPhrase(PHRASES.greetingsNormal, 'greetNormal');
  }

  if (lastVisit && Date.now() - parseInt(lastVisit, 10) < 6 * 3600 * 1000) {
    segs.push(`${intro} Since your last visit ${timeAgo(Date.now() - parseInt(lastVisit, 10))}, here's what's changed ${greetName}.`);
  } else {
    segs.push(`${intro} Here's your live StormVector forecast ${greetName}.`);
  }

  // A little light personality up top on quiet, low-stakes days only —
  // never during breaking weather or elevated-risk broadcasts.
  if (plan.personality === "full") {
    const isGloomy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 45, 48].includes(wcode);
    segs.push(pickPhrase(isGloomy ? PHRASES.gloomyObservations : PHRASES.quietObservations, 'observation'));
  }

  const ctx = { tempF, feelsF, windSpd, windDeg, windG, wcode, dewF, humidity, alerts, forecast, spc };
  const segmentBuilders = {
    currentConditions: () => addCurrentConditions(segs, ctx),
    shortForecast: () => addShortForecast(segs, forecast),
    tonight: () => addTonightForecast(segs, forecast),
    alerts: () => addAlerts(segs, alerts),
    windDiscussion: () => addWindDiscussion(segs, ctx),
    dewPoint: () => addDewPointDiscussion(segs, ctx),
    humidity: () => addHumidityDiscussion(segs, ctx),
    spcOutlook: () => addSpcOutlook(segs, spc),
    sunTimes: () => addSunTimes(segs),
    astronomy: () => addAstronomy(segs),
    trivia: () => addSeasonalTrivia(segs),
    confidence: () => addForecastConfidence(segs, ctx),
    safety: () => addSafetyReminder(segs, ctx),
    closing: () => {}
  };

  for (const id of plan.segments) {
    const fn = segmentBuilders[id];
    if (fn) fn();
  }

  segs.push(pickPhrase(PHRASES.closers, 'closers'));
  liveSegments = segs;
  liveSegIdx = 0;
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
    chip('Wind', `${degToCompass(windDeg)} ${windSpd} mph`),
    windG > windSpd + 5 ? chip('Gusts', `${windG} mph`) : '',
  ].join('');
}

function setBroadcastBg({ wcode, alerts }) {
  const hasTornado = alerts.some(a => isTornadoLevel(a.properties?.event || ''));
  if (hasTornado) { window.setBgMode('tornado'); return; }
  if ([95,96,99].includes(wcode)) window.setBgMode('storm');
  else if ([71,73,75,77,85,86].includes(wcode)) window.setBgMode('snow');
  else if ([45,48].includes(wcode)) window.setBgMode('fog');
  else if ([51,53,55,61,63,65,80,81,82].includes(wcode)) window.setBgMode('rain');
  else if (wcode === 1) window.setBgMode('partlycloudy');
  else if ([2,3].includes(wcode)) window.setBgMode('cloudy');
  else window.setBgMode('clear');
}

/* ── SPEECH + CAPTIONS ── */
function pickVoice() {
  const voices = speechSynthesis.getVoices();

  console.log("Available voices:", voices.map(v => v.name));

  liveVoice =
    voices.find(v =>
      /en-US/i.test(v.lang) &&
      /(David|Daniel|Aaron|Microsoft David|Google US English Male|Alex|Tom)/i.test(v.name)
    ) ||

    voices.find(v =>
      /Male/i.test(v.name)
    ) ||

    voices.find(v =>
      /en-US/i.test(v.lang)
    ) ||

    voices[0] ||

    null;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = pickVoice;
  pickVoice();
}

/* ── SEVERE WEATHER INTERRUPTION ─────────────────────
   While a broadcast is running, poll for newly-issued
   tornado-level alerts. If one appears mid-broadcast,
   cancel whatever's being said, sound the attention tone,
   deliver Breaking Weather Mode immediately, then resume
   the normal broadcast loop afterward. */
let knownTornadoIds = new Set();
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
    const tornadoAlerts = alerts.filter(a => isTornadoLevel(a.properties?.event || ''));
    const newOnes = tornadoAlerts.filter(a => !knownTornadoIds.has(a.id));
    tornadoAlerts.forEach(a => knownTornadoIds.add(a.id));
    if (newOnes.length > 0) {
      interruptForBreakingWeather(newOnes[0], alerts);
    }
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

async function interruptForBreakingWeather(tornadoAlert, allAlerts) {
  breakingWeatherActive = true;
  resumeSegIdxAfterBreak = liveSegIdx;
  speechSynthesis.cancel();
  setLiveBadge('BREAKING');
  showBreakingBanner(true);

  await playEASTone();

  const mv = parseMovement(tornadoAlert.properties?.description || '');
  const breakingSegs = [
    "This is a StormVector Breaking Weather Update.",
    `A ${tornadoAlert.properties.event} is in effect for ${(tornadoAlert.properties.areaDesc || 'your area').split(';')[0]}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ''} Take shelter now if you are in the warned area.`,
    "I'll continue to track this closely. Stay tuned and stay safe."
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
      const utter = new SpeechSynthesisUtterance(list[idx]);
      if (liveVoice) utter.voice = liveVoice;
      utter.rate = 1.0; utter.pitch = 1.0;
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
  let el = document.getElementById('liveBreakingBanner');
  if (!el) return;
  el.hidden = !show;
}

/* ── ANDROID / MOBILE RELIABILITY ────────────────────
   Chrome on Android (and some desktop builds) has a known
   bug where speechSynthesis silently stops after ~15s on a
   long utterance queue. The standard workaround is nudging
   it with pause()/resume() periodically while it's actively
   speaking. This is a no-op on platforms that don't need it. */
let speechKeepAlive = null;
function startSpeechKeepAlive() {
  stopSpeechKeepAlive();
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
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* wake lock is a nicety, not a requirement */ }
}
function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch (_) {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!liveMuted) requestWakeLock();
    // Android sometimes drops the synth queue while backgrounded — resume if it went quiet unexpectedly.
    if (!liveMuted && !breakingWeatherActive && 'speechSynthesis' in window && !speechSynthesis.speaking) {
      speakSegment(liveSegIdx);
    }
  }
});

function startBroadcast() {
  document.getElementById('liveStartOverlay').style.display = 'none';
  startMusic();
  try { localStorage.setItem('stormvectorLastVisit', String(Date.now())); } catch(_) {}
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
    stopMusic();              // <-- Add this line
    setLiveBadge('MUTED');
    if (btn) btn.textContent = '🔊 Resume';
    stopSpeechKeepAlive();
    stopSevereWatch();
    releaseWakeLock();
  }
  else {
    setLiveBadge('LIVE');
    if (btn) btn.textContent = '🔇 Stop';
    startMusic();             // <-- Add this line
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
  setLiveBadge("CHECKING WEATHER");

  setTimeout(async () => {
    console.log("StormVector: Refreshing broadcast...");

    await prepareBroadcast();

    console.log("StormVector: Segments =", liveSegments.length);

    speechSynthesis.cancel();

    setTimeout(() => {
      speakSegment(0);
    }, 500);

  }, 3000);

  return;
}

  liveSegIdx = i;
  speechSynthesis.cancel();
  const isAndroid = /Android/i.test(navigator.userAgent);
  const utter = new SpeechSynthesisUtterance(liveSegments[i]);
  if (liveVoice) utter.voice = liveVoice;
  utter.rate = isAndroid ? 0.95 : 1.0; utter.pitch = 1.0;
  utter.onstart = () => {
    setLiveBadge('LIVE');
    document.getElementById('liveAvatar')?.classList.add('speaking');
    const cap = document.getElementById('liveCaptionText');
    if (cap) cap.textContent = liveSegments[i];
    announce(liveSegments[i]);
  };
  utter.onend = () => {
  console.log("Segment ended:", i);

  document.getElementById('liveAvatar')?.classList.remove('speaking');

  if (!liveMuted) {
    speakSegment(i + 1);
  }
};
  utter.onerror = () => { document.getElementById('liveAvatar')?.classList.remove('speaking'); };
  // A tiny delay between cancel() and speak() avoids a well-known Android
  // Chrome quirk where speech silently fails to start right after a cancel.
  setTimeout(() => speechSynthesis.speak(utter), isAndroid ? 60 : 0);
}
function announce(msg) {
  const el = document.getElementById('ariaLive'); if (!el) return;
  el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; });
}
window.addEventListener('beforeunload', () => {
  try { speechSynthesis.cancel(); } catch(_) {}
  stopSpeechKeepAlive();
  stopSevereWatch();
  releaseWakeLock();
});

/* ── SUN/DAY-NIGHT (same math as Home/Outlooks, kept local + minimal) ── */
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
(function updateDayNight() {
  const now=new Date();
  const h=now.getHours()+now.getMinutes()/60;
  const st=getSunTimes(liveLat,liveLon);
  let isDay=true,sunProg=0.5,nightProg=0.5;
  if(st.sunrise&&st.sunset){
    isDay=h>=st.sunrise&&h<=st.sunset;
    if(isDay) sunProg=Math.max(0,Math.min(1,(h-st.sunrise)/(st.sunset-st.sunrise)));
    else { const nightLen=(24-st.sunset)+st.sunrise; const nightH=h<st.sunrise?h+(24-st.sunset):h-st.sunset; nightProg=Math.max(0,Math.min(1,nightH/nightLen)); }
  }
  window.setDaytime(isDay,sunProg,nightProg);
})();
