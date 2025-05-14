// curseMode.js
// Módulo para gestionar el modo "palabras malditas" de manera clara, optimizada y extensible.

class CurseMode {
    /**
     * Constructor
     * @param {object} io - instancia de socket.io
     * @param {number} timeoutMs - tiempo en milisegundos para cambio automático de palabra maldita
     * @param {string[]} staticWords - lista estática inicial de palabras malditas
     */
    constructor(io, timeoutMs, staticWords) {
      this.io = io;
      this.timeoutMs = timeoutMs;
      // Lista estática original: se usa para reiniciar cuando se agota
      this.originalStaticWords = Array.isArray(staticWords) ? [...staticWords] : [];
      // Estado de cada jugador
      this.players = {
        1: { musaWords: [], staticPool: [...this.originalStaticWords], timer: null },
        2: { musaWords: [], staticPool: [...this.originalStaticWords], timer: null }
      };
    }
  
    /**
     * Inicializa las palabras de musa (inspiración) para un jugador
     * @param {number} playerId - 1 o 2
     * @param {string[]} musaWords - lista inicial de palabras de musa
     */
    initPlayer(playerId, musaWords) {
      this.players[playerId].musaWords = Array.isArray(musaWords) ? [...musaWords] : [];
      // Reiniciar su pool estático también
      this.players[playerId].staticPool = [...this.originalStaticWords];
    }
  
    /**
     * Inicia el modo para un jugador: asigna palabra maldita inicial y programa timeout
     * @param {number} playerId - 1 o 2
     */
    start(playerId) {
      this.clearTimer(playerId);
      this.assignNextWord(playerId);
    }
  
    /**
     * Selecciona la siguiente palabra maldita para el jugador,
     * priorizando las musaWords del jugador opuesto.
     * Emite el evento `enviar_palabra_prohibida_j{playerId}` con:
     * - modo_actual: "palabras prohibidas"
     * - palabras_var: [palabraMaldita]
     * @param {number} playerId - 1 o 2
     */
    assignNextWord(playerId) {
      const player = this.players[playerId];
      const other = this.players[playerId === 1 ? 2 : 1];
  
      let word;
      // 1) Si el otro jugador envió musaWords, son malditas para este
      if (other.musaWords.length > 0) {
        const idx = Math.floor(Math.random() * other.musaWords.length);
        word = other.musaWords.splice(idx, 1)[0];
      } else {
        // 2) Sino, tomar aleatoriamente de la pool estática
        if (player.staticPool.length === 0) {
          // Reiniciar pool cuando se consume
          player.staticPool = [...this.originalStaticWords];
        }
        const idx = Math.floor(Math.random() * player.staticPool.length);
        word = player.staticPool.splice(idx, 1)[0];
      }
  
      // Emitir la palabra maldita
      this.io.emit(`enviar_palabra_prohibida_j${playerId}`, {
        modo_actual: "palabras prohibidas",
        palabras_var: [word]
      });
      // Programar próximo cambio
      this.scheduleTimeout(playerId);
    }
  
    /**
     * Programa el timeout para el siguiente cambio automático de palabra maldita
     * @param {number} playerId - 1 o 2
     */
    scheduleTimeout(playerId) {
      this.clearTimer(playerId);
      this.players[playerId].timer = setTimeout(() => {
        this.assignNextWord(playerId);
      }, this.timeoutMs);
    }
  
    /**
     * Maneja la petición de nueva palabra maldita (cuando el jugador la solicita)
     * @param {number} playerId - 1 o 2
     */
    handleRequest(playerId) {
      this.assignNextWord(playerId);
    }
  
    /**
     * Añade una nueva palabra de musa recibida del jugador (se convertirá en maldita para el otro)
     * @param {number} playerId - 1 o 2
     * @param {string} word - palabra de musa a añadir
     */
    addMusaWord(playerId, word) {
      if (!word) return;
      this.players[playerId].musaWords.push(word);
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
  
  module.exports = CurseMode;