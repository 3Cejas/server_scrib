"use strict";
window.ScribLighting = function(h) {
  const {esc,btn,pageHead,request,toast} = h;
  const clone = value => JSON.parse(JSON.stringify(value));
  const LIGHTS = new Set(['street','spot','front']);
  let scope='',loadedScope=null,draft=null,version=0,selected='blue-street',dirty=false,busy=false,drag=null,requestId='',cableView='hdmi';
  let baseline='',past=[],future=[],editGroup=null;
  function upgraded(source) {
    const defaults=h.state().lightingDefaults;
    const plan=clone({schemaVersion:defaults.schemaVersion,notes:source.notes || '',elements:source.elements});
    const legacy=['blue-street','red-street','presenter','frontals','blue-desk','red-desk','screen'];
    const additions=['game-controller','video-card','video-psu','left-speaker','right-speaker'];
    const v2=defaults.elements.map(e=>e.id).filter(id=>!additions.includes(id));
    const ids=plan.elements.map(e=>e.id),old=[legacy,v2].some(keys=>ids.length===keys.length&&new Set(ids).size===ids.length&&keys.every(id=>ids.includes(id)));
    if(old){
      const positions={splitter:[50,34],'blue-power':[14,28],'red-power':[86,28],'game-computer':[25,25],'sound-computer':[75,25],'sound-desk':[75,65],'technical-power':[25,65],'dmx-desk':[50,90]};
      const notes={projector:'HDMI directo desde PC principal; ajustar posición y óptica a la sala.',splitter:'Segunda salida del PC principal; señal a ambos monitores. Confirmar salidas/adaptadores y duplicado.','game-computer':'Videojuego, proyector y señal de monitores. Audio del juego a mesa de sonido.'};
      plan.elements.forEach(e=>{const p=positions[e.id],d=defaults.elements.find(x=>x.id===e.id);if(p&&e.x===p[0]&&e.y===p[1]){e.x=d.x;e.y=d.y;}if(e.id==='splitter')e.zone='technical';if(e.notes&&e.notes===notes[e.id])e.notes=d.notes;});
      plan.elements.push(...clone(defaults.elements.filter(e=>!ids.includes(e.id))));
    }
    plan.elements=plan.elements.map(e=>({...defaults.elements.find(x=>x.id===e.id),...e}));
    for(const field of ['connections','walkies','checklist'])plan[field]=clone(source[field] || defaults[field]);
    if(old)for(const [field,added] of [['connections',['data-video','data-controller','power-video-psu','power-video-card','audio-left','audio-right','power-left-speaker','power-right-speaker']],['checklist',['video-card','controller','speakers']]]){
      const keys=plan[field].map(r=>r.id),previous=defaults[field].filter(r=>!added.includes(r.id));
      if(keys.length===previous.length&&new Set(keys).size===keys.length&&previous.every(r=>keys.includes(r.id)))plan[field]=defaults[field].map(d=>{const r=plan[field].find(r=>r.id===d.id);return {...clone(d),...(r?.notes!==undefined?{notes:r.notes}:{}),...(r?.done!==undefined?{done:r.done}:{})};});
    }
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
    baseline=JSON.stringify(draft);past=[];future=[];editGroup=null;
    if(!draft.elements.some(e=>e.id===selected))selected=draft.elements[0].id;
    return true;
  }
  const current = () => draft.elements.find(e=>e.id===selected);
  const tone = e => ['blue','red','warm','white'].includes(e.color)?e.color:'white';
  const short = value => value.length>29?value.slice(0,28)+'…':value;
  const name = e => ['blue','red'].includes(e.color)?e.label.replace(/(?:\s*·)?\s+(?:azul(?:es)?|roj[oa]s?)$/i,''):e.label;
  const at = e => e.zone==='technical'?({x:70+4*e.x,y:755+4.8*e.y}):e.zone==='actors'?({x:530+4*e.x,y:755+4.8*e.y}):({x:100+8*e.x,y:100+5*e.y});
  const bounds = e => ['blue-power','red-power'].includes(e.id)?({min:0,max:100}):({min:['screen','front'].includes(e.type)?20:10,max:['screen','front'].includes(e.type)?80:90});
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
    else if(e.type==='power')shape='<rect class="lumi-body" x="-13" y="-12" width="26" height="27" rx="6"/><path class="lumi-line" d="M-6-12v-11M6-12v-11M0 15v10q0 12 16 12h16"/>';
    else if(e.type==='psu')shape='<rect class="lumi-body" x="-29" y="-18" width="58" height="36" rx="5"/><path class="lumi-line" d="M-45 0h16M29 0h16M-8-6h16M-8 6h16"/>';
    else if(e.type==='video-card')shape='<rect class="lumi-body" x="-38" y="-21" width="76" height="42" rx="5"/><path class="lumi-line" d="M-25-10h25v20h-25zM14-11h15v8H14zM14 3h15v8H14zM-46 0h8M38-7h12M38 7h12"/>';
    else if(e.type==='controller')shape='<path class="lumi-body" d="M-23-16h46q12 0 15 20l2 14q-2 13-16 2l-8-7h-32l-8 7q-14 11-16-2l2-14q3-20 15-20Z"/><path class="lumi-line" d="M-24-4h16M-16-12V4"/><circle class="lumi-line" cx="20" cy="-8" r="3"/><circle class="lumi-line" cx="28" cy="0" r="3"/>';
    else if(e.type==='speaker')shape='<rect class="lumi-body" x="-23" y="-35" width="46" height="70" rx="5"/><circle class="lumi-line" cy="-16" r="8"/><circle class="lumi-line" cy="13" r="15"/>';
    else if(e.type==='console')shape='<rect class="lumi-body" x="-38" y="-22" width="76" height="44" rx="5"/><path class="lumi-line" d="M-20-12v24M0-12v24M20-12v24M-27-3h14M-7 7H7M13-7h14"/>';
    else if(e.type==='smoke')shape='<rect class="lumi-body" x="-28" y="-15" width="56" height="30" rx="5"/><path class="lumi-line" d="M0 15v25m-10-9 10 10 10-10"/><path class="lumi-smoke-direction" d="M-15 50q15 12 30 0M-22 60q22 15 44 0"/>';
    else shape=`<circle class="lumi-body" r="25"/><path class="lumi-line" ${e.color==='red'?'transform="scale(-1 1)"':''} d="m-10-12 22 12-22 12Z"/>`;
    const yLabel=e.type==='desk'&&!e.zone?67:e.type==='screen'?62:e.type==='smoke'?-28:e.type==='street'?45:e.zone?(e.type==='power'?32:43):57;
    const edge=['blue-power','red-power'].includes(e.id),anchor=edge?(e.color==='blue'?'start':'end'):'middle';
    return `<g class="lumi-node lumi-${t}${selected===e.id?' is-selected':''}${!e.enabled?' is-off':''}" transform="translate(${x},${y})" data-lighting-node="${esc(e.id)}" data-action="lighting-select" data-id="${esc(e.id)}" tabindex="0" role="button" aria-pressed="${selected===e.id}" aria-label="${esc(e.label)}${['blue','red'].includes(e.color)?'. '+(e.color==='blue'?'Azul':'Rojo'):''}. ${LIGHTS.has(e.type)?e.enabled?'Simulación al '+e.intensity+' por ciento':'Apagado en la simulación':'Elemento de escenario'}. Pulsa para seleccionar; flechas para mover."><title>${esc(e.label)}</title><circle class="lumi-hit" r="42"/>${shape}<text class="lumi-node-label" text-anchor="${anchor}" y="${yLabel}">${esc(short(name(e)))}</text></g>`;
  }
  function svg() {
    const palettes={blue:'#39ccff',red:'#ff5373',warm:'#ffcc75',white:'#f3efff'};
    return `<svg class="lighting-map" viewBox="0 0 1000 1250" role="group" aria-label="Plano interactivo del escenario, técnica y sala de intérpretes, visto desde el público"><defs><pattern id="lumi-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="lumi-grid-line"/></pattern><clipPath id="lumi-stage-clip"><rect x="70" y="80" width="860" height="540" rx="18"/></clipPath>${Object.entries(palettes).map(([name,color])=>`<radialGradient id="lumi-${name}"><stop offset="0" stop-color="${color}" stop-opacity=".48"/><stop offset="1" stop-color="${color}" stop-opacity=".04"/></radialGradient>`).join('')}</defs><text class="lumi-orientation" text-anchor="middle" x="500" y="43">FONDO DEL ESCENARIO</text><rect class="lumi-stage" x="70" y="80" width="860" height="540" rx="18"/><rect x="70" y="80" width="860" height="540" rx="18" fill="url(#lumi-grid)"/><rect class="lumi-proscenium" x="72" y="462" width="856" height="155" rx="18"/><text class="lumi-zone-label" text-anchor="middle" x="500" y="490">PROSCENIO</text><rect class="lumi-stage" x="60" y="720" width="430" height="510" rx="18"/><rect class="lumi-stage" x="520" y="720" width="430" height="510" rx="18"/><text class="lumi-orientation" text-anchor="middle" x="275" y="750">TÉCNICA</text><text class="lumi-orientation" text-anchor="middle" x="735" y="750">SALA INTÉRPRETES</text><g class="lumi-beams" clip-path="url(#lumi-stage-clip)">${draft.elements.map(beams).join('')}</g><g class="lumi-cables">${cables()}</g><g class="lumi-markers">${draft.elements.map(marker).join('')}</g><path class="lumi-audience-line" d="M220 654h560"/><text class="lumi-orientation" text-anchor="middle" x="500" y="684">PÚBLICO · IZQUIERDA ← → DERECHA</text></svg>`;
  }
  const cableLabels={hdmi:'Vídeo HDMI',data:'PC · tarjeta · mando',audio:'Audio',power:'Alimentación',dmx:'DMX'};
  function cables() {
    return draft.connections.filter(c=>cableView==='all'||c.type===cableView).map((c,i)=>{
      const source=draft.elements.find(e=>e.id===c.from),target=draft.elements.find(e=>e.id===c.to);if(!source||!target)return '';
      const a=at(source),b=at(target),side=source.zone!==target.zone?(target.x>50?965-i*3:35+i*3):null;
      const path=side!==null?`M${a.x} ${a.y}H${side}V${b.y}H${b.x}`:c.type==='power'&&!source.zone?`M${a.x} ${a.y}V${b.y}H${b.x}`:`M${a.x} ${a.y}V${(a.y+b.y)/2}H${b.x}V${b.y}`;
      return `<g class="lumi-route cable-${esc(c.type)}" data-connection="${esc(c.id)}" data-from="${esc(c.from)}" data-to="${esc(c.to)}"><title>${esc(c.label)} · ${esc(source.label)} → ${esc(target.label)}</title><path class="lumi-cable cable-${esc(c.type)}" d="${path}"/><circle class="lumi-cable-end" cx="${b.x}" cy="${b.y}" r="5"/></g>`;
    }).join('');
  }
  function technicalSections() {
    const checks=draft.checklist,groups=[...new Set(checks.map(c=>c.category))];
    const endpoint=id=>{const e=draft.elements.find(e=>e.id===id);return `<span class="lighting-endpoint lumi-${tone(e)}" title="${esc(e.label)}">${esc(name(e))}</span>`;};
    return `<section class="panel lighting-wiring"><div class="panel-head"><h2>Conexiones y cableado</h2><span class="badge gold">${draft.connections.length} recorridos</span></div><p class="tiny">Recorridos esquemáticos, no longitudes reales. Adaptar y validar conectores, alimentación y tendido con la sala.</p><div class="lighting-connections">${draft.connections.map(c=>`<div class="lighting-connection cable-${esc(c.type)}"><strong>${esc(name({label:c.label,color:draft.elements.find(e=>e.id===c.to)?.color}))}</strong><div class="lighting-endpoints">${endpoint(c.from)} <span aria-hidden="true">→</span> ${endpoint(c.to)}</div><input aria-label="Notas de ${esc(c.label)}" data-connection-notes="${esc(c.id)}" data-lighting-control maxlength="1000" value="${esc(c.notes || '')}" placeholder="Longitud, conector, circuito o dirección…"></div>`).join('')}</div></section><section class="panel"><h2>Walkies · cuatro unidades</h2><div class="lighting-walkies">${draft.walkies.map(w=>{const color=w.id==='actors-blue'?'blue':w.id==='actors-red'?'red':'warm';return `<div class="lighting-radio lumi-${color}"><span aria-hidden="true">📻</span><strong title="${esc(w.label)}">${esc(name({label:w.label,color}))}</strong><span class="badge gold">CANAL ${esc(w.channel)}</span>${w.notes?`<small>${esc(w.notes)}</small>`:''}</div>`;}).join('')}</div></section><section class="panel lighting-checklist"><div class="panel-head"><h2>Checklist de montaje técnico</h2><span id="lighting-check-progress" class="badge gold" role="status">${checks.filter(c=>c.done).length}/${checks.length}</span></div><p class="tiny">${scope?'Progreso independiente para este bolo.':'Plano base: los bolos nuevos empiezan con los pasos pendientes.'} Marca los pasos y guarda el plano para compartirlos.</p><div class="lighting-check-groups">${groups.map(group=>`<fieldset><legend>${esc(group)}</legend>${checks.filter(c=>c.category===group).map(c=>`<label class="lighting-check"><input type="checkbox" data-lighting-check="${esc(c.id)}" data-lighting-control ${c.done?'checked':''}><span>${esc(c.text)}</span></label>`).join('')}</fieldset>`).join('')}</div></section>`;
  }
  function inspector() {
    const e=current(),b=bounds(e),light=LIGHTS.has(e.type);
    return `<div class="lighting-inspector lumi-${tone(e)}"><p class="eyebrow">ELEMENTO SELECCIONADO</p><h2>${esc(name(e))}</h2>
      <label class="field">Nombre<input data-lighting-field="label" data-lighting-control value="${esc(e.label)}" maxlength="80" required></label>
      <div class="grid cols2"><label class="field">Horizontal (%)<input type="number" data-lighting-field="x" data-lighting-control value="${e.x}" min="${b.min}" max="${b.max}" step="1"></label><label class="field">${e.zone?'Vertical en su zona':'Fondo → proscenio'} (%)<input type="number" data-lighting-field="y" data-lighting-control value="${e.y}" min="10" max="90" step="1"></label></div>
      ${light?`<label class="lighting-switch"><input type="checkbox" data-lighting-field="enabled" data-lighting-control ${e.enabled?'checked':''}> Encendido en la simulación</label><label class="field">Intensidad simulada <output id="lighting-intensity">${e.intensity}%</output><input type="range" data-lighting-field="intensity" data-lighting-control min="0" max="100" step="1" value="${e.intensity}"></label>`:''}
      <label class="field">${e.type==='smoke'||e.id==='dmx-desk'?'Dirección / canal DMX':'Circuito / canal / conexión'}<input data-lighting-field="channel" data-lighting-control value="${esc(e.channel)}" maxlength="80" placeholder="Por asignar en la sala"></label>
      <label class="field">Notas de montaje<textarea data-lighting-field="notes" data-lighting-control maxlength="2000">${esc(e.notes)}</textarea></label><p class="tiny">Arrastra en el plano o utiliza las posiciones. Con el elemento enfocado, las flechas lo mueven; Mayús acelera el paso.</p></div>`;
  }
  function elementList() {
    return draft.elements.map(e=>`<button type="button" class="lighting-element lumi-${tone(e)}${e.id===selected?' is-selected':''}" data-action="lighting-select" data-id="${esc(e.id)}" data-lighting-control aria-pressed="${e.id===selected}"><span class="lighting-swatch" aria-hidden="true"></span><span>${esc(name(e))}</span>${LIGHTS.has(e.type)?`<small>${e.enabled?e.intensity+'%':'OFF'}</small>`:''}</button>`).join('');
  }
  function render() {
    if(!ensure())return pageHead('PREPARAR LA ESCENA','Técnica','El servidor debe actualizarse para cargar el plano de iluminación.');
    const events=h.state().items.filter(x=>x.kind==='event' && !x.archived).sort((a,b)=>b.start.localeCompare(a.start));
    return pageHead('EL SHOW, CON TODO CONECTADO','Técnica','Escenario, vídeo, técnica, sala de intérpretes y montaje: todo conectado en un mismo plano.',btn('lighting-pdf','↓ Exportar plano PDF'))+
      `<section class="lighting-workspace"><div class="panel lighting-toolbar"><label class="field">Plano<select id="lighting-scope" data-lighting-control><option value=""${scope===''?' selected':''}>Plano base de &lt;SCRI&gt; B</option>${events.map(e=>`<option value="${esc(e.id)}"${scope===e.id?' selected':''}>${esc(e.title)} · ${esc(e.start.slice(0,10))}</option>`).join('')}</select></label><div class="actions"><span id="lighting-status" role="status">${dirty?'Cambios sin guardar':version?'Plano guardado · v'+version:scope?'Adaptación nueva a partir del plano base':'Plano inicial · aún sin guardar'}</span><button class="button small" type="button" data-action="lighting-undo" data-lighting-control title="Deshacer · Ctrl/Cmd+Z" ${busy||!past.length?'disabled':''}>↶ Deshacer</button><button class="button small" type="button" data-action="lighting-redo" data-lighting-control title="Rehacer · Ctrl/Cmd+Mayús+Z o Ctrl/Cmd+Y" ${busy||!future.length?'disabled':''}>↷ Rehacer</button><button class="button" type="button" data-action="lighting-revert" data-lighting-control>↺ Descartar cambios</button><button class="button primary" type="button" data-action="lighting-save" data-lighting-control ${busy?'disabled':''}>${busy?'Guardando…':'✓ Guardar plano'}</button></div></div><div class="lighting-layout"><section class="panel lighting-stage-panel"><div class="panel-head"><div><h2>Plano de escenario</h2><p class="muted">Vista desde el público · no está a escala</p></div><span class="badge gold">SIMULACIÓN</span></div><div class="lighting-cues" aria-label="Vistas de iluminación simulada">${[['all','✦ Todo'],['blue','🔵 Azul'],['red','🔴 Rojo'],['presenter','◉ Presentador'],['frontals','☀ Proscenio'],['black','● Negro']].map(([id,label])=>`<button type="button" class="button small" data-action="lighting-cue" data-id="${id}" data-lighting-control>${label}</button>`).join('')}</div><div class="lighting-cable-filters" aria-label="Capas de cableado">${Object.entries({none:'Sin cables',...cableLabels,all:'Todos'}).map(([id,label])=>`<button type="button" class="button small cable-${id}" data-action="lighting-cables" data-id="${id}" aria-pressed="${id===cableView}">${label}</button>`).join('')}</div><p class="lighting-signal-path"><strong>Vídeo</strong> PC → tarjeta de vídeo → proyector / splitter → monitores <span>Fuente propia · mando al PC · audio a altavoces</span></p><div class="lighting-map-scroll"><div id="lighting-svg">${svg()}</div></div><div id="lighting-elements" class="lighting-elements">${elementList()}</div></section><aside class="panel" id="lighting-inspector">${inspector()}</aside></div>${technicalSections()}<section class="panel lighting-notes"><label class="field">Notas generales para la sala<textarea id="lighting-notes" data-lighting-control maxlength="5000">${esc(draft.notes)}</textarea></label></section></section>`;
  }
  function historyControls() {
    for(const [action,stack] of [['undo',past],['redo',future]]){const button=document.querySelector(`[data-action="lighting-${action}"]`);if(button)button.disabled=busy||!stack.length;}
  }
  function remember(key=null) {
    if(key===null||key!==editGroup){past.push({plan:clone(draft),selected});if(past.length>100)past.shift();}
    future=[];editGroup=key;historyControls();
  }
  function edit(change,key=null) {
    const before=JSON.stringify(draft),snapshot=clone(draft);change();
    if(before===JSON.stringify(draft))return;
    const after=draft;draft=snapshot;remember(key);draft=after;markDirty();
  }
  function markDirty() {
    dirty=JSON.stringify(draft)!==baseline;requestId='';
    const status=document.querySelector('#lighting-status');if(status)status.textContent=dirty?'Cambios sin guardar':version?'Plano guardado · v'+version:'Plano inicial · aún sin guardar';
    historyControls();
  }
  function travel(redo=false) {
    if(busy||drag||!draft)return;
    const from=redo?future:past,to=redo?past:future;if(!from.length)return;
    to.push({plan:clone(draft),selected});const saved=from.pop();draft=clone(saved.plan);selected=saved.selected;editGroup=null;markDirty();h.renderPage();
  }
  function focusout(event) {if(event.target?.matches?.('[data-lighting-control]'))editGroup=null;}
  function redraw() {
    const canvas=document.querySelector('#lighting-svg'),list=document.querySelector('#lighting-elements');
    if(canvas)canvas.innerHTML=svg();if(list)list.innerHTML=elementList();
  }
  function select(id) {
    if(busy || !draft?.elements.some(e=>e.id===id))return;
    if(selected!==id)editGroup=null;
    selected=id;const pane=document.querySelector('#lighting-inspector');if(pane)pane.innerHTML=inspector();
    root()?.querySelectorAll('[data-lighting-node]').forEach(g=>{g.classList.toggle('is-selected',g.dataset.lightingNode===selected);g.setAttribute('aria-pressed',String(g.dataset.lightingNode===selected));});
    document.querySelector('#lighting-elements')?.querySelectorAll('[data-action="lighting-select"]').forEach(button=>{button.classList.toggle('is-selected',button.dataset.id===selected);button.setAttribute('aria-pressed',String(button.dataset.id===selected));});
  }
  function input(node) {
    const key=node.dataset?.lightingField;
    if(node.dataset?.lightingCheck || node.dataset?.connectionNotes) {
      if(busy || !draft)return true;
      if(node.dataset.lightingCheck){
        const check=draft.checklist.find(c=>c.id===node.dataset.lightingCheck);if(check)edit(()=>{check.done=node.checked;});
        const progress=document.querySelector('#lighting-check-progress');if(progress)progress.textContent=draft.checklist.filter(c=>c.done).length+'/'+draft.checklist.length;
      } else {const connection=draft.connections.find(c=>c.id===node.dataset.connectionNotes);if(connection)edit(()=>{connection.notes=node.value;},node);}
      return true;
    }
    if(!key && node.id!=='lighting-notes')return false;
    if(busy || !draft)return true;
    if(node.id==='lighting-notes'){edit(()=>{draft.notes=node.value;},node);return true;}
    const e=current();
    if(key==='x' || key==='y') {
      if(node.value==='' || !Number.isFinite(Number(node.value)))return true;
      const b=bounds(e);edit(()=>{e[key]=limited(Number(node.value),key==='x'?b.min:10,key==='x'?b.max:90);},node);
    } else if(key==='enabled')edit(()=>{e.enabled=node.checked;});
    else if(key==='intensity')edit(()=>{e.intensity=Math.round(limited(Number(node.value),0,100));},node);
    else if(['label','notes','channel'].includes(key))edit(()=>{e[key]=node.value;},node);
    else return false;
    redraw();const output=document.querySelector('#lighting-intensity');if(output)output.textContent=e.intensity+'%';
    // Keep the input/textarea node intact while typing, including its caret.
    const heading=document.querySelector('#lighting-inspector h2');if(heading)heading.textContent=name(e);
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
    const p=point(event,drag.svg);if(!p)return;if(!drag.moved)remember();drag.moved=true;
    const zone=current().zone,x0=zone==='technical'?70:zone==='actors'?530:100,y0=zone?755:100;
    moved((p.x-drag.dx-x0)/(zone?4:8),(p.y-drag.dy-y0)/(zone?4.8:5));
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
    // Native text undo stays native. Plan shortcuts apply only while this workspace is visible.
    const editable=event.target.matches?.('input,textarea,select,[contenteditable="true"]')||event.target.isContentEditable;
    const key=event.key.toLowerCase(),modifier=event.ctrlKey||event.metaKey;
    if(modifier&&!event.altKey&&['z','y'].includes(key)&&!editable&&root()&&!document.querySelector('dialog[open]')){
      event.preventDefault();travel(key==='y'||event.shiftKey);document.querySelector(`[data-lighting-node="${selected}"]`)?.focus();return;
    }
    const node=event.target.closest('[data-lighting-node]');if(!node || busy)return;
    if(['Enter',' '].includes(event.key)){event.preventDefault();select(node.dataset.lightingNode);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();select(node.dataset.lightingNode);const e=current(),step=event.shiftKey?5:1;
    if(!event.repeat)editGroup=null;remember('arrows-'+selected);
    moved(e.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),e.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0));
    redraw();document.querySelector(`[data-lighting-node="${selected}"]`)?.focus();
  }
  function cue(id) {
    if(!['all','blue','red','presenter','frontals','black'].includes(id) || busy)return;
    edit(()=>draft.elements.filter(e=>LIGHTS.has(e.type)).forEach(e=>{e.enabled=id==='all' || e.id===id || (id==='blue'&&e.id==='blue-street') || (id==='red'&&e.id==='red-street');}));
    redraw();select(selected);
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
      version=saved.version;dirty=false;requestId='';draft=upgraded(saved);baseline=JSON.stringify(draft);editGroup=null;
      let refreshed=true;try{await h.refresh(false);}catch(_){refreshed=false;}
      busy=false;h.renderPage();toast(refreshed?'Plano técnico guardado para el equipo.':'Plano guardado. La actualización del resto del espacio está pendiente de conexión.');
    }catch(error){toast(error.message+(error.status===409?' Descarta los cambios para cargar la versión compartida; tu plano sigue aquí.':''));}
    finally{busy=false;controls(false);historyControls();}
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
    else if(a==='lighting-undo')travel();
    else if(a==='lighting-redo')travel(true);
    else if(a==='lighting-revert' && !busy && (!dirty || window.confirm('¿Descartar los cambios sin guardar y cargar el plano compartido?'))){const previous={plan:clone(draft),selected};await h.refresh(false);ensure(true);if(JSON.stringify(previous.plan)!==baseline)past.push(previous);h.renderPage();}
    return true;
  }
  return {render,action,input,changeScope,pointerDown,pointerMove,pointerUp,keydown,focusout,hasDraft:()=>dirty || busy || Boolean(drag)};
};
