/* ═══════════════════════════════════════════════════════
   STORMVECTOR — COMPLETE VECTOR ENGINE
   watch-live.js

   Built for the current StormVector index.html.

   Includes:
   - Current GPS location
   - Moving GPS tracking while driving
   - U.S. predictive location search
   - NWS observations, forecast, and alerts
   - Open-Meteo fallback/current/hourly
   - SPC Day 1 categorical risk
   - NOAA MRMS radar + warning polygons
   - SPC categorical and tornado outlook image tabs
   - Severe-only urgent broadcast mode
   - NWS safety instruction takeover
   - Vector speech + background music
   - What Changed
   - Ask Vector
   - Broadcast history
   - Status pills
═══════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════
   FEATURE FLAGS
════════════════════════════════════════════════ */

const STORMVECTOR_FEATURES = {
  radar: true,
  warningPolygons: true,
  askVector: true,
  changeEngine: true,
  broadcastHistory: true,
  severeTakeover: true,
  movingLocation: true
};


/* ═══════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════ */

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas',
  CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware',
  FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho',
  IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas',
  KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi',
  MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
  NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York',
  NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma',
  OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah',
  VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia',
  WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia'
};

const SPC_RANK = {
  TSTM: 1,
  MRGL: 2,
  SLGT: 3,
  ENH: 4,
  MDT: 5,
  HIGH: 6
};

const MOVING_REFRESH_MILES = 2;
const MOVING_REFRESH_MS = 5 * 60 * 1000;
const ALERT_CHECK_MS = 30 * 1000;
const MAX_HISTORY_ITEMS = 30;


/* ═══════════════════════════════════════════════
   CORE STATE
════════════════════════════════════════════════ */

let liveLat = null;
let liveLon = null;
let deviceLat = null;
let deviceLon = null;
let liveCityState = null;
let locationMode = 'none';
let selectedSearchLocation = null;
let locationReady = false;

let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;
let liveMuted = false;
let liveStarted = false;
let startupRunning = false;
let broadcastLoopCount = 0;
let currentWeatherContext = null;

let speechGeneration = 0;
let speechKeepAlive = null;
let wakeLock = null;

let selectedView = 'conditions';
let viewBeforeSevere = 'conditions';
let severeTakeoverActive = false;
let breakingWeatherActive = false;

let liveMusic = null;
let musicFadeFrame = null;

let severeWatchTimer = null;
let locationWatchId = null;
let movingRefreshRunning = false;
let lastWeatherRefreshLat = null;
let lastWeatherRefreshLon = null;
let lastWeatherRefreshAt = 0;

const knownPriorityAlertIds = new Set();
const spokenFactMemory = new Map();
const phraseHistory = {};
let previousWeatherSnapshot = null;
let latestChanges = [];

let locationSearchTimer = null;
let locationSearchController = null;

let radarMap = null;
let radarLayer = null;
let radarMarker = null;
let radarWarningLayer = null;
let radarWarningsVisible = true;
let radarZoomMode = 'local';
let radarLastLoaded = null;

const broadcastHistory = [];
let lastAskTopic = null;


/* ═══════════════════════════════════════════════
   FALLBACK SHARED HELPERS
════════════════════════════════════════════════ */

(function installFallbacks() {
  const install = (name, fn) => {
    if (typeof window[name] !== 'function') {
      window[name] = fn;
    }
  };

  install('setBgMode', () => {});
  install('setDaytime', () => {});

  install('degToCompass', degrees => {
    const n = Number(degrees);
    if (!Number.isFinite(n)) return '';
    const dirs = [
      'N','NNE','NE','ENE','E','ESE','SE','SSE',
      'S','SSW','SW','WSW','W','WNW','NW','NNW'
    ];
    return dirs[Math.round(n / 22.5) % 16];
  });

  install('dewLabel', dewF => {
    if (dewF == null) return '';
    if (dewF < 50) return 'very comfortable';
    if (dewF < 60) return 'comfortable';
    if (dewF < 65) return 'a little sticky';
    if (dewF < 70) return 'muggy';
    if (dewF < 75) return 'oppressive';
    return 'very humid';
  });

  install('alertPriorityScore', event => {
    const text = String(event || '').toLowerCase();
    const order = [
      ['tornado emergency',0],
      ['tornado warning',1],
      ['flash flood emergency',2],
      ['severe thunderstorm warning',3],
      ['flash flood warning',4],
      ['snow squall warning',5],
      ['blizzard warning',6],
      ['ice storm warning',7],
      ['tornado watch',8],
      ['severe thunderstorm watch',9],
      ['winter storm warning',10],
      ['high wind warning',11],
      ['excessive heat warning',12],
      ['flood warning',13],
      ['winter weather advisory',14],
      ['wind advisory',15],
      ['heat advisory',16]
    ];
    for (const [needle, score] of order) {
      if (text.includes(needle)) return score;
    }
    return 50;
  });

  install('isTornadoLevel', event =>
    /tornado warning|tornado emergency/i.test(event || '')
  );

  install('parseMovement', description => {
    const text = String(description || '');
    let m = /moving\s+([nsew]{1,3})\s+at\s+(\d+)\s*mph/i.exec(text);
    if (m) return { dir: m[1].toUpperCase(), spd: m[2] };

    m = /moving\s+(north|south|east|west|northeast|northwest|southeast|southwest)\s+at\s+(\d+)\s*mph/i.exec(text);
    if (m) return { dir: m[1], spd: m[2] };

    return null;
  });
})();


/* ═══════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════ */

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stateName(value) {
  const s = String(value || '').trim();
  return STATE_NAMES[s.toUpperCase()] || s;
}

function celsiusToFahrenheit(c) {
  const n = numberOrNull(c);
  return n === null ? null : Math.round(n * 9 / 5 + 32);
}

function kmhToMph(kmh) {
  const n = numberOrNull(kmh);
  return n === null ? null : Math.round(n * 0.621371);
}

function metersPerSecondToMph(ms) {
  const n = numberOrNull(ms);
  return n === null ? null : Math.round(n * 2.23694);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function removeEmojis(text) {
  let result = String(text || '');
  try {
    result = result.replace(/\p{Extended_Pictographic}/gu, '');
  } catch (_) {
    result = result.replace(/[\u2600-\u27BF]/g, '');
  }
  return result.replace(/\uFE0F/g,'').replace(/\s+/g,' ').trim();
}

async function safeFetch(url, options = {}) {
  const { timeout = 10000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
}

function announce(message) {
  const el = document.getElementById('ariaLive');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = removeEmojis(message);
  });
}

function setCaption(text) {
  const cleaned = removeEmojis(text);
  setText('liveCaptionText', cleaned);
  announce(cleaned);
}

function setCaptionTopic(text) {
  setText('liveCaptionTopic', String(text || '').toUpperCase());
}

function setLocationText(text) {
  setText('liveLocationText', text);
  setText('askVectorLocation', text);
  setText('radarLocationLabel', text);
}

