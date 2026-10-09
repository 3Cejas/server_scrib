// Real thumbnail templates/resizing, in memory without sockets or production data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const read=file=>fs.readFileSync(path.join(__dirname,'public',file),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function client(observer=true){
  let covers=[];const observed=[],renders=[];
  const context={window:{},location:{hash:'#materials'},document:{querySelectorAll:()=>covers}};
  if(observer)context.ResizeObserver=class{
    constructor(callback){this.callback=callback;this.targets=[];this.disconnected=false;observed.push(this);}
    observe(target){this.targets.push(target);}
    disconnect(){this.disconnected=true;}
  };
  vm.createContext(context);vm.runInContext(read('library.js'),context);
  const materials=[
    {id:'tutorial',title:'Guía del espectáculo',cover:'/scrib/backstage/materials/tutorial/cover.html',coverType:'slide',url:'/scrib/backstage/materials/tutorial/',slides:19,tags:['Equipo'],description:'Guía'},
    {id:'charla',title:'El origen de <SCRI> B',cover:'/scrib/backstage/materials/charla/cover.html',coverType:'slide',url:'/scrib/backstage/materials/charla/',slides:38,tags:['Historia'],description:'Origen'}
  ];
  const library=context.window.ScribMaterials({esc,request:async()=>({materials}),renderPage:()=>renders.push(true),pageHead:()=>'',empty:()=>'',btn:()=>'',badge:esc});
  return {library,observed,renders,setCovers:value=>covers=value};
}
function cover(width){
  const ready=new Set(),frame={style:{},classList:{add:c=>ready.add(c)}};
  return {clientWidth:width,frame,ready,querySelector:()=>frame};
}
test('materials use passive first-slide previews with the new title, retaining clickable presentation links',async()=>{
  const {library,renders}=client();assert.match(library.list(),/Abriendo materiales/);await flush();
  const html=library.list();assert.equal(renders.length,1);
  assert.equal((html.match(/class="material-slide-cover"/g)||[]).length,2);
  assert.equal((html.match(/sandbox="allow-same-origin" tabindex="-1" aria-hidden="true" loading="lazy"/g)||[]).length,2);
  assert.doesNotMatch(html,/allow-scripts|autoplay|<img\b/);
  assert.match(html,/href="#material\/tutorial"/);assert.match(html,/src="\/scrib\/backstage\/materials\/tutorial\/cover.html"/);
  assert.match(html,/El origen de &lt;SCRI&gt; B/);assert.doesNotMatch(html,/Sutura y el origen de SCRIB/);
  assert.match(library.detail('charla'),/src="\/scrib\/backstage\/materials\/charla\/"/);
});
test('covers scale the whole original slide on initial render, tablet resize and hidden-to-visible changes',()=>{
  const {library,setCovers,observed}=client(),wide=cover(720),narrow=cover(288),hidden=cover(0);
  setCovers([wide,narrow,hidden]);library.afterRender();
  assert.equal(wide.frame.style.transform,'scale(0.5)');assert.equal(narrow.frame.style.transform,'scale(0.2)');
  assert.ok(wide.ready.has('is-ready'));assert.ok(!hidden.ready.has('is-ready'));
  assert.equal(observed[0].targets.length,3);
  wide.clientWidth=360;hidden.clientWidth=432;
  observed[0].callback([{target:wide},{target:hidden}]);
  assert.equal(wide.frame.style.transform,'scale(0.25)');assert.equal(hidden.frame.style.transform,'scale(0.3)');
  assert.ok(hidden.ready.has('is-ready'));
  setCovers([]);library.afterRender();assert.ok(observed[0].disconnected);assert.equal(observed.length,1);
  setCovers([narrow]);library.afterRender();assert.equal(observed.length,2);
  library.afterRender();assert.ok(observed[1].disconnected);
});
test('initial cover scaling works without ResizeObserver, with a fixed non-interactive 16:9 canvas',()=>{
  const {library,setCovers}=client(false),small=cover(320);setCovers([small]);library.afterRender();
  assert.equal(small.frame.style.transform,'scale('+320/1440+')');
  assert.match(read('resources.css'),/\.material-cover\{[^}]*aspect-ratio:16\/9/);
  assert.match(read('resources.css'),/\.material-slide-cover\{[^}]*width:1440px;height:810px;[^}]*pointer-events:none/);
  assert.match(read('app.js'),/library\.afterRender\?\.\(\)/);
});
