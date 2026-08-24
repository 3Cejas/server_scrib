const test = require("node:test");
const assert = require("node:assert/strict");

const PalabrasBonusMode = require("../palabras_bonus.js");

function createFakeIo() {
  const events = [];
  return {
    events,
    emit(event, payload) {
      events.push({ event, payload });
    },
    to() {
      return {
        emit() {}
      };
    }
  };
}

function cleanupMode(mode) {
  mode.clearAll();
  for (const player of [1, 2]) {
    clearTimeout(mode.players[player].emitTimer);
    clearTimeout(mode.players[player].pendingTimer);
    mode.players[player].emitTimer = null;
    mode.players[player].pendingTimer = null;
  }
}

function withoutProtocolMetadata(payload = {}) {
  const {
    inspiracion_id,
    descartable,
    descartes_consecutivos,
    factor_inspiracion,
    valor_inspiracion,
    caduca_en_ts,
    tiempo_base_inspiracion,
    ...rest
  } = payload;
  return rest;
}

function assertProtocolMetadata(payload, { id, factor = 1 } = {}) {
  assert.equal(payload.inspiracion_id, id);
  assert.equal(payload.descartable, true);
  assert.equal(payload.descartes_consecutivos, 0);
  assert.equal(payload.factor_inspiracion, factor);
  assert.equal(payload.valor_inspiracion, factor);
  assert.ok(payload.caduca_en_ts > Date.now());
  assert.ok(payload.tiempo_base_inspiracion > 0);
}

function withoutDeliveryProtocolMetadata(entrega = {}) {
  const {
    inspiracion_id,
    descartes_consecutivos,
    factor_inspiracion,
    valor_inspiracion,
    ...rest
  } = entrega;
  return rest;
}

test("PalabrasBonus delivers queued musa words correctly for both writers", async () => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });
  mode.addMusa(2, { palabra: "faro", musa: "Sol" });

  await mode.handleRequest(1);
  await mode.handleRequest(2);

  assert.equal(mode.getInsertedCount(1), 1);
  assert.equal(mode.getInsertedCount(2), 1);
  assert.equal(mode.getlastDeliveredFromMusa(1), true);
  assert.equal(mode.getlastDeliveredFromMusa(2), true);
  assert.equal(io.events.length, 2);
  assert.deepEqual({ ...io.events[0], payload: withoutProtocolMetadata(io.events[0].payload) }, {
    event: "enviar_palabra_j1",
    payload: {
      modo_actual: "palabras bonus",
      palabras_var: "aurora",
      palabra_bonus: [
        ["aurora"],
        "<span style=\"color:lime;\">Luna</span><span style=\"color: white;\">: </span><span style='color: white;'>Podrías escribir esta palabra ⬆️</span>"
      ],
      tiempo_palabras_bonus: mode._puntuacionPalabra("aurora"),
      origen_musa: "musa",
      musa_nombre: "Luna"
    }
  });
  assertProtocolMetadata(io.events[0].payload, { id: 1 });
  assert.equal(io.events[1].event, "enviar_palabra_j2");
  assert.equal(io.events[1].payload.palabras_var, "faro");
  assert.equal(io.events[1].payload.origen_musa, "musa");
  assert.equal(io.events[1].payload.musa_nombre, "Sol");
  const entrega = mode.consumirEntregaMusaIntroducida(1);
  assert.deepEqual(withoutDeliveryProtocolMetadata(entrega), {
    player: 1,
    target_player: 1,
    modo: "palabras bonus",
    palabra: "aurora",
    musa_nombre: "Luna",
    client_id: "",
    client_ids: [],
    musas: ["Luna"],
    tiempo: mode._puntuacionPalabra("aurora"),
    superbonus: false,
    repeticiones: 1
  });
  assert.equal(entrega.inspiracion_id, 1);
  assert.equal(entrega.valor_inspiracion, 1);

  cleanupMode(mode);
});