function setLocationSource(text) {
  setText('liveLocationSource', text);
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


/* ═══════════════════════════════════════════════
   ALERT CLASSIFICATION
════════════════════════════════════════════════ */

function alertCombinedText(alert) {
  const p = alert?.properties || {};
  return [
    p.event,
    p.headline,
    p.description,
    p.instruction
  ].filter(Boolean).join(' ').toLowerCase();
}

function isCriticalAlert(alert) {
  const text = alertCombinedText(alert);
  return (
    text.includes('tornado emergency') ||
    text.includes('flash flood emergency') ||
    text.includes('particularly dangerous situation') ||
    /\bpds\b/.test(text)
  );
}

function isUrgentWarning(alert) {
  if (isCriticalAlert(alert)) return true;
  const event = String(alert?.properties?.event || '').toLowerCase();

  return (
    event.includes('tornado warning') ||
    event.includes('severe thunderstorm warning') ||
    event.includes('flash flood warning') ||
    event.includes('snow squall warning') ||
    event.includes('blizzard warning') ||
    event.includes('ice storm warning')
  );
}

function isWatchAlert(alert) {
  const event = String(alert?.properties?.event || '').toLowerCase();

  return (
    event.includes('tornado watch') ||
    event.includes('severe thunderstorm watch') ||
    event.includes('flash flood watch') ||
    event.includes('flood watch') ||
    event.includes('winter storm watch') ||
    event.includes('high wind watch') ||
    event.includes('excessive heat watch') ||
    event.includes('fire weather watch')
  );
}

function getPriorityAlerts(alerts = []) {
  return [...alerts]
    .filter(alert =>
      isUrgentWarning(alert) ||
      isWatchAlert(alert)
    )
    .sort((a,b) =>
      window.alertPriorityScore(a.properties?.event || '') -
      window.alertPriorityScore(b.properties?.event || '')
    );
}

function severeOnlyMode(ctx = currentWeatherContext) {
  return (ctx?.alerts || []).some(isUrgentWarning);
}

function threatLevel(alerts = []) {
  if (alerts.some(isCriticalAlert)) return 3;
  if (alerts.some(isUrgentWarning)) return 2;
  if (alerts.some(isWatchAlert)) return 1;
  return 0;
}


/* ═══════════════════════════════════════════════
   STATUS UI
════════════════════════════════════════════════ */

function setLiveBadge(text) {
  const badge = document.getElementById('liveBadge');

  if (badge) {
    badge.innerHTML = `
      <span class="live-dot"></span>
      <span class="live-badge-text">${escapeHtml(text)}</span>
    `;
    badge.classList.toggle('live-badge-on', text === 'LIVE');
  }

  updateStatusPills(text);
}

function updateStatusPills(requested = '') {
  const travel = document.getElementById('vectorTravelStatus');
  if (travel) {
    if (liveMuted) {
      travel.textContent = 'PAUSED';
    } else if (!locationReady) {
      travel.textContent = 'LOCATION OFF';
    } else if (locationMode === 'search') {
      travel.textContent = 'FIXED LOCATION';
    } else if (movingRefreshRunning) {
      travel.textContent = 'GPS UPDATING';
    } else {
      travel.textContent = 'GPS TRACKING';
    }
  }

  const threat = document.getElementById('vectorThreatStatus');
  if (threat) {
    threat.classList.remove(
      'vector-threat-normal',
      'vector-threat-watch',
      'vector-threat-warning',
      'vector-threat-critical'
    );

    const level = threatLevel(currentWeatherContext?.alerts || []);

    if (level === 3) {
      threat.textContent = 'CRITICAL';
      threat.classList.add('vector-threat-critical');
    } else if (level === 2) {
      threat.textContent = 'WARNING';
      threat.classList.add('vector-threat-warning');
    } else if (level === 1) {
      threat.textContent = 'WATCH';
      threat.classList.add('vector-threat-watch');
    } else {
      threat.textContent = 'NORMAL';
      threat.classList.add('vector-threat-normal');
    }
  }

  let header = String(requested || '').toUpperCase();
  const level = threatLevel(currentWeatherContext?.alerts || []);

  if (level === 3) header = 'CRITICAL WEATHER';
  else if (level === 2) header = 'SEVERE WEATHER';
  else if (liveStarted && !liveMuted && !['UPDATING','LOCATING','CONNECTING'].includes(header)) {
    header = 'LIVE';
  } else if (liveMuted) {
    header = 'PAUSED';
  }

  setText('vectorHeaderStatus', header || 'STANDBY');
}

function setRobotSpeaking(speaking) {
  document.getElementById('liveAvatar')
    ?.classList.toggle('speaking', speaking);

  document.body.classList.toggle(
    'vector-speaking',
    speaking
  );
}

function hideStartOverlay() {
  const overlay = document.getElementById('liveStartOverlay');
  if (overlay) overlay.style.display = 'none';
}

function updateReturnLocationButton() {
  const btn = document.getElementById('returnToMyLocationBtn');
  if (btn) btn.hidden = locationMode !== 'search';
}


/* ═══════════════════════════════════════════════
   SPEECH HELPERS
════════════════════════════════════════════════ */

function pickPhrase(pool, category) {
  if (!pool?.length) return '';
  if (!phraseHistory[category]) phraseHistory[category] = new Set();

  const used = phraseHistory[category];
  let choices = pool
    .map((_,i) => i)
    .filter(i => !used.has(i));

  if (!choices.length) {
    used.clear();
    choices = pool.map((_,i) => i);
  }

  const choice =
    choices[Math.floor(Math.random() * choices.length)];

  used.add(choice);
  return pool[choice];
}

function splitLongSpeech(text) {
  const cleaned = removeEmojis(text).replace(/\s+/g,' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= 170) return [cleaned];

  const sentences =
    cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];

  const chunks = [];
  let current = '';

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (!current) {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= 170) {
      current += ` ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function polishSegments(segments) {
  const seen = new Set();
  const output = [];

  for (const item of segments) {
    for (const chunk of splitLongSpeech(item)) {
      const key = chunk.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(chunk);
    }
  }

  return output;
}

function renderForSpeech(text) {
  let result = removeEmojis(text)
    .replace(/StormVector Live/g,'StormVector Lyve')
    .replace(/\blive\b/gi,'lyve')
    .replace(/\bSPC\b/g,'S P C')
    .replace(/\bNWS\b/g,'National Weather Service')
    .replace(/\bmph\b/gi,'miles per hour')
    .replace(/°F/g,' degrees')
    .replace(/%/g,' percent');

  for (const [abbr, full] of Object.entries(STATE_NAMES)) {
    result = result.replace(
      new RegExp(`\\b${abbr}\\b`, 'g'),
      full
    );
  }

  return result;
}

function topicForSpeech(text) {
  const value = String(text || '').toLowerCase();

  if (/warning|emergency|breaking weather/.test(value)) return 'WEATHER ALERT';
  if (/watch|storm prediction center|severe risk|tornado risk/.test(value)) return 'SEVERE';
  if (/wind|gust/.test(value)) return 'WIND';
  if (/tonight|forecast|tomorrow|later today|looking ahead/.test(value)) return 'FORECAST';
  if (/changed|since the last/.test(value)) return 'WHAT CHANGED';
  return 'CURRENT CONDITIONS';
}

function createUtterance(text) {
  const u = new SpeechSynthesisUtterance(renderForSpeech(text));

  if (liveVoice) u.voice = liveVoice;

  const isiPhone =
    /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const isAndroid =
    /Android/i.test(navigator.userAgent);

  u.rate = isiPhone ? 0.93 : isAndroid ? 0.92 : 0.96;
  u.pitch = 1;
  u.volume = 1;

  return u;
}

function pickVoice() {
  if (!('speechSynthesis' in window)) return;

  const voices = speechSynthesis.getVoices();

  liveVoice =
    voices.find(v =>
      /en-US/i.test(v.lang) &&
      /Daniel|Aaron|David|Alex|Tom/i.test(v.name)
    ) ||
    voices.find(v => /en-US/i.test(v.lang)) ||
    voices.find(v => /^en/i.test(v.lang)) ||
    voices[0] ||
    null;
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = pickVoice;
  pickVoice();
}


/* ═══════════════════════════════════════════════
   MUSIC
════════════════════════════════════════════════ */

function ensureLiveMusicElement() {
  if (liveMusic) return liveMusic;

  liveMusic = document.getElementById('liveMusic');

  if (!liveMusic) {
    liveMusic = document.createElement('audio');
    liveMusic.id = 'liveMusic';
    liveMusic.src = './stormvector-theme.mp3';
    document.body.appendChild(liveMusic);
  }

  liveMusic.loop = true;
  liveMusic.preload = 'auto';
  liveMusic.setAttribute('playsinline','');

  return liveMusic;
}

function setMusicVolume(target, duration = 350) {
  const music = ensureLiveMusicElement();
  target = clamp(target,0,1);

  if (musicFadeFrame) {
    cancelAnimationFrame(musicFadeFrame);
  }

  const start = music.volume || 0;
  const t0 = performance.now();

  function frame(now) {
    const p =
      duration <= 0
        ? 1
        : clamp((now - t0) / duration,0,1);

    const eased = 1 - Math.pow(1 - p,3);
    music.volume = start + (target - start) * eased;

    if (p < 1) {
      musicFadeFrame = requestAnimationFrame(frame);
    } else {
      musicFadeFrame = null;
    }
  }

  musicFadeFrame = requestAnimationFrame(frame);
}

async function bringMusicUp() {
  const music = ensureLiveMusicElement();

  try {
    if (music.paused) await music.play();
    setMusicVolume(0.17,900);
  } catch (error) {
    console.warn('StormVector music failed:', error);
  }
}

function duckMusic() {
  if (!liveMusic || liveMusic.paused) return;
  setMusicVolume(0.045,260);
}

function sentenceBreakMusic() {
  if (!liveMusic || liveMusic.paused) return;
  setMusicVolume(0.085,220);
}

function restoreMusic() {
  if (!liveMusic || liveMusic.paused) return;
  setMusicVolume(0.17,650);
}

function stopMusic(reset = false) {
  if (!liveMusic) return;

  setMusicVolume(0,300);

  setTimeout(() => {
    if (!liveMusic) return;
    liveMusic.pause();
    if (reset) liveMusic.currentTime = 0;
  },340);
}

function unlockMediaFromGesture() {
  const music = ensureLiveMusicElement();

  try {
    music.volume = 0.02;
    music.play()?.catch(() => {});
  } catch (_) {}

  if ('speechSynthesis' in window) {
    try {
      const u = createUtterance('Vector is loading your weather.');
      u.volume = 0.01;
      speechSynthesis.speak(u);
    } catch (_) {}
  }
}


/* ═══════════════════════════════════════════════
   WEATHER LANGUAGE
════════════════════════════════════════════════ */

function weatherCodePhrase(code) {
  if ([95,96,99].includes(code)) return 'thunderstorms';
  if ([71,73,75,77,85,86].includes(code)) return 'snow';
  if ([61,63,65,80,81,82].includes(code)) return 'rain showers';
  if ([56,57,66,67].includes(code)) return 'freezing precipitation';
  if ([51,53,55].includes(code)) return 'drizzle';
  if ([45,48].includes(code)) return 'fog';
  return null;
}

function skyDescription(code) {
  if (code === 0) return 'clear skies';
  if (code === 1) return 'mostly clear skies';
  if (code === 2) return 'partly cloudy skies';
  if (code === 3) return 'mostly cloudy skies';
  if ([45,48].includes(code)) return 'foggy conditions';
  return weatherCodePhrase(code);
}

function cleanForecastText(text) {
  if (!text) return null;

  let cleaned = removeEmojis(text)
    .replace(/^Tonight:\s*/i,'')
    .replace(/^Today:\s*/i,'')
    .replace(/^This Afternoon:\s*/i,'')
    .replace(/^Overnight:\s*/i,'')
    .replace(/\bChance of precipitation is\b/gi,'Rain chances are')
    .replace(/\bNew precipitation amounts?[^.]*\.?/gi,'')
    .replace(/\s+/g,' ')
    .trim();

  const sentences =
    cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];

  return sentences
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0,3)
    .join(' ')
    .trim();
}


/* ═══════════════════════════════════════════════
   DATA FETCHING
════════════════════════════════════════════════ */

async function fetchAlerts(lat, lon) {
  try {
    const r = await safeFetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        headers: { Accept:'application/geo+json' },
        timeout: 10000
      }
    );

    const data = await r.json();
    return data.features || [];
  } catch (error) {
    console.warn('Alerts failed:', error);
    return [];
  }
}

async function fetchNwsContext(lat, lon) {
  try {
    const response = await safeFetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        headers: { Accept:'application/geo+json' },
        timeout: 10000
      }
    );

    const data = await response.json();
    const p = data.properties || {};
    const rel = p.relativeLocation?.properties;
    const fullState = stateName(rel?.state || '');

    const cityState =
      rel?.city && fullState
        ? `${rel.city}, ${fullState}`
        : rel?.city || fullState || null;

    let periods = [];

    if (p.forecast) {
      try {
        const fr = await safeFetch(p.forecast, {
          headers: { Accept:'application/geo+json' },
          timeout: 10000
        });

        const fd = await fr.json();
        periods = fd.properties?.periods || [];
      } catch (error) {
        console.warn('Forecast failed:', error);
      }
    }

    const now = new Date();

    const currentPeriod =
      periods.find(period => {
        const start = new Date(period.startTime);
        const end = new Date(period.endTime);
        return start <= now && now < end;
      }) || periods[0];

    const nightPeriod =
      periods.find(period =>
        !period.isDaytime &&
        new Date(period.endTime) > now
      );

    const tomorrowDay =
      periods.find(period =>
        period.isDaytime &&
        new Date(period.startTime).getDate() !== now.getDate()
      );

    return {
      cityState,
      observationStationsUrl: p.observationStations || null,
      forecast: {
        today: cleanForecastText(
          currentPeriod?.detailedForecast ||
          currentPeriod?.shortForecast
        ),
        tonight: cleanForecastText(
          nightPeriod?.detailedForecast ||
          nightPeriod?.shortForecast
        ),
        tomorrow: cleanForecastText(
          tomorrowDay?.detailedForecast ||
          tomorrowDay?.shortForecast
        )
      },
      periods
    };
  } catch (error) {
    console.warn('NWS point failed:', error);

    return {
      cityState: null,
      observationStationsUrl: null,
      forecast: {
        today:null,
        tonight:null,
        tomorrow:null
      },
      periods:[]
    };
  }
}

function quantitativeWindToMph(measurement) {
  if (!measurement) return null;
  const value = numberOrNull(measurement.value);
  if (value === null) return null;

  const unit =
    String(measurement.unitCode || '').toLowerCase();

  if (unit.includes('km_h') || unit.includes('km/h')) {
    return kmhToMph(value);
  }

  if (unit.includes('m_s') || unit.includes('m/s')) {
    return metersPerSecondToMph(value);
  }

  if (unit.includes('mi_h') || unit.includes('mph')) {
    return Math.round(value);
  }

  return kmhToMph(value);
}

async function fetchNearestObservation(url) {
  if (!url) return null;

  try {
    const sr = await safeFetch(url, {
      headers: { Accept:'application/geo+json' },
      timeout: 10000
    });

    const stationData = await sr.json();
    const stations = stationData.features || [];

    for (const station of stations.slice(0,6)) {
      const stationId =
        station.properties?.stationIdentifier ||
        station.id?.split('/').pop();

      if (!stationId) continue;

      try {
        const or = await safeFetch(
          `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
          {
            headers: { Accept:'application/geo+json' },
            timeout: 8000
          }
        );

        const data = await or.json();
        const p = data.properties || {};
        const temp = numberOrNull(p.temperature?.value);

        if (temp === null) continue;

        const dew = numberOrNull(p.dewpoint?.value);
        const hum = numberOrNull(p.relativeHumidity?.value);
        const windDir = numberOrNull(p.windDirection?.value);

        return {
          stationId,
          stationName: station.properties?.name || stationId,
          timestamp: p.timestamp || null,
          tempF: celsiusToFahrenheit(temp),
          dewF: dew !== null ? celsiusToFahrenheit(dew) : null,
          humidity: hum !== null ? Math.round(hum) : null,
          windSpd: quantitativeWindToMph(p.windSpeed) ?? 0,
          windG: quantitativeWindToMph(p.windGust) ?? 0,
          windDeg: windDir ?? 0,
          textDescription: removeEmojis(p.textDescription || '')
        };
      } catch (error) {
        console.warn(`Observation ${stationId} failed:`, error);
      }
    }
  } catch (error) {
    console.warn('Station lookup failed:', error);
  }

  return null;
}

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&daily=sunrise,sunset' +
    '&temperature_unit=fahrenheit' +
    '&wind_speed_unit=mph' +
    '&forecast_days=2' +
    '&timezone=auto';

  const response = await safeFetch(url,{ timeout:10000 });
  const data = await response.json();
  const c = data.current || {};
  const d = data.daily || {};

  const formatTime = value => {
    if (!value) return null;
    try {
      return new Date(value).toLocaleTimeString([], {
        hour:'numeric',
        minute:'2-digit'
      });
    } catch (_) {
      return null;
    }
  };

  return {
    tempF: c.temperature_2m !== undefined ? Math.round(c.temperature_2m) : null,
    feelsF: c.apparent_temperature !== undefined ? Math.round(c.apparent_temperature) : null,
    humidity: c.relative_humidity_2m !== undefined ? Math.round(c.relative_humidity_2m) : null,
    dewF: c.dew_point_2m !== undefined ? Math.round(c.dew_point_2m) : null,
    wcode: c.weather_code ?? null,
    windSpd: c.wind_speed_10m !== undefined ? Math.round(c.wind_speed_10m) : 0,
    windDeg: c.wind_direction_10m ?? 0,
    windG: c.wind_gusts_10m !== undefined ? Math.round(c.wind_gusts_10m) : 0,
    sunrise: formatTime(d.sunrise?.[0]),
    sunset: formatTime(d.sunset?.[0]),
    hourly: data.hourly || {}
  };
}


