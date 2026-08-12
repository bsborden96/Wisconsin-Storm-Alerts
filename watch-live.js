/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Self-contained live weather broadcaster.

   Key behavior:
     • Uses the user's geolocation for all local weather data.
     • Pulls current conditions from Open-Meteo.
     • Pulls NWS alerts + NWS forecast text.
     • Pulls the SPC Day 1 categorical outlook.
     • Uses stormvector-theme.mp3 as background music.
     • Ducks music smoothly while Vector speaks.
     • Rotates the rundown so each loop has a different focus.
     • Remembers recently spoken conditions and talks about
       what changed instead of re-reading the same numbers.
     • Interrupts for newly issued watches/warnings/emergencies.
     • Uses an EAS-style attention tone before breaking weather.
════════════════════════════════════════════════ */

/* ── STATE ─────────────────────────────────────────── */
let liveLat = null;
let liveLon = null;
let liveCityState = null;

let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;

let liveMuted = false;
let liveMusic = null;
let musicEnabled = true;
let musicFadeFrame = null;

let liveBroadcastContext = null;
let broadcastLoopCount = 0;

let locationReady = false;
let locationError = null;

const spokenFactMemory = new Map();

/* ── SAFE FALLBACKS FOR SHARED HELPERS ─────────────── */
(function installFallbacks() {
  const set = (name, fn) => {
    if (typeof window[name] !== 'function') window[name] = fn;
  };

  set('setBgMode', function () {});
  set('setDaytime', function () {});

  set('degToCompass', function (deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return '';

    const dirs = [
      'N','NNE','NE','ENE',
      'E','ESE','SE','SSE',
      'S','SSW','SW','WSW',
      'W','WNW','NW','NNW'
    ];

    return dirs[Math.round(deg / 22.5) % 16];
  });

  set('dewLabel', function (dewF) {
    if (dewF === null || dewF === undefined) return '';

    if (dewF < 50) return 'very comfortable';
    if (dewF < 60) return 'comfortable';
    if (dewF < 65) return 'a bit sticky';
    if (dewF < 70) return 'muggy';
    if (dewF < 75) return 'oppressive';

    return 'brutally humid';
  });

  set('alertPriorityScore', function (event) {
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
      if (e.includes(needle)) return score;
    }

    return 50;
  });

  set('isTornadoLevel', function (event) {
    return /tornado warning|tornado emergency/i.test(event || '');
  });

  set('parseMovement', function (desc) {
    const text = String(desc || '');

    let m = /moving\s+([nsew]{1,3})\s+at\s+(\d+)\s*mph/i.exec(text);

    if (m) {
      return {
        dir: m[1].toUpperCase(),
        spd: m[2]
      };
    }

    m = /moving\s+(north|south|east|west|northeast|northwest|southeast|southwest)\s+at\s+(\d+)\s*mph/i.exec(text);

    if (m) {
      return {
        dir: m[1],
        spd: m[2]
      };
    }

    return null;
  });

  set('toggleMenu', function () {
    const panel = document.getElementById('menuPanel');
    const btn = document.getElementById('menuBtn');

    if (!panel) return;

    const open = panel.classList.contains('open');

    panel.classList.toggle('open', !open);

    if (btn) {
      btn.setAttribute('aria-expanded', String(!open));
    }
  });
})();

/* ── SMALL UTILITIES ──────────────────────────────── */
async function safeFetch(url, opts = {}) {
  const {
    timeout = 10000,
    ...rest
  } = opts;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctrl.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return res;
  } finally {
    clearTimeout(t);
  }
}

