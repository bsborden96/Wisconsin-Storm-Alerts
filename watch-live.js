/* ═══════════════════════════════════════════════════════
   STORMVECTOR — VECTOR BROADCAST ENGINE
   watch-live.js

   FEATURES
   - Current location weather
   - Continuous GPS tracking while driving/traveling
   - Automatic location/weather refresh
   - U.S. location search
   - NWS alerts + forecast
   - NWS observation stations
   - Open-Meteo current/hourly fallback
   - SPC Day 1 categorical outlook
   - SPC Day 1 tornado probability
   - NOAA MRMS radar
   - Warning polygons
   - Official SPC product links
   - Severe weather priority broadcasting
   - NWS-style safety instructions
   - Severe weather interruption
   - Watch/warning/critical visual themes
   - Ask Vector
   - Broadcast history
   - iPhone speech/music support
═══════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════ */

const STORMVECTOR_FEATURES = {
  radar: true,
  warningPolygons: true,
  askVector: true,
  changeEngine: true,
  broadcastHistory: true,
  severeTakeover: true,
  liveLocationTracking: true
};

const LOCATION_REFRESH_DISTANCE_MILES = 2;
const LOCATION_REFRESH_MAX_AGE = 5 * 60 * 1000;
const ALERT_CHECK_INTERVAL = 30000;


/* ═══════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */

let liveLat = null;
let liveLon = null;

let deviceLat = null;
let deviceLon = null;

let liveCityState = null;
let locationMode = 'none';
let selectedSearchLocation = null;
let locationReady = false;

let locationWatchId = null;
let lastTrackedRefreshLat = null;
let lastTrackedRefreshLon = null;
let lastTrackedRefreshTime = 0;
let movingRefreshRunning = false;

let liveSegments = [];
let liveSegIdx = 0;

let liveVoice = null;
let liveMuted = false;
let liveStarted = false;
let startupRunning = false;
let startupSpeechPromise = null;

let currentWeatherContext = null;
let broadcastLoopCount = 0;

let speechGeneration = 0;
let speechKeepAlive = null;
let wakeLock = null;

let selectedView = 'conditions';
let viewBeforeSevere = 'conditions';
let severeTakeoverActive = false;

let liveMusic = null;
let musicFadeFrame = null;

let breakingWeatherActive = false;
let severeWatchTimer = null;

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
const MAX_HISTORY_ITEMS = 30;

let lastAskTopic = null;


/* ═══════════════════════════════════════════════
   SPC
════════════════════════════════════════════════ */

const SPC_RANK = {
  TSTM: 1,
  MRGL: 2,
  SLGT: 3,
  ENH: 4,
  MDT: 5,
  HIGH: 6
};

const STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia'
};


/* ═══════════════════════════════════════════════
   BASIC HELPERS
════════════════════════════════════════════════ */

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function stateName(value) {
  const state = String(value || '').trim();

  return STATE_NAMES[state.toUpperCase()] || state;
}

function celsiusToFahrenheit(value) {
  const n = numberOrNull(value);

  if (n === null) return null;

  return Math.round((n * 9 / 5) + 32);
}

function kmhToMph(value) {
  const n = numberOrNull(value);

  if (n === null) return null;

  return Math.round(n * 0.621371);
}