/* ═══════════════════════════════════════════════
   SPC POINT-IN-POLYGON
════════════════════════════════════════════════ */

function pointInRing(point, ring) {
  let inside = false;

  for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      (yi > point[1]) !== (yj > point[1]) &&
      point[0] <
      ((xj - xi) * (point[1] - yi) / (yj - yi)) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point, coordinates) {
  if (
    !coordinates ||
    !coordinates[0] ||
    !pointInRing(point, coordinates[0])
  ) return false;

  for (let i=1; i<coordinates.length; i++) {
    if (pointInRing(point, coordinates[i])) return false;
  }

  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly =>
      pointInPolygon(point, poly)
    );
  }

  return false;
}

async function fetchSpcOutlook(lat, lon) {
  const urls = [
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson'
  ];

  for (const url of urls) {
    try {
      const response = await safeFetch(url,{ timeout:8000 });
      const data = await response.json();
      const point = [lon,lat];
      let best = null;

      for (const feature of data.features || []) {
        const label = String(
          feature.properties?.LABEL ||
          feature.properties?.label ||
          feature.properties?.DN ||
          ''
        ).toUpperCase();

        if (!SPC_RANK[label]) continue;

        if (pointInGeometry(point, feature.geometry)) {
          if (!best || SPC_RANK[label] > SPC_RANK[best]) {
            best = label;
          }
        }
      }

      return best;
    } catch (error) {
      console.warn('SPC outlook failed:', error);
    }
  }

  return null;
}


/* ═══════════════════════════════════════════════
   LOCATION
════════════════════════════════════════════════ */

function geolocationErrorMessage(error) {
  if (!error) return 'StormVector could not get your location.';

  if (error.code === 1) {
    return 'Location access is blocked. Allow location for StormVector and try again.';
  }

  if (error.code === 2) {
    return 'Your device could not determine its current location.';
  }

  if (error.code === 3) {
    return 'The location request timed out. Try again.';
  }

  return 'StormVector could not get your location.';
}

function requestCurrentLocation() {
  return new Promise((resolve,reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error(
        'This browser does not support location services.'
      ));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        deviceLat = position.coords.latitude;
        deviceLon = position.coords.longitude;
        liveLat = deviceLat;
        liveLon = deviceLon;
        locationMode = 'device';
        selectedSearchLocation = null;
        locationReady = true;

        updateReturnLocationButton();
        updateStatusPills('LOCATING');

        resolve(position);
      },
      error => reject(
        new Error(geolocationErrorMessage(error))
      ),
      {
        enableHighAccuracy:true,
        timeout:15000,
        maximumAge:0
      }
    );
  });
}

function startLiveLocationTracking() {
  if (
    !STORMVECTOR_FEATURES.movingLocation ||
    !('geolocation' in navigator)
  ) return;

  stopLiveLocationTracking();

  locationWatchId = navigator.geolocation.watchPosition(
    position => {
      deviceLat = position.coords.latitude;
      deviceLon = position.coords.longitude;

      if (locationMode !== 'device') {
        updateStatusPills();
        return;
      }

      maybeRefreshMovingLocation(
        deviceLat,
        deviceLon
      );
    },
    error => {
      console.warn(
        'StormVector moving GPS failed:',
        geolocationErrorMessage(error)
      );
    },
    {
      enableHighAccuracy:true,
      maximumAge:15000,
      timeout:20000
    }
  );

  updateStatusPills();
}

function stopLiveLocationTracking() {
  if (
    locationWatchId !== null &&
    'geolocation' in navigator
  ) {
    navigator.geolocation.clearWatch(
      locationWatchId
    );
  }

  locationWatchId = null;
}

async function maybeRefreshMovingLocation(newLat, newLon) {
  if (
    movingRefreshRunning ||
    locationMode !== 'device'
  ) return;

  const baselineLat =
    lastWeatherRefreshLat ?? liveLat;

  const baselineLon =
    lastWeatherRefreshLon ?? liveLon;

  if (
    baselineLat == null ||
    baselineLon == null
  ) {
    liveLat = newLat;
    liveLon = newLon;
    return;
  }

  const distance =
    haversineMiles(
      baselineLat,
      baselineLon,
      newLat,
      newLon
    );

  const elapsed =
    Date.now() - lastWeatherRefreshAt;

  if (
    distance < MOVING_REFRESH_MILES &&
    elapsed < MOVING_REFRESH_MS
  ) {
    liveLat = newLat;
    liveLon = newLon;
    updateRadarForLocation();
    return;
  }

  movingRefreshRunning = true;
  updateStatusPills('UPDATING');

  liveLat = newLat;
  liveLon = newLon;

  try {
    await prepareBroadcast({
      movingRefresh:true,
      suppressScriptRestart:true
    });

    if (
      !liveMuted &&
      !breakingWeatherActive
    ) {
      const moveText =
        `Vector has updated coverage for ${liveCityState || 'your current area'} as your location changed.`;

      await interruptSpeechForUpdate(moveText);
    }
  } catch (error) {
    console.warn(
      'Moving weather refresh failed:',
      error
    );
  } finally {
    movingRefreshRunning = false;
    updateStatusPills('LIVE');
  }
}


/* ═══════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════════ */

