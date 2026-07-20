/* ════════════════════════════════════════════════
   OUTLOOKS PAGE — depends on shared.js + bg-canvas.js
════════════════════════════════════════════════ */

let olLat = 43, olLon = -88;
let olDays = [];       // computed per-day hazard data
let olSelectedIdx = 0;

const HAZARDS = [
  { key:'tornado', label:'Tornado',        icon:'🌪', unit:'' },
  { key:'wind',     label:'Severe Wind',    icon:'💨', unit:'' },
  { key:'hail',     label:'Hail Potential', icon:'🧊', unit:'' },
  { key:'snow',     label:'Winter / Snow',  icon:'❄️', unit:'' },
];

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
function toggleExpand(el) {
  const isOpen = el.classList.contains('open');
  el.classList.toggle('open', !isOpen);
  el.setAttribute('aria-expanded', String(!isOpen));
}
document.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ') && e.target.matches('.card-expandable')) { e.preventDefault(); toggleExpand(e.target); } });

async function safeFetch(url, { timeout = 10000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) { clearTimeout(t); throw e; }
}

navigator.geolocation.getCurrentPosition(
  p => { olLat = p.coords.latitude; olLon = p.coords.longitude; init(); },
  () => init(),
  { timeout: 8000 }
);

async function init() {
  loadLocationLabel();
  await loadForecast();
  updateDayNight();
  renderAll();
  setTimeout(() => { window.setBgMode(modeForDay(olDays[olSelectedIdx])); }, 50);
}

async function loadLocationLabel() {
  try {
    const res = await safeFetch(`https://api.weather.gov/points/${olLat.toFixed(4)},${olLon.toFixed(4)}`, { timeout:8000 });
    const data = await res.json();
    const city = data.properties?.relativeLocation?.properties?.city || '';
    const state = data.properties?.relativeLocation?.properties?.state || '';
    const el = document.getElementById('olLocationCard');
    if (el) el.innerHTML = `<b>Outlook for</b><span>${city}${city&&state?', ':''}${state}</span>`;
  } catch(e) {
    const el = document.getElementById('olLocationCard');
    if (el) el.textContent = 'Location unavailable';
  }
}

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
function updateDayNight() {
  const now=new Date();
  const h=now.getHours()+now.getMinutes()/60;
  const st=getSunTimes(olLat,olLon);
  let isDay=true,sunProg=0.5,nightProg=0.5;
  if(st.sunrise&&st.sunset){
    isDay=h>=st.sunrise&&h<=st.sunset;
    if(isDay) sunProg=Math.max(0,Math.min(1,(h-st.sunrise)/(st.sunset-st.sunrise)));
    else { const nightLen=(24-st.sunset)+st.sunrise; const nightH=h<st.sunrise?h+(24-st.sunset):h-st.sunset; nightProg=Math.max(0,Math.min(1,nightH/nightLen)); }
  }
  window.setDaytime(isDay,sunProg,nightProg);
}

/* ── FORECAST FETCH + HAZARD COMPUTATION ── */
async function loadForecast() {
  try {
    const url = [
      `https://api.open-meteo.com/v1/forecast?latitude=${olLat}&longitude=${olLon}`,
      `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,windgusts_10m_max,snowfall_sum`,
      `&hourly=cape,lifted_index,wind_speed_10m,wind_gusts_10m,wind_direction_10m,dew_point_2m,precipitation_probability`,
      `&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=7&timezone=auto`,
    ].join('');
    const res = await safeFetch(url, { timeout: 12000 });
    const d = await res.json();

    const days = d.daily.time.length;
    const hourly = d.hourly;
    const hoursPerDay = 24;

    olDays = [];
    for (let i = 0; i < days; i++) {
      const startH = i * hoursPerDay;
      // Afternoon/evening convective window (roughly 11am–9pm local)
      const windowStart = startH + 11, windowEnd = Math.min(startH + 21, hourly.time.length - 1);

      let maxCape = 0, minLi = 8, maxWindGust = 0, maxDew = -99, maxWindSpd = 0, windDegAtMaxCape = 0, maxPrecipProb = 0;
      for (let h = windowStart; h <= windowEnd; h++) {
        if (h >= hourly.time.length) break;
        const cape = hourly.cape?.[h] ?? 0;
        const li = hourly.lifted_index?.[h] ?? 8;
        const wgust = hourly.wind_gusts_10m?.[h] ?? 0;
        const wspd = hourly.wind_speed_10m?.[h] ?? 0;
        const dew = hourly.dew_point_2m?.[h] ?? -99;
        const pprob = hourly.precipitation_probability?.[h] ?? 0;
        if (cape > maxCape) { maxCape = cape; windDegAtMaxCape = hourly.wind_direction_10m?.[h] ?? 180; }
        if (li < minLi) minLi = li;
        if (wgust > maxWindGust) maxWindGust = wgust;
        if (wspd > maxWindSpd) maxWindSpd = wspd;
        if (dew > maxDew) maxDew = dew;
        if (pprob > maxPrecipProb) maxPrecipProb = pprob;
      }
      // Also consider the daily max gust reported directly (covers non-convective wind events)
      const dailyGust = d.daily.windgusts_10m_max?.[i] ?? 0;
      maxWindGust = Math.max(maxWindGust, dailyGust);

      const snowfall = d.daily.snowfall_sum?.[i] ?? 0;
      const minTemp = d.daily.temperature_2m_min?.[i] ?? 40;
      const maxTemp = d.daily.temperature_2m_max?.[i] ?? 60;
      const precipProbDaily = d.daily.precipitation_probability_max?.[i] ?? maxPrecipProb;
      const wcode = d.daily.weathercode?.[i] ?? 0;

      const tTornado = tornadoTier(minLi, maxCape, maxDew, maxWindSpd, windDegAtMaxCape);
      const tWind = windTier(maxWindGust);
      const tHail = hailTier(maxCape, Math.max(maxPrecipProb, precipProbDaily));
      const tSnow = snowTier(snowfall, minTemp);

      olDays.push({
        date: new Date(d.daily.time[i] + 'T12:00:00'),
        wcode, maxCape, minLi, maxWindGust, maxDew, maxWindSpd, snowfall, minTemp, maxTemp,
        precipProb: Math.max(maxPrecipProb, precipProbDaily),
        tiers: { tornado: tTornado, wind: tWind, hail: tHail, snow: tSnow },
      });
    }
    markFooter();
  } catch(e) {
    console.error('Outlook forecast error:', e);
    const grid = document.getElementById('olDayScroll');
    if (grid) grid.innerHTML = '<div class="ol-none" style="color:#ff6060">⚠ Forecast unavailable</div>';
  }
}
function markFooter() {
  const el = document.getElementById('footerTime');
  if (el) el.textContent = `Data: Open-Meteo · Updated ${new Date().toLocaleTimeString()}`;
}