function metersPerSecondToMph(value) {
  const n = numberOrNull(value);

  if (n === null) return null;

  return Math.round(n * 2.23694);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function removeEmojis(text) {
  let output = String(text || '');

  try {
    output = output.replace(/\p{Extended_Pictographic}/gu, '');
  } catch (_) {
    output = output.replace(/[\u2600-\u27BF]/g, '');
  }

  return output
    .replace(/\uFE0F/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function safeFetch(url, options = {}) {
  const {
    timeout = 10000,
    ...rest
  } = options;

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

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
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function setLocationText(text) {
  const element = document.querySelector(
    '#liveLocationCard .live-location-text'
  );

  if (element) {
    element.textContent = text;
  }

  setText('askVectorLocation', text);
  setText('radarLocationLabel', text);
}

function setLocationSource(text) {
  setText('liveLocationSource', text);
}

function setCaption(text) {
  const cleaned = removeEmojis(text);

  setText('liveCaptionText', cleaned);
  announce(cleaned);
}

function setCaptionTopic(text) {
  setText(
    'liveCaptionTopic',
    String(text || '').toUpperCase()
  );
}

function setLiveBadge(text) {
  const badge = document.getElementById('liveBadge');

  if (!badge) return;

  badge.innerHTML = `
    <span class="live-dot"></span>
    <span class="live-badge-text">
      ${escapeHtml(text)}
    </span>
  `;

  badge.classList.toggle(
    'live-badge-on',
    text === 'LIVE'
  );
}

function setRobotSpeaking(speaking) {
  document
    .getElementById('liveAvatar')
    ?.classList
    .toggle('speaking', speaking);

  document.body.classList.toggle(
    'vector-speaking',
    speaking
  );
}

function hideStartOverlay() {
  const overlay = document.getElementById(
    'liveStartOverlay'
  );

  if (overlay) {
    overlay.style.display = 'none';
  }
}

function updateReturnLocationButton() {
  const button = document.getElementById(
    'returnToMyLocationBtn'
  );

  if (!button) return;

  button.hidden = locationMode !== 'search';
}


/* ═══════════════════════════════════════════════
   WEATHER HELPERS
════════════════════════════════════════════════ */

function degToCompass(degrees) {
  if (
    degrees === null ||
    degrees === undefined ||
    Number.isNaN(Number(degrees))
  ) {
    return '';
  }

  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW'
  ];

  return directions[
    Math.round(Number(degrees) / 22.5) % 16
  ];
}

function dewLabel(dewF) {
  if (dewF === null || dewF === undefined) {
    return '';
  }

  if (dewF < 50) return 'very comfortable';
  if (dewF < 60) return 'comfortable';
  if (dewF < 65) return 'a little sticky';
  if (dewF < 70) return 'muggy';
  if (dewF < 75) return 'oppressive';

  return 'very humid';
}

function alertPriorityScore(event) {
  const text = String(event || '').toLowerCase();

  const order = [
    ['tornado emergency', 0],
    ['tornado warning', 1],
    ['flash flood emergency', 2],
    ['severe thunderstorm warning', 3],
    ['snow squall warning', 4],
    ['flash flood warning', 5],
    ['tornado watch', 6],
    ['severe thunderstorm watch', 7],
    ['flood warning', 8],
    ['blizzard warning', 9],
    ['ice storm warning', 10],
    ['winter storm warning', 11],
    ['high wind warning', 12],
    ['excessive heat warning', 13],
    ['winter storm watch', 14],
    ['flood watch', 15]
  ];

  for (const [needle, score] of order) {
    if (text.includes(needle)) {
      return score;
    }
  }

  return 50;
}

function isTornadoLevel(event) {
  return /tornado warning|tornado emergency/i.test(
    event || ''
  );
}

function parseMovement(description) {
  const text = String(description || '');

  let match =
    /moving\s+([nsew]{1,3})\s+at\s+(\d+)\s*mph/i
      .exec(text);

  if (match) {
    return {
      dir: match[1].toUpperCase(),
      spd: match[2]
    };
  }

  match =
    /moving\s+(north|south|east|west|northeast|northwest|southeast|southwest)\s+at\s+(\d+)\s*mph/i
      .exec(text);

  if (match) {
    return {
      dir: match[1],
      spd: match[2]
    };
  }

  return null;
}

function weatherCodePhrase(code) {
  if ([95, 96, 99].includes(code)) {
    return 'thunderstorms';
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return 'snow';
  }

  if ([61, 63, 65, 80, 81, 82].includes(code)) {
    return 'rain showers';
  }

  if ([56, 57, 66, 67].includes(code)) {
    return 'freezing precipitation';
  }

  if ([51, 53, 55].includes(code)) {
    return 'drizzle';
  }

  if ([45, 48].includes(code)) {
    return 'fog';
  }

  return null;
}

function skyDescription(code) {
  if (code === 0) return 'clear skies';
  if (code === 1) return 'mostly clear skies';
  if (code === 2) return 'partly cloudy skies';
  if (code === 3) return 'mostly cloudy skies';

  if ([45, 48].includes(code)) {
    return 'foggy conditions';
  }

  return weatherCodePhrase(code);
}


/* ═══════════════════════════════════════════════
   DISTANCE / LIVE GPS
════════════════════════════════════════════════ */

function milesBetween(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;

  const toRad = degrees =>
    degrees * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );
}

function stopLocationTracking() {
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

function startLocationTracking() {
  if (
    !STORMVECTOR_FEATURES.liveLocationTracking ||
    !('geolocation' in navigator)
  ) {
    return;
  }

  stopLocationTracking();

  locationWatchId =
    navigator.geolocation.watchPosition(
      position => {
        deviceLat = position.coords.latitude;
        deviceLon = position.coords.longitude;

        if (locationMode !== 'device') {
          return;
        }

        maybeRefreshMovingLocation(
          deviceLat,
          deviceLon
        );
      },

      error => {
        console.warn(
          'StormVector live GPS tracking error:',
          error
        );
      },

      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 20000
      }
    );
}

async function maybeRefreshMovingLocation(
  newLat,
  newLon
) {
  if (
    !liveStarted ||
    liveMuted ||
    movingRefreshRunning ||
    breakingWeatherActive ||
    locationMode !== 'device'
  ) {
    return;
  }

  if (
    lastTrackedRefreshLat === null ||
    lastTrackedRefreshLon === null
  ) {
    lastTrackedRefreshLat = newLat;
    lastTrackedRefreshLon = newLon;
    lastTrackedRefreshTime = Date.now();
    return;
  }

  const distance = milesBetween(
    lastTrackedRefreshLat,
    lastTrackedRefreshLon,
    newLat,
    newLon
  );

  const age =
    Date.now() -
    lastTrackedRefreshTime;

  if (
    distance < LOCATION_REFRESH_DISTANCE_MILES &&
    age < LOCATION_REFRESH_MAX_AGE
  ) {
    return;
  }

  movingRefreshRunning = true;

  liveLat = newLat;
  liveLon = newLon;

  lastTrackedRefreshLat = newLat;
  lastTrackedRefreshLon = newLon;
  lastTrackedRefreshTime = Date.now();

  try {
    await prepareBroadcast({
      movingUpdate: true
    });

    updateRadarForLocation();

  } catch (error) {
    console.warn(
      'StormVector moving-location refresh failed:',
      error
    );
  } finally {
    movingRefreshRunning = false;
  }
}


/* ═══════════════════════════════════════════════
   LOCATION
════════════════════════════════════════════════ */

function geolocationErrorMessage(error) {
  if (!error) {
    return 'StormVector could not get your location.';
  }

  if (error.code === 1) {
    return 'Location access is blocked. Allow location access and try again.';
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
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(
        new Error(
          'This browser does not support location services.'
        )
      );

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

        lastTrackedRefreshLat = liveLat;
        lastTrackedRefreshLon = liveLon;
        lastTrackedRefreshTime = Date.now();

        updateReturnLocationButton();

        resolve(position);
      },

      error => {
        reject(
          new Error(
            geolocationErrorMessage(error)
          )
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}


/* ═══════════════════════════════════════════════
   LOCATION SEARCH
════════════════════════════════════════════════ */

async function searchUsLocations(query) {
  const term = String(query || '').trim();

  if (term.length < 3) {
    return [];
  }

  if (locationSearchController) {
    locationSearchController.abort();
  }

  locationSearchController =
    new AbortController();

  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(term)}` +
    '&count=10' +
    '&language=en' +
    '&format=json' +
    '&countryCode=US';

  try {
    const response = await fetch(url, {
      signal: locationSearchController.signal
    });

    if (!response.ok) {
      throw new Error(
        `Search HTTP ${response.status}`
      );
    }

    const data = await response.json();

    return (data.results || []).filter(
      result =>
        Number.isFinite(Number(result.latitude)) &&
        Number.isFinite(Number(result.longitude))
    );

  } catch (error) {
    if (error.name === 'AbortError') {
      return [];
    }

    console.warn(
      'StormVector location search failed:',
      error
    );

    return [];
  }
}

function locationResultDisplay(result) {
  const city =
    result.name ||
    'Selected location';

  const state =
    stateName(result.admin1 || '');

  return [city, state]
    .filter(Boolean)
    .join(', ');
}

function renderSearchSuggestions(
  config,
  results
) {
  const suggestions =
    document.getElementById(
      config.suggestionsId
    );

  const input =
    document.getElementById(
      config.inputId
    );

  if (!suggestions || !input) {
    return;
  }

  suggestions.innerHTML = '';

  if (!results.length) {
    suggestions.innerHTML = `
      <div class="live-search-suggestion">
        <span class="live-search-suggestion-main">
          No U.S. locations found
        </span>
      </div>
    `;

    suggestions.hidden = false;

    input.setAttribute(
      'aria-expanded',
      'true'
    );

    return;
  }

  results.forEach(result => {
    const button =
      document.createElement('button');

    button.type = 'button';
    button.className =
      'live-search-suggestion';

    const state =
      stateName(result.admin1 || '');

    const secondary = [
      result.admin2,
      state
    ]
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

    button.addEventListener(
      'click',
      () => selectSearchedLocation(result)
    );

    suggestions.appendChild(button);
  });

  suggestions.hidden = false;

  input.setAttribute(
    'aria-expanded',
    'true'
  );
}

function bindLocationSearch(config) {
  const input =
    document.getElementById(
      config.inputId
    );

  const suggestions =
    document.getElementById(
      config.suggestionsId
    );

  const status =
    document.getElementById(
      config.statusId
    );

  const clearButton =
    document.getElementById(
      config.clearId
    );

  if (!input || !suggestions) {
    return;
  }

  function closeSuggestions() {
    suggestions.hidden = true;

    input.setAttribute(
      'aria-expanded',
      'false'
    );
  }

  input.addEventListener(
    'input',
    () => {
      const query =
        input.value.trim();

      if (clearButton) {
        clearButton.hidden = !query;
      }

      clearTimeout(locationSearchTimer);

      if (query.length < 3) {
        closeSuggestions();

        if (status) {
          status.textContent = '';
        }

        return;
      }

      if (status) {
        status.textContent =
          'Searching...';
      }

      locationSearchTimer =
        setTimeout(
          async () => {
            const results =
              await searchUsLocations(query);

            if (
              input.value.trim() !== query
            ) {
              return;
            }

            if (status) {
              status.textContent =
                results.length
                  ? `${results.length} locations found`
                  : 'No matching locations';
            }

            renderSearchSuggestions(
              config,
              results
            );
          },
          300
        );
    }
  );

  clearButton?.addEventListener(
    'click',
    () => {
      input.value = '';
      clearButton.hidden = true;

      if (status) {
        status.textContent = '';
      }

      closeSuggestions();
      input.focus();
    }
  );

  document.addEventListener(
    'click',
    event => {
      if (
        event.target === input ||
        suggestions.contains(event.target)
      ) {
        return;
      }

      closeSuggestions();
    }
  );
}

function closeAllSearchSuggestions() {
  [
    'liveSearchSuggestions',
    'livePopupSearchSuggestions'
  ].forEach(id => {
    const element =
      document.getElementById(id);

    if (element) {
      element.hidden = true;
    }
  });
}

function setAllSearchInputs(value) {
  [
    'liveLocationSearch',
    'livePopupLocationSearch'
  ].forEach(id => {
    const input =
      document.getElementById(id);

    if (input) {
      input.value = value;
    }
  });
}


/* ═══════════════════════════════════════════════
   SELECT SEARCH LOCATION
════════════════════════════════════════════════ */

async function selectSearchedLocation(result) {
  if (!result) return;

  const alreadyStarted = liveStarted;

  if (!alreadyStarted) {
    startMediaFromUserGesture();
  }

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

  liveCityState =
    locationResultDisplay(result);

  setLocationText(liveCityState);

  setLocationSource(
    'StormVector selected location'
  );

  updateReturnLocationButton();

  setAllSearchInputs(liveCityState);
  closeAllSearchSuggestions();

  setLiveBadge('UPDATING');

  setCaption(
    `Loading weather for ${liveCityState}.`
  );

  try {
    await prepareBroadcast();

    liveStarted = true;
    liveMuted = false;

    document.body.classList.add(
      'broadcast-active'
    );

    hideStartOverlay();

    await bringMusicUp();

    requestWakeLock();

    startSevereWatch();
    startSpeechKeepAlive();

    ensureRadar();
    updateRadarForLocation();

    if (alreadyStarted) {
      await speakStandalone(
        `Switching StormVector coverage to ${liveCityState}.`
      );
    } else if (startupSpeechPromise) {
      await Promise.race([
        startupSpeechPromise,
        wait(5500)
      ]);
    }

    await wait(250);

    speakSegment(0);

  } catch (error) {
    console.error(
      'StormVector location switch failed:',
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

    updateRadarForLocation();

    startLocationTracking();

    await speakStandalone(
      `Switching coverage back to your current location in ${liveCityState || 'your area'}.`
    );

    await wait(250);

    speakSegment(0);

  } catch (error) {
    setCaption(error.message);
    setLiveBadge('LOCATION ERROR');
  }
}


/* ═══════════════════════════════════════════════
   NWS ALERTS
════════════════════════════════════════════════ */

async function fetchAlerts(lat, lon) {
  try {
    const response = await safeFetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        timeout: 10000,
        headers: {
          Accept: 'application/geo+json'
        }
      }
    );

    const data = await response.json();

    return data.features || [];

  } catch (error) {
    console.warn(
      'StormVector alerts failed:',
      error
    );

    return [];
  }
}


/* ═══════════════════════════════════════════════
   NWS POINT / FORECAST
════════════════════════════════════════════════ */

function cleanForecastText(text) {
  if (!text) return null;

  let cleaned = removeEmojis(text);

  cleaned = cleaned
    .replace(/^Tonight:\s*/i, '')
    .replace(/^Today:\s*/i, '')
    .replace(/^This Afternoon:\s*/i, '')
    .replace(/^Overnight:\s*/i, '')
    .replace(/\bChance of precipitation is\b/gi, 'Rain chances are')
    .replace(/\bNew precipitation amounts?[^.]*\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences =
    cleaned.match(
      /[^.!?]+[.!?]?/g
    ) || [cleaned];

  return sentences
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
    .trim();
}

async function fetchNwsContext(lat, lon) {
  try {
    const response = await safeFetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        timeout: 10000,
        headers: {
          Accept: 'application/geo+json'
        }
      }
    );

    const data = await response.json();

    const properties =
      data.properties || {};

    const relative =
      properties.relativeLocation
        ?.properties;

    const fullState =
      stateName(relative?.state || '');

    const cityState =
      relative?.city && fullState
        ? `${relative.city}, ${fullState}`
        : relative?.city ||
          fullState ||
          null;

    let periods = [];
    let today = null;
    let tonight = null;
    let tomorrow = null;

    if (properties.forecast) {
      try {
        const forecastResponse =
          await safeFetch(
            properties.forecast,
            {
              timeout: 10000,
              headers: {
                Accept:
                  'application/geo+json'
              }
            }
          );

        const forecastData =
          await forecastResponse.json();

        periods =
          forecastData.properties
            ?.periods || [];

        const now = new Date();

        const currentPeriod =
          periods.find(period => {
            const start =
              new Date(period.startTime);

            const end =
              new Date(period.endTime);

            return start <= now && now < end;
          }) ||
          periods[0];

        const nightPeriod =
          periods.find(
            period =>
              !period.isDaytime &&
              new Date(period.endTime) > now
          );

        const tomorrowDay =
          periods.find(
            period =>
              period.isDaytime &&
              new Date(period.startTime)
                .getDate() !==
                now.getDate()
          );

        today = cleanForecastText(
          currentPeriod?.detailedForecast ||
          currentPeriod?.shortForecast
        );

        tonight = cleanForecastText(
          nightPeriod?.detailedForecast ||
          nightPeriod?.shortForecast
        );

        tomorrow = cleanForecastText(
          tomorrowDay?.detailedForecast ||
          tomorrowDay?.shortForecast
        );

      } catch (error) {
        console.warn(
          'StormVector NWS forecast failed:',
          error
        );
      }
    }

    return {
      cityState,

      observationStationsUrl:
        properties.observationStations ||
        null,

      forecast: {
        today,
        tonight,
        tomorrow
      },

      periods
    };

  } catch (error) {
    console.warn(
      'StormVector NWS point failed:',
      error
    );

    return {
      cityState: null,
      observationStationsUrl: null,
      forecast: {
        today: null,
        tonight: null,
        tomorrow: null
      },
      periods: []
    };
  }
}


/* ═══════════════════════════════════════════════
   NWS OBSERVATIONS
════════════════════════════════════════════════ */

function quantitativeWindToMph(
  measurement
) {
  if (!measurement) return null;

  const value =
    numberOrNull(measurement.value);

  if (value === null) return null;

  const unit =
    String(
      measurement.unitCode || ''
    ).toLowerCase();

  if (
    unit.includes('km_h') ||
    unit.includes('km/h')
  ) {
    return kmhToMph(value);
  }

  if (
    unit.includes('m_s') ||
    unit.includes('m/s')
  ) {
    return metersPerSecondToMph(value);
  }

  if (
    unit.includes('mi_h') ||
    unit.includes('mph')
  ) {
    return Math.round(value);
  }

  return kmhToMph(value);
}

async function fetchNearestObservation(
  observationStationsUrl
) {
  if (!observationStationsUrl) {
    return null;
  }

  try {
    const stationResponse =
      await safeFetch(
        observationStationsUrl,
        {
          timeout: 10000,
          headers: {
            Accept:
              'application/geo+json'
          }
        }
      );

    const stationData =
      await stationResponse.json();

    const stations =
      stationData.features || [];

    for (
      const station
      of stations.slice(0, 6)
    ) {
      const stationId =
        station.properties
          ?.stationIdentifier ||
        station.id
          ?.split('/')
          .pop();

      if (!stationId) {
        continue;
      }

      try {
        const response =
          await safeFetch(
            `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
            {
              timeout: 8000,
              headers: {
                Accept:
                  'application/geo+json'
              }
            }
          );

        const observation =
          await response.json();

        const props =
          observation.properties || {};

        const temperature =
          numberOrNull(
            props.temperature?.value
          );

        if (temperature === null) {
          continue;
        }

        const dewpoint =
          numberOrNull(
            props.dewpoint?.value
          );

        const humidity =
          numberOrNull(
            props.relativeHumidity?.value
          );

        const windDirection =
          numberOrNull(
            props.windDirection?.value
          );

        return {
          stationId,

          stationName:
            station.properties?.name ||
            stationId,

          timestamp:
            props.timestamp || null,

          tempF:
            celsiusToFahrenheit(
              temperature
            ),

          dewF:
            dewpoint !== null
              ? celsiusToFahrenheit(
                  dewpoint
                )
              : null,

          humidity:
            humidity !== null
              ? Math.round(humidity)
              : null,

          windSpd:
            quantitativeWindToMph(
              props.windSpeed
            ) ?? 0,

          windG:
            quantitativeWindToMph(
              props.windGust
            ) ?? 0,

          windDeg:
            windDirection ?? 0,

          textDescription:
            removeEmojis(
              props.textDescription || ''
            )
        };

      } catch (_) {}
    }

    return null;

  } catch (error) {
    console.warn(
      'Observation lookup failed:',
      error
    );

    return null;
  }
}


