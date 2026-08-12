/* ═══════════════════════════════════════════════════════
   STORMVECTOR LIVE — VECTOR BROADCAST ENGINE
   Version: Smooth Broadcast / iPhone Friendly

   FEATURES
   • Location requested only after user taps Go Live
   • Unlocks BOTH music and speech during that tap
   • Uses stormvector-theme.mp3
   • Smooth music ducking under Vector
   • Natural sentence transitions
   • Shorter / cleaner NWS forecast language
   • Different rundown every broadcast loop
   • Remembers changing weather values
   • Animated Vector speaking state
   • Watches for new severe weather alerts
   • Breaking weather interruption
═══════════════════════════════════════════════════════ */


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
let liveStarted = false;
let startupRunning = false;

let liveMusic = null;
let musicFadeFrame = null;

let broadcastLoopCount = 0;

let locationReady = false;

let speechKeepAlive = null;
let wakeLock = null;

let breakingWeatherActive = false;
let severeWatchTimer = null;

let speechGeneration = 0;

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
   SHARED.JS FALLBACKS
════════════════════════════════════════════════ */

(function installFallbacks() {

  const install = (name, fn) => {

    if (typeof window[name] !== 'function') {
      window[name] = fn;
    }

  };


  install(
    'setBgMode',
    () => {}
  );


  install(
    'setDaytime',
    () => {}
  );


  install(
    'degToCompass',
    deg => {

      if (
        deg === null ||
        deg === undefined ||
        Number.isNaN(Number(deg))
      ) {
        return '';
      }

      const dirs = [
        'N',
        'NNE',
        'NE',
        'ENE',
        'E',
        'ESE',
        'SE',
        'SSE',
        'S',
        'SSW',
        'SW',
        'WSW',
        'W',
        'WNW',
        'NW',
        'NNW'
      ];

      return dirs[
        Math.round(Number(deg) / 22.5) % 16
      ];

    }
  );


  install(
    'dewLabel',
    dewF => {

      if (
        dewF === null ||
        dewF === undefined
      ) {
        return '';
      }

      if (dewF < 50) {
        return 'very comfortable';
      }

      if (dewF < 60) {
        return 'comfortable';
      }

      if (dewF < 65) {
        return 'a little sticky';
      }

      if (dewF < 70) {
        return 'muggy';
      }

      if (dewF < 75) {
        return 'oppressive';
      }

      return 'very humid';

    }
  );


  install(
    'alertPriorityScore',
    event => {

      const text =
        String(event || '')
          .toLowerCase();

      const order = [
        ['tornado emergency', 0],
        ['tornado warning', 1],
        ['flash flood emergency', 2],
        ['severe thunderstorm warning', 3],
        ['flash flood warning', 4],
        ['tornado watch', 5],
        ['severe thunderstorm watch', 6],
        ['flood warning', 7],
        ['blizzard warning', 8],
        ['ice storm warning', 9],
        ['winter storm warning', 10],
        ['high wind warning', 11],
        ['excessive heat warning', 12],
        ['winter weather advisory', 13],
        ['wind advisory', 14],
        ['heat advisory', 15]
      ];

      for (const [needle, score] of order) {

        if (text.includes(needle)) {
          return score;
        }

      }

      return 50;

    }
  );


  install(
    'isTornadoLevel',
    event =>
      /tornado warning|tornado emergency/i
        .test(event || '')
  );


  install(
    'parseMovement',
    description => {

      const text =
        String(description || '');

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
  );

})();


/* ════════════════════════════════════════════════
   MENU
════════════════════════════════════════════════ */

function toggleMenu() {

  const panel =
    document.getElementById('menuPanel');

  const button =
    document.getElementById('menuBtn');

  if (!panel) {
    return;
  }

  const opening =
    !panel.classList.contains('open');

  panel.classList.toggle(
    'open',
    opening
  );

  button?.setAttribute(
    'aria-expanded',
    String(opening)
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

    document
      .getElementById('menuPanel')
      ?.classList
      .remove('open');

    document
      .getElementById('menuBtn')
      ?.setAttribute(
        'aria-expanded',
        'false'
      );

  }
);


/* ════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════ */

async function safeFetch(
  url,
  options = {}
) {

  const {
    timeout = 10000,
    ...rest
  } = options;

  const controller =
    new AbortController();

  const timeoutId =
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

    clearTimeout(
      timeoutId
    );

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


function wait(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}


function capitalize(text) {

  text =
    String(text || '');

  if (!text) {
    return '';
  }

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
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

  let options =
    pool
      .map((_, index) => index)
      .filter(
        index =>
          !used.has(index)
      );

  if (!options.length) {

    used.clear();

    options =
      pool.map(
        (_, index) => index
      );

  }

  const chosen =
    options[
      Math.floor(
        Math.random() *
        options.length
      )
    ];

  used.add(chosen);

  return pool[chosen];

}


function fill(
  template,
  values
) {

  return String(template)
    .replace(
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


function polishSegments(
  segments
) {

  const seen =
    new Set();

  return segments
    .map(
      text =>
        String(text || '')
          .replace(/\s+/g, ' ')
          .replace(/\s+\./g, '.')
          .trim()
    )
    .filter(Boolean)
    .filter(
      text => {

        const key =
          text.toLowerCase();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;

      }
    );

}


/* ════════════════════════════════════════════════
   SPEECH TEXT CLEANUP
════════════════════════════════════════════════ */

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
      /\bmph\b/gi,
      'miles per hour'
    )

    .replace(
      /°F/g,
      ' degrees'
    )

    .replace(
      /%/g,
      ' percent'
    );

}


function cleanForecastText(
  text
) {

  if (!text) {
    return null;
  }

  let cleaned =
    String(text)
      .replace(/\s+/g, ' ')
      .trim();

  /*
    Remove a few phrases that sound fine
    in written NWS products but awkward
    when read aloud by Vector.
  */

  cleaned =
    cleaned
      .replace(
        /^Tonight:\s*/i,
        ''
      )
      .replace(
        /^Today:\s*/i,
        ''
      )
      .replace(
        /^This Afternoon:\s*/i,
        ''
      )
      .replace(
        /\bChance of precipitation is\b/gi,
        'Rain chances are'
      )
      .replace(
        /\bNew precipitation amounts of less than a tenth of an inch possible\.?/gi,
        ''
      )
      .replace(
        /\bNew precipitation amounts between .*? possible\.?/gi,
        ''
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();


  /*
    Keep Vector from reading a massive forecast
    paragraph in one breath.
  */

  const sentences =
    cleaned.match(
      /[^.!?]+[.!?]?/g
    ) || [cleaned];


  return sentences
    .slice(0, 3)
    .join(' ')
    .trim();

}


/* ════════════════════════════════════════════════
   WEATHER LANGUAGE
════════════════════════════════════════════════ */

function weatherCodePhrase(
  code
) {

  if ([95,96,99].includes(code)) {
    return 'thunderstorms';
  }

  if ([71,73,75,77,85,86].includes(code)) {
    return 'snow';
  }

  if ([61,63,65,80,81,82].includes(code)) {
    return 'rain showers';
  }

  if ([56,57,66,67].includes(code)) {
    return 'freezing precipitation';
  }

  if ([51,53,55].includes(code)) {
    return 'drizzle';
  }

  if ([45,48].includes(code)) {
    return 'fog';
  }

  return null;

}


function skyDescription(
  code
) {

  if (code === 0) {
    return 'clear skies';
  }

  if (code === 1) {
    return 'mostly clear skies';
  }

  if (code === 2) {
    return 'partly cloudy skies';
  }

  if (code === 3) {
    return 'mostly cloudy skies';
  }

  if ([45,48].includes(code)) {
    return 'foggy conditions';
  }

  return weatherCodePhrase(code);

}


/* ════════════════════════════════════════════════
   PHRASE BANKS
════════════════════════════════════════════════ */

const PHRASES = {

  firstOpeners: [

    "You're watching StormVector Live. I'm Vector.",

    "StormVector Live is on the air. Vector here.",

    "Welcome in. I'm Vector, and I've got your local weather.",

    "This is StormVector Live. Let's get you caught up."

  ],


  continuingOpeners: [

    "Let's check back in.",

    "Here's what's changed since the last update.",

    "Back with another weather check.",

    "Let's bring the latest conditions back up.",

    "Time for another look at the weather."

  ],


  steadyOpeners: [

    "Not a lot has changed, but here's where things stand.",

    "Conditions are holding fairly steady.",

    "The overall weather picture hasn't changed much.",

    "Things are fairly steady right now, so here's the quick update."

  ],


  currentFirst: [

    "Right now it's {tempF} degrees{feelsClause}.",

    "We're sitting at {tempF} degrees right now{feelsClause}.",

    "Current temperature is {tempF} degrees{feelsClause}.",

    "Outside right now, we're around {tempF} degrees{feelsClause}."

  ],


  currentWarmer: [

    "We've warmed up since the last check. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have climbed {difference}, putting us at {tempF} degrees{feelsClause}.",

    "It's a little warmer now, up to {tempF} degrees{feelsClause}."

  ],


  currentCooler: [

    "We've cooled off since the last check. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have dropped {difference}, bringing us down to {tempF} degrees{feelsClause}.",

    "It's a little cooler now, sitting at {tempF} degrees{feelsClause}."

  ],


  currentSteady: [

    "Temperature hasn't really moved. We're still around {tempF} degrees{feelsClause}.",

    "We're holding pretty steady near {tempF} degrees{feelsClause}.",

    "Not much movement in the temperature. We're still at about {tempF} degrees{feelsClause}."

  ],


  conditions: [

    "We're seeing {condition} around the area.",

    "The current weather picture includes {condition}.",

    "Outside, we've got {condition} right now."

  ],


  wind: [

    "Wind is out of the {direction} at {speed} miles per hour{gustClause}.",

    "We've got a {direction} wind around {speed} miles per hour{gustClause}.",

    "Winds are running from the {direction} at about {speed} miles per hour{gustClause}."

  ],


  humidity: [

    "The dew point is {dewF}, so the air feels {dewLabel}.",

    "Humidity is around {humidity} percent, with a dew point of {dewF}.",

    "Moisture-wise, the dew point is around {dewF}, putting us in the {dewLabel} range."

  ],


  forecastTransitions: [

    "Looking ahead,",

    "As we go through the rest of the day,",

    "For the next several hours,",

    "Here's how the forecast shapes up,"

  ],


  tonightTransitions: [

    "Heading into tonight,",

    "For tonight,",

    "Later tonight,",

    "Once we get into tonight,"

  ],


  quiet: [

    "Overall, it's a pretty quiet weather setup.",

    "There isn't much weather drama locally at the moment.",

    "This is a fairly calm stretch for the area.",

    "Locally, things are pretty uneventful weather-wise right now."

  ],


  closers: [

    "That's where things stand. I'll keep watching for anything that changes.",

    "That's the latest for now. I'll check everything again in a few minutes.",

    "That's your StormVector update. I'll keep the weather moving from here.",

    "That's the latest look. I'll be back when there's something new to talk about."

  ],


  severeClosers: [

    "I'll keep that alert at the top of the coverage. Stay weather-aware.",

    "Keep a way to receive warnings nearby. I'll continue watching this closely.",

    "That threat stays our priority. I'll update you as soon as anything changes."

  ],


  trivia: [

    "While things are quiet, here's one weather fact. Lightning can strike the same place more than once.",

    "Here's a quick weather fact. Sun dogs form when sunlight passes through ice crystals high in the atmosphere.",

    "A quick weather fact while we have a calm moment. Hail can fall even when temperatures at ground level are warm."

  ]

};


/* ════════════════════════════════════════════════
   LOCATION
════════════════════════════════════════════════ */

function setLocationText(
  text
) {

  const nested =
    document.querySelector(
      '#liveLocationCard .live-location-text'
    );

  if (nested) {

    nested.textContent =
      text;

    return;

  }


  const card =
    document.getElementById(
      'liveLocationCard'
    );

  if (card) {

    card.textContent =
      text;

  }

}


function geolocationErrorMessage(
  error
) {

  if (!error) {
    return 'StormVector could not get your location.';
  }

  switch (error.code) {

    case 1:

      return 'Location access is blocked. Allow location for StormVector in your browser settings and try again.';


    case 2:

      return 'Your device could not determine its current location.';


    case 3:

      return 'The location request timed out. Tap the button to try again.';


    default:

      return 'StormVector could not get your location.';

  }

}


function requestCurrentLocation() {

  return new Promise(
    (resolve, reject) => {

      if (!('geolocation' in navigator)) {

        reject(
          new Error(
            'This browser does not support location services.'
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

            locationReady =
              true;

            resolve(position);

          },


          error => {

            locationReady =
              false;

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
            timeout: 15000,
            maximumAge: 0
          }

        );

    }
  );

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
      'StormVector alerts failed:',
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
            Accept: 'application/geo+json'
          }
        }
      );


    const data =
      await response.json();

    const properties =
      data.properties || {};

    const relativeLocation =
      properties
        .relativeLocation
        ?.properties;


    const cityState =

      relativeLocation?.city &&
      relativeLocation?.state

        ? `${relativeLocation.city}, ${relativeLocation.state}`

        : null;


    let today =
      null;

    let tonight =
      null;


    if (properties.forecast) {

      try {

        const forecastResponse =
          await safeFetch(
            properties.forecast,
            {
              timeout: 10000,
              headers: {
                Accept: 'application/geo+json'
              }
            }
          );


        const forecastData =
          await forecastResponse.json();


        const periods =
          forecastData
            .properties
            ?.periods || [];


        const now =
          new Date();


        const currentPeriod =

          periods.find(
            period => {

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

            }
          ) || periods[0];


        const nightPeriod =
          periods.find(
            period =>
              !period.isDaytime &&
              new Date(
                period.endTime
              ) > now
          );


        today =
          cleanForecastText(
            currentPeriod?.detailedForecast ||
            currentPeriod?.shortForecast
          );


        tonight =
          cleanForecastText(
            nightPeriod?.detailedForecast ||
            nightPeriod?.shortForecast
          );

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
      'StormVector NWS location failed:',
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
    value => {

      if (!value) {
        return null;
      }

      return new Date(value)
        .toLocaleTimeString(
          [],
          {
            hour: 'numeric',
            minute: '2-digit'
          }
        );

    };


  return {

    tempF:
      current.temperature_2m !== undefined
        ? Math.round(current.temperature_2m)
        : null,


    feelsF:
      current.apparent_temperature !== undefined
        ? Math.round(current.apparent_temperature)
        : null,


    humidity:
      current.relative_humidity_2m !== undefined
        ? Math.round(current.relative_humidity_2m)
        : null,


    dewF:
      current.dew_point_2m !== undefined
        ? Math.round(current.dew_point_2m)
        : null,


    wcode:
      current.weather_code !== undefined
        ? current.weather_code
        : null,


    windSpd:
      current.wind_speed_10m !== undefined
        ? Math.round(current.wind_speed_10m)
        : 0,


    windDeg:
      current.wind_direction_10m !== undefined
        ? current.wind_direction_10m
        : 0,


    windG:
      current.wind_gusts_10m !== undefined
        ? Math.round(current.wind_gusts_10m)
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
   SPC DAY 1 OUTLOOK
════════════════════════════════════════════════ */

function pointInRing(
  point,
  ring
) {

  let inside =
    false;

  for (
    let i = 0,
        j = ring.length - 1;

    i < ring.length;

    j = i++
  ) {

    const xi =
      ring[i][0];

    const yi =
      ring[i][1];

    const xj =
      ring[j][0];

    const yj =
      ring[j][1];


    const intersects =

      (
        yi > point[1]
      ) !==
      (
        yj > point[1]
      )

      &&

      point[0] <
      (
        (xj - xi) *
        (point[1] - yi) /
        (yj - yi)
      ) +
      xi;


    if (intersects) {

      inside =
        !inside;

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

  if (!geometry) {
    return false;
  }


  if (
    geometry.type ===
    'Polygon'
  ) {

    return pointInPolygon(
      point,
      geometry.coordinates
    );

  }


  if (
    geometry.type ===
    'MultiPolygon'
  ) {

    return geometry.coordinates
      .some(
        polygon =>
          pointInPolygon(
            point,
            polygon
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


      let best =
        null;


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

            best =
              label;

          }

        }

      }


      return best;

    }

    catch (error) {

      console.warn(
        'StormVector SPC request failed:',
        error
      );

    }

  }


  return null;

}


/* ════════════════════════════════════════════════
   UI
════════════════════════════════════════════════ */

function renderConditionsRow(
  ctx
) {

  const row =
    document.getElementById(
      'liveConditionsRow'
    );

  if (!row) {
    return;
  }


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

  ]
  .join('');

}


function setBroadcastBg(
  ctx
) {

  if (
    ctx.alerts.some(
      alert =>
        window.isTornadoLevel(
          alert.properties?.event || ''
        )
    )
  ) {

    window.setBgMode(
      'tornado'
    );

    return;

  }


  if ([95,96,99].includes(ctx.wcode)) {

    window.setBgMode('storm');

  }

  else if (
    [71,73,75,77,85,86]
      .includes(ctx.wcode)
  ) {

    window.setBgMode('snow');

  }

  else if (
    [45,48]
      .includes(ctx.wcode)
  ) {

    window.setBgMode('fog');

  }

  else if (
    [51,53,55,61,63,65,80,81,82]
      .includes(ctx.wcode)
  ) {

    window.setBgMode('rain');

  }

  else if (ctx.wcode === 1) {

    window.setBgMode(
      'partlycloudy'
    );

  }

  else if (
    [2,3]
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


function setRobotSpeaking(
  speaking
) {

  document
    .getElementById('liveAvatar')
    ?.classList
    .toggle(
      'speaking',
      speaking
    );


  document.body
    .classList
    .toggle(
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
   BROADCAST SCRIPT BUILDERS
════════════════════════════════════════════════ */

function addCurrentConditions(
  segments,
  ctx
) {

  if (ctx.tempF === null) {

    segments.push(
      "I'm still waiting on the latest temperature, but the rest of the weather data is coming through."
    );

    return;

  }


  const oldTemp =
    spokenFactMemory.get('temperature');


  const oldFeels =
    spokenFactMemory.get('feels');


  const feelsClause =

    ctx.feelsF !== null &&

    Math.abs(
      ctx.feelsF -
      ctx.tempF
    ) >= 3 &&

    (
      oldFeels === undefined ||
      oldFeels !== ctx.feelsF ||
      broadcastLoopCount === 0
    )

      ? `, and it feels closer to ${ctx.feelsF}`

      : '';


  if (oldTemp === undefined) {

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
    oldTemp
  ) {

    const difference =
      ctx.tempF -
      oldTemp;

    segments.push(
      pickFilled(
        PHRASES.currentWarmer,
        'current-warmer',
        {

          tempF:
            ctx.tempF,

          feelsClause,

          difference:
            difference === 1
              ? 'one degree'
              : `${difference} degrees`

        }
      )
    );

  }


  else if (
    ctx.tempF <
    oldTemp
  ) {

    const difference =
      oldTemp -
      ctx.tempF;

    segments.push(
      pickFilled(
        PHRASES.currentCooler,
        'current-cooler',
        {

          tempF:
            ctx.tempF,

          feelsClause,

          difference:
            difference === 1
              ? 'one degree'
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

          tempF:
            ctx.tempF,

          feelsClause

        }
      )
    );

  }


  const condition =
    skyDescription(
      ctx.wcode
    );


  const previousCode =
    spokenFactMemory.get(
      'weatherCode'
    );


  if (
    condition &&
    (
      broadcastLoopCount === 0 ||
      previousCode !== ctx.wcode ||
      broadcastLoopCount % 3 === 0
    )
  ) {

    segments.push(
      pickFilled(
        PHRASES.conditions,
        'conditions',
        {
          condition
        }
      )
    );

  }


  spokenFactMemory.set(
    'temperature',
    ctx.tempF
  );


  spokenFactMemory.set(
    'feels',
    ctx.feelsF
  );


  spokenFactMemory.set(
    'weatherCode',
    ctx.wcode
  );

}


function addWind(
  segments,
  ctx,
  force = false
) {

  if (
    !force &&
    ctx.windSpd < 7 &&
    ctx.windG < 12
  ) {

    return;

  }


  const previousWind =
    spokenFactMemory.get(
      'windSpeed'
    );


  /*
    If wind is exactly the same, don't repeat
    it every single loop unless it matters.
  */

  if (
    !force &&
    broadcastLoopCount > 0 &&
    previousWind === ctx.windSpd &&
    broadcastLoopCount % 3 !== 0
  ) {

    return;

  }


  const direction =
    window.degToCompass(
      ctx.windDeg
    ) || 'variable';


  const gustClause =
    ctx.windG >
    ctx.windSpd + 5

      ? `, with gusts near ${ctx.windG}`

      : '';


  segments.push(
    pickFilled(
      PHRASES.wind,
      'wind',
      {
        direction,
        speed: ctx.windSpd,
        gustClause
      }
    )
  );


  if (
    ctx.windG >= 40
  ) {

    segments.push(
      'Those gusts are strong enough to move loose outdoor objects and make driving tougher for high-profile vehicles.'
    );

  }


  spokenFactMemory.set(
    'windSpeed',
    ctx.windSpd
  );

}


function addHumidity(
  segments,
  ctx
) {

  if (ctx.dewF === null) {
    return;
  }


  const oldDew =
    spokenFactMemory.get(
      'dewPoint'
    );


  if (
    broadcastLoopCount > 0 &&
    oldDew === ctx.dewF &&
    broadcastLoopCount % 4 !== 2
  ) {

    return;

  }


  segments.push(
    pickFilled(
      PHRASES.humidity,
      'humidity',
      {

        humidity:
          ctx.humidity ?? 'unknown',

        dewF:
          ctx.dewF,

        dewLabel:
          window.dewLabel(
            ctx.dewF
          )

      }
    )
  );


  spokenFactMemory.set(
    'dewPoint',
    ctx.dewF
  );

}


function addAlerts(
  segments,
  alerts
) {

  if (!alerts.length) {

    if (broadcastLoopCount === 0) {

      segments.push(
        'There are no active National Weather Service alerts for your location right now.'
      );

    }

    return;

  }


  const sorted =
    [...alerts]
      .sort(
        (a,b) =>
          window.alertPriorityScore(
            a.properties?.event || ''
          ) -
          window.alertPriorityScore(
            b.properties?.event || ''
          )
      );


  sorted
    .slice(0,2)
    .forEach(
      alert => {

        const properties =
          alert.properties || {};


        const area =
          (
            properties.areaDesc ||
            'your area'
          )
          .split(';')[0];


        let expiration =
          '';


        if (properties.expires) {

          try {

            expiration =
              new Date(
                properties.expires
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
          `A ${properties.event || 'weather alert'} is in effect for ${area}${expiration ? ` until ${expiration}` : ''}.`
        );


        const movement =
          window.parseMovement(
            properties.description || ''
          );


        if (movement) {

          segments.push(
            `That storm is moving ${movement.dir} at ${movement.spd} miles per hour.`
          );

        }

      }
    );

}


function addSpc(
  segments,
  spc
) {

  const labels = {

    TSTM:
      'a general thunderstorm risk',

    MRGL:
      'a marginal risk for severe storms',

    SLGT:
      'a slight risk for severe storms',

    ENH:
      'an enhanced risk for severe storms',

    MDT:
      'a moderate risk for severe storms',

    HIGH:
      'a high risk for severe storms'

  };


  if (!labels[spc]) {
    return;
  }


  const previous =
    spokenFactMemory.get(
      'spcRisk'
    );


  if (
    broadcastLoopCount > 0 &&
    previous === spc &&
    broadcastLoopCount % 4 !== 1
  ) {

    return;

  }


  segments.push(
    `The Storm Prediction Center has your location under ${labels[spc]} today.`
  );


  if (
    SPC_RANK[spc] >=
    SPC_RANK.ENH
  ) {

    segments.push(
      'That's a meaningful severe weather signal, so I'll keep it near the top of the broadcast.'
    );

  }


  spokenFactMemory.set(
    'spcRisk',
    spc
  );

}


function addTodayForecast(
  segments,
  ctx
) {

  if (!ctx.forecast?.today) {
    return;
  }


  segments.push(
    `${pickPhrase(
      PHRASES.forecastTransitions,
      'forecast-transition'
    )} ${ctx.forecast.today}`
  );

}


function addTonightForecast(
  segments,
  ctx
) {

  if (!ctx.forecast?.tonight) {
    return;
  }


  segments.push(
    `${pickPhrase(
      PHRASES.tonightTransitions,
      'tonight-transition'
    )} ${ctx.forecast.tonight}`
  );

}


/* ════════════════════════════════════════════════
   BUILD BROADCAST
════════════════════════════════════════════════ */

function buildScript(
  ctx
) {

  const segments =
    [];


  const warnings =
    ctx.alerts.filter(
      alert =>
        /Warning|Emergency/i
          .test(
            alert.properties?.event || ''
          )
    );


  const watches =
    ctx.alerts.filter(
      alert =>
        /Watch/i
          .test(
            alert.properties?.event || ''
          )
    );


  const severeMode =
    warnings.length > 0 ||
    watches.length > 0;


  const cityText =
    ctx.cityState
      ? ` in ${ctx.cityState}`
      : ' in your area';


  /*
    FIRST PASS
  */

  if (broadcastLoopCount === 0) {

    segments.push(
      pickPhrase(
        PHRASES.firstOpeners,
        'first-openers'
      )
    );


    if (warnings.length) {

      segments.push(
        `We have active warning information${cityText}, so that's where we're starting.`
      );

    }

    else {

      segments.push(
        `Here's the weather picture${cityText}.`
      );

    }

  }


  /*
    SUBSEQUENT PASSES
  */

  else {

    const oldTemp =
      spokenFactMemory.get(
        'temperature'
      );


    const oldAlertCount =
      spokenFactMemory.get(
        'alertCount'
      );


    const somethingChanged =

      (
        oldTemp !== undefined &&
        oldTemp !== ctx.tempF
      )

      ||

      (
        oldAlertCount !== undefined &&
        oldAlertCount !== ctx.alerts.length
      );


    segments.push(
      pickPhrase(

        somethingChanged
          ? PHRASES.continuingOpeners
          : PHRASES.steadyOpeners,

        somethingChanged
          ? 'continuing-openers'
          : 'steady-openers'

      )
    );

  }


  spokenFactMemory.set(
    'alertCount',
    ctx.alerts.length
  );


  /*
    SEVERE WEATHER MODE
  */

  if (severeMode) {

    addAlerts(
      segments,
      ctx.alerts
    );


    addCurrentConditions(
      segments,
      ctx
    );


    addWind(
      segments,
      ctx,
      true
    );


    addSpc(
      segments,
      ctx.spc
    );


    addTodayForecast(
      segments,
      ctx
    );


    segments.push(
      pickPhrase(
        PHRASES.severeClosers,
        'severe-closers'
      )
    );

  }


  /*
    NORMAL WEATHER MODE
  */

  else {

    const rotation =
      broadcastLoopCount % 5;


    /*
      LOOP 1:
      Current conditions + main forecast
    */

    if (rotation === 0) {

      addCurrentConditions(
        segments,
        ctx
      );


      if (
        ctx.windSpd >= 12 ||
        ctx.windG >= 20
      ) {

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


    /*
      LOOP 2:
      Conditions + tonight + SPC
    */

    else if (rotation === 1) {

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


    /*
      LOOP 3:
      Conditions + comfort + wind
    */

    else if (rotation === 2) {

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
          `Sunset comes around ${ctx.sunset} this evening.`
        );

      }

    }


    /*
      LOOP 4:
      Forecast-heavy update
    */

    else if (rotation === 3) {

      addCurrentConditions(
        segments,
        ctx
      );


      addTodayForecast(
        segments,
        ctx
      );


      addTonightForecast(
        segments,
        ctx
      );

    }


    /*
      LOOP 5:
      Short conversational check
    */

    else {

      addCurrentConditions(
        segments,
        ctx
      );


      const quiet =
        !weatherCodePhrase(
          ctx.wcode
        ) &&
        ctx.windSpd < 15;


      if (quiet) {

        segments.push(
          pickPhrase(
            PHRASES.quiet,
            'quiet'
          )
        );


        segments.push(
          pickPhrase(
            PHRASES.trivia,
            'trivia'
          )
        );

      }

      else {

        addWind(
          segments,
          ctx
        );


        addSpc(
          segments,
          ctx.spc
        );

      }

    }


    segments.push(
      pickPhrase(
        PHRASES.closers,
        'normal-closers'
      )
    );

  }


  liveSegments =
    polishSegments(
      segments
    );


  liveSegIdx =
    0;


  console.log(
    'StormVector rundown:',
    liveSegments
  );

}


/* ════════════════════════════════════════════════
   PREPARE WEATHER
════════════════════════════════════════════════ */

async function prepareBroadcast() {

  if (
    !locationReady ||
    liveLat === null ||
    liveLon === null
  ) {

    throw new Error(
      'StormVector does not have a location yet.'
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
      .catch(
        error => {

          console.warn(
            'StormVector Open-Meteo failed:',
            error
          );

          return {};

        }
      ),


      fetchAlerts(
        liveLat,
        liveLon
      ),


      fetchSpcOutlook(
        liveLat,
        liveLon
      )
      .catch(
        () => null
      )

    ]);


  liveCityState =
    nws.cityState;


  setLocationText(

    liveCityState ||

    `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`

  );


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
      alerts ||
      [],


    forecast:
      nws.forecast ||
      {
        today: null,
        tonight: null
      },


    spc:
      spc ||
      null

  };


  /*
    Alerts that already exist when the page starts
    should NOT trigger a fake "new alert" interrupt.
  */

  if (broadcastLoopCount === 0) {

    ctx.alerts.forEach(
      alert => {

        if (
          /Warning|Watch|Emergency/i
            .test(
              alert.properties?.event || ''
            )
        ) {

          knownPriorityAlertIds
            .add(
              alert.id
            );

        }

      }
    );

  }


  renderConditionsRow(
    ctx
  );


  setBroadcastBg(
    ctx
  );


  buildScript(
    ctx
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

    voices.find(
      voice =>
        /en-US/i.test(
          voice.lang
        ) &&
        /Daniel|Aaron|David|Alex|Tom/i.test(
          voice.name
        )
    )

    ||

    voices.find(
      voice =>
        /en-US/i.test(
          voice.lang
        )
    )

    ||

    voices.find(
      voice =>
        /^en/i.test(
          voice.lang
        )
    )

    ||

    voices[0]

    ||

    null;


  console.log(
    'StormVector voice:',
    liveVoice?.name || 'default'
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
   AUDIO UNLOCK
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
    Do NOT reset currentTime every time
    ensureLiveMusicElement gets called.
  */

  if (
    !liveMusic.getAttribute('src')
  ) {

    liveMusic.src =
      './stormvector-theme.mp3';

  }


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


/*
  CRITICAL iPHONE FIX:

  This function is called immediately from
  the user's button tap BEFORE geolocation
  and API calls.

  That keeps Safari's user interaction
  permission alive for our audio.
*/

function unlockMediaFromUserGesture() {

  const music =
    ensureLiveMusicElement();


  try {

    music.volume =
      0;


    const playPromise =
      music.play();


    if (
      playPromise &&
      typeof playPromise.catch ===
      'function'
    ) {

      playPromise.catch(
        error =>
          console.warn(
            'StormVector music unlock:',
            error
          )
      );

    }

  }

  catch (error) {

    console.warn(
      'StormVector music unlock failed:',
      error
    );

  }


  /*
    Prime speechSynthesis during the same
    user interaction.

    Volume = 0, so nothing is heard.
  */

  if (
    'speechSynthesis' in window
  ) {

    try {

      speechSynthesis.cancel();


      const primer =
        new SpeechSynthesisUtterance(
          ' '
        );


      primer.volume =
        0;


      primer.rate =
        1;


      if (liveVoice) {

        primer.voice =
          liveVoice;

      }


      speechSynthesis.speak(
        primer
      );

    }

    catch (error) {

      console.warn(
        'StormVector speech unlock failed:',
        error
      );

    }

  }

}


/* ════════════════════════════════════════════════
   MUSIC MIXER
════════════════════════════════════════════════ */

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
            ) /
            duration,
            0,
            1
          );


    /*
      Ease instead of a perfectly linear fade.
    */

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

    }

    else {

      musicFadeFrame =
        null;

    }

  }


  musicFadeFrame =
    requestAnimationFrame(
      frame
    );

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
      1100
    );

  }

  catch (error) {

    console.warn(
      'StormVector music playback failed:',
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
    0.045,
    300
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
    240
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
    700
  );

}


function stopMusic(
  reset = false
) {

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


      if (reset) {

        liveMusic.currentTime =
          0;

      }

    },
    340
  );

}


/* ════════════════════════════════════════════════
   SPEECH ENGINE
════════════════════════════════════════════════ */

function createUtterance(
  text
) {

  const utterance =
    new SpeechSynthesisUtterance(
      renderForSpeech(
        text
      )
    );


  if (liveVoice) {

    utterance.voice =
      liveVoice;

  }


  const isiPhone =
    /iPhone|iPad|iPod/i
      .test(
        navigator.userAgent
      );


  const isAndroid =
    /Android/i
      .test(
        navigator.userAgent
      );


  /*
    Slightly slower than before.

    Weather broadcasts sound considerably more
    natural when the device TTS isn't rushing.
  */

  utterance.rate =
    isiPhone
      ? 0.93
      : isAndroid
        ? 0.92
        : 0.96;


  utterance.pitch =
    1;


  utterance.volume =
    1;


  return utterance;

}


/* ════════════════════════════════════════════════
   PLAY ONE SEGMENT
════════════════════════════════════════════════ */

function speakSegment(
  index
) {

  if (
    breakingWeatherActive ||
    liveMuted
  ) {
    return;
  }


  if (
    !liveSegments.length
  ) {
    return;
  }


  /*
    Rundown finished.
  */

  if (
    index >=
    liveSegments.length
  ) {

    finishBroadcastLoop();

    return;

  }


  liveSegIdx =
    index;


  const text =
    liveSegments[index];


  const generation =
    speechGeneration;


  const utterance =
    createUtterance(
      text
    );


  utterance.onstart =
    () => {

      if (
        generation !==
        speechGeneration
      ) {
        return;
      }


      duckMusic();


      setLiveBadge(
        'LIVE'
      );


      setRobotSpeaking(
        true
      );


      setCaption(
        text
      );

    };


  utterance.onend =
    () => {

      if (
        generation !==
        speechGeneration
      ) {
        return;
      }


      setRobotSpeaking(
        false
      );


      if (
        liveMuted ||
        breakingWeatherActive
      ) {
        return;
      }


      sentenceBreakMusic();


      /*
        Pause depends on sentence style rather
        than just text length.
      */

      let pause =
        420;


      if (
        /warning|watch|emergency/i
          .test(text)
      ) {

        pause =
          600;

      }

      else if (
        text.length >
        220
      ) {

        pause =
          650;

      }

      else if (
        text.length <
        70
      ) {

        pause =
          330;

      }


      setTimeout(
        () => {

          if (
            generation ===
            speechGeneration &&
            !liveMuted &&
            !breakingWeatherActive
          ) {

            speakSegment(
              index + 1
            );

          }

        },
        pause
      );

    };


  utterance.onerror =
    event => {

      console.warn(
        'StormVector speech error:',
        event
      );


      if (
        generation !==
        speechGeneration
      ) {
        return;
      }


      setRobotSpeaking(
        false
      );


      setTimeout(
        () => {

          if (
            !liveMuted &&
            !breakingWeatherActive
          ) {

            speakSegment(
              index + 1
            );

          }

        },
        400
      );

    };


  speechSynthesis.speak(
    utterance
  );

}


/* ════════════════════════════════════════════════
   LOOP TRANSITION
════════════════════════════════════════════════ */

async function finishBroadcastLoop() {

  setRobotSpeaking(
    false
  );


  setLiveBadge(
    'CHECKING WEATHER'
  );


  restoreMusic();


  /*
    This is intentionally not immediate.

    Vector now behaves like a continuous
    weather channel instead of instantly
    restarting the same report.
  */

  await wait(
    5500
  );


  if (
    liveMuted ||
    breakingWeatherActive
  ) {
    return;
  }


  broadcastLoopCount++;


  setLiveBadge(
    'UPDATING'
  );


  try {

    await prepareBroadcast();

  }

  catch (error) {

    console.error(
      'StormVector refresh failed:',
      error
    );


    setLiveBadge(
      'RETRYING'
    );


    await wait(
      4000
    );

  }


  if (
    liveMuted ||
    breakingWeatherActive
  ) {
    return;
  }


  await wait(
    850
  );


  speakSegment(
    0
  );

}


/* ════════════════════════════════════════════════
   REPLAY / STOP / RESUME
════════════════════════════════════════════════ */

function replaySegment() {

  if (
    !liveSegments.length ||
    liveMuted
  ) {
    return;
  }


  speechGeneration++;


  speechSynthesis.cancel();


  setRobotSpeaking(
    false
  );


  setTimeout(
    () =>
      speakSegment(
        liveSegIdx
      ),
    150
  );

}


async function toggleMute() {

  const button =
    document.getElementById(
      'liveMuteBtn'
    );


  liveMuted =
    !liveMuted;


  speechGeneration++;


  if (liveMuted) {

    speechSynthesis.cancel();


    setRobotSpeaking(
      false
    );


    stopMusic(
      false
    );


    stopSevereWatch();


    stopSpeechKeepAlive();


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


  if (button) {

    button.innerHTML =
      '<span class="live-control-icon">🔇</span> Stop';

  }


  /*
    Resume is also a direct user gesture,
    so media playback is safe here.
  */

  unlockMediaFromUserGesture();


  await bringMusicUp();


  requestWakeLock();


  startSevereWatch();


  startSpeechKeepAlive();


  await wait(
    180
  );


  speakSegment(
    liveSegIdx
  );

}


/* ════════════════════════════════════════════════
   START BROADCAST
════════════════════════════════════════════════ */

async function startBroadcast() {

  if (startupRunning) {
    return;
  }


  startupRunning =
    true;


  const button =
    document.getElementById(
      'liveStartBtn'
    );


  /*
    CRITICAL:

    Do this BEFORE ANY await.

    Safari sees this function executing directly
    from the user's button press and unlocks
    both audio systems.
  */

  unlockMediaFromUserGesture();


  if (button) {

    button.disabled =
      true;

    button.textContent =
      '📍 Getting Location…';

  }


  setCaption(
    'Getting your location and loading the latest weather…'
  );


  try {

    /*
      LOCATION
    */

    if (!locationReady) {

      setLocationText(
        'Waiting for location permission…'
      );


      await requestCurrentLocation();

    }


    /*
      WEATHER
    */

    setLocationText(
      'Loading local weather…'
    );


    if (button) {

      button.textContent =
        'Loading Weather…';

    }


    await prepareBroadcast();


    /*
      SHOW LIVE PAGE
    */

    liveStarted =
      true;


    liveMuted =
      false;


    document.body
      .classList
      .add(
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
      MUSIC

      It should already technically be playing
      silently from unlockMediaFromUserGesture().
    */

    await bringMusicUp();


    requestWakeLock();


    startSevereWatch();


    startSpeechKeepAlive();


    /*
      Cancel only our silent speech primer.
    */

    speechGeneration++;


    speechSynthesis.cancel();


    setLiveBadge(
      'ON AIR'
    );


    setCaption(
      'Vector is going live…'
    );


    /*
      Give theme music a tiny intro before
      Vector begins.
    */

    await wait(
      850
    );


    speakSegment(
      0
    );

  }


  catch (error) {

    console.error(
      'StormVector startup failed:',
      error
    );


    stopMusic(
      false
    );


    setRobotSpeaking(
      false
    );


    setLiveBadge(
      'STANDBY'
    );


    setLocationText(
      error.message ||
      'Unable to start StormVector.'
    );


    setCaption(
      'StormVector could not start the local broadcast. Check location permission and try again.'
    );


    if (button) {

      button.disabled =
        false;

      button.textContent =
        '📍 Enable Location & Go Live';

    }

  }


  finally {

    startupRunning =
      false;

  }

}


/* ════════════════════════════════════════════════
   BREAKING WEATHER WATCH
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


  severeWatchTimer =
    null;

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


    const priorityAlerts =
      alerts

        .filter(
          alert =>
            /Warning|Watch|Emergency/i
              .test(
                alert.properties?.event || ''
              )
        )

        .sort(
          (a,b) =>
            window.alertPriorityScore(
              a.properties?.event || ''
            ) -
            window.alertPriorityScore(
              b.properties?.event || ''
            )
        );


    const newAlerts =
      priorityAlerts.filter(
        alert =>
          !knownPriorityAlertIds
            .has(
              alert.id
            )
      );


    priorityAlerts.forEach(
      alert =>
        knownPriorityAlertIds
          .add(
            alert.id
          )
    );


    if (newAlerts.length) {

      await interruptForBreakingWeather(
        newAlerts[0]
      );

    }

  }

  catch (error) {

    console.warn(
      'StormVector severe watch failed:',
      error
    );

  }

}


/* ════════════════════════════════════════════════
   BREAKING WEATHER TONE
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
      3.0;


    const gain =
      context.createGain();


    gain.gain.value =
      0.18;


    gain.connect(
      context.destination
    );


    [853,960].forEach(
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


    await wait(
      duration * 1000 +
      100
    );


    await context
      .close()
      .catch(() => {});

  }

  catch (error) {

    console.warn(
      'StormVector tone failed:',
      error
    );

  }

}


/* ════════════════════════════════════════════════
   BREAKING WEATHER INTERRUPT
════════════════════════════════════════════════ */

async function interruptForBreakingWeather(
  alert
) {

  breakingWeatherActive =
    true;


  speechGeneration++;


  speechSynthesis.cancel();


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

    banner.hidden =
      false;

  }


  await playAttentionTone();


  const properties =
    alert.properties || {};


  const event =
    properties.event ||
    'weather alert';


  const area =
    (
      properties.areaDesc ||
      'your area'
    )
    .split(';')[0];


  const movement =
    window.parseMovement(
      properties.description || ''
    );


  const warning =
    /Warning|Emergency/i
      .test(event);


  const messages = [

    'This is a StormVector Breaking Weather update.',


    `A ${event} has been issued for ${area}.${movement ? ` The storm is moving ${movement.dir} at ${movement.spd} miles per hour.` : ''}`,


    warning
      ? 'If you are in the warned area, take action now and follow National Weather Service instructions.'
      : 'Review your severe weather plan and be ready to act if warnings are issued.'

  ];


  await speakSequential(
    messages
  );


  try {

    await prepareBroadcast();

  }

  catch (error) {

    console.warn(
      'StormVector post-alert refresh failed:',
      error
    );

  }


  if (banner) {

    banner.hidden =
      true;

  }


  breakingWeatherActive =
    false;


  restoreMusic();


  if (!liveMuted) {

    await wait(
      700
    );


    speakSegment(
      0
    );

  }

}


/* ════════════════════════════════════════════════
   SPEAK SEQUENTIAL
════════════════════════════════════════════════ */

function speakSequential(
  messages
) {

  return new Promise(
    resolve => {

      let index =
        0;


      function next() {

        if (
          index >=
          messages.length
        ) {

          setRobotSpeaking(
            false
          );


          resolve();

          return;

        }


        const text =
          messages[index];


        const utterance =
          createUtterance(
            text
          );


        utterance.rate =
          0.92;


        utterance.onstart =
          () => {

            duckMusic();


            setRobotSpeaking(
              true
            );


            setCaption(
              text
            );

          };


        utterance.onend =
          () => {

            setRobotSpeaking(
              false
            );


            sentenceBreakMusic();


            index++;


            setTimeout(
              next,
              450
            );

          };


        utterance.onerror =
          () => {

            setRobotSpeaking(
              false
            );


            index++;


            next();

          };


        speechSynthesis.speak(
          utterance
        );

      }


      next();

    }
  );

}


/* ════════════════════════════════════════════════
   MOBILE RELIABILITY
════════════════════════════════════════════════ */

function startSpeechKeepAlive() {

  stopSpeechKeepAlive();


  /*
    Android needs this more than iOS.
    Do NOT repeatedly pause/resume iPhone speech.
  */

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


  speechKeepAlive =
    null;

}


/* ════════════════════════════════════════════════
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
        await navigator
          .wakeLock
          .request(
            'screen'
          );

    }

  }

  catch (_) {}

}


function releaseWakeLock() {

  try {

    wakeLock?.release();

  }

  catch (_) {}


  wakeLock =
    null;

}


/* ════════════════════════════════════════════════
   ACCESSIBILITY
════════════════════════════════════════════════ */

function announce(
  message
) {

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
   VISIBILITY HANDLING
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

    }

  }
);


/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    ensureLiveMusicElement();


    pickVoice();


    setLocationText(
      'Location required for local weather'
    );


    setCaption(
      'Tap Enable Location and Go Live to start your local StormVector broadcast.'
    );


    setLiveBadge(
      'STANDBY'
    );


    const button =
      document.getElementById(
        'liveStartBtn'
      );


    if (button) {

      button.disabled =
        false;


      button.textContent =
        '📍 Enable Location & Go Live';

    }

  }
);


/* ════════════════════════════════════════════════
   CLEANUP
════════════════════════════════════════════════ */

window.addEventListener(
  'beforeunload',
  () => {

    speechGeneration++;


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