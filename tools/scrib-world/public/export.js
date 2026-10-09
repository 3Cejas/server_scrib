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
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='SCRIB-'+data.kind+'.pdf';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } finally {clearTimeout(timer);if(button){button.innerHTML=label;button.disabled=false;button.removeAttribute('aria-busy');}}
};
