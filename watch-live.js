/* ═══════════════════════════════════════════════════════
   STORMVECTOR LIVE — VECTOR BROADCAST ENGINE
   NWS OBSERVATION-FIRST VERSION

   CURRENT WEATHER PRIORITY
   1. NWS / NOAA observation station
   2. Open-Meteo fallback for missing observed fields

   FORECAST
   • NWS forecast

   SEVERE WEATHER
   • NWS alerts
   • SPC Day 1 categorical outlook

   IPHONE STARTUP
   • User taps once
   • Audio unlocks immediately
   • Vector speaks immediately
   • Location loads
   • Weather loads
   • Broadcast begins

   SPEECH
   • Safari-safe speech chunking
   • Full captions remain visible
   • Vector mouth remains animated
   • Emojis removed from spoken forecast
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

let startupSpeechPromise = null;

let currentObservationStationId = null;
let currentObservationStationName = null;
let currentObservationTime = null;

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


function nwsFetchOptions(
  timeout = 10000
) {

  return {
    timeout,
    headers: {
      Accept: 'application/geo+json'
    }
  };

}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
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


function cToF(
  value
) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {

    return null;

  }

  return Math.round(
    Number(value) *
    9 / 5 +
    32
  );

}


function kmhToMph(
  value
) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {

    return null;

  }

  return Math.round(
    Number(value) *
    0.621371
  );

}


function metersToMiles(
  value
) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {

    return null;

  }

  return Math.round(
    Number(value) /
    1609.344 *
    10
  ) / 10;

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


/* ════════════════════════════════════════════════
   TEXT CLEANUP
════════════════════════════════════════════════ */

function stripEmoji(
  text
) {

  let value =
    String(text || '');

  try {

    value =
      value.replace(
        /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu,
        ' '
      );

  }

  catch (_) {

    value =
      value.replace(
        /[\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF]/g,
        ' '
      );

  }

  return value
    .replace(/\uFE0F/g, '')
    .replace(/\u200D/g, '')
    .replace(/\s+/g, ' ')
    .trim();

}


function sanitizeBroadcastText(
  text
) {

  return stripEmoji(
    String(text || '')
  )
    .replace(/\s+/g, ' ')
    .trim();

}


