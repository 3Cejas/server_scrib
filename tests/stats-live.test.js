const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorStatsLive } = require("../stats_live.js");

test("muses receive live stats only in the shared stats view and at most once per second", () => {
  const realNow = Date.now;
  let now = 10000;
  let view = "partida";
  Date.now = () => now;
  const socket = flags => ({ ...flags, received: [], emit(event, data) { this.received.push({ event, data }); } });
  const muse1 = socket({ musa: { player: 1 } });
  const muse2 = socket({ musa: { player: 2 } });
  const spectator = socket({ espectador: true });
  const writer = socket({ escritxr: 1 });
  const io = { sockets: { sockets: new Map([[1, muse1], [2, muse2], [3, spectator], [4, writer]]) } };
  try {
    const gestor = crearGestorStatsLive({ io, getModoVista: () => view });
    gestor.actualizar({ players: { 1: { palabrasBenditas: ["LUZ", "SOL", "MAR"], valorInspiracion: 3, tiempoTotalMs: 5000 } } });
    gestor.emitir();
    assert.equal(muse1.received.length, 0);
    assert.equal(spectator.received.length, 1);
    view = "stats";
    gestor.emitir();
    assert.equal(muse1.received.length, 1);
    assert.equal(muse2.received.length, 1);
    assert.equal(writer.received.length, 0);
    assert.deepEqual(muse1.received[0].data.historial_inspiracion[1], [{ t: 0, valor: 0 }, { t: 5000, valor: 3 }]);
    assert.equal(spectator.received[1].data.historial_inspiracion, undefined);
    now += 250;
    gestor.emitir();
    assert.equal(muse1.received.length, 1);
    now += 750;
    gestor.emitir();
    assert.equal(muse1.received.length, 2);
    view = "partida";
    now += 1000;
    gestor.emitir();
    assert.equal(muse1.received.length, 2);
    // A newly connected muse can explicitly fetch its current snapshot.
    gestor.emitir(muse2);
    assert.equal(muse2.received.length, 3);
    muse2.received[2].data.historial_inspiracion[1][0].valor = 999;
    gestor.reset();
    gestor.emitir(muse1);
    assert.deepEqual(muse1.received.at(-1).data.historial_inspiracion[1], [{ t: 0, valor: 0 }]);
  } finally { Date.now = realNow; }
});

test("muse inspiration history stays bounded over long performances", () => {
  const gestor = crearGestorStatsLive();
  for (let i = 1; i <= 500; i++) {
    gestor.actualizar({ players: { 1: { palabrasBenditas: ["LUZ"], valorInspiracion: i % 2, tiempoTotalMs: i * 1000 } } });
    gestor.emitir();
  }
  let snapshot;
  gestor.emitir({ musa: true, emit(event, data) { snapshot = data; } });
  assert.equal(snapshot.historial_inspiracion[1].length, 360);
  assert.deepEqual(snapshot.historial_inspiracion[1][0], { t: 0, valor: 0 });
  assert.deepEqual(snapshot.historial_inspiracion[1].at(-1), { t: 500000, valor: 0 });
});

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

test("match cleanup preserves names without carrying over stats or telemetry provenance", () => {
  const gestor = crearGestorStatsLive();
  gestor.actualizarDesdeControl({
    players: {
      1: { nombre: "ÁNGELA", palabrasTotal: 40, palabrasUnicas: 30, ritmoPpm: 60 },
      2: { nombre: "PABLO", palabrasTotal: 20, palabrasUnicas: 12, ritmoPpm: 45 }
    }
  });

  const estado = gestor.reset({ conservarNombres: true });
  assert.equal(estado.players[1].nombre, "ÁNGELA");
  assert.equal(estado.players[2].nombre, "PABLO");
  for (const player of Object.values(estado.players)) {
    assert.equal(player.palabrasTotal, 0);
    assert.equal(player.palabrasUnicas, 0);
    assert.equal(player.ritmoPpm, 0);
  }
  assert.deepEqual(gestor.payloadDatosRecibidos(), { 1: false, 2: false });
  const completo = gestor.reset();
  assert.equal(completo.players[1].nombre, "ESCRITXR 1");
  assert.equal(completo.players[2].nombre, "ESCRITXR 2");
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
