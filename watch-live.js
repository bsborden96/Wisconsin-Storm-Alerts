/* ═══════════════════════════════════════════════════════
   STORMVECTOR — VECTOR LIVE ENGINE
   watch-live.js

   RESTORED / FIXED:
   - Predictive U.S. location search
   - Moving GPS tracking while driving
   - NOAA MRMS Leaflet radar
   - NWS warning polygons
   - Actual SPC Day 1 categorical outlook image
   - Actual SPC Day 1 tornado outlook image
   - Direct SPC image first, image-proxy fallback if NOAA blocks hotlinking
   - Severe-only urgent broadcast mode
   - NWS-style safety instructions
   - Vector speech + music
   - Forecast / conditions / changes / ask Vector
═══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */

const CONFIG = {
  movingRefreshMiles: 2,
  movingRefreshMs: 5 * 60 * 1000,
  alertCheckMs: 30 * 1000,
  normalRefreshMs: 5 * 60 * 1000,
  searchDebounceMs: 280,
  maxHistory: 30
};

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

const SPC_RANK = { TSTM:1, MRGL:2, SLGT:3, ENH:4, MDT:5, HIGH:6 };

/* ─────────────────────────────────────────────
   CORE STATE
───────────────────────────────────────────── */

let liveLat = null;
let liveLon = null;
let deviceLat = null;
let deviceLon = null;
let liveCityState = null;
let locationMode = 'none'; // none | device | search
let selectedSearchLocation = null;
let locationReady = false;

let liveStarted = false;
let liveMuted = false;
let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;
let liveMusic = null;
let speechGeneration = 0;

let currentWeatherContext = null;
let previousSnapshot = null;
let latestChanges = [];
let broadcastLoopCount = 0;

let locationWatchId = null;
let lastWeatherRefreshLat = null;
let lastWeatherRefreshLon = null;
let lastWeatherRefreshAt = 0;
let movingRefreshRunning = false;

let alertTimer = null;
let refreshTimer = null;
const knownPriorityAlertIds = new Set();

let searchTimer = null;
let searchController = null;

let radarMap = null;
let radarLayer = null;
let radarMarker = null;
let radarWarningLayer = null;
let radarWarningsVisible = true;
let radarZoomMode = 'local';
let radarLastLoaded = null;

let selectedView = 'conditions';
let selectedRadarProduct = 'radar';

const broadcastHistory = [];

/* ─────────────────────────────────────────────
   SHARED FALLBACKS
───────────────────────────────────────────── */

if (typeof window.setBgMode !== 'function') window.setBgMode = () => {};

if (typeof window.degToCompass !== 'function') {
  window.degToCompass = degrees => {
    const n = Number(degrees);
    if (!Number.isFinite(n)) return '';
    const dirs = [
      'N','NNE','NE','ENE','E','ESE','SE','SSE',
      'S','SSW','SW','WSW','W','WNW','NW','NNW'
    ];
    return dirs[Math.round(n / 22.5) % 16];
  };
}

if (typeof window.dewLabel !== 'function') {
  window.dewLabel = dewF => {
    if (dewF == null) return '';
    if (dewF < 50) return 'comfortable';
    if (dewF < 60) return 'comfortable';
    if (dewF < 65) return 'a little humid';
    if (dewF < 70) return 'muggy';
    if (dewF < 75) return 'oppressive';
    return 'very humid';
  };
}

/* ─────────────────────────────────────────────
   BASIC UTILITIES
───────────────────────────────────────────── */

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function stateName(value) {
  const s = String(value || '').trim();
  return STATE_NAMES[s.toUpperCase()] || s;
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

function cToF(c) {
  const n = Number(c);
  return Number.isFinite(n) ? Math.round(n * 9 / 5 + 32) : null;
}

function kmhToMph(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 0.621371) : null;
}

function msToMph(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 2.23694) : null;
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

async function safeFetch(url, options = {}) {
  const { timeout = 10000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
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

function setLiveBadge(text) {
  const badge = document.getElementById('liveBadge');
  if (badge) {
    badge.innerHTML =
      `<span class="live-dot"></span>` +
      `<span class="live-badge-text">${escapeHtml(text)}</span>`;
    badge.classList.toggle('live-badge-on', text === 'LIVE');
  }
  setText('vectorHeaderStatus', text);
  updateStatusPills();
}

function setRobotSpeaking(on) {
  document.getElementById('liveAvatar')?.classList.toggle('speaking', !!on);
}

function updateStatusPills() {
  const travel = document.getElementById('vectorTravelStatus');
  if (travel) {
    if (liveMuted) travel.textContent = 'PAUSED';
    else if (!locationReady) travel.textContent = 'LOCATION OFF';
    else if (locationMode === 'search') travel.textContent = 'FIXED LOCATION';
    else if (movingRefreshRunning) travel.textContent = 'GPS UPDATING';
    else travel.textContent = 'GPS TRACKING';
  }

  const threat = document.getElementById('vectorThreatStatus');
  if (!threat) return;

  const level = threatLevel(currentWeatherContext?.alerts || []);
  threat.classList.remove('vector-threat-normal','vector-threat-watch','vector-threat-warning','vector-threat-critical');

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

/* ─────────────────────────────────────────────
   ALERT CLASSIFICATION / SAFETY
───────────────────────────────────────────── */

function alertText(alert) {
  const p = alert?.properties || {};
  return [p.event,p.headline,p.description,p.instruction].filter(Boolean).join(' ').toLowerCase();
}

function isCriticalAlert(alert) {
  const t = alertText(alert);
  return (
    t.includes('tornado emergency') ||
    t.includes('flash flood emergency') ||
    t.includes('particularly dangerous situation') ||
    /\bpds\b/.test(t)
  );
}

function isUrgentWarning(alert) {
  if (isCriticalAlert(alert)) return true;
  const e = String(alert?.properties?.event || '').toLowerCase();
  return (
    e.includes('tornado warning') ||
    e.includes('severe thunderstorm warning') ||
    e.includes('flash flood warning') ||
    e.includes('snow squall warning') ||
    e.includes('blizzard warning') ||
    e.includes('ice storm warning')
  );
}

function isWatchAlert(alert) {
  const e = String(alert?.properties?.event || '').toLowerCase();
  return (
    e.includes('tornado watch') ||
    e.includes('severe thunderstorm watch') ||
    e.includes('flash flood watch') ||
    e.includes('flood watch') ||
    e.includes('winter storm watch') ||
    e.includes('high wind watch') ||
    e.includes('excessive heat watch') ||
    e.includes('fire weather watch')
  );
}

function threatLevel(alerts = []) {
  if (alerts.some(isCriticalAlert)) return 3;
  if (alerts.some(isUrgentWarning)) return 2;
  if (alerts.some(isWatchAlert)) return 1;
  return 0;
}

function alertPriorityScore(event = '') {
  const e = String(event).toLowerCase();
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
    ['severe thunderstorm watch',9]
  ];
  for (const [needle, score] of order) if (e.includes(needle)) return score;
  return 50;
}

function safetyInstructions(alert) {
  const p = alert?.properties || {};
  const event = String(p.event || '').toLowerCase();

  if (event.includes('tornado')) {
    return 'Take shelter now in a basement or a small interior room on the lowest floor of a sturdy building. Stay away from windows and protect your head and neck.';
  }

  if (event.includes('severe thunderstorm')) {
    return 'Move indoors now and stay away from windows. Remain inside until the warning has expired or the National Weather Service says the threat has passed.';
  }

  if (event.includes('flash flood')) {
    return 'Move to higher ground if you are in a flood-prone area. Never drive through flooded roads. Turn around, do not drown.';
  }

  if (event.includes('snow squall')) {
    return 'Avoid or delay travel if possible. If already driving, slow down, turn on headlights, and leave much more stopping distance.';
  }

  if (event.includes('blizzard') || event.includes('ice storm')) {
    return 'Avoid unnecessary travel. Stay indoors if possible and follow National Weather Service and local emergency instructions.';
  }

  return removeEmojis(
    p.instruction ||
    'Follow official National Weather Service instructions for this alert.'
  );
}

/* ─────────────────────────────────────────────
   WEATHER LANGUAGE
───────────────────────────────────────────── */

function skyDescription(code) {
  const c = Number(code);
  if (c === 0) return 'clear skies';
  if (c === 1) return 'mostly clear skies';
  if (c === 2) return 'partly cloudy skies';
  if (c === 3) return 'cloudy skies';
  if ([45,48].includes(c)) return 'fog';
  if ([51,53,55].includes(c)) return 'drizzle';
  if ([61,63,65,80,81,82].includes(c)) return 'rain showers';
  if ([71,73,75,77,85,86].includes(c)) return 'snow';
  if ([95,96,99].includes(c)) return 'thunderstorms';
  return 'current conditions';
}

function cleanForecastText(text) {
  return removeEmojis(text || '')
    .replace(/\s+/g,' ')
    .trim();
}

/* ─────────────────────────────────────────────
   LOCATION — CURRENT DEVICE
───────────────────────────────────────────── */

function requestCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location services.'));
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
        updateReturnButton();
        resolve(position);
      },
      error => {
        const msg =
          error?.code === 1 ? 'Location access is blocked. Allow location for StormVector and try again.' :
          error?.code === 2 ? 'Your device could not determine its location.' :
          error?.code === 3 ? 'The location request timed out. Try again.' :
          'StormVector could not get your location.';
        reject(new Error(msg));
      },
      { enableHighAccuracy:true, timeout:15000, maximumAge:15000 }
    );
  });
}