test("PalabrasBonus prioritizes repeated ally words as superbonus", async () => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};

  mode.addMusa(1, { palabra: "bruma", musa: "Musa Solo", client_id: "solo" });
  mode.addMusa(1, { palabra: "cometa", musa: "Musa Uno", client_id: "uno" });
  mode.addMusa(1, { palabra: "COMETA", musa: "Musa Dos", client_id: "dos" });

  await mode.handleRequest(1);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].payload.palabras_var, "cometa");
  assert.equal(io.events[0].payload.origen_musa, "musa");
  assert.equal(io.events[0].payload.musa_nombre, "Musa Uno + Musa Dos");
  assert.deepEqual(io.events[0].payload.superbonus, {
    activo: true,
    repeticiones: 2,
    musas: ["Musa Uno", "Musa Dos"],
    tiempo_base: mode._puntuacionPalabra("cometa"),
    multiplicador_tiempo: 1.5
  });
  assert.equal(
    io.events[0].payload.tiempo_palabras_bonus,
    mode._aplicarTiempoSuperbonus(mode._puntuacionPalabra("cometa"), 2)
  );
  const entrega = mode.consumirEntregaMusaIntroducida(1);
  assert.deepEqual(withoutDeliveryProtocolMetadata(entrega), {
    player: 1,
    target_player: 1,
    modo: "palabras bonus",
    palabra: "cometa",
    musa_nombre: "Musa Uno + Musa Dos",
    client_id: "uno",
    client_ids: ["uno", "dos"],
    musas: ["Musa Uno", "Musa Dos"],
    tiempo: mode._aplicarTiempoSuperbonus(mode._puntuacionPalabra("cometa"), 2),
    superbonus: true,
    repeticiones: 2
  });
  assert.equal(entrega.valor_inspiracion, 1);
  assert.deepEqual(mode.players[1].queue, [{ palabra: "bruma", musa: "Musa Solo", client_id: "solo" }]);

  cleanupMode(mode);
});

test("PalabrasBonus does not create superbonus from one muse repeating a word", async () => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};

  mode.addMusa(1, { palabra: "cometa", musa: "Musa Uno", client_id: "misma" });
  mode.addMusa(1, { palabra: "COMETA", musa: "Musa Uno", client_id: "misma" });

  await mode.handleRequest(1);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].payload.palabras_var.toLowerCase(), "cometa");
  assert.equal(io.events[0].payload.origen_musa, "musa");
  assert.equal(Object.prototype.hasOwnProperty.call(io.events[0].payload, "superbonus"), false);
  assert.equal(io.events[0].payload.tiempo_palabras_bonus, mode._puntuacionPalabra("cometa"));
  assert.equal(mode.players[1].queue.length, 1);

  cleanupMode(mode);
});

test("PalabrasBonus gives higher priority to the most repeated superbonus", async () => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};

  mode.addMusa(1, { palabra: "luz", musa: "A" });
  mode.addMusa(1, { palabra: "luz", musa: "B" });
  mode.addMusa(1, { palabra: "nube", musa: "C" });
  mode.addMusa(1, { palabra: "nube", musa: "D" });
  mode.addMusa(1, { palabra: "nube", musa: "E" });

  await mode.handleRequest(1);

  assert.equal(io.events[0].payload.palabras_var, "nube");
  assert.equal(io.events[0].payload.superbonus.repeticiones, 3);
  assert.deepEqual(
    mode.players[1].queue,
    [
      { palabra: "luz", musa: "A" },
      { palabra: "luz", musa: "B" }
    ]
  );

  cleanupMode(mode);
});

test("PalabrasBonus falls back to RAE when the queue is empty", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", async () => ["historia", "Narracion de hechos."]);

  await mode.handleRequest(1);

  assert.equal(mode.getInsertedCount(1), 0);
  assert.equal(mode.getlastDeliveredFromMusa(1), false);
  assert.deepEqual(io.events.map((entry) => ({
    ...entry,
    payload: withoutProtocolMetadata(entry.payload)
  })), [
    {
      event: "enviar_palabra_j1",
      payload: {
        modo_actual: "palabras bonus",
        palabras_var: "historia",
        palabra_bonus: [["historia"], "Narracion de hechos."],
        tiempo_palabras_bonus: mode._puntuacionPalabra("historia")
      }
    }
  ]);
  assertProtocolMetadata(io.events[0].payload, { id: 1 });

  cleanupMode(mode);
});

