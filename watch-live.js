/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Natural looping local weather broadcast.
════════════════════════════════════════════════ */

let liveLat = null;
let liveLon = null;
let liveCityState = null;

let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;

let liveMuted = false;
let liveMusic = null;
let musicFadeFrame = null;

let broadcastLoopCount = 0;
let locationReady = false;

let speechKeepAlive = null;
let wakeLock = null;

let breakingWeatherActive = false;
let severeWatchTimer = null;
let resumeSegIdxAfterBreak = 0;

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
   FALLBACK HELPERS
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
      'N', 'NNE', 'NE', 'ENE',
      'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW',
      'W', 'WNW', 'NW', 'NNW'
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

    const e =
      String(event || '')
        .toLowerCase();

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
      ['heat advisory', 15]
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

    const text =
      String(desc || '');

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
        `HTTP ${response.status}`
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

function pickPhrase(
  pool,
  category
) {

  if (!pool?.length) {
    return '';
  }

  if (!phraseHistory[category]) {

    phraseHistory[category] =
      new Set();

  }

  const used =
    phraseHistory[category];

  let available =
    pool
      .map((_, index) => index)
      .filter(index =>
        !used.has(index)
      );

  if (!available.length) {

    used.clear();

    available =
      pool.map(
        (_, index) => index
      );

  }

  const index =
    available[
      Math.floor(
        Math.random() *
        available.length
      )
    ];

  used.add(index);

  return pool[index];

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

function polishSegments(segments) {

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

  if (
    [95, 96, 99]
      .includes(wcode)
  ) {
    return 'thunderstorms';
  }

  if (
    [71, 73, 75, 77, 85, 86]
      .includes(wcode)
  ) {
    return 'snow';
  }

  if (
    [61, 63, 65, 80, 81, 82]
      .includes(wcode)
  ) {
    return 'rain showers';
  }

  if (
    [56, 57, 66, 67]
      .includes(wcode)
  ) {
    return 'freezing precipitation';
  }

  if (
    [51, 53, 55]
      .includes(wcode)
  ) {
    return 'drizzle';
  }

  if (
    [45, 48]
      .includes(wcode)
  ) {
    return 'fog';
  }

  return null;

}


/* ════════════════════════════════════════════════
   NATURAL SPEECH BANK
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

    "Let's check in on what's changed.",

    "Here's the latest look at your local weather.",

    "Back on StormVector Live with another weather check.",

    "Let's bring the weather picture back up."

  ],

  quiet: [

    "Things are pretty calm locally right now.",

    "The weather is giving us a fairly easy setup at the moment.",

    "Not much weather drama locally right now.",

    "It's a quieter stretch across the area."

  ],

  gloomy: [

    "It's a gray-looking setup outside right now.",

    "Clouds are doing most of the work in the sky at the moment.",

    "A little dreary outside, but here's what matters."

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

    "It's a little warmer now, up to {tempF} degrees{feelsClause}."

  ],

  currentCooler: [

    "We've cooled off a bit since the last update. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have dropped {changeText}, putting us at {tempF}{feelsClause}.",

    "It's a little cooler now, down to {tempF} degrees{feelsClause}."

  ],

  precip: [

    "We're also seeing {precip} in the area.",

    "{precipCap} are part of the local weather picture right now.",

    "There's also some {precip} showing up locally."

  ],

  wind: [

    "Wind is out of the {windDir} at {windSpd} miles per hour{gustClause}.",

    "We've got a {windDir} wind around {windSpd} miles per hour{gustClause}.",

    "Winds are running from the {windDir} at about {windSpd} miles per hour{gustClause}."

  ],

  humidity: [

    "Humidity is around {humidity} percent, with a dew point near {dewF}. That puts the air in the {dewLabel} range.",

    "The dew point is near {dewF}, so the air feels {dewLabel}.",

    "Moisture levels are noticeable. Humidity is around {humidity} percent with a dew point near {dewF}."

  ],

  closers: [

    "That's where things stand right now. I'll keep watching for changes.",

    "That's your latest StormVector check. I'll update you again as conditions evolve.",

    "That's the weather picture for now. I'll keep the next update moving.",

    "That's the latest. Stay weather-aware and I'll keep watching what changes next."

  ],

  trivia: [

    "A quick weather fact while things are quiet. Lightning can strike the same place more than once.",

    "A quick weather fact. Sun dogs are caused by ice crystals high in the atmosphere.",

    "One weather fact while we have a quiet moment. Hail can fall even when it is warm at ground level."

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

      navigator.geolocation
        .getCurrentPosition(

          position => {

            liveLat =
              position.coords.latitude;

            liveLon =
              position.coords.longitude;

            locationReady = true;

            resolve();

          },

          error => {

            locationReady = false;

            reject(
              new Error(
                geolocationErrorMessage(
                  error
                )
              )
            );

          },

          {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 60000
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

  if (card) {

    card.innerHTML =
      '<span class="live-location-icon">📍</span><span class="live-location-text">Requesting location…</span>';

  }

  if (button) {

    button.disabled = true;

    button.textContent =
      'Locating…';

  }

  try {

    await initLocation();

    await prepareBroadcast();

    if (button) {

      button.disabled = false;

      button.textContent =
        '▶ Go Live';

    }

    return true;

  }

  catch (error) {

    console.error(
      'StormVector location error:',
      error
    );

    if (card) {

      card.innerHTML =
        `<span class="live-location-icon">📍</span><span class="live-location-text">${error.message}</span>`;

    }

    if (button) {

      button.disabled = false;

      button.textContent =
        '📍 Enable Location';

    }

    return false;

  }

}


/* ════════════════════════════════════════════════
   WEATHER DATA
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
            Accept:
              'application/geo+json'
          }
        }

      );

    const data =
      await response.json();

    return data.features || [];

  }

  catch (error) {

    console.warn(
      'StormVector alerts fetch failed:',
      error
    );

    return [];

  }

}

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
            Accept:
              'application/geo+json'
          }
        }

      );

    const data =
      await response.json();

    const props =
      data.properties || {};

    const location =
      props.relativeLocation
        ?.properties;

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
          forecastData.properties
            ?.periods || [];

        const now =
          new Date();

        const current =
          periods.find(period => {

            const start =
              new Date(
                period.startTime
              );

            const end =
              new Date(
                period.endTime
              );

            return (
              start <= now &&
              now < end
            );

          }) ||
          periods[0];

        const nextNight =
          periods.find(period =>

            !period.isDaytime &&

            new Date(
              period.endTime
            ) > now

          );

        today =
          current?.detailedForecast ||
          current?.shortForecast ||
          null;

        tonight =
          nextNight?.detailedForecast ||
          nextNight?.shortForecast ||
          null;

      }

      catch (error) {

        console.warn(
          'NWS forecast failed:',
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
      'NWS point lookup failed:',
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

async function fetchOpenMeteo(
  lat,
  lon
) {

  const url =

    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +

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
    iso => {

      if (!iso) return null;

      try {

        return new Date(iso)
          .toLocaleTimeString(
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
   SPC OUTLOOK
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

      inside =
        !inside;

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
            timeout: 8000
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

            feature.properties
              ?.LABEL ||

            feature.properties
              ?.label ||

            feature.properties
              ?.DN ||

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
        'SPC outlook fetch failed:',
        error
      );

    }

  }

  return null;

}


/* ════════════════════════════════════════════════
   CONDITIONS UI
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

  if (
    [95, 96, 99]
      .includes(ctx.wcode)
  ) {

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
   NATURAL BROADCAST SCRIPT
════════════════════════════════════════════════ */

function addCurrentConditions(
  segments,
  ctx
) {

  if (ctx.tempF === null) {

    segments.push(
      "I'm having trouble getting the latest temperature right now, but I'm still watching the rest of the weather data."
    );

    return;

  }

  const previous =
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
    previous === undefined
  ) {

    segments.push(

      pickFilled(
        PHRASES.currentFirst,
        'currentFirst',
        {
          tempF:
            ctx.tempF,

          feelsClause
        }
      )

    );

  }

  else if (
    ctx.tempF > previous
  ) {

    const difference =
      ctx.tempF -
      previous;

    segments.push(

      pickFilled(
        PHRASES.currentWarmer,
        'currentWarmer',
        {
          tempF:
            ctx.tempF,

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
    ctx.tempF < previous
  ) {

    const difference =
      previous -
      ctx.tempF;

    segments.push(

      pickFilled(
        PHRASES.currentCooler,
        'currentCooler',
        {
          tempF:
            ctx.tempF,

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
        'currentSteady',
        {
          tempF:
            ctx.tempF,

          feelsClause
        }
      )

    );

  }

  const precip =
    weatherCodePhrase(
      ctx.wcode
    );

  if (precip) {

    segments.push(

      pickFilled(
        PHRASES.precip,
        'precip',
        {
          precip,

          precipCap:
            precip
              .charAt(0)
              .toUpperCase() +
            precip.slice(1)
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
      "Those winds are strong enough to move loose objects and make driving more difficult for high-profile vehicles."
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
        "There are no active National Weather Service alerts for your location right now."
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

      let until = '';

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

function buildScript(ctx) {

  const segments = [];

  const hasPriorityAlert =
    ctx.alerts.some(alert =>
      /Warning|Watch|Emergency/i
        .test(
          alert.properties?.event || ''
        )
    );

  const severeWarning =
    ctx.alerts.some(alert =>
      /Warning|Emergency/i
        .test(
          alert.properties?.event || ''
        )
    );

  const windy =
    ctx.windSpd >= 20 ||
    ctx.windG >= 30;

  const precip =
    weatherCodePhrase(
      ctx.wcode
    );

  const city =
    ctx.cityState
      ? ` for ${ctx.cityState}`
      : '';

  if (
    broadcastLoopCount === 0
  ) {

    segments.push(
      pickPhrase(
        PHRASES.firstOpeners,
        'firstOpeners'
      )
    );

    if (severeWarning) {

      segments.push(
        `We have active severe weather information${city}, so let's get right to it.`
      );

    }

    else {

      segments.push(
        `Here's what you need to know${city}.`
      );

    }

  }

  else {

    segments.push(
      pickPhrase(
        PHRASES.returnOpeners,
        'returnOpeners'
      )
    );

  }

  /*
    Severe weather always takes priority.
  */

  if (hasPriorityAlert) {

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

    if (
      ctx.forecast.today
    ) {

      segments.push(
        ctx.forecast.today
      );

    }

    segments.push(
      "Keep a reliable way to receive weather alerts nearby and be ready to act if conditions worsen."
    );

  }

  else {

    /*
      Normal broadcasts rotate their focus so
      Vector does not repeat the exact same
      weather report every time.
    */

    const rotation =
      broadcastLoopCount % 4;

    if (rotation === 0) {

      addCurrentConditions(
        segments,
        ctx
      );

      if (
        !precip &&
        ctx.windSpd < 12
      ) {

        segments.push(
          pickPhrase(
            PHRASES.quiet,
            'quiet'
          )
        );

      }

      if (windy) {

        addWind(
          segments,
          ctx
        );

      }

      if (
        ctx.forecast.today
      ) {

        segments.push(
          `Looking ahead, ${ctx.forecast.today}`
        );

      }

    }

    else if (
      rotation === 1
    ) {

      addCurrentConditions(
        segments,
        ctx
      );

      if (
        ctx.forecast.tonight
      ) {

        const tonight =
          String(
            ctx.forecast.tonight
          )
          .replace(
            /^tonight,?\s*/i,
            ''
          );

        segments.push(
          `For tonight, ${tonight}`
        );

      }

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

      if (
        ctx.sunset
      ) {

        segments.push(
          `Sunset is around ${ctx.sunset} this evening.`
        );

      }

    }

    else {

      addCurrentConditions(
        segments,
        ctx
      );

      if (
        ctx.forecast.today
      ) {

        segments.push(
          `Taking another look at the forecast, ${ctx.forecast.today}`
        );

      }

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

  liveSegIdx = 0;

}


/* ════════════════════════════════════════════════
   PREPARE BROADCAST
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

  const [
    nws,
    weather,
    alerts,
    spc
  ] =
    await Promise.all([

      fetchNwsContext(
        liveLat,
        liveLon
      ),

      fetchOpenMeteo(
        liveLat,
        liveLon
      )
      .catch(error => {

        console.warn(
          'Open-Meteo failed:',
          error
        );

        return {};

      }),

      fetchAlerts(
        liveLat,
        liveLon
      ),

      fetchSpcOutlook(
        liveLat,
        liveLon
      )

    ]);

  liveCityState =
    nws.cityState;

  const locationCard =
    document.getElementById(
      'liveLocationCard'
    );

  if (locationCard) {

    locationCard.innerHTML = `

      <span class="live-location-icon">
        📍
      </span>

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
      weather.tempF ?? null,

    feelsF:
      weather.feelsF ?? null,

    humidity:
      weather.humidity ?? null,

    dewF:
      weather.dewF ?? null,

    wcode:
      weather.wcode ?? null,

    windSpd:
      weather.windSpd ?? 0,

    windDeg:
      weather.windDeg ?? 0,

    windG:
      weather.windG ?? 0,

    sunrise:
      weather.sunrise ?? null,

    sunset:
      weather.sunset ?? null,

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

  renderConditionsRow(ctx);

  setBroadcastBg(ctx);

  buildScript(ctx);

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
    speechSynthesis.getVoices();

  liveVoice =

    voices.find(voice =>

      /en-US/i.test(
        voice.lang
      ) &&

      /David|Daniel|Aaron|Alex|Tom|Male/i
        .test(
          voice.name
        )

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

}

if (
  'speechSynthesis' in window
) {

  speechSynthesis.onvoiceschanged =
    pickVoice;

  pickVoice();

}


/* ════════════════════════════════════════════════
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

    document.body.appendChild(
      liveMusic
    );

  }

  /*
    Force the correct repository file here too.
    This protects against the HTML source being
    accidentally removed or changed later.
  */

  if (
    !liveMusic.getAttribute(
      'src'
    )
  ) {

    liveMusic.src =
      './stormvector-theme.mp3';

  }

  liveMusic.loop = true;

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

  }

  const start =
    music.volume || 0;

  const started =
    performance.now();

  const step =
    now => {

      const progress =
        clamp(
          (now - started) /
          duration,
          0,
          1
        );

      music.volume =
        start +
        (
          target -
          start
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

  music.loop = true;
  music.volume = 0;

  try {

    /*
      startBroadcast() is triggered directly by
      the user's tap, which allows Safari/iPhone
      to begin audio playback.
    */

    await music.play();

    setMusicVolume(
      0.19,
      1000
    );

  }

  catch (error) {

    console.warn(
      'StormVector theme music could not start:',
      error
    );

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
    0.055,
    260
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
    0.19,
    600
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

      liveMusic.currentTime = 0;

    },
    330
  );

}


/* ════════════════════════════════════════════════
   ROBOT + CAPTIONS
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

function setCaption(text) {

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

function setLiveBadge(text) {

  const badge =
    document.getElementById(
      'liveBadge'
    );

  if (!badge) {
    return;
  }

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

}


/* ════════════════════════════════════════════════
   SEVERE WEATHER INTERRUPTION
════════════════════════════════════════════════ */

function startSevereWatch() {

  stopSevereWatch();

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
        !knownPriorityAlertIds.has(
          alert.id
        )
      );

    priority.forEach(alert =>
      knownPriorityAlertIds.add(
        alert.id
      )
    );

    if (fresh.length) {

      await interruptForBreakingWeather(
        fresh[0]
      );

    }

  }

  catch (error) {

    console.warn(
      'StormVector severe weather watch failed:',
      error
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

    [853, 960]
      .forEach(frequency => {

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

      });

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          duration * 1000 + 150
        )
    );

    await context
      .close()
      .catch(() => {});

  }

  catch (error) {

    console.warn(
      'StormVector attention tone failed:',
      error
    );

  }

}

async function interruptForBreakingWeather(
  alert
) {

  breakingWeatherActive =
    true;

  resumeSegIdxAfterBreak =
    liveSegIdx;

  speechSynthesis.cancel();

  setRobotSpeaking(false);

  setMusicVolume(
    0.025,
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

  await speakSequential([

    'This is a StormVector Breaking Weather update.',

    `A ${event} is now in effect for ${area}.${movement ? ` The storm is moving ${movement.dir} at ${movement.spd} miles per hour.` : ''} ${warning ? 'Take action now if you are in the warned area and follow National Weather Service instructions.' : 'Review your severe weather plan and be ready to act if warnings are issued.'}`,

    'I will keep this alert at the top of the weather coverage.'

  ]);

  try {

    await prepareBroadcast();

  }

  catch (error) {

    console.warn(
      'StormVector post-alert refresh failed:',
      error
    );

  }

  breakingWeatherActive =
    false;

  if (banner) {

    banner.hidden = true;

  }

  restoreMusic();

  if (!liveMuted) {

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

function speakSequential(list) {

  return new Promise(
    resolve => {

      let index = 0;

      const next =
        () => {

          if (
            index >=
            list.length
          ) {

            resolve();

            return;

          }

          const text =
            list[index];

          const utter =
            new SpeechSynthesisUtterance(
              renderForSpeech(
                text
              )
            );

          if (liveVoice) {

            utter.voice =
              liveVoice;

          }

          utter.rate = 0.94;
          utter.pitch = 1;
          utter.volume = 1;

          utter.onstart =
            () => {

              duckMusic();

              setCaption(text);

              setRobotSpeaking(
                true
              );

            };

          utter.onend =
            () => {

              setRobotSpeaking(
                false
              );

              index++;

              setTimeout(
                next,
                350
              );

            };

          utter.onerror =
            () => {

              setRobotSpeaking(
                false
              );

              index++;

              next();

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
   MOBILE RELIABILITY
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

  speechKeepAlive = null;

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
   PLAYBACK
════════════════════════════════════════════════ */

async function startBroadcast() {

  if (!locationReady) {

    const ready =
      await requestLocationAndPrepare();

    if (!ready) {
      return;
    }

  }

  document.body.classList.add(
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
    IMPORTANT:
    Start the MP3 directly inside the user's
    button-tap event. This is important for
    Safari/iPhone autoplay restrictions.
  */

  await startMusic();

  requestWakeLock();

  startSevereWatch();

  startSpeechKeepAlive();

  speakSegment(0);

}

function replaySegment() {

  if (!liveSegments.length) {
    return;
  }

  speechSynthesis.cancel();

  setRobotSpeaking(false);

  setTimeout(
    () =>
      speakSegment(
        liveSegIdx
      ),
    100
  );

}

function toggleMute() {

  liveMuted =
    !liveMuted;

  const button =
    document.getElementById(
      'liveMuteBtn'
    );

  if (liveMuted) {

    speechSynthesis.cancel();

    setRobotSpeaking(false);

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

  }

  else {

    if (button) {

      button.innerHTML =
        '<span class="live-control-icon">🔇</span> Stop';

    }

    startMusic();

    requestWakeLock();

    startSevereWatch();

    startSpeechKeepAlive();

    speakSegment(
      liveSegIdx
    );

  }

}

function speakSegment(index) {

  if (
    breakingWeatherActive ||
    liveMuted
  ) {
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

  /*
    End of this rundown.
    Refresh live weather and create a
    different conversational rundown.
  */

  if (
    index >=
    liveSegments.length
  ) {

    setLiveBadge(
      'CHECKING WEATHER'
    );

    setRobotSpeaking(false);

    restoreMusic();

    setTimeout(
      async () => {

        broadcastLoopCount++;

        try {

          await prepareBroadcast();

        }

        catch (error) {

          console.error(
            'StormVector refresh failed:',
            error
          );

        }

        setTimeout(
          () =>
            speakSegment(0),
          1800
        );

      },
      2800
    );

    return;

  }

  liveSegIdx =
    index;

  const text =
    liveSegments[index];

  const isAndroid =
    /Android/i.test(
      navigator.userAgent
    );

  const utter =
    new SpeechSynthesisUtterance(
      renderForSpeech(
        text
      )
    );

  if (liveVoice) {

    utter.voice =
      liveVoice;

  }

  utter.rate =
    isAndroid
      ? 0.93
      : 0.97;

  utter.pitch = 1;

  utter.volume = 1;

  utter.onstart =
    () => {

      duckMusic();

      setLiveBadge(
        'LIVE'
      );

      setRobotSpeaking(
        true
      );

      setCaption(text);

    };

  utter.onend =
    () => {

      setRobotSpeaking(
        false
      );

      if (liveMuted) {
        return;
      }

      /*
        Let the theme breathe slightly between
        sentences instead of hard-cutting it.
      */

      setMusicVolume(
        0.10,
        180
      );

      const pause =

        text.length > 170
          ? 650

          : text.length > 100
            ? 480

            : 340;

      setTimeout(
        () =>
          speakSegment(
            index + 1
          ),
        pause
      );

    };

  utter.onerror =
    event => {

      console.warn(
        'StormVector speech error:',
        event
      );

      setRobotSpeaking(
        false
      );

      if (!liveMuted) {

        setTimeout(
          () =>
            speakSegment(
              index + 1
            ),
          400
        );

      }

    };

  setTimeout(
    () =>
      speechSynthesis.speak(
        utter
      ),
    isAndroid
      ? 80
      : 30
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

    if (!liveMuted) {

      requestWakeLock();

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

      card.innerHTML =
        '<span class="live-location-icon">📍</span><span class="live-location-text">Locating…</span>';

    }

    if (button) {

      button.disabled =
        true;

      button.textContent =
        'Preparing…';

    }

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

    try {

      speechSynthesis.cancel();

    }

    catch (_) {}

    stopSevereWatch();

    stopSpeechKeepAlive();

    releaseWakeLock();

    if (liveMusic) {

      try {

        liveMusic.pause();

      }

      catch (_) {}

    }

  }
);