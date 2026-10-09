"use strict";
window.ScribInventory = function(h) {
  const {esc,btn,badge,field,input,area,select,option,item,active,pageHead,empty,openDialog,formShell}=h;
  const TEAMS={blue:'Equipo azul',red:'Equipo rojo'};
  const CATEGORIES={props:'Utilería',costume:'Vestuario',furniture:'Mobiliario',technical:'Técnica',other:'Otros'};
  const quantityLabel=o=>o.quantity==null?'Cantidad sin especificar':'× '+o.quantity;
  const knownUnits=objects=>objects.reduce((n,o)=>n+(o.quantity??0),0);
  const unitsLabel=objects=>`${knownUnits(objects)} unidades${objects.some(o=>o.quantity==null)?' · algunas cantidades sin especificar':''}`;
  let filters={team:'',category:'',search:''};
  function matches(o) {
    const query=[o.title,o.description].join(' ').toLocaleLowerCase('es');
    return (!filters.team||o.team===filters.team)&&(!filters.category||o.category===filters.category)&&query.includes(filters.search.toLocaleLowerCase('es'));
  }
  function card(o) {
    return `<article class="panel object-card ${esc(o.team)}" data-object="${esc(o.id)}">${o.image?`<img class="object-photo${o.imageReference?' reference-photo':''}" src="/scrib/backstage/images/${esc(o.image)}" alt="${esc(o.title)}" loading="lazy">`:`<div class="object-placeholder" aria-hidden="true">${o.category==='costume'?'👕':o.category==='technical'?'🔌':'🎭'}</div>`}<div class="object-body"><div class="panel-head"><h3>${esc(o.title)}</h3><span class="object-quantity" title="Cantidad">${esc(quantityLabel(o))}</span></div><div class="label-group">${badge(TEAMS[o.team]||'Asignar equipo',o.team==='red'?'coral':'cyan')}${badge(CATEGORIES[o.category])}</div>${o.description?`<p class="muted notes">${esc(o.description)}</p>`:''}${o.imageReference?'<p class="tiny muted">Imagen de catálogo orientativa</p>':''}${o.sourceUrl?`<a class="tiny" href="${esc(o.sourceUrl)}" target="_blank" rel="noopener noreferrer">Referencia del producto ↗</a>`:''}${btn('edit-object','Ver / editar objeto',o.id,'small')}</div></article>`;
  }
  function list() {
    const objects=active('inventory');
    return pageHead('LO QUE LLEVAMOS A ESCENA','Inventario','Dos equipos, dos kits. Elige los objetos que quieres incluir en tu PDF.',btn('new-object','＋ Añadir objeto','','primary')+btn('inventory-export','↓ Exportar PDF'))+
      `<div class="inventory-summary">${Object.entries(TEAMS).map(([team,name])=>{const chosen=objects.filter(o=>o.team===team);return `<button type="button" class="panel ${team}" data-action="inventory-team" data-id="${team}" aria-pressed="${filters.team===team}"><small>${name}</small><strong>${knownUnits(chosen)}</strong><span>unidades · ${chosen.length} objetos</span></button>`;}).join('')}</div><div class="toolbar inventory-filters">${input('inventory-search',filters.search,'search','id="inventory-search" aria-label="Buscar objetos" placeholder="Buscar objeto…"')}${select('inventory-team',{'':'Azul y rojo',...TEAMS},filters.team,'id="inventory-team" aria-label="Filtrar por equipo"')}${select('inventory-category',{'':'Todas las categorías',...CATEGORIES},filters.category,'id="inventory-category" aria-label="Filtrar por categoría"')}</div><p id="inventory-count" class="muted" role="status"></p><div class="grid cols3" id="inventory-grid">${objects.sort((a,b)=>a.team.localeCompare(b.team)||a.title.localeCompare(b.title,'es')).map(card).join('')||empty('Un almacén por construir','Añade los objetos de cada equipo.',btn('new-object','＋ Primer objeto','','primary'))}</div><div id="inventory-no-match" hidden>${empty('No hay coincidencias','Prueba otro equipo, categoría o palabra.')}</div>`;
  }
  function applyFilters() {
    const cards=[...document.querySelectorAll('[data-object]')];
    for(const node of cards)node.hidden=!matches(item(node.dataset.object));
    const visible=cards.filter(n=>!n.hidden),indicator=document.querySelector('#inventory-count'),blank=document.querySelector('#inventory-no-match');
    if(indicator)indicator.textContent=`${visible.length} objetos · ${unitsLabel(visible.map(n=>item(n.dataset.object)))}`;
    if(blank)blank.hidden=!cards.length||Boolean(visible.length);
  }
  function open(id='',eventId='') {
    const o=id?item(id):{team:filters.team||'blue',quantity:1,category:'props',condition:'good',eventId};
    if(!o||o.archived)throw new Error('El objeto está archivado o no existe. Recupéralo en Tareas → Archivo.');
    openDialog('inventory',id?'Ficha del objeto':'Nuevo objeto',formShell('inventory',o,
      field('Objeto',input('title',o.title,'text','required maxlength="240"'))+
      `<div class="grid cols2">${field('Equipo',select('team',TEAMS,o.team))}${field('Cantidad',input('quantity',o.quantity??'','number','min="0" max="9999" step="1" placeholder="Sin especificar"'))}${field('Categoría',select('category',CATEGORIES,o.category))}</div>`+
      input('condition',o.condition||'good','hidden')+input('location',o.location||'','hidden')+input('custodianId',o.custodianId||'','hidden')+input('eventId',o.eventId||'','hidden')+
      field('Descripción / notas',area('description',o.description,'maxlength="15000"'))+
      field('Referencia del producto',input('sourceUrl',o.sourceUrl||'','url','maxlength="2000" placeholder="https://…"'))+
      `${o.image?`<img class="object-form-photo" src="/scrib/backstage/images/${esc(o.image)}" alt="${esc(o.title)}">`:''}`+input('image',o.image||'','hidden')+
      field('Foto del objeto',input('photo','','file','accept="image/png,image/jpeg,image/webp"'),'Hasta 4 MB. Se guarda dentro del espacio protegido.')+
      `<label class="check-option"><input type="checkbox" name="imageReference" ${o.imageReference?'checked':''}> Es una imagen de catálogo / referencia</label>`+
      (o.image?btn('remove-object-photo','Quitar foto','','small'):'')
    ));
  }
  function eventObjects(event) {
    return active('inventory').filter(o=>!event.inventoryIds||event.inventoryIds.includes(o.id));
  }
  function eventPanel(event) {
    const objects=eventObjects(event);
    return `<section class="panel event-inventory-section"><div class="panel-head"><h2>🎭 Objetos para este bolo</h2>${btn('inventory-export','↓ Exportar PDF',event.id,'small')}</div>${['blue','red'].map(team=>`<h3 class="section">${team==='blue'?'🔵':'🔴'} ${TEAMS[team]}</h3><div class="event-objects">${objects.filter(o=>o.team===team).map(o=>`<button type="button" class="event-object ${team}" data-action="edit-object" data-id="${esc(o.id)}">${o.image?`<img class="event-object-photo${o.imageReference?' reference-photo':''}" src="/scrib/backstage/images/${esc(o.image)}" alt="" loading="lazy">`:`<span class="event-object-placeholder" aria-hidden="true">${o.category==='costume'?'👕':o.category==='technical'?'🔌':'🎭'}</span>`}<span class="event-object-info"><strong>${esc(o.title)} <span>${esc(quantityLabel(o))}</span></strong><small>${esc(CATEGORIES[o.category])}</small></span></button>`).join('')||'<p class="muted">Sin objetos seleccionados.</p>'}</div>`).join('')}<a href="#inventory" class="button small section">Ver inventario ↗</a></section>`;
  }
  function exportDialog(eventId='') {
    const event=eventId?item(eventId):null,objects=event?eventObjects(event):active('inventory');
    openDialog('inventory','Tu inventario, listo para llevar',`<form id="inventory-export-form">${field('Título del PDF',input('title',event?'Inventario - '+event.title:'Inventario de escena','text','maxlength="160"'))}<div class="actions">${btn('inventory-select','Seleccionar todo','all','small')}${btn('inventory-select','Solo azul','blue','small')}${btn('inventory-select','Solo rojo','red','small')}${btn('inventory-select','Vaciar','none','small')}</div>${['blue','red'].map(team=>`<fieldset class="inventory-export-team ${team}"><legend>${TEAMS[team]}</legend>${objects.filter(o=>o.team===team).sort((a,b)=>a.title.localeCompare(b.title,'es')).map(o=>`<label class="recipient-option"><input type="checkbox" name="objects" value="${esc(o.id)}" data-team="${team}" ${event||matches(o)?'checked':''}><span><strong>${esc(o.title)}</strong><small>${esc(quantityLabel(o))}</small></span></label>`).join('')}</fieldset>`).join('')}<label class="check-option"><input type="checkbox" name="photos" checked> Incluir fotos</label><label class="check-option"><input type="checkbox" name="notes" checked> Incluir notas</label><p class="form-error" role="alert"></p><div class="form-footer"><span>Secciones azul y roja, con el logo de SCRIB.</span><button type="submit" class="button primary">↓ Descargar PDF</button></div></form>`);
  }
  async function exportForm(form) {
    const ids=[...form.querySelectorAll('[name=objects]:checked')].map(n=>n.value);
    const error=form.querySelector('.form-error');error.textContent='';
    if(!ids.length){error.textContent='Selecciona al menos un objeto.';return;}
    try {await window.ScribExport(h.state(),{kind:'inventory',ids,title:form.querySelector('[name=title]').value,photos:form.querySelector('[name=photos]').checked,notes:form.querySelector('[name=notes]').checked},form.querySelector('[type=submit]'));}
    catch(e){error.textContent=e.message;}
  }
  async function action(node) {
    const {action:a,id}=node.dataset;
    if(a==='new-object')open();else if(a==='edit-object')open(id);else if(a==='object-for-event')open('',id);
    else if(a==='inventory-team'){filters.team=filters.team===id?'':id;h.renderPage();}
    else if(a==='inventory-export')exportDialog(id);
    else if(a==='inventory-select')h.dialog.querySelectorAll('[name=objects]').forEach(n=>n.checked=id==='all'||n.dataset.team===id);
    else if(a==='remove-object-photo'){const form=node.closest('form');form.querySelector('[name=image]').value='';form.querySelector('[name=photo]').value='';form.querySelector('.object-form-photo')?.remove();node.remove();}
    else return false;
    return true;
  }
  function filter(node) {
    const key={'inventory-team':'team','inventory-category':'category','inventory-search':'search'}[node.id];
    if(!key)return false;filters[key]=node.value;applyFilters();return true;
  }
  return {list,applyFilters,eventPanel,eventObjects,exportForm,action,filter};
};
