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
  const ordenPreShow = [];
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
  const preShow = {
    activo: true,
    aperturas: 0,
    cierres: [],
    abrir() {
      this.activo = true;
      this.aperturas += 1;
      ordenPreShow.push("pre_show_estado");
    },
    cerrar(motivo) {
      this.activo = false;
      this.cierres.push(motivo);
    }
  };
  const videoPreShow = {
    activo: true,
    aperturas: 0,
    cierres: [],
    abrirFase() {
      this.activo = true;
      this.aperturas += 1;
      ordenPreShow.push("video_tutorial_estado");
    },
    cerrarFase(motivo) {
      this.activo = false;
      this.cierres.push(motivo);
    }
  };
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
    programarInicioTimer: noOp,
    preShowMusas: preShow,
    videoTutorialPreShow: videoPreShow
  });
  const socket = {
    broadcast: { emit: noOp }
  };
  return { ciclo, eventos, ordenPreShow, preShow, videoPreShow, puntuacionFinal, socket, state, statsLive };
}

function crearSocketLifecycle({ control = false, simulacion = false } = {}) {
  const handlers = {};
  return {
    control,
    simulacion_scrib: simulacion,
    broadcast: { emit() {} },
    on(event, handler) {
      handlers[event] = handler;
    },
    trigger(event, payload) {
      handlers[event](payload);
    }
  };
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

test("only control or the internal simulator can open or close pre-show through lifecycle events", () => {
  const ctx = crearHarness();
  const intruso = crearSocketLifecycle();
  ctx.ciclo.registrarHandlers(intruso);

  intruso.trigger("inicio", { count: "1:00" });
  intruso.trigger("limpiar", {});
  assert.equal(ctx.preShow.activo, true);
  assert.deepEqual(ctx.preShow.cierres, []);
  assert.equal(ctx.preShow.aperturas, 0);
  assert.equal(ctx.videoPreShow.activo, true);
  assert.deepEqual(ctx.videoPreShow.cierres, []);
  assert.equal(ctx.videoPreShow.aperturas, 0);

  const control = crearSocketLifecycle({ control: true });
  ctx.ciclo.registrarHandlers(control);
  control.trigger("inicio", { count: "1:00", parametros: {} });
  assert.equal(ctx.preShow.activo, false);
  assert.equal(ctx.preShow.cierres.at(-1), "inicio_partida");
  assert.equal(ctx.videoPreShow.activo, false);
  assert.equal(ctx.videoPreShow.cierres.at(-1), "inicio_partida");
  control.broadcast.emit = (event) => ctx.ordenPreShow.push(event);
  control.trigger("limpiar", {});
  assert.equal(ctx.preShow.activo, true);
  assert.equal(ctx.preShow.aperturas, 1);
  assert.equal(ctx.videoPreShow.activo, true);
  assert.equal(ctx.videoPreShow.aperturas, 1);
  assert.deepEqual(ctx.ordenPreShow.slice(-3), ["limpiar", "pre_show_estado", "video_tutorial_estado"]);

  const simulador = crearSocketLifecycle({ simulacion: true });
  ctx.ciclo.registrarHandlers(simulador);
  simulador.trigger("inicio", { count: "1:00", parametros: {} });
  assert.equal(ctx.preShow.activo, false);
  assert.equal(ctx.videoPreShow.activo, false);
});
