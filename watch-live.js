/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Full rebuilt version.

   Goals:
   • Correctly use the current user's location.
   • Load local current weather reliably.
   • Let Vector speak even if SPC or music fails.
   • Smooth music ducking with stormvector-theme.mp3.
   • Natural rotating broadcasts that do not sound identical.
   • Animated robot speaking state.
   • Severe-weather interruptions.
   • Android/mobile speech reliability.
════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */

let liveLat = null;
let liveLon = null;
let liveCityState = null;

let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;

let liveMuted = false;
let broadcastStarted = false;

let liveMusic = null;
let musicFadeFrame = null;

let broadcastLoopCount = 0;

let locationReady = false;
let locationRequestInProgress = false;

let speechKeepAlive = null;
let wakeLock = null;

let breakingWeatherActive = false;
let severeWatchTimer = null;
let resumeSegIdxAfterBreak = 0;

let nextSegmentTimer = null;
let nextLoopTimer = null;

const spokenFactMemory = new Map();
const knownPriorityAlertIds = new Set();
const phraseHistory = {};

const SPC_RANK = {
  TSTM: 1,
  MRGL: 2,
  SLGT: 3,
  ENH: 4,
  MDT: 5,
  HIGH: 6
};


/* ════════════════════════════════════════════════
   SHARED HELPER FALLBACKS
════════════════════════════════════════════════ */

(function installFallbacks() {

  const set = (name, fn) => {
    if (typeof window[name] !== 'function') {
      window[name] = fn;
    }
  };

  set('setBgMode', () => {});
  set('setDaytime', () => {});

  set('degToCompass', deg => {

    if (
      deg === null ||
      deg === undefined ||
      Number.isNaN(Number(deg))
    ) {
      return '';
    }

    const dirs = [
      'N','NNE','NE','ENE',
      'E','ESE','SE','SSE',
      'S','SSW','SW','WSW',
      'W','WNW','NW','NNW'
    ];

    return dirs[
      Math.round(Number(deg) / 22.5) % 16
    ];

  });

  set('dewLabel', dewF => {

    if (
      dewF === null ||
      dewF === undefined
    ) {
      return '';
    }

    if (dewF < 50) return 'very comfortable';
    if (dewF < 60) return 'comfortable';
    if (dewF < 65) return 'a little sticky';
    if (dewF < 70) return 'muggy';
    if (dewF < 75) return 'oppressive';

    return 'very humid';

  });

  set('alertPriorityScore', event => {

    const e = String(event || '').toLowerCase();

    const table = [
      ['tornado emergency', 0],
      ['tornado warning', 1],
      ['flash flood emergency', 2],
      ['severe thunderstorm warning', 3],
      ['flash flood warning', 4],
      ['tornado watch', 5],
      ['severe thunderstorm watch', 6],
      ['flood warning', 7],
      ['winter storm warning', 8],
      ['ice storm warning', 9],
      ['blizzard warning', 10],
      ['high wind warning', 11],
      ['excessive heat warning', 12],
      ['winter weather advisory', 13],
      ['wind advisory', 14],
      ['heat advisory', 15],
      ['flood advisory', 16],
      ['dense fog advisory', 17]
    ];

    for (const [needle, score] of table) {
      if (e.includes(needle)) {
        return score;
      }
    }

    return 50;

  });

  set(
    'isTornadoLevel',
    event =>
      /tornado warning|tornado emergency/i
        .test(event || '')
  );

  set('parseMovement', desc => {

    const text = String(desc || '');

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

  });

})();


/* ════════════════════════════════════════════════
   MENU
════════════════════════════════════════════════ */

function toggleMenu() {

  const panel =
    document.getElementById('menuPanel');

  const button =
    document.getElementById('menuBtn');

  if (!panel) return;

  const open =
    panel.classList.contains('open');

  panel.classList.toggle(
    'open',
    !open
  );

  button?.setAttribute(
    'aria-expanded',
    String(!open)
  );

}


document.addEventListener(
  'click',
  event => {

    if (
      event.target.closest('#menuPanel') ||
      event.target.closest('#menuBtn')
    ) {
      return;
    }

    const panel =
      document.getElementById('menuPanel');

    const button =
      document.getElementById('menuBtn');

    if (panel?.classList.contains('open')) {

      panel.classList.remove('open');

      button?.setAttribute(
        'aria-expanded',
        'false'
      );

    }

  }
);


/* ════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════ */

