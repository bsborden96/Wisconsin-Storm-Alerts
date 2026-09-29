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
      setContext(ctx) { currentWeatherContext = ctx; locationReady = true; liveLat = 43.63; liveLon = -88.73; },
      mute() { liveMuted = true; },
      setFetch(fn) { fetchAlerts = fn; },
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
  assert.equal(elements('freshnessAlerts').textContent,'1 ACTIVE');
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
  assert.equal(elements('freshnessAlerts').textContent,'CHECK FAILED');
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
  assert.equal(elements('vectorDecisionTitle').textContent,'No active NWS warning for this location');
  assert.equal(elements('severeTakeover').hidden,true);
});
