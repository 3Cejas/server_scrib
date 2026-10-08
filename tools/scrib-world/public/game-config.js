(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function editor(event, schema) {
    if (event.eventType === 'rehearsal') return '';
    const config = event.gameConfig;
    const params = config?.parametros || {};
    const modes = config?.modos || Object.keys(schema.modes);
    return `<section class="game-config-editor"><h3>🎮 Configuración del videojuego</h3><p class="muted">Se guarda en este bolo. Después podrás cargarla desde Juego en Control, junto con las escritoras y los créditos del elenco. Guardar aquí no modifica una partida.</p><label class="game-config-enable"><input type="checkbox" name="gameConfigEnabled" ${config ? 'checked' : ''}> Guardar parámetros para esta función</label><fieldset data-game-config-fields ${config ? '' : 'disabled'}><legend>Parámetros de la función</legend><div class="game-config-grid">${Object.entries(schema.parameters).map(([key, p]) => key === 'pausa_explicacion_niveles' ? `<label class="field"><span>${esc(p.label)}</span><input type="checkbox" data-game-param="${key}" ${(params[key] ?? p.default) === 1 ? 'checked' : ''}></label>` : `<label class="field">${esc(p.label)}<input type="number" data-game-param="${key}" min="${p.min}" max="${p.max}" step="1" value="${params[key] ?? p.default}" required></label>`).join('')}<label class="field">Idioma del juego<select data-game-language>${[['es','Español'],['en','English'],['fr','Français']].map(([v,l]) => `<option value="${v}" ${(config?.idioma || 'es') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><div class="game-config-levels"><strong>Niveles · orden del videojuego</strong>${Object.entries(schema.modes).map(([key, label]) => `<label><input type="checkbox" data-game-mode value="${esc(key)}" ${modes.includes(key) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div><div class="game-config-grid">${['1','2'].map(player => `<label class="field">Frase final · equipo ${player === '1' ? 'azul' : 'rojo'} (opcional)<textarea data-game-phrase="${player}" maxlength="220" rows="2">${esc(config?.frases_finales?.[player] || '')}</textarea></label>`).join('')}</div><p class="hint">Si dejas las frases vacías, las escogerán las musas. El reparto se toma del elenco de la ficha; asigna una persona de Escritura a cada equipo.</p></fieldset></section>`;
  }

  function read(form) {
    const enabled = form.querySelector('[name=gameConfigEnabled]');
    if (!enabled) return undefined;
    if (!enabled.checked) return null;
    const modes = [...form.querySelectorAll('[data-game-mode]:checked')].map(el => el.value);
    if (!modes.length) throw new Error('Selecciona al menos un nivel del videojuego.');
    const params = Object.fromEntries([...form.querySelectorAll('[data-game-param]')].map(el => [el.dataset.gameParam, el.type === 'checkbox' ? (el.checked ? 1 : 0) : Number(el.value)]));
    if (params.duracion_minutos * 60 + params.duracion_segundos <= 0) throw new Error('La partida debe durar más de cero segundos.');
    return {version: 1, parametros: params, modos: modes, idioma: form.querySelector('[data-game-language]').value, frases_finales: Object.fromEntries([...form.querySelectorAll('[data-game-phrase]')].map(el => [el.dataset.gamePhrase, el.value]))};
  }

  function summary(event, schema) {
    const c = event.gameConfig;
    if (!c) return '<p class="muted section">No hay parámetros del videojuego guardados. Actívalos desde Editar bolo para poder cargarlos en Control.</p>';
    return `<div class="game-config-summary section"><strong>${c.parametros.duracion_minutos} min ${c.parametros.duracion_segundos ? c.parametros.duracion_segundos + ' s' : ''}</strong><span>🎨 Musas: una inspiración cada ${c.parametros.limite_tiempo_inspiracion} s</span><span>🌐 ${esc(c.idioma.toUpperCase())}</span><span>${c.parametros.pausa_explicacion_niveles ? '⏸ Explicación hasta reanudar' : '▶ Explicación automática'}</span></div><div class="label-group section">${c.modos.map(m => `<span class="badge cyan">${esc(schema.modes[m])}</span>`).join('')}</div><p class="hint section">Cárgalo desde Juego → Cargar configuración de un bolo. Se prepara la función sin iniciar ni borrar la partida.</p>`;
  }

  document.addEventListener('change', event => {
    if (event.target.name === 'gameConfigEnabled') event.target.closest('form').querySelector('[data-game-config-fields]').disabled = !event.target.checked;
  });
  global.ScribWorldGameConfig = {editor, read, summary};
})(window);