async function safeFetch(
  url,
  opts = {}
) {

  const {
    timeout = 10000,
    ...rest
  } = opts;

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {

    const response =
      await fetch(
        url,
        {
          ...rest,
          signal: controller.signal
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} for ${url}`
      );
    }

    return response;

  }

  finally {
    clearTimeout(timer);
  }

}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(max, value)
  );

}


function clearPlaybackTimers() {

  if (nextSegmentTimer) {

    clearTimeout(
      nextSegmentTimer
    );

    nextSegmentTimer = null;

  }

  if (nextLoopTimer) {

    clearTimeout(
      nextLoopTimer
    );

    nextLoopTimer = null;

  }

}


function pickPhrase(
  pool,
  category
) {

  if (!pool?.length) {
    return '';
  }

  if (!phraseHistory[category]) {
    phraseHistory[category] = new Set();
  }

  const used =
    phraseHistory[category];

  let choices =
    pool
      .map((_, index) => index)
      .filter(index =>
        !used.has(index)
      );

  if (!choices.length) {

    used.clear();

    choices =
      pool.map(
        (_, index) => index
      );

  }

  const selected =
    choices[
      Math.floor(
        Math.random() *
        choices.length
      )
    ];

  used.add(selected);

  return pool[selected];

}


function fill(
  template,
  values
) {

  return template.replace(
    /\{(\w+)\}/g,
    (_, key) =>
      values[key] !== undefined
        ? values[key]
        : ''
  );

}


function pickFilled(
  pool,
  category,
  values
) {

  return fill(
    pickPhrase(
      pool,
      category
    ),
    values
  );

}


function renderForSpeech(text) {

  return String(text || '')
    .replace(
      /StormVector Live/g,
      'StormVector Lyve'
    )
    .replace(
      /\blive\b/gi,
      'lyve'
    )
    .replace(
      /\bSPC\b/g,
      'S P C'
    )
    .replace(
      /\bNWS\b/g,
      'National Weather Service'
    )
    .replace(
      /\bmph\b/g,
      'miles per hour'
    );

}


function polishSegments(
  segments
) {

  const seen =
    new Set();

  return segments

    .map(segment =>
      String(segment || '')
        .replace(/\s+/g, ' ')
        .trim()
    )

    .filter(Boolean)

    .filter(segment => {

      const key =
        segment.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;

    });

}


function weatherCodePhrase(wcode) {

  if ([95, 96, 99].includes(wcode)) {
    return 'thunderstorms';
  }

  if ([71, 73, 75, 77, 85, 86].includes(wcode)) {
    return 'snow';
  }

  if ([61, 63, 65, 80, 81, 82].includes(wcode)) {
    return 'rain showers';
  }

  if ([56, 57, 66, 67].includes(wcode)) {
    return 'freezing precipitation';
  }

  if ([51, 53, 55].includes(wcode)) {
    return 'drizzle';
  }

  if ([45, 48].includes(wcode)) {
    return 'fog';
  }

  return null;

}


/* ════════════════════════════════════════════════
   SPEECH PHRASES
════════════════════════════════════════════════ */

const PHRASES = {

  firstOpeners: [

    "You're watching StormVector Live.",

    "StormVector Live is on the air. I'm Vector.",

    "This is StormVector Live. Vector here with your local weather.",

    "Welcome to StormVector Live. I'm Vector, and I've got your local weather ready."

  ],

  returnOpeners: [

    "Back with another check of your weather.",

    "Let's see what's changed since the last update.",

    "Here's another look at your local weather.",

    "Back on StormVector Live with another weather check.",

    "Let's bring the local weather picture back up.",

    "Time for another look at what's happening outside."

  ],

  quiet: [

    "Things are pretty calm locally right now.",

    "The weather is giving us a fairly easy setup at the moment.",

    "Not much weather drama locally right now.",

    "It's a quieter stretch across the area.",

    "Nothing particularly aggressive is showing up locally right now."

  ],

  gloomy: [

    "It's a gray-looking setup outside right now.",

    "Clouds are doing most of the work in the sky at the moment.",

    "A little dreary outside, but here's what matters.",

    "The sky isn't offering much sunshine right now."

  ],

  currentFirst: [

    "Right now we're sitting at {tempF} degrees{feelsClause}.",

    "Current temperature is {tempF} degrees{feelsClause}.",

    "Outside right now, it's around {tempF} degrees{feelsClause}.",

    "We're starting this weather check at {tempF} degrees{feelsClause}."

  ],

  currentSteady: [

    "Temperatures haven't moved much since the last check. We're still near {tempF} degrees{feelsClause}.",

    "Not much change in temperature. We're holding around {tempF}{feelsClause}.",

    "We're still sitting near {tempF} degrees{feelsClause}.",

    "Temperature-wise, things are pretty steady at around {tempF} degrees{feelsClause}."

  ],

  currentWarmer: [

    "We've warmed a bit since the last update. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have climbed {changeText}, putting us at {tempF}{feelsClause}.",

    "It's a little warmer now, up to {tempF} degrees{feelsClause}.",

    "Temperatures are trending upward, now sitting near {tempF} degrees{feelsClause}."

  ],

  currentCooler: [

    "We've cooled off a bit since the last update. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have dropped {changeText}, putting us at {tempF}{feelsClause}.",

    "It's a little cooler now, down to {tempF} degrees{feelsClause}.",

    "Temperatures are easing back, now around {tempF} degrees{feelsClause}."

  ],

  precip: [

    "We're also seeing {precip} in the area.",

    "{precipCap} are part of the local weather picture right now.",

    "There's also some {precip} showing up locally.",

    "{precipCap} are part of the setup as well."

  ],

  wind: [

    "Wind is out of the {windDir} at {windSpd} miles per hour{gustClause}.",

    "We've got a {windDir} wind around {windSpd} miles per hour{gustClause}.",

    "Winds are running from the {windDir} at about {windSpd} miles per hour{gustClause}.",

    "The breeze is coming from the {windDir}, around {windSpd} miles per hour{gustClause}."

  ],

  humidity: [

    "Humidity is around {humidity} percent, with a dew point near {dewF}. That puts the air in the {dewLabel} range.",

    "The dew point is near {dewF}, so the air feels {dewLabel}.",

    "Moisture levels are noticeable. Humidity is around {humidity} percent with a dew point near {dewF}.",

    "The air is sitting in the {dewLabel} range, with a dew point around {dewF}."

  ],

  forecastLead: [

    "Looking ahead,",

    "As we move through the next part of the day,",

    "Here's how the forecast shapes up,",

    "Coming up in the forecast,"

  ],

  tonightLead: [

    "For tonight,",

    "Later tonight,",

    "Heading into tonight,",

    "Once we get into tonight,"

  ],

  closers: [

    "That's where things stand right now. I'll keep watching for changes.",

    "That's your latest StormVector check. I'll update you again as conditions evolve.",

    "That's the weather picture for now. I'll keep the next update moving.",

    "That's the latest. Stay weather-aware and I'll keep watching what changes next.",

    "That's where we'll leave it for this pass. I'll check the weather again shortly."

  ],

  trivia: [

    "A quick weather fact while things are quiet. Lightning can strike the same place more than once.",

    "A quick weather fact. Sun dogs are caused by ice crystals high in the atmosphere.",

    "One weather fact while we have a quiet moment. Hail can fall even when it is warm at ground level.",

    "A little weather trivia while we have time. Thunder can usually only be heard within roughly ten miles of the lightning that caused it."

  ]

};


/* ════════════════════════════════════════════════
   LOCATION
════════════════════════════════════════════════ */

function geolocationErrorMessage(error) {

  if (!error) {
    return 'StormVector could not get your location.';
  }

  switch (error.code) {

    case 1:

      return 'Location permission is turned off. Allow location access for StormVector and try again.';

    case 2:

      return 'Your device could not determine its current location.';

    case 3:

      return 'The location request timed out. Tap Enable Location to try again.';

    default:

      return 'StormVector could not get your location.';

  }

}


function initLocation() {

  return new Promise(
    (resolve, reject) => {

      if (
        !('geolocation' in navigator)
      ) {

        reject(
          new Error(
            'Geolocation is not supported by this browser.'
          )
        );

        return;

      }

      if (locationRequestInProgress) {

        reject(
          new Error(
            'Location request already in progress.'
          )
        );

        return;

      }

      locationRequestInProgress = true;

      navigator.geolocation
        .getCurrentPosition(

          position => {

            liveLat =
              position.coords.latitude;

            liveLon =
              position.coords.longitude;

            locationReady = true;
            locationRequestInProgress = false;

            console.log(
              'StormVector GPS:',
              liveLat,
              liveLon,
              'accuracy:',
              position.coords.accuracy
            );

            resolve(position);

          },

          error => {

            locationReady = false;
            locationRequestInProgress = false;

            console.error(
              'StormVector geolocation failure:',
              error
            );

            reject(
              new Error(
                geolocationErrorMessage(error)
              )
            );

          },

          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 30000
          }

        );

    }
  );

}


async function requestLocationAndPrepare() {

  const card =
    document.getElementById(
      'liveLocationCard'
    );

  const button =
    document.getElementById(
      'liveStartBtn'
    );

  if (locationRequestInProgress) {
    return false;
  }

  if (card) {

    card.innerHTML = `
      <span class="live-location-icon">📍</span>
      <span class="live-location-text">
        Requesting your location…
      </span>
    `;

  }

  if (button) {

    button.disabled = true;
    button.textContent = 'Locating…';

  }

  try {

    await initLocation();

    if (card) {

      card.innerHTML = `
        <span class="live-location-icon">📍</span>
        <span class="live-location-text">
          Location found — loading local weather…
        </span>
      `;

    }

    if (button) {

      button.textContent =
        'Loading Weather…';

    }

    await prepareBroadcast();

    if (!liveSegments.length) {

      liveSegments = [
        "I'm Vector. I found your location, but I'm having trouble loading the full weather report right now. I'll keep checking."
      ];

    }

    if (button) {

      button.disabled = false;
      button.textContent = '▶ Go Live';

    }

    setLiveBadge('READY');

    return true;

  }

  catch (error) {

    console.error(
      'StormVector startup failed:',
      error
    );

    if (card) {

      card.innerHTML = `
        <span class="live-location-icon">📍</span>
        <span class="live-location-text">
          ${error.message || 'Unable to determine location.'}
        </span>
      `;

    }

    if (button) {

      button.disabled = false;
      button.textContent =
        '📍 Enable Location';

    }

    setLiveBadge(
      'LOCATION NEEDED'
    );

    return false;

  }

}


/* ════════════════════════════════════════════════
   NWS ALERTS
════════════════════════════════════════════════ */

async function fetchAlerts(
  lat,
  lon
) {

  try {

    const response =
      await safeFetch(
        `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
        {
          timeout: 10000,
          headers: {
            Accept: 'application/geo+json'
          }
        }
      );

    const data =
      await response.json();

    return data.features || [];

  }

  catch (error) {

    console.warn(
      'StormVector NWS alerts failed:',
      error
    );

    return [];

  }

}


