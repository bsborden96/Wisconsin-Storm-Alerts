const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function app() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {textContent:'',innerHTML:'',hidden:false,paused:true,
      pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},setAttribute(){},
      classList:{toggle(){},add(){},remove(){}}});
    return elements.get(id);
  };
  const context = vm.createContext({console,Date,setTimeout,clearTimeout,
    document:{getElementById:get,addEventListener(){}},window:{addEventListener(){}},
    speechSynthesis:{cancel(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8')+`
    globalThis.api={timelinePoints,forecastTimeMs,upcomingChanges,localWeatherSummary,spcDescription,updateDecision,
      toggleMute,toggleMusic,startMusic,
      setup(ctx){currentWeatherContext=ctx;liveStarted=true;liveMuted=false;musicMuted=false;},
      state(){return {voiceMuted:liveMuted,musicMuted,playing:!ensureMusic().paused};}};`,context);
  return {api:context.api,get};
}

test('24-hour forecast respects selected-location offset and never duplicates missing slots',()=>{
  const {api}=app();
  const ctx={utcOffsetSeconds:-18000,hourly:{time:['2026-10-03T10:00','2026-10-03T11:00'],temperature_2m:[54,null],weather_code:[0,null]}};
  assert.equal(api.forecastTimeMs(ctx.hourly.time[0],ctx),Date.parse('2026-10-03T15:00Z'));
  const points=api.timelinePoints(ctx,6,Date.parse('2026-10-03T15:00Z'));
  assert.equal(points.length,2);
  assert.equal(points[1].temp,null);
  const midHour=api.timelinePoints(ctx,6,Date.parse('2026-10-03T15:46Z'));
  assert.equal(midHour[0].time,Date.parse('2026-10-03T15:00Z'));
  assert.equal(api.timelinePoints(ctx,24,Date.parse('2026-10-04T15:00Z')).length,0);
});

test('hourly changes distinguish forecast precipitation from storm arrival',()=>{
  const {api}=app();
  const now=Date.now();
  const ctx={hourly:{time:[new Date(now).toISOString(),new Date(now+3600000).toISOString()],weather_code:[0,61],wind_gusts_10m:[5,30],temperature_2m:[65,50]}};
  const copy=api.upcomingChanges(ctx,6);
  assert.match(copy,/Precipitation forecast around/);
  assert.match(copy,/Gusts near 30 mph/);
  assert.match(copy,/fall about 15/);
  assert.doesNotMatch(copy,/storm.*arriv/i);
});

test('local summary yields to warnings and unavailable warning checks',()=>{
  const {api,get}=app();
  const ctx={alertsAvailable:true,alerts:[],tempF:54,forecast:{today:'Sunny. High near 62.',tonight:'Clear. Low near 40.'}};
  api.updateDecision(ctx);
  assert.match(get('vectorDecisionDetail').textContent,/54° now.*Tonight: Clear/);
  ctx.alerts=[{properties:{event:'Tornado Warning',instruction:'Take shelter now.'}}];
  api.updateDecision(ctx);
  assert.equal(get('vectorDecisionTitle').textContent,'Tornado Warning');
  assert.doesNotMatch(get('vectorDecisionDetail').textContent,/Sunny/);
  ctx.alertsAvailable=false;
  api.updateDecision(ctx);
  assert.equal(get('vectorDecisionTitle').textContent,'Unable to verify current warnings');
});

test('voice off leaves music enabled, while music off leaves voice enabled',()=>{
  const {api}=app();
  api.setup({alerts:[],mesoscale:[],spc:null});
  api.startMusic();
  api.toggleMute();
  assert.equal(api.state().voiceMuted,true);
  assert.equal(api.state().musicMuted,false);
  assert.equal(api.state().playing,true);
  api.setup({alerts:[],mesoscale:[],spc:null});
  api.toggleMusic();
  assert.equal(api.state().voiceMuted,false);
  assert.equal(api.state().musicMuted,true);
  assert.equal(api.state().playing,false);
});

test('music stays paused for warnings even when voice is off',()=>{
  const {api}=app();
  api.setup({alerts:[{properties:{event:'Tornado Warning'}}]});
  api.toggleMute();
  api.startMusic();
  assert.equal(api.state().playing,false);
});

test('SPC labels explain official risk and retain unavailable state',()=>{
  const {api}=app();
  assert.equal(api.spcDescription({spcAvailable:true,spc:'SLGT'})[0],'Slight risk');
  assert.equal(api.spcDescription({spcAvailable:false,spc:null})[0],'UNAVAILABLE');
});
