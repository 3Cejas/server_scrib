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
  let reanudarDesventajasCalls = 0;
  let cancelarInicioCalls = 0;
  let tempEmitidos = 0;

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
    reanudarDesventajasActivas() {
      reanudarDesventajasCalls += 1;
    },
    setPartidaPausada(valor) {
      pausaEstados.push(Boolean(valor));
    },
    sesionesEscritor: overrides.sesionesEscritor || null
  });

  return {
    broadcasts,
    cancelarInicioCalls: () => cancelarInicioCalls,
    desventajasRegistradas,
    handlers,
    labelsAvance,
    pausaEstados,
    pausarDesventajasCalls: () => pausarDesventajasCalls,
    reanudarDesventajasCalls: () => reanudarDesventajasCalls,
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
  assert.equal(ctx.cancelarInicioCalls(), 1);
  assert.deepEqual(ctx.broadcasts, [
    { eventName: "pausar_js", payload: { source: "pause-button" } }
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

test("inactive writer sessions cannot finish or tick the round", () => {
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
  ctx.handlers.fin_de_player({ player: 1 });
  ctx.handlers.pausar({ source: "stale-writer" });

  assert.deepEqual(ctx.broadcasts, []);
  assert.deepEqual(ctx.pausaEstados, []);
});