function polishSegments(
  segments
) {

  const seen =
    new Set();

  return segments

    .map(
      text =>
        sanitizeBroadcastText(text)
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


function renderForSpeech(
  text
) {

  return sanitizeBroadcastText(text)

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


/* ════════════════════════════════════════════════
   FORECAST CLEANUP
════════════════════════════════════════════════ */

function cleanForecastText(
  text
) {

  if (!text) {
    return null;
  }

  let cleaned =
    stripEmoji(text)
      .replace(/\s+/g, ' ')
      .trim();


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
        /^Overnight:\s*/i,
        ''
      )

      .replace(
        /\bpatchy smoke\b/gi,
        'some wildfire smoke may be around'
      )

      .replace(
        /\bareas of smoke\b/gi,
        'wildfire smoke may be around'
      )

      .replace(
        /\bwidespread smoke\b/gi,
        'widespread wildfire smoke'
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

      .replace(/\s+/g, ' ')
      .trim();


  const sentences =
    cleaned.match(
      /[^.!?]+[.!?]?/g
    ) || [cleaned];


  return sentences
    .slice(0, 3)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

}


/* ════════════════════════════════════════════════
   SPEECH CHUNKING
════════════════════════════════════════════════ */

function splitSpeechChunks(
  text,
  maxLength = 125
) {

  const speechText =
    renderForSpeech(text)
      .replace(/\s+/g, ' ')
      .trim();


  if (!speechText) {
    return [];
  }


  if (
    speechText.length <=
    maxLength
  ) {

    return [speechText];

  }


  const sentences =
    speechText.match(
      /[^.!?]+[.!?]?/g
    ) || [speechText];


  const chunks =
    [];


  for (
    const rawSentence
    of sentences
  ) {

    const sentence =
      rawSentence.trim();


    if (!sentence) {
      continue;
    }


    if (
      sentence.length <=
      maxLength
    ) {

      chunks.push(sentence);

      continue;

    }


    const clauses =
      sentence
        .split(
          /(?<=[,;:])\s+/
        )
        .map(
          item =>
            item.trim()
        )
        .filter(Boolean);


    let working =
      '';


    for (
      const clause
      of clauses
    ) {

      const candidate =
        working
          ? `${working} ${clause}`
          : clause;


      if (
        candidate.length <=
        maxLength
      ) {

        working =
          candidate;

        continue;

      }


      if (working) {

        chunks.push(
          working
        );

        working =
          '';

      }


      if (
        clause.length >
        maxLength
      ) {

        const words =
          clause.split(/\s+/);


        let wordChunk =
          '';


        for (
          const word
          of words
        ) {

          const wordCandidate =
            wordChunk
              ? `${wordChunk} ${word}`
              : word;


          if (
            wordCandidate.length <=
            maxLength
          ) {

            wordChunk =
              wordCandidate;

          }

          else {

            if (wordChunk) {

              chunks.push(
                wordChunk
              );

            }

            wordChunk =
              word;

          }

        }


        if (wordChunk) {

          working =
            wordChunk;

        }

      }

      else {

        working =
          clause;

      }

    }


    if (working) {

      chunks.push(
        working
      );

    }

  }


  return chunks
    .map(
      chunk =>
        chunk.trim()
    )
    .filter(Boolean);

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

  return weatherCodePhrase(
    code
  );

}


function cleanObservedCondition(
  text
) {

  if (!text) {
    return null;
  }


  const cleaned =
    sanitizeBroadcastText(text)
      .replace(
        /\bFair\b/gi,
        'clear conditions'
      )
      .replace(
        /\bMostly Cloudy\b/gi,
        'mostly cloudy skies'
      )
      .replace(
        /\bPartly Cloudy\b/gi,
        'partly cloudy skies'
      )
      .replace(
        /\bOvercast\b/gi,
        'overcast skies'
      )
      .replace(
        /\bLight Rain\b/gi,
        'light rain'
      )
      .replace(
        /\bHeavy Rain\b/gi,
        'heavy rain'
      )
      .replace(
        /\bLight Snow\b/gi,
        'light snow'
      )
      .replace(
        /\bThunderstorm\b/gi,
        'thunderstorms'
      )
      .trim();


  if (!cleaned) {
    return null;
  }


  return cleaned.charAt(0).toLowerCase() +
    cleaned.slice(1);

}


/* ════════════════════════════════════════════════
   PHRASES
════════════════════════════════════════════════ */

const PHRASES = {

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

    "The latest observation has us at {tempF} degrees{feelsClause}.",

    "Right now, the latest observed temperature is {tempF} degrees{feelsClause}.",

    "We're sitting at an observed {tempF} degrees{feelsClause}.",

    "The latest weather station observation has the temperature at {tempF} degrees{feelsClause}."

  ],


  currentWarmer: [

    "The latest observation is a little warmer. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have climbed {difference}, putting the latest observation at {tempF} degrees{feelsClause}.",

    "We've warmed since the last check, with the latest observation at {tempF} degrees{feelsClause}."

  ],


  currentCooler: [

    "The latest observation is a little cooler. We're now at {tempF} degrees{feelsClause}.",

    "Temperatures have dropped {difference}, bringing the latest observation to {tempF} degrees{feelsClause}.",

    "We've cooled since the last check, with the latest observation at {tempF} degrees{feelsClause}."

  ],


  currentSteady: [

    "Temperature hasn't really moved. The latest observation is still around {tempF} degrees{feelsClause}.",

    "We're holding pretty steady near {tempF} degrees{feelsClause}.",

    "Not much movement in the temperature. The latest observation is about {tempF} degrees{feelsClause}."

  ],


  conditions: [

    "The latest observation is reporting {condition}.",

    "Observed conditions are showing {condition}.",

    "At the observation station, conditions are being reported as {condition}."

  ],


  wind: [

    "Observed wind is out of the {direction} at {speed} miles per hour{gustClause}.",

    "The latest wind observation is from the {direction} at around {speed} miles per hour{gustClause}.",

    "Winds are being observed from the {direction} at about {speed} miles per hour{gustClause}."

  ],


  humidity: [

    "The observed dew point is {dewF}, so the air feels {dewLabel}.",

    "Observed humidity is around {humidity} percent, with a dew point near {dewF}.",

    "Moisture-wise, the latest observation has a dew point around {dewF}, putting us in the {dewLabel} range."

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
    (
      resolve,
      reject
    ) => {

      if (
        !(
          'geolocation'
          in navigator
        )
      ) {

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


            console.log(
              'StormVector location:',
              liveLat,
              liveLon
            );


            resolve(
              position
            );

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
            enableHighAccuracy:
              true,

            timeout:
              15000,

            maximumAge:
              0
          }

        );

    }
  );

}


/* ════════════════════════════════════════════════
   NWS POINT LOOKUP
════════════════════════════════════════════════ */

async function fetchNwsPoint(
  lat,
  lon
) {

  const response =
    await safeFetch(

      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,

      nwsFetchOptions(
        10000
      )

    );


  const data =
    await response.json();


  return data.properties ||
    {};

}


/* ════════════════════════════════════════════════
   NWS OBSERVATION STATION
════════════════════════════════════════════════ */

async function fetchNearestObservationStation(
  stationsUrl
) {

  if (!stationsUrl) {
    return null;
  }


  try {

    const response =
      await safeFetch(
        stationsUrl,
        nwsFetchOptions(
          10000
        )
      );


    const data =
      await response.json();


    const stations =
      data.features ||
      [];


    if (!stations.length) {

      return null;

    }


    /*
      NWS returns stations relevant to the grid.
      Use the first available station.
    */

    const station =
      stations[0];


    const stationId =

      station.properties
        ?.stationIdentifier

      ||

      station.id
        ?.split('/')
        .pop()

      ||

      null;


    return {

      id:
        stationId,

      name:
        station.properties
          ?.name ||
        stationId,

      url:
        station.id ||
        (
          stationId
            ? `https://api.weather.gov/stations/${stationId}`
            : null
        )

    };

  }


  catch (
    error
  ) {

    console.warn(
      'StormVector observation station lookup failed:',
      error
    );


    return null;

  }

}


/* ════════════════════════════════════════════════
   LATEST NWS OBSERVATION
════════════════════════════════════════════════ */

async function fetchLatestObservation(
  station
) {

  if (
    !station?.id
  ) {

    return null;

  }


  try {

    const response =
      await safeFetch(

        `https://api.weather.gov/stations/${encodeURIComponent(station.id)}/observations/latest`,

        nwsFetchOptions(
          10000
        )

      );


    const data =
      await response.json();


    const props =
      data.properties ||
      {};


    const temperatureC =
      props.temperature
        ?.value;


    const dewpointC =
      props.dewpoint
        ?.value;


    const windSpeedKmh =
      props.windSpeed
        ?.value;


    const windGustKmh =
      props.windGust
        ?.value;


    const visibilityMeters =
      props.visibility
        ?.value;


    const humidity =

      props.relativeHumidity
        ?.value !==
      null

      &&

      props.relativeHumidity
        ?.value !==
      undefined

        ? Math.round(
            props.relativeHumidity.value
          )

        : null;


    const tempF =
      cToF(
        temperatureC
      );


    const dewF =
      cToF(
        dewpointC
      );


    const windSpd =
      kmhToMph(
        windSpeedKmh
      );


    const windG =
      kmhToMph(
        windGustKmh
      );


    const windDeg =

      props.windDirection
        ?.value !==
      null

      &&

      props.windDirection
        ?.value !==
      undefined

        ? Math.round(
            props.windDirection.value
          )

        : null;


    const visibilityMi =
      metersToMiles(
        visibilityMeters
      );


    let observationTime =
      null;


    if (
      props.timestamp
    ) {

      try {

        observationTime =
          new Date(
            props.timestamp
          );

      }

      catch (_) {}

    }


    const textDescription =
      cleanObservedCondition(
        props.textDescription
      );


    console.log(
      'StormVector NWS observation:',
      {
        station:
          station.id,
        stationName:
          station.name,
        time:
          props.timestamp,
        tempF,
        dewF,
        humidity,
        windSpd,
        windG,
        windDeg,
        visibilityMi,
        textDescription
      }
    );


    return {

      source:
        'NWS observation',

      stationId:
        station.id,

      stationName:
        station.name,


      tempF,


      dewF,


      humidity,


      windSpd,


      windG,


      windDeg,


      visibilityMi,


      condition:
        textDescription,


      timestamp:
        observationTime

    };

  }


  catch (
    error
  ) {

    console.warn(
      'StormVector latest observation failed:',
      error
    );


    return null;

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

        nwsFetchOptions(
          10000
        )

      );


    const data =
      await response.json();


    return data.features ||
      [];

  }


  catch (
    error
  ) {

    console.warn(
      'StormVector alerts failed:',
      error
    );


    return [];

  }

}


