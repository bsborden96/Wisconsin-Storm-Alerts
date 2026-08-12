/* ═══════════════════════════════════════════════════════
   STORMVECTOR LIVE — VECTOR BROADCAST ENGINE

   FEATURES
   - Device-location broadcasts
   - Search any U.S. city/place
   - Predictive location search
   - Searched-location specific speech
   - Return to My Location
   - Full state names in speech
   - NWS observation station current conditions FIRST
   - Open-Meteo fallback
   - NWS forecast
   - NWS alerts
   - SPC Day 1 categorical outlook
   - iPhone/Safari speech startup
   - StormVector theme music
   - Animated Vector speaking state
   - Breaking weather interruptions
═══════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */

let liveLat = null;
let liveLon = null;

let deviceLat = null;
let deviceLon = null;

let liveCity = null;
let liveStateCode = null;
let liveStateName = null;
let liveCityState = null;

let liveLocationMode = 'none';
// none | device | search

let liveSegments = [];
let liveSegIdx = 0;

let liveVoice = null;

let liveMuted = false;
let liveStarted = false;
let startupRunning = false;

let liveMusic = null;
let musicFadeFrame = null;

let broadcastLoopCount = 0;

let deviceLocationReady = false;

let speechKeepAlive = null;
let wakeLock = null;

let breakingWeatherActive = false;
let severeWatchTimer = null;

let speechGeneration = 0;

let startupSpeechPromise = null;

let latestContext = null;

let searchDebounceMain = null;
let searchDebouncePopup = null;

let searchRequestCounter = 0;

const spokenFactMemory = new Map();
const knownPriorityAlertIds = new Set();
const phraseHistory = {};


/* ════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════ */

const SPC_RANK = {
  TSTM: 1,
  MRGL: 2,
  SLGT: 3,
  ENH: 4,
  MDT: 5,
  HIGH: 6
};


const US_STATE_NAMES = {
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
    document.getElementById(
      'menuPanel'
    );

  const button =
    document.getElementById(
      'menuBtn'
    );

  if (!panel) {
    return;
  }

  const opening =
    !panel.classList.contains(
      'open'
    );

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


function fahrenheitFromCelsius(
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
    Number(value) * 9 / 5 + 32
  );

}


function mphFromKmh(
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
    Number(value) * 0.621371
  );

}


function stateNameFromCode(
  code
) {

  if (!code) {
    return '';
  }

  const upper =
    String(code)
      .trim()
      .toUpperCase();

  return (
    US_STATE_NAMES[upper] ||
    upper
  );

}


function normalizePlaceName(
  city,
  stateCode,
  stateName
) {

  const state =
    stateName ||
    stateNameFromCode(
      stateCode
    );

  if (
    city &&
    state
  ) {

    return `${city}, ${state}`;

  }

  return (
    city ||
    state ||
    'Selected Location'
  );

}


