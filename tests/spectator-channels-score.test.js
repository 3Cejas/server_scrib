const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { crearGestorPuntuacionFinal } = require("../final_scoring.js");
const { createJuryResultManager } = require("../jury_result.js");
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
  const resultadoJurado = createJuryResultManager({
    io,
    isVisible: () => espectador.resolverModo() === "resultado_jurado",
    now: () => 4321
  });
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
  const cambiosConParada = [];
  const preShowMusas = {
    estaActivo: () => preShowActivo || aperturasPreShow > 0,
    abrir() { aperturasPreShow += 1; }
  };

  registrarCanalesEspectador({
    socket,
    io,
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
    emitirResultadoJurado: resultadoJurado.emit,
    emitirEstadoBanderasMusas: () => {},
    emitirCreditosShow: () => {},
    emitirFeedbackMusas: () => {},
    sincronizarEstadoMusa: () => {},
    espectador,
    creditosShow: { actualizar() {}, incrementarAnimacion() {} },
    resultadoJurado,
    resolverModoVistaEspectador: espectador.resolverModo,
    preShowMusas,
    detenerExperienciasTutorial: (cambio) => cambiosConParada.push(cambio)
  });

  ioEvents.length = 0;
  return {
    actualizacionesStats: () => actualizacionesStats,
    aperturasPreShow: () => aperturasPreShow,
    cambiosConParada,
    espectador,
    ioEvents,
    puntuacionFinal,
    resultadoJurado,
    statsLive,
    socket
  };
}

test("deliberation is restricted to Control and replaces the active spectator view", () => {
  const ctx = crearContexto();

  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "deliberacion" });
  assert.equal(ctx.espectador.resolverModo(), "tutorial");

  ctx.socket.control = true;
  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "deliberacion" });
  assert.equal(ctx.espectador.resolverModo(), "deliberacion");
  assert.deepEqual(ctx.cambiosConParada, [{
    modoAnterior: "tutorial",
    modoSiguiente: "deliberacion"
  }]);
});

test("only Jury can publish its result and only Control can reveal it", () => {
  const ctx = crearContexto({ control: true });
  const payload = {
    disponible: true,
    jugadores: {
      1: { nombre: "Azul", total: 8.4 },
      2: { nombre: "Roja", total: 7.1 }
    }
  };
  let rejected = null;
  ctx.socket.emit("jurado_resultado_actualizar", payload, (response) => { rejected = response; });
  assert.deepEqual(rejected, { ok: false, code: "NOT_AUTHORIZED" });

  ctx.socket.jurado = true;
  let published = null;
  ctx.socket.emit("jurado_resultado_actualizar", payload, (response) => { published = response; });
  assert.equal(published.ok, true);
  assert.equal(ctx.resultadoJurado.payload().ganador, 1);

  ctx.socket.jurado = false;
  let shown = null;
  ctx.socket.emit("mostrar_resultado_jurado", {}, (response) => { shown = response; });
  assert.equal(shown.ok, true);
  assert.equal(ctx.espectador.resolverModo(), "resultado_jurado");
  assert.equal(ctx.resultadoJurado.payload().mostrar, true);
});

test("Control can load and clear a deterministic deliberation fixture without starting a match", () => {
  const ctx = crearContexto({ control: true, disponible: false });
  let loaded = null;
  ctx.socket.emit("cargar_datos_prueba_deliberacion", {}, (response) => { loaded = response; });

  assert.equal(loaded.ok, true);
  assert.equal(loaded.puntuacion.disponible, true);
  assert.equal(loaded.puntuacion.categorias.length, 6);
  assert.equal(loaded.puntuacion.ganador, 2);
  assert.equal(loaded.jurado.disponible, true);
  assert.equal(loaded.jurado.ganador, 1);
  assert.equal(ctx.espectador.resolverModo(), "deliberacion");

  let cleared = null;
  ctx.socket.emit("limpiar_datos_prueba_deliberacion", {}, (response) => { cleared = response; });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.puntuacion.disponible, false);
  assert.equal(cleared.jurado.disponible, false);
});

test("deliberation fixtures require an authenticated Control socket", () => {
  const ctx = crearContexto({ control: false, disponible: false });
  let loaded = null;
  ctx.socket.emit("cargar_datos_prueba_deliberacion", {}, (response) => { loaded = response; });
  assert.deepEqual(loaded, { ok: false, code: "NOT_AUTHORIZED" });
});

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
  assert.equal(ctx.espectador.resolverModo(), "tutorial");
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
  assert.deepEqual(ctx.cambiosConParada, [{
    modoAnterior: "tutorial",
    modoSiguiente: "partida"
  }]);
});

