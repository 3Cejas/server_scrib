"use strict";
window.ScribLaboratory = function(h) {
  const games = [
    {id:"bolzano",title:"Bolzano",subtitle:"Conectar dos palabras",description:"Un calentamiento colectivo: las musas aportan palabras y buscan un punto de encuentro. Conserva los modos Control, Musa azul y Musa roja.",tags:["Colectivo","Calentamiento"],url:"/scrib/backstage/laboratory/bolzano/"},
    {id:"s7",title:"S+7",subtitle:"Escribir con restricciones",description:"Transforma un texto desplazando sus palabras por el diccionario. Explora S+7, V+7, A+7, SAV+7, Eclipse y Caradec; también puedes utilizar tu propio diccionario.",tags:["Oulipo","Escritura"],url:"/scrib/backstage/laboratory/s7/"}
  ];
  function list() {
    return h.pageHead("PROBAR · JUGAR · DESCUBRIR","Laboratorio","Juegos para explorar otras maneras de escribir y crear en equipo.")+
      `<div class="grid cols2 laboratory-grid">${games.map(g=>`<article class="panel laboratory-card laboratory-card--${g.id}"><a class="laboratory-cover" href="#experiment/${g.id}" aria-label="Abrir ${g.title}">${g.id==="bolzano"?'<div class="laboratory-words" aria-hidden="true"><span>Mar</span><b>⇄</b><span>Cielo</span></div>':'<div class="laboratory-formula" aria-hidden="true"><span>S</span><b>+</b><span>7</span></div>'}<span class="laboratory-play" aria-hidden="true">▶</span></a><div class="material-body"><div class="label-group">${g.tags.map(t=>h.badge(t,g.id==="bolzano"?"cyan":"violet")).join("")}</div><h2>${g.title}</h2><p class="laboratory-subtitle">${g.subtitle}</p><p class="muted">${g.description}</p><a class="button primary" href="#experiment/${g.id}">Jugar ↗</a></div></article>`).join("")}</div>`;
  }
  function detail(id) {
    const g=games.find(g=>g.id===id);
    if(!g)return h.empty("Juego no encontrado","Elige uno de los juegos del laboratorio.",'<a class="button" href="#laboratory">← Laboratorio</a>');
    return h.pageHead("LABORATORIO",g.title,g.subtitle,'<a class="button" href="#laboratory">← Laboratorio</a>'+h.btn('laboratory-fullscreen','⛶ Pantalla completa')+`<a class="button" href="${g.url}" target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a>`)+
      `<div class="laboratory-viewer"><iframe title="Juego ${g.title}" src="${g.url}" allow="fullscreen; clipboard-write" allowfullscreen></iframe></div>`;
  }
  async function action(node) {
    if(node.dataset.action!=="laboratory-fullscreen")return false;
    const frame=document.querySelector('.laboratory-viewer iframe');
    if(!frame?.requestFullscreen)throw new Error("Este navegador no permite pantalla completa. Abre el juego en otra pestaña.");
    await frame.requestFullscreen();frame.focus();return true;
  }
  return {list,detail,action};
};
