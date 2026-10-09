const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/public/export.js','utf8');
function client(response,native={}){
 const calls=[],downloads=[],timers=[],revoked=[],button={innerHTML:'Exportar PDF',disabled:false,setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]}};
 const context={window:{ScribAndroid:native.bridge},AbortController,FileReader:class {
   readAsDataURL(){if(native.readError)this.onerror();else {this.result='data:application/pdf;base64,JVBERi10ZXN0';this.onload();}}
  },URL:{createObjectURL:()=> 'blob:private-pdf',revokeObjectURL:u=>revoked.push(u)},
  setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},
  fetch:async(u,o)=>{calls.push({u,o});return typeof response==='function'?await response():response;},
  document:{body:{append(){}},createElement:()=>({click(){downloads.push({href:this.href,name:this.download})},remove(){}})}};
 vm.runInNewContext(source,context);return {run:context.window.ScribExport,calls,downloads,button,timers,revoked};
}
const success={ok:true,headers:{get:()=> 'application/pdf'},blob:async()=>new Blob(['%PDF-test'])};
test('PDF export uses session CSRF, a private Blob and restores the same button',async()=>{
 const c=client(success);await c.run({csrf:'private-token'},{kind:'inventory',ids:['blue-1']},c.button);
 assert.equal(c.calls.length,1);assert.equal(c.calls[0].u,'/scrib/backstage/api/pdf');assert.equal(c.calls[0].o.credentials,'same-origin');
 assert.equal(c.calls[0].o.headers['X-CSRF-Token'],'private-token');assert.equal(JSON.parse(c.calls[0].o.body).ids[0],'blue-1');
 assert.deepEqual(c.downloads,[{href:'blob:private-pdf',name:'SCRIB-inventory.pdf'}]);assert.equal(c.button.disabled,false);assert.equal(c.button.innerHTML,'Exportar PDF');
 c.timers[1]();assert.deepEqual(c.revoked,['blob:private-pdf']);
});
test('HTML login pages and stale selections never become fake PDF downloads',async()=>{
 for(const response of [{ok:true,headers:{get:()=> 'text/html'},json:async()=>{throw Error('HTML')}},{ok:false,headers:{get:()=> 'application/json'},json:async()=>({error:'Actualiza la selección.'})}]){
  const c=client(response);await assert.rejects(c.run({csrf:'token'},{kind:'inventory'},c.button));assert.equal(c.downloads.length,0);assert.equal(c.button.disabled,false);
 }
});
test('double click cannot launch duplicate rendering while the button is generating',async()=>{
 let resolve;const c=client(()=>new Promise(r=>resolve=r)),run=c.run({csrf:'token'},{kind:'lighting'},c.button);
 assert.equal(c.button.disabled,true);assert.equal(c.button.textContent,'Generando PDF…');
 await c.run({csrf:'token'},{kind:'lighting'},c.button);assert.equal(c.calls.length,1);
 resolve(success);await run;assert.equal(c.downloads.length,1);
});
test('Android PDF export uses the limited native save bridge, not a blob URL',async()=>{
 const saves=[],c=client(success,{bridge:{savePdf:(...args)=>{saves.push(args);return true;}}});
 await c.run({csrf:'private-token'},{kind:'event'},c.button);
 assert.deepEqual(saves,[['JVBERi10ZXN0','SCRIB-event.pdf']]);assert.equal(c.downloads.length,0);
 assert.equal(c.button.innerHTML,'Exportar PDF');assert.equal(c.button.disabled,false);assert.equal(c.calls.length,1);
});
test('Android errors restore the button and never fall back to an unusable blob download',async()=>{
 for(const native of [{bridge:{savePdf:()=>false}},{readError:true,bridge:{savePdf:()=>true}}]){
  const c=client(success,native);await assert.rejects(c.run({csrf:'token'},{kind:'report'},c.button));
  assert.equal(c.downloads.length,0);assert.equal(c.button.disabled,false);
 }
 const c=client({...success,blob:async()=>({size:16*1024*1024+1})},{bridge:{savePdf:()=>{throw Error('Do not pass oversized data');}}});
 await assert.rejects(c.run({csrf:'token'},{kind:'report'},c.button),/16 MB/);assert.equal(c.downloads.length,0);
});
