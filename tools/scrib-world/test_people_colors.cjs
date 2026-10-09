// Exercise the real client templates in memory: no browser, sockets or live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');

function element() {
  const classes = new Set(), listeners = {};
  return {innerHTML:'',textContent:'',dataset:{},open:true,scrollTop:0,
    classList:{add:(...v)=>v.forEach(c=>classes.add(c)),remove:(...v)=>v.forEach(c=>classes.delete(c)),
      contains:v=>classes.has(v),[Symbol.iterator]:()=>classes[Symbol.iterator]()},
    addEventListener:(k,v)=>{listeners[k]=v;},querySelector:()=>null,querySelectorAll:()=>[],
    showModal(){this.open=true;},close(){this.open=false;},listeners};
}
function client() {
  const nodes = Object.fromEntries(['main','editor','dialog-title','dialog-kicker','dialog-content','message-recipients','server-health','delete-confirmation','delete-ticket-name','delete-error','toast','user-name','user-avatar','connection'].map(k=>[k,element()]));
  nodes['delete-confirmation'].open=false;
  nodes.editor.querySelector=q=>nodes[q.slice(1)]||null;
  const listeners={},calls=[],responses={};
  const context={window:{addEventListener(){}},
    location:{hostname:'localhost',origin:'http://localhost',pathname:'/scrib/',hash:'#home'},
    document:{querySelector:q=>nodes[q.slice(1)]||null,querySelectorAll:()=>[],getElementById:id=>nodes[id],
      addEventListener:(k,f)=>{listeners[k]=f;}},crypto:{randomUUID:()=> 'test-request'},
    setInterval(){},setTimeout:()=>1,clearTimeout(){},AbortController,URL,
    FormData:class{constructor(form){return form.entries;}},
    fetch:async(url,options)=>{calls.push({url,options});let value=responses[url];if(typeof value==='function')value=await value(options);if(value instanceof Error)throw value;return {ok:!value?.__status || value.__status < 400,status:value?.__status || 200,redirected:false,
      headers:{get:()=> 'application/json'},json:async()=>value?.__body || value || {reports:[]}};}};
  vm.createContext(context);
  for(const file of ['people-colors.js','people-profile.js','documents.js','availability.js','business.js','inventory.js','lighting.js'])vm.runInContext(read(file),context,{filename:file});
  context.window.ScribMaterials=()=>({action:async()=>false});
  context.window.ScribWorldGameConfig={summary:()=>'<p>Configuración guardada</p>'};
  const marker='  boot();';
  assert.equal(read('app.js').split(marker).length,2);
  vm.runInContext(read('app.js').replace(marker,`window.tests={setState:s=>state=s,refresh,renderPage,setHomeCalendar:(m,d='')=>{homeMonth=m;homeDay=d;},today,homeCalendarDays,renderHomeCalendar,renderCalendar,renderEvents,agendaEvents,eventCard,renderHome,renderEvent,renderPeople,renderPerson,renderArchive,renderBoards,renderBoard,ticketCard,openBoard,formShell,askDelete,confirmDelete,action,boardTitle,btn,openPerson,openDialog,personLabel,messageRecipients,showMessagePreview,checkHealth,inventory,business,polls,profile,castRow,formData,dependencyInfo,dependencyEditor};`),context,{filename:'app.js'});
  const people=[['p1','ÁNGELA HARRIS BUENO','orchid'],['p2','PABLO PINEÑO','cyan'],['p3','DAVID VIÑAS','auto']].map(([id,name,color])=>({id,name,color,kind:'person',roles:['Interpretación'],bio:'',image:'',phone:'+34600000000',phoneConfirmed:true,instagram:'',website:'',otherSocial:'',version:1}));
  const event={id:'e1',kind:'event',title:'León · función',start:'2026-11-07T19:00',end:'2026-11-07T20:00',arrival:'2026-11-07T17:00',status:'confirmed',venue:'Teatro',city:'León',boardId:'b1',cast:[{personId:'p1',team:'blue',role:'Escritura'},{personId:'p2',team:'red',role:'Escritura'},{personId:'p3',team:'general',role:'Técnica'}]};
  const state={items:[...people,event],user:{name:'Ensayo local',username:'tester',role:'admin'},members:[],activity:[],gameConfigSchema:{},csrf:'test-token',demo:true,revision:1};
  context.window.tests.setState(state);
  return {app:context.window.tests,colors:context.window.ScribPeopleColors,state,event,people,nodes,listeners,calls,responses};
}
function balanced(html) {
  const stack=[],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const tag of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const name=tag[2].toLowerCase();
    if(voids.has(name) || (stack.includes('svg') && /\/>$/.test(tag[0])))continue;
    if(tag[1])assert.equal(stack.pop(),name,'Unexpected closing '+tag[0]);else stack.push(name);
  }
  assert.deepEqual(stack,[]);
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('tickets show named chips, column colors and arrows without status dropdowns or assignee counts',()=>{
  const {app,state}=client();state.members=[{username:'pablop',name:'Pablo Pineño'},{username:'abueno',name:'Ángela <Bueno>'}];
  const task={id:'task',kind:'ticket',boardId:'board',title:'Tertulia',priority:'normal',labels:[],checklist:[],assignees:['pablop','abueno'],due:'',blockedBy:[]};
  for(const status of ['todo','progress','blocked','done']){
    const html=app.ticketCard({...task,status});balanced(html);
    assert.match(html,new RegExp('data-status="'+status+'"'));
    assert.match(html,/ticket-assignee/);assert.match(html,/Pablo Pineño/);assert.match(html,/Ángela &lt;Bueno&gt;/);
    assert.doesNotMatch(html,/<select|responsable\(s\)/);
    assert.equal(html.includes('ticket-move-prev'),status!=='todo');assert.equal(html.includes('ticket-move-next'),status!=='done');
    assert.match(read('tasks.css'),new RegExp('ticket\\[data-status='+status+'\\]'));
  }
  assert.doesNotMatch(read('app.js'),/select\("status",STATUS/);
  assert.match(read('app.js'),/input\("status",t.status,"hidden"\)/);
});

test('production naming, clickable cards and generation are simplified while actual agreement viewing remains',async()=>{
  const {app,event,responses}=client();responses['/scrib/backstage/api/business/overview']={records:[]};
  app.business.overview();await flush();const html=app.business.overview();balanced(html);
  assert.match(html,/Producción y cuentas/);assert.match(html,/href="#production\/e1"/);
  assert.doesNotMatch(html,/Gestionar bolo|Gestionar por bolo|Gestión · temporadas/);
  assert.doesNotMatch(read('business.js'),/He revisado el bolo, el elenco y la plantilla|Revisa la plantilla y el bolo/);
  assert.match(read('business.js'),/business-agreement-preview/);assert.match(read('business.js'),/business-agreement-view/);
  assert.match(read('resources.css'),/\.event-objects\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('one logo/status header keeps connection updates and section rendering without a breadcrumb node',async()=>{
  const {app,nodes,state,responses}=client();
  const html=read('index.html');balanced(html);
  assert.equal((html.match(/class="brand-logo"/g)||[]).length,1);
  assert.equal((html.match(/id="connection"/g)||[]).length,1);
  assert.doesNotMatch(html,/topbar-brand|brand-word|workspace-caption|id="breadcrumb"/);
  assert.match(html,/<header class="sidebar-heading">[\s\S]*?<\/header>/);
  assert.match(html,/href="\/logout" aria-label="Cerrar sesión"/);
  responses['/scrib/backstage/api/state']=state;
  await app.refresh(false);assert.equal(nodes.connection.textContent,'● Ensayo local');
  state.demo=false;await app.refresh(false);assert.equal(nodes.connection.textContent,'● Conectado');
  assert.doesNotThrow(()=>app.renderPage());assert.match(nodes.main.innerHTML,/page-head/);
});

test('management uses full-card show links with actual financial totals, calendar date and venue',async()=>{
  const {app,state,event,responses}=client();
  responses['/scrib/backstage/api/business/overview']={records:[{type:'settlement',id:event.id,season:'2026 / 2027',days:[{income:100000,expenses:5000,allocations:[{personId:'p1',amount:20000,paid:false},{personId:'p2',amount:30000,paid:true}]},{income:20000,expenses:0,allocations:[{personId:'p1',amount:10000,paid:false}]}]}]};
  app.business.overview();await flush();let html=app.business.overview();balanced(html);
  assert.match(html,/<a class="production-card" href="#production\/e1">/);assert.match(html,/2026 \/ 2027/);
  assert.match(html,/Teatro · León/);assert.match(html,/3 personas/);assert.match(html,/2 días liquidados/);
  assert.match(html,/1\.?200,00/);assert.match(html,/300,00/);assert.match(html,/>07<\/strong>/);
  assert.match(html,/noviembre/);const card=html.match(/<a class="production-card"[^>]*>([\s\S]*?)<\/a>/)[1];assert.doesNotMatch(card,/<a\b|<button\b/);
  event.title='<img src=x>';assert.match(app.business.overview(),/&lt;img src=x&gt;/);
  state.items.push({...event,id:'rehearsal',eventType:'rehearsal',title:'No mostrar ensayo'});assert.doesNotMatch(app.business.overview(),/No mostrar ensayo/);
});
test('management empty and unliquidated cards never invent amounts or lose admin boundaries',async()=>{
  const {app,state,responses}=client();responses['/scrib/backstage/api/business/overview']={records:[]};
  app.business.overview();await flush();const html=app.business.overview();balanced(html);
  assert.match(html,/Liquidación pendiente/);assert.match(html,/Temporada por asignar/);assert.match(html,/Ingresos registrados<\/small><strong>—/);
  state.items=state.items.filter(e=>e.kind!=='event');assert.match(app.business.overview(),/Todavía no hay bolos/);
  state.user.role='member';assert.doesNotMatch(app.business.overview(),/production-card/);
  assert.doesNotMatch(read('app.js'),/La lista incluye preparar el acceso/);
  assert.match(read('index.html'),/data-nav="lighting"[^>]*>[\s\S]*? Técnica<\/a>/);
});

test('cross-board dependencies are visible at both ends, safe and reflect completion/deletion',()=>{
  const {app,state}=client();
  state.items.push({id:'bb',kind:'board',title:'Programación <juego>'},{id:'bc',kind:'board',title:'Producción'});
  const source={id:'s',kind:'ticket',title:'Publicar & probar',boardId:'bb',status:'todo'};
  const target={id:'t',kind:'ticket',title:'Preparar estreno',boardId:'bc',status:'blocked',blockedBy:['s']};
  state.items.push(source,target);
  let html=app.dependencyInfo(target);balanced(html);assert.match(html,/🔒 Publicar &amp; probar/);assert.match(html,/#board\/bb/);
  html=app.dependencyInfo(source);assert.match(html,/Desbloquea: Preparar estreno/);assert.match(html,/#board\/bc/);
  source.status='done';assert.match(app.dependencyInfo(target),/Dependencias resueltas/);
  html=app.dependencyEditor(target);balanced(html);assert.match(html,/Programación &lt;juego&gt;/);assert.match(html,/name="blockedBy" value="s" checked/);
  target.blockedBy=['missing'];assert.match(app.dependencyInfo(target),/Tarea eliminada/);assert.match(app.dependencyEditor(target),/desmarca para retirar/);
});

test('all sidebar icons use the same outline system and keep routes and admin restriction',()=>{
  const html=read('index.html'),nav=html.match(/<nav aria-label="Secciones">([\s\S]*?)<\/nav>/)[1];
  const entries=[...nav.matchAll(/<a\b[^>]*data-nav="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.deepEqual(entries.map(x=>x[1]),['home','events','availability','boards','people','inventory','lighting','materials','messages','templates','finance']);
  for(const [,route,content] of entries){
    assert.match(content,/<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">/);
    assert.equal((content.match(/<svg/g)||[]).length,1,route);
    assert.doesNotMatch(content,/<span|🎭|💶/);
  }
  assert.match(nav,/data-nav="finance" data-admin/);
  assert.match(read('app.css'),/\.sidebar nav \.nav-icon\{width:20px;height:20px;flex:0 0 20px/);
});
test('presenter is available for person profiles and bolo casts',()=>{
  const {app}=client();
  assert.match(app.profile.roleEditor(['Presentador']),/value="Presentador" checked/);
  assert.match(app.profile.roleTags(['Presentador']),/role-gold.*🎤.*Presentador/);
  assert.match(app.castRow({personId:'p3',team:'general',role:'Presentador'}),/value="Presentador" selected/);
});
test('only writing and acting cast rows expose blue/red teams and juror replaces participation',()=>{
  const {app}=client();
  for(const role of ['Técnica','Presentador','Jurado','Dramaturgia','Producción']){
    const html=app.castRow({personId:'p3',team:'red',role});balanced(html);
    assert.match(html,/class="cast-team"[^>]*hidden disabled/);assert.doesNotMatch(html,/>Rojo<|>Azul<|>General</);
  }
  for(const role of ['Escritura','Interpretación'])assert.doesNotMatch(app.castRow({role,team:'blue'}),/hidden disabled/);
  assert.match(app.profile.roleEditor([]),/Jurado/);assert.doesNotMatch(app.profile.roleEditor(['Participación']),/Participación/);
});
test('archive is inside Tareas and inventory export selects separate team kits by default',async()=>{
  const {app,state,event,nodes}=client();
  state.items.push({id:'blue-object',kind:'inventory',title:'Gorra',team:'blue',quantity:1,category:'costume'}, {id:'red-object',kind:'inventory',title:'Gorra',team:'red',quantity:1,category:'costume'});
  assert.match(app.renderBoards(),/href="#archive"/);
  assert.equal(app.inventory.eventObjects(event).length,2);
  await app.action({dataset:{action:'inventory-export',id:'e1'}});
  const html=nodes['dialog-content'].innerHTML;balanced(html);
  assert.match(html,/inventory-export-team blue/);assert.match(html,/inventory-export-team red/);assert.equal((html.match(/name="objects"[^>]*checked/g)||[]).length,2);
  assert.doesNotMatch(html,/Ubicación|Responsable|Compartido|Por revisar/);
});
test('communication has explicit send actions without individual confirmation checkboxes',()=>{
  const {app,state,nodes}=client();state.demo=false;
  app.showMessagePreview({id:'draft',people:[{id:'p1',name:'Ángela',text:'Mensaje personalizado',phone:'Prueba',delivery:{status:'pending'}}],deliveries:[]});
  const html=nodes['dialog-content'].innerHTML;balanced(html);
  assert.match(html,/data-action="send-message"/);assert.match(html,/data-action="send-messages"/);
  assert.doesNotMatch(html,/message-confirm|type="checkbox"|confirma el teléfono/i);
});
test('whole bolo card is a native link without nesting its independent task link',()=>{
  const {app,event}=client(),html=app.eventCard(event);balanced(html);
  assert.match(html,/<a class="event-card-link" href="#event\/e1" aria-label="Abrir bolo León · función/);
  assert.equal((html.match(/href="#event\/e1"/g)||[]).length,1);
  assert.match(html,/<\/a><a class="button small event-task-link" href="#board\/b1">Abrir tareas ↗<\/a>/);
  const primary=html.match(/<a class="event-card-link"[^>]*>([\s\S]*?)<\/a>/)[1];
  assert.doesNotMatch(primary,/<a\b|<button\b/);
  assert.match(read('app.css'),/\.event-card-link::after\{content:"";position:absolute;inset:0/);
  assert.match(read('app.css'),/\.event-task-link\{position:relative;z-index:1/);
  event.eventType='rehearsal';balanced(app.eventCard(event));
  assert.match(app.eventCard(event),/aria-label="Abrir ensayo/);
  assert.equal((app.eventCard(event).match(/<a\b/g)||[]).length,1);
  delete event.boardId;event.eventType='show';assert.doesNotMatch(app.eventCard(event),/#board\/undefined/);
});
test('mini calendar has six Monday-first weeks, including leap days and year boundaries',()=>{
  const {app}=client();
  assert.equal(app.homeCalendarDays('2024-02').length,42);
  assert.equal(app.homeCalendarDays('2024-02')[0],'2024-01-29');
  assert.ok(app.homeCalendarDays('2024-02').includes('2024-02-29'));
  assert.ok(!app.homeCalendarDays('2025-02').includes('2025-02-29'));
  assert.equal(app.homeCalendarDays('2026-11')[0],'2026-10-26');
  assert.equal(app.homeCalendarDays('2027-01')[0],'2026-12-28');
  app.setHomeCalendar('2026-11','2026-11-07');const html=app.renderHomeCalendar();balanced(html);
  assert.equal((html.match(/data-action="home-calendar-day"/g)||[]).length,42);
  assert.match(html,/noviembre de 2026/);
  assert.match(html,/data-id="2026-11-07" aria-label="7 de noviembre de 2026 · 1 evento" aria-pressed="true"/);
  assert.match(html,/href="#event\/e1" class="home-calendar-entry"/);
  assert.match(html,/home-calendar-day outside/);
});
test('mini calendar shows bolos and rehearsals, all same-day events, cancellations and no archived records',()=>{
  const {app,state,event}=client();
  for(let i=2;i<=6;i++)state.items.push({...event,id:'e'+i,eventType:i===2?'rehearsal':'show',title:'Evento '+i,status:i===3?'cancelled':'confirmed'});
  state.items.push({...event,id:'archive',title:'ARCHIVED',archived:true});
  app.setHomeCalendar('2026-11','2026-11-07');const html=app.renderHomeCalendar();balanced(html);
  assert.match(html,/7 de noviembre de 2026 · 6 eventos/);
  assert.match(html,/home-calendar-dot rehearsal/);
  assert.match(html,/home-calendar-dot show inactive cancelled/);
  assert.match(html,/<small>\+3<\/small>/);
  assert.equal((html.match(/class="home-calendar-entry/g)||[]).length,6);
  assert.match(html,/Evento 3<\/strong><small>[^<]*Bolo · Cancelado/);
  assert.doesNotMatch(html,/ARCHIVED|#event\/archive/);
});
test('home embeds a visual calendar instead of the old calendar button; empty state remains usable',()=>{
  const {app,state,event}=client();event.start=app.today()+'T19:00';
  const html=app.renderHome();balanced(html);
  assert.match(html,/home-schedule/);assert.match(html,/Calendario de bolos y ensayos/);
  assert.match(html,/class="event-card-link" href="#event\/e1"/);
  assert.doesNotMatch(html,/Ver calendario ↗/);
  state.items=state.items.filter(x=>x.kind!=='event');
  app.setHomeCalendar('2026-11','2026-11-07');const empty=app.renderHome();balanced(empty);
  assert.match(empty,/Primer bolo/);assert.match(empty,/No hay bolos ni ensayos este día/);
  assert.equal((empty.match(/data-action="home-calendar-day"/g)||[]).length,42);
});
test('Android app download is prominent on Home and permanently in the sidebar for every role',()=>{
  const {app,state}=client();const index=read('index.html');
  assert.match(index,/<a class="sidebar-app" href="\/scrib\/backstage\/android\/scrib\.apk" download="SCRIB-Android.apk"/);
  const sidebar=index.match(/<a class="sidebar-app"[\s\S]*?<\/a>/)[0];
  assert.match(sidebar,/Descargar app/);assert.match(sidebar,/Android/);assert.match(sidebar,/<svg class="nav-icon"/);assert.doesNotMatch(sidebar,/data-admin|target=/);
  for(const role of ['admin','user']){
    state.user.role=role;const html=app.renderHome();balanced(html);
    assert.match(html,/<a class="button app-download" href="\/scrib\/backstage\/android\/scrib\.apk" download="SCRIB-Android.apk"/);
    assert.match(html,/Descargar app · Android/);
  }
});
test('home month navigation and day selection are read-only and independent of full calendar',async()=>{
  const {app,nodes,calls}=client(),full=app.renderCalendar();
  app.setHomeCalendar('2026-12','2026-12-01');
  await app.action({dataset:{action:'home-month-next',id:''}});
  assert.match(app.renderHomeCalendar(),/enero de 2027/);
  assert.match(app.renderHomeCalendar(),/Toca un día/);
  await app.action({dataset:{action:'home-month-prev',id:''}});
  assert.match(app.renderHomeCalendar(),/diciembre de 2026/);
  await app.action({dataset:{action:'home-calendar-day',id:'2026-12-31'}});
  assert.match(nodes.main.innerHTML,/data-id="2026-12-31"[^>]*aria-pressed="true"/);
  const selected=app.renderHomeCalendar();
  await app.action({dataset:{action:'home-calendar-day',id:'2026-05-20'}});
  assert.equal(app.renderHomeCalendar(),selected);
  assert.equal(app.renderCalendar(),full);assert.equal(calls.length,0);
  await app.action({dataset:{action:'home-month-today',id:''}});
  assert.match(app.renderHomeCalendar(),new RegExp('data-id="'+app.today()+'"[^>]*aria-pressed="true"'));
  assert.match(app.renderHomeCalendar(),/aria-current="date"/);
  assert.equal(calls.length,0);
});
test('calendar picks up collaboration changes while keeping the selected month/day and escaping titles',()=>{
  const {app,state,event}=client();app.setHomeCalendar('2026-11','2026-11-07');
  state.items.push({...event,id:'unsafe',title:'<img src=x onerror=alert(1)> '+ 'LONG '.repeat(80)});
  const html=app.renderHomeCalendar();balanced(html);
  assert.match(html,/noviembre de 2026/);
  assert.match(html,/7 de noviembre de 2026 · 2 eventos" aria-pressed="true"/);
  assert.match(html,/&lt;img src=x/);assert.doesNotMatch(html,/<img src=x/);
  assert.match(read('app.css'),/\.home-calendar-agenda\{[^}]*max-height:185px;overflow:auto/);
  const card=app.eventCard({...event,title:'<script>alert(1)</script>'});balanced(card);
  assert.doesNotMatch(card,/<script>/);assert.match(card,/&lt;script&gt;/);
});
test('agenda lists nearest upcoming events first, then history newest first without mutating state',()=>{
  const {app,state,event}=client();
  state.items=state.items.filter(e=>e.kind!=='event');
  const rows=[
    ['old','2000-01-01','completed'],['far','2098-11-07','confirmed'],
    ['recent','2020-01-01','completed'],['near','2097-11-07','pending'],
    ['cancelled','2019-01-01','cancelled'],['today',app.today(),'confirmed']
  ].map(([id,start,status])=>({...event,id,start,status}));
  state.items.push(...rows,{...event,id:'archived',start:'2096-01-01',archived:true});
  const before=state.items.slice();
  assert.deepEqual(Array.from(app.agendaEvents(),e=>e.id),['today','near','far','recent','cancelled','old']);
  assert.deepEqual(state.items,before);
  rows.find(e=>e.id==='near').status='completed';
  assert.deepEqual(Array.from(app.agendaEvents(),e=>e.id),['today','far','near','recent','cancelled','old']);
});
test('past shows and rehearsals are subdued without disabling their links or changing status',()=>{
  const {app,event}=client();
  for(const eventType of ['show','rehearsal']){
    const html=app.eventCard({...event,eventType,status:'completed'});balanced(html);
    assert.match(html,/class="panel event-card is-completed"/);
  }
  assert.doesNotMatch(app.eventCard(event),/is-completed/);
  const past={...event,start:'2000-01-01',status:'confirmed'};
  assert.match(app.eventCard(past),/event-card is-completed/);
  assert.equal(past.status,'confirmed');
  assert.match(app.eventCard(past),/href="#event\/e1"/);
  assert.match(read('app.css'),/\.event-card\.is-completed\{[^}]*box-shadow:/);
  assert.match(read('app.css'),/\.calendar-event\.is-completed\{[^}]*color:#a8adba/);
  assert.doesNotMatch(read('app.css'),/\.event-card\.is-completed\{[^}]*pointer-events:none/);
  assert.match(app.eventCard(event),/<h3>León · función<\/h3>[\s\S]*?<p class="event-date"><time/);
  assert.match(read('app.css'),/\.home-schedule\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(read('app.css'),/\.home-calendar\{grid-row:1/);
});
test('event inventory shows private object photo thumbnails and preserves selection and team boundaries',()=>{
  const {app,state,event}=client(),image='a'.repeat(64)+'.png';
  state.items.push(
    {id:'photo',kind:'inventory',title:'Linterna <azul>',team:'blue',quantity:2,category:'technical',image,imageReference:true},
    {id:'blank',kind:'inventory',title:'Chaqueta',team:'red',quantity:1,category:'costume'},
    {id:'excluded',kind:'inventory',title:'No incluir',team:'red',image},
    {id:'archived',kind:'inventory',title:'Archivado',team:'blue',image,archived:true}
  );
  event.inventoryIds=['photo','blank','archived'];
  const html=app.inventory.eventPanel(event);balanced(html);
  assert.match(html,new RegExp('class="event-object-photo reference-photo" src="/scrib/backstage/images/'+image+'" alt="" loading="lazy"'));
  assert.match(html,/Linterna &lt;azul&gt;/);assert.match(html,/event-object-placeholder[^>]*>👕/);
  assert.match(html,/event-object blue[^>]*data-id="photo"/);assert.match(html,/event-object red[^>]*data-id="blank"/);
  assert.doesNotMatch(html,/No incluir|Archivado/);
  assert.match(read('resources.css'),/\.event-object-photo[^}]*object-fit:contain/);
});

test('automatic colors stay stable on rename/team changes and unsafe color values never become CSS',()=>{
  const {colors}=client(),original=colors.key({id:'fixed-uuid',name:'Ana',team:'blue'});
  for(const changed of [{name:'Another name'},{team:'red'},{color:'auto'},{color:'rose malicious-class'}])assert.equal(colors.key({id:'fixed-uuid',...changed}),original);
  for(const [key] of colors.palette)assert.equal(colors.key({id:'fixed-uuid',color:key}),key);
  assert.equal(colors.key(null),'neutral');
  assert.match(colors.className({id:'test',color:'<script>'}),/^person-colored person-tone-[a-z]+$/);
  const n=element();n.classList.add('keep','person-tone-mint');colors.decorate(n,{color:'orchid'});colors.decorate(n,{color:'cyan'});
  assert.deepEqual([...n.classList].sort(),['keep','person-colored','person-tone-cyan']);
});
test('website link and server status move to the sidebar, without duplicated Home content',()=>{
  const html=client().app.renderHome();balanced(html);
  const index=read('index.html');
  assert.match(index,/<a class="sidebar-web" href="https:\/\/scribshow\.es\/"[^>]*rel="noopener noreferrer"/);
  assert.match(index,/sidebar-web-copy[\s\S]*?id="server-health" class="server-health" role="status"/);
  assert.doesNotMatch(html,/Abrir videojuego|href="\/scrib\/game\/"/);
  assert.doesNotMatch(html,/Producción anterior|Producción antes|scribshow\.es ↗|El escaparate|web-health/);
  assert.doesNotMatch(html,/server-health|home-game-service|scribshow\.es/);
  assert.equal((index.match(/id="server-health"/g)||[]).length,1);
});
test('health indicator keeps the server check without the removed duplicate web probe',async()=>{
  const {app,state,responses,calls,nodes}=client();
  await app.checkHealth();assert.equal(calls.length,0);
  state.demo=false;responses['/api/scrib-health']={ok:true};
  await app.checkHealth();assert.deepEqual(calls.map(c=>c.url),['/api/scrib-health']);
  assert.match(nodes['server-health'].textContent,/Servidor activo/);
  responses['/api/scrib-health']={ok:false};await app.checkHealth();
  assert.match(nodes['server-health'].textContent,/no disponible/);
});
test('settlement has photos, initials, role labels, accurate amounts and visual actions, not the multi-day heading',async()=>{
  const {app,people,event,responses}=client();
  people[0].image='a'.repeat(64)+'.jpg';people[1].name='<Persona & dos>';
  responses['/scrib/backstage/api/business/agreements/e1']={agreements:[]};
  responses['/scrib/backstage/api/business/overview']={records:[{type:'settlement',id:'e1',season:'2026 / 2027',days:[{income:100000,expenses:5000,allocations:[{personId:'p1',amount:20000,paid:false},{personId:'p2',amount:30000,paid:true},{personId:'previous',amount:5000,paid:false}]}]}]};
  app.business.production('e1');await flush();const html=app.business.production('e1');balanced(html);
  assert.match(html,/<h2>💶 Liquidación<\/h2>/);assert.doesNotMatch(html,/varios días/);
  assert.match(html,new RegExp('src="/scrib/backstage/images/'+people[0].image+'"'));
  assert.match(html,/finance-initials/);assert.match(html,/&lt;Persona &amp; dos&gt;/);
  assert.equal((html.match(/class="settlement-person-card"/g)||[]).length,4);
  assert.match(html,/Asignado · base<\/small><strong>200,00/);
  assert.match(html,/Pendiente · base<\/small><strong>0,00/);
  assert.match(html,/data-action="business-invoice" data-id="e1\|previous"/);
  assert.match(html,/data-action="business-person" data-id="p1"/);
  assert.match(html,/noviembre de 2026/);assert.match(html,/19:00/);
  for(const [action,label] of [['business-person','Ficha económica'],['business-invoice','Borrador de factura'],['business-settlement','Ingresos y reparto']]){
    const button=app.btn(action,label,'p1');balanced(button);
    assert.match(button,/<svg class="action-icon"/);assert.match(button,new RegExp('>'+label+'<'));
    assert.doesNotMatch(button,/icon-only/);
  }
  people[0].image='" onerror="alert(1)';assert.doesNotMatch(app.business.production(event.id),/onerror=/);
});
test('empty settlement never invents earnings and financial views remain admin-only',async()=>{
  const {app,state,responses}=client();
  responses['/scrib/backstage/api/business/agreements/e1']={agreements:[]};
  responses['/scrib/backstage/api/business/overview']={records:[]};
  app.business.production('e1');await flush();let html=app.business.production('e1');balanced(html);
  assert.match(html,/Aún no hay liquidación/);assert.match(html,/Asignado · base<\/small><strong>—/);
  state.user.role='member';html=app.business.production('e1');assert.doesNotMatch(html,/settlement-person-card|Ingresos y reparto/);
});
test('roadmap groups blue/red/general teams and keeps each person color',()=>{
  const {app,people}=client(),html=app.renderEvent('e1');balanced(html);
  for(const css of ['event-roadmap','event-prep-section','event-cast-section','event-inventory-section','event-game-section','event-reports-section','event-notes-section','cast-group blue','cast-group red','cast-group general'])assert.ok(html.includes(css),css);
  for(const person of people)assert.ok(html.includes(app.personLabel(person.id))||html.includes(app.personLabel(person.id,' '+person.name)));
  assert.match(html,/cast-chip blue person-colored person-tone-orchid/);
  assert.match(html,/cast-chip red person-colored person-tone-cyan/);
  assert.match(html,/data-action="edit-person" data-id="p1"/);
});
test('empty, rehearsal, historical and archived roadmap cases retain proper structure',()=>{
  const {app,event}=client();event.cast=[];
  for(const changes of [{},{eventType:'rehearsal',sourcePollId:'poll'},{eventType:'show',historical:true}]){
    Object.assign(event,changes);const html=app.renderEvent('e1');balanced(html);
    assert.match(html,/Elenco pendiente de asignar/);assert.doesNotMatch(html,/cast-group general/);
    if(event.eventType==='rehearsal')assert.doesNotMatch(html,/event-game-section|event-reports-section/);
  }
  event.archived=true;assert.doesNotMatch(app.renderEvent('e1'),/event-roadmap/);
});
test('names and snapshot names remain safely escaped, including long names',()=>{
  const {app,people}=client();people[0].name='<img src=x onerror=alert(1)> '+ 'LONG '.repeat(80);
  for(const html of [app.personLabel('p1'),app.renderPeople(),app.renderEvent('e1')]){
    balanced(html);assert.ok(html.includes('&lt;img'));assert.doesNotMatch(html,/<img src=x/);
  }
  assert.match(app.personLabel('p1','Earlier <name>'),/Earlier &lt;name&gt;/);
  assert.match(app.personLabel('missing','Public <name>'),/person-tone-neutral.*Public &lt;name&gt;/);
});
test('person dialog hides the color picker and roles hint without losing saved colors',()=>{
  const {app,nodes}=client();app.openPerson('p1');
  assert.ok(nodes.editor.classList.contains('person-tone-orchid'));
  assert.match(nodes['dialog-content'].innerHTML,/<input name="color" type="hidden" value="orchid"/);
  assert.doesNotMatch(nodes['dialog-content'].innerHTML,/<select name="color"|Color de la persona|Puedes elegir varios roles|No es necesario escribirlos/);
  app.openPerson('p3');assert.match(nodes['dialog-content'].innerHTML,/<input name="color" type="hidden" value="auto"/);
  app.openDialog('event','Other form','');assert.ok(!nodes.editor.classList.contains('person-colored'));
  assert.ok(![...nodes.editor.classList].some(c=>c.startsWith('person-tone-')));
});
test('archiving a person keeps their color in the archive and read-only cast dialog',()=>{
  const {app,people,nodes}=client();people[0].archived=true;people[0].updated='2026-10-08T12:00:00+00:00';
  const html=app.renderArchive();balanced(html);assert.ok(html.includes(app.personLabel('p1')));
  app.openPerson('p1');assert.ok(nodes.editor.classList.contains('person-tone-orchid'));
  assert.match(nodes['dialog-content'].innerHTML,/Recuperar ficha/);
  assert.doesNotMatch(nodes['dialog-content'].innerHTML,/name="color"/);
});
test('inventory omits hidden custodian metadata and communication retains person identity',()=>{
  const {app,state,nodes}=client();state.items.push({id:'obj',kind:'inventory',title:'Maleta',team:'blue',quantity:1,category:'props',condition:'good',custodianId:'p1',eventId:'e1'});
  const html=app.inventory.list();balanced(html);assert.ok(!html.includes(app.personLabel('p1')));assert.doesNotMatch(html,/Responsable|Ubicación/);
  app.messageRecipients('e1');assert.ok(nodes['message-recipients'].innerHTML.includes(app.personLabel('p1')));
  app.showMessagePreview({id:'draft',people:[{id:'p1',name:'Earlier name',phone:'test',text:'Hello'}],deliveries:[]});
  assert.ok(nodes['dialog-content'].innerHTML.includes(app.personLabel('p1','Earlier name')));
});
test('availability replies, pending invitations and public names keep color and identity distinctions',async()=>{
  const {app,state,responses}=client();const poll={id:'poll',kind:'availability',version:1,title:'Ensayos',description:'',people:['p1','p2'],slots:[],confirmed:{},invites:{p1:'token1',p2:'token2'},publicEnabled:false};state.items.push(poll);
  responses['/scrib/backstage/api/availability/poll']={poll,open:true,replies:[{personId:'p1',name:'Earlier name',answers:{},comment:'Note'},{personId:'',name:'Guest <name>',answers:{},comment:''}]};
  app.polls.detail('poll');await flush();const html=app.polls.detail('poll');balanced(html);
  assert.ok(html.includes(app.personLabel('p1','Earlier name')));assert.ok(html.includes(app.personLabel('p2')));
  assert.ok(html.includes(app.personLabel('','Guest <name>')));assert.match(html,/identidad no verificada/);
});
test('financial allocation names use the same colored labels, amounts unchanged',async()=>{
  const {app,responses}=client();responses['/scrib/backstage/api/business/overview']={records:[{id:'e1',type:'settlement',season:'2026–2027',days:[{allocations:[{personId:'p1',amount:10000,paid:false}]}]}]};
  app.business.overview();await flush();const html=app.business.overview();balanced(html);
  assert.ok(html.includes(app.personLabel('p1')));assert.match(html,/100,00/);
});
test('palette has readable contrast on dark backgrounds and no continuous animations or unsafe inline styles',()=>{
  const {colors}=client(),styles=read('people.css');
  const lum=hex=>{const parts=hex.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return parts.reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);};
  for(const [key,,hex] of colors.palette){
    assert.ok(styles.includes(`.person-tone-${key}{--person-color:${hex}}`));
    for(const bg of ['#191c29','#1b2130','#203640','#1b2330'])assert.ok((lum(hex)+.05)/(lum(bg)+.05)>=4.5,`${key} contrast on ${bg}`);
  }
  assert.doesNotMatch(styles,/animation:|filter:|backdrop-filter:|url\(/);
  assert.match(styles,/@media\(max-width:700px\)/);assert.match(styles,/overflow-wrap:anywhere/);assert.match(styles,/@media print/);
  assert.doesNotMatch(read('people-colors.js'),/\.style\b|style=/);
});
test('cast cards link to detail, show Instagram with its logo and hide phone and duplicate history',()=>{
  const {app,people}=client();people[0].instagram='https://www.instagram.com/_anasempere/?igsh=test';
  const html=app.renderPeople();balanced(html);
  assert.match(html,/@_anasempere ↗/);assert.doesNotMatch(html,/\+34 600 000 000|href="tel:|participation-history|compose-person/);
  assert.match(html,/href="#person\/p1"/);assert.match(html,/class="instagram-icon"/);assert.match(html,/person-contact instagram/);
  assert.match(html,/person-role role-cyan/);assert.doesNotMatch(html,/>Instagram ↗<|Teléfono privado/);
  const contacts=app.profile.contacts(people[0]);assert.match(contacts,/\+34 600 000 000/);assert.match(contacts,/href="tel:\+34600000000"/);
  app.openPerson('p1');
});
test('Instagram handles update from URLs or at-signs and invalid legacy links never crash or execute',()=>{
  const {app}=client(),p=app.profile;
  for(const value of ['@_anasempere','_anasempere','https://www.instagram.com/_anasempere/','https://instagram.com/_anasempere/?igsh=abc'])assert.equal(p.instagramHandle(value),'@_anasempere');
  for(const value of ['https://instagram.com/p/ABC/','https://example.com/anasempere','javascript:alert(1)',''])assert.equal(p.instagramHandle(value),'');
  const html=p.contacts({instagram:'javascript:alert(1)',website:'broken',otherSocial:'https://user:pass@example.com/'});
  balanced(html);assert.doesNotMatch(html,/href="javascript|href="https:\/\/user:pass/);
  assert.doesNotThrow(()=>p.contacts({}));
});
test('person detail keeps contact and history and simplified edits preserve hidden legacy links without archive',()=>{
  const {app,people,nodes}=client();const p=people[0];
  p.website='https://example.com/portfolio';p.otherSocial='https://example.com/social';
  p.participationCount=1;p.participations=[{date:'2026-03-27',title:'Función',venue:'Sala',roles:[{role:'Interpretación',team:'blue'}],eventId:'e1'}];
  const card=app.renderPeople();assert.doesNotMatch(card,/participation-history|Ver bolos|Web \/ portfolio|Otra red/);
  const detail=app.renderPerson(p.id);balanced(detail);assert.match(detail,/participation-history|Ver bolo/);assert.match(detail,/href="tel:/);
  assert.doesNotMatch(detail,/Web \/ portfolio|Otra red/);
  app.openPerson(p.id);const form=nodes['dialog-content'].innerHTML;balanced(form);
  assert.doesNotMatch(form,/data-action="archive"|Web \/ portfolio|Otra red social/);
  assert.match(form,/name="website"[^>]*type="hidden"/);assert.match(form,/name="otherSocial"[^>]*type="hidden"/);
});
test('inventory is a native whole-card edit button and removed product fields do not erase stored references',async()=>{
  const {app,state,nodes}=client();const o={id:'obj',kind:'inventory',title:'Gorra',team:'blue',quantity:1,category:'costume',description:'',image:'',sourceUrl:'https://example.com/product',imageReference:true,version:1};state.items.push(o);
  const html=app.inventory.list();balanced(html);
  assert.match(html,/<button type="button" class="panel object-card blue"[^>]*data-action="edit-object"/);
  assert.doesNotMatch(html,/icon-only|Referencia del producto|Imagen de catálogo/);
  app.inventory.action({dataset:{action:'edit-object',id:o.id}});
  const form=nodes['dialog-content'].innerHTML;assert.doesNotMatch(form,/name="sourceUrl"|name="imageReference"|Referencia del producto|imagen de catálogo/);
  const data=await app.formData({dataset:{kind:'inventory',id:o.id},entries:[['quantity','1']],querySelector:()=>null});
  assert.equal(data.imageReference,true);
});
test('roles are checkbox tags, not a free text field, including cast selectors',()=>{
  const {app,nodes}=client();app.openPerson('p1');const html=nodes['dialog-content'].innerHTML;balanced(html);
  assert.match(html,/<fieldset class="person-role-picker">/);
  assert.match(html,/<input type="checkbox" name="roles" value="Interpretación" checked>/);
  assert.doesNotMatch(html,/<input name="roles"|name="phoneConfirmed"|He comprobado que este teléfono/);
  const legacy=app.profile.roleEditor(['Rol histórico']);assert.match(legacy,/value="Rol histórico" checked/);
  const cast=app.castRow({personId:'p1',role:'Escritura',team:'blue'});balanced(cast);
  assert.match(cast,/<select class="cast-role"/);assert.doesNotMatch(cast,/input class="cast-role"|datalist/);
});
test('form serializes multiple role tags and blank inventory quantity without turning it into zero',async()=>{
  const {app}=client();
  const person=await app.formData({dataset:{kind:'person'},entries:[['name','Ana'],['color','orchid'],['roles','Escritura'],['roles','Interpretación']],querySelectorAll:()=>[{value:'Escritura'},{value:'Interpretación'}]});
  assert.deepEqual(Array.from(person.roles),['Escritura','Interpretación']);assert.ok(!('phoneConfirmed' in person));
  assert.equal(person.color,'orchid');
  const object=await app.formData({dataset:{kind:'inventory'},entries:[['title','Mochilas'],['quantity','']],querySelector:()=>null});
  assert.equal(object.quantity,null);
  const zero=await app.formData({dataset:{kind:'inventory'},entries:[['title','Mochilas'],['quantity','0']],querySelector:()=>null});assert.equal(zero.quantity,0);
});
test('a phone is usable without identity checkbox, while missing phone remains disabled',()=>{
  const {app,people,nodes}=client();people[0].phoneConfirmed=false;people[1].phone='';
  app.messageRecipients('e1','p1');const html=nodes['message-recipients'].innerHTML;
  assert.match(html,/<input type="checkbox" name="people" value="p1"\s+checked>/);
  assert.match(html,/<input type="checkbox" name="people" value="p2" disabled/);
  assert.doesNotMatch(html,/Confirma el teléfono|Teléfono confirmado/);
});
test('unquantified inventory cards and event entries stay explicit without NaN or null',()=>{
  const {app,state,event}=client();state.items.push({id:'obj',kind:'inventory',title:'Mochilas',team:'blue',quantity:null,category:'props',condition:'unchecked',eventId:'e1'});
  for(const html of [app.inventory.list(),app.inventory.eventPanel(event)]){
    balanced(html);assert.match(html,/Cantidad sin especificar/);assert.doesNotMatch(html,/Por revisar|Compartido|× null|NaN/);
  }
  assert.match(app.inventory.list(),/unidades · 1 objetos/);
});

function taskFixture() {
  const result=client();
  const board={id:'board-1',kind:'board',title:'Dramaturgia · laboratorio',description:'Ideas <b>en equipo</b>',color:'violet',eventId:'',version:2};
  const ticket={id:'ticket-1',kind:'ticket',title:'Ensayar <final>',boardId:board.id,status:'todo',version:3,priority:'normal',labels:[],assignees:[],checklist:[],due:'',created:'2026-10-08'};
  result.state.items.push(board,ticket);
  return {...result,board,ticket};
}
test('Tareas cards have full-card native links and separate accessible edit icons',()=>{
  const {app,board}=taskFixture();const html=app.renderBoards();balanced(html);
  assert.match(html,/<h1>Tareas<\/h1>/);assert.doesNotMatch(html,/laboratorio/i);
  assert.match(html,/<a class="board-card-link" href="#board\/board-1" aria-label="Abrir tablero Dramaturgia">/);
  assert.match(html,/<\/a><button[^>]*data-action="edit-board"[^>]*aria-label="Editar tablero Dramaturgia"[^>]*><svg/);
  assert.match(html,/Ideas &lt;b&gt;en equipo&lt;\/b&gt;/);
  assert.match(read('tasks.css'),/\.board-card-link::after\{[^}]*inset:0/);
  assert.match(read('tasks.css'),/\.board-card \.board-edit\{[^}]*z-index:1/);
  const detail=app.renderBoard(board.id);balanced(detail);assert.doesNotMatch(detail,/laboratorio/i);
  assert.match(detail,/data-action="delete-ticket"[^>]*aria-label="Eliminar tarea Ensayar &lt;final&gt;"/);
});
test('board editor cleans legacy labels and symbols retain tooltip/accessibility names',()=>{
  const {app,board,nodes,ticket}=taskFixture();app.openBoard(board.id);
  assert.match(nodes['dialog-content'].innerHTML,/name="title"[^>]*value="Dramaturgia"/);
  for(const [action,label] of [['edit-board','Editar tablero'],['edit-person','Ver / editar'],['delete-ticket','Eliminar tarea'],['print','Imprimir']]){
    const html=app.btn(action,label,ticket.id);balanced(html);
    assert.match(html,/class="button  icon-only"/);assert.ok(html.includes(`aria-label="${label}" title="${label}"`));
    assert.match(html,/aria-hidden="true" focusable="false"/);
  }
  const form=app.formShell('ticket',ticket,'');balanced(form);
  assert.match(form,/data-action="archive"/);assert.match(form,/data-action="delete-ticket"/);
  assert.doesNotMatch(app.formShell('ticket',{},''),/data-action="delete-ticket"/);
  assert.doesNotMatch(app.formShell('board',board,''),/data-action="delete-ticket"/);
});
test('delete prompt does not write or replace drafts and cancel preserves them',async()=>{
  const {app,nodes,calls,ticket}=taskFixture();nodes['dialog-content'].innerHTML='UNSAVED DRAFT';
  await app.action({dataset:{action:'delete-ticket',id:ticket.id}});
  assert.ok(nodes['delete-confirmation'].open);assert.equal(nodes['delete-ticket-name'].textContent,ticket.title);
  assert.equal(calls.length,0);assert.equal(nodes['dialog-content'].innerHTML,'UNSAVED DRAFT');
  await app.action({dataset:{action:'cancel-delete'}});
  assert.ok(!nodes['delete-confirmation'].open);assert.equal(calls.length,0);
  assert.ok(nodes.editor.open);assert.equal(nodes['dialog-content'].innerHTML,'UNSAVED DRAFT');
  app.askDelete('p1');assert.ok(!nodes['delete-confirmation'].open);
});
test('confirmed delete sends exact version and CSRF and removes only the target',async()=>{
  const {app,nodes,calls,state,responses,ticket}=taskFixture();
  nodes.editor.querySelector=q=>q==='#edit-form'?{dataset:{id:ticket.id}}:null;
  responses['/scrib/backstage/api/delete-ticket']={ok:true,item:{id:ticket.id,deleted:true}};
  responses['/scrib/backstage/api/state']=()=>state;
  app.askDelete(ticket.id);await app.confirmDelete();
  const writes=calls.filter(c=>c.options.method==='POST');assert.equal(writes.length,1);
  assert.equal(writes[0].url,'/scrib/backstage/api/delete-ticket');
  const payload=JSON.parse(writes[0].options.body);
  assert.equal(payload.id,ticket.id);assert.equal(payload.version,3);assert.equal(payload.confirmed,true);assert.ok(payload.requestId);
  assert.equal(writes[0].options.headers['X-CSRF-Token'],'test-token');
  assert.ok(!state.items.some(t=>t.id===ticket.id));assert.ok(state.items.some(t=>t.id==='p1'));
  assert.ok(!nodes['delete-confirmation'].open);assert.ok(!nodes.editor.open);
});
test('stale deletion keeps ticket and draft and displays conflict rather than pretending success',async()=>{
  const {app,nodes,state,responses,ticket}=taskFixture();nodes['dialog-content'].innerHTML='UNSAVED DRAFT';
  responses['/scrib/backstage/api/delete-ticket']={__status:409,__body:{error:'Otra persona ha actualizado esta tarea'}};
  app.askDelete(ticket.id);await app.confirmDelete();
  assert.equal(nodes['delete-error'].textContent,'Otra persona ha actualizado esta tarea');
  assert.ok(nodes['delete-confirmation'].open);assert.ok(nodes.editor.open);
  assert.equal(nodes['dialog-content'].innerHTML,'UNSAVED DRAFT');assert.ok(state.items.some(t=>t.id===ticket.id));
});
test('double-click while deleting performs one operation and disables cancellation until done',async()=>{
  const {app,nodes,calls,responses,state,ticket}=taskFixture();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const controls=[{disabled:false},{disabled:false}];nodes['delete-confirmation'].querySelectorAll=()=>controls;
  responses['/scrib/backstage/api/delete-ticket']=async()=>{await gate;return {ok:true,item:{id:ticket.id,deleted:true}};};
  responses['/scrib/backstage/api/state']=()=>state;
  app.askDelete(ticket.id);const first=app.confirmDelete();await app.confirmDelete();
  assert.equal(calls.filter(c=>c.options.method==='POST').length,1);assert.ok(controls.every(b=>b.disabled));
  await app.action({dataset:{action:'cancel-delete'}});assert.ok(nodes['delete-confirmation'].open);
  release();await first;assert.ok(controls.every(b=>!b.disabled));
});
test('a lost reply can retry the same deletion token without losing another open editor',async()=>{
  const {app,nodes,calls,state,responses,ticket}=taskFixture();nodes.editor.querySelector=q=>q==='#edit-form'?{dataset:{id:'p1'}}:null;
  nodes['dialog-content'].innerHTML='ANOTHER DRAFT';
  responses['/scrib/backstage/api/delete-ticket']=new Error('Connection interrupted');
  app.askDelete(ticket.id);await app.confirmDelete();
  assert.equal(nodes['delete-error'].textContent,'Connection interrupted');assert.ok(nodes['delete-confirmation'].open);
  responses['/scrib/backstage/api/delete-ticket']={ok:true,item:{id:ticket.id,deleted:true}};responses['/scrib/backstage/api/state']=()=>state;
  await app.confirmDelete();
  const writes=calls.filter(c=>c.options.method==='POST');assert.equal(writes.length,2);
  assert.equal(writes[0].options.body,writes[1].options.body);
  assert.ok(nodes.editor.open);assert.equal(nodes['dialog-content'].innerHTML,'ANOTHER DRAFT');
});
test('delete button drag cannot accidentally move a ticket',()=>{
  const {listeners}=taskFixture();let prevented=false;
  listeners.dragstart({target:{closest:selector=>selector==='.ticket'?{dataset:{ticket:'ticket-1'}}:{}},preventDefault:()=>{prevented=true;}});
  assert.ok(prevented);
});
test('an unexpected successful HTTP response cannot falsely confirm a deletion',async()=>{
  const {app,nodes,state,responses,ticket}=taskFixture();
  responses['/scrib/backstage/api/delete-ticket']={ok:true,item:{id:'another-task',deleted:true}};
  app.askDelete(ticket.id);await app.confirmDelete();
  assert.match(nodes['delete-error'].textContent,/No se ha podido confirmar/);
  assert.ok(nodes['delete-confirmation'].open);assert.ok(state.items.some(x=>x.id===ticket.id));
});