/* ════════════════════════════════════════════════
   NWS LOCATION + FORECAST
════════════════════════════════════════════════ */

async function fetchNwsContext(
  lat,
  lon
) {

  try {

    const response =
      await safeFetch(
        `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
        {
          timeout: 10000,
          headers: {
            Accept: 'application/geo+json'
          }
        }
      );

    const data =
      await response.json();

    const props =
      data.properties || {};

    const location =
      props.relativeLocation?.properties;

    const cityState =
      location?.city &&
      location?.state
        ? `${location.city}, ${location.state}`
        : location?.city ||
          location?.state ||
          null;

    let today = null;
    let tonight = null;

    if (props.forecast) {

      try {

        const forecastResponse =
          await safeFetch(
            props.forecast,
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

        const periods =
          forecastData.properties?.periods || [];

        const now =
          new Date();

        const currentPeriod =
          periods.find(period => {

            const start =
              new Date(period.startTime);

            const end =
              new Date(period.endTime);

            return (
              start <= now &&
              now < end
            );

          }) ||
          periods[0];

        const nextNight =
          periods.find(period =>
            !period.isDaytime &&
            new Date(period.endTime) > now
          );

        today =
          currentPeriod?.detailedForecast ||
          currentPeriod?.shortForecast ||
          null;

        tonight =
          nextNight?.detailedForecast ||
          nextNight?.shortForecast ||
          null;

      }

      catch (error) {

        console.warn(
          'StormVector NWS forecast failed:',
          error
        );

      }

    }

    return {
      cityState,
      forecast: {
        today,
        tonight
      }
    };

  }

  catch (error) {

    console.warn(
      'StormVector NWS point lookup failed:',
      error
    );

    return {
      cityState: null,
      forecast: {
        today: null,
        tonight: null
      }
    };

  }

}


/* ════════════════════════════════════════════════
   OPEN-METEO CURRENT CONDITIONS
════════════════════════════════════════════════ */

async function fetchOpenMeteo(
  lat,
  lon
) {

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&daily=sunrise,sunset` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&timezone=auto`;

  const response =
    await safeFetch(
      url,
      {
        timeout: 10000
      }
    );

  const data =
    await response.json();

  const current =
    data.current || {};

  const daily =
    data.daily || {};

  const formatTime =
    value => {

      if (!value) {
        return null;
      }

      try {

        const date =
          new Date(value);

        return date.toLocaleTimeString(
          [],
          {
            hour: 'numeric',
            minute: '2-digit'
          }
        );

      }

      catch (_) {

        return null;

      }

    };

  return {

    tempF:
      current.temperature_2m !== undefined
        ? Math.round(
            Number(
              current.temperature_2m
            )
          )
        : null,

    feelsF:
      current.apparent_temperature !== undefined
        ? Math.round(
            Number(
              current.apparent_temperature
            )
          )
        : null,

    humidity:
      current.relative_humidity_2m !== undefined
        ? Math.round(
            Number(
              current.relative_humidity_2m
            )
          )
        : null,

    dewF:
      current.dew_point_2m !== undefined
        ? Math.round(
            Number(
              current.dew_point_2m
            )
          )
        : null,

    wcode:
      current.weather_code !== undefined
        ? Number(
            current.weather_code
          )
        : null,

    windSpd:
      current.wind_speed_10m !== undefined
        ? Math.round(
            Number(
              current.wind_speed_10m
            )
          )
        : 0,

    windDeg:
      current.wind_direction_10m !== undefined
        ? Number(
            current.wind_direction_10m
          )
        : 0,

    windG:
      current.wind_gusts_10m !== undefined
        ? Math.round(
            Number(
              current.wind_gusts_10m
            )
          )
        : 0,

    sunrise:
      formatTime(
        daily.sunrise?.[0]
      ),

    sunset:
      formatTime(
        daily.sunset?.[0]
      )

  };

}


/* ════════════════════════════════════════════════
   SPC
════════════════════════════════════════════════ */

function pointInRing(
  point,
  ring
) {

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
      ((yi > point[1]) !==
       (yj > point[1])) &&
      (
        point[0] <
        (
          (xj - xi) *
          (point[1] - yi) /
          (yj - yi)
        ) +
        xi
      );

    if (intersects) {
      inside = !inside;
    }

  }

  return inside;

}


function pointInPolygonCoords(
  point,
  coords
) {

  if (
    !coords ||
    !coords[0] ||
    !pointInRing(
      point,
      coords[0]
    )
  ) {

    return false;

  }

  for (
    let i = 1;
    i < coords.length;
    i++
  ) {

    if (
      pointInRing(
        point,
        coords[i]
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

  if (!geometry) {
    return false;
  }

  if (
    geometry.type ===
    'Polygon'
  ) {

    return pointInPolygonCoords(
      point,
      geometry.coordinates
    );

  }

  if (
    geometry.type ===
    'MultiPolygon'
  ) {

    return geometry.coordinates
      .some(poly =>
        pointInPolygonCoords(
          point,
          poly
        )
      );

  }

  return false;

}


async function fetchSpcOutlook(
  lat,
  lon
) {

  const urls = [
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson'
  ];

  for (const url of urls) {

    try {

      const response =
        await safeFetch(
          url,
          {
            timeout: 6000
          }
        );

      const data =
        await response.json();

      const point = [
        lon,
        lat
      ];

      let best = null;

      for (
        const feature of
        data.features || []
      ) {

        const label =
          String(
            feature.properties?.LABEL ||
            feature.properties?.label ||
            feature.properties?.DN ||
            ''
          )
            .toUpperCase();

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

    catch (error) {

      console.warn(
        'StormVector SPC fetch failed:',
        error
      );

    }

  }

  return null;

}


/* ════════════════════════════════════════════════
   CONDITIONS DISPLAY
════════════════════════════════════════════════ */

function renderConditionsRow(ctx) {

  const row =
    document.getElementById(
      'liveConditionsRow'
    );

  if (!row) return;

  const chip =
    (label, value) => `
      <div class="live-chip">

        <span class="live-chip-label">
          ${label}
        </span>

        <span class="live-chip-val">
          ${value}
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
      `${window.degToCompass(ctx.windDeg)} ${ctx.windSpd} mph`
    ),

    ctx.windG >
    ctx.windSpd + 5
      ? chip(
          'GUSTS',
          `${ctx.windG} mph`
        )
      : ''

  ].join('');

}


