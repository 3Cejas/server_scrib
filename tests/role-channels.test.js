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
  const io = deps.io || {
    emit() {},
    to() {
      return { emit() {} };
    }
  };
  registrarCanalesRoles({
    socket,
    io,
    bolzanoEvents: { REGISTER_MUSA: "bolzano_register_musa" },
    rolesConectados: deps.rolesConectados,
    sesionesEscritor: deps.sesionesEscritor,
    calentamientoGestor: deps.calentamientoGestor || { registrarMusa() {}, desregistrarMusa() {}, desregistrarEscritor() {} },
    bolzanoCalentamientoGestor: { registrarMusa() {}, desregistrarMusa() {} },
    musasAuxiliares: deps.musasAuxiliares || {
      obtenerRegalo: () => null,
      emitirEstadoRegaloBandera() {}
    },
    normalizarMusaClientId: (valor) => String(valor || ""),
    obtenerIdJugadorValido: (valor) => {
      const id = Number(valor);
      return id === 1 || id === 2 ? id : null;
    },
    normalizarNombreMusa: (valor) => String(valor || "").trim(),
    getNombreEscritxr: deps.getNombreEscritxr || (() => ""),
    emitirEstadoBanderasMusas() {},
    sincronizarEstadoMusa() {},
    sincronizarSocketRecienConectado: deps.sincronizarSocketRecienConectado || (() => {}),
    emitirEstadoDramaturgia: deps.emitirEstadoDramaturgia || (() => {}),
    registrarMusaEnCreditosPartida: deps.registrarMusaEnCreditosPartida || (() => {}),
    getPartidaActivaParaCreditos: deps.getPartidaActivaParaCreditos || (() => false),
    autorizarRegistroControl: deps.autorizarRegistroControl || (() => ({ ok: true, rol: "control" })),
    registrar: () => {}
  });
}

test("control registration requires the runtime authorization result and acknowledges it explicitly", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const rechazado = crearSocket("control-rechazado");
  registrar(rechazado, {
    rolesConectados,
    sesionesEscritor,
    autorizarRegistroControl: () => ({ ok: false, code: "INVALID_ACCESS_TOKEN" })
  });
  let ack = null;
  rechazado.trigger("registrar_control", { access_token: "falso" }, (payload) => { ack = payload; });
  assert.equal(ack.code, "INVALID_ACCESS_TOKEN");
  assert.equal(rechazado.control, undefined);
  assert.equal(rolesConectados.payloadConexiones().control.count, 0);

  const aceptado = crearSocket("control-aceptado");
  registrar(aceptado, {
    rolesConectados,
    sesionesEscritor,
    autorizarRegistroControl: (_socket, payload) => ({
      ok: payload.access_token === "valido",
      code: "INVALID_ACCESS_TOKEN",
      access_token: "renovado_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expires_ts: Date.now() + 60000
    })
  });
  aceptado.trigger("registrar_control", { access_token: "valido" }, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(ack.rol, "control");
  assert.equal(ack.access_token, "renovado_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(ack.expires_ts > Date.now(), true);
  assert.equal(aceptado.control, true);
  assert.equal(rolesConectados.payloadConexiones().control.count, 1);
});

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
  assert.equal(monitor.emitted.some(({ event }) => event === "musa_asignacion"), false);
});

test("role channels return the authoritative musa assignment with writer name by event and ack", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const musa = crearSocket("musa-assignment");
  const broadcasts = [];
  const io = {
    emit(event, payload) {
      broadcasts.push({ event, payload });
    },
    to() {
      return { emit() {} };
    }
  };
  registrar(musa, {
    io,
    rolesConectados,
    sesionesEscritor,
    getNombreEscritxr: (player) => player === 1 ? "ANA AZUL" : "BEA ROJA"
  });

  let ack = null;
  musa.trigger("registrar_musa", {
    musa: 2,
    nombre: "Luna",
    client_id: "luna-client",
    request_id: "request-entry-42"
  }, (payload) => {
    ack = payload;
  });

  const assignmentEvent = musa.emitted.find(({ event }) => event === "musa_asignacion");
  assert.ok(assignmentEvent);
  assert.deepEqual(ack, assignmentEvent.payload);
  assert.equal(ack.ok, true);
  assert.equal(ack.player, 1);
  assert.equal(ack.equipo, 1);
  assert.equal(ack.color, "azul");
  assert.equal(ack.nombre_equipo, "EQUIPO AZUL");
  assert.equal(ack.escritxr, "ANA AZUL");
  assert.equal(ack.nombre_escritxr, "ANA AZUL");
  assert.equal(ack.reasignada, false);
  assert.equal(ack.reconexion, false);
  assert.equal(ack.idempotente, false);
  assert.equal(ack.motivo, "entrada");
  assert.equal(ack.request_id, "request-entry-42");
  assert.equal(typeof ack.ts, "number");
  assert.equal(Object.prototype.hasOwnProperty.call(ack, "contador"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ack, "replaced"), false);
  assert.deepEqual(rolesConectados.obtenerContadorMusas(), {
    escritxr1: 1,
    escritxr2: 0
  });
  assert.equal(
    broadcasts.some(({ event, payload }) => event === "actualizar_contador_musas"
      && payload.escritxr1 === 1
      && payload.escritxr2 === 0),
    true
  );
});

