const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('full-screen radar escapes the broadcast panel and restores the same map and focus',()=>{
  const nodes=[];
  let focused=null;
  function node(tag){
    const classes=new Set();
    const n={tag,children:[],parentNode:null,hidden:false,open:false,listeners:{},
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
      setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},focus(){focused=this;},
      appendChild(c){detach(c);this.children.push(c);c.parentNode=this;},
      prepend(c){detach(c);this.children.unshift(c);c.parentNode=this;},
      insertBefore(c,b){detach(c);this.children.splice(this.children.indexOf(b),0,c);c.parentNode=this;},
      replaceChild(c,b){detach(c);this.children[this.children.indexOf(b)]=c;c.parentNode=this;b.parentNode=null;},
      showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}};
    nodes.push(n);return n;
  }
  function detach(n){if(n.parentNode){const p=n.parentNode;p.children.splice(p.children.indexOf(n),1);n.parentNode=null;}}
  const body=node('body'),host=node('div'),radar=node('div'),map=node('div'),opener=node('button');
  radar.id='graphicRadar';body.appendChild(host);host.appendChild(radar);radar.appendChild(map);
  const context=vm.createContext({console,setTimeout(){},clearTimeout(){},document:{body,activeElement:opener,
    getElementById:id=>nodes.find(n=>n.id===id),createElement:node,createComment:()=>node('comment'),addEventListener(){}},window:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../watch-live.js'),'utf8')+`
    selectView=()=>{};selectRadarProduct=()=>{};
    globalThis.api={open:openStormVectorRadarFullscreen,close:closeStormVectorRadarFullscreen};`,context);
  context.api.open();
  const dialog=nodes.find(n=>n.id==='svRadarDialog');
  assert.equal(dialog.parentNode,body);
  assert.equal(radar.parentNode,dialog);
  assert.equal(dialog.open,true);
  assert.equal(radar.children.includes(map),true);
  context.api.open();
  assert.equal(host.children.filter(n=>n.tag==='comment').length,1);
  context.api.close();
  assert.equal(radar.parentNode,host);
  assert.equal(focused,opener);
  assert.equal(body.classList.contains('sv-radar-open'),false);
  context.api.open();
  let prevented=false;
  dialog.listeners.cancel({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(dialog.open,false);
  assert.equal(radar.parentNode,host);
  assert.equal(radar.children.includes(map),true);
});
