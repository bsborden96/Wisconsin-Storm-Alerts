const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('NEXRAD motion projects 30 minutes along the given bearing and speed',()=>{
  const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8')+
    '\nglobalThis.project=projectStormTrack;radarReplayHost="https://tilecache.rainviewer.com";globalThis.frameUrl=radarFrameUrl;',context);
  const north=context.project(43.63,-88.73,0,60);
  assert.ok(north[0]>44.12 && north[0]<44.14);
  assert.ok(Math.abs(north[1]+88.73)<0.01);
  const east=context.project(43.63,-88.73,90,60);
  assert.ok(Math.abs(east[0]-43.63)<0.01);
  assert.ok(east[1]>-88.05 && east[1]<-88.03);
  assert.equal(context.frameUrl({path:'/v2/radar/36a57c2d0624'}),
    'https://tilecache.rainviewer.com/v2/radar/36a57c2d0624/256/{z}/{x}/{y}/2/1_1.png');
});

test('NOAA NoArea placeholder is not presented as an active discussion',()=>{
  const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8')+
    '\nglobalThis.discussion=isRadarDiscussion; globalThis.frameUrl=radarFrameUrl;',context);
  const polygon={type:'Polygon',coordinates:[[[-97.71,39.92],[-97.711,39.92],[-97.711,39.921],[-97.71,39.92]]]};
  assert.equal(context.discussion({properties:{name:'NoArea'},geometry:polygon}),false);
  assert.equal(context.discussion({properties:{name:'MD 0123'},geometry:polygon}),true);
  assert.equal(context.discussion({properties:{name:'MD 0123'},geometry:{type:'Point'}}),false);
  assert.equal(context.frameUrl({site:'MKX',product:'N0S',stamp:'202610032201'}),
    'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::MKX-N0S-202610032201/{z}/{x}/{y}.png');
});

test('discussion toggle filters placeholders and lets an offscreen area be opened',async()=>{
  const nodes=new Map();
  const makeNode=()=>({hidden:false,children:[],classList:{toggle(){}},setAttribute(){},replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);},addEventListener(type,handler){this.handler=handler;}});
  for(const id of ['radarDiscussionsBtn','radarDiscussionsStatus','radarDiscussionList','radarDiscussionsLink']) nodes.set(id,makeNode());
  let added,fit=false,opened=false;
  const bounds={isValid:()=>true,getCenter:()=>[43,-89]};
  const layer={feature:{properties:{name:'MD 0123'}},getBounds:()=>bounds,openPopup(){opened=true;}};
  const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById:id=>nodes.get(id),createElement:makeNode},console,URLSearchParams});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8'),context);
  context.feed={features:[{properties:{name:'NoArea'},geometry:{type:'Polygon'}},{properties:{name:'MD 0123'},geometry:{type:'Polygon'}}]};
  context.fakeLayer={clearLayers(){},addData(features){added=features;},addTo(){},getLayers:()=>[layer]};
  context.fakeMap={getBounds:()=>({intersects:()=>false}),fitBounds(){fit=true;},hasLayer:()=>true};
  vm.runInContext('radarDiscussionsLayer=fakeLayer;radarMap=fakeMap;safeFetch=async()=>({json:async()=>feed});globalThis.toggle=toggleRadarDiscussions;',context);
  await context.toggle();
  assert.equal(added.length,1);
  assert.equal(added[0].properties.name,'MD 0123');
  assert.match(nodes.get('radarDiscussionsStatus').textContent,/outside this view/);
  const button=nodes.get('radarDiscussionList').children[0];
  assert.equal(button.textContent,'VIEW MD 0123');
  button.handler();
  assert.equal(fit,true);assert.equal(opened,true);
});
