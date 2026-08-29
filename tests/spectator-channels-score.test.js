const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { crearGestorPuntuacionFinal } = require("../final_scoring.js");
const { registrarCanalesEspectador } = require("../spectator_channels.js");
const { crearGestorVistaEspectador } = require("../spectator_state.js");
const { crearGestorStatsLive } = require("../stats_live.js");

const crearTelemetria = (palabras1 = 80, palabras2 = 40) => ({
  modo_actual: "frase final",
  players: {
    1: {
      nombre: "AZUL",
      palabrasTotal: palabras1,
      palabrasUnicas: Math.round(palabras1 * 0.6),
      ritmoPpm: 90,
      palabrasBenditas: ["luz", "mar"],
      intentosLetraProhibida: 0,
      intentosPalabraProhibida: 1,
      vida: { media: 45 }
    },
    2: {
      nombre: "ROJO",
      palabrasTotal: palabras2,
      palabrasUnicas: Math.round(palabras2 * 0.5),
      ritmoPpm: 60,
      palabrasBenditas: ["fuego"],
      intentosLetraProhibida: 2,
      intentosPalabraProhibida: 2,
      vida: { media: 25 }
    }
  }
});

function crearContexto({ control = false, disponible = true, pendiente = false, preShowActivo = true, pulsaciones = { 1: 120, 2: 80 } } = {}) {
  const socket = new EventEmitter();
  socket.control = control;
  const ioEvents = [];
  const io = {
    emit(event, payload) {
      ioEvents.push({ event, payload });
    }
  };
  const espectador = crearGestorVistaEspectador({ io });
  const statsBase = crearGestorStatsLive({ io });
  const puntuacionFinal = crearGestorPuntuacionFinal({ io, now: () => 1234 });
  if (disponible) {
    statsBase.actualizarDesdeControl(crearTelemetria());
    puntuacionFinal.prepararCaptura();
    puntuacionFinal.capturarPendiente(statsBase.payload(), {
      datosRecibidos: statsBase.payloadDatosRecibidos()
    });
  } else if (pendiente) {
    puntuacionFinal.prepararCaptura();
  }
  let actualizacionesStats = 0;
  const statsLive = {
    actualizarDesdeControl(payload) {
      actualizacionesStats += 1;
      return statsBase.actualizarDesdeControl(payload);
    },
    emitir: statsBase.emitir,
    payload: statsBase.payload,
    payloadDatosRecibidos: statsBase.payloadDatosRecibidos
  };
  let aperturasPreShow = 0;
  const preShowMusas = {
    estaActivo: () => preShowActivo || aperturasPreShow > 0,
    abrir() { aperturasPreShow += 1; }
  };

  registrarCanalesEspectador({
    socket,
    calentamiento: { vista: false },
    obtenerContadorMusas: () => ({}),
    payloadEstadoCalentamiento: () => ({}),
    emitirIdiomaJuego: () => {},
    setIdiomaJuego: () => {},
    emitirVistaEspectadorModo: (destino = null) => espectador.emitir(destino),
    emitirStatsLive: statsBase.emitir,
    statsLive,
    emitirPuntuacionFinal: puntuacionFinal.emitir,
    puntuacionFinal,
    getPulsacionesCompeticion: () => pulsaciones,
    emitirNubeInspiracionEstado: () => {},
    emitirEstadoBanderasMusas: () => {},
    emitirCreditosShow: () => {},
    emitirFeedbackMusas: () => {},
    sincronizarEstadoMusa: () => {},
    espectador,
    creditosShow: { actualizar() {}, incrementarAnimacion() {} },
    resolverModoVistaEspectador: espectador.resolverModo,
    preShowMusas
  });

  ioEvents.length = 0;
  return {
    actualizacionesStats: () => actualizacionesStats,
    aperturasPreShow: () => aperturasPreShow,
    espectador,
    ioEvents,
    puntuacionFinal,
    statsLive,
    socket
  };
}

test("only a registered control can replace authoritative live stats", () => {
  const ctx = crearContexto();
  let rechazo = null;

  ctx.socket.emit("stats_live_actualizar", { players: {} }, (respuesta) => {
    rechazo = respuesta;
  });
  assert.deepEqual(rechazo, { ok: false, code: "NOT_AUTHORIZED" });
  assert.equal(ctx.actualizacionesStats(), 0);

  ctx.socket.control = true;
  let aceptada = null;
  ctx.socket.emit("stats_live_actualizar", { players: { 1: {} } }, (respuesta) => {
    aceptada = respuesta;
  });
  assert.deepEqual(aceptada, { ok: true });
  assert.equal(ctx.actualizacionesStats(), 1);
});

test("score state is readable by every role but unavailable scores cannot be shown", () => {
  const ctx = crearContexto({ disponible: false });
  let pedido = null;
  let mostrar = null;

  ctx.socket.emit("pedir_puntuacion_final", {}, (respuesta) => {
    pedido = respuesta;
  });
  assert.equal(pedido.disponible, false);

  ctx.socket.control = true;
  ctx.socket.emit("mostrar_puntuacion_final", {}, (respuesta) => {
    mostrar = respuesta;
  });
  assert.deepEqual(mostrar, { ok: false, code: "PUNTUACION_NO_DISPONIBLE" });
  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "puntuacion" });
  assert.equal(ctx.espectador.resolverModo(), "partida");
});

