const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'public/business.js'),'utf8');
function client(){
  const listeners={},calls=[],answers={},toasts=[];
  const invoice={type:'invoice',id:'i1',version:1,status:'draft',created:'2026-11-08',date:'2026-11-08',eventId:'e1',eventTitle:'Bolo ficticio',issuer:{legalName:'Nombre <seguro>',taxId:'TEST',address:'Domicilio',iban:'ES00 CUENTA',vat:'0',withholding:'15'},recipient:{name:'Entidad',taxId:'TEST',address:'Domicilio'},number:'',series:'SUTURA',concept:'Concepto',lines:[{date:'2026-11-07',amount:1000}],base:1000,vat:0,withholding:150,total:850,uploads:[]};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const location={hash:'#production/e1'},window={scrollX:0,scrollY:640,addEventListener:(name,fn)=>listeners[name]=fn,confirm:()=>true,scrollTo:(x,y)=>calls.push({scroll:[x,y]})};
  const context={window,location,URL,crypto:{randomUUID:()=> 'delete-request-00000001'},document:{addEventListener:(name,fn)=>listeners[name]=fn,querySelectorAll:()=>[]},requestAnimationFrame:fn=>fn(),setTimeout(){},clearTimeout(){}};
  vm.createContext(context);vm.runInContext(source,context);
  const dialog={open:false,close(){},querySelector(){return null;}},state={user:{role:'admin'}};
  const request=async(route,payload)=>{calls.push({route,payload});const answer=answers[route];if(answer instanceof Error)throw answer;if(typeof answer==='function')return answer(payload);return answer||{records:[invoice]};};
  const event={id:'e1',title:'Bolo ficticio',start:'2026-11-07',cast:[]};
  const business=window.ScribBusiness({esc,state:()=>state,request,item:()=>event,personLabel:()=>'',btn:(a,l,id='')=>`<button data-action="${a}" data-id="${id}">${l}</button>`,field:()=>'',input:()=>'',area:()=>'',openDialog(){},dialog,toast:m=>toasts.push(m),renderPage:()=>calls.push({render:true}),eventGroups:()=>[],eventSeries:e=>[e],resolveCast:x=>x,seriesLinks:()=>'',niceDate:()=>'',hour:()=>''});
  return {business,invoice,location,window,listeners,calls,answers,state,toasts};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('invoice view omits draft and missing number, has top-right close/trash and signed PDF upload',async()=>{
  const c=client();c.business.invoice('i1');await flush();let html=c.business.invoice('i1');
  assert.doesNotMatch(html,/BORRADOR|Borrador|Número pendiente|Factura · SUTURA/);
  assert.match(html,/<h1>Factura<\/h1>/);assert.match(html,/transferencia bancaria a la cuenta ES00 CUENTA\./);
  for(const action of ['business-invoice-close','business-invoice-delete','business-invoice-upload'])assert.match(html,new RegExp('data-action="'+action+'"'));
  assert.match(html,/aria-label="Cerrar factura y volver"/);assert.match(html,/<svg viewBox="0 0 24 24"/);
  c.invoice.number='001';html=c.business.invoice('i1');assert.match(html,/Factura · SUTURA \/ 001/);
  c.invoice.uploads=[{id:'u1',name:'firma <segura>.pdf'}];html=c.business.invoice('i1');assert.match(html,/invoice-document\/u1/);assert.match(html,/firma &lt;segura&gt;.pdf/);assert.doesNotMatch(html,/firma <segura>/);
  c.state.user.role='user';assert.doesNotMatch(c.business.invoice('i1'),/ES00 CUENTA|business-invoice-upload|Nombre &lt;/);
});
test('close returns to original route and scroll, including direct-link fallback',async()=>{
  const c=client();c.business.invoice('i1');await flush();
  c.listeners.click({target:{closest:()=>({getAttribute:()=> '#invoice/i1'})}});
  c.location.hash='#invoice/i1';
  await c.business.action({dataset:{action:'business-invoice-close',id:'i1'}});
  assert.equal(c.location.hash,'#production/e1');assert.deepEqual(c.calls.at(-1).scroll,[0,640]);
  const direct=client();direct.location.hash='#invoice/i1';direct.business.invoice('i1');await flush();
  await direct.business.action({dataset:{action:'business-invoice-close',id:'i1'}});
  assert.equal(direct.location.hash,'#production/e1');assert.deepEqual(direct.calls.at(-1).scroll,[0,0]);
});
test('invoice lists and bolo detail expose trash and original signed document without draft copy',async()=>{
  const c=client();c.invoice.uploads=[{id:'u1',name:'firmada.pdf'}];c.answers['business/agreements/e1']={agreements:[]};
  c.business.overview();c.business.production('e1');await flush();
  for(const html of [c.business.overview(),c.business.production('e1')]){
    assert.match(html,/#invoice\/i1/);assert.match(html,/business-invoice-delete/);assert.match(html,/PDF firmado subido/);assert.match(html,/invoice-document\/u1/);assert.doesNotMatch(html,/Borradores|Sin borradores/);
  }
});
test('cancel never deletes; lost acknowledgement reuses operation token; malformed success is not accepted',async()=>{
  const c=client();c.business.invoice('i1');await flush();const node={dataset:{action:'business-invoice-delete',id:'i1'},disabled:false};
  c.window.confirm=()=>false;await c.business.action(node);assert.equal(c.calls.filter(x=>x.route==='business/invoice-delete').length,0);
  c.window.confirm=()=>true;c.answers['business/invoice-delete']=new Error('lost response');
  await assert.rejects(c.business.action(node),/lost response/);assert.equal(node.disabled,false);
  c.answers['business/invoice-delete']={ok:true,item:{id:'other',kind:'invoice',deleted:true}};
  await assert.rejects(c.business.action(node),/confirmar la eliminación/);assert.equal(c.toasts.length,0);
  const requests=c.calls.filter(x=>x.route==='business/invoice-delete');assert.equal(requests[0].payload.requestId,requests[1].payload.requestId);
  c.answers['business/invoice-delete']={ok:true,item:{id:'i1',kind:'invoice',deleted:true}};
  await c.business.action(node);assert.equal(c.toasts.length,1);assert.equal(node.disabled,false);
});
test('double click cannot delete concurrently and ordinary users cannot mutate cached invoices',async()=>{
  const c=client();c.business.invoice('i1');await flush();let release;
  c.answers['business/invoice-delete']=()=>new Promise(resolve=>release=resolve);
  const node={dataset:{action:'business-invoice-delete',id:'i1'},disabled:false};
  const first=c.business.action(node);await c.business.action(node);
  assert.equal(c.calls.filter(x=>x.route==='business/invoice-delete').length,1);
  release({ok:true,item:{id:'i1',kind:'invoice',deleted:true}});await first;
  c.state.user.role='user';await assert.rejects(c.business.action(node),/administración/);
});
