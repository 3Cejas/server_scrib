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
