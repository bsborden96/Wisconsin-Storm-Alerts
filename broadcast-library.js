/* StormVector spoken briefings. Facts come from NWS alerts/forecasts and
   Open-Meteo conditions; phrase rotation changes delivery, never the facts. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StormVectorBroadcast = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const LIBRARY = {
    hello: [
      'Here is your weather update for {place}.',
      'Let me bring you up to speed on {place}.',
      'Here is what the weather is doing around {place}.',
      'Checking in on the weather for {place}.',
      'I have the latest conditions for {place}.',
      'Let us take a look at what is ahead for {place}.',
      'Here is the picture outside and what comes next for {place}.',
      'Back with an update for {place}.'
    ],
    temperature: [
      'Right now it is {temp} degrees with {sky}.',
      'We are sitting near {temp} degrees under {sky}.',
      'Outside, it is about {temp} degrees and {sky}.',
      'Current temperature is {temp}, with {sky}.',
      'At the moment, expect {sky} and a temperature near {temp}.',
      'The latest reading is {temp} degrees, with {sky}.',
      'It is {temp} degrees around {place}, with {sky}.',
      'For current conditions, it is {temp} degrees and {sky}.'
    ],
    feels: [
      'It feels closer to {feels} degrees, so there is a difference from the thermometer.',
      'The feels-like temperature is {feels} degrees.',
      'On your skin, it feels more like {feels}.',
      'Factoring in the air and wind, it feels like {feels} degrees.',
      'That {temp}-degree reading feels more like {feels} outside.'
    ],
    pleasant: [
      'This is a comfortable stretch to spend some time outside.',
      'Conditions look good for getting outside right now.',
      'It is a pretty pleasant window for outdoor plans.',
      'If you have something to do outside, the current weather looks cooperative.',
      'The weather is giving us a fairly easy stretch at the moment.',
      'For now, the outdoor conditions look comfortable.'
    ],
    wind: [
      'Wind is coming from the {windDirection} at {wind} miles per hour{gusts}.',
      'There is a {wind}-mile-per-hour wind from the {windDirection}{gusts}.',
      'The breeze is out of the {windDirection} at {wind} miles per hour{gusts}.',
      'Expect a {wind}-mile-per-hour wind from the {windDirection}{gusts}.',
      'Wind is running around {wind} miles per hour out of the {windDirection}{gusts}.'
    ],
    currentForecast: [
      'For the next part of the forecast, {forecast}',
      'Looking ahead from here, {forecast}',
      'Here is what the National Weather Service expects next: {forecast}',
      'As the day moves along, {forecast}',
      'The near-term forecast calls for this: {forecast}',
      'For the rest of this forecast period, {forecast}',
      'The forecast from here is: {forecast}',
      'Here is the outlook for the next stretch: {forecast}'
    ],
    tonight: [
      'Tonight, {forecast}',
      'For your evening and overnight hours, {forecast}',
      'Looking toward tonight, {forecast}',
      'If you are heading out later, the nighttime forecast is: {forecast}',
      'Overnight, the National Weather Service expects this: {forecast}',
      'Here is what to expect tonight: {forecast}',
      'As we get into tonight, {forecast}',
      'For tonight in {place}, {forecast}'
    ],
    tomorrow: [
      'Tomorrow, {forecast}',
      'Looking one day ahead, {forecast}',
      'For tomorrow in {place}, {forecast}',
      'The next daytime forecast calls for this: {forecast}',
      'If you are planning ahead for tomorrow, {forecast}',
      'After tonight, {forecast}'
    ],
    changes: [
      'Here is what changed since my last check: {change}',
      'One thing has shifted: {change}',
      'A new detail in the weather is this: {change}',
      'Since the previous update, {change}'
    ],
    calmClose: [
      'I will keep checking for changes.',
      'I am still watching the next forecast update.',
      'That is the latest for now. I will check again shortly.',
      'I will let you know if the weather picture changes.',
      'That is your current weather picture. I will stay on it.',
      'I will be back with the next update.'
    ],
    warningOpen: [
      'National Weather Service {event} for {area}. Take action now.',
      'An active {event} affects {area}. Here is what you need to know.',
      'Warning coverage for {area}: the National Weather Service has issued a {event}.',
      'A {event} is in effect for {area}. Focus on your safety now.',
      'The immediate concern in {area} is a {event}.',
      'This is the latest official {event} for {area}.',
      'Stay with this warning for {area}. It is a {event}.',
      'Urgent update for {area}: a {event} is in effect.'
    ],
    warningContinue: [
      'The {event} for {area} remains the focus of this update.',
      'Here is the latest on the {event} affecting {area}.',
      'Continuing coverage of the {event} for {area}.',
      'Checking the {event} for {area} again.',
      'The National Weather Service {event} for {area} is still our priority.',
      'Another update on the {event} for {area}.',
      'I am staying with the {event} affecting {area}.',
      'Here is the current warning information for {area}.'
    ],
    warningMotion: [
      'The warning reports movement toward the {direction} at {speed} miles per hour.',
      'The storm is moving {direction} at {speed} miles per hour, according to the warning.',
      'Official storm motion is {direction} at {speed} miles per hour.',
      'The reported track is toward the {direction}, moving {speed} miles per hour.',
      'From the warning text, the storm is heading {direction} at {speed} miles per hour.',
      'The National Weather Service places its motion {direction} at {speed} miles per hour.'
    ],
    warningUntil: [
      'The current warning is scheduled to expire at {time}, unless it is updated sooner.',
      'The warning runs until {time} right now. An update could change that.',
      'Its present expiration time is {time}. Keep following the warning until officials clear it.',
      'The National Weather Service currently has this warning in effect until {time}.'
    ],
    arrival: [
      'The warning specifically names {place} around {time}. Do not wait for that clock time to take shelter.',
      'For {place}, the official warning text says around {time}. Take the recommended action now.',
      'The National Weather Service lists {place} around {time}. Conditions can change before then.'
    ],
    noArrival: [
      'The warning does not give a reliable arrival time for {place}. Treat it as a threat now.',
      'There is no specific arrival time for {place} in this warning. Act on the warning now.',
      'I cannot put an exact arrival time on {place} from this warning. Stay in your safe place.'
    ],
    warningClose: [
      'I will keep the warning in focus and check for official updates.',
      'Stay sheltered and keep following National Weather Service updates.',
      'I will report changes to the warning as the official text updates.',
      'Keep your safety plan in place while this warning applies.',
      'I am watching for any change to the warning area, motion, or expiration.'
    ],
    watchOpen: [
      'A {event} is in effect for {area}. This means conditions could support dangerous weather.',
      'Weather watch for {area}: the National Weather Service has a {event} in effect.',
      'I am keeping this {event} front and center for {area}.',
      'The main weather concern in {area} is an active {event}.',
      'Here is the watch situation for {area}: a {event} remains in effect.',
      'A {event} is active for {area}. Stay aware of later warnings.'
    ],
    watchClose: [
      'Keep a way to receive warnings and be ready to act if one is issued.',
      'A watch is a time to be prepared. I will keep checking for an official warning.',
      'Review where you would go if a warning is issued for your location.',
      'Stay weather-aware and keep official alerts enabled.',
      'I will watch for changes in the watch area and any new warnings.'
    ]
  };

  function pick(group, loop = 0) {
    const lines = LIBRARY[group] || [];
    return lines.length ? lines[Math.abs(loop) % lines.length] : '';
  }

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')
      .replace(/\s+/g, ' ').trim();
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function sentence(text) {
    const value = clean(text);
    return value && !/[.!?]$/.test(value) ? `${value}.` : value;
  }

  function sky(code) {
    const c = Number(code);
    if (c === 0) return 'clear skies';
    if (c === 1) return 'mostly clear skies';
    if (c === 2) return 'partly cloudy skies';
    if (c === 3) return 'cloudy skies';
    if ([45,48].includes(c)) return 'foggy conditions';
    if ([51,53,55].includes(c)) return 'drizzle';
    if ([61,63,65,80,81,82].includes(c)) return 'rain';
    if ([71,73,75,77,85,86].includes(c)) return 'snow';
    if ([95,96,99].includes(c)) return 'thunderstorms';
    return null;
  }

  function compass(degrees) {
    if (!Number.isFinite(Number(degrees))) return null;
    const names = ['north','northeast','east','southeast','south','southwest','west','northwest'];
    return names[Math.round((((Number(degrees) % 360) + 360) % 360) / 45) % 8];
  }

  function normalSegments(ctx, {loop = 0, changes = []} = {}) {
    const place = ctx.cityState || 'your area';
    const values = {place,temp:ctx.tempF,feels:ctx.feelsF,sky:sky(ctx.wcode)};
    const lines = [fill(pick('hello',loop),values)];
    if (ctx.tempF != null) {
      const current = values.sky
        ? fill(pick('temperature',loop+2),values)
        : `Right now it is ${ctx.tempF} degrees in ${place}.`;
      lines.push(current);
    } else if (values.sky) {
      lines.push(`Current conditions include ${values.sky}.`);
    }
    if (ctx.feelsF != null && ctx.tempF != null && Math.abs(ctx.feelsF-ctx.tempF) >= 4) {
      lines.push(fill(pick('feels',loop+1),values));
    }
    if (values.sky && [0,1,2].includes(Number(ctx.wcode)) &&
        ctx.tempF >= 60 && ctx.tempF <= 82 && (ctx.windSpd ?? 0) < 15 &&
        !(ctx.alerts || []).length && ctx.alertsAvailable !== false) {
      lines.push(pick('pleasant',loop+3));
    }
    if (ctx.windSpd >= 12 || ctx.windG >= 20) {
      const direction = compass(ctx.windDeg);
      values.wind = ctx.windSpd;
      values.windDirection = direction;
      values.gusts = ctx.windG > ctx.windSpd + 5 ? `, gusting near ${ctx.windG}` : '';
      lines.push(direction ? fill(pick('wind',loop),values)
        : `Wind is near ${ctx.windSpd} miles per hour${values.gusts}.`);
    }

    // Do not read every NWS period on every short loop. Rotate the topics.
    const periods = [
      ['currentForecast',ctx.forecast?.today],
      ['tonight',ctx.forecast?.tonight],
      ['tomorrow',ctx.forecast?.tomorrow]
    ].filter(([,text]) => clean(text));
    if (periods.length) {
      const [topic,forecast] = periods[loop % periods.length];
      lines.push(sentence(fill(pick(topic,loop),{place,forecast:clean(forecast)})));
      if (periods.length > 1 && loop === 0) {
        const [nextTopic,nextForecast] = periods[1];
        if (nextTopic !== topic) lines.push(sentence(fill(pick(nextTopic,loop+1),{place,forecast:clean(nextForecast)})));
      }
    }
    const meaningful = changes.filter(c => c?.important && clean(c.text));
    if (meaningful.length) lines.push(fill(pick('changes',loop),{change:sentence(meaningful[0].text)}));
    if (ctx.alertsAvailable === false) lines.push('The National Weather Service alert feed is unavailable right now. I cannot confirm the current alert status.');
    lines.push(pick('calmClose',loop));
    return lines.filter(Boolean);
  }

  function movementFromAlert(alert) {
    const text = String(alert?.properties?.description || '');
    const match = text.match(/\bmoving\s+(north(?:east|west)?|south(?:east|west)?|east|west|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|NW|SE|SW|N|E|S|W)\s+at\s+(\d{1,3})\s*(?:mph|miles per hour)\b/i);
    if (!match) return null;
    const abbreviations = {N:'north',NE:'northeast',E:'east',SE:'southeast',S:'south',SW:'southwest',W:'west',NW:'northwest',NNE:'north-northeast',ENE:'east-northeast',ESE:'east-southeast',SSE:'south-southeast',SSW:'south-southwest',WSW:'west-southwest',WNW:'west-northwest',NNW:'north-northwest'};
    const speed = Number(match[2]);
    if (!Number.isFinite(speed) || speed > 150) return null;
    return {direction:abbreviations[match[1].toUpperCase()] || match[1].toLowerCase(),speed};
  }

  function officialArrival(alert, place) {
    const city = clean(place).split(',')[0];
    if (!city || city.length < 3 || city.toLowerCase() === 'your area') return null;
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const text = String(alert?.properties?.description || '');
    // NWS warning text sometimes lists "Waupun around 3:45 PM". Never
    // calculate an ETA from polygon, heading, or speed alone.
    const match = text.match(new RegExp(`\\b${escaped}\\s+(?:around|by|at)\\s+(\\d{1,4}(?::\\d{2})?)\\s*(AM|PM)\\b`,'i'));
    if (!match) return null;
    let hour = match[1], minute = '00';
    if (hour.includes(':')) [hour,minute] = hour.split(':');
    else if (hour.length >= 3) { minute = hour.slice(-2); hour = hour.slice(0,-2); }
    if (+hour < 1 || +hour > 12 || +minute > 59) return null;
    return `${+hour}:${minute} ${match[2].toUpperCase()}`;
  }

  function clock(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime())
      ? date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : null;
  }

  function hazard(alert) {
    const p = alert?.properties || {};
    const parts = [];
    const wind = p.parameters?.maxWindGust?.[0];
    const hail = p.parameters?.maxHailSize?.[0];
    if (/^\d{1,3}\s*(?:mph)?$/i.test(String(wind || '').trim())) parts.push(`wind gusts up to ${String(wind).trim().replace(/\s*mph$/i,'')} miles per hour`);
    if (/^\d+(?:\.\d+)?\s*(?:in|inches)?$/i.test(String(hail || '').trim())) parts.push(`hail up to ${String(hail).trim().replace(/\s*(?:in|inches)$/i,'')} inches`);
    if (parts.length) return `The warning lists ${parts.join(' and ')}.`;
    const description = String(p.description || '');
    const line = description.match(/(?:^|\n)\s*\*?\s*HAZARD\.{2,}\s*([^\n]+)/i)?.[1];
    return line ? sentence(`The warning describes ${clean(line).slice(0,150).toLowerCase()}`) : null;
  }

  function watchSegments(ctx, alert, {loop = 0} = {}) {
    const p = alert?.properties || {};
    const values = {event:p.event || 'weather watch',area:clean(p.areaDesc).split(';')[0] || ctx.cityState || 'your area'};
    const lines = [fill(pick('watchOpen',loop),values)];
    const expires = clock(p.ends || p.expires);
    if (expires) lines.push(`The watch is currently scheduled through ${expires}, unless the National Weather Service changes it.`);
    if (ctx.alertsAvailable === false) lines.push('The alert feed is unavailable, so I cannot verify whether this watch has changed.');
    lines.push(pick('watchClose',loop));
    return lines;
  }

  function severeSegments(ctx, alert, {loop = 0, safety = ''} = {}) {
    const p = alert?.properties || {};
    const place = ctx.cityState || 'your location';
    const area = clean(p.areaDesc).split(';')[0] || place;
    const values = {event:p.event || 'weather warning',area,place};
    const lines = [fill(pick(loop ? 'warningContinue' : 'warningOpen',loop),values)];
    if (ctx.alertsAvailable === false) {
      lines.push('The alert feed is temporarily unavailable. This is the last warning I received; I cannot confirm a newer update. Keep following official warning channels.');
    }
    const arrival = officialArrival(alert,place);
    const motion = movementFromAlert(alert);
    if (arrival) lines.push(fill(pick('arrival',loop),{place,time:arrival}));
    else if (loop % 2 === 0) lines.push(fill(pick('noArrival',loop),{place}));
    if (motion) lines.push(fill(pick('warningMotion',loop),motion));
    const impacts = hazard(alert);
    if (impacts) lines.push(impacts);
    const expires = clock(p.ends || p.expires);
    if (expires) lines.push(fill(pick('warningUntil',loop),{time:expires}));
    if (safety) lines.push(sentence(clean(safety)));
    lines.push(pick('warningClose',loop));
    return lines.filter(Boolean);
  }

  return {LIBRARY,normalSegments,watchSegments,severeSegments,movementFromAlert,officialArrival};
});
