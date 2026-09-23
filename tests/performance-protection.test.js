const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorProteccionRendimiento,
  crearMaquinaProteccion,
  resolverRolSocket
} = require("../performance_protection.js");

test("server protection escalates only after sustained pressure and recovers step by step", () => {
  const machine = crearMaquinaProteccion({
    warningSustainMs: 10,
    dangerSustainMs: 10,
    emergencySustainMs: 5,
    minimumLevelMs: 10,
    recoverySustainMs: 10
  });

  assert.equal(machine.evaluar({ warning: true }, 100).level, 0);
  assert.equal(machine.evaluar({ warning: true }, 111).level, 1);
  assert.equal(machine.evaluar({}, 112).level, 1);
  assert.equal(machine.evaluar({}, 123).level, 0);

  assert.equal(machine.evaluar({ danger: true }, 200).level, 0);
  assert.equal(machine.evaluar({ danger: true }, 211).level, 2);
  assert.equal(machine.evaluar({}, 212).level, 2);
  assert.equal(machine.evaluar({}, 223).level, 1);
  assert.equal(machine.evaluar({}, 224).level, 1);
  assert.equal(machine.evaluar({}, 235).level, 0);
});

test("reports are attributed to the authenticated socket role, not the claimed role", () => {
  assert.deepEqual(
    resolverRolSocket({ actor: 2 }, { role: "control", player: 1 }),
    { role: "actor", player: 2 }
  );
});

test("manager aggregates browser protection by role and activates emergency server protection", () => {
  let now = 1000;
  const emitted = [];
  const handlers = new Map();
  const socket = {
    id: "actor-2",
    actor: 2,
    on(event, handler) { handlers.set(event, handler); }
  };
  const manager = crearGestorProteccionRendimiento({
    io: { emit: (event, payload) => emitted.push({ event, payload }) },
    now: () => now,
    memoryUsage: () => ({ rss: 700 * 1024 * 1024 }),
    opciones: {
      sampleMs: 1000,
      emergencySustainMs: 3000,
      dangerSustainMs: 15000
    }
  });

  manager.registrarHandlers(socket);
  handlers.get("performance_protection_report")({
    role: "control",
    level: 1,
    reasons: ["low_fps"],
    metrics: { fps: 17, rtt_p95_ms: 80 }
  });
  let snapshot = manager.payload();
  assert.equal(snapshot.roles.actors[2].level, 1);
  assert.equal(snapshot.roles.control.samples, 0);

  manager.muestrear();
  now = 4001;
  snapshot = manager.muestrear();
  assert.equal(snapshot.level, 2);
  assert.equal(emitted.at(-1).event, "performance_protection_global");
});
