"use strict";
// Loaded by dashboard-auth only. Nginx performs existing Authentik forward-auth;
// dashboard-auth supplies its already validated Sutura session, never browser headers.
const http = require("http");
const fs = require("fs");
const path = require("path");
const PREFIX = "/scrib/backstage/";
module.exports = function scribWorldProxy(req, res, session) {
  if (!session) {
    res.writeHead(401, {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"});
    res.end(JSON.stringify({ok:false,error:"Entra con tu usuario de Sutura / Authentik."}));
    return;
  }
  const size = Number(req.headers["content-length"] || 0);
  // Only the authenticated provenance check accepts a 16 MiB PDF as base64.
  // Keep ordinary mutations and uploads at their existing 6 MiB boundary.
  const limit=req.url.split('?',1)[0] === '/scrib/backstage/api/pdf/verify' && req.method === 'POST' ? 23*1024*1024 : 6*1024*1024;
  if (!Number.isFinite(size) || size < 0 || size > limit || req.headers["transfer-encoding"]) {
    res.writeHead(413, {"Content-Type":"application/json"});res.end(JSON.stringify({error:"Datos demasiado grandes."}));return;
  }
  let secret;
  try {
    secret = fs.readFileSync(process.env.SCRIB_WORLD_SECRET || path.join(process.env.HOME, "dockers/scrib-world-data/bridge-secret"), "utf8").trim();
  } catch (_) {
    res.writeHead(503, {"Content-Type":"application/json"});res.end(JSON.stringify({error:"El backstage aún no está disponible."}));return;
  }
  const headers = {
    "X-Scrib-Bridge":secret,
    "X-Scrib-User":session.username,
    "X-Scrib-Name":Buffer.from(session.username, "utf8").toString("base64"),
    "X-Scrib-Role":session.role === "admin" ? "admin" : "user"
  };
  for (const key of ["content-type","content-length","origin","x-csrf-token","cookie","range"]) {
    if(req.headers[key])headers[key] = req.headers[key];
  }
  const upstream = http.request({hostname:"127.0.0.1",port:5124,path:req.url,method:req.method,headers,timeout:28000}, response => {
    res.writeHead(response.statusCode, response.headers);response.pipe(res);
  });
  upstream.on("timeout",()=>upstream.destroy(new Error("timeout")));
  upstream.on("error",()=>{
    if(!res.headersSent){res.writeHead(503,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify({ok:false,error:"El backstage no está disponible. Tu borrador no se ha descartado."}));}
    else res.destroy();
  });
  req.on("aborted",()=>upstream.destroy());
  res.on("close",()=>{if(!res.writableEnded)upstream.destroy();});
  req.pipe(upstream);
};
module.exports.PREFIX = PREFIX;
