"use strict";
window.ScribLighting = function(h) {
  const {esc,btn,pageHead,request,toast} = h;
  const clone = value => JSON.parse(JSON.stringify(value));
  const LIGHTS = new Set(['street','spot','front']);
  const TYPES={computer:'Ordenador',desk:'Mesa con portátil','video-card':'Interfaz de vídeo',splitter:'Splitter HDMI',projector:'Proyector',monitor:'Monitor',screen:'Pantalla',console:'Mesa de control',power:'Alimentación',speaker:'Altavoz',controller:'Mando',smoke:'Máquina de humo',street:'Calle de luz',spot:'Puntual',front:'Frontales',psu:'Fuente de alimentación'};
  let scope='',loadedScope=null,draft=null,version=0,selected='blue-street',dirty=false,busy=false,drag=null,requestId='',cableView='all';
  let baseline='',past=[],future=[],editGroup=null;
  function upgraded(source) {
    const defaults=h.state().lightingDefaults;
    const plan=clone({schemaVersion:defaults.schemaVersion,notes:source.notes||'',elements:source.elements,connections:source.connections||defaults.connections,walkies:source.walkies||defaults.walkies,checklist:source.checklist||defaults.checklist});
    if(source.schemaVersion>=5)return plan;
    const ids=plan.elements.map(e=>e.id);
    const additions=['game-controller','video-card','left-speaker','right-speaker'];
    const v2=defaults.elements.map(e=>e.id).filter(id=>!additions.includes(id));
    const legacy=['blue-street','red-street','presenter','frontals','blue-desk','red-desk','screen'];
    const same=(a,b)=>new Set(a).size===a.length&&a.length===b.length&&b.every(id=>a.includes(id));
    if([legacy,v2,[...defaults.elements.map(e=>e.id),'video-psu'],defaults.elements.map(e=>e.id)].some(keys=>same(ids,keys))){
      const positions={splitter:[50,34],'blue-power':[14,28],'red-power':[86,28],'game-computer':[25,25],'sound-computer':[75,25],'sound-desk':[75,65],'technical-power':[25,65],'dmx-desk':[50,90]};
      for(const e of plan.elements){const d=defaults.elements.find(x=>x.id===e.id),p=positions[e.id];if(d&&[legacy,v2].some(keys=>same(ids,keys))&&p&&e.x===p[0]&&e.y===p[1]){e.x=d.x;e.y=d.y;}if(e.id==='splitter')e.zone='technical';}
      plan.elements.push(...clone(defaults.elements.filter(e=>!ids.includes(e.id))));
    }
    const labels={'video-card':'Tarjeta de vídeo · 2 HDMI',splitter:'Splitter HDMI 1 → 2','dmx-desk':'Control DMX · humo'};
    plan.elements=plan.elements.filter(e=>e.id!=='video-psu').map(e=>{
      const d=defaults.elements.find(x=>x.id===e.id);if(!d)return e;
      const row={...clone(d),...e};if(row.label===labels[e.id])row.label=d.label;
      return row;
    });
    for(const [field,retired,added] of [['connections',['power-game','power-video-psu'],['data-video','data-controller','power-video-card','power-video-psu','audio-left','audio-right','power-left-speaker','power-right-speaker']],['checklist',['room','cables','backup','sound-cues','speakers'],['video-card','controller','speakers']]]){
      const rows=plan[field],keys=rows.map(r=>r.id),fixed=defaults[field].map(r=>r.id);
      const previous=[...new Set([...fixed,...retired])];
      const historical=[previous,previous.filter(id=>!added.includes(id)),previous.filter(id=>id!=='power-game'),previous.filter(id=>id!=='power-video-psu'),previous.filter(id=>id!=='power-game'&&!added.includes(id)),fixed];
      if(!historical.some(ids=>same(keys,ids)))continue;
      plan[field]=defaults[field].map(d=>{
        const r=rows.find(r=>r.id===d.id),copy={...clone(d),...(r?.notes!==undefined?{notes:r.notes}:{}),...(r?.done!==undefined?{done:r.done}:{})};
        const speakers=rows.find(r=>r.id==='speakers');
        if(field==='checklist'&&d.id==='sound'&&speakers){copy.done=Boolean(r?.done&&speakers.done);copy.notes=[...new Set([r?.notes,speakers.notes].filter(Boolean))].join('\n');}
        return copy;
      });
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
    if(!draft.elements.some(e=>e.id===selected))selected=draft.elements[0]?.id||'';
    return true;
  }
  const current = () => draft.elements.find(e=>e.id===selected);
  const tone = e => e.type==='monitor'?'white':['blue','red','warm','white'].includes(e.color)?e.color:'white';
  const short = value => value.length>29?value.slice(0,28)+'…':value;
  const name = e => e.type==='monitor'?e.label.replace(/·\s*(azul|rojo)$/i,(_,team)=>'· '+(team.toLowerCase()==='azul'?'izquierdo':'derecho')):['blue','red'].includes(e.color)?e.label.replace(/(?:\s*·)?\s+(?:azul(?:es)?|roj[oa]s?)$/i,''):e.label;
  const at = e => e.zone==='technical'?({x:100+8*e.x,y:755+4.8*e.y}):e.zone==='actors'?({x:100+8*e.x,y:1290+2.5*e.y}):({x:100+8*e.x,y:100+5*e.y});
  function freePosition(zone) {
    const occupied=draft.elements.filter(e=>(e.zone||'stage')===zone).map(at);
    const candidates=[20,50,80].flatMap(y=>[15,50,85].map(x=>({x,y,...(zone!=='stage'?{zone}:{})})));
    const distance=p=>{const point=at(p);return occupied.length?Math.min(...occupied.map(q=>Math.hypot(point.x-q.x,point.y-q.y))):0;};
    candidates.sort((a,b)=>distance(b)-distance(a));
    return {x:candidates[0].x,y:candidates[0].y};
  }
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
    else if(e.type==='splitter')shape='<rect class="lumi-body" x="-45" y="-25" width="90" height="50" rx="8"/><path class="lumi-line" d="M-45 0h32L15-11h30M-13 0l28 11h30"/>';
    else if(e.type==='power')shape='<rect class="lumi-body" x="-13" y="-22" width="26" height="44" rx="6"/><circle class="lumi-line" cy="-10" r="5"/><circle class="lumi-line" cy="10" r="5"/><text class="lumi-port-label" x="0" y="-30" text-anchor="middle">230 V</text>';
    else if(e.type==='psu')shape='<rect class="lumi-body" x="-29" y="-18" width="58" height="36" rx="5"/><path class="lumi-line" d="M-45 0h16M29 0h16M-8-6h16M-8 6h16"/>';
    else if(e.type==='video-card')shape='<rect class="lumi-body" x="-38" y="-21" width="76" height="42" rx="5"/><path class="lumi-line" d="M-25-10h25v20h-25zM14-11h15v8H14zM14 3h15v8H14zM-46 0h8M38-7h12M38 7h12"/>';
    else if(e.type==='controller')shape='<path class="lumi-body" d="M-23-16h46q12 0 15 20l2 14q-2 13-16 2l-8-7h-32l-8 7q-14 11-16-2l2-14q3-20 15-20Z"/><path class="lumi-line" d="M-24-4h16M-16-12V4"/><circle class="lumi-line" cx="20" cy="-8" r="3"/><circle class="lumi-line" cx="28" cy="0" r="3"/>';
    else if(e.type==='speaker')shape='<rect class="lumi-body" x="-23" y="-35" width="46" height="70" rx="5"/><circle class="lumi-line" cy="-16" r="8"/><circle class="lumi-line" cy="13" r="15"/>';
    else if(e.type==='console')shape='<rect class="lumi-body" x="-38" y="-22" width="76" height="44" rx="5"/><path class="lumi-line" d="M-20-12v24M0-12v24M20-12v24M-27-3h14M-7 7H7M13-7h14"/>';
    else if(e.type==='smoke')shape='<rect class="lumi-body" x="-28" y="-15" width="56" height="30" rx="5"/><path class="lumi-line" d="M0 15v25m-10-9 10 10 10-10"/><path class="lumi-smoke-direction" d="M-15 50q15 12 30 0M-22 60q22 15 44 0"/>';
    else shape=`<circle class="lumi-body" r="25"/><path class="lumi-line" ${e.color==='red'?'transform="scale(-1 1)"':''} d="m-10-12 22 12-22 12Z"/>`;
    const yLabel=e.type==='desk'&&!e.zone?67:e.type==='screen'?62:e.type==='smoke'?-28:e.type==='spot'?-60:e.type==='street'?45:e.zone?(e.type==='power'?32:43):57;
    const edge=['blue-power','red-power'].includes(e.id),anchor=edge?(e.color==='blue'?'start':'end'):'middle';
    const label=name(e),parts=(e.zone||e.type==='spot')&&label.includes(' · ')?label.split(' · '):[label];
    return `<g class="lumi-node lumi-${t}${selected===e.id?' is-selected':''}${!e.enabled?' is-off':''}" transform="translate(${x},${y})" data-lighting-node="${esc(e.id)}" data-action="lighting-select" data-id="${esc(e.id)}" tabindex="0" role="button" aria-pressed="${selected===e.id}" aria-label="${esc(e.label)}. ${LIGHTS.has(e.type)?e.enabled?'Intensidad '+e.intensity+' por ciento':'Apagado':'Elemento de escenario'}. Pulsa para seleccionar; flechas para mover."><title>${esc(e.label)}</title><circle class="lumi-hit" r="42"/>${shape}<text class="lumi-node-label" text-anchor="${anchor}" y="${yLabel}">${parts.map((part,i)=>`<tspan x="0" dy="${i?18:0}">${esc(short(part))}</tspan>`).join('')}</text></g>`;
  }
  function svg() {
    const palettes={blue:'#39ccff',red:'#ff5373',warm:'#ffcc75',white:'#f3efff'};
    return `<svg class="lighting-map" viewBox="0 0 1000 1600" role="group" aria-label="Plano interactivo del escenario, técnica y sala de intérpretes, visto desde el público"><defs><pattern id="lumi-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="lumi-grid-line"/></pattern><clipPath id="lumi-stage-clip"><rect x="70" y="80" width="860" height="540" rx="18"/></clipPath>${Object.entries(palettes).map(([name,color])=>`<radialGradient id="lumi-${name}"><stop offset="0" stop-color="${color}" stop-opacity=".48"/><stop offset="1" stop-color="${color}" stop-opacity=".04"/></radialGradient>`).join('')}</defs><text class="lumi-orientation" text-anchor="middle" x="500" y="43">FONDO DEL ESCENARIO</text><rect class="lumi-stage" x="70" y="80" width="860" height="540" rx="18"/><rect x="70" y="80" width="860" height="540" rx="18" fill="url(#lumi-grid)"/><rect class="lumi-proscenium" x="72" y="462" width="856" height="155" rx="18"/><text class="lumi-zone-label" text-anchor="middle" x="500" y="490">PROSCENIO</text><rect class="lumi-stage" x="60" y="730" width="900" height="510" rx="18"/><rect class="lumi-stage" x="60" y="1280" width="900" height="300" rx="18"/><text class="lumi-orientation" text-anchor="middle" x="500" y="770">TÉCNICA</text><text class="lumi-orientation" text-anchor="middle" x="500" y="1310">SALA INTÉRPRETES</text><g class="lumi-beams" clip-path="url(#lumi-stage-clip)">${draft.elements.map(beams).join('')}</g><g class="lumi-cables">${cables()}</g><g class="lumi-markers">${draft.elements.map(marker).join('')}</g><g class="lumi-ports">${connectionPorts()}</g><g class="lumi-audience" aria-hidden="true">${[280,350,420,500,580,650,720].map(x=>`<g transform="translate(${x},660)"><circle cy="-10" r="7"/><path d="M-12 18v-6a12 12 0 0 1 24 0v6M-7 18v10M7 18v10"/></g>`).join('')}</g><text class="lumi-orientation" text-anchor="middle" x="500" y="714">PÚBLICO</text></svg>`;
  }
  const cableLabels={hdmi:'Vídeo',data:'Datos / USB',audio:'Audio',power:'Alimentación',dmx:'DMX'};
  function cables() {
    return draft.connections.filter(c=>cableView==='all'||c.type===cableView).map((c,i)=>{
      const source=draft.elements.find(e=>e.id===c.from),target=draft.elements.find(e=>e.id===c.to);if(!source||!target)return '';
      const a=port(source,c,true),b=port(target,c,false),side=source.zone!==target.zone?(target.x>50?965-i*3:35+i*3):null;
      const path=side!==null?`M${a.x} ${a.y}H${side}V${b.y}H${b.x}`:c.type==='power'&&!source.zone?`M${a.x} ${a.y}V${b.y}H${b.x}`:`M${a.x} ${a.y}V${(a.y+b.y)/2}H${b.x}V${b.y}`;
      return `<g class="lumi-route cable-${esc(c.type)}" data-connection="${esc(c.id)}" data-from="${esc(c.from)}" data-to="${esc(c.to)}"><title>${esc(c.label)} · ${esc(source.label)} → ${esc(target.label)}</title><path class="lumi-cable cable-${esc(c.type)}" d="${path}"/></g>`;
    }).join('');
  }
  function port(e,connection,source) {
    const point=at(e);
    if(e.type==='splitter')return {...point,x:point.x+(source?45:connection.type==='power'?0:-45),y:point.y+(connection.type==='power'?25:source?(connection.to==='blue-monitor'?-11:11):0)};
    const widths={desk:80,computer:35,monitor:35,projector:38,console:38,'video-card':38,psu:29,power:13,speaker:23,smoke:28,controller:42};
    return {...point,x:point.x+(source?1:-1)*(widths[e.type]||0)};
  }
  function connectionPorts() {
    return draft.connections.filter(c=>cableView==='all'||c.type===cableView).map(c=>[c.from,c.to].map((id,i)=>{
      const e=draft.elements.find(e=>e.id===id);if(!e)return '';
      const p=port(e,c,i===0);
      return `<circle class="lumi-cable-end cable-${esc(c.type)}" data-port-for="${esc(id)}" cx="${p.x}" cy="${p.y}" r="4"><title>${esc(c.label)} · ${esc(e.label)}</title></circle>`;
    }).join('')).join('');
  }
  function materialSummary() {
    const cables=Object.entries(cableLabels).map(([type,label])=>({label,type,icon:{hdmi:'▣',data:'⌘',audio:'♫',power:'ϟ',dmx:'✦'}[type],count:draft.connections.filter(c=>c.type===type).length}));
    const equipment=Object.entries(TYPES).map(([type,label])=>({label,icon:{computer:'💻',desk:'✍',monitor:'▣',screen:'▱',projector:'🎥',splitter:'↣','video-card':'▤',controller:'🎮',speaker:'🔊',console:'🎛',smoke:'☁',power:'ϟ',street:'✦',spot:'◉',front:'☀',psu:'▰'}[type],count:draft.elements.filter(e=>e.type===type).length}));
    equipment.push({label:'Walkies',icon:'📻',count:draft.walkies.length});
    const rows=items=>items.filter(x=>x.count).map(x=>`<div class="lighting-material ${x.type?'cable-'+esc(x.type):''}"><span class="material-icon" aria-hidden="true">${x.icon}</span><strong>${x.count}</strong><span class="material-label">${esc(x.label)}</span></div>`).join('');
    return `<section class="panel lighting-materials"><div class="panel-head"><div><p class="eyebrow">TODO LISTO PARA CONECTAR</p><h2>Material técnico del show</h2></div><span class="badge gold">${draft.connections.length} conexiones · ${draft.elements.length} elementos</span></div><div class="lighting-material-columns"><section><h3>ϟ Cableado</h3><div class="lighting-material-list">${rows(cables)}</div></section><section><h3>▣ Equipos</h3><div class="lighting-material-list">${rows(equipment)}</div></section></div></section>`;
  }
  function technicalSections() {
    const checks=draft.checklist,groups=[...new Set(checks.map(c=>c.category))];
    return materialSummary()+`<section class="panel"><h2>Walkies · cuatro unidades</h2><div class="lighting-walkies">${draft.walkies.map(w=>{const color=w.id==='actors-blue'?'blue':w.id==='actors-red'?'red':'warm';return `<div class="lighting-radio lumi-${color}"><span aria-hidden="true">📻</span><strong title="${esc(w.label)}">${esc(name({label:w.label,color}))}</strong><span class="badge gold">CANAL ${esc(w.channel)}</span>${w.notes?`<small>${esc(w.notes)}</small>`:''}</div>`;}).join('')}</div></section><section class="panel lighting-checklist"><div class="panel-head"><h2>Checklist de montaje técnico</h2><span id="lighting-check-progress" class="badge gold" role="status">${checks.filter(c=>c.done).length}/${checks.length}</span></div><p class="tiny">${scope?'Progreso independiente para este bolo.':'Plano base: los bolos nuevos empiezan con los pasos pendientes.'} Marca los pasos y guarda el plano para compartirlos.</p><div class="lighting-check-groups">${groups.map(group=>`<fieldset><legend>${esc(group)}</legend>${checks.filter(c=>c.category===group).map(c=>`<label class="lighting-check"><input type="checkbox" data-lighting-check="${esc(c.id)}" data-lighting-control ${c.done?'checked':''}><span>${esc(c.text)}</span></label>`).join('')}</fieldset>`).join('')}</div></section>`;
  }
  function inspector() {
    const e=current();if(!e)return '<p class="muted">Añade un elemento para empezar el plano.</p>';
    const b=bounds(e),light=LIGHTS.has(e.type),connections=draft.connections.filter(c=>c.from===e.id||c.to===e.id);
    return `<div class="lighting-inspector lumi-${tone(e)}"><p class="eyebrow">ELEMENTO SELECCIONADO</p><h2>${esc(name(e))}</h2>
      <label class="field">Nombre<input data-lighting-field="label" data-lighting-control value="${esc(e.label)}" maxlength="80" required></label>
      <div class="grid cols2"><label class="field">Horizontal (%)<input type="number" data-lighting-field="x" data-lighting-control value="${e.x}" min="${b.min}" max="${b.max}" step="1"></label><label class="field">${e.zone?'Vertical en su zona':'Fondo → proscenio'} (%)<input type="number" data-lighting-field="y" data-lighting-control value="${e.y}" min="10" max="90" step="1"></label></div>
      ${light?`<label class="lighting-switch"><input type="checkbox" data-lighting-field="enabled" data-lighting-control ${e.enabled?'checked':''}> Encendido</label><label class="field">Intensidad <output id="lighting-intensity">${e.intensity}%</output><input type="range" data-lighting-field="intensity" data-lighting-control min="0" max="100" step="1" value="${e.intensity}"></label>`:''}
      <label class="field">Notas de montaje<textarea data-lighting-field="notes" data-lighting-control maxlength="2000">${esc(e.notes)}</textarea></label>
      <section class="lighting-link-editor"><h3>Conectar con…</h3><label class="field">Destino<select id="lighting-link-target" data-lighting-control>${draft.elements.filter(x=>x.id!==e.id).map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}</select></label><label class="field">Tipo<select id="lighting-link-type" data-lighting-control>${Object.entries(cableLabels).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>${btn('lighting-connect','＋ Conectar','','small')}
      <div class="lighting-link-list">${connections.map(c=>`<div class="lighting-link cable-${esc(c.type)}"><span><strong>${esc(cableLabels[c.type])}</strong><small>${esc(draft.elements.find(x=>x.id===(c.from===e.id?c.to:c.from))?.label||'Elemento eliminado')} ${c.from===e.id?'↗':'↙'}</small></span>${btn('lighting-disconnect','×',c.id,'icon-button')}</div>`).join('')}</div></section>${btn('lighting-remove','⌫ Eliminar elemento',e.id,'small danger')}</div>`;
  }
  function render() {
    if(!ensure())return pageHead('PREPARAR LA ESCENA','Técnica','El servidor debe actualizarse para cargar el plano de iluminación.');
    const events=h.state().items.filter(x=>x.kind==='event' && !x.archived).sort((a,b)=>b.start.localeCompare(a.start));
    return pageHead('EL SHOW, CON TODO CONECTADO','Técnica','Escenario, vídeo, técnica, sala de intérpretes y montaje: todo conectado en un mismo plano.',btn('lighting-pdf','↓ Exportar plano PDF'))+
      `<section class="lighting-workspace"><div class="panel lighting-toolbar"><label class="field">Plano<select id="lighting-scope" data-lighting-control><option value=""${scope===''?' selected':''}>Plano base de &lt;SCRI&gt; B</option>${events.map(e=>`<option value="${esc(e.id)}"${scope===e.id?' selected':''}>${esc(e.title)} · ${esc(e.start.slice(0,10))}</option>`).join('')}</select></label><div class="actions"><span id="lighting-status" role="status">${dirty?'Cambios sin guardar':version?'Plano guardado · v'+version:scope?'Adaptación nueva a partir del plano base':'Plano inicial · aún sin guardar'}</span><button class="button small" type="button" data-action="lighting-undo" data-lighting-control title="Deshacer · Ctrl/Cmd+Z" ${busy||!past.length?'disabled':''}>↶ Deshacer</button><button class="button small" type="button" data-action="lighting-redo" data-lighting-control title="Rehacer · Ctrl/Cmd+Mayús+Z o Ctrl/Cmd+Y" ${busy||!future.length?'disabled':''}>↷ Rehacer</button><button class="button" type="button" data-action="lighting-revert" data-lighting-control>↺ Descartar cambios</button><button class="button primary" type="button" data-action="lighting-save" data-lighting-control ${busy?'disabled':''}>${busy?'Guardando…':'✓ Guardar plano'}</button></div></div><div class="lighting-layout"><section class="panel lighting-stage-panel"><div class="panel-head"><div><h2>Plano de escenario</h2></div></div><div class="lighting-cues" aria-label="Vistas de iluminación">${[['all','✦ Todo'],['blue','🔵 Azul'],['red','🔴 Rojo'],['presenter','◉ Presentador'],['frontals','☀ Proscenio'],['black','● Negro']].map(([id,label])=>`<button type="button" class="button small" data-action="lighting-cue" data-id="${id}" data-lighting-control>${label}</button>`).join('')}</div><div class="lighting-cable-filters" aria-label="Capas de cableado">${Object.entries({none:'Sin cables',...cableLabels,all:'Todos'}).map(([id,label])=>`<button type="button" class="button small cable-${id}" data-action="lighting-cables" data-id="${id}" aria-pressed="${id===cableView}">${label}</button>`).join('')}</div><div class="lighting-add-element"><label class="field">Nuevo elemento<select id="lighting-new-type" data-lighting-control>${Object.entries(TYPES).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label class="field">Zona<select id="lighting-new-zone" data-lighting-control><option value="stage">Escenario</option><option value="technical">Técnica</option><option value="actors">Sala de intérpretes</option></select></label><label class="field">Color<select id="lighting-new-color" data-lighting-control><option value="white">Neutro</option><option value="blue">Azul</option><option value="red">Rojo</option><option value="warm">Cálido</option></select></label>${btn('lighting-add','＋ Añadir','','small')}</div><div class="lighting-map-scroll"><div id="lighting-svg">${svg()}</div></div></section><aside class="panel" id="lighting-inspector">${inspector()}</aside></div>${technicalSections()}<section class="panel lighting-notes"><label class="field">Notas generales para la sala<textarea id="lighting-notes" data-lighting-control maxlength="5000">${esc(draft.notes)}</textarea></label></section></section>`;
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
    const canvas=document.querySelector('#lighting-svg');
    if(canvas)canvas.innerHTML=svg();
  }
  function select(id) {
    if(busy || !draft?.elements.some(e=>e.id===id))return;
    if(selected!==id)editGroup=null;
    selected=id;const pane=document.querySelector('#lighting-inspector');if(pane)pane.innerHTML=inspector();
    root()?.querySelectorAll('[data-lighting-node]').forEach(g=>{g.classList.toggle('is-selected',g.dataset.lightingNode===selected);g.setAttribute('aria-pressed',String(g.dataset.lightingNode===selected));});
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
    const zone=current().zone,x0=100,y0=zone==='technical'?755:zone==='actors'?1290:100;
    moved((p.x-drag.dx-x0)/8,(p.y-drag.dy-y0)/(zone==='technical'?4.8:zone==='actors'?2.5:5));
    const e=current(),node=drag.svg.querySelector(`[data-lighting-node="${e.id}"]`),pos=at(e);
    node?.setAttribute('transform',`translate(${pos.x},${pos.y})`);
    const beamGroup=drag.svg.querySelector('.lumi-beams');if(beamGroup)beamGroup.innerHTML=draft.elements.map(beams).join('');
    const cableGroup=drag.svg.querySelector('.lumi-cables');if(cableGroup)cableGroup.innerHTML=cables();
    const ports=drag.svg.querySelector('.lumi-ports');if(ports)ports.innerHTML=connectionPorts();
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
    if(busy)return true;
    if(a==='lighting-add'){
      if(draft.elements.length>=100){toast('Máximo 100 elementos.');return true;}
      const type=document.querySelector('#lighting-new-type')?.value,zone=document.querySelector('#lighting-new-zone')?.value,color=document.querySelector('#lighting-new-color')?.value;
      if(!TYPES[type]||!['stage','technical','actors'].includes(zone)||!['white','blue','red','warm'].includes(color))return true;
      const ident='node-'+crypto.randomUUID();
      edit(()=>{draft.elements.push({id:ident,type,label:TYPES[type],color,...freePosition(zone),enabled:true,intensity:100,channel:'',notes:'',...(zone!=='stage'?{zone}: {})});});selected=ident;h.renderPage();
      return true;
    }
    if(a==='lighting-remove'){
      const e=current();if(!e)return true;
      const count=draft.connections.filter(c=>c.from===e.id||c.to===e.id).length;
      if(!window.confirm('¿Eliminar '+e.label+(count?' y sus '+count+' conexiones':'')+'? Puedes deshacerlo.'))return true;
      edit(()=>{draft.elements=draft.elements.filter(x=>x.id!==e.id);draft.connections=draft.connections.filter(c=>c.from!==e.id&&c.to!==e.id);});selected=draft.elements[0]?.id||'';h.renderPage();return true;
    }
    if(a==='lighting-connect'){
      const e=current(),target=document.querySelector('#lighting-link-target')?.value,type=document.querySelector('#lighting-link-type')?.value;
      if(!e||e.id===target||!draft.elements.some(x=>x.id===target)||!cableLabels[type])return true;
      if(draft.connections.length>=200){toast('Máximo 200 conexiones.');return true;}
      if(draft.connections.some(c=>c.type===type&&c.from===e.id&&c.to===target)){toast('Esta conexión ya existe.');return true;}
      edit(()=>{draft.connections.push({id:'link-'+crypto.randomUUID(),from:e.id,to:target,type,label:cableLabels[type],notes:''});});h.renderPage();return true;
    }
    if(a==='lighting-disconnect'){
      if(draft.connections.some(c=>c.id===id)){edit(()=>{draft.connections=draft.connections.filter(c=>c.id!==id);});h.renderPage();}return true;
    }
    if(a==='lighting-pdf'){
      if(node.disabled)return true;
      const label=node.innerHTML,plan=clone(draft);node.disabled=true;node.textContent='Preparando plano…';
      try {
        const planImage=await window.ScribPlanImage(document.querySelector('.lighting-map'));
        node.disabled=false;node.innerHTML=label;
        await window.ScribExport(h.state(),{kind:'lighting',id:scope,plan,planImage},node);
      }finally{node.disabled=false;node.innerHTML=label;}
      return true;
    }
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
