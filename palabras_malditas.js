// palabras_malditas.js
const MusasMode = require('./musas.js');

class PalabrasMalditasMode extends MusasMode {
  static STATIC_WORDS    = [
    "de","la","que","el","en","y","a","los","se","del",
    "las","un","por","con","no","una","su","para","es","al",
    "lo","como","más","o","pero","sus","le","ha","me","si",
    "sin","sobre","este","ya","entre","cuando","todo","esta","ser","son",
    "dos","también","fue","había","era","muy","años","hasta","desde","está"
  ];
  static remainingStatic = [...PalabrasMalditasMode.STATIC_WORDS];

  constructor(io, timeoutMs) {
    super(io, timeoutMs);
    // Inicializar contadores y flags por jugador
    [1, 2].forEach(id => {
      this.players[id].insertedCount         = 0;
      this.players[id].lastDeliveredFromMusa = false;
    });
  }

  /**
   * Devuelve cuántas musas ha usado (pedido tras musa previa) cada jugador.
   */
  getInsertedCount(playerId) {
    return this.players[playerId]?.insertedCount || 0;
  }

  /**
   * Cada musa que envía playerId se encola en la cola del otro.
   */
  addMusa(playerId, word) {
    const target = 3 - playerId;  // 1↔2
    const st     = this.players[target];
    st.queue.push(word);
    console.log(
      `[Malditas][addMusa] J${playerId} ➡ encolada para J${target}: "${word}"`
    );
    // Si target estaba pendiente, emitimos YA
    if (st.pending) {
      st.pending = false;
      this._emitNext(target);
      this._schedulePending(target);
    }
  }

  /**
   * Inicia el modo para playerId:
   * 1) Limpia timers.
   * 2) Emite YA la primera palabra.
   */
  start(playerId) {
    const st = this.players[playerId];
    clearTimeout(st.emitTimer);
    clearTimeout(st.pendingTimer);
    st.emitTimer    = null;
    st.pendingTimer = null;
    st.pending      = false;
    this._emitNext(playerId);
  }

  /**
   * Emite la siguiente palabra para playerId y reprograma:
   * - Si SU cola no vacía → roba de ella (musa).
   * - Si vacía → toma aleatoria de STATIC_WORDS.
   * Ajusta `lastDeliveredFromMusa` según el origen.
   *
   * @param {1|2} playerId
   * @private
   */
  _emitNext(playerId) {
    const st        = this.players[playerId];
    const queueSelf = st.queue;
    const evento    = `enviar_palabra_j${playerId}`;

    let word;
    if (queueSelf.length > 0) {
      // Musa de cola propia (sugerida por el otro)
      const idx = Math.floor(Math.random() * queueSelf.length);
      word      = queueSelf.splice(idx, 1)[0];
      st.lastDeliveredFromMusa = true;
      console.log(`[Malditas][_emitNext] J${playerId} usa musa: "${word}"`);
    } else {
      // Palabra estática
      if (!PalabrasMalditasMode.remainingStatic.length) {
        PalabrasMalditasMode.remainingStatic = [
          ...PalabrasMalditasMode.STATIC_WORDS
        ];
        console.log('[Malditas][_emitNext] Lista estática reiniciada');
      }
      const remIdx = Math.floor(
        Math.random() * PalabrasMalditasMode.remainingStatic.length
      );
      word = PalabrasMalditasMode.remainingStatic.splice(remIdx, 1)[0];
      st.lastDeliveredFromMusa = false;
      console.log(`[Malditas][_emitNext] J${playerId} recibe estática: "${word}"`);
    }

    // Construir y enviar payload
    const payload = {
      modo_actual:           'palabras malditas',
      palabras_var:          [word],
      palabra_bonus:         [[word], ''],
      tiempo_palabras_bonus: this._puntuacionPalabra(word)
    };
    console.log(`[Malditas][_emitNext] Emite ${evento}:`, payload);
    this.io.emit(evento, payload);

    // Reprogramar siguiente emisión
    st.emitTimer = setTimeout(
      () => this._emitNext(playerId),
      this.timeout
    );
  }

  /**
   * Maneja petición MANUAL de nueva palabra maldita:
   * 1) Si la última entrega fue musa → suma al otro insertedCount.
   * 2) Limpia timer y emite YA una nueva palabra.
   *
   * @param {1|2} playerId
   */
  async handleRequest(playerId) {
    const st        = this.players[playerId];
    const opponent  = 3 - playerId;

    // 1) Si la última entrega fue de musa, sumamos al otro
    if (st.lastDeliveredFromMusa) {
      this.players[opponent].insertedCount++;
      console.log(
        `[Malditas][handleRequest] J${playerId} pidió tras musa →` +
        ` insertedCount J${opponent}=${this.players[opponent].insertedCount}`
      );
    }

    // 2) Limpiar timer automático y disparar nueva emisión
    clearTimeout(st.emitTimer);
    st.emitTimer = null;
    this._emitNext(playerId);
  }

  /**
   * Puntuación según frecuencia de letras.
   */
  _puntuacionPalabra(word) {
    if (!word) return 10;
    const freq = {
      a:1,b:2,c:3,d:4,e:5,f:1,g:2,h:1,i:5,
      j:1,k:1,l:1,m:2,n:2,o:5,p:1,q:1,r:1,
      s:1,t:1,u:5,v:1,w:1,x:1,y:1,z:1
    };
    const clean = word.toLowerCase().replace(/\s+/g, '');
    let sum = 0;
    for (const ch of clean) sum += freq[ch] || 0;
    const pts = Math.ceil((((10 - sum * 0.5) + clean.length * 3)) / 5) * 5;
    return isNaN(pts) ? 10 : pts;
  }
}

module.exports = PalabrasMalditasMode;