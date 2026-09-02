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
