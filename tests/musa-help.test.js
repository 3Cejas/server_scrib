const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AYUDA_CONTROL_ROOM,
  crearGestorAyudaMusas,
  MAX_FRAME_BYTES
} = require("../musa_help.js");
const { crearRegistroRoles } = require("../role_connections.js");

function crearIo() {
  const eventos = [];
  return {
    eventos,
    to(room) {
      return {
        emit(event, payload) {
          eventos.push({ room, event, payload });
        }
      };
    }
  };
}

function crearSocket(id, extra = {}) {
  const handlers = {};
  const emitted = [];
  const rooms = new Set();
  return {
    id,
    handlers,
    emitted,
    rooms,
    ...extra,
    on(event, handler) {
      handlers[event] = handler;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    join(room) {
      rooms.add(room);
    },
    leave(room) {
      rooms.delete(room);
    },
    trigger(event, ...args) {
      assert.equal(typeof handlers[event], "function", `handler ${event}`);
      return handlers[event](...args);
    }
  };
}

function crearReloj(inicio = 100000) {
  let actual = inicio;
  let secuencia = 0;
  const timers = new Map();
  const setTimeoutFn = (callback, delay) => {
    const id = ++secuencia;
    timers.set(id, { callback, at: actual + Math.max(0, Number(delay) || 0) });
    return id;
  };
  const clearTimeoutFn = (id) => timers.delete(id);
  const avanzar = (ms) => {
    const destino = actual + ms;
    while (true) {
      const siguiente = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= destino)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!siguiente) break;
      const [id, timer] = siguiente;
      timers.delete(id);
      actual = timer.at;
      timer.callback();
    }
    actual = destino;
  };
  return { avanzar, clearTimeoutFn, now: () => actual, pendientes: () => timers.size, setTimeoutFn };
}

function crearContexto() {
  const io = crearIo();
  const reloj = crearReloj();
  const roles = crearRegistroRoles();
  let tickets = 0;
  let sesiones = 0;
  let comandos = 0;
  const gestor = crearGestorAyudaMusas({
    io,
    obtenerMusaActiva: (socket) => roles.obtenerMusaActiva(socket),
    now: reloj.now,
    setTimeoutFn: reloj.setTimeoutFn,
    clearTimeoutFn: reloj.clearTimeoutFn,
    crearTicketId: () => `ayuda_ticket${String(++tickets).padStart(4, "0")}`,
    crearSessionId: () => `diag_session${String(++sesiones).padStart(4, "0")}`,
    crearCommandId: () => `cmd_command${String(++comandos).padStart(4, "0")}`
  });
  return { gestor, io, reloj, roles };
}

function registrarMusa(roles, socket, { nombre = "LUNA", clientId = socket.id } = {}) {
  const resultado = roles.registrarMusa(socket, { nombre, clientId });
  assert.equal(resultado.ok, true);
  return resultado;
}

function framePayload(ticket, extra = {}) {
  return {
    ticket_id: ticket.ticket_id,
    session_id: ticket.diagnostico.session_id,
    seq: 1,
    mime: "image/jpeg",
    data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64"),
    width: 360,
    height: 720,
    ruta: "/game/public/players/index.html?secreto=1#hash",
    viewport: { width: 390, height: 844 },
    online: true,
    socket_conectado: true,
    ...extra
  };
}

function activarDiagnostico(ctx, musa, ticket, sufijo = "a") {
  const solicitud = ctx.gestor.solicitarDiagnostico({
    ticket_id: ticket.ticket_id,
    request_id: `diag-${sufijo}`
  });
  assert.equal(solicitud.ok, true);
  assert.equal(solicitud.diagnostico.estado, "solicitado");
  const consentimiento = ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: solicitud.diagnostico.session_id,
    aceptar: true,
    request_id: `consent-${sufijo}`
  });
  assert.equal(consentimiento.ok, true);
  assert.equal(consentimiento.aceptado, true);
  return ctx.gestor.payloadControl().tickets.find(({ ticket_id }) => ticket_id === ticket.ticket_id);
}

