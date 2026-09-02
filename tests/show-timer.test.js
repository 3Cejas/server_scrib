const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorTemporizadorShow,
  normalizarDuracionTemporizador
} = require("../show_timer.js");

test("show timer publishes an authoritative deadline and restores remaining time", () => {
  let now = 1_000_000;
  let scheduled = null;
  const emitted = [];
  const manager = crearGestorTemporizadorShow({
    io: { emit(event, payload) { emitted.push({ event, payload }); } },
    now: () => now,
    schedule(callback, delay) {
      scheduled = { callback, delay };
      return 7;
    },
    cancel() {}
  });

  const start = manager.iniciar(90);
  assert.equal(start.estado, "activo");
  assert.equal(start.duracion, 90);
  assert.equal(start.fin_ts, 1_090_000);
  assert.equal(start.restante, 90);
  assert.equal(scheduled.delay, 90_000);

  now += 32_400;
  const restored = manager.payload();
  assert.equal(restored.restante, 58);
  assert.equal(restored.mostrar, true);
  assert.equal(emitted.at(-1).event, "temporizador_gigante_estado");
});

test("show timer keeps the final card visible until Control hides it", () => {
  let finish = null;
  const emitted = [];
  const manager = crearGestorTemporizadorShow({
    io: { emit(event, payload) { emitted.push({ event, payload }); } },
    schedule(callback) {
      finish = callback;
      return 9;
    },
    cancel() {}
  });

  manager.iniciar(5);
  finish();
  assert.equal(manager.payload().estado, "finalizado");
  assert.equal(manager.payload().mostrar, true);
  assert.ok(emitted.some(({ event }) => event === "temporizador_gigante_final"));

  manager.detener();
  assert.equal(manager.payload().estado, "oculto");
  assert.equal(manager.payload().mostrar, false);
});

test("show timer normalizes unsafe durations", () => {
  assert.equal(normalizarDuracionTemporizador(0), 600);
  assert.equal(normalizarDuracionTemporizador("45"), 45);
  assert.equal(normalizarDuracionTemporizador(99_999), 14_400);
});