function startMovingLocationWatch() {
  if (!navigator.geolocation || locationMode === 'search') return;

  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
  }

  locationWatchId = navigator.geolocation.watchPosition(
    async position => {
      deviceLat = position.coords.latitude;
      deviceLon = position.coords.longitude;

      if (locationMode !== 'device') return;

      liveLat = deviceLat;
      liveLon = deviceLon;

      const now = Date.now();
      const moved =
        lastWeatherRefreshLat == null ||
        haversineMiles(lastWeatherRefreshLat,lastWeatherRefreshLon,liveLat,liveLon) >= CONFIG.movingRefreshMiles;
      const old =
        !lastWeatherRefreshAt ||
        now - lastWeatherRefreshAt >= CONFIG.movingRefreshMs;

      updateRadarForLocation();

      if ((moved || old) && !movingRefreshRunning) {
        movingRefreshRunning = true;
        updateStatusPills();
        try {
          await prepareBroadcast({ preserveSpeech:true });
        } catch (err) {
          console.warn('Moving location refresh failed:', err);
        } finally {
          movingRefreshRunning = false;
          updateStatusPills();
        }
      }
    },
    error => console.warn('StormVector GPS watch:', error),
    { enableHighAccuracy:true, timeout:20000, maximumAge:15000 }
  );
}

function updateReturnButton() {
  const button = document.getElementById('returnToMyLocationBtn');
  if (button) button.hidden = locationMode !== 'search';
}

async function returnToMyLocation() {
  setLiveBadge('LOCATING');
  setLocationText('Getting your current location...');

  try {
    await requestCurrentLocation();
    startMovingLocationWatch();
    previousSnapshot = null;
    await prepareBroadcast();
    if (liveStarted && !liveMuted) {
      await speakStandalone(`Switching StormVector coverage back to ${liveCityState || 'your current location'}.`);
      startCurrentRundown();
    }
  } catch (error) {
    setCaption(error.message);
    setLiveBadge('LOCATION ERROR');
  }
}

/* ─────────────────────────────────────────────
   PREDICTIVE LOCATION SEARCH
───────────────────────────────────────────── */

