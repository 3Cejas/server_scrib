const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const token='A'.repeat(43),prefix='/scrib-disponibilidad/';
function proxy(url,method='GET',extra={}){
  const results=[],forwarded=[];
  const req={url,method,headers:{'content-length':'0','x-scrib-user':'forged','x-scrib-bridge':'forged',...extra},on(){},pipe(){}};
  const res={writeHead:(status,headers)=>results.push({status,headers}),end:body=>{results.at(-1).body=body;},on(){}};
  const http={request:options=>{forwarded.push(options);return {on(){},destroy(){}};}};
  const context={module:{exports:{}},URL,require:name=>name==='http'?http:require(name)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public_proxy.js'),'utf8'),context);
  context.module.exports(req,res);return {results,forwarded};
}
test('public proxy admits only the exact personal PDF and public branding without private identity',()=>{
  for(const route of [token,token+'/',token+'/acuerdo.pdf','api/'+token,'form.js?v=4','form.css?v=3','logo.png?v=1']){
    for(const method of ['GET','HEAD']){
      const r=proxy(prefix+route,method);assert.equal(r.forwarded.length,1,route);
      assert.equal(r.forwarded[0].hostname,'127.0.0.1');assert.equal(r.forwarded[0].port,5124);
      assert.ok(!('x-scrib-user' in r.forwarded[0].headers));assert.ok(!('x-scrib-bridge' in r.forwarded[0].headers));
    }
  }
  assert.equal(proxy(prefix+'api/'+token,'POST').forwarded.length,1);
});
test('public proxy still blocks arbitrary files, modified tokens and non-API writes',()=>{
  for(const route of [token+'/other.pdf',token+'/acuerdo.pdf/extra',token+'/acuerdo.pdf/',token+'/documents/file.pdf','logo.svg','logo.png/extra','server.py','../scrib/backstage/api/state',token.slice(1)+'/acuerdo.pdf',token+'/acuerdo%2Epdf']){
    const r=proxy(prefix+route);assert.equal(r.results[0].status,404,route);assert.equal(r.forwarded.length,0);
  }
  for(const route of [token,token+'/acuerdo.pdf','logo.png','form.js'])assert.equal(proxy(prefix+route,'POST').results[0].status,404);
  assert.equal(proxy(prefix+token+'/acuerdo.pdf','DELETE').results[0].status,404);
  assert.equal(proxy(prefix+'api/'+token,'POST',{'transfer-encoding':'chunked'}).results[0].status,413);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function node(){return {textContent:'',disabled:false,attributes:{},listeners:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,v){this.listeners[k]=v;}};}
async function form(response={}){
  const button=node(),error=node(),root=node(),downloads=[],calls=[],timers=[],revoked=[];
  button.textContent='Descargar / guardar acuerdo en PDF';root.innerHTML='';
  root.querySelector=q=>q==='#print-agreement'?button:q==='#agreement-download-error'?error:null;
  const person={kind:'agreement',name:'Persona <ensayo>',title:'Bolo <ficticio>',text:'Acuerdo de ensayo\nNo es un documento legal',uploads:[],status:'reviewed',csrf:'test',...response.poll};
  const context={document:{title:'',visibilityState:'hidden',querySelector:()=>root,addEventListener(){},body:{appendChild(){}},createElement:()=>({click(){downloads.push({href:this.href,name:this.download});},remove(){}})},
    location:{pathname:prefix+token,hash:'',href:'https://example.test'+prefix+token},history:{replaceState(){}},localStorage:{getItem:()=> 'B'.repeat(43),setItem(){}},
    URLSearchParams,Uint8Array,btoa,AbortController,Blob,Error,TypeError,URL:{createObjectURL:()=> 'blob:test-pdf',revokeObjectURL:u=>revoked.push(u)},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval(){},
    fetch:async(url,options)=>{calls.push({url,options});if(url===prefix+'api/'+token)return {ok:true,headers:{get:()=> 'application/json'},json:async()=>person};
      if(response.fetch)return response.fetch();
      return {ok:response.ok??true,redirected:response.redirected??false,headers:{get:()=>response.type||'application/pdf'},json:async()=>({error:response.message}),blob:async()=>new Blob([response.raw||'%PDF-1.7\nfixture\n%%EOF'])};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'public/form.js'),'utf8'),context);await flush();
  return {button,error,root,downloads,calls,timers,revoked,context};
}
test('personal agreement greets its recipient and explains privacy, with spaced notice and public logo',async()=>{
  const r=await form();assert.match(r.root.innerHTML,/<h1>Hola, Persona &lt;ensayo&gt;<\/h1>/);
  assert.match(r.root.innerHTML,/Este es tu enlace personal/);assert.match(r.root.innerHTML,/Guárdalo y no lo reenvíes/);
  assert.match(r.root.innerHTML,/Bolo &lt;ficticio&gt;/);assert.match(r.root.innerHTML,/notice agreement-notice no-print/);
  const css=fs.readFileSync(path.join(__dirname,'public/form.css'),'utf8');assert.match(css,/\.agreement-document\{margin:24px 0\}/);assert.match(css,/\.agreement-notice\{margin:28px 0\}/);
  const html=fs.readFileSync(path.join(__dirname,'public/availability.html'),'utf8');assert.match(html,/src="\/scrib-disponibilidad\/logo.png\?v=1"/);
});
test('download saves a verified PDF, keeps the personal page and restores its button',async()=>{
  const r=await form();await r.button.onclick();
  assert.deepEqual(r.downloads,[{href:'blob:test-pdf',name:'SCRIB-acuerdo-colaboracion.pdf'}]);
  const call=r.calls.find(c=>c.url.endsWith('/acuerdo.pdf'));assert.equal(call.url,prefix+token+'/acuerdo.pdf');assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');
  assert.equal(r.button.disabled,false);assert.equal(r.button.textContent,'Descargar / guardar acuerdo en PDF');assert.ok(!('aria-busy' in r.button.attributes));
  assert.equal(r.error.textContent,'');assert.equal(r.context.location.href,'https://example.test'+prefix+token);
  r.timers.at(-1)();assert.deepEqual(r.revoked,['blob:test-pdf']);
});
test('download errors and invalid files do not navigate away or become misleading PDFs',async()=>{
  for(const response of [{ok:false,type:'application/json',message:'Enlace no disponible.'},{type:'text/html'},{raw:'not a PDF'},{redirected:true},{fetch:()=>{throw new TypeError('offline');}},{fetch:()=>{const e=new Error('timeout');e.name='AbortError';throw e;}}]){
    const r=await form(response);await r.button.onclick();assert.equal(r.downloads.length,0);assert.ok(r.error.textContent);assert.equal(r.button.disabled,false);assert.match(r.root.innerHTML,/agreement-document/);
    assert.equal(r.context.location.href,'https://example.test'+prefix+token);
  }
});
test('double tap during rendering requests only one PDF',async()=>{
  let resolve;const r=await form({fetch:()=>new Promise(done=>resolve=done)});
  const pending=r.button.onclick();await flush();await r.button.onclick();
  assert.equal(r.calls.filter(c=>c.url.endsWith('/acuerdo.pdf')).length,1);
  assert.equal(r.button.disabled,true);assert.equal(r.button.attributes['aria-busy'],'true');
  resolve({ok:true,headers:{get:()=> 'application/pdf'},blob:async()=>new Blob(['%PDF-1.7\n%%EOF'])});await pending;
  assert.equal(r.downloads.length,1);assert.equal(r.button.disabled,false);
});
