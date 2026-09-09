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

test("detonator tests require Control and active Debug mode", () => {
  const ctx = crearContexto();
  let unauthorized = null;
  ctx.socket.emit("debug_detonadores_prueba", {}, (result) => { unauthorized = result; });
  assert.deepEqual(unauthorized, { ok: false, code: "NOT_AUTHORIZED" });

  ctx.socket.control = true;
  let disabled = null;
  ctx.socket.emit("debug_detonadores_prueba", {}, (result) => { disabled = result; });
  assert.deepEqual(disabled, { ok: false, code: "DEBUG_MODE_REQUIRED" });
});

test("active Debug mode relays normalized detonator tests to every role", () => {
  const ctx = crearContexto();
  ctx.socket.control = true;
  ctx.manager.establecer(true);
  ctx.emissions.length = 0;

  let response = null;
  ctx.socket.emit("debug_detonadores_prueba", {
    seq: 4.4,
    cantidad: 99,
    velocidad: 0
  }, (result) => { response = result; });

  assert.deepEqual(response, {
    ok: true,
    seq: 4,
    cantidad: 8,
    velocidad: 5,
    ts: 1234
  });
  assert.deepEqual(ctx.emissions, [{
    event: "debug_detonadores_visual",
    payload: { seq: 4, cantidad: 8, velocidad: 5, ts: 1234 }
  }]);
});

test("turning Debug off clears test detonators from every screen", () => {
  const ctx = crearContexto();
  ctx.socket.control = true;
  ctx.manager.establecer(true);
  ctx.emissions.length = 0;
  ctx.manager.establecer(false);

  assert.deepEqual(ctx.emissions, [{
    event: "debug_detonadores_detener",
    payload: { ts: 1234 }
  }]);
});