function setBroadcastBg(ctx) {

  const tornado =
    ctx.alerts.some(alert =>
      window.isTornadoLevel(
        alert.properties?.event || ''
      )
    );

  if (tornado) {

    window.setBgMode(
      'tornado'
    );

    return;

  }

  if ([95, 96, 99].includes(ctx.wcode)) {

    window.setBgMode(
      'storm'
    );

  }

  else if (
    [71, 73, 75, 77, 85, 86]
      .includes(ctx.wcode)
  ) {

    window.setBgMode(
      'snow'
    );

  }

  else if (
    [45, 48]
      .includes(ctx.wcode)
  ) {

    window.setBgMode(
      'fog'
    );

  }

  else if (
    [
      51, 53, 55,
      61, 63, 65,
      80, 81, 82
    ]
      .includes(ctx.wcode)
  ) {

    window.setBgMode(
      'rain'
    );

  }

  else if (
    ctx.wcode === 1
  ) {

    window.setBgMode(
      'partlycloudy'
    );

  }

  else if (
    [2, 3]
      .includes(ctx.wcode)
  ) {

    window.setBgMode(
      'cloudy'
    );

  }

  else {

    window.setBgMode(
      'clear'
    );

  }

}


/* ════════════════════════════════════════════════
   NATURAL BROADCAST SEGMENTS
════════════════════════════════════════════════ */

function addCurrentConditions(
  segments,
  ctx
) {

  if (
    ctx.tempF === null
  ) {

    segments.push(
      "I'm having a little trouble getting the latest temperature, but I'm still watching the rest of the weather data."
    );

    return;

  }

  const previousTemp =
    spokenFactMemory.get(
      'temp'
    );

  const previousFeels =
    spokenFactMemory.get(
      'feels'
    );

  const feelsClause =
    ctx.feelsF !== null &&
    Math.abs(
      ctx.feelsF -
      ctx.tempF
    ) >= 3 &&
    (
      broadcastLoopCount === 0 ||
      ctx.feelsF !== previousFeels
    )
      ? `, but it feels closer to ${ctx.feelsF}`
      : '';

  if (
    previousTemp === undefined
  ) {

    segments.push(
      pickFilled(
        PHRASES.currentFirst,
        'current-first',
        {
          tempF: ctx.tempF,
          feelsClause
        }
      )
    );

  }

  else if (
    ctx.tempF >
    previousTemp
  ) {

    const difference =
      ctx.tempF -
      previousTemp;

    segments.push(
      pickFilled(
        PHRASES.currentWarmer,
        'current-warmer',
        {
          tempF: ctx.tempF,

          feelsClause,

          changeText:
            difference === 1
              ? 'a degree'
              : `${difference} degrees`
        }
      )
    );

  }

  else if (
    ctx.tempF <
    previousTemp
  ) {

    const difference =
      previousTemp -
      ctx.tempF;

    segments.push(
      pickFilled(
        PHRASES.currentCooler,
        'current-cooler',
        {
          tempF: ctx.tempF,

          feelsClause,

          changeText:
            difference === 1
              ? 'a degree'
              : `${difference} degrees`
        }
      )
    );

  }

  else {

    segments.push(
      pickFilled(
        PHRASES.currentSteady,
        'current-steady',
        {
          tempF: ctx.tempF,
          feelsClause
        }
      )
    );

  }

  const precipitation =
    weatherCodePhrase(
      ctx.wcode
    );

  const oldPrecip =
    spokenFactMemory.get(
      'precip'
    );

  if (
    precipitation &&
    (
      broadcastLoopCount === 0 ||
      precipitation !== oldPrecip ||
      broadcastLoopCount % 3 === 0
    )
  ) {

    segments.push(
      pickFilled(
        PHRASES.precip,
        'precip',
        {
          precip:
            precipitation,

          precipCap:
            precipitation
              .charAt(0)
              .toUpperCase() +
            precipitation.slice(1)
        }
      )
    );

  }

  spokenFactMemory.set(
    'temp',
    ctx.tempF
  );

  spokenFactMemory.set(
    'feels',
    ctx.feelsF
  );

  spokenFactMemory.set(
    'precip',
    precipitation
  );

}


function addWind(
  segments,
  ctx
) {

  if (
    ctx.windSpd < 5 &&
    ctx.windG < 10
  ) {

    return;

  }

  const gustClause =
    ctx.windG >
    ctx.windSpd + 5
      ? `, gusting up to ${ctx.windG}`
      : '';

  segments.push(
    pickFilled(
      PHRASES.wind,
      'wind',
      {
        windDir:
          window.degToCompass(
            ctx.windDeg
          ),

        windSpd:
          ctx.windSpd,

        gustClause
      }
    )
  );

  if (
    ctx.windSpd >= 30 ||
    ctx.windG >= 45
  ) {

    segments.push(
      'Those winds are strong enough to move loose objects and make driving more difficult for high-profile vehicles.'
    );

  }

}


function addHumidity(
  segments,
  ctx
) {

  if (
    ctx.dewF === null
  ) {
    return;
  }

  segments.push(
    pickFilled(
      PHRASES.humidity,
      'humidity',
      {
        humidity:
          ctx.humidity ??
          'unknown',

        dewF:
          ctx.dewF,

        dewLabel:
          window.dewLabel(
            ctx.dewF
          )
      }
    )
  );

}


function addAlerts(
  segments,
  alerts
) {

  if (!alerts.length) {

    if (
      broadcastLoopCount === 0
    ) {

      segments.push(
        'There are no active National Weather Service alerts for your location right now.'
      );

    }

    return;

  }

  const sorted =
    [...alerts]
      .sort(
        (a, b) =>
          window.alertPriorityScore(
            a.properties?.event || ''
          ) -
          window.alertPriorityScore(
            b.properties?.event || ''
          )
      );

  sorted
    .slice(0, 2)
    .forEach(alert => {

      const props =
        alert.properties || {};

      const area =
        (
          props.areaDesc ||
          'your area'
        )
          .split(';')[0];

      let until =
        '';

      if (props.expires) {

        try {

          until =
            new Date(
              props.expires
            )
              .toLocaleTimeString(
                [],
                {
                  hour: 'numeric',
                  minute: '2-digit'
                }
              );

        }

        catch (_) {}

      }

      segments.push(
        `A ${props.event || 'weather alert'} is in effect for ${area}${until ? ` until ${until}` : ''}.`
      );

    });

}


