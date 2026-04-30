const test = require("node:test");
const assert = require("node:assert/strict");

const PalabrasMalditasMode = require("../palabras_malditas.js");

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

function stubTimers(t) {
  t.mock.method(global, "setTimeout", () => ({ mocked: true }));
  t.mock.method(global, "clearTimeout", () => {});
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

test("PalabrasMalditas routes musa words to the opponent queue", (t) => {
  stubTimers(t);
  const mode = new PalabrasMalditasMode(createFakeIo(), 10000);
  mode.addMusa(1, { palabra: "tormenta", musa: "Eva" });
  assert.deepEqual(mode.players[2].queue, [{ palabra: "tormenta", musa: "Eva" }]);
  assert.deepEqual(mode.players[1].queue, []);
  cleanupMode(mode);
});

test("PalabrasMalditas extracts top words from readable opponent text only", (t) => {
  stubTimers(t);
  const mode = new PalabrasMalditasMode(createFakeIo(), 10000);
  mode.actualizarTextoJugador(1, '<div>Sol sol sol</div><style>.x{}</style>&nbsp; luna span luna');
  assert.deepEqual(mode._obtenerTopPalabrasJugador(1, 3), ["sol", "luna"]);
  cleanupMode(mode);
});

test("PalabrasMalditas emits musa payload with escaped musa name metadata", (t) => {
  stubTimers(t);
  const io = createFakeIo();
  const mode = new PalabrasMalditasMode(io, 10000);
  mode.players[1].queue.push({ palabra: "cometa", musa: '<b>Ana</b>' });

  mode._emitNext(1);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].event, "enviar_palabra_j1");
  assert.equal(io.events[0].payload.origen_musa, "musa_enemiga");
  assert.equal(io.events[0].payload.musa_nombre, "<b>Ana</b>");
  assert.match(io.events[0].payload.palabra_bonus[1], /&lt;b&gt;Ana&lt;\/b&gt;/);
  cleanupMode(mode);
});

test("PalabrasMalditas handleRequest increments the opponent count after a musa delivery", async (t) => {
  stubTimers(t);
  const io = createFakeIo();
  const mode = new PalabrasMalditasMode(io, 10000);
  mode.players[1].queue.push({ palabra: "cometa", musa: "Luna" });
  mode._emitNext(1);

  await mode.handleRequest(1);

  assert.equal(mode.getInsertedCount(2), 1);
  assert.ok(io.events.length >= 2);
  cleanupMode(mode);
});

test("PalabrasMalditas falls back to the opponent top words before static words", (t) => {
  stubTimers(t);
  const io = createFakeIo();
  const mode = new PalabrasMalditasMode(io, 10000);
  mode.TOP_K_PALABRAS = 3;
  mode.actualizarTextoJugador(1, "nube nube nube fuego fuego mar");

  mode._emitNext(1);
  mode._emitNext(1);

  const delivered = io.events.map((entry) => entry.payload.palabra_bonus[0][0]);
  assert.deepEqual(delivered.slice(0, 2), ["nube", "fuego"]);
  cleanupMode(mode);
});

test("PalabrasMalditas scheduled emissions are ignored after clearAll", (t) => {
  const io = createFakeIo();
  const callbacks = [];
  t.mock.method(global, "setTimeout", (callback) => {
    callbacks.push(callback);
    return { mocked: true, index: callbacks.length - 1 };
  });
  t.mock.method(global, "clearTimeout", () => {});
  const mode = new PalabrasMalditasMode(io, 10000);
  mode.players[1].queue.push({ palabra: "cometa", musa: "Luna" });

  mode._emitNext(1);
  assert.equal(io.events.length, 1);
  assert.equal(callbacks.length, 1);

  mode.clearAll();
  callbacks[0]();

  assert.equal(io.events.length, 1);
  cleanupMode(mode);
});

test("PalabrasMalditas emits current mode metadata for forbidden words", (t) => {
  stubTimers(t);
  const io = createFakeIo();
  const mode = new PalabrasMalditasMode(
    io,
    10000,
    (payload) => ({ ...payload, modo_seq: 11, modo_actual: payload.modo_actual })
  );
  mode.players[1].queue.push({ palabra: "cometa", musa: "Luna" });

  mode._emitNext(1);

  assert.equal(io.events.length, 1);
  assert.equal(io.events[0].payload.modo_actual, "palabras prohibidas");
  assert.equal(io.events[0].payload.modo_seq, 11);
  cleanupMode(mode);
});
