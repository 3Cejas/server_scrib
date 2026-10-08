"use strict";
// Public capabilities only: NEVER forward a Sutura identity or bridge secret.
const http = require("http");
module.exports = function(req,res) {
  const url=new URL(req.url,"http://localhost"), path=url.pathname;
  const allowed=/^\/scrib-disponibilidad\/(?:[A-Za-z0-9_-]{43}\/?|api\/[A-Za-z0-9_-]{43}\/?|form\.(?:js|css))$/.test(path);
  const size=Number(req.headers["content-length"]||0);
  function fail(code,msg){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"});res.end(JSON.stringify({error:msg}));}
  if(!allowed||!["GET","HEAD","POST"].includes(req.method)||(req.method==="POST"&&!path.includes("/api/")))return fail(404,"Enlace no disponible.");
  if(!Number.isInteger(size)||size<0||size>4*1024*1024+2048||req.headers["transfer-encoding"])return fail(413,"Archivo demasiado grande.");
  const headers={};
  for(const k of ["content-type","content-length","origin","x-csrf-token","x-availability-edit","cookie"])if(req.headers[k])headers[k]=req.headers[k];
  const upstream=http.request({hostname:"127.0.0.1",port:5124,path:path,method:req.method,headers,timeout:28000},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on("timeout",()=>upstream.destroy());upstream.on("error",()=>{if(!res.headersSent)fail(503,"El servidor está iniciándose o no está disponible. Tu respuesta no se ha descartado.");else res.destroy();});
  req.on("aborted",()=>upstream.destroy());res.on("close",()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
};