function addSpc(
  segments,
  spc
) {

  const labels = {

    TSTM:
      'a general thunderstorm risk',

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

  if (!labels[spc]) {
    return;
  }

  segments.push(
    `The Storm Prediction Center has your area under ${labels[spc]} today.`
  );

  if (
    SPC_RANK[spc] >=
    SPC_RANK.ENH
  ) {

    segments.push(
      "That's a level worth paying close attention to, so severe weather will stay near the top of the broadcast."
    );

  }

}


function addTodayForecast(
  segments,
  ctx
) {

  if (
    !ctx.forecast?.today
  ) {
    return;
  }

  segments.push(
    `${pickPhrase(
      PHRASES.forecastLead,
      'forecast-lead'
    )} ${ctx.forecast.today}`
  );

}


function addTonightForecast(
  segments,
  ctx
) {

  if (
    !ctx.forecast?.tonight
  ) {
    return;
  }

  const tonight =
    String(
      ctx.forecast.tonight
    )
      .replace(
        /^tonight,?\s*/i,
        ''
      )
      .trim();

  if (!tonight) {
    return;
  }

  segments.push(
    `${pickPhrase(
      PHRASES.tonightLead,
      'tonight-lead'
    )} ${tonight}`
  );

}


/* ════════════════════════════════════════════════
   BROADCAST SCRIPT BUILDER
════════════════════════════════════════════════ */

function buildScript(ctx) {

  const segments = [];

  const priorityAlerts =
    ctx.alerts.filter(alert =>
      /Warning|Watch|Emergency/i
        .test(
          alert.properties?.event || ''
        )
    );

  const severeWarning =
    priorityAlerts.some(alert =>
      /Warning|Emergency/i
        .test(
          alert.properties?.event || ''
        )
    );

  const windy =
    ctx.windSpd >= 20 ||
    ctx.windG >= 30;

  const precipitation =
    weatherCodePhrase(
      ctx.wcode
    );

  const gloomy =
    [
      45, 48,
      51, 53, 55,
      61, 63, 65,
      80, 81, 82
    ]
      .includes(ctx.wcode);

  const cityPhrase =
    ctx.cityState
      ? ` for ${ctx.cityState}`
      : '';

  /*
    First time through.
  */

  if (
    broadcastLoopCount === 0
  ) {

    segments.push(
      pickPhrase(
        PHRASES.firstOpeners,
        'first-openers'
      )
    );

    if (severeWarning) {

      segments.push(
        `We have active severe weather information${cityPhrase}, so let's get right to it.`
      );

    }

    else {

      segments.push(
        `Here's what you need to know${cityPhrase}.`
      );

    }

  }

  else {

    segments.push(
      pickPhrase(
        PHRASES.returnOpeners,
        'return-openers'
      )
    );

  }

  /*
    Warning/watch mode.
  */

  if (
    priorityAlerts.length
  ) {

    addAlerts(
      segments,
      ctx.alerts
    );

    addCurrentConditions(
      segments,
      ctx
    );

    if (windy) {

      addWind(
        segments,
        ctx
      );

    }

    addSpc(
      segments,
      ctx.spc
    );

    addTodayForecast(
      segments,
      ctx
    );

    segments.push(
      'Keep a reliable way to receive weather alerts nearby and be ready to act if conditions worsen.'
    );

  }

  /*
    Normal rotating weather mode.
  */

  else {

    const rotation =
      broadcastLoopCount % 5;

    if (rotation === 0) {

      addCurrentConditions(
        segments,
        ctx
      );

      if (
        !precipitation &&
        ctx.windSpd < 12
      ) {

        segments.push(
          pickPhrase(
            gloomy
              ? PHRASES.gloomy
              : PHRASES.quiet,

            gloomy
              ? 'gloomy'
              : 'quiet'
          )
        );

      }

      if (windy) {

        addWind(
          segments,
          ctx
        );

      }

      addTodayForecast(
        segments,
        ctx
      );

    }

    else if (
      rotation === 1
    ) {

      addCurrentConditions(
        segments,
        ctx
      );

      addTonightForecast(
        segments,
        ctx
      );

      addSpc(
        segments,
        ctx.spc
      );

    }

    else if (
      rotation === 2
    ) {

      addCurrentConditions(
        segments,
        ctx
      );

      addHumidity(
        segments,
        ctx
      );

      addWind(
        segments,
        ctx
      );

      if (ctx.sunset) {

        segments.push(
          `Sunset is around ${ctx.sunset} this evening.`
        );

      }

    }

    else if (
      rotation === 3
    ) {

      addCurrentConditions(
        segments,
        ctx
      );

      addTodayForecast(
        segments,
        ctx
      );

      if (ctx.spc) {

        addSpc(
          segments,
          ctx.spc
        );

      }

      else {

        segments.push(
          pickPhrase(
            PHRASES.trivia,
            'trivia'
          )
        );

      }

    }

    else {

      addCurrentConditions(
        segments,
        ctx
      );

      if (
        ctx.forecast?.tonight
      ) {

        addTonightForecast(
          segments,
          ctx
        );

      }

      else {

        addTodayForecast(
          segments,
          ctx
        );

      }

      if (
        ctx.windSpd >= 8
      ) {

        addWind(
          segments,
          ctx
        );

      }

    }

  }

  segments.push(
    pickPhrase(
      PHRASES.closers,
      'closers'
    )
  );

  liveSegments =
    polishSegments(
      segments
    );

  liveSegIdx =
    0;

  console.log(
    'StormVector speech rundown:',
    liveSegments
  );

}


/* ════════════════════════════════════════════════
   PREPARE LOCAL BROADCAST
════════════════════════════════════════════════ */

async function prepareBroadcast() {

  if (
    !locationReady ||
    liveLat === null ||
    liveLon === null
  ) {

    throw new Error(
      'StormVector needs your location before it can prepare local weather.'
    );

  }

  setLiveBadge(
    'UPDATING'
  );

  const locationCard =
    document.getElementById(
      'liveLocationCard'
    );

  /*
    Show actual coordinates immediately.

    That way you can confirm the current device
    is supplying the location before the NWS
    reverse-location lookup finishes.
  */

  if (locationCard) {

    locationCard.innerHTML = `
      <span class="live-location-icon">📍</span>

      <span class="live-location-text">
        ${liveLat.toFixed(4)}, ${liveLon.toFixed(4)}
        <small style="display:block;opacity:.7;margin-top:3px;">
          Loading local weather…
        </small>
      </span>
    `;

  }

  /*
    Every source is isolated.

    Open-Meteo or NWS failing does not prevent
    Vector from getting a speech rundown.
  */

  const nwsPromise =
    fetchNwsContext(
      liveLat,
      liveLon
    )
      .catch(error => {

        console.warn(
          'NWS context unavailable:',
          error
        );

        return {
          cityState: null,
          forecast: {
            today: null,
            tonight: null
          }
        };

      });

  const weatherPromise =
    fetchOpenMeteo(
      liveLat,
      liveLon
    )
      .catch(error => {

        console.warn(
          'Open-Meteo unavailable:',
          error
        );

        return {
          tempF: null,
          feelsF: null,
          humidity: null,
          dewF: null,
          wcode: null,
          windSpd: 0,
          windDeg: 0,
          windG: 0,
          sunrise: null,
          sunset: null
        };

      });

  const alertsPromise =
    fetchAlerts(
      liveLat,
      liveLon
    )
      .catch(() => []);

  const [
    nws,
    weather,
    alerts
  ] =
    await Promise.all([
      nwsPromise,
      weatherPromise,
      alertsPromise
    ]);

  /*
    SPC is non-essential.

    Give it a short window, then continue.
  */

  let spc = null;

  try {

    spc =
      await Promise.race([

        fetchSpcOutlook(
          liveLat,
          liveLon
        ),

        new Promise(
          resolve =>
            setTimeout(
              () =>
                resolve(null),
              2500
            )
        )

      ]);

  }

  catch (error) {

    console.warn(
      'SPC unavailable:',
      error
    );

  }

  liveCityState =
    nws.cityState;

  if (locationCard) {

    locationCard.innerHTML = `
      <span class="live-location-icon">📍</span>

      <span class="live-location-text">
        ${
          liveCityState ||
          `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`
        }
      </span>
    `;

  }

  const ctx = {

    cityState:
      liveCityState,

    tempF:
      weather.tempF ??
      null,

    feelsF:
      weather.feelsF ??
      null,

    humidity:
      weather.humidity ??
      null,

    dewF:
      weather.dewF ??
      null,

    wcode:
      weather.wcode ??
      null,

    windSpd:
      weather.windSpd ??
      0,

    windDeg:
      weather.windDeg ??
      0,

    windG:
      weather.windG ??
      0,

    sunrise:
      weather.sunrise ??
      null,

    sunset:
      weather.sunset ??
      null,

    alerts:
      alerts || [],

    forecast:
      nws.forecast || {
        today: null,
        tonight: null
      },

    spc:
      spc || null

  };

  /*
    Existing alerts should not immediately
    trigger the breaking interruption when
    the page first loads.
  */

  if (
    broadcastLoopCount === 0
  ) {

    ctx.alerts.forEach(alert => {

      if (
        /Warning|Watch|Emergency/i
          .test(
            alert.properties?.event || ''
          )
      ) {

        knownPriorityAlertIds.add(
          alert.id
        );

      }

    });

  }

  console.log(
    'StormVector current context:',
    ctx
  );

  renderConditionsRow(
    ctx
  );

  setBroadcastBg(
    ctx
  );

  buildScript(
    ctx
  );

  /*
    Absolute safety net.

    Vector should never have zero lines.
  */

  if (!liveSegments.length) {

    liveSegments = [

      liveCityState
        ? `I'm Vector. I'm monitoring the weather for ${liveCityState}, but some weather data is temporarily unavailable. I'll keep checking for an update.`
        : "I'm Vector. I have your location, but some weather data is temporarily unavailable. I'll keep checking for an update."

    ];

  }

  setLiveBadge(
    broadcastStarted
      ? 'LIVE'
      : 'READY'
  );

  return ctx;

}


/* ════════════════════════════════════════════════
   VOICE
════════════════════════════════════════════════ */

function pickVoice() {

  if (
    !('speechSynthesis' in window)
  ) {
    return;
  }

  const voices =
    speechSynthesis
      .getVoices();

  liveVoice =

    voices.find(voice =>
      /en-US/i.test(voice.lang) &&
      /David|Daniel|Aaron|Alex|Tom|Male/i
        .test(voice.name)
    ) ||

    voices.find(voice =>
      /en-US/i.test(
        voice.lang
      )
    ) ||

    voices.find(voice =>
      /^en/i.test(
        voice.lang
      )
    ) ||

    voices[0] ||

    null;

  console.log(
    'StormVector voice:',
    liveVoice?.name ||
    'system default'
  );

}


if (
  'speechSynthesis' in window
) {

  speechSynthesis.onvoiceschanged =
    pickVoice;

  pickVoice();

}


/* ════════════════════════════════════════════════
   THEME MUSIC
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

    document.body.appendChild(
      liveMusic
    );

  }

  liveMusic.src =
    './stormvector-theme.mp3';

  liveMusic.loop =
    true;

  liveMusic.preload =
    'auto';

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
    clamp(
      target,
      0,
      1
    );

  if (musicFadeFrame) {

    cancelAnimationFrame(
      musicFadeFrame
    );

    musicFadeFrame =
      null;

  }

  if (duration <= 0) {

    music.volume =
      target;

    return;

  }

  const startVolume =
    Number.isFinite(
      music.volume
    )
      ? music.volume
      : 0;

  const startTime =
    performance.now();

  const step =
    now => {

      const progress =
        clamp(
          (
            now -
            startTime
          ) /
          duration,
          0,
          1
        );

      music.volume =
        startVolume +
        (
          target -
          startVolume
        ) *
        progress;

      if (
        progress < 1
      ) {

        musicFadeFrame =
          requestAnimationFrame(
            step
          );

      }

      else {

        musicFadeFrame =
          null;

      }

    };

  musicFadeFrame =
    requestAnimationFrame(
      step
    );

}


async function startMusic() {

  const music =
    ensureLiveMusicElement();

  if (!music.paused) {

    restoreMusic();

    return true;

  }

  music.volume = 0;

  try {

    await music.play();

    setMusicVolume(
      0.18,
      900
    );

    return true;

  }

  catch (error) {

    console.warn(
      'StormVector music could not start:',
      error
    );

    return false;

  }

}


function duckMusic() {

  if (
    !liveMusic ||
    liveMusic.paused
  ) {
    return;
  }

  setMusicVolume(
    0.05,
    250
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
    0.18,
    550
  );

}


function stopMusic() {

  if (!liveMusic) {
    return;
  }

  setMusicVolume(
    0,
    300
  );

  setTimeout(
    () => {

      if (!liveMusic) {
        return;
      }

      liveMusic.pause();

    },
    330
  );

}


/* ════════════════════════════════════════════════
   ROBOT / CAPTIONS / BADGE
════════════════════════════════════════════════ */

function setRobotSpeaking(
  speaking
) {

  document
    .getElementById(
      'liveAvatar'
    )
    ?.classList.toggle(
      'speaking',
      speaking
    );

  document.body
    .classList.toggle(
      'vector-speaking',
      speaking
    );

}


function setCaption(
  text
) {

  const caption =
    document.getElementById(
      'liveCaptionText'
    );

  if (caption) {

    caption.textContent =
      text;

  }

  announce(text);

}


function setLiveBadge(
  text
) {

  const badge =
    document.getElementById(
      'liveBadge'
    );

  if (!badge) return;

  badge.innerHTML = `
    <span class="live-dot"></span>
    <span class="live-badge-text">
      ${text}
    </span>
  `;

  badge.classList.toggle(
    'live-badge-on',
    text === 'LIVE'
  );

  badge.classList.toggle(
    'live-badge-breaking',
    text === 'BREAKING'
  );

}


/* ════════════════════════════════════════════════
   SEVERE WEATHER WATCH
════════════════════════════════════════════════ */

function startSevereWatch() {

  stopSevereWatch();

  /*
    Check immediately after broadcast starts,
    then every 60 seconds.
  */

  checkForBreakingWeather();

  severeWatchTimer =
    setInterval(
      checkForBreakingWeather,
      60000
    );

}


function stopSevereWatch() {

  if (severeWatchTimer) {

    clearInterval(
      severeWatchTimer
    );

  }

  severeWatchTimer =
    null;

}


async function checkForBreakingWeather() {

  if (
    liveMuted ||
    breakingWeatherActive ||
    !locationReady ||
    !broadcastStarted
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
      alerts
        .filter(alert =>
          /Warning|Watch|Emergency/i
            .test(
              alert.properties?.event || ''
            )
        )
        .sort(
          (a, b) =>
            window.alertPriorityScore(
              a.properties?.event || ''
            ) -
            window.alertPriorityScore(
              b.properties?.event || ''
            )
        );

    const fresh =
      priority.filter(alert =>
        !knownPriorityAlertIds
          .has(alert.id)
      );

    priority.forEach(alert =>
      knownPriorityAlertIds
        .add(alert.id)
    );

    if (fresh.length) {

      await interruptForBreakingWeather(
        fresh[0]
      );

    }

  }

  catch (error) {

    console.warn(
      'StormVector severe weather poll failed:',
      error
    );

  }

}


/* ════════════════════════════════════════════════
   ATTENTION TONE
════════════════════════════════════════════════ */

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
      context.state ===
      'suspended'
    ) {

      await context.resume();

    }

    const duration =
      3.2;

    const gain =
      context.createGain();

    gain.gain.value =
      0.20;

    gain.connect(
      context.destination
    );

    [853, 960].forEach(
      frequency => {

        const oscillator =
          context.createOscillator();

        oscillator.type =
          'sine';

        oscillator.frequency.value =
          frequency;

        oscillator.connect(
          gain
        );

        oscillator.start();

        oscillator.stop(
          context.currentTime +
          duration
        );

      }
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          duration * 1000 +
          150
        )
    );

    try {

      await context.close();

    }

    catch (_) {}

  }

  catch (error) {

    console.warn(
      'StormVector attention tone failed:',
      error
    );

  }

}