function removeEmoji(
  text
) {

  return String(text || '')
    .replace(
      /[\p{Extended_Pictographic}\uFE0F]/gu,
      ''
    )
    .replace(
      /\s{2,}/g,
      ' '
    )
    .trim();

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

  let choices =
    pool
      .map(
        (_, index) =>
          index
      )
      .filter(
        index =>
          !used.has(index)
      );

  if (!choices.length) {

    used.clear();

    choices =
      pool.map(
        (_, index) =>
          index
      );

  }

  const chosen =
    choices[
      Math.floor(
        Math.random() *
        choices.length
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
        removeEmoji(
          String(text || '')
            .replace(/\s+/g, ' ')
            .replace(/\s+\./g, '.')
            .trim()
        )
    )
    .filter(Boolean)
    .filter(
      text => {

        const key =
          text.toLowerCase();

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;

      }
    );

}


/* ════════════════════════════════════════════════
   SPEECH CLEANUP
════════════════════════════════════════════════ */

function expandStateAbbreviationsForSpeech(
  text
) {

  let result =
    String(text || '');

  for (
    const [
      code,
      name
    ]
    of Object.entries(
      US_STATE_NAMES
    )
  ) {

    const commaPattern =
      new RegExp(
        `,\\s*${code}\\b`,
        'g'
      );

    result =
      result.replace(
        commaPattern,
        `, ${name}`
      );

  }

  return result;

}


function renderForSpeech(
  text
) {

  let result =
    removeEmoji(
      String(text || '')
    );


  result =
    expandStateAbbreviationsForSpeech(
      result
    );


  result =
    result

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


  return result;

}


function cleanForecastText(
  text
) {

  if (!text) {
    return null;
  }

  let cleaned =
    removeEmoji(
      String(text)
    )
      .replace(
        /\s+/g,
        ' '
      )
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

  return weatherCodePhrase(
    code
  );

}


/* ════════════════════════════════════════════════
   PHRASES
════════════════════════════════════════════════ */

const PHRASES = {

  currentFirst: [

    "Right now it's {tempF} degrees{feelsClause}.",

    "The latest observation has the temperature at {tempF} degrees{feelsClause}.",

    "Current temperature is {tempF} degrees{feelsClause}.",

    "We're sitting at {tempF} degrees right now{feelsClause}."

  ],


  currentSteady: [

    "Temperature hasn't changed much. We're still around {tempF} degrees{feelsClause}.",

    "We're holding pretty steady near {tempF} degrees{feelsClause}.",

    "Not much movement in temperature. We're still at about {tempF} degrees{feelsClause}."

  ],


  currentWarmer: [

    "It's warmed up since the last check. We're now at {tempF} degrees{feelsClause}.",

    "Temperature has climbed {difference}, putting us at {tempF} degrees{feelsClause}.",

    "It's a little warmer now, up to {tempF} degrees{feelsClause}."

  ],


  currentCooler: [

    "It's cooled off since the last check. We're now at {tempF} degrees{feelsClause}.",

    "Temperature has dropped {difference}, bringing us to {tempF} degrees{feelsClause}.",

    "It's a little cooler now, sitting at {tempF} degrees{feelsClause}."

  ],


  wind: [

    "Wind is out of the {direction} at {speed} miles per hour{gustClause}.",

    "We've got a {direction} wind around {speed} miles per hour{gustClause}.",

    "Winds are running from the {direction} at about {speed} miles per hour{gustClause}."

  ],


  humidity: [

    "The dew point is around {dewF}, so the air feels {dewLabel}.",

    "Humidity is around {humidity} percent, with a dew point near {dewF}.",

    "Moisture-wise, the dew point is around {dewF}, putting the air in the {dewLabel} range."

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


  closers: [

    "That's where things stand. I'll keep watching for changes.",

    "That's the latest for now. I'll check everything again shortly.",

    "That's your StormVector update. I'll keep monitoring the weather from here.",

    "That's the latest look. I'll be back with another update."

  ],


  severeClosers: [

    "I'll keep that alert at the top of the coverage. Stay weather-aware.",

    "Keep a reliable way to receive warnings nearby. I'll continue watching this closely.",

    "That threat stays our priority. I'll update you as soon as anything changes."

  ]

};


/* ════════════════════════════════════════════════
   LOCATION UI
════════════════════════════════════════════════ */

function setLocationText(
  text
) {

  const target =
    document.querySelector(
      '#liveLocationCard .live-location-text'
    );

  if (target) {

    target.textContent =
      text;

  }

}


function setLocationSource(
  text
) {

  const target =
    document.getElementById(
      'liveLocationSource'
    );

  if (target) {

    target.textContent =
      text;

  }

}


function updateReturnButton() {

  const button =
    document.getElementById(
      'returnToMyLocationBtn'
    );

  if (!button) {
    return;
  }

  button.hidden =
    liveLocationMode !==
    'search';

}


/* ════════════════════════════════════════════════
   DEVICE LOCATION
════════════════════════════════════════════════ */

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

      if (
        !('geolocation' in navigator)
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

            deviceLat =
              position.coords.latitude;

            deviceLon =
              position.coords.longitude;

            liveLat =
              deviceLat;

            liveLon =
              deviceLon;

            deviceLocationReady =
              true;

            liveLocationMode =
              'device';

            console.log(
              'StormVector device location:',
              deviceLat,
              deviceLon
            );

            resolve(
              position
            );

          },


          error => {

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
   U.S. PREDICTIVE LOCATION SEARCH
════════════════════════════════════════════════ */

async function searchUSLocations(
  query
) {

  const cleanQuery =
    String(query || '')
      .trim();

  if (
    cleanQuery.length <
    2
  ) {

    return [];

  }


  const url =

    'https://geocoding-api.open-meteo.com/v1/search' +

    `?name=${encodeURIComponent(cleanQuery)}` +

    '&count=8' +

    '&language=en' +

    '&format=json' +

    '&countryCode=US';


  const response =
    await safeFetch(
      url,
      {
        timeout: 8000
      }
    );


  const data =
    await response.json();


  return (
    data.results ||
    []
  )
    .filter(
      item =>
        item.latitude !== undefined &&
        item.longitude !== undefined &&
        item.country_code === 'US'
    )
    .map(
      item => {

        const stateName =

          item.admin1 ||

          stateNameFromCode(
            item.admin1_code
          ) ||

          'United States';


        return {

          name:
            item.name,

          stateName,

          stateCode:
            item.admin1_code ||
            '',

          county:
            item.admin2 ||
            '',

          latitude:
            Number(
              item.latitude
            ),

          longitude:
            Number(
              item.longitude
            ),

          timezone:
            item.timezone ||
            null

        };

      }
    );

}


function buildSuggestionLabel(
  result
) {

  return normalizePlaceName(
    result.name,
    result.stateCode,
    result.stateName
  );

}


function renderSearchSuggestions(
  container,
  results,
  source
) {

  if (!container) {
    return;
  }


  container.innerHTML =
    '';


  if (
    !results.length
  ) {

    container.hidden =
      false;

    container.innerHTML =
      '<div class="live-search-empty">No matching U.S. locations found.</div>';

    return;

  }


  results.forEach(
    result => {

      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.className =
        'live-search-suggestion';


      button.setAttribute(
        'role',
        'option'
      );


      const locationName =
        document.createElement(
          'span'
        );


      locationName.className =
        'live-search-suggestion-name';


      locationName.textContent =
        buildSuggestionLabel(
          result
        );


      const detail =
        document.createElement(
          'span'
        );


      detail.className =
        'live-search-suggestion-detail';


      detail.textContent =
        result.county
          ? result.county
          : 'United States';


      button.appendChild(
        locationName
      );


      button.appendChild(
        detail
      );


      /*
        IMPORTANT:
        Selecting a popup location is a
        direct user gesture.

        We unlock speech/music immediately
        BEFORE doing asynchronous weather calls.
      */

      button.addEventListener(
        'click',
        () => {

          selectSearchedLocation(
            result,
            source
          );

        }
      );


      container.appendChild(
        button
      );

    }
  );


  container.hidden =
    false;

}


function clearSearchUI(
  source
) {

  const isPopup =
    source ===
    'popup';


  const input =
    document.getElementById(
      isPopup
        ? 'livePopupLocationSearch'
        : 'liveLocationSearch'
    );


  const suggestions =
    document.getElementById(
      isPopup
        ? 'livePopupSearchSuggestions'
        : 'liveSearchSuggestions'
    );


  const status =
    document.getElementById(
      isPopup
        ? 'livePopupSearchStatus'
        : 'liveSearchStatus'
    );


  const clear =
    document.getElementById(
      isPopup
        ? 'livePopupSearchClearBtn'
        : 'liveSearchClearBtn'
    );


  if (input) {

    input.value =
      '';

    input.setAttribute(
      'aria-expanded',
      'false'
    );

  }


  if (suggestions) {

    suggestions.hidden =
      true;

    suggestions.innerHTML =
      '';

  }


  if (status) {

    status.textContent =
      '';

  }


  if (clear) {

    clear.hidden =
      true;

  }

}


function setupSearchBox(
  source
) {

  const isPopup =
    source ===
    'popup';


  const input =
    document.getElementById(
      isPopup
        ? 'livePopupLocationSearch'
        : 'liveLocationSearch'
    );


  const suggestions =
    document.getElementById(
      isPopup
        ? 'livePopupSearchSuggestions'
        : 'liveSearchSuggestions'
    );


  const status =
    document.getElementById(
      isPopup
        ? 'livePopupSearchStatus'
        : 'liveSearchStatus'
    );


  const clear =
    document.getElementById(
      isPopup
        ? 'livePopupSearchClearBtn'
        : 'liveSearchClearBtn'
    );


  if (
    !input ||
    !suggestions
  ) {

    return;

  }


  input.addEventListener(
    'input',
    () => {

      const query =
        input.value
          .trim();


      clear.hidden =
        !query;


      if (
        query.length <
        2
      ) {

        suggestions.hidden =
          true;

        status.textContent =
          '';

        input.setAttribute(
          'aria-expanded',
          'false'
        );

        return;

      }


      status.textContent =
        'Searching…';


      const run =
        async () => {

          const requestId =
            ++searchRequestCounter;


          try {

            const results =
              await searchUSLocations(
                query
              );


            if (
              requestId !==
              searchRequestCounter
            ) {

              return;

            }


            status.textContent =
              results.length
                ? ''
                : 'No matches found.';


            renderSearchSuggestions(
              suggestions,
              results,
              source
            );


            input.setAttribute(
              'aria-expanded',
              'true'
            );

          }


          catch (error) {

            console.warn(
              'StormVector location search failed:',
              error
            );


            status.textContent =
              'Location search is temporarily unavailable.';


            suggestions.hidden =
              true;


            input.setAttribute(
              'aria-expanded',
              'false'
            );

          }

        };


      if (
        isPopup
      ) {

        clearTimeout(
          searchDebouncePopup
        );


        searchDebouncePopup =
          setTimeout(
            run,
            260
          );

      }


      else {

        clearTimeout(
          searchDebounceMain
        );


        searchDebounceMain =
          setTimeout(
            run,
            260
          );

      }

    }
  );


  clear?.addEventListener(
    'click',
    () => {

      clearSearchUI(
        source
      );


      input.focus();

    }
  );


  input.addEventListener(
    'keydown',
    event => {

      if (
        event.key ===
        'Escape'
      ) {

        suggestions.hidden =
          true;


        input.setAttribute(
          'aria-expanded',
          'false'
        );

      }

    }
  );

}


/* ════════════════════════════════════════════════
   SELECT SEARCHED LOCATION
════════════════════════════════════════════════ */

async function selectSearchedLocation(
  result,
  source
) {

  if (
    !result ||
    startupRunning
  ) {

    return;

  }


  /*
    If this is the popup, unlock audio/speech
    during the actual result tap.
  */

  if (
    source ===
    'popup' &&
    !liveStarted
  ) {

    startMediaFromUserGesture(
      'search'
    );

  }


  speechGeneration++;


  try {

    speechSynthesis.cancel();

  }

  catch (_) {}


  setRobotSpeaking(
    false
  );


  liveLat =
    result.latitude;


  liveLon =
    result.longitude;


  liveCity =
    result.name;


  liveStateCode =
    result.stateCode ||
    '';


  liveStateName =
    result.stateName ||
    stateNameFromCode(
      result.stateCode
    );


  liveCityState =
    normalizePlaceName(
      liveCity,
      liveStateCode,
      liveStateName
    );


  liveLocationMode =
    'search';


  broadcastLoopCount =
    0;


  spokenFactMemory.clear();


  updateReturnButton();


  clearSearchUI(
    'main'
  );


  clearSearchUI(
    'popup'
  );


  setLocationText(
    liveCityState
  );


  setLocationSource(
    'Viewing searched location'
  );


  setCaption(
    `Loading weather for ${liveCityState}…`
  );


  setLiveBadge(
    'UPDATING'
  );


  try {

    await prepareBroadcast();


    /*
      Popup search becomes the initial broadcast.
    */

    if (
      source ===
      'popup' &&
      !liveStarted
    ) {

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


      await bringMusicUp();


      requestWakeLock();


      startSevereWatch();


      startSpeechKeepAlive();


      if (
        startupSpeechPromise
      ) {

        await Promise.race([
          startupSpeechPromise,
          wait(5000)
        ]);

      }


      await wait(
        250
      );


      speakSegment(
        0
      );


      return;

    }


    /*
      Search while already broadcasting.
    */

    if (
      liveStarted &&
      !liveMuted
    ) {

      await bringMusicUp();


      await speakSingleLine(
        `Let's head over to ${liveCityState}. I've loaded the latest weather there.`
      );


      await wait(
        300
      );


      speakSegment(
        0
      );

    }

  }


  catch (error) {

    console.error(
      'StormVector searched location failed:',
      error
    );


    setCaption(
      `I couldn't load the weather for ${liveCityState}. Try another location.`
    );


    setLiveBadge(
      'ERROR'
    );

  }

}


/* ════════════════════════════════════════════════
   RETURN TO DEVICE LOCATION
════════════════════════════════════════════════ */

async function returnToMyLocation() {

  if (
    startupRunning
  ) {

    return;

  }


  speechGeneration++;


  try {

    speechSynthesis.cancel();

  }

  catch (_) {}


  setRobotSpeaking(
    false
  );


  setLiveBadge(
    'UPDATING'
  );


  setCaption(
    'Returning to your current location…'
  );


  try {

    if (
      !deviceLocationReady
    ) {

      await requestCurrentLocation();

    }


    else {

      liveLat =
        deviceLat;


      liveLon =
        deviceLon;


      liveLocationMode =
        'device';

    }


    broadcastLoopCount =
      0;


    spokenFactMemory.clear();


    await prepareBroadcast();


    updateReturnButton();


    if (
      liveStarted &&
      !liveMuted
    ) {

      await speakSingleLine(
        `We're back to your current location. I've refreshed the local weather.`
      );


      await wait(
        300
      );


      speakSegment(
        0
      );

    }

  }


  catch (error) {

    console.error(
      'StormVector return location failed:',
      error
    );


    setCaption(
      error.message ||
      'I could not return to your device location.'
    );


    setLiveBadge(
      'ERROR'
    );

  }

}


/* ════════════════════════════════════════════════
   NWS POINT + FORECAST
════════════════════════════════════════════════ */

async function fetchNwsPoint(
  lat,
  lon
) {

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


  return data.properties ||
    {};

}


async function fetchNwsForecastFromPoint(
  pointProperties
) {

  let today =
    null;

  let tonight =
    null;


  if (
    !pointProperties?.forecast
  ) {

    return {
      today,
      tonight
    };

  }


  try {

    const response =
      await safeFetch(
        pointProperties.forecast,
        {
          timeout: 10000,
          headers: {
            Accept: 'application/geo+json'
          }
        }
      );


    const data =
      await response.json();


    const periods =
      data.properties
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
      ) ||

      periods[0];


    const nextNight =
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

        nextNight?.detailedForecast ||

        nextNight?.shortForecast

      );

  }


  catch (error) {

    console.warn(
      'StormVector forecast failed:',
      error
    );

  }


  return {
    today,
    tonight
  };

}


/* ════════════════════════════════════════════════
   NWS OBSERVATION STATION
════════════════════════════════════════════════ */

async function fetchNearestObservation(
  pointProperties
) {

  const stationsUrl =
    pointProperties
      ?.observationStations;


  if (
    !stationsUrl
  ) {

    return null;

  }


  try {

    const stationsResponse =
      await safeFetch(
        stationsUrl,
        {
          timeout: 10000,
          headers: {
            Accept: 'application/geo+json'
          }
        }
      );


    const stationsData =
      await stationsResponse
        .json();


    const stations =
      stationsData.features ||
      [];


    /*
      Try several nearby stations.

      This protects us if the absolute closest
      station has stale or missing data.
    */

    for (
      const station
      of stations.slice(0, 5)
    ) {

      const stationId =
        station.properties
          ?.stationIdentifier;


      const stationName =
        station.properties
          ?.name ||
        stationId ||
        'Nearby NWS Station';


      const stationUrl =
        station.id;


      if (
        !stationUrl
      ) {

        continue;

      }


      try {

        const latestResponse =
          await safeFetch(
            `${stationUrl}/observations/latest`,
            {
              timeout: 8000,
              headers: {
                Accept: 'application/geo+json'
              }
            }
          );


        const latestData =
          await latestResponse
            .json();


        const properties =
          latestData.properties ||
          {};


        const timestamp =
          properties.timestamp
            ? new Date(
                properties.timestamp
              )
            : null;


        /*
          Do not trust a station that is extremely stale.
          Two hours is generous enough for sparse stations.
        */

        if (
          timestamp &&
          Date.now() -
          timestamp.getTime() >
          2 * 60 * 60 * 1000
        ) {

          continue;

        }


        const tempF =
          fahrenheitFromCelsius(
            properties.temperature
              ?.value
          );


        /*
          A station with no temperature at all
          is probably not useful as our primary source.
        */

        if (
          tempF ===
          null
        ) {

          continue;

        }


        return {

          stationId,

          stationName,

          timestamp,

          tempF,


          dewF:
            fahrenheitFromCelsius(
              properties.dewpoint
                ?.value
            ),


          windSpd:
            mphFromKmh(
              properties.windSpeed
                ?.value
            ) ??
            0,


          windG:
            mphFromKmh(
              properties.windGust
                ?.value
            ) ??
            0,


          windDeg:
            properties.windDirection
              ?.value ??
            0,


          humidity:
            properties.relativeHumidity
              ?.value !==
              null &&
            properties.relativeHumidity
              ?.value !==
              undefined

              ? Math.round(
                  properties.relativeHumidity.value
                )

              : null,


          textDescription:
            removeEmoji(
              properties.textDescription ||
              ''
            )

        };

      }


      catch (error) {

        console.warn(
          `StormVector observation station failed: ${stationId || stationName}`,
          error
        );

      }

    }

  }


  catch (error) {

    console.warn(
      'StormVector station list failed:',
      error
    );

  }


  return null;

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

    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +

    '&daily=sunrise,sunset' +

    '&temperature_unit=fahrenheit' +

    '&wind_speed_unit=mph' +

    '&timezone=auto';


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


    return data.features ||
      [];

  }


  catch (error) {

    console.warn(
      'StormVector alerts failed:',
      error
    );


    return [];

  }

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
              ?.LABEL ||

            feature.properties
              ?.label ||

            feature.properties
              ?.DN ||

            ''

          )
          .toUpperCase();


        if (
          !SPC_RANK[label]
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


/* ════════════════════════════════════════════════
   OBSERVATION UI
════════════════════════════════════════════════ */

function observationAgeText(
  timestamp
) {

  if (!timestamp) {
    return '';
  }


  const minutes =
    Math.max(
      0,
      Math.round(
        (
          Date.now() -
          timestamp.getTime()
        ) /
        60000
      )
    );


  if (
    minutes <
    2
  ) {

    return 'just reported';

  }


  if (
    minutes <
    60
  ) {

    return `${minutes} min ago`;

  }


  const hours =
    Math.round(
      minutes /
      60
    );


  return `${hours} hr ago`;

}


function renderObservationInfo(
  observation
) {

  const wrapper =
    document.getElementById(
      'liveObservationInfo'
    );


  const station =
    document.getElementById(
      'liveObservationStation'
    );


  const age =
    document.getElementById(
      'liveObservationAge'
    );


  if (
    !wrapper ||
    !station ||
    !age
  ) {

    return;

  }


  if (
    !observation
  ) {

    wrapper.hidden =
      true;

    return;

  }


  station.textContent =

    observation.stationId

      ? `${observation.stationName} (${observation.stationId})`

      : observation.stationName;


  age.textContent =
    observationAgeText(
      observation.timestamp
    );


  wrapper.hidden =
    false;

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
          alert.properties?.event || ''
        )
    )
  ) {

    window.setBgMode(
      'tornado'
    );

    return;

  }


  if (
    [95,96,99]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'storm'
    );

  }


  else if (
    [71,73,75,77,85,86]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'snow'
    );

  }


  else if (
    [45,48]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'fog'
    );

  }


  else if (
    [51,53,55,61,63,65,80,81,82]
      .includes(
        ctx.wcode
      )
  ) {

    window.setBgMode(
      'rain'
    );

  }


  else if (
    ctx.wcode ===
    1
  ) {

    window.setBgMode(
      'partlycloudy'
    );

  }


  else if (
    [2,3]
      .includes(
        ctx.wcode
      )
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
   VECTOR UI
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


  if (caption) {

    caption.textContent =
      removeEmoji(
        text
      );

  }


  announce(
    removeEmoji(
      text
    )
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


  badge.classList.toggle(
    'live-badge-on',
    text === 'LIVE'
  );

}


/* ════════════════════════════════════════════════
   SCRIPT HELPERS
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
      "I'm still waiting on the latest temperature, but the rest of the weather information is available."
    );

    return;

  }


  const previousTemp =
    spokenFactMemory.get(
      'temperature'
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
      previousFeels === undefined ||
      previousFeels !== ctx.feelsF ||
      broadcastLoopCount === 0
    )

      ? `, and it feels closer to ${ctx.feelsF}`

      : '';


  if (
    previousTemp ===
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


  if (
    condition &&
    (
      broadcastLoopCount === 0 ||
      broadcastLoopCount % 3 === 0
    )
  ) {

    segments.push(
      `Conditions are showing ${condition}.`
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


  const direction =
    window.degToCompass(
      ctx.windDeg
    ) ||
    'variable';


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

  if (
    !alerts.length
  ) {

    if (
      broadcastLoopCount ===
      0
    ) {

      segments.push(
        'There are no active National Weather Service alerts for this location right now.'
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
          (
            properties.areaDesc ||
            'the area'
          )
          .split(';')[0];


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

          `A ${properties.event || 'weather alert'} is in effect for ${area}${expiration ? ` until ${expiration}` : ''}.`

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
    !labels[spc]
  ) {

    return;

  }


  segments.push(
    `The Storm Prediction Center has this location under ${labels[spc]} today.`
  );


  if (
    SPC_RANK[spc] >=
    SPC_RANK.ENH
  ) {

    segments.push(
      "That's a meaningful severe weather signal, so I'll keep it near the top of the broadcast."
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
    !ctx.forecast?.tonight
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
            alert.properties?.event ||
            ''
          )
    );


  const watches =
    ctx.alerts.filter(
      alert =>
        /Watch/i
          .test(
            alert.properties?.event ||
            ''
          )
    );


  const severeMode =
    warnings.length > 0 ||
    watches.length > 0;


  /*
    LOCATION-SPECIFIC OPENING

    Device location:
      "I've got the latest weather loaded for Waupun, Wisconsin."

    Searched location:
      "We're taking a look at Dallas, Texas."
  */

  if (
    broadcastLoopCount ===
    0
  ) {

    if (
      liveLocationMode ===
      'search'
    ) {

      if (
        severeMode
      ) {

        segments.push(
          `We're taking a look at ${ctx.cityState}. There is active severe weather information for that area, so let's get right to it.`
        );

      }


      else {

        segments.push(
          `We're taking a look at ${ctx.cityState}. Here's the latest weather there.`
        );

      }

    }


    else {

      if (
        severeMode
      ) {

        segments.push(
          `I've got the latest weather loaded for ${ctx.cityState}, and there is active severe weather information, so let's get right to it.`
        );

      }


      else {

        segments.push(
          `I've got the latest weather loaded for ${ctx.cityState}. Here's where things stand.`
        );

      }

    }

  }


  else {

    if (
      liveLocationMode ===
      'search'
    ) {

      segments.push(
        `Here's another check on ${ctx.cityState}.`
      );

    }


    else {

      segments.push(
        `Here's another check of your local weather in ${ctx.cityState}.`
      );

    }

  }


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
      4;


    if (
      rotation ===
      0
    ) {

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
          `Sunset is around ${ctx.sunset} this evening.`
        );

      }

    }


    else {

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


  /*
    Get the NWS point first because it gives us:
      - city/state
      - forecast URL
      - observation stations URL
  */

  let nwsPoint =
    {};


  try {

    nwsPoint =
      await fetchNwsPoint(
        liveLat,
        liveLon
      );

  }


  catch (error) {

    console.warn(
      'StormVector NWS point failed:',
      error
    );

  }


  /*
    NWS relative location is authoritative for
    device location.

    For searched locations we preserve the
    searched city name so "Dallas" doesn't suddenly
    become a nearby suburb.
  */

  const relative =
    nwsPoint
      ?.relativeLocation
      ?.properties;


  if (
    liveLocationMode !==
    'search'
  ) {

    liveCity =
      relative?.city ||
      liveCity ||
      'Your Area';


    liveStateCode =
      relative?.state ||
      liveStateCode ||
      '';


    liveStateName =
      stateNameFromCode(
        liveStateCode
      );


    liveCityState =
      normalizePlaceName(
        liveCity,
        liveStateCode,
        liveStateName
      );

  }


  else {

    liveCityState =
      normalizePlaceName(
        liveCity,
        liveStateCode,
        liveStateName
      );

  }


  const [
    forecast,
    openMeteo,
    alerts,
    spc,
    observation
  ] =
    await Promise.all([

      fetchNwsForecastFromPoint(
        nwsPoint
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
      ),


      fetchNearestObservation(
        nwsPoint
      )

    ]);


  /*
    OBSERVATION-FIRST CONDITIONS

    NWS station:
      temperature
      dew point
      humidity
      wind
      gusts

    Open-Meteo:
      feels-like
      weather code
      sunrise/sunset
      fallback for missing station fields
  */

  const ctx = {

    city:
      liveCity,


    stateCode:
      liveStateCode,


    stateName:
      liveStateName,


    cityState:
      liveCityState,


    tempF:
      observation?.tempF ??
      openMeteo.tempF ??
      null,


    feelsF:
      openMeteo.feelsF ??
      null,


    humidity:
      observation?.humidity ??
      openMeteo.humidity ??
      null,


    dewF:
      observation?.dewF ??
      openMeteo.dewF ??
      null,


    wcode:
      openMeteo.wcode ??
      null,


    windSpd:
      observation?.windSpd ??
      openMeteo.windSpd ??
      0,


    windDeg:
      observation?.windDeg ??
      openMeteo.windDeg ??
      0,


    windG:
      observation?.windG ??
      openMeteo.windG ??
      0,


    sunrise:
      openMeteo.sunrise ??
      null,


    sunset:
      openMeteo.sunset ??
      null,


    alerts:
      alerts ||
      [],


    forecast:
      forecast ||
      {
        today:
          null,

        tonight:
          null
      },


    spc:
      spc ||
      null,


    observation

  };


  latestContext =
    ctx;


  /*
    Avoid treating already-active alerts
    as brand-new breaking alerts.
  */

  if (
    broadcastLoopCount ===
    0
  ) {

    ctx.alerts.forEach(
      alert => {

        if (
          /Warning|Watch|Emergency/i
            .test(
              alert.properties?.event ||
              ''
            )
        ) {

          knownPriorityAlertIds.add(
            alert.id
          );

        }

      }
    );

  }


  setLocationText(
    ctx.cityState
  );


  setLocationSource(

    liveLocationMode ===
    'search'

      ? 'Viewing searched location'

      : 'Using your current location'

  );


  updateReturnButton();


  renderConditionsRow(
    ctx
  );


  renderObservationInfo(
    observation
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
    liveVoice?.name ||
    'default'
  );

}


