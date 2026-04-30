const test = require("node:test");
const assert = require("node:assert/strict");

const { crearMotorModos, debeLanzarVentaja, elegirLetraPendiente } = require("../mode_engine.js");

test("mode engine decides when advantage voting should launch", () => {
  assert.equal(debeLanzarVentaja("palabras bonus", "letra bendita"), true);
  assert.equal(debeLanzarVentaja("", "letra bendita"), false);
  assert.equal(debeLanzarVentaja("palabras bonus", "tertulia"), false);
});

test("mode engine picks pending letters and resets from base when exhausted", () => {
  const first = elegirLetraPendiente({ pendientes: ["z"], base: ["z", "j"] });
  assert.equal(first.letra, "z");
  assert.deepEqual(first.pendientes, ["z", "j"]);

  const fallback = elegirLetraPendiente({ pendientes: [], base: ["x"] });
  assert.equal(fallback.letra, "x");
  assert.deepEqual(fallback.pendientes, ["x"]);
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