/* ════════════════════════════════════════════════
   BREAKING WEATHER INTERRUPTION
════════════════════════════════════════════════ */

async function interruptForBreakingWeather(
  alert
) {

  if (breakingWeatherActive) {
    return;
  }

  breakingWeatherActive =
    true;

  resumeSegIdxAfterBreak =
    liveSegIdx;

  clearPlaybackTimers();

  try {

    speechSynthesis.cancel();

  }

  catch (_) {}

  setRobotSpeaking(
    false
  );

  setMusicVolume(
    0.02,
    200
  );

  setLiveBadge(
    'BREAKING'
  );

  const banner =
    document.getElementById(
      'liveBreakingBanner'
    );

  if (banner) {
    banner.hidden = false;
  }

  await playAttentionTone();

  const event =
    alert.properties?.event ||
    'weather alert';

  const area =
    (
      alert.properties?.areaDesc ||
      'your area'
    )
      .split(';')[0];

  const movement =
    window.parseMovement(
      alert.properties?.description ||
      ''
    );

  const warning =
    /Warning|Emergency/i
      .test(event);

  const breakingSegments = [

    'This is a StormVector Breaking Weather update.',

    `A ${event} is now in effect for ${area}.${movement ? ` The storm is moving ${movement.dir} at ${movement.spd} miles per hour.` : ''} ${warning ? 'Take action now if you are in the warned area and follow National Weather Service instructions.' : 'Review your severe weather plan and be ready to act if warnings are issued.'}`,

    'I will keep this alert at the top of the weather coverage.'

  ];

  await speakSequential(
    breakingSegments
  );

  try {

    await prepareBroadcast();

  }

  catch (error) {

    console.warn(
      'StormVector refresh after alert failed:',
      error
    );

  }

  breakingWeatherActive =
    false;

  if (banner) {
    banner.hidden = true;
  }

  restoreMusic();

  if (
    !liveMuted &&
    broadcastStarted
  ) {

    speakSegment(
      Math.min(
        resumeSegIdxAfterBreak,
        Math.max(
          0,
          liveSegments.length - 1
        )
      )
    );

  }

}


