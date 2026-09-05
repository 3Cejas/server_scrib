const test = require("node:test");
const assert = require("node:assert/strict");

const { registrarCanalesRonda } = require("../player_round_channels.js");

function crearCanalesRondaFake(overrides = {}) {
  const handlers = {};
  const broadcasts = [];
  const labelsAvance = [];
  const tempModosCalls = [];
  const pausaEstados = [];
  const desventajasRegistradas = [];
  let pausarDesventajasCalls = 0;
  let pausarRelojCalls = 0;
  let reanudarDesventajasCalls = 0;
  let cancelarInicioCalls = 0;
  let tempEmitidos = 0;
  let pulsacionesRegistradas = 0;
  let finalizarPartidaCalls = 0;

  const state = {
    modoActual: overrides.modoActual || "tertulia",
    modoAnterior: "",
    segundosTranscurridos: 5,
    estadoJugadores: {
      1: { finished: false },
      2: { finished: false }
    },
    finDelJuego: false,
    finJ1: false,
    finJ2: false,
    setNuevaPalabra() {},
    marcarFinJugador() {},
    ...overrides.state
  };

  const socket = {
    id: overrides.socketId || "socket",
    escritxr: overrides.escritxr,
    control: overrides.control === true,
    on(eventName, handler) {
      handlers[eventName] = handler;
    },
    broadcast: {
      emit(eventName, payload) {
        broadcasts.push({ eventName, payload });
      }
    }
  };

  const motorModos = {
    activarModo() {},
    modos_de_juego() {
      state.modoAnterior = state.modoActual;
      state.modoActual = overrides.nextMode || "palabras bonus";
    },
    temp_modos(socketArg, options) {
      tempModosCalls.push({ socket: socketArg, options });
    }
  };

  registrarCanalesRonda({
    socket,
    io: { emit() {} },
    state,
    partidaSync: {
      obtenerModoSeq: () => 1,
      obtenerTiempoSeq: () => 0,
      obtenerConteo: () => ({ modo_seq: 0, count_seq: 0, tiempo_seq: 0 }),
      guardarConteo() {},
      siguienteModoSeq() {},
      convertirTextoCountASegundos: () => 0
    },
    timersPartida: {
      cancelarIntervaloModos() {},
      cancelarInicio() {
        cancelarInicioCalls += 1;
      },
      cancelarCambioLetra() {}
    },
    limpiezasModo: {},
    limpiarTimersPalabras() {},
    limpiarTimersRonda() {},
    activarSocketsExtratextuales() {},
    construirPayloadCount: (payload) => payload,
    obtenerIdJugadorValido: (player) => Number(player) || null,
    motorModos,
    avanzarModoSeguro(_socket, callback, label) {
      labelsAvance.push(label);
      callback();
      return true;
    },
    reiniciarEstadoPartida() {},
    emitirTempModos() {
      tempEmitidos += 1;
    },
    cancelarCambioPalabra() {},
    registrarDesventajaAplicada(evento = {}) {
      desventajasRegistradas.push(evento);
      return overrides.registrarDesventajaAplicada
        ? overrides.registrarDesventajaAplicada(evento)
        : {
            player: Number(evento.player) || 1,
            putada: evento.putada,
            duracion_ms: Number(evento.duracion_ms) || 5000,
            tiempo_restante_ms: Number(evento.duracion_ms) || 5000
          };
    },
    pausarDesventajasActivas() {
      pausarDesventajasCalls += 1;
    },
    pausarRelojPartida() {
      pausarRelojCalls += 1;
    },
    reanudarDesventajasActivas() {
      reanudarDesventajasCalls += 1;
    },
    setPartidaPausada(valor) {
      pausaEstados.push(Boolean(valor));
    },
    sesionesEscritor: overrides.sesionesEscritor || null,
    isDebugMode: () => overrides.debug === true,
    finalizarPartida() {
      finalizarPartidaCalls += 1;
      state.finDelJuego = true;
      state.modoActual = "";
      return true;
    },
    registrarPulsacionCompeticion() {
      pulsacionesRegistradas += 1;
    }
  });

  return {
    broadcasts,
    cancelarInicioCalls: () => cancelarInicioCalls,
    desventajasRegistradas,
    handlers,
    labelsAvance,
    pausaEstados,
    pausarDesventajasCalls: () => pausarDesventajasCalls,
    pausarRelojCalls: () => pausarRelojCalls,
    reanudarDesventajasCalls: () => reanudarDesventajasCalls,
    pulsacionesRegistradas: () => pulsacionesRegistradas,
    finalizarPartidaCalls: () => finalizarPartidaCalls,
    state,
    tempEmitidos: () => tempEmitidos,
    tempModosCalls
  };
}