test("only an active muse can request one authoritative ticket and public state hides technical identity", () => {
  const ctx = crearContexto();
  const luna = crearSocket("socket-luna");
  const sol = crearSocket("socket-sol");
  registrarMusa(ctx.roles, luna, { nombre: "PUTA", clientId: "client-secret-luna" });
  registrarMusa(ctx.roles, sol, { nombre: "SOL", clientId: "client-secret-sol" });

  assert.equal(ctx.gestor.solicitar(crearSocket("intruso"), {}).code, "MUSA_NOT_REGISTERED");
  const falsa = crearSocket("falsa", { musa: luna.musa });
  assert.equal(ctx.gestor.solicitar(falsa, {}).code, "MUSA_SESSION_INACTIVE");

  const primera = ctx.gestor.solicitar(luna, { request_id: "help-luna" });
  const repetida = ctx.gestor.solicitar(luna, { request_id: "help-luna" });
  const segunda = ctx.gestor.solicitar(sol, { request_id: "help-sol" });
  assert.equal(primera.ok, true);
  assert.equal(repetida.ok, true);
  assert.equal(repetida.idempotente, true);
  assert.equal(segunda.ok, true);
  assert.notEqual(primera.ticket.color, segunda.ticket.color);
  assert.equal(ctx.gestor.payloadControl().tickets.length, 2);

  const publico = JSON.stringify(ctx.gestor.payloadControl());
  assert.equal(publico.includes("client-secret"), false);
  assert.equal(publico.includes("socket-luna"), false);
  assert.equal(publico.includes("PUTA"), false);
  assert.equal(primera.ticket.nombre_musa, "MUSA");
  assert.match(primera.ticket.ticket_id, /^ayuda_/);
});

test("a muse can cancel only its own ticket and request cooldown is enforced", () => {
  const ctx = crearContexto();
  const luna = crearSocket("luna");
  const sol = crearSocket("sol");
  registrarMusa(ctx.roles, luna);
  registrarMusa(ctx.roles, sol, { nombre: "SOL" });
  const ticketLuna = ctx.gestor.solicitar(luna, {}).ticket;
  const ticketSol = ctx.gestor.solicitar(sol, {}).ticket;

  assert.equal(ctx.gestor.cancelarMusa(luna, { ticket_id: ticketSol.ticket_id }).code, "TICKET_NOT_OWNED");
  const cancelada = ctx.gestor.cancelarMusa(luna, { ticket_id: ticketLuna.ticket_id });
  assert.equal(cancelada.ok, true);
  assert.equal(ctx.gestor.payloadControl().tickets.length, 1);
  assert.equal(ctx.gestor.payloadControl().historial[0].estado, "cancelado");
  assert.equal(ctx.gestor.solicitar(luna, {}).code, "RATE_LIMITED");
  ctx.reloj.avanzar(3000);
  assert.equal(ctx.gestor.solicitar(luna, {}).ok, true);
});