async function searchUsLocations(query) {
  const term = String(query || '').trim();
  if (term.length < 3) return [];

  if (searchController) searchController.abort();
  searchController = new AbortController();

  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(term)}` +
    '&count=10&language=en&format=json&countryCode=US';

  try {
    const response = await fetch(url, { signal:searchController.signal });
    if (!response.ok) throw new Error(`Search HTTP ${response.status}`);
    const data = await response.json();
    return (data.results || []).filter(r =>
      Number.isFinite(Number(r.latitude)) &&
      Number.isFinite(Number(r.longitude))
    );
  } catch (error) {
    if (error.name === 'AbortError') return [];
    console.warn('Location search failed:', error);
    return [];
  }
}

function locationDisplay(result) {
  const city = result?.name || 'Selected location';
  const state = stateName(result?.admin1 || '');
  return [city,state].filter(Boolean).join(', ');
}

function renderSearchSuggestions(config, results) {
  const list = document.getElementById(config.suggestionsId);
  const input = document.getElementById(config.inputId);
  if (!list || !input) return;

  list.innerHTML = '';

  if (!results.length) {
    list.innerHTML =
      '<div class="live-search-suggestion">' +
      '<span class="live-search-suggestion-main">No U.S. locations found</span>' +
      '</div>';
    list.hidden = false;
    input.setAttribute('aria-expanded','true');
    return;
  }

  results.forEach(result => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-search-suggestion';

    const sub = [result.admin2,stateName(result.admin1 || '')]
      .filter(Boolean)
      .join(', ');

    button.innerHTML =
      `<span class="live-search-suggestion-main">${escapeHtml(result.name || '')}</span>` +
      `<span class="live-search-suggestion-sub">${escapeHtml(sub)}</span>`;

    button.addEventListener('click', () => selectSearchedLocation(result));
    list.appendChild(button);
  });

  list.hidden = false;
  input.setAttribute('aria-expanded','true');
}

function bindLocationSearch(config) {
  const input = document.getElementById(config.inputId);
  const list = document.getElementById(config.suggestionsId);
  const status = document.getElementById(config.statusId);
  const clear = document.getElementById(config.clearId);

  if (!input || !list) return;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded','false');
  };

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (clear) clear.hidden = !query;
    clearTimeout(searchTimer);

    if (query.length < 3) {
      close();
      if (status) status.textContent = '';
      return;
    }

    if (status) status.textContent = 'Searching...';

    searchTimer = setTimeout(async () => {
      const results = await searchUsLocations(query);
      if (input.value.trim() !== query) return;
      if (status) {
        status.textContent = results.length
          ? `${results.length} location${results.length === 1 ? '' : 's'} found`
          : 'No matching locations';
      }
      renderSearchSuggestions(config, results);
    }, CONFIG.searchDebounceMs);
  });

  clear?.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    if (status) status.textContent = '';
    close();
    input.focus();
  });

  document.addEventListener('click', event => {
    if (event.target === input || list.contains(event.target)) return;
    close();
  });
}

function closeSearchLists() {
  ['liveSearchSuggestions','livePopupSearchSuggestions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}

function fillSearchInputs(value) {
  ['liveLocationSearch','livePopupLocationSearch'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

async function selectSearchedLocation(result) {
  if (!result) return;

  if (!liveStarted) unlockMediaFromUserGesture();

  speechGeneration++;
  try { speechSynthesis.cancel(); } catch (_) {}
  setRobotSpeaking(false);

  liveLat = Number(result.latitude);
  liveLon = Number(result.longitude);
  locationMode = 'search';
  selectedSearchLocation = result;
  locationReady = true;
  liveCityState = locationDisplay(result);
  previousSnapshot = null;
  broadcastLoopCount = 0;

  if (locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }

  setLocationText(liveCityState);
  setLocationSource('StormVector selected location');
  fillSearchInputs(liveCityState);
  closeSearchLists();
  updateReturnButton();

  setLiveBadge('UPDATING');
  setCaption(`Loading weather for ${liveCityState}.`);

  try {
    await prepareBroadcast();

    if (!liveStarted) {
      liveStarted = true;
      hideStartOverlay();
      startMusic();
      startTimers();
    }

    if (!liveMuted) {
      await speakStandalone(`Switching StormVector coverage to ${liveCityState}.`);
      startCurrentRundown();
    }
  } catch (error) {
    console.error(error);
    setLiveBadge('ERROR');
    setCaption(`StormVector could not load weather for ${liveCityState}.`);
  }
}

/* ─────────────────────────────────────────────
   NWS / OPEN-METEO / SPC DATA
───────────────────────────────────────────── */

async function fetchAlerts(lat, lon) {
  try {
    const res = await safeFetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        timeout:10000,
        headers:{
          Accept:'application/geo+json'
        }
      }
    );
    const data = await res.json();
    return data.features || [];
  } catch (error) {
    console.warn('NWS alerts failed:', error);
    return [];
  }
}

async function fetchNwsPoint(lat, lon) {
  try {
    const res = await safeFetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        timeout:10000,
        headers:{
          Accept:'application/geo+json'
        }
      }
    );

    const data = await res.json();
    const p = data.properties || {};
    const rel = p.relativeLocation?.properties || {};

    let periods = [];
    if (p.forecast) {
      try {
        const fRes = await safeFetch(p.forecast, {
          timeout:10000,
          headers:{
            Accept:'application/geo+json',
            'User-Agent':'StormVector/1.0'
          }
        });
        const fData = await fRes.json();
        periods = fData.properties?.periods || [];
      } catch (error) {
        console.warn('NWS forecast failed:', error);
      }
    }

    return {
      cityState: [rel.city,stateName(rel.state)].filter(Boolean).join(', '),
      stationUrl:p.observationStations || null,
      periods
    };
  } catch (error) {
    console.warn('NWS point failed:', error);
    return { cityState:null, stationUrl:null, periods:[] };
  }
}

function observationWindMph(measurement) {
  if (!measurement || measurement.value == null) return null;
  const unit = String(measurement.unitCode || '').toLowerCase();
  if (unit.includes('km_h') || unit.includes('km/h')) return kmhToMph(measurement.value);
  if (unit.includes('m_s') || unit.includes('m/s')) return msToMph(measurement.value);
  if (unit.includes('mi_h') || unit.includes('mph')) return Math.round(measurement.value);
  return kmhToMph(measurement.value);
}

async function fetchNearestObservation(stationUrl) {
  if (!stationUrl) return null;

  try {
    const stationRes = await safeFetch(stationUrl, {
      timeout:9000,
      headers:{ Accept:'application/geo+json' }
    });
    const stationData = await stationRes.json();

    for (const station of (stationData.features || []).slice(0,6)) {
      const stationId =
        station.properties?.stationIdentifier ||
        station.id?.split('/').pop();

      if (!stationId) continue;

      try {
        const obsRes = await safeFetch(
          `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
          {
            timeout:8000,
            headers:{ Accept:'application/geo+json' }
          }
        );
        const obs = await obsRes.json();
        const p = obs.properties || {};
        if (p.temperature?.value == null) continue;

        return {
          stationId,
          stationName:station.properties?.name || stationId,
          timestamp:p.timestamp || null,
          tempF:cToF(p.temperature?.value),
          dewF:p.dewpoint?.value == null ? null : cToF(p.dewpoint.value),
          humidity:p.relativeHumidity?.value == null ? null : Math.round(p.relativeHumidity.value),
          windSpd:observationWindMph(p.windSpeed) ?? 0,
          windG:observationWindMph(p.windGust) ?? 0,
          windDeg:Number.isFinite(Number(p.windDirection?.value)) ? Number(p.windDirection.value) : 0,
          textDescription:removeEmojis(p.textDescription || '')
        };
      } catch (_) {}
    }
  } catch (error) {
    console.warn('Observation lookup failed:', error);
  }

  return null;
}

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=2&timezone=auto';

  const res = await safeFetch(url,{timeout:10000});
  const data = await res.json();
  const c = data.current || {};

  return {
    tempF:c.temperature_2m == null ? null : Math.round(c.temperature_2m),
    feelsF:c.apparent_temperature == null ? null : Math.round(c.apparent_temperature),
    humidity:c.relative_humidity_2m == null ? null : Math.round(c.relative_humidity_2m),
    dewF:c.dew_point_2m == null ? null : Math.round(c.dew_point_2m),
    wcode:c.weather_code ?? null,
    windSpd:Math.round(c.wind_speed_10m || 0),
    windDeg:Number(c.wind_direction_10m || 0),
    windG:Math.round(c.wind_gusts_10m || 0),
    hourly:data.hourly || {}
  };
}

/* SPC point-in-polygon */

function pointInRing(point, ring) {
  let inside = false;
  for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
    const xi=ring[i][0], yi=ring[i][1];
    const xj=ring[j][0], yj=ring[j][1];
    const cross =
      ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj-xi) * (point[1]-yi) / ((yj-yi) || Number.EPSILON) + xi);
    if (cross) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, coords) {
  if (!coords?.[0] || !pointInRing(point,coords[0])) return false;
  for (let i=1;i<coords.length;i++) if (pointInRing(point,coords[i])) return false;
  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point,geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => pointInPolygon(point,poly));
  }
  return false;
}

async function fetchSpcRisk(lat, lon) {
  const urls = [
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson'
  ];

  for (const url of urls) {
    try {
      const res = await safeFetch(url,{timeout:9000});
      const data = await res.json();
      let best = null;
      const point = [lon,lat];

      for (const feature of data.features || []) {
        const raw =
          feature.properties?.LABEL ??
          feature.properties?.label ??
          feature.properties?.DN ??
          '';
        const label = String(raw).toUpperCase();
        if (!SPC_RANK[label]) continue;
        if (pointInGeometry(point,feature.geometry)) {
          if (!best || SPC_RANK[label] > SPC_RANK[best]) best = label;
        }
      }
      return best;
    } catch (error) {
      console.warn('SPC risk request failed:', error);
    }
  }

  return null;
}

/* ─────────────────────────────────────────────
   PREPARE / RENDER WEATHER
───────────────────────────────────────────── */

async function prepareBroadcast(options = {}) {
  if (!locationReady || liveLat == null || liveLon == null) {
    throw new Error('StormVector does not have a location yet.');
  }

  setLiveBadge('UPDATING');
  setText('vectorGraphicStatus','UPDATING');

  const [nws,fallback,alerts,spc] = await Promise.all([
    fetchNwsPoint(liveLat,liveLon),
    fetchOpenMeteo(liveLat,liveLon).catch(() => ({})),
    fetchAlerts(liveLat,liveLon),
    fetchSpcRisk(liveLat,liveLon).catch(() => null)
  ]);

  const observation = await fetchNearestObservation(nws.stationUrl);

  liveCityState =
    locationMode === 'search' && selectedSearchLocation
      ? locationDisplay(selectedSearchLocation)
      : nws.cityState || liveCityState;

  setLocationText(
    liveCityState ||
    `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`
  );

  setLocationSource(
    locationMode === 'search'
      ? 'StormVector selected location'
      : 'StormVector current device location'
  );

  const periods = nws.periods || [];
  const now = Date.now();
  const currentPeriod =
    periods.find(p =>
      new Date(p.startTime).getTime() <= now &&
      now < new Date(p.endTime).getTime()
    ) || periods[0] || null;

  const tonight =
    periods.find(p => !p.isDaytime && new Date(p.endTime).getTime() > now) || null;

  const tomorrow =
    periods.find(p =>
      p.isDaytime &&
      new Date(p.startTime).toDateString() !== new Date().toDateString()
    ) || null;

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
    hourly:fallback.hourly ?? {},
    alerts:alerts || [],
    spc:spc || null,
    observation,
    forecast:{
      today:cleanForecastText(currentPeriod?.detailedForecast || currentPeriod?.shortForecast || ''),
      tonight:cleanForecastText(tonight?.detailedForecast || tonight?.shortForecast || ''),
      tomorrow:cleanForecastText(tomorrow?.detailedForecast || tomorrow?.shortForecast || '')
    }
  };

  currentWeatherContext = ctx;

  lastWeatherRefreshLat = liveLat;
  lastWeatherRefreshLon = liveLon;
  lastWeatherRefreshAt = Date.now();

  renderConditions(ctx);
  renderObservation(ctx.observation);
  renderForecast(ctx);
  renderSevere(ctx);
  renderChanges(detectChanges(ctx));
  updateRadarForLocation();
  updateRadarWarnings();
  updateSpcImagePanels();
  updateSevereTakeover(ctx);
  setBroadcastBackground(ctx);
  buildRundown(ctx);

  setText('freshnessForecast',ctx.forecast.today || ctx.forecast.tonight ? 'CURRENT' : 'UNAVAILABLE');
  setText('freshnessAlerts',ctx.alerts.length ? `${ctx.alerts.length} ACTIVE` : 'CURRENT');
  setText('vectorGraphicStatus','CURRENT');

  updateStatusPills();

  return ctx;
}