/* ════════════════════════════════════════════════
   NWS FORECAST CONTEXT
════════════════════════════════════════════════ */

async function fetchNwsContextFromPoint(
  properties
) {

  const relativeLocation =
    properties
      .relativeLocation
      ?.properties;


  const cityState =

    relativeLocation?.city &&
    relativeLocation?.state

      ? `${relativeLocation.city}, ${relativeLocation.state}`

      : relativeLocation?.city ||
        relativeLocation?.state ||
        null;


  let today =
    null;


  let tonight =
    null;


  if (
    properties.forecast
  ) {

    try {

      const forecastResponse =
        await safeFetch(

          properties.forecast,

          nwsFetchOptions(
            10000
          )

        );


      const forecastData =
        await forecastResponse
          .json();


      const periods =
        forecastData
          .properties
          ?.periods ||
        [];


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
        )

        ||

        periods[0];


      const nightPeriod =
        periods.find(
          period =>

            !period.isDaytime

            &&

            new Date(
              period.endTime
            ) >
            now
        );


      today =
        cleanForecastText(

          currentPeriod
            ?.detailedForecast

          ||

          currentPeriod
            ?.shortForecast

        );


      tonight =
        cleanForecastText(

          nightPeriod
            ?.detailedForecast

          ||

          nightPeriod
            ?.shortForecast

        );

    }


    catch (
      error
    ) {

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
    },

    observationStationsUrl:
      properties.observationStations ||
      null

  };

}


