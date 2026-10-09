const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
const defaults=()=>JSON.parse(read('lighting_plan.json'));
function historical(){const plan=defaults();plan.schemaVersion=3;plan.connections.push({id:'power-game',from:'technical-power',to:'game-computer',type:'power',label:'PC'});for(const id of ['room','cables','backup','sound-cues','speakers'])plan.checklist.push({id,category:'Anterior',text:id,done:false});return plan;}
function setup() {
  const calls=[],toasts=[],nodes={},state={lightingDefaults:defaults(),items:[{kind:'event',id:'leon',title:'León <7 noviembre>',start:'2026-11-07'}]};
  let updates=0,answer=true,saveReply=null,refreshError=false,uuid=0;
  const element=()=>({innerHTML:'',textContent:'',dataset:{},querySelectorAll:()=>[],querySelector:()=>null});
  for(const id of ['.lighting-workspace','#lighting-svg','#lighting-elements','#lighting-inspector','#lighting-inspector h2','#lighting-intensity','#lighting-status'])nodes[id]=element();
  const context={window:{confirm:()=>answer},document:{querySelector:s=>nodes[s]||null},crypto:{randomUUID:()=> 'test-request-identifier-unique-'+(++uuid)}};
  vm.createContext(context);vm.runInContext(read('public/lighting.js'),context);
  const app=context.window.ScribLighting({state:()=>state,
    esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    btn:(action,label)=>`<button data-action="${action}">${label}</button>`,pageHead:(_,title,sub,actions)=>`<h1>${title}</h1><p>${sub}</p>${actions||''}`,
    request:async(url,data)=>{calls.push({url,data});if(saveReply instanceof Error)throw saveReply;return saveReply || {item:{id:'lighting-'+(data.eventId||'base'),kind:'lighting',eventId:data.eventId,version:data.version+1,...JSON.parse(JSON.stringify(data.plan))}};},
    toast:m=>toasts.push(m),refresh:async()=>{if(refreshError)throw new Error('offline');},renderPage:()=>{updates++;}});
  return {app,state,nodes,calls,toasts,setAnswer:v=>{answer=v;},setReply:v=>{saveReply=v;},setRefreshError:()=>{refreshError=true;},updates:()=>updates};
}
const action=(app,a,id='')=>app.action({dataset:{action:a,id}});
test('power cables are visible by default, attach to equipment ports and splitter has one input and two outputs',async()=>{
  const {app}=setup(),html=app.render();
  for(const id of ['power-blue','power-red','power-sound','power-actors-blue','power-actors-red','power-splitter'])assert.match(html,new RegExp('data-connection="'+id+'"'));
  assert.doesNotMatch(html,/data-connection="power-game"/);assert.match(html,/data-connection="data-video"/);
  for(const id of ['blue-desk','red-desk','actors-blue','actors-red','game-computer','sound-computer'])assert.match(html,new RegExp('data-port-for="'+id+'"'));
  assert.match(html,/class="lumi-ports"/);assert.match(html,/>IN<\/text>/);
  await action(app,'lighting-cables','power');
  const power=app.render();assert.match(power,/data-connection="power-blue"/);assert.doesNotMatch(power,/data-connection="hdmi-blue"/);
});
test('complete stage with blue/red streets, tables, screen, presenter and frontals is safe and responsive',()=>{
  const {app}=setup(),html=app.render();
  for(const id of defaults().elements.map(e=>e.id))assert.ok(html.includes(`data-lighting-node="${id}"`));
  assert.doesNotMatch(html,/Vista desde el público|no está a escala|SIMULACIÓN/);assert.doesNotMatch(html,/no controla focos reales/);assert.match(html,/data-action="lighting-pdf"/);
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
  assert.ok(app.input({dataset:{lightingCheck:'writers'},checked:true}));
  assert.ok(app.input({dataset:{connectionNotes:'hdmi-projector'},value:'15 m'}));
  await action(app,'lighting-save');
  assert.equal(calls[0].data.plan.checklist[0].done,true);assert.equal(calls[0].data.plan.connections[0].notes,'15 m');
  assert.doesNotMatch(app.render(),/data-connection-notes/);assert.match(app.render(),/data-lighting-check="writers"[^>]*checked/);
});
test('technical material counts replace connection editors and monitor colors are neutral even in saved old plans',()=>{
  const {app,state}=setup();const legacy=defaults();legacy.elements.filter(e=>e.type==='monitor').forEach(e=>e.color=e.id==='blue-monitor'?'blue':'red');
  state.items.push({...legacy,id:'lighting-base',kind:'lighting',eventId:'',version:1});
  const html=app.render();
  assert.match(html,/Material técnico del show/);assert.match(html,/26 conexiones · 27 elementos/);
  for(const [number,label] of [[5,'Vídeo'],[2,'Ordenador'],[2,'Monitor'],[4,'Walkies']])assert.ok(html.includes(`<strong>${number}</strong><span class="material-label">${label}</span>`));
  assert.match(html,/lumi-node lumi-white[^>]*data-lighting-node="blue-monitor"/);
  assert.match(html,/lumi-node lumi-white[^>]*data-lighting-node="red-monitor"/);
  assert.match(html,/class="lumi-audience"/);
  assert.doesNotMatch(html,/Conexiones y cableado|Circuito \/ canal|data-lighting-field="channel"|Arrastra en el plano|id="lighting-elements"|IZQUIERDA ← → DERECHA/);
});
test('old seven-node plan upgrades and a new bolo resets the base checklist only',async()=>{
  const {app,state,calls}=setup();const base=defaults();base.checklist[0].done=true;
  base.schemaVersion=1;base.elements=base.elements.slice(0,7);base.elements[0].x=18;
  state.items.push({kind:'lighting',id:'lighting-base',eventId:'',version:3,...base});
  assert.match(app.render(),/blue-monitor/);
  await app.changeScope({id:'lighting-scope',value:'leon'});await action(app,'lighting-save');
  assert.equal(calls[0].data.plan.elements.length,27);assert.equal(calls[0].data.plan.elements[0].x,18);
  assert.ok(calls[0].data.plan.checklist.every(c=>!c.done));assert.equal(base.checklist[0].done,true);
});
test('diagram shows correct video, controller, speaker endpoints and no redundant color words',async()=>{
  const {app}=setup();const html=app.render();assert.match(html,/<h1>Técnica<\/h1>/);
  for(const id of ['game-controller','video-card','left-speaker','right-speaker'])assert.match(html,new RegExp('data-lighting-node="'+id+'"'));
  assert.match(html,/data-from="video-card" data-to="splitter"/);assert.match(html,/data-from="splitter" data-to="blue-monitor"/);
  await action(app,'lighting-cables','data');assert.match(app.render(),/Datos \/ USB/);
  const labels=[...html.matchAll(/class="lumi-node-label"[^>]*>([\s\S]*?)<\/text>/g)].map(m=>[...m[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(part=>part[1]).join(' · '));
  assert.ok(labels.includes('Calle'));assert.ok(labels.includes('Mesa · escritxr'));assert.ok(!labels.some(l=>/azul|rojo|roja/i.test(l)));
  assert.match(html,/data-lighting-node="blue-power"/);assert.doesNotMatch(html,/m5-16-13 20h10/);
});
test('undo and redo restore a whole cue, checklist, positions and connection notes without writes',async()=>{
  const {app,calls}=setup();app.render();await action(app,'lighting-cue','black');
  app.input({dataset:{lightingCheck:'writers'},checked:true});
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
  const {app,state,calls}=setup();const old=historical(),added=['game-controller','video-card','left-speaker','right-speaker'];
  old.elements=old.elements.filter(e=>!added.includes(e.id));delete old.schemaVersion;
  old.connections=old.connections.filter(c=>!['data-video','data-controller','power-video-psu','power-video-card','audio-left','audio-right','power-left-speaker','power-right-speaker'].includes(c.id));old.connections[0].from='game-computer';old.connections[0].notes='Mantener';
  old.checklist=old.checklist.filter(c=>!['video-card','controller','speakers'].includes(c.id));old.checklist[0].done=true;old.elements[0].x=18;
  state.items.push({kind:'lighting',id:'lighting-base',eventId:'',version:2,...old});const snapshot=JSON.stringify(old);
  app.render();await action(app,'lighting-save');assert.equal(JSON.stringify(old),snapshot);
  const p=calls[0].data.plan;assert.equal(p.elements.length,27);assert.equal(p.elements[0].x,18);assert.equal(p.connections[0].from,'video-card');
  assert.equal(p.connections[0].notes,'Mantener');assert.ok(p.checklist[0].done);assert.ok(p.checklist.filter(c=>['controller','video-card'].includes(c.id)).every(c=>!c.done));
});
test('v3 checklist simplifies and reorders without mutating saved data or losing remaining progress',async()=>{
  const {app,state,calls}=setup(),old=historical();old.checklist[0].done=true;
  old.checklist.find(c=>c.id==='sound').done=true;old.checklist.find(c=>c.id==='sound').notes='Entrada';
  old.checklist.find(c=>c.id==='speakers').notes='Salida';
  state.items.push({...old,id:'lighting-base',kind:'lighting',eventId:'',version:3});const before=JSON.stringify(old);
  const html=app.render();assert.doesNotMatch(html,/Sala y seguridad|Validar permiso|Preparar red de respaldo|sound-cues/);
  assert.ok(html.indexOf('data-lighting-check="video-card"')<html.indexOf('data-lighting-check="projection"'));
  await action(app,'lighting-save');const p=calls[0].data.plan;assert.equal(p.schemaVersion,5);assert.equal(p.checklist.length,16);
  assert.equal(p.checklist[0].done,true);const sound=p.checklist.find(c=>c.id==='sound');assert.equal(sound.done,false);assert.equal(sound.notes,'Entrada\nSalida');
  assert.equal(JSON.stringify(old),before);assert.equal(p.connections.length,26);
});

test('technical area spans full width and actors room is below, preserving equipment positions',()=>{
  const {app}=setup(),html=app.render();
  assert.match(html,/viewBox="0 0 1000 1600"/);
  assert.match(html,/x="60" y="730" width="900"/);
  assert.match(html,/x="60" y="1280" width="900"/);
  const translation=id=>html.split('data-lighting-node="'+id+'"')[0].split('transform="translate(').at(-1).split(')"')[0].split(',').map(Number);
  const [techX,techY]=translation('game-computer'),[actorsX,actorsY]=translation('actors-blue');
  assert.ok(actorsY>techY+100);
  assert.equal(techX,100+8*defaults().elements.find(e=>e.id==='game-computer').x);
});

test('adding connecting deleting and undo restore custom topology through save and reload',async()=>{
  const {app,nodes,calls,state}=setup();app.render();
  nodes['#lighting-new-type']={value:'monitor'};nodes['#lighting-new-zone']={value:'actors'};nodes['#lighting-new-color']={value:'white'};
  await action(app,'lighting-add');assert.match(app.render(),/value="Monitor"/);
  nodes['#lighting-link-target']={value:'actors-power'};nodes['#lighting-link-type']={value:'power'};
  await action(app,'lighting-connect');await action(app,'lighting-save');
  const saved=calls[0].data.plan,extra=saved.elements.at(-1);assert.equal(extra.type,'monitor');assert.equal(extra.zone,'actors');
  assert.equal(saved.connections.at(-1).from,extra.id);assert.equal(saved.connections.at(-1).to,'actors-power');
  await action(app,'lighting-connect');assert.equal(calls.length,1);
  await action(app,'lighting-remove');assert.doesNotMatch(app.render(),new RegExp('data-lighting-node="'+extra.id+'"'));
  await action(app,'lighting-undo');await action(app,'lighting-save');assert.equal(calls[1].data.plan.connections.length,saved.connections.length);
  await action(app,'lighting-disconnect',saved.connections.at(-1).id);await action(app,'lighting-save');assert.equal(calls[2].data.plan.connections.length,saved.connections.length-1);
  state.items.find(i=>i.kind==='lighting').elements=state.items.find(i=>i.kind==='lighting').elements.filter(e=>e.id!=='red-street');
  app.changeScope({id:'lighting-scope',value:''});assert.doesNotMatch(app.render(),/data-lighting-node="red-street"/);
});
test('empty plans remain usable and no deleted elements are auto-restored',async()=>{
  const {app,state}=setup();state.items.push({...defaults(),elements:[],connections:[],kind:'lighting',id:'lighting-base',eventId:'',version:1});
  assert.match(app.render(),/Añade un elemento/);assert.doesNotThrow(()=>app.render());
});
