const test = require("node:test");
const assert = require("node:assert/strict");

const { crearMotorModos, elegirLetraPendiente } = require("../mode_engine.js");

test("mode engine picks pending letters and resets from base when exhausted", () => {
  const first = elegirLetraPendiente({ pendientes: ["z"], base: ["z", "j"] });
  assert.equal(first.letra, "z");
  assert.deepEqual(first.pendientes, ["z", "j"]);

  const fallback = elegirLetraPendiente({ pendientes: [], base: ["x"] });
  assert.equal(fallback.letra, "x");
  assert.deepEqual(fallback.pendientes, ["x"]);
});

test("mode engine weights forbidden and blessed letter draws in opposite directions", () => {
  const commonForbidden = elegirLetraPendiente({
    pendientes: ["e", "w"],
    base: ["e", "w"],
    tipo: "prohibida",
    random: () => 0.5
  });
  const rareBlessed = elegirLetraPendiente({
    pendientes: ["e", "w"],
    base: ["e", "w"],
    tipo: "bendita",
    random: () => 0.5
  });

  assert.equal(commonForbidden.letra, "e");
  assert.equal(rareBlessed.letra, "w");
});

test("mode engine activates bonus mode and rejects removed chaos mode", () => {
  const eventos = [];
  const bonus = crearModoFake();
  const motor = crearMotorModos({
    state: crearEstadoMotorFake({ modoActual: "palabras bonus" }),
    io: { emit: (event, payload) => eventos.push({ event, payload }) },
    timersPartida: crearTimersFake(),
    partidaSync: crearPartidaSyncFake(),
    limpiarTodosLosModos: () => {},
    emitirActivarModo: (payload) => eventos.push({ event: "modo_actual", payload }),
    emitirPedirInspiracionMusa: (payload) => eventos.push({ event: "pedir_inspiracion_musa", payload }),
    statsLive: { actualizar: () => {} },
    votacionVentaja: { lanzar: () => {} },
    getModoBonus: () => bonus,
    getModoMalditas: () => crearModoFake(),
    getModoMusas: () => crearModoFake(),
    estadoJugadores: { 1: { finished: false }, 2: { finished: false } },
    letrasBenditas: ["z"],
    letrasProhibidas: ["e"]
  });

  assert.equal(motor.tieneModo("loc" + "ura"), false);
  assert.equal(motor.activarModo("palabras bonus"), true);
  assert.deepEqual(bonus.startPlayers, [1, 2]);
  assert.deepEqual(eventos.map((evt) => evt.event), ["modo_actual", "pedir_inspiracion_musa"]);
});

test("mode engine changes blessed letters through the timer path", () => {
  const letras = [];
  const timers = crearTimersFake();
  const musas = crearModoFake();
  const state = crearEstadoMotorFake({
    modoActual: "letra bendita",
    letrasBenditasPendientes: ["z"]
  });
  const motor = crearMotorModos({
    state,
    io: { emit: () => {} },
    timersPartida: timers,
    partidaSync: crearPartidaSyncFake(),
    limpiarTodosLosModos: () => {},
    emitirActivarModo: () => {},
    emitirPedirInspiracionMusa: () => {},
    emitirNuevaLetra: (tipo, letra) => letras.push({ tipo, letra }),
    statsLive: { actualizar: () => {} },
    votacionVentaja: { lanzar: () => {} },
    getModoBonus: () => crearModoFake(),
    getModoMalditas: () => crearModoFake(),
    getModoMusas: () => musas,
    estadoJugadores: { 1: { finished: false }, 2: { finished: false } },
    letrasBenditas: ["z", "j"],
    letrasProhibidas: ["e"]
  });

  motor.nueva_letra_bendita();

  assert.equal(state.letraBendita, "z");
  assert.deepEqual(letras, [{ tipo: "bendita", letra: "z" }]);
  assert.deepEqual(musas.startPlayers, [1, 2]);
  assert.equal(timers.cambiosLetra.length, 1);
});

test("mode engine can advance from tertulia without launching a stale advantage", () => {
  const bonus = crearModoFake();
  const musas = crearModoFake();
  const state = crearEstadoMotorFake({
    modoActual: "tertulia",
    modosPendientes: ["palabras bonus"],
    indiceModo: 0
  });
  const launches = [];
  const motor = crearMotorModos({
    state,
    io: { emit: () => {} },
    timersPartida: crearTimersFake(),
    partidaSync: crearPartidaSyncFake(),
    limpiarTodosLosModos: () => {},
    emitirActivarModo: () => {},
    emitirPedirInspiracionMusa: () => {},
    emitirNubeInspiracionEstado: () => {},
    statsLive: { actualizar: () => {} },
    payloadStatsLive: () => ({}),
    emitirStatsLive: () => {},
    votacionVentaja: { lanzar: (payload) => launches.push(payload) },
    getModoBonus: () => bonus,
    getModoMalditas: () => crearModoFake(),
    getModoMusas: () => musas,
    estadoJugadores: { 1: { finished: true }, 2: { finished: true } },
    letrasBenditas: ["z"],
    letrasProhibidas: ["e"]
  });

  motor.modos_de_juego();

  assert.equal(state.modoActual, "palabras bonus");
  assert.equal(state.indiceModo, 1);
  assert.deepEqual(bonus.startPlayers, [1, 2]);
  assert.equal(launches.length, 0);
});

