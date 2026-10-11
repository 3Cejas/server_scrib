"use strict";
window.ScribTaskComments = h => {
  const drafts = new WeakMap();
  const draft = form => {if(!drafts.has(form))drafts.set(form,[]);return drafts.get(form);};
  const photoName = name => typeof name==='string' && /^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name);
  const imageUrl = name => '/scrib/backstage/images/' + name;
  const trash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
  function html(comments) {
    return comments.map(c=>`<div class="comment${c.author===h.state().user.username?' own':''}"><div class="comment-head"><small><strong class="${h.memberClass(c.author)}">${h.esc(h.member(c.author))}</strong> · ${h.dateTime(c.created)}</small>${c.id?`<button type="button" class="comment-delete" data-action="delete-comment" data-id="${h.esc(c.id)}" data-ticket="${h.esc(c.ticket)}" aria-label="Eliminar comentario" title="Eliminar comentario">${trash}</button>`:''}</div>${h.esc(c.body)}${(c.attachments||[]).filter(photoName).length?`<div class="comment-photos">${c.attachments.filter(photoName).map((name,i)=>`<a href="${imageUrl(name)}" target="_blank" rel="noopener" aria-label="Abrir foto ${i+1} del comentario"><img src="${imageUrl(name)}" alt="Foto ${i+1} del comentario" loading="lazy" width="240" height="180"></a>`).join('')}</div>`:''}</div>`).join('');
  }
  function composer(id) {
    return `<form class="comment-form" data-id="${h.esc(id)}" data-request="${crypto.randomUUID()}"><div class="comment-draft-photos" aria-live="polite"></div><div class="chat-composer"><button type="button" class="chat-attach" data-action="attach-comment-photo" aria-label="Adjuntar fotos" title="Adjuntar fotos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg></button><input type="file" class="comment-photo-input" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Seleccionar fotos"><textarea name="comment" rows="2" maxlength="10000" aria-label="Nuevo comentario" placeholder="Escribe un comentario…"></textarea><button type="submit" class="button primary chat-send" aria-label="Enviar comentario" title="Enviar comentario"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/></svg></button></div><small class="comment-photo-hint">Hasta 4 fotos · PNG, JPG o WebP · 4 MB por foto</small><p class="form-error" role="alert"></p></form>`;
  }
  const read = file => new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No se pudo leer la foto.'));reader.readAsDataURL(file);
  });
  function preview(form) {
    form.querySelector('.comment-draft-photos').innerHTML=draft(form).map(p=>`<div class="comment-draft-photo"><img src="${h.esc(p.preview)}" alt="${h.esc(p.file.name)}"><button type="button" data-action="remove-comment-photo" data-id="${p.id}" aria-label="Quitar foto ${h.esc(p.file.name)}">×</button></div>`).join('');
  }
  async function select(input) {
    const form=input.closest('.comment-form'),files=[...input.files];input.value='';
    if(!files.length || h.saving())return;
    const error=form.querySelector('.form-error');error.textContent='';
    try {
      if(draft(form).length+files.length>4)throw new Error('Puedes adjuntar hasta 4 fotos por comentario.');
      if(files.some(f=>f.size>4*1024*1024))throw new Error('Cada foto debe pesar menos de 4 MB.');
      if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)))throw new Error('Solo fotos PNG, JPG o WebP.');
      input.disabled=true;form.dataset.reading='true';
      const photos=await Promise.all(files.map(async file=>({id:crypto.randomUUID(),file,preview:await read(file),uploaded:''})));
      draft(form).push(...photos);preview(form);
    } catch(e){error.textContent=e.message;}
    finally{input.disabled=false;delete form.dataset.reading;}
  }
  const hasPhotos = form => draft(form).length>0;
  async function prepare(form) {
    if(form.dataset.reading)throw new Error('Espera a que se carguen las fotos.');
    const body=form.querySelector('textarea').value;
    if(!body.trim() && !hasPhotos(form))throw new Error('Escribe un comentario o adjunta una foto.');
    const attachments=[];
    for(const photo of draft(form)) {
      if(!photo.uploaded)photo.uploaded=(await h.request('upload',{base64:photo.preview.split(',')[1]})).item.image;
      attachments.push(photo.uploaded);
    }
    return {body,attachments};
  }
  function reset(form){drafts.delete(form);form.reset();preview(form);form.dataset.request=crypto.randomUUID();}
  async function action(node) {
    const a=node.dataset.action;
    if(a==='attach-comment-photo'){
      const form=node.closest('.comment-form');if(!h.saving() && !form.dataset.reading)form.querySelector('.comment-photo-input').click();return true;
    }
    if(a==='remove-comment-photo'){
      const form=node.closest('.comment-form');if(h.saving()||form.dataset.reading)return true;
      drafts.set(form,draft(form).filter(p=>p.id!==node.dataset.id));preview(form);return true;
    }
    if(a!=='delete-comment')return false;
    if(h.saving() || node.disabled)return true;
    if(!window.confirm('¿Eliminar este comentario y sus fotos de la conversación?'))return true;
    node.disabled=true;
    // Retain a token after an uncertain response, so a retry cannot duplicate.
    node.dataset.request ||= crypto.randomUUID();
    try {
      await h.request('delete-comment',{id:node.dataset.id,ticket:node.dataset.ticket,requestId:node.dataset.request,confirmed:true});
      const details=await h.request('items/'+node.dataset.ticket);h.update(details.comments);
      h.toast('Comentario eliminado.');
    } catch(error){h.toast(error.message);}
    finally{node.disabled=false;}
    return true;
  }
  return {html,composer,select,prepare,reset,hasPhotos,action,photoName};
};
