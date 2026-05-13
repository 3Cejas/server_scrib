const test = require("node:test");
const assert = require("node:assert/strict");

const Musas = require("../musas.js");

function createFakeIo() {
  const events = [];
  return {
    events,
    emit(event, payload) {
      events.push({ scope: "io", event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          events.push({ scope: "room", room, event, payload });
        }
      };
    }
  };
}

function cleanupMode(mode) {
  mode.clearAll();
}

test("Musas normalizes musa items from strings and objects", () => {
  const mode = new Musas(createFakeIo(), 10000);
  cleanupMode(mode);
  assert.deepEqual(mode._normalizarMusaItem("  aurora  "), { palabra: "aurora", musa: "" });
  assert.deepEqual(mode._normalizarMusaItem({ palabra: "  cometa ", musa: "  Ana " }), { palabra: "cometa", musa: "Ana" });
  assert.deepEqual(mode._normalizarMusaItem({ palabra: "sol", musa: "Ana", client_id: "musa_1" }), { palabra: "sol", musa: "Ana", client_id: "musa_1" });
  assert.deepEqual(mode._normalizarMusaItem({ word: " brillo ", nombre: " Musa B " }), { palabra: "brillo", musa: "Musa B" });
  assert.equal(mode._normalizarMusaItem("   "), null);
  assert.equal(mode._normalizarMusaItem(null), null);
});

test("Musas handleRequest increments count and marks pending when the queue is empty", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000);
  mode.handleRequest(1);
  assert.equal(mode.getInsertedCount(1), 1);
  assert.equal(mode.players[1].pending, true);
  assert.equal(io.events.length, 0);
  cleanupMode(mode);
});

test("Musas addMusa flushes immediately when the player was pending", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000);
  mode.players[1].pending = true;
  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });

  assert.equal(mode.players[1].pending, false);
  assert.equal(io.events.length, 1);
  assert.deepEqual(io.events[0], {
    scope: "room",
    room: "j1",
    event: "inspirar_j1",
    payload: {
      palabra: "aurora",
      musa_nombre: "Luna"
    }
  });
  assert.deepEqual(mode.consumirEntregaMusaIntroducida(1), {
    player: 1,
    target_player: 1,
    modo: "",
    palabra: "aurora",
    musa_nombre: "Luna",
    client_id: "",
    client_ids: [],
    musas: ["Luna"],
    tiempo: 0,
    superbonus: false
  });
  cleanupMode(mode);
});

test("Musas keeps pending requests isolated per writer and delivers to the matching room", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000);

  mode.handleRequest(1);
  assert.equal(mode.players[1].pending, true);
  assert.equal(mode.players[2].pending, false);

  mode.addMusa(2, { palabra: "brisa", musa: "Nora" });
  assert.equal(mode.players[1].pending, true);
  assert.equal(mode.players[2].pending, false);
  assert.equal(io.events.length, 0);

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });
  assert.equal(mode.players[1].pending, false);
  assert.equal(io.events.length, 1);
  assert.deepEqual(io.events[0], {
    scope: "room",
    room: "j1",
    event: "inspirar_j1",
    payload: {
      palabra: "aurora",
      musa_nombre: "Luna"
    }
  });

  cleanupMode(mode);
});

test("Musas emits queued musa requests independently for both writers", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000);

  mode.addMusa(1, { palabra: "cometa", musa: "Azul" });
  mode.addMusa(2, { palabra: "faro", musa: "Roja" });

  mode.handleRequest(1);
  mode.handleRequest(2);

  assert.equal(mode.getInsertedCount(1), 1);
  assert.equal(mode.getInsertedCount(2), 1);
  assert.deepEqual(io.events, [
    {
      scope: "room",
      room: "j1",
      event: "inspirar_j1",
      payload: {
        palabra: "cometa",
        musa_nombre: "Azul"
      }
    },
    {
      scope: "room",
      room: "j2",
      event: "inspirar_j2",
      payload: {
        palabra: "faro",
        musa_nombre: "Roja"
      }
    }
  ]);

  cleanupMode(mode);
});

test("Musas exposes control status only for queued and delivered muse words", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000);

  mode.addMusa(1, { palabra: "cometa", musa: "Azul" });
  mode.addMusa(1, { palabra: "faro", musa: "Bruma" });

  let status = mode.obtenerEstadoPalabrasMusasControl();
  assert.equal(status.players[1].activa, true);
  assert.equal(status.players[1].origen_estado, "cola");
  assert.equal(status.players[1].palabra, "cometa");
  assert.equal(status.players[1].cola, 2);
  assert.equal(status.players[1].cola_palabras_musas, 2);
  assert.ok(status.players[1].tiempo_restante_ms > 0);
  assert.ok(status.players[1].tiempo_restante_ms <= 10000);
  assert.equal(status.players[2].cola, 0);

  mode.handleRequest(1);
  status = mode.obtenerEstadoPalabrasMusasControl();

  assert.equal(status.players[1].activa, true);
  assert.equal(status.players[1].cola, 1);
  assert.equal(status.players[1].palabra.length > 0, true);
  assert.equal(status.players[1].musa_nombre.length > 0, true);
  assert.ok(status.players[1].tiempo_restante_ms > 0);
  assert.ok(status.players[1].tiempo_restante_ms <= 10000);

  mode.consumirEntregaMusaIntroducida(1);
  status = mode.obtenerEstadoPalabrasMusasControl();
  assert.equal(status.players[1].activa, true);
  assert.equal(status.players[1].origen_estado, "cola");
  assert.ok(status.players[1].tiempo_restante_ms > 0);
  assert.equal(status.players[1].cola, 1);

  cleanupMode(mode);
});

