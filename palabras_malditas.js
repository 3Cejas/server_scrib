// palabras_malditas.js
const MusasMode = require('./musas.js');

class PalabrasMalditasMode extends MusasMode {
  // ─── Lista estática de palabras malditas ────────────────────────────
  static MALDITAS = [
    "de","la","que","el","en","y","a","los","se","del",
    "las","un","por","con","no","una","su","para","es","al",
    "lo","como","más","o","pero","sus","le","ha","me","si",
    "sin","sobre","este","ya","entre","cuando","todo","esta","ser","son",
    "dos","también","fue","había","era","muy","años","hasta","desde","está"
  ];

  // Copia mutable para ir consumiendo sin repetir
  static _remainingMalditas = [...PalabrasMalditasMode.MALDITAS];

  constructor(io, TIEMPO_CAMBIO_PALABRAS) {
    super(io, TIEMPO_CAMBIO_PALABRAS);
  }

  /**
   * Override de la emisión automática tras timeout.
   * Se encarga de:
   *  - Robar musa del oponente si existe.
   *  - Si no, tomar palabra estática al azar.
   *  - Emitir por 'enviar_palabra_j{playerId}'.
   */
  _emitNext(playerId) {
    const otro         = playerId === 1 ? 2 : 1;
    const queueOther   = this.players[otro].queue;
    const evento       = `enviar_palabra_j${playerId}`;

    let palabras_var, palabra_bonus, tiempo_palabras_bonus;

    if (queueOther.length > 0) {
      // ─── Robar musa del oponente ───────────────────────────────────
      const idx  = Math.floor(Math.random() * queueOther.length);
      const word = queueOther.splice(idx, 1)[0];

      palabras_var          = word;
      palabra_bonus         = [ [word], '' ]; // sin definición
      tiempo_palabras_bonus = this._puntuacionPalabra(word);

      console.log(
        `[PalabrasMalditasMode][_emitNext] J${playerId} robó musa de J${otro}: "${word}"`
      );

    } else {
      // ─── Lista estática (aleatorio + reset) ────────────────────────
      if (PalabrasMalditasMode._remainingMalditas.length === 0) {
        PalabrasMalditasMode._remainingMalditas = [
          ...PalabrasMalditasMode.MALDITAS
        ];
        console.log(
          '[PalabrasMalditasMode][_emitNext] Lista estática reiniciada'
        );
      }

      const rem  = PalabrasMalditasMode._remainingMalditas;
      const idx  = Math.floor(Math.random() * rem.length);
      const word = rem.splice(idx, 1)[0];

      palabras_var          = word;
      palabra_bonus         = [ [word], '' ];
      tiempo_palabras_bonus = this._puntuacionPalabra(word);

      console.log(
        `[PalabrasMalditasMode][_emitNext] J${playerId} recibe estática: "${word}"`
      );
    }

    // ─── Emitir payload unificado ────────────────────────────────────
    const payload = {
      modo_actual: 'palabras malditas',
      palabras_var,
      palabra_bonus,
      tiempo_palabras_bonus
    };
    console.log(`[PalabrasMalditasMode][_emitNext] Emite ${evento}:`);
    console.dir(payload, { depth: null, colors: true });

    this.io.emit(evento, payload);
    // ─── Reprogramar siguiente envío ────────────────────────────────
    this._schedulePending(playerId);
  }

  /**
   * Cuando el cliente pide manualmente otra palabra maldita (opcional):
   * simplemente arranca el scheduler para que al timeout lance `_emitNext`.
   *
   * @param {1|2} playerId
   */
  async handleRequest(playerId) {
    const st = this.players[playerId];
    if (!st) return;

    // Limpiar timeout previo, si hubiera
    if (st.pendingTimer) {
      clearTimeout(st.pendingTimer);
      st.pendingTimer = null;
    }
    // Arrancar emisión automática
    this._schedulePending(playerId);
  }

  /**
   * Calcula un "tiempo" según frecuencias de letras.
   * @param {string} word
   * @returns {number}
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
    const pts = Math.ceil((((10 - sum*0.5) + clean.length*3)) / 5) * 5;
    return isNaN(pts) ? 10 : pts;
  }
}

module.exports = PalabrasMalditasMode;