test("PalabrasBonus replaces an automatic RAE word as soon as a muse word arrives", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", async () => ["historia", "Narracion de hechos."]);

  await mode.handleRequest(1);
  let status = mode.obtenerEstadoPalabrasMusasControl();

  assert.equal(status.players[1].activa, false);
  assert.equal(status.players[1].cola, 0);
  assert.equal(status.players[1].tiempo_restante_ms, 0);

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });
  assert.equal(mode.getInsertedCount(1), 1);
  assert.equal(io.events.length, 2);
  assert.equal(io.events[1].event, "enviar_palabra_j1");
  assert.equal(io.events[1].payload.palabras_var, "aurora");
  assert.equal(io.events[1].payload.origen_musa, "musa");
  assert.equal(io.events[1].payload.musa_nombre, "Luna");

  status = mode.obtenerEstadoPalabrasMusasControl();
  assert.equal(status.players[1].activa, true);
  assert.equal(status.players[1].palabra, "aurora");
  assert.equal(status.players[1].musa_nombre, "Luna");
  assert.equal(status.players[1].cola, 0);
  assert.ok(status.players[1].tiempo_restante_ms > 0);

  cleanupMode(mode);
});

test("PalabrasBonus uses the local fallback when RAE is unavailable", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", async () => {
    throw new Error("rae offline");
  });
  t.mock.method(mode, "_palabraFallbackLocal", () => ({
    palabra: "refugio",
    definicion: "Lugar que protege."
  }));

  await mode.handleRequest(2);

  assert.equal(mode.getInsertedCount(2), 0);
  assert.equal(mode.getlastDeliveredFromMusa(2), false);
  assert.deepEqual(io.events.map((entry) => ({
    ...entry,
    payload: withoutProtocolMetadata(entry.payload)
  })), [
    {
      event: "enviar_palabra_j2",
      payload: {
        modo_actual: "palabras bonus",
        palabras_var: "refugio",
        palabra_bonus: [["refugio"], "Lugar que protege."],
        tiempo_palabras_bonus: mode._puntuacionPalabra("refugio")
      }
    }
  ]);
  assertProtocolMetadata(io.events[0].payload, { id: 1 });

  cleanupMode(mode);
});

test("PalabrasBonus does not wait for the next scheduled request to replace an automatic word", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  let scheduledPlayer = null;

  mode._scheduleNext = (playerId) => {
    scheduledPlayer = playerId;
  };
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", async () => ["historia", "Narracion de hechos."]);

  await mode.handleRequest(1);
  assert.equal(scheduledPlayer, 1);
  assert.equal(io.events[0].payload.palabras_var, "historia");

  mode.addMusa(1, { palabra: "cometa", musa: "Musa Azul" });

  assert.equal(mode.getInsertedCount(1), 1);
  assert.equal(io.events.length, 2);
  assert.equal(io.events[1].event, "enviar_palabra_j1");
  assert.equal(io.events[1].payload.palabras_var, "cometa");
  assert.equal(io.events[1].payload.origen_musa, "musa");
  assert.equal(io.events[1].payload.musa_nombre, "Musa Azul");

  cleanupMode(mode);
});

test("PalabrasBonus ignores an in-flight RAE result if a muse word has already replaced it", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  let resolveRae;
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", () => new Promise((resolve) => {
    resolveRae = resolve;
  }));

  const pending = mode.handleRequest(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof resolveRae, "function");
  assert.equal(mode.players[1].peticionAutomaticaPendiente, true);

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].event, "enviar_palabra_j1");
  assert.equal(io.events[0].payload.palabras_var, "aurora");
  assert.equal(io.events[0].payload.origen_musa, "musa");
  assert.equal(io.events[0].payload.musa_nombre, "Luna");

  resolveRae(["historia", "Narracion de hechos."]);
  await pending;

  assert.equal(io.events.length, 1);
  cleanupMode(mode);
});

