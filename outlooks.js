/* ════════════════════════════════════════════════
   OUTLOOKS PAGE — depends on shared.js + bg-canvas.js
   Implements the Complete Future Outlooks spec:
   confidence, model agreement, historical context,
   storm chaser mode, predictive search, expandable
   hazard cards, expected timeline, forecast-change
   tracking, and forecast metadata.
════════════════════════════════════════════════ */

let olLat = 43, olLon = -88;
let olDays = [];       // computed per-day hazard data
let olSelectedIdx = 0;
let olMode = localStorage.getItem('outlookMode') === 'chaser' ? 'chaser' : 'simple';
let olHistory = null;  // previous localStorage snapshot for this location
let olLastFetchedAt = null;
const olHistoricalCache = new Map();

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

/* ── Generic expand/collapse for whole cards (kept for parity with Home) ── */
function toggleExpand(el) {
  const isOpen = el.classList.contains('open');
  el.classList.toggle('open', !isOpen);
  el.setAttribute('aria-expanded', String(!isOpen));
}
document.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ') && e.target.matches('.card-expandable')) { e.preventDefault(); toggleExpand(e.target); } });

/* ── Independent per-hazard subsections: Why This Risk? / Technical
   Details / What Should I Do? each open on their own click. ── */
function toggleSub(headEl) {
  const sec = headEl.closest('.ol-subsection');
  if (!sec) return;
  sec.classList.toggle('open');
}

/* ── Compact disclaimer row ── */
function toggleDisclaimer() {
  const row = document.getElementById('olDisclaimerRow');
  if (!row) return;
  const open = row.classList.toggle('open');
  row.setAttribute('aria-expanded', String(open));
}

/* ── Storm Chaser Mode ── */
function setOutlookMode(mode) {
  olMode = mode;
  localStorage.setItem('outlookMode', mode);
  document.getElementById('olModeSimple')?.classList.toggle('active', mode === 'simple');
  document.getElementById('olModeChaser')?.classList.toggle('active', mode === 'chaser');
  renderHazardCards(); // re-render so subsections pick up the new default open state
}

// Left/right arrow keys step through forecast days when focus is anywhere
// in the day selector — makes flipping through the week a lot faster than
// hunting for each tiny chip with a thumb.
document.addEventListener('keydown', e => {
  if (!olDays.length) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const scroller = document.getElementById('olDayScroll');
  if (!scroller || !scroller.contains(document.activeElement)) return;
  e.preventDefault();
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  const next = Math.max(0, Math.min(olDays.length - 1, olSelectedIdx + dir));
  if (next !== olSelectedIdx) { selectDay(next); const chip = scroller.children[next]; if (chip) chip.focus(); }
});

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

/* ── INIT — prefer a remembered in-session search location over
   geolocation, per spec §15 ("remember last searched location during the
   session"). ── */
(function initLocation() {
  let remembered = null;
  try { remembered = JSON.parse(sessionStorage.getItem('outlookLastSearch') || 'null'); } catch(_) {}
  if (remembered && typeof remembered.lat === 'number' && typeof remembered.lon === 'number') {
    olLat = remembered.lat; olLon = remembered.lon;
    init(remembered.label);
  } else {
    navigator.geolocation.getCurrentPosition(
      p => { olLat = p.coords.latitude; olLon = p.coords.longitude; init(); },
      () => init(),
      { timeout: 8000 }
    );
  }
})();