/* ═══════════════════════════════════════════════
   OPEN-METEO
════════════════════════════════════════════════ */

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

  const response =
    await safeFetch(
      url,
      {
        timeout: 10000
      }
    );

  const data = await response.json();

  const current =
    data.current || {};

  const daily =
    data.daily || {};

  const formatTime = value => {
    if (!value) return null;

    try {
      return new Date(value)
        .toLocaleTimeString(
          [],
          {
            hour: 'numeric',
            minute: '2-digit'
          }
        );
    } catch (_) {
      return null;
    }
  };

  return {
    tempF:
      current.temperature_2m !== undefined
        ? Math.round(
            current.temperature_2m
          )
        : null,

    feelsF:
      current.apparent_temperature !== undefined
        ? Math.round(
            current.apparent_temperature
          )
        : null,

    humidity:
      current.relative_humidity_2m !== undefined
        ? Math.round(
            current.relative_humidity_2m
          )
        : null,

    dewF:
      current.dew_point_2m !== undefined
        ? Math.round(
            current.dew_point_2m
          )
        : null,

    wcode:
      current.weather_code !== undefined
        ? current.weather_code
        : null,

    windSpd:
      current.wind_speed_10m !== undefined
        ? Math.round(
            current.wind_speed_10m
          )
        : 0,

    windDeg:
      current.wind_direction_10m !== undefined
        ? current.wind_direction_10m
        : 0,

    windG:
      current.wind_gusts_10m !== undefined
        ? Math.round(
            current.wind_gusts_10m
          )
        : 0,

    sunrise:
      formatTime(daily.sunrise?.[0]),

    sunset:
      formatTime(daily.sunset?.[0]),

    hourly:
      data.hourly || {}
  };
}


/* ═══════════════════════════════════════════════
   SPC GEOMETRY
════════════════════════════════════════════════ */

function pointInRing(point, ring) {
  let inside = false;

  for (
    let i = 0,
        j = ring.length - 1;
    i < ring.length;
    j = i++
  ) {
    const xi = ring[i][0];
    const yi = ring[i][1];

    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects =
      (yi > point[1]) !==
      (yj > point[1]) &&
      point[0] <
        (
          (xj - xi) *
          (point[1] - yi) /
          (yj - yi)
        ) +
        xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(
  point,
  coordinates
) {
  if (
    !coordinates ||
    !coordinates[0] ||
    !pointInRing(
      point,
      coordinates[0]
    )
  ) {
    return false;
  }

  for (
    let i = 1;
    i < coordinates.length;
    i++
  ) {
    if (
      pointInRing(
        point,
        coordinates[i]
      )
    ) {
      return false;
    }
  }

  return true;
}

function pointInGeometry(
  point,
  geometry
) {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    return pointInPolygon(
      point,
      geometry.coordinates
    );
  }

  if (
    geometry.type ===
    'MultiPolygon'
  ) {
    return geometry.coordinates.some(
      polygon =>
        pointInPolygon(
          point,
          polygon
        )
    );
  }

  return false;
}

async function fetchSpcGeoJson(url) {
  try {
    const response =
      await safeFetch(
        url,
        {
          timeout: 9000
        }
      );

    return await response.json();

  } catch (error) {
    console.warn(
      'SPC product unavailable:',
      url,
      error
    );

    return null;
  }
}

function findSpcCategoryForPoint(
  data,
  lat,
  lon
) {
  if (!data?.features) {
    return null;
  }

  const point = [lon, lat];

  let best = null;

  for (
    const feature
    of data.features
  ) {
    const label =
      String(
        feature.properties?.LABEL ||
        feature.properties?.label ||
        feature.properties?.DN ||
        ''
      ).toUpperCase();

    if (!SPC_RANK[label]) {
      continue;
    }

    if (
      pointInGeometry(
        point,
        feature.geometry
      )
    ) {
      if (
        !best ||
        SPC_RANK[label] >
        SPC_RANK[best]
      ) {
        best = label;
      }
    }
  }

  return best;
}

function findSpcProbabilityForPoint(
  data,
  lat,
  lon
) {
  if (!data?.features) {
    return null;
  }

  const point = [lon, lat];

  let best = null;

  for (
    const feature
    of data.features
  ) {
    if (
      !pointInGeometry(
        point,
        feature.geometry
      )
    ) {
      continue;
    }

    const props =
      feature.properties || {};

    const raw =
      props.LABEL ??
      props.label ??
      props.DN ??
      props.PROB ??
      props.probability;

    if (raw === undefined) {
      continue;
    }

    const text =
      String(raw)
        .replace('%', '')
        .trim();

    const number =
      Number(text);

    if (
      Number.isFinite(number) &&
      (
        best === null ||
        number > best
      )
    ) {
      best = number;
    }
  }

  return best;
}

async function fetchSpcProducts(
  lat,
  lon
) {
  const [
    categorical,
    tornado
  ] = await Promise.all([
    fetchSpcGeoJson(
      'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson'
    ),

    fetchSpcGeoJson(
      'https://www.spc.noaa.gov/products/outlook/day1otlk_torn.lyr.geojson'
    )
  ]);

  return {
    category:
      findSpcCategoryForPoint(
        categorical,
        lat,
        lon
      ),

    tornadoProbability:
      findSpcProbabilityForPoint(
        tornado,
        lat,
        lon
      )
  };
}


/* ═══════════════════════════════════════════════
   MANUAL VIEWS
════════════════════════════════════════════════ */

const VIEW_TITLES = {
  conditions:
    'CURRENT CONDITIONS',

  radar:
    'LIVE RADAR',

  forecast:
    'FORECAST',

  spc:
    'SEVERE WEATHER',

  changes:
    'WHAT CHANGED',

  alert:
    'WEATHER ALERT'
};

function selectView(
  view,
  options = {}
) {
  const {
    manual = true
  } = options;

  const allowed = [
    'conditions',
    'radar',
    'forecast',
    'spc',
    'changes',
    'alert'
  ];

  if (!allowed.includes(view)) {
    return;
  }

  document
    .querySelectorAll(
      '.vector-graphic-view'
    )
    .forEach(element => {
      element.classList.remove(
        'active'
      );
    });

  const selected =
    document.querySelector(
      `[data-graphic="${view}"]`
    );

  selected?.classList.add('active');

  document
    .querySelectorAll(
      '.live-view-btn'
    )
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

  if (
    manual &&
    view !== 'alert'
  ) {
    selectedView = view;
  }

  if (view === 'radar') {
    ensureRadar();

    setTimeout(
      () =>
        radarMap?.invalidateSize(),
      150
    );
  }
}

function bindViewSelector() {
  document
    .querySelectorAll(
      '.live-view-btn'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          selectView(
            button.dataset.view,
            {
              manual: true
            }
          );
        }
      );
    });

  document
    .getElementById(
      'severeOpenRadarBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        selectView(
          'radar',
          {
            manual: true
          }
        );
      }
    );
}


/* ═══════════════════════════════════════════════
   OFFICIAL SPC BUTTONS
════════════════════════════════════════════════ */

function addOfficialWeatherButtons() {
  const radarView =
    document.getElementById(
      'graphicRadar'
    );

  if (!radarView) {
    return;
  }

  if (
    document.getElementById(
      'officialWeatherProducts'
    )
  ) {
    return;
  }

  const container =
    document.createElement('div');

  container.id =
    'officialWeatherProducts';

  container.className =
    'radar-control-row';

  container.style.marginTop =
    '10px';

  container.innerHTML = `
    <button
      id="openSpcOutlookBtn"
      class="radar-tool-btn"
      type="button">
      SPC OUTLOOK
    </button>

    <button
      id="openSpcTornadoBtn"
      class="radar-tool-btn"
      type="button">
      TORNADO OUTLOOK
    </button>

    <button
      id="openNwsAlertsBtn"
      class="radar-tool-btn"
      type="button">
      NWS ALERTS
    </button>
  `;

  radarView.appendChild(container);

  document
    .getElementById(
      'openSpcOutlookBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        window.open(
          'https://www.spc.noaa.gov/products/outlook/day1otlk.html',
          '_blank',
          'noopener'
        );
      }
    );

  document
    .getElementById(
      'openSpcTornadoBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        window.open(
          'https://www.spc.noaa.gov/products/outlook/day1probotlk.html',
          '_blank',
          'noopener'
        );
      }
    );

  document
    .getElementById(
      'openNwsAlertsBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        window.open(
          'https://www.weather.gov/',
          '_blank',
          'noopener'
        );
      }
    );
}


/* ═══════════════════════════════════════════════
   WEATHER THEMES
════════════════════════════════════════════════ */

