const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function app() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        textContent:'', hidden:false, innerHTML:'', pause(){}, play(){return Promise.resolve();},
        classList:{add:x => classes.add(x),remove:x => classes.delete(x),toggle:(x,on) => on ? classes.add(x) : classes.delete(x),contains:x => classes.has(x)}
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    console, Date, setTimeout, clearTimeout,
    document:{getElementById:element,addEventListener(){}},
    window:{addEventListener(){}}
  });
  const source = fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8');
  vm.runInContext(source + `
    globalThis.testApi = {
      setContext(ctx,lat = 43.63,lon = -88.73) { currentWeatherContext = ctx; locationReady = true; liveLat = lat; liveLon = lon; },
      mute() { liveMuted = true; },
      setFetch(fn) { fetchAlerts = fn; },
      switchLocation(lat,lon) { liveLat = lat; liveLon = lon; resetLocationAlertState(); },
      setCheckedAt(date) { lastAlertCheckAt = date; },
      expire: expireOldAlertStatus,
      resume: resumeAlertChecks,
      check: checkForBreakingWeather,
      renderSevere,
      renderSevereCenter
    };`,context);
  return {elements:element,api:context.testApi};
}

test('an unavailable SPC outlook and alert feed never display an all-clear', () => {
  const {elements,api} = app();
  const ctx = {cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:false,spc:null,spcAvailable:false};
  api.setContext(ctx);
  api.renderSevere(ctx);
  api.renderSevereCenter(ctx);
  assert.equal(elements('graphicSpcRisk').textContent,'OUTLOOK UNAVAILABLE');
  assert.equal(elements('severeCenterAlerts').textContent,'UNKNOWN');
  assert.equal(elements('severeCenterThreat').textContent,'UNKNOWN');
  assert.match(elements('severeAlertSummary').textContent,/Unable to verify/);
});

test('muting speech still checks and displays a new tornado warning', async () => {
  const {elements,api} = app();
  const ctx = {cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]};
  const warning = {id:'test-warning',properties:{event:'Tornado Warning',expires:new Date(Date.now()+20*60_000).toISOString()}};
  api.setContext(ctx);
  api.mute();
  api.setFetch(async () => [warning]);
  await api.check();
  assert.equal(elements('vectorThreatStatus').textContent,'WARNING');
  assert.equal(elements('severeCenterAlertName').textContent,'Tornado Warning');
  assert.equal(elements('vectorDecisionTitle').textContent,'Tornado Warning');
  assert.match(elements('vectorDecisionDetail').textContent,/Take shelter now/);
  assert.equal(elements('freshnessAlerts').textContent,'1 ACTIVE · 0 MIN AGO');
  assert.equal(elements('vectorOfficialDetails').hidden,false);
  assert.match(elements('vectorWarningArea').textContent,/Waupun/);
});

test('a failed warning refresh marks every status unknown', async () => {
  const {elements,api} = app();
  const ctx = {cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]};
  api.setContext(ctx);
  api.mute();
  api.setFetch(async () => null);
  await api.check();
  assert.equal(elements('vectorThreatStatus').textContent,'UNKNOWN');
  assert.equal(elements('severeCenterStatus').textContent,'CHECK FAILED');
  assert.equal(elements('freshnessAlerts').textContent,'UNAVAILABLE');
  assert.equal(elements('vectorDecisionTitle').textContent,'Unable to verify current warnings');
});

test('an expired warning clears across the page even while audio is muted', async () => {
  const {elements,api} = app();
  const warning = {id:'old-warning',properties:{event:'Tornado Warning',expires:new Date(Date.now()+20*60_000).toISOString()}};
  const ctx = {cityState:'Waupun, Wisconsin',alerts:[warning],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]};
  api.setContext(ctx);
  api.mute();
  api.setFetch(async () => []);
  await api.check();
  assert.equal(elements('vectorThreatStatus').textContent,'NORMAL');
  assert.equal(elements('severeCenterAlertName').textContent,'No active NWS alert for this location');
  assert.equal(elements('vectorDecisionTitle').textContent,'Your local forecast');
  assert.equal(elements('severeTakeover').hidden,true);
});

