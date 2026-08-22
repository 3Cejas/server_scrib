const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DRAMATURGIA_UI_VERSION,
  registrarCanalesRoles
} = require("../role_channels.js");
const { crearRegistroRoles } = require("../role_connections.js");
const { crearRegistroSesionesEscritor } = require("../writer_sessions.js");

function crearSocket(id) {
  const handlers = {};
  const salas = new Set();
  const emitted = [];
  return {
    id,
    handlers,
    salas,
    emitted,
    on(event, handler) {
      handlers[event] = handler;
    },
    trigger(event, ...args) {
      handlers[event](...args);
    },
    join(room) {
      salas.add(room);
    },
    leave(room) {
      salas.delete(room);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    }
  };
}

function registrar(socket, deps = {}) {
  registrarCanalesRoles({
    socket,
    io: deps.io,
    bolzanoEvents: { REGISTER_MUSA: "bolzano_register_musa" },
    rolesConectados: deps.rolesConectados,
    sesionesEscritor: deps.sesionesEscritor,
    calentamientoGestor: { registrarMusa() {}, desregistrarMusa() {}, desregistrarEscritor() {} },
    bolzanoCalentamientoGestor: { registrarMusa() {}, desregistrarMusa() {} },
    musasAuxiliares: {
      obtenerRegalo: () => null,
      emitirEstadoRegaloBandera() {}
    },
    normalizarMusaClientId: (valor) => String(valor || ""),
    obtenerIdJugadorValido: (valor) => {
      const id = Number(valor);
      return id === 1 || id === 2 ? id : null;
    },
    normalizarNombreMusa: (valor) => String(valor || "").trim(),
    emitirEstadoBanderasMusas() {},
    sincronizarEstadoMusa() {},
    sincronizarSocketRecienConectado: deps.sincronizarSocketRecienConectado || (() => {}),
    emitirEstadoDramaturgia: deps.emitirEstadoDramaturgia || (() => {}),
    registrar: () => {}
  });
}

test("role channels notify the old writer tab when a new session replaces it", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const roomEvents = [];
  const io = {
    emit() {},
    to(room) {
      return {
        emit(event, payload) {
          roomEvents.push({ room, event, payload });
        }
      };
    }
  };
  const oldWriter = crearSocket("old-writer");
  const newWriter = crearSocket("new-writer");

  registrar(oldWriter, { io, rolesConectados, sesionesEscritor });
  registrar(newWriter, { io, rolesConectados, sesionesEscritor });

  oldWriter.trigger("registrar_escritor", 1);
  newWriter.trigger("registrar_escritor", 1);

  assert.equal(roomEvents.length, 1);
  assert.equal(roomEvents[0].room, "old-writer");
  assert.equal(roomEvents[0].event, "escritor_reemplazado");
  assert.equal(roomEvents[0].payload.player, 1);
  assert.match(roomEvents[0].payload.mensaje, /Otra sesi\u00f3n activa/);
  assert.equal(sesionesEscritor.esActiva(oldWriter, 1), false);
  assert.equal(sesionesEscritor.esActiva(newWriter, 1), true);
});

test("role channels do not warn a writer tab during its own socket reconnect", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const roomEvents = [];
  const io = {
    emit() {},
    to(room) {
      return {
        emit(event, payload) {
          roomEvents.push({ room, event, payload });
        }
      };
    }
  };
  const oldWriter = crearSocket("old-writer");
  const newWriter = crearSocket("new-writer");

  registrar(oldWriter, { io, rolesConectados, sesionesEscritor });
  registrar(newWriter, { io, rolesConectados, sesionesEscritor });

  oldWriter.trigger("registrar_escritor", { player: 1, client_id: "same-tab" });
  newWriter.trigger("registrar_escritor", { player: 1, client_id: "same-tab" });

  assert.equal(roomEvents.length, 0);
  assert.equal(sesionesEscritor.esActiva(oldWriter, 1), false);
  assert.equal(sesionesEscritor.esActiva(newWriter, 1), true);
});

test("role channels register jury as a read-only live role", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const jury = crearSocket("jury");

  registrar(jury, { io: { emit() {} }, rolesConectados, sesionesEscritor });
  jury.trigger("registrar_jurado");

  assert.equal(jury.jurado, true);
  assert.equal(jury.salas.has("j1"), true);
  assert.equal(jury.salas.has("j2"), true);
  assert.deepEqual(rolesConectados.payloadConexiones().jury, { count: 1, connected: true });
});

