const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(__dirname+'/public/task-autosave.js','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const fields={title:'Prueba',description:'',priority:'normal',due:'',labels:[],assignees:[],blockedBy:[],checklist:[]};
const tick=()=>new Promise(r=>setImmediate(r));
function setup(overrides={}){
 const context={window:{},crypto:{randomUUID},setTimeout:()=>1,clearTimeout(){}};vm.createContext(context);vm.runInContext(source,context);
 const error={textContent:''},retry={hidden:true},actions={hidden:true};
 const form={dataset:{id:'t',version:'1',request:randomUUID()},data:clone(fields),valid:true,
  checkValidity(){return this.valid;},querySelector:q=>q==='.task-error-actions'?actions:q==='.form-error'?error:q==='[data-action="task-retry"]'?retry:null};
 const calls=[],saved=[];
 const h={read:async f=>clone(f.data),busy:()=>false,request:async(route,payload)=>{calls.push(clone(payload));return{item:{...clone(payload.data||form.data),kind:'ticket',id:'t',version:2}};},saved:t=>saved.push(t),...overrides};
 const auto=context.window.ScribTaskAutosave(h);return{auto,h,form,calls,saved,error,retry,actions};
}
test('changes save without rebuilding, disabling, or moving editable fields',async()=>{
 const x=setup();await x.auto.attach(x.form);const same=x.form.data;
 x.form.data.description='Uno\nDos';x.auto.changed(x.form);assert.equal(x.auto.hasDraft(),true);
 assert.equal(await x.auto.flush(),true);assert.equal(x.form.data,same);
 assert.equal(x.form.dataset.version,'2');assert.equal(x.calls.length,1);
 assert.deepEqual(x.calls[0].changes,{description:'Uno\nDos'});assert.deepEqual(x.calls[0].base,{description:''});
 assert.equal(x.auto.hasDraft(),false);assert.equal(x.form.dataset.saveState,'saved');assert.equal(x.actions.hidden,true);
 x.auto.changed(x.form);await x.auto.flush();assert.equal(x.calls.length,1);
});
test('typing during flight and a simultaneous close flush serialize latest revision',async()=>{
 let resolve;const x=setup({request:async(route,payload)=>{x.calls.push(clone(payload));if(x.calls.length===1)await new Promise(r=>resolve=r);return{item:{...fields,...clone(payload.changes),kind:'ticket',id:'t',version:x.calls.length+1}};}});
 await x.auto.attach(x.form);x.form.data.description='Primero';x.auto.changed(x.form);
 const flight=x.auto.flush();await tick();x.form.data.description='Segundo';x.auto.changed(x.form);const close=x.auto.flush();resolve();
 assert.equal(await flight,true);assert.equal(await close,true);assert.equal(x.calls.length,2);
 assert.equal(x.calls[1].changes.description,'Segundo');assert.equal(x.calls[1].base.description,'Primero');assert.equal(x.calls[1].version,2);
});
test('lost create acknowledgement retries frozen payload and token before later typing',async()=>{
 let first=true;const x=setup({request:async(route,payload)=>{x.calls.push(clone(payload));if(first){first=false;throw new Error('Sin conexión');}return{item:{...fields,...clone(payload.data||payload.changes),kind:'ticket',id:'created',version:x.calls.length===2?1:2}};}});
 x.form.dataset.id='';x.form.dataset.version='0';x.form.data.title='';await x.auto.attach(x.form);
 x.form.data.title='Nueva';x.auto.changed(x.form);assert.equal(await x.auto.flush(),false);
 x.form.data.title='Nueva completa';x.auto.changed(x.form);assert.equal(await x.auto.flush(),true);
 assert.deepEqual(x.calls[0],x.calls[1]);assert.equal(x.calls[2].id,'created');assert.equal(x.calls[2].changes.title,'Nueva completa');
 assert.equal(x.calls[2].base.title,'Nueva');assert.equal(x.retry.hidden,true);
});
test('validation and server conflicts keep draft intact, never report saved',async()=>{
 const x=setup({request:async()=>{const e=new Error('Cambio ajeno');e.status=409;throw e;}});await x.auto.attach(x.form);
 x.form.valid=false;x.form.data.title='';x.auto.changed(x.form);assert.equal(await x.auto.flush(),false);assert.equal(x.saved.length,0);
 x.form.valid=true;x.form.data.title='Local';x.auto.changed(x.form);assert.equal(await x.auto.flush(),false);
 assert.equal(x.auto.hasDraft(),true);assert.equal(x.form.dataset.saveState,'error');assert.equal(x.actions.hidden,false);assert.equal(x.retry.hidden,false);assert.equal(x.error.textContent,'Cambio ajeno');assert.equal(x.form.data.title,'Local');
});
test('an unconfirmed or wrong-task response retains frozen retry instead of losing draft',async()=>{
 const x=setup({request:async()=>({item:{kind:'ticket',id:'wrong',version:2}})});await x.auto.attach(x.form);
 x.form.data.title='Nuevo';x.auto.changed(x.form);assert.equal(await x.auto.flush(),false);assert.equal(x.form.dataset.id,'t');assert.equal(x.auto.hasDraft(),true);
});
test('busy comment sending delays save and detach clears all pending UI ownership',async()=>{
 let busy=true;const x=setup({busy:()=>busy});await x.auto.attach(x.form);x.form.data.title='Nuevo';x.auto.changed(x.form);
 assert.equal(await x.auto.flush(),false);assert.equal(x.calls.length,0);busy=false;assert.equal(await x.auto.flush(),true);
 assert.equal(x.auto.owns(x.form),true);x.auto.detached();assert.equal(x.auto.owns(x.form),false);assert.equal(await x.auto.flush(),true);
});
test('composition does not schedule an autosave until composition ends',async()=>{
 const timers=[];const context={window:{},crypto:{randomUUID},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};vm.createContext(context);vm.runInContext(source,context);
 const x=setup(),auto=context.window.ScribTaskAutosave(x.h);await auto.attach(x.form);
 x.form.data.title='Composición';auto.changed(x.form,true);assert.equal(timers.length,0);auto.changed(x.form);assert.equal(timers.length,1);
 await auto.flush();assert.equal(x.calls.length,1);
});
test('normalized server fields do not cause conflict or caret rewrite on later typing',async()=>{
 const x=setup({request:async(route,payload)=>{x.calls.push(clone(payload));return{item:{...fields,...clone(payload.changes),title:payload.changes.title?.trim()||'Nuevo',kind:'ticket',id:'t',version:x.calls.length+1}};}});
 await x.auto.attach(x.form);x.form.data.title=' Nuevo ';x.auto.changed(x.form);await x.auto.flush();
 assert.equal(x.form.data.title,' Nuevo ');
 x.form.data.description='Descripción';x.auto.changed(x.form);await x.auto.flush();assert.deepEqual(x.calls[1].changes,{description:'Descripción'});
 x.form.data.title=' Nuevo título ';x.auto.changed(x.form);await x.auto.flush();assert.equal(x.calls[2].base.title,'Nuevo');
});
test('opening, blurring and closing tasks of any status never saves or patches their status',async()=>{
 const x=setup();
 for(const status of ['blocked','todo','blocked','done','progress']){
  x.form.data={...clone(fields),status};await x.auto.attach(x.form);
  assert.equal(await x.auto.flush(),true);assert.equal(x.calls.length,0);
  x.auto.changed(x.form);assert.equal(await x.auto.flush(),true);assert.equal(x.calls.length,0);
  assert.equal(x.form.data.status,status);x.auto.detached();
 }
 x.form.data={...clone(fields),status:'blocked'};await x.auto.attach(x.form);
 x.form.data.labels=['Sonido'];x.auto.changed(x.form);await x.auto.flush();
 assert.deepEqual(x.calls[0].changes,{labels:['Sonido']});assert.equal(x.form.data.status,'blocked');
});
