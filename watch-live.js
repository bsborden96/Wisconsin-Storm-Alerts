/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Updated for the current Vector index.html:
   - no hamburger/menu dependency
   - location-aware weather updates
   - severe-weather priority
   - SPC/Tornado data panels
   - radar product tabs
════════════════════════════════════════════════ */

let liveLat = 43, liveLon = -88;
let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;
let liveMuted = false;
let liveMusic = null;
let musicEnabled = true;
let currentWeatherContext = null;

const SPC_RANK = { NONE:0, TSTM:1, MRGL:2, SLGT:3, ENH:4, MDT:5, HIGH:6 };

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "--";
}

function degToCompass(deg) {
  if (!Number.isFinite(Number(deg))) return "CALM";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(Number(deg) / 22.5) % 16];
}

function alertPriorityScore(event = "") {
  const e = event.toLowerCase();
  if (e.includes("tornado emergency")) return 0;
  if (e.includes("tornado warning")) return 1;
  if (e.includes("severe thunderstorm warning")) return 2;
  if (e.includes("flash flood warning")) return 3;
  if (e.includes("tornado watch")) return 4;
  if (e.includes("severe thunderstorm watch")) return 5;
  return 20;
}

function isTornadoLevel(event = "") {
  return /tornado warning|tornado emergency/i.test(event);
}

function isCriticalAlert(alert) {
  return /tornado emergency/i.test(alert?.properties?.event || "");
}

function isUrgentWarning(alert) {
  if (isCriticalAlert(alert)) return true;
  const event = String(alert?.properties?.event || "").toLowerCase();
  return event.includes("tornado warning") ||
    event.includes("severe thunderstorm warning") ||
    event.includes("flash flood warning") ||
    event.includes("snow squall warning") ||
    event.includes("blizzard warning") ||
    event.includes("ice storm warning");
}

function isWatchAlert(alert) {
  return /tornado watch|severe thunderstorm watch/i.test(alert?.properties?.event || "");
}

function severeOnlyMode(ctx = currentWeatherContext) {
  return (ctx?.alerts || []).some(isUrgentWarning);
}

function getSafetyInstructions(alert) {
  const event = String(alert?.properties?.event || "").toLowerCase();
  if (event.includes("tornado")) {
    return "Move to a basement or small interior room on the lowest floor of a sturdy building. Stay away from windows and protect your head and neck.";
  }
  if (event.includes("severe thunderstorm")) {
    return "Move indoors and stay away from windows. Avoid travel until the warning has passed.";
  }
  if (event.includes("flash flood")) {
    return "Move away from flood-prone areas. Never drive through flooded roads. Turn around, don't drown.";
  }
  if (event.includes("snow squall")) {
    return "Avoid or delay travel if possible. If driving, slow down, use headlights, and allow extra stopping distance.";
  }
  return alert?.properties?.instruction || "Follow official National Weather Service instructions.";
}

function parseMovement(description = "") {
  const m = description.match(/MOVING\s+([A-Z]+)\s+AT\s+(\d+)\s+MPH/i);
  return m ? { dir:m[1], spd:m[2] } : null;
}

function startMusic() {
  if (!musicEnabled) return;
  if (!liveMusic) liveMusic = document.getElementById("liveMusic");
  if (!liveMusic) return;
  liveMusic.volume = 0.35;
  liveMusic.loop = true;
  liveMusic.play().catch(() => {});
}

function stopMusic() {
  if (!liveMusic) return;
  liveMusic.pause();
  liveMusic.currentTime = 0;
}