test("Control alone can attend, resolve or cancel individual tickets through handlers", () => {
  const ctx = crearContexto();
  const musa = crearSocket("musa");
  registrarMusa(ctx.roles, musa);
  const ticket = ctx.gestor.solicitar(musa, {}).ticket;
  const control = crearSocket("control", { control: true });
  const intruso = crearSocket("intruso");
  ctx.gestor.registrarHandlers(control);
  ctx.gestor.registrarHandlers(intruso);

  let ack = null;
  intruso.trigger("ayuda_musa_atender", { ticket_id: ticket.ticket_id }, (payload) => { ack = payload; });
  assert.equal(ack.code, "NOT_AUTHORIZED");
  intruso.trigger("pedir_ayuda_musas_estado", {}, (payload) => { ack = payload; });
  assert.equal(ack.code, "NOT_AUTHORIZED");

  control.trigger("ayuda_musa_atender", {
    ticket_id: ticket.ticket_id,
    request_id: "attend-1"
  }, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(ack.ticket.estado, "atendiendo");

  control.trigger("ayuda_musa_resolver", {
    ticket_id: ticket.ticket_id,
    resolucion: "cancelada",
    request_id: "resolve-1"
  }, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(ack.ticket.estado, "cancelado");
  assert.equal(ctx.gestor.payloadControl().tickets.length, 0);
  assert.equal(ctx.gestor.payloadControl().historial[0].cerrado_ts > 0, true);
});

test("Control alone can clear active and closed incidents and releases every connected muse", () => {
  const ctx = crearContexto();
  const luna = crearSocket("musa-luna");
  const sol = crearSocket("musa-sol");
  registrarMusa(ctx.roles, luna, { nombre: "LUNA" });
  registrarMusa(ctx.roles, sol, { nombre: "SOL" });
  const ticketLuna = ctx.gestor.solicitar(luna, {}).ticket;
  const ticketSol = ctx.gestor.solicitar(sol, {}).ticket;
  activarDiagnostico(ctx, luna, ticketLuna, "clear");
  ctx.gestor.cancelarMusa(sol, { ticket_id: ticketSol.ticket_id });
  assert.equal(ctx.gestor.payloadControl().tickets.length, 1);
  assert.equal(ctx.gestor.payloadControl().historial.length, 1);
  assert.equal(ctx.reloj.pendientes(), 1);

  const control = crearSocket("control-clear", { control: true });
  const intruso = crearSocket("intruso-clear");
  ctx.gestor.registrarHandlers(control);
  ctx.gestor.registrarHandlers(intruso);
  let ack = null;
  intruso.trigger("ayuda_musas_limpiar", { request_id: "clear-forged" }, (payload) => { ack = payload; });
  assert.equal(ack.code, "NOT_AUTHORIZED");

  control.trigger("ayuda_musas_limpiar", { request_id: "clear-all" }, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(ack.eliminadas, 2);
  assert.equal(ack.estado.tickets.length, 0);
  assert.equal(ack.estado.historial.length, 0);
  assert.equal(ctx.gestor.payloadControl().tickets.length, 0);
  assert.equal(ctx.gestor.payloadControl().historial.length, 0);
  assert.equal(ctx.reloj.pendientes(), 0);
  assert.ok(ctx.io.eventos.some(({ room, event }) => (
    room === "musa-luna" && event === "ayuda_musa_diagnostico_detener"
  )));
  const estadoLuna = ctx.io.eventos.find(({ room, event, payload }) => (
    room === "musa-luna" && event === "ayuda_musa_estado" && payload.ticket === null
  ));
  assert.ok(estadoLuna, "the active muse must immediately lose the flag and assistance halo");
});

test("stable reconnect keeps a ticket, stops old diagnostics and reload targets exactly the active socket", () => {
  const ctx = crearContexto();
  const anterior = crearSocket("musa-old");
  registrarMusa(ctx.roles, anterior, { clientId: "stable-client" });
  ctx.gestor.sincronizarMusa(anterior);
  const ticketInicial = ctx.gestor.solicitar(anterior, {}).ticket;
  const activo = activarDiagnostico(ctx, anterior, ticketInicial);
  assert.equal(activo.diagnostico.estado, "activo");

  const nueva = crearSocket("musa-new");
  registrarMusa(ctx.roles, nueva, { clientId: "stable-client" });
  const sync = ctx.gestor.sincronizarMusa(nueva);
  assert.equal(sync.ok, true);
  assert.equal(sync.estado.ticket.ticket_id, ticketInicial.ticket_id);
  assert.equal(sync.estado.ticket.diagnostico.estado, "inactivo");
  ctx.gestor.desconectarMusa(anterior);
  assert.equal(ctx.gestor.payloadControl().tickets[0].conectada, true);

  const recarga = ctx.gestor.recargar({ ticket_id: ticketInicial.ticket_id });
  assert.equal(recarga.ok, true);
  const evento = ctx.io.eventos.find(({ room, event }) => room === "musa-new" && event === "recargar_rol_remoto");
  assert.deepEqual(evento.payload, {
    rol: "musa",
    motivo: "soporte",
    ticket_id: ticketInicial.ticket_id,
    ts: ctx.reloj.now()
  });
  assert.equal(
    ctx.io.eventos.some(({ room, event }) => room === "musa-old" && event === "recargar_rol_remoto"),
    false
  );
  assert.equal(ctx.gestor.recargar({ ticket_id: ticketInicial.ticket_id }).code, "RATE_LIMITED");
});

test("diagnostic requires exact consent, expires and accepts only bounded rate-limited frames", () => {
  const ctx = crearContexto();
  const musa = crearSocket("musa");
  registrarMusa(ctx.roles, musa);
  const ticket = ctx.gestor.solicitar(musa, {}).ticket;
  const solicitud = ctx.gestor.solicitarDiagnostico({ ticket_id: ticket.ticket_id });
  assert.equal(solicitud.ok, true);
  assert.equal(ctx.reloj.pendientes(), 1);
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload({
    ...ticket,
    diagnostico: solicitud.diagnostico
  })).code, "DIAGNOSTIC_NOT_ACTIVE");
  assert.equal(ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: "diag_incorrecta0000",
    aceptar: true
  }).code, "STALE_DIAGNOSTIC");

  const consentimiento = ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: solicitud.diagnostico.session_id,
    aceptar: true
  });
  assert.equal(consentimiento.ok, true);
  const consentimientoRepetido = ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: solicitud.diagnostico.session_id,
    aceptar: true,
    request_id: "consent-retry"
  });
  assert.equal(consentimientoRepetido.ok, true);
  assert.equal(consentimientoRepetido.idempotente, true);
  const activo = ctx.gestor.payloadControl().tickets[0];
  const frame = ctx.gestor.recibirFrame(musa, framePayload(activo));
  assert.equal(frame.ok, true);
  const reenviado = ctx.io.eventos.find(({ event }) => event === "ayuda_musa_diagnostico_frame");
  assert.equal(reenviado.room, AYUDA_CONTROL_ROOM);
  assert.equal(reenviado.payload.ruta, "/game/public/players/index.html");
  assert.deepEqual(reenviado.payload.viewport, { width: 390, height: 844 });
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload(activo, { seq: 2 })).code, "RATE_LIMITED");
  ctx.reloj.avanzar(250);
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload(activo, { seq: 1 })).code, "STALE_FRAME");
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload(activo, { seq: 2, mime: "text/html" })).code, "INVALID_FRAME_MIME");
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload(activo, {
    seq: 2,
    data: Buffer.alloc(MAX_FRAME_BYTES + 1).toString("base64")
  })).code, "FRAME_TOO_LARGE");
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload(activo, {
    seq: 2,
    data: Buffer.from("not-an-image").toString("base64")
  })).code, "INVALID_FRAME_SIGNATURE");

  ctx.reloj.avanzar(5 * 60 * 1000);
  assert.equal(ctx.gestor.payloadControl().tickets[0].diagnostico.estado, "inactivo");
  assert.equal(ctx.gestor.recibirFrame(musa, framePayload(activo, { seq: 3 })).code, "DIAGNOSTIC_NOT_ACTIVE");
});