test("role channels register dramaturgy, sync it and serve targeted state only after registration", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const dramaturgy = crearSocket("dramaturgy");
  const syncCalls = [];
  const stateCalls = [];

  registrar(dramaturgy, {
    io: { emit() {} },
    rolesConectados,
    sesionesEscritor,
    sincronizarSocketRecienConectado(socket) {
      syncCalls.push(socket);
    },
    emitirEstadoDramaturgia(socket) {
      stateCalls.push(socket);
    }
  });

  dramaturgy.trigger("pedir_estado_dramaturgia");
  assert.equal(stateCalls.length, 0);

  dramaturgy.trigger("registrar_dramaturgia", { ui_version: DRAMATURGIA_UI_VERSION });
  assert.equal(dramaturgy.dramaturgia, true);
  assert.equal(dramaturgy.salas.has("j1"), true);
  assert.equal(dramaturgy.salas.has("j2"), true);
  assert.equal(dramaturgy.salas.has("role_dramaturgia"), true);
  assert.deepEqual(rolesConectados.payloadConexiones().dramaturgia, {
    count: 1,
    connected: true
  });
  assert.deepEqual(syncCalls, [dramaturgy]);
  assert.equal(dramaturgy.emitted.some(({ event }) => event === "recargar_rol_remoto"), false);

  dramaturgy.trigger("pedir_estado_dramaturgia");
  assert.deepEqual(stateCalls, [dramaturgy]);
  assert.equal(rolesConectados.payloadConexiones().dramaturgia.count, 1);
});

test("role channels reload a stale dramaturgy UI after registration", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const dramaturgy = crearSocket("dramaturgy-stale");

  registrar(dramaturgy, {
    io: { emit() {} },
    rolesConectados,
    sesionesEscritor
  });

  dramaturgy.trigger("registrar_dramaturgia");

  const reload = dramaturgy.emitted.find(({ event }) => event === "recargar_rol_remoto");
  assert.ok(reload);
  assert.equal(reload.payload.rol, "dramaturgia");
  assert.equal(reload.payload.motivo, "ui_desactualizada");
  assert.equal(reload.payload.ui_version, DRAMATURGIA_UI_VERSION);
});

test("role channels register a muse monitor without counting a muse and sync its team", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const monitor = crearSocket("monitor-musa");
  const syncCalls = [];
  const museSyncCalls = [];

  registrarCanalesRoles({
    socket: monitor,
    io: { emit() {} },
    bolzanoEvents: { REGISTER_MUSA: "bolzano_register_musa" },
    rolesConectados,
    sesionesEscritor,
    calentamientoGestor: { registrarMusa() {}, desregistrarMusa() {}, desregistrarEscritor() {} },
    bolzanoCalentamientoGestor: { registrarMusa() {}, desregistrarMusa() {} },
    musasAuxiliares: { obtenerRegalo: () => null, emitirEstadoRegaloBandera() {} },
    normalizarMusaClientId: (valor) => String(valor || ""),
    obtenerIdJugadorValido: (valor) => ([1, 2].includes(Number(valor)) ? Number(valor) : null),
    normalizarNombreMusa: (valor) => String(valor || "").trim(),
    emitirEstadoBanderasMusas() {},
    sincronizarEstadoMusa(socket) {
      museSyncCalls.push(socket);
    },
    sincronizarSocketRecienConectado(socket) {
      syncCalls.push(socket);
    }
  });

  let rejected = null;
  monitor.trigger("registrar_monitor_pantalla", { rol: "musa", player: 1 }, (payload) => {
    rejected = payload;
  });
  assert.equal(rejected.code, "MONITOR_HANDSHAKE_REQUIRED");
  assert.equal(monitor.monitor_pantalla, undefined);

  monitor.monitor_pantalla_solicitada = true;
  monitor.trigger("registrar_monitor_pantalla", { rol: "musa", player: 1 });

  assert.equal(monitor.monitor_pantalla.rol, "musa");
  assert.equal(monitor.salas.has("j1"), true);
  assert.equal(monitor.salas.has("musa_j1"), true);
  assert.deepEqual(rolesConectados.obtenerContadorMusas(), {
    escritxr1: 0,
    escritxr2: 0
  });
  assert.deepEqual(syncCalls, [monitor]);
  assert.deepEqual(museSyncCalls, [monitor]);

  monitor.musa = 1;
  let collision = null;
  monitor.trigger("registrar_monitor_pantalla", { rol: "musa", player: 2 }, (payload) => {
    collision = payload;
  });
  assert.equal(collision.code, "ROLE_ALREADY_REGISTERED");
  assert.equal(monitor.monitor_pantalla.player, 1);
});
