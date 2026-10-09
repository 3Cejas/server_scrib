"use strict";
// Capture only the local SVG: the PDF uses the exact visible plan and cable layer.
window.ScribPlanImage = async function(source) {
  if(!source)throw new Error('Abre el plano antes de exportarlo.');
  const copy=source.cloneNode(true),properties=['fill','stroke','stroke-width','stroke-dasharray','stroke-linejoin','stroke-linecap','opacity','fill-opacity','stroke-opacity','font-family','font-size','font-weight','font-style','letter-spacing','text-anchor','paint-order','visibility'];
  const originals=[source,...source.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
  originals.forEach((node,i)=>{const style=getComputedStyle(node);clones[i].setAttribute('style',properties.map(p=>p+':'+style.getPropertyValue(p).replace(/url\(["']?[^)#]*#([^)'"\s]+)["']?\)/g,'url(#$1)')).join(';'));});
  const height=source.viewBox.baseVal.height;
  if(![1250,1600].includes(height))throw new Error('Formato de plano no válido.');
  copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width','1000');copy.setAttribute('height',String(height));
  const background=document.createElementNS('http://www.w3.org/2000/svg','rect');
  for(const [key,value] of Object.entries({width:'1000',height:String(height),fill:'#0c101b'}))background.setAttribute(key,value);
  copy.insertBefore(background,copy.firstChild);
  const serialized=new XMLSerializer().serializeToString(copy),image=new Image();
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{image.src='';reject(new Error('No se pudo preparar el dibujo del plano.'));},10000);
    image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(new Error('No se pudo preparar el dibujo del plano.'));};
    image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serialized);
  });
  const canvas=document.createElement('canvas');canvas.width=1500;canvas.height=height*1.5;
  const context=canvas.getContext('2d');if(!context)throw new Error('No se pudo preparar el dibujo del plano.');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
};
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
