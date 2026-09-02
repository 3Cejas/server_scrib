const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createJuryResultManager,
  normalizeJuryResult
} = require("../jury_result");

test("jury result clamps totals, preserves names and chooses a winner", () => {
  const result = normalizeJuryResult({
    disponible: true,
    jugadores: {
      1: { nombre: "  Escritora Azul  ", total: 12.37 },
      2: { nombre: "Escritora Roja", total: 8.24 }
    }
  }, 1234);

  assert.equal(result.disponible, true);
  assert.equal(result.jugadores[1].nombre, "Escritora Azul");
  assert.equal(result.jugadores[1].total, 10);
  assert.equal(result.jugadores[2].total, 8.2);
  assert.equal(result.ganador, 1);
  assert.equal(result.empate, false);
  assert.equal(result.actualizado_en_ts, 1234);
});

test("jury result manager emits an authoritative visible payload and resets it", () => {
  const io = new EventEmitter();
  const received = [];
  io.on("jurado_resultado_estado", (payload) => received.push(payload));
  const manager = createJuryResultManager({ io, isVisible: () => true, now: () => 99 });

  manager.update({
    disponible: true,
    jugadores: {
      1: { nombre: "A", total: 7 },
      2: { nombre: "B", total: 7 }
    }
  });
  const emitted = manager.emit();
  assert.equal(emitted.mostrar, true);
  assert.equal(emitted.empate, true);
  assert.equal(emitted.ganador, null);
  assert.equal(received.length, 1);

  const reset = manager.reset();
  assert.equal(reset.disponible, false);
  assert.equal(reset.jugadores[1].total, 0);
});