async function searchUsLocations(query) {
  const term = String(query || '').trim();
  if (term.length < 3) return [];

  if (locationSearchController) {
    locationSearchController.abort();
  }

  locationSearchController = new AbortController();

  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(term)}` +
    '&count=10&language=en&format=json&countryCode=US';

  try {
    const r = await fetch(url,{
      signal: locationSearchController.signal
    });

    if (!r.ok) {
      throw new Error(`Search HTTP ${r.status}`);
    }

    const data = await r.json();

    return (data.results || [])
      .filter(result =>
        Number.isFinite(Number(result.latitude)) &&
        Number.isFinite(Number(result.longitude))
      );
  } catch (error) {
    if (error.name === 'AbortError') return [];
    console.warn('Location search failed:', error);
    return [];
  }
}

function locationResultDisplay(result) {
  const city = result.name || 'Selected location';
  const state = stateName(result.admin1 || '');

  return [city,state]
    .filter(Boolean)
    .join(', ');
}

function renderSearchSuggestions(config, results) {
  const box = document.getElementById(config.suggestionsId);
  const input = document.getElementById(config.inputId);

  if (!box || !input) return;

  box.innerHTML = '';

  if (!results.length) {
    box.innerHTML = `
      <div class="live-search-suggestion">
        <span class="live-search-suggestion-main">
          No U.S. locations found
        </span>
      </div>
    `;
    box.hidden = false;
    input.setAttribute('aria-expanded','true');
    return;
  }

  for (const result of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-search-suggestion';

    const secondary =
      [result.admin2, stateName(result.admin1 || '')]
        .filter(Boolean)
        .join(', ');

    button.innerHTML = `
      <span class="live-search-suggestion-main">
        ${escapeHtml(result.name || '')}
      </span>
      <span class="live-search-suggestion-sub">
        ${escapeHtml(secondary)}
      </span>
    `;

    button.addEventListener('click', () =>
      selectSearchedLocation(result)
    );

    box.appendChild(button);
  }

  box.hidden = false;
  input.setAttribute('aria-expanded','true');
}

function bindLocationSearch(config) {
  const input = document.getElementById(config.inputId);
  const box = document.getElementById(config.suggestionsId);
  const status = document.getElementById(config.statusId);
  const clear = document.getElementById(config.clearId);

  if (!input || !box) return;

  const close = () => {
    box.hidden = true;
    input.setAttribute('aria-expanded','false');
  };

  input.addEventListener('input', () => {
    const query = input.value.trim();

    if (clear) clear.hidden = !query;

    clearTimeout(locationSearchTimer);

    if (query.length < 3) {
      close();
      if (status) status.textContent = '';
      return;
    }

    if (status) status.textContent = 'Searching...';

    locationSearchTimer = setTimeout(async () => {
      const results = await searchUsLocations(query);

      if (input.value.trim() !== query) return;

      if (status) {
        status.textContent =
          results.length
            ? `${results.length} locations found`
            : 'No matching locations';
      }

      renderSearchSuggestions(config, results);
    },300);
  });

  clear?.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    if (status) status.textContent = '';
    close();
    input.focus();
  });

  document.addEventListener('click', event => {
    if (
      event.target === input ||
      box.contains(event.target)
    ) return;

    close();
  });
}

function closeAllSearchSuggestions() {
  for (const id of [
    'liveSearchSuggestions',
    'livePopupSearchSuggestions'
  ]) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
}

function setAllSearchInputs(value) {
  for (const id of [
    'liveLocationSearch',
    'livePopupLocationSearch'
  ]) {
    const input = document.getElementById(id);
    if (input) input.value = value;
  }
}

async function selectSearchedLocation(result) {
  if (!result) return;

  const alreadyStarted = liveStarted;

  unlockMediaFromGesture();

  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);

  liveLat = Number(result.latitude);
  liveLon = Number(result.longitude);
  locationMode = 'search';
  selectedSearchLocation = result;
  locationReady = true;

  broadcastLoopCount = 0;
  spokenFactMemory.clear();
  previousWeatherSnapshot = null;
  latestChanges = [];

  liveCityState = locationResultDisplay(result);

  setLocationText(liveCityState);
  setLocationSource('StormVector selected location');
  updateReturnLocationButton();
  setAllSearchInputs(liveCityState);
  closeAllSearchSuggestions();

  setLiveBadge('UPDATING');
  setCaption(`Loading weather for ${liveCityState}.`);

  try {
    await prepareBroadcast();

    liveStarted = true;
    liveMuted = false;
    document.body.classList.add('broadcast-active');

    hideStartOverlay();
    await bringMusicUp();

    requestWakeLock();
    startSevereWatch();
    startSpeechKeepAlive();
    ensureRadar();

    if (alreadyStarted) {
      await speakStandalone(
        `Switching StormVector coverage to ${liveCityState}.`
      );
    }

    speakSegment(0);
  } catch (error) {
    console.error(
      'Selected location failed:',
      error
    );

    setLiveBadge('ERROR');
    setCaption(
      `StormVector could not load weather for ${liveCityState}.`
    );
  }
}

async function returnToMyLocation() {
  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);
  setLiveBadge('LOCATING');
  setLocationText(
    'Getting your current location...'
  );

  try {
    await requestCurrentLocation();

    broadcastLoopCount = 0;
    spokenFactMemory.clear();
    previousWeatherSnapshot = null;
    latestChanges = [];

    await prepareBroadcast();

    startLiveLocationTracking();
    updateRadarForLocation();

    await speakStandalone(
      `Switching StormVector coverage back to your current location in ${liveCityState || 'your area'}.`
    );

    speakSegment(0);
  } catch (error) {
    setCaption(error.message);
    setLiveBadge('LOCATION ERROR');
  }
}


/* ═══════════════════════════════════════════════
   WEATHER UI
════════════════════════════════════════════════ */

function renderConditionsRow(ctx) {
  const row = document.getElementById('liveConditionsRow');
  if (!row) return;

  const chip = (label,value) => `
    <div class="live-chip">
      <span class="live-chip-label">${label}</span>
      <span class="live-chip-val">${escapeHtml(value)}</span>
    </div>
  `;

  row.innerHTML = [
    ctx.tempF !== null ? chip('TEMP',`${ctx.tempF}°F`) : '',
    ctx.feelsF !== null ? chip('FEELS',`${ctx.feelsF}°F`) : '',
    ctx.dewF !== null ? chip('DEW POINT',`${ctx.dewF}°F`) : '',
    ctx.humidity !== null ? chip('HUMIDITY',`${ctx.humidity}%`) : '',
    chip(
      'WIND',
      `${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`
    ),
    ctx.windG > ctx.windSpd + 5
      ? chip('GUSTS',`${ctx.windG} mph`)
      : ''
  ].join('');
}

function renderObservationInfo(observation) {
  const container = document.getElementById('liveObservationInfo');
  if (!container) return;

  if (!observation) {
    container.hidden = true;
    setText('freshnessObservation','FALLBACK DATA');
    return;
  }

  container.hidden = false;

  setText(
    'liveObservationStation',
    `${observation.stationName} (${observation.stationId})`
  );

  if (observation.timestamp) {
    const minutes = Math.max(
      0,
      Math.round(
        (Date.now() - new Date(observation.timestamp).getTime()) /
        60000
      )
    );

    setText(
      'liveObservationAge',
      minutes <= 1
        ? 'Latest observation'
        : `${minutes} min old`
    );

    setText(
      'freshnessObservation',
      minutes <= 15
        ? 'CURRENT'
        : `${minutes} MIN OLD`
    );
  } else {
    setText('liveObservationAge','');
    setText('freshnessObservation','AVAILABLE');
  }
}

function hourlyConditionShort(code) {
  return skyDescription(code) || 'No precipitation';
}

function renderForecastTimeline(hourly) {
  const container = document.getElementById('forecastTimeline');
  if (!container) return;

  const times = hourly?.time || [];
  const temps = hourly?.temperature_2m || [];
  const pops = hourly?.precipitation_probability || [];
  const codes = hourly?.weather_code || [];
  const winds = hourly?.wind_speed_10m || [];

  if (!times.length) {
    container.innerHTML = `
      <div class="forecast-timeline-empty">
        Hourly forecast is temporarily unavailable.
      </div>
    `;
    return;
  }

  const now = Date.now();

  let start = times.findIndex(value =>
    new Date(value).getTime() >= now - 30 * 60000
  );

  if (start < 0) start = 0;

  const items = [];

  for (let offset=0; offset<12; offset++) {
    const i = start + offset;
    if (i >= times.length) break;

    const time =
      new Date(times[i]).toLocaleTimeString([],{
        hour:'numeric'
      });

    items.push(`
      <div class="forecast-hour">
        <span class="forecast-hour-time">${escapeHtml(time)}</span>
        <strong class="forecast-hour-temp">${Math.round(temps[i])}°</strong>
        <span class="forecast-hour-detail">${Math.round(pops[i] ?? 0)}% precip</span>
        <span class="forecast-hour-detail">Wind ${Math.round(winds[i] ?? 0)} mph</span>
        <span class="forecast-hour-detail">${escapeHtml(hourlyConditionShort(codes[i]))}</span>
      </div>
    `);
  }

  container.innerHTML = items.join('');
}

function updateSpcGraphic(risk) {
  const titles = {
    TSTM:'GENERAL THUNDERSTORMS',
    MRGL:'MARGINAL RISK',
    SLGT:'SLIGHT RISK',
    ENH:'ENHANCED RISK',
    MDT:'MODERATE RISK',
    HIGH:'HIGH RISK'
  };

  const descriptions = {
    TSTM:'Thunderstorms are possible, but organized severe storms are not expected.',
    MRGL:'Isolated severe storms are possible.',
    SLGT:'Scattered severe storms are possible.',
    ENH:'Numerous severe storms are possible in parts of the risk area.',
    MDT:'Widespread severe weather is possible.',
    HIGH:'A significant severe weather outbreak is possible.'
  };

  setText(
    'graphicSpcRisk',
    titles[risk] || 'NO ORGANIZED RISK'
  );

  setText(
    'graphicSpcDescription',
    descriptions[risk] ||
    'No categorical severe weather risk is currently loaded for this location.'
  );
}

function updateAlertGraphic(alerts) {
  const sorted = [...(alerts || [])]
    .sort((a,b) =>
      window.alertPriorityScore(a.properties?.event || '') -
      window.alertPriorityScore(b.properties?.event || '')
    );

  const alert = sorted[0];

  if (!alert) {
    setText('graphicAlertTitle','NO ACTIVE ALERT');
    setText(
      'graphicAlertArea',
      liveCityState || 'Selected location'
    );
    setText(
      'graphicAlertInstruction',
      'No active National Weather Service alert is currently affecting this location.'
    );
    return;
  }

  const p = alert.properties || {};

  setText(
    'graphicAlertTitle',
    p.event || 'WEATHER ALERT'
  );

  setText(
    'graphicAlertArea',
    (p.areaDesc || liveCityState || 'Selected location')
      .split(';')[0]
  );

  setText(
    'graphicAlertInstruction',
    getSafetyInstructions(alert)
  );
}

function updateSevereSummary(ctx) {
  const significant =
    (ctx.alerts || []).filter(alert =>
      isUrgentWarning(alert) ||
      isWatchAlert(alert)
    );

  if (!significant.length) {
    setText(
      'severeAlertSummary',
      'No active severe weather watches or warnings for this location.'
    );
    return;
  }

  setText(
    'severeAlertSummary',
    `Active: ${significant.slice(0,3).map(a =>
      a.properties?.event || 'Weather Alert'
    ).join(', ')}`
  );
}

function updateGraphicsData(ctx) {
  setText('graphicTemp',
    ctx.tempF !== null ? `${ctx.tempF}°` : '--'
  );

  setText('graphicFeels',
    ctx.feelsF !== null ? `${ctx.feelsF}°F` : '--'
  );

  setText('graphicDew',
    ctx.dewF !== null ? `${ctx.dewF}°F` : '--'
  );

  setText('graphicHumidity',
    ctx.humidity !== null ? `${ctx.humidity}%` : '--'
  );

  setText(
    'graphicWind',
    `${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`
  );

  setText(
    'graphicForecastText',
    ctx.forecast?.today ||
    ctx.forecast?.tonight ||
    'Forecast data is currently unavailable.'
  );

  updateSpcGraphic(ctx.spc);
  updateAlertGraphic(ctx.alerts);
  updateSevereSummary(ctx);
  renderForecastTimeline(ctx.hourly);
  updateSpcImages();
}

function updateFreshness(ctx) {
  setText(
    'freshnessForecast',
    (ctx.forecast?.today || ctx.forecast?.tonight)
      ? 'CURRENT'
      : 'UNAVAILABLE'
  );

  setText(
    'freshnessAlerts',
    ctx.alerts.length
      ? `${ctx.alerts.length} ACTIVE`
      : 'CURRENT'
  );

  setText(
    'freshnessRadar',
    radarLastLoaded ? 'CURRENT' : 'READY'
  );
}

function updateSpcImages() {
  const cat = document.getElementById('spcOutlookImage');
  const tor = document.getElementById('spcTornadoImage');

  /*
    SPC's image server can reject/cache-bust URLs with
    extra query strings on some mobile browsers.

    Use the official NOAA/SPC image URL exactly as published,
    and suppress the GitHub Pages referrer.
  */

  if (cat) {
    cat.referrerPolicy = 'no-referrer';
    cat.removeAttribute('crossorigin');

    cat.onload = () =>
      setText(
        'spcOutlookStatus',
        'Official SPC Day 1 outlook loaded.'
      );

    cat.onerror = () =>
      setText(
        'spcOutlookStatus',
        'Official SPC outlook image could not load. Tap the tab again to retry.'
      );

    cat.src =
      'https://www.spc.noaa.gov/products/outlook/day1otlk.gif';
  }

  if (tor) {
    tor.referrerPolicy = 'no-referrer';
    tor.removeAttribute('crossorigin');

    tor.onload = () =>
      setText(
        'spcTornadoStatus',
        'Official SPC tornado outlook loaded.'
      );

    tor.onerror = () =>
      setText(
        'spcTornadoStatus',
        'Official SPC tornado outlook image could not load. Tap the tab again to retry.'
      );

    tor.src =
      'https://www.spc.noaa.gov/products/outlook/day1probotlk_torn.gif';
  }
}


/* ═══════════════════════════════════════════════
   WEATHER THEMES
════════════════════════════════════════════════ */

function setBroadcastBg(ctx) {
  if (
    ctx.alerts.some(alert =>
      window.isTornadoLevel(alert.properties?.event || '')
    )
  ) {
    window.setBgMode('tornado');
    return;
  }

  if ([95,96,99].includes(ctx.wcode)) {
    window.setBgMode('storm');
  } else if ([71,73,75,77,85,86].includes(ctx.wcode)) {
    window.setBgMode('snow');
  } else if ([45,48].includes(ctx.wcode)) {
    window.setBgMode('fog');
  } else if ([51,53,55,61,63,65,80,81,82].includes(ctx.wcode)) {
    window.setBgMode('rain');
  } else if (ctx.wcode === 1) {
    window.setBgMode('partlycloudy');
  } else if ([2,3].includes(ctx.wcode)) {
    window.setBgMode('cloudy');
  } else {
    window.setBgMode('clear');
  }
}

function updateWatchLiveWeatherTheme(ctx) {
  const body = document.body;

  body.classList.remove(
    'weather-theme-watch',
    'weather-theme-warning',
    'weather-theme-critical'
  );

  const level = threatLevel(ctx?.alerts || []);

  if (level === 3) {
    body.classList.add('weather-theme-critical');
  } else if (level === 2) {
    body.classList.add('weather-theme-warning');
  } else if (level === 1) {
    body.classList.add('weather-theme-watch');
  }

  updateStatusPills();
}


/* ═══════════════════════════════════════════════
   WHAT CHANGED
════════════════════════════════════════════════ */

function makeSnapshot(ctx) {
  return {
    tempF:ctx.tempF,
    dewF:ctx.dewF,
    windSpd:ctx.windSpd,
    windG:ctx.windG,
    wcode:ctx.wcode,
    spc:ctx.spc,
    alertMap:new Map(
      (ctx.alerts || []).map(alert => [
        alert.id,
        alert.properties?.event || 'Weather Alert'
      ])
    )
  };
}

function detectWeatherChanges(ctx) {
  if (!STORMVECTOR_FEATURES.changeEngine) return [];

  const next = makeSnapshot(ctx);

  if (!previousWeatherSnapshot) {
    previousWeatherSnapshot = next;

    latestChanges = [{
      text:'StormVector baseline established. Future updates will be compared with these conditions.',
      important:false
    }];

    renderChanges(latestChanges);
    return latestChanges;
  }

  const prev = previousWeatherSnapshot;
  const changes = [];

  if (
    prev.tempF !== null &&
    next.tempF !== null &&
    prev.tempF !== next.tempF
  ) {
    const d = next.tempF - prev.tempF;

    changes.push({
      text:`Temperature ${d > 0 ? 'rose' : 'fell'} ${Math.abs(d)} degree${Math.abs(d) === 1 ? '' : 's'} to ${next.tempF} degrees.`,
      important:Math.abs(d) >= 5
    });
  }

  if (
    Math.abs((next.windSpd ?? 0) - (prev.windSpd ?? 0)) >= 5
  ) {
    changes.push({
      text:`Sustained wind changed from ${prev.windSpd} to ${next.windSpd} miles per hour.`,
      important:next.windSpd >= 25
    });
  }

  if (
    Math.abs((next.windG ?? 0) - (prev.windG ?? 0)) >= 8
  ) {
    changes.push({
      text:`Wind gusts changed from ${prev.windG} to ${next.windG} miles per hour.`,
      important:next.windG >= 40
    });
  }

  if (
    prev.dewF !== null &&
    next.dewF !== null &&
    Math.abs(next.dewF - prev.dewF) >= 3
  ) {
    changes.push({
      text:`The dew point changed from ${prev.dewF} to ${next.dewF} degrees.`,
      important:false
    });
  }

  if (prev.spc !== next.spc) {
    changes.push({
      text:`The Storm Prediction Center category changed from ${prev.spc || 'none'} to ${next.spc || 'none'}.`,
      important:true
    });
  }

  next.alertMap.forEach((event,id) => {
    if (!prev.alertMap.has(id)) {
      changes.push({
        text:`New alert: ${event}.`,
        important:true
      });
    }
  });

  prev.alertMap.forEach((event,id) => {
    if (!next.alertMap.has(id)) {
      changes.push({
        text:`${event} is no longer active for this location.`,
        important:true
      });
    }
  });

  if (!changes.length) {
    changes.push({
      text:'No significant weather changes since the previous StormVector update.',
      important:false
    });
  }

  previousWeatherSnapshot = next;
  latestChanges = changes;
  renderChanges(changes);

  return changes;
}

function renderChanges(changes) {
  setText(
    'weatherChangesTime',
    `Updated ${new Date().toLocaleTimeString([],{
      hour:'numeric',
      minute:'2-digit'
    })}`
  );

  const full = document.getElementById('weatherChangesList');
  const graphic = document.getElementById('graphicChangesList');

  const html = changes.map(change => `
    <div class="weather-change-item">
      ${escapeHtml(change.text)}
    </div>
  `).join('');

  if (full) full.innerHTML = html;

  if (graphic) {
    graphic.innerHTML = changes.slice(0,5).map(change => `
      <div class="graphic-change-item">
        ${escapeHtml(change.text)}
      </div>
    `).join('');
  }
}


/* ═══════════════════════════════════════════════
   BROADCAST SCRIPT
════════════════════════════════════════════════ */

const PHRASES = {
  steady:[
    'Conditions are holding fairly steady.',
    'Not much has changed since the last update.',
    'The overall weather picture is fairly steady.'
  ],
  closers:[
    "That's the latest. I'll keep watching for changes.",
    "That's your StormVector update. I'll keep monitoring the weather.",
    "That's where things stand right now. I'll update you when something changes."
  ]
};

function addCurrentConditions(segments,ctx) {
  if (ctx.tempF === null) return;

  const feels =
    ctx.feelsF !== null &&
    Math.abs(ctx.feelsF - ctx.tempF) >= 3
      ? ` and it feels like ${ctx.feelsF}`
      : '';

  segments.push(
    `Right now in ${ctx.cityState || 'your area'}, it's ${ctx.tempF} degrees${feels}.`
  );

  const condition = skyDescription(ctx.wcode);
  if (condition) {
    segments.push(
      `Current conditions are ${condition}.`
    );
  }

  spokenFactMemory.set('temperature',ctx.tempF);
}