test("rejected consent and disconnected muses cannot be observed", () => {
  const ctx = crearContexto();
  const musa = crearSocket("musa");
  registrarMusa(ctx.roles, musa);
  ctx.gestor.sincronizarMusa(musa);
  const ticket = ctx.gestor.solicitar(musa, {}).ticket;
  let solicitud = ctx.gestor.solicitarDiagnostico({ ticket_id: ticket.ticket_id });
  const rechazo = ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: solicitud.diagnostico.session_id,
    aceptar: false
  });
  assert.equal(rechazo.ok, true);
  assert.equal(rechazo.aceptado, false);
  assert.equal(ctx.gestor.payloadControl().tickets[0].diagnostico.estado, "inactivo");

  solicitud = ctx.gestor.solicitarDiagnostico({
    ticket_id: ticket.ticket_id,
    request_id: "segunda"
  });
  assert.equal(solicitud.ok, true);
  assert.equal(ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: solicitud.diagnostico.session_id,
    aceptar: true
  }).ok, true);
  assert.equal(ctx.gestor.consentirDiagnostico(musa, {
    ticket_id: ticket.ticket_id,
    session_id: solicitud.diagnostico.session_id,
    aceptar: false
  }).aceptado, false);
  assert.equal(ctx.gestor.payloadControl().tickets[0].diagnostico.estado, "inactivo");

  solicitud = ctx.gestor.solicitarDiagnostico({
    ticket_id: ticket.ticket_id,
    request_id: "tercera"
  });
  assert.equal(solicitud.ok, true);
  ctx.gestor.desconectarMusa(musa);
  assert.equal(ctx.gestor.payloadControl().tickets[0].conectada, false);
  assert.equal(ctx.gestor.payloadControl().tickets[0].diagnostico.estado, "inactivo");
  assert.equal(ctx.gestor.solicitarDiagnostico({ ticket_id: ticket.ticket_id }).code, "MUSA_DISCONNECTED");
});