async function safeFetch(url, { timeout = 10000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept:"application/geo+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

function timeAgo(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

async function prepareBroadcast() {
  setLiveBadge("UPDATING");

  let cityState = "";
  let county = "";
  let forecastUrl = null;

  try {
    const res = await safeFetch(`https://api.weather.gov/points/${liveLat.toFixed(4)},${liveLon.toFixed(4)}`, {timeout:8000});
    const data = await res.json();
    forecastUrl = data.properties?.forecast || null;
    const city = data.properties?.relativeLocation?.properties?.city || "";
    const state = data.properties?.relativeLocation?.properties?.state || "";
    cityState = `${city}${city && state ? ", " : ""}${state}`;

    if (data.properties?.county) {
      try {
        const cRes = await safeFetch(data.properties.county, {timeout:6000});
        const cData = await cRes.json();
        county = cData.properties?.name || "";
      } catch (_) {}
    }
  } catch (_) {}

  setText("liveLocationText", cityState || "Current location");
  setText("liveLocationSource", county ? `${county} County` : "StormVector Live Weather");
  setText("askVectorLocation", cityState || "Current location");
  setText("radarLocationLabel", cityState || "Current location");

  let tempF=null, feelsF=null, windSpd=0, windDeg=0, windG=0, wcode=0, dewF=null, humidity=null;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${liveLat}&longitude=${liveLon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`;
    const res = await safeFetch(url);
    const d = await res.json();
    const c = d.current || {};
    tempF = Number.isFinite(c.temperature_2m) ? Math.round(c.temperature_2m) : null;
    feelsF = Number.isFinite(c.apparent_temperature) ? Math.round(c.apparent_temperature) : null;
    dewF = Number.isFinite(c.dew_point_2m) ? Math.round(c.dew_point_2m) : null;
    humidity = Number.isFinite(c.relative_humidity_2m) ? Math.round(c.relative_humidity_2m) : null;
    windSpd = Math.round(c.wind_speed_10m || 0);
    windDeg = Number(c.wind_direction_10m || 0);
    windG = Math.round(c.wind_gusts_10m || 0);
    wcode = Number(c.weather_code || 0);
  } catch (_) {}

  let alerts = [];
  try {
    const res = await safeFetch(`https://api.weather.gov/alerts/active?point=${liveLat.toFixed(4)},${liveLon.toFixed(4)}`);
    const data = await res.json();
    alerts = (data.features || []).sort((a,b) =>
      alertPriorityScore(a.properties?.event || "") - alertPriorityScore(b.properties?.event || "")
    );
  } catch (_) {}

  let forecast = [];
  if (forecastUrl) {
    try {
      const res = await safeFetch(forecastUrl);
      const data = await res.json();
      forecast = data.properties?.periods || [];
    } catch (_) {}
  }

  currentWeatherContext = {
    cityState, county, tempF, feelsF, dewF, humidity,
    windSpd, windDeg, windG, wcode, alerts, forecast,
    spc: inferSpcRisk(alerts)
  };

  buildScript(currentWeatherContext);
  renderConditionsRow(currentWeatherContext);
  updateGraphicsData(currentWeatherContext);
  updateSpcImages();
  updateSevereTakeover(currentWeatherContext);
  setBroadcastBg(currentWeatherContext);

  setText("freshnessObservation", "CURRENT");
  setText("freshnessForecast", forecast.length ? "CURRENT" : "UNAVAILABLE");
  setText("freshnessAlerts", "CURRENT");
  setText("vectorTravelStatus", "LOCATION ON");
  setText("vectorThreatStatus", severeOnlyMode() ? "WARNING" : alerts.some(isWatchAlert) ? "WATCH" : "NORMAL");

  const btn = document.getElementById("liveStartBtn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "USE MY LOCATION";
  }

  if (!liveMuted) setLiveBadge("READY");
}

function inferSpcRisk(alerts) {
  if (alerts.some(a => /tornado warning|tornado emergency/i.test(a.properties?.event || ""))) return "HIGH";
  if (alerts.some(a => /severe thunderstorm warning/i.test(a.properties?.event || ""))) return "ENH";
  if (alerts.some(isWatchAlert)) return "SLGT";
  return "NONE";
}

function createBroadcastPlan({alerts,tempF,windSpd,dewF}) {
  if ((alerts || []).some(isUrgentWarning)) return {priority:"breaking",intro:"breaking",lead:"warning"};
  if (windSpd >= 20) return {priority:"wind",intro:"wind",lead:"wind"};
  if (tempF >= 90 && dewF >= 72) return {priority:"heat",intro:"heat",lead:"heat"};
  return {priority:"normal",intro:"normal",lead:"conditions"};
}

function addCurrentConditions(segs, ctx) {
  if (ctx.tempF === null) {
    segs.push("I'm having trouble reaching live current conditions right now.");
    return;
  }
  let line = `Right now it's ${ctx.tempF} degrees`;
  if (ctx.feelsF !== null && ctx.feelsF !== ctx.tempF) line += `, feeling like ${ctx.feelsF}`;
  line += ".";
  if (ctx.windSpd >= 15) {
    line += ` Winds are out of the ${degToCompass(ctx.windDeg)} at ${ctx.windSpd} miles per hour${ctx.windG > ctx.windSpd + 5 ? `, gusting to ${ctx.windG}` : ""}.`;
  }
  segs.push(line);
}

function addAlerts(segs, alerts) {
  const urgent = (alerts || []).filter(isUrgentWarning);
  if (urgent.length) {
    const a = urgent[0];
    const p = a.properties || {};
    const mv = parseMovement(p.description || "");
    segs.push(`This is StormVector Breaking Weather. A ${p.event || "weather warning"} is in effect for ${(p.areaDesc || "your area").split(";")[0]}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ""} ${getSafetyInstructions(a)}`);
    return;
  }
  const watches = (alerts || []).filter(isWatchAlert);
  if (watches.length) {
    const a = watches[0].properties || {};
    segs.push(`A ${a.event} is in effect for ${(a.areaDesc || "your area").split(";")[0]}. Stay weather-aware and be ready to act if a warning is issued.`);
  }
}

function addShortForecast(segs, forecast) {
  const next = forecast?.[0];
  if (next?.detailedForecast) segs.push(`Looking ahead, ${next.detailedForecast}`);
}

function buildScript(ctx) {
  const segs = [];
  const plan = createBroadcastPlan(ctx);

  if (plan.lead === "warning") {
    addAlerts(segs, ctx.alerts);
    liveSegments = segs;
    liveSegIdx = 0;
    return;
  }

  let lastVisit = null;
  try { lastVisit = localStorage.getItem("stormvectorLastVisit"); } catch (_) {}

  segs.push("You're listening to StormVector.");
  if (lastVisit && Date.now() - Number(lastVisit) < 6 * 3600 * 1000) {
    segs.push(`Welcome back. Since your last update ${timeAgo(Date.now() - Number(lastVisit))}, here's the latest for ${ctx.cityState || "your area"}.`);
  } else {
    segs.push(`Hi, I'm Vector. Here's your live StormVector forecast for ${ctx.cityState || "your area"}.`);
  }

  addCurrentConditions(segs, ctx);
  addShortForecast(segs, ctx.forecast);
  addAlerts(segs, ctx.alerts);

  if (ctx.dewF !== null && ctx.dewF >= 60) {
    segs.push(`The dew point is ${ctx.dewF} degrees, so the air is carrying plenty of moisture.`);
  }

  segs.push("That's your StormVector update. I'll keep watching conditions for changes.");
  liveSegments = segs;
  liveSegIdx = 0;
}

function renderConditionsRow(ctx) {
  const el = document.getElementById("liveConditionsRow");
  if (!el) return;
  const chip = (label,val) => `<div class="live-chip"><span class="live-chip-label">${label}</span><span class="live-chip-val">${val}</span></div>`;
  el.innerHTML = [
    ctx.tempF !== null ? chip("Temp", `${ctx.tempF}°F`) : "",
    ctx.feelsF !== null ? chip("Feels", `${ctx.feelsF}°F`) : "",
    ctx.dewF !== null ? chip("Dew Point", `${ctx.dewF}°F`) : "",
    chip("Wind", `${degToCompass(ctx.windDeg)} ${ctx.windSpd} mph`),
    ctx.windG > ctx.windSpd + 5 ? chip("Gusts", `${ctx.windG} mph`) : ""
  ].join("");
}

function updateGraphicsData(ctx) {
  setText("graphicTemp", ctx.tempF !== null ? `${ctx.tempF}°` : "--");
  setText("graphicFeels", ctx.feelsF !== null ? `${ctx.feelsF}°` : "--");
  setText("graphicDew", ctx.dewF !== null ? `${ctx.dewF}°` : "--");
  setText("graphicHumidity", ctx.humidity !== null ? `${ctx.humidity}%` : "--");
  setText("graphicWind", `${degToCompass(ctx.windDeg)} ${ctx.windSpd} MPH`);
  setText("graphicForecastText", ctx.forecast?.[0]?.detailedForecast || "Forecast unavailable.");
  setText("graphicSpcRisk", ctx.spc === "NONE" ? "NO ORGANIZED RISK" : ctx.spc);
  setText("severeAlertSummary", ctx.alerts.length ? `${ctx.alerts.length} active weather alert${ctx.alerts.length === 1 ? "" : "s"}.` : "No active severe weather alerts loaded.");
}

function updateSpcImages() {
  const ctx = currentWeatherContext;
  if (!ctx) return;

  const riskTitles = {
    TSTM:"GENERAL THUNDERSTORMS", MRGL:"MARGINAL RISK", SLGT:"SLIGHT RISK",
    ENH:"ENHANCED RISK", MDT:"MODERATE RISK", HIGH:"HIGH RISK"
  };
  const riskDescriptions = {
    TSTM:"Thunderstorms are possible, but organized severe weather is not currently expected.",
    MRGL:"Isolated severe storms are possible near this location.",
    SLGT:"Scattered severe storms are possible near this location.",
    ENH:"Numerous severe storms may occur in or near this risk area.",
    MDT:"Widespread severe weather is possible. Stay weather-aware and be ready to act.",
    HIGH:"A significant severe weather outbreak is possible. Closely monitor warnings and be prepared to act quickly."
  };

  const risk = riskTitles[ctx.spc] || "NO ORGANIZED RISK";
  const description = riskDescriptions[ctx.spc] || "No organized SPC severe weather risk is currently loaded for this location.";
  const severeAlerts = (ctx.alerts || []).filter(a => isUrgentWarning(a) || isWatchAlert(a));

  setText("spcPanelRisk", risk);
  setText("spcPanelDescription", description);
  setText("spcPanelLocation", ctx.cityState || "Current location");
  setText("spcPanelAlerts", severeAlerts.length ? `${severeAlerts.length} ACTIVE` : "NONE");
  setText("spcPanelWind", ctx.windG > ctx.windSpd + 5 ? `${ctx.windSpd} MPH / G ${ctx.windG}` : `${ctx.windSpd} MPH`);
  setText("spcPanelStatus", severeOnlyMode(ctx) ? "WARNING" : severeAlerts.length ? "WATCH" : SPC_RANK[ctx.spc] >= SPC_RANK.SLGT ? "ELEVATED" : "NORMAL");
  setText("spcPanelMessage", `${description} ${severeAlerts.length ? `There ${severeAlerts.length === 1 ? "is" : "are"} ${severeAlerts.length} active severe weather alert${severeAlerts.length === 1 ? "" : "s"} affecting this location.` : "There are no active severe weather watches or warnings affecting this location."}`);

  const tornadoWarning = (ctx.alerts || []).find(a => /tornado warning|tornado emergency/i.test(a.properties?.event || ""));
  const tornadoWatch = (ctx.alerts || []).find(a => /tornado watch/i.test(a.properties?.event || ""));

  if (tornadoWarning) {
    const p = tornadoWarning.properties || {};
    setText("tornadoPanelStatus", p.event || "TORNADO WARNING");
    setText("tornadoPanelDescription", (p.areaDesc || ctx.cityState || "Current location").split(";")[0]);
    setText("tornadoPanelAlert", getSafetyInstructions(tornadoWarning));
  } else if (tornadoWatch) {
    setText("tornadoPanelStatus", "TORNADO WATCH");
    setText("tornadoPanelDescription", "Conditions are favorable for tornadoes and severe thunderstorms in the watch area.");
    setText("tornadoPanelAlert", "Stay weather-aware and be ready to move to shelter quickly if a warning is issued.");
  } else {
    setText("tornadoPanelStatus", "NO ACTIVE TORNADO WARNING");
    setText("tornadoPanelDescription", `Vector is monitoring National Weather Service tornado alerts for ${ctx.cityState || "this location"}.`);
    setText("tornadoPanelAlert", "No tornado warning or tornado watch is currently affecting this location.");
  }
}

function updateSevereTakeover(ctx) {
  const takeover = document.getElementById("severeTakeover");
  const warning = (ctx.alerts || []).find(isUrgentWarning);
  const banner = document.getElementById("liveBreakingBanner");

  if (!warning) {
    if (takeover) takeover.hidden = true;
    if (banner) banner.hidden = true;
    return;
  }

  const p = warning.properties || {};
  if (takeover) takeover.hidden = false;
  if (banner) banner.hidden = false;
  setText("severeTakeoverTitle", p.event || "WEATHER WARNING");
  setText("severeTakeoverArea", (p.areaDesc || ctx.cityState || "Current location").split(";")[0]);
  setText("severeTakeoverSafety", getSafetyInstructions(warning));
  setText("graphicAlertTitle", p.event || "WEATHER WARNING");
  setText("graphicAlertArea", (p.areaDesc || ctx.cityState || "Current location").split(";")[0]);
  setText("graphicAlertInstruction", getSafetyInstructions(warning));
}

function selectRadarProduct(product) {
  document.querySelectorAll(".radar-product-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.radarProduct === product);
  });
  document.querySelectorAll(".radar-product-panel").forEach(panel => panel.classList.remove("active"));

  const panels = {radar:"radarProductRadar",spc:"radarProductSpc",tornado:"radarProductTornado"};
  document.getElementById(panels[product])?.classList.add("active");

  if (product === "radar") {
    setTimeout(() => {
      if (window.radarMap?.invalidateSize) window.radarMap.invalidateSize();
    }, 150);
  }
}

function bindRadarProductTabs() {
  document.querySelectorAll(".radar-product-btn").forEach(button => {
    button.addEventListener("click", () => selectRadarProduct(button.dataset.radarProduct));
  });
}

function bindMainViewTabs() {
  document.querySelectorAll(".live-view-btn").forEach(button => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      document.querySelectorAll(".live-view-btn").forEach(b => {
        b.classList.toggle("active", b === button);
        b.setAttribute("aria-selected", String(b === button));
      });
      document.querySelectorAll(".vector-graphic-view").forEach(v => v.classList.remove("active"));
      document.querySelector(`[data-graphic="${view}"]`)?.classList.add("active");
    });
  });
}

