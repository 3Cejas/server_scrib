// bonusMode.js
// Módulo para gestionar el modo "palabras bonus" de manera clara, optimizada y extensible.

// Definición por defecto para palabras de musa
const DEFAULT_DEFINITION_MUSA = "<span style='color:lime;'>MUSA</span>";

class BonusMode {
  /**
   * Constructor
   * @param {object} io - instancia de socket.io
   * @param {number} timeoutMs - tiempo en milisegundos para cambio automático de palabra
   * @param {Function} palabraRAE - función que devuelve una promesa con una palabra RAE ([palabra, definición])
   * @param {Function} puntuacionFn - función que calcula puntuación a partir de una palabra
   */
  constructor(io, timeoutMs, palabraRAE, puntuacionFn) {
    this.io = io;
    this.timeoutMs = timeoutMs;
    this.palabraRAE = palabraRAE;
    this.puntuacionFn = puntuacionFn;
    this.players = {
      1: { musaWords: [], timer: null },
      2: { musaWords: [], timer: null }
    };
  }

  /**
   * Inicializa las palabras de musa para un jugador
   * @param {number} playerId - 1 o 2
   * @param {string[]} musaWords - lista inicial de palabras de musa
   */
  initPlayer(playerId, musaWords) {
    this.players[playerId].musaWords = Array.isArray(musaWords) ? [...musaWords] : [];
  }

  /**
   * Inicia el modo para un jugador: asigna palabra inicial y programa timeout
   * @param {number} playerId - 1 o 2
   */
  start(playerId) {
    this.clearTimer(playerId);
    this.assignNextWord(playerId);
  }

  /**
   * Asigna la siguiente palabra al jugador, priorizando musas
   * Emite el evento `enviar_palabra_j{playerId}` con:
   * - modo_actual: "palabras bonus"
   * - palabras_var: [palabra]
   * - palabra_bonus: [[palabra], [definición]]
   * - tiempo_palabras_bonus: puntuación
   * @param {number} playerId - 1 o 2
   */
  assignNextWord(playerId) {
    const player = this.players[playerId];

    const emitData = (word, definition) => {
      const tiempo = this.puntuacionFn(word);
      this.io.emit(`enviar_palabra_j${playerId}`, {
        modo_actual: "palabras bonus",
        palabras_var: [word],
        palabra_bonus: [[word], [definition]],
        tiempo_palabras_bonus: tiempo
      });
      this.scheduleTimeout(playerId);
    };

    // Priorizar palabra de musa si existe
    if (player.musaWords.length > 0) {
      const idx = Math.floor(Math.random() * player.musaWords.length);
      const word = player.musaWords.splice(idx, 1)[0];
      emitData(word, DEFAULT_DEFINITION_MUSA);
    } else {
      // Sino, solicitar palabra RAE
      this.palabraRAE()
        .then(([wordRAE]) => emitData(wordRAE, ""))
        .catch(err => console.error("Error obteniendo palabra RAE:", err));
    }
  }

  /**
   * Programa el timeout para el siguiente cambio automático de palabra
   * @param {number} playerId - 1 o 2
   */
  scheduleTimeout(playerId) {
    this.clearTimer(playerId);
    this.players[playerId].timer = setTimeout(() => {
      this.assignNextWord(playerId);
    }, this.timeoutMs);
  }

  /**
   * Maneja la petición de nueva palabra (cuando el jugador la introduce)
   * @param {number} playerId - 1 o 2
   */
  handleRequest(playerId) {
    this.assignNextWord(playerId);
  }

  /**
   * Añade una nueva palabra de musa recibida del jugador
   * @param {number} playerId - 1 o 2
   * @param {string} word - palabra de musa a añadir
   */
  addMusaWord(playerId, word) {
    if (!word) return;
    const player = this.players[playerId];
    player.musaWords.push(word);
  }

  /**
   * Limpia el temporizador de un jugador
   * @param {number} playerId - 1 o 2
   */
  clearTimer(playerId) {
    const t = this.players[playerId].timer;
    if (t) clearTimeout(t);
    this.players[playerId].timer = null;
  }

  /**
   * Limpia todos los temporizadores (al finalizar el modo)
   */
  clearAll() {
    [1, 2].forEach(id => this.clearTimer(id));
  }
}

module.exports = BonusMode;