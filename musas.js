// musas.js
// Gestión del modo “Letra bendita” / “Letra prohibida” con control de colas,
// timers, peticiones pendientes y contadores de solicitudes de musa.

class Musas {
  /**
   * @param {import('socket.io').Server} io
   * @param {number} TIEMPO_CAMBIO_PALABRAS en milisegundos
   */
  constructor(io, TIEMPO_CAMBIO_PALABRAS, decoratePayload = null, onStateChange = null) {
    this.io      = io
    this.timeout = TIEMPO_CAMBIO_PALABRAS
    this.generation = 0
    this.decoratePayload = typeof decoratePayload === 'function'
      ? decoratePayload
      : (payload) => payload
    this.onStateChange = typeof onStateChange === 'function'
      ? onStateChange
      : () => {}

    // Estado por jugador: cola de palabras, timers, flag pending y contador de peticiones
    this.players = {
      1: { queue: [], emitTimer: null, pendingTimer: null, pending: false, insertedCount: 0, ultimaEntregaMusa: null, ultimaEntregaMusaCaducaEnTs: 0 },
      2: { queue: [], emitTimer: null, pendingTimer: null, pending: false, insertedCount: 0, ultimaEntregaMusa: null, ultimaEntregaMusaCaducaEnTs: 0 }
    }

    console.log('[MusasMode] Inicializado con timeout de petición:', this.timeout)
  }

  _nextGeneration() {
    this.generation = (Number(this.generation) || 0) + 1
    return this.generation
  }

  _isGenerationActive(generation) {
    return generation === this.generation
  }

  _withModePayload(payload) {
    const base = (payload && typeof payload === 'object') ? payload : {}
    return this.decoratePayload({ ...base })
  }

  _emitClear(playerId, entregaAnterior = null, reason = 'caducada') {
    const st = this.players[playerId]
    const payload = this._withModePayload({
      palabra: '',
      musa_nombre: '',
      limpiar_inspiracion: true,
      inspiracion_caducada: reason === 'caducada',
      motivo: reason,
      palabra_anterior: entregaAnterior && entregaAnterior.palabra ? String(entregaAnterior.palabra) : '',
      player: playerId,
      target_player: playerId,
      cola: st && Array.isArray(st.queue) ? st.queue.length : 0,
      cola_palabras_musas: st && Array.isArray(st.queue) ? st.queue.length : 0,
      tiempo_restante_ms: 0,
      caduca_en_ts: 0
    })
    this.io.to(`j${playerId}`).emit(`inspirar_j${playerId}`, payload)
  }

  _notifyStateChange(playerId = null) {
    try {
      this.onStateChange({
        player: playerId,
        mode: this
      })
    } catch (error) {
      console.error('[MusasMode] Error notificando estado de palabras de musas:', error)
    }
  }