function renderConditions(ctx) {
  setText('graphicTemp',ctx.tempF == null ? '--' : `${ctx.tempF}°`);
  setText('graphicFeels',ctx.feelsF == null ? '--' : `${ctx.feelsF}°F`);
  setText('graphicDew',ctx.dewF == null ? '--' : `${ctx.dewF}°F`);
  setText('graphicHumidity',ctx.humidity == null ? '--' : `${ctx.humidity}%`);
  setText('graphicWind',`${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`);

  const row = document.getElementById('liveConditionsRow');
  if (!row) return;

  const chip = (label,value) =>
    `<div class="live-chip">` +
      `<span class="live-chip-label">${escapeHtml(label)}</span>` +
      `<span class="live-chip-val">${escapeHtml(value)}</span>` +
    `</div>`;

  row.innerHTML = [
    ctx.tempF == null ? '' : chip('TEMP',`${ctx.tempF}°F`),
    ctx.feelsF == null ? '' : chip('FEELS',`${ctx.feelsF}°F`),
    ctx.dewF == null ? '' : chip('DEW POINT',`${ctx.dewF}°F`),
    ctx.humidity == null ? '' : chip('HUMIDITY',`${ctx.humidity}%`),
    chip('WIND',`${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`),
    ctx.windG > ctx.windSpd + 5 ? chip('GUSTS',`${ctx.windG} mph`) : ''
  ].join('');
}

function renderObservation(obs) {
  const box = document.getElementById('liveObservationInfo');

  if (!obs) {
    if (box) box.hidden = true;
    setText('freshnessObservation','FALLBACK DATA');
    return;
  }

  if (box) box.hidden = false;
  setText('liveObservationStation',`${obs.stationName} (${obs.stationId})`);

  if (obs.timestamp) {
    const age = Math.max(0,Math.round((Date.now()-new Date(obs.timestamp).getTime())/60000));
    setText('liveObservationAge',age <= 1 ? 'Latest observation' : `${age} min old`);
    setText('freshnessObservation',age <= 15 ? 'CURRENT' : `${age} MIN OLD`);
  } else {
    setText('liveObservationAge','');
    setText('freshnessObservation','AVAILABLE');
  }
}

function renderForecast(ctx) {
  setText(
    'graphicForecastText',
    ctx.forecast.today ||
    ctx.forecast.tonight ||
    'Forecast data is temporarily unavailable.'
  );

  const container = document.getElementById('forecastTimeline');
  if (!container) return;

  const hourly = ctx.hourly || {};
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const pops = hourly.precipitation_probability || [];
  const winds = hourly.wind_speed_10m || [];

  if (!times.length) {
    container.innerHTML = '<div class="forecast-timeline-empty">Hourly forecast unavailable.</div>';
    return;
  }

  const now = Date.now();
  let start = times.findIndex(t => new Date(t).getTime() >= now - 30*60000);
  if (start < 0) start = 0;

  const html = [];
  for (let i=start;i<Math.min(start+12,times.length);i++) {
    const time = new Date(times[i]).toLocaleTimeString([],{hour:'numeric'});
    html.push(
      `<div class="forecast-hour">` +
      `<span class="forecast-hour-time">${escapeHtml(time)}</span>` +
      `<strong class="forecast-hour-temp">${Math.round(temps[i])}°</strong>` +
      `<span class="forecast-hour-detail">${Math.round(pops[i] ?? 0)}% precip</span>` +
      `<span class="forecast-hour-detail">Wind ${Math.round(winds[i] ?? 0)} mph</span>` +
      `</div>`
    );
  }
  container.innerHTML = html.join('');
}

function renderSevere(ctx) {
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

  setText('graphicSpcRisk',titles[ctx.spc] || 'NO ORGANIZED RISK');
  setText(
    'graphicSpcDescription',
    descriptions[ctx.spc] ||
    'No categorical severe weather risk is currently loaded for this location.'
  );

  const significant = (ctx.alerts || []).filter(a => isUrgentWarning(a) || isWatchAlert(a));
  setText(
    'severeAlertSummary',
    significant.length
      ? `Active: ${significant.slice(0,3).map(a => a.properties?.event || 'Weather Alert').join(', ')}`
      : 'No active severe weather watches or warnings for this location.'
  );
}

/* ─────────────────────────────────────────────
   ACTUAL SPC IMAGE PANELS
───────────────────────────────────────────── */

const SPC_IMAGE_URLS = {
  categorical:'https://www.spc.noaa.gov/products/outlook/day1otlk.gif',
  tornado:'https://www.spc.noaa.gov/products/outlook/day1probotlk_torn.gif'
};

function proxyImageUrl(originUrl) {
  // wsrv.nl is used ONLY as a fallback when SPC blocks direct cross-site image loading.
  return `https://images.weserv.nl/?url=${encodeURIComponent(originUrl)}&output=png`;
}

function spcImageMarkup(type) {
  const isTor = type === 'tornado';
  const id = isTor ? 'spcTornadoImage' : 'spcOutlookImage';
  const title = isTor ? 'SPC DAY 1 TORNADO OUTLOOK' : 'SPC DAY 1 CATEGORICAL OUTLOOK';
  const source = isTor ? SPC_IMAGE_URLS.tornado : SPC_IMAGE_URLS.categorical;

  return `
    <div class="spc-image-card" style="
      padding:10px;
      text-align:left;
      background:rgba(3,12,28,.72);
      border:1px solid rgba(0,207,255,.16);
      border-radius:12px;
    ">
      <div style="
        display:flex;
        justify-content:space-between;
        gap:10px;
        align-items:center;
        margin-bottom:8px;
      ">
        <span class="graphic-label" style="margin:0;">${title}</span>
        <span style="font-size:8px;color:#688da3;">OFFICIAL SPC</span>
      </div>

      <img
        id="${id}"
        src="${source}"
        data-direct="${source}"
        data-fallback="${proxyImageUrl(source)}"
        alt="${title}"
        style="
          display:block;
          width:100%;
          height:auto;
          max-height:600px;
          object-fit:contain;
          border-radius:8px;
          background:#07111f;
        "
      >

      <div
        id="${id}Status"
        style="
          margin-top:7px;
          color:#6f94aa;
          font-size:9px;
          line-height:1.4;
        ">
        Loading official Storm Prediction Center graphic...
      </div>
    </div>
  `;
}

function installSpcImagePanels() {
  const spcPanel = document.getElementById('radarProductSpc');
  const torPanel = document.getElementById('radarProductTornado');

  if (spcPanel) spcPanel.innerHTML = spcImageMarkup('categorical');
  if (torPanel) torPanel.innerHTML = spcImageMarkup('tornado');

  bindSpcImageFallback('spcOutlookImage');
  bindSpcImageFallback('spcTornadoImage');
}

