"use strict";
// Build the carousel only from this immutable saved report, never live Control.
window.ScribSavedReportSocial = {
  data(r) {
    const players={},muses={};
    for(const id of ['1','2']){
      const s=r.stats?.players?.[id]||{},group=r.muses?.equipos?.[id]||{},rows=group.musas||[];
      const sent=rows.reduce((n,m)=>n+(Number(m.stats?.enviadas)||0),0),used=rows.reduce((n,m)=>n+(Number(m.stats?.introducidas)||0),0);
      players[id]={nombre:r.writers[id].name,texto:r.writers[id].text,palabras:s.palabrasTotal,unicas:s.palabrasUnicas,pulsaciones:s.pulsacionesTotal,ppm:s.ritmoPpm,inspiraciones:used,puntuacion:r.score?.jugadores?.[id]?.total,
        letrasBenditas:s.letrasBenditas||[],letrasMalditas:s.letrasMalditas||[],palabrasBenditas:s.palabrasBenditas||[],palabrasMalditas:s.palabrasMalditas||[]};
      muses[id]={cantidad:rows.length,nombres:rows.map(m=>m.nombre),enviadas:sent,introducidas:used,efectividad:sent?Math.round(100*used/sent):0,superbonus:rows.reduce((n,m)=>n+(Number(m.stats?.superbonus)||0),0)};
    }
    const seconds=Math.max(0,Math.round((r.endedAt-r.startedAt)/1000));
    return {fecha:new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'long'}).format(new Date(r.endedAt)),duracion:Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'),jugadores:players,musas:muses,puntuacion:r.score};
  },
  async download(r,button) {
    if(button.disabled)return;const label=button.innerHTML;button.disabled=true;button.setAttribute('aria-busy','true');
    try{
      if(!r?.writers?.['1']||!r?.writers?.['2'])throw Error('La partida no contiene los dos textos guardados.');
      const data=this.data(r);
      if(window.ScribInstagramReport.crearPlan(data).slides.length>200)throw Error('El carrusel supera las 200 imágenes. Exporta esta partida en PDF.');
      if(document.fonts?.load)await document.fonts.load('16px "Retro-gaming"');
      const result=await window.ScribInstagramReport.generarPngs(data,{onProgress:(n,total)=>button.textContent=`Creando PNG ${n}/${total}…`});
      const zip=window.ScribInstagramReport.crearZip(result.archivos),url=URL.createObjectURL(new Blob([zip],{type:'application/zip'})),link=document.createElement('a');
      link.href=url;link.download='SCRIB-Instagram-'+new Date(r.endedAt).toISOString().slice(0,10)+'-'+String(r.id).replace(/[^a-z0-9_-]/gi,'').slice(0,50)+'.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }finally{button.disabled=false;button.innerHTML=label;button.removeAttribute('aria-busy');}
  }
};