async function init(rememberedLabel) {
  document.getElementById('olModeSimple')?.classList.toggle('active', olMode === 'simple');
  document.getElementById('olModeChaser')?.classList.toggle('active', olMode === 'chaser');
  if (rememberedLabel) {
    const el = document.getElementById('olLocationCard');
    if (el) el.innerHTML = `<b>Outlook for</b><span>${rememberedLabel}</span>`;
  } else {
    loadLocationLabel();
  }
  olHistory = loadOutlookHistory(olLat, olLon);
  await loadForecast();
  updateDayNight();
  renderAll();
  setTimeout(() => { window.setBgMode(modeForDay(olDays[olSelectedIdx])); }, 50);
  saveOutlookHistory(olLat, olLon, olDays);
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
      `&hourly=cape,lifted_index,wind_speed_10m,wind_gusts_10m,wind_direction_10m,dew_point_2m,precipitation_probability,freezing_level_height`,
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
      let peakHourIdx = windowStart, freezingLevelAtPeak = null;
      const windowCapeVals = [], windowLiVals = [];
      for (let h = windowStart; h <= windowEnd; h++) {
        if (h >= hourly.time.length) break;
        const cape = hourly.cape?.[h] ?? 0;
        const li = hourly.lifted_index?.[h] ?? 8;
        const wgust = hourly.wind_gusts_10m?.[h] ?? 0;
        const wspd = hourly.wind_speed_10m?.[h] ?? 0;
        const dew = hourly.dew_point_2m?.[h] ?? -99;
        const pprob = hourly.precipitation_probability?.[h] ?? 0;
        windowCapeVals.push(cape); windowLiVals.push(li);
        if (cape > maxCape) { maxCape = cape; windDegAtMaxCape = hourly.wind_direction_10m?.[h] ?? 180; peakHourIdx = h; freezingLevelAtPeak = hourly.freezing_level_height?.[h] ?? null; }
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

      // Full-day (0-23 local hour) CAPE slice for the Expected Timeline buckets.
      const hourlyCapeDay = [];
      for (let h = startH; h < startH + hoursPerDay; h++) hourlyCapeDay.push(hourly.cape?.[h] ?? 0);

      olDays.push({
        date: new Date(d.daily.time[i] + 'T12:00:00'),
        wcode, maxCape, minLi, maxWindGust, maxDew, maxWindSpd, snowfall, minTemp, maxTemp,
        precipProb: Math.max(maxPrecipProb, precipProbDaily),
        windDegAtMaxCape, freezingLevelAtPeak,
        tiers: { tornado: tTornado, wind: tWind, hail: tHail, snow: tSnow },
        confidence: computeForecastConfidence(windowCapeVals, windowLiVals),
        hourlyCapeDay,
      });
    }
    olLastFetchedAt = new Date();
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
  renderConfidenceAndAgreement();
  renderChangeCard();
  renderOverall();
  renderTimeline();
  renderHazardCards();
  renderHeatmap();
  renderWeekSnapshot();
  renderForecastData();
  loadHistoricalContext(olDays[olSelectedIdx]);
}

// Quick "which day should I actually worry about" summary at the top of the page
function renderWeekSnapshot() {
  const worstEl = document.getElementById('olWorstDay'), bestEl = document.getElementById('olBestDay');
  if (!worstEl || !bestEl || olDays.length === 0) return;
  let worstIdx = 0, bestIdx = 0;
  olDays.forEach((d, i) => {
    if (overallTierForDay(d) > overallTierForDay(olDays[worstIdx])) worstIdx = i;
    if (overallTierForDay(d) < overallTierForDay(olDays[bestIdx])) bestIdx = i;
  });
  const worstDay = olDays[worstIdx], bestDay = olDays[bestIdx];
  const worstTier = tierAt(overallTierForDay(worstDay));
  const bestTier = tierAt(overallTierForDay(bestDay));
  worstEl.textContent = `${dayLabel(worstDay.date, worstIdx)} — ${worstTier.label}`;
  worstEl.style.color = worstTier.color;
  bestEl.textContent = `${dayLabel(bestDay.date, bestIdx)} — ${bestTier.label}`;
  bestEl.style.color = bestTier.color;
}

function renderDaySelector() {
  const el = document.getElementById('olDayScroll');
  if (!el) return;
  if (olDays.length === 0) { el.innerHTML = '<div class="ol-none">No data</div>'; return; }
  el.innerHTML = olDays.map((day, i) => {
    const tier = tierAt(overallTierForDay(day));
    const active = i === olSelectedIdx ? ' active' : '';
    return `<button class="ol-day-chip${active}" role="tab" aria-selected="${i===olSelectedIdx}" onclick="selectDay(${i})">
      <span class="ol-day-name">${dayLabel(day.date, i)}</span>
      <span class="ol-day-date">${dateSub(day.date)}</span>
      <span class="ol-day-dot" style="background:${tier.color}"></span>
    </button>`;
  }).join('');
}