function setBroadcastBg({wcode,alerts}) {
  if (!window.setBgMode) return;
  if ((alerts || []).some(a => isTornadoLevel(a.properties?.event || ""))) return window.setBgMode("tornado");
  if ([95,96,99].includes(wcode)) window.setBgMode("storm");
  else if ([71,73,75,77,85,86].includes(wcode)) window.setBgMode("snow");
  else if ([45,48].includes(wcode)) window.setBgMode("fog");
  else if ([51,53,55,61,63,65,80,81,82].includes(wcode)) window.setBgMode("rain");
  else if (wcode === 1) window.setBgMode("partlycloudy");
  else if ([2,3].includes(wcode)) window.setBgMode("cloudy");
  else window.setBgMode("clear");
}

function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  liveVoice =
    voices.find(v => /en-US/i.test(v.lang) && /(David|Daniel|Aaron|Alex|Tom)/i.test(v.name)) ||
    voices.find(v => /en-US/i.test(v.lang)) ||
    voices[0] || null;
}

function startBroadcast() {
  const overlay = document.getElementById("liveStartOverlay");
  if (overlay) overlay.style.display = "none";
  startMusic();
  try { localStorage.setItem("stormvectorLastVisit", String(Date.now())); } catch (_) {}
  if (!liveSegments.length) {
    prepareBroadcast().then(() => speakSegment(0));
  } else {
    speakSegment(0);
  }
}