function addWind(segments,ctx,force=false) {
  if (
    !force &&
    ctx.windSpd < 7 &&
    ctx.windG < 12
  ) return;

  const dir =
    window.degToCompass(ctx.windDeg) || 'variable';

  segments.push(
    `Wind is ${dir} at ${ctx.windSpd} miles per hour${ctx.windG > ctx.windSpd + 5 ? `, with gusts near ${ctx.windG}` : ''}.`
  );
}

function addSpc(segments,spc) {
  const labels = {
    TSTM:'general thunderstorms',
    MRGL:'a marginal risk for severe storms',
    SLGT:'a slight risk for severe storms',
    ENH:'an enhanced risk for severe storms',
    MDT:'a moderate risk for severe storms',
    HIGH:'a high risk for severe storms'
  };

  if (!labels[spc]) return;

  segments.push(
    `The Storm Prediction Center has this location under ${labels[spc]} today.`
  );
}

function getSafetyInstructions(alert) {
  const p = alert?.properties || {};
  const official =
    removeEmojis(p.instruction || '').trim();

  if (official) return official;

  const event =
    String(p.event || '').toLowerCase();

  if (event.includes('tornado')) {
    return 'Move to a basement or small interior room on the lowest floor of a sturdy building. Stay away from windows. If you are in a vehicle or mobile home, get to a sturdy shelter if you can do so safely.';
  }

  if (event.includes('severe thunderstorm')) {
    return 'Move indoors to a sturdy building and stay away from windows. Avoid unnecessary travel until the warning passes. Be prepared for damaging wind, hail, and rapidly changing conditions.';
  }

  if (event.includes('flash flood')) {
    return 'Move to higher ground. Do not walk or drive through flood water. Turn around, do not drown.';
  }

  if (event.includes('snow squall')) {
    return 'Avoid or delay travel if possible. If you are driving, slow down gradually, turn on headlights and hazard lights, and increase following distance.';
  }

  if (event.includes('blizzard')) {
    return 'Avoid travel. Stay indoors if possible. If you must travel, carry emergency supplies and be prepared for whiteout conditions.';
  }

  if (event.includes('ice storm')) {
    return 'Avoid travel and stay away from downed power lines. Prepare for dangerous roads and possible power outages.';
  }

  return 'Follow the latest National Weather Service instructions for your location.';
}

function buildUrgentSevereScript(ctx) {
  const urgent =
    getPriorityAlerts(ctx.alerts)
      .filter(isUrgentWarning);

  const segments = [];

  for (const alert of urgent.slice(0,2)) {
    const p = alert.properties || {};
    const area =
      (p.areaDesc || ctx.cityState || 'your area')
        .split(';')[0];

    segments.push(
      `Urgent weather update. A ${p.event || 'weather warning'} is in effect for ${area}.`
    );

    const movement =
      window.parseMovement(p.description || '');

    if (movement) {
      segments.push(
        `The storm is moving ${movement.dir} at ${movement.spd} miles per hour.`
      );
    }

    segments.push(
      getSafetyInstructions(alert)
    );
  }

  segments.push(
    'StormVector will stay focused on this warning until the immediate threat is no longer active.'
  );

  return polishSegments(segments);
}

function buildScript(ctx) {
  if (severeOnlyMode(ctx)) {
    liveSegments = buildUrgentSevereScript(ctx);
    liveSegIdx = 0;
    return;
  }

  const segments = [];

  if (broadcastLoopCount === 0) {
    segments.push(
      `Vector here. I've got the latest weather loaded for ${ctx.cityState || 'your location'}.`
    );
  } else {
    const important =
      latestChanges.some(change => change.important);

    if (important) {
      segments.push(
        "Here's what's changed since the last update."
      );

      latestChanges
        .filter(change => change.important)
        .slice(0,2)
        .forEach(change =>
          segments.push(change.text)
        );
    } else {
      segments.push(
        pickPhrase(PHRASES.steady,'steady')
      );
    }
  }

  const watches =
    getPriorityAlerts(ctx.alerts)
      .filter(isWatchAlert);

  if (watches.length) {
    const p = watches[0].properties || {};
    segments.push(
      `A ${p.event || 'weather watch'} is in effect for the area. This means conditions are favorable for hazardous weather, so stay weather-aware.`
    );
  }

  addCurrentConditions(segments,ctx);
  addWind(segments,ctx);
  addSpc(segments,ctx.spc);

  if (ctx.forecast?.today) {
    segments.push(
      `Looking ahead, ${ctx.forecast.today}`
    );
  }

  if (
    broadcastLoopCount % 2 === 1 &&
    ctx.forecast?.tonight
  ) {
    segments.push(
      `For tonight, ${ctx.forecast.tonight}`
    );
  }

  segments.push(
    pickPhrase(PHRASES.closers,'closers')
  );

  liveSegments = polishSegments(segments);
  liveSegIdx = 0;
}


/* ═══════════════════════════════════════════════
   PREPARE / REFRESH
════════════════════════════════════════════════ */

