"use strict";
window.ScribLighting = function(h) {
  const {esc,btn,pageHead,request,toast} = h;
  const clone = value => JSON.parse(JSON.stringify(value));
  const LIGHTS = new Set(['street','spot','front']);
  let scope='',loadedScope=null,draft=null,version=0,selected='blue-street',dirty=false,busy=false,drag=null,requestId='',cableView='hdmi';
  function upgraded(source) {
    const defaults=h.state().lightingDefaults;
    const plan=clone({notes:source.notes,elements:source.elements});
    const legacy=['blue-street','red-street','presenter','frontals','blue-desk','red-desk','screen'];
    if(plan.elements.length===7 && legacy.every(id=>plan.elements.some(e=>e.id===id)))plan.elements.push(...clone(defaults.elements.filter(e=>!legacy.includes(e.id))));
    plan.elements=plan.elements.map(e=>({...defaults.elements.find(x=>x.id===e.id),...e}));
    for(const field of ['connections','walkies','checklist'])plan[field]=clone(source[field] || defaults[field]);
    return plan;
  }
  const root = () => document.querySelector('.lighting-workspace');
  const own = () => h.state().items.find(x=>x.kind==='lighting' && x.eventId===scope && !x.archived);
  const base = () => h.state().items.find(x=>x.kind==='lighting' && !x.eventId && !x.archived) || h.state().lightingDefaults;
  function ensure(force=false) {
    const source=own(),fallback=base();
    if(!fallback)return false;
    if(!force && draft && loadedScope===scope && (dirty || busy || drag || version===(source?.version || 0)))return true;
    draft=upgraded(source || fallback);
    if(!source && scope)draft.checklist.forEach(c=>{c.done=false;c.notes='';});
    version=source?.version || 0;loadedScope=scope;dirty=false;requestId='';
    if(!draft.elements.some(e=>e.id===selected))selected=draft.elements[0].id;
    return true;
  }
  const current = () => draft.elements.find(e=>e.id===selected);
  const tone = e => ['blue','red','warm','white'].includes(e.color)?e.color:'white';
  const short = value => value.length>29?value.slice(0,28)+'…':value;
  const at = e => e.zone==='technical'?({x:70+4*e.x,y:735+2.5*e.y}):e.zone==='actors'?({x:530+4*e.x,y:735+2.5*e.y}):({x:100+8*e.x,y:100+5*e.y});
  const bounds = e => ({min:['screen','front'].includes(e.type)?20:10,max:['screen','front'].includes(e.type)?80:90});
  const limited = (value,min,max) => Math.round(Math.max(min,Math.min(max,value))*100)/100;
  function beams(e) {
    if(!LIGHTS.has(e.type))return '';
    const {x,y}=at(e),opacity=e.enabled?e.intensity/100:0;
    if(e.type==='street') {const end=x+(e.color==='blue'?360:-360);return `<polygon points="${x},${y} ${end},${y-155} ${end},${y+155}" fill="url(#lumi-${tone(e)})" opacity="${opacity}"/>`;}
    if(e.type==='spot')return `<ellipse cx="${x}" cy="${y}" rx="105" ry="66" fill="url(#lumi-warm)" opacity="${opacity}"/>`;
    return `<rect x="${x-305}" y="${y-105}" width="610" height="125" rx="45" fill="url(#lumi-white)" opacity="${opacity*.55}"/>`;
  }
  function marker(e) {
    const {x,y}=at(e),t=tone(e);
    let shape;
    if(e.type==='desk')shape='<rect class="lumi-body" x="-80" y="-30" width="160" height="60" rx="10"/><rect class="lumi-laptop" x="-27" y="-22" width="54" height="30" rx="4"/><path class="lumi-line" d="M-35 14h70M-60 30v15M60 30v15"/>';
    else if(e.type==='screen')shape='<rect class="lumi-body" x="-150" y="-30" width="300" height="60" rx="5"/><path class="lumi-line" d="M-156-37h312M0 30v12"/><text class="lumi-screen-word" text-anchor="middle" y="7">&lt;SCRI&gt; B</text>';
    else if(e.type==='front')shape=[-115,0,115].map(pos=>`<circle class="lumi-body" cx="${pos}" cy="0" r="23"/><path class="lumi-line" d="M${pos-9} 5l9-13 9 13"/>`).join('');
    else if(e.type==='spot')shape='<circle class="lumi-body" r="34"/><circle class="lumi-person" cy="-9" r="8"/><path class="lumi-line" d="M-14 17v-2a14 14 0 0 1 28 0v2"/>';
    else if(['monitor','computer'].includes(e.type))shape='<rect class="lumi-body" x="-35" y="-24" width="70" height="43" rx="5"/><path class="lumi-line" d="M0 19v10M-22 29h44"/>';
    else if(e.type==='projector')shape='<rect class="lumi-body" x="-38" y="-20" width="76" height="40" rx="6"/><circle class="lumi-line" cx="18" r="12"/><path class="lumi-line" d="M-28-6h20M-28 6h20"/>';
    else if(e.type==='splitter')shape='<rect class="lumi-body" x="-39" y="-17" width="78" height="34" rx="5"/><path class="lumi-line" d="M-48 0h15M0-5v10M0 0h24M24-10v20M24-10h22M24 10h22"/>';
    else if(e.type==='power')shape='<circle class="lumi-body" r="24"/><path class="lumi-line" d="m5-16-13 20h10l-6 14L11-4H1Z"/>';
    else if(e.type==='console')shape='<rect class="lumi-body" x="-38" y="-22" width="76" height="44" rx="5"/><path class="lumi-line" d="M-20-12v24M0-12v24M20-12v24M-27-3h14M-7 7H7M13-7h14"/>';
    else if(e.type==='smoke')shape='<rect class="lumi-body" x="-28" y="-15" width="56" height="30" rx="5"/><path class="lumi-line" d="M0 15v25m-10-9 10 10 10-10"/><path class="lumi-smoke-direction" d="M-15 50q15 12 30 0M-22 60q22 15 44 0"/>';
    else shape=`<circle class="lumi-body" r="25"/><path class="lumi-line" ${e.color==='red'?'transform="scale(-1 1)"':''} d="m-10-12 22 12-22 12Z"/>`;
    const yLabel=e.type==='desk'&&!e.zone?67:e.type==='screen'?62:e.type==='smoke'?-28:e.type==='street'?45:e.zone?43:57;
    return `<g class="lumi-node lumi-${t}${selected===e.id?' is-selected':''}${!e.enabled?' is-off':''}" transform="translate(${x},${y})" data-lighting-node="${esc(e.id)}" data-action="lighting-select" data-id="${esc(e.id)}" tabindex="0" role="button" aria-pressed="${selected===e.id}" aria-label="${esc(e.label)}. ${LIGHTS.has(e.type)?e.enabled?'Simulación al '+e.intensity+' por ciento':'Apagado en la simulación':'Elemento de escenario'}. Pulsa para seleccionar; flechas para mover."><title>${esc(e.label)}</title><circle class="lumi-hit" r="42"/>${shape}<text class="lumi-node-label" text-anchor="middle" y="${yLabel}">${esc(short(e.label))}</text></g>`;
  }
  function svg() {
    const palettes={blue:'#39ccff',red:'#ff5373',warm:'#ffcc75',white:'#f3efff'};
    return `<svg class="lighting-map" viewBox="0 0 1000 1040" role="group" aria-label="Plano interactivo del escenario, técnica y sala de intérpretes, visto desde el público"><defs><pattern id="lumi-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="lumi-grid-line"/></pattern><clipPath id="lumi-stage-clip"><rect x="70" y="80" width="860" height="540" rx="18"/></clipPath>${Object.entries(palettes).map(([name,color])=>`<radialGradient id="lumi-${name}"><stop offset="0" stop-color="${color}" stop-opacity=".48"/><stop offset="1" stop-color="${color}" stop-opacity=".04"/></radialGradient>`).join('')}</defs><text class="lumi-orientation" text-anchor="middle" x="500" y="43">FONDO DEL ESCENARIO</text><rect class="lumi-stage" x="70" y="80" width="860" height="540" rx="18"/><rect x="70" y="80" width="860" height="540" rx="18" fill="url(#lumi-grid)"/><rect class="lumi-proscenium" x="72" y="462" width="856" height="155" rx="18"/><text class="lumi-zone-label" text-anchor="middle" x="500" y="490">PROSCENIO</text><rect class="lumi-stage" x="60" y="720" width="430" height="300" rx="18"/><rect class="lumi-stage" x="520" y="720" width="430" height="300" rx="18"/><text class="lumi-orientation" text-anchor="middle" x="275" y="750">TÉCNICA</text><text class="lumi-orientation" text-anchor="middle" x="735" y="750">SALA INTÉRPRETES</text><g class="lumi-beams" clip-path="url(#lumi-stage-clip)">${draft.elements.map(beams).join('')}</g><g class="lumi-cables">${cables()}</g><g class="lumi-markers">${draft.elements.map(marker).join('')}</g><path class="lumi-audience-line" d="M220 654h560"/><text class="lumi-orientation" text-anchor="middle" x="500" y="684">PÚBLICO · IZQUIERDA ← → DERECHA</text></svg>`;
  }
  const cableLabels={hdmi:'Vídeo HDMI',audio:'Audio',power:'Alimentación',dmx:'DMX'};
  function cables() {
    return draft.connections.filter(c=>cableView==='all'||c.type===cableView).map((c,i)=>{
      const source=draft.elements.find(e=>e.id===c.from),target=draft.elements.find(e=>e.id===c.to);if(!source||!target)return '';
      const a=at(source),b=at(target),side=source.zone!==target.zone?35+i*5:null;
      const path=side!==null?`M${a.x} ${a.y}H${side}V${b.y}H${b.x}`:`M${a.x} ${a.y}V${(a.y+b.y)/2}H${b.x}V${b.y}`;
      return `<path class="lumi-cable cable-${esc(c.type)}" d="${path}"><title>${esc(c.label)} · ${esc(source.label)} → ${esc(target.label)}</title></path>`;
    }).join('');
  }
  function technicalSections() {
    const checks=draft.checklist,groups=[...new Set(checks.map(c=>c.category))];
    return `<section class="panel lighting-wiring"><div class="panel-head"><h2>Conexiones y cableado</h2><span class="badge gold">${draft.connections.length} recorridos</span></div><p class="tiny">Recorridos esquemáticos, no longitudes reales. Adaptar y validar conectores, alimentación y tendido con la sala.</p><div class="lighting-connections">${draft.connections.map(c=>`<div class="lighting-connection cable-${esc(c.type)}"><strong>${esc(c.label)}</strong><span>${esc(draft.elements.find(e=>e.id===c.from)?.label)} → ${esc(draft.elements.find(e=>e.id===c.to)?.label)}</span><input aria-label="Notas de ${esc(c.label)}" data-connection-notes="${esc(c.id)}" data-lighting-control maxlength="1000" value="${esc(c.notes || '')}" placeholder="Longitud, conector, circuito o dirección…"></div>`).join('')}</div></section><section class="panel"><h2>Walkies · cuatro unidades</h2><div class="lighting-walkies">${draft.walkies.map(w=>`<div class="lighting-radio"><span aria-hidden="true">📻</span><strong>${esc(w.label)}</strong><span class="badge gold">CANAL ${esc(w.channel)}</span>${w.notes?`<small>${esc(w.notes)}</small>`:''}</div>`).join('')}</div></section><section class="panel lighting-checklist"><div class="panel-head"><h2>Checklist de montaje técnico</h2><span id="lighting-check-progress" class="badge gold" role="status">${checks.filter(c=>c.done).length}/${checks.length}</span></div><p class="tiny">${scope?'Progreso independiente para este bolo.':'Plano base: los bolos nuevos empiezan con los pasos pendientes.'} Marca los pasos y guarda el plano para compartirlos.</p><div class="lighting-check-groups">${groups.map(group=>`<fieldset><legend>${esc(group)}</legend>${checks.filter(c=>c.category===group).map(c=>`<label class="lighting-check"><input type="checkbox" data-lighting-check="${esc(c.id)}" data-lighting-control ${c.done?'checked':''}><span>${esc(c.text)}</span></label>`).join('')}</fieldset>`).join('')}</div></section>`;
  }
  function inspector() {
    const e=current(),b=bounds(e),light=LIGHTS.has(e.type);
    return `<div class="lighting-inspector lumi-${tone(e)}"><p class="eyebrow">ELEMENTO SELECCIONADO</p><h2>${esc(e.label)}</h2>
      <label class="field">Nombre<input data-lighting-field="label" data-lighting-control value="${esc(e.label)}" maxlength="80" required></label>
      <div class="grid cols2"><label class="field">Horizontal (%)<input type="number" data-lighting-field="x" data-lighting-control value="${e.x}" min="${b.min}" max="${b.max}" step="1"></label><label class="field">${e.zone?'Vertical en su zona':'Fondo → proscenio'} (%)<input type="number" data-lighting-field="y" data-lighting-control value="${e.y}" min="10" max="90" step="1"></label></div>
      ${light?`<label class="lighting-switch"><input type="checkbox" data-lighting-field="enabled" data-lighting-control ${e.enabled?'checked':''}> Encendido en la simulación</label><label class="field">Intensidad simulada <output id="lighting-intensity">${e.intensity}%</output><input type="range" data-lighting-field="intensity" data-lighting-control min="0" max="100" step="1" value="${e.intensity}"></label>`:''}
      <label class="field">${e.type==='smoke'||e.id==='dmx-desk'?'Dirección / canal DMX':'Circuito / canal / conexión'}<input data-lighting-field="channel" data-lighting-control value="${esc(e.channel)}" maxlength="80" placeholder="Por asignar en la sala"></label>
      <label class="field">Notas de montaje<textarea data-lighting-field="notes" data-lighting-control maxlength="2000">${esc(e.notes)}</textarea></label><p class="tiny">Arrastra en el plano o utiliza las posiciones. Con el elemento enfocado, las flechas lo mueven; Mayús acelera el paso.</p></div>`;
  }
  function elementList() {
    return draft.elements.map(e=>`<button type="button" class="lighting-element lumi-${tone(e)}${e.id===selected?' is-selected':''}" data-action="lighting-select" data-id="${esc(e.id)}" data-lighting-control aria-pressed="${e.id===selected}"><span class="lighting-swatch" aria-hidden="true"></span><span>${esc(e.label)}</span>${LIGHTS.has(e.type)?`<small>${e.enabled?e.intensity+'%':'OFF'}</small>`:''}</button>`).join('');
  }
  function render() {
    if(!ensure())return pageHead('PREPARAR LA ESCENA','Luminotecnia','El servidor debe actualizarse para cargar el plano de iluminación.');
    const events=h.state().items.filter(x=>x.kind==='event' && !x.archived).sort((a,b)=>b.start.localeCompare(a.start));
    return pageHead('LA ESCENA, CON SU PROPIA LUZ','Luminotecnia','Escenario, vídeo, técnica, sala de intérpretes y montaje: todo conectado en un mismo plano.',btn('lighting-pdf','↓ Exportar plano PDF'))+
      `<section class="lighting-workspace"><div class="panel lighting-toolbar"><label class="field">Plano<select id="lighting-scope" data-lighting-control><option value=""${scope===''?' selected':''}>Plano base de &lt;SCRI&gt; B</option>${events.map(e=>`<option value="${esc(e.id)}"${scope===e.id?' selected':''}>${esc(e.title)} · ${esc(e.start.slice(0,10))}</option>`).join('')}</select></label><div class="actions"><span id="lighting-status" role="status">${dirty?'Cambios sin guardar':version?'Plano guardado · v'+version:scope?'Adaptación nueva a partir del plano base':'Plano inicial · aún sin guardar'}</span><button class="button" type="button" data-action="lighting-revert" data-lighting-control>↺ Descartar cambios</button><button class="button primary" type="button" data-action="lighting-save" data-lighting-control ${busy?'disabled':''}>${busy?'Guardando…':'✓ Guardar plano'}</button></div></div><div class="lighting-layout"><section class="panel lighting-stage-panel"><div class="panel-head"><div><h2>Plano de escenario</h2><p class="muted">Vista desde el público · no está a escala</p></div><span class="badge gold">SIMULACIÓN</span></div><div class="lighting-cues" aria-label="Vistas de iluminación simulada">${[['all','✦ Todo'],['blue','🔵 Azul'],['red','🔴 Rojo'],['presenter','◉ Presentador'],['frontals','☀ Proscenio'],['black','● Negro']].map(([id,label])=>`<button type="button" class="button small" data-action="lighting-cue" data-id="${id}" data-lighting-control>${label}</button>`).join('')}</div><div class="lighting-cable-filters" aria-label="Capas de cableado">${Object.entries({none:'Sin cables',...cableLabels,all:'Todos'}).map(([id,label])=>`<button type="button" class="button small cable-${id}" data-action="lighting-cables" data-id="${id}" aria-pressed="${id===cableView}">${label}</button>`).join('')}</div><div class="lighting-map-scroll"><div id="lighting-svg">${svg()}</div></div><div id="lighting-elements" class="lighting-elements">${elementList()}</div></section><aside class="panel" id="lighting-inspector">${inspector()}</aside></div>${technicalSections()}<section class="panel lighting-notes"><label class="field">Notas generales para la sala<textarea id="lighting-notes" data-lighting-control maxlength="5000">${esc(draft.notes)}</textarea></label></section></section>`;
  }
  function markDirty() {dirty=true;requestId='';const status=document.querySelector('#lighting-status');if(status)status.textContent='Cambios sin guardar';}
  function redraw() {
    const canvas=document.querySelector('#lighting-svg'),list=document.querySelector('#lighting-elements');
    if(canvas)canvas.innerHTML=svg();if(list)list.innerHTML=elementList();
  }
  function select(id) {
    if(busy || !draft?.elements.some(e=>e.id===id))return;
    selected=id;const pane=document.querySelector('#lighting-inspector');if(pane)pane.innerHTML=inspector();
    root()?.querySelectorAll('[data-lighting-node]').forEach(g=>{g.classList.toggle('is-selected',g.dataset.lightingNode===selected);g.setAttribute('aria-pressed',String(g.dataset.lightingNode===selected));});
    document.querySelector('#lighting-elements')?.querySelectorAll('[data-action="lighting-select"]').forEach(button=>{button.classList.toggle('is-selected',button.dataset.id===selected);button.setAttribute('aria-pressed',String(button.dataset.id===selected));});
  }
  function input(node) {
    const key=node.dataset?.lightingField;
    if(node.dataset?.lightingCheck || node.dataset?.connectionNotes) {
      if(busy || !draft)return true;
      if(node.dataset.lightingCheck){
        const check=draft.checklist.find(c=>c.id===node.dataset.lightingCheck);if(check)check.done=node.checked;
        const progress=document.querySelector('#lighting-check-progress');if(progress)progress.textContent=draft.checklist.filter(c=>c.done).length+'/'+draft.checklist.length;
      } else {const connection=draft.connections.find(c=>c.id===node.dataset.connectionNotes);if(connection)connection.notes=node.value;}
      markDirty();return true;
    }
    if(!key && node.id!=='lighting-notes')return false;
    if(busy || !draft)return true;
    if(node.id==='lighting-notes'){draft.notes=node.value;markDirty();return true;}
    const e=current();
    if(key==='x' || key==='y') {
      if(node.value==='' || !Number.isFinite(Number(node.value)))return true;
      const b=bounds(e);e[key]=limited(Number(node.value),key==='x'?b.min:10,key==='x'?b.max:90);
    } else if(key==='enabled')e.enabled=node.checked;
    else if(key==='intensity')e.intensity=Math.round(limited(Number(node.value),0,100));
    else if(['label','notes','channel'].includes(key))e[key]=node.value;
    else return false;
    markDirty();redraw();const output=document.querySelector('#lighting-intensity');if(output)output.textContent=e.intensity+'%';
    // Keep the input/textarea node intact while typing, including its caret.
    const heading=document.querySelector('#lighting-inspector h2');if(heading)heading.textContent=e.label;
    return true;
  }
  function moved(x,y) {
    const e=current(),b=bounds(e);e.x=limited(x,b.min,b.max);e.y=limited(y,10,90);markDirty();
    const pane=document.querySelector('#lighting-inspector');
    for(const axis of ['x','y']){const field=pane?.querySelector(`[data-lighting-field="${axis}"]`);if(field)field.value=e[axis];}
  }
  function point(event,svgNode) {
    const matrix=svgNode.getScreenCTM();if(!matrix)return null;
    const p=svgNode.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(matrix.inverse());
  }
  function pointerDown(event) {
    const node=event.target.closest('[data-lighting-node]');
    if(!node || busy || event.button!==0)return;
    const svgNode=node.closest('svg'),p=point(event,svgNode);if(!p)return;
    select(node.dataset.lightingNode);const origin=at(current());
    drag={svg:svgNode,id:current().id,pointer:event.pointerId,dx:p.x-origin.x,dy:p.y-origin.y,startX:event.clientX,startY:event.clientY,moved:false};
    svgNode.setPointerCapture(event.pointerId);event.preventDefault();
  }
  function pointerMove(event) {
    if(!drag || event.pointerId!==drag.pointer)return;
    if(!drag.moved && Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<4)return;
    const p=point(event,drag.svg);if(!p)return;drag.moved=true;
    const zone=current().zone,x0=zone==='technical'?70:zone==='actors'?530:100,y0=zone?735:100;
    moved((p.x-drag.dx-x0)/(zone?4:8),(p.y-drag.dy-y0)/(zone?2.5:5));
    const e=current(),node=drag.svg.querySelector(`[data-lighting-node="${e.id}"]`),pos=at(e);
    node?.setAttribute('transform',`translate(${pos.x},${pos.y})`);
    const beamGroup=drag.svg.querySelector('.lumi-beams');if(beamGroup)beamGroup.innerHTML=draft.elements.map(beams).join('');
    const cableGroup=drag.svg.querySelector('.lumi-cables');if(cableGroup)cableGroup.innerHTML=cables();
    event.preventDefault();
  }
  function pointerUp(event) {
    if(!drag || event.pointerId!==drag.pointer)return;
    const active=drag;drag=null;
    if(active.svg.hasPointerCapture(event.pointerId))active.svg.releasePointerCapture(event.pointerId);
    redraw();
  }
  function keydown(event) {
    const node=event.target.closest('[data-lighting-node]');if(!node || busy)return;
    if(['Enter',' '].includes(event.key)){event.preventDefault();select(node.dataset.lightingNode);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();select(node.dataset.lightingNode);const e=current(),step=event.shiftKey?5:1;
    moved(e.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),e.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0));
    redraw();document.querySelector(`[data-lighting-node="${selected}"]`)?.focus();
  }
  function cue(id) {
    if(!['all','blue','red','presenter','frontals','black'].includes(id) || busy)return;
    draft.elements.filter(e=>LIGHTS.has(e.type)).forEach(e=>{e.enabled=id==='all' || e.id===id || (id==='blue'&&e.id==='blue-street') || (id==='red'&&e.id==='red-street');});
    markDirty();redraw();select(selected);
  }
  function controls(disabled) {root()?.querySelectorAll('[data-lighting-control]').forEach(n=>{n.disabled=disabled;});}
  async function save() {
    if(busy || !ensure())return;
    if(draft.elements.some(e=>!e.label.trim())){toast('Pon un nombre a cada elemento antes de guardar.');return;}
    busy=true;controls(true);requestId=requestId || crypto.randomUUID();
    const operation={eventId:scope,version,requestId,plan:clone(draft)};
    try {
      const response=await request('lighting/save',operation),saved=response.item;
      if(saved?.kind!=='lighting' || saved.eventId!==scope || !Number.isInteger(saved.version))throw new Error('No se pudo confirmar el guardado. Conservamos el plano para reintentar.');
      const index=h.state().items.findIndex(x=>x.id===saved.id);
      if(index<0)h.state().items.push(saved);else h.state().items[index]=saved;
      version=saved.version;dirty=false;requestId='';draft=upgraded(saved);
      let refreshed=true;try{await h.refresh(false);}catch(_){refreshed=false;}
      busy=false;h.renderPage();toast(refreshed?'Plano de luminotecnia guardado para el equipo.':'Plano guardado. La actualización del resto del espacio está pendiente de conexión.');
    }catch(error){toast(error.message+(error.status===409?' Descarta los cambios para cargar la versión compartida; tu plano sigue aquí.':''));}
    finally{busy=false;controls(false);}
  }
  async function changeScope(node) {
    if(node.id!=='lighting-scope')return false;
    if(busy || (dirty && !window.confirm('¿Descartar los cambios sin guardar de este plano antes de cambiar de bolo?'))){node.value=scope;return true;}
    const next=node.value;if(next && !h.state().items.some(x=>x.id===next && x.kind==='event' && !x.archived)){node.value=scope;return true;}
    scope=next;loadedScope=null;ensure(true);h.renderPage();return true;
  }
  async function action(node) {
    const {action:a,id}=node.dataset;if(!a.startsWith('lighting-'))return false;
    if(a==='lighting-pdf'){await window.ScribExport(h.state(),{kind:'lighting',id:scope,plan:clone(draft)},node);return true;}
    else if(a==='lighting-cables' && ['none','all',...Object.keys(cableLabels)].includes(id)){
      cableView=id;redraw();root()?.querySelectorAll('[data-action="lighting-cables"]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.id===id)));
    }
    else if(a==='lighting-select')select(id);
    else if(a==='lighting-cue')cue(id);
    else if(a==='lighting-save')await save();
    else if(a==='lighting-revert' && !busy && (!dirty || window.confirm('¿Descartar los cambios sin guardar y cargar el plano compartido?'))){await h.refresh(false);ensure(true);h.renderPage();}
    return true;
  }
  return {render,action,input,changeScope,pointerDown,pointerMove,pointerUp,keydown,hasDraft:()=>dirty || busy || Boolean(drag)};
};
