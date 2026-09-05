const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { crearGestorModoDebug } = require("../debug_mode.js");

function crearContexto() {
  const emissions = [];
  const roomEmissions = [];
  const io = {
    emit(event, payload) {
      emissions.push({ event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          roomEmissions.push({ room, event, payload });
        }
      };
    }
  };
  const manager = crearGestorModoDebug({ io, now: () => 1234 });
  const socket = new EventEmitter();
  manager.registrarHandlers(socket);
  return { emissions, manager, roomEmissions, socket };
}

test("Debug mode starts disabled and is only mutable by Control", () => {
  const ctx = crearContexto();
  assert.equal(ctx.manager.isActive(), false);
  let response = null;
  ctx.socket.emit("modo_debug_establecer", { activo: true }, (result) => { response = result; });
  assert.deepEqual(response, { ok: false, code: "NOT_AUTHORIZED" });
  assert.equal(ctx.manager.isActive(), false);
});

test("Control can toggle Debug mode and its state is emitted only to Control room", () => {
  const ctx = crearContexto();
  ctx.socket.control = true;
  let response = null;
  ctx.socket.emit("modo_debug_establecer", { activo: true }, (result) => { response = result; });

  assert.equal(response.ok, true);
  assert.equal(response.activo, true);
  assert.equal(response.revision, 1);
  assert.equal(ctx.manager.isActive(), true);
  assert.equal(ctx.emissions.length, 0);
  assert.deepEqual(ctx.roomEmissions.map(({ room, event }) => ({ room, event })), [
    { room: "role_control", event: "modo_debug_estado" }
  ]);
});

test("an authenticated Control can request the current Debug state", () => {
  const ctx = crearContexto();
  ctx.socket.control = true;
  ctx.manager.establecer(true);
  let response = null;
  ctx.socket.emit("pedir_modo_debug_estado", {}, (result) => { response = result; });

  assert.equal(response.ok, true);
  assert.equal(response.activo, true);
  assert.equal(response.ts, 1234);
});
