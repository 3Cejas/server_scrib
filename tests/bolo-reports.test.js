'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBoloReportArchive}=require('../bolo_reports.js');
const fixture=()=>({partida:{id:'match-test',inicio_ts:1000,fin_ts:2000},escritores:{1:{nombre:'Azul',texto_final:'Una\nHistoria'},2:{nombre:'Rojo',texto_final:'Texto'}},resumen:{stats:{},puntuacion_final:{}}});
test('durable outbox retries after restart; exactly one immutable report with no client ids or HTML',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scrib-report-test-'));let fail=true,captured=[];
 const send=async r=>{if(fail)throw new Error('offline');captured.push(r);};
 try{
  const a=createBoloReportArchive({directory,enabled:true,send});
  a.enqueue({bolo:{id:'bolo-1'}},fixture(),{equipos:{1:{musas:[{nombre:'Musa',client_id:'secret',stats:{enviadas:2,introducidas:1}}]}}});
  await a.flush();assert.equal(fs.readdirSync(directory).filter(f=>f.endsWith('.json')).length,1);
  const original=fs.readFileSync(path.join(directory,fs.readdirSync(directory)[0]),'utf8');assert.ok(!original.includes('secret'));assert.ok(original.includes('Historia'));
  const altered=fixture();altered.escritores[1].texto_final='Changed';a.enqueue({bolo:{id:'bolo-2'}},altered);
  assert.equal(fs.readFileSync(path.join(directory,fs.readdirSync(directory)[0]),'utf8'),original);
  fail=false;const b=createBoloReportArchive({directory,enabled:true,send});await b.flush();
  assert.equal(captured.length,1);assert.equal(captured[0].bolo.id,'bolo-1');assert.equal(captured[0].writers[1].text,'Una\nHistoria');assert.equal(fs.readdirSync(directory).length,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('no preset or unfinished match is not archived',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scrib-report-test-'));try{
 const a=createBoloReportArchive({directory,enabled:false});assert.equal(a.enqueue({bolo:null},fixture()),false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