test("pausar marks the match as paused and freezes active disadvantages", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "palabras bonus"
  });

  ctx.handlers.pausar({ source: "pause-button" });

  assert.deepEqual(ctx.pausaEstados, [true]);
  assert.equal(ctx.pausarDesventajasCalls(), 1);
  assert.equal(ctx.pausarRelojCalls(), 1);
  assert.equal(ctx.cancelarInicioCalls(), 1);
  assert.deepEqual(ctx.broadcasts, [
    { eventName: "pausar_js", payload: { source: "pause-button" } }
  ]);
});

test("automatic tertulia pause leaves the total match clock running", () => {
  const ctx = crearCanalesRondaFake({ modoActual: "tertulia" });

  ctx.handlers.pausar({ motivo: "tertulia" });

  assert.deepEqual(ctx.pausaEstados, [true]);
  assert.equal(ctx.pausarDesventajasCalls(), 1);
  assert.equal(ctx.pausarRelojCalls(), 0);
  assert.deepEqual(ctx.broadcasts, [
    { eventName: "pausar_js", payload: { motivo: "tertulia" } }
  ]);
});

test("enviar_putada_a_jx broadcasts normalized disadvantage payload with duration", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "palabras bonus",
    registrarDesventajaAplicada: (evento) => ({
      player: evento.player,
      putada: evento.putada,
      duracion_ms: 7000,
      tiempo_restante_ms: 7000
    })
  });

  ctx.handlers.enviar_putada_a_jx({ player: 2, putada: "rayo", duracion_ms: 7000 });

  assert.deepEqual(ctx.desventajasRegistradas, [
    { player: 2, putada: "rayo", duracion_ms: 7000 }
  ]);
  assert.deepEqual(ctx.broadcasts, [
    {
      eventName: "enviar_putada_de_j2",
      payload: {
        player: 2,
        putada: "rayo",
        duracion_ms: 7000,
        tiempo_restante_ms: 7000
      }
    }
  ]);
});

test("reanudar clears the paused state and resumes active disadvantages", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "palabras bonus"
  });

  ctx.handlers.reanudar({ source: "pause-button" });

  assert.deepEqual(ctx.pausaEstados, [false]);
  assert.equal(ctx.reanudarDesventajasCalls(), 1);
  assert.deepEqual(ctx.tempModosCalls.map((call) => call.options), [{ continuar: true }]);
  assert.deepEqual(ctx.broadcasts, [
    { eventName: "reanudar_js", payload: { source: "pause-button" } }
  ]);
});

test("reanudar_modo advances the mode and restarts the mode interval", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "tertulia",
    nextMode: "palabras bonus"
  });

  ctx.handlers.reanudar_modo({ source: "pause-button" });

  assert.deepEqual(ctx.labelsAvance, ["reanudar_modo"]);
  assert.deepEqual(ctx.pausaEstados, [false]);
  assert.equal(ctx.reanudarDesventajasCalls(), 1);
  assert.equal(ctx.state.modoActual, "palabras bonus");
  assert.equal(ctx.state.segundosTranscurridos, 0);
  assert.deepEqual(ctx.tempModosCalls.map((call) => call.options), [undefined]);
  assert.deepEqual(ctx.broadcasts, [
    { eventName: "reanudar_js", payload: { source: "pause-button" } }
  ]);
});

test("reanudar_modo ignores stale requests once tertulia already ended", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "palabras bonus",
    nextMode: "palabras prohibidas"
  });

  ctx.handlers.reanudar_modo({ source: "stale-tertulia-timeout" });

  assert.deepEqual(ctx.labelsAvance, []);
  assert.equal(ctx.state.modoActual, "palabras bonus");
  assert.deepEqual(ctx.tempModosCalls, []);
  assert.deepEqual(ctx.broadcasts, []);
});