function selectDay(i) {
  olSelectedIdx = i;
  renderConfidenceAndAgreement();
  renderChangeCard();
  renderOverall();
  renderTimeline();
  renderHazardCards();
  renderDaySelector();
  renderHeatmapSelection();
  loadHistoricalContext(olDays[i]);
  window.setBgMode(modeForDay(olDays[i]));
}

/* ── Forecast Confidence + Model Agreement (spec §1, §17) ── */
function renderConfidenceAndAgreement() {
  const day = olDays[olSelectedIdx];
  const confValEl = document.getElementById('olConfValue'), confWhyEl = document.getElementById('olConfWhy');
  const agreeValEl = document.getElementById('olAgreeValue'), agreeWhyEl = document.getElementById('olAgreeWhy');
  if (!day || !confValEl || !agreeValEl) return;

  const conf = day.confidence;
  confValEl.textContent = conf.label;
  confValEl.className = `ol-meta-value ol-conf-${conf.level}`;
  confWhyEl.textContent = conf.why;

  const dateStr = day.date.toISOString().slice(0,10);
  const prevDay = findHistoryDay(olHistory, dateStr);
  const agree = computeModelAgreement(prevDay, day);
  agreeValEl.textContent = agree.label;
  agreeValEl.className = `ol-meta-value ol-agree-${agree.level}`;
  agreeWhyEl.textContent = agree.why;
}

/* ── Why the forecast changed (spec §19) ── */
function renderChangeCard() {
  const card = document.getElementById('olChangeCard');
  if (!card) return;
  const day = olDays[olSelectedIdx];
  if (!day) { card.classList.remove('visible'); return; }
  const dateStr = day.date.toISOString().slice(0,10);
  const prevDay = findHistoryDay(olHistory, dateStr);
  const change = computeForecastChange(prevDay, day);
  if (!change) { card.classList.remove('visible'); return; }
  const prevTier = tierAt(change.prevTierIdx), currTier = tierAt(change.currTierIdx);
  const prevPill = document.getElementById('olChangePrev'), currPill = document.getElementById('olChangeCurr');
  prevPill.textContent = prevTier.label; prevPill.style.background = prevTier.color + '33'; prevPill.style.color = prevTier.color;
  currPill.textContent = currTier.label; currPill.style.background = currTier.color + '33'; currPill.style.color = currTier.color;
  document.getElementById('olChangeWhy').textContent = change.reason;
  const timeEl = document.getElementById('olChangeTime');
  if (timeEl) timeEl.textContent = olHistory?.fetchedAt ? `since ${new Date(olHistory.fetchedAt).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}` : '';
  card.classList.add('visible');
}

function renderOverall() {
  const day = olDays[olSelectedIdx];
  const box = document.getElementById('olOverallBox');
  const txt = document.getElementById('olOverallText');
  const why = document.getElementById('olOverallWhy');
  const threatEl = document.getElementById('olPrimaryThreat');
  if (!day || !box || !txt || !why) return;
  const tierIdx = overallTierForDay(day);
  const tier = tierAt(tierIdx);
  const classMap = ['risk-low','risk-low','risk-medium','risk-medium','risk-high'];
  box.className = `risk-box ${classMap[tierIdx]}`;
  txt.textContent = `${tier.label.toUpperCase()} — ${dayLabel(day.date, olSelectedIdx)}`;

  const drivers = HAZARDS.filter(h => day.tiers[h.key] === tierIdx && tierIdx > 0);
  if (tierIdx === 0) {
    why.textContent = 'No notable severe or winter hazards expected from current model data.';
    if (threatEl) threatEl.textContent = '';
  } else {
    why.textContent = `High ${Math.round(day.maxTemp)}°F / Low ${Math.round(day.minTemp)}°F · Precip chance ${Math.round(day.precipProb)}%.`;
    const primary = drivers[0];
    if (threatEl && primary) threatEl.textContent = `Primary Threat: ${primary.label} — ${HAZARD_PLAIN_LANGUAGE[primary.key]}`;
  }
}

