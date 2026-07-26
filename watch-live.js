/* ════════════════════════════════════════════════
   WATCH LIVE — StormVector Meteorologist (Vector)
   Depends on shared.js (loaded first) and bg-canvas.js
   (loaded second) for window.setBgMode/setDaytime and
   the shared helper functions (degToCompass, dewLabel,
   alertPriorityScore, isTornadoLevel, parseMovement, etc).

   MVP scope: this builds one real broadcast script per
   page load from live NWS + Open-Meteo data and speaks it
   with the browser's built-in TTS, with synced captions.
   The AI Producer / Director / multi-segment engine
   described in the vision doc is the natural next step —
   this establishes the page, the nav entry, and a working
   speech + caption pipeline it can plug into.
════════════════════════════════════════════════ */

let liveLat = 43, liveLon = -88;
let liveSegments = [];
let liveSegIdx = 0;
let liveVoice = null;
let liveMuted = false;

function toggleMenu() {
  const panel = document.getElementById('menuPanel'), btn = document.getElementById('menuBtn');
  const open = panel.classList.contains('open');
  panel.classList.toggle('open', !open);
  btn.setAttribute('aria-expanded', String(!open));
}
document.addEventListener('click', e => {
  if (!e.target.closest('#menuPanel') && !e.target.closest('#menuBtn')) {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) { panel.classList.remove('open'); document.getElementById('menuBtn').setAttribute('aria-expanded','false'); }
  }
});

async function safeFetch(url, { timeout = 10000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/geo+json" } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) { clearTimeout(t); throw e; }
}

navigator.geolocation.getCurrentPosition(
  p => { liveLat = p.coords.latitude; liveLon = p.coords.longitude; prepareBroadcast(); },
  () => prepareBroadcast(),
  { timeout: 8000 }
);

function timeAgo(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins===1?'':'s'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs===1?'':'s'} ago`;
  return `${Math.round(hrs/24)} day${Math.round(hrs/24)===1?'':'s'} ago`;
}

async function prepareBroadcast() {
  const locEl = document.getElementById('liveLocationCard');
  let cityState = '', county = '';
  try {
    const res = await safeFetch(`https://api.weather.gov/points/${liveLat.toFixed(4)},${liveLon.toFixed(4)}`, { timeout: 8000 });
    const data = await res.json();
    const city = data.properties?.relativeLocation?.properties?.city || '';
    const state = data.properties?.relativeLocation?.properties?.state || '';
    cityState = `${city}${city&&state?', ':''}${state}`;
    try {
      const cRes = await safeFetch(data.properties.county, { timeout: 6000 });
      const cData = await cRes.json();
      county = cData.properties?.name || '';
    } catch(_) {}
    if (locEl) locEl.innerHTML = `<b>${county ? county+' County' : 'Your Area'}</b><span>${cityState}</span>`;
  } catch(_) {
    if (locEl) locEl.textContent = 'Location unavailable';
  }

  let tempF = null, feelsF = null, windSpd = 0, windDeg = 0, windG = 0, wcode = 0, dewF = null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${liveLat}&longitude=${liveLon}&current=temperature_2m,apparent_temperature,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`;
    const res = await safeFetch(url, { timeout: 10000 });
    const d = await res.json();
    const c = d.current;
    tempF = Math.round(c.temperature_2m); feelsF = Math.round(c.apparent_temperature);
    dewF = Math.round(c.dew_point_2m);
    windSpd = Math.round(c.wind_speed_10m); windDeg = c.wind_direction_10m; windG = Math.round(c.wind_gusts_10m);
    wcode = c.weather_code || 0;
  } catch(_) {}

  let alerts = [];
  try {
    const res = await safeFetch(`https://api.weather.gov/alerts/active?point=${liveLat.toFixed(4)},${liveLon.toFixed(4)}`, { timeout: 10000 });
    const data = await res.json();
    alerts = (data.features || []).sort((a,b) => alertPriorityScore(a.properties?.event||'') - alertPriorityScore(b.properties?.event||''));
  } catch(_) {}

  buildScript({ cityState, tempF, feelsF, windSpd, windDeg, windG, wcode, dewF, alerts });
  renderConditionsRow({ tempF, feelsF, windSpd, windDeg, windG, dewF });
  setBroadcastBg({ wcode, alerts });

  const btn = document.getElementById('liveStartBtn');
  if (btn) { btn.disabled = false; btn.textContent = '▶ Start Broadcast'; }
}

