const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/public/documents.js','utf8');
function client(response,{admin=true,file={size:123},readError=false}={}){
 const calls=[],dialogs=[],button={disabled:false,textContent:'Comprobar documento'},error={textContent:''},result={innerHTML:'',textContent:''};
 const form={querySelector:q=>({'[type=submit]':button,'.form-error':error,'.document-check-result':result,'[name=pdf]':{files:file?[file]:[]}}[q])};
 const h={isAdmin:()=>admin,openDialog:(...args)=>dialogs.push(args),esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  request:async(...args)=>{calls.push(args);return typeof response==='function'?response():response;}};
 const context={window:{},FileReader:class {readAsDataURL(){if(readError)this.onerror();else {this.result='data:application/pdf;base64,JVBERg==';this.onload();}}}};
 vm.runInNewContext(source,context);return {run:context.window.ScribDocuments(h),calls,dialogs,form,button,error,result};
}
const original={status:'original',verified:true,name:'<Persona>',exportedBy:'usuario',created:'2026-10-09T10:00:00+00:00',kind:'inventory',reference:'SC-test'};
test('only admins can open provenance verification, without altering the PDF',async()=>{
 const c=client(original);assert.equal(await c.run.action({dataset:{action:'other'}}),false);
 assert.equal(await c.run.action({dataset:{action:'verify-document'}}),true);assert.match(c.dialogs[0][2],/document-check-form/);
 await assert.rejects(client(original,{admin:false}).run.action({dataset:{action:'verify-document'}}),/administración/);
});
test('original provenance uses the existing authenticated request and escapes names',async()=>{
 const c=client(original);await c.run.submit(c.form);assert.equal(c.calls.length,1);assert.equal(c.calls[0][0],'pdf/verify');
 assert.equal(c.calls[0][1].pdf,'JVBERg==');assert.match(c.result.innerHTML,/Original verificado/);
 assert.match(c.result.innerHTML,/&lt;Persona&gt;/);assert.doesNotMatch(c.result.innerHTML,/<Persona>/);assert.equal(c.button.disabled,false);
});
test('modified PDFs attribute the original, never the changes; old or missing keys are unverified',async()=>{
 const c=client({...original,status:'modified',verified:false});await c.run.submit(c.form);
 assert.match(c.result.innerHTML,/Archivo modificado/);assert.match(c.result.innerHTML,/No se puede atribuir/);
 for(const status of ['unknown','unverifiable']){
  const c=client({status,verified:false});await c.run.submit(c.form);assert.equal(c.result.innerHTML,'');
  assert.match(c.result.textContent,status==='unknown'?/No hay un sello/:/No se puede validar/);
 }
});
test('limits, reader errors and network errors do not leave the verification button stuck',async()=>{
 for(const opts of [{file:null},{file:{size:16*1024*1024+1}},{readError:true}]){
  const c=client(original,opts);await c.run.submit(c.form);assert.equal(c.calls.length,0);assert.ok(c.error.textContent);assert.equal(c.button.disabled,false);
 }
 const c=client(()=>{throw Error('Sin conexión');});await c.run.submit(c.form);assert.equal(c.error.textContent,'Sin conexión');assert.equal(c.button.disabled,false);
});
test('double tap cannot verify twice concurrently',async()=>{
 let resolve;const c=client(()=>new Promise(r=>resolve=r)),first=c.run.submit(c.form);
 assert.equal(c.button.disabled,true);await c.run.submit(c.form);await new Promise(r=>setImmediate(r));assert.equal(c.calls.length,1);
 resolve(original);await first;assert.equal(c.button.disabled,false);
});