test("remote control is allowlisted, bounded, exact-targeted and reports execution", () => {
  const ctx = crearContexto();
  const musa = crearSocket("musa-target");
  registrarMusa(ctx.roles, musa);
  const ticket = ctx.gestor.solicitar(musa, {}).ticket;
  const activo = activarDiagnostico(ctx, musa, ticket);
  const base = {
    ticket_id: ticket.ticket_id,
    session_id: activo.diagnostico.session_id
  };

  assert.equal(ctx.gestor.comandoRemoto({ ...base, tipo: "script", codigo: "alert(1)" }).code, "COMMAND_NOT_ALLOWED");
  assert.equal(ctx.gestor.comandoRemoto({ ...base, tipo: "tap", x: "no", y: 0.5 }).code, "INVALID_COMMAND");
  const tap = ctx.gestor.comandoRemoto({ ...base, tipo: "tap", x: 2, y: -1 });
  assert.equal(tap.ok, true);
  const tapEvent = ctx.io.eventos.find(({ event }) => event === "ayuda_musa_comando_remoto");
  assert.equal(tapEvent.room, "musa-target");
  assert.deepEqual(
    { tipo: tapEvent.payload.tipo, x: tapEvent.payload.x, y: tapEvent.payload.y },
    { tipo: "tap", x: 1, y: 0 }
  );
  const scroll = ctx.gestor.comandoRemoto({ ...base, tipo: "scroll", delta_y: 5000 });
  assert.equal(scroll.ok, true);
  const scrollEvent = ctx.io.eventos.filter(({ event }) => event === "ayuda_musa_comando_remoto").at(-1);
  assert.equal(scrollEvent.payload.delta_y, 1200);
  assert.equal(ctx.gestor.comandoRemoto({ ...base, tipo: "back" }).ok, true);
  assert.equal(ctx.gestor.comandoRemoto({ ...base, tipo: "reconnect" }).ok, true);

  const resultado = ctx.gestor.comandoRemoto({ ...base, tipo: "tap", x: 0.2, y: 0.3 });
  const ack = ctx.gestor.comandoRemoto;
  assert.equal(typeof ack, "function");
  const reportado = ctx.gestor.payloadControl().tickets[0];
  const resultadoAck = ctx.gestor.registrarHandlers;
  assert.equal(typeof resultadoAck, "function");
  // El resultado se prueba por el handler público para cubrir la autorización
  // de la musa además de la correlación opaca del comando.
  ctx.gestor.registrarHandlers(musa);
  let respuesta = null;
  musa.trigger("ayuda_musa_comando_resultado", {
    ...base,
    command_id: resultado.command_id,
    ok: true,
    detalle: "ejecutado"
  }, (payload) => { respuesta = payload; });
  assert.equal(respuesta.ok, true);
  assert.equal(reportado.diagnostico.estado, "activo");
  const controlResultado = ctx.io.eventos.find(({ event, payload }) => (
    event === "ayuda_musa_comando_resultado" && payload.command_id === resultado.command_id
  ));
  assert.equal(controlResultado.room, AYUDA_CONTROL_ROOM);
  assert.equal(controlResultado.payload.detalle, "ejecutado");
});

