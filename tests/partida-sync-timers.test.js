const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorSincronizacionPartida } = require("../partida_sync.js");
const { crearGestorTimersPartida } = require("../partida_timers.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("partida sync tracks mode and per-player time sequences independently", () => {
  const sync = crearGestorSincronizacionPartida();

  assert.equal(sync.obtenerModoSeq(), 0);
  assert.equal(sync.siguienteModoSeq(), 1);
  assert.deepEqual(sync.withModoSeq({ modo_actual: "letra bendita" }), {
    modo_actual: "letra bendita",
    modo_seq: 1
  });

  assert.equal(sync.siguienteTiempoSeq(1), 1);
  assert.equal(sync.siguienteTiempoSeq(1), 2);
  assert.equal(sync.siguienteTiempoSeq(2), 1);
  assert.equal(sync.obtenerTiempoSeq(1), 2);
  assert.equal(sync.obtenerTiempoSeq(2), 1);

  sync.resetTiempoSeq();
  assert.equal(sync.obtenerTiempoSeq(1), 0);
  assert.equal(sync.obtenerTiempoSeq(2), 0);
});

test("partida sync stores count state and builds compatible count payloads", () => {
  const sync = crearGestorSincronizacionPartida();
  sync.siguienteModoSeq();
  sync.siguienteTiempoSeq(1);

  sync.guardarConteo(1, {
    modo_seq: sync.obtenerModoSeq(),
    count_seq: 3,
    tiempo_seq: sync.obtenerTiempoSeq(1),
    count_seconds: 75,
    count_text: "01:15"
  });

  assert.deepEqual(sync.obtenerConteo(1), {
    modo_seq: 1,
    count_seq: 3,
    tiempo_seq: 1,
    count_seconds: 75,
    count_text: "01:15"
  });
  assert.equal(sync.convertirTextoCountASegundos("01:15"), 75);
  assert.equal(sync.formatearTextoCountDesdeSegundos(75), "01:15");
  assert.equal(sync.formatearTextoCountDesdeSegundos(0), "\u00a1Tiempo!");
  assert.deepEqual(sync.construirPayloadCount({ player: 1, count: "01:15" }), {
    player: 1,
    count: "01:15",
    modo_seq: 1,
    tiempo_seq: 1
  });
});

test("partida timers cancel stale scheduled work and check expected mode", async () => {
  let modoActual = "letra bendita";
  const timers = crearGestorTimersPartida({ getModoActual: () => modoActual });
  const ejecutados = [];

  timers.programarCambioLetra("letra bendita", () => ejecutados.push("stale"), 5);
  timers.programarCambioLetra("letra prohibida", () => ejecutados.push("wrong-mode"), 5);
  await sleep(15);
  assert.deepEqual(ejecutados, []);

  modoActual = "letra prohibida";
  timers.programarCambioLetra("letra prohibida", () => ejecutados.push("ok"), 5);
  await sleep(15);
  assert.deepEqual(ejecutados, ["ok"]);

  timers.cancelarCambioLetra();
});

test("partida timers cancel round timers in bulk", async () => {
  const timers = crearGestorTimersPartida();
  const ejecutados = [];

  timers.programarInicio(() => ejecutados.push("inicio"), 5);
  timers.programarVotacion(() => ejecutados.push("votacion"), 5);
  timers.programarIntervaloModos(() => ejecutados.push("intervalo"), 5);
  timers.cancelarRonda();

  await sleep(15);
  assert.deepEqual(ejecutados, []);
});
