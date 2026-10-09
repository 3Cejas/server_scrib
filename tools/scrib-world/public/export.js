"use strict";
window.ScribExport = async function(state, data, button) {
  const label=button?.innerHTML;
  if(button){if(button.disabled)return;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Generando PDF…';}
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60000);
  try {
    const response=await fetch('/scrib/backstage/api/pdf',{method:'POST',credentials:'same-origin',cache:'no-store',signal:abort.signal,
      headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(data)});
    if(!response.ok || !response.headers.get('content-type')?.startsWith('application/pdf')) {
      const result=await response.json().catch(()=>({}));throw new Error(result.error || 'No se pudo generar el PDF.');
    }
    const blob=await response.blob();
    if(typeof window.ScribAndroid?.savePdf==='function'){
      if(blob.size>16*1024*1024)throw new Error('El PDF supera los 16 MB admitidos por la app. Descárgalo desde el navegador.');
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo preparar el PDF.'));reader.onload=()=>resolve(String(reader.result).split(',',2)[1]);reader.readAsDataURL(blob);});
      if(window.ScribAndroid.savePdf(encoded,'SCRIB-'+data.kind+'.pdf')!==true)throw new Error('No se pudo abrir el guardado del PDF. Termina la descarga anterior o vuelve a intentarlo.');
      return;
    }
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='SCRIB-'+data.kind+'.pdf';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } finally {clearTimeout(timer);if(button){button.innerHTML=label;button.disabled=false;button.removeAttribute('aria-busy');}}
};