function bindSpcImageFallback(id) {
  const img = document.getElementById(id);
  if (!img) return;

  let usedFallback = false;
  const status = document.getElementById(`${id}Status`);

  img.referrerPolicy = 'no-referrer';

  img.onload = () => {
    if (status) {
      status.textContent = usedFallback
        ? 'Official SPC graphic loaded through image cache fallback.'
        : 'Official SPC graphic loaded.';
    }
  };

  img.onerror = () => {
    if (!usedFallback) {
      usedFallback = true;
      if (status) status.textContent = 'Direct SPC image was blocked. Loading cached official graphic...';
      img.src = img.dataset.fallback;
      return;
    }

    if (status) {
      status.textContent =
        'The official SPC graphic could not be loaded right now. StormVector will retry on the next refresh.';
    }
  };
}

function updateSpcImagePanels() {
  // Force a fresh attempt without changing the official source image itself.
  ['spcOutlookImage','spcTornadoImage'].forEach(id => {
    const img = document.getElementById(id);
    if (!img) return;

    const direct = img.dataset.direct;
    const fallback = img.dataset.fallback;
    const status = document.getElementById(`${id}Status`);

    if (!img.complete || img.naturalWidth === 0) {
      if (status) status.textContent = 'Refreshing official SPC graphic...';
      // Rebind via a new cache-busted proxy URL only if fallback is already in use.
      if (img.src.includes('images.weserv.nl')) {
        img.src = `${fallback}&cb=${Math.floor(Date.now()/300000)}`;
      } else {
        img.src = direct;
      }
    }
  });
}

/* ─────────────────────────────────────────────
   WHAT CHANGED
───────────────────────────────────────────── */

function makeSnapshot(ctx) {
  return {
    tempF:ctx.tempF,
    dewF:ctx.dewF,
    windSpd:ctx.windSpd,
    windG:ctx.windG,
    spc:ctx.spc,
    alerts:new Map((ctx.alerts || []).map(a => [a.id,a.properties?.event || 'Weather Alert']))
  };
}

function detectChanges(ctx) {
  const next = makeSnapshot(ctx);

  if (!previousSnapshot) {
    previousSnapshot = next;
    return [{text:'StormVector baseline established. Future updates will be compared with these conditions.',important:false}];
  }

  const prev = previousSnapshot;
  const changes = [];

  if (prev.tempF != null && next.tempF != null && prev.tempF !== next.tempF) {
    const d = next.tempF-prev.tempF;
    changes.push({
      text:`Temperature ${d>0?'rose':'fell'} ${Math.abs(d)} degree${Math.abs(d)===1?'':'s'} to ${next.tempF} degrees.`,
      important:Math.abs(d)>=5
    });
  }

  if (Math.abs((next.windSpd||0)-(prev.windSpd||0)) >= 5) {
    changes.push({
      text:`Sustained wind changed from ${prev.windSpd} to ${next.windSpd} miles per hour.`,
      important:next.windSpd>=25
    });
  }

  if (Math.abs((next.windG||0)-(prev.windG||0)) >= 8) {
    changes.push({
      text:`Wind gusts changed from ${prev.windG} to ${next.windG} miles per hour.`,
      important:next.windG>=40
    });
  }

  if (prev.spc !== next.spc) {
    changes.push({
      text:`The SPC category changed from ${prev.spc || 'none'} to ${next.spc || 'none'}.`,
      important:true
    });
  }

  next.alerts.forEach((event,id) => {
    if (!prev.alerts.has(id)) changes.push({text:`New alert: ${event}.`,important:true});
  });

  prev.alerts.forEach((event,id) => {
    if (!next.alerts.has(id)) changes.push({text:`${event} is no longer active for this location.`,important:true});
  });

  if (!changes.length) {
    changes.push({text:'No significant weather changes since the previous StormVector update.',important:false});
  }

  previousSnapshot = next;
  latestChanges = changes;
  return changes;
}

function renderChanges(changes) {
  setText(
    'weatherChangesTime',
    `Updated ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`
  );

  const full = document.getElementById('weatherChangesList');
  const graphic = document.getElementById('graphicChangesList');

  if (full) {
    full.innerHTML = changes.map(c =>
      `<div class="weather-change-item">${escapeHtml(c.text)}</div>`
    ).join('');
  }

  if (graphic) {
    graphic.innerHTML = changes.slice(0,5).map(c =>
      `<div class="graphic-change-item">${escapeHtml(c.text)}</div>`
    ).join('');
  }
}

/* ─────────────────────────────────────────────
   BACKGROUND
───────────────────────────────────────────── */

function setBroadcastBackground(ctx) {
  if ((ctx.alerts || []).some(a => /tornado warning|tornado emergency/i.test(a.properties?.event || ''))) {
    window.setBgMode('tornado'); return;
  }
  if ([95,96,99].includes(ctx.wcode)) window.setBgMode('storm');
  else if ([71,73,75,77,85,86].includes(ctx.wcode)) window.setBgMode('snow');
  else if ([45,48].includes(ctx.wcode)) window.setBgMode('fog');
  else if ([51,53,55,61,63,65,80,81,82].includes(ctx.wcode)) window.setBgMode('rain');
  else if (ctx.wcode === 1) window.setBgMode('partlycloudy');
  else if ([2,3].includes(ctx.wcode)) window.setBgMode('cloudy');
  else window.setBgMode('clear');
}

/* ─────────────────────────────────────────────
   VIEW SELECTORS
───────────────────────────────────────────── */

const VIEW_TITLES = {
  conditions:'CURRENT CONDITIONS',
  radar:'LIVE RADAR',
  forecast:'FORECAST',
  spc:'SEVERE WEATHER',
  changes:'WHAT CHANGED',
  alert:'WEATHER ALERT'
};

