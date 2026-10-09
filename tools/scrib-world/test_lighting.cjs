const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const defaults=()=>JSON.parse(read('lighting_plan.json'));
function setup() {
  const calls=[],toasts=[],nodes={},state={lightingDefaults:defaults(),items:[{kind:'event',id:'leon',title:'León <7 noviembre>',start:'2026-11-07'}]};
  let updates=0,answer=true,saveReply=null,refreshError=false;
  const element=()=>({innerHTML:'',textContent:'',dataset:{},querySelectorAll:()=>[],querySelector:()=>null});
  for(const id of ['.lighting-workspace','#lighting-svg','#lighting-elements','#lighting-inspector','#lighting-inspector h2','#lighting-intensity','#lighting-status'])nodes[id]=element();
  const context={window:{confirm:()=>answer},document:{querySelector:s=>nodes[s]||null},crypto:{randomUUID:()=> 'test-request-identifier-unique'}};
  vm.createContext(context);vm.runInContext(read('public/lighting.js'),context);
  const app=context.window.ScribLighting({state:()=>state,
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    btn:(action,label)=>`<button data-action="${action}">${label}</button>`,pageHead:(_,title,sub,actions)=>`<h1>${title}</h1><p>${sub}</p>${actions||''}`,
    request:async(url,data)=>{calls.push({url,data});if(saveReply instanceof Error)throw saveReply;return saveReply || {item:{id:'lighting-'+(data.eventId||'base'),kind:'lighting',eventId:data.eventId,version:data.version+1,...JSON.parse(JSON.stringify(data.plan))}};},
    toast:m=>toasts.push(m),refresh:async()=>{if(refreshError)throw new Error('offline');},renderPage:()=>{updates++;}});
  return {app,state,nodes,calls,toasts,setAnswer:v=>{answer=v;},setReply:v=>{saveReply=v;},setRefreshError:()=>{refreshError=true;},updates:()=>updates};
}
const action=(app,a,id='')=>app.action({dataset:{action:a,id}});
test('complete stage with blue/red streets, tables, screen, presenter and frontals is safe and responsive',()=>{
  const {app}=setup(),html=app.render();
  for(const id of defaults().elements.map(e=>e.id))assert.ok(html.includes(`data-lighting-node="${id}"`));
  assert.match(html,/Vista desde el público/);assert.match(html,/no está a escala/);assert.doesNotMatch(html,/no controla focos reales/);assert.match(html,/data-action="lighting-pdf"/);
  assert.match(html,/León &lt;7 noviembre&gt;/);assert.match(html,/role="button" aria-pressed="true"/);
  assert.match(read('public/lighting.css'),/grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(html,/style="|on(?:click|change|input)=/);assert.doesNotMatch(read('public/lighting.css'),/animation:|filter:blur/);
});
test('typing and sliders redraw the diagram without replacing the input pane',async()=>{
  const {app,nodes,calls}=setup();app.render();nodes['#lighting-inspector'].innerHTML='CARET AND DRAFT';
  assert.ok(app.input({dataset:{lightingField:'label'},value:'Calle <azul>'}));
  assert.equal(nodes['#lighting-inspector'].innerHTML,'CARET AND DRAFT');assert.match(nodes['#lighting-svg'].innerHTML,/Calle &lt;azul&gt;/);
  app.input({dataset:{lightingField:'intensity'},value:'42'});assert.equal(nodes['#lighting-intensity'].textContent,'42%');
  assert.ok(app.hasDraft());await action(app,'lighting-save');
  assert.equal(calls[0].data.plan.elements[0].intensity,42);assert.equal(calls[0].data.plan.elements[0].label,'Calle <azul>');
});
test('selecting previews never writes until explicitly saved and does not hide furniture',async()=>{
  const {app,calls}=setup();app.render();await action(app,'lighting-cue','red');assert.equal(calls.length,0);
  await action(app,'lighting-save');const plan=calls[0].data.plan;
  assert.ok(plan.elements.find(e=>e.id==='red-street').enabled);assert.ok(!plan.elements.find(e=>e.id==='blue-street').enabled);
  assert.ok(plan.elements.filter(e=>['desk','screen'].includes(e.type)).every(e=>e.enabled));
});
test('scope switch asks before discarding dirty edits and new bolo starts from saved base',async()=>{
  const {app,state,setAnswer,calls}=setup();
  const base=defaults();base.elements[0].intensity=33;state.items.push({kind:'lighting',id:'lighting-base',eventId:'',version:2,...base});
  app.render();app.input({dataset:{lightingField:'intensity'},value:'40'});setAnswer(false);
  const chooser={id:'lighting-scope',value:'leon'};await app.changeScope(chooser);assert.equal(chooser.value,'');
  setAnswer(true);chooser.value='leon';await app.changeScope(chooser);await action(app,'lighting-save');
  assert.equal(calls[0].data.eventId,'leon');assert.equal(calls[0].data.version,0);assert.equal(calls[0].data.plan.elements[0].intensity,33);
  assert.equal(state.items.find(e=>e.id==='lighting-base').elements[0].intensity,33);
});
test('background changes cannot overwrite a draft and conflict retains it',async()=>{
  const {app,state,setReply,calls,toasts}=setup();app.render();app.input({id:'lighting-notes',value:'Keep this draft'});
  state.items.push({id:'lighting-base',kind:'lighting',eventId:'',version:4,...defaults(),notes:'Other person'});
  assert.match(app.render(),/Keep this draft/);
  const conflict=new Error('Otra persona ha actualizado');conflict.status=409;setReply(conflict);
  await action(app,'lighting-save');assert.ok(app.hasDraft());assert.equal(calls[0].data.version,0);
  assert.match(app.render(),/Keep this draft/);assert.match(toasts.at(-1),/tu plano sigue aquí/);
});
test('lost reply retries exactly once with same payload and token, successful save ends dirty state',async()=>{
  const {app,setReply,calls}=setup();app.render();app.input({id:'lighting-notes',value:'Saved note'});setReply(new Error('offline'));
  await action(app,'lighting-save');assert.ok(app.hasDraft());setReply(null);await action(app,'lighting-save');
  assert.equal(JSON.stringify(calls[0].data),JSON.stringify(calls[1].data));assert.ok(!app.hasDraft());
  assert.match(app.render(),/Plano guardado · v1/);assert.doesNotMatch(app.render(),/Guardando…/);
});
test('positions clamp inside the canvas and empty labels cannot be saved',async()=>{
  const {app,calls,toasts}=setup();app.render();await action(app,'lighting-select','screen');
  app.input({dataset:{lightingField:'x'},value:'999'});app.input({dataset:{lightingField:'y'},value:'-999'});
  await action(app,'lighting-save');const screen=calls[0].data.plan.elements.find(e=>e.id==='screen');assert.equal(screen.x,80);assert.equal(screen.y,10);
  app.input({dataset:{lightingField:'label'},value:' '});await action(app,'lighting-save');assert.equal(calls.length,1);assert.match(toasts.at(-1),/Pon un nombre/);
});
test('keyboard moves selected element and invalid targets do nothing',async()=>{
  const {app,calls}=setup();app.render();let prevented=0;
  const event={target:{closest:()=>({dataset:{lightingNode:'blue-street'}})},key:'ArrowRight',shiftKey:true,preventDefault:()=>{prevented++;}};
  app.keydown(event);await action(app,'lighting-save');assert.equal(calls[0].data.plan.elements[0].x,15);assert.equal(prevented,1);
  assert.equal(app.input({id:'unrelated',dataset:{},value:''}),false);
});
test('drag keeps grab offset, ignores other pointers and safely releases capture before redraw',async()=>{
  const {app,calls,nodes}=setup();app.render();
  const captures=new Set(),attrs={},beam={innerHTML:''};let prevented=0,releases=0;
  const node={dataset:{lightingNode:'blue-street'},closest:()=>svg,setAttribute:(name,value)=>{attrs[name]=value;}};
  const svg={getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}}),
    setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),
    releasePointerCapture:id=>{captures.delete(id);releases++;app.pointerUp({pointerId:id});},
    querySelector:selector=>selector==='.lumi-beams'?beam:node};
  const event=(x,y,pointerId=7)=>({target:{closest:()=>node},button:0,pointerId,clientX:x,clientY:y,preventDefault:()=>{prevented++;}});
  app.pointerDown(event(200,370));assert.ok(captures.has(7));
  app.pointerMove(event(202,371));assert.equal(attrs.transform,undefined);assert.ok(app.hasDraft());
  app.pointerMove(event(280,420,99));assert.equal(attrs.transform,undefined);
  app.pointerMove(event(280,420));assert.equal(attrs.transform,'translate(260,410)');assert.ok(beam.innerHTML.includes('<polygon'));
  app.pointerUp(event(280,420));assert.equal(releases,1);assert.equal(captures.size,0);assert.match(nodes['#lighting-svg'].innerHTML,/translate\(260,410\)/);
  app.pointerMove(event(999,999));await action(app,'lighting-save');
  assert.equal(calls[0].data.plan.elements[0].x,20);assert.equal(calls[0].data.plan.elements[0].y,62);assert.equal(prevented,2);
});
test('tap is not an edit and dragging beyond the stage clamps without losing the element',async()=>{
  const {app,calls}=setup();app.render();const captures=new Set();
  const node={dataset:{lightingNode:'screen'},closest:()=>svg,setAttribute:()=>{}};
  const svg={getScreenCTM:()=>({inverse:()=>({})}),createSVGPoint:()=>({matrixTransform(){return {x:this.x,y:this.y};}}),
    setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),querySelector:()=>null};
  const event=(x,y)=>({target:{closest:()=>node},button:0,pointerId:1,clientX:x,clientY:y,preventDefault:()=>{}});
  app.pointerDown(event(500,160));app.pointerUp(event(500,160));assert.ok(!app.hasDraft());
  app.pointerDown(event(500,160));app.pointerMove(event(99999,-99999));app.pointerUp(event(99999,-99999));await action(app,'lighting-save');
  const screen=calls[0].data.plan.elements.find(e=>e.id==='screen');assert.equal(screen.x,80);assert.equal(screen.y,10);
});
test('successful save plus failed refresh remains a confirmed save with an offline warning',async()=>{
  const {app,toasts,setRefreshError}=setup();app.render();setRefreshError();await action(app,'lighting-save');
  assert.ok(!app.hasDraft());assert.match(toasts.at(-1),/Plano guardado.*pendiente de conexión/);
});
test('checklist and cable notes preserve caret and persist with the full topology',async()=>{
  const {app,calls,nodes}=setup();const html=app.render();
  for(const id of ['blue-monitor','red-monitor','game-computer','sound-computer','dmx-desk','actors-blue','actors-red'])assert.ok(html.includes(`data-lighting-node="${id}"`));
  assert.match(html,/Walkies · cuatro unidades/);assert.match(html,/Checklist de montaje técnico/);
  assert.ok(app.input({dataset:{lightingCheck:'room'},checked:true}));
  assert.ok(app.input({dataset:{connectionNotes:'hdmi-projector'},value:'15 m'}));
  await action(app,'lighting-save');
  assert.equal(calls[0].data.plan.checklist[0].done,true);assert.equal(calls[0].data.plan.connections[0].notes,'15 m');
  assert.match(app.render(),/value="15 m"/);assert.match(app.render(),/data-lighting-check="room"[^>]*checked/);
});
test('old seven-node plan upgrades and a new bolo resets the base checklist only',async()=>{
  const {app,state,calls}=setup();const base=defaults();base.checklist[0].done=true;
  base.elements=base.elements.slice(0,7);base.elements[0].x=18;
  state.items.push({kind:'lighting',id:'lighting-base',eventId:'',version:3,...base});
  assert.match(app.render(),/blue-monitor/);
  await app.changeScope({id:'lighting-scope',value:'leon'});await action(app,'lighting-save');
  assert.equal(calls[0].data.plan.elements.length,28);assert.equal(calls[0].data.plan.elements[0].x,18);
  assert.ok(calls[0].data.plan.checklist.every(c=>!c.done));assert.equal(base.checklist[0].done,true);
});
test('diagram shows correct video, controller, speaker endpoints and no redundant color words',async()=>{
  const {app}=setup();const html=app.render();assert.match(html,/<h1>Técnica<\/h1>/);
  for(const id of ['game-controller','video-card','video-psu','left-speaker','right-speaker'])assert.match(html,new RegExp('data-lighting-node="'+id+'"'));
  assert.match(html,/data-from="video-card" data-to="splitter"/);assert.match(html,/data-from="splitter" data-to="blue-monitor"/);
  await action(app,'lighting-cables','data');assert.match(app.render(),/PC · tarjeta · mando/);
  const labels=[...html.matchAll(/class="lumi-node-label"[^>]*>([^<]+)</g)].map(m=>m[1]);
  assert.ok(labels.includes('Calle'));assert.ok(labels.includes('Mesa · escritxr'));assert.ok(!labels.some(l=>/azul|rojo|roja/i.test(l)));
  assert.match(html,/data-lighting-node="blue-power"/);assert.doesNotMatch(html,/m5-16-13 20h10/);
});
test('undo and redo restore a whole cue, checklist, positions and connection notes without writes',async()=>{
  const {app,calls}=setup();app.render();await action(app,'lighting-cue','black');
  app.input({dataset:{lightingCheck:'room'},checked:true});
  app.input({dataset:{connectionNotes:'hdmi-projector'},value:'Cable 20m'});
  app.input({dataset:{lightingField:'x'},value:'24'});
  for(let i=0;i<4;i++)await action(app,'lighting-undo');assert.ok(!app.hasDraft());assert.equal(calls.length,0);
  for(let i=0;i<4;i++)await action(app,'lighting-redo');await action(app,'lighting-save');
  const plan=calls[0].data.plan;assert.equal(plan.elements[0].x,24);assert.ok(plan.checklist[0].done);
  assert.equal(plan.connections[0].notes,'Cable 20m');assert.ok(plan.elements.filter(e=>['street','spot','front'].includes(e.type)).every(e=>!e.enabled));
});
test('continuous field edits group until blur, new edits invalidate redo and saving keeps undo',async()=>{
  const {app,calls}=setup();app.render();const node={dataset:{lightingField:'label'},value:'C'};
  app.input(node);node.value='Calle nueva';app.input(node);
  await action(app,'lighting-undo');assert.ok(!app.hasDraft());await action(app,'lighting-redo');
  await action(app,'lighting-save');assert.ok(!app.hasDraft());await action(app,'lighting-undo');assert.ok(app.hasDraft());
  assert.match(app.render(),/value="Calle azul"/);await action(app,'lighting-redo');assert.ok(!app.hasDraft());
  app.focusout({target:{matches:()=>true}});node.value='Otra';app.input(node);await action(app,'lighting-undo');
  app.input({id:'lighting-notes',value:'Edición después de deshacer'});await action(app,'lighting-redo');
  assert.doesNotMatch(app.render(),/value="Otra"/);await action(app,'lighting-save');assert.equal(calls[1].data.plan.elements[0].label,'Calle nueva');
});
test('Ctrl/Cmd undo, Shift-Z and Y redo work on the plan but never steal native field undo',async()=>{
  for(const [modifier,key,shift] of [['ctrlKey','z',true],['metaKey','z',true],['ctrlKey','y',false],['metaKey','y',false]]){
    const {app,calls}=setup();app.render();app.input({id:'lighting-notes',value:'Cambio'});let prevented=0;
    const event={target:{closest:()=>null,matches:()=>false},key:'z',[modifier]:true,preventDefault:()=>{prevented++;}};
    app.keydown(event);assert.ok(!app.hasDraft());app.keydown({...event,key,shiftKey:shift});assert.ok(app.hasDraft());assert.equal(prevented,2);
    app.keydown({...event,target:{closest:()=>null,matches:()=>true}});assert.equal(prevented,2);assert.equal(calls.length,0);
  }
});
test('scope switches and hidden workspace do not replay another bolo history',async()=>{
  const {app,nodes}=setup();app.render();app.input({id:'lighting-notes',value:'Solo base'});
  await app.changeScope({id:'lighting-scope',value:'leon'});await action(app,'lighting-undo');assert.doesNotMatch(app.render(),/Solo base/);
  app.input({id:'lighting-notes',value:'Solo León'});delete nodes['.lighting-workspace'];
  app.keydown({target:{matches:()=>false,closest:()=>null},key:'z',ctrlKey:true,preventDefault:()=>assert.fail('Hidden shortcut')});
  assert.match(app.render(),/Solo León/);
});
test('v2 UI migration keeps connection notes and completed checks and never mutates saved plan',async()=>{
  const {app,state,calls}=setup();const old=defaults(),added=['game-controller','video-card','video-psu','left-speaker','right-speaker'];
  old.elements=old.elements.filter(e=>!added.includes(e.id));delete old.schemaVersion;
  old.connections=old.connections.slice(0,20);old.connections[0].from='game-computer';old.connections[0].notes='Mantener';
  old.checklist=old.checklist.slice(0,18);old.checklist[0].done=true;old.elements[0].x=18;
  state.items.push({kind:'lighting',id:'lighting-base',eventId:'',version:2,...old});const snapshot=JSON.stringify(old);
  app.render();await action(app,'lighting-save');assert.equal(JSON.stringify(old),snapshot);
  const p=calls[0].data.plan;assert.equal(p.elements.length,28);assert.equal(p.elements[0].x,18);assert.equal(p.connections[0].from,'video-card');
  assert.equal(p.connections[0].notes,'Mantener');assert.ok(p.checklist[0].done);assert.ok(p.checklist.slice(18).every(c=>!c.done));
});
