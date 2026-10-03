const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('radar measure reports straight-line miles and clears its map layer',()=>{
  const labels={};
  const clear={hidden:true};
  const map={removed:0,distance:()=>16093.44,removeLayer(){this.removed++;}};
  const layer={addTo(){return this;}};
  const L={layerGroup:()=>layer,circleMarker:()=>({addTo(){}}),polyline:()=>({addTo(){}})};
  const context=vm.createContext({console,L,window:{addEventListener(){}},document:{getElementById:id=>id==='radarMeasureClearBtn'?clear:null,addEventListener(){}},setTimeout(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8')+`
    radarMap=globalThis.testMap;
    radarMeasureActive=true;
    setText=(id,value)=>{globalThis.testLabels[id]=value};
    globalThis.measure={click:handleRadarMapClick,clear:clearRadarMeasurement};`,Object.assign(context,{testMap:map,testLabels:labels}));
  context.measure.click({latlng:{lat:43.63,lng:-88.73}});
  assert.equal(labels.radarMapReadout,'Tap the destination');
  context.measure.click({latlng:{lat:43.7,lng:-88.8}});
  assert.equal(labels.radarMapReadout,'10 miles straight-line');
  assert.equal(clear.hidden,false);
  context.measure.clear();
  assert.equal(map.removed,1);
  assert.equal(clear.hidden,true);
});