async function prepareBroadcast(options = {}) {
  if (
    !locationReady ||
    liveLat === null ||
    liveLon === null
  ) {
    throw new Error(
      'StormVector does not have a location yet.'
    );
  }

  setLiveBadge('UPDATING');
  setText('vectorGraphicStatus','UPDATING');

  const [nws,fallback,alerts,spc] =
    await Promise.all([
      fetchNwsContext(liveLat,liveLon),
      fetchOpenMeteo(liveLat,liveLon).catch(error => {
        console.warn('Open-Meteo failed:',error);
        return {};
      }),
      fetchAlerts(liveLat,liveLon),
      fetchSpcOutlook(liveLat,liveLon).catch(() => null)
    ]);

  const observation =
    await fetchNearestObservation(
      nws.observationStationsUrl
    );

  if (
    locationMode === 'search' &&
    selectedSearchLocation
  ) {
    liveCityState =
      locationResultDisplay(selectedSearchLocation);
  } else {
    liveCityState = nws.cityState;
  }

  setLocationText(
    liveCityState ||
    `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`
  );

  setLocationSource(
    locationMode === 'search'
      ? 'StormVector selected location'
      : 'StormVector live device location'
  );

  const ctx = {
    cityState:liveCityState,
    tempF:observation?.tempF ?? fallback.tempF ?? null,
    feelsF:fallback.feelsF ?? observation?.tempF ?? null,
    humidity:observation?.humidity ?? fallback.humidity ?? null,
    dewF:observation?.dewF ?? fallback.dewF ?? null,
    wcode:fallback.wcode ?? null,
    windSpd:observation?.windSpd ?? fallback.windSpd ?? 0,
    windDeg:observation?.windDeg ?? fallback.windDeg ?? 0,
    windG:observation?.windG ?? fallback.windG ?? 0,
    sunrise:fallback.sunrise ?? null,
    sunset:fallback.sunset ?? null,
    hourly:fallback.hourly ?? {},
    alerts:alerts || [],
    forecast:nws.forecast || {
      today:null,
      tonight:null,
      tomorrow:null
    },
    spc:spc || null,
    observation:observation || null
  };

  currentWeatherContext = ctx;

  ctx.alerts.forEach(alert => {
    if (
      isUrgentWarning(alert) ||
      isWatchAlert(alert)
    ) {
      knownPriorityAlertIds.add(alert.id);
    }
  });

  renderConditionsRow(ctx);
  renderObservationInfo(observation);
  setBroadcastBg(ctx);
  updateWatchLiveWeatherTheme(ctx);
  updateGraphicsData(ctx);
  detectWeatherChanges(ctx);
  updateFreshness(ctx);
  buildScript(ctx);
  updateRadarForLocation();

  lastWeatherRefreshLat = liveLat;
  lastWeatherRefreshLon = liveLon;
  lastWeatherRefreshAt = Date.now();

  setText('vectorGraphicStatus','CURRENT');

  updateStatusPills(
    severeOnlyMode(ctx)
      ? 'SEVERE WEATHER'
      : 'LIVE'
  );

  return ctx;
}


/* ═══════════════════════════════════════════════
   SPEECH
════════════════════════════════════════════════ */

function addBroadcastHistory(text) {
  if (!STORMVECTOR_FEATURES.broadcastHistory) return;

  const cleaned = removeEmojis(text);
  if (!cleaned) return;

  if (
    broadcastHistory[0] &&
    broadcastHistory[0].text === cleaned
  ) return;

  broadcastHistory.unshift({
    text:cleaned,
    time:new Date()
  });

  if (broadcastHistory.length > MAX_HISTORY_ITEMS) {
    broadcastHistory.length = MAX_HISTORY_ITEMS;
  }

  renderBroadcastHistory();
}

function renderBroadcastHistory() {
  const container =
    document.getElementById('broadcastHistoryList');

  if (!container) return;

  if (!broadcastHistory.length) {
    container.textContent =
      'No broadcast history yet.';
    return;
  }

  container.innerHTML =
    broadcastHistory.map(item => `
      <div class="broadcast-history-item">
        <span class="broadcast-history-time">
          ${escapeHtml(item.time.toLocaleTimeString([],{
            hour:'numeric',
            minute:'2-digit'
          }))}
        </span>
        ${escapeHtml(item.text)}
      </div>
    `).join('');
}

function speakSegment(index) {
  if (
    breakingWeatherActive ||
    liveMuted ||
    !liveSegments.length
  ) return;

  if (!('speechSynthesis' in window)) {
    if (liveSegments[index]) {
      setCaption(liveSegments[index]);
    }
    return;
  }

  if (index >= liveSegments.length) {
    finishBroadcastLoop();
    return;
  }

  liveSegIdx = index;

  const text = liveSegments[index];
  const generation = speechGeneration;
  const u = createUtterance(text);

  u.onstart = () => {
    if (generation !== speechGeneration) return;

    duckMusic();
    setLiveBadge(
      severeOnlyMode()
        ? 'SEVERE WEATHER'
        : 'LIVE'
    );
    setRobotSpeaking(true);
    setCaption(text);
    setCaptionTopic(topicForSpeech(text));
    addBroadcastHistory(text);
  };

  u.onend = () => {
    if (generation !== speechGeneration) return;

    setRobotSpeaking(false);

    if (
      liveMuted ||
      breakingWeatherActive
    ) return;

    sentenceBreakMusic();

    const pause =
      /warning|emergency/i.test(text)
        ? 650
        : text.length > 145
          ? 500
          : 350;

    setTimeout(() => {
      if (
        generation === speechGeneration &&
        !liveMuted &&
        !breakingWeatherActive
      ) {
        speakSegment(index + 1);
      }
    },pause);
  };

  u.onerror = () => {
    setRobotSpeaking(false);

    setTimeout(() => {
      if (
        generation === speechGeneration &&
        !liveMuted &&
        !breakingWeatherActive
      ) {
        speakSegment(index + 1);
      }
    },450);
  };

  speechSynthesis.speak(u);
}

function speakStandalone(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) {
      setCaption(text);
      resolve();
      return;
    }

    const u = createUtterance(text);

    u.onstart = () => {
      duckMusic();
      setRobotSpeaking(true);
      setCaption(text);
      setCaptionTopic(topicForSpeech(text));
      addBroadcastHistory(text);
    };

    u.onend = () => {
      setRobotSpeaking(false);
      sentenceBreakMusic();
      resolve();
    };

    u.onerror = () => {
      setRobotSpeaking(false);
      resolve();
    };

    speechSynthesis.speak(u);
  });
}

async function interruptSpeechForUpdate(text) {
  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);
  await wait(100);
  await speakStandalone(text);

  if (
    !liveMuted &&
    !breakingWeatherActive
  ) {
    await wait(500);
    buildScript(currentWeatherContext);
    speakSegment(0);
  }
}

async function finishBroadcastLoop() {
  setRobotSpeaking(false);
  setLiveBadge('CHECKING WEATHER');
  setCaptionTopic('NEXT UPDATE');
  restoreMusic();

  const severe = severeOnlyMode();
  await wait(severe ? 4500 : 9000);

  if (
    liveMuted ||
    breakingWeatherActive
  ) return;

  broadcastLoopCount++;

  try {
    await prepareBroadcast();
  } catch (error) {
    console.error('Broadcast refresh failed:',error);
    setLiveBadge('RETRYING');
    await wait(4000);
  }

  if (
    liveMuted ||
    breakingWeatherActive
  ) return;

  await wait(700);
  speakSegment(0);
}

function replaySegment() {
  if (
    !liveSegments.length ||
    liveMuted
  ) return;

  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);

  setTimeout(() =>
    speakSegment(liveSegIdx),
    150
  );
}

async function toggleMute() {
  const button =
    document.getElementById('liveMuteBtn');

  liveMuted = !liveMuted;
  speechGeneration++;

  if (liveMuted) {
    try {
      speechSynthesis.cancel();
    } catch (_) {}

    setRobotSpeaking(false);
    stopMusic(false);
    stopSevereWatch();
    stopSpeechKeepAlive();
    releaseWakeLock();

    setLiveBadge('MUTED');

    if (button) button.textContent = 'RESUME';
    return;
  }

  if (button) button.textContent = 'STOP';

  await bringMusicUp();
  requestWakeLock();
  startSevereWatch();
  startSpeechKeepAlive();

  await wait(150);
  speakSegment(liveSegIdx);
}


/* ═══════════════════════════════════════════════
   START
════════════════════════════════════════════════ */

async function startBroadcast() {
  if (startupRunning) return;
  startupRunning = true;

  const button =
    document.getElementById('liveStartBtn');

  unlockMediaFromGesture();

  if (button) {
    button.disabled = true;
    button.textContent = 'GETTING LOCATION...';
  }

  try {
    if (!locationReady) {
      setLocationText(
        'Waiting for location permission...'
      );

      await requestCurrentLocation();
    }

    if (button) {
      button.textContent = 'LOADING WEATHER...';
    }

    await prepareBroadcast();

    liveStarted = true;
    liveMuted = false;
    document.body.classList.add('broadcast-active');

    hideStartOverlay();
    await bringMusicUp();

    requestWakeLock();
    startSevereWatch();
    startSpeechKeepAlive();
    startLiveLocationTracking();
    ensureRadar();

    setLiveBadge(
      severeOnlyMode()
        ? 'SEVERE WEATHER'
        : 'LIVE'
    );

    await speakStandalone(
      severeOnlyMode()
        ? 'Vector is live. There is an active warning affecting your area, so I am switching to urgent weather coverage.'
        : `Vector is live for ${liveCityState || 'your area'}.`
    );

    speakSegment(0);
  } catch (error) {
    console.error('StormVector startup failed:',error);

    try {
      speechSynthesis.cancel();
    } catch (_) {}

    setRobotSpeaking(false);
    stopMusic(false);
    setLiveBadge('STANDBY');

    setLocationText(
      error.message ||
      'Unable to start StormVector.'
    );

    setCaption(
      'StormVector could not start. Check location permission and try again.'
    );

    if (button) {
      button.disabled = false;
      button.textContent = 'USE MY LOCATION';
    }
  } finally {
    startupRunning = false;
  }
}


/* ═══════════════════════════════════════════════
   SEVERE WATCH / TAKEOVER
════════════════════════════════════════════════ */

function startSevereWatch() {
  stopSevereWatch();

  severeWatchTimer =
    setInterval(
      checkForBreakingWeather,
      ALERT_CHECK_MS
    );
}

function stopSevereWatch() {
  if (severeWatchTimer) {
    clearInterval(severeWatchTimer);
  }

  severeWatchTimer = null;
}

async function checkForBreakingWeather() {
  if (
    liveMuted ||
    breakingWeatherActive ||
    !locationReady
  ) return;

  try {
    const alerts =
      await fetchAlerts(liveLat,liveLon);

    const priority =
      getPriorityAlerts(alerts);

    const newAlerts =
      priority.filter(alert =>
        !knownPriorityAlertIds.has(alert.id)
      );

    priority.forEach(alert =>
      knownPriorityAlertIds.add(alert.id)
    );

    if (currentWeatherContext) {
      currentWeatherContext.alerts = alerts;
      updateWatchLiveWeatherTheme(
        currentWeatherContext
      );
      updateAlertGraphic(alerts);
      updateSevereSummary(
        currentWeatherContext
      );
      updateRadarWarnings();
    }

    const breaking =
      newAlerts.find(isUrgentWarning);

    if (breaking) {
      await interruptForBreakingWeather(
        breaking
      );
    }
  } catch (error) {
    console.warn(
      'Severe watch failed:',
      error
    );
  }
}

async function playAttentionTone() {
  try {
    const AC =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AC) return;

    const context = new AC();

    if (context.state === 'suspended') {
      await context.resume();
    }

    const gain = context.createGain();
    gain.gain.value = 0.16;
    gain.connect(context.destination);

    [853,960].forEach(frequency => {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start();
      osc.stop(context.currentTime + 2.5);
    });

    await wait(2600);
    await context.close().catch(() => {});
  } catch (error) {
    console.warn('Attention tone failed:',error);
  }
}