test("role channels sanitize request correlation and cap the writer name in muse assignments", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const musa = crearSocket("musa-bounded-assignment");
  registrar(musa, {
    rolesConectados,
    sesionesEscritor,
    getNombreEscritxr: () => `  ${"A".repeat(120)}  `
  });

  let ack = null;
  musa.trigger("registrar_musa", {
    nombre: "Luna",
    client_id: "bounded-client",
    request_id: " ../../request:unsafe? "
  }, (payload) => {
    ack = payload;
  });

  assert.equal(ack.request_id, "requestunsafe");
  assert.equal(ack.nombre_escritxr.length, 80);
  assert.equal(ack.escritxr, ack.nombre_escritxr);
});

test("role channels replace an overlapping musa reconnect without double counting", () => {
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
  const oldMusa = crearSocket("old-musa");
  const newMusa = crearSocket("new-musa");
  registrar(oldMusa, { io, rolesConectados, sesionesEscritor });
  registrar(newMusa, { io, rolesConectados, sesionesEscritor });

  let firstAck = null;
  oldMusa.trigger("registrar_musa", {
    musa: 2,
    nombre: "Luna",
    client_id: "persistent-muse"
  }, (payload) => {
    firstAck = payload;
  });
  let reconnectAck = null;
  newMusa.trigger("registrar_musa", {
    musa: firstAck.player === 1 ? 2 : 1,
    nombre: "Luna",
    client_id: "persistent-muse"
  }, (payload) => {
    reconnectAck = payload;
  });

  assert.equal(reconnectAck.player, firstAck.player);
  assert.equal(reconnectAck.reconexion, true);
  assert.equal(reconnectAck.motivo, "reconexion");
  assert.deepEqual(rolesConectados.obtenerContadorMusas(), firstAck.player === 1
    ? { escritxr1: 1, escritxr2: 0 }
    : { escritxr1: 0, escritxr2: 1 });
  assert.equal(oldMusa.musa, null);
  assert.equal(
    roomEvents.some(({ room, event }) => room === oldMusa.id && event === "musa_reemplazada"),
    true
  );

  oldMusa.trigger("disconnect");
  assert.equal(rolesConectados.payloadConexiones().musas[firstAck.player].count, 1);
});

test("role channels propagate a disconnect rebalance to warmup and the moved musa", () => {
  const rolesConectados = crearRegistroRoles();
  const sesionesEscritor = crearRegistroSesionesEscritor();
  const warmupCalls = [];
  const calentamientoGestor = {
    registrarMusa(socket, player, nombre) {
      warmupCalls.push({ action: "register", socket: socket.id, player, nombre });
    },
    desregistrarMusa(socket, player) {
      warmupCalls.push({ action: "unregister", socket: socket.id, player });
    },
    desregistrarEscritor() {}
  };
  const io = {
    emit() {},
    to() {
      return { emit() {} };
    }
  };
  const first = crearSocket("musa-one");
  const second = crearSocket("musa-two");
  const third = crearSocket("musa-three");
  [first, second, third].forEach((musa) => registrar(musa, {
    io,
    rolesConectados,
    sesionesEscritor,
    calentamientoGestor,
    getNombreEscritxr: (player) => `AUTORA ${player}`
  }));

  first.trigger("registrar_musa", { nombre: "Uno", client_id: "one" });
  second.trigger("registrar_musa", { nombre: "Dos", client_id: "two" });
  third.trigger("registrar_musa", { nombre: "Tres", client_id: "three" });
  first.trigger("disconnect");

  assert.deepEqual(rolesConectados.obtenerContadorMusas(), {
    escritxr1: 1,
    escritxr2: 1
  });
  const rebalance = third.emitted.filter(({ event }) => event === "musa_asignacion").at(-1);
  assert.ok(rebalance);
  assert.equal(rebalance.payload.player, 1);
  assert.equal(rebalance.payload.nombre_escritxr, "AUTORA 1");
  assert.equal(rebalance.payload.reasignada, true);
  assert.equal(rebalance.payload.motivo, "reequilibrio");
  assert.equal(
    warmupCalls.some((call) => call.action === "unregister" && call.socket === third.id && call.player === 2),
    true
  );
  assert.equal(
    warmupCalls.some((call) => call.action === "register" && call.socket === third.id && call.player === 1),
    true
  );
  assert.equal(third.emitted.some(({ event }) => event === "regalo_pdf_musas_reset"), true);
});
