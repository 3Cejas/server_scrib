"use strict";
window.ScribPersonProfile = function(h) {
  const {esc}=h;
  const catalog=['Escritura','Interpretación','Presentador','Técnica','Jurado','Dramaturgia','Producción','Dirección','Música','Comunicación','Fotografía','Vídeo','Diseño','Coordinación'];
  const icons={'Escritura':'✍️','Interpretación':'🎭','Presentador':'🎤','Dramaturgia':'📖','Técnica':'🎛️','Producción':'📋','Dirección':'🎬','Música':'🎵','Comunicación':'📣','Fotografía':'📷','Vídeo':'🎥','Diseño':'🎨','Coordinación':'🧭','Participación':'✨'};
  const tones={'Escritura':'gold','Interpretación':'cyan','Presentador':'gold','Dramaturgia':'violet','Técnica':'mint','Producción':'coral','Dirección':'pink','Música':'violet','Comunicación':'coral','Fotografía':'gold','Vídeo':'cyan','Diseño':'pink','Coordinación':'mint','Participación':'gold'};
  icons.Jurado='⚖️';tones.Jurado='violet';
  const roles=()=>h.roles?.()||catalog;
  const canonical=r=>roles().find(x=>x.toLocaleLowerCase('es')===r.toLocaleLowerCase('es'))||r;
  const choices=selected=>[...new Set([...roles(),...(selected||[]).map(canonical)])].filter(r=>r!=='Participación');
  const roleTag=r=>`<span class="person-role role-${tones[canonical(r)]||'violet'}"><span aria-hidden="true">${icons[canonical(r)]||'✦'}</span>${esc(canonical(r))}</span>`;
  function roleTags(selected=[]) {
    return `<div class="person-role-tags">${selected.filter(r=>r!=='Participación').map(roleTag).join('')||'<span class="muted">Roles pendientes</span>'}</div>`;
  }
  function roleEditor(selected=[]) {
    const checked=new Set(selected.map(canonical));
    return `<fieldset class="person-role-picker"><legend>Roles · elige las etiquetas</legend><div class="role-options">${choices(selected).map(r=>`<label class="role-option role-${tones[r]||'violet'}"><input type="checkbox" name="roles" value="${esc(r)}" ${checked.has(r)?'checked':''}><span><i aria-hidden="true">${icons[r]||'✦'}</i>${esc(r)}</span></label>`).join('')}</div><p class="hint">Puedes elegir varios roles. No es necesario escribirlos a mano.</p></fieldset>`;
  }
  function roleOptions(selected='') {
    return choices(selected?[selected]:[]).map(r=>`<option value="${esc(r)}" ${canonical(selected)===r?'selected':''}>${icons[r]||'✦'} ${esc(r)}</option>`).join('');
  }
  function instagramHandle(value) {
    const raw=String(value||'').trim();
    if(/^@?[A-Za-z0-9_.]{1,30}$/.test(raw))return '@'+raw.replace(/^@/,'');
    try {
      const url=new URL(raw),handle=url.pathname.split('/').filter(Boolean)[0];
      if(['instagram.com','www.instagram.com','m.instagram.com'].includes(url.hostname.toLowerCase())&&/^[A-Za-z0-9_.]{1,30}$/.test(handle||'')&&!['p','reel','reels','stories','explore','accounts'].includes(handle))return '@'+handle;
    } catch(_) {}
    return '';
  }
  function instagramUrl(value) {
    if(/^@?[A-Za-z0-9_.]{1,30}$/.test(value||''))return 'https://www.instagram.com/'+value.replace(/^@/,'')+'/';
    return value||'';
  }
  function displayPhone(phone) {
    const match=/^\+34(\d{3})(\d{3})(\d{3})$/.exec(phone||'');
    return match?'+34 '+match.slice(1).join(' '):phone;
  }
  function safeUrl(value) {
    try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch(_){return '';}
  }
  function hostLabel(value) {
    try {return new URL(value).hostname;}catch(_){return 'Abrir enlace';}
  }
  function contact(icon,label,value,url='',tone='',external=false) {
    url=external?safeUrl(url):url;
    const tag=url?'a':'div';
    return `<${tag} class="person-contact ${tone} ${url?'':'missing'}"${url?` href="${esc(url)}"${external?' target="_blank" rel="noopener noreferrer"':''}`:''}><span class="contact-icon" aria-hidden="true">${icon}</span><span class="contact-copy"><small>${label}</small><strong>${esc(value||'Sin añadir')}${url&&external?' ↗':''}</strong></span></${tag}>`;
  }
  function contacts(person) {
    const phone=person.phone||'',ig=person.instagram||'';
    return `<div class="person-contacts">${contact('☎','Teléfono',displayPhone(phone),/^\+[0-9]{7,15}$/.test(phone)?'tel:'+phone:'','phone')}${contact('◎','Instagram',ig?(instagramHandle(ig)||'Ver perfil'):'',instagramUrl(ig),'instagram',true)}${person.website?contact('↗','Web / portfolio',hostLabel(person.website),person.website,'website',true):''}${person.otherSocial?contact('✦','Otra red',hostLabel(person.otherSocial),person.otherSocial,'other',true):''}</div>`;
  }
  return {catalog,roleTags,roleEditor,roleOptions,instagramHandle,displayPhone,contacts};
};