/* ── RENDERING ── */
function dayLabel(date, idx) {
  if (idx === 0) return 'TODAY';
  if (idx === 1) return 'TOMORROW';
  return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
}
function dateSub(date) { return date.toLocaleDateString('en-US', { month:'short', day:'numeric' }); }

function overallTierForDay(day) {
  return Math.max(day.tiers.tornado, day.tiers.wind, day.tiers.hail, day.tiers.snow);
}

function modeForDay(day) {
  if (!day) return 'clear';
  if (day.tiers.tornado >= 2) return 'tornado';
  if (day.tiers.wind >= 2 || day.tiers.hail >= 2) return 'storm';
  if (day.tiers.snow >= 1) return 'snow';
  if ([51,53,55,61,63,65,80,81,82].includes(day.wcode)) return 'rain';
  if ([45,48].includes(day.wcode)) return 'fog';
  if (day.wcode === 1) return 'partlycloudy';
  if ([2,3].includes(day.wcode)) return 'cloudy';
  return 'clear';
}

function renderAll() {
  renderDaySelector();
  renderOverall();
  renderHazardCards();
  renderHeatmap();
}

function renderDaySelector() {
  const el = document.getElementById('olDayScroll');
  if (!el) return;
  if (olDays.length === 0) { el.innerHTML = '<div class="ol-none">No data</div>'; return; }
  el.innerHTML = olDays.map((day, i) => {
    const tier = tierAt(overallTierForDay(day));
    const active = i === olSelectedIdx ? ' active' : '';
    return `<button class="ol-day-chip${active}" style="--chip-color:${tier.color}" role="tab" aria-selected="${i===olSelectedIdx}" onclick="selectDay(${i})">
      <span class="ol-day-name">${dayLabel(day.date, i)}</span>
      <span class="ol-day-date">${dateSub(day.date)}</span>
      <span class="ol-day-dot" style="background:${tier.color}"></span>
    </button>`;
  }).join('');
}

function selectDay(i) {
  olSelectedIdx = i;
  renderAll();
  window.setBgMode(modeForDay(olDays[i]));
}

function renderOverall() {
  const day = olDays[olSelectedIdx];
  const box = document.getElementById('olOverallBox');
  const txt = document.getElementById('olOverallText');
  const why = document.getElementById('olOverallWhy');
  if (!day || !box || !txt || !why) return;
  const tierIdx = overallTierForDay(day);
  const tier = tierAt(tierIdx);
  const classMap = ['risk-low','risk-low','risk-medium','risk-medium','risk-high'];
  box.className = `risk-box ${classMap[tierIdx]}`;
  txt.textContent = `${tier.label.toUpperCase()} — ${dayLabel(day.date, olSelectedIdx)}`;

  const drivers = HAZARDS.filter(h => day.tiers[h.key] === tierIdx && tierIdx > 0).map(h => h.label);
  why.textContent = tierIdx === 0
    ? 'No notable severe or winter hazards expected from current model data.'
    : `Primary driver${drivers.length>1?'s':''}: ${drivers.join(', ') || 'multiple factors'}. High ${Math.round(day.maxTemp)}°F / Low ${Math.round(day.minTemp)}°F · Precip chance ${Math.round(day.precipProb)}%.`;
}