/* ════════════════════════════════════════════════
   OPEN-METEO FALLBACK
════════════════════════════════════════════════ */

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
        timeout:
          10000
      }
    );


  const data =
    await response.json();


  const current =
    data.current ||
    {};


  const daily =
    data.daily ||
    {};


  const formatTime =
    value => {

      if (!value) {
        return null;
      }

      try {

        return new Date(value)
          .toLocaleTimeString(
            [],
            {
              hour:
                'numeric',

              minute:
                '2-digit'
            }
          );

      }

      catch (_) {

        return null;

      }

    };


  return {

    tempF:
      current.temperature_2m !==
      undefined

        ? Math.round(
            current.temperature_2m
          )

        : null,


    feelsF:
      current.apparent_temperature !==
      undefined

        ? Math.round(
            current.apparent_temperature
          )

        : null,


    humidity:
      current.relative_humidity_2m !==
      undefined

        ? Math.round(
            current.relative_humidity_2m
          )

        : null,


    dewF:
      current.dew_point_2m !==
      undefined

        ? Math.round(
            current.dew_point_2m
          )

        : null,


    wcode:
      current.weather_code !==
      undefined

        ? current.weather_code

        : null,


    windSpd:
      current.wind_speed_10m !==
      undefined

        ? Math.round(
            current.wind_speed_10m
          )

        : 0,


    windDeg:
      current.wind_direction_10m !==
      undefined

        ? current.wind_direction_10m

        : 0,


    windG:
      current.wind_gusts_10m !==
      undefined

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
   MERGE OBSERVATION + FALLBACK
════════════════════════════════════════════════ */

function mergeCurrentWeather(
  observation,
  fallback
) {

  const hasObservedTemp =
    observation?.tempF !==
    null &&
    observation?.tempF !==
    undefined;


  const tempF =
    hasObservedTemp
      ? observation.tempF
      : fallback.tempF ??
        null;


  /*
    NWS station observations do not always
    provide an apparent temperature.

    Use Open-Meteo only for feels-like.
  */

  const feelsF =
    fallback.feelsF ??
    tempF ??
    null;


  const humidity =

    observation?.humidity !==
    null &&
    observation?.humidity !==
    undefined

      ? observation.humidity

      : fallback.humidity ??
        null;


  const dewF =

    observation?.dewF !==
    null &&
    observation?.dewF !==
    undefined

      ? observation.dewF

      : fallback.dewF ??
        null;


  const windSpd =

    observation?.windSpd !==
    null &&
    observation?.windSpd !==
    undefined

      ? observation.windSpd

      : fallback.windSpd ??
        0;


  const windDeg =

    observation?.windDeg !==
    null &&
    observation?.windDeg !==
    undefined

      ? observation.windDeg

      : fallback.windDeg ??
        0;


  const windG =

    observation?.windG !==
    null &&
    observation?.windG !==
    undefined

      ? observation.windG

      : fallback.windG ??
        0;


  return {

    tempF,

    feelsF,

    humidity,

    dewF,

    windSpd,

    windDeg,

    windG,

    wcode:
      fallback.wcode ??
      null,

    condition:
      observation?.condition ||
      skyDescription(
        fallback.wcode
      ) ||
      null,

    visibilityMi:
      observation?.visibilityMi ??
      null,

    observationSource:
      observation
        ? 'NWS'
        : 'Open-Meteo',

    observationStationId:
      observation?.stationId ||
      null,

    observationStationName:
      observation?.stationName ||
      null,

    observationTime:
      observation?.timestamp ||
      null,

    sunrise:
      fallback.sunrise ??
      null,

    sunset:
      fallback.sunset ??
      null

  };

}


/* ════════════════════════════════════════════════
   SPC OUTLOOK
════════════════════════════════════════════════ */

function pointInRing(
  point,
  ring
) {

  let inside =
    false;


  for (
    let i = 0,
        j =
          ring.length -
          1;

    i <
    ring.length;

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
        yi >
        point[1]
      )

      !==

      (
        yj >
        point[1]
      )

      &&

      point[0] <

      (
        (xj - xi) *
        (point[1] - yi) /
        (yj - yi)
      )

      +

      xi;


    if (
      intersects
    ) {

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
    i <
    coordinates.length;
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


  for (
    const url
    of urls
  ) {

    try {

      const response =
        await safeFetch(
          url,
          {
            timeout:
              8000
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
        const feature
        of data.features ||
        []
      ) {

        const label =
          String(

            feature.properties
              ?.LABEL

            ||

            feature.properties
              ?.label

            ||

            feature.properties
              ?.DN

            ||

            ''

          )
          .toUpperCase();


        if (
          !SPC_RANK[
            label
          ]
        ) {

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


    catch (
      error
    ) {

      console.warn(
        'StormVector SPC request failed:',
        error
      );

    }

  }


  return null;

}


/* ════════════════════════════════════════════════
   CONDITIONS UI
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
    (
      label,
      value
    ) => `

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

    ctx.tempF !==
    null

      ? chip(
          'TEMP',
          `${ctx.tempF}°F`
        )

      : '',


    ctx.feelsF !==
    null

      ? chip(
          'FEELS',
          `${ctx.feelsF}°F`
        )

      : '',


    ctx.dewF !==
    null

      ? chip(
          'DEW POINT',
          `${ctx.dewF}°F`
        )

      : '',


    ctx.humidity !==
    null

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
    ctx.windSpd +
    5

      ? chip(
          'GUSTS',
          `${ctx.windG} mph`
        )

      : '',


    ctx.visibilityMi !==
    null

      ? chip(
          'VISIBILITY',
          `${ctx.visibilityMi} mi`
        )

      : ''

  ]
  .join('');

}


/* ════════════════════════════════════════════════
   BACKGROUND
════════════════════════════════════════════════ */

function setBroadcastBg(
  ctx
) {

  if (
    ctx.alerts.some(
      alert =>
        window.isTornadoLevel(
          alert.properties
            ?.event ||
          ''
        )
    )
  ) {

    window.setBgMode(
      'tornado'
    );

    return;

  }


  const observed =
    String(
      ctx.condition ||
      ''
    )
    .toLowerCase();


  if (
    observed.includes(
      'thunder'
    )

    ||

    [95,96,99]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'storm'
    );

    return;

  }


  if (
    observed.includes(
      'snow'
    )

    ||

    [71,73,75,77,85,86]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'snow'
    );

    return;

  }


  if (
    observed.includes(
      'fog'
    )

    ||

    [45,48]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'fog'
    );

    return;

  }


  if (
    observed.includes(
      'rain'
    )

    ||

    observed.includes(
      'drizzle'
    )

    ||

    [51,53,55,61,63,65,80,81,82]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'rain'
    );

    return;

  }


  if (
    observed.includes(
      'cloud'
    )

    ||

    observed.includes(
      'overcast'
    )
  ) {

    window.setBgMode(
      'cloudy'
    );

    return;

  }


  window.setBgMode(
    'clear'
  );

}


/* ════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════ */

function setRobotSpeaking(
  speaking
) {

  document
    .getElementById(
      'liveAvatar'
    )
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


  const cleanText =
    sanitizeBroadcastText(
      text
    );


  if (
    caption
  ) {

    caption.textContent =
      cleanText;

  }


  announce(
    cleanText
  );

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


  badge.classList
    .toggle(
      'live-badge-on',
      text ===
      'LIVE'
    );

}


/* ════════════════════════════════════════════════
   OBSERVATION AGE
════════════════════════════════════════════════ */

function getObservationAgeMinutes(
  date
) {

  if (
    !date ||
    !(date instanceof Date) ||
    Number.isNaN(date.getTime())
  ) {

    return null;

  }


  return Math.max(
    0,
    Math.round(
      (
        Date.now() -
        date.getTime()
      ) /
      60000
    )
  );

}


/* ════════════════════════════════════════════════
   BROADCAST BUILDERS
════════════════════════════════════════════════ */

function addCurrentConditions(
  segments,
  ctx
) {

  if (
    ctx.tempF ===
    null
  ) {

    segments.push(
      "I'm still waiting on a reliable current temperature observation, but the forecast and alert data are available."
    );

    return;

  }


  const oldTemp =
    spokenFactMemory.get(
      'temperature'
    );


  const oldFeels =
    spokenFactMemory.get(
      'feels'
    );


  const feelsClause =

    ctx.feelsF !==
    null &&

    Math.abs(
      ctx.feelsF -
      ctx.tempF
    ) >=
    3 &&

    (
      oldFeels ===
      undefined ||

      oldFeels !==
      ctx.feelsF ||

      broadcastLoopCount ===
      0
    )

      ? `, and it feels closer to ${ctx.feelsF}`

      : '';


  if (
    oldTemp ===
    undefined
  ) {

    segments.push(

      pickFilled(
        PHRASES.currentFirst,
        'current-first',
        {

          tempF:
            ctx.tempF,

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
            difference ===
            1

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
            difference ===
            1

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


  if (
    ctx.condition
  ) {

    const oldCondition =
      spokenFactMemory.get(
        'condition'
      );


    if (
      broadcastLoopCount ===
      0 ||

      oldCondition !==
      ctx.condition ||

      broadcastLoopCount %
      3 ===
      0
    ) {

      segments.push(

        pickFilled(
          PHRASES.conditions,
          'conditions',
          {
            condition:
              ctx.condition
          }
        )

      );

    }

  }


  /*
    Tell the listener if the station observation
    is notably old.
  */

  const ageMinutes =
    getObservationAgeMinutes(
      ctx.observationTime
    );


  if (
    ageMinutes !==
    null &&

    ageMinutes >=
    25
  ) {

    segments.push(
      `That observation is about ${ageMinutes} minutes old, so conditions may have changed a little since it was taken.`
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
    'condition',
    ctx.condition
  );

}


function addWind(
  segments,
  ctx,
  force = false
) {

  if (
    !force &&
    ctx.windSpd <
    7 &&
    ctx.windG <
    12
  ) {

    return;

  }


  const previousWind =
    spokenFactMemory.get(
      'windSpeed'
    );


  if (
    !force &&
    broadcastLoopCount >
    0 &&
    previousWind ===
    ctx.windSpd &&
    broadcastLoopCount %
    3 !==
    0
  ) {

    return;

  }


  const direction =
    window.degToCompass(
      ctx.windDeg
    )

    ||

    'variable';


  const gustClause =

    ctx.windG >
    ctx.windSpd +
    5

      ? `, with gusts near ${ctx.windG}`

      : '';


  segments.push(

    pickFilled(
      PHRASES.wind,
      'wind',
      {

        direction,

        speed:
          ctx.windSpd,

        gustClause

      }
    )

  );


  if (
    ctx.windG >=
    40
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

  if (
    ctx.dewF ===
    null
  ) {

    return;

  }


  const oldDew =
    spokenFactMemory.get(
      'dewPoint'
    );


  if (
    broadcastLoopCount >
    0 &&

    oldDew ===
    ctx.dewF &&

    broadcastLoopCount %
    4 !==
    2
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

    if (
      broadcastLoopCount ===
      0
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
        (
          a,
          b
        ) =>

          window.alertPriorityScore(
            a.properties
              ?.event ||
            ''
          )

          -

          window.alertPriorityScore(
            b.properties
              ?.event ||
            ''
          )
      );


  sorted
    .slice(
      0,
      2
    )
    .forEach(
      alert => {

        const properties =
          alert.properties ||
          {};


        const area =
          sanitizeBroadcastText(
            (
              properties.areaDesc ||
              'your area'
            )
            .split(';')[0]
          );


        let expiration =
          '';


        if (
          properties.expires
        ) {

          try {

            expiration =
              new Date(
                properties.expires
              )
              .toLocaleTimeString(
                [],
                {
                  hour:
                    'numeric',

                  minute:
                    '2-digit'
                }
              );

          }

          catch (_) {}

        }


        segments.push(

          `A ${sanitizeBroadcastText(properties.event || 'weather alert')} is in effect for ${area}${expiration ? ` until ${expiration}` : ''}.`

        );


        const movement =
          window.parseMovement(
            properties.description ||
            ''
          );


        if (
          movement
        ) {

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


  if (
    !labels[
      spc
    ]
  ) {

    return;

  }


  const previous =
    spokenFactMemory.get(
      'spcRisk'
    );


  if (
    broadcastLoopCount >
    0 &&

    previous ===
    spc &&

    broadcastLoopCount %
    4 !==
    1
  ) {

    return;

  }


  segments.push(

    `The Storm Prediction Center has your location under ${labels[spc]} today.`

  );


  if (
    SPC_RANK[
      spc
    ] >=
    SPC_RANK.ENH
  ) {

    segments.push(
      "That's a meaningful severe weather signal, so I'll keep it near the top of the broadcast."
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

  if (
    !ctx.forecast
      ?.today
  ) {

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

  if (
    !ctx.forecast
      ?.tonight
  ) {

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
   BUILD SCRIPT
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
            alert.properties
              ?.event ||
            ''
          )
    );


  const watches =
    ctx.alerts.filter(
      alert =>
        /Watch/i
          .test(
            alert.properties
              ?.event ||
            ''
          )
    );


  const severeMode =

    warnings.length >
    0

    ||

    watches.length >
    0;


  const cityText =
    ctx.cityState

      ? ` in ${ctx.cityState}`

      : ' in your area';


  if (
    broadcastLoopCount ===
    0
  ) {

    if (
      warnings.length
    ) {

      segments.push(
        `I've got the latest weather loaded${cityText}, and we have active warning information, so let's get right to it.`
      );

    }

    else {

      segments.push(
        `I've got the latest weather loaded${cityText}. Here's where things stand.`
      );

    }

  }


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
        oldTemp !==
        undefined &&

        oldTemp !==
        ctx.tempF
      )

      ||

      (
        oldAlertCount !==
        undefined &&

        oldAlertCount !==
        ctx.alerts.length
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


  if (
    severeMode
  ) {

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


  else {

    const rotation =
      broadcastLoopCount %
      5;


    if (
      rotation ===
      0
    ) {

      addCurrentConditions(
        segments,
        ctx
      );


      if (
        ctx.windSpd >=
        12 ||

        ctx.windG >=
        20
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


    else if (
      rotation ===
      1
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
      rotation ===
      2
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
          `Sunset comes around ${ctx.sunset} this evening.`
        );

      }

    }


    else if (
      rotation ===
      3
    ) {

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


    else {

      addCurrentConditions(
        segments,
        ctx
      );


      const quiet =

        !weatherCodePhrase(
          ctx.wcode
        )

        &&

        ctx.windSpd <
        15;


      if (
        quiet
      ) {

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
   PREPARE BROADCAST
════════════════════════════════════════════════ */

async function prepareBroadcast() {

  if (
    !locationReady ||
    liveLat ===
    null ||
    liveLon ===
    null
  ) {

    throw new Error(
      'StormVector does not have a location yet.'
    );

  }


  setLiveBadge(
    'UPDATING'
  );


  /*
    STEP 1:
    NWS point lookup.

    This gives us:
    • local city/state
    • NWS forecast URL
    • observation stations URL
  */

  let pointProperties =
    {};


  try {

    pointProperties =
      await fetchNwsPoint(
        liveLat,
        liveLon
      );

  }


  catch (
    error
  ) {

    console.warn(
      'StormVector NWS point lookup failed:',
      error
    );

  }


  /*
    STEP 2:
    Build NWS context from point.
  */

  const nwsContext =
    await fetchNwsContextFromPoint(
      pointProperties
    );


  /*
    STEP 3:
    Find closest NWS observation station.
  */

  const station =
    await fetchNearestObservationStation(
      nwsContext
        .observationStationsUrl
    );


  currentObservationStationId =
    station?.id ||
    null;


  currentObservationStationName =
    station?.name ||
    null;


  /*
    STEP 4:
    Fetch actual station observation.

    At the same time:
    • Open-Meteo fallback
    • NWS alerts
    • SPC outlook
  */

  const [
    observation,
    fallback,
    alerts,
    spc
  ] =
    await Promise.all([

      station

        ? fetchLatestObservation(
            station
          )

        : Promise.resolve(
            null
          ),


      fetchOpenMeteo(
        liveLat,
        liveLon
      )
      .catch(
        error => {

          console.warn(
            'StormVector Open-Meteo fallback failed:',
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
        () =>
          null
      )

    ]);


  /*
    STEP 5:
    Observation always wins.

    Open-Meteo only fills gaps.
  */

  const weather =
    mergeCurrentWeather(
      observation,
      fallback
    );


  liveCityState =
    nwsContext.cityState;


  currentObservationTime =
    weather.observationTime;


  setLocationText(

    liveCityState

    ||

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


    condition:
      weather.condition ??
      null,


    visibilityMi:
      weather.visibilityMi ??
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


    observationSource:
      weather.observationSource,


    observationStationId:
      weather.observationStationId,


    observationStationName:
      weather.observationStationName,


    observationTime:
      weather.observationTime,


    alerts:
      alerts ||
      [],


    forecast:
      nwsContext.forecast

      ||

      {
        today:
          null,

        tonight:
          null
      },


    spc:
      spc ||
      null

  };


  /*
    Existing warnings should not trigger
    false "breaking weather" alerts.
  */

  if (
    broadcastLoopCount ===
    0
  ) {

    ctx.alerts
      .forEach(
        alert => {

          if (
            /Warning|Watch|Emergency/i
              .test(
                alert.properties
                  ?.event ||
                ''
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


  console.log(
    'StormVector weather source:',
    {
      currentSource:
        ctx.observationSource,

      station:
        ctx.observationStationId,

      stationName:
        ctx.observationStationName,

      observationTime:
        ctx.observationTime,

      temp:
        ctx.tempF,

      condition:
        ctx.condition
    }
  );


  return ctx;

}


/* ════════════════════════════════════════════════
   VOICE
════════════════════════════════════════════════ */

function pickVoice() {

  if (
    !(
      'speechSynthesis'
      in window
    )
  ) {

    return;

  }


  const voices =
    speechSynthesis
      .getVoices();


  liveVoice =

    voices.find(
      voice =>

        /en-US/i
          .test(
            voice.lang
          )

        &&

        /Daniel|Aaron|David|Alex|Tom/i
          .test(
            voice.name
          )
    )

    ||

    voices.find(
      voice =>
        /en-US/i
          .test(
            voice.lang
          )
    )

    ||

    voices.find(
      voice =>
        /^en/i
          .test(
            voice.lang
          )
    )

    ||

    voices[0]

    ||

    null;


  console.log(
    'StormVector voice:',
    liveVoice
      ?.name ||
    'default'
  );

}


if (
  'speechSynthesis'
  in window
) {

  speechSynthesis
    .onvoiceschanged =
    pickVoice;


  pickVoice();

}


/* ════════════════════════════════════════════════
   MUSIC
════════════════════════════════════════════════ */

function ensureLiveMusicElement() {

  if (
    liveMusic
  ) {

    return liveMusic;

  }


  liveMusic =
    document.getElementById(
      'liveMusic'
    );


  if (
    !liveMusic
  ) {

    liveMusic =
      document.createElement(
        'audio'
      );


    liveMusic.id =
      'liveMusic';


    document.body
      .appendChild(
        liveMusic
      );

  }


  if (
    !liveMusic
      .getAttribute(
        'src'
      )
  ) {

    liveMusic.src =
      './stormvector-theme.mp3';

  }


  liveMusic.loop =
    true;


  liveMusic.preload =
    'auto';


  liveMusic
    .setAttribute(
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


  if (
    musicFadeFrame
  ) {

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


  function frame(
    now
  ) {

    const progress =

      duration <=
      0

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


    const eased =
      1 -
      Math.pow(
        1 -
        progress,
        3
      );


    music.volume =

      startingVolume +

      (
        target -
        startingVolume
      ) *

      eased;


    if (
      progress <
      1
    ) {

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

    if (
      music.paused
    ) {

      await music.play();

    }


    setMusicVolume(
      0.17,
      900
    );

  }


  catch (
    error
  ) {

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


function stopMusic(
  reset = false
) {

  if (
    !liveMusic
  ) {

    return;

  }


  setMusicVolume(
    0,
    300
  );


  setTimeout(
    () => {

      if (
        !liveMusic
      ) {

        return;

      }


      liveMusic.pause();


      if (
        reset
      ) {

        liveMusic.currentTime =
          0;

      }

    },
    340
  );

}


/* ════════════════════════════════════════════════
   SPEECH UTTERANCE
════════════════════════════════════════════════ */

function createUtterance(
  text
) {

  const utterance =
    new SpeechSynthesisUtterance(
      text
    );


  if (
    liveVoice
  ) {

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
   SAFE SPEECH CHUNKS
════════════════════════════════════════════════ */

function speakTextInChunks(
  fullText,
  generation
) {

  return new Promise(
    resolve => {

      const chunks =
        splitSpeechChunks(
          fullText,
          125
        );


      if (
        !chunks.length
      ) {

        resolve(
          true
        );

        return;

      }


      let chunkIndex =
        0;


      let completed =
        false;


      function finish(
        success = true
      ) {

        if (
          completed
        ) {

          return;

        }


        completed =
          true;


        resolve(
          success
        );

      }


      function speakNextChunk() {

        if (
          generation !==
          speechGeneration ||

          liveMuted ||

          breakingWeatherActive
        ) {

          finish(
            false
          );

          return;

        }


        if (
          chunkIndex >=
          chunks.length
        ) {

          finish(
            true
          );

          return;

        }


        const chunk =
          chunks[
            chunkIndex
          ];


        const utterance =
          createUtterance(
            chunk
          );


        let ended =
          false;


        const estimatedDuration =
          Math.max(
            3500,
            Math.min(
              12000,
              chunk.length *
              95
            )
          );


        const watchdog =
          setTimeout(
            () => {

              if (
                ended
              ) {

                return;

              }


              ended =
                true;


              chunkIndex++;


              setTimeout(
                speakNextChunk,
                80
              );

            },
            estimatedDuration
          );


        utterance.onend =
          () => {

            if (
              ended
            ) {

              return;

            }


            ended =
              true;


            clearTimeout(
              watchdog
            );


            chunkIndex++;


            setTimeout(
              speakNextChunk,
              65
            );

          };


        utterance.onerror =
          event => {

            if (
              ended
            ) {

              return;

            }


            ended =
              true;


            clearTimeout(
              watchdog
            );


            console.warn(
              'StormVector speech chunk error:',
              event
            );


            chunkIndex++;


            setTimeout(
              speakNextChunk,
              80
            );

          };


        speechSynthesis
          .speak(
            utterance
          );

      }


      speakNextChunk();

    }
  );

}


/* ════════════════════════════════════════════════
   IPHONE STARTUP
════════════════════════════════════════════════ */

function startMediaFromUserGesture() {

  const music =
    ensureLiveMusicElement();


  try {

    music.volume =
      0.025;


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
            'StormVector theme unlock failed:',
            error
          )
      );

    }

  }


  catch (
    error
  ) {

    console.warn(
      'StormVector theme unlock failed:',
      error
    );

  }


  startupSpeechPromise =
    new Promise(
      resolve => {

        if (
          !(
            'speechSynthesis'
            in window
          )
        ) {

          resolve();

          return;

        }


        const text =
          pickPhrase(
            [

              "Vector here. Give me a second while I pull up the latest observations and your local forecast.",

              "Vector here. I'm grabbing your location and the latest observed weather now.",

              "All right, I'm Vector. Give me a second while I load the latest weather observation.",

              "Vector here. Let me pull up the latest weather data for where you are."

            ],

            'startup-lines'
          );


        const utterance =
          createUtterance(
            renderForSpeech(
              text
            )
          );


        utterance.rate =
          0.94;


        utterance.onstart =
          () => {

            setLiveBadge(
              'CONNECTING'
            );


            setRobotSpeaking(
              true
            );


            setCaption(
              text
            );


            duckMusic();

          };


        utterance.onend =
          () => {

            setRobotSpeaking(
              false
            );


            sentenceBreakMusic();


            resolve();

          };


        utterance.onerror =
          error => {

            console.warn(
              'StormVector startup speech error:',
              error
            );


            setRobotSpeaking(
              false
            );


            resolve();

          };


        speechSynthesis
          .speak(
            utterance
          );

      }
    );

}


/* ════════════════════════════════════════════════
   START BROADCAST
════════════════════════════════════════════════ */

async function startBroadcast() {

  if (
    startupRunning
  ) {

    return;

  }


  startupRunning =
    true;


  const button =
    document.getElementById(
      'liveStartBtn'
    );


  /*
    Must happen before first await.
  */

  startMediaFromUserGesture();


  if (
    button
  ) {

    button.disabled =
      true;


    button.textContent =
      'Getting Location...';

  }


  try {

    if (
      !locationReady
    ) {

      setLocationText(
        'Waiting for location permission...'
      );


      await requestCurrentLocation();

    }


    setLocationText(
      'Loading latest weather observation...'
    );


    if (
      button
    ) {

      button.textContent =
        'Loading Weather...';

    }


    await prepareBroadcast();


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


    if (
      overlay
    ) {

      overlay.style.display =
        'none';

    }


    await bringMusicUp();


    requestWakeLock();


    startSevereWatch();


    startSpeechKeepAlive();


    if (
      startupSpeechPromise
    ) {

      await Promise.race([

        startupSpeechPromise,

        wait(
          6500
        )

      ]);

    }


    setRobotSpeaking(
      false
    );


    setLiveBadge(
      'LIVE'
    );


    await wait(
      250
    );


    speakSegment(
      0
    );

  }


  catch (
    error
  ) {

    console.error(
      'StormVector startup failed:',
      error
    );


    try {

      speechSynthesis.cancel();

    }

    catch (_) {}


    setRobotSpeaking(
      false
    );


    stopMusic(
      false
    );


    setLiveBadge(
      'STANDBY'
    );


    setLocationText(

      error.message

      ||

      'Unable to start StormVector.'

    );


    setCaption(
      'StormVector could not start the local broadcast. Check location permission and try again.'
    );


    if (
      button
    ) {

      button.disabled =
        false;


      button.textContent =
        'Enable Location & Go Live';

    }

  }


  finally {

    startupRunning =
      false;

  }

}


/* ════════════════════════════════════════════════
   SPEAK SEGMENT
════════════════════════════════════════════════ */

async function speakSegment(
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


  if (
    !(
      'speechSynthesis'
      in window
    )
  ) {

    if (
      liveSegments[
        index
      ]
    ) {

      setCaption(
        liveSegments[
          index
        ]
      );

    }

    return;

  }


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
    sanitizeBroadcastText(
      liveSegments[
        index
      ]
    );


  const generation =
    speechGeneration;


  setCaption(
    text
  );


  setLiveBadge(
    'LIVE'
  );


  setRobotSpeaking(
    true
  );


  duckMusic();


  const completed =
    await speakTextInChunks(
      text,
      generation
    );


  if (
    generation !==
    speechGeneration
  ) {

    return;

  }


  if (
    !completed ||
    liveMuted ||
    breakingWeatherActive
  ) {

    setRobotSpeaking(
      false
    );

    return;

  }


  setRobotSpeaking(
    false
  );


  sentenceBreakMusic();


  let pause =
    420;


  if (
    /warning|watch|emergency/i
      .test(
        text
      )
  ) {

    pause =
      650;

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


  await wait(
    pause
  );


  if (
    generation ===
    speechGeneration &&

    !liveMuted &&

    !breakingWeatherActive
  ) {

    speakSegment(
      index +
      1
    );

  }

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


  catch (
    error
  ) {

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
   REPLAY
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


/* ════════════════════════════════════════════════
   STOP / RESUME
════════════════════════════════════════════════ */

async function toggleMute() {

  const button =
    document.getElementById(
      'liveMuteBtn'
    );


  liveMuted =
    !liveMuted;


  speechGeneration++;


  if (
    liveMuted
  ) {

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


    if (
      button
    ) {

      button.innerHTML =
        '<span class="live-control-icon">Resume</span>';

    }


    return;

  }


  if (
    button
  ) {

    button.innerHTML =
      '<span class="live-control-icon">Stop</span>';

  }


  try {

    await bringMusicUp();

  }

  catch (_) {}


  requestWakeLock();


  startSevereWatch();


  startSpeechKeepAlive();


  await wait(
    150
  );


  speakSegment(
    liveSegIdx
  );

}


/* ════════════════════════════════════════════════
   SEVERE WEATHER WATCH
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

  if (
    severeWatchTimer
  ) {

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
                alert.properties
                  ?.event ||
                ''
              )
        )

        .sort(
          (
            a,
            b
          ) =>

            window.alertPriorityScore(
              a.properties
                ?.event ||
              ''
            )

            -

            window.alertPriorityScore(
              b.properties
                ?.event ||
              ''
            )
        );


    const newAlerts =
      priorityAlerts
        .filter(
          alert =>
            !knownPriorityAlertIds
              .has(
                alert.id
              )
        );


    priorityAlerts
      .forEach(
        alert =>
          knownPriorityAlertIds
            .add(
              alert.id
            )
      );


    if (
      newAlerts.length
    ) {

      await interruptForBreakingWeather(
        newAlerts[
          0
        ]
      );

    }

  }


  catch (
    error
  ) {

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

      window.AudioContext

      ||

      window.webkitAudioContext;


    if (
      !AudioContextClass
    ) {

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
      3;


    const gain =
      context.createGain();


    gain.gain.value =
      0.18;


    gain.connect(
      context.destination
    );


    [
      853,
      960
    ]
      .forEach(
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
      duration *
      1000 +
      100
    );


    await context
      .close()
      .catch(
        () => {}
      );

  }


  catch (
    error
  ) {

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


  if (
    banner
  ) {

    banner.hidden =
      false;

  }


  await playAttentionTone();


  const properties =
    alert.properties ||
    {};


  const event =
    sanitizeBroadcastText(
      properties.event ||
      'weather alert'
    );


  const area =
    sanitizeBroadcastText(
      (
        properties.areaDesc ||
        'your area'
      )
      .split(';')[0]
    );


  const movement =
    window.parseMovement(
      properties.description ||
      ''
    );


  const warning =
    /Warning|Emergency/i
      .test(
        event
      );


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


  catch (
    error
  ) {

    console.warn(
      'StormVector post-alert refresh failed:',
      error
    );

  }


  if (
    banner
  ) {

    banner.hidden =
      true;

  }


  breakingWeatherActive =
    false;


  restoreMusic();


  if (
    !liveMuted
  ) {

    await wait(
      700
    );


    speakSegment(
      0
    );

  }

}


/* ════════════════════════════════════════════════
   BREAKING WEATHER SPEECH
════════════════════════════════════════════════ */

async function speakSequential(
  messages
) {

  for (
    const rawMessage
    of messages
  ) {

    if (
      liveMuted
    ) {

      break;

    }


    const message =
      sanitizeBroadcastText(
        rawMessage
      );


    const generation =
      speechGeneration;


    setCaption(
      message
    );


    setRobotSpeaking(
      true
    );


    duckMusic();


    await speakTextInChunks(
      message,
      generation
    );


    setRobotSpeaking(
      false
    );


    sentenceBreakMusic();


    await wait(
      450
    );

  }


  setRobotSpeaking(
    false
  );

}


/* ════════════════════════════════════════════════
   MOBILE SPEECH RELIABILITY
════════════════════════════════════════════════ */

function startSpeechKeepAlive() {

  stopSpeechKeepAlive();


  if (
    !/Android/i
      .test(
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

  if (
    speechKeepAlive
  ) {

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
      'wakeLock'
      in navigator

      &&

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

    wakeLock
      ?.release();

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


  if (
    !element
  ) {

    return;

  }


  element.textContent =
    '';


  requestAnimationFrame(
    () => {

      element.textContent =
        sanitizeBroadcastText(
          message
        );

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


    if (
      button
    ) {

      button.disabled =
        false;


      button.textContent =
        'Enable Location & Go Live';

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


    if (
      liveMusic
    ) {

      try {

        liveMusic.pause();

      }

      catch (_) {}

    }

  }
);