  _normalizarMusaItem(item) {
    if (typeof item === 'string') {
      const palabra = item.trim();
      return palabra ? { palabra, musa: '' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const palabra = typeof item.palabra === 'string'
      ? item.palabra.trim()
      : (typeof item.word === 'string' ? item.word.trim() : '');
    if (!palabra) return null;
    const musa = typeof item.musa === 'string'
      ? item.musa.trim()
      : (typeof item.nombre === 'string' ? item.nombre.trim() : '');
    const client_id = typeof item.client_id === 'string'
      ? item.client_id.trim()
      : (typeof item.clientId === 'string' ? item.clientId.trim() : '');
    const salida = { palabra, musa };
    if (client_id) salida.client_id = client_id;
    return salida;
  }

  _normalizarMusaItemConMeta(item) {
    const normalizado = this._normalizarMusaItem(item);
    if (!normalizado) return null;
    if (!item || typeof item !== 'object') return normalizado;

    const recibidaEnTs = Number(item.recibida_en_ts || item.recibidaEnTs || item.created_at_ts || 0);
    const caducaEnTs = Number(item.caduca_en_ts || item.caducaEnTs || item.expira_en_ts || item.expiraEnTs || 0);
    const salida = { ...normalizado };
    if (Number.isFinite(recibidaEnTs) && recibidaEnTs > 0) {
      salida.recibida_en_ts = recibidaEnTs;
    }
    if (Number.isFinite(caducaEnTs) && caducaEnTs > 0) {
      salida.caduca_en_ts = caducaEnTs;
    }
    return salida;
  }

  _asignarMetaColaMusa(item, recibidaEnTs, caducaEnTs) {
    if (!item || typeof item !== 'object') return item;
    Object.defineProperty(item, 'recibida_en_ts', {
      value: recibidaEnTs,
      enumerable: false,
      configurable: true,
      writable: true
    });
    Object.defineProperty(item, 'caduca_en_ts', {
      value: caducaEnTs,
      enumerable: false,
      configurable: true,
      writable: true
    });
    return item;
  }

  _prepararMusaItemParaCola(item, now = Date.now()) {
    const normalizado = this._normalizarMusaItemConMeta(item);
    if (!normalizado) return null;
    const caducaActual = Number(normalizado.caduca_en_ts || 0);
    const timeout = Math.max(0, Number(this.timeout) || 0);
    const tieneCaducidad = Number.isFinite(caducaActual) && caducaActual > 0;
    const recibidaEnTs = Number(normalizado.recibida_en_ts || 0) > 0
      ? Number(normalizado.recibida_en_ts)
      : now;
    const caducaEnTs = tieneCaducidad
      ? caducaActual
      : (timeout > 0 ? now + timeout : 0);
    return this._asignarMetaColaMusa({ ...normalizado }, recibidaEnTs, caducaEnTs);
  }

  _obtenerCaducidadMusaItem(item, now = Date.now()) {
    const caducaEnTs = Number(item && (item.caduca_en_ts || item.caducaEnTs || item.expira_en_ts || item.expiraEnTs) || 0);
    if (Number.isFinite(caducaEnTs) && caducaEnTs > 0) {
      return caducaEnTs;
    }
    const timeout = Math.max(0, Number(this.timeout) || 0);
    return timeout > 0 ? now + timeout : 0;
  }

  _podarColaMusaCaducada(st, now = Date.now()) {
    if (!st || !Array.isArray(st.queue) || !st.queue.length) return 0;
    const vigente = [];
    for (const entrada of st.queue) {
      const item = this._normalizarMusaItemConMeta(entrada);
      if (!item) continue;
      const caducaEnTs = this._obtenerCaducidadMusaItem(entrada, now);
      if (caducaEnTs > 0 && caducaEnTs <= now) continue;
      vigente.push(this._asignarMetaColaMusa(
        { ...item },
        Number(item.recibida_en_ts || 0) > 0 ? Number(item.recibida_en_ts) : now,
        caducaEnTs
      ));
    }
    st.queue = vigente;
    return vigente.length;
  }

  _identidadMusaItem(item, index = 0) {
    if (!item || typeof item !== 'object') return `anon:${index}`;
    if (item.client_id) return `client:${item.client_id}`;
    if (item.musa) return `name:${String(item.musa).trim().toLowerCase()}`;
    return `anon:${index}`;
  }

  _clavePalabraMusa(palabra) {
    const texto = String(palabra || '').trim().toLowerCase();
    return texto.normalize ? texto.normalize('NFC') : texto;
  }

  _analizarColaMusa(queue = []) {
    const grupos = new Map();
    const lista = Array.isArray(queue) ? queue : [];
    lista.forEach((item, index) => {
      const normalizado = this._normalizarMusaItemConMeta(item);
      if (!normalizado) return;
      const clave = this._clavePalabraMusa(normalizado.palabra);
      if (!clave) return;
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          clave,
          palabra: normalizado.palabra,
          primerIndice: index,
          indices: [],
          items: [],
          musas: [],
          client_ids: [],
          identidades: new Set()
        });
      }
      const grupo = grupos.get(clave);
      grupo.indices.push(index);
      grupo.items.push(normalizado);
      grupo.identidades.add(this._identidadMusaItem(normalizado, index));
      if (normalizado.musa && !grupo.musas.includes(normalizado.musa)) {
        grupo.musas.push(normalizado.musa);
      }
      if (normalizado.client_id && !grupo.client_ids.includes(normalizado.client_id)) {
        grupo.client_ids.push(normalizado.client_id);
      }
    });
    return Array.from(grupos.values()).map((grupo) => ({
      ...grupo,
      repeticiones: grupo.identidades.size || grupo.indices.length
    }));
  }

  _grupoSuperbonusPrioritario(queue = []) {
    return this._analizarColaMusa(queue)
      .filter((grupo) => grupo.repeticiones >= 2)
      .sort((a, b) => (
        b.repeticiones - a.repeticiones
        || a.primerIndice - b.primerIndice
        || a.clave.localeCompare(b.clave)
      ))[0] || null;
  }

  _extraerMusaDeCola(st, opciones = {}) {
    this._podarColaMusaCaducada(st);
    const queue = st && Array.isArray(st.queue) ? st.queue : null;
    if (!queue || !queue.length) return null;

    if (opciones.superbonus !== false) {
      const grupo = this._grupoSuperbonusPrioritario(queue);
      if (grupo) {
        grupo.indices
          .slice()
          .sort((a, b) => b - a)
          .forEach((indice) => queue.splice(indice, 1));
        return {
          item: grupo.items[0],
          items: grupo.items,
          superbonus: {
            activo: true,
            repeticiones: grupo.repeticiones,
            palabra: grupo.palabra,
            musas: grupo.musas,
            client_ids: grupo.client_ids
          }
        };
      }
    }

    const idx = Math.floor(Math.random() * queue.length);
    const item = this._normalizarMusaItemConMeta(queue.splice(idx, 1)[0]);
    if (!item) {
      return {
        item: { palabra: '', musa: '' },
        items: [],
        superbonus: { activo: false, repeticiones: 1, musas: [], client_ids: [] }
      };
    }
    return {
      item,
      items: [item],
      superbonus: {
        activo: false,
        repeticiones: 1,
        palabra: item.palabra,
        musas: item.musa ? [item.musa] : [],
        client_ids: item.client_id ? [item.client_id] : []
      }
    };
  }

  // ─── Métodos públicos de limpieza ─────────────────────────────---

  /**
   * Limpia colas, timers y flags (pending) **pero NO** toca los contadores.
   * Úsalo al cambiar de modo para mantener el historial de peticiones.
   */
  clearAll() {
    this._nextGeneration()
    console.log('[MusasMode] clearMode() → colas, timers y flags limpiados (contadores intactos)')
    Object.values(this.players).forEach(st => {
      // 1) vaciar cola
      st.queue = []
      // 2) limpiar timers
      if (st.emitTimer)   { clearTimeout(st.emitTimer);   st.emitTimer   = null }
      if (st.pendingTimer){ clearTimeout(st.pendingTimer);st.pendingTimer= null }
      // 3) reset flag pending
      st.pending = false
      if (st.lastDeliveredFromMusa != null) st.lastDeliveredFromMusa = false
      if (st.entregaActualAutomatica != null) st.entregaActualAutomatica = false
      if (st.peticionAutomaticaPendiente != null) st.peticionAutomaticaPendiente = false
      if (st.ultimoMusaNombre != null) st.ultimoMusaNombre = ''
      st.ultimaEntregaMusa = null
      st.ultimaEntregaMusaCaducaEnTs = 0
    })
    this._notifyStateChange()
  }

  /**
   * Limpia SOLO los contadores de peticiones (insertedCount).
   * Úsalo cuando quieras reiniciar el recuento global de solicitudes.
   */
  clearCounters() {
    console.log('[MusasMode] clearCounters() → contadores reiniciados')
    Object.values(this.players).forEach(st => {
      st.insertedCount = 0
    })
  }

  // ─── Métodos públicos de consulta ─────────────────────────────---

  /**
   * Devuelve cuántas veces ha solicitado musa un jugador.
   * @param {1|2} playerId
   * @returns {number}
   */
  getInsertedCount(playerId) {
    const st = this.players[playerId]
    return st ? st.insertedCount : 0
  }

  consumirEntregaMusaIntroducida(playerId) {
    const st = this.players[playerId]
    if (!st || !st.ultimaEntregaMusa) return null
    const entrega = { ...st.ultimaEntregaMusa }
    st.ultimaEntregaMusa = null
    st.ultimaEntregaMusaCaducaEnTs = 0
    this._notifyStateChange(playerId)
    return entrega
  }

  obtenerEstadoPalabrasMusas(playerId, now = Date.now()) {
    const player = Number(playerId)
    const st = this.players[player]
    if (!st) {
      return {
        player,
        activa: false,
        palabra: '',
        modo: '',
        musa_nombre: '',
        superbonus: false,
        tiempo_restante_ms: 0,
        caduca_en_ts: 0,
        cola: 0,
        cola_palabras_musas: 0
      }
    }

    this._podarColaMusaCaducada(st, now)
    const cola = Array.isArray(st.queue) ? st.queue.length : 0
    const entrega = st.ultimaEntregaMusa && typeof st.ultimaEntregaMusa === 'object'
      ? st.ultimaEntregaMusa
      : null
    const caducaEnTs = Number(st.ultimaEntregaMusaCaducaEnTs || 0)
    const restante = entrega && caducaEnTs > 0
      ? Math.max(0, Math.trunc(caducaEnTs - now))
      : 0
    if (entrega && caducaEnTs > 0 && restante <= 0) {
      st.ultimaEntregaMusa = null
      st.ultimaEntregaMusaCaducaEnTs = 0
    }
    const activa = Boolean(st.ultimaEntregaMusa && restante > 0)
    if (activa) {
      return {
        player,
        activa: true,
        palabra: String(st.ultimaEntregaMusa.palabra || ''),
        modo: String(st.ultimaEntregaMusa.modo || ''),
        musa_nombre: String(st.ultimaEntregaMusa.musa_nombre || ''),
        superbonus: Boolean(st.ultimaEntregaMusa.superbonus),
        tiempo_restante_ms: restante,
        caduca_en_ts: caducaEnTs,
        cola,
        cola_palabras_musas: cola
      }
    }

    const grupoSuperbonus = this._grupoSuperbonusPrioritario(st.queue)
    const itemCola = grupoSuperbonus && grupoSuperbonus.items.length
      ? grupoSuperbonus.items[0]
      : this._normalizarMusaItemConMeta(st.queue[0])
    const caducaColaEnTs = itemCola ? this._obtenerCaducidadMusaItem(itemCola, now) : 0
    const restanteCola = itemCola && caducaColaEnTs > 0
      ? Math.max(0, Math.trunc(caducaColaEnTs - now))
      : 0
    if (itemCola && restanteCola > 0) {
      return {
        player,
        activa: true,
        origen_estado: 'cola',
        palabra: String(itemCola.palabra || ''),
        modo: '',
        musa_nombre: grupoSuperbonus && grupoSuperbonus.musas.length
          ? grupoSuperbonus.musas.join(' + ')
          : String(itemCola.musa || ''),
        superbonus: Boolean(grupoSuperbonus && grupoSuperbonus.repeticiones >= 2),
        repeticiones: grupoSuperbonus ? grupoSuperbonus.repeticiones : 1,
        tiempo_restante_ms: restanteCola,
        caduca_en_ts: caducaColaEnTs,
        cola,
        cola_palabras_musas: cola
      }
    }

    return {
      player,
      activa: false,
      palabra: '',
      modo: '',
      musa_nombre: '',
      superbonus: false,
      tiempo_restante_ms: 0,
      caduca_en_ts: 0,
      cola,
      cola_palabras_musas: cola
    }
  }

  obtenerEstadoPalabrasMusasControl(now = Date.now()) {
    return {
      now,
      players: {
        1: this.obtenerEstadoPalabrasMusas(1, now),
        2: this.obtenerEstadoPalabrasMusas(2, now)
      }
    }
  }

  // ─── Lógica principal de musas ─────────────────────────────────---

  /**
   * Añade una palabra a la cola de un jugador.
   * Si había petición pendiente, emite de inmediato y reprograma el timeout.
   * @param {1|2} playerId
   * @param {string} word
   */
  addMusa(playerId, word) {
    const st = this.players[playerId]
    if (!st) return
    const item = this._prepararMusaItemParaCola(word)
    if (!item) return

    console.log(`[MusasMode] addMusa() jugador ${playerId} recibe palabra: "${item.palabra}"`)
    st.queue.push(item)

    if (st.pending) {
      st.pending = false
      const generation = this.generation
      this._emitNext(playerId, generation)
      this._schedulePending(playerId, generation)
    } else {
      this._notifyStateChange(playerId)
    }
  }

  /**
   * Maneja la petición explícita de musa por parte del jugador.
   * 1) Cuenta la petición.
   * 2) Si hay cola, emite una palabra; si no, marca pending.
   * 3) Siempre reprograma el siguiente timeout.
   * @param {1|2} playerId
   */
  handleRequest(playerId) {
    const st = this.players[playerId]
    if (!st) return

    // ① Contabilizar solicitud
    st.insertedCount++
    console.log(
      `[MusasMode] handleRequest() J${playerId} pidió musa → total peticiones: ${st.insertedCount}`
    )

    // ② Limpio el timer anterior de pending (si existe)
    if (st.pendingTimer) {
      clearTimeout(st.pendingTimer)
      st.pendingTimer = null
    }

    // ③ Si hay cola, emito; si no, marco pending
    if (st.queue.length > 0) {
      this._emitNext(playerId, this.generation)
    } else {
      st.pending = true
      st.ultimaEntregaMusa = null
      st.ultimaEntregaMusaCaducaEnTs = 0
      this._notifyStateChange(playerId)
    }

    // ④ Reprogramo el siguiente timeout
    this._schedulePending(playerId, this.generation)
  }

  /**
   * Inicia el ciclo de petición automática de musas para un jugador.
   * Limpia timers anteriores y programa el primer timeout.
   * @param {1|2} playerId
   */
  start(playerId) {
    const st = this.players[playerId]
    if (!st) return

    console.log(`[MusasMode] start() jugador ${playerId}`)
    if (st.pendingTimer) {
      clearTimeout(st.pendingTimer)
      st.pendingTimer = null
    }
    this._schedulePending(playerId, this.generation)
  }

  // ─── Métodos privados de emisión y timeout ─────────────────────---

  /**
   * Emite la siguiente musa de la cola, si existe.
   * @private
   */
  _emitNext(playerId, generation = this.generation) {
    if (!this._isGenerationActive(generation)) return
    const st = this.players[playerId]
    this._podarColaMusaCaducada(st)
    if (!st || st.queue.length === 0) return

    const idx  = Math.floor(Math.random() * st.queue.length)
    const item = this._normalizarMusaItemConMeta(st.queue.splice(idx, 1)[0]) || { palabra: '', musa: '' }
    const word = item.palabra
    const musa = item.musa || ''
    console.log(`[MusasMode] _emitNext() J${playerId} → emitiendo "${word}"`)
    const payload = this._withModePayload({
      palabra: word,
      musa_nombre: musa
    })
    st.ultimaEntregaMusa = {
      player: playerId,
      target_player: playerId,
      modo: payload.modo_actual || '',
      palabra: word,
      musa_nombre: musa,
      client_id: item.client_id || '',
      client_ids: item.client_id ? [item.client_id] : [],
      musas: musa ? [musa] : [],
      tiempo: 0,
      superbonus: false
    }
    const now = Date.now()
    const caducaEnTs = this._obtenerCaducidadMusaItem(item, now)
    st.ultimaEntregaMusaCaducaEnTs = caducaEnTs > now ? caducaEnTs : now + this.timeout
    this.io.to(`j${playerId}`).emit(`inspirar_j${playerId}`, payload)
    this._notifyStateChange(playerId)
  }

  /**
   * Programa un timeout de TIEMPO_CAMBIO_PALABRAS ms que:
   * - emite automáticamente la próxima palabra si la cola no está vacía.
   * - marca pending=true si la cola está vacía.
   * Y vuelve a reprogramarse a sí mismo.
   * @private
   */
  _schedulePending(playerId, generation = this.generation) {
    const st = this.players[playerId]
    if (!st) return

    if (st.pendingTimer) clearTimeout(st.pendingTimer)

    st.pendingTimer = setTimeout(() => {
      const mantenerCiclo = this._expirePending(playerId, generation)
      if (mantenerCiclo) {
        // Reprograma mientras siga perteneciendo a la partida actual.
        this._schedulePending(playerId, generation)
      }
    }, this.timeout)
  }

  _expirePending(playerId, generation = this.generation) {
    if (!this._isGenerationActive(generation)) {
      return false
    }
    const st = this.players[playerId]
    if (!st) return false
    console.log(`[MusasMode] _schedulePending expirado para J${playerId}`)

    this._podarColaMusaCaducada(st)
    const entregaAnterior = st.ultimaEntregaMusa ? { ...st.ultimaEntregaMusa } : null
    if (st.queue.length > 0) {
      st.ultimaEntregaMusa = null
      st.ultimaEntregaMusaCaducaEnTs = 0
      this._emitNext(playerId, generation)
      return true
    }

    st.pending = true
    st.ultimaEntregaMusa = null
    st.ultimaEntregaMusaCaducaEnTs = 0
    if (entregaAnterior) {
      this._emitClear(playerId, entregaAnterior, 'caducada')
    }
    this._notifyStateChange(playerId)
    return true
  }
}

module.exports = Musas;