function buildScript({ cityState, tempF, feelsF, windSpd, windDeg, windG, wcode, dewF, alerts }) {
  const segs = [];
  let lastVisit = null;
  try { lastVisit = localStorage.getItem('stormvectorLastVisit'); } catch(_) {}
  const greetName = cityState ? `for ${cityState}` : 'for your area';

  if (lastVisit && Date.now() - parseInt(lastVisit, 10) < 6 * 3600 * 1000) {
    segs.push(`Welcome back. Here's your updated StormVector forecast ${greetName}, current as of right now. Since you last checked in ${timeAgo(Date.now() - parseInt(lastVisit,10))}, here's what's changed.`);
  } else {
    segs.push(`Hi, I'm Vector. Here's your live StormVector forecast ${greetName}.`);
  }

  if (tempF !== null) {
    let tempLine = `Right now it's ${tempF} degrees`;
    if (feelsF !== null && feelsF !== tempF) tempLine += `, feeling like ${feelsF}`;
    tempLine += '.';
    if (windSpd >= 15) tempLine += ` Winds are out of the ${degToCompass(windDeg)} at ${windSpd} miles per hour${windG > windSpd + 5 ? `, gusting to ${windG}` : ''}.`;
    segs.push(tempLine);
  } else {
    segs.push("I'm having trouble reaching live current conditions right now — bear with me.");
  }

  const tornadoAlerts = alerts.filter(a => isTornadoLevel(a.properties?.event || ''));
  if (tornadoAlerts.length > 0) {
    const a = tornadoAlerts[0];
    const mv = parseMovement(a.properties?.description || '');
    segs.push(`This is a StormVector Breaking Weather update. A ${a.properties.event} is in effect for ${(a.properties.areaDesc||'your area').split(';')[0]}.${mv ? ` The storm is moving ${mv.dir} at ${mv.spd} miles per hour.` : ''} Take shelter now if you are in the warned area.`);
  } else if (alerts.length > 0) {
    const a = alerts[0];
    segs.push(`There ${alerts.length===1?'is':'are'} currently ${alerts.length} active weather alert${alerts.length===1?'':'s'} for your area. The highest priority is a ${a.properties.event} covering ${(a.properties.areaDesc||'').split(';')[0]}.`);
  } else {
    segs.push('There are no active weather alerts for your location at this time.');
  }

  if (dewF !== null) {
    if (dewF >= 60) segs.push(`Dew points are running high at ${dewF} degrees, which means plenty of moisture is available if storms fire later.`);
    else if (dewF <= 35) segs.push(`Dew points are low at ${dewF} degrees — expect a dry air mass overall.`);
  }

  segs.push("That's your StormVector update. I'll be back with the latest as conditions change. Stay weather-aware.");
  liveSegments = segs;
  liveSegIdx = 0;
}

function renderConditionsRow({ tempF, feelsF, windSpd, windDeg, windG, dewF }) {
  const el = document.getElementById('liveConditionsRow');
  if (!el) return;
  const chip = (label, val) => `<div class="live-chip"><span class="live-chip-label">${label}</span><span class="live-chip-val">${val}</span></div>`;
  el.innerHTML = [
    tempF !== null ? chip('Temp', `${tempF}°F`) : '',
    feelsF !== null ? chip('Feels', `${feelsF}°F`) : '',
    dewF !== null ? chip('Dew Point', `${dewF}°F`) : '',
    chip('Wind', `${degToCompass(windDeg)} ${windSpd} mph`),
    windG > windSpd + 5 ? chip('Gusts', `${windG} mph`) : '',
  ].join('');
}

function setBroadcastBg({ wcode, alerts }) {
  const hasTornado = alerts.some(a => isTornadoLevel(a.properties?.event || ''));
  if (hasTornado) { window.setBgMode('tornado'); return; }
  if ([95,96,99].includes(wcode)) window.setBgMode('storm');
  else if ([71,73,75,77,85,86].includes(wcode)) window.setBgMode('snow');
  else if ([45,48].includes(wcode)) window.setBgMode('fog');
  else if ([51,53,55,61,63,65,80,81,82].includes(wcode)) window.setBgMode('rain');
  else if (wcode === 1) window.setBgMode('partlycloudy');
  else if ([2,3].includes(wcode)) window.setBgMode('cloudy');
  else window.setBgMode('clear');
}

/* ── SPEECH + CAPTIONS ── */
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  liveVoice = voices.find(v => /en-US/i.test(v.lang) && /Google|Samantha|Alex|Aria|Female/i.test(v.name)) || voices.find(v => /en/i.test(v.lang)) || voices[0] || null;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = pickVoice;
  pickVoice();
}

