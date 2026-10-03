const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('NEXRAD motion projects 30 minutes along the given bearing and speed',()=>{
  const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8')+
    '\nglobalThis.project=projectStormTrack;',context);
  const north=context.project(43.63,-88.73,0,60);
  assert.ok(north[0]>44.12 && north[0]<44.14);
  assert.ok(Math.abs(north[1]+88.73)<0.01);
  const east=context.project(43.63,-88.73,90,60);
  assert.ok(Math.abs(east[0]-43.63)<0.01);
  assert.ok(east[1]>-88.05 && east[1]<-88.03);
});