function selectView(view, manual = true) {
  document.querySelectorAll('.vector-graphic-view').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-graphic="${view}"]`)?.classList.add('active');

  document.querySelectorAll('.live-view-btn').forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',String(active));
  });

  setText('vectorGraphicTitle',VIEW_TITLES[view] || 'STORMVECTOR DISPLAY');
  if (manual && view !== 'alert') selectedView = view;

  if (view === 'radar') {
    ensureRadar();
    setTimeout(() => radarMap?.invalidateSize(),150);
  }
}

function bindMainViewTabs() {
  document.querySelectorAll('.live-view-btn').forEach(btn => {
    btn.addEventListener('click',() => selectView(btn.dataset.view,true));
  });

  document.getElementById('severeOpenRadarBtn')?.addEventListener('click',() => {
    selectView('radar',true);
    selectRadarProduct('radar');
  });
}

function selectRadarProduct(product) {
  selectedRadarProduct = product;

  document.querySelectorAll('.radar-product-btn').forEach(btn => {
    btn.classList.toggle('active',btn.dataset.radarProduct === product);
  });

  document.querySelectorAll('.radar-product-panel').forEach(panel => {
    panel.classList.remove('active');
    panel.hidden = true;
  });

  const map = {
    radar:'radarProductRadar',
    spc:'radarProductSpc',
    tornado:'radarProductTornado'
  };

  const panel = document.getElementById(map[product]);
  if (panel) {
    panel.hidden = false;
    panel.classList.add('active');
  }

  if (product === 'radar') {
    ensureRadar();
    setTimeout(() => radarMap?.invalidateSize(),150);
  } else {
    updateSpcImagePanels();
  }
}

function bindRadarProductTabs() {
  document.querySelectorAll('.radar-product-btn').forEach(btn => {
    btn.addEventListener('click',() => selectRadarProduct(btn.dataset.radarProduct));
  });
}

/* ─────────────────────────────────────────────
   NOAA MRMS RADAR
───────────────────────────────────────────── */

function ensureRadar() {
  if (radarMap) {
    updateRadarForLocation();
    return;
  }

  if (typeof L === 'undefined') {
    setRadarStatus('Radar map library unavailable.');
    return;
  }

  const target = document.getElementById('stormVectorRadar');
  if (!target) return;

  radarMap = L.map(target,{
    zoomControl:true,
    attributionControl:true,
    preferCanvas:true
  }).setView([liveLat ?? 39,liveLon ?? -98],liveLat == null ? 4 : 8);

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

  radarLayer.on('loading',() => {
    setRadarStatus('Loading NOAA MRMS radar...');
    setText('freshnessRadar','LOADING');
  });

  radarLayer.on('load',() => {
    radarLastLoaded = new Date();
    setRadarStatus('NOAA MRMS radar current');
    setText(
      'radarTimestamp',
      `Loaded ${radarLastLoaded.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`
    );
    setText('freshnessRadar','CURRENT');
  });

  radarLayer.on('tileerror',() => {
    setRadarStatus('A radar tile failed to load. Retrying automatically.');
    setText('freshnessRadar','RETRYING');
  });

  radarWarningLayer = L.geoJSON(null,{
    style:warningPolygonStyle,
    onEachFeature:(feature,layer) => {
      const p = feature.properties || {};
      layer.bindPopup(
        `<strong>${escapeHtml(p.event || 'Weather Alert')}</strong><br>` +
        `${escapeHtml(p.areaDesc || '')}`
      );
    }
  }).addTo(radarMap);

  updateRadarForLocation();
  setTimeout(() => radarMap?.invalidateSize(),200);
}

function setRadarStatus(text) {
  setText('radarStatus',text);
}

function warningPolygonStyle(feature) {
  const e = String(feature.properties?.event || '').toLowerCase();

  if (e.includes('tornado')) {
    return {color:'#ff2020',weight:4,fillColor:'#ff2020',fillOpacity:0.08};
  }
  if (e.includes('severe thunderstorm')) {
    return {color:'#ffb000',weight:3,fillColor:'#ffb000',fillOpacity:0.07};
  }
  if (e.includes('flash flood')) {
    return {color:'#29d65b',weight:3,fillColor:'#29d65b',fillOpacity:0.06};
  }
  return {color:'#ff6633',weight:2,fillOpacity:0.04};
}

function createRadarMarker() {
  if (!radarMap || liveLat == null || liveLon == null) return;
  const latlng = [liveLat,liveLon];

  if (radarMarker) {
    radarMarker.setLatLng(latlng);
    return;
  }

  const icon = L.divIcon({
    className:'',
    html:'<div class="sv-radar-location-marker"></div>',
    iconSize:[18,18],
    iconAnchor:[9,9]
  });

  radarMarker = L.marker(latlng,{icon}).addTo(radarMap);
}

function radarZoomLevel() {
  return radarZoomMode === 'regional' ? 5 :
         radarZoomMode === 'state' ? 7 : 9;
}

function setRadarZoomMode(mode) {
  radarZoomMode = mode;

  const ids = {
    local:'radarLocalBtn',
    regional:'radarRegionalBtn',
    state:'radarStateBtn'
  };

  Object.entries(ids).forEach(([key,id]) => {
    document.getElementById(id)?.classList.toggle('active',key === mode);
  });

  if (radarMap && liveLat != null && liveLon != null) {
    radarMap.setView([liveLat,liveLon],radarZoomLevel());
  }
}

function updateRadarForLocation() {
  if (!radarMap || liveLat == null || liveLon == null) return;

  createRadarMarker();
  radarMarker?.bindTooltip(liveCityState || 'StormVector location',{direction:'top'});
  radarMap.setView([liveLat,liveLon],radarZoomLevel());

  setTimeout(() => radarMap?.invalidateSize(),120);
}

function updateRadarWarnings() {
  if (!radarWarningLayer) return;
  radarWarningLayer.clearLayers();

  if (!radarWarningsVisible || !currentWeatherContext) return;

  (currentWeatherContext.alerts || [])
    .filter(a => a.geometry && isUrgentWarning(a))
    .forEach(a => radarWarningLayer.addData(a));
}

function refreshRadar() {
  if (!radarLayer) {
    ensureRadar();
    return;
  }

  setRadarStatus('Refreshing NOAA MRMS radar...');
  setText('freshnessRadar','REFRESHING');

  radarLayer.setParams({_stormvector:Date.now()},false);
  radarLayer.redraw();
}

function bindRadarControls() {
  document.getElementById('radarLocalBtn')?.addEventListener('click',() => setRadarZoomMode('local'));
  document.getElementById('radarRegionalBtn')?.addEventListener('click',() => setRadarZoomMode('regional'));
  document.getElementById('radarStateBtn')?.addEventListener('click',() => setRadarZoomMode('state'));

  document.getElementById('radarCenterBtn')?.addEventListener('click',() => {
    if (radarMap && liveLat != null && liveLon != null) {
      radarMap.setView([liveLat,liveLon],radarZoomLevel());
    }
  });

  const warnBtn = document.getElementById('radarWarningsBtn');
  warnBtn?.addEventListener('click',() => {
    radarWarningsVisible = !radarWarningsVisible;
    warnBtn.classList.toggle('active',radarWarningsVisible);
    warnBtn.textContent = radarWarningsVisible ? 'WARNINGS ON' : 'WARNINGS OFF';
    updateRadarWarnings();
  });

  document.getElementById('radarRefreshBtn')?.addEventListener('click',refreshRadar);
}

/* ─────────────────────────────────────────────
   SEVERE TAKEOVER
───────────────────────────────────────────── */

function updateSevereTakeover(ctx) {
  const warning = [...(ctx.alerts || [])]
    .filter(isUrgentWarning)
    .sort((a,b) =>
      alertPriorityScore(a.properties?.event || '') -
      alertPriorityScore(b.properties?.event || '')
    )[0];

  const takeover = document.getElementById('severeTakeover');
  const banner = document.getElementById('liveBreakingBanner');

  if (!warning) {
    if (takeover) takeover.hidden = true;
    if (banner) banner.hidden = true;
    return;
  }

  const p = warning.properties || {};
  if (takeover) takeover.hidden = false;
  if (banner) banner.hidden = false;

  setText('severeTakeoverTitle',p.event || 'WEATHER WARNING');
  setText('severeTakeoverArea',(p.areaDesc || ctx.cityState || 'Current location').split(';')[0]);
  setText('severeTakeoverSafety',safetyInstructions(warning));

  setText('graphicAlertTitle',p.event || 'WEATHER WARNING');
  setText('graphicAlertArea',(p.areaDesc || ctx.cityState || 'Current location').split(';')[0]);
  setText('graphicAlertInstruction',safetyInstructions(warning));
}

/* ─────────────────────────────────────────────
   BROADCAST SCRIPT — SEVERE ONLY WHEN WARNING
───────────────────────────────────────────── */

function buildRundown(ctx) {
  const urgent = [...(ctx.alerts || [])]
    .filter(isUrgentWarning)
    .sort((a,b) =>
      alertPriorityScore(a.properties?.event || '') -
      alertPriorityScore(b.properties?.event || '')
    );

  if (urgent.length) {
    const a = urgent[0];
    const p = a.properties || {};
    liveSegments = [
      `This is a StormVector breaking weather update. A ${p.event || 'weather warning'} is in effect for ${(p.areaDesc || ctx.cityState || 'your area').split(';')[0]}.`,
      safetyInstructions(a),
      removeEmojis(p.headline || '')
    ].filter(Boolean);

    liveSegIdx = 0;
    return;
  }

  const segments = [];

  if (broadcastLoopCount === 0) {
    segments.push(`I've got the latest weather loaded for ${ctx.cityState || 'your location'}. Here's where things stand.`);
  } else if (latestChanges.some(c => c.important)) {
    segments.push("Here's what's changed since the last update.");
    latestChanges.filter(c => c.important).slice(0,2).forEach(c => segments.push(c.text));
  } else {
    segments.push("Conditions are fairly steady. Here's the latest weather check.");
  }

  if (ctx.tempF != null) {
    let current = `Right now it's ${ctx.tempF} degrees`;
    if (ctx.feelsF != null && Math.abs(ctx.feelsF-ctx.tempF) >= 3) {
      current += `, and it feels like ${ctx.feelsF}`;
    }
    current += `. We're seeing ${skyDescription(ctx.wcode)}.`;
    segments.push(current);
  }

  if (ctx.windSpd >= 7 || ctx.windG >= 12) {
    segments.push(
      `Wind is out of the ${window.degToCompass(ctx.windDeg) || 'variable'} at ${ctx.windSpd} miles per hour` +
      `${ctx.windG > ctx.windSpd + 5 ? `, with gusts near ${ctx.windG}` : ''}.`
    );
  }

  const watches = (ctx.alerts || []).filter(isWatchAlert);
  if (watches.length) {
    const p = watches[0].properties || {};
    segments.push(
      `A ${p.event || 'weather watch'} is in effect for ${(p.areaDesc || ctx.cityState || 'your area').split(';')[0]}. Stay weather-aware and be ready to act if a warning is issued.`
    );
  }

  if (ctx.spc) {
    const labels = {
      TSTM:'general thunderstorm',
      MRGL:'marginal',
      SLGT:'slight',
      ENH:'enhanced',
      MDT:'moderate',
      HIGH:'high'
    };
    segments.push(`The Storm Prediction Center has this location under a ${labels[ctx.spc]} risk today.`);
  }

  if (ctx.forecast.today) {
    segments.push(`Looking ahead, ${ctx.forecast.today}`);
  }

  segments.push("That's your StormVector update. I'll keep watching for changes.");

  liveSegments = segments.map(cleanForecastText).filter(Boolean);
  liveSegIdx = 0;
}

