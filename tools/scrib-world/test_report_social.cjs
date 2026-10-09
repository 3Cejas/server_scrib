const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const renderer=require('./public/instagram-report.js');
function fixture(){return {id:'match-1',startedAt:Date.parse('2026-10-09T16:00Z'),endedAt:Date.parse('2026-10-09T16:35Z'),
  writers:{1:{name:'Ángela',text:'Primera línea.\n\nFin de la historia.'},2:{name:'Pablo',text:'Segunda historia.'}},
  stats:{players:{1:{palabrasTotal:8,palabrasUnicas:7,pulsacionesTotal:60,ritmoPpm:120,letrasBenditas:['A']},2:{palabrasTotal:2}}},
  score:{disponible:true,jugadores:{1:{total:84.5},2:{total:75}},ganador:1},
  muses:{equipos:{1:{musas:[{nombre:'Nébula',stats:{enviadas:3,introducidas:2,superbonus:1}}]},2:{musas:[]}}}};}
function setup(){
  const clicks=[],fonts=[],revoked=[],context={window:{ScribInstagramReport:renderer},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)},setTimeout:f=>f(),
    document:{fonts:{load:async f=>fonts.push(f)},body:{append(){}},createElement:()=>({click(){clicks.push(this.download);},remove(){}})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'public/report-social.js'),'utf8'),context);
  const button={disabled:false,innerHTML:'Instagram · ZIP',textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};
  return {api:context.window.ScribSavedReportSocial,window:context.window,button,clicks,fonts,revoked};
}
test('saved-report adapter uses original stories, scores, rhythm and muses without mutable Control',()=>{
  const {api}=setup(),r=fixture(),before=JSON.stringify(r),data=api.data(r);
  assert.equal(data.jugadores[1].nombre,'Ángela');assert.equal(data.jugadores[1].texto,r.writers[1].text);
  assert.equal(data.jugadores[1].puntuacion,84.5);assert.equal(data.jugadores[1].ppm,120);
  assert.equal(data.musas[1].cantidad,1);assert.equal(data.musas[1].efectividad,67);assert.equal(data.musas[2].efectividad,0);
  assert.equal(data.duracion,'35:00');assert.equal(JSON.stringify(r),before);
  const plan=renderer.crearPlan(data);assert.equal(plan.slides[0].tipo,'portada');assert.equal(plan.slides.at(-1).tipo,'cierre');
  assert.match(plan.slides.filter(s=>s.tipo==='historia'&&s.jugadorId===1).flatMap(s=>s.lineas).join('\n'),/Primera línea\.\n{2,}Fin de la historia/);
});
test('download creates a saved-match ZIP once, loads the retro font and restores its button',async()=>{
  const {api,window,button,clicks,fonts,revoked}=setup();let release,started=false;
  window.ScribInstagramReport={crearPlan:()=>({slides:[{}]}),generarPngs:async(data,{onProgress})=>{started=true;onProgress(1,1);await new Promise(r=>release=r);return {archivos:[]};},crearZip:()=>new Uint8Array([80,75])};
  const first=api.download(fixture(),button);await new Promise(r=>setImmediate(r));assert.ok(started);assert.ok(button.disabled);
  await api.download(fixture(),button);assert.equal(clicks.length,0);release();await first;
  assert.deepEqual(clicks,['SCRIB-Instagram-2026-10-09-match-1.zip']);assert.deepEqual(fonts,['16px "Retro-gaming"']);assert.deepEqual(revoked,['blob:test']);
  assert.equal(button.innerHTML,'Instagram · ZIP');assert.equal(button.disabled,false);assert.deepEqual(button.attrs,{});
});
test('incomplete, excessively large or failed exports restore buttons without misleading downloads',async()=>{
  const {api,window,button,clicks}=setup();
  await assert.rejects(api.download({},button),/dos textos guardados/);assert.equal(button.disabled,false);
  window.ScribInstagramReport={crearPlan:()=>({slides:Array(201).fill({})})};
  await assert.rejects(api.download(fixture(),button),/200 imágenes/);assert.equal(button.disabled,false);
  window.ScribInstagramReport={crearPlan:()=>({slides:[{}]}),generarPngs:async()=>{throw Error('Canvas unavailable');}};
  await assert.rejects(api.download(fixture(),button),/Canvas unavailable/);
  assert.equal(button.disabled,false);assert.equal(button.innerHTML,'Instagram · ZIP');assert.equal(clicks.length,0);
});
test('carousel ZIP has numbered ordered entries and a full multipage story',()=>{
  const data=setup().api.data(fixture());data.jugadores[1].texto=Array.from({length:70},(_,i)=>`Escena ${i+1}. La ciudad despierta y cambia de rumbo.`).join('\n');
  const plan=renderer.crearPlan(data);assert.ok(plan.slides.length>8);
  assert.match(plan.slides.filter(s=>s.jugadorId===1).flatMap(s=>s.lineas).join(' '),/Escena 70\./);
  const files=plan.slides.map((s,i)=>({nombre:String(i+1).padStart(2,'0')+'_'+s.nombre+'.png',bytes:new Uint8Array([137,80,78,71])})),zip=renderer.crearZip(files),text=Buffer.from(zip).toString('latin1');
  assert.ok(text.indexOf('01_portada.png')<text.indexOf('02_resumen.png'));assert.equal(Buffer.from(zip).readUInt32LE(0),0x04034b50);
  assert.equal(Buffer.from(zip).readUInt16LE(zip.length-12),files.length);
});