test("saltar_tertulia advances the mode, emits timer sync and restarts the mode interval", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "tertulia",
    nextMode: "palabras bonus"
  });

  ctx.handlers.saltar_tertulia();

  assert.deepEqual(ctx.labelsAvance, ["saltar_tertulia"]);
  assert.deepEqual(ctx.pausaEstados, [false]);
  assert.equal(ctx.reanudarDesventajasCalls(), 1);
  assert.equal(ctx.state.segundosTranscurridos, 0);
  assert.equal(ctx.state.modoActual, "palabras bonus");
  assert.deepEqual(ctx.tempModosCalls.map((call) => call.options), [undefined]);
  assert.equal(ctx.tempEmitidos(), 1);
  assert.deepEqual(ctx.broadcasts, [
    { eventName: "reanudar_js", payload: { motivo: "saltar_tertulia" } }
  ]);
});

test("debug level skip requires authenticated Control and active Debug mode", () => {
  const unauthorized = crearCanalesRondaFake({ modoActual: "letra bendita", debug: true });
  let unauthorizedResponse = null;
  unauthorized.handlers.debug_siguiente_nivel({}, (response) => { unauthorizedResponse = response; });
  assert.deepEqual(unauthorizedResponse, { ok: false, code: "NOT_AUTHORIZED" });

  const disabled = crearCanalesRondaFake({ modoActual: "letra bendita", control: true });
  let disabledResponse = null;
  disabled.handlers.debug_siguiente_nivel({}, (response) => { disabledResponse = response; });
  assert.deepEqual(disabledResponse, { ok: false, code: "DEBUG_MODE_REQUIRED" });
});

test("Debug Control can advance one level and restart its timer", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "letra bendita",
    nextMode: "letra prohibida",
    control: true,
    debug: true
  });
  let response = null;
  ctx.handlers.debug_siguiente_nivel({}, (result) => { response = result; });

  assert.deepEqual(response, {
    ok: true,
    modo_actual: "letra prohibida",
    partida_finalizada: false
  });
  assert.deepEqual(ctx.labelsAvance, ["debug_siguiente_nivel"]);
  assert.equal(ctx.state.segundosTranscurridos, 0);
  assert.equal(ctx.tempEmitidos(), 1);
  assert.equal(ctx.tempModosCalls.length, 1);
});

test("Debug Control can finish an active match", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "palabras bonus",
    control: true,
    debug: true
  });
  let response = null;
  ctx.handlers.debug_finalizar_partida({}, (result) => { response = result; });

  assert.deepEqual(response, { ok: true, partida_finalizada: true });
  assert.equal(ctx.finalizarPartidaCalls(), 1);
  assert.equal(ctx.state.finDelJuego, true);
});

test("Debug Control cannot finish before a match has an active level", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "",
    control: true,
    debug: true,
    state: { modoActual: "" }
  });
  ctx.state.modoActual = "";
  let response = null;
  ctx.handlers.debug_finalizar_partida({}, (result) => { response = result; });

  assert.deepEqual(response, { ok: false, code: "GAME_NOT_ACTIVE" });
  assert.equal(ctx.finalizarPartidaCalls(), 0);
});

test("inactive writer sessions cannot tick or register keystrokes", () => {
  const ctx = crearCanalesRondaFake({
    modoActual: "palabras bonus",
    escritxr: 1,
    sesionesEscritor: { esActiva: () => false },
    state: {
      marcarFinJugador() {
        throw new Error("inactive writer should not finish the round");
      }
    }
  });

  ctx.handlers.count({ player: 1, count: "00:10", count_seq: 1 });
  ctx.handlers.tecla_jugador({ player: 1, code: "KeyA", key: "a" });
  ctx.handlers.pausar({ source: "stale-writer" });

  assert.deepEqual(ctx.broadcasts, []);
  assert.deepEqual(ctx.pausaEstados, []);
  assert.equal(ctx.pulsacionesRegistradas(), 0);
});

test("keystrokes use the authenticated writer instead of a spoofed player", () => {
  const ctx = crearCanalesRondaFake({
    escritxr: 1,
    sesionesEscritor: { esActiva: () => true }
  });

  ctx.handlers.tecla_jugador({ player: 2, code: "KeyA", key: "a" });

  assert.equal(ctx.pulsacionesRegistradas(), 1);
});
