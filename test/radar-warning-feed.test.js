const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
  const nodes=new Map();
  const context=vm.createContext({console,Date,setTimeout,clearTimeout,document:{addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}},window:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../watch-live.js'),'utf8'),context);
  const drawn=[];
  context.layer={clearLayers(){drawn.length=0;},addData(a){drawn.push(a);}};
  vm.runInContext('radarWarningLayer=layer;globalThis.api={filter:activeRadarWarnings,refresh:refreshRadarWarningFeed,draw:updateRadarWarnings};',context);
  return {context,nodes,drawn,api:context.api};
}
function warning(overrides={}){return {id:'warning',geometry:{type:'Polygon',coordinates:[]},properties:{status:'Actual',event:'Tornado Warning',expires:new Date(Date.now()+60000).toISOString(),...overrides}};}
test('warning map excludes expired, test, missing-time and non-polygon alerts',()=>{
  const {api}=setup();
  const features=[warning(),warning({expires:'2020-01-01'}),warning({status:'Test'}),warning({expires:null}),{...warning(),geometry:null}];
  assert.equal(api.filter(features).length,1);
});
test('nationwide warnings are independent of selected-location alerts; failed refresh is unverified',async()=>{
  const {context,nodes,drawn,api}=setup();
  context.feed={features:[warning()]};
  vm.runInContext('currentWeatherContext={alerts:[]};safeFetch=async()=>({json:async()=>feed});',context);
  await api.refresh();
  assert.equal(drawn.length,1);
  assert.match(nodes.get('radarWarningStatus').textContent,/1 active NWS/);
  vm.runInContext('radarWarningsCheckedAt=Date.now()-30000;safeFetch=async()=>{throw new Error("offline")};',context);
  await api.refresh();
  assert.equal(drawn.length,1);
  assert.match(nodes.get('radarWarningStatus').textContent,/UNVERIFIED/);
  vm.runInContext('radarNationalWarnings[0].properties.expires="2020-01-01";',context);
  api.draw();
  assert.equal(drawn.length,0);
});
