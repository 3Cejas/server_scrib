const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { crearGestorTeleprompter } = require("../teleprompter");

test("teleprompter keeps the spectator preparation state until a text is loaded", () => {
  const broadcasts = [];
  const socket = new EventEmitter();
  const manager = crearGestorTeleprompter({
    io: {
      emit(event, payload) {
        broadcasts.push({ event, payload });
      }
    }
  });

  manager.registrarHandlers(socket);
  socket.emit("teleprompter_control", {
    state: {
      preparing: true,
      visible: false,
      text: "",
      playing: false
    }
  });

  assert.equal(manager.snapshot().state.preparing, true);
  assert.equal(manager.snapshot().state.visible, false);
  assert.equal(broadcasts.at(-1).event, "teleprompter_state");
  assert.equal(broadcasts.at(-1).payload.state.preparing, true);

  socket.emit("teleprompter_control", {
    state: {
      preparing: false,
      visible: true,
      text: "Texto cargado",
      source: 1,
      loadId: 1
    }
  });

  assert.equal(manager.snapshot().state.preparing, false);
  assert.equal(manager.snapshot().state.visible, true);
  assert.equal(manager.snapshot().state.text, "Texto cargado");
});

test("teleprompter preserves projector-sized font settings", () => {
  const socket = new EventEmitter();
  const manager = crearGestorTeleprompter({ io: { emit() {} } });

  manager.registrarHandlers(socket);
  socket.emit("teleprompter_control", {
    state: { fontSize: 160 }
  });
  assert.equal(manager.snapshot().state.fontSize, 160);

  socket.emit("teleprompter_control", {
    state: { fontSize: 999 }
  });
  assert.equal(manager.snapshot().state.fontSize, 160);
});

test("a later teleprompter action wins even when another tab left a newer client revision", () => {
  const broadcasts = [];
  const socket = new EventEmitter();
  const manager = crearGestorTeleprompter({
    io: {
      emit(event, payload) {
        broadcasts.push({ event, payload });
      }
    }
  });

  manager.registrarHandlers(socket);
  socket.emit("teleprompter_control", {
    state: {
      revision: 40,
      visible: false,
      preparing: false,
      text: "Texto azul ya cargado",
      source: 1
    }
  });
  socket.emit("teleprompter_control", {
    state: {
      revision: 3,
      visible: false,
      preparing: true,
      text: "Texto azul ya cargado",
      source: 1
    }
  });

  const state = manager.snapshot().state;
  assert.equal(state.text, "Texto azul ya cargado");
  assert.equal(state.visible, true);
  assert.equal(state.preparing, false);
  assert.ok(state.revision > 40);
  assert.equal(broadcasts.at(-1).payload.state.visible, true);
});