if (
  'speechSynthesis'
  in window
) {

  speechSynthesis.onvoiceschanged =
    pickVoice;


  pickVoice();

}


/* ════════════════════════════════════════════════
   CREATE UTTERANCE
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

      ? 0.91

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


    liveMusic.src =
      './stormvector-theme.mp3';


    document.body.appendChild(
      liveMusic
    );

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


  const startVolume =
    Number.isFinite(
      music.volume
    )
      ? music.volume
      : 0;


  const startTime =
    performance.now();


  function frame(now) {

    const progress =

      duration <= 0

        ? 1

        : clamp(
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
    0.04,
    240
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
    0.08,
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


function stopMusic() {

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
        liveMusic
      ) {

        liveMusic.pause();

      }

    },
    340
  );

}


/* ════════════════════════════════════════════════
   USER-GESTURE MEDIA START
════════════════════════════════════════════════ */

function startMediaFromUserGesture(
  mode = 'device'
) {

  const music =
    ensureLiveMusicElement();


  /*
    Unlock theme audio immediately.
  */

  try {

    music.volume =
      0.02;


    const promise =
      music.play();


    promise?.catch(
      error =>
        console.warn(
          'StormVector audio unlock failed:',
          error
        )
    );

  }


  catch (error) {

    console.warn(
      'StormVector audio unlock failed:',
      error
    );

  }


  /*
    Audible speech starts during the tap.
    This is what fixed Safari requiring Stop/Resume.
  */

  startupSpeechPromise =
    new Promise(
      resolve => {

        if (
          !('speechSynthesis' in window)
        ) {

          resolve();

          return;

        }


        const text =

          mode ===
          'search'

            ? "Vector here. Give me a second while I load the weather for that location."

            : "Vector here. Give me a second while I pull up your local weather.";


        const utterance =
          createUtterance(
            text
          );


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
          () => {

            setRobotSpeaking(
              false
            );


            resolve();

          };


        speechSynthesis.speak(
          utterance
        );

      }
    );

}


