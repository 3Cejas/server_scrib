"use strict";
window.ScribTaskAutosave = h => {
  const FIELDS=['title','description','priority','due','labels','assignees','blockedBy','checklist'];
  const fields=data=>Object.fromEntries(FIELDS.map(key=>[key,data[key]]));
  const fingerprint=data=>JSON.stringify(fields(data));
  let session=null;
  function status(s,kind,text) {
    const node=s.form.querySelector('.task-save-status');
    if(node){node.dataset.state=kind;node.textContent=text;}
    const retry=s.form.querySelector('[data-action="task-retry"]');if(retry)retry.hidden=kind!=='error';
  }
  function timer(s,delay=650) {
    clearTimeout(s.timer);
    s.timer=setTimeout(()=>{s.timer=null;if(session===s)flush().catch(()=>{});},delay);
  }
  async function attach(form) {
    if(!form)return;
    if(session?.timer)clearTimeout(session.timer);
    const s={form,dirty:false,pending:null,flight:null,timer:null,retry:0,revision:0};session=s;
    const data=await h.read(form);s.base=fields(data);s.sent=fields(data);s.last=fingerprint(data);
    status(s,'saved',form.dataset.id?'✓ Guardado':'Añade un título para empezar');
  }
  function changed(form,isComposing=false) {
    const s=session;if(!s||s.form!==form)return false;
    s.revision++;s.dirty=true;s.retry=0;
    status(s,'dirty','Cambios pendientes…');
    if(!isComposing)timer(s);
    return true;
  }
  async function drain(s) {
    while(session===s && (s.dirty||s.pending)) {
      if(h.busy()){timer(s,300);return false;}
      if(!s.pending) {
        if(!s.form.checkValidity()){status(s,'error','Completa los campos señalados');return false;}
        const revision=s.revision,data=await h.read(s.form),stamp=fingerprint(data);
        if(stamp===s.last){s.dirty=false;status(s,'saved',s.form.dataset.id?'✓ Guardado':'Añade un título para empezar');return true;}
        const changes=Object.fromEntries(FIELDS.filter(key=>JSON.stringify(data[key])!==JSON.stringify(s.sent[key])).map(key=>[key,data[key]]));
        s.pending={revision,data,stamp,payload:s.form.dataset.id?
          {id:s.form.dataset.id,version:Number(s.form.dataset.version),changes,base:Object.fromEntries(Object.keys(changes).map(key=>[key,s.base[key]])),requestId:crypto.randomUUID()}:
          {data,requestId:s.form.dataset.request}};
      }
      const pending=s.pending;status(s,'saving','Guardando…');
      try {
        const result=await h.request('task-autosave',pending.payload),saved=result.item;
        if(!saved || saved.kind!=='ticket' || !saved.id || !Number.isInteger(saved.version) || (pending.payload.id && saved.id!==pending.payload.id))throw new Error('No se pudo confirmar el guardado. Reintenta; tu borrador sigue aquí.');
        s.form.dataset.id=saved.id;s.form.dataset.version=String(saved.version);
        // Keep the server's normalized values as the next conflict baseline,
        // but compare typing against the submitted draft so trimming does not
        // trigger another save or force a caret-changing input rewrite.
        const confirmed=pending.payload.id?Object.keys(pending.payload.changes):FIELDS;
        for(const key of confirmed)s.base[key]=saved[key];
        s.sent=fields(pending.data);s.last=pending.stamp;s.pending=null;s.retry=0;
        // Never rebuild editable fields: typing and the caret remain untouched.
        h.saved(saved,s.form);
        s.dirty=s.revision!==pending.revision;
        status(s,s.dirty?'dirty':'saved',s.dirty?'Guardando los últimos cambios…':'✓ Guardado');
      } catch(error) {
        if(error.status && error.status<500)s.pending=null;
        status(s,'error','No guardado · '+error.message);
        s.form.querySelector('.form-error').textContent=error.message;
        if(!error.status || error.status>=500)timer(s,Math.min(15000,1500*2**Math.min(s.retry++,4)));
        return false;
      }
    }
    return true;
  }
  async function flush() {
    const s=session;if(!s)return true;
    clearTimeout(s.timer);s.timer=null;
    if(s.flight)return s.flight;
    s.form.querySelector('.form-error').textContent='';
    s.flight=drain(s);
    try{return await s.flight;}catch(error){status(s,'error','No guardado · '+error.message);s.form.querySelector('.form-error').textContent=error.message;return false;}
    finally{s.flight=null;}
  }
  function detached(){if(session?.timer)clearTimeout(session.timer);session=null;}
  const owns=form=>Boolean(session && session.form===form);
  const hasDraft=()=>Boolean(session && (session.dirty||session.pending||session.flight));
  return {attach,changed,flush,detached,owns,hasDraft};
};
