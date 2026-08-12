/* ═══════════════════════════════════════════════════════
   STORMVECTOR LIVE — COMPLETE BROADCAST ENGINE
   File: watch-live.js

   FEATURES
   - iPhone/Safari speech + music startup
   - Device GPS location
   - Predictive U.S. location search
   - Full state names when Vector speaks
   - Nearest NWS observation station
   - NWS forecast + alerts
   - Open-Meteo fallback data
   - SPC Day 1 outlook
   - Dynamic broadcast graphics
   - NOAA MRMS radar
   - Warning polygons
   - What Changed engine
   - Ask Vector
   - Severe weather takeover
   - Breaking-weather interruption
   - Mobile reliability
   - No forecast emojis
   - Shorter speech chunks to reduce skipped speech
═══════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════
   FEATURE SWITCHES
════════════════════════════════════════════════ */

const STORMVECTOR_FEATURES = {

  dynamicGraphics: true,

  changeEngine: true,

  askVector: true,

  radar: true,

  warningPolygons: true,

  severeTakeover: true

};


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

let locationMode = 'none';

let deviceLat = null;
let deviceLon = null;

let selectedSearchLocation = null;

let speechKeepAlive = null;
let wakeLock = null;

let breakingWeatherActive = false;
let severeWatchTimer = null;

let speechGeneration = 0;

let startupSpeechPromise = null;

let currentWeatherContext = null;
let previousWeatherSnapshot = null;

let latestChanges = [];

let locationSearchTimer = null;
let locationSearchController = null;


/* ════════════════════════════════════════════════
   RADAR STATE
════════════════════════════════════════════════ */

let radarMap = null;

let radarLayer = null;

let radarMarker = null;

let radarWarningLayer = null;

let radarWarningsVisible = true;

let radarReady = false;


/* ════════════════════════════════════════════════
   MEMORY
════════════════════════════════════════════════ */

const spokenFactMemory =
  new Map();

const knownPriorityAlertIds =
  new Set();

const phraseHistory = {};


/* ════════════════════════════════════════════════
   SPC RANK
════════════════════════════════════════════════ */

const SPC_RANK = {

  TSTM: 1,

  MRGL: 2,

  SLGT: 3,

  ENH: 4,

  MDT: 5,

  HIGH: 6

};


/* ════════════════════════════════════════════════
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


/* ════════════════════════════════════════════════
   FALLBACK HELPERS
════════════════════════════════════════════════ */

