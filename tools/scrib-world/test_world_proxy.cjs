const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/world_proxy.js','utf8');
function proxy({url='/scrib/backstage/api/pdf/verify',method='POST',size=7*1024*1024,session={username:'exportador',role:'admin'},chunked=false}={}){
 const results=[],forwarded=[];
 const request={url,method,headers:{'content-length':String(size),'content-type':'application/json',...(chunked?{'transfer-encoding':'chunked'}:{})},on(){},pipe(){}};
 const response={writeHead:(status,headers)=>results.push({status,headers}),end:body=>{results.at(-1).body=body;},on(){}};
 const http={request:(options,callback)=>{forwarded.push(options);return {on(){},destroy(){}};}};
 const context={module:{exports:{}},process:{env:{HOME:'/private'}},Buffer,
  require:name=>name==='http'?http:name==='fs'?{readFileSync:()=> 'private-test-bridge-secret'}:require(name)};
 vm.runInNewContext(source,context);context.module.exports(request,response,session);return {results,forwarded};
}
test('only exact authenticated PDF verification can forward larger JSON, with overwritten identity',()=>{
 for(const url of ['/scrib/backstage/api/pdf/verify','/scrib/backstage/api/pdf/verify?x=1']){
  const c=proxy({url});assert.equal(c.forwarded.length,1);assert.equal(c.forwarded[0].headers['X-Scrib-User'],'exportador');
  assert.equal(c.forwarded[0].headers['X-Scrib-Role'],'admin');assert.equal(c.forwarded[0].hostname,'127.0.0.1');
 }
 assert.equal(proxy({session:null}).results[0].status,401);
 for(const opts of [{url:'/scrib/backstage/api/create'},{url:'/scrib/backstage/api/pdf/verify/other'},
                   {url:'/scrib/backstage/api/pdf/%76erify'},{method:'GET'},{size:23*1024*1024+1},{chunked:true}]){
  const c=proxy(opts);assert.equal(c.results[0].status,413);assert.equal(c.forwarded.length,0);
 }
 assert.equal(proxy({url:'/scrib/backstage/api/create',size:1024}).forwarded.length,1);
});