function showSevereTakeover(alert) {
  if (!STORMVECTOR_FEATURES.severeTakeover) return;

  if (!severeTakeoverActive) {
    viewBeforeSevere = selectedView;
  }

  severeTakeoverActive = true;

  const p = alert.properties || {};
  const takeover =
    document.getElementById('severeTakeover');

  setText(
    'severeTakeoverTitle',
    p.event || 'WEATHER WARNING'
  );

  setText(
    'severeTakeoverArea',
    (p.areaDesc || liveCityState || 'Current location')
      .split(';')[0]
  );

  setText(
    'severeTakeoverSafety',
    getSafetyInstructions(alert)
  );

  if (takeover) takeover.hidden = false;

  document.body.classList.add('severe-mode');

  selectView('radar',{ manual:false });
  updateAlertGraphic([alert]);
}

function hideSevereTakeover(restoreView=true) {
  const takeover =
    document.getElementById('severeTakeover');

  if (takeover) takeover.hidden = true;

  document.body.classList.remove('severe-mode');
  severeTakeoverActive = false;

  if (restoreView) {
    selectView(
      viewBeforeSevere,
      { manual:false }
    );
  }
}

async function interruptForBreakingWeather(alert) {
  breakingWeatherActive = true;
  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);
  setMusicVolume(0.02,200);
  setLiveBadge('BREAKING');

  const banner =
    document.getElementById('liveBreakingBanner');

  if (banner) banner.hidden = false;

  showSevereTakeover(alert);
  ensureRadar();

  await playAttentionTone();

  const p = alert.properties || {};
  const area =
    (p.areaDesc || 'your area')
      .split(';')[0];

  const movement =
    window.parseMovement(p.description || '');

  const messages = [
    'This is a StormVector Breaking Weather update.',
    `A ${p.event || 'weather warning'} has been issued for ${area}.${movement ? ` The storm is moving ${movement.dir} at ${movement.spd} miles per hour.` : ''}`,
    getSafetyInstructions(alert)
  ];

  await speakSequential(messages);

  try {
    await prepareBroadcast();
  } catch (error) {
    console.warn(
      'Post-alert refresh failed:',
      error
    );
  }

  if (banner) banner.hidden = true;

  hideSevereTakeover(true);
  breakingWeatherActive = false;
  restoreMusic();

  if (!liveMuted) {
    await wait(500);
    speakSegment(0);
  }
}

function speakSequential(messages) {
  return new Promise(resolve => {
    let index = 0;

    function next() {
      if (index >= messages.length) {
        setRobotSpeaking(false);
        resolve();
        return;
      }

      const text = messages[index];
      const u = createUtterance(text);
      u.rate = 0.92;

      u.onstart = () => {
        duckMusic();
        setRobotSpeaking(true);
        setCaption(text);
        setCaptionTopic('BREAKING WEATHER');
        addBroadcastHistory(text);
      };

      u.onend = () => {
        setRobotSpeaking(false);
        sentenceBreakMusic();
        index++;
        setTimeout(next,400);
      };

      u.onerror = () => {
        setRobotSpeaking(false);
        index++;
        next();
      };

      speechSynthesis.speak(u);
    }

    next();
  });
}


/* ═══════════════════════════════════════════════
   VIEWS / RADAR PRODUCT TABS
════════════════════════════════════════════════ */

const VIEW_TITLES = {
  conditions:'CURRENT CONDITIONS',
  radar:'LIVE RADAR',
  forecast:'FORECAST',
  spc:'SEVERE WEATHER',
  changes:'WHAT CHANGED',
  alert:'WEATHER ALERT'
};

function selectView(view,{ manual=true }={}) {
  const allowed = [
    'conditions',
    'radar',
    'forecast',
    'spc',
    'changes',
    'alert'
  ];

  if (!allowed.includes(view)) return;

  document.querySelectorAll('.vector-graphic-view')
    .forEach(el =>
      el.classList.remove('active')
    );

  document.querySelector(
    `[data-graphic="${view}"]`
  )?.classList.add('active');

  document.querySelectorAll('.live-view-btn')
    .forEach(button => {
      const active =
        button.dataset.view === view;

      button.classList.toggle(
        'active',
        active
      );

      button.setAttribute(
        'aria-selected',
        String(active)
      );
    });

  setText(
    'vectorGraphicTitle',
    VIEW_TITLES[view] ||
    'STORMVECTOR DISPLAY'
  );

  if (manual && view !== 'alert') {
    selectedView = view;
  }

  if (view === 'radar') {
    ensureRadar();

    setTimeout(() =>
      radarMap?.invalidateSize(),
      150
    );
  }
}

function bindViewSelector() {
  document.querySelectorAll('.live-view-btn')
    .forEach(button => {
      button.addEventListener('click', () =>
        selectView(button.dataset.view,{
          manual:true
        })
      );
    });

  document.getElementById('severeOpenRadarBtn')
    ?.addEventListener('click', () =>
      selectView('radar',{ manual:true })
    );
}

function selectRadarProduct(product) {
  document.querySelectorAll('.radar-product-btn')
    .forEach(btn => {
      btn.classList.toggle(
        'active',
        btn.dataset.radarProduct === product
      );
    });

  document.querySelectorAll('.radar-product-panel')
    .forEach(panel =>
      panel.classList.remove('active')
    );

  const map = {
    radar:'radarProductRadar',
    spc:'radarProductSpc',
    tornado:'radarProductTornado'
  };

  document.getElementById(map[product])
    ?.classList.add('active');

  if (product === 'radar') {
    ensureRadar();
    setTimeout(() =>
      radarMap?.invalidateSize(),
      150
    );
  } else {
    updateSpcImages();
  }
}

function bindRadarProductTabs() {
  document.querySelectorAll('.radar-product-btn')
    .forEach(button => {
      button.addEventListener('click', () =>
        selectRadarProduct(
          button.dataset.radarProduct
        )
      );
    });
}


/* ═══════════════════════════════════════════════
   RADAR
════════════════════════════════════════════════ */

function setRadarStatus(text) {
  setText('radarStatus',text);
}

function warningPolygonStyle(feature) {
  const event =
    String(feature.properties?.event || '')
      .toLowerCase();

  if (event.includes('tornado')) {
    return {
      color:'#ff2020',
      weight:4,
      fillColor:'#ff2020',
      fillOpacity:0.08
    };
  }

  if (event.includes('severe thunderstorm')) {
    return {
      color:'#ffb000',
      weight:3,
      fillColor:'#ffb000',
      fillOpacity:0.07
    };
  }

  if (event.includes('flash flood')) {
    return {
      color:'#29d65b',
      weight:3,
      fillColor:'#29d65b',
      fillOpacity:0.06
    };
  }

  return {
    color:'#ff6633',
    weight:2,
    fillOpacity:0.04
  };
}

function ensureRadar() {
  if (!STORMVECTOR_FEATURES.radar) return;

  if (radarMap) {
    updateRadarForLocation();
    return;
  }

  if (typeof L === 'undefined') {
    setRadarStatus(
      'Radar map library unavailable.'
    );
    return;
  }

  const target =
    document.getElementById('stormVectorRadar');

  if (!target) return;

  radarMap = L.map(target,{
    zoomControl:true,
    attributionControl:true
  }).setView(
    [liveLat || 39, liveLon || -98],
    liveLat !== null ? 8 : 4
  );

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      maxZoom:19,
      subdomains:'abcd',
      attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
    }
  ).addTo(radarMap);

  radarLayer = L.tileLayer.wms(
    'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows',
    {
      layers:'conus_bref_qcd',
      format:'image/png',
      transparent:true,
      version:'1.1.1',
      tiled:true,
      opacity:0.78,
      attribution:'NOAA/NWS MRMS'
    }
  );

  radarLayer.addTo(radarMap);

  radarLayer.on('loading', () => {
    setRadarStatus(
      'Loading NOAA MRMS radar...'
    );
    setText('freshnessRadar','LOADING');
  });

  radarLayer.on('load', () => {
    radarLastLoaded = new Date();

    setRadarStatus(
      'NOAA MRMS radar current'
    );

    setText(
      'radarTimestamp',
      `Loaded ${radarLastLoaded.toLocaleTimeString([],{
        hour:'numeric',
        minute:'2-digit'
      })}`
    );

    setText('freshnessRadar','CURRENT');
  });

  radarLayer.on('tileerror', () => {
    setRadarStatus(
      'Radar tile unavailable. Retrying automatically.'
    );
    setText('freshnessRadar','RETRYING');
  });

  radarWarningLayer = L.geoJSON(null,{
    style:warningPolygonStyle,
    onEachFeature:(feature,layer) => {
      const p = feature.properties || {};

      layer.bindPopup(
        `<strong>${escapeHtml(p.event || 'Weather Alert')}</strong><br>${escapeHtml(p.areaDesc || '')}`
      );
    }
  }).addTo(radarMap);

  updateRadarForLocation();

  setTimeout(() =>
    radarMap?.invalidateSize(),
    200
  );
}

function createRadarMarker() {
  if (
    !radarMap ||
    liveLat === null ||
    liveLon === null
  ) return;

  const latLng = [liveLat,liveLon];

  if (radarMarker) {
    radarMarker.setLatLng(latLng);
    return;
  }

  const icon = L.divIcon({
    className:'',
    html:'<div class="sv-radar-location-marker"></div>',
    iconSize:[18,18],
    iconAnchor:[9,9]
  });

  radarMarker = L.marker(latLng,{ icon })
    .addTo(radarMap);
}

function radarZoomLevel() {
  if (radarZoomMode === 'regional') return 5;
  if (radarZoomMode === 'state') return 7;
  return 9;
}

function setRadarZoomMode(mode) {
  radarZoomMode = mode;

  const ids = {
    local:'radarLocalBtn',
    regional:'radarRegionalBtn',
    state:'radarStateBtn'
  };

  for (const [key,id] of Object.entries(ids)) {
    document.getElementById(id)
      ?.classList.toggle(
        'active',
        key === mode
      );
  }

  if (
    radarMap &&
    liveLat !== null &&
    liveLon !== null
  ) {
    radarMap.setView(
      [liveLat,liveLon],
      radarZoomLevel()
    );
  }
}

function updateRadarForLocation() {
  if (
    !radarMap ||
    liveLat === null ||
    liveLon === null
  ) return;

  createRadarMarker();

  radarMarker?.bindTooltip(
    liveCityState || 'StormVector location',
    { direction:'top' }
  );

  radarMap.setView(
    [liveLat,liveLon],
    radarZoomLevel()
  );

  updateRadarWarnings();

  setTimeout(() =>
    radarMap?.invalidateSize(),
    120
  );
}

function updateRadarWarnings() {
  if (!radarWarningLayer) return;

  radarWarningLayer.clearLayers();

  if (
    !radarWarningsVisible ||
    !STORMVECTOR_FEATURES.warningPolygons ||
    !currentWeatherContext
  ) return;

  currentWeatherContext.alerts
    .filter(alert =>
      alert.geometry &&
      isUrgentWarning(alert)
    )
    .forEach(alert =>
      radarWarningLayer.addData(alert)
    );
}

