"use strict";
window.ScribMaterials = function(h) {
  let materials=null, pending=null, error='';
  function load() {
    if(materials||pending)return;
    pending=h.request('materials').then(data=>{materials=data.materials;error='';}).catch(e=>{error=e.message;}).finally(()=>{pending=null;if(/^#materials?$|^#material\//.test(location.hash))h.renderPage();});
  }
  function waiting() {
    if(error)return h.empty('No se ha podido abrir la biblioteca',error,h.btn('reload-materials','Reintentar'));
    load();return '<div class="loading" role="status">Abriendo materiales…</div>';
  }
  function list() {
    return h.pageHead('LA CAJA DE HERRAMIENTAS','Materiales','Las presentaciones de SCRIB, reunidas aquí con sus imágenes, vídeos y animaciones. Acceso exclusivo del equipo.')+
      (materials?`<div class="grid cols2 material-grid">${materials.map(m=>`<article class="panel material-card"><a href="#material/${h.esc(m.id)}" class="material-cover" aria-label="Abrir ${h.esc(m.title)}"><img src="${h.esc(m.cover)}" alt="" loading="lazy"><span>▶ Abrir presentación</span></a><div class="material-body"><div class="label-group">${m.tags.map(t=>h.badge(t,'violet')).join('')}${h.badge(m.slides+' diapositivas','cyan')}</div><h2>${h.esc(m.title)}</h2><p class="muted">${h.esc(m.description)}</p><a href="#material/${h.esc(m.id)}" class="button primary">Presentar ↗</a></div></article>`).join('')}</div>`:waiting());
  }
  function detail(id) {
    if(!materials)return waiting();
    const m=materials.find(m=>m.id===id);
    if(!m)return h.empty('Material no encontrado','Elige una de las presentaciones disponibles.','<a class="button" href="#materials">Volver a materiales</a>');
    return h.pageHead('MATERIALES',m.title,'Avanza con las flechas del visor o del teclado. En móvil también puedes deslizar.',`<a class="button" href="#materials">← Biblioteca</a>`+h.btn('material-fullscreen','⛶ Pantalla completa'))+
      `<div class="material-viewer"><iframe title="${h.esc(m.title)}" src="${h.esc(m.url)}" allow="fullscreen; autoplay" allowfullscreen></iframe></div><p class="hint section">Pulsa sobre la presentación para usar las flechas del teclado. Escape sale de pantalla completa.</p>`;
  }
  async function action(node) {
    if(node.dataset.action==='material-fullscreen'){
      const frame=document.querySelector('.material-viewer iframe');
      if(!frame?.requestFullscreen)throw new Error('Este navegador no permite pantalla completa. Usa el botón del visor.');
      await frame.requestFullscreen();frame.focus();return true;
    }
    if(node.dataset.action==='reload-materials'){error='';load();h.renderPage();return true;}
    return false;
  }
  return {list,detail,action};
};