function hazardRationale(key, day) {
  switch(key) {
    case 'tornado': {
      const t = day.tiers.tornado;
      if (t === 0) return `Weak or no rotational potential. LI ${day.minLi.toFixed(1)}, CAPE ${Math.round(day.maxCape)} J/kg.`;
      if (t === 1) return `Marginal setup — some instability (CAPE ${Math.round(day.maxCape)} J/kg) with modest moisture, but limited organized shear.`;
      if (t === 2) return `Favorable ingredients for rotating storms: LI ${day.minLi.toFixed(1)}, CAPE ${Math.round(day.maxCape)} J/kg, dew point ${Math.round(day.maxDew)}°F.`;
      return `Strong instability and shear alignment — organized/discrete supercells with tornado potential are possible. LI ${day.minLi.toFixed(1)}, CAPE ${Math.round(day.maxCape)} J/kg.`;
    }
    case 'wind': {
      const g = Math.round(day.maxWindGust);
      if (day.tiers.wind === 0) return `Peak gusts near ${g} mph — below damaging thresholds.`;
      if (day.tiers.wind === 1) return `Breezy to gusty, peak gusts near ${g} mph. Loose outdoor items may be affected.`;
      if (day.tiers.wind === 2) return `Gusts near ${g} mph — approaching severe thunderstorm criteria (58 mph). Isolated damage possible.`;
      return `Gusts near ${g} mph — damaging wind potential, downed limbs/power lines possible.`;
    }
    case 'hail': {
      if (day.tiers.hail === 0) return `Low instability/precip overlap — hail-producing storms unlikely.`;
      if (day.tiers.hail === 1) return `Some instability (CAPE ${Math.round(day.maxCape)} J/kg) with ${Math.round(day.precipProb)}% precip chance — small hail possible in stronger cells.`;
      if (day.tiers.hail === 2) return `Moderate-to-strong instability with good precip coverage — hail-producing storms plausible.`;
      return `Strong instability (CAPE ${Math.round(day.maxCape)} J/kg) and high precip coverage — larger hail is more likely in any storms that fire.`;
    }
    case 'snow': {
      const s = day.snowfall.toFixed(1);
      if (day.tiers.snow === 0) return `Little to no accumulation expected (${s}" modeled).`;
      if (day.tiers.snow === 1) return `Light accumulation possible (${s}"), or cold enough that any precip could be wintry.`;
      if (day.tiers.snow === 2) return `Accumulating snow likely, around ${s}" modeled — plan for slick roads.`;
      if (day.tiers.snow === 3) return `Significant snowfall modeled, around ${s}" — travel impacts likely.`;
      return `Major winter event modeled, around ${s}" — plan for hazardous travel and possible closures.`;
    }
  }
  return '';
}

function renderHazardCards() {
  const day = olDays[olSelectedIdx];
  const grid = document.getElementById('olHazardGrid');
  if (!day || !grid) return;
  grid.innerHTML = HAZARDS.map(h => {
    const tierIdx = day.tiers[h.key];
    const tier = tierAt(tierIdx);
    const pct = (tierIdx / (RISK_TIERS.length - 1)) * 100;
    return `
      <div class="ol-hazard-card card-expandable" onclick="toggleExpand(this)" role="button" tabindex="0" aria-expanded="false" style="--tier-color:${tier.color}">
        <div class="ol-hazard-head">
          <span class="ol-hazard-icon">${h.icon}</span>
          <div class="ol-hazard-titles">
            <span class="ol-hazard-name">${h.label}</span>
            <span class="ol-hazard-tier">${tier.label}</span>
          </div>
        </div>
        <div class="ol-gauge"><div class="ol-gauge-fill" style="width:${pct}%;background:${tier.color}"></div></div>
        <div class="expand-details">
          <div class="ol-hazard-detail">${hazardRationale(h.key, day)}</div>
        </div>
      </div>`;
  }).join('');
}

function renderHeatmap() {
  const wrap = document.getElementById('olHeatmap');
  const legend = document.getElementById('olLegend');
  if (!wrap) return;
  let html = `<div class="ol-heat-row ol-heat-header"><div class="ol-heat-label"></div>${olDays.map((d,i)=>`<div class="ol-heat-cell-head${i===olSelectedIdx?' active':''}" onclick="selectDay(${i})">${dayLabel(d.date,i).slice(0,3)}</div>`).join('')}</div>`;
  HAZARDS.forEach(h => {
    html += `<div class="ol-heat-row"><div class="ol-heat-label">${h.icon} ${h.label}</div>`;
    olDays.forEach((d, i) => {
      const tier = tierAt(d.tiers[h.key]);
      html += `<div class="ol-heat-cell${i===olSelectedIdx?' active':''}" style="background:${tier.color}${d.tiers[h.key]===0?'33':'cc'}" title="${h.label} — ${dayLabel(d.date,i)}: ${tier.label}" onclick="selectDay(${i})"></div>`;
    });
    html += `</div>`;
  });
  wrap.innerHTML = html;
  if (legend) legend.innerHTML = RISK_TIERS.map(t => `<span class="ol-legend-item"><span class="ol-legend-dot" style="background:${t.color}"></span>${t.label}</span>`).join('');
}

setTimeout(markFooter, 500);