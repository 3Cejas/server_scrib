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
  const nodes = Object.fromEntries(['main','editor','dialog-title','dialog-kicker','dialog-content','message-recipients','server-health'].map(k=>[k,element()]));
  nodes.editor.querySelector=q=>nodes[q.slice(1)]||null;
  const listeners={},calls=[],responses={};
  const context={window:{addEventListener(){}},
    location:{hostname:'localhost',origin:'http://localhost',pathname:'/scrib/',hash:'#home'},
    document:{querySelector:q=>nodes[q.slice(1)]||null,querySelectorAll:()=>[],getElementById:id=>nodes[id],
      addEventListener:(k,f)=>{listeners[k]=f;}},crypto:{randomUUID:()=> 'test-request'},
    setInterval(){},setTimeout:()=>1,clearTimeout(){},AbortController,
    fetch:async(url,options)=>{calls.push({url,options});return {ok:true,redirected:false,
      headers:{get:()=> 'application/json'},json:async()=>responses[url]||{reports:[]}};}};
  vm.createContext(context);
  for(const file of ['people-colors.js','availability.js','business.js','inventory.js'])vm.runInContext(read(file),context,{filename:file});
  context.window.ScribMaterials=()=>({});
  context.window.ScribWorldGameConfig={summary:()=>'<p>Configuración guardada</p>'};
  const marker='  boot();';
  assert.equal(read('app.js').split(marker).length,2);
  vm.runInContext(read('app.js').replace(marker,`window.tests={setState:s=>state=s,renderHome,renderEvent,renderPeople,renderArchive,openPerson,openDialog,personLabel,messageRecipients,showMessagePreview,checkHealth,inventory,business,polls};`),context,{filename:'app.js'});
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
    if(voids.has(name))continue;
    if(tag[1])assert.equal(stack.pop(),name,'Unexpected closing '+tag[0]);else stack.push(name);
  }
  assert.deepEqual(stack,[]);
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('automatic colors stay stable on rename/team changes and unsafe color values never become CSS',()=>{
  const {colors}=client(),original=colors.key({id:'fixed-uuid',name:'Ana',team:'blue'});
  for(const changed of [{name:'Another name'},{team:'red'},{color:'auto'},{color:'rose malicious-class'}])assert.equal(colors.key({id:'fixed-uuid',...changed}),original);
  for(const [key] of colors.palette)assert.equal(colors.key({id:'fixed-uuid',color:key}),key);
  assert.equal(colors.key(null),'neutral');
  assert.match(colors.className({id:'test',color:'<script>'}),/^person-colored person-tone-[a-z]+$/);
  const n=element();n.classList.add('keep','person-tone-mint');colors.decorate(n,{color:'orchid'});colors.decorate(n,{color:'cyan'});
  assert.deepEqual([...n.classList].sort(),['keep','person-colored','person-tone-cyan']);
});
test('public website link is correct, duplicates removed, game shortcut intact',()=>{
  const html=client().app.renderHome();balanced(html);
  assert.match(html,/<a href="https:\/\/scribshow\.es\/"[^>]*rel="noopener noreferrer"[^>]*>Abrir web ↗<\/a>/);
  assert.match(html,/<a href="\/scrib\/game\/"[^>]*>Abrir videojuego ↗<\/a>/);
  assert.doesNotMatch(html,/Producción anterior|Producción antes|scribshow\.es ↗|El escaparate|web-health/);
  assert.equal((html.match(/>Abrir web ↗</g)||[]).length,1);
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
test('person dialog exposes saved palette choice, previews without submitting and resets for other forms',()=>{
  const {app,nodes,colors,listeners}=client();app.openPerson('p1');
  assert.ok(nodes.editor.classList.contains('person-tone-orchid'));
  assert.match(nodes['dialog-content'].innerHTML,/<select name="color"\s*>/);
  assert.match(nodes['dialog-content'].innerHTML,/<option value="orchid" selected>/);
  assert.equal((nodes['dialog-content'].innerHTML.match(/<option value=/g)||[]).length,Object.keys(colors.options).length);
  const form={dataset:{kind:'person',id:'p1'},querySelector:()=>({value:'New name'})};
  listeners.change({target:{name:'color',value:'mint',id:'',closest:()=>form,matches:()=>false}});
  assert.ok(nodes.editor.classList.contains('person-tone-mint'));
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
test('inventory and WhatsApp labels use the same person identity',()=>{
  const {app,state,nodes}=client();state.items.push({id:'obj',kind:'inventory',title:'Maleta',team:'blue',quantity:1,category:'props',condition:'good',custodianId:'p1',eventId:'e1'});
  const html=app.inventory.list();balanced(html);assert.ok(html.includes(app.personLabel('p1')));
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
