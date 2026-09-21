const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { crearGestorModoDebug } = require("../debug_mode.js");

function crearContexto({ exportacion = null, temporizadorEstado = "oculto" } = {}) {
  const emissions = [];
  const roomEmissions = [];
  const injections = [];
  let clears = 0;
  let exportRequests = 0;
  let timerFinishes = 0;
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
  const warmup = {
    inyectarDetonadoresDebug(payload) {
      injections.push(payload);
      return { ok: true, agregadas: payload.cantidad, solicitud: "lugares", vista: true };
    },
    limpiarDetonadoresDebug() {
      clears += 1;
      return { ok: true, eliminadas: 7 };
    }
  };
  const temporizadorShow = {
    payload() {
      return { estado: temporizadorEstado, mostrar: temporizadorEstado !== "oculto" };
    },
    finalizar() {
      timerFinishes += 1;
      temporizadorEstado = "finalizado";
      return { estado: "finalizado", mostrar: true, restante: 0 };
    }
  };
  const manager = crearGestorModoDebug({
    io,
    now: () => 1234,
    getCalentamientoGestor: () => warmup,
    getTemporizadorShow: () => temporizadorShow,
    getIteracionesPartida: () => {
      exportRequests += 1;
      return exportacion;
    }
  });
  const socket = new EventEmitter();
  manager.registrarHandlers(socket);
  return {
    emissions,
    getClears: () => clears,
    getExportRequests: () => exportRequests,
    getTimerFinishes: () => timerFinishes,
    injections,
    manager,
    roomEmissions,
    socket
  };
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

test("active Debug mode injects normalized detonators through the real Muse flow", () => {
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
    ts: 1234,
    agregadas: 8,
    solicitud: "lugares",
    vista: true
  });
  assert.deepEqual(ctx.injections, [{ seq: 4, cantidad: 8, velocidad: 5, ts: 1234 }]);
  assert.deepEqual(ctx.emissions, []);
});

test("turning Debug off clears test detonators from every screen", () => {
  const ctx = crearContexto();
  ctx.socket.control = true;
  ctx.manager.establecer(true);
  ctx.emissions.length = 0;
  ctx.manager.establecer(false);

  assert.deepEqual(ctx.emissions, [{
    event: "debug_detonadores_detener",
    payload: { ts: 1234, ok: true, eliminadas: 7 }
  }]);
  assert.equal(ctx.getClears(), 1);
});

test("Control can finish an active giant timer only while Debug is active", () => {
  const ctx = crearContexto({ temporizadorEstado: "activo" });

  let unauthorized = null;
  ctx.socket.emit("debug_finalizar_temporizador_gigante", {}, (result) => { unauthorized = result; });
  assert.deepEqual(unauthorized, { ok: false, code: "NOT_AUTHORIZED" });

  ctx.socket.control = true;
  let disabled = null;
  ctx.socket.emit("debug_finalizar_temporizador_gigante", {}, (result) => { disabled = result; });
  assert.deepEqual(disabled, { ok: false, code: "DEBUG_MODE_REQUIRED" });

  ctx.manager.establecer(true);
  let response = null;
  ctx.socket.emit("debug_finalizar_temporizador_gigante", {}, (result) => { response = result; });
  assert.deepEqual(response, {
    ok: true,
    temporizador: { estado: "finalizado", mostrar: true, restante: 0 }
  });
  assert.equal(ctx.getTimerFinishes(), 1);

  let alreadyFinished = null;
  ctx.socket.emit("debug_finalizar_temporizador_gigante", {}, (result) => { alreadyFinished = result; });
  assert.deepEqual(alreadyFinished, { ok: false, code: "SHOW_TIMER_NOT_ACTIVE" });
});

test("iteration export is lazy and restricted to Control with active Debug mode", () => {
  const exportacion = {
    tipo: "scrib_iteraciones_partida",
    resumen: { iteraciones: 42 },
    iteraciones: []
  };
  const ctx = crearContexto({ exportacion });
  assert.equal(ctx.getExportRequests(), 0);

  let unauthorized = null;
  ctx.socket.emit("debug_exportar_iteraciones_partida", {}, (result) => { unauthorized = result; });
  assert.deepEqual(unauthorized, { ok: false, code: "NOT_AUTHORIZED" });
  assert.equal(ctx.getExportRequests(), 0);

  ctx.socket.control = true;
  let disabled = null;
  ctx.socket.emit("debug_exportar_iteraciones_partida", {}, (result) => { disabled = result; });
  assert.deepEqual(disabled, { ok: false, code: "DEBUG_MODE_REQUIRED" });
  assert.equal(ctx.getExportRequests(), 0);

  ctx.manager.establecer(true);
  let response = null;
  ctx.socket.emit("debug_exportar_iteraciones_partida", {}, (result) => { response = result; });
  assert.equal(response.ok, true);
  assert.equal(response.exportacion, exportacion);
  assert.deepEqual(response.resumen, { iteraciones: 42 });
  assert.equal(ctx.getExportRequests(), 1);
});

test("iteration export reports when no match has been recorded", () => {
  const ctx = crearContexto();
  ctx.socket.control = true;
  ctx.manager.establecer(true);
  let response = null;

  ctx.socket.emit("debug_exportar_iteraciones_partida", {}, (result) => { response = result; });

  assert.deepEqual(response, { ok: false, code: "NO_MATCH_ITERATIONS" });
});
