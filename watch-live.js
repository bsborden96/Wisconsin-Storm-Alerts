<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Watch Live — US Storm Alerts</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#050a14">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">

<style>
  #mainContent { max-width: 980px; margin-inline: auto; }
  .live-stage {
    position: relative; overflow: hidden; padding: clamp(24px, 5vw, 44px);
    border: 1px solid rgba(0,207,255,.28); border-radius: 28px;
    background: radial-gradient(circle at 50% 10%, rgba(0,207,255,.22), transparent 34%), linear-gradient(150deg, rgba(5,14,30,.92), rgba(11,28,56,.8));
    box-shadow: 0 30px 90px rgba(0,0,0,.4), inset 0 0 70px rgba(0,207,255,.05);
  }
  .live-stage::before { content:""; position:absolute; inset:-45%; background: conic-gradient(from 180deg, transparent, rgba(0,207,255,.16), transparent 28%); animation: liveSweep 10s linear infinite; opacity:.75; }
  .live-stage > * { position: relative; z-index: 1; }
  @keyframes liveSweep { to { transform: rotate(1turn); } }
  .live-badge { display:inline-flex; gap:8px; align-items:center; padding:7px 13px; border-radius:999px; background:rgba(255,255,255,.08); color:#bfefff; letter-spacing:.12em; font-family:'Share Tech Mono', monospace; }
  .live-dot { width:9px; height:9px; border-radius:50%; background:#ff5757; box-shadow:0 0 14px #ff5757; }
  .live-badge-on .live-dot { background:#49ff8b; box-shadow:0 0 14px #49ff8b; }
  .live-avatar { width: clamp(132px, 28vw, 210px); height: clamp(132px, 28vw, 210px); margin: 22px auto 14px; display:grid; place-items:center; border-radius:50%; }
  .live-avatar::before, .live-avatar::after { content:""; position:absolute; width:100%; height:100%; border-radius:50%; background: radial-gradient(circle, rgba(0,207,255,.28), transparent 62%); animation: avatarPulse 2.8s ease-out infinite; }
  .live-avatar::after { animation-delay: 1.4s; }
  .live-avatar.speaking::before, .live-avatar.speaking::after, .broadcast-active .live-avatar::before { background: radial-gradient(circle, rgba(110,255,138,.38), transparent 62%); animation-duration:1.2s; }
  @keyframes avatarPulse { 0%{transform:scale(.86); opacity:.9} 100%{transform:scale(1.55); opacity:0} }
  .live-avatar-ring { position:absolute; inset:8px; border-radius:50%; border:1px solid rgba(0,207,255,.42); box-shadow: inset 0 0 28px rgba(0,207,255,.2), 0 0 38px rgba(0,207,255,.2); }
  .live-avatar-core { width:70%; height:70%; border-radius:50%; display:grid; place-items:center; font: clamp(58px, 13vw, 96px)/1 'Bebas Neue', sans-serif; color:#07111f; background:linear-gradient(135deg,#eaffff,#00cfff 58%,#1b6dff); box-shadow:0 0 35px rgba(0,207,255,.45); }
  .live-name { font-family:'Bebas Neue', sans-serif; letter-spacing:.12em; font-size:clamp(30px, 7vw, 56px); }
  .live-name-sub { display:block; font-family:'Share Tech Mono', monospace; font-size:clamp(12px, 2.4vw, 15px); color:#8fdfff; letter-spacing:.08em; }
  .live-caption-box { margin:24px auto 0; max-width:820px; min-height:96px; padding:20px; border-radius:18px; background:rgba(0,0,0,.32); border:1px solid rgba(255,255,255,.1); line-height:1.65; text-align:left; box-shadow: inset 0 0 30px rgba(0,0,0,.22); }
  .live-controls, .live-conditions-row, .live-crew-row { display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin-top:18px; }
  .live-ctrl-btn, .live-chip, .live-crew-card { border:1px solid rgba(0,207,255,.22); background:rgba(4,12,25,.72); color:#dff8ff; border-radius:14px; padding:12px 15px; backdrop-filter:blur(14px); }
  .live-ctrl-btn { cursor:pointer; }
  .live-chip-label, .live-crew-label { display:block; color:#7ecfff; font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
  .live-chip-val { display:block; font-size:18px; margin-top:4px; }
  .live-start-overlay { position:fixed; inset:0; display:grid; place-items:center; background:rgba(2,8,16,.78); backdrop-filter:blur(10px); z-index:20; padding:20px; }
  .live-start-inner { max-width:520px; border:1px solid rgba(0,207,255,.28); border-radius:24px; padding:30px; background:linear-gradient(160deg, rgba(6,20,42,.96), rgba(2,9,18,.96)); box-shadow:0 24px 80px rgba(0,0,0,.5); }
  .live-start-title { font-family:'Bebas Neue', sans-serif; font-size:42px; letter-spacing:.1em; }
  .live-start-sub, .live-start-note { color:#a8dff2; margin-top:10px; line-height:1.6; }
  .live-start-btn { margin-top:20px; border:0; border-radius:999px; padding:13px 24px; background:linear-gradient(90deg,#00cfff,#6eff8a); color:#04101b; font-weight:800; cursor:pointer; }
</style>

</head>
<body>

<canvas id="bgCanvas" aria-hidden="true"></canvas>
<div id="ariaLive" class="sr-only" aria-live="assertive" aria-atomic="true"></div>

<!-- Breaking weather banner: hidden by default, shown/hidden by watch-live.js
     during Breaking Weather Mode. Styling is injected by watch-live.js so this
     page doesn't need styles.css changes to support it. -->
<div id="liveBreakingBanner" class="live-breaking-banner" role="alert" hidden>⚠ STORMVECTOR BREAKING WEATHER ⚠</div>

<div id="headerBar" aria-label="Navigation header">
  <button class="menu-btn" id="menuBtn" onclick="toggleMenu()" aria-expanded="false" aria-controls="menuPanel" aria-label="Open navigation menu">☰</button>
  <div id="headerTitle">WATCH LIVE</div>
</div>
<nav id="menuPanel" class="menu-panel" role="menu" aria-label="Main navigation">
  <a href="./index.html" role="menuitem"><span class="menu-icon-char">🏠</span>Home</a>
  <a href="./outlooks.html" role="menuitem"><span class="menu-icon-char">🧭</span>Outlooks</a>
  <a href="./watch-live.html" role="menuitem"><span class="menu-icon-char">📺</span>Watch Live</a>
</nav>

<main id="mainContent">

  <div class="section" style="padding-top:4px">
    <div id="liveLocationCard" class="location-card" aria-live="polite">Locating…</div>
  </div>

  <div class="section">
    <div class="live-stage" id="liveStage">
      <div class="live-badge" id="liveBadge"><span class="live-dot"></span>STANDBY</div>
      <div class="live-avatar" id="liveAvatar" role="img" aria-label="Vector, your AI meteorologist">
        <div class="live-avatar-ring"></div>
        <div class="live-avatar-core">V</div>
      </div>
      <div class="live-name">VECTOR <span class="live-name-sub">AI Meteorologist</span></div>

      <div class="live-crew-row" aria-label="Broadcast crew status">
        <div class="live-crew-card"><span class="live-crew-label">Producer</span>Builds the rundown from live data</div>
        <div class="live-crew-card"><span class="live-crew-label">Broadcaster</span>Speaks the highest-impact story first</div>
      </div>

      <div class="live-caption-box" id="liveCaptionBox" aria-live="polite">
        <span id="liveCaptionText">Preparing today's broadcast…</span>
      </div>

      <div class="live-controls" id="liveControls">
        <button class="live-ctrl-btn" id="liveReplayBtn" onclick="replaySegment()" aria-label="Replay this segment">↺ Replay</button>
        <button class="live-ctrl-btn" id="liveMuteBtn" onclick="toggleMute()" aria-label="Mute broadcast">🔇 Stop</button>
      </div>
    </div>

    <div class="live-start-overlay" id="liveStartOverlay">
      <div class="live-start-inner">
        <div class="live-start-title">📡 STORMVECTOR LIVE</div>
        <div class="live-start-sub">Vector is ready with your local forecast.</div>
        <button class="live-start-btn" id="liveStartBtn" onclick="startBroadcast()" disabled>Preparing…</button>
        <div class="live-start-note">Uses your device's built-in voice. Captions are shown for every word spoken.</div>
      </div>
    </div>
  </div>



  <div class="section">
    <div class="live-conditions-row" id="liveConditionsRow"></div>
  </div>
watch-live.js
watch-live.js
+84
-16

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
let liveBroadcastContext = null;
let broadcastLoopCount = 0;
const spokenFactMemory = new Map();

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
  ]
};


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
    .replace(/\bENS\b/g, 'E N S');
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
function weatherCodePhrase(wcode) {
  if ([95, 96, 99].includes(wcode)) return 'thunderstorms are in the area';
  if ([71, 73, 75, 77, 85, 86].includes(wcode)) return 'snow is showing up';
  if ([61, 63, 65, 80, 81, 82].includes(wcode)) return 'rain is around';
  if ([45, 48].includes(wcode)) return 'fog is reducing visibility';
  if ([2, 3].includes(wcode)) return 'cloud cover is holding on';
  if (wcode === 1) return 'skies are partly cloudy';
  return 'conditions are fairly quiet';
}
function addProducerBrief(segs, ctx, plan) {
  const tempTrend = changedPhrase('tempF', ctx.tempF, (oldVal, newVal) =>
    `Producer note: temperatures have ${newVal > oldVal ? 'climbed' : 'dropped'} from ${oldVal} to ${newVal} degrees since the last loop.`);
  const alertTrend = changedPhrase('alertCount', ctx.alerts.length, (oldVal, newVal) =>
    `Producer update: active alerts have changed from ${oldVal} to ${newVal}.`);
  if (alertTrend) segs.push(alertTrend);
  else if (tempTrend && broadcastLoopCount > 0) segs.push(tempTrend);
  else if (plan.priority === 'quiet') segs.push(`The producer is seeing ${weatherCodePhrase(ctx.wcode)}, so we'll keep this update conversational and short.`);
  else segs.push(`The producer is prioritizing ${plan.lead === 'conditions' ? 'current conditions' : plan.lead} first, then the forecast details.`);
}

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
@@ -630,108 +690,110 @@ function buildScript({
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

  segs.push(pickPhrase(PHRASES.liveOpeners, 'liveOpeners'));

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
  addProducerBrief(segs, ctx, plan);
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
  liveSegments = polishSegments(segs);
  liveBroadcastContext = { cityState, tempF, feelsF, windSpd, windDeg, windG, wcode, dewF, humidity, alerts, forecast, spc, plan };
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
@@ -748,135 +810,138 @@ function pickVoice() {
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
   watch or warning alerts. If one appears mid-broadcast,
   cancel whatever's being said, sound the attention tone,
   deliver Breaking Weather Mode immediately, then resume
   the normal broadcast loop afterward. */
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
    const priorityAlerts = alerts.filter(a => /Warning|Watch|Emergency/i.test(a.properties?.event || ''))
      .sort((a,b) => alertPriorityScore(a.properties?.event || '') - alertPriorityScore(b.properties?.event || ''));
    const newOnes = priorityAlerts.filter(a => !knownPriorityAlertIds.has(a.id));
    priorityAlerts.forEach(a => knownPriorityAlertIds.add(a.id));
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

async function interruptForBreakingWeather(priorityAlert, allAlerts) {
  breakingWeatherActive = true;
  resumeSegIdxAfterBreak = liveSegIdx;
  speechSynthesis.cancel();
  setLiveBadge('BREAKING');
  showBreakingBanner(true);

  await playEASTone();

  const event = priorityAlert.properties?.event || 'weather alert';
  const mv = parseMovement(priorityAlert.properties?.description || '');
  const isWarning = /Warning|Emergency/i.test(event);
  const breakingSegs = [
    "This is the StormVector ENS interruption tone. Stand by for urgent weather information.",
    `A ${event} is in effect for ${(priorityAlert.properties?.areaDesc || 'your area').split(';')[0]}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ''} ${isWarning ? 'Move to a safe place now if you are in the warned area.' : 'Review your safety plan and be ready to act if warnings are issued.'}`,
    "I am returning to the broadcast, but this alert stays at the top of the rundown."
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
      utter.rate = 0.94; utter.pitch = 1.02;
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
@@ -893,50 +958,51 @@ function startSpeechKeepAlive() {
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
  document.body.classList.add('broadcast-active');
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
@@ -944,71 +1010,73 @@ function toggleMute() {
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

    broadcastLoopCount++;
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
  const utter = new SpeechSynthesisUtterance(renderForSpeech(liveSegments[i]));
  if (liveVoice) utter.voice = liveVoice;
  utter.rate = isAndroid ? 0.92 : 0.96; utter.pitch = 1.02;
  utter.volume = 1.0;
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