function updateWatchLiveWeatherTheme(ctx) {
  const body = document.body;

  body.classList.remove(
    'weather-theme-watch',
    'weather-theme-warning',
    'weather-theme-critical'
  );

  const alerts =
    ctx?.alerts || [];

  if (!alerts.length) {
    return;
  }

  let level = 0;

  for (const alert of alerts) {
    const props =
      alert.properties || {};

    const event =
      String(
        props.event || ''
      ).toLowerCase();

    const combined =
      [
        props.event,
        props.headline,
        props.description
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (
      combined.includes(
        'tornado emergency'
      ) ||
      combined.includes(
        'flash flood emergency'
      ) ||
      combined.includes(
        'particularly dangerous situation'
      ) ||
      /\bpds\b/.test(combined)
    ) {
      level = Math.max(level, 3);
      continue;
    }

    if (
      event.includes('tornado warning') ||
      event.includes(
        'severe thunderstorm warning'
      ) ||
      event.includes(
        'flash flood warning'
      ) ||
      event.includes(
        'snow squall warning'
      ) ||
      event.includes(
        'blizzard warning'
      ) ||
      event.includes(
        'ice storm warning'
      )
    ) {
      level = Math.max(level, 2);
      continue;
    }

    if (
      event.includes('tornado watch') ||
      event.includes(
        'severe thunderstorm watch'
      ) ||
      event.includes('flood watch') ||
      event.includes(
        'winter storm watch'
      )
    ) {
      level = Math.max(level, 1);
    }
  }

  if (level === 3) {
    body.classList.add(
      'weather-theme-critical'
    );
  } else if (level === 2) {
    body.classList.add(
      'weather-theme-warning'
    );
  } else if (level === 1) {
    body.classList.add(
      'weather-theme-watch'
    );
  }
}


/* ═══════════════════════════════════════════════
   ALERT CLASSIFICATION
════════════════════════════════════════════════ */

function getPriorityAlerts(alerts) {
  return [...(alerts || [])]
    .filter(alert =>
      /Warning|Watch|Emergency/i.test(
        alert.properties?.event || ''
      )
    )
    .sort(
      (a, b) =>
        alertPriorityScore(
          a.properties?.event || ''
        ) -
        alertPriorityScore(
          b.properties?.event || ''
        )
    );
}

function getUrgentAlerts(alerts) {
  return getPriorityAlerts(alerts)
    .filter(alert =>
      /Warning|Emergency/i.test(
        alert.properties?.event || ''
      )
    );
}

function severeOnlyMode(ctx) {
  return getUrgentAlerts(
    ctx?.alerts || []
  ).length > 0;
}


/* ═══════════════════════════════════════════════
   NWS-STYLE SAFETY
════════════════════════════════════════════════ */

function getSafetyInstructions(alert) {
  const props =
    alert?.properties || {};

  const official =
    removeEmojis(
      props.instruction || ''
    );

  if (official) {
    return official;
  }

  const event =
    String(
      props.event || ''
    ).toLowerCase();

  if (
    event.includes(
      'tornado warning'
    ) ||
    event.includes(
      'tornado emergency'
    )
  ) {
    return (
      'Move to an interior room on the lowest floor of a sturdy building. ' +
      'Stay away from windows. ' +
      'If you are in a vehicle or mobile home, get to a substantial shelter if one is safely accessible. ' +
      'Protect your head and neck.'
    );
  }

  if (
    event.includes(
      'severe thunderstorm warning'
    )
  ) {
    return (
      'Move indoors and stay away from windows. ' +
      'Avoid unnecessary travel while damaging wind, large hail, or dangerous lightning are affecting the area.'
    );
  }

  if (
    event.includes(
      'flash flood warning'
    ) ||
    event.includes(
      'flash flood emergency'
    )
  ) {
    return (
      'Move to higher ground now if flooding threatens your location. ' +
      'Do not walk, swim, or drive through floodwater. ' +
      'Never drive around barricades.'
    );
  }

  if (
    event.includes(
      'snow squall warning'
    )
  ) {
    return (
      'Avoid or delay travel if possible. ' +
      'If you are already driving, reduce speed gradually, turn on headlights, and increase following distance because visibility can drop suddenly.'
    );
  }

  if (
    event.includes('blizzard warning')
  ) {
    return (
      'Avoid travel unless absolutely necessary. ' +
      'If you must travel, carry emergency supplies and be prepared for whiteout conditions and dangerous wind chills.'
    );
  }

  if (
    event.includes('tornado watch')
  ) {
    return (
      'Be ready to move to shelter quickly if a warning is issued. ' +
      'Keep multiple ways to receive warnings and review where you will shelter.'
    );
  }

  if (
    event.includes(
      'severe thunderstorm watch'
    )
  ) {
    return (
      'Stay weather-aware and be prepared to move indoors quickly if a warning is issued. ' +
      'Secure loose outdoor objects if it is safe to do so.'
    );
  }

  return (
    'Follow instructions from the National Weather Service and local emergency officials.'
  );
}
/* ═══════════════════════════════════════════════
   CONDITIONS UI
════════════════════════════════════════════════ */

function renderConditionsRow(ctx) {
  const row =
    document.getElementById(
      'liveConditionsRow'
    );

  if (!row) return;

  const chip = (
    label,
    value
  ) => `
    <div class="live-chip">
      <span class="live-chip-label">
        ${label}
      </span>

      <span class="live-chip-val">
        ${escapeHtml(value)}
      </span>
    </div>
  `;

  row.innerHTML = [
    ctx.tempF !== null
      ? chip(
          'TEMP',
          `${ctx.tempF}°F`
        )
      : '',

    ctx.feelsF !== null
      ? chip(
          'FEELS',
          `${ctx.feelsF}°F`
        )
      : '',

    ctx.dewF !== null
      ? chip(
          'DEW POINT',
          `${ctx.dewF}°F`
        )
      : '',

    ctx.humidity !== null
      ? chip(
          'HUMIDITY',
          `${ctx.humidity}%`
        )
      : '',

    chip(
      'WIND',
      `${degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`
    ),

    ctx.windG > ctx.windSpd + 5
      ? chip(
          'GUSTS',
          `${ctx.windG} mph`
        )
      : ''
  ].join('');
}

function renderObservationInfo(
  observation
) {
  const container =
    document.getElementById(
      'liveObservationInfo'
    );

  if (!container) return;

  if (!observation) {
    container.hidden = true;

    setText(
      'freshnessObservation',
      'FALLBACK DATA'
    );

    return;
  }

  container.hidden = false;

  setText(
    'liveObservationStation',
    `${observation.stationName} (${observation.stationId})`
  );

  if (observation.timestamp) {
    const minutes =
      Math.max(
        0,
        Math.round(
          (
            Date.now() -
            new Date(
              observation.timestamp
            ).getTime()
          ) /
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
    setText(
      'liveObservationAge',
      ''
    );

    setText(
      'freshnessObservation',
      'AVAILABLE'
    );
  }
}

function hourlyConditionShort(code) {
  return skyDescription(code) ||
    'No precipitation';
}

function renderForecastTimeline(
  hourly
) {
  const container =
    document.getElementById(
      'forecastTimeline'
    );

  if (!container) return;

  const times =
    hourly?.time || [];

  const temperatures =
    hourly?.temperature_2m || [];

  const rainChance =
    hourly?.precipitation_probability ||
    [];

  const weatherCodes =
    hourly?.weather_code || [];

  const winds =
    hourly?.wind_speed_10m || [];

  if (!times.length) {
    container.innerHTML = `
      <div class="forecast-timeline-empty">
        Hourly forecast is temporarily unavailable.
      </div>
    `;

    return;
  }

  const now = Date.now();

  let startIndex =
    times.findIndex(
      value =>
        new Date(value).getTime() >=
        now - 30 * 60000
    );

  if (startIndex < 0) {
    startIndex = 0;
  }

  const items = [];

  for (
    let offset = 0;
    offset < 12;
    offset++
  ) {
    const index =
      startIndex + offset;

    if (index >= times.length) {
      break;
    }

    const date =
      new Date(times[index]);

    const time =
      date.toLocaleTimeString(
        [],
        {
          hour: 'numeric'
        }
      );

    const temp =
      Math.round(
        temperatures[index]
      );

    const chance =
      Math.round(
        rainChance[index] ?? 0
      );

    const wind =
      Math.round(
        winds[index] ?? 0
      );

    const condition =
      hourlyConditionShort(
        weatherCodes[index]
      );

    items.push(`
      <div class="forecast-hour">
        <span class="forecast-hour-time">
          ${escapeHtml(time)}
        </span>

        <strong class="forecast-hour-temp">
          ${temp}°
        </strong>

        <span class="forecast-hour-detail">
          ${chance}% precip
        </span>

        <span class="forecast-hour-detail">
          Wind ${wind} mph
        </span>

        <span class="forecast-hour-detail">
          ${escapeHtml(condition)}
        </span>
      </div>
    `);
  }

  container.innerHTML =
    items.join('');
}


/* ═══════════════════════════════════════════════
   GRAPHICS
════════════════════════════════════════════════ */

function updateSpcGraphic(ctx) {
  const titles = {
    TSTM: 'GENERAL THUNDERSTORMS',
    MRGL: 'MARGINAL RISK',
    SLGT: 'SLIGHT RISK',
    ENH: 'ENHANCED RISK',
    MDT: 'MODERATE RISK',
    HIGH: 'HIGH RISK'
  };

  const descriptions = {
    TSTM:
      'Thunderstorms are possible, but organized severe storms are not expected.',

    MRGL:
      'Isolated severe storms are possible.',

    SLGT:
      'Scattered severe storms are possible.',

    ENH:
      'Numerous severe storms are possible in parts of the risk area.',

    MDT:
      'Widespread severe weather is possible.',

    HIGH:
      'A significant severe weather outbreak is possible.'
  };

  setText(
    'graphicSpcRisk',
    titles[ctx.spc] ||
    'NO ORGANIZED RISK'
  );

  let description =
    descriptions[ctx.spc] ||
    'No categorical severe weather risk is currently loaded for this location.';

  if (
    ctx.tornadoProbability !== null
  ) {
    description +=
      ` SPC tornado probability at this location is approximately ${ctx.tornadoProbability} percent.`;
  }

  setText(
    'graphicSpcDescription',
    description
  );
}

function updateAlertGraphic(alerts) {
  const sorted =
    [...(alerts || [])]
      .sort(
        (a, b) =>
          alertPriorityScore(
            a.properties?.event || ''
          ) -
          alertPriorityScore(
            b.properties?.event || ''
          )
      );

  const alert = sorted[0];

  if (!alert) {
    setText(
      'graphicAlertTitle',
      'NO ACTIVE ALERT'
    );

    setText(
      'graphicAlertArea',
      liveCityState ||
      'Selected location'
    );

    setText(
      'graphicAlertInstruction',
      'No active National Weather Service alert is currently affecting this location.'
    );

    return;
  }

  const props =
    alert.properties || {};

  setText(
    'graphicAlertTitle',
    props.event ||
    'WEATHER ALERT'
  );

  setText(
    'graphicAlertArea',
    (
      props.areaDesc ||
      liveCityState ||
      'Selected location'
    )
      .split(';')[0]
  );

  setText(
    'graphicAlertInstruction',
    getSafetyInstructions(alert)
  );
}

function updateSevereSummary(ctx) {
  const alerts =
    getPriorityAlerts(
      ctx.alerts
    );

  if (!alerts.length) {
    let text =
      'No active severe weather watches or warnings for this location.';

    if (
      ctx.tornadoProbability !== null &&
      ctx.tornadoProbability > 0
    ) {
      text +=
        ` SPC tornado probability is ${ctx.tornadoProbability} percent.`;
    }

    setText(
      'severeAlertSummary',
      text
    );

    return;
  }

  const events =
    alerts
      .slice(0, 3)
      .map(
        alert =>
          alert.properties?.event ||
          'Weather Alert'
      );

  setText(
    'severeAlertSummary',
    `Active: ${events.join(', ')}`
  );
}

function updateGraphicsData(ctx) {
  setText(
    'graphicTemp',
    ctx.tempF !== null
      ? `${ctx.tempF}°`
      : '--'
  );

  setText(
    'graphicFeels',
    ctx.feelsF !== null
      ? `${ctx.feelsF}°F`
      : '--'
  );

  setText(
    'graphicDew',
    ctx.dewF !== null
      ? `${ctx.dewF}°F`
      : '--'
  );

  setText(
    'graphicHumidity',
    ctx.humidity !== null
      ? `${ctx.humidity}%`
      : '--'
  );

  setText(
    'graphicWind',
    `${degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`
  );

  setText(
    'graphicForecastText',
    ctx.forecast?.today ||
    ctx.forecast?.tonight ||
    'Forecast data is currently unavailable.'
  );

  updateSpcGraphic(ctx);
  updateAlertGraphic(ctx.alerts);
  updateSevereSummary(ctx);

  renderForecastTimeline(
    ctx.hourly
  );
}


/* ═══════════════════════════════════════════════
   BACKGROUND
════════════════════════════════════════════════ */

function setBroadcastBg(ctx) {
  if (
    ctx.alerts.some(
      alert =>
        isTornadoLevel(
          alert.properties?.event ||
          ''
        )
    )
  ) {
    if (
      typeof window.setBgMode ===
      'function'
    ) {
      window.setBgMode(
        'tornado'
      );
    }

    return;
  }

  let mode = 'clear';

  if ([95, 96, 99].includes(ctx.wcode)) {
    mode = 'storm';
  } else if (
    [71, 73, 75, 77, 85, 86]
      .includes(ctx.wcode)
  ) {
    mode = 'snow';
  } else if (
    [45, 48].includes(ctx.wcode)
  ) {
    mode = 'fog';
  } else if (
    [
      51, 53, 55,
      61, 63, 65,
      80, 81, 82
    ].includes(ctx.wcode)
  ) {
    mode = 'rain';
  } else if (ctx.wcode === 1) {
    mode = 'partlycloudy';
  } else if (
    [2, 3].includes(ctx.wcode)
  ) {
    mode = 'cloudy';
  }

  if (
    typeof window.setBgMode ===
    'function'
  ) {
    window.setBgMode(mode);
  }
}


/* ═══════════════════════════════════════════════
   CHANGE ENGINE
════════════════════════════════════════════════ */

function makeSnapshot(ctx) {
  return {
    tempF: ctx.tempF,
    windSpd: ctx.windSpd,
    windG: ctx.windG,
    spc: ctx.spc,
    tornadoProbability:
      ctx.tornadoProbability,

    alertMap:
      new Map(
        (ctx.alerts || []).map(
          alert => [
            alert.id,
            alert.properties?.event ||
            'Weather Alert'
          ]
        )
      )
  };
}

function detectWeatherChanges(ctx) {
  if (
    !STORMVECTOR_FEATURES.changeEngine
  ) {
    return [];
  }

  const next = makeSnapshot(ctx);

  if (!previousWeatherSnapshot) {
    previousWeatherSnapshot = next;

    latestChanges = [{
      text:
        'StormVector baseline established. Future updates will be compared with these conditions.',
      important: false
    }];

    renderChanges(latestChanges);

    return latestChanges;
  }

  const previous =
    previousWeatherSnapshot;

  const changes = [];

  if (
    previous.tempF !== null &&
    next.tempF !== null &&
    previous.tempF !== next.tempF
  ) {
    const difference =
      next.tempF -
      previous.tempF;

    changes.push({
      text:
        `Temperature ${difference > 0 ? 'rose' : 'fell'} ${Math.abs(difference)} degrees to ${next.tempF}.`,

      important:
        Math.abs(difference) >= 5
    });
  }

  if (
    Math.abs(
      next.windSpd -
      previous.windSpd
    ) >= 5
  ) {
    changes.push({
      text:
        `Wind changed from ${previous.windSpd} to ${next.windSpd} miles per hour.`,

      important:
        next.windSpd >= 25
    });
  }

  if (
    previous.spc !== next.spc
  ) {
    changes.push({
      text:
        `SPC severe weather category changed from ${previous.spc || 'none'} to ${next.spc || 'none'}.`,

      important: true
    });
  }

  if (
    previous.tornadoProbability !==
    next.tornadoProbability
  ) {
    changes.push({
      text:
        `SPC tornado probability changed from ${previous.tornadoProbability ?? 0} percent to ${next.tornadoProbability ?? 0} percent.`,

      important: true
    });
  }

  next.alertMap.forEach(
    (event, id) => {
      if (
        !previous.alertMap.has(id)
      ) {
        changes.push({
          text:
            `New alert: ${event}.`,
          important: true
        });
      }
    }
  );

  previous.alertMap.forEach(
    (event, id) => {
      if (
        !next.alertMap.has(id)
      ) {
        changes.push({
          text:
            `${event} is no longer active for this location.`,
          important: true
        });
      }
    }
  );

  if (!changes.length) {
    changes.push({
      text:
        'No significant weather changes since the previous update.',
      important: false
    });
  }

  previousWeatherSnapshot = next;
  latestChanges = changes;

  renderChanges(changes);

  return changes;
}

function renderChanges(changes) {
  const fullList =
    document.getElementById(
      'weatherChangesList'
    );

  const graphicList =
    document.getElementById(
      'graphicChangesList'
    );

  setText(
    'weatherChangesTime',
    `Updated ${new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    })}`
  );

  if (fullList) {
    fullList.innerHTML =
      changes.map(
        change => `
          <div class="weather-change-item">
            ${escapeHtml(change.text)}
          </div>
        `
      ).join('');
  }

  if (graphicList) {
    graphicList.innerHTML =
      changes
        .slice(0, 5)
        .map(
          change => `
            <div class="graphic-change-item">
              ${escapeHtml(change.text)}
            </div>
          `
        )
        .join('');
  }
}


/* ═══════════════════════════════════════════════
   DATA FRESHNESS
════════════════════════════════════════════════ */

function updateFreshness(ctx) {
  setText(
    'freshnessForecast',
    ctx.forecast?.today ||
    ctx.forecast?.tonight
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
    radarLastLoaded
      ? 'CURRENT'
      : 'READY'
  );
}


/* ═══════════════════════════════════════════════
   SPEECH
════════════════════════════════════════════════ */

function renderForSpeech(text) {
  let result =
    removeEmojis(text);

  result = result
    .replace(
      /StormVector Live/g,
      'StormVector Lyve'
    )
    .replace(
      /\blive\b/gi,
      'lyve'
    )
    .replace(/\bSPC\b/g, 'S P C')
    .replace(
      /\bNWS\b/g,
      'National Weather Service'
    )
    .replace(
      /\bmph\b/gi,
      'miles per hour'
    )
    .replace(/°F/g, ' degrees')
    .replace(/%/g, ' percent');

  Object.entries(
    STATE_NAMES
  ).forEach(
    ([abbr, full]) => {
      result = result.replace(
        new RegExp(
          `\\b${abbr}\\b`,
          'g'
        ),
        full
      );
    }
  );

  return result;
}

function splitLongSpeech(text) {
  const cleaned =
    removeEmojis(text)
      .replace(/\s+/g, ' ')
      .trim();

  if (cleaned.length <= 170) {
    return [cleaned];
  }

  const sentences =
    cleaned.match(
      /[^.!?]+[.!?]+|[^.!?]+$/g
    ) || [cleaned];

  const chunks = [];
  let current = '';

  for (const sentenceRaw of sentences) {
    const sentence =
      sentenceRaw.trim();

    if (!sentence) continue;

    const candidate =
      current
        ? `${current} ${sentence}`
        : sentence;

    if (
      candidate.length <= 170
    ) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
      }

      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function polishSegments(segments) {
  const output = [];
  const seen = new Set();

  segments
    .map(removeEmojis)
    .filter(Boolean)
    .forEach(text => {
      splitLongSpeech(text)
        .forEach(chunk => {
          const key =
            chunk.toLowerCase();

          if (!seen.has(key)) {
            seen.add(key);
            output.push(chunk);
          }
        });
    });

  return output;
}

function createUtterance(text) {
  const utterance =
    new SpeechSynthesisUtterance(
      renderForSpeech(text)
    );

  if (liveVoice) {
    utterance.voice = liveVoice;
  }

  const isiPhone =
    /iPhone|iPad|iPod/i.test(
      navigator.userAgent
    );

  const isAndroid =
    /Android/i.test(
      navigator.userAgent
    );

  utterance.rate =
    isiPhone
      ? 0.93
      : isAndroid
        ? 0.92
        : 0.96;

  utterance.pitch = 1;
  utterance.volume = 1;

  return utterance;
}

function pickVoice() {
  if (
    !('speechSynthesis' in window)
  ) {
    return;
  }

  const voices =
    speechSynthesis.getVoices();

  liveVoice =
    voices.find(
      voice =>
        /en-US/i.test(voice.lang) &&
        /Daniel|Aaron|David|Alex|Tom/i
          .test(voice.name)
    ) ||
    voices.find(
      voice =>
        /en-US/i.test(voice.lang)
    ) ||
    voices.find(
      voice =>
        /^en/i.test(voice.lang)
    ) ||
    voices[0] ||
    null;
}

if (
  'speechSynthesis' in window
) {
  speechSynthesis.onvoiceschanged =
    pickVoice;

  pickVoice();
}


/* ═══════════════════════════════════════════════
   BROADCAST SCRIPT
════════════════════════════════════════════════ */

function buildUrgentScript(ctx) {
  const alerts =
    getUrgentAlerts(ctx.alerts);

  if (!alerts.length) {
    return [];
  }

  const alert = alerts[0];

  const props =
    alert.properties || {};

  const event =
    props.event ||
    'weather warning';

  const area =
    (
      props.areaDesc ||
      ctx.cityState ||
      'your area'
    )
      .split(';')[0];

  const movement =
    parseMovement(
      props.description || ''
    );

  const segments = [
    `StormVector urgent weather update for ${ctx.cityState || 'your location'}.`,

    `A ${event} is in effect for ${area}.`
  ];

  if (movement) {
    segments.push(
      `The storm is moving ${movement.dir} at ${movement.spd} miles per hour.`
    );
  }

  segments.push(
    getSafetyInstructions(alert)
  );

  if (
    ctx.tornadoProbability !== null &&
    ctx.tornadoProbability > 0
  ) {
    segments.push(
      `The Storm Prediction Center tornado probability for this location is approximately ${ctx.tornadoProbability} percent today.`
    );
  }

  segments.push(
    'This warning remains the priority. I will continue monitoring official National Weather Service information.'
  );

  return polishSegments(segments);
}

function buildNormalScript(ctx) {
  const segments = [];

  const priority =
    getPriorityAlerts(ctx.alerts);

  if (priority.length) {
    const alert =
      priority[0];

    const event =
      alert.properties?.event ||
      'weather alert';

    segments.push(
      `A ${event} is currently in effect for this area.`
    );
  }

  if (ctx.tempF !== null) {
    let current =
      `Right now in ${ctx.cityState || 'your area'}, it is ${ctx.tempF} degrees`;

    if (
      ctx.feelsF !== null &&
      Math.abs(
        ctx.feelsF -
        ctx.tempF
      ) >= 3
    ) {
      current +=
        `, and it feels like ${ctx.feelsF}`;
    }

    current += '.';

    segments.push(current);
  }

  const condition =
    skyDescription(ctx.wcode);

  if (condition) {
    segments.push(
      `Current conditions include ${condition}.`
    );
  }

  if (
    ctx.windSpd >= 7 ||
    ctx.windG >= 12
  ) {
    let wind =
      `Wind is ${degToCompass(ctx.windDeg) || 'variable'} at about ${ctx.windSpd} miles per hour`;

    if (
      ctx.windG >
      ctx.windSpd + 5
    ) {
      wind +=
        `, with gusts around ${ctx.windG}`;
    }

    wind += '.';

    segments.push(wind);
  }

  if (ctx.spc) {
    const labels = {
      TSTM:
        'general thunderstorms',
      MRGL:
        'a marginal severe weather risk',
      SLGT:
        'a slight severe weather risk',
      ENH:
        'an enhanced severe weather risk',
      MDT:
        'a moderate severe weather risk',
      HIGH:
        'a high severe weather risk'
    };

    segments.push(
      `The Storm Prediction Center has this location under ${labels[ctx.spc] || ctx.spc}.`
    );
  }

  if (
    ctx.tornadoProbability !== null &&
    ctx.tornadoProbability > 0
  ) {
    segments.push(
      `The SPC tornado probability for this location is approximately ${ctx.tornadoProbability} percent today.`
    );
  }

  if (ctx.forecast?.today) {
    segments.push(
      `Looking ahead, ${ctx.forecast.today}`
    );
  }

  segments.push(
    'That is the latest StormVector update. I will keep watching for changes.'
  );

  return polishSegments(segments);
}

function buildScript(ctx) {
  liveSegments =
    severeOnlyMode(ctx)
      ? buildUrgentScript(ctx)
      : buildNormalScript(ctx);

  liveSegIdx = 0;
}


/* ═══════════════════════════════════════════════
   PREPARE BROADCAST
════════════════════════════════════════════════ */

async function prepareBroadcast(
  options = {}
) {
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

  setText(
    'vectorGraphicStatus',
    'UPDATING'
  );

  const [
    nws,
    fallback,
    alerts,
    spc
  ] = await Promise.all([
    fetchNwsContext(
      liveLat,
      liveLon
    ),

    fetchOpenMeteo(
      liveLat,
      liveLon
    ).catch(
      () => ({})
    ),

    fetchAlerts(
      liveLat,
      liveLon
    ),

    fetchSpcProducts(
      liveLat,
      liveLon
    ).catch(
      () => ({
        category: null,
        tornadoProbability: null
      })
    )
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
      locationResultDisplay(
        selectedSearchLocation
      );
  } else {
    liveCityState =
      nws.cityState;
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
    cityState:
      liveCityState,

    tempF:
      observation?.tempF ??
      fallback.tempF ??
      null,

    feelsF:
      fallback.feelsF ??
      observation?.tempF ??
      null,

    humidity:
      observation?.humidity ??
      fallback.humidity ??
      null,

    dewF:
      observation?.dewF ??
      fallback.dewF ??
      null,

    wcode:
      fallback.wcode ?? null,

    windSpd:
      observation?.windSpd ??
      fallback.windSpd ??
      0,

    windDeg:
      observation?.windDeg ??
      fallback.windDeg ??
      0,

    windG:
      observation?.windG ??
      fallback.windG ??
      0,

    sunrise:
      fallback.sunrise ?? null,

    sunset:
      fallback.sunset ?? null,

    hourly:
      fallback.hourly || {},

    alerts:
      alerts || [],

    forecast:
      nws.forecast || {
        today: null,
        tonight: null,
        tomorrow: null
      },

    spc:
      spc.category || null,

    tornadoProbability:
      spc.tornadoProbability ?? null,

    observation:
      observation || null
  };

  currentWeatherContext = ctx;

  if (
    broadcastLoopCount === 0
  ) {
    getPriorityAlerts(ctx.alerts)
      .forEach(
        alert =>
          knownPriorityAlertIds.add(
            alert.id
          )
      );
  }

  renderConditionsRow(ctx);

  renderObservationInfo(
    observation
  );

  setBroadcastBg(ctx);

  updateWatchLiveWeatherTheme(
    ctx
  );

  updateGraphicsData(ctx);

  detectWeatherChanges(ctx);

  updateFreshness(ctx);

  buildScript(ctx);

  updateRadarForLocation();

  setText(
    'vectorGraphicStatus',
    severeOnlyMode(ctx)
      ? 'SEVERE WEATHER'
      : 'CURRENT'
  );

  if (
    options.movingUpdate &&
    severeOnlyMode(ctx) &&
    !breakingWeatherActive
  ) {
    const urgent =
      getUrgentAlerts(ctx.alerts)[0];

    if (
      urgent &&
      !knownPriorityAlertIds.has(
        urgent.id
      )
    ) {
      knownPriorityAlertIds.add(
        urgent.id
      );

      interruptForBreakingWeather(
        urgent
      );
    }
  }

  return ctx;
}


/* ═══════════════════════════════════════════════
   MUSIC
════════════════════════════════════════════════ */

function ensureLiveMusicElement() {
  if (liveMusic) {
    return liveMusic;
  }

  liveMusic =
    document.getElementById(
      'liveMusic'
    );

  if (!liveMusic) {
    liveMusic =
      document.createElement(
        'audio'
      );

    liveMusic.id =
      'liveMusic';

    liveMusic.src =
      './stormvector-theme.mp3';

    document.body.appendChild(
      liveMusic
    );
  }

  liveMusic.loop = true;
  liveMusic.preload = 'auto';

  liveMusic.setAttribute(
    'playsinline',
    ''
  );

  return liveMusic;
}

function setMusicVolume(
  target,
  duration = 350
) {
  const music =
    ensureLiveMusicElement();

  target =
    clamp(target, 0, 1);

  if (musicFadeFrame) {
    cancelAnimationFrame(
      musicFadeFrame
    );
  }

  const startingVolume =
    Number.isFinite(
      music.volume
    )
      ? music.volume
      : 0;

  const startingTime =
    performance.now();

  function frame(now) {
    const progress =
      duration <= 0
        ? 1
        : clamp(
            (
              now -
              startingTime
            ) / duration,
            0,
            1
          );

    const eased =
      1 -
      Math.pow(
        1 - progress,
        3
      );

    music.volume =
      startingVolume +
      (
        target -
        startingVolume
      ) *
      eased;

    if (progress < 1) {
      musicFadeFrame =
        requestAnimationFrame(
          frame
        );
    } else {
      musicFadeFrame = null;
    }
  }

  musicFadeFrame =
    requestAnimationFrame(frame);
}

async function bringMusicUp() {
  const music =
    ensureLiveMusicElement();

  try {
    if (music.paused) {
      await music.play();
    }

    setMusicVolume(
      0.17,
      900
    );
  } catch (_) {}
}

function duckMusic() {
  if (
    !liveMusic ||
    liveMusic.paused
  ) {
    return;
  }

  setMusicVolume(
    0.045,
    260
  );
}

function sentenceBreakMusic() {
  if (
    !liveMusic ||
    liveMusic.paused
  ) {
    return;
  }

  setMusicVolume(
    0.085,
    220
  );
}

function restoreMusic() {
  if (
    !liveMusic ||
    liveMusic.paused
  ) {
    return;
  }

  setMusicVolume(
    0.17,
    650
  );
}

function stopMusic(reset = false) {
  if (!liveMusic) return;

  setMusicVolume(0, 300);

  setTimeout(
    () => {
      if (!liveMusic) return;

      liveMusic.pause();

      if (reset) {
        liveMusic.currentTime = 0;
      }
    },
    340
  );
}


/* ═══════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════════ */

function addBroadcastHistory(text) {
  if (
    !STORMVECTOR_FEATURES.broadcastHistory
  ) {
    return;
  }

  const cleaned =
    removeEmojis(text);

  if (!cleaned) return;

  if (
    broadcastHistory[0]?.text ===
    cleaned
  ) {
    return;
  }

  broadcastHistory.unshift({
    text: cleaned,
    time: new Date()
  });

  if (
    broadcastHistory.length >
    MAX_HISTORY_ITEMS
  ) {
    broadcastHistory.length =
      MAX_HISTORY_ITEMS;
  }

  renderBroadcastHistory();
}

function renderBroadcastHistory() {
  const container =
    document.getElementById(
      'broadcastHistoryList'
    );

  if (!container) return;

  if (!broadcastHistory.length) {
    container.textContent =
      'No broadcast history yet.';

    return;
  }

  container.innerHTML =
    broadcastHistory.map(
      item => `
        <div class="broadcast-history-item">
          <span class="broadcast-history-time">
            ${escapeHtml(
              item.time
                .toLocaleTimeString(
                  [],
                  {
                    hour: 'numeric',
                    minute: '2-digit'
                  }
                )
            )}
          </span>

          ${escapeHtml(item.text)}
        </div>
      `
    ).join('');
}

function bindBroadcastHistory() {
  const toggle =
    document.getElementById(
      'broadcastHistoryToggle'
    );

  const body =
    document.getElementById(
      'broadcastHistoryBody'
    );

  const chevron =
    document.getElementById(
      'broadcastHistoryChevron'
    );

  toggle?.addEventListener(
    'click',
    () => {
      if (!body) return;

      const opening =
        body.hidden;

      body.hidden = !opening;

      if (chevron) {
        chevron.textContent =
          opening ? '−' : '+';
      }
    }
  );
}


/* ═══════════════════════════════════════════════
   START MEDIA / START BROADCAST
════════════════════════════════════════════════ */

function startMediaFromUserGesture() {
  const music =
    ensureLiveMusicElement();

  try {
    music.volume = 0.025;

    music.play().catch(() => {});
  } catch (_) {}

  startupSpeechPromise =
    new Promise(resolve => {
      if (
        !('speechSynthesis' in window)
      ) {
        resolve();
        return;
      }

      const text =
        'Vector here. Give me a second while I pull up your local weather.';

      const utterance =
        createUtterance(text);

      utterance.onstart = () => {
        setLiveBadge('CONNECTING');
        setRobotSpeaking(true);
        setCaption(text);
        setCaptionTopic(
          'CONNECTING'
        );

        addBroadcastHistory(text);

        duckMusic();
      };

      utterance.onend = () => {
        setRobotSpeaking(false);
        sentenceBreakMusic();
        resolve();
      };

      utterance.onerror = () => {
        setRobotSpeaking(false);
        resolve();
      };

      speechSynthesis.speak(
        utterance
      );
    });
}

async function startBroadcast() {
  if (startupRunning) return;

  startupRunning = true;

  const button =
    document.getElementById(
      'liveStartBtn'
    );

  startMediaFromUserGesture();

  if (button) {
    button.disabled = true;
    button.textContent =
      'GETTING LOCATION...';
  }

  try {
    if (!locationReady) {
      setLocationText(
        'Waiting for location permission...'
      );

      await requestCurrentLocation();
    }

    setLocationText(
      'Loading local weather...'
    );

    if (button) {
      button.textContent =
        'LOADING WEATHER...';
    }

    await prepareBroadcast();

    liveStarted = true;
    liveMuted = false;

    document.body.classList.add(
      'broadcast-active'
    );

    hideStartOverlay();

    await bringMusicUp();

    requestWakeLock();

    startSevereWatch();
    startSpeechKeepAlive();

    if (
      locationMode === 'device'
    ) {
      startLocationTracking();
    }

    ensureRadar();

    if (startupSpeechPromise) {
      await Promise.race([
        startupSpeechPromise,
        wait(6000)
      ]);
    }

    setRobotSpeaking(false);
    setLiveBadge('LIVE');

    await wait(250);

    speakSegment(0);

  } catch (error) {
    console.error(
      'StormVector startup failed:',
      error
    );

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

      button.textContent =
        'ENABLE LOCATION & GO LIVE';
    }

  } finally {
    startupRunning = false;
  }
}


/* ═══════════════════════════════════════════════
   SPEAK BROADCAST
════════════════════════════════════════════════ */

function speakSegment(index) {
  if (
    breakingWeatherActive ||
    liveMuted
  ) {
    return;
  }

  if (!liveSegments.length) {
    return;
  }

  if (
    !('speechSynthesis' in window)
  ) {
    if (liveSegments[index]) {
      setCaption(
        liveSegments[index]
      );
    }

    return;
  }

  if (
    index >= liveSegments.length
  ) {
    finishBroadcastLoop();
    return;
  }

  liveSegIdx = index;

  const text =
    liveSegments[index];

  const generation =
    speechGeneration;

  const utterance =
    createUtterance(text);

  if (
    currentWeatherContext &&
    severeOnlyMode(
      currentWeatherContext
    )
  ) {
    utterance.rate = 0.9;
  }

  utterance.onstart = () => {
    if (
      generation !==
      speechGeneration
    ) {
      return;
    }

    duckMusic();

    setLiveBadge(
      severeOnlyMode(
        currentWeatherContext
      )
        ? 'SEVERE WEATHER'
        : 'LIVE'
    );

    setRobotSpeaking(true);
    setCaption(text);

    setCaptionTopic(
      severeOnlyMode(
        currentWeatherContext
      )
        ? 'URGENT WEATHER'
        : 'CURRENT CONDITIONS'
    );

    addBroadcastHistory(text);
  };

  utterance.onend = () => {
    if (
      generation !==
      speechGeneration
    ) {
      return;
    }

    setRobotSpeaking(false);

    if (
      liveMuted ||
      breakingWeatherActive
    ) {
      return;
    }

    sentenceBreakMusic();

    setTimeout(
      () => {
        if (
          generation ===
          speechGeneration &&
          !liveMuted &&
          !breakingWeatherActive
        ) {
          speakSegment(index + 1);
        }
      },
      severeOnlyMode(
        currentWeatherContext
      )
        ? 250
        : 450
    );
  };

  utterance.onerror = () => {
    setRobotSpeaking(false);

    setTimeout(
      () => {
        if (
          !liveMuted &&
          !breakingWeatherActive
        ) {
          speakSegment(index + 1);
        }
      },
      400
    );
  };

  speechSynthesis.speak(
    utterance
  );
}

function speakStandalone(text) {
  return new Promise(resolve => {
    if (
      !('speechSynthesis' in window)
    ) {
      setCaption(text);
      resolve();
      return;
    }

    const utterance =
      createUtterance(text);

    utterance.onstart = () => {
      duckMusic();

      setRobotSpeaking(true);
      setCaption(text);

      addBroadcastHistory(text);
    };

    utterance.onend = () => {
      setRobotSpeaking(false);
      sentenceBreakMusic();
      resolve();
    };

    utterance.onerror = () => {
      setRobotSpeaking(false);
      resolve();
    };

    speechSynthesis.speak(
      utterance
    );
  });
}

async function finishBroadcastLoop() {
  setRobotSpeaking(false);

  setLiveBadge(
    severeOnlyMode(
      currentWeatherContext
    )
      ? 'MONITORING WARNING'
      : 'CHECKING WEATHER'
  );

  restoreMusic();

  await wait(
    severeOnlyMode(
      currentWeatherContext
    )
      ? 2500
      : 5500
  );

  if (
    liveMuted ||
    breakingWeatherActive
  ) {
    return;
  }

  broadcastLoopCount++;

  try {
    await prepareBroadcast();
  } catch (error) {
    console.warn(
      'StormVector refresh failed:',
      error
    );

    await wait(3000);
  }

  if (
    liveMuted ||
    breakingWeatherActive
  ) {
    return;
  }

  await wait(500);

  speakSegment(0);
}

function replaySegment() {
  if (
    !liveSegments.length ||
    liveMuted
  ) {
    return;
  }

  speechGeneration++;

  speechSynthesis.cancel();

  setRobotSpeaking(false);

  setTimeout(
    () =>
      speakSegment(liveSegIdx),
    150
  );
}

async function toggleMute() {
  const button =
    document.getElementById(
      'liveMuteBtn'
    );

  liveMuted = !liveMuted;

  speechGeneration++;

  if (liveMuted) {
    speechSynthesis.cancel();

    setRobotSpeaking(false);

    stopMusic(false);

    stopSevereWatch();
    stopSpeechKeepAlive();
    stopLocationTracking();

    releaseWakeLock();

    setLiveBadge('MUTED');

    if (button) {
      button.textContent =
        'RESUME';
    }

    return;
  }

  if (button) {
    button.textContent = 'STOP';
  }

  await bringMusicUp();

  requestWakeLock();

  startSevereWatch();
  startSpeechKeepAlive();

  if (
    locationMode === 'device'
  ) {
    startLocationTracking();
  }

  await wait(150);

  speakSegment(liveSegIdx);
}


/* ═══════════════════════════════════════════════
   RADAR
════════════════════════════════════════════════ */

function setRadarStatus(text) {
  setText(
    'radarStatus',
    text
  );
}

function warningPolygonStyle(feature) {
  const event =
    String(
      feature.properties?.event ||
      ''
    ).toLowerCase();

  if (
    event.includes('tornado')
  ) {
    return {
      color: '#ff2020',
      weight: 4,
      fillColor: '#ff2020',
      fillOpacity: 0.08
    };
  }

  if (
    event.includes(
      'severe thunderstorm'
    )
  ) {
    return {
      color: '#ffb000',
      weight: 3,
      fillColor: '#ffb000',
      fillOpacity: 0.07
    };
  }

  if (
    event.includes('flash flood')
  ) {
    return {
      color: '#29d65b',
      weight: 3,
      fillColor: '#29d65b',
      fillOpacity: 0.06
    };
  }

  return {
    color: '#ff6633',
    weight: 2,
    fillOpacity: 0.04
  };
}

function ensureRadar() {
  if (
    !STORMVECTOR_FEATURES.radar
  ) {
    return;
  }

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
    document.getElementById(
      'stormVectorRadar'
    );

  if (!target) return;

  radarMap =
    L.map(
      target,
      {
        zoomControl: true,
        attributionControl: true
      }
    )
      .setView(
        [
          liveLat || 39,
          liveLon || -98
        ],
        liveLat !== null
          ? 8
          : 4
      );

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 19,
      subdomains: 'abcd',

      attribution:
        '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  ).addTo(radarMap);

  radarLayer =
    L.tileLayer.wms(
      'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows',
      {
        layers:
          'conus_bref_qcd',

        format:
          'image/png',

        transparent: true,
        version: '1.1.1',
        tiled: true,
        opacity: 0.78,

        attribution:
          'NOAA/NWS MRMS'
      }
    );

  radarLayer.addTo(radarMap);

  radarLayer.on(
    'loading',
    () => {
      setRadarStatus(
        'Loading NOAA MRMS radar...'
      );

      setText(
        'freshnessRadar',
        'LOADING'
      );
    }
  );

  radarLayer.on(
    'load',
    () => {
      radarLastLoaded =
        new Date();

      setRadarStatus(
        'NOAA MRMS radar current'
      );

      setText(
        'radarTimestamp',
        `Loaded ${radarLastLoaded.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        })}`
      );

      setText(
        'freshnessRadar',
        'CURRENT'
      );
    }
  );

  radarWarningLayer =
    L.geoJSON(
      null,
      {
        style:
          warningPolygonStyle,

        onEachFeature:
          (feature, layer) => {
            const props =
              feature.properties || {};

            layer.bindPopup(
              `<strong>${escapeHtml(props.event || 'Weather Alert')}</strong><br>${escapeHtml(props.areaDesc || '')}`
            );
          }
      }
    ).addTo(radarMap);

  updateRadarForLocation();

  setTimeout(
    () =>
      radarMap?.invalidateSize(),
    200
  );
}

function createRadarMarker() {
  if (
    !radarMap ||
    liveLat === null ||
    liveLon === null
  ) {
    return;
  }

  const latLng = [
    liveLat,
    liveLon
  ];

  if (radarMarker) {
    radarMarker.setLatLng(latLng);
    return;
  }

  const icon =
    L.divIcon({
      className: '',
      html:
        '<div class="sv-radar-location-marker"></div>',

      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

  radarMarker =
    L.marker(
      latLng,
      { icon }
    ).addTo(radarMap);
}

function radarZoomLevel() {
  if (
    radarZoomMode === 'regional'
  ) {
    return 5;
  }

  if (
    radarZoomMode === 'state'
  ) {
    return 7;
  }

  return 9;
}

function setRadarZoomMode(mode) {
  radarZoomMode = mode;

  [
    ['local', 'radarLocalBtn'],
    ['state', 'radarStateBtn'],
    ['regional', 'radarRegionalBtn']
  ].forEach(
    ([name, id]) => {
      document
        .getElementById(id)
        ?.classList
        .toggle(
          'active',
          mode === name
        );
    }
  );

  if (
    radarMap &&
    liveLat !== null &&
    liveLon !== null
  ) {
    radarMap.setView(
      [liveLat, liveLon],
      radarZoomLevel()
    );
  }
}

function updateRadarForLocation() {
  if (
    !radarMap ||
    liveLat === null ||
    liveLon === null
  ) {
    return;
  }

  createRadarMarker();

  radarMarker?.bindTooltip(
    liveCityState ||
    'StormVector location',
    {
      direction: 'top'
    }
  );

  radarMap.setView(
    [liveLat, liveLon],
    radarZoomLevel()
  );

  updateRadarWarnings();

  setTimeout(
    () =>
      radarMap?.invalidateSize(),
    120
  );
}

function updateRadarWarnings() {
  if (!radarWarningLayer) {
    return;
  }

  radarWarningLayer.clearLayers();

  if (
    !radarWarningsVisible ||
    !STORMVECTOR_FEATURES
      .warningPolygons ||
    !currentWeatherContext
  ) {
    return;
  }

  currentWeatherContext.alerts
    .filter(
      alert =>
        alert.geometry &&
        /Warning|Emergency/i.test(
          alert.properties?.event ||
          ''
        )
    )
    .forEach(
      alert =>
        radarWarningLayer.addData(
          alert
        )
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

  radarLayer.setParams(
    {
      _stormvector:
        Date.now()
    },
    false
  );

  radarLayer.redraw();
}

function bindRadarControls() {
  document
    .getElementById(
      'radarLocalBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        setRadarZoomMode('local')
    );

  document
    .getElementById(
      'radarStateBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        setRadarZoomMode('state')
    );

  document
    .getElementById(
      'radarRegionalBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        setRadarZoomMode(
          'regional'
        )
    );

  document
    .getElementById(
      'radarCenterBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        if (
          radarMap &&
          liveLat !== null &&
          liveLon !== null
        ) {
          radarMap.setView(
            [liveLat, liveLon],
            radarZoomLevel()
          );
        }
      }
    );

  const warningsButton =
    document.getElementById(
      'radarWarningsBtn'
    );

  warningsButton
    ?.addEventListener(
      'click',
      () => {
        radarWarningsVisible =
          !radarWarningsVisible;

        warningsButton.classList.toggle(
          'active',
          radarWarningsVisible
        );

        warningsButton.textContent =
          radarWarningsVisible
            ? 'WARNINGS ON'
            : 'WARNINGS OFF';

        updateRadarWarnings();
      }
    );

  document
    .getElementById(
      'radarRefreshBtn'
    )
    ?.addEventListener(
      'click',
      refreshRadar
    );
}


/* ═══════════════════════════════════════════════
   ASK VECTOR
════════════════════════════════════════════════ */

function answerVectorQuestion(
  question
) {
  const ctx =
    currentWeatherContext;

  if (!ctx) {
    return 'I need a weather location loaded before I can answer that.';
  }

  const q =
    String(
      question || ''
    ).toLowerCase();

  const location =
    ctx.cityState ||
    'this location';

  if (
    /tornado|severe|risk|spc/
      .test(q)
  ) {
    lastAskTopic = 'severe';

    const priority =
      getPriorityAlerts(
        ctx.alerts
      );

    let answer = priority.length
      ? `For ${location}, the highest-priority active alert is a ${priority[0].properties?.event || 'weather alert'}.`
      : `There are no active National Weather Service watches or warnings for ${location}.`;

    if (ctx.spc) {
      answer +=
        ` The SPC categorical risk is ${ctx.spc}.`;
    }

    if (
      ctx.tornadoProbability !== null
    ) {
      answer +=
        ` The SPC tornado probability is approximately ${ctx.tornadoProbability} percent.`;
    }

    return answer;
  }

  if (
    /radar/.test(q)
  ) {
    selectView(
      'radar',
      {
        manual: true
      }
    );

    return `I opened the NOAA MRMS radar for ${location}. Warning polygons are displayed when official warning geometry is available.`;
  }

  if (
    /wind|gust/.test(q)
  ) {
    return `For ${location}, wind is ${degToCompass(ctx.windDeg) || 'variable'} at about ${ctx.windSpd} miles per hour${ctx.windG > ctx.windSpd + 5 ? ` with gusts around ${ctx.windG}` : ''}.`;
  }

  if (
    /temperature|temp|hot|cold|feels/
      .test(q)
  ) {
    return `For ${location}, the temperature is ${ctx.tempF} degrees${ctx.feelsF !== null ? ` and it feels like ${ctx.feelsF}` : ''}.`;
  }

  if (
    /tonight/.test(q)
  ) {
    return ctx.forecast?.tonight
      ? `For ${location} tonight, ${ctx.forecast.tonight}`
      : `I do not currently have tonight's detailed forecast loaded for ${location}.`;
  }

  if (
    /tomorrow/.test(q)
  ) {
    return ctx.forecast?.tomorrow
      ? `For ${location} tomorrow, ${ctx.forecast.tomorrow}`
      : `I do not currently have tomorrow's detailed forecast loaded for ${location}.`;
  }

  if (
    /changed|change|new/
      .test(q)
  ) {
    return latestChanges
      .map(
        change => change.text
      )
      .join(' ');
  }

  return `For ${location}, it is currently ${ctx.tempF} degrees. ${ctx.forecast?.today || ''}`;
}

async function askVector(question) {
  if (
    !STORMVECTOR_FEATURES.askVector
  ) {
    return;
  }

  const trimmed =
    String(question || '').trim();

  if (!trimmed) return;

  const answer =
    answerVectorQuestion(trimmed);

  setText(
    'askVectorAnswer',
    answer
  );

  if (!liveStarted) {
    return;
  }

  speechGeneration++;

  speechSynthesis.cancel();

  setRobotSpeaking(false);

  await wait(120);

  await speakStandalone(answer);

  if (
    !liveMuted &&
    !breakingWeatherActive
  ) {
    await wait(500);

    speakSegment(
      Math.min(
        liveSegIdx + 1,
        liveSegments.length
      )
    );
  }
}

function bindAskVector() {
  const form =
    document.getElementById(
      'askVectorForm'
    );

  const input =
    document.getElementById(
      'askVectorInput'
    );

  form?.addEventListener(
    'submit',
    event => {
      event.preventDefault();

      if (!input) return;

      const question =
        input.value.trim();

      if (!question) return;

      askVector(question);

      input.value = '';
    }
  );

  document
    .querySelectorAll(
      '.ask-vector-quick'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          askVector(
            button.dataset.question ||
            button.textContent
          );
        }
      );
    });
}


/* ═══════════════════════════════════════════════
   SEVERE WATCH
════════════════════════════════════════════════ */

function startSevereWatch() {
  stopSevereWatch();

  severeWatchTimer =
    setInterval(
      checkForBreakingWeather,
      ALERT_CHECK_INTERVAL
    );
}

function stopSevereWatch() {
  if (severeWatchTimer) {
    clearInterval(
      severeWatchTimer
    );
  }

  severeWatchTimer = null;
}

async function checkForBreakingWeather() {
  if (
    liveMuted ||
    breakingWeatherActive ||
    !locationReady
  ) {
    return;
  }

  try {
    const alerts =
      await fetchAlerts(
        liveLat,
        liveLon
      );

    const priority =
      getPriorityAlerts(alerts);

    const newAlerts =
      priority.filter(
        alert =>
          !knownPriorityAlertIds.has(
            alert.id
          )
      );

    priority.forEach(
      alert =>
        knownPriorityAlertIds.add(
          alert.id
        )
    );

    if (
      currentWeatherContext
    ) {
      currentWeatherContext.alerts =
        alerts;

      updateWatchLiveWeatherTheme(
        currentWeatherContext
      );

      updateAlertGraphic(alerts);

      updateRadarWarnings();
    }

    if (newAlerts.length) {
      await interruptForBreakingWeather(
        newAlerts[0]
      );
    }

  } catch (error) {
    console.warn(
      'StormVector severe watch failed:',
      error
    );
  }
}


/* ═══════════════════════════════════════════════
   SEVERE TAKEOVER
════════════════════════════════════════════════ */

function showSevereTakeover(alert) {
  if (
    !STORMVECTOR_FEATURES
      .severeTakeover
  ) {
    return;
  }

  if (!severeTakeoverActive) {
    viewBeforeSevere =
      selectedView;
  }

  severeTakeoverActive = true;

  const takeover =
    document.getElementById(
      'severeTakeover'
    );

  const props =
    alert.properties || {};

  setText(
    'severeTakeoverTitle',
    props.event ||
    'WEATHER WARNING'
  );

  setText(
    'severeTakeoverArea',
    (
      props.areaDesc ||
      liveCityState ||
      'Selected location'
    ).split(';')[0]
  );

  if (takeover) {
    takeover.hidden = false;
  }

  document.body.classList.add(
    'severe-mode'
  );

  selectView(
    'radar',
    {
      manual: false
    }
  );

  updateAlertGraphic([alert]);
}

function hideSevereTakeover(
  restoreView = true
) {
  document
    .getElementById(
      'severeTakeover'
    )
    ?.setAttribute(
      'hidden',
      ''
    );

  document.body.classList.remove(
    'severe-mode'
  );

  severeTakeoverActive = false;

  if (restoreView) {
    selectView(
      viewBeforeSevere,
      {
        manual: false
      }
    );
  }
}

async function playAttentionTone() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    const context =
      new AudioContextClass();

    if (
      context.state === 'suspended'
    ) {
      await context.resume();
    }

    const gain =
      context.createGain();

    gain.gain.value = 0.16;

    gain.connect(
      context.destination
    );

    [853, 960].forEach(
      frequency => {
        const oscillator =
          context.createOscillator();

        oscillator.type = 'sine';

        oscillator.frequency.value =
          frequency;

        oscillator.connect(gain);

        oscillator.start();

        oscillator.stop(
          context.currentTime + 2
        );
      }
    );

    await wait(2100);

    await context
      .close()
      .catch(() => {});

  } catch (_) {}
}

