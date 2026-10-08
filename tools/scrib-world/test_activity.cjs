// No browser/network/power side effects: exercise the real client in an isolated VM.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "public/activity.js"), "utf8");
function page({host="sutura-gateway.ddns.net", visible=true, beacon=true, existing=false, broken=false}={}) {
  const calls=[], timers=[], listeners={};
  const context={
    location:{hostname:host, pathname:"/scrib/", search:"?private=secret", hash:"#board/private"},
    document:{visibilityState:visible?"visible":"hidden", addEventListener:(name,fn)=>{listeners[name]=fn;}},
    navigator:{sendBeacon:url=>{calls.push(["beacon",url]);if(broken)throw Error("offline");return beacon;}},
    fetch:(url,options)=>{calls.push(["fetch",url,options]);return Promise.reject(Error("offline"));},
    window:{__suturaActivityPing:existing, setInterval:(fn,ms)=>{timers.push({fn,ms});}},
  };
  vm.createContext(context);vm.runInContext(source,context);
  return {context,calls,timers,listeners};
}
const p=page();
assert.equal(p.calls.length,1);
assert.deepEqual(p.calls[0],["beacon","/_activity?visible=1&path=%2Fscrib%2F"]);
assert.equal(p.timers.length,1);assert.equal(p.timers[0].ms,45000);
vm.runInContext(source,p.context);assert.equal(p.timers.length,1);
p.timers[0].fn();assert.equal(p.calls.length,2);
p.context.document.visibilityState="hidden";
p.timers[0].fn();p.listeners.visibilitychange();assert.equal(p.calls.length,2);
p.context.document.visibilityState="visible";
p.listeners.visibilitychange();assert.equal(p.calls.length,3);
const hidden=page({visible:false});assert.equal(hidden.calls.length,0);
hidden.context.document.visibilityState="visible";hidden.listeners.visibilitychange();assert.equal(hidden.calls.length,1);
for (const host of ["localhost","127.0.0.1","sutura.ddns.net","evil.example"]) {
  const local=page({host});assert.equal(local.calls.length,0);assert.equal(local.timers.length,0);
}
const duplicate=page({existing:true});assert.equal(duplicate.calls.length,0);assert.equal(duplicate.timers.length,0);
const fallback=page({beacon:false});assert.equal(fallback.calls[1][0],"fetch");
assert.equal(fallback.calls[1][2].method,"POST");assert.equal(fallback.calls[1][2].keepalive,true);
assert.doesNotThrow(()=>page({broken:true}));
const app=fs.readFileSync(path.join(__dirname,"public/app.js"),"utf8");
const redirects=[];
vm.runInNewContext(app,{location:{hostname:"sutura.ddns.net",pathname:"/mundo-scrib/",search:"?from=link",hash:"#board/123",replace:url=>redirects.push(url)}});
assert.deepEqual(redirects,["https://sutura-gateway.ddns.net/scrib/?from=link#board/123"]);
vm.runInNewContext(app,{location:{hostname:"sutura-gateway.ddns.net",origin:"https://sutura-gateway.ddns.net",pathname:"/mundo-scrib/",search:"",hash:"#event/123",replace:url=>redirects.push(url)}});
assert.equal(redirects[1],"https://sutura-gateway.ddns.net/scrib/#event/123");
console.log("Activity: visible/hidden, 45s, duplicate guard, fallback, offline, local isolation and legacy redirect passed.");