/* ════════════════════════════════════════════════
   START DEVICE BROADCAST
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
    MUST STAY BEFORE FIRST AWAIT.
  */

  startMediaFromUserGesture(
    'device'
  );


  if (
    button
  ) {

    button.disabled =
      true;


    button.textContent =
      'Getting Location…';

  }


  try {

    setLocationText(
      'Waiting for location permission…'
    );


    await requestCurrentLocation();


    setLocationText(
      'Loading your local weather…'
    );


    if (
      button
    ) {

      button.textContent =
        'Loading Weather…';

    }


    broadcastLoopCount =
      0;


    spokenFactMemory.clear();


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
          5500
        )

      ]);

    }


    await wait(
      250
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


    try {

      speechSynthesis.cancel();

    }

    catch (_) {}


    setRobotSpeaking(
      false
    );


    stopMusic();


    setLiveBadge(
      'STANDBY'
    );


    setLocationText(
      error.message ||
      'Unable to start StormVector.'
    );


    setCaption(
      'StormVector could not start. Check location permission and try again.'
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
   SPEAK ONE LINE
════════════════════════════════════════════════ */

function speakSingleLine(
  text
) {

  return new Promise(
    resolve => {

      if (
        !('speechSynthesis' in window) ||
        liveMuted
      ) {

        resolve();

        return;

      }


      const utterance =
        createUtterance(
          text
        );


      utterance.onstart =
        () => {

          duckMusic();


          setRobotSpeaking(
            true
          );


          setCaption(
            text
          );


          setLiveBadge(
            'LIVE'
          );

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
        () => {

          setRobotSpeaking(
            false
          );


          resolve();

        };


      speechSynthesis.speak(
        utterance
      );

    }
  );

}


/* ════════════════════════════════════════════════
   NORMAL SPEECH
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


  if (
    !('speechSynthesis' in window)
  ) {

    if (
      liveSegments[index]
    ) {

      setCaption(
        liveSegments[index]
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
        Longer pauses help Safari avoid clipping
        or skipping the beginning of the next line.
      */

      let pause =
        650;


      if (
        text.length >
        180
      ) {

        pause =
          900;

      }


      if (
        /warning|watch|emergency/i
          .test(
            text
          )
      ) {

        pause =
          950;

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
        700
      );

    };


  /*
    Give Safari a small gap before enqueueing
    the next utterance.
  */

  setTimeout(
    () => {

      if (
        generation ===
        speechGeneration &&
        !liveMuted
      ) {

        speechSynthesis.speak(
          utterance
        );

      }

    },
    80
  );

}


/* ════════════════════════════════════════════════
   LOOP
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
    6000
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
    900
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
    () => {

      speakSegment(
        liveSegIdx
      );

    },
    180
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


    stopMusic();


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
    liveLat === null ||
    liveLon === null
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

        .filter(
          alert =>
            /Warning|Watch|Emergency/i
              .test(
                alert.properties?.event ||
                ''
              )
        )

        .sort(
          (a,b) =>

            window.alertPriorityScore(
              a.properties?.event ||
              ''
            ) -

            window.alertPriorityScore(
              b.properties?.event ||
              ''
            )

        );


    const fresh =
      priority.filter(
        alert =>
          !knownPriorityAlertIds
            .has(
              alert.id
            )
      );


    priority.forEach(
      alert =>
        knownPriorityAlertIds
          .add(
            alert.id
          )
    );


    if (
      fresh.length
    ) {

      await interruptForBreakingWeather(
        fresh[0]
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
   ATTENTION TONE
════════════════════════════════════════════════ */

async function playAttentionTone() {

  try {

    const AudioContextClass =

      window.AudioContext ||

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
      .18;


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


    await context.close()
      .catch(
        () => {}
      );

  }


  catch (error) {

    console.warn(
      'StormVector tone failed:',
      error
    );

  }

}


/* ════════════════════════════════════════════════
   BREAKING WEATHER
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
    .02,
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
    properties.event ||
    'weather alert';


  const area =
    (
      properties.areaDesc ||
      liveCityState ||
      'the area'
    )
    .split(';')[0];


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


  catch (error) {

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
      750
    );


    speakSegment(
      0
    );

  }

}


/* ════════════════════════════════════════════════
   SEQUENTIAL SPEECH
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
          .91;


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
              700
            );

          };


        utterance.onerror =
          () => {

            setRobotSpeaking(
              false
            );


            index++;


            setTimeout(
              next,
              500
            );

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
    Android only.

    Do NOT use pause/resume keepalive on iPhone.
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
      in navigator &&
      document.visibilityState ===
      'visible'
    ) {

      wakeLock =
        await navigator.wakeLock
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


    if (
      liveStarted &&
      !liveMuted
    ) {

      requestWakeLock();

    }

  }
);


/* ════════════════════════════════════════════════
   CLICK OUTSIDE SEARCH RESULTS
════════════════════════════════════════════════ */

document.addEventListener(
  'click',
  event => {

    const mainWrap =
      document.getElementById(
        'liveSearchWrap'
      );


    const popupWrap =
      document.querySelector(
        '.live-popup-search-wrap'
      );


    if (
      mainWrap &&
      !mainWrap.contains(
        event.target
      )
    ) {

      const suggestions =
        document.getElementById(
          'liveSearchSuggestions'
        );


      if (
        suggestions
      ) {

        suggestions.hidden =
          true;

      }

    }


    if (
      popupWrap &&
      !popupWrap.contains(
        event.target
      )
    ) {

      const suggestions =
        document.getElementById(
          'livePopupSearchSuggestions'
        );


      if (
        suggestions
      ) {

        suggestions.hidden =
          true;

      }

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


    setupSearchBox(
      'main'
    );


    setupSearchBox(
      'popup'
    );


    setLocationText(
      'Location not selected'
    );


    setLocationSource(
      'StormVector Live Weather'
    );


    setCaption(
      'Choose your current location or search for a United States location to begin.'
    );


    setLiveBadge(
      'STANDBY'
    );


    updateReturnButton();


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