/* ════════════════════════════════════════════════
   SPEAK SEQUENTIAL
════════════════════════════════════════════════ */

function speakSequential(list) {

  return new Promise(
    resolve => {

      let index = 0;

      const next = () => {

        if (
          index >=
          list.length
        ) {

          setRobotSpeaking(
            false
          );

          resolve();

          return;

        }

        const text =
          list[index];

        const utter =
          new SpeechSynthesisUtterance(
            renderForSpeech(text)
          );

        if (liveVoice) {
          utter.voice = liveVoice;
        }

        utter.rate = 0.94;
        utter.pitch = 1;
        utter.volume = 1;

        utter.onstart = () => {

          duckMusic();

          setRobotSpeaking(
            true
          );

          setCaption(text);

        };

        utter.onend = () => {

          setRobotSpeaking(
            false
          );

          index++;

          setTimeout(
            next,
            300
          );

        };

        utter.onerror = () => {

          setRobotSpeaking(
            false
          );

          index++;

          setTimeout(
            next,
            200
          );

        };

        speechSynthesis.speak(
          utter
        );

      };

      next();

    }
  );

}


/* ════════════════════════════════════════════════
   ANDROID / MOBILE RELIABILITY
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
            40
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

  speechKeepAlive =
    null;

}


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

  }

  catch (_) {}

}


function releaseWakeLock() {

  try {

    wakeLock?.release();

  }

  catch (_) {}

  wakeLock = null;

}


/* ════════════════════════════════════════════════
   START BROADCAST
════════════════════════════════════════════════ */

async function startBroadcast() {

  /*
    If location failed before, tapping the button
    attempts the browser location request again.
  */

  if (!locationReady) {

    const ready =
      await requestLocationAndPrepare();

    if (!ready) {
      return;
    }

  }

  if (!liveSegments.length) {

    try {

      await prepareBroadcast();

    }

    catch (error) {

      console.error(
        'StormVector cannot build broadcast:',
        error
      );

      liveSegments = [
        "I'm Vector. I found your location, but I'm having trouble getting the latest weather data right now. I'll keep trying."
      ];

    }

  }

  broadcastStarted =
    true;

  liveMuted =
    false;

  clearPlaybackTimers();

  document.body
    .classList.add(
      'broadcast-active'
    );

  const overlay =
    document.getElementById(
      'liveStartOverlay'
    );

  if (overlay) {

    overlay.style.display =
      'none';

  }

  /*
    Music must NEVER block speech.
  */

  startMusic()
    .catch(error => {

      console.warn(
        'StormVector music failed but broadcast will continue:',
        error
      );

    });

  requestWakeLock();

  startSevereWatch();

  startSpeechKeepAlive();

  setLiveBadge(
    'LIVE'
  );

  setTimeout(
    () =>
      speakSegment(0),
    150
  );

}


/* ════════════════════════════════════════════════
   REPLAY / STOP / RESUME
════════════════════════════════════════════════ */