test("control can switch the spectator between tutorial and game as distinct views", () => {
  const ctx = crearContexto({ control: true });

  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "tutorial" });
  assert.equal(ctx.espectador.resolverModo(), "tutorial");
  assert.equal(
    ctx.ioEvents.some(({ event, payload }) => (
      event === "vista_espectador_modo"
      && payload.modo === "tutorial"
      && payload.override === "tutorial"
    )),
    true
  );

  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "partida" });
  assert.equal(ctx.espectador.resolverModo(), "partida");
});

test("opening Tutorial from Control restores the pre-show channel for spectator and muses", () => {
  const ctx = crearContexto({ control: true, preShowActivo: false });

  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "tutorial" });

  assert.equal(ctx.aperturasPreShow(), 1);
  assert.equal(ctx.espectador.resolverModo(), "tutorial");
});

test("only control can trigger the one-time final capture", () => {
  const ctx = crearContexto({ disponible: false, pendiente: true });
  let rechazo = null;

  ctx.socket.emit("capturar_puntuacion_final", {}, (respuesta) => {
    rechazo = respuesta;
  });
  assert.deepEqual(rechazo, { ok: false, code: "NOT_AUTHORIZED" });
  assert.equal(ctx.puntuacionFinal.estaPendiente(), true);
  assert.equal(ctx.puntuacionFinal.payload().disponible, false);
});

test("final telemetry followed by capture fixes the score and repeat calls are idempotent", () => {
  const ctx = crearContexto({ control: true, disponible: false, pendiente: true });
  ctx.socket.emit("stats_live_actualizar", crearTelemetria(100, 30));

  let primera = null;
  ctx.socket.emit("capturar_puntuacion_final", {}, (respuesta) => {
    primera = respuesta;
  });
  assert.equal(primera.ok, true);
  assert.equal(primera.capturada, true);
  assert.equal(primera.puntuacion.disponible, true);
  assert.equal(primera.puntuacion.ganador, 1);
  const categoriaPulsaciones = primera.puntuacion.categorias.find((categoria) => categoria.id === "pulsaciones");
  assert.deepEqual(categoriaPulsaciones.valores, { 1: 120, 2: 80 });
  const totalFijado = primera.puntuacion.jugadores[1].total;

  ctx.socket.emit("stats_live_actualizar", crearTelemetria(1, 999));
  let repetida = null;
  ctx.socket.emit("capturar_puntuacion_final", (respuesta) => {
    repetida = respuesta;
  });
  assert.equal(repetida.ok, true);
  assert.equal(repetida.capturada, false);
  assert.equal(repetida.ya_capturada, true);
  assert.equal(repetida.puntuacion.jugadores[1].total, totalFijado);
  assert.equal(repetida.puntuacion.ganador, 1);
});

test("show uses sufficient pending telemetry as fallback but refuses incomplete data", () => {
  const incompleto = crearContexto({ control: true, disponible: false, pendiente: true });
  let rechazo = null;
  incompleto.socket.emit("mostrar_puntuacion_final", {}, (respuesta) => {
    rechazo = respuesta;
  });
  assert.deepEqual(rechazo, { ok: false, code: "PUNTUACION_NO_DISPONIBLE" });
  assert.equal(incompleto.puntuacionFinal.estaPendiente(), true);

  const completo = crearContexto({ control: true, disponible: false, pendiente: true });
  completo.socket.emit("stats_live_actualizar", crearTelemetria());
  let mostrar = null;
  completo.socket.emit("mostrar_puntuacion_final", {}, (respuesta) => {
    mostrar = respuesta;
  });
  assert.equal(mostrar.ok, true);
  assert.equal(mostrar.puntuacion.disponible, true);
  assert.equal(completo.puntuacionFinal.estaPendiente(), false);
  assert.equal(completo.espectador.resolverModo(), "puntuacion");
});

test("control can show, reveal, clamp and hide the final score", () => {
  const ctx = crearContexto({ control: true });
  let mostrar = null;
  ctx.socket.emit("mostrar_puntuacion_final", {}, (respuesta) => {
    mostrar = respuesta;
  });

  assert.equal(mostrar.ok, true);
  assert.equal(ctx.espectador.resolverModo(), "puntuacion");
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 0);

  for (let index = 0; index < 12; index += 1) {
    ctx.socket.emit("puntuacion_final_siguiente", {});
  }
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 7);

  ctx.socket.emit("puntuacion_final_anterior", {});
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 6);

  let ocultar = null;
  ctx.socket.emit("ocultar_puntuacion_final", {}, (respuesta) => {
    ocultar = respuesta;
  });
  assert.equal(ocultar.ok, true);
  assert.equal(ctx.espectador.resolverModo(), "partida");
  assert.equal(
    ctx.ioEvents.some((evento) => evento.event === "puntuacion_final_estado"),
    true
  );
});

test("non-control sockets cannot mutate score visibility or reveal steps", () => {
  const ctx = crearContexto();
  let rechazo = null;

  ctx.socket.emit("mostrar_puntuacion_final", {}, (respuesta) => {
    rechazo = respuesta;
  });
  assert.deepEqual(rechazo, { ok: false, code: "NOT_AUTHORIZED" });
  assert.equal(ctx.espectador.resolverModo(), "partida");

  ctx.espectador.cambiarModo("puntuacion");
  ctx.socket.emit("puntuacion_final_siguiente", {});
  ctx.socket.emit("ocultar_puntuacion_final", {});
  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "partida" });
  assert.equal(ctx.espectador.resolverModo(), "puntuacion");
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 0);
});