async function interruptForBreakingWeather(
  alert
) {
  breakingWeatherActive = true;

  speechGeneration++;

  try {
    speechSynthesis.cancel();
  } catch (_) {}

  setRobotSpeaking(false);

  setMusicVolume(0.02, 200);

  setLiveBadge('BREAKING');

  const banner =
    document.getElementById(
      'liveBreakingBanner'
    );

  if (banner) {
    banner.hidden = false;
  }

  showSevereTakeover(alert);

  ensureRadar();
  updateRadarWarnings();

  await playAttentionTone();

  const props =
    alert.properties || {};

  const event =
    props.event ||
    'weather alert';

  const area =
    (
      props.areaDesc ||
      liveCityState ||
      'your area'
    ).split(';')[0];

  const movement =
    parseMovement(
      props.description || ''
    );

  const messages = [
    'This is a StormVector breaking weather update.',

    `A ${event} has been issued for ${area}.`,

    movement
      ? `The storm is moving ${movement.dir} at ${movement.spd} miles per hour.`
      : '',

    getSafetyInstructions(alert)
  ].filter(Boolean);

  await speakSequential(messages);

  try {
    await prepareBroadcast();
  } catch (_) {}

  if (banner) {
    banner.hidden = true;
  }

  hideSevereTakeover(true);

  breakingWeatherActive = false;

  restoreMusic();

  if (!liveMuted) {
    await wait(400);

    speakSegment(0);
  }
}