test("mode engine consumes every pending level in order without skipping letra maldita", () => {
  const state = crearEstadoMotorFake({
    modoActual: "letra bendita",
    modosPendientes: ["letra prohibida", "tertulia", "palabras bonus"],
    indiceModo: 0
  });
  const activados = [];
  const motor = crearMotorModos({
    state,
    io: { emit: () => {} },
    timersPartida: crearTimersFake(),
    partidaSync: crearPartidaSyncFake(),
    limpiarTodosLosModos: () => {},
    emitirActivarModo: (payload) => activados.push(payload.modo_actual),
    emitirPedirInspiracionMusa: () => {},
    emitirNubeInspiracionEstado: () => {},
    statsLive: { actualizar: () => {} },
    payloadStatsLive: () => ({}),
    emitirStatsLive: () => {},
    getModoBonus: () => crearModoFake(),
    getModoMalditas: () => crearModoFake(),
    getModoMusas: () => crearModoFake(),
    estadoJugadores: { 1: { finished: false }, 2: { finished: false } },
    letrasBenditas: ["z"],
    letrasProhibidas: ["e"]
  });

  motor.modos_de_juego();
  assert.equal(state.modoActual, "letra prohibida");
  assert.deepEqual(state.modosPendientes, ["tertulia", "palabras bonus"]);

  motor.modos_de_juego();
  assert.equal(state.modoActual, "tertulia");
  assert.deepEqual(state.modosPendientes, ["palabras bonus"]);
  assert.deepEqual(activados, ["letra prohibida", "tertulia"]);
});

test("mode engine never carries an advantage vote across tertulia", () => {
  const bonus = crearModoFake();
  const musas = crearModoFake();
  const state = crearEstadoMotorFake({
    modoActual: "palabras bonus",
    modosPendientes: ["tertulia", "letra bendita"],
    indiceModo: 0
  });
  bonus.insertedCount = { 1: 3, 2: 1 };
  musas.insertedCount = { 1: 0, 2: 8 };
  const launches = [];
  const motor = crearMotorModos({
    state,
    io: { emit: () => {} },
    timersPartida: crearTimersFake(),
    partidaSync: crearPartidaSyncFake(),
    limpiarTodosLosModos: () => {},
    emitirActivarModo: () => {},
    emitirPedirInspiracionMusa: () => {},
    emitirNubeInspiracionEstado: () => {},
    statsLive: { actualizar: () => {} },
    payloadStatsLive: () => ({}),
    emitirStatsLive: () => {},
    votacionVentaja: { lanzar: (payload) => launches.push(payload) },
    getModoBonus: () => bonus,
    getModoMalditas: () => crearModoFake(),
    getModoMusas: () => musas,
    estadoJugadores: { 1: { finished: false }, 2: { finished: false } },
    letrasBenditas: ["z"],
    letrasProhibidas: ["e"]
  });

  motor.modos_de_juego();

  assert.equal(state.modoActual, "tertulia");
  assert.equal(state.modoPendienteVentaja, "");
  assert.equal(launches.length, 0);

  motor.modos_de_juego();

  assert.equal(state.modoActual, "letra bendita");
  assert.equal(state.modoPendienteVentaja, "");
  assert.equal(launches.length, 0);
  assert.equal(bonus.clearCounterCalls, 0);
  assert.equal(musas.clearCounterCalls, 0);
});

function crearModoFake() {
  return {
    clearAllCalls: 0,
    clearCounterCalls: 0,
    insertedCount: { 1: 1, 2: 0 },
    startPlayers: [],
    clearAll() { this.clearAllCalls += 1; },
    start(player) { this.startPlayers.push(player); },
    getInsertedCount(player) { return this.insertedCount[player] || 0; },
    clearCounters() { this.clearCounterCalls += 1; }
  };
}

function crearTimersFake() {
  return {
    cambiosLetra: [],
    intervalos: [],
    programarCambioLetra(modo, callback, ms) {
      this.cambiosLetra.push({ modo, callback, ms });
    },
    programarIntervaloModos(callback, ms) {
      this.intervalos.push({ callback, ms });
    }
  };
}

function crearPartidaSyncFake() {
  return {
    seq: 0,
    siguienteModoSeq() { this.seq += 1; }
  };
}

function crearEstadoMotorFake(overrides = {}) {
  return {
    segundosTranscurridos: 0,
    modoActual: "",
    modoAnterior: "",
    modoPendienteVentaja: "",
    indiceModo: 0,
    modosPendientes: [],
    letraProhibida: "",
    letraBendita: "",
    letrasProhibidasPendientes: ["e"],
    letrasBenditasPendientes: ["z"],
    tiempoCambioModos: 10,
    tiempoCambioLetra: 5,
    tiempoBorroso: 3,
    repentizadoEnviado: false,
    ...overrides
  };
}
