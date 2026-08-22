const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorPuntuacionFinal } = require("../final_scoring.js");
const { crearCicloPartida } = require("../partida_lifecycle.js");
const { crearGestorStatsLive } = require("../stats_live.js");

const telemetriaFinal = (palabras1 = 70, palabras2 = 35) => ({
  players: {
    1: {
      nombre: "AZUL",
      palabrasTotal: palabras1,
      palabrasUnicas: Math.round(palabras1 * 0.6),
      ritmoPpm: 80,
      palabrasBenditas: ["luz", "mar"],
      intentosLetraProhibida: 0,
      intentosPalabraProhibida: 1,
      vida: { media: 40 }
    },
    2: {
      nombre: "ROJO",
      palabrasTotal: palabras2,
      palabrasUnicas: Math.round(palabras2 * 0.5),
      ritmoPpm: 50,
      palabrasBenditas: ["fuego"],
      intentosLetraProhibida: 2,
      intentosPalabraProhibida: 2,
      vida: { media: 20 }
    }
  }
});

function crearHarness() {
  const eventos = [];
  const io = {
    emit(event, payload) {
      eventos.push({ event, payload });
    }
  };
  const statsLive = crearGestorStatsLive({ io });
  const puntuacionFinal = crearGestorPuntuacionFinal({ io, now: () => 777 });
  const state = {
    listaModos: ["letra bendita", "frase final"],
    modosPendientes: ["frase final"],
    indiceModo: 1,
    modoAnterior: "",
    modoActual: "frase final",
    modoPendienteVentaja: "",
    finJ1: true,
    finJ2: true,
    finDelJuego: false,
    transicionModoEnCurso: false,
    estadoJugadores: {
      1: { finished: false },
      2: { finished: false }
    },
    tiempos: [],
    tiempoCambioModos: 10,
    duracionTiempoModos: 10,
    nuevaPalabraJ1: false,
    nuevaPalabraJ2: false,
    reiniciarLetrasPendientes() {}
  };
  const noOp = () => {};
  const ciclo = crearCicloPartida({
    state,
    io,
    partidaSync: {
      siguienteModoSeq: noOp,
      resetTiempoSeq: noOp,
      resetConteoSync: noOp
    },
    limpiezasModo: { "frase final": noOp },
    limpiarTimersPalabras: noOp,
    limpiarTimersRonda: noOp,
    limpiarTodosLosModos: noOp,
    activarSocketsExtratextuales: noOp,
    resetearEstadoAuxiliarParaTests: noOp,
    resetearEstadoResurreccion: noOp,
    payloadEstadoResurreccion: () => ({ 1: {}, 2: {} }),
    musasAuxiliares: { resetRegalos: noOp },
    prepararParametrosInicio: noOp,
    getRanges: () => [],
    statsLive,
    emitirStatsLive: statsLive.emitir,
    puntuacionFinal,
    emitirPuntuacionFinal: puntuacionFinal.emitir,
    emitirNubeInspiracionEstado: noOp,
    emitirModoActual: noOp,
    setPartidaPausada: noOp,
    registrarTimelineModo: noOp,
    motorModos: { activarModo: noOp, temp_modos: noOp },
    programarInicioTimer: noOp
  });
  const socket = {
    broadcast: { emit: noOp }
  };
  return { ciclo, eventos, puntuacionFinal, socket, state, statsLive };
}

test("end-of-player reset marks score pending without capturing or clearing old telemetry", () => {
  const ctx = crearHarness();
  ctx.statsLive.actualizarDesdeControl(telemetriaFinal());

  ctx.ciclo.reiniciarEstadoPartida(ctx.socket);

  assert.equal(ctx.puntuacionFinal.estaPendiente(), true);
  assert.equal(ctx.puntuacionFinal.payload().disponible, false);
  assert.equal(ctx.puntuacionFinal.payload().calculado_en_ts, 0);
  assert.equal(ctx.statsLive.payload().players[1].palabrasTotal, 70);
  assert.deepEqual(ctx.statsLive.payloadDatosRecibidos(), { 1: true, 2: true });
});

test("a captured final score survives repeated finish cleanup and resets on the next match", () => {
  const ctx = crearHarness();
  ctx.statsLive.actualizarDesdeControl(telemetriaFinal());
  ctx.ciclo.finalizarPartida(ctx.socket);

  const capturada = ctx.puntuacionFinal.capturarPendiente(ctx.statsLive.payload(), {
    datosRecibidos: ctx.statsLive.payloadDatosRecibidos()
  });
  assert.equal(capturada.ok, true);
  assert.equal(capturada.capturada, true);
  const totalFijado = capturada.puntuacion.jugadores[1].total;

  ctx.statsLive.actualizarDesdeControl(telemetriaFinal(1, 999));
  ctx.ciclo.reiniciarEstadoPartida(ctx.socket);
  const repetida = ctx.puntuacionFinal.capturarPendiente(ctx.statsLive.payload(), {
    datosRecibidos: ctx.statsLive.payloadDatosRecibidos()
  });
  assert.equal(repetida.ya_capturada, true);
  assert.equal(repetida.puntuacion.jugadores[1].total, totalFijado);

  ctx.ciclo.iniciarPartida(ctx.socket, { count: 10, parametros: {} });
  assert.equal(ctx.puntuacionFinal.payload().disponible, false);
  assert.equal(ctx.puntuacionFinal.estaPendiente(), false);
  assert.deepEqual(ctx.statsLive.payloadDatosRecibidos(), { 1: false, 2: false });
  assert.equal(ctx.statsLive.payload().players[1].palabrasTotal, 0);
});