function speakSequential(messages) {
  return new Promise(resolve => {
    let index = 0;

    function next() {
      if (
        index >= messages.length
      ) {
        setRobotSpeaking(false);
        resolve();
        return;
      }

      const text =
        messages[index];

      const utterance =
        createUtterance(text);

      utterance.rate = 0.9;

      utterance.onstart = () => {
        duckMusic();

        setRobotSpeaking(true);
        setCaption(text);

        setCaptionTopic(
          'BREAKING WEATHER'
        );

        addBroadcastHistory(text);
      };

      utterance.onend = () => {
        setRobotSpeaking(false);

        sentenceBreakMusic();

        index++;

        setTimeout(next, 300);
      };

      utterance.onerror = () => {
        setRobotSpeaking(false);

        index++;

        next();
      };

      speechSynthesis.speak(
        utterance
      );
    }

    next();
  });
}


/* ═══════════════════════════════════════════════
   ANDROID KEEPALIVE
════════════════════════════════════════════════ */

function startSpeechKeepAlive() {
  stopSpeechKeepAlive();

  if (
    !/Android/i.test(
      navigator.userAgent
    )
  ) {
    return;
  }

  speechKeepAlive =
    setInterval(
      () => {
        if (
          speechSynthesis.speaking &&
          !speechSynthesis.paused
        ) {
          speechSynthesis.pause();

          setTimeout(
            () =>
              speechSynthesis.resume(),
            35
          );
        }
      },
      10000
    );
}