function refreshRadar() {
  if (!radarLayer) {
    ensureRadar();
    return;
  }

  setRadarStatus(
    'Refreshing NOAA MRMS radar...'
  );
  setText('freshnessRadar','REFRESHING');

  radarLayer.setParams({
    _stormvector:Date.now()
  },false);

  radarLayer.redraw();
}

function bindRadarControls() {
  document.getElementById('radarLocalBtn')
    ?.addEventListener('click', () =>
      setRadarZoomMode('local')
    );

  document.getElementById('radarRegionalBtn')
    ?.addEventListener('click', () =>
      setRadarZoomMode('regional')
    );

  document.getElementById('radarStateBtn')
    ?.addEventListener('click', () =>
      setRadarZoomMode('state')
    );

  document.getElementById('radarCenterBtn')
    ?.addEventListener('click', () => {
      if (
        radarMap &&
        liveLat !== null &&
        liveLon !== null
      ) {
        radarMap.setView(
          [liveLat,liveLon],
          radarZoomLevel()
        );
      }
    });

  const warnings =
    document.getElementById('radarWarningsBtn');

  warnings?.addEventListener('click', () => {
    radarWarningsVisible =
      !radarWarningsVisible;

    warnings.classList.toggle(
      'active',
      radarWarningsVisible
    );

    warnings.textContent =
      radarWarningsVisible
        ? 'WARNINGS ON'
        : 'WARNINGS OFF';

    updateRadarWarnings();
  });

  document.getElementById('radarRefreshBtn')
    ?.addEventListener('click',refreshRadar);
}


/* ═══════════════════════════════════════════════
   ASK VECTOR
════════════════════════════════════════════════ */

function spcSpeechName(risk) {
  const labels = {
    TSTM:'general thunderstorms',
    MRGL:'marginal risk',
    SLGT:'slight risk',
    ENH:'enhanced risk',
    MDT:'moderate risk',
    HIGH:'high risk'
  };

  return labels[risk] ||
    'no organized severe weather risk';
}

function answerVectorQuestion(question) {
  const ctx = currentWeatherContext;

  if (!ctx) {
    return 'I need a weather location loaded before I can answer that.';
  }

  const q = String(question || '').toLowerCase();
  const location = ctx.cityState || 'this location';

  if (/tomorrow/.test(q)) {
    lastAskTopic = 'forecast';

    return ctx.forecast?.tomorrow
      ? `For ${location} tomorrow, ${ctx.forecast.tomorrow}`
      : `I don't currently have a reliable tomorrow forecast loaded for ${location}.`;
  }

  if (/rain|precipitation|umbrella/.test(q)) {
    lastAskTopic = 'rain';

    const tonight = ctx.forecast?.tonight || '';

    if (!tonight) {
      return `I don't currently have enough forecast information to give you a reliable answer about rain tonight in ${location}.`;
    }

    if (/rain|shower|thunderstorm|drizzle|precipitation/i.test(tonight)) {
      return `For ${location}, precipitation is included in tonight's National Weather Service forecast. ${tonight}`;
    }

    return `For ${location}, tonight's National Weather Service forecast does not currently mention rain or thunderstorms. ${tonight}`;
  }

  if (/severe|storm threat|tornado|risk|spc/.test(q)) {
    lastAskTopic = 'severe';

    const priority =
      getPriorityAlerts(ctx.alerts);

    if (priority.length) {
      return `For ${location}, the highest-priority active alert is a ${priority[0].properties?.event || 'weather alert'}. The Storm Prediction Center category is ${spcSpeechName(ctx.spc)}.`;
    }

    return `There are no active National Weather Service warnings or watches for ${location} right now. The Storm Prediction Center category is ${spcSpeechName(ctx.spc)}.`;
  }

  if (/wind|windy|gust/.test(q)) {
    lastAskTopic = 'wind';

    const dir =
      window.degToCompass(ctx.windDeg) || 'variable';

    return `For ${location}, wind is ${dir} at about ${ctx.windSpd} miles per hour${ctx.windG > ctx.windSpd + 5 ? `, with gusts around ${ctx.windG} miles per hour` : ''}.`;
  }

  if (/temperature|temp|how hot|how cold|feels/.test(q)) {
    lastAskTopic = 'temperature';

    return `For ${location}, the current temperature is ${ctx.tempF} degrees${ctx.feelsF !== null ? `, and it feels like ${ctx.feelsF}` : ''}.`;
  }

  if (/humidity|dew point|muggy/.test(q)) {
    lastAskTopic = 'humidity';

    return `For ${location}, humidity is around ${ctx.humidity ?? 'unknown'} percent and the dew point is ${ctx.dewF ?? 'unavailable'} degrees.`;
  }

  if (/radar/.test(q)) {
    lastAskTopic = 'radar';
    selectView('radar',{ manual:true });

    return `I've opened the NOAA MRMS radar for ${location}. Active warning polygons are shown when available.`;
  }

  if (/tonight/.test(q)) {
    lastAskTopic = 'forecast';

    return ctx.forecast?.tonight
      ? `For ${location} tonight, ${ctx.forecast.tonight}`
      : `I don't currently have tonight's detailed forecast loaded for ${location}.`;
  }

  if (/changed|change|new/.test(q)) {
    lastAskTopic = 'changes';

    return latestChanges
      .map(change => change.text)
      .join(' ');
  }

  if (/today|forecast|weather|later/.test(q)) {
    lastAskTopic = 'forecast';

    return ctx.forecast?.today
      ? `For ${location}, ${ctx.forecast.today}`
      : `The current temperature in ${location} is ${ctx.tempF} degrees, but the detailed forecast is temporarily unavailable.`;
  }

  return `For ${location}, it's currently ${ctx.tempF} degrees. Wind is around ${ctx.windSpd} miles per hour. ${ctx.forecast?.today || 'Ask me about temperature, wind, severe weather, tonight, radar, or what changed.'}`;
}

async function askVector(question) {
  if (!STORMVECTOR_FEATURES.askVector) return;

  const trimmed = String(question || '').trim();
  if (!trimmed) return;

  const answer =
    answerVectorQuestion(trimmed);

  setText('askVectorAnswer',answer);

  if (!liveStarted) return;

  const resume =
    Math.min(
      liveSegIdx + 1,
      liveSegments.length
    );

  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);

  await wait(120);
  await speakStandalone(answer);

  if (
    !liveMuted &&
    !breakingWeatherActive &&
    resume < liveSegments.length
  ) {
    await wait(600);
    speakSegment(resume);
  }
}

function bindAskVector() {
  const form =
    document.getElementById('askVectorForm');

  const input =
    document.getElementById('askVectorInput');

  form?.addEventListener('submit', event => {
    event.preventDefault();

    const question = input?.value.trim();
    if (!question) return;

    askVector(question);
    input.value = '';
  });

  document.querySelectorAll('.ask-vector-quick')
    .forEach(button => {
      button.addEventListener('click', () =>
        askVector(
          button.dataset.question ||
          button.textContent
        )
      );
    });
}


/* ═══════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════════ */

function bindBroadcastHistory() {
  const toggle =
    document.getElementById('broadcastHistoryToggle');

  const body =
    document.getElementById('broadcastHistoryBody');

  const chevron =
    document.getElementById('broadcastHistoryChevron');

  toggle?.addEventListener('click', () => {
    if (!body) return;

    const opening = body.hidden;
    body.hidden = !opening;

    if (chevron) {
      chevron.textContent =
        opening ? '−' : '+';
    }
  });
}


/* ═══════════════════════════════════════════════
   MOBILE RELIABILITY
════════════════════════════════════════════════ */

function startSpeechKeepAlive() {
  stopSpeechKeepAlive();

  if (!/Android/i.test(navigator.userAgent)) {
    return;
  }

  speechKeepAlive = setInterval(() => {
    if (
      speechSynthesis.speaking &&
      !speechSynthesis.paused
    ) {
      speechSynthesis.pause();

      setTimeout(() =>
        speechSynthesis.resume(),
        35
      );
    }
  },10000);
}

function stopSpeechKeepAlive() {
  if (speechKeepAlive) {
    clearInterval(speechKeepAlive);
  }

  speechKeepAlive = null;
}

async function requestWakeLock() {
  try {
    if (
      'wakeLock' in navigator &&
      document.visibilityState === 'visible'
    ) {
      wakeLock =
        await navigator.wakeLock.request('screen');
    }
  } catch (_) {}
}

function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch (_) {}

  wakeLock = null;
}



/* ═══════════════════════════════════════════════
   BRANDING IMAGE PATH REPAIR

   GitHub Pages is case-sensitive.
   Repository files are .PNG, not .png.
════════════════════════════════════════════════ */

function repairBrandingImages() {
  document
    .querySelectorAll(
      'img[src="./Vector-logo.png"], img[src="Vector-logo.png"]'
    )
    .forEach(image => {
      image.src = './Vector-logo.PNG';
    });

  document
    .querySelectorAll(
      'img[src="./bottom-logo.png"], img[src="bottom-logo.png"]'
    )
    .forEach(image => {
      image.src = './bottom-logo.PNG';
    });

  const headerLogo =
    document.getElementById('vectorHeaderLogo');

  if (headerLogo) {
    headerLogo.src = './Vector-logo.PNG';
  }
}


/* ═══════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  if (liveStarted && !liveMuted) {
    requestWakeLock();
  }

  setTimeout(() =>
    radarMap?.invalidateSize(),
    200
  );
});

document.addEventListener('DOMContentLoaded', () => {
  repairBrandingImages();
  ensureLiveMusicElement();
  pickVoice();

  setLocationText('Location not selected');
  setLocationSource('StormVector');
  setCaption(
    'Choose your current location or search for a United States location to begin.'
  );
  setCaptionTopic('STANDBY');
  setLiveBadge('STANDBY');

  setText('vectorGraphicStatus','READY');

  selectView('conditions',{ manual:true });

  const startButton =
    document.getElementById('liveStartBtn');

  if (startButton) {
    startButton.disabled = false;
    startButton.textContent = 'USE MY LOCATION';
  }

  bindLocationSearch({
    inputId:'liveLocationSearch',
    suggestionsId:'liveSearchSuggestions',
    statusId:'liveSearchStatus',
    clearId:'liveSearchClearBtn'
  });

  bindLocationSearch({
    inputId:'livePopupLocationSearch',
    suggestionsId:'livePopupSearchSuggestions',
    statusId:'livePopupSearchStatus',
    clearId:'livePopupSearchClearBtn'
  });

  bindViewSelector();
  bindRadarProductTabs();
  bindRadarControls();
  bindAskVector();
  bindBroadcastHistory();

  updateSpcImages();

  updateStatusPills('STANDBY');

  window.startBroadcast = startBroadcast;
  window.returnToMyLocation = returnToMyLocation;
  window.replaySegment = replaySegment;
  window.toggleMute = toggleMute;
  window.askVector = askVector;
  window.selectView = selectView;
});

window.addEventListener('beforeunload', () => {
  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  stopSevereWatch();
  stopSpeechKeepAlive();
  stopLiveLocationTracking();
  releaseWakeLock();

  if (liveMusic) {
    try {
      liveMusic.pause();
    } catch (_) {}
  }

  if (locationSearchController) {
    try {
      locationSearchController.abort();
    } catch (_) {}
  }

  if (radarMap) {
    try {
      radarMap.remove();
    } catch (_) {}
  }
});
