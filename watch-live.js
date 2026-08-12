/* ═══════════════════════════════════════════════════════
   STORMVECTOR LIVE — COMPLETE BROADCAST ENGINE
   FILE 3 OF 3
   watch-live.js

   BUILT FOR THE MATCHING:
   - watch-live.html
   - styles.css

   FEATURES
   - Startup popup
   - iPhone/Safari speech + music startup
   - Current GPS location
   - Predictive U.S. location search
   - Full spoken state names
   - Nearest NWS observation station
   - NWS forecast + alerts
   - Open-Meteo fallback + hourly timeline
   - SPC Day 1 outlook
   - Manual Now / Radar / Forecast / Severe / Changes
   - NOAA MRMS radar
   - Local / State / Regional radar zoom
   - Warning polygons
   - Radar refresh
   - Data freshness
   - What Changed engine
   - Ask Vector
   - Broadcast history
   - Severe weather takeover
   - Return to previous manual view after takeover
   - No forecast emojis
   - Short speech chunks for iPhone reliability
═══════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════
   FEATURE SWITCHES
════════════════════════════════════════════════ */

const STORMVECTOR_FEATURES = {

  radar: true,

  warningPolygons: true,

  askVector: true,

  changeEngine: true,

  broadcastHistory: true,

  severeTakeover: true

};


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

let startupSpeechPromise = null;

let broadcastLoopCount = 0;

let currentWeatherContext = null;

let speechGeneration = 0;

let speechKeepAlive = null;

let wakeLock = null;


/* ═══════════════════════════════════════════════
   MANUAL PANEL STATE
════════════════════════════════════════════════ */

let selectedView = 'conditions';

let viewBeforeSevere = 'conditions';

let severeTakeoverActive = false;


/* ═══════════════════════════════════════════════
   MUSIC STATE
════════════════════════════════════════════════ */

let liveMusic = null;

let musicFadeFrame = null;


/* ═══════════════════════════════════════════════
   SEVERE WEATHER STATE
════════════════════════════════════════════════ */

let breakingWeatherActive = false;

let severeWatchTimer = null;

const knownPriorityAlertIds =
  new Set();


/* ═══════════════════════════════════════════════
   WEATHER MEMORY
════════════════════════════════════════════════ */

const spokenFactMemory =
  new Map();

const phraseHistory = {};

let previousWeatherSnapshot = null;

let latestChanges = [];


/* ═══════════════════════════════════════════════
   SEARCH STATE
════════════════════════════════════════════════ */

let locationSearchTimer = null;

let locationSearchController = null;


/* ═══════════════════════════════════════════════
   RADAR STATE
════════════════════════════════════════════════ */

let radarMap = null;

let radarLayer = null;

let radarMarker = null;

let radarWarningLayer = null;

let radarWarningsVisible = true;

let radarZoomMode = 'local';

let radarLastLoaded = null;


/* ═══════════════════════════════════════════════
   BROADCAST HISTORY
════════════════════════════════════════════════ */

const broadcastHistory = [];

const MAX_HISTORY_ITEMS = 30;


/* ═══════════════════════════════════════════════
   ASK VECTOR MEMORY
════════════════════════════════════════════════ */

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


/* ═══════════════════════════════════════════════
   STATE NAMES
════════════════════════════════════════════════ */

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
   FALLBACK HELPERS
════════════════════════════════════════════════ */