test("handlers expose exact muse state and reject forged control and diagnostic actions", () => {
  const ctx = crearContexto();
  const musa = crearSocket("musa");
  const intruso = crearSocket("intruso");
  registrarMusa(ctx.roles, musa);
  ctx.gestor.registrarHandlers(musa);
  ctx.gestor.registrarHandlers(intruso);
  let ack = null;
  musa.trigger("pedir_ayuda_musa_estado", {}, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(ack.estado.ticket, null);
  musa.trigger("ayuda_musa_solicitar", { request_id: "handler-request" }, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(ack.estado_musa.ticket.ticket_id, ack.ticket.ticket_id);
  intruso.trigger("ayuda_musa_diagnostico_frame", {
    ticket_id: ack.ticket.ticket_id,
    session_id: "diag_forged0000",
    seq: 1,
    mime: "image/jpeg",
    data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"),
    width: 10,
    height: 10
  }, (payload) => { ack = payload; });
  assert.equal(ack.code, "MUSA_NOT_REGISTERED");
  intruso.trigger("ayuda_musa_recargar", { ticket_id: "ayuda_forged0000" }, (payload) => { ack = payload; });
  assert.equal(ack.code, "NOT_AUTHORIZED");
});

test("a read-only Control monitor never joins or receives the private support room", () => {
  const ctx = crearContexto();
  const monitor = crearSocket("monitor", {
    monitor_pantalla_solicitada: true,
    monitor_pantalla: { rol: "control", player: null }
  });
  const control = crearSocket("control", { control: true });
  ctx.gestor.registrarHandlers(monitor);
  ctx.gestor.registrarHandlers(control);
  let ack = null;
  monitor.trigger("pedir_ayuda_musas_estado", {}, (payload) => { ack = payload; });
  assert.equal(ack.code, "NOT_AUTHORIZED");
  assert.equal(monitor.rooms.has(AYUDA_CONTROL_ROOM), false);

  control.trigger("pedir_ayuda_musas_estado", {}, (payload) => { ack = payload; });
  assert.equal(ack.ok, true);
  assert.equal(control.rooms.has(AYUDA_CONTROL_ROOM), true);
  assert.equal(
    ctx.io.eventos.every(({ room }) => room !== "role_control"),
    true
  );
});

test("explicit test reset clears support state, while ordinary lifecycle code need not own it", () => {
  const ctx = crearContexto();
  const musa = crearSocket("musa-reset");
  registrarMusa(ctx.roles, musa);
  const ticket = ctx.gestor.solicitar(musa, {}).ticket;
  activarDiagnostico(ctx, musa, ticket, "reset");
  assert.equal(ctx.gestor.payloadControl().tickets.length, 1);
  assert.equal(ctx.reloj.pendientes(), 1);

  const estado = ctx.gestor.reset();
  assert.equal(estado.tickets.length, 0);
  assert.equal(estado.historial.length, 0);
  assert.equal(ctx.reloj.pendientes(), 0);
});
