// musas.js
// Gestión del modo “Letra bendita” / “Letra prohibida” con control de colas,
// timers, peticiones pendientes y contadores de solicitudes de musa.

class Musas {
  /**
   * @param {import('socket.io').Server} io
   * @param {number} TIEMPO_CAMBIO_PALABRAS en milisegundos
   */
  constructor(io, TIEMPO_CAMBIO_PALABRAS) {
    this.io      = io
    this.timeout = TIEMPO_CAMBIO_PALABRAS

    // Estado por jugador: cola de palabras, timers, flag pending y contador de peticiones
    this.players = {
      1: { queue: [], emitTimer: null, pendingTimer: null, pending: false, insertedCount: 0 },
      2: { queue: [], emitTimer: null, pendingTimer: null, pending: false, insertedCount: 0 }
    }

    console.log('[MusasMode] Inicializado con timeout de petición:', this.timeout)
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
    return { palabra, musa };
  }

  // ─── Métodos públicos de limpieza ─────────────────────────────---

  /**
   * Limpia colas, timers y flags (pending) **pero NO** toca los contadores.
   * Úsalo al cambiar de modo para mantener el historial de peticiones.
   */
  clearAll() {
    console.log('[MusasMode] clearMode() → colas, timers y flags limpiados (contadores intactos)')
    Object.values(this.players).forEach(st => {
      // 1) vaciar cola
      st.queue = []
      // 2) limpiar timers
      if (st.emitTimer)   { clearTimeout(st.emitTimer);   st.emitTimer   = null }
      if (st.pendingTimer){ clearTimeout(st.pendingTimer);st.pendingTimer= null }
      // 3) reset flag pending
      st.pending = false
      if (st.ultimoMusaNombre != null) st.ultimoMusaNombre = ''
    })
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
    const item = this._normalizarMusaItem(word)
    if (!item) return

    console.log(`[MusasMode] addMusa() jugador ${playerId} recibe palabra: "${item.palabra}"`)
    st.queue.push(item)

    if (st.pending) {
      st.pending = false
      this._emitNext(playerId)
      this._schedulePending(playerId)
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
      this._emitNext(playerId)
    } else {
      st.pending = true
    }

    // ④ Reprogramo el siguiente timeout
    this._schedulePending(playerId)
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
    this._schedulePending(playerId)
  }

  // ─── Métodos privados de emisión y timeout ─────────────────────---

  /**
   * Emite la siguiente musa de la cola, si existe.
   * @private
   */
  _emitNext(playerId) {
    const st = this.players[playerId]
    if (!st || st.queue.length === 0) return

    const idx  = Math.floor(Math.random() * st.queue.length)
    const item = st.queue.splice(idx, 1)[0]
    const word = typeof item === 'string' ? item : item.palabra
    const musa = (item && typeof item === 'object') ? item.musa : ''
    console.log(`[MusasMode] _emitNext() J${playerId} → emitiendo "${word}"`)
    this.io.to(`j${playerId}`).emit(`inspirar_j${playerId}`, {
      palabra: word,
      musa_nombre: musa
    })
  }

  /**
   * Programa un timeout de TIEMPO_CAMBIO_PALABRAS ms que:
   * - emite automáticamente la próxima palabra si la cola no está vacía.
   * - marca pending=true si la cola está vacía.
   * Y vuelve a reprogramarse a sí mismo.
   * @private
   */
  _schedulePending(playerId) {
    const st = this.players[playerId]
    if (!st) return

    if (st.pendingTimer) clearTimeout(st.pendingTimer)

    st.pendingTimer = setTimeout(() => {
      console.log(`[MusasMode] _schedulePending expirado para J${playerId}`)

      if (st.queue.length > 0) {
        this._emitNext(playerId)
      } else {
        st.pending = true
      }
      // Reprograma siempre
      this._schedulePending(playerId)
    }, this.timeout)
  }
}

module.exports = Musas;