(function installFallbacks() {

  const install = (
    name,
    fn
  ) => {

    if (
      typeof window[name] !==
      'function'
    ) {

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
    degrees => {

      if (
        degrees === null ||
        degrees === undefined ||
        Number.isNaN(
          Number(degrees)
        )
      ) {

        return '';

      }

      const directions = [

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

      return directions[
        Math.round(
          Number(degrees) /
          22.5
        ) %
        16
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
        String(
          event || ''
        )
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


      for (
        const [
          needle,
          score
        ] of order
      ) {

        if (
          text.includes(
            needle
          )
        ) {

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
        .test(
          event || ''
        )
  );


  install(
    'parseMovement',
    description => {

      const text =
        String(
          description || ''
        );


      let match =
        /moving\s+([nsew]{1,3})\s+at\s+(\d+)\s*mph/i
          .exec(
            text
          );


      if (match) {

        return {

          dir:
            match[1]
              .toUpperCase(),

          spd:
            match[2]

        };

      }


      match =
        /moving\s+(north|south|east|west|northeast|northwest|southeast|southwest)\s+at\s+(\d+)\s*mph/i
          .exec(
            text
          );


      if (match) {

        return {

          dir:
            match[1],

          spd:
            match[2]

        };

      }


      return null;

    }
  );

})();


/* ═══════════════════════════════════════════════
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
    !panel.classList
      .contains(
        'open'
      );


  panel.classList
    .toggle(
      'open',
      opening
    );


  button
    ?.setAttribute(
      'aria-expanded',
      String(
        opening
      )
    );

}


document.addEventListener(
  'click',
  event => {

    if (
      event.target.closest(
        '#menuPanel'
      ) ||
      event.target.closest(
        '#menuBtn'
      )
    ) {

      return;

    }


    document
      .getElementById(
        'menuPanel'
      )
      ?.classList
      .remove(
        'open'
      );


    document
      .getElementById(
        'menuBtn'
      )
      ?.setAttribute(
        'aria-expanded',
        'false'
      );

  }
);


/* ═══════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════ */

function wait(
  milliseconds
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );

}


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(

    minimum,

    Math.min(
      maximum,
      value
    )

  );

}


function numberOrNull(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  const result =
    Number(
      value
    );


  return Number.isFinite(
    result
  )
    ? result
    : null;

}


function stateName(
  value
) {

  const state =
    String(
      value || ''
    )
    .trim();


  return (
    STATE_NAMES[
      state.toUpperCase()
    ] ||
    state
  );

}


function celsiusToFahrenheit(
  celsius
) {

  const value =
    numberOrNull(
      celsius
    );


  if (
    value === null
  ) {

    return null;

  }


  return Math.round(

    value *
    9 /
    5 +
    32

  );

}


function kmhToMph(
  kmh
) {

  const value =
    numberOrNull(
      kmh
    );


  if (
    value === null
  ) {

    return null;

  }


  return Math.round(
    value *
    0.621371
  );

}


function metersPerSecondToMph(
  value
) {

  const number =
    numberOrNull(
      value
    );


  if (
    number === null
  ) {

    return null;

  }


  return Math.round(
    number *
    2.23694
  );

}


function escapeHtml(
  value
) {

  return String(
    value || ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );

}


function removeEmojis(
  text
) {

  let result =
    String(
      text || ''
    );


  try {

    result =
      result.replace(
        /\p{Extended_Pictographic}/gu,
        ''
      );

  }


  catch (_) {

    result =
      result.replace(
        /[\u2600-\u27BF]/g,
        ''
      );

  }


  return result
    .replace(
      /\uFE0F/g,
      ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();

}


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


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );


  try {

    const response =
      await fetch(
        url,
        {

          ...rest,

          signal:
            controller.signal

        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `HTTP ${response.status}`
      );

    }


    return response;

  }


  finally {

    clearTimeout(
      timer
    );

  }

}


/* ═══════════════════════════════════════════════
   RANDOM PHRASES
════════════════════════════════════════════════ */

function pickPhrase(
  pool,
  category
) {

  if (
    !pool?.length
  ) {

    return '';

  }


  if (
    !phraseHistory[
      category
    ]
  ) {

    phraseHistory[
      category
    ] =
      new Set();

  }


  const used =
    phraseHistory[
      category
    ];


  let available =
    pool
      .map(
        (
          _,
          index
        ) =>
          index
      )
      .filter(
        index =>
          !used.has(
            index
          )
      );


  if (
    !available.length
  ) {

    used.clear();


    available =
      pool.map(
        (
          _,
          index
        ) =>
          index
      );

  }


  const chosen =
    available[
      Math.floor(
        Math.random() *
        available.length
      )
    ];


  used.add(
    chosen
  );


  return pool[
    chosen
  ];

}


function fill(
  template,
  values
) {

  return String(
    template
  )
    .replace(
      /\{(\w+)\}/g,
      (
        _,
        key
      ) =>
        values[
          key
        ] !==
        undefined
          ? values[
              key
            ]
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


/* ═══════════════════════════════════════════════
   SPEECH SAFETY
════════════════════════════════════════════════ */

function splitLongSpeech(
  text
) {

  const cleaned =
    removeEmojis(
      text
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();


  if (
    cleaned.length <=
    170
  ) {

    return [
      cleaned
    ];

  }


  const sentences =
    cleaned.match(
      /[^.!?]+[.!?]+|[^.!?]+$/g
    ) ||
    [
      cleaned
    ];


  const chunks = [];

  let current = '';


  for (
    const sentenceRaw
    of sentences
  ) {

    const sentence =
      sentenceRaw.trim();


    if (!sentence) {
      continue;
    }


    if (!current) {

      current =
        sentence;

      continue;

    }


    const candidate =
      `${current} ${sentence}`;


    if (
      candidate.length <=
      170
    ) {

      current =
        candidate;

    }


    else {

      chunks.push(
        current
      );


      current =
        sentence;

    }

  }


  if (
    current
  ) {

    chunks.push(
      current
    );

  }


  return chunks;

}


function polishSegments(
  segments
) {

  const seen =
    new Set();


  const output =
    [];


  segments
    .map(
      text =>
        removeEmojis(
          text
        )
        .replace(
          /\s+\./g,
          '.'
        )
        .trim()
    )
    .filter(
      Boolean
    )
    .forEach(
      text => {

        splitLongSpeech(
          text
        )
        .forEach(
          chunk => {

            const key =
              chunk
                .toLowerCase();


            if (
              seen.has(
                key
              )
            ) {

              return;

            }


            seen.add(
              key
            );


            output.push(
              chunk
            );

          }
        );

      }
    );


  return output;

}


/* ═══════════════════════════════════════════════
   SPEECH CLEANUP
════════════════════════════════════════════════ */

function renderForSpeech(
  text
) {

  let result =
    removeEmojis(
      text
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


  Object.entries(
    STATE_NAMES
  )
  .forEach(
    (
      [
        abbreviation,
        fullName
      ]
    ) => {

      const expression =
        new RegExp(
          `\\b${abbreviation}\\b`,
          'g'
        );


      result =
        result.replace(
          expression,
          fullName
        );

    }
  );


  return result;

}


/* ═══════════════════════════════════════════════
   FORECAST CLEANUP
════════════════════════════════════════════════ */

function cleanForecastText(
  text
) {

  if (!text) {
    return null;
  }


  let cleaned =
    removeEmojis(
      text
    );


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
        /\bPatchy smoke\.?/gi,
        ''
      )
      .replace(
        /\bAreas of smoke\.?/gi,
        ''
      )
      .replace(
        /\bWidespread haze\.?/gi,
        ''
      )
      .replace(
        /\bPatchy haze\.?/gi,
        ''
      )
      .replace(
        /\bChance of precipitation is\b/gi,
        'Rain chances are'
      )
      .replace(
        /\bNew precipitation amounts?[^.]*\.?/gi,
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
    ) ||
    [
      cleaned
    ];


  return sentences
    .map(
      sentence =>
        sentence.trim()
    )
    .filter(
      Boolean
    )
    .slice(
      0,
      3
    )
    .join(
      ' '
    )
    .trim();

}


/* ═══════════════════════════════════════════════
   WEATHER LANGUAGE
════════════════════════════════════════════════ */

function weatherCodePhrase(
  code
) {

  if (
    [
      95,
      96,
      99
    ].includes(
      code
    )
  ) {

    return 'thunderstorms';

  }


  if (
    [
      71,
      73,
      75,
      77,
      85,
      86
    ].includes(
      code
    )
  ) {

    return 'snow';

  }


  if (
    [
      61,
      63,
      65,
      80,
      81,
      82
    ].includes(
      code
    )
  ) {

    return 'rain showers';

  }


  if (
    [
      56,
      57,
      66,
      67
    ].includes(
      code
    )
  ) {

    return 'freezing precipitation';

  }


  if (
    [
      51,
      53,
      55
    ].includes(
      code
    )
  ) {

    return 'drizzle';

  }


  if (
    [
      45,
      48
    ].includes(
      code
    )
  ) {

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

  if (
    [
      45,
      48
    ].includes(
      code
    )
  ) {

    return 'foggy conditions';

  }


  return weatherCodePhrase(
    code
  );

}


/* ═══════════════════════════════════════════════
   SPEECH BANK
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


/* ═══════════════════════════════════════════════
   BASIC UI HELPERS
════════════════════════════════════════════════ */

function setText(
  id,
  value
) {

  const element =
    document.getElementById(
      id
    );


  if (element) {

    element.textContent =
      value;

  }

}


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

  }


  else {

    setText(
      'liveLocationCard',
      text
    );

  }


  setText(
    'askVectorLocation',
    text
  );


  setText(
    'radarLocationLabel',
    text
  );

}


function setLocationSource(
  text
) {

  setText(
    'liveLocationSource',
    text
  );

}


function setCaption(
  text
) {

  const cleaned =
    removeEmojis(
      text
    );


  setText(
    'liveCaptionText',
    cleaned
  );


  announce(
    cleaned
  );

}


function setCaptionTopic(
  text
) {

  setText(
    'liveCaptionTopic',
    String(
      text || ''
    )
    .toUpperCase()
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
      ${escapeHtml(text)}
    </span>

  `;


  badge.classList
    .toggle(
      'live-badge-on',
      text ===
      'LIVE'
    );

}


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


function hideStartOverlay() {

  const overlay =
    document.getElementById(
      'liveStartOverlay'
    );


  if (overlay) {

    overlay.style.display =
      'none';

  }

}


function updateReturnLocationButton() {

  const button =
    document.getElementById(
      'returnToMyLocationBtn'
    );


  if (!button) {
    return;
  }


  button.hidden =
    locationMode !==
    'search';

}


/* ═══════════════════════════════════════════════
   MANUAL DISPLAY VIEWS
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


  if (
    !allowed.includes(
      view
    )
  ) {

    return;

  }


  /*
    IMPORTANT:

    Normal Vector speech NEVER calls this.

    The view stays where the user put it.
  */

  document
    .querySelectorAll(
      '.vector-graphic-view'
    )
    .forEach(
      element =>
        element.classList
          .remove(
            'active'
          )
    );


  const selected =
    document.querySelector(
      `[data-graphic="${view}"]`
    );


  selected
    ?.classList
    .add(
      'active'
    );


  document
    .querySelectorAll(
      '.live-view-btn'
    )
    .forEach(
      button => {

        const active =
          button.dataset.view ===
          view;


        button.classList
          .toggle(
            'active',
            active
          );


        button.setAttribute(
          'aria-selected',
          String(
            active
          )
        );

      }
    );


  setText(

    'vectorGraphicTitle',

    VIEW_TITLES[
      view
    ] ||
    'STORMVECTOR DISPLAY'

  );


  if (
    manual &&
    view !==
    'alert'
  ) {

    selectedView =
      view;

  }


  if (
    view ===
    'radar'
  ) {

    ensureRadar();


    setTimeout(
      () =>
        radarMap
          ?.invalidateSize(),
      150
    );

  }

}


function bindViewSelector() {

  document
    .querySelectorAll(
      '.live-view-btn'
    )
    .forEach(
      button => {

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

      }
    );


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
   SPEECH TOPIC ONLY
════════════════════════════════════════════════ */

function topicForSpeech(
  text
) {

  const value =
    String(
      text || ''
    )
    .toLowerCase();


  if (
    /warning|watch|emergency|breaking weather/
      .test(
        value
      )
  ) {

    return 'WEATHER ALERT';

  }


  if (
    /storm prediction center|severe risk|marginal risk|slight risk|enhanced risk|moderate risk|high risk/
      .test(
        value
      )
  ) {

    return 'SEVERE';

  }


  if (
    /wind|gust/
      .test(
        value
      )
  ) {

    return 'WIND';

  }


  if (
    /tonight|forecast|looking ahead|rest of the day|sunset|tomorrow/
      .test(
        value
      )
  ) {

    return 'FORECAST';

  }


  if (
    /changed|since the last/
      .test(
        value
      )
  ) {

    return 'WHAT CHANGED';

  }


  return 'CURRENT CONDITIONS';

}


function updateTopicForSpeech(
  text
) {

  /*
    This changes ONLY the caption topic.

    It does NOT change the selected weather card.
  */

  setCaptionTopic(
    topicForSpeech(
      text
    )
  );

}


/* ═══════════════════════════════════════════════
   DEVICE LOCATION
════════════════════════════════════════════════ */

function geolocationErrorMessage(
  error
) {

  if (!error) {

    return 'StormVector could not get your location.';

  }


  switch (
    error.code
  ) {

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

            deviceLat =
              position.coords.latitude;


            deviceLon =
              position.coords.longitude;


            liveLat =
              deviceLat;


            liveLon =
              deviceLon;


            locationMode =
              'device';


            selectedSearchLocation =
              null;


            locationReady =
              true;


            updateReturnLocationButton();


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


/* ═══════════════════════════════════════════════
   LOCATION SEARCH
════════════════════════════════════════════════ */

async function searchUsLocations(
  query
) {

  const term =
    String(
      query || ''
    )
    .trim();


  if (
    term.length <
    3
  ) {

    return [];

  }


  if (
    locationSearchController
  ) {

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

    const response =
      await fetch(
        url,
        {
          signal:
            locationSearchController.signal
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `Search HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    return (
      data.results ||
      []
    )
    .filter(
      result =>
        Number.isFinite(
          Number(
            result.latitude
          )
        ) &&
        Number.isFinite(
          Number(
            result.longitude
          )
        )
    );

  }


  catch (
    error
  ) {

    if (
      error.name ===
      'AbortError'
    ) {

      return [];

    }


    console.warn(
      'StormVector location search failed:',
      error
    );


    return [];

  }

}


function locationResultDisplay(
  result
) {

  const city =
    result.name ||
    'Selected location';


  const state =
    stateName(
      result.admin1 ||
      ''
    );


  return [
    city,
    state
  ]
  .filter(
    Boolean
  )
  .join(
    ', '
  );

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


  if (
    !suggestions ||
    !input
  ) {

    return;

  }


  suggestions.innerHTML =
    '';


  if (
    !results.length
  ) {

    suggestions.innerHTML = `

      <div class="live-search-suggestion">

        <span class="live-search-suggestion-main">
          No U.S. locations found
        </span>

      </div>

    `;


    suggestions.hidden =
      false;


    input.setAttribute(
      'aria-expanded',
      'true'
    );


    return;

  }


  results
    .forEach(
      result => {

        const button =
          document.createElement(
            'button'
          );


        button.type =
          'button';


        button.className =
          'live-search-suggestion';


        const state =
          stateName(
            result.admin1 ||
            ''
          );


        const secondary =

          [
            result.admin2,
            state
          ]
          .filter(
            Boolean
          )
          .join(
            ', '
          );


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
          () => {

            selectSearchedLocation(
              result
            );

          }
        );


        suggestions.appendChild(
          button
        );

      }
    );


  suggestions.hidden =
    false;


  input.setAttribute(
    'aria-expanded',
    'true'
  );

}


function bindLocationSearch(
  config
) {

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


  if (
    !input ||
    !suggestions
  ) {

    return;

  }


  function closeSuggestions() {

    suggestions.hidden =
      true;


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


      if (
        clearButton
      ) {

        clearButton.hidden =
          !query;

      }


      clearTimeout(
        locationSearchTimer
      );


      if (
        query.length <
        3
      ) {

        closeSuggestions();


        if (
          status
        ) {

          status.textContent =
            '';

        }


        return;

      }


      if (
        status
      ) {

        status.textContent =
          'Searching...';

      }


      locationSearchTimer =
        setTimeout(
          async () => {

            const results =
              await searchUsLocations(
                query
              );


            if (
              input.value.trim() !==
              query
            ) {

              return;

            }


            if (
              status
            ) {

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


  clearButton
    ?.addEventListener(
      'click',
      () => {

        input.value =
          '';


        clearButton.hidden =
          true;


        if (
          status
        ) {

          status.textContent =
            '';

        }


        closeSuggestions();


        input.focus();

      }
    );


  document.addEventListener(
    'click',
    event => {

      if (
        event.target ===
        input ||
        suggestions.contains(
          event.target
        )
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
  ]
  .forEach(
    id => {

      const element =
        document.getElementById(
          id
        );


      if (element) {

        element.hidden =
          true;

      }

    }
  );

}


function setAllSearchInputs(
  value
) {

  [
    'liveLocationSearch',
    'livePopupLocationSearch'
  ]
  .forEach(
    id => {

      const input =
        document.getElementById(
          id
        );


      if (input) {

        input.value =
          value;

      }

    }
  );

}


/* ═══════════════════════════════════════════════
   SELECT SEARCH LOCATION
════════════════════════════════════════════════ */

async function selectSearchedLocation(
  result
) {

  if (!result) {
    return;
  }


  const alreadyStarted =
    liveStarted;


  /*
    If location is selected from startup popup,
    this click is the direct user gesture.
  */

  if (
    !alreadyStarted
  ) {

    startMediaFromUserGesture();

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
    Number(
      result.latitude
    );


  liveLon =
    Number(
      result.longitude
    );


  locationMode =
    'search';


  selectedSearchLocation =
    result;


  locationReady =
    true;


  broadcastLoopCount =
    0;


  spokenFactMemory.clear();


  previousWeatherSnapshot =
    null;


  latestChanges =
    [];


  liveCityState =
    locationResultDisplay(
      result
    );


  setLocationText(
    liveCityState
  );


  setLocationSource(
    'StormVector selected location'
  );


  updateReturnLocationButton();


  setAllSearchInputs(
    liveCityState
  );


  closeAllSearchSuggestions();


  setLiveBadge(
    'UPDATING'
  );


  setCaption(
    `Loading weather for ${liveCityState}.`
  );


  try {

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


    hideStartOverlay();


    await bringMusicUp();


    requestWakeLock();


    startSevereWatch();


    startSpeechKeepAlive();


    ensureRadar();


    updateRadarForLocation();


    if (
      alreadyStarted
    ) {

      await speakStandalone(

        `Switching StormVector coverage to ${liveCityState}.`

      );

    }


    else if (
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


  catch (
    error
  ) {

    console.error(
      'StormVector searched location failed:',
      error
    );


    setLiveBadge(
      'ERROR'
    );


    setCaption(
      `StormVector could not load weather for ${liveCityState}.`
    );

  }

}


/* ═══════════════════════════════════════════════
   RETURN TO DEVICE LOCATION
════════════════════════════════════════════════ */

async function returnToMyLocation() {

  speechGeneration++;


  try {

    speechSynthesis.cancel();

  }


  catch (_) {}


  setRobotSpeaking(
    false
  );


  setLiveBadge(
    'LOCATING'
  );


  setLocationText(
    'Getting your current location...'
  );


  try {

    await requestCurrentLocation();


    broadcastLoopCount =
      0;


    spokenFactMemory.clear();


    previousWeatherSnapshot =
      null;


    latestChanges =
      [];


    await prepareBroadcast();


    updateRadarForLocation();


    await speakStandalone(

      `Switching StormVector coverage back to your current location in ${liveCityState || 'your area'}.`

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

    setCaption(
      error.message
    );


    setLiveBadge(
      'LOCATION ERROR'
    );

  }

}


/* ═══════════════════════════════════════════════
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

          timeout:
            10000,

          headers: {

            Accept:
              'application/geo+json'

          }

        }

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


/* ═══════════════════════════════════════════════
   NWS POINT + FORECAST
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

          timeout:
            10000,

          headers: {

            Accept:
              'application/geo+json'

          }

        }

      );


    const data =
      await response.json();


    const properties =
      data.properties ||
      {};


    const relativeLocation =
      properties
        .relativeLocation
        ?.properties;


    const fullState =
      stateName(
        relativeLocation
          ?.state ||
        ''
      );


    const cityState =

      relativeLocation
        ?.city &&
      fullState

        ? `${relativeLocation.city}, ${fullState}`

        : relativeLocation
            ?.city ||
          fullState ||
          null;


    let today =
      null;


    let tonight =
      null;


    let tomorrow =
      null;


    let periods =
      [];


    if (
      properties.forecast
    ) {

      try {

        const forecastResponse =
          await safeFetch(

            properties.forecast,

            {

              timeout:
                10000,

              headers: {

                Accept:
                  'application/geo+json'

              }

            }

          );


        const forecastData =
          await forecastResponse.json();


        periods =
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
                start <=
                now &&
                now <
                end
              );

            }
          )

          ||

          periods[
            0
          ];


        const nightPeriod =
          periods.find(
            period =>
              !period.isDaytime &&
              new Date(
                period.endTime
              ) >
              now
          );


        const tomorrowDay =
          periods.find(
            period =>
              period.isDaytime &&
              new Date(
                period.startTime
              )
              .getDate() !==
              now.getDate()
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


        tomorrow =
          cleanForecastText(

            tomorrowDay
              ?.detailedForecast

            ||

            tomorrowDay
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

      observationStationsUrl:
        properties
          .observationStations ||
        null,

      forecast: {

        today,

        tonight,

        tomorrow

      },

      periods

    };

  }


  catch (
    error
  ) {

    console.warn(
      'StormVector NWS point failed:',
      error
    );


    return {

      cityState:
        null,

      observationStationsUrl:
        null,

      forecast: {

        today:
          null,

        tonight:
          null,

        tomorrow:
          null

      },

      periods:
        []

    };

  }

}


/* ═══════════════════════════════════════════════
   NWS OBSERVATION
════════════════════════════════════════════════ */

function quantitativeWindToMph(
  measurement
) {

  if (
    !measurement
  ) {

    return null;

  }


  const value =
    numberOrNull(
      measurement.value
    );


  if (
    value === null
  ) {

    return null;

  }


  const unit =
    String(
      measurement.unitCode ||
      ''
    )
    .toLowerCase();


  if (
    unit.includes(
      'km_h'
    ) ||
    unit.includes(
      'km/h'
    )
  ) {

    return kmhToMph(
      value
    );

  }


  if (
    unit.includes(
      'm_s'
    ) ||
    unit.includes(
      'm/s'
    )
  ) {

    return metersPerSecondToMph(
      value
    );

  }


  if (
    unit.includes(
      'mi_h'
    ) ||
    unit.includes(
      'mph'
    )
  ) {

    return Math.round(
      value
    );

  }


  /*
    NWS station observations normally use km/h.
  */

  return kmhToMph(
    value
  );

}


async function fetchNearestObservation(
  observationStationsUrl
) {

  if (
    !observationStationsUrl
  ) {

    return null;

  }


  try {

    const stationResponse =
      await safeFetch(

        observationStationsUrl,

        {

          timeout:
            10000,

          headers: {

            Accept:
              'application/geo+json'

          }

        }

      );


    const stationData =
      await stationResponse.json();


    const stations =
      stationData.features ||
      [];


    for (
      const station
      of stations.slice(
        0,
        6
      )
    ) {

      const stationId =

        station.properties
          ?.stationIdentifier

        ||

        station.id
          ?.split(
            '/'
          )
          .pop();


      if (
        !stationId
      ) {

        continue;

      }


      try {

        const observationResponse =
          await safeFetch(

            `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,

            {

              timeout:
                8000,

              headers: {

                Accept:
                  'application/geo+json'

              }

            }

          );


        const observation =
          await observationResponse.json();


        const props =
          observation.properties ||
          {};


        const temperature =
          numberOrNull(
            props.temperature
              ?.value
          );


        if (
          temperature ===
          null
        ) {

          continue;

        }


        const dewpoint =
          numberOrNull(
            props.dewpoint
              ?.value
          );


        const humidity =
          numberOrNull(
            props.relativeHumidity
              ?.value
          );


        const windDirection =
          numberOrNull(
            props.windDirection
              ?.value
          );


        return {

          stationId,

          stationName:
            station.properties
              ?.name ||
            stationId,

          timestamp:
            props.timestamp ||
            null,

          tempF:
            celsiusToFahrenheit(
              temperature
            ),

          dewF:
            dewpoint !==
            null
              ? celsiusToFahrenheit(
                  dewpoint
                )
              : null,

          humidity:
            humidity !==
            null
              ? Math.round(
                  humidity
                )
              : null,

          windSpd:
            quantitativeWindToMph(
              props.windSpeed
            ) ??
            0,

          windG:
            quantitativeWindToMph(
              props.windGust
            ) ??
            0,

          windDeg:
            windDirection ??
            0,

          textDescription:
            removeEmojis(
              props.textDescription ||
              ''
            )

        };

      }


      catch (
        error
      ) {

        console.warn(
          `Observation station ${stationId} unavailable.`,
          error
        );

      }

    }


    return null;

  }


  catch (
    error
  ) {

    console.warn(
      'Observation station lookup failed:',
      error
    );


    return null;

  }

}


/* ═══════════════════════════════════════════════
   OPEN-METEO CURRENT + HOURLY
════════════════════════════════════════════════ */

async function fetchOpenMeteo(
  lat,
  lon
) {

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

        return new Date(
          value
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


      catch (_) {

        return null;

      }

    };


  return {

    tempF:
      current
        .temperature_2m !==
      undefined
        ? Math.round(
            current
              .temperature_2m
          )
        : null,

    feelsF:
      current
        .apparent_temperature !==
      undefined
        ? Math.round(
            current
              .apparent_temperature
          )
        : null,

    humidity:
      current
        .relative_humidity_2m !==
      undefined
        ? Math.round(
            current
              .relative_humidity_2m
          )
        : null,

    dewF:
      current
        .dew_point_2m !==
      undefined
        ? Math.round(
            current
              .dew_point_2m
          )
        : null,

    wcode:
      current
        .weather_code !==
      undefined
        ? current
            .weather_code
        : null,

    windSpd:
      current
        .wind_speed_10m !==
      undefined
        ? Math.round(
            current
              .wind_speed_10m
          )
        : 0,

    windDeg:
      current
        .wind_direction_10m !==
      undefined
        ? current
            .wind_direction_10m
        : 0,

    windG:
      current
        .wind_gusts_10m !==
      undefined
        ? Math.round(
            current
              .wind_gusts_10m
          )
        : 0,

    sunrise:
      formatTime(
        daily.sunrise?.[
          0
        ]
      ),

    sunset:
      formatTime(
        daily.sunset?.[
          0
        ]
      ),

    hourly:
      data.hourly ||
      {}

  };

}


/* ═══════════════════════════════════════════════
   SPC GEOMETRY
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

    j =
      i++
  ) {

    const xi =
      ring[
        i
      ][
        0
      ];


    const yi =
      ring[
        i
      ][
        1
      ];


    const xj =
      ring[
        j
      ][
        0
      ];


    const yj =
      ring[
        j
      ][
        1
      ];


    const intersects =

      (
        yi >
        point[
          1
        ]
      ) !==
      (
        yj >
        point[
          1
        ]
      )

      &&

      point[
        0
      ] <

      (
        (
          xj -
          xi
        ) *
        (
          point[
            1
          ] -
          yi
        ) /
        (
          yj -
          yi
        )
      ) +
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
    !coordinates[
      0
    ] ||
    !pointInRing(
      point,
      coordinates[
        0
      ]
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
        coordinates[
          i
        ]
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


/* ═══════════════════════════════════════════════
   SPC FETCH
════════════════════════════════════════════════ */

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
            SPC_RANK[
              label
            ] >
            SPC_RANK[
              best
            ]
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


/* ═══════════════════════════════════════════════
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
          ${escapeHtml(value)}
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

      `${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`

    ),

    ctx.windG >
    ctx.windSpd +
    5
      ? chip(
          'GUSTS',
          `${ctx.windG} mph`
        )
      : ''

  ]
  .join('');

}


/* ═══════════════════════════════════════════════
   OBSERVATION UI
════════════════════════════════════════════════ */

function renderObservationInfo(
  observation
) {

  const container =
    document.getElementById(
      'liveObservationInfo'
    );


  if (!container) {
    return;
  }


  if (!observation) {

    container.hidden =
      true;


    setText(
      'freshnessObservation',
      'FALLBACK DATA'
    );


    return;

  }


  container.hidden =
    false;


  setText(

    'liveObservationStation',

    `${observation.stationName} (${observation.stationId})`

  );


  if (
    observation.timestamp
  ) {

    const minutes =
      Math.max(
        0,
        Math.round(
          (
            Date.now() -
            new Date(
              observation.timestamp
            )
            .getTime()
          ) /
          60000
        )
      );


    const ageText =
      minutes <=
      1
        ? 'Latest observation'
        : `${minutes} min old`;


    setText(
      'liveObservationAge',
      ageText
    );


    setText(
      'freshnessObservation',
      minutes <=
      15
        ? 'CURRENT'
        : `${minutes} MIN OLD`
    );

  }


  else {

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


/* ═══════════════════════════════════════════════
   FORECAST TIMELINE
════════════════════════════════════════════════ */

function hourlyConditionShort(
  code
) {

  const condition =
    skyDescription(
      code
    );


  return condition ||
    'No precipitation';

}


function renderForecastTimeline(
  hourly
) {

  const container =
    document.getElementById(
      'forecastTimeline'
    );


  if (!container) {
    return;
  }


  const times =
    hourly?.time ||
    [];


  const temperatures =
    hourly?.temperature_2m ||
    [];


  const rainChance =
    hourly?.precipitation_probability ||
    [];


  const weatherCodes =
    hourly?.weather_code ||
    [];


  const winds =
    hourly?.wind_speed_10m ||
    [];


  if (
    !times.length
  ) {

    container.innerHTML = `

      <div class="forecast-timeline-empty">

        Hourly forecast is temporarily unavailable.

      </div>

    `;


    return;

  }


  const now =
    Date.now();


  let startIndex =
    times.findIndex(
      value =>
        new Date(
          value
        )
        .getTime() >=
        now -
        30 *
        60000
    );


  if (
    startIndex <
    0
  ) {

    startIndex =
      0;

  }


  const items = [];


  for (
    let offset = 0;
    offset <
    12;
    offset++
  ) {

    const index =
      startIndex +
      offset;


    if (
      index >=
      times.length
    ) {

      break;

    }


    const date =
      new Date(
        times[
          index
        ]
      );


    const time =
      date.toLocaleTimeString(
        [],
        {
          hour:
            'numeric'
        }
      );


    const temp =
      Math.round(
        temperatures[
          index
        ]
      );


    const chance =
      Math.round(
        rainChance[
          index
        ] ??
        0
      );


    const wind =
      Math.round(
        winds[
          index
        ] ??
        0
      );


    const condition =
      hourlyConditionShort(
        weatherCodes[
          index
        ]
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
   GRAPHICS DATA
════════════════════════════════════════════════ */

function updateGraphicsData(
  ctx
) {

  setText(
    'graphicTemp',
    ctx.tempF !==
    null
      ? `${ctx.tempF}°`
      : '--'
  );


  setText(
    'graphicFeels',
    ctx.feelsF !==
    null
      ? `${ctx.feelsF}°F`
      : '--'
  );


  setText(
    'graphicDew',
    ctx.dewF !==
    null
      ? `${ctx.dewF}°F`
      : '--'
  );


  setText(
    'graphicHumidity',
    ctx.humidity !==
    null
      ? `${ctx.humidity}%`
      : '--'
  );


  setText(

    'graphicWind',

    `${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`

  );


  setText(

    'graphicForecastText',

    ctx.forecast
      ?.today ||
    ctx.forecast
      ?.tonight ||
    'Forecast data is currently unavailable.'

  );


  updateSpcGraphic(
    ctx.spc
  );


  updateAlertGraphic(
    ctx.alerts
  );


  updateSevereSummary(
    ctx
  );


  renderForecastTimeline(
    ctx.hourly
  );

}


/* ═══════════════════════════════════════════════
   SPC GRAPHIC
════════════════════════════════════════════════ */

function updateSpcGraphic(
  risk
) {

  const titles = {

    TSTM:
      'GENERAL THUNDERSTORMS',

    MRGL:
      'MARGINAL RISK',

    SLGT:
      'SLIGHT RISK',

    ENH:
      'ENHANCED RISK',

    MDT:
      'MODERATE RISK',

    HIGH:
      'HIGH RISK'

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

    titles[
      risk
    ] ||
    'NO ORGANIZED RISK'

  );


  setText(

    'graphicSpcDescription',

    descriptions[
      risk
    ] ||
    'No categorical severe weather risk is currently loaded for this location.'

  );

}


/* ═══════════════════════════════════════════════
   ALERT GRAPHIC
════════════════════════════════════════════════ */

function updateAlertGraphic(
  alerts
) {

  const sorted =
    [
      ...(
        alerts ||
        []
      )
    ]
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


  const alert =
    sorted[
      0
    ];


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
    alert.properties ||
    {};


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
    .split(
      ';'
    )[
      0
    ]

  );


  setText(

    'graphicAlertInstruction',

    removeEmojis(
      props.instruction ||
      props.headline ||
      'Follow National Weather Service instructions.'
    )

  );

}


function updateSevereSummary(
  ctx
) {

  const alerts =
    ctx.alerts ||
    [];


  const significant =
    alerts.filter(
      alert =>
        /Warning|Watch|Emergency/i
          .test(
            alert.properties
              ?.event ||
            ''
          )
    );


  if (
    !significant.length
  ) {

    setText(
      'severeAlertSummary',
      'No active severe weather watches or warnings for this location.'
    );


    return;

  }


  const events =
    significant
      .slice(
        0,
        3
      )
      .map(
        alert =>
          alert.properties
            ?.event ||
          'Weather Alert'
      );


  setText(

    'severeAlertSummary',

    `Active: ${events.join(', ')}`

  );

}


/* ═══════════════════════════════════════════════
   WEATHER BACKGROUND
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


  if (
    [
      95,
      96,
      99
    ].includes(
      ctx.wcode
    )
  ) {

    window.setBgMode(
      'storm'
    );

  }


  else if (
    [
      71,
      73,
      75,
      77,
      85,
      86
    ].includes(
      ctx.wcode
    )
  ) {

    window.setBgMode(
      'snow'
    );

  }


  else if (
    [
      45,
      48
    ].includes(
      ctx.wcode
    )
  ) {

    window.setBgMode(
      'fog'
    );

  }


  else if (
    [
      51,
      53,
      55,
      61,
      63,
      65,
      80,
      81,
      82
    ].includes(
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
    [
      2,
      3
    ].includes(
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


/* ═══════════════════════════════════════════════
   WHAT CHANGED
════════════════════════════════════════════════ */

function makeSnapshot(
  ctx
) {

  return {

    tempF:
      ctx.tempF,

    feelsF:
      ctx.feelsF,

    dewF:
      ctx.dewF,

    windSpd:
      ctx.windSpd,

    windG:
      ctx.windG,

    wcode:
      ctx.wcode,

    spc:
      ctx.spc,

    alertMap:
      new Map(

        (
          ctx.alerts ||
          []
        )
        .map(
          alert => [

            alert.id,

            alert.properties
              ?.event ||
            'Weather Alert'

          ]
        )

      )

  };

}


function detectWeatherChanges(
  ctx
) {

  if (
    !STORMVECTOR_FEATURES
      .changeEngine
  ) {

    return [];

  }


  const next =
    makeSnapshot(
      ctx
    );


  if (
    !previousWeatherSnapshot
  ) {

    previousWeatherSnapshot =
      next;


    latestChanges = [

      {

        text:
          'StormVector baseline established. Future weather updates will be compared with these conditions.',

        important:
          false

      }

    ];


    renderChanges(
      latestChanges
    );


    return latestChanges;

  }


  const previous =
    previousWeatherSnapshot;


  const changes =
    [];


  if (
    previous.tempF !==
    null &&
    next.tempF !==
    null &&
    previous.tempF !==
    next.tempF
  ) {

    const difference =
      next.tempF -
      previous.tempF;


    changes.push({

      text:
        `Temperature ${difference > 0 ? 'rose' : 'fell'} ${Math.abs(difference)} degree${Math.abs(difference) === 1 ? '' : 's'} to ${next.tempF} degrees.`,

      important:
        Math.abs(
          difference
        ) >=
        5

    });

  }


  if (
    previous.windSpd !==
    null &&
    next.windSpd !==
    null &&
    Math.abs(
      next.windSpd -
      previous.windSpd
    ) >=
    5
  ) {

    changes.push({

      text:
        `Sustained wind changed from ${previous.windSpd} to ${next.windSpd} miles per hour.`,

      important:
        next.windSpd >=
        25

    });

  }


  if (
    previous.windG !==
    null &&
    next.windG !==
    null &&
    Math.abs(
      next.windG -
      previous.windG
    ) >=
    8
  ) {

    changes.push({

      text:
        `Wind gusts changed from ${previous.windG} to ${next.windG} miles per hour.`,

      important:
        next.windG >=
        40

    });

  }


  if (
    previous.dewF !==
    null &&
    next.dewF !==
    null &&
    Math.abs(
      next.dewF -
      previous.dewF
    ) >=
    3
  ) {

    changes.push({

      text:
        `The dew point changed from ${previous.dewF} to ${next.dewF} degrees.`,

      important:
        false

    });

  }


  if (
    previous.spc !==
    next.spc
  ) {

    changes.push({

      text:
        `The Storm Prediction Center category changed from ${previous.spc || 'none'} to ${next.spc || 'none'}.`,

      important:
        true

    });

  }


  next.alertMap
    .forEach(
      (
        event,
        id
      ) => {

        if (
          !previous.alertMap
            .has(
              id
            )
        ) {

          changes.push({

            text:
              `New alert: ${event}.`,

            important:
              true

          });

        }

      }
    );


  previous.alertMap
    .forEach(
      (
        event,
        id
      ) => {

        if (
          !next.alertMap
            .has(
              id
            )
        ) {

          changes.push({

            text:
              `${event} is no longer active for this location.`,

            important:
              true

          });

        }

      }
    );


  if (
    !changes.length
  ) {

    changes.push({

      text:
        'No significant weather changes since the previous StormVector update.',

      important:
        false

    });

  }


  previousWeatherSnapshot =
    next;


  latestChanges =
    changes;


  renderChanges(
    changes
  );


  return changes;

}


function renderChanges(
  changes
) {

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


  if (
    fullList
  ) {

    fullList.innerHTML =
      changes
        .map(
          change => `

            <div class="weather-change-item">

              ${escapeHtml(change.text)}

            </div>

          `
        )
        .join('');

  }


  if (
    graphicList
  ) {

    graphicList.innerHTML =
      changes
        .slice(
          0,
          5
        )
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
   FRESHNESS
════════════════════════════════════════════════ */

function updateFreshness(
  ctx
) {

  setText(
    'freshnessForecast',
    ctx.forecast
      ?.today ||
    ctx.forecast
      ?.tonight
      ? 'CURRENT'
      : 'UNAVAILABLE'
  );


  setText(

    'freshnessAlerts',

    ctx.alerts.length
      ? `${ctx.alerts.length} ACTIVE`
      : 'CURRENT'

  );


  if (
    radarLastLoaded
  ) {

    setText(
      'freshnessRadar',
      'CURRENT'
    );

  }


  else {

    setText(
      'freshnessRadar',
      'READY'
    );

  }

}


/* ═══════════════════════════════════════════════
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
      "I'm still waiting on the latest temperature, but the rest of the weather data is coming through."
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

    ctx.feelsF !==
    null &&

    Math.abs(
      ctx.feelsF -
      ctx.tempF
    ) >=
    3 &&

    (
      previousFeels ===
      undefined ||

      previousFeels !==
      ctx.feelsF ||

      broadcastLoopCount ===
      0
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
      broadcastLoopCount ===
      0 ||
      previousCode !==
      ctx.wcode ||
      broadcastLoopCount %
      3 ===
      0
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
    ctx.windSpd <
    7 &&
    ctx.windG <
    12
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
    [
      ...alerts
    ]
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

        const props =
          alert.properties ||
          {};


        const area =
          (
            props.areaDesc ||
            'the selected area'
          )
          .split(
            ';'
          )[
            0
          ];


        let expiration =
          '';


        if (
          props.expires
        ) {

          try {

            expiration =
              new Date(
                props.expires
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

          `A ${props.event || 'weather alert'} is in effect for ${area}${expiration ? ` until ${expiration}` : ''}.`

        );


        const movement =
          window.parseMovement(
            props.description ||
            ''
          );


        if (
          movement
        ) {

          segments.push(

            `The storm is moving ${movement.dir} at ${movement.spd} miles per hour.`

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


  segments.push(

    `The Storm Prediction Center has this location under ${labels[spc]} today.`

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


/* ═══════════════════════════════════════════════
   STORY PRIORITY
════════════════════════════════════════════════ */

function determineWeatherStory(
  ctx
) {

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


  if (
    warnings.length
  ) {

    return 'warning';

  }


  if (
    watches.length
  ) {

    return 'watch';

  }


  if (
    ctx.spc &&
    SPC_RANK[
      ctx.spc
    ] >=
    SPC_RANK.ENH
  ) {

    return 'severe-risk';

  }


  if (
    ctx.windG >=
    40 ||
    ctx.windSpd >=
    30
  ) {

    return 'wind';

  }


  if (
    weatherCodePhrase(
      ctx.wcode
    )
  ) {

    return 'active-weather';

  }


  return 'normal';

}


/* ═══════════════════════════════════════════════
   BUILD BROADCAST
════════════════════════════════════════════════ */

function buildScript(
  ctx
) {

  const segments =
    [];


  const story =
    determineWeatherStory(
      ctx
    );


  const locationText =
    ctx.cityState
      ? ` for ${ctx.cityState}`
      : ' for this location';


  if (
    broadcastLoopCount ===
    0
  ) {

    if (
      story ===
      'warning'
    ) {

      segments.push(

        `I've got the latest weather loaded${locationText}, and there is active warning information, so let's get right to it.`

      );

    }


    else {

      segments.push(

        `I've got the latest weather loaded${locationText}. Here's where things stand.`

      );

    }

  }


  else {

    const importantChanges =
      latestChanges.some(
        change =>
          change.important
      );


    segments.push(

      pickPhrase(

        importantChanges
          ? PHRASES.continuingOpeners
          : PHRASES.steadyOpeners,

        importantChanges
          ? 'continuing-openers'
          : 'steady-openers'

      )

    );


    if (
      importantChanges
    ) {

      latestChanges
        .filter(
          change =>
            change.important
        )
        .slice(
          0,
          2
        )
        .forEach(
          change =>
            segments.push(
              change.text
            )
        );

    }

  }


  if (
    story ===
    'warning' ||
    story ===
    'watch'
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


  else if (
    story ===
    'severe-risk'
  ) {

    addSpc(
      segments,
      ctx.spc
    );


    addCurrentConditions(
      segments,
      ctx
    );


    addWind(
      segments,
      ctx
    );


    addTodayForecast(
      segments,
      ctx
    );


    segments.push(

      pickPhrase(
        PHRASES.closers,
        'normal-closers'
      )

    );

  }


  else if (
    story ===
    'wind'
  ) {

    addWind(
      segments,
      ctx,
      true
    );


    addCurrentConditions(
      segments,
      ctx
    );


    addTodayForecast(
      segments,
      ctx
    );


    segments.push(

      pickPhrase(
        PHRASES.closers,
        'normal-closers'
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
        ) &&

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


/* ═══════════════════════════════════════════════
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


  setText(
    'vectorGraphicStatus',
    'UPDATING'
  );


  const [
    nws,
    fallback,
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
            'Open-Meteo failed:',
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


  const observation =
    await fetchNearestObservation(
      nws.observationStationsUrl
    );


  if (
    locationMode ===
    'search' &&
    selectedSearchLocation
  ) {

    liveCityState =
      locationResultDisplay(
        selectedSearchLocation
      );

  }


  else {

    liveCityState =
      nws.cityState;

  }


  setLocationText(

    liveCityState

    ||

    `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`

  );


  setLocationSource(

    locationMode ===
    'search'

      ? 'StormVector selected location'

      : 'StormVector current device location'

  );


  const ctx = {

    cityState:
      liveCityState,

    tempF:
      observation?.tempF
      ??
      fallback.tempF
      ??
      null,

    feelsF:
      fallback.feelsF
      ??
      observation?.tempF
      ??
      null,

    humidity:
      observation?.humidity
      ??
      fallback.humidity
      ??
      null,

    dewF:
      observation?.dewF
      ??
      fallback.dewF
      ??
      null,

    wcode:
      fallback.wcode
      ??
      null,

    windSpd:
      observation?.windSpd
      ??
      fallback.windSpd
      ??
      0,

    windDeg:
      observation?.windDeg
      ??
      fallback.windDeg
      ??
      0,

    windG:
      observation?.windG
      ??
      fallback.windG
      ??
      0,

    sunrise:
      fallback.sunrise
      ??
      null,

    sunset:
      fallback.sunset
      ??
      null,

    hourly:
      fallback.hourly
      ??
      {},

    alerts:
      alerts ||
      [],

    forecast:
      nws.forecast ||
      {

        today:
          null,

        tonight:
          null,

        tomorrow:
          null

      },

    spc:
      spc ||
      null,

    observation:
      observation ||
      null

  };


  currentWeatherContext =
    ctx;


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


  renderObservationInfo(
    observation
  );


  setBroadcastBg(
    ctx
  );


  updateGraphicsData(
    ctx
  );


  detectWeatherChanges(
    ctx
  );


  updateFreshness(
    ctx
  );


  buildScript(
    ctx
  );


  updateRadarForLocation();


  setText(
    'vectorGraphicStatus',
    'CURRENT'
  );


  return ctx;

}


/* ═══════════════════════════════════════════════
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
          ) &&

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

    voices[
      0
    ]

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


/* ═══════════════════════════════════════════════
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


    document.body
      .appendChild(
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
      'StormVector music failed:',
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


/* ═══════════════════════════════════════════════
   SPEECH UTTERANCE
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


/* ═══════════════════════════════════════════════
   BROADCAST HISTORY
════════════════════════════════════════════════ */

function addBroadcastHistory(
  text
) {

  if (
    !STORMVECTOR_FEATURES
      .broadcastHistory
  ) {

    return;

  }


  const cleaned =
    removeEmojis(
      text
    );


  if (!cleaned) {
    return;
  }


  const last =
    broadcastHistory[
      0
    ];


  if (
    last &&
    last.text ===
    cleaned
  ) {

    return;

  }


  broadcastHistory.unshift({

    text:
      cleaned,

    time:
      new Date()

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


  if (!container) {
    return;
  }


  if (
    !broadcastHistory.length
  ) {

    container.textContent =
      'No broadcast history yet.';


    return;

  }


  container.innerHTML =
    broadcastHistory
      .map(
        item => `

          <div class="broadcast-history-item">

            <span class="broadcast-history-time">

              ${escapeHtml(
                item.time.toLocaleTimeString(
                  [],
                  {
                    hour:
                      'numeric',

                    minute:
                      '2-digit'
                  }
                )
              )}

            </span>

            ${escapeHtml(item.text)}

          </div>

        `
      )
      .join('');

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


  toggle
    ?.addEventListener(
      'click',
      () => {

        if (!body) {
          return;
        }


        const opening =
          body.hidden;


        body.hidden =
          !opening;


        if (
          chevron
        ) {

          chevron.textContent =
            opening
              ? '−'
              : '+';

        }

      }
    );

}


/* ═══════════════════════════════════════════════
   IPHONE STARTUP UNLOCK
════════════════════════════════════════════════ */

function startMediaFromUserGesture() {

  const music =
    ensureLiveMusicElement();


  try {

    music.volume =
      0.025;


    const promise =
      music.play();


    promise
      ?.catch(
        error =>
          console.warn(
            'Theme unlock failed:',
            error
          )
      );

  }


  catch (
    error
  ) {

    console.warn(
      'Theme unlock failed:',
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

              "Vector here. Give me a second while I pull up your local weather.",

              "Vector here. I'm grabbing your location and the latest weather now.",

              "All right, I'm Vector. Give me a second while I get your local weather loaded.",

              "Vector here. Let me pull up the latest weather for where you are."

            ],
            'startup-lines'
          );


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


            setCaptionTopic(
              'CONNECTING'
            );


            addBroadcastHistory(
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


/* ═══════════════════════════════════════════════
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
    MUST remain before first await for iPhone.
  */

  startMediaFromUserGesture();


  if (
    button
  ) {

    button.disabled =
      true;


    button.textContent =
      'GETTING LOCATION...';

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
      'Loading local weather...'
    );


    if (
      button
    ) {

      button.textContent =
        'LOADING WEATHER...';

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


    hideStartOverlay();


    await bringMusicUp();


    requestWakeLock();


    startSevereWatch();


    startSpeechKeepAlive();


    ensureRadar();


    if (
      startupSpeechPromise
    ) {

      await Promise.race([

        startupSpeechPromise,

        wait(
          6000
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
      'StormVector could not start. Check location permission and try again.'
    );


    if (
      button
    ) {

      button.disabled =
        false;


      button.textContent =
        'ENABLE LOCATION & GO LIVE';

    }

  }


  finally {

    startupRunning =
      false;

  }

}


/* ═══════════════════════════════════════════════
   NORMAL BROADCAST SPEECH
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
    liveSegments[
      index
    ];


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


      /*
        ONLY caption topic changes.

        Selected display stays where the user left it.
      */

      updateTopicForSpeech(
        text
      );


      addBroadcastHistory(
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


      let pause =
        420;


      if (
        /warning|watch|emergency/i
          .test(
            text
          )
      ) {

        pause =
          600;

      }


      else if (
        text.length >
        145
      ) {

        pause =
          520;

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
              index +
              1
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
              index +
              1
            );

          }

        },
        450
      );

    };


  speechSynthesis.speak(
    utterance
  );

}


/* ═══════════════════════════════════════════════
   STANDALONE SPEECH
════════════════════════════════════════════════ */

function speakStandalone(
  text
) {

  return new Promise(
    resolve => {

      if (
        !(
          'speechSynthesis'
          in window
        )
      ) {

        setCaption(
          text
        );


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


          updateTopicForSpeech(
            text
          );


          addBroadcastHistory(
            text
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


/* ═══════════════════════════════════════════════
   BROADCAST LOOP
════════════════════════════════════════════════ */

async function finishBroadcastLoop() {

  setRobotSpeaking(
    false
  );


  setLiveBadge(
    'CHECKING WEATHER'
  );


  setCaptionTopic(
    'NEXT UPDATE'
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


/* ═══════════════════════════════════════════════
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


/* ═══════════════════════════════════════════════
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

      button.textContent =
        'RESUME';

    }


    return;

  }


  if (
    button
  ) {

    button.textContent =
      'STOP';

  }


  await bringMusicUp();


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


/* ═══════════════════════════════════════════════
   RADAR
════════════════════════════════════════════════ */

function ensureRadar() {

  if (
    !STORMVECTOR_FEATURES
      .radar
  ) {

    return;

  }


  if (
    radarMap
  ) {

    updateRadarForLocation();


    return;

  }


  if (
    typeof L ===
    'undefined'
  ) {

    setRadarStatus(
      'Radar map library unavailable.'
    );


    return;

  }


  const target =
    document.getElementById(
      'stormVectorRadar'
    );


  if (!target) {
    return;
  }


  radarMap =
    L.map(
      target,
      {

        zoomControl:
          true,

        attributionControl:
          true

      }
    )
    .setView(
      [
        liveLat ||
        39,

        liveLon ||
        -98
      ],
      liveLat !==
      null
        ? 8
        : 4
    );


  /*
    DARK BASEMAP
  */

  L.tileLayer(

    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',

    {

      maxZoom:
        19,

      subdomains:
        'abcd',

      attribution:
        '&copy; OpenStreetMap contributors &copy; CARTO'

    }

  )
  .addTo(
    radarMap
  );


  /*
    NOAA MRMS BASE REFLECTIVITY
  */

  radarLayer =
    L.tileLayer.wms(

      'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows',

      {

        layers:
          'conus_bref_qcd',

        format:
          'image/png',

        transparent:
          true,

        version:
          '1.1.1',

        tiled:
          true,

        opacity:
          0.78,

        attribution:
          'NOAA/NWS MRMS'

      }

    );


  radarLayer.addTo(
    radarMap
  );


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


  radarLayer.on(
    'tileerror',
    () => {

      setRadarStatus(
        'Radar tile unavailable. Retrying automatically.'
      );


      setText(
        'freshnessRadar',
        'RETRYING'
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
          (
            feature,
            layer
          ) => {

            const props =
              feature.properties ||
              {};


            layer.bindPopup(

              `<strong>${escapeHtml(props.event || 'Weather Alert')}</strong><br>${escapeHtml(props.areaDesc || '')}`

            );

          }

      }
    )
    .addTo(
      radarMap
    );


  updateRadarForLocation();


  setTimeout(
    () =>
      radarMap
        ?.invalidateSize(),
    200
  );

}


function setRadarStatus(
  text
) {

  setText(
    'radarStatus',
    text
  );

}


function warningPolygonStyle(
  feature
) {

  const event =
    String(
      feature.properties
        ?.event ||
      ''
    )
    .toLowerCase();


  if (
    event.includes(
      'tornado'
    )
  ) {

    return {

      color:
        '#ff2020',

      weight:
        4,

      fillColor:
        '#ff2020',

      fillOpacity:
        0.08

    };

  }


  if (
    event.includes(
      'severe thunderstorm'
    )
  ) {

    return {

      color:
        '#ffb000',

      weight:
        3,

      fillColor:
        '#ffb000',

      fillOpacity:
        0.07

    };

  }


  if (
    event.includes(
      'flash flood'
    )
  ) {

    return {

      color:
        '#29d65b',

      weight:
        3,

      fillColor:
        '#29d65b',

      fillOpacity:
        0.06

    };

  }


  return {

    color:
      '#ff6633',

    weight:
      2,

    fillOpacity:
      0.04

  };

}


function createRadarMarker() {

  if (
    !radarMap ||
    liveLat ===
    null ||
    liveLon ===
    null
  ) {

    return;

  }


  const latLng = [

    liveLat,

    liveLon

  ];


  if (
    radarMarker
  ) {

    radarMarker.setLatLng(
      latLng
    );


    return;

  }


  const icon =
    L.divIcon(
      {

        className:
          '',

        html:
          '<div class="sv-radar-location-marker"></div>',

        iconSize:
          [
            18,
            18
          ],

        iconAnchor:
          [
            9,
            9
          ]

      }
    );


  radarMarker =
    L.marker(
      latLng,
      {
        icon
      }
    )
    .addTo(
      radarMap
    );

}


function radarZoomLevel() {

  switch (
    radarZoomMode
  ) {

    case 'regional':

      return 5;


    case 'state':

      return 7;


    default:

      return 9;

  }

}


function updateRadarZoomButtons() {

  const mapping = {

    local:
      'radarLocalBtn',

    state:
      'radarStateBtn',

    regional:
      'radarRegionalBtn'

  };


  Object.entries(
    mapping
  )
  .forEach(
    (
      [
        mode,
        id
      ]
    ) => {

      document
        .getElementById(
          id
        )
        ?.classList
        .toggle(
          'active',
          mode ===
          radarZoomMode
        );

    }
  );

}


function setRadarZoomMode(
  mode
) {

  radarZoomMode =
    mode;


  updateRadarZoomButtons();


  if (
    radarMap &&
    liveLat !==
    null &&
    liveLon !==
    null
  ) {

    radarMap.setView(
      [
        liveLat,
        liveLon
      ],
      radarZoomLevel()
    );

  }

}


function updateRadarForLocation() {

  if (
    !radarMap ||
    liveLat ===
    null ||
    liveLon ===
    null
  ) {

    return;

  }


  createRadarMarker();


  radarMarker
    ?.bindTooltip(
      liveCityState ||
      'StormVector location',
      {
        direction:
          'top'
      }
    );


  radarMap.setView(
    [
      liveLat,
      liveLon
    ],
    radarZoomLevel()
  );


  updateRadarWarnings();


  setTimeout(
    () =>
      radarMap
        ?.invalidateSize(),
    120
  );

}


function updateRadarWarnings() {

  if (
    !radarWarningLayer
  ) {

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


  const warnings =
    currentWeatherContext
      .alerts
      .filter(
        alert =>

          alert.geometry

          &&

          /Warning|Emergency/i
            .test(
              alert.properties
                ?.event ||
              ''
            )
      );


  warnings
    .forEach(
      warning => {

        radarWarningLayer.addData(
          warning
        );

      }
    );

}


function refreshRadar() {

  if (
    !radarLayer
  ) {

    ensureRadar();


    return;

  }


  setRadarStatus(
    'Refreshing NOAA MRMS radar...'
  );


  setText(
    'freshnessRadar',
    'REFRESHING'
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
        setRadarZoomMode(
          'local'
        )
    );


  document
    .getElementById(
      'radarStateBtn'
    )
    ?.addEventListener(
      'click',
      () =>
        setRadarZoomMode(
          'state'
        )
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
          liveLat !==
          null &&
          liveLon !==
          null
        ) {

          radarMap.setView(
            [
              liveLat,
              liveLon
            ],
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


        warningsButton.classList
          .toggle(
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

function spcSpeechName(
  risk
) {

  const labels = {

    TSTM:
      'general thunderstorms',

    MRGL:
      'marginal risk',

    SLGT:
      'slight risk',

    ENH:
      'enhanced risk',

    MDT:
      'moderate risk',

    HIGH:
      'high risk'

  };


  return labels[
    risk
  ] ||
  'no organized severe weather risk';

}


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
    )
    .toLowerCase();


  const location =
    ctx.cityState ||
    'this location';


  if (
    /tomorrow/
      .test(
        q
      ) ||
    (
      /what about/
        .test(
          q
        ) &&
      lastAskTopic ===
      'forecast'
    )
  ) {

    lastAskTopic =
      'forecast';


    if (
      ctx.forecast
        ?.tomorrow
    ) {

      return `For ${location} tomorrow, ${ctx.forecast.tomorrow}`;

    }


    return `I don't currently have a reliable tomorrow forecast loaded for ${location}.`;

  }


  if (
    /rain|precipitation|umbrella/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'rain';


    const tonight =
      ctx.forecast
        ?.tonight ||
      '';


    if (
      tonight
    ) {

      if (
        /rain|shower|thunderstorm|drizzle|precipitation/
          .test(
            tonight.toLowerCase()
          )
      ) {

        return `For ${location}, precipitation is included in tonight's National Weather Service forecast. ${tonight}`;

      }


      return `For ${location}, tonight's National Weather Service forecast does not currently mention rain or thunderstorms. ${tonight}`;

    }


    return `I don't currently have enough forecast information to give you a reliable answer about rain tonight in ${location}.`;

  }


  if (
    /severe|storm threat|tornado|risk|spc/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'severe';


    const priority =
      ctx.alerts.filter(
        alert =>
          /Warning|Watch|Emergency/i
            .test(
              alert.properties
                ?.event ||
              ''
            )
      );


    if (
      priority.length
    ) {

      const event =
        priority[
          0
        ]
        .properties
        ?.event ||
        'weather alert';


      return `For ${location}, there is active severe weather information. The highest-priority local alert I have is a ${event}. The Storm Prediction Center category is ${spcSpeechName(ctx.spc)}.`;

    }


    return `There are no active National Weather Service warnings or watches for ${location} right now. The Storm Prediction Center category is ${spcSpeechName(ctx.spc)}.`;

  }


  if (
    /wind|windy|gust/
      .test(
        q
      ) ||
    (
      /how much|how strong/
        .test(
          q
        ) &&
      lastAskTopic ===
      'wind'
    )
  ) {

    lastAskTopic =
      'wind';


    const direction =
      window.degToCompass(
        ctx.windDeg
      ) ||
      'variable';


    return `For ${location}, wind is currently ${direction} at about ${ctx.windSpd} miles per hour${ctx.windG > ctx.windSpd + 5 ? `, with gusts around ${ctx.windG} miles per hour` : ''}.`;

  }


  if (
    /temperature|temp|how hot|how cold|feels/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'temperature';


    return `For ${location}, the current temperature is ${ctx.tempF} degrees${ctx.feelsF !== null ? `, and it feels like ${ctx.feelsF}` : ''}.`;

  }


  if (
    /humidity|dew point|muggy/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'humidity';


    return `For ${location}, humidity is around ${ctx.humidity ?? 'unknown'} percent and the dew point is ${ctx.dewF ?? 'unavailable'} degrees.`;

  }


  if (
    /radar/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'radar';


    selectView(
      'radar',
      {
        manual:
          true
      }
    );


    const warning =
      ctx.alerts.find(
        alert =>
          /Warning|Emergency/i
            .test(
              alert.properties
                ?.event ||
              ''
            )
      );


    if (
      warning
    ) {

      return `I've opened the NOAA radar for ${location}, along with the active ${warning.properties?.event || 'warning'} polygon. I use official warning information rather than claiming rotation or hail from reflectivity alone.`;

    }


    return `I've opened the NOAA MRMS radar for ${location}. The map is centered on the selected location and you can switch between local, state, and regional views.`;

  }


  if (
    /tonight/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'forecast';


    return ctx.forecast
      ?.tonight
        ? `For ${location} tonight, ${ctx.forecast.tonight}`
        : `I don't currently have tonight's detailed forecast loaded for ${location}.`;

  }


  if (
    /changed|change|new/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'changes';


    return latestChanges
      .map(
        change =>
          change.text
      )
      .join(
        ' '
      );

  }


  if (
    /today|forecast|weather|later/
      .test(
        q
      )
  ) {

    lastAskTopic =
      'forecast';


    if (
      ctx.forecast
        ?.today
    ) {

      return `For ${location}, ${ctx.forecast.today}`;

    }


    return `The current temperature in ${location} is ${ctx.tempF} degrees, but the detailed forecast is temporarily unavailable.`;

  }


  return `For ${location}, it's currently ${ctx.tempF} degrees. Wind is around ${ctx.windSpd} miles per hour. ${ctx.forecast?.today || 'Ask me about temperature, wind, severe weather, tonight, radar, or what changed.'}`;

}


async function askVector(
  question
) {

  if (
    !STORMVECTOR_FEATURES
      .askVector
  ) {

    return;

  }


  const trimmed =
    String(
      question || ''
    )
    .trim();


  if (!trimmed) {
    return;
  }


  const answer =
    answerVectorQuestion(
      trimmed
    );


  setText(
    'askVectorAnswer',
    answer
  );


  if (
    !liveStarted
  ) {

    return;

  }


  const resumeIndex =
    Math.min(

      liveSegIdx +
      1,

      liveSegments.length

    );


  speechGeneration++;


  speechSynthesis.cancel();


  setRobotSpeaking(
    false
  );


  await wait(
    120
  );


  await speakStandalone(
    answer
  );


  if (
    !liveMuted &&
    !breakingWeatherActive &&
    resumeIndex <
    liveSegments.length
  ) {

    await wait(
      700
    );


    speakSegment(
      resumeIndex
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


  form
    ?.addEventListener(
      'submit',
      event => {

        event.preventDefault();


        if (!input) {
          return;
        }


        const question =
          input.value.trim();


        if (!question) {
          return;
        }


        askVector(
          question
        );


        input.value =
          '';

      }
    );


  document
    .querySelectorAll(
      '.ask-vector-quick'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            askVector(

              button.dataset
                .question ||
              button.textContent

            );

          }
        );

      }
    );

}


/* ═══════════════════════════════════════════════
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


    const priority =
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
      priority.filter(
        alert =>
          !knownPriorityAlertIds
            .has(
              alert.id
            )
      );


    priority
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


/* ═══════════════════════════════════════════════
   ATTENTION TONE
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
      'StormVector attention tone failed:',
      error
    );

  }

}


/* ═══════════════════════════════════════════════
   SEVERE TAKEOVER
════════════════════════════════════════════════ */

function showSevereTakeover(
  alert
) {

  if (
    !STORMVECTOR_FEATURES
      .severeTakeover
  ) {

    return;

  }


  if (
    !severeTakeoverActive
  ) {

    viewBeforeSevere =
      selectedView;

  }


  severeTakeoverActive =
    true;


  const takeover =
    document.getElementById(
      'severeTakeover'
    );


  const props =
    alert.properties ||
    {};


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
    )
    .split(
      ';'
    )[
      0
    ]

  );


  if (
    takeover
  ) {

    takeover.hidden =
      false;

  }


  document.body
    .classList
    .add(
      'severe-mode'
    );


  /*
    Radar becomes the temporary panel underneath
    the takeover.

    The user's original panel is remembered.
  */

  selectView(
    'radar',
    {
      manual:
        false
    }
  );


  updateAlertGraphic(
    [
      alert
    ]
  );

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


  document.body
    .classList
    .remove(
      'severe-mode'
    );


  severeTakeoverActive =
    false;


  if (
    restoreView
  ) {

    selectView(
      viewBeforeSevere,
      {
        manual:
          false
      }
    );

  }

}


/* ═══════════════════════════════════════════════
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


  showSevereTakeover(
    alert
  );


  ensureRadar();


  updateRadarWarnings();


  await playAttentionTone();


  const props =
    alert.properties ||
    {};


  const event =
    props.event ||
    'weather alert';


  const area =
    (
      props.areaDesc ||
      'the selected area'
    )
    .split(
      ';'
    )[
      0
    ];


  const movement =
    window.parseMovement(
      props.description ||
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
      'Post-alert weather refresh failed:',
      error
    );

  }


  if (
    banner
  ) {

    banner.hidden =
      true;

  }


  hideSevereTakeover(
    true
  );


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


/* ═══════════════════════════════════════════════
   BREAKING WEATHER SPEECH
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
          messages[
            index
          ];


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


            setCaptionTopic(
              'BREAKING WEATHER'
            );


            addBroadcastHistory(
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


/* ═══════════════════════════════════════════════
   ANDROID SPEECH KEEPALIVE
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


/* ═══════════════════════════════════════════════
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


/* ═══════════════════════════════════════════════
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
        removeEmojis(
          message
        );

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

    }


    setTimeout(
      () =>
        radarMap
          ?.invalidateSize(),
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


    setCaptionTopic(
      'STANDBY'
    );


    setLiveBadge(
      'STANDBY'
    );


    setText(
      'vectorGraphicStatus',
      'READY'
    );


    selectView(
      'conditions',
      {
        manual:
          true
      }
    );


    const startButton =
      document.getElementById(
        'liveStartBtn'
      );


    if (
      startButton
    ) {

      startButton.disabled =
        false;


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


    bindAskVector();


    bindBroadcastHistory();


    document
      .getElementById(
        'severeTakeoverClose'
      )
      ?.addEventListener(
        'click',
        () =>
          hideSevereTakeover(
            true
          )
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


    if (
      locationSearchController
    ) {

      try {

        locationSearchController.abort();

      }


      catch (_) {}

    }


    if (
      radarMap
    ) {

      try {

        radarMap.remove();

      }


      catch (_) {}

    }

  }
);