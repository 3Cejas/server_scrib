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
  assert.deepEqual(io.events[0], {
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
  assert.equal(io.events[1].event, "enviar_palabra_j2");
  assert.equal(io.events[1].payload.palabras_var, "faro");
  assert.equal(io.events[1].payload.origen_musa, "musa");
  assert.equal(io.events[1].payload.musa_nombre, "Sol");
  assert.deepEqual(mode.consumirEntregaMusaIntroducida(1), {
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
  assert.deepEqual(mode.consumirEntregaMusaIntroducida(1), {
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
  assert.deepEqual(io.events, [
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
  assert.deepEqual(io.events, [
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
