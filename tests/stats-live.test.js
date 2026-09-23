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

test("server text telemetry preserves inspiration scoring semantics and clears removed marks", () => {
  const gestor = crearGestorStatsLive({ getModoActual: () => "palabras bonus" });

  gestor.registrarTexto(1, {
    plano: "Luz azul y luz",
    html: [
      '<span class="palabra-bendita" data-inspiration-value="0.35">Luz azul</span>',
      ' y ',
      '<span data-inspiration-value="0,8" class="palabra-musa">luz</span>'
    ].join("")
  });

  assert.deepEqual(gestor.payload().players[1].palabrasBenditas, ["AZUL", "LUZ"]);
  assert.equal(gestor.payload().players[1].valorInspiracion, 1.15);

  gestor.registrarTexto(1, { plano: "Luz azul y luz", html: "Luz azul y luz" });
  assert.deepEqual(gestor.payload().players[1].palabrasBenditas, []);
  assert.equal(gestor.payload().players[1].valorInspiracion, 0);
});

test("server typing rate keeps advancing instead of freezing at the first keystroke", () => {
  const realNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const gestor = crearGestorStatsLive({ getModoActual: () => "partida" });
    gestor.registrarPulsacion(1, { code: "KeyA" });
    now += 60_000;
    gestor.registrarPulsacion(1, { code: "KeyB" });

    const jugador = gestor.payload().players[1];
    assert.equal(jugador.tiempoEscrituraMs, 60_000);
    assert.equal(jugador.ritmoPpm, 2);
  } finally {
    Date.now = realNow;
  }
});

test("server rule events cannot be overwritten by stale Control summaries", () => {
  const gestor = crearGestorStatsLive({ getModoActual: () => "letra prohibida" });
  gestor.registrarLetra("bendita", "r");
  gestor.registrarLetra("prohibida", "ñ");
  gestor.registrarInfraccion(1, { tipo: "letra", valor: "Ñ" });
  gestor.registrarInfraccion(1, { tipo: "palabra", valor: "Nunca" });

  gestor.actualizarDesdeControl({
    players: {
      1: {
        letrasBenditas: ["X"],
        letrasMalditas: ["Y"],
        palabrasMalditas: ["FALSA"],
        intentosLetraProhibida: 99,
        intentosPalabraProhibida: 99,
        vida: { actual: 12 }
      }
    }
  });

  const player = gestor.payload().players[1];
  assert.deepEqual(player.letrasBenditas, ["R"]);
  assert.deepEqual(player.letrasMalditas, ["Ñ"]);
  assert.deepEqual(player.palabrasMalditas, ["NUNCA"]);
  assert.equal(player.intentosLetraProhibida, 1);
  assert.equal(player.intentosPalabraProhibida, 1);
  assert.equal(player.vida.actual, 12);
});
