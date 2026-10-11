"use strict";
window.ScribTasksUI = h => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Hide synthetic verification actors, not their comments/history or stored assignments.
  const isServiceMember = m => [m?.username, m?.name].some(value => /^(?:deployment(?: verification| test| smoke)?|verification deploy(?:ment)?|verificacion despliegue|despliegue verificacion|e2e|smoke test)(?: |$)/.test(normalize(value)));
  const memberClass = username => h.colors.className({id:'member:' + username, color:'auto'});
  // Only task-assignment aliases; this does not merge login accounts or history.
  const canonicalAssignee = username => ['3cejas','trescejas'].includes(username) ? '3cejas' : username;
  const assigneeName = username => canonicalAssignee(username)==='3cejas' ? '3cejas' : h.state().members.find(m=>m.username===username)?.name || username;
  const members = () => [...new Map(h.state().members.filter(m => !isServiceMember(m)).map(m=>{
    const username=canonicalAssignee(m.username);return [username,{...m,username,name:assigneeName(username)}];
  })).values()];
  const assigneeOptions = selected => members().map(m => `<label class="assignee-option ${memberClass(m.username)}"><input type="checkbox" name="assignees" value="${h.esc(m.username)}" ${selected.map(canonicalAssignee).includes(m.username)?'checked':''}><span><i aria-hidden="true">${h.esc(h.initials(m.name))}</i>${h.esc(m.name)}</span></label>`).join('');
  const chip = label => `<span class="tag-chip badge ${h.labelColor(label)}" data-label="${h.esc(label)}"><span>${h.esc(label)}</span><button type="button" data-action="remove-tag" aria-label="Quitar etiqueta ${h.esc(label)}">×</button></span>`;
  function knownLabels() {
    const {items}=h.state(), boards=new Set(items.filter(b=>b.kind==='board' && !b.archived && !b.eventId).map(b=>b.id));
    return [...new Set(items.filter(t=>t.kind==='ticket' && !t.archived && boards.has(t.boardId)).flatMap(t=>t.labels || []))].sort((a,b)=>a.localeCompare(b,'es'));
  }
  const tagOptions = selected => `<option value="">Elegir etiqueta existente…</option>${knownLabels().filter(label=>!selected.includes(label)).map(label=>`<option value="${h.esc(label)}">${h.esc(label)}</option>`).join('')}`;
  const tagEditor = labels => `<div class="field"><span>Etiquetas</span><div class="tag-editor" role="group" aria-label="Etiquetas de la tarea"><div class="tag-chips">${labels.map(chip).join('')}</div><select class="tag-existing" aria-label="Elegir una etiqueta existente">${tagOptions(labels)}</select><input class="tag-input" name="labels" type="text" maxlength="800" aria-label="Crear o añadir etiquetas" placeholder="Crear etiqueta · separa varias con comas" autocomplete="off"><small class="tag-error" role="alert"></small></div></div>`;
  const labelsIn = editor => [...editor.querySelectorAll('.tag-chip')].map(n => n.dataset.label);
  function refreshOptions(editor) {
    const picker=editor.querySelector('.tag-existing');
    if(picker)picker.innerHTML=tagOptions(labelsIn(editor));
  }
  function combineLabels(labels, draft) {
    const result = [...new Set([...labels, ...String(draft || '').split(',').map(x => x.trim()).filter(Boolean)])];
    if(result.length > 12)throw new Error('Puedes añadir hasta 12 etiquetas.');
    if(result.some(x => [...x].length > 60))throw new Error('Cada etiqueta puede tener hasta 60 caracteres.');
    return result;
  }
  function clearError(input) {
    input.setCustomValidity('');
    input.closest('.tag-editor').querySelector('.tag-error').textContent = '';
  }
  function commit(input, partial = false) {
    const editor = input.closest('.tag-editor'), raw = input.value;
    const cut = partial ? raw.lastIndexOf(',') : raw.length;
    if(cut < 0)return true;
    try {
      const current = labelsIn(editor), labels = combineLabels(current, raw.slice(0, cut));
      // Preserve existing chip nodes: blur can run between pointerdown and click
      // on their remove buttons, so replacing the list would swallow that click.
      for(const label of labels)if(!current.includes(label))editor.querySelector('.tag-chips').insertAdjacentHTML('beforeend',chip(label));
      input.value = partial ? raw.slice(cut + 1) : '';
      clearError(input);
      refreshOptions(editor);
      return true;
    } catch(error) {
      input.setCustomValidity(error.message);
      editor.querySelector('.tag-error').textContent = error.message;
      return false; // Never truncate or lose a draft that exceeded a limit.
    }
  }
  function readLabels(form, commitDraft=true) {
    const input = form.querySelector('.tag-input');
    if(!commitDraft)return combineLabels(labelsIn(input.closest('.tag-editor')),input.value);
    if(!commit(input))throw new Error(input.validationMessage);
    return labelsIn(input.closest('.tag-editor'));
  }
  function input(event) {
    if(!event.target.matches('.tag-input'))return false;
    clearError(event.target);
    if(!event.isComposing && event.target.value.includes(','))commit(event.target, true);
    return true;
  }
  function removeTag(node) {
    const editor = node.closest('.tag-editor'), input = editor.querySelector('.tag-input');
    node.closest('.tag-chip').remove();
    clearError(input);
    refreshOptions(editor);
    input.focus({preventScroll:true});
  }
  function chooseExisting(event) {
    const picker=event.target;if(!picker.matches('.tag-existing'))return false;
    const editor=picker.closest('.tag-editor'),input=editor.querySelector('.tag-input'),label=picker.value;
    if(!label)return false;
    try {
      const current=labelsIn(editor);
      // Include unsent typing in the limit check, but leave it and its caret intact.
      combineLabels([...current,label],input.value);
      if(!current.includes(label))editor.querySelector('.tag-chips').insertAdjacentHTML('beforeend',chip(label));
      clearError(input);refreshOptions(editor);
    } catch(error) {
      picker.value='';input.setCustomValidity(error.message);editor.querySelector('.tag-error').textContent=error.message;
    }
    return true;
  }
  function keydown(event) {
    const input = event.target;
    if(!input.matches('.tag-input') || event.isComposing || event.keyCode === 229)return false;
    if(event.key === 'Enter') {event.preventDefault();commit(input);return true;}
    if(event.key === 'Backspace' && !input.value && !event.ctrlKey && !event.metaKey) {
      const last = input.closest('.tag-editor').querySelector('.tag-chip:last-child');
      if(last){event.preventDefault();input.value = last.dataset.label;last.remove();clearError(input);refreshOptions(input.closest('.tag-editor'));}
      return true;
    }
    return false;
  }
  function focusout(event) {
    if(event.target.matches('.tag-input'))commit(event.target);
  }
  return {isServiceMember,canonicalAssignee,assigneeName,memberClass,members,assigneeOptions,knownLabels,tagEditor,combineLabels,readLabels,input,removeTag,chooseExisting,keydown,focusout};
};