function timeAgo(ms) {
  const mins = Math.round(ms / 60000);

  if (mins < 1) return 'moments ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;

  const hrs = Math.round(mins / 60);

  if (hrs === 1) return '1 hour ago';
  if (hrs < 24) return `${hrs} hours ago`;

  const days = Math.round(hrs / 24);

  return days === 1
    ? '1 day ago'
    : `${days} days ago`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ── PERSONALITY / PHRASE BANKS ───────────────────── */
const phraseHistory = {};

function pickPhrase(pool, category) {
  if (!pool || pool.length === 0) return '';

  if (!phraseHistory[category]) {
    phraseHistory[category] = new Set();
  }

  const used = phraseHistory[category];

  let choices = pool
    .map((_, i) => i)
    .filter(i => !used.has(i));

  if (choices.length === 0) {
    used.clear();
    choices = pool.map((_, i) => i);
  }

  const chosen =
    choices[Math.floor(Math.random() * choices.length)];

  used.add(chosen);

  return pool[chosen];
}

function fill(tpl, vals) {
  return tpl.replace(
    /\{(\w+)\}/g,
    (_, key) =>
      vals[key] !== undefined
        ? vals[key]
        : ''
  );
}

function pickFilled(pool, category, vals) {
  return fill(
    pickPhrase(pool, category),
    vals
  );
}

const PHRASES = {
  liveOpeners: [
    "You're watching StormVector Live.",
    "This is StormVector Live, with Vector on weather.",
    "StormVector Live is on the air.",
    "You're tuned to StormVector Live weather coverage."
  ],

  returnOpeners: [
    "Back with another check of your weather.",
    "Let's get you caught up on what's changed.",
    "Continuing our StormVector Live coverage.",
    "Here's another look at where the weather stands.",
    "Let's check back in on your local weather."
  ],

  transitions: [
    "Looking ahead,",
    "Later today,",
    "Moving into tonight,",
    "As we head toward tomorrow,",
    "Here's what comes next —",
    "Switching gears,",
    "Now, here's something worth watching —",
    "Meanwhile,"
  ],

  quietObservations: [
    "Looks like a pretty easygoing weather setup right now.",
    "If you're headed outside, there isn't much in the weather department fighting you at the moment.",
    "Things are fairly calm across the area right now.",
    "This is one of those quieter stretches where the forecast can breathe a little.",
    "Not a whole lot of weather drama locally at the moment."
  ],

  gloomyObservations: [
    "It's a gray one out there.",
    "Not the brightest weather setup, but we'll walk through what matters.",
    "A little dreary outside right now.",
    "Clouds are doing most of the work in the sky at the moment."
  ],

  closers: [
    "That's where things stand right now. I'll keep watching for changes.",
    "That's your latest check. I'll update you again as the weather evolves.",
    "That's the weather picture for now. I'll be back with another update shortly.",
    "We'll keep the weather moving here on StormVector Live.",
    "That's the latest. Stay weather-aware and I'll keep an eye on what changes next."
  ],

  greetingsQuiet: [
    "Good to have you with us.",
    "Thanks for tuning in.",
    "Glad you're here."
  ],

  greetingsNormal: [
    "Hi, I'm Vector.",
    "Vector here with your latest.",
    "I'm Vector, and here's what we're watching."
  ],

  currentFirst: [
    "Right now we're sitting at {tempF} degrees{feelsClause}.",
    "Currently it's {tempF} degrees{feelsClause}.",
    "Taking a look outside, temperatures are around {tempF}{feelsClause}.",
    "We're sitting at {tempF} degrees right now{feelsClause}."
  ],

  currentSteady: [
    "Temperatures haven't moved much — we're still around {tempF} degrees{feelsClause}.",
    "Not much change outside. We're holding near {tempF}{feelsClause}.",
    "We're still sitting right around {tempF} degrees{feelsClause}.",
    "Conditions remain pretty steady, with the temperature holding at {tempF}{feelsClause}."
  ],

  currentWarmer: [
    "We've warmed up since the last update, now sitting at {tempF} degrees{feelsClause}.",
    "Temperatures have climbed {changeText}, putting us at {tempF}{feelsClause}.",
    "A little warmer now — we're up to {tempF} degrees{feelsClause}.",
    "The temperature has edged upward to {tempF} degrees{feelsClause}."
  ],

  currentCooler: [
    "We've cooled off since the last update, now at {tempF} degrees{feelsClause}.",
    "Temperatures have slipped {changeText}, down to {tempF}{feelsClause}.",
    "A little cooler now — we're sitting at {tempF} degrees{feelsClause}.",
    "The temperature has backed down to {tempF} degrees{feelsClause}."
  ],

  precipActive: [
    "We're also seeing {precip} around the area.",
    "{precipCap} are part of the local weather picture right now.",
    "There's also some {precip} showing up in the current conditions.",
    "Locally, {precip} are in the mix as well."
  ],

  precipQuiet: [
    "No meaningful precipitation is showing up in the current conditions right now.",
    "Precipitation isn't much of a factor locally at the moment.",
    "The local weather picture is fairly dry right now."
  ],

  windDiscussion: [
    "Wind is out of the {windDir} at {windSpd} miles per hour{gustClause}.",
    "We've got a {windDir} wind running {windSpd} miles per hour{gustClause}.",
    "Winds are blowing from the {windDir} at {windSpd} miles per hour{gustClause}.",
    "The breeze is coming from the {windDir} around {windSpd} miles per hour{gustClause}."
  ],

  humidityDiscussion: [
    "Humidity is at {humidity} percent, and with a dew point of {dewF}, it feels {dewLabel} outside.",
    "The dew point is sitting at {dewF}, which puts the air in the {dewLabel} range.",
    "It's {dewLabel} out there, with humidity holding around {humidity} percent.",
    "The moisture in the air is noticeable right now — dew point near {dewF}, humidity around {humidity} percent."
  ],

  confidence: [
    "Confidence in the near-term forecast is pretty solid.",
    "The short-term forecast picture is fairly consistent right now.",
    "There isn't a lot of uncertainty in the immediate forecast at the moment.",
    "We'll keep watching the details, but the overall short-term trend is reasonably clear."
  ],

  safety: [
    "Keep a reliable way to receive weather alerts nearby in case conditions change quickly.",
    "If you've got outdoor plans, keep an eye on the sky and have a backup plan ready.",
    "It's always worth knowing where you'd shelter if severe weather develops.",
    "Make sure weather notifications are enabled somewhere you can hear them."
  ],

  sunTimes: [
    "Sunrise was at {sunrise}, and sunset comes at {sunset}.",
    "We'll lose daylight around {sunset} this evening.",
    "Today's daylight runs from roughly {sunrise} to {sunset}."
  ],

  trivia: [
    "A little weather trivia — lightning can strike the same place more than once, and often does.",
    "Here's a weather fact for you — thunder is usually only heard within roughly ten miles of the lightning that created it.",
    "A quick weather fact — sun dogs are bright spots near the sun caused by ice crystals high in the atmosphere.",
    "One weather fact while things are quiet — hail can fall even when the air at ground level is quite warm."
  ]
};

/* ── MEMORY / SPEECH CLEANUP ──────────────────────── */
function renderForSpeech(text) {
  return String(text || '')
    .replace(/StormVector Live/g, 'StormVector Lyve')
    .replace(/\blive\b/gi, 'lyve')
    .replace(/\bSPC\b/g, 'S P C')
    .replace(/\bNWS\b/g, 'National Weather Service')
    .replace(/\bENS\b/g, 'E N S')
    .replace(/\bmph\b/g, 'miles per hour');
}

function polishSegments(segs) {
  const seen = new Set();

  return segs
    .map(s =>
      String(s || '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .filter(s => {
      const key = s.toLowerCase();

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

  return null;
}

/* ── SEGMENT BUILDERS ─────────────────────────────── */
function addCurrentConditions(segs, ctx) {
  if (ctx.tempF === null) {
    segs.push(
      "I'm having a little trouble getting the latest temperature right now, but I'm still watching the rest of the weather data."
    );

    return;
  }

  const previousTemp =
    spokenFactMemory.get('spokenTemp');

  const previousFeels =
    spokenFactMemory.get('spokenFeels');

  const feelsClause =
    ctx.feelsF !== null &&
    Math.abs(ctx.feelsF - ctx.tempF) >= 3 &&
    (
      broadcastLoopCount === 0 ||
      ctx.feelsF !== previousFeels
    )
      ? `, and it feels closer to ${ctx.feelsF}`
      : '';

  if (previousTemp === undefined) {
    segs.push(
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

  else if (ctx.tempF > previousTemp) {
    const diff =
      ctx.tempF - previousTemp;

    segs.push(
      pickFilled(
        PHRASES.currentWarmer,
        'current-warmer',
        {
          tempF: ctx.tempF,
          feelsClause,
          changeText:
            diff === 1
              ? 'a degree'
              : `${diff} degrees`
        }
      )
    );
  }

  else if (ctx.tempF < previousTemp) {
    const diff =
      previousTemp - ctx.tempF;

    segs.push(
      pickFilled(
        PHRASES.currentCooler,
        'current-cooler',
        {
          tempF: ctx.tempF,
          feelsClause,
          changeText:
            diff === 1
              ? 'a degree'
              : `${diff} degrees`
        }
      )
    );
  }

  else {
    segs.push(
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

  const precip =
    weatherCodePhrase(ctx.wcode);

  if (precip) {
    segs.push(
      pickFilled(
        PHRASES.precipActive,
        'precip-active',
        {
          precip,
          precipCap:
            precip.charAt(0).toUpperCase() +
            precip.slice(1)
        }
      )
    );
  }

  else if (broadcastLoopCount % 3 === 0) {
    segs.push(
      pickPhrase(
        PHRASES.precipQuiet,
        'precip-quiet'
      )
    );
  }

  spokenFactMemory.set(
    'spokenTemp',
    ctx.tempF
  );

  spokenFactMemory.set(
    'spokenFeels',
    ctx.feelsF
  );
}

function addWindDiscussion(segs, ctx) {
  if (
    ctx.windSpd < 5 &&
    ctx.windG < 10
  ) {
    return;
  }

  const gustClause =
    ctx.windG &&
    ctx.windG > ctx.windSpd + 5
      ? `, with gusts up to ${ctx.windG}`
      : '';

  segs.push(
    pickFilled(
      PHRASES.windDiscussion,
      'wind',
      {
        windDir:
          window.degToCompass(ctx.windDeg),

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
    segs.push(
      "Those winds are strong enough to move loose objects and make driving more difficult for high-profile vehicles."
    );
  }
}

function addHumidityDiscussion(segs, ctx) {
  if (ctx.dewF === null) return;

  segs.push(
    pickFilled(
      PHRASES.humidityDiscussion,
      'humidity',
      {
        humidity:
          ctx.humidity !== null
            ? ctx.humidity
            : 'unknown',

        dewF:
          ctx.dewF,

        dewLabel:
          window.dewLabel(ctx.dewF)
      }
    )
  );
}

function addShortForecast(segs, forecast) {
  if (
    !forecast ||
    !forecast.today
  ) {
    return;
  }

  segs.push(
    `${pickPhrase(
      PHRASES.transitions,
      'transitions'
    )} ${forecast.today}`
  );
}

function addTonightForecast(segs, forecast) {
  if (
    !forecast ||
    !forecast.tonight
  ) {
    return;
  }

  const text =
    String(forecast.tonight)
      .replace(/^tonight,?\s*/i, '')
      .trim();

  if (!text) return;

  segs.push(
    `For tonight, ${text}`
  );
}

function extractAlertHazards(description) {
  const desc =
    String(description || '');

  const hazards = [];

  const hailMatch =
    /([\d.]+)\s*inch(?:es)?\s*(?:in diameter\s*)?hail/i.exec(desc);

  const windMatch =
    /(?:wind gusts?|winds?)\s+(?:up to|near|around|of)?\s*(\d+)\s*mph/i.exec(desc);

  if (hailMatch) {
    hazards.push(
      `hail up to ${hailMatch[1]} inches`
    );
  }

  if (windMatch) {
    hazards.push(
      `wind gusts near ${windMatch[1]} miles per hour`
    );
  }

  return hazards;
}

function addAlerts(segs, alerts) {
  if (
    !alerts ||
    alerts.length === 0
  ) {
    if (broadcastLoopCount === 0) {
      segs.push(
        "There are no active National Weather Service alerts for your location right now."
      );
    }

    return;
  }

  const sorted =
    [...alerts].sort(
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
    .forEach(a => {
      const p =
        a.properties || {};

      const area =
        (p.areaDesc || 'your area')
          .split(';')[0];

      let until = null;

      if (p.expires) {
        try {
          until =
            new Date(p.expires)
              .toLocaleTimeString(
                [],
                {
                  hour: 'numeric',
                  minute: '2-digit'
                }
              );
        } catch (_) {}
      }

      const hazards =
        extractAlertHazards(
          p.description
        );

      const hazardClause =
        hazards.length
          ? ` The main threats include ${hazards.join(' and ')}.`
          : '';

      segs.push(
        `A ${p.event || 'weather alert'} is in effect for ${area}${until ? ` until ${until}` : ''}.${hazardClause}`
      );
    });

  if (alerts.length > 2) {
    const extra =
      alerts.length - 2;

    segs.push(
      `There ${extra === 1 ? 'is' : 'are'} ${extra} additional alert${extra === 1 ? '' : 's'} posted for the area as well.`
    );
  }
}

function addSpcOutlook(segs, spc) {
  if (!spc) return;

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

  const label =
    labels[spc];

  if (!label) return;

  segs.push(
    `The Storm Prediction Center has your area under ${label} today.`
  );

  if (
    SPC_RANK[spc] >=
    SPC_RANK.ENH
  ) {
    segs.push(
      "That level of risk deserves extra attention, so I'll keep severe weather near the top of the rundown."
    );
  }
}

function addSunTimes(segs, ctx) {
  if (
    !ctx.sunrise ||
    !ctx.sunset
  ) {
    return;
  }

  segs.push(
    pickFilled(
      PHRASES.sunTimes,
      'sun',
      {
        sunrise:
          ctx.sunrise,

        sunset:
          ctx.sunset
      }
    )
  );
}

function addSeasonalTrivia(segs) {
  segs.push(
    pickPhrase(
      PHRASES.trivia,
      'trivia'
    )
  );
}

function addForecastConfidence(segs) {
  segs.push(
    pickPhrase(
      PHRASES.confidence,
      'confidence'
    )
  );
}

function addSafetyReminder(segs) {
  segs.push(
    pickPhrase(
      PHRASES.safety,
      'safety'
    )
  );
}

/* ── BROADCAST PLAN ───────────────────────────────── */
function createBroadcastPlan({
  alerts,
  tempF,
  windSpd,
  windG,
  dewF,
  wcode,
  spc
}) {
  const hasWarning =
    alerts.some(a =>
      /Warning|Emergency/i.test(
        a.properties?.event || ''
      )
    );

  const hasWatch =
    alerts.some(a =>
      /Watch/i.test(
        a.properties?.event || ''
      )
    );

  const windy =
    windSpd >= 20 ||
    windG >= 30;

  const hot =
    tempF !== null &&
    tempF >= 92;

  const activePrecip =
    weatherCodePhrase(wcode) !== null;

  let intro = 'normal';
  let priority = 'active';
  let lead = 'conditions';

  if (hasWarning) {
    intro = 'breaking';
    priority = 'severe';
    lead = 'alerts';
  }

  else if (hasWatch) {
    intro = 'normal';
    priority = 'severe';
    lead = 'alerts';
  }

  else if (windy) {
    intro = 'wind';
    lead = 'wind';
  }

  else if (hot) {
    intro = 'heat';
    lead = 'heat';
  }

  else if (
    !activePrecip &&
    windSpd < 12
  ) {
    intro = 'quiet';
    priority = 'quiet';
    lead = 'conditions';
  }

  const personality =
    priority === 'severe'
      ? 'reduced'
      : 'full';

  const segments = [];

  /* Severe weather overrides normal rotation. */
  if (priority === 'severe') {
    segments.push(
      'alerts',
      'currentConditions'
    );

    if (windy) {
      segments.push(
        'windDiscussion'
      );
    }

    if (spc) {
      segments.push(
        'spcOutlook'
      );
    }

    segments.push(
      'shortForecast',
      'safety',
      'closing'
    );

    return {
      intro,
      priority,
      lead,
      personality,
      segments
    };
  }

  /*
    NORMAL BROADCAST ROTATION

    Every loop includes current conditions.
    The rest changes so the channel does not
    sound like a report restarting verbatim.
  */

  const rotation =
    broadcastLoopCount % 4;

  segments.push(
    'currentConditions'
  );

  /* Loop 1 */
  if (rotation === 0) {
    if (windy) {
      segments.push(
        'windDiscussion'
      );
    }

    segments.push(
      'shortForecast'
    );

    if (
      dewF !== null &&
      dewF >= 65
    ) {
      segments.push(
        'humidity'
      );
    }
  }

  /* Loop 2 */
  else if (rotation === 1) {
    segments.push(
      'tonight'
    );

    if (spc) {
      segments.push(
        'spcOutlook'
      );
    }

    segments.push(
      'confidence'
    );
  }

  /* Loop 3 */
  else if (rotation === 2) {
    if (dewF !== null) {
      segments.push(
        'humidity'
      );
    }

    if (windSpd >= 8) {
      segments.push(
        'windDiscussion'
      );
    }

    segments.push(
      'sunTimes'
    );
  }

  /* Loop 4 */
  else {
    segments.push(
      'shortForecast'
    );

    if (spc) {
      segments.push(
        'spcOutlook'
      );
    }

    else {
      segments.push(
        'trivia'
      );
    }
  }

  segments.push(
    'closing'
  );

  return {
    intro,
    priority,
    lead,
    personality,
    segments
  };
}

/* ── DATA FETCHING ────────────────────────────────── */
async function fetchAlerts(lat, lon) {
  try {
    const res =
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
      await res.json();

    return data.features || [];
  }

  catch (err) {
    console.warn(
      'StormVector alerts fetch failed:',
      err
    );

    return [];
  }
}

async function fetchNwsContext(lat, lon) {
  try {
    const res =
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
      await res.json();

    const props =
      data.properties || {};

    const loc =
      props.relativeLocation?.properties;

    const cityState =
      loc?.city && loc?.state
        ? `${loc.city}, ${loc.state}`
        : loc?.city ||
          loc?.state ||
          null;

    let today = null;
    let tonight = null;

    if (props.forecast) {
      try {
        const fRes =
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

        const fData =
          await fRes.json();

        const periods =
          fData.properties?.periods ||
          [];

        if (periods.length) {
          const now =
            new Date();

          const currentPeriod =
            periods.find(p => {
              const start =
                new Date(p.startTime);

              const end =
                new Date(p.endTime);

              return (
                start <= now &&
                now < end
              );
            }) ||
            periods[0];

          const nextNight =
            periods.find(p =>
              !p.isDaytime &&
              new Date(p.endTime) > now
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
      }

      catch (err) {
        console.warn(
          'StormVector NWS forecast fetch failed:',
          err
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

  catch (err) {
    console.warn(
      'StormVector NWS point fetch failed:',
      err
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

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&daily=sunrise,sunset` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&timezone=auto`;

  const res =
    await safeFetch(
      url,
      {
        timeout: 10000
      }
    );

  const data =
    await res.json();

  const c =
    data.current || {};

  const d =
    data.daily || {};

  const fmt =
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
      c.temperature_2m !== undefined
        ? Math.round(c.temperature_2m)
        : null,

    feelsF:
      c.apparent_temperature !== undefined
        ? Math.round(c.apparent_temperature)
        : null,

    humidity:
      c.relative_humidity_2m !== undefined
        ? Math.round(c.relative_humidity_2m)
        : null,

    dewF:
      c.dew_point_2m !== undefined
        ? Math.round(c.dew_point_2m)
        : null,

    wcode:
      c.weather_code !== undefined
        ? c.weather_code
        : null,

    windSpd:
      c.wind_speed_10m !== undefined
        ? Math.round(c.wind_speed_10m)
        : 0,

    windDeg:
      c.wind_direction_10m !== undefined
        ? c.wind_direction_10m
        : 0,

    windG:
      c.wind_gusts_10m !== undefined
        ? Math.round(c.wind_gusts_10m)
        : 0,

    sunrise:
      fmt(d.sunrise?.[0]),

    sunset:
      fmt(d.sunset?.[0])
  };
}

/* ── SPC DAY 1 CATEGORICAL OUTLOOK ────────────────── */
function pointInRing(pt, ring) {
  let inside = false;

  for (
    let i = 0, j = ring.length - 1;
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

    const intersect =
      ((yi > pt[1]) !== (yj > pt[1])) &&
      (
        pt[0] <
        (xj - xi) *
        (pt[1] - yi) /
        (yj - yi) +
        xi
      );

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygonCoords(pt, coords) {
  if (
    !coords ||
    !coords[0] ||
    !pointInRing(pt, coords[0])
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
        pt,
        coords[i]
      )
    ) {
      return false;
    }
  }

  return true;
}

function pointInGeometry(pt, geometry) {
  if (!geometry) return false;

  if (
    geometry.type ===
    'Polygon'
  ) {
    return pointInPolygonCoords(
      pt,
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
          pt,
          poly
        )
      );
  }

  return false;
}

const SPC_RANK = {
  TSTM: 1,
  MRGL: 2,
  SLGT: 3,
  ENH: 4,
  MDT: 5,
  HIGH: 6
};

async function fetchSpcOutlook(lat, lon) {
  const candidateUrls = [
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
    'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson'
  ];

  for (const url of candidateUrls) {
    try {
      const res =
        await safeFetch(
          url,
          {
            timeout: 8000
          }
        );

      const data =
        await res.json();

      const pt = [
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
            pt,
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

    catch (err) {
      console.warn(
        'StormVector SPC fetch failed for',
        url,
        err
      );
    }
  }

  return null;
}

/* ── CONDITIONS UI + BACKGROUND ───────────────────── */
function renderConditionsRow({
  tempF,
  feelsF,
  windSpd,
  windDeg,
  windG,
  dewF,
  humidity
}) {
  const el =
    document.getElementById(
      'liveConditionsRow'
    );

  if (!el) return;

  const chip =
    (label, val) =>
      `<div class="live-chip"><span class="live-chip-label">${label}</span><span class="live-chip-val">${val}</span></div>`;

  el.innerHTML = [
    tempF !== null
      ? chip(
          'Temp',
          `${tempF}°F`
        )
      : '',

    feelsF !== null
      ? chip(
          'Feels',
          `${feelsF}°F`
        )
      : '',

    dewF !== null
      ? chip(
          'Dew Point',
          `${dewF}°F`
        )
      : '',

    humidity !== null &&
    humidity !== undefined
      ? chip(
          'Humidity',
          `${humidity}%`
        )
      : '',

    chip(
      'Wind',
      `${window.degToCompass(windDeg)} ${windSpd} mph`
    ),

    windG > windSpd + 5
      ? chip(
          'Gusts',
          `${windG} mph`
        )
      : ''
  ].join('');
}

function setBroadcastBg({
  wcode,
  alerts
}) {
  const hasTornado =
    alerts.some(a =>
      window.isTornadoLevel(
        a.properties?.event || ''
      )
    );

  if (hasTornado) {
    window.setBgMode('tornado');
    return;
  }

  if (
    [95, 96, 99]
      .includes(wcode)
  ) {
    window.setBgMode('storm');
  }

  else if (
    [71, 73, 75, 77, 85, 86]
      .includes(wcode)
  ) {
    window.setBgMode('snow');
  }

  else if (
    [45, 48]
      .includes(wcode)
  ) {
    window.setBgMode('fog');
  }

  else if (
    [
      51, 53, 55,
      61, 63, 65,
      80, 81, 82
    ]
      .includes(wcode)
  ) {
    window.setBgMode('rain');
  }

  else if (
    wcode === 1
  ) {
    window.setBgMode(
      'partlycloudy'
    );
  }

  else if (
    [2, 3]
      .includes(wcode)
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

/* ── SCRIPT BUILDING ──────────────────────────────── */
function buildScript(ctx) {
  const {
    cityState,
    tempF,
    feelsF,
    windSpd,
    windDeg,
    windG,
    wcode,
    dewF,
    humidity,
    alerts,
    forecast,
    spc
  } = ctx;

  const segs = [];

  const plan =
    createBroadcastPlan({
      alerts,
      tempF,
      windSpd,
      windG,
      dewF,
      wcode,
      spc
    });

  const greetName =
    cityState
      ? `for ${cityState}`
      : 'for your area';

  if (broadcastLoopCount === 0) {
    segs.push(
      pickPhrase(
        PHRASES.liveOpeners,
        'live-openers'
      )
    );

    let intro;

    switch (plan.intro) {
      case 'breaking':
        intro =
          'This is StormVector Breaking Weather.';
        break;

      case 'wind':
        intro =
          "Let's begin with the wind.";
        break;

      case 'heat':
        intro =
          "Let's start with the heat.";
        break;

      case 'quiet':
        intro =
          pickPhrase(
            PHRASES.greetingsQuiet,
            'greet-quiet'
          );
        break;

      default:
        intro =
          pickPhrase(
            PHRASES.greetingsNormal,
            'greet-normal'
          );
    }

    let lastVisit = null;

    try {
      lastVisit =
        localStorage.getItem(
          'stormvectorLastVisit'
        );
    }

    catch (_) {}

    if (
      lastVisit &&
      Date.now() -
      parseInt(lastVisit, 10) <
      6 * 3600 * 1000
    ) {
      segs.push(
        `${intro} Since you last checked in ${timeAgo(Date.now() - parseInt(lastVisit, 10))}, here's your latest update ${greetName}.`
      );
    }

    else {
      segs.push(
        `${intro} Here's your local StormVector forecast ${greetName}.`
      );
    }
  }

  else if (
    broadcastLoopCount % 4 === 0
  ) {
    segs.push(
      pickPhrase(
        PHRASES.returnOpeners,
        'return-openers'
      )
    );
  }

  if (
    plan.personality === 'full' &&
    broadcastLoopCount % 3 === 0
  ) {
    const isGloomy =
      [
        45, 48,
        51, 53, 55,
        61, 63, 65,
        80, 81, 82
      ]
        .includes(wcode);

    segs.push(
      pickPhrase(
        isGloomy
          ? PHRASES.gloomyObservations
          : PHRASES.quietObservations,
        'observation'
      )
    );
  }

  const builders = {
    currentConditions:
      () =>
        addCurrentConditions(
          segs,
          ctx
        ),

    shortForecast:
      () =>
        addShortForecast(
          segs,
          forecast
        ),

    tonight:
      () =>
        addTonightForecast(
          segs,
          forecast
        ),

    alerts:
      () =>
        addAlerts(
          segs,
          alerts
        ),

    windDiscussion:
      () =>
        addWindDiscussion(
          segs,
          ctx
        ),

    humidity:
      () =>
        addHumidityDiscussion(
          segs,
          ctx
        ),

    spcOutlook:
      () =>
        addSpcOutlook(
          segs,
          spc
        ),

    sunTimes:
      () =>
        addSunTimes(
          segs,
          ctx
        ),

    trivia:
      () =>
        addSeasonalTrivia(
          segs
        ),

    confidence:
      () =>
        addForecastConfidence(
          segs
        ),

    safety:
      () =>
        addSafetyReminder(
          segs
        ),

    closing:
      () => {}
  };

  for (
    const id of
    plan.segments
  ) {
    const fn =
      builders[id];

    if (fn) fn();
  }

  segs.push(
    pickPhrase(
      PHRASES.closers,
      'closers'
    )
  );

  liveSegments =
    polishSegments(segs);

  liveBroadcastContext = {
    ...ctx,
    plan
  };

  liveSegIdx = 0;
}

/* ── LOCATION ─────────────────────────────────────── */
function geolocationErrorMessage(err) {
  if (!err) {
    return 'StormVector could not get your location.';
  }

  switch (err.code) {
    case 1:
      return 'Location permission is turned off. StormVector needs your location to build the local broadcast.';

    case 2:
      return 'Your device could not determine its location.';

    case 3:
      return 'Location lookup timed out.';

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
        const err =
          new Error(
            'Geolocation is not supported by this browser.'
          );

        locationError = err;
        reject(err);

        return;
      }

      navigator.geolocation
        .getCurrentPosition(
          pos => {
            liveLat =
              pos.coords.latitude;

            liveLon =
              pos.coords.longitude;

            locationReady = true;
            locationError = null;

            console.log(
              'StormVector location:',
              liveLat,
              liveLon
            );

            resolve();
          },

          err => {
            locationReady = false;
            locationError = err;

            reject(
              new Error(
                geolocationErrorMessage(err)
              )
            );
          },

          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge:
              2 * 60 * 1000
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

  const startBtn =
    document.getElementById(
      'liveStartBtn'
    );

  if (card) {
    card.textContent =
      'Requesting location…';
  }

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent =
      'Locating…';
  }

  try {
    await initLocation();
    await prepareBroadcast();

    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent =
        '▶ Go Live';
    }

    return true;
  }

  catch (err) {
    console.error(
      'StormVector location/setup error:',
      err
    );

    if (card) {
      card.textContent =
        err.message ||
        'Location required';
    }

    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent =
        '📍 Enable Location';
    }

    return false;
  }
}

/* ── DATA REFRESH ─────────────────────────────────── */
async function prepareBroadcast() {
  if (
    !locationReady ||
    liveLat === null ||
    liveLon === null
  ) {
    throw new Error(
      'StormVector cannot prepare local weather without a location.'
    );
  }

  setLiveBadge(
    'UPDATING'
  );

  const card =
    document.getElementById(
      'liveLocationCard'
    );

  const [
    nws,
    om,
    alerts,
    spc
  ] =
    await Promise.all([
      fetchNwsContext(
        liveLat,
        liveLon
      )
        .catch(() => ({
          cityState: null,
          forecast: {
            today: null,
            tonight: null
          }
        })),

      fetchOpenMeteo(
        liveLat,
        liveLon
      )
        .catch(err => {
          console.warn(
            'StormVector Open-Meteo fetch failed:',
            err
          );

          return {};
        }),

      fetchAlerts(
        liveLat,
        liveLon
      )
        .catch(() => []),

      fetchSpcOutlook(
        liveLat,
        liveLon
      )
        .catch(() => null)
    ]);

  liveCityState =
    nws.cityState;

  if (card) {
    card.textContent =
      liveCityState ||
      `Lat ${liveLat.toFixed(2)}, Lon ${liveLon.toFixed(2)}`;
  }

  const ctx = {
    cityState:
      liveCityState,

    tempF:
      om.tempF ?? null,

    feelsF:
      om.feelsF ?? null,

    windSpd:
      om.windSpd ?? 0,

    windDeg:
      om.windDeg ?? 0,

    windG:
      om.windG ?? 0,

    wcode:
      om.wcode ?? null,

    dewF:
      om.dewF ?? null,

    humidity:
      om.humidity ?? null,

    sunrise:
      om.sunrise ?? null,

    sunset:
      om.sunset ?? null,

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

  if (broadcastLoopCount === 0) {
    for (
      const alert of
      ctx.alerts
    ) {
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
  }

  renderConditionsRow(ctx);
  setBroadcastBg(ctx);
  buildScript(ctx);

  return ctx;
}

/* ── VOICE ────────────────────────────────────────── */
function pickVoice() {
  const voices =
    speechSynthesis.getVoices();

  liveVoice =
    voices.find(v =>
      /en-US/i.test(v.lang) &&
      /(David|Daniel|Aaron|Microsoft David|Google US English Male|Alex|Tom)/i.test(v.name)
    ) ||

    voices.find(v =>
      /Male/i.test(v.name)
    ) ||

    voices.find(v =>
      /en-US/i.test(v.lang)
    ) ||

    voices[0] ||

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

/* ── THEME MUSIC ──────────────────────────────────── */
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

    liveMusic.preload =
      'auto';

    liveMusic.loop =
      true;

    liveMusic.setAttribute(
      'aria-hidden',
      'true'
    );

    liveMusic.style.display =
      'none';

    document.body.appendChild(
      liveMusic
    );
  }

  return liveMusic;
}

function setMusicVolume(
  target,
  duration = 350
) {
  const music =
    ensureLiveMusicElement();

  if (!music) return;

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
          (now - startTime) /
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

      if (progress < 1) {
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

function startMusic() {
  if (!musicEnabled) return;

  const music =
    ensureLiveMusicElement();

  if (!music) return;

  music.loop = true;
  music.volume = 0;

  music.play()
    .then(() => {
      setMusicVolume(
        0.18,
        900
      );
    })
    .catch(err => {
      console.log(
        'StormVector music waiting for user interaction:',
        err
      );
    });
}

function duckMusic() {
  if (
    !liveMusic ||
    liveMusic.paused
  ) {
    return;
  }

  setMusicVolume(
    0.07,
    300
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
    500
  );
}

function stopMusic() {
  if (!liveMusic) return;

  setMusicVolume(
    0,
    350
  );

  setTimeout(
    () => {
      if (!liveMusic) return;

      liveMusic.pause();
      liveMusic.currentTime = 0;
    },
    380
  );
}

/* ── BREAKING WEATHER BANNER ──────────────────────── */
(function injectBreakingBannerStyles() {
  const style =
    document.createElement(
      'style'
    );

  style.textContent = `
.live-breaking-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  background:
    repeating-linear-gradient(
      45deg,
      #ff2d2d,
      #ff2d2d 14px,
      #b40000 14px,
      #b40000 28px
    );
  color: #fff;
  font-family: 'Share Tech Mono', monospace;
  letter-spacing: .08em;
  text-align: center;
  padding: 10px 12px;
  font-weight: 700;
  box-shadow: 0 4px 18px rgba(0,0,0,.4);
  animation: breakingFlash 1s steps(2,start) infinite;
}

@keyframes breakingFlash {
  50% {
    filter: brightness(1.25);
  }
}
`;

  document.head.appendChild(
    style
  );
})();

/* ── SEVERE WEATHER INTERRUPTION ──────────────────── */
let knownPriorityAlertIds =
  new Set();

let breakingWeatherActive =
  false;

let severeWatchTimer =
  null;

let resumeSegIdxAfterBreak =
  0;

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

    severeWatchTimer =
      null;
  }
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
        .filter(a =>
          /Warning|Watch|Emergency/i
            .test(
              a.properties?.event ||
              ''
            )
        )
        .sort(
          (a, b) =>
            window.alertPriorityScore(
              a.properties?.event ||
              ''
            ) -
            window.alertPriorityScore(
              b.properties?.event ||
              ''
            )
        );

    const newOnes =
      priorityAlerts.filter(
        a =>
          !knownPriorityAlertIds
            .has(a.id)
      );

    priorityAlerts.forEach(
      a =>
        knownPriorityAlertIds
          .add(a.id)
    );

    if (
      newOnes.length > 0
    ) {
      await interruptForBreakingWeather(
        newOnes[0]
      );
    }
  }

  catch (err) {
    console.warn(
      'StormVector severe watch failed:',
      err
    );
  }
}

async function playEASTone() {
  try {
    const Ctx =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!Ctx) return;

    const ctx =
      new Ctx();

    if (
      ctx.state ===
      'suspended'
    ) {
      await ctx.resume();
    }

    const duration =
      3.2;

    const gain =
      ctx.createGain();

    gain.gain.value =
      0.22;

    gain.connect(
      ctx.destination
    );

    [853, 960].forEach(
      freq => {
        const osc =
          ctx.createOscillator();

        osc.type =
          'sine';

        osc.frequency.value =
          freq;

        osc.connect(
          gain
        );

        osc.start();

        osc.stop(
          ctx.currentTime +
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
      await ctx.close();
    }

    catch (_) {}
  }

  catch (err) {
    console.warn(
      'StormVector attention tone failed:',
      err
    );
  }
}

async function interruptForBreakingWeather(
  priorityAlert
) {
  breakingWeatherActive =
    true;

  resumeSegIdxAfterBreak =
    liveSegIdx;

  speechSynthesis.cancel();

  setMusicVolume(
    0.035,
    250
  );

  setLiveBadge(
    'BREAKING'
  );

  showBreakingBanner(
    true
  );

  await playEASTone();

  const event =
    priorityAlert.properties?.event ||
    'weather alert';

  const area =
    (
      priorityAlert.properties?.areaDesc ||
      'your area'
    )
      .split(';')[0];

  const mv =
    window.parseMovement(
      priorityAlert.properties?.description ||
      ''
    );

  const isWarning =
    /Warning|Emergency/i
      .test(event);

  const breakingSegs = [
    'This is a StormVector Breaking Weather update.',

    `A ${event} is now in effect for ${area}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ''} ${isWarning ? 'Take action now if you are in the warned area and follow National Weather Service instructions.' : 'Review your severe weather plan and be ready to act if warnings are issued.'}`,

    'I will keep this alert at the top of the weather coverage.'
  ];

  await speakSequential(
    breakingSegs
  );

  try {
    await prepareBroadcast();
  }

  catch (err) {
    console.warn(
      'StormVector post-alert refresh failed:',
      err
    );
  }

  breakingWeatherActive =
    false;

  showBreakingBanner(
    false
  );

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
      let idx = 0;

      const next =
        () => {
          if (
            idx >=
            list.length
          ) {
            resolve();
            return;
          }

          const utter =
            new SpeechSynthesisUtterance(
              renderForSpeech(
                list[idx]
              )
            );

          if (liveVoice) {
            utter.voice =
              liveVoice;
          }

          utter.rate = 0.94;
          utter.pitch = 1.0;
          utter.volume = 1.0;

          utter.onstart =
            () => {
              duckMusic();

              const cap =
                document.getElementById(
                  'liveCaptionText'
                );

              if (cap) {
                cap.textContent =
                  list[idx];
              }

              announce(
                list[idx]
              );
            };

          utter.onend =
            () => {
              idx++;

              setTimeout(
                next,
                300
              );
            };

          utter.onerror =
            () => {
              idx++;
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

function showBreakingBanner(
  show
) {
  const el =
    document.getElementById(
      'liveBreakingBanner'
    );

  if (!el) return;

  el.hidden =
    !show;
}

/* ── ANDROID / MOBILE RELIABILITY ─────────────────── */
let speechKeepAlive =
  null;

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
  if (
    speechKeepAlive
  ) {
    clearInterval(
      speechKeepAlive
    );

    speechKeepAlive =
      null;
  }
}

let wakeLock = null;

async function requestWakeLock() {
  try {
    if (
      'wakeLock' in navigator
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
    wakeLock &&
      wakeLock.release();
  }

  catch (_) {}

  wakeLock = null;
}

document.addEventListener(
  'visibilitychange',
  () => {
    if (
      document.visibilityState ===
      'visible'
    ) {
      if (!liveMuted) {
        requestWakeLock();
      }

      if (
        !liveMuted &&
        !breakingWeatherActive &&
        'speechSynthesis' in window &&
        !speechSynthesis.speaking &&
        liveSegments.length
      ) {
        speakSegment(
          liveSegIdx
        );
      }
    }
  }
);

/* ── PLAYBACK CONTROL ─────────────────────────────── */
async function startBroadcast() {
  if (!locationReady) {
    const ready =
      await requestLocationAndPrepare();

    if (!ready) {
      alert(
        'StormVector needs location access to provide your local weather. If you previously denied it, enable location permission for this site in your browser settings and try again.'
      );

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

  startMusic();

  try {
    localStorage.setItem(
      'stormvectorLastVisit',
      String(Date.now())
    );
  }

  catch (_) {}

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

  const btn =
    document.getElementById(
      'liveMuteBtn'
    );

  if (liveMuted) {
    speechSynthesis.cancel();

    stopMusic();

    setLiveBadge(
      'MUTED'
    );

    if (btn) {
      btn.textContent =
        '🔊 Resume';
    }

    stopSpeechKeepAlive();
    stopSevereWatch();
    releaseWakeLock();
  }

  else {
    setLiveBadge(
      'LIVE'
    );

    if (btn) {
      btn.textContent =
        '🔇 Stop';
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

function setLiveBadge(text) {
  const el =
    document.getElementById(
      'liveBadge'
    );

  if (!el) return;

  el.innerHTML =
    `<span class="live-dot"></span>${text}`;

  el.classList.toggle(
    'live-badge-on',
    text === 'LIVE'
  );
}

/* ── SMOOTH SPEECH PIPELINE ───────────────────────── */
function speakSegment(i) {
  if (
    breakingWeatherActive
  ) {
    return;
  }

  if (
    liveMuted ||
    !('speechSynthesis' in window)
  ) {
    const cap =
      document.getElementById(
        'liveCaptionText'
      );

    if (
      cap &&
      liveSegments[i]
    ) {
      cap.textContent =
        liveSegments[i];
    }

    return;
  }

  if (
    i >=
    liveSegments.length
  ) {
    setLiveBadge(
      'CHECKING WEATHER'
    );

    restoreMusic();

    setTimeout(
      async () => {
        broadcastLoopCount++;

        try {
          await prepareBroadcast();
        }

        catch (err) {
          console.error(
            'StormVector refresh failed:',
            err
          );
        }

        setTimeout(
          () =>
            speakSegment(0),
          2200
        );
      },
      3500
    );

    return;
  }

  liveSegIdx = i;

  const isAndroid =
    /Android/i.test(
      navigator.userAgent
    );

  const utter =
    new SpeechSynthesisUtterance(
      renderForSpeech(
        liveSegments[i]
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

  utter.pitch = 1.0;
  utter.volume = 1.0;

  utter.onstart =
    () => {
      duckMusic();

      setLiveBadge(
        'LIVE'
      );

      document
        .getElementById(
          'liveAvatar'
        )
        ?.classList.add(
          'speaking'
        );

      const cap =
        document.getElementById(
          'liveCaptionText'
        );

      if (cap) {
        cap.textContent =
          liveSegments[i];
      }

      announce(
        liveSegments[i]
      );
    };

  utter.onend =
    () => {
      document
        .getElementById(
          'liveAvatar'
        )
        ?.classList.remove(
          'speaking'
        );

      if (liveMuted) return;

      const pause =
        liveSegments[i].length >
        180
          ? 550
          : 350;

      setTimeout(
        () =>
          speakSegment(
            i + 1
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

      document
        .getElementById(
          'liveAvatar'
        )
        ?.classList.remove(
          'speaking'
        );

      if (!liveMuted) {
        setTimeout(
          () =>
            speakSegment(
              i + 1
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
      ? 75
      : 25
  );
}

function announce(msg) {
  const el =
    document.getElementById(
      'ariaLive'
    );

  if (!el) return;

  el.textContent = '';

  requestAnimationFrame(
    () => {
      el.textContent =
        msg;
    }
  );
}

/* ── BOOT ─────────────────────────────────────────── */
document.addEventListener(
  'DOMContentLoaded',
  async () => {
    ensureLiveMusicElement();

    const startBtn =
      document.getElementById(
        'liveStartBtn'
      );

    const card =
      document.getElementById(
        'liveLocationCard'
      );

    if (card) {
      card.textContent =
        'Locating…';
    }

    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent =
        'Preparing…';
    }

    const ready =
      await requestLocationAndPrepare();

    if (
      ready &&
      startBtn
    ) {
      startBtn.disabled = false;
      startBtn.textContent =
        '▶ Go Live';
    }
  }
);

/* ── CLEANUP ──────────────────────────────────────── */
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