test('an old successful check expires without claiming the area is clear', () => {
  const {elements,api} = app();
  const ctx = {cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]};
  api.setContext(ctx);
  api.setCheckedAt(new Date(Date.now()-2*60_000));
  assert.equal(api.expire(),true);
  assert.equal(elements('vectorThreatStatus').textContent,'UNKNOWN');
  assert.equal(elements('vectorDecisionTitle').textContent,'Unable to verify current warnings');
  assert.match(elements('vectorAlertChecked').textContent,/Warnings checked/);
});

test('returning to a visible page checks immediately and shows checking until it resolves', async () => {
  const {elements,api} = app();
  const ctx = {cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]};
  api.setContext(ctx);
  api.setCheckedAt(new Date());
  let resolve;
  api.setFetch(() => new Promise(done => { resolve = done; }));
  const pending = api.resume();
  assert.equal(elements('vectorThreatStatus').textContent,'UNKNOWN');
  assert.equal(elements('vectorDecisionTitle').textContent,'Checking current warnings');
  assert.equal(elements('freshnessAlerts').textContent,'CHECKING');
  resolve([]);
  await pending;
  assert.equal(elements('vectorThreatStatus').textContent,'NORMAL');
  assert.equal(elements('vectorDecisionTitle').textContent,'Your local forecast');
});

test('switching location invalidates an in-flight warning response and checks the new location', async () => {
  const {elements,api} = app();
  api.setContext({cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]});
  api.mute();
  let resolveOld;
  api.setFetch(() => new Promise(done => { resolveOld = done; }));
  const oldCheck = api.check();
  api.switchLocation(44.02,-88.54);
  api.setContext({cityState:'Oshkosh, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]},44.02,-88.54);
  api.setFetch(async () => []);
  await api.check();
  resolveOld([{id:'old-place',properties:{event:'Tornado Warning'}}]);
  await oldCheck;
  assert.equal(elements('vectorThreatStatus').textContent,'NORMAL');
  assert.equal(elements('vectorDecisionTitle').textContent,'Your local forecast');
  assert.match(elements('vectorAlertChecked').textContent,/Warnings checked/);
});

test('warning card presents action, official area, expiry and full NWS wording', async () => {
  const {elements,api} = app();
  api.setContext({cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]});
  api.mute();
  api.setFetch(async () => [{id:'example',properties:{event:'Tornado Warning',areaDesc:'Dodge County',
    headline:'Tornado Warning for Dodge County',description:'A tornado has been observed.',
    instruction:'Move to a basement.',expires:new Date(Date.now()+20*60_000).toISOString()}}]);
  await api.check();
  assert.match(elements('vectorDecisionDetail').textContent,/Take shelter now/);
  assert.match(elements('vectorDecisionDetail').textContent,/valid until/);
  assert.match(elements('vectorWarningArea').textContent,/Dodge County/);
  assert.match(elements('vectorOfficialText').textContent,/A tornado has been observed/);
  assert.equal(elements('vectorOfficialDetails').hidden,false);
});

test('an updated warning and then its expiration refresh the action card', async () => {
  const {elements,api} = app();
  api.setContext({cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]});
  api.mute();
  let description = 'Storm near Waupun.';
  api.setFetch(async () => [{id:'same-warning',properties:{event:'Tornado Warning',areaDesc:'Dodge County',description,
    expires:new Date(Date.now()+20*60_000).toISOString()}}]);
  await api.check();
  description = 'Storm now approaching Waupun.';
  await api.check();
  assert.match(elements('vectorOfficialText').textContent,/now approaching/);
  api.setFetch(async () => []);
  await api.check();
  assert.equal(elements('vectorOfficialDetails').hidden,true);
  assert.equal(elements('vectorDecisionTitle').textContent,'Your local forecast');
});

test('a failed recheck after tab resume stays unknown with the last check time', async () => {
  const {elements,api} = app();
  api.setContext({cityState:'Waupun, Wisconsin',alerts:[],alertsAvailable:true,spc:null,spcAvailable:false,mesoscale:[]});
  api.setCheckedAt(new Date(Date.now()-60_000));
  api.setFetch(async () => null);
  await api.resume();
  assert.equal(elements('vectorThreatStatus').textContent,'UNKNOWN');
  assert.equal(elements('freshnessAlerts').textContent,'UNAVAILABLE');
  assert.match(elements('vectorAlertChecked').textContent,/Warnings checked/);
});