test("PalabrasBonus discards stale RAE results after clearAll", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  let resolveRae;
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", () => new Promise((resolve) => {
    resolveRae = resolve;
  }));

  const pending = mode.handleRequest(1);
  await Promise.resolve();
  mode.clearAll();
  assert.equal(typeof resolveRae, "function");
  resolveRae(["historia", "Narracion de hechos."]);
  await pending;

  assert.deepEqual(io.events, []);
  cleanupMode(mode);
});

test("PalabrasBonus decorates emitted words with mode metadata", async () => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(
    io,
    10000,
    (payload) => ({ ...payload, modo_seq: 9, modo_actual: payload.modo_actual || "palabras bonus" })
  );
  mode._scheduleNext = () => {};
  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });

  await mode.handleRequest(1);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].payload.modo_seq, 9);
  assert.equal(io.events[0].payload.modo_actual, "palabras bonus");
  cleanupMode(mode);
});

test("PalabrasBonus penalizes superbonus time and score with the cumulative factor", async () => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  mode.addMusa(1, { palabra: "paso", musa: "Inicio", client_id: "inicio" });

  mode.solicitarInspiracion(1);
  await mode.handleRequest(1, { contabilizar: false });
  const primera = io.events.at(-1).payload;
  assert.equal(mode.descartarInspiracion(1, primera.inspiracion_id).factor_siguiente, 0.75);

  mode.addMusa(1, { palabra: "cometa", musa: "Luna", client_id: "luna" });
  mode.addMusa(1, { palabra: "COMETA", musa: "Sol", client_id: "sol" });
  await mode.handleRequest(1, { contabilizar: false });
  const penalizada = io.events.at(-1).payload;
  const baseSuperbonus = mode._aplicarTiempoSuperbonus(mode._puntuacionPalabra("cometa"), 2);

  assert.equal(penalizada.factor_inspiracion, 0.75);
  assert.equal(penalizada.valor_inspiracion, 0.75);
  assert.equal(penalizada.tiempo_base_inspiracion, baseSuperbonus);
  assert.equal(penalizada.tiempo_palabras_bonus, Math.max(1, Math.ceil(baseSuperbonus * 0.75)));
  const resultado = mode.aprovecharInspiracion(1, penalizada.inspiracion_id);
  assert.equal(resultado.tiempo_otorgado, penalizada.tiempo_palabras_bonus);
  assert.equal(resultado.valor_inspiracion, 0.75);
  assert.equal(mode.getInsertedCount(1), 0.75);
  cleanupMode(mode);
});

test("PalabrasBonus keeps RAE deliveries discardable and timed without counting inspiration score", async (t) => {
  const io = createFakeIo();
  const mode = new PalabrasBonusMode(io, 10000);
  mode._scheduleNext = () => {};
  t.mock.method(PalabrasBonusMode, "_inicializarNavegador", async () => {});
  t.mock.method(mode, "_palabraRAE", async () => ["historia", "Narracion de hechos."]);

  mode.solicitarInspiracion(1);
  await mode.handleRequest(1, { contabilizar: false });
  const payload = io.events[0].payload;
  assert.equal(payload.descartable, true);
  assert.ok(payload.tiempo_palabras_bonus > 0);
  const resultado = mode.aprovecharInspiracion(1, payload.inspiracion_id);

  assert.equal(resultado.ok, true);
  assert.equal(resultado.entrega_musa, null);
  assert.equal(resultado.tiempo_otorgado, payload.tiempo_palabras_bonus);
  assert.equal(mode.getInsertedCount(1), 0);
  cleanupMode(mode);
});

test("PalabrasBonus time penalty always rounds up and has a one-second floor", () => {
  const mode = new PalabrasBonusMode(createFakeIo(), 10000);
  assert.equal(mode._tiempoInspiracionPenalizado(5, 0.75), 4);
  assert.equal(mode._tiempoInspiracionPenalizado(1, 0.25), 1);
  cleanupMode(mode);
});
