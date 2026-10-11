'use strict';
window.ScribBusiness = function(h) {
  const {personLabel,esc,btn,field,input,area,request,openDialog,dialog,item,toast,renderPage}=h;
  const base='/scrib/backstage/api/';
  const euro=c=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format((Number(c)||0)/100);
  const amount=c=>((Number(c)||0)/100).toFixed(2);
  const seasonFor=value=>{const [year,month]=String(value).slice(0,7).split('-').map(Number);if(!year||!month||[7,8].includes(month))return '';const first=month>=9?year:year-1;return String(first%100).padStart(2,'0')+'-'+String((first+1)%100).padStart(2,'0');};
  const currentSeason=()=>seasonFor(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  const seasonLabel=value=>String(value||'').replace(/^(?:20)?(\d{2})\s*[-–—/]\s*(?:20)?(\d{2})$/,'$1-$2');
  const GROUPS={creation:['Creación del proyecto','10','% del neto'],music:['Música','2','% del neto'],publicity:['Publicidad y difusión','15','€ fijos'],mount:['Montaje y desmontaje','15','€ fijos'],direction:['Dirección','5','% del fondo'],dramaturgy:['Dramaturgia activa','5','% del fondo'],cast:['Elenco y técnica','90','% del fondo']};
  function agreementHtml(text){
    const lines=String(text).split('\n'),signature=lines.findIndex(line=>line.startsWith('Fdo. LA COMPAÑÍA')&&line.includes('Fdo. LA PERSONA COLABORADORA'));
    const tail=signature<0?[]:lines.slice(signature+1).filter(line=>line.trim()),names=tail.at(-1)?.trim().split(/\s{2,}/)||[];
    // Only structure the standard two-signature footer; custom templates keep all their text.
    const structured=signature>=0&&tail.length===2&&/^[_\s]+$/.test(tail[0])&&names.length===2,body=structured?lines.slice(0,signature):lines;
    const content=body.map(line=>{
      const check=line.match(/^\[([X ])\] (.+)$/);
      if(check)return `<div class="agreement-check ${check[1]==='X'?'is-checked':''}"><span aria-label="${check[1]==='X'?'Seleccionado':'Sin seleccionar'}">${check[1]==='X'?'✓':''}</span>${esc(check[2])}</div>`;
      if(line.startsWith('ACUERDO DE COLABORACIÓN'))return `<h2 class="agreement-title">${esc(line)}</h2>`;
      if(line==='CLÁUSULAS')return `<h2 class="agreement-clauses">${esc(line)}</h2>`;
      if(/^[A-ZÁÉÍÓÚÑ]+\. /.test(line)||line.startsWith('Fdo.'))return `<h3>${esc(line)}</h3>`;
      return line.trim()?`<p${/^(De una parte|Y de otra)/.test(line)?' class="agreement-party"':''}>${esc(line)}</p>`:'';
    }).join('');
    const signatures=structured?`<div class="agreement-signatures">${['LA COMPAÑÍA','LA PERSONA COLABORADORA'].map((label,i)=>`<section class="agreement-signature"><h3>${label}</h3><div class="agreement-signature-space" aria-hidden="true"></div><p>${esc(names[i].toLocaleUpperCase('es-ES'))}</p></section>`).join('')}</div>`:'';
    return `<header class="agreement-brand"><img src="/scrib/backstage/sutura-logo.png" alt="Sutura Teatro"></header><div class="agreement-content">${content}${signatures}</div>`;
  }
  const date=v=>new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'long',timeStyle:'short'}).format(new Date(v));
  let cache={},pending=new Set(),errors={},paths={},exporting=new Set(),cacheEpoch=0;
  const invoiceOrigins=new Map(),deleting=new Set(),deleteTokens=new Map();
  let previousHash=location.hash;
  function rememberInvoice(id,hash=location.hash){if(hash&&!hash.startsWith('#invoice/'))invoiceOrigins.set(id,{hash,x:window.scrollX||0,y:window.scrollY||0});}
  document.addEventListener('click',event=>{const anchor=event.target.closest?.('a[href^="#invoice/"]');if(anchor)rememberInvoice(anchor.getAttribute('href').slice(9));},true);
  window.addEventListener('hashchange',event=>{const next=location.hash,old=event.oldURL?new URL(event.oldURL).hash:previousHash;if(next.startsWith('#invoice/')&&!invoiceOrigins.has(next.slice(9)))rememberInvoice(next.slice(9),old);previousHash=next;});
  function closeInvoice(id,eventId){const origin=invoiceOrigins.get(id)||{hash:'#production/'+eventId,x:0,y:0};location.hash=origin.hash;renderPage();requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(origin.x,origin.y)));}
  function iconButton(action,id,label,icon='trash') {
    const drawing=icon==='close'?'<path d="m6 6 12 12M18 6 6 18"/>':'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>';
    return `<button type="button" class="button document-icon ${icon==='trash'?'danger':''}" data-action="${esc(action)}" data-id="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg></button>`;
  }
  function invoiceFiles(r){return (r.uploads||[]).map(u=>`<a class="button small" href="${base}business/invoice-document/${esc(u.id)}" target="_blank" rel="noopener noreferrer">▤ ${esc(u.name)} · Ver PDF</a>`).join('');}
  function invoiceList(rows){return `<div class="invoice-list">${rows.sort((a,b)=>b.created.localeCompare(a.created)).map(r=>`<article class="invoice-card"><a class="invoice-card-link" href="#invoice/${esc(r.id)}"><strong>${esc(r.issuer.legalName)}</strong><span>${esc(r.eventTitle)} · ${esc(r.date)}</span><b>${euro(r.total)}</b></a><div class="invoice-card-actions">${(r.uploads||[]).length?'<span class="badge cyan">PDF firmado subido</span>':'<span class="badge gold">Sin PDF firmado</span>'}${iconButton('business-invoice-delete',r.id,'Eliminar factura de '+r.issuer.legalName)}</div>${(r.uploads||[]).length?`<div class="actions">${invoiceFiles(r)}</div>`:''}</article>`).join('')||'<p class="muted">Todavía no hay facturas.</p>'}</div>`;}
  // Printing must start at the document beginning, not the modal's screen scroll.
  let printScroll=null;
  window.addEventListener('beforeprint',()=>{
    printScroll={dialog:dialog.scrollTop,x:window.scrollX,y:window.scrollY};
    dialog.scrollTop=0;window.scrollTo(0,0);
    document.querySelectorAll('.report-story').forEach(n=>n.open=true);
  });
  window.addEventListener('afterprint',()=>{
    if(printScroll){dialog.scrollTop=printScroll.dialog;window.scrollTo(printScroll.x,printScroll.y);printScroll=null;}
  });
  const admin=()=>h.state()?.user.role==='admin';
  function load(key,path){paths[key]=path;if(pending.has(key))return;const epoch=cacheEpoch;pending.add(key);request(path).then(v=>{if(epoch===cacheEpoch){cache[key]=v;delete errors[key];}}).catch(e=>{if(epoch===cacheEpoch)errors[key]=e.message;}).finally(()=>{if(epoch===cacheEpoch){pending.delete(key);if(!dialog.open)renderPage();}});}
  function get(key,path){if(!cache[key]&&!errors[key])load(key,path);return cache[key];}
  function records(){return cache.overview?.records||[];}
  function record(type,id){return records().find(r=>r.type===type&&r.id===id)||{version:0,id};}
  function loading(key){return `<p class="notice">${esc(errors[key]||'Cargando…')}</p>${btn('business-refresh','Actualizar')}`;}
  function link(route,label){return `<a class="button" href="#${esc(route)}">${esc(label)}</a>`;}
  function paymentsPanel(event){
    if(!admin())return '';
    const group=h.eventSeries(event),summaries=group.map(e=>get('payments-'+e.id,'business/summary/'+e.id));
    const error=group.map(e=>errors['payments-'+e.id]).find(Boolean),ready=summaries.every(Boolean);
    let content;
    if(!ready){
      content=`<p class="event-payments-status" role="status">${esc(error?'No se pudo cargar el resumen. Puedes entrar al detalle o actualizar.':'Cargando acuerdos y pagos…')}</p>`;
    }else{
      const agreements={total:0,generated:0,missing:0,unsigned:0,signed:0,review:0,reviewed:0};
      const payments={assigned:0,paid:0,pending:0},people=new Set();
      for(const s of summaries){
        for(const key of Object.keys(agreements))agreements[key]+=s.agreements[key];
        for(const key of Object.keys(payments))payments[key]+=s.payments[key];
        s.payments.pendingPeople.forEach(id=>people.add(id));
      }
      const generation=agreements.total?agreements.missing?`${agreements.missing} sin generar`:'Todos generados':'Elenco pendiente';
      content=`<div class="event-payments-metrics">
        <div class="payment-metric violet"><span aria-hidden="true">▤</span><small>Acuerdos generados</small><strong>${agreements.generated}<span> / ${agreements.total}</span></strong><p>${generation}</p></div>
        <div class="payment-metric gold"><span aria-hidden="true">✎</span><small>Por firmar</small><strong>${agreements.unsigned}</strong><p>${agreements.signed} firmados</p></div>
        <div class="payment-metric cyan"><span aria-hidden="true">✓</span><small>Por revisar</small><strong>${agreements.review}</strong><p>${agreements.reviewed} revisados</p></div>
        <div class="payment-metric coral"><span aria-hidden="true">€</span><small>Personas por pagar</small><strong>${people.size}</strong><p>${payments.assigned?euro(payments.pending)+' pendientes':'Sin importes asignados'}</p></div>
      </div>${payments.assigned?`<div class="event-payments-totals"><span>Asignado <strong>${euro(payments.assigned)}</strong></span><span>Pagado <strong>${euro(payments.paid)}</strong></span></div>`:''}`;
    }
    return `<section class="panel event-payments-section"><a class="event-payments-link" href="#production/${esc(event.id)}" aria-label="Pagos de ${esc(event.title)} · ver acuerdos y liquidación"><div class="event-payments-head"><h2>💶 Pagos</h2>${group.length>1?`<span class="badge">${group.length} funciones</span>`:''}<span class="event-payments-arrow" aria-hidden="true">↗</span></div>${content}<span class="event-payments-enter">Ver acuerdos y pagos <span aria-hidden="true">→</span></span></a></section>`;
  }
  function eventPanel(event){return `<section class="panel event-reports-section"><div class="panel-head"><h2>📚 Memoria de las partidas</h2>${btn('business-refresh','Actualizar')}</div><p class="muted section">Los informes se guardan al terminar con la configuración de este bolo cargada en Control. Se consultan aquí sin generar PDFs automáticamente.</p>${reportList(event.id)}</section>`;}
  function reportList(id){const group=h.eventSeries(item(id)),responses=group.map(e=>get('reports-'+e.id,'reports/event/'+e.id)),key=group.find((e,i)=>!responses[i])?.id||id,c=responses.every(Boolean)?{reports:responses.flatMap(v=>v.reports).sort((a,b)=>b.endedAt-a.endedAt)}:null;return c?`<div class="report-list section">${c.reports.map(r=>`<article class="saved-match-card">${link('report/'+r.id,date(r.endedAt)+' · '+Object.values(r.writers).map(w=>w.name).join(' / '))}${btn('business-instagram','▧ Instagram · ZIP',r.id,'small')}</article>`).join('')||'<p class="muted">Todavía no hay partidas archivadas para este bolo.</p>'}</div>`:`<p class="notice">${esc(errors['reports-'+key]||'Cargando…')}</p>`;}
  function report(id){const key='report-'+id,r=get(key,'reports/match/'+id);if(!r)return loading(key);
    const scores=r.score||{},stats=r.stats?.players||{};
    return `<article class="match-report printable"><div class="page-head no-print"><div><p class="eyebrow">LA MEMORIA DEL VIDEOJUEGO</p><h1>${esc(r.bolo.title)}</h1><p class="muted">${esc(date(r.endedAt))} · ${Math.round((r.endedAt-r.startedAt)/60000)} minutos</p></div><div class="actions">${link('event/'+r.bolo.id,'← Bolo')}${btn('business-print','↓ Exportar PDF')}${btn('business-instagram','▧ Instagram · ZIP',r.id)}</div></div><div class="print-only"><h1>Informe de partida · ${esc(r.bolo.title)}</h1><p>${esc(date(r.endedAt))}</p></div><div class="grid cols2">${['1','2'].map(p=>{const w=r.writers[p],s=stats[p]||{},team=r.muses?.equipos?.[p]||{},rank=[...(team.musas||[])].sort((a,b)=>(b.stats?.introducidas||0)-(a.stats?.introducidas||0));return `<section class="panel report-team ${p==='1'?'blue':'red'}"><p class="eyebrow">${p==='1'?'EQUIPO AZUL':'EQUIPO ROJO'}</p><h2>${esc(w.name)}</h2><p class="report-score">${scores.disponible?esc(scores.jugadores?.[p]?.total)+' <small>puntos</small>':'Puntuación no disponible'}</p><div class="report-metrics">${[['✍ Palabras',s.palabrasTotal],['💎 Únicas',s.palabrasUnicas],['PPM · pulsaciones/min',s.ritmoPpm],['🎨 Inspiración',s.valorInspiracion??s.vida?.actual],['📚 Riqueza léxica',s.palabrasTotal?Math.round(100*s.palabrasUnicas/s.palabrasTotal)+'%':'—']].map(([l,v])=>`<div><small>${esc(l)}</small><strong>${esc(v??'—')}</strong></div>`).join('')}</div><div class="report-criteria section">${(scores.categorias||[]).map(c=>`<div><span>${esc(c.etiqueta||c.titulo||c.nombre||c.id)}</span><strong>${esc(c.puntos?.[p]??'—')}</strong></div>`).join('')}</div><details class="report-story section" open><summary>📖 La historia · contraer / expandir</summary><div>${esc(w.text)}</div></details><h3 class="section">🎨 Sus musas</h3><div class="report-ranking">${rank.map((m,i)=>`<div><span>#${i+1} ${esc(m.nombre)}</span><strong>${m.stats?.introducidas||0} incorporadas <small>de ${m.stats?.enviadas||0}</small></strong></div>`).join('')||'<p class="muted">Sin musas registradas.</p>'}</div></section>`;}).join('')}</div><details class="panel section no-print"><summary>Configuración utilizada</summary><pre>${esc(JSON.stringify(r.configuration?.parametros||{},null,2))}</pre></details></article>`;
  }
  function totals(personId=''){const sums={};for(const s of records().filter(r=>r.type==='settlement'))for(const d of s.days)for(const a of d.allocations){if(personId&&personId!==a.personId)continue;const season=seasonLabel(s.season),key=season+'|'+a.personId,t=sums[key]||={season,personId:a.personId,total:0,paid:0};t.total+=a.amount;t.paid+=a.paid?a.amount:0;}return Object.values(sums).sort((a,b)=>b.season.localeCompare(a.season)||a.personId.localeCompare(b.personId));}
  function totalsHtml(person=''){const rows=totals(person);return `<div class="finance-table"><table><thead><tr><th>Temporada</th>${person?'':'<th>Persona</th>'}<th>Generado</th><th>Pagado</th><th>Pendiente</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.season)}</td>${person?'':`<td>${personLabel(r.personId)}</td>`}<td>${euro(r.total)}</td><td>${euro(r.paid)}</td><td>${euro(r.total-r.paid)}</td></tr>`).join('')||`<tr><td colspan="${person?4:5}">Todavía no hay importes asignados.</td></tr>`}</tbody></table></div>`;}
  function personHeading(id,name,subtitle='') {
    const p=item(id),label=name||p?.name||'Ficha archivada';
    const initials=label.split(/[\s_.-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    const photo=/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(p?.image||'')
      ? `<img class="finance-avatar" src="/scrib/backstage/images/${esc(p.image)}" alt="" width="64" height="64" loading="lazy">`
      : `<span class="finance-avatar finance-initials" aria-hidden="true">${esc(initials)}</span>`;
    return `<div class="finance-person">${photo}<div><h3>${personLabel(id,label)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div>`;
  }
  function productionCard(e) {
    const group=h.eventSeries(e),settlements=group.map(f=>record('settlement',f.id)),s={season:[...new Set(settlements.map(s=>seasonLabel(s.season)).filter(Boolean))].join(' / ')},days=settlements.flatMap(s=>s.days||[]),allocations=days.flatMap(d=>d.allocations||[]);
    const income=days.reduce((sum,d)=>sum+(Number(d.income)||0),0),pending=allocations.reduce((sum,a)=>sum+(a.paid?0:Number(a.amount)||0),0);
    const start=new Date(e.start.length===10?e.start+'T12:00:00Z':e.start),valid=Number.isFinite(start.getTime());
    const part=options=>valid?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',...options}).format(start):'—';
    const people=new Set(group.flatMap(f=>f.cast||[]).map(c=>c.personId)).size;
    return `<a class="production-card${h.eventInactive(e)?' is-completed':''}" href="#production/${esc(e.id)}"><div class="production-date" aria-label="${esc(part({dateStyle:'long'}))}"><span>${esc(part({month:'short'}))}</span><strong>${esc(part({day:'2-digit'}))}</strong><small>${esc(part({year:'numeric'}))}</small></div><div class="production-card-body"><div class="production-card-top"><span class="production-season">${esc(s.season||seasonFor(e.start)||'Fuera de temporada')}</span><span class="production-card-arrow" aria-hidden="true">↗</span></div><h3>${esc(e.title)}</h3><p class="production-datetime"><time datetime="${esc(e.start)}">${esc(h.seriesDates(e))}${group.length===1?' · '+esc(h.hour(e.start)):''}</time></p><p class="production-venue">⌖ ${esc([e.venue,e.city].filter(Boolean).join(' · ')||'Espacio por confirmar')}</p><div class="production-card-tags">${group.length>1?`<span>▦ ${group.length} funciones</span>`:''}<span>♟ ${people} ${people===1?'persona':'personas'}</span>${days.length?`<span>◷ ${days.length} ${days.length===1?'día liquidado':'días liquidados'}</span>`:'<span>Liquidación pendiente</span>'}</div><div class="production-card-money"><div><small>Ingresos registrados</small><strong>${days.length?euro(income):'—'}</strong></div><div><small>Pendiente de pago</small><strong>${days.length?euro(pending):'—'}</strong></div></div></div></a>`;
  }
  function overview(){if(!admin())return '<p class="notice">Gestión económica y fiscal reservada a administración.</p>';if(!get('overview','business/overview'))return loading('overview');return `<div class="page-head"><div><p class="eyebrow">PRODUCCIÓN, CON TODO ATADO</p><h1>Producción y cuentas</h1><p class="muted">Importes asignados, pagos registrados y documentos.</p></div><div class="actions">${btn('business-settings','✍ Entidad y plantilla')}${btn('business-refresh','Actualizar')}</div></div><section class="panel"><h2>💶 Lo que va generando cada persona</h2>${totalsHtml()}</section><section class="panel section"><h2>📍 Bolos</h2><div class="production-grid section">${h.eventGroups().map(g=>g[0]).filter(e=>e.eventType!=='rehearsal').sort((a,b)=>b.start.localeCompare(a.start)).map(productionCard).join('')||'<p class="muted">Todavía no hay bolos.</p>'}</div></section><section class="panel section"><h2>🧾 Facturas</h2>${invoiceList(records().filter(r=>r.type==='invoice'))}</section>`;}
  function agreementCards(event,agreements,people){
    const eligible=new Set([...h.resolveCast(event.cast).map(c=>c.personId),...(record('settlement',event.id).days||[]).flatMap(d=>d.allocations.filter(a=>a.breakdown?.length).map(a=>a.personId))]);
    const missing=people.filter(p=>eligible.has(p)&&!agreements.some(c=>c.personId===p&&c.status!=='revoked')).map(p=>`<article class="agreement-card"><div class="service-top">${personHeading(p)}<span class="badge gold">Sin acuerdo</span></div><div class="actions section">${btn('business-agreement-upload','Subir acuerdo firmado',event.id+'|'+p,'primary')}</div></article>`).join('');
    return missing+agreements.map(c=>`<article class="agreement-card"><div class="service-top">${personHeading(c.personId,c.name)}<span class="badge">${({generated:'Preparado',sent:'Enviado',uploaded:'Subido · pendiente de revisión',reviewed:'Revisado',revoked:'Revocado'})[c.status]}</span></div><div class="actions section">${btn('business-agreement-view','Ver acuerdo / PDF',c.id)}${!['revoked','reviewed'].includes(c.status)?`${btn('business-agreement-upload','Subir acuerdo firmado',event.id+'|'+c.personId+'|'+c.id,'primary')}<a class="button" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Enlace personal de firma</a>`:''}${c.status!=='revoked'?btn('business-copy','Copiar enlace',c.id):''}${c.uploads.map(u=>`<div class="document-file"><a class="button small" href="${base}business/document/${esc(u.id)}">↓ ${esc(u.name)} · ${esc(u.created.slice(0,10))}</a>${iconButton('business-agreement-upload-delete',c.id+'|'+u.id,'Eliminar acuerdo subido: '+u.name)}</div>`).join('')}${c.status==='uploaded'?btn('business-review','Marcar revisado',c.id):''}${c.status!=='revoked'?btn('business-revoke','Revocar enlace',c.id,'danger small'):''}</div></article>`).join('');
  }
  function production(id) {
    if(!admin())return overview();
    const e=item(id);if(!e)return '<p>Bolo no disponible.</p>';
    const key='agreements-'+id,a=get(key,'business/agreements/'+id),v=get('overview','business/overview');
    if(!a||!v)return loading(!a?key:'overview');
    const s=record('settlement',id),days=s.days||[],allocations=days.flatMap(d=>d.allocations||[]);
    // Preserve allocations to people who have since left the cast.
    const people=[...new Set([...e.cast.map(c=>c.personId),...allocations.map(c=>c.personId)])];
    const summary=days.length?`<div class="settlement-summary section"><div><small>Temporada</small><strong>${esc(s.season)}</strong></div><div><small>Ingresos</small><strong>${euro(days.reduce((sum,d)=>sum+d.income,0))}</strong></div><div><small>Gastos</small><strong>${euro(days.reduce((sum,d)=>sum+d.expenses,0))}</strong></div></div>`:'<p class="muted section">Aún no hay liquidación.</p>';
    const cards=people.map(p=>{
      const assigned=allocations.filter(a=>a.personId===p),total=assigned.reduce((sum,a)=>sum+a.amount,0),paid=assigned.reduce((sum,a)=>sum+(a.paid?a.amount:0),0);
      const roles=[...new Set(h.resolveCast(e.cast).filter(c=>c.personId===p).map(c=>c.role))].join(' · ');
      const signed=a.agreements.some(c=>c.personId===p&&c.status==='reviewed'&&c.uploads.length);
      return `<article class="settlement-person-card">${personHeading(p,'',roles)}<span class="badge ${total&&paid===total?'cyan':'gold'}">${total?paid===total?'✓ Pagado':paid?'◷ Pago parcial':'◷ Pendiente de pago':'Sin asignación'}</span><div class="settlement-person-money"><div><small>Asignado</small><strong>${assigned.length?euro(total):'—'}</strong></div><div><small>Pendiente</small><strong>${assigned.length?euro(total-paid):'—'}</strong></div></div>${assigned.flatMap(a=>a.breakdown||[]).length?`<ul class="finance-breakdown">${assigned.flatMap(a=>a.breakdown||[]).map(part=>`<li>${esc(part.label)} <strong>${euro(part.amount)}</strong></li>`).join('')}</ul>`:''}<div class="actions">${btn('business-person','Ficha económica',p,'finance-action')}${btn('business-payments','Registrar pago',id+'|'+p,'finance-action')}${signed?btn('business-invoice','Crear factura',id+'|'+p,'finance-action invoice-action'):'<button type="button" class="button invoice-action is-blocked" disabled aria-disabled="true" title="Bloqueado: falta el acuerdo firmado y revisado de este bolo">Factura · falta acuerdo firmado</button>'}</div></article>`;
    }).join('');
    return `<div class="page-head"><div><p class="eyebrow">✍ PRODUCCIÓN Y CUENTAS</p><h1>${esc(e.title)}</h1><p class="muted">${esc(h.niceDate(e.start))} · ${esc(h.hour(e.start))} · ${esc(e.venue)}</p></div><div class="actions">${link('event/'+id,'← Ficha')}${btn('business-refresh','Actualizar')}</div></div>
      ${h.seriesLinks(e,'production')}<section class="panel agreements-panel"><div class="panel-head"><h2>Acuerdos de colaboración</h2><div class="actions">${btn('business-agreement-preview','Ver modelo de acuerdo',id)}${btn('business-generate','＋ Preparar acuerdos',id)}</div></div><div class="agreement-grid section">${agreementCards(e,a.agreements,people)||'<p class="muted">Añade el elenco para subir sus acuerdos.</p>'}</div>${btn('business-send-links','Enviar acuerdos · elegir destinatarios',id,'section')}</section>
      <section class="panel section settlement-panel"><div class="panel-head"><h2>💶 Liquidación</h2>${btn('business-settlement','Neto y reparto automático',id,'finance-action')}</div>${summary}<div class="settlement-people section">${cards||'<p class="muted">Añade el elenco en la ficha del bolo para preparar el reparto.</p>'}</div></section><section class="panel section"><h2>🧾 Facturas del bolo</h2>${invoiceList(records().filter(r=>r.type==='invoice'&&r.eventId===id))}</section>`;
  }
  function invoice(id){
    if(!admin())return overview();if(!get('overview','business/overview'))return loading('overview');
    const r=record('invoice',id);if(!r.status)return '<p>Factura no encontrada.</p>';
    const number=r.number?[r.series,r.number].filter(Boolean).join(' / '):'';
    return `<article class="invoice-document printable panel"><div class="invoice-toolbar no-print"><div class="actions">${btn('business-print','↓ Guardar PDF')}${iconButton('business-invoice-delete',r.id,'Eliminar factura')}</div>${iconButton('business-invoice-close',r.id,'Cerrar factura y volver','close')}</div><h1>Factura${number?' · '+esc(number):''}</h1><p class="section">Fecha: ${esc(r.date)}</p><div class="grid cols2 section"><div><h3>Emisor</h3><p class="notes">${esc(r.issuer.legalName)}\n${esc(r.issuer.taxId)}\n${esc(r.issuer.address)}</p></div><div><h3>Destinatario</h3><p class="notes">${esc(r.recipient.name)}\n${esc(r.recipient.taxId)}\n${esc(r.recipient.address)}</p></div></div><h3 class="section">Concepto</h3><p class="notes section">${esc(r.concept||'Participación en <SCRI> B · '+r.eventTitle)}</p><div class="invoice-line section"><strong>Día de función</strong><strong>Honorarios</strong></div>${r.lines.map(l=>`<div class="invoice-line"><span>${esc(l.date)}</span><strong>${euro(l.amount)}</strong></div>`).join('')}<div class="invoice-totals section">${[['Base imponible',r.base],['IVA '+r.issuer.vat+'%',r.vat],['IRPF '+r.issuer.withholding+'%',-r.withholding],['Total a percibir',r.total]].map(([l,v])=>`<div class="invoice-line"><span>${esc(l)}</span><strong>${euro(v)}</strong></div>`).join('')}</div><p class="notes section">${r.issuer.iban?'El pago se realizará mediante transferencia bancaria a la cuenta '+esc(r.issuer.iban)+'.':'El pago se realizará mediante transferencia bancaria. Cuenta bancaria pendiente de indicar.'}</p><div class="invoice-signature" role="group" aria-label="Firma de la factura"><div class="invoice-signature-field"><div class="invoice-signature-space" aria-hidden="true"></div><span>Firma</span></div><div class="invoice-signature-field"><div class="invoice-signature-space" aria-hidden="true"></div><span>Nombre de quien firma</span></div></div><section class="invoice-signed section no-print"><div class="panel-head"><h2>Factura firmada</h2>${btn('business-invoice-upload','↑ Subir PDF firmado',r.id)}</div><div class="actions section">${invoiceFiles(r)||'<p>Aún no has subido la factura firmada.</p>'}</div></section></article>`;
  }
  function form(title,body,onSubmit,success='Guardado.'){openDialog('business',title,`<form id="business-form">${body}<p class="form-error" role="alert"></p><div class="actions section">${btn('close-dialog','Cancelar')}<button type="submit" class="button primary">Guardar</button></div></form>`);const f=dialog.querySelector('form');f.addEventListener('submit',async e=>{e.preventDefault();const b=f.querySelector('[type=submit]');if(b.disabled)return;b.disabled=true;try{await onSubmit(f);dialog.close();invalidate();renderPage();toast(success);}catch(e){f.querySelector('.form-error').textContent=e.message;}finally{b.disabled=false;}});return f;}
  function invalidate(){cacheEpoch++;cache={};errors={};paths={};pending.clear();}
  async function ensure(){cache.overview=await request('business/overview');}
  async function agreementPreview(id) {
    const result=await request('business/agreement-preview/'+id);
    openDialog('business','Vista previa del acuerdo',`<div class="agreement-preview-head"><span class="badge gold">MODELO ACTUAL · VISTA PREVIA</span><p>${esc(result.eventTitle)}</p><p class="muted tiny">No genera enlaces ni envía documentos.${result.pending?' Los datos pendientes aparecen entre corchetes.':''}</p><label class="field">Persona del elenco<select id="agreement-preview-person">${result.previews.map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join('')}</select></label></div><article class="agreement-document agreement-preview"><div id="agreement-preview-text">${agreementHtml(result.previews[0].text)}</div></article>`);
    const select=dialog.querySelector('#agreement-preview-person'),body=dialog.querySelector('#agreement-preview-text');
    select.addEventListener('change',()=>{const preview=result.previews[Number(select.value)];if(preview)body.innerHTML=agreementHtml(preview.text);});
  }
  async function settings(){await ensure();const s=record('settings','organizer'),source=await request('business/template');form('Entidad y plantilla de acuerdos',`<p class="notice">Formato con casillas como el modelo de Drive. Guardar no genera ni envía acuerdos.</p>${['name','taxId','address','representative'].map((k,i)=>field(['Nombre / razón social','NIF / CIF','Domicilio fiscal','Representante'][i],input(k,s[k]||'','text','required maxlength="1000"'))).join('')}${field('Plantilla editable',area('template',s.template||source.text,'required rows="20" maxlength="22000"'))}<p class="hint">Variables: {persona}, {documento}, {entidad}, {cif}, {domicilio}, {representante}, {bolo}, {fecha}, {lugar}, {papel}, {roles_checks}, {fechas_checks}, {horario}, {fecha_firma}.</p>`,f=>request('business/settings',{...Object.fromEntries(new FormData(f)),id:'organizer',version:s.version}));}
  function person(id){if(!admin())return;dialog.close();location.hash='#person/'+id;renderPage();}
  function personPanel(id){
    if(!admin())return '';
    if(!get('overview','business/overview'))return `<section class="section person-finances"><h2>Temporadas y datos fiscales</h2>${loading('overview')}</section>`;
    const fiscal=record('billing',id),fields=[['legalName','Nombre legal'],['taxId','NIF / documento'],['address','Domicilio fiscal'],['iban','IBAN'],['vat','IVA'],['withholding','IRPF']];
    return `<section class="section person-finances"><h2>💶 Por temporada</h2>${totalsHtml(id)}<div class="report-list section">${records().filter(r=>r.type==='settlement'&&r.days.some(d=>d.allocations.some(a=>a.personId===id))).map(s=>link('production/'+s.id,(item(s.id)?.title||'Bolo')+' · '+seasonLabel(s.season))).join('')}</div><div class="panel-head section"><h2>Datos fiscales</h2>${btn('business-billing','Editar datos fiscales',id)}</div><dl class="person-fiscal-data">${fields.map(([key,label])=>{const value=fiscal[key],known=value!==undefined&&value!==null&&value!=='';return `<div><dt>${label}</dt><dd${known?'':' class="muted"'}>${known?esc(value)+(['vat','withholding'].includes(key)?' %':''):'Pendiente'}</dd></div>`;}).join('')}</dl></section>`;
  }
  async function billing(id){await ensure();const s=record('billing',id);form('Datos fiscales · '+item(id).name,`${[['legalName','Nombre legal'],['taxId','NIF / documento'],['address','Domicilio completo'],['iban','IBAN'],['vat','IVA (%) · dejar vacío si pendiente'],['withholding','IRPF (%) · dejar vacío si pendiente']].map(([k,l])=>field(l,input(k,s[k]??'','text','maxlength="1000"'))).join('')}`,f=>request('business/billing',{...Object.fromEntries(new FormData(f)),id,version:s.version}));}
  async function uploadAgreement(value){
    if(!admin())throw new Error('Subida reservada a administración.');
    const [eventId,personId,agreementId='']=value.split('|'),event=item(eventId),person=item(personId);
    if(!event||!person)throw new Error('Persona o bolo no disponible.');
    await ensure();const settingsVersion=record('settings','organizer').version;
    const f=form('Subir acuerdo firmado · '+person.name,`${personHeading(personId)}<p class="section">${esc(event.title)}</p>${field('Acuerdo firmado (PDF)','<input type="file" name="pdf" accept="application/pdf,.pdf" required>')}<p class="hint">Hasta 3 MB. El archivo se conserva intacto y queda pendiente de revisión.</p>`,async f=>{
      const file=f.querySelector('[name=pdf]').files[0];
      if(!file||file.size<1||file.size>3*1024*1024||!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Selecciona un PDF de hasta 3 MB.');
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.onload=()=>resolve(String(reader.result).split(',',2)[1]);reader.readAsDataURL(file);});
      return request('business/agreement-upload',{eventId,personId,agreementId,eventVersion:event.version,settingsVersion,name:file.name,base64:encoded});
    },'Acuerdo subido · pendiente de revisión.');
    f.querySelector('[type=submit]').textContent='Subir acuerdo firmado';
  }
  async function uploadInvoice(id){
    if(!admin())throw new Error('Subida reservada a administración.');
    await ensure();const r=record('invoice',id);if(!r.status)throw new Error('Factura no disponible.');
    const f=form('Subir factura firmada · '+r.issuer.legalName,`${field('Factura firmada (PDF)','<input type="file" name="pdf" accept="application/pdf,.pdf" required>')}<p class="hint">Hasta 3 MB. Se conserva el PDF original sin modificarlo.</p>`,async f=>{
      const file=f.querySelector('[name=pdf]').files[0];
      if(!file||file.size<1||file.size>3*1024*1024||!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Selecciona un PDF de hasta 3 MB.');
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.onload=()=>resolve(String(reader.result).split(',',2)[1]);reader.readAsDataURL(file);});
      const result=await request('business/invoice-upload',{id,version:r.version,name:file.name,base64:encoded});
      if(result.ok!==true||result.item?.id!==id||!result.item.uploadId)throw new Error('No se pudo confirmar la subida. Actualiza antes de intentarlo de nuevo.');
    },'Factura firmada subida.');
    f.querySelector('[type=submit]').textContent='Subir factura firmada';
  }
  async function deleteDocument(node,kind,id){
    if(!admin())throw new Error('Eliminación reservada a administración.');
    const key=kind+'|'+id;if(deleting.has(key)||node.disabled)return;
    let payload,label,eventId;
    if(kind==='invoice'){
      const r=record('invoice',id);if(!r.status)throw new Error('Actualiza la lista de facturas.');
      payload={id,version:r.version};label='la factura de '+r.issuer.legalName;eventId=r.eventId;
    }else{
      const [agreementId,uploadId]=id.split('|'),c=Object.values(cache).flatMap(v=>v.agreements||[]).find(c=>c.id===agreementId),u=c?.uploads.find(u=>u.id===uploadId);
      if(!u)throw new Error('Actualiza la lista de acuerdos.');
      payload={id:uploadId,agreementId};label='el acuerdo subido «'+u.name+'» de '+c.name;
    }
    if(!window.confirm('¿Eliminar '+label+'? No se modifican los pagos registrados.'))return;
    deleting.add(key);node.disabled=true;
    const serialized=JSON.stringify(payload),prior=deleteTokens.get(key);
    const requestId=prior?.payload===serialized?prior.token:crypto.randomUUID();deleteTokens.set(key,{payload:serialized,token:requestId});
    try{
      const response=await request('business/'+(kind==='invoice'?'invoice-delete':'agreement-upload-delete'),{...payload,confirmed:true,requestId});
      if(response.ok!==true||response.item?.deleted!==true||response.item.id!==payload.id||response.item.kind!==kind)throw new Error('No se pudo confirmar la eliminación. Actualiza antes de continuar.');
      deleteTokens.delete(key);invalidate();
      if(kind==='invoice'&&location.hash==='#invoice/'+id)closeInvoice(id,eventId);else renderPage();
      toast('Documento eliminado de la ficha. Se conserva una copia privada recuperable.');
    }finally{deleting.delete(key);node.disabled=false;}
  }
  function allocationRows(event,d={},auto=false){const ids=[...new Set([...(auto?[]:event.cast.map(c=>c.personId)),...(d.allocations||[]).map(a=>a.personId)])];return ids.map(p=>{const a=d.allocations?.find(a=>a.personId===p)||{};return `<tr data-allocation="${esc(p)}"><th>${personLabel(p)}${(a.breakdown||[]).map(b=>`<small class="allocation-detail">${esc(b.label)} · ${euro(b.amount)}</small>`).join('')}</th><td>${input('amount',amount(a.amount),'text',`required inputmode="decimal" ${auto?'readonly':''}`)}${auto?`<small class="allocation-detail">${d.income>d.expenses?((a.amount||0)*100/(d.income-d.expenses)).toFixed(2):'0'} % del neto</small>`:''}</td><td><input type="checkbox" name="paid" ${a.paid?'checked':''} aria-label="Pagado ${esc(item(p)?.name||'')}"></td><td>${input('paymentDate',a.paymentDate||'','date')}</td><td>${input('reference',a.reference||'','text','maxlength="200"')}</td></tr>`;}).join('')||'<tr><td colspan="5">Introduce el neto y elige quién participa en cada apartado.</td></tr>';}
  function dayRow(event,d={}){
    const auto=d.mode?d.mode==='auto':!d.allocations,unique=[...new Set(event.cast.map(c=>c.personId))];
    const defaults={cast:unique,creation:[],music:[],publicity:[],mount:[],direction:[],dramaturgy:[]};
    const people=h.state().items.filter(p=>p.kind==='person'&&!p.archived||p.kind==='person'&&Object.values(d.members||{}).some(ids=>ids.includes(p.id))).sort((a,b)=>a.name.localeCompare(b.name,'es'));
    return `<fieldset class="settlement-day section"><legend>Día de función</legend><div class="form-row">${field('Fecha',input('day-date',d.date||event.start.slice(0,10),'date','required'))}${field('Neto ingresado por sala (€)',input('income',amount(d.income),'text','required inputmode="decimal"'))}${field('Gastos adicionales (€)',input('expenses',amount(d.expenses),'text','required inputmode="decimal"'))}</div>${field('Reparto',`<select name="allocation-mode"><option value="auto" ${auto?'selected':''}>Automático · regla del acuerdo</option><option value="manual" ${auto?'':'selected'}>Manual · conservar o ajustar importes</option></select>`)}<details class="revenue-rule" ${auto?'':'hidden'}><summary>Regla y personas del reparto</summary><p class="hint">10 % creación y 2 % música sobre el neto. Fijos para publicidad y montaje. El resto se divide 5 / 5 / 90 entre las categorías activas, y a partes iguales entre sus integrantes. Sin destinatario, creación y música quedan pendientes, no se reasignan. Los fijos son 15 € en el acuerdo; puedes ajustarlos por función.</p><div class="revenue-groups">${Object.entries(GROUPS).map(([key,[label,value,unit]])=>`<fieldset><legend>${esc(label)}</legend>${field(unit,input('rule-'+key,d.rule?.[key]??value,'text','required inputmode="decimal"'))}<div class="revenue-members">${people.map(p=>`<label class="check-option"><input type="checkbox" name="member-${key}" value="${esc(p.id)}" ${(d.members?.[key]||defaults[key]).includes(p.id)?'checked':''}>${personLabel(p.id)}</label>`).join('')}</div></fieldset>`).join('')}</div></details><p class="revenue-preview hint" role="status"></p><div class="finance-table"><table><thead><tr><th>Persona</th><th>Asignado (€)</th><th>Pagado</th><th>Fecha pago</th><th>Referencia</th></tr></thead><tbody>${allocationRows(event,d,auto)}</tbody></table></div>${btn('business-remove-day','Quitar este día','','small danger')}</fieldset>`;
  }
  function readDay(n){return {date:n.querySelector('[name=day-date]').value,income:n.querySelector('[name=income]').value,expenses:n.querySelector('[name=expenses]').value,mode:n.querySelector('[name=allocation-mode]').value,rule:Object.fromEntries(Object.keys(GROUPS).map(k=>[k,n.querySelector(`[name=rule-${k}]`).value])),members:Object.fromEntries(Object.keys(GROUPS).map(k=>[k,[...n.querySelectorAll(`[name=member-${k}]:checked`)].map(x=>x.value)])),allocations:[...n.querySelectorAll('[data-allocation]')].map(a=>({personId:a.dataset.allocation,amount:a.querySelector('[name=amount]').value,paid:a.querySelector('[name=paid]').checked,paymentDate:a.querySelector('[name=paymentDate]').value,reference:a.querySelector('[name=reference]').value}))};}
  async function computeDay(n,event){const epoch=(n.__epoch||0)+1;n.__epoch=epoch;const data=readDay(n),auto=data.mode==='auto';n.querySelector('.revenue-rule').hidden=!auto;if(!auto){n.querySelectorAll('[name=amount]').forEach(x=>x.readOnly=false);n.querySelector('.revenue-preview').textContent='Reparto manual; no se sustituyen los importes.';return;}
    try{const response=await request('business/settlement-preview',{id:event.id,eventVersion:event.version,day:data});if(!n.isConnected||n.__epoch!==epoch)return;const d=response.item,current=readDay(n).allocations;for(const a of d.allocations){const payment=current.find(p=>p.personId===a.personId);if(payment)Object.assign(a,{paid:payment.paid,paymentDate:payment.paymentDate,reference:payment.reference});}n.querySelector('tbody').innerHTML=allocationRows(event,d,true);n.querySelector('.revenue-preview').textContent='Disponible: '+euro(d.income-d.expenses)+' · Repartido: '+euro(d.allocations.reduce((sum,a)=>sum+a.amount,0))+' · Sin asignar: '+euro(d.unassigned);}
    catch(error){if(n.isConnected&&n.__epoch===epoch)n.querySelector('.revenue-preview').textContent=error.message;throw error;}
  }
  async function settlement(id){await ensure();const e=item(id),s=record('settlement',id);const f=form('Liquidación · '+e.title,`${field('Temporada',input('season',seasonLabel(s.season)||seasonFor(e.start)||currentSeason(),'text','required maxlength="7" placeholder="26-27"'))}<p class="hint">Neto después de la liquidación de sala; resta aquí únicamente gastos adicionales. El reparto existente permanece manual hasta que elijas automático. Para modificar un importe ya pagado, desmarca y guarda antes ese pago.</p><div class="settlement-days">${(s.days||[{}]).map(d=>dayRow(e,d)).join('')}</div>${btn('business-add-day','＋ Otro día',id,'section')}`,async f=>{await Promise.all([...f.querySelectorAll('.settlement-day')].map(n=>computeDay(n,e)));return request('business/settlement',{id,version:s.version,season:f.elements.namedItem('season').value,days:[...f.querySelectorAll('.settlement-day')].map(readDay)});});f.dataset.settlement=id;
    f.addEventListener('input',event=>{const n=event.target.closest('.settlement-day');if(!n||['paid','paymentDate','reference','amount'].includes(event.target.name))return;clearTimeout(n.__timer);n.__timer=setTimeout(()=>computeDay(n,e).catch(()=>{}),250);});
    await Promise.all([...f.querySelectorAll('.settlement-day')].map(n=>computeDay(n,e).catch(()=>{})));
  }
  async function payments(value){await ensure();const [eventId,personId]=value.split('|'),s=record('settlement',eventId),rows=(s.days||[]).filter(d=>d.allocations.some(a=>a.personId===personId));if(!rows.length)throw new Error('Registra primero el neto y el reparto.');form('Pagos · '+item(personId).name,`<p class="hint">Registro de pagos realizados fuera de esta web. No se envía dinero.</p>${rows.map(d=>{const a=d.allocations.find(a=>a.personId===personId);return `<fieldset class="settlement-day section" data-payment-day="${esc(d.date)}"><legend>${esc(d.date)} · ${euro(a.amount)}</legend><label class="check-option"><input name="paid" type="checkbox" ${a.paid?'checked':''}>✓ Pagado</label>${field('Fecha de pago',input('paymentDate',a.paymentDate||'','date'))}${field('Referencia',input('reference',a.reference||'','text','maxlength="200"'))}</fieldset>`;}).join('')}`,f=>{const days=structuredClone(s.days);for(const d of days){d.income=amount(d.income);d.expenses=amount(d.expenses);for(const a of d.allocations)a.amount=amount(a.amount);const n=f.querySelector(`[data-payment-day="${d.date}"]`);if(n){const a=d.allocations.find(a=>a.personId===personId);a.paid=n.querySelector('[name=paid]').checked;a.paymentDate=n.querySelector('[name=paymentDate]').value;a.reference=n.querySelector('[name=reference]').value;}}return request('business/settlement',{id:eventId,version:s.version,season:s.season,days});});}
  function choices(event,exclude=[]){return [...new Set([...event.cast.map(c=>c.personId),...(record('settlement',event.id).days||[]).flatMap(d=>d.allocations.map(a=>a.personId))])].filter(id=>!exclude.includes(id)).map(id=>`<label class="check-option"><input type="checkbox" name="people" value="${id}" checked>${personLabel(id)}</label>`).join('');}
  async function generate(id){await ensure();const e=item(id),s=record('settings','organizer');form('Preparar acuerdos · '+e.title,`<div class="recipient-list">${choices(e)}</div>`,f=>request('business/generate',{eventId:id,eventVersion:e.version,settingsVersion:s.version,people:[...f.querySelectorAll('[name=people]:checked')].map(n=>n.value)}));}
  async function invoiceForm(value){await ensure();const [eventId,personId]=value.split('|');form('Crear factura · '+item(personId).name,`${field('Fecha',input('date',new Date().toISOString().slice(0,10),'date','required'))}${field('Serie (opcional)',input('series','SUTURA','text','maxlength="60"'))}${field('Número (opcional)',input('number','','text','maxlength="60"'))}`,async f=>{const r=await request('business/invoice',{...Object.fromEntries(new FormData(f)),eventId,personId});rememberInvoice(r.item.id);location.hash='invoice/'+r.item.id;});}
  async function sendLinks(id){const a=await request('business/agreements/'+id);const valid=a.agreements.filter(c=>c.status!=='revoked'&&c.expires*1000>Date.now());form('Enviar enlaces de acuerdos',`<p class="notice">Selecciona una persona o todo el elenco. El siguiente paso muestra los mensajes exactos antes del envío automático individual.</p><div class="recipient-list">${valid.map(c=>`<label class="check-option"><input type="checkbox" name="people" value="${c.personId}" checked>${personLabel(c.personId,c.name)}</label>`).join('')}</div>${field('Mensaje',area('text','Hola {nombre}, te enviamos tu acuerdo para participar en {bolo}. En el enlace puedes descargarlo y devolverlo firmado. Gracias.','required maxlength="4000"'))}`,async f=>{const r=await request('whatsapp/preview',{eventId:id,agreements:true,text:f.elements.namedItem('text').value,people:[...f.querySelectorAll('[name=people]:checked')].map(n=>n.value)});setTimeout(()=>preview(r.item),0);});}
  function preview(draft){
    openDialog('business','Acuerdos personalizados',`<div class="notice">Pulsa Enviar para mandar los mensajes personalizados a todos los destinatarios elegidos. No hace falta confirmar cada mensaje. Si un envío queda sin confirmar, el lote se detiene y no se repite automáticamente.</div>${draft.people.map(p=>`<article class="panel section"><h3>${personLabel(p.id,p.name)}</h3><p>${esc(p.phone)}</p><div class="notes section">${esc(p.text)}</div></article>`).join('')}<form id="agreement-send"><p class="form-error" role="alert"></p><p class="send-status" role="status"></p><button type="submit" class="button primary" ${h.state().demo?'disabled':''}>Enviar ${draft.people.length} mensajes</button></form>`);
    const f=dialog.querySelector('form');
    f.addEventListener('submit',async e=>{
      e.preventDefault();const button=f.querySelector('button');if(button.disabled)return;
      button.disabled=true;const statuses=[];
      for(let i=0;i<draft.people.length;i++){
        button.textContent=`Enviando ${i+1}/${draft.people.length}…`;
        try{
          const r=await request('whatsapp/send',{draftId:draft.id,recipient:i});
          statuses.push(draft.people[i].name+': '+(r.item.status==='sent'?'Enviado':'No confirmado · revisar WhatsApp'));
          f.querySelector('.send-status').textContent=statuses.join('\n');
          if(r.item.status!=='sent')break;
        }catch(e){statuses.push(draft.people[i].name+': '+e.message);break;}
      }
      f.querySelector('.send-status').textContent=statuses.join('\n');
      invalidate();button.textContent='Proceso terminado · consultar estados';
    });
  }
  async function action(node){const {action:a,id}=node.dataset;if(!a.startsWith('business-'))return false;
    if(a==='business-instagram'){
      if(node.disabled||exporting.has(id))return true;
      exporting.add(id);node.disabled=true;
      try{const r=cache['report-'+id]||await request('reports/match/'+id);node.disabled=false;await window.ScribSavedReportSocial.download(r,node);toast('Carrusel exportado en PNG · ZIP.');}
      finally{exporting.delete(id);node.disabled=false;}
    }
    else if(a==='business-print'){const [page,routeId]=location.hash.slice(1).split('/');await window.ScribExport(h.state(),{kind:id?'agreement':page==='invoice'?'invoice':'report',id:id||routeId},node);}
    else if(a==='business-refresh'){if(node.disabled)return true;const label=node.innerHTML;node.disabled=true;node.textContent='Actualizando…';node.setAttribute('aria-busy','true');try{await Promise.all(Object.entries(paths).map(async([key,path])=>{cache[key]=await request(path);delete errors[key];}));renderPage();}finally{node.disabled=false;node.innerHTML=label;node.removeAttribute('aria-busy');}}
    else if(a==='business-settings')await settings();else if(a==='business-person')await person(id);else if(a==='business-billing')await billing(id);
    else if(a==='business-agreement-preview')await agreementPreview(id);
    else if(a==='business-agreement-upload')await uploadAgreement(id);
    else if(a==='business-invoice-upload')await uploadInvoice(id);
    else if(a==='business-invoice-delete')await deleteDocument(node,'invoice',id);
    else if(a==='business-agreement-upload-delete')await deleteDocument(node,'agreement-upload',id);
    else if(a==='business-invoice-close'){const r=record('invoice',id);closeInvoice(id,r.eventId);}
    else if(a==='business-settlement')await settlement(id);else if(a==='business-payments')await payments(id);else if(a==='business-add-day'){dialog.querySelector('.settlement-days').insertAdjacentHTML('beforeend',dayRow(item(id)));await computeDay(dialog.querySelector('.settlement-day:last-child'),item(id)).catch(()=>{});}
    else if(a==='business-remove-day')node.closest('.settlement-day').remove();else if(a==='business-generate')await generate(id);
    else if(a==='business-invoice')await invoiceForm(id);else if(a==='business-send-links')await sendLinks(id);
    else {const all=Object.values(cache).flatMap(v=>v.agreements||[]),c=all.find(c=>c.id===id);if(!c)throw new Error('Actualiza la lista de acuerdos.');
      if(a==='business-copy'){try{await navigator.clipboard.writeText(c.link);toast('Enlace personal copiado.');}catch(_){openDialog('business','Copiar enlace',field('Enlace personal',input('link',c.link,'text','readonly')));}}
      else if(a==='business-agreement-view'){openDialog('business',c.name,`<div class="printable agreement-document">${agreementHtml(c.text)}</div><div class="actions section no-print">${btn('business-print','↓ Guardar en PDF',c.id)}</div>`);}
      else if(a==='business-review'||a==='business-revoke'){if(!window.confirm(a==='business-review'?'¿Has descargado y revisado el documento y la firma?':'¿Revocar este enlace? Los documentos se conservan y no podrán sustituirse con este enlace.'))return true;await request('business/agreement-state',{id,status:a==='business-review'?'reviewed':'revoked'});invalidate();renderPage();}}
    return true;
  }
  return {overview,production,report,invoice,eventPanel,paymentsPanel,action,personPanel,invalidate};
};
