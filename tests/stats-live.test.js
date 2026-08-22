const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorStatsLive } = require("../stats_live.js");

test("stats manager only marks explicit control telemetry and reset clears its provenance", () => {
  const gestor = crearGestorStatsLive({ getModoActual: () => "letra bendita" });

  gestor.actualizar({
    players: {
      1: { palabrasTotal: 4 },
      2: { palabrasTotal: 3 }
    }
  });
  assert.deepEqual(gestor.payloadDatosRecibidos(), { 1: false, 2: false });

  gestor.actualizarDesdeControl({
    players: {
      1: { palabrasTotal: 8, palabrasUnicas: 5 }
    }
  });
  assert.deepEqual(gestor.payloadDatosRecibidos(), { 1: true, 2: false });
  assert.equal(gestor.payload().players[1].palabrasUnicas, 5);

  gestor.reset();
  assert.deepEqual(gestor.payloadDatosRecibidos(), { 1: false, 2: false });
  assert.equal(gestor.payload().players[1].palabrasTotal, 0);
});
