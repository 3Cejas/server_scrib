const test = require("node:test");
const assert = require("node:assert/strict");

const { registrarCanalesRoles } = require("../role_channels.js");
const { crearRegistroRoles } = require("../role_connections.js");
const { crearRegistroSesionesEscritor } = require("../writer_sessions.js");

function crearSocket(id) {
  const handlers = {};
  const salas = new Set();
  return {
    id,
    handlers,
    salas,
    on(event, handler) {
      handlers[event] = handler;
    },
    trigger(event, payload) {
      handlers[event](payload);
    },
    join(room) {
      salas.add(room);
    },
    leave(room) {
      salas.delete(room);
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
    sincronizarSocketRecienConectado() {},
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
