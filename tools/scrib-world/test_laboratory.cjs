const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
function library(){const context={window:{}};vm.runInNewContext(read('public/laboratory.js'),context);return context.window.ScribLaboratory({pageHead:(e,t,s,a='')=>t+s+a,badge:(t)=>t,btn:(a,l)=>l,empty:(t,s,a)=>t+s+a});}

test('Laboratory lists both games and accepts only its two exact game IDs',()=>{
  const lab=library();const list=lab.list();
  assert.match(list,/Juegos para explorar otras maneras de escribir y crear en equipo\./);
  assert.doesNotMatch(list,/Dos juegos/i);
  assert.match(list,/Bolzano/);assert.match(list,/S\+7/);
  assert.match(list,/#experiment\/bolzano/);assert.match(list,/#experiment\/s7/);
  assert.match(lab.detail('bolzano'),/src="\/scrib\/backstage\/laboratory\/bolzano\/"/);
  assert.match(lab.detail('s7'),/clipboard-write/);
  assert.doesNotMatch(lab.detail('<img onerror=alert(1)>'),/<iframe|onerror/);
});
test('background state refreshes never replace a running game iframe',()=>{
  assert.match(read('public/app.js'),/\^#experiment\\\/.*laboratory-viewer iframe.*return;/);
  const html=read('public/index.html');
  assert.match(html,/data-nav="laboratory"/);
  assert.ok(html.indexOf('laboratory.js')<html.indexOf('app.js'));
  for(const page of ['bolzano/index.html','bolzano/musa.html','s7/index.html'])assert.match(read('laboratory/'+page),/backstage\/activity\.js/);
});
test('a single Bolzano musa can submit both seeds, with server acknowledgement between them',()=>{
  const nodes=new Map(),callbacks={},emitted=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',dataset:{},style:{},disabled:false,classList:{add(){},remove(){}},listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}});
    return nodes.get(id);
  };
  const socket={id:'musa-one',on:(event,fn)=>callbacks[event]=fn,emit:(event,data)=>emitted.push({event,data})};
  const context={URLSearchParams,window:{location:{search:'?player=1'},io:()=>socket},document:{body:node('body'),getElementById:node}};
  vm.runInNewContext(read('laboratory/bolzano/js/events.js'),context);
  vm.runInNewContext(read('laboratory/bolzano/js/musa.js'),context);
  const events=context.window.BolzanoEvents;
  const state=received=>callbacks[events.STATE_MUSA]({rol:'semilla_doble',estado:'esperando_semillas',semillasRecibidas:received});
  state({1:false,2:false});
  node('input_palabra').value='mar';node('btn_enviar').listeners.click();
  assert.equal(node('input_palabra').disabled,true);
  // An older state must not unblock a still-pending submission.
  state({1:false,2:false});assert.equal(node('input_palabra').disabled,true);
  state({1:true,2:false});assert.equal(node('input_palabra').disabled,false);
  node('input_palabra').value='cielo';node('btn_enviar').listeners.click();
  assert.deepEqual(emitted.map(x=>[x.event,x.data.posicion,x.data.palabra]),[[events.SUBMIT_SEED,1,'mar'],[events.SUBMIT_SEED,2,'cielo']]);
  state({1:true,2:true});assert.equal(node('input_palabra').disabled,true);
});