function replaySegment() { speakSegment(liveSegIdx); }

function toggleMute() {
  liveMuted = !liveMuted;
  const btn = document.getElementById("liveMuteBtn");
  if (liveMuted) {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    stopMusic();
    setLiveBadge("MUTED");
    if (btn) btn.textContent = "RESUME";
  } else {
    setLiveBadge("LIVE");
    if (btn) btn.textContent = "STOP";
    startMusic();
    speakSegment(liveSegIdx);
  }
}

function setLiveBadge(text) {
  const el = document.getElementById("liveBadge");
  if (!el) return;
  el.innerHTML = `<span class="live-dot"></span><span class="live-badge-text">${text}</span>`;
  el.classList.toggle("live-badge-on", text === "LIVE");
  setText("vectorHeaderStatus", text);
}

function speakSegment(i) {
  if (!liveSegments[i]) {
    setLiveBadge("CHECKING WEATHER");
    setTimeout(async () => {
      await prepareBroadcast();
      if (!liveMuted) speakSegment(0);
    }, 60000);
    return;
  }

  liveSegIdx = i;
  setText("liveCaptionText", liveSegments[i]);

  if (liveMuted || !("speechSynthesis" in window)) return;

  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(liveSegments[i]);
  if (liveVoice) utter.voice = liveVoice;
  utter.rate = 1.0;
  utter.pitch = 1.0;

  utter.onstart = () => {
    setLiveBadge("LIVE");
    document.getElementById("liveAvatar")?.classList.add("speaking");
    announce(liveSegments[i]);
  };
  utter.onend = () => {
    document.getElementById("liveAvatar")?.classList.remove("speaking");
    if (!liveMuted) speakSegment(i + 1);
  };
  utter.onerror = () => document.getElementById("liveAvatar")?.classList.remove("speaking");
  speechSynthesis.speak(utter);
}

function announce(msg) {
  const el = document.getElementById("ariaLive");
  if (!el) return;
  el.textContent = "";
  requestAnimationFrame(() => el.textContent = msg);
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    prepareBroadcast();
    return;
  }

  navigator.geolocation.watchPosition(
    async p => {
      const oldLat = liveLat, oldLon = liveLon;
      liveLat = p.coords.latitude;
      liveLon = p.coords.longitude;
      const moved = Math.abs(liveLat-oldLat) > 0.01 || Math.abs(liveLon-oldLon) > 0.01;
      if (moved || !currentWeatherContext) await prepareBroadcast();
    },
    () => prepareBroadcast(),
    {enableHighAccuracy:true, maximumAge:30000, timeout:15000}
  );
}

function returnToMyLocation() {
  startLocationTracking();
}

document.addEventListener("DOMContentLoaded", () => {
  bindRadarProductTabs();
  bindMainViewTabs();
  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = pickVoice;
    pickVoice();
  }
  startLocationTracking();
});

window.addEventListener("beforeunload", () => {
  try { speechSynthesis.cancel(); } catch (_) {}
});