test("changing the authoritative view stops tutorial media once, but reselecting it does not", () => {
  const ctx = crearContexto({ control: true });

  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "tutorial" });
  assert.equal(ctx.cambiosConParada.length, 0);

  ctx.socket.emit("mostrar_creditos_espectador", {});
  assert.deepEqual(ctx.cambiosConParada, [{
    modoAnterior: "tutorial",
    modoSiguiente: "creditos"
  }]);

  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "creditos" });
  assert.equal(ctx.cambiosConParada.length, 1);
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

  for (let index = 0; index < 30; index += 1) {
    ctx.socket.emit("puntuacion_final_siguiente", {});
  }
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 7);

  ctx.socket.emit("puntuacion_final_anterior", {});
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 6);
  assert.equal(ctx.espectador.getPuntuacionRevealPhase(), 2);

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
  assert.equal(ctx.espectador.resolverModo(), "tutorial");

  ctx.espectador.cambiarModo("puntuacion");
  ctx.socket.emit("puntuacion_final_siguiente", {});
  ctx.socket.emit("ocultar_puntuacion_final", {});
  ctx.socket.emit("cambiar_vista_espectador_modo", { modo: "partida" });
  assert.equal(ctx.espectador.resolverModo(), "puntuacion");
  assert.equal(ctx.espectador.getPuntuacionSlideStep(), 0);
});

test("Control reveals every Jury category and explicitly advances to the combined winner", () => {
  const ctx = crearContexto({ control: true });
  ctx.socket.jurado = true;
  ctx.socket.emit("jurado_resultado_actualizar", {
    disponible: true,
    jugadores: {
      1: { nombre: "AZUL", total: 9 },
      2: { nombre: "ROJO", total: 6 }
    },
    criterios: [
      ["writing", "idea", 9, 6], ["writing", "voz", 8, 7],
      ["writing", "estructura", 9, 6], ["writing", "riesgo", 8, 7],
      ["writing", "cierre", 9, 6], ["muses", "inspiracion", 9, 5],
      ["muses", "escucha", 8, 7], ["muses", "ritmo", 9, 6],
      ["muses", "cooperacion", 10, 4]
    ].map(([scope, id, value1, value2]) => ({ scope, id, valores: { 1: value1, 2: value2 } }))
  });
  ctx.socket.jurado = false;

  let shown = null;
  ctx.socket.emit("mostrar_resultado_jurado", {}, (response) => { shown = response; });
  assert.equal(shown.ok, true);
  assert.deepEqual(ctx.resultadoJurado.payload().revelacion.criterios[0].valores, { 1: 0, 2: 0 });
  for (let index = 0; index < 9; index += 1) {
    ctx.socket.emit("jurado_resultado_siguiente", {});
    assert.equal(ctx.espectador.getJuradoSlideStep(), index + 1);
    let blocked = null;
    ctx.socket.emit("jurado_resultado_siguiente", {}, (response) => { blocked = response; });
    assert.equal(blocked.code, "JURY_CRITERION_NOT_CONFIRMED");
    assert.equal(ctx.espectador.getJuradoSlideStep(), index + 1);
    ctx.socket.control = false;
    ctx.socket.jurado = true;
    ctx.socket.emit("jurado_revelacion_actualizar", { jugador: 1, valor: 8 + (index % 2) });
    ctx.socket.emit("jurado_revelacion_actualizar", { jugador: 2, valor: 6 + (index % 3) });
    let confirmed = null;
    ctx.socket.emit("jurado_revelacion_confirmar", {}, (response) => { confirmed = response; });
    assert.equal(confirmed.ok, true);
    ctx.socket.jurado = false;
    ctx.socket.control = true;
  }
  ctx.socket.emit("jurado_resultado_siguiente", {});
  assert.equal(ctx.espectador.getJuradoSlideStep(), 10);

  assert.equal(ctx.espectador.resolverModo(), "resultado_jurado");

  let finalShown = null;
  ctx.socket.emit("mostrar_resultado_final", {}, (response) => { finalShown = response; });
  assert.equal(finalShown.ok, true);
  assert.equal(ctx.espectador.resolverModo(), "resultado_final");
  const finalEvent = ctx.ioEvents.findLast(({ event }) => event === "resultado_final_estado");
  assert.equal(finalEvent.payload.disponible, true);
  assert.ok([1, 2].includes(finalEvent.payload.ganador));
  assert.equal(finalEvent.payload.formula, "50% videojuego + 50% jurado");
});

test("Control cannot show the combined winner before revealing the Jury verdict", () => {
  const ctx = crearContexto({ control: true });
  ctx.socket.jurado = true;
  ctx.socket.emit("jurado_resultado_actualizar", {
    disponible: true,
    jugadores: { 1: { nombre: "AZUL", total: 9 }, 2: { nombre: "ROJO", total: 6 } },
    criterios: [["writing", "idea", 9, 6]].map(([scope, id, value1, value2]) => ({
      scope,
      id,
      valores: { 1: value1, 2: value2 }
    }))
  });
  ctx.socket.jurado = false;
  ctx.socket.emit("mostrar_resultado_jurado", {});

  let response = null;
  ctx.socket.emit("mostrar_resultado_final", {}, (payload) => { response = payload; });
  assert.deepEqual(response, { ok: false, code: "JURY_RESULT_NOT_COMPLETE" });
  assert.equal(ctx.espectador.resolverModo(), "resultado_jurado");
});