/* ── Expected Timeline (spec §18) ── */
function renderTimeline() {
  const wrap = document.getElementById('olTimeline');
  const day = olDays[olSelectedIdx];
  if (!wrap || !day) return;
  const buckets = computeTimeline(day.hourlyCapeDay);
  if (!buckets) { wrap.innerHTML = ''; return; }
  const statusClass = { 'Quiet':'tl-quiet', 'Storm Development':'tl-build', 'Highest Risk':'tl-peak', 'Storms Weaken':'tl-weaken' };
  wrap.innerHTML = buckets.map(b => `
    <div class="ol-timeline-cell">
      <div class="ol-timeline-time">${b.label}</div>
      <div class="ol-timeline-status ${statusClass[b.status]||''}">${b.status}</div>
    </div>`).join('');
}

/* ── Historical Context (spec §16) ──
   Averages the same calendar date across the past 3 years via Open-Meteo's
   historical archive. Hidden entirely if the data can't be fetched. ── */
async function loadHistoricalContext(day) {
  const card = document.getElementById('olHistoricalCard');
  if (!card) return;
  card.classList.remove('visible');
  if (!day) return;
  const monthDay = `${String(day.date.getMonth()+1).padStart(2,'0')}-${String(day.date.getDate()).padStart(2,'0')}`;
  const cacheKey = `${olLat.toFixed(2)},${olLon.toFixed(2)},${monthDay}`;
  const requestToken = cacheKey + '|' + olSelectedIdx;
  loadHistoricalContext._token = requestToken;
  try {
    let normals = olHistoricalCache.get(cacheKey);
    if (normals === undefined) {
      const years = [1,2,3].map(n => day.date.getFullYear() - n);
      const results = await Promise.all(years.map(y => {
        const dateStr = `${y}-${monthDay}`;
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${olLat}&longitude=${olLon}&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`;
        return safeFetch(url, { timeout: 9000 }).then(r => r.json()).catch(() => null);
      }));
      const maxes=[], precs=[];
      results.forEach(r => {
        const tmax = r?.daily?.temperature_2m_max?.[0];
        const prec = r?.daily?.precipitation_sum?.[0];
        if (typeof tmax === 'number' && !Number.isNaN(tmax)) maxes.push(tmax);
        if (typeof prec === 'number' && !Number.isNaN(prec)) precs.push(prec);
      });
      normals = maxes.length === 0 ? null : {
        avgMax: maxes.reduce((s,v)=>s+v,0) / maxes.length,
        avgPrecip: precs.length ? precs.reduce((s,v)=>s+v,0) / precs.length : null,
        years: maxes.length,
      };
      olHistoricalCache.set(cacheKey, normals);
    }
    // If the user has since switched days/locations, drop this stale response.
    if (loadHistoricalContext._token !== requestToken) return;
    if (!normals) return; // stays hidden — "hide if data isn't available"

    const tempDiff = day.maxTemp - normals.avgMax;
    let tempTxt;
    if (Math.abs(tempDiff) < 3) tempTxt = `Temperatures are near average for this date (~${Math.round(normals.avgMax)}°F typical high).`;
    else if (tempDiff > 0) tempTxt = `Today's high (${Math.round(day.maxTemp)}°F) is running about ${Math.round(tempDiff)}° warmer than the ${normals.years}-year average for this date (~${Math.round(normals.avgMax)}°F).`;
    else tempTxt = `Today's high (${Math.round(day.maxTemp)}°F) is running about ${Math.round(Math.abs(tempDiff))}° cooler than the ${normals.years}-year average for this date (~${Math.round(normals.avgMax)}°F).`;

    let precipTxt = '';
    if (normals.avgPrecip !== null) {
      if (day.precipProb >= 60 && normals.avgPrecip < 0.1) precipTxt = 'Rainfall potential today looks above normal for this date.';
      else if (normals.avgPrecip < 0.02) precipTxt = 'Rainfall is typically minimal on this date.';
      else precipTxt = `A typical year sees about ${normals.avgPrecip.toFixed(2)}" of rain on this date.`;
    }

    document.getElementById('olHistTemp').textContent = tempTxt;
    const precipEl = document.getElementById('olHistPrecip');
    precipEl.textContent = precipTxt;
    precipEl.style.display = precipTxt ? 'block' : 'none';
    card.classList.add('visible');
  } catch(e) {
    card.classList.remove('visible');
  }
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

function hazardQuickFact(key, day) {
  switch(key) {
    case 'tornado': return `LI ${day.minLi.toFixed(1)} · ${Math.round(day.maxCape)} J/kg`;
    case 'wind':     return `Gusts ${Math.round(day.maxWindGust)} mph`;
    case 'hail':     return `${Math.round(day.maxCape)} J/kg · ${Math.round(day.precipProb)}% precip`;
    case 'snow':     return `${day.snowfall.toFixed(1)}" modeled`;
  }
  return '';
}

/* ── Technical Details panel (spec §5) — CAPE / LI / shear / SRH / LCL /
   STP / SCP / PWAT / Freezing Level, hidden behind an expandable by
   default (auto-opened only in Storm Chaser Mode). ── */
function technicalDetailsHTML(day) {
  const { shearScore, srh_proxy } = computeShearIngredients(day.maxWindSpd, day.windDegAtMaxCape);
  const lclM = estimateLCLmeters(day.maxTemp, day.maxDew);
  const pwat = estimatePWATin(day.maxDew);
  const stp = estimateSTP(day.maxCape, day.maxTemp, day.maxDew, day.maxWindSpd, day.windDegAtMaxCape);
  const scp = estimateSCP(day.maxCape, day.maxWindSpd, day.windDegAtMaxCape);
  const fzLevel = day.freezingLevelAtPeak;
  const shearTxt = ['Weak','Weak-Moderate','Moderate','Strong'][Math.min(3, shearScore)];
  const row = (k, v) => `<div class="ol-tech-row"><span class="ol-tech-key">${k}</span><span class="ol-tech-val">${v}</span></div>`;
  return `
    ${row('CAPE', `${Math.round(day.maxCape)} J/kg`)}
    ${row('Lifted Index', `${day.minLi.toFixed(1)}`)}
    ${row('Low-Level Shear (proxy)', shearTxt)}
    ${row('SRH (proxy)', `${Math.round(srh_proxy)} m²/s²`)}
    ${row('LCL Height (est.)', `${lclM} m`)}
    ${row('PWAT (est.)', `${pwat}"`)}
    ${row('STP (proxy)', `${stp}`)}
    ${row('SCP (proxy)', `${scp}`)}
    ${row('Freezing Level', fzLevel != null ? `${Math.round(fzLevel)} m` : 'N/A')}
    <div class="ol-tech-caveat">Shear, SRH, LCL, STP, SCP, and PWAT are surface-based estimates — not the official SPC formulas, since this data source doesn't provide a full vertical profile.</div>
  `;
}

function whatShouldIDoHTML(day) {
  const activeHazards = HAZARDS.filter(h => day.tiers[h.key] > 0);
  if (activeHazards.length === 0) return '<div>No specific action needed — no notable hazards expected today.</div>';
  return activeHazards.map(h => `
    <div style="margin-bottom:8px">
      <div style="font-weight:bold;margin-bottom:3px">${h.icon} ${h.label}</div>
      <ul>${(HAZARD_ACTIONS[h.key]||[]).map(a => `<li>${a}</li>`).join('')}</ul>
    </div>`).join('');
}

function renderHazardCards() {
  const day = olDays[olSelectedIdx];
  const grid = document.getElementById('olHazardGrid');
  if (!day || !grid) return;
  const chaser = olMode === 'chaser';
  grid.innerHTML = HAZARDS.map(h => {
    const tierIdx = day.tiers[h.key];
    const tier = tierAt(tierIdx);
    const pct = (tierIdx / (RISK_TIERS.length - 1)) * 100;
    const concern = tierIdx === 0 ? 'Low concern today.' : tierIdx <= 1 ? 'Worth keeping an eye on.' : 'Stay weather-aware today.';
    return `
      <div class="ol-hazard-card" style="--tier-color:${tier.color}">
        <div class="ol-hazard-head">
          <span class="ol-hazard-icon">${h.icon}</span>
          <div class="ol-hazard-titles">
            <span class="ol-hazard-name">${h.label}</span>
            <span class="ol-hazard-tier">${tier.label}</span>
          </div>
        </div>
        <div class="ol-gauge"><div class="ol-gauge-fill" style="width:${pct}%;background:${tier.color}"></div></div>
        <div class="ol-hazard-plain">${HAZARD_PLAIN_LANGUAGE[h.key]} <strong>${concern}</strong></div>
        <div class="ol-hazard-quick" style="margin-top:6px">${hazardQuickFact(h.key, day)}</div>

        <div class="ol-subsection${chaser?' open':''}">
          <div class="ol-subsection-head" onclick="toggleSub(this)" role="button" tabindex="0" aria-expanded="${chaser}">
            <span>Why This Risk?</span><span class="ol-subsection-chevron">▼</span>
          </div>
          <div class="ol-subsection-body">${whyThisRisk(day)}<br><br>${hazardRationale(h.key, day)}</div>
        </div>

        <div class="ol-subsection${chaser?' open':''}">
          <div class="ol-subsection-head" onclick="toggleSub(this)" role="button" tabindex="0" aria-expanded="${chaser}">
            <span>Technical Details</span><span class="ol-subsection-chevron">▼</span>
          </div>
          <div class="ol-subsection-body">${technicalDetailsHTML(day)}</div>
        </div>

        <div class="ol-subsection${chaser?' open':''}">
          <div class="ol-subsection-head" onclick="toggleSub(this)" role="button" tabindex="0" aria-expanded="${chaser}">
            <span>What Should I Do?</span><span class="ol-subsection-chevron">▼</span>
          </div>
          <div class="ol-subsection-body">${whatShouldIDoHTML(day)}</div>
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
// Lighter-weight version used by selectDay() so flipping through days
// doesn't fully rebuild the heatmap DOM every time.
function renderHeatmapSelection() {
  document.querySelectorAll('.ol-heat-cell-head').forEach((el,i) => el.classList.toggle('active', i===olSelectedIdx));
  const rows = document.querySelectorAll('.ol-heat-row:not(.ol-heat-header)');
  rows.forEach(row => {
    Array.from(row.querySelectorAll('.ol-heat-cell')).forEach((cell,i) => cell.classList.toggle('active', i===olSelectedIdx));
  });
}

/* ── Forecast Data card (spec §8) ── */
function computeModelRunInfo(now) {
  const runHours = [0,6,12,18];
  const utcHour = now.getUTCHours();
  let lastRunUTCHour = 18, daysBack = 0;
  for (let i = runHours.length - 1; i >= 0; i--) {
    if (utcHour >= runHours[i]) { lastRunUTCHour = runHours[i]; break; }
    if (i === 0) { lastRunUTCHour = 18; daysBack = 1; }
  }
  const lastRun = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack, lastRunUTCHour, 0, 0));
  const availabilityDelayMs = 3.5 * 3600 * 1000; // typical processing/ingest delay
  const lastRunAvailable = new Date(lastRun.getTime() + availabilityDelayMs);
  const nextRun = new Date(lastRun.getTime() + 6 * 3600 * 1000);
  const nextRunAvailable = new Date(nextRun.getTime() + availabilityDelayMs);
  return { lastRunAvailable, nextRunAvailable };
}
function renderForecastData() {
  const updatedEl = document.getElementById('olDataUpdated');
  const lastRunEl = document.getElementById('olDataLastRun');
  const nextRunEl = document.getElementById('olDataNextRun');
  if (!updatedEl) return;
  updatedEl.textContent = olLastFetchedAt ? olLastFetchedAt.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '--';
  const { lastRunAvailable, nextRunAvailable } = computeModelRunInfo(new Date());
  const fmt = d => d.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  lastRunEl.textContent = fmt(lastRunAvailable);
  nextRunEl.textContent = fmt(nextRunAvailable);
}

setTimeout(markFooter, 500);

/* ════════════════════════════════════════════
   PREDICTIVE LOCATION SEARCH (spec §15)
   Mirrors the Home page's search experience: debounced Nominatim lookup,
   keyboard + touch support, loading indicator, clear button, friendly
   not-found state, and remembers the last searched location for the
   session so a reload of this tab doesn't snap back to GPS.
════════════════════════════════════════════ */
const olSearchCache = new Map();
let olSearchDebounce;
const olSearchInput = document.getElementById('olSearchInput');
const olSuggestionsEl = document.getElementById('olSearchSuggestions');
const olClearBtn = document.getElementById('olSearchClear');
const olLoadingEl = document.getElementById('olSearchLoading');
const olNotFoundEl = document.getElementById('olSearchNotFound');

function clearOlSearch() {
  if (olSearchInput) olSearchInput.value = '';
  hideOlSuggestions();
  olClearBtn?.classList.remove('visible');
  olNotFoundEl?.classList.remove('visible');
  olSearchInput?.focus();
}
function hideOlSuggestions() {
  if (!olSuggestionsEl) return;
  olSuggestionsEl.innerHTML = '';
  olSuggestionsEl.style.display = 'none';
}

if (olSearchInput) {
  olSearchInput.addEventListener('input', () => {
    olClearBtn?.classList.toggle('visible', olSearchInput.value.length > 0);
    olNotFoundEl?.classList.remove('visible');
    clearTimeout(olSearchDebounce);
    const q = olSearchInput.value.trim();
    if (q.length < 2) { hideOlSuggestions(); olLoadingEl?.classList.remove('visible'); return; }
    olSearchDebounce = setTimeout(async () => {
      if (olSearchCache.has(q)) { renderOlSuggestions(olSearchCache.get(q)); return; }
      olLoadingEl?.classList.add('visible');
      try {
        const res = await safeFetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=20&addressdetails=1`, { timeout:6000 });
        const data = await res.json();
        olSearchCache.set(q, data);
        renderOlSuggestions(data);
      } catch(e) { if (e.name !== 'AbortError') console.warn('Outlook search error:', e); }
      finally { olLoadingEl?.classList.remove('visible'); }
    }, 280);
  });
}
function renderOlSuggestions(data) {
  if (!olSuggestionsEl) return;
  olSuggestionsEl.innerHTML = '';
  if (!data || data.length === 0) {
    olSuggestionsEl.style.display = 'none';
    olNotFoundEl?.classList.add('visible');
    return;
  }
  olNotFoundEl?.classList.remove('visible');
  olSuggestionsEl.style.display = 'block';
  const frag = document.createDocumentFragment();
  data.slice(0,8).forEach(p => {
    if (!p.lat || !p.lon) return;
    const div = document.createElement('div');
    div.textContent = p.display_name; div.setAttribute('role','option'); div.setAttribute('tabindex','0');
    const pick = () => {
      olLat = parseFloat(p.lat); olLon = parseFloat(p.lon);
      if (olSearchInput) olSearchInput.value = p.display_name;
      hideOlSuggestions();
      olClearBtn?.classList.add('visible');
      try { sessionStorage.setItem('outlookLastSearch', JSON.stringify({ lat: olLat, lon: olLon, label: p.display_name })); } catch(_) {}
      olLoadingEl?.classList.add('visible');
      reloadOutlookLocation(p.display_name);
    };
    div.addEventListener('click', pick);
    div.addEventListener('keydown', e => { if(e.key==='Enter') pick(); });
    frag.appendChild(div);
  });
  olSuggestionsEl.appendChild(frag);
}
async function reloadOutlookLocation(label) {
  const el = document.getElementById('olLocationCard');
  if (el) el.innerHTML = `<b>Outlook for</b><span>${label}</span>`;
  olHistory = loadOutlookHistory(olLat, olLon);
  olHistoricalCache.clear();
  olSelectedIdx = 0;
  await loadForecast();
  updateDayNight();
  renderAll();
  window.setBgMode(modeForDay(olDays[olSelectedIdx]));
  saveOutlookHistory(olLat, olLon, olDays);
  olLoadingEl?.classList.remove('visible');
}
document.addEventListener('click', e => { if (!e.target.closest('.search-wrap') && olSuggestionsEl) hideOlSuggestions(); });

/* ── AUTO-REFRESH ──
   Quietly refreshes in the background so a tab left open (or reopened
   later in the day) doesn't show a stale forecast. Also re-saves history
   on every refresh, which is what powers Model Agreement / "Why It
   Changed" across successive loads. ── */
jitteredInterval(async () => {
  const prevSelected = olSelectedIdx;
  const prevHistory = olHistory;
  olHistory = loadOutlookHistory(olLat, olLon);
  await loadForecast();
  olSelectedIdx = Math.min(prevSelected, Math.max(0, olDays.length - 1));
  renderAll();
  window.setBgMode(modeForDay(olDays[olSelectedIdx]));
  saveOutlookHistory(olLat, olLon, olDays);
}, 10 * 60_000, 60_000);
jitteredInterval(() => { updateDayNight(); }, 600_000, 60_000);