test("Musas prunes expired queued muse words from control status", () => {
  const mode = new Musas(createFakeIo(), 10000);
  const now = Date.now();
  mode.addMusa(1, { palabra: "aurora", musa: "Luna", caduca_en_ts: now - 1 });
  mode.addMusa(1, { palabra: "brillo", musa: "Sol", caduca_en_ts: now + 5000 });

  const status = mode.obtenerEstadoPalabrasMusasControl(now);

  assert.equal(status.players[1].activa, true);
  assert.equal(status.players[1].palabra, "brillo");
  assert.equal(status.players[1].cola, 1);
  assert.ok(status.players[1].tiempo_restante_ms <= 5000);

  cleanupMode(mode);
});

test("Musas clearAll preserves counters but clears queues and pending state", () => {
  const mode = new Musas(createFakeIo(), 10000);
  mode.players[1].queue.push({ palabra: "aurora", musa: "" });
  mode.players[1].pending = true;
  mode.players[1].insertedCount = 3;
  mode.clearAll();

  assert.deepEqual(mode.players[1].queue, []);
  assert.equal(mode.players[1].pending, false);
  assert.equal(mode.players[1].insertedCount, 3);
  cleanupMode(mode);
});

test("Musas ignores stale pending timers after clearAll", (t) => {
  const io = createFakeIo();
  const callbacks = [];
  t.mock.method(global, "setTimeout", (callback) => {
    callbacks.push(callback);
    return { mocked: true, index: callbacks.length - 1 };
  });
  t.mock.method(global, "clearTimeout", () => {});
  const mode = new Musas(io, 10000);

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });
  mode.start(1);
  assert.equal(callbacks.length, 1);

  mode.clearAll();
  callbacks[0]();

  assert.deepEqual(io.events, []);
  assert.deepEqual(mode.players[1].queue, []);
  cleanupMode(mode);
});

test("Musas decorates emitted inspiration with mode metadata", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000, (payload) => ({ ...payload, modo_seq: 7, modo_actual: "letra bendita" }));

  mode.players[1].pending = true;
  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });

  assert.equal(io.events.length, 1);
  assert.deepEqual(io.events[0].payload, {
    palabra: "aurora",
    musa_nombre: "Luna",
    modo_seq: 7,
    modo_actual: "letra bendita"
  });
  cleanupMode(mode);
});

test("Musas emits a clear inspiration payload when delivered letter inspiration expires empty", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000, (payload) => ({ ...payload, modo_actual: "letra bendita" }));

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });
  mode.handleRequest(1);
  io.events.length = 0;

  mode._expirePending(1, mode.generation);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].room, "j1");
  assert.equal(io.events[0].event, "inspirar_j1");
  assert.equal(io.events[0].payload.palabra, "");
  assert.equal(io.events[0].payload.musa_nombre, "");
  assert.equal(io.events[0].payload.limpiar_inspiracion, true);
  assert.equal(io.events[0].payload.inspiracion_caducada, true);
  assert.equal(io.events[0].payload.palabra_anterior, "aurora");
  assert.equal(io.events[0].payload.modo_actual, "letra bendita");
  assert.equal(io.events[0].payload.cola_palabras_musas, 0);

  const status = mode.obtenerEstadoPalabrasMusas(1);
  assert.equal(status.activa, false);
  assert.equal(status.cola_palabras_musas, 0);
  cleanupMode(mode);
});

test("Musas replaces expired delivered inspiration with queued muse word before clearing", () => {
  const io = createFakeIo();
  const mode = new Musas(io, 10000, (payload) => ({ ...payload, modo_actual: "letra prohibida" }));

  mode.addMusa(1, { palabra: "aurora", musa: "Luna" });
  mode.handleRequest(1);
  mode.addMusa(1, { palabra: "brillo", musa: "Sol" });
  io.events.length = 0;

  mode._expirePending(1, mode.generation);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].event, "inspirar_j1");
  assert.equal(io.events[0].payload.palabra, "brillo");
  assert.equal(io.events[0].payload.musa_nombre, "Sol");
  assert.equal(io.events[0].payload.modo_actual, "letra prohibida");
  assert.equal(io.events[0].payload.limpiar_inspiracion, undefined);
  assert.equal(mode.obtenerEstadoPalabrasMusas(1).palabra, "brillo");
  cleanupMode(mode);
});