/* ─────────────────────────────────────────────
   SPEECH / MUSIC
───────────────────────────────────────────── */

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();

  liveVoice =
    voices.find(v => /en-US/i.test(v.lang) && /Daniel|Aaron|David|Alex|Tom/i.test(v.name)) ||
    voices.find(v => /en-US/i.test(v.lang)) ||
    voices.find(v => /^en/i.test(v.lang)) ||
    voices[0] ||
    null;
}

function createUtterance(text) {
  const utter = new SpeechSynthesisUtterance(removeEmojis(text));
  if (liveVoice) utter.voice = liveVoice;
  utter.rate = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 0.93 : 0.96;
  utter.pitch = 1;
  utter.volume = 1;
  return utter;
}

function ensureMusic() {
  if (!liveMusic) liveMusic = document.getElementById('liveMusic');
  return liveMusic;
}

function startMusic() {
  const music = ensureMusic();
  if (!music) return;
  music.loop = true;
  music.volume = 0.16;
  music.play().catch(err => console.warn('Music play blocked:',err));
}

function stopMusic() {
  const music = ensureMusic();
  if (!music) return;
  music.pause();
}

function duckMusic() {
  const music = ensureMusic();
  if (music && !music.paused) music.volume = 0.045;
}

function restoreMusic() {
  const music = ensureMusic();
  if (music && !music.paused) music.volume = 0.16;
}

function unlockMediaFromUserGesture() {
  const music = ensureMusic();
  if (music) {
    music.volume = 0.01;
    music.play().catch(() => {});
  }

  if ('speechSynthesis' in window) {
    const utter = createUtterance('');
    utter.volume = 0;
    speechSynthesis.speak(utter);
  }
}

function speakSegment(index) {
  if (liveMuted || !liveSegments.length) return;

  if (index >= liveSegments.length) {
    setRobotSpeaking(false);
    setLiveBadge('MONITORING');
    restoreMusic();
    return;
  }

  liveSegIdx = index;
  const text = liveSegments[index];
  setCaption(text);

  if (!('speechSynthesis' in window)) return;

  const generation = speechGeneration;
  const utter = createUtterance(text);

  utter.onstart = () => {
    if (generation !== speechGeneration) return;
    duckMusic();
    setRobotSpeaking(true);
    setLiveBadge('LIVE');
  };

  utter.onend = () => {
    if (generation !== speechGeneration) return;
    setRobotSpeaking(false);
    restoreMusic();

    setTimeout(() => {
      if (generation === speechGeneration && !liveMuted) {
        speakSegment(index+1);
      }
    }, /warning|emergency/i.test(text) ? 550 : 350);
  };

  utter.onerror = () => {
    if (generation !== speechGeneration) return;
    setRobotSpeaking(false);
    setTimeout(() => speakSegment(index+1),350);
  };

  speechSynthesis.speak(utter);
}

function startCurrentRundown() {
  speechGeneration++;
  try { speechSynthesis.cancel(); } catch (_) {}
  setRobotSpeaking(false);
  speakSegment(0);
}

function speakStandalone(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) {
      setCaption(text);
      resolve();
      return;
    }

    const utter = createUtterance(text);
    utter.onstart = () => {
      duckMusic();
      setRobotSpeaking(true);
      setCaption(text);
    };
    utter.onend = () => {
      setRobotSpeaking(false);
      restoreMusic();
      resolve();
    };
    utter.onerror = () => {
      setRobotSpeaking(false);
      resolve();
    };
    speechSynthesis.speak(utter);
  });
}

function replaySegment() {
  if (!liveSegments.length || liveMuted) return;
  speechGeneration++;
  try { speechSynthesis.cancel(); } catch (_) {}
  setRobotSpeaking(false);
  setTimeout(() => speakSegment(liveSegIdx),100);
}

function toggleMute() {
  liveMuted = !liveMuted;
  const button = document.getElementById('liveMuteBtn');

  speechGeneration++;

  if (liveMuted) {
    try { speechSynthesis.cancel(); } catch (_) {}
    setRobotSpeaking(false);
    stopMusic();
    setLiveBadge('MUTED');
    if (button) button.textContent = 'RESUME';
  } else {
    if (button) button.textContent = 'STOP';
    startMusic();
    setLiveBadge('LIVE');
    speakSegment(liveSegIdx);
  }

  updateStatusPills();
}

/* ─────────────────────────────────────────────
   STARTUP
───────────────────────────────────────────── */