(function installFallbacks() {

  const install =
    (
      name,
      fn
    ) => {

      if (
        typeof window[name] !==
        'function'
      ) {

        window[name] =
          fn;

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
        Number.isNaN(
          Number(deg)
        )
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
        Math.round(
          Number(deg) /
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


      if (
        dewF < 50
      ) {

        return 'very comfortable';

      }


      if (
        dewF < 60
      ) {

        return 'comfortable';

      }


      if (
        dewF < 65
      ) {

        return 'a little sticky';

      }


      if (
        dewF < 70
      ) {

        return 'muggy';

      }


      if (
        dewF < 75
      ) {

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

        [
          'tornado emergency',
          0
        ],

        [
          'tornado warning',
          1
        ],

        [
          'flash flood emergency',
          2
        ],

        [
          'severe thunderstorm warning',
          3
        ],

        [
          'flash flood warning',
          4
        ],

        [
          'tornado watch',
          5
        ],

        [
          'severe thunderstorm watch',
          6
        ],

        [
          'flood warning',
          7
        ],

        [
          'blizzard warning',
          8
        ],

        [
          'ice storm warning',
          9
        ],

        [
          'winter storm warning',
          10
        ],

        [
          'high wind warning',
          11
        ],

        [
          'excessive heat warning',
          12
        ],

        [
          'winter weather advisory',
          13
        ],

        [
          'wind advisory',
          14
        ],

        [
          'heat advisory',
          15
        ]

      ];


      for (
        const [
          needle,
          score
        ]
        of order
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


      if (
        match
      ) {

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


      if (
        match
      ) {

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


  if (
    !panel
  ) {

    return;

  }


  const opening =
    !panel
      .classList
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


/* ════════════════════════════════════════════════
   GENERAL UTILITIES
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


function stateName(
  value
) {

  const state =
    String(
      value || ''
    )
    .trim();


  if (
    STATE_NAMES[
      state.toUpperCase()
    ]
  ) {

    return STATE_NAMES[
      state.toUpperCase()
    ];

  }


  return state;

}


function capitalize(
  text
) {

  const value =
    String(
      text || ''
    );


  if (
    !value
  ) {

    return '';

  }


  return (
    value
      .charAt(0)
      .toUpperCase() +

    value
      .slice(1)
  );

}


function celsiusToFahrenheit(
  celsius
) {

  if (
    celsius === null ||
    celsius === undefined ||
    Number.isNaN(
      Number(celsius)
    )
  ) {

    return null;

  }


  return Math.round(
    Number(celsius) *
    9 /
    5 +
    32
  );

}


function kmhToMph(
  kmh
) {

  if (
    kmh === null ||
    kmh === undefined ||
    Number.isNaN(
      Number(kmh)
    )
  ) {

    return null;

  }


  return Math.round(
    Number(kmh) *
    0.621371
  );

}


function metersPerSecondToMph(
  value
) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(
      Number(value)
    )
  ) {

    return null;

  }


  return Math.round(
    Number(value) *
    2.23694
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


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;

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


/* ════════════════════════════════════════════════
   PHRASE ROTATION
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


  let choices =
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
    !choices.length
  ) {

    used.clear();


    choices =
      pool.map(
        (
          _,
          index
        ) =>
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
        ] !== undefined
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


/* ════════════════════════════════════════════════
   SPEECH SEGMENT SAFETY
════════════════════════════════════════════════ */

function splitLongSpeech(
  text
) {

  const cleaned =
    String(
      text || ''
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();


  if (
    cleaned.length <= 185
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


    if (
      !sentence
    ) {

      continue;

    }


    if (
      !current
    ) {

      current =
        sentence;

      continue;

    }


    if (
      (
        current +
        ' ' +
        sentence
      ).length <=
      185
    ) {

      current +=
        ` ${sentence}`;

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


  const result =
    [];


  segments
    .map(
      text =>
        removeEmojis(
          String(
            text || ''
          )
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


            result.push(
              chunk
            );

          }
        );

      }
    );


  return result;

}


/* ════════════════════════════════════════════════
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


/* ════════════════════════════════════════════════
   FORECAST CLEANUP
════════════════════════════════════════════════ */

function cleanForecastText(
  text
) {

  if (
    !text
  ) {

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

      /*
        Smoke/haze wording was creating poor,
        repetitive broadcast language.

        The raw NWS forecast is still used for
        the rest of the forecast. We simply
        avoid making smoke the headline of
        Vector's spoken forecast.
      */

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


/* ════════════════════════════════════════════════
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

  if (
    code ===
    0
  ) {

    return 'clear skies';

  }


  if (
    code ===
    1
  ) {

    return 'mostly clear skies';

  }


  if (
    code ===
    2
  ) {

    return 'partly cloudy skies';

  }


  if (
    code ===
    3
  ) {

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


/* ════════════════════════════════════════════════
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


/* ════════════════════════════════════════════════
   LOCATION DISPLAY
════════════════════════════════════════════════ */

function setLocationText(
  text
) {

  const nested =
    document.querySelector(
      '#liveLocationCard .live-location-text'
    );


  if (
    nested
  ) {

    nested.textContent =
      text;

  }


  else {

    const card =
      document.getElementById(
        'liveLocationCard'
      );


    if (
      card
    ) {

      card.textContent =
        text;

    }

  }


  const askLocation =
    document.getElementById(
      'askVectorLocation'
    );


  if (
    askLocation
  ) {

    askLocation.textContent =
      text;

  }


  const radarLabel =
    document.getElementById(
      'radarLocationLabel'
    );


  if (
    radarLabel
  ) {

    radarLabel.textContent =
      text;

  }

}


function setLocationSource(
  text
) {

  const element =
    document.getElementById(
      'liveLocationSource'
    );


  if (
    element
  ) {

    element.textContent =
      text;

  }

}


function updateReturnLocationButton() {

  const button =
    document.getElementById(
      'returnToMyLocationBtn'
    );


  if (
    !button
  ) {

    return;

  }


  button.hidden =
    locationMode !==
    'search';

}


/* ════════════════════════════════════════════════
   DEVICE GEOLOCATION
════════════════════════════════════════════════ */

function geolocationErrorMessage(
  error
) {

  if (
    !error
  ) {

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

  const parts =
    [];


  if (
    result.name
  ) {

    parts.push(
      result.name
    );

  }


  if (
    result.admin1
  ) {

    parts.push(
      result.admin1
    );

  }


  return parts.join(
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

      <div class="live-search-empty">
        No U.S. locations found.
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
          result.admin1 ||
          '';


        const county =
          result.admin2 ||
          '';


        button.innerHTML = `

          <span class="live-search-suggestion-name">
            ${escapeHtml(result.name || '')}
          </span>

          <span class="live-search-suggestion-detail">
            ${escapeHtml(
              [
                county,
                state
              ]
              .filter(Boolean)
              .join(', ')
            )}
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


  const closeSuggestions =
    () => {

      suggestions.hidden =
        true;


      input.setAttribute(
        'aria-expanded',
        'false'
      );

    };


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
          'Searching…';

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


/* ════════════════════════════════════════════════
   SELECT SEARCH LOCATION
════════════════════════════════════════════════ */

async function selectSearchedLocation(
  result
) {

  if (
    !result
  ) {

    return;

  }


  const wasStarted =
    liveStarted;


  /*
    If this is the initial popup selection,
    this click is a user gesture.

    Unlock media immediately.
  */

  if (
    !wasStarted
  ) {

    startMediaFromUserGesture();

  }


  speechGeneration++;


  if (
    'speechSynthesis'
    in window
  ) {

    speechSynthesis.cancel();

  }


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


  locationReady =
    true;


  locationMode =
    'search';


  selectedSearchLocation =
    result;


  broadcastLoopCount =
    0;


  spokenFactMemory.clear();


  previousWeatherSnapshot =
    null;


  latestChanges =
    [];


  const display =
    locationResultDisplay(
      result
    );


  liveCityState =
    display;


  setLocationText(
    display
  );


  setLocationSource(
    'Selected U.S. location'
  );


  updateReturnLocationButton();


  closeAllSearchSuggestions();


  setAllSearchInputs(
    display
  );


  setLiveBadge(
    'UPDATING'
  );


  setCaption(
    `Loading weather for ${display}…`
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


    updateRadarForLocation();


    if (
      wasStarted
    ) {

      await speakStandalone(

        `Switching StormVector coverage to ${display}.`

      );

    }


    else if (
      startupSpeechPromise
    ) {

      await Promise.race([

        startupSpeechPromise,

        wait(
          5000
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


    setCaption(
      `StormVector could not load weather for ${display}.`
    );

  }

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


      if (
        element
      ) {

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


      if (
        input
      ) {

        input.value =
          value;

      }

    }
  );

}


/* ════════════════════════════════════════════════
   RETURN TO DEVICE LOCATION
════════════════════════════════════════════════ */

async function returnToMyLocation() {

  speechGeneration++;


  if (
    'speechSynthesis'
    in window
  ) {

    speechSynthesis.cancel();

  }


  setRobotSpeaking(
    false
  );


  setLiveBadge(
    'LOCATING'
  );


  setLocationText(
    'Getting your current location…'
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


/* ════════════════════════════════════════════════
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


    const rawState =
      relativeLocation
        ?.state ||
      '';


    const fullState =
      stateName(
        rawState
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

      pointProperties:
        properties,

      observationStationsUrl:
        properties
          .observationStations ||
        null,

      forecast: {

        today,

        tonight

      }

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

      pointProperties:
        {},

      observationStationsUrl:
        null,

      forecast: {

        today:
          null,

        tonight:
          null

      }

    };

  }

}


/* ════════════════════════════════════════════════
   NWS OBSERVATION STATION
════════════════════════════════════════════════ */

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


    /*
      NWS provides nearby stations for the grid.
      Try the first few until one has a current
      observation.
    */

    for (
      const station
      of stations.slice(
        0,
        5
      )
    ) {

      const stationId =

        station.properties
          ?.stationIdentifier

        ||

        station.id
          ?.split('/')
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


        const temperatureC =
          numberOrNull(
            props.temperature
              ?.value
          );


        if (
          temperatureC ===
          null
        ) {

          continue;

        }


        const dewC =
          numberOrNull(
            props.dewpoint
              ?.value
          );


        const humidity =
          numberOrNull(
            props.relativeHumidity
              ?.value
          );


        const windSpeedRaw =
          numberOrNull(
            props.windSpeed
              ?.value
          );


        const gustRaw =
          numberOrNull(
            props.windGust
              ?.value
          );


        const windDeg =
          numberOrNull(
            props.windDirection
              ?.value
          );


        /*
          NWS observation QuantitativeValue wind
          values are commonly in km/h.
        */

        const windSpd =
          windSpeedRaw !==
          null
            ? kmhToMph(
                windSpeedRaw
              )
            : 0;


        const windG =
          gustRaw !==
          null
            ? kmhToMph(
                gustRaw
              )
            : 0;


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
              temperatureC
            ),

          dewF:
            dewC !==
            null
              ? celsiusToFahrenheit(
                  dewC
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
            windSpd ??
            0,

          windG:
            windG ??
            0,

          windDeg:
            windDeg ??
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
          `Observation ${stationId} unavailable`,
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
      'StormVector observation station lookup failed:',
      error
    );


    return null;

  }

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

      if (
        !value
      ) {

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
      )

  };

}


/* ════════════════════════════════════════════════
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
      ) !==
      (
        yj >
        point[1]
      )

      &&

      point[0] <

      (
        (
          xj -
          xi
        ) *
        (
          point[1] -
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

  if (
    !geometry
  ) {

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


/* ════════════════════════════════════════════════
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


  if (
    !row
  ) {

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


/* ════════════════════════════════════════════════
   OBSERVATION UI
════════════════════════════════════════════════ */

function renderObservationInfo(
  observation
) {

  const container =
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
    !container
  ) {

    return;

  }


  if (
    !observation
  ) {

    container.hidden =
      true;


    return;

  }


  container.hidden =
    false;


  if (
    station
  ) {

    station.textContent =
      `${observation.stationName} (${observation.stationId})`;

  }


  if (
    age
  ) {

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


      age.textContent =
        minutes <=
        1
          ? 'Latest observation'
          : `${minutes} min old`;

    }


    else {

      age.textContent =
        '';

    }

  }

}


/* ════════════════════════════════════════════════
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


  if (
    caption
  ) {

    caption.textContent =
      removeEmojis(
        text
      );

  }


  announce(
    text
  );

}


function setCaptionTopic(
  topic
) {

  const element =
    document.getElementById(
      'liveCaptionTopic'
    );


  if (
    element
  ) {

    element.textContent =
      String(
        topic ||
        ''
      )
      .toUpperCase();

  }

}


function setLiveBadge(
  text
) {

  const badge =
    document.getElementById(
      'liveBadge'
    );


  if (
    !badge
  ) {

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
   DYNAMIC GRAPHICS
════════════════════════════════════════════════ */

function showGraphic(
  name
) {

  if (
    !STORMVECTOR_FEATURES
      .dynamicGraphics
  ) {

    return;

  }


  document
    .querySelectorAll(
      '.vector-graphic-view'
    )
    .forEach(
      view =>
        view.classList
          .remove(
            'active'
          )
    );


  const view =
    document.querySelector(
      `[data-graphic="${name}"]`
    );


  if (
    view
  ) {

    view.classList
      .add(
        'active'
      );

  }


  const titles = {

    conditions:
      'CURRENT CONDITIONS',

    wind:
      'WIND',

    forecast:
      'FORECAST',

    spc:
      'SEVERE WEATHER OUTLOOK',

    changes:
      'WHAT CHANGED',

    alert:
      'WEATHER ALERT',

    radar:
      'LIVE RADAR'

  };


  const title =
    document.getElementById(
      'vectorGraphicTitle'
    );


  if (
    title
  ) {

    title.textContent =
      titles[
        name
      ] ||
      'STORMVECTOR LIVE';

  }


  setCaptionTopic(
    titles[
      name
    ] ||
    name
  );


  if (
    name ===
    'radar'
  ) {

    setTimeout(
      () => {

        radarMap
          ?.invalidateSize();

      },
      150
    );

  }

}


function topicForSpeech(
  text
) {

  const value =
    String(
      text ||
      ''
    )
    .toLowerCase();


  if (
    /tornado warning|severe thunderstorm warning|flash flood warning|weather alert|breaking weather|warning has been issued|watch is in effect/
      .test(
        value
      )
  ) {

    return 'alert';

  }


  if (
    /radar/
      .test(
        value
      )
  ) {

    return 'radar';

  }


  if (
    /storm prediction center|severe risk|enhanced risk|moderate risk|high risk|slight risk|marginal risk/
      .test(
        value
      )
  ) {

    return 'spc';

  }


  if (
    /wind|gust/
      .test(
        value
      )
  ) {

    return 'wind';

  }


  if (
    /tonight|forecast|looking ahead|rest of the day|sunset|tomorrow/
      .test(
        value
      )
  ) {

    return 'forecast';

  }


  if (
    /what changed|since the last|changed/
      .test(
        value
      )
  ) {

    return 'changes';

  }


  return 'conditions';

}


function switchGraphicForSpeech(
  text
) {

  const topic =
    topicForSpeech(
      text
    );


  showGraphic(
    topic
  );


  if (
    topic ===
    'radar'
  ) {

    ensureRadar();

  }

}


/* ════════════════════════════════════════════════
   UPDATE GRAPHICS DATA
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

    'graphicWindLarge',

    `${window.degToCompass(ctx.windDeg) || 'VRB'} ${ctx.windSpd} mph`

  );


  setText(

    'graphicGust',

    ctx.windG
      ? `${ctx.windG} mph`
      : 'None'

  );


  const arrow =
    document.getElementById(
      'graphicWindArrow'
    );


  if (
    arrow &&
    Number.isFinite(
      Number(
        ctx.windDeg
      )
    )
  ) {

    arrow.style.transform =
      `rotate(${Number(ctx.windDeg)}deg)`;

  }


  setText(

    'graphicForecastText',

    ctx.forecast?.today ||
    ctx.forecast?.tonight ||
    'Forecast data is currently unavailable.'

  );


  updateSpcGraphic(
    ctx.spc
  );


  updateAlertGraphic(
    ctx.alerts
  );

}


function setText(
  id,
  value
) {

  const element =
    document.getElementById(
      id
    );


  if (
    element
  ) {

    element.textContent =
      value;

  }

}


function updateSpcGraphic(
  risk
) {

  const riskNames = {

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


  setText(

    'graphicSpcRisk',

    riskNames[
      risk
    ] ||
    'NO ORGANIZED RISK'

  );


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

    'graphicSpcDescription',

    descriptions[
      risk
    ] ||
    'No categorical severe weather risk is currently loaded for this location.'

  );

}


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


  if (
    !alert
  ) {

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
      ''
    )

  );

}


/* ════════════════════════════════════════════════
   WHAT CHANGED ENGINE
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

    humidity:
      ctx.humidity,

    windSpd:
      ctx.windSpd,

    windG:
      ctx.windG,

    windDeg:
      ctx.windDeg,

    wcode:
      ctx.wcode,

    spc:
      ctx.spc,

    forecastToday:
      ctx.forecast
        ?.today ||
      '',

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
          'StormVector baseline established. Future updates will be compared with these conditions.',
        important:
          false
      }

    ];


    renderChanges(
      latestChanges
    );


    return latestChanges;

  }


  const old =
    previousWeatherSnapshot;


  const changes =
    [];


  if (
    old.tempF !==
    null &&
    next.tempF !==
    null &&
    next.tempF !==
    old.tempF
  ) {

    const difference =
      next.tempF -
      old.tempF;


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
    old.windSpd !==
    null &&
    next.windSpd !==
    null &&
    Math.abs(
      next.windSpd -
      old.windSpd
    ) >=
    5
  ) {

    changes.push({

      text:
        `Sustained wind changed from ${old.windSpd} to ${next.windSpd} miles per hour.`,

      important:
        next.windSpd >=
        25

    });

  }


  if (
    old.windG !==
    null &&
    next.windG !==
    null &&
    Math.abs(
      next.windG -
      old.windG
    ) >=
    8
  ) {

    changes.push({

      text:
        `Wind gusts changed from ${old.windG} to ${next.windG} miles per hour.`,

      important:
        next.windG >=
        40

    });

  }


  if (
    old.dewF !==
    null &&
    next.dewF !==
    null &&
    Math.abs(
      next.dewF -
      old.dewF
    ) >=
    3
  ) {

    changes.push({

      text:
        `The dew point changed from ${old.dewF} to ${next.dewF} degrees.`,

      important:
        false

    });

  }


  if (
    old.spc !==
    next.spc
  ) {

    changes.push({

      text:
        `The Storm Prediction Center category changed from ${old.spc || 'none'} to ${next.spc || 'none'}.`,

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
          !old.alertMap.has(
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


  old.alertMap
    .forEach(
      (
        event,
        id
      ) => {

        if (
          !next.alertMap.has(
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


  const time =
    document.getElementById(
      'weatherChangesTime'
    );


  if (
    time
  ) {

    time.textContent =
      `Updated ${new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      })}`;

  }


  if (
    fullList
  ) {

    fullList.innerHTML =
      changes
        .map(
          change => `

            <div class="weather-change-item ${change.important ? 'important' : ''}">
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
          4
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
      "I'm still waiting on the latest temperature, but the rest of the weather data is coming through."
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


  const condition =
    skyDescription(
      ctx.wcode
    );


  const oldCode =
    spokenFactMemory.get(
      'weatherCode'
    );


  if (
    condition &&
    (
      broadcastLoopCount ===
      0 ||

      oldCode !==
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
    0 ||

    watches.length >
    0;


  const locationText =
    ctx.cityState
      ? ` for ${ctx.cityState}`
      : ' for this location';


  if (
    broadcastLoopCount ===
    0
  ) {

    if (
      warnings.length
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
    severeMode
  ) {

    addAlerts(
      segments,
      ctx.alerts
    );


    segments.push(
      "I'm putting the radar and warning area on screen."
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


      segments.push(
        `I'm putting the live radar on screen for ${ctx.cityState || 'this location'}.`
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
        () =>
          null
      )

    ]);


  const observation =
    await fetchNearestObservation(
      nws.observationStationsUrl
    );


  /*
    For searched locations, preserve the place the
    user selected rather than replacing it with an
    NWS relative-location name several miles away.
  */

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


  /*
    NWS station observations are preferred for
    the observed values.

    Open-Meteo fills fields the observation
    station may not provide.
  */

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


    alerts:
      alerts ||
      [],


    forecast:
      nws.forecast ||
      {

        today:
          null,

        tonight:
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


  buildScript(
    ctx
  );


  updateRadarForLocation();


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
      .17,
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
    .045,
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
    .085,
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
    .17,
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
      ? .93

      : isAndroid
        ? .92

        : .96;


  utterance.pitch =
    1;


  utterance.volume =
    1;


  return utterance;

}


/* ════════════════════════════════════════════════
   IPHONE STARTUP MEDIA UNLOCK
════════════════════════════════════════════════ */

function startMediaFromUserGesture() {

  const music =
    ensureLiveMusicElement();


  try {

    music.volume =
      .025;


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


            showGraphic(
              'conditions'
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
    MUST remain before the first await.
  */

  startMediaFromUserGesture();


  if (
    button
  ) {

    button.disabled =
      true;


    button.textContent =
      'Getting Location…';

  }


  try {

    if (
      !locationReady
    ) {

      setLocationText(
        'Waiting for location permission…'
      );


      await requestCurrentLocation();

    }


    setLocationText(
      'Loading local weather…'
    );


    if (
      button
    ) {

      button.textContent =
        'Loading Weather…';

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
        'Enable Location & Go Live';

    }

  }


  finally {

    startupRunning =
      false;

  }

}


function hideStartOverlay() {

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


      switchGraphicForSpeech(
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
        150
      ) {

        pause =
          540;

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


/* ════════════════════════════════════════════════
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


          switchGraphicForSpeech(
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


/* ════════════════════════════════════════════════
   BROADCAST LOOP
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

      button.textContent =
        'Resume';

    }


    return;

  }


  if (
    button
  ) {

    button.textContent =
      'Stop';

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


/* ════════════════════════════════════════════════
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


  if (
    !target
  ) {

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
    Base map.
  */

  L.tileLayer(

    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',

    {

      maxZoom:
        18,

      attribution:
        '&copy; OpenStreetMap contributors'

    }

  )
  .addTo(
    radarMap
  );


  /*
    NOAA / NCEP MRMS BREF QCD.

    The NOAA GeoServer publishes this as a WMS
    layer named conus_bref_qcd.
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
          .72,

        attribution:
          'NOAA/NWS MRMS'

      }

    );


  radarLayer.addTo(
    radarMap
  );


  radarLayer.on(
    'loading',
    () =>
      setRadarStatus(
        'Loading NOAA MRMS radar…'
      )
  );


  radarLayer.on(
    'load',
    () => {

      radarReady =
        true;


      setRadarStatus(
        'NOAA MRMS radar current'
      );

    }
  );


  radarLayer.on(
    'tileerror',
    () => {

      setRadarStatus(
        'Radar tile unavailable. Retrying automatically.'
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


  bindRadarControls();


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
        .08

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
        .07

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
        .06

    };

  }


  return {

    color:
      '#ff6633',

    weight:
      2,

    fillOpacity:
      .04

  };

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


  const latLng = [

    liveLat,

    liveLon

  ];


  if (
    radarMarker
  ) {

    radarMarker
      .setLatLng(
        latLng
      );

  }


  else {

    radarMarker =
      L.circleMarker(
        latLng,
        {

          radius:
            7,

          color:
            '#ffffff',

          weight:
            2,

          fillColor:
            '#00cfff',

          fillOpacity:
            1

        }
      )
      .addTo(
        radarMap
      );

  }


  radarMarker.bindTooltip(

    liveCityState ||
    'StormVector location',

    {
      direction:
        'top'
    }

  );


  radarMap.setView(
    latLng,
    Math.max(
      radarMap.getZoom(),
      8
    )
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


  radarWarningLayer
    .clearLayers();


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

        radarWarningLayer
          .addData(
            warning
          );

      }
    );

}


function bindRadarControls() {

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
            8
          );

        }

      }
    );


  const warningButton =
    document.getElementById(
      'radarWarningsBtn'
    );


  warningButton
    ?.addEventListener(
      'click',
      () => {

        radarWarningsVisible =
          !radarWarningsVisible;


        warningButton
          .classList
          .toggle(
            'active',
            radarWarningsVisible
          );


        updateRadarWarnings();

      }
    );

}


function showRadarGraphic() {

  showGraphic(
    'radar'
  );


  ensureRadar();


  setTimeout(
    () =>
      radarMap
        ?.invalidateSize(),
    180
  );

}


/* ════════════════════════════════════════════════
   ASK VECTOR
════════════════════════════════════════════════ */

function answerVectorQuestion(
  question
) {

  const ctx =
    currentWeatherContext;


  if (
    !ctx
  ) {

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
    /rain|precipitation|umbrella/
      .test(
        q
      )
  ) {

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

    const priorityAlerts =
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
      priorityAlerts.length
    ) {

      const first =
        priorityAlerts[
          0
        ]
        .properties
        ?.event ||
        'weather alert';


      return `For ${location}, there is active severe weather information. The highest-priority local alert I have is a ${first}. The Storm Prediction Center category is ${spcSpeechName(ctx.spc)}.`;

    }


    return `There are no active National Weather Service warnings or watches for ${location} right now. The Storm Prediction Center category is ${spcSpeechName(ctx.spc)}.`;

  }


  if (
    /wind|windy|gust/
      .test(
        q
      )
  ) {

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

    return `For ${location}, the current temperature is ${ctx.tempF} degrees${ctx.feelsF !== null ? `, and it feels like ${ctx.feelsF}` : ''}.`;

  }


  if (
    /humidity|dew point|muggy/
      .test(
        q
      )
  ) {

    return `For ${location}, humidity is around ${ctx.humidity ?? 'unknown'} percent and the dew point is ${ctx.dewF ?? 'unavailable'} degrees.`;

  }


  if (
    /radar/
      .test(
        q
      )
  ) {

    showRadarGraphic();


    const activeWarning =
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
      activeWarning
    ) {

      return `I've put the live NOAA radar on screen for ${location}, along with the active ${activeWarning.properties?.event || 'warning'} polygon. I use official warning information for storm threats rather than claiming rotation or hail from reflectivity alone.`;

    }


    return `I've put the live NOAA radar on screen for ${location}. It shows the current MRMS reflectivity field around the selected location.`;

  }


  if (
    /tonight/
      .test(
        q
      )
  ) {

    if (
      ctx.forecast
        ?.tonight
    ) {

      return `For ${location} tonight, ${ctx.forecast.tonight}`;

    }


    return `I don't currently have the tonight forecast loaded for ${location}.`;

  }


  if (
    /today|forecast|weather|later/
      .test(
        q
      )
  ) {

    if (
      ctx.forecast
        ?.today
    ) {

      return `For ${location}, ${ctx.forecast.today}`;

    }


    return `The current temperature in ${location} is ${ctx.tempF} degrees, but the detailed forecast is temporarily unavailable.`;

  }


  if (
    /changed|change|new/
      .test(
        q
      )
  ) {

    return latestChanges
      .map(
        change =>
          change.text
      )
      .join(
        ' '
      );

  }


  return `For ${location}, it's currently ${ctx.tempF} degrees. Wind is around ${ctx.windSpd} miles per hour. ${ctx.forecast?.today || 'Ask me about temperature, wind, severe weather, tonight, radar, or what changed.'}`;

}


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


  if (
    !trimmed
  ) {

    return;

  }


  const answer =
    answerVectorQuestion(
      trimmed
    );


  const answerElement =
    document.getElementById(
      'askVectorAnswer'
    );


  if (
    answerElement
  ) {

    answerElement.textContent =
      answer;

  }


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


        if (
          !input
        ) {

          return;

        }


        const question =
          input.value.trim();


        if (
          !question
        ) {

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

            const question =
              button.dataset
                .question ||
              button.textContent;


            askVector(
              question
            );

          }
        );

      }
    );

}


/* ════════════════════════════════════════════════
   SEVERE WEATHER MONITOR
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
          context
            .createOscillator();


        oscillator.type =
          'sine';


        oscillator.frequency
          .value =
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


/* ════════════════════════════════════════════════
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


  const takeover =
    document.getElementById(
      'severeTakeover'
    );


  if (
    !takeover
  ) {

    return;

  }


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


  takeover.hidden =
    false;


  document.body
    .classList
    .add(
      'severe-mode'
    );


  showGraphic(
    'alert'
  );


  updateAlertGraphic(
    [
      alert
    ]
  );

}


function hideSevereTakeover() {

  const takeover =
    document.getElementById(
      'severeTakeover'
    );


  if (
    takeover
  ) {

    takeover.hidden =
      true;

  }


  document.body
    .classList
    .remove(
      'severe-mode'
    );

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


  showSevereTakeover(
    alert
  );


  showRadarGraphic();


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
          messages[
            index
          ];


        const utterance =
          createUtterance(
            text
          );


        utterance.rate =
          .92;


        utterance.onstart =
          () => {

            duckMusic();


            setRobotSpeaking(
              true
            );


            setCaption(
              text
            );


            switchGraphicForSpeech(
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
        removeEmojis(
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


    setTimeout(
      () =>
        radarMap
          ?.invalidateSize(),
      200
    );

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


    showGraphic(
      'conditions'
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


    bindAskVector();


    document
      .getElementById(
        'severeTakeoverClose'
      )
      ?.addEventListener(
        'click',
        hideSevereTakeover
      );


    /*
      Radar initializes lazily.
      This keeps page startup light and avoids
      radar network traffic before the user
      actually begins a broadcast.
    */

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


    if (
      locationSearchController
    ) {

      try {

        locationSearchController.abort();

      }


      catch (_) {}

    }

  }
);