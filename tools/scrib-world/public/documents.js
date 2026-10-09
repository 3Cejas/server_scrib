"use strict";
window.ScribDocuments=function(h){
  const MAX=16*1024*1024;
  async function action(node){
    if(node.dataset.action!=='verify-document')return false;
    if(!h.isAdmin())throw new Error('La trazabilidad está reservada a administración.');
    h.openDialog('document','Comprobar origen del PDF',`<form id="document-check-form"><p class="muted">Comprueba quién generó el original y si este archivo sigue intacto. No modifica el PDF ni lo publica.</p><label class="field">PDF de SCRIB<input type="file" name="pdf" accept="application/pdf,.pdf" required></label><p class="hint">Hasta 16 MB. Los documentos anteriores a esta función no tienen sello. Una copia modificada no acredita la autoría de sus cambios.</p><div class="document-check-result" aria-live="polite"></div><p class="form-error" role="alert"></p><button type="submit" class="button primary">Comprobar documento</button></form>`);
    return true;
  }
  async function submit(form){
    const button=form.querySelector('[type=submit]'),error=form.querySelector('.form-error'),result=form.querySelector('.document-check-result');
    if(button.disabled)return;error.textContent='';result.innerHTML='';button.disabled=true;button.textContent='Comprobando…';
    try{
      const file=form.querySelector('[name=pdf]').files[0];
      if(!file||file.size>MAX)throw new Error('Selecciona un PDF de hasta 16 MB.');
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.onload=()=>resolve(String(reader.result).split(',',2)[1]);reader.readAsDataURL(file);});
      const data=await h.request('pdf/verify',{pdf:encoded});
      if(data.status==='original'||data.status==='modified'){
        result.innerHTML=`<div class="notice ${data.verified?'document-original':'document-modified'}"><strong>${data.verified?'✓ Original verificado':'⚠ Archivo modificado'}</strong><p>Original generado por <strong>${h.esc(data.name)}</strong> (${h.esc(data.exportedBy)})</p><p>${h.esc(new Date(data.created).toLocaleString('es-ES'))} · ${h.esc(data.kind)}</p><small>${h.esc(data.reference)}</small>${data.verified?'':'<p>No se puede atribuir a esta persona el contenido añadido o cambiado.</p>'}</div>`;
      }else result.textContent=data.status==='unverifiable'?'No se puede validar el sello: falta la clave privada de recuperación.':'No hay un sello reconocido en este archivo. Puede ser antiguo, de otro servidor o haber perdido su marca.';
    }catch(e){error.textContent=e.message;}
    finally{button.disabled=false;button.textContent='Comprobar documento';}
  }
  return {action,submit};
};