function hideStartOverlay() {
  const overlay = document.getElementById('liveStartOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function startBroadcast() {
  if (liveStarted) return;

  const button = document.getElementById('liveStartBtn');
  unlockMediaFromUserGesture();

  if (button) {
    button.disabled = true;
    button.textContent = 'GETTING LOCATION...';
  }

  try {
    await requestCurrentLocation();

    if (button) button.textContent = 'LOADING WEATHER...';

    await prepareBroadcast();

    liveStarted = true;
    hideStartOverlay();
    startMusic();
    startMovingLocationWatch();
    startTimers();
    setLiveBadge('LIVE');

    startCurrentRundown();
  } catch (error) {
    console.error('StormVector startup failed:',error);

    setLiveBadge('STANDBY');
    setLocationText(error.message || 'Unable to start StormVector.');
    setCaption('StormVector could not start. Check location permission and try again.');

    if (button) {
      button.disabled = false;
      button.textContent = 'USE MY LOCATION';
    }
  }
}

/* ─────────────────────────────────────────────
   ALERT / REFRESH TIMERS
───────────────────────────────────────────── */

function startTimers() {
  stopTimers();

  alertTimer = setInterval(checkForBreakingWeather,CONFIG.alertCheckMs);

  refreshTimer = setInterval(async () => {
    if (liveMuted || !locationReady || movingRefreshRunning) return;

    try {
      broadcastLoopCount++;
      await prepareBroadcast({preserveSpeech:true});

      if (!currentWeatherContext?.alerts?.some(isUrgentWarning)) {
        // Do not interrupt normal speech every refresh.
        if (!('speechSynthesis' in window) || !window.speechSynthesis.speaking) startCurrentRundown();
      }
    } catch (error) {
      console.warn('Background refresh failed:',error);
    }
  },CONFIG.normalRefreshMs);
}

function stopTimers() {
  if (alertTimer) clearInterval(alertTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  alertTimer = null;
  refreshTimer = null;
}

async function checkForBreakingWeather() {
  if (!locationReady || liveMuted) return;

  const alerts = await fetchAlerts(liveLat,liveLon);
  const priority = alerts
    .filter(isUrgentWarning)
    .sort((a,b) =>
      alertPriorityScore(a.properties?.event || '') -
      alertPriorityScore(b.properties?.event || '')
    );

  const newWarnings = priority.filter(a => !knownPriorityAlertIds.has(a.id));
  priority.forEach(a => knownPriorityAlertIds.add(a.id));

  if (!newWarnings.length) return;

  const warning = newWarnings[0];
  currentWeatherContext = {
    ...(currentWeatherContext || {}),
    alerts
  };

  updateSevereTakeover(currentWeatherContext);
  updateRadarWarnings();
  updateStatusPills();

  speechGeneration++;
  try { speechSynthesis.cancel(); } catch (_) {}
  setRobotSpeaking(false);

  const p = warning.properties || {};
  liveSegments = [
    `This is a StormVector breaking weather update. A ${p.event || 'weather warning'} has been issued for ${(p.areaDesc || liveCityState || 'your area').split(';')[0]}.`,
    safetyInstructions(warning),
    removeEmojis(p.headline || '')
  ].filter(Boolean);

  liveSegIdx = 0;
  speakSegment(0);
}

/* ─────────────────────────────────────────────
   ASK VECTOR
───────────────────────────────────────────── */

function answerVectorQuestion(question) {
  const ctx = currentWeatherContext;
  if (!ctx) return 'I need weather data loaded before I can answer that.';

  const q = String(question || '').toLowerCase();
  const loc = ctx.cityState || 'this location';

  if (/radar/.test(q)) {
    selectView('radar',true);
    selectRadarProduct('radar');
    return `I've opened NOAA MRMS radar for ${loc}. Warning polygons are shown when active.`;
  }

  if (/tornado/.test(q)) {
    selectView('radar',true);
    selectRadarProduct('tornado');
    const warning = ctx.alerts.find(a => /tornado warning|tornado emergency/i.test(a.properties?.event || ''));
    if (warning) return `There is an active ${warning.properties?.event} affecting this location. ${safetyInstructions(warning)}`;
    const watch = ctx.alerts.find(a => /tornado watch/i.test(a.properties?.event || ''));
    if (watch) return `A Tornado Watch is active for this location. Be ready to move to shelter quickly if a warning is issued.`;
    return `There is no active tornado warning or tornado watch affecting ${loc} right now.`;
  }

  if (/spc|severe|outlook|risk/.test(q)) {
    selectView('radar',true);
    selectRadarProduct('spc');
    return `I've opened the official SPC Day 1 outlook. The categorical risk at ${loc} is ${ctx.spc || 'not currently loaded'}.`;
  }

  if (/wind|gust/.test(q)) {
    return `For ${loc}, wind is ${window.degToCompass(ctx.windDeg) || 'variable'} at ${ctx.windSpd} miles per hour${ctx.windG > ctx.windSpd + 5 ? `, gusting to ${ctx.windG}` : ''}.`;
  }

  if (/temperature|temp|hot|cold|feels/.test(q)) {
    return `For ${loc}, the current temperature is ${ctx.tempF ?? 'unavailable'} degrees${ctx.feelsF != null ? `, and it feels like ${ctx.feelsF}` : ''}.`;
  }

  if (/rain|tonight/.test(q)) {
    return ctx.forecast.tonight
      ? `For ${loc} tonight, ${ctx.forecast.tonight}`
      : `I don't currently have tonight's detailed forecast loaded for ${loc}.`;
  }

  if (/changed|change|new/.test(q)) {
    return latestChanges.map(c => c.text).join(' ');
  }

  return ctx.forecast.today
    ? `For ${loc}, ${ctx.forecast.today}`
    : `For ${loc}, it's currently ${ctx.tempF ?? 'unavailable'} degrees.`;
}

async function askVector(question) {
  const text = String(question || '').trim();
  if (!text) return;

  const answer = answerVectorQuestion(text);
  setText('askVectorAnswer',answer);

  if (liveStarted && !liveMuted) {
    speechGeneration++;
    try { speechSynthesis.cancel(); } catch (_) {}
    setRobotSpeaking(false);
    await wait(100);
    await speakStandalone(answer);
  }
}

function bindAskVector() {
  const form = document.getElementById('askVectorForm');
  const input = document.getElementById('askVectorInput');

  form?.addEventListener('submit',event => {
    event.preventDefault();
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    askVector(q);
  });

  document.querySelectorAll('.ask-vector-quick').forEach(button => {
    button.addEventListener('click',() => {
      askVector(button.dataset.question || button.textContent);
    });
  });
}

/* ─────────────────────────────────────────────
   BROADCAST HISTORY
───────────────────────────────────────────── */

function addHistory(text) {
  const cleaned = removeEmojis(text);
  if (!cleaned) return;

  if (broadcastHistory[0]?.text === cleaned) return;

  broadcastHistory.unshift({text:cleaned,time:new Date()});
  if (broadcastHistory.length > CONFIG.maxHistory) broadcastHistory.length = CONFIG.maxHistory;
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('broadcastHistoryList');
  if (!container) return;

  if (!broadcastHistory.length) {
    container.textContent = 'No broadcast history yet.';
    return;
  }

  container.innerHTML = broadcastHistory.map(item =>
    `<div class="broadcast-history-item">` +
      `<span class="broadcast-history-time">${escapeHtml(item.time.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</span>` +
      `${escapeHtml(item.text)}` +
    `</div>`
  ).join('');
}

function bindHistory() {
  const toggle = document.getElementById('broadcastHistoryToggle');
  const body = document.getElementById('broadcastHistoryBody');
  const chev = document.getElementById('broadcastHistoryChevron');

  toggle?.addEventListener('click',() => {
    if (!body) return;
    const opening = body.hidden;
    body.hidden = !opening;
    if (chev) chev.textContent = opening ? '−' : '+';
  });
}

/* Hook history into captions */
const originalSetCaption = setCaption;
setCaption = function(text) {
  originalSetCaption(text);
  addHistory(text);
};

/* ─────────────────────────────────────────────
   DOM / DIAGNOSTICS
───────────────────────────────────────────── */

function runDiagnostics() {
  const required = [
    'liveStartBtn',
    'livePopupLocationSearch',
    'livePopupSearchSuggestions',
    'liveLocationSearch',
    'liveSearchSuggestions',
    'stormVectorRadar',
    'radarProductRadar',
    'radarProductSpc',
    'radarProductTornado',
    'liveAvatar'
  ];

  const missing = required.filter(id => !document.getElementById(id));
  if (missing.length) console.warn('StormVector missing DOM elements:',missing);
}

document.addEventListener('visibilitychange',() => {
  if (document.visibilityState === 'visible') {
    setTimeout(() => radarMap?.invalidateSize(),200);
  }
});

/* ─────────────────────────────────────────────
   BOOT
───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded',() => {
  runDiagnostics();

  ensureMusic();
  pickVoice();

  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  setLocationText('Location not selected');
  setLocationSource('StormVector');
  setCaption('Choose your current location or search for a United States location to begin.');
  setCaptionTopic('STANDBY');
  setLiveBadge('STANDBY');
  setText('vectorGraphicStatus','READY');

  installSpcImagePanels();

  // Keep only radar panel visible inside radar-product area.
  selectRadarProduct('radar');
  selectView('conditions',true);

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

  bindMainViewTabs();
  bindRadarProductTabs();
  bindRadarControls();
  bindAskVector();
  bindHistory();

  const startButton = document.getElementById('liveStartBtn');
  if (startButton) {
    startButton.disabled = false;
    startButton.textContent = 'USE MY LOCATION';
  }
});

/* ─────────────────────────────────────────────
   CLEANUP
───────────────────────────────────────────── */

window.addEventListener('beforeunload',() => {
  speechGeneration++;
  try { speechSynthesis.cancel(); } catch (_) {}
  stopTimers();

  if (locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
  }

  if (searchController) {
    try { searchController.abort(); } catch (_) {}
  }

  if (radarMap) {
    try { radarMap.remove(); } catch (_) {}
  }

  if (liveMusic) {
    try { liveMusic.pause(); } catch (_) {}
  }
});
