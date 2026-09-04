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

test("jury result preserves the nine category scores and calculates each winner", () => {
  const result = normalizeJuryResult({
    disponible: true,
    jugadores: {
      1: { nombre: "Azul", total: 8 },
      2: { nombre: "Roja", total: 7 }
    },
    criterios: [
      { id: "idea", scope: "writing", valores: { 1: 11, 2: 8 } },
      { id: "voz", scope: "writing", valores: { 1: 5, 2: 5 } },
      { id: "cooperacion", scope: "muses", valores: { 1: 6.2, 2: 8.4 } }
    ]
  }, 4567);

  assert.equal(result.criterios.length, 9);
  assert.deepEqual(result.criterios[0].valores, { 1: 10, 2: 8 });
  assert.equal(result.criterios[0].ganador, 1);
  assert.equal(result.criterios[1].empate, true);
  assert.equal(result.criterios[8].ganador, 2);
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

test("a deliberation test fixture ignores stale Jury updates until reset", () => {
  const manager = createJuryResultManager({ now: () => 101 });
  manager.loadTestFixture({
    disponible: true,
    jugadores: {
      1: { nombre: "A", total: 8.7 },
      2: { nombre: "B", total: 7.9 }
    }
  });

  const stale = manager.update({
    disponible: false,
    jugadores: {
      1: { nombre: "A", total: 0 },
      2: { nombre: "B", total: 0 }
    }
  });
  assert.equal(stale.disponible, true);
  assert.equal(stale.ganador, 1);
  assert.equal(stale.jugadores[1].total, 8.7);

  manager.reset();
  const real = manager.update({
    disponible: true,
    jugadores: {
      1: { nombre: "A", total: 6 },
      2: { nombre: "B", total: 9 }
    }
  });
  assert.equal(real.ganador, 2);
  assert.equal(real.jugadores[2].total, 9);
});

test("live Jury reveal starts at zero, keeps reference scores and locks each confirmed criterion", () => {
  let tick = 200;
  const manager = createJuryResultManager({ now: () => ++tick });
  manager.loadTestFixture({
    disponible: true,
    jugadores: { 1: { nombre: "Azul", total: 8 }, 2: { nombre: "Rojo", total: 7 } },
    criterios: [
      { id: "idea", scope: "writing", valores: { 1: 8.5, 2: 6.5 } }
    ]
  });

  manager.startReveal();
  manager.setRevealStep(1);
  let reveal = manager.payload().revelacion.criterios[0];
  assert.deepEqual(reveal.referencias, { 1: 8.5, 2: 6.5 });
  assert.deepEqual(reveal.valores, { 1: 0, 2: 0 });
  assert.equal(reveal.confirmado, false);
  assert.equal(manager.isCurrentRevealConfirmed(), false);

  assert.equal(manager.updateReveal({ jugador: 1, valor: 9.2 }).ok, true);
  assert.equal(manager.updateReveal({ jugador: 2, valor: 7.4 }).ok, true);
  assert.equal(manager.confirmReveal().ok, true);
  reveal = manager.payload().revelacion.criterios[0];
  assert.equal(reveal.confirmado, true);
  assert.equal(reveal.ganador, 1);
  assert.deepEqual(reveal.valores, { 1: 9.2, 2: 7.4 });
  assert.equal(manager.updateReveal({ jugador: 1, valor: 1 }).code, "JURY_REVEAL_ALREADY_CONFIRMED");
  assert.equal(manager.payload().criterios[0].valores[1], 9.2);
});
