"use strict";
window.ScribInventory = function (h) {
  const {personLabel,esc,btn,badge,field,input,area,select,option,item,active,pageHead,empty,openDialog,formShell} = h;
  const TEAMS = {blue:'🔵 Intérpretes · Azul',red:'🔴 Intérpretes · Rojo',general:'🧰 Compartido'};
  const CATEGORIES = {props:'Utilería',costume:'Vestuario',furniture:'Mobiliario',technical:'Técnica',other:'Otros'};
  const CONDITIONS = {good:'✓ Listo para escena',repair:'⚒ Por reparar',missing:'? Por localizar',loaned:'↗ Prestado'};
  let filters = {team:'',category:'',condition:'',search:''};
  function card(o) {
    const responsible = item(o.custodianId), event = item(o.eventId);
    return `<article class="panel object-card ${esc(o.team)}" data-object="${esc(o.id)}">${o.image?`<img class="object-photo" src="/scrib/backstage/images/${esc(o.image)}" alt="${esc(o.title)}" loading="lazy">`:`<div class="object-placeholder" aria-hidden="true">${o.category==='costume'?'👕':o.category==='technical'?'🔌':o.category==='furniture'?'🪑':'🎭'}</div>`}<div class="object-body"><div class="panel-head"><h3>${esc(o.title)}</h3><span class="object-quantity" title="Cantidad">× ${o.quantity}</span></div><div class="label-group">${badge(TEAMS[o.team],o.team==='blue'?'cyan':o.team==='red'?'coral':'violet')}${badge(CATEGORIES[o.category])}${badge(CONDITIONS[o.condition],o.condition==='good'?'green':'gold')}</div><p class="muted notes">${esc(o.description || 'Sin descripción')}</p><dl class="object-details"><div><dt>⌖ Ubicación</dt><dd>${esc(o.location || 'Sin indicar')}</dd></div><div><dt>✳ Responsable</dt><dd>${responsible?personLabel(responsible.id):'Sin asignar'}${responsible?.archived?' (archivado)':''}</dd></div>${event?`<div><dt>▦ Bolo</dt><dd><a href="#event/${esc(event.id)}">${esc(event.title)}</a>${event.archived?' (archivado)':''}</dd></div>`:''}</dl>${btn('edit-object','Ver / editar objeto',o.id,'small')}</div></article>`;
  }
  function list() {
    const objects=active('inventory'), units=team=>objects.filter(o=>o.team===team).reduce((n,o)=>n+o.quantity,0);
    return pageHead('LO QUE LLEVAMOS A ESCENA','Inventario','Objetos por equipo de intérpretes. Registra dónde están, quién los cuida y para qué bolo se preparan.',btn('new-object','＋ Añadir objeto','','primary')+btn('print','↓ Imprimir inventario')) +
      `<div class="inventory-summary">${Object.entries(TEAMS).map(([t,n])=>`<button type="button" class="panel ${t}" data-action="inventory-team" data-id="${t}" aria-pressed="${filters.team===t}"><small>${esc(n)}</small><strong>${units(t)}</strong><span>unidades · ${objects.filter(o=>o.team===t).length} fichas</span></button>`).join('')}</div><div class="toolbar inventory-filters">${input('inventory-search',filters.search,'search','id="inventory-search" aria-label="Buscar objetos" placeholder="Buscar objeto, lugar, responsable…"')}${select('inventory-team',{'':'Todos los equipos',...TEAMS},filters.team,'id="inventory-team" aria-label="Filtrar por equipo"')}${select('inventory-category',{'':'Todas las categorías',...CATEGORIES},filters.category,'id="inventory-category" aria-label="Filtrar por categoría"')}${select('inventory-condition',{'':'Todos los estados',...CONDITIONS},filters.condition,'id="inventory-condition" aria-label="Filtrar por estado"')}</div><p id="inventory-count" class="muted" role="status"></p><div class="grid cols3" id="inventory-grid">${objects.sort((a,b)=>a.title.localeCompare(b.title,'es')).map(card).join('') || empty('Un almacén por construir','Añade los objetos reales de cada equipo; no hemos inventado existencias.',btn('new-object','＋ Primer objeto','','primary'))}</div><div id="inventory-no-match" hidden>${empty('No hay coincidencias','Prueba otro equipo, estado o palabra.')}</div>`;
  }
  function applyFilters() {
    const cards=[...document.querySelectorAll('[data-object]')];
    for(const node of cards){
      const o=item(node.dataset.object), query=[o.title,o.description,o.location,item(o.custodianId)?.name,item(o.eventId)?.title].join(' ').toLocaleLowerCase('es');
      node.hidden=Boolean((filters.team&&o.team!==filters.team)||(filters.category&&o.category!==filters.category)||(filters.condition&&o.condition!==filters.condition)||!query.includes(filters.search.toLocaleLowerCase('es')));
    }
    const count=cards.filter(n=>!n.hidden).length, indicator=document.querySelector('#inventory-count'), blank=document.querySelector('#inventory-no-match');
    if(indicator)indicator.textContent=`${count} ${count===1?'objeto':'objetos'} · ${cards.filter(n=>!n.hidden).reduce((n,c)=>n+item(c.dataset.object).quantity,0)} unidades`;
    if(blank)blank.hidden=!cards.length||Boolean(count);
  }
  function open(id='',eventId='') {
    const o=id?item(id):{team:filters.team||'general',quantity:1,category:'props',condition:'good',eventId};
    if(!o || o.archived)throw new Error('El objeto está archivado o no existe. Recupéralo desde Archivo.');
    const choices=kind=>h.state().items.filter(x=>x.kind===kind&&(!x.archived||x.id===o[kind==='person'?'custodianId':'eventId'])).sort((a,b)=>(a.name||a.title).localeCompare(b.name||b.title,'es'));
    openDialog('inventory',id?'Ficha del objeto':'Nuevo objeto',formShell('inventory',o,
      field('Objeto',input('title',o.title,'text','required maxlength="240" placeholder="Ej.: maleta de escena"'))+
      `<div class="grid cols2">${field('Equipo',select('team',TEAMS,o.team))}${field('Cantidad',input('quantity',o.quantity,'number','required min="0" max="9999" step="1"'))}${field('Categoría',select('category',CATEGORIES,o.category))}${field('Estado',select('condition',CONDITIONS,o.condition))}</div>`+
      field('Dónde está',input('location',o.location,'text','maxlength="1000" placeholder="Almacén, sala, bolsa…"'))+
      field('Quién lo cuida',`<select name="custodianId">${option('','Sin asignar',o.custodianId)}${choices('person').map(p=>option(p.id,p.name+(p.archived?' (archivado)':''),o.custodianId)).join('')}</select>`)+
      field('Preparado para un bolo',`<select name="eventId">${option('','Sin asociar a un bolo',o.eventId)}${choices('event').map(e=>option(e.id,e.title+(e.archived?' (archivado)':''),o.eventId)).join('')}</select>`,'Esta asociación no cambia el equipo ni duplica las existencias.')+
      field('Descripción / notas',area('description',o.description,'maxlength="15000" placeholder="Medidas, uso escénico, préstamo, reparaciones…"'))+
      `${o.image?`<img class="object-form-photo" src="/scrib/backstage/images/${esc(o.image)}" alt="${esc(o.title)}">`:''}`+input('image',o.image,'hidden')+
      field('Foto del objeto',input('photo','','file','accept="image/png,image/jpeg,image/webp"'),'Hasta 4 MB. Se guarda dentro del espacio protegido.')+
      (o.image?btn('remove-object-photo','Quitar foto','','small'):'')
    ));
  }
  function eventPanel(event) {
    const objects=active('inventory').filter(o=>o.eventId===event.id);
    return `<section class="panel event-inventory-section"><div class="panel-head"><h2>🎭 Objetos para este bolo</h2>${btn('object-for-event','＋ Añadir objeto',event.id,'small')}</div>${objects.length?`<div class="event-objects">${objects.map(o=>`<button type="button" class="event-object ${esc(o.team)}" data-action="edit-object" data-id="${esc(o.id)}"><strong>${esc(o.title)} <span>× ${o.quantity}</span></strong><small>${esc(TEAMS[o.team])} · ${esc(CONDITIONS[o.condition])} · ${esc(o.location||'Ubicación pendiente')}</small></button>`).join('')}</div>`:'<p class="muted section">Sin objetos asociados. Puedes vincular los existentes desde Inventario o añadir uno aquí.</p>'}<a href="#inventory" class="button small section">Ver todo el inventario ↗</a></section>`;
  }
  async function action(node) {
    const {action:a,id}=node.dataset;
    if(a==='new-object')open();
    else if(a==='edit-object')open(id);
    else if(a==='object-for-event')open('',id);
    else if(a==='inventory-team'){filters.team=filters.team===id?'':id;h.renderPage();}
    else if(a==='remove-object-photo'){const form=node.closest('form');form.querySelector('[name=image]').value='';form.querySelector('[name=photo]').value='';form.querySelector('.object-form-photo')?.remove();node.remove();}
    else return false;
    return true;
  }
  function filter(node) {
    const key={'inventory-team':'team','inventory-category':'category','inventory-condition':'condition','inventory-search':'search'}[node.id];
    if(!key)return false;
    filters[key]=node.value;applyFilters();return true;
  }
  return {list,applyFilters,eventPanel,action,filter};
};