function startBroadcast() {
  document.getElementById('liveStartOverlay').style.display = 'none';
  try { localStorage.setItem('stormvectorLastVisit', String(Date.now())); } catch(_) {}
  speakSegment(0);
}
function replaySegment() { speakSegment(liveSegIdx); }
function toggleMute() {
  liveMuted = !liveMuted;
  const btn = document.getElementById('liveMuteBtn');
  if (liveMuted) { speechSynthesis.cancel(); setLiveBadge('MUTED'); if (btn) btn.textContent = '🔊 Resume'; }
  else { setLiveBadge('LIVE'); if (btn) btn.textContent = '🔇 Stop'; speakSegment(liveSegIdx); }
}
function setLiveBadge(text) {
  const el = document.getElementById('liveBadge'); if (!el) return;
  el.innerHTML = `<span class="live-dot"></span>${text}`;
  el.classList.toggle('live-badge-on', text === 'LIVE');
}

function speakSegment(i) {
  if (liveMuted || !('speechSynthesis' in window)) {
    const cap = document.getElementById('liveCaptionText');
    if (cap && liveSegments[i]) cap.textContent = liveSegments[i];
    return;
  }
  if (i >= liveSegments.length) { setLiveBadge('STANDBY'); return; }
  liveSegIdx = i;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(liveSegments[i]);
  if (liveVoice) utter.voice = liveVoice;
  utter.rate = 1.0; utter.pitch = 1.0;
  utter.onstart = () => {
    setLiveBadge('LIVE');
    document.getElementById('liveAvatar')?.classList.add('speaking');
    const cap = document.getElementById('liveCaptionText');
    if (cap) cap.textContent = liveSegments[i];
    announce(liveSegments[i]);
  };
  utter.onend = () => {
    document.getElementById('liveAvatar')?.classList.remove('speaking');
    if (!liveMuted) speakSegment(i + 1);
  };
  utter.onerror = () => { document.getElementById('liveAvatar')?.classList.remove('speaking'); };
  speechSynthesis.speak(utter);
}
function announce(msg) {
  const el = document.getElementById('ariaLive'); if (!el) return;
  el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; });
}
window.addEventListener('beforeunload', () => { try { speechSynthesis.cancel(); } catch(_) {} });

/* ── SUN/DAY-NIGHT (same math as Home/Outlooks, kept local + minimal) ── */
function getSunTimes(lat,lon) {
  const now=new Date();
  const JD=Math.floor(now/86400000)+2440587.5;
  const n=Math.round(JD-2451545.0);
  const L=(280.46+0.9856474*n)%360;
  const g=((357.528+0.9856003*n)%360)*Math.PI/180;
  const lambda=L+1.915*Math.sin(g)+0.02*Math.sin(2*g);
  const eps=23.439-0.0000004*n;
  const sinDec=Math.sin(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180);
  const cosDec=Math.sqrt(1-sinDec*sinDec);
  const cosH=(-Math.tan(lat*Math.PI/180)*sinDec/cosDec)-0.01454/(cosDec*Math.cos(lat*Math.PI/180));
  if(cosH>1||cosH<-1)return{sunrise:null,sunset:null};
  const H=Math.acos(cosH)*180/Math.PI;
  const RA=(Math.atan2(Math.cos(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180),Math.cos(lambda*Math.PI/180))*180/Math.PI)/15;
  const transit=12-lon/15+(RA-L/15);
  const tzOff=new Date().getTimezoneOffset()/60;
  return{sunrise:transit-H/15-tzOff,sunset:transit+H/15-tzOff};
}
(function updateDayNight() {
  const now=new Date();
  const h=now.getHours()+now.getMinutes()/60;
  const st=getSunTimes(liveLat,liveLon);
  let isDay=true,sunProg=0.5,nightProg=0.5;
  if(st.sunrise&&st.sunset){
    isDay=h>=st.sunrise&&h<=st.sunset;
    if(isDay) sunProg=Math.max(0,Math.min(1,(h-st.sunrise)/(st.sunset-st.sunrise)));
    else { const nightLen=(24-st.sunset)+st.sunrise; const nightH=h<st.sunrise?h+(24-st.sunset):h-st.sunset; nightProg=Math.max(0,Math.min(1,nightH/nightLen)); }
  }
  window.setDaytime(isDay,sunProg,nightProg);
})();