function stopSpeechKeepAlive() {
  if (speechKeepAlive) {
    clearInterval(
      speechKeepAlive
    );
  }

  speechKeepAlive = null;
}


/* ═══════════════════════════════════════════════
   WAKE LOCK
════════════════════════════════════════════════ */

async function requestWakeLock() {
  try {
    if (
      'wakeLock' in navigator &&
      document.visibilityState ===
      'visible'
    ) {
      wakeLock =
        await navigator.wakeLock
          .request('screen');
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
   ACCESSIBILITY
════════════════════════════════════════════════ */

function announce(message) {
  const element =
    document.getElementById(
      'ariaLive'
    );

  if (!element) return;

  element.textContent = '';

  requestAnimationFrame(
    () => {
      element.textContent =
        removeEmojis(message);
    }
  );
}


/* ═══════════════════════════════════════════════
   VISIBILITY
════════════════════════════════════════════════ */

document.addEventListener(
  'visibilitychange',
  () => {
    if (
      document.visibilityState !==
      'visible'
    ) {
      return;
    }

    if (
      liveStarted &&
      !liveMuted
    ) {
      requestWakeLock();

      if (
        locationMode === 'device'
      ) {
        startLocationTracking();
      }
    }

    setTimeout(
      () =>
        radarMap?.invalidateSize(),
      200
    );
  }
);


/* ═══════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

document.addEventListener(
  'DOMContentLoaded',
  () => {
    ensureLiveMusicElement();

    pickVoice();

    setLocationText(
      'Location not selected'
    );

    setLocationSource(
      'StormVector Live Weather'
    );

    setCaption(
      'Choose your current location or search for a United States location to begin.'
    );

    setCaptionTopic('STANDBY');

    setLiveBadge('STANDBY');

    setText(
      'vectorGraphicStatus',
      'READY'
    );

    selectView(
      'conditions',
      {
        manual: true
      }
    );

    const startButton =
      document.getElementById(
        'liveStartBtn'
      );

    if (startButton) {
      startButton.disabled = false;

      startButton.textContent =
        'ENABLE LOCATION & GO LIVE';
    }

    bindLocationSearch({
      inputId:
        'liveLocationSearch',

      suggestionsId:
        'liveSearchSuggestions',

      statusId:
        'liveSearchStatus',

      clearId:
        'liveSearchClearBtn'
    });

    bindLocationSearch({
      inputId:
        'livePopupLocationSearch',

      suggestionsId:
        'livePopupSearchSuggestions',

      statusId:
        'livePopupSearchStatus',

      clearId:
        'livePopupSearchClearBtn'
    });

    bindViewSelector();

    bindRadarControls();

    addOfficialWeatherButtons();

    bindAskVector();

    bindBroadcastHistory();

    document
      .getElementById(
        'severeTakeoverClose'
      )
      ?.addEventListener(
        'click',
        () =>
          hideSevereTakeover(true)
      );
  }
);


/* ═══════════════════════════════════════════════
   CLEANUP
════════════════════════════════════════════════ */

window.addEventListener(
  'beforeunload',
  () => {
    speechGeneration++;

    try {
      speechSynthesis.cancel();
    } catch (_) {}

    stopSevereWatch();
    stopSpeechKeepAlive();
    stopLocationTracking();

    releaseWakeLock();

    if (liveMusic) {
      try {
        liveMusic.pause();
      } catch (_) {}
    }

    if (
      locationSearchController
    ) {
      try {
        locationSearchController
          .abort();
      } catch (_) {}
    }

    if (radarMap) {
      try {
        radarMap.remove();
      } catch (_) {}
    }
  }
);