function replaySegment() {

  if (
    !liveSegments.length ||
    liveMuted ||
    breakingWeatherActive
  ) {

    return;

  }

  clearPlaybackTimers();

  try {

    speechSynthesis.cancel();

  }

  catch (_) {}

  setRobotSpeaking(
    false
  );

  nextSegmentTimer =
    setTimeout(
      () =>
        speakSegment(
          liveSegIdx
        ),
      120
    );

}


function toggleMute() {

  const button =
    document.getElementById(
      'liveMuteBtn'
    );

  /*
    STOP.
  */

  if (!liveMuted) {

    liveMuted =
      true;

    clearPlaybackTimers();

    try {

      speechSynthesis.cancel();

    }

    catch (_) {}

    setRobotSpeaking(
      false
    );

    stopMusic();

    stopSpeechKeepAlive();

    stopSevereWatch();

    releaseWakeLock();

    setLiveBadge(
      'MUTED'
    );

    if (button) {

      button.innerHTML =
        '<span class="live-control-icon">🔊</span> Resume';

    }

    return;

  }

  /*
    RESUME.
  */

  liveMuted =
    false;

  if (button) {

    button.innerHTML =
      '<span class="live-control-icon">🔇</span> Stop';

  }

  startMusic()
    .catch(() => {});

  requestWakeLock();

  startSevereWatch();

  startSpeechKeepAlive();

  setLiveBadge(
    'LIVE'
  );

  nextSegmentTimer =
    setTimeout(
      () =>
        speakSegment(
          liveSegIdx
        ),
      150
    );

}


/* ════════════════════════════════════════════════
   MAIN SPEECH LOOP
════════════════════════════════════════════════ */

function speakSegment(index) {

  if (
    breakingWeatherActive ||
    liveMuted ||
    !broadcastStarted
  ) {

    return;

  }

  /*
    Browser without Web Speech API:
    captions continue to work.
  */

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

  /*
    End of rundown.

    Refresh all live data and build a different
    conversational loop.
  */

  if (
    index >=
    liveSegments.length
  ) {

    setRobotSpeaking(
      false
    );

    setLiveBadge(
      'CHECKING WEATHER'
    );

    restoreMusic();

    nextLoopTimer =
      setTimeout(
        async () => {

          broadcastLoopCount++;

          try {

            await prepareBroadcast();

          }

          catch (error) {

            console.error(
              'StormVector loop refresh failed:',
              error
            );

          }

          if (
            !liveMuted &&
            broadcastStarted &&
            !breakingWeatherActive
          ) {

            nextLoopTimer =
              setTimeout(
                () =>
                  speakSegment(0),
                1200
              );

          }

        },
        2200
      );

    return;

  }

  liveSegIdx =
    index;

  const text =
    liveSegments[index];

  if (!text) {

    speakSegment(
      index + 1
    );

    return;

  }

  const isAndroid =
    /Android/i.test(
      navigator.userAgent
    );

  const utter =
    new SpeechSynthesisUtterance(
      renderForSpeech(text)
    );

  if (liveVoice) {

    utter.voice =
      liveVoice;

  }

  utter.rate =
    isAndroid
      ? 0.93
      : 0.97;

  utter.pitch =
    1;

  utter.volume =
    1;

  utter.onstart = () => {

    duckMusic();

    setLiveBadge(
      'LIVE'
    );

    setRobotSpeaking(
      true
    );

    setCaption(text);

  };

  utter.onend = () => {

    setRobotSpeaking(
      false
    );

    if (
      liveMuted ||
      breakingWeatherActive ||
      !broadcastStarted
    ) {

      return;

    }

    /*
      Give the music room between thoughts.
  */

    setMusicVolume(
      0.105,
      180
    );

    const pause =
      text.length > 190
        ? 600
        : text.length > 120
          ? 450
          : 320;

    nextSegmentTimer =
      setTimeout(
        () =>
          speakSegment(
            index + 1
          ),
        pause
      );

  };

  utter.onerror = event => {

    console.warn(
      'StormVector speech error:',
      event
    );

    setRobotSpeaking(
      false
    );

    if (
      !liveMuted &&
      !breakingWeatherActive &&
      broadcastStarted
    ) {

      nextSegmentTimer =
        setTimeout(
          () =>
            speakSegment(
              index + 1
            ),
          400
        );

    }

  };

  /*
    Do not repeatedly cancel speech between lines.
    That can cause mobile browsers to stop talking.
  */

  nextSegmentTimer =
    setTimeout(
      () => {

        if (
          liveMuted ||
          breakingWeatherActive ||
          !broadcastStarted
        ) {

          return;

        }

        speechSynthesis.speak(
          utter
        );

      },
      isAndroid
        ? 80
        : 25
    );

}


/* ════════════════════════════════════════════════
   ACCESSIBILITY
════════════════════════════════════════════════ */

function announce(message) {

  const element =
    document.getElementById(
      'ariaLive'
    );

  if (!element) {
    return;
  }

  element.textContent =
    '';

  requestAnimationFrame(
    () => {

      element.textContent =
        message;

    }
  );

}


/* ════════════════════════════════════════════════
   VISIBILITY RECOVERY
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
      broadcastStarted &&
      !liveMuted
    ) {

      requestWakeLock();

    }

    /*
      Some Android browsers drop TTS after
      the browser is backgrounded.
  */

    if (
      broadcastStarted &&
      !liveMuted &&
      !breakingWeatherActive &&
      liveSegments.length &&
      'speechSynthesis' in window &&
      !speechSynthesis.speaking &&
      !nextSegmentTimer &&
      !nextLoopTimer
    ) {

      nextSegmentTimer =
        setTimeout(
          () =>
            speakSegment(
              liveSegIdx
            ),
          300
        );

    }

  }
);


/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

document.addEventListener(
  'DOMContentLoaded',
  async () => {

    ensureLiveMusicElement();

    const button =
      document.getElementById(
        'liveStartBtn'
      );

    const card =
      document.getElementById(
        'liveLocationCard'
      );

    if (card) {

      card.innerHTML = `
        <span class="live-location-icon">📍</span>

        <span class="live-location-text">
          Locating…
        </span>
      `;

    }

    if (button) {

      button.disabled =
        true;

      button.textContent =
        'Preparing…';

    }

    /*
      Location is attempted immediately.

      If the browser refuses permission,
      the Go Live button turns into
      Enable Location instead of silently
      using a fallback city.
  */

    const ready =
      await requestLocationAndPrepare();

    if (
      ready &&
      button
    ) {

      button.disabled =
        false;

      button.textContent =
        '▶ Go Live';

    }

  }
);


/* ════════════════════════════════════════════════
   CLEANUP
════════════════════════════════════════════════ */

window.addEventListener(
  'beforeunload',
  () => {

    broadcastStarted =
      false;

    clearPlaybackTimers();

    try {

      speechSynthesis.cancel();

    }

    catch (_) {}

    stopSevereWatch();

    stopSpeechKeepAlive();

    releaseWakeLock();

    if (musicFadeFrame) {

      cancelAnimationFrame(
        musicFadeFrame
      );

    }

    if (liveMusic) {

      try {

        liveMusic.pause();

      }

      catch (_) {}

    }

  }
);