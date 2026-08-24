const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_TEXTO_PRE_SHOW,
  crearGestorPreShowMusas,
  longitudUnicode,
  normalizarRequestId,
  normalizarTextoPreShow
} = require("../pre_show_musas.js");
const { crearRegistroRoles, ROLE_ROOMS } = require("../role_connections.js");

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

function crearSocket(id) {
  const handlers = {};
  const emitted = [];
  const rooms = new Set();
  return {
    id,
    handlers,
    emitted,
    rooms,
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
      return handlers[event](...args);
    }
  };
}

function crearContexto({ now = () => Date.now(), contieneOfensa, ...opciones } = {}) {
  const io = crearIo();
  const roles = crearRegistroRoles();
  const gestor = crearGestorPreShowMusas({
    io,
    now,
    contieneOfensa,
    obtenerMusaActiva: (socket) => roles.obtenerMusaActiva(socket),
    ...opciones
  });
  return { gestor, io, roles };
}

function registrarMusa(roles, socket, { nombre = "LUNA", clientId = socket.id } = {}) {
  const resultado = roles.registrarMusa(socket, { nombre, clientId });
  assert.equal(resultado.ok, true);
  return resultado;
}

function enviar(gestor, socket, entrada = {}) {
  const estado = gestor.payload();
  return gestor.procesarEnvio(socket, {
    session_id: estado.session_id,
    phase_seq: estado.phase_seq,
    ...entrada
  });
}

test("pre-show normalizes Unicode text and removes invisible, control and HTML delimiters", () => {
  assert.equal(
    normalizarTextoPreShow("  Ｈｏｌａ\u200b\n <b>mundo</b>\u0000  "),
    "Hola mundo"
  );
  assert.equal(normalizarTextoPreShow({ texto: "hola" }), "");
  assert.equal(longitudUnicode("🎭🎭"), 2);
  assert.equal(normalizarRequestId(" abc/../DEF_1 "), "abcDEF_1");
});

test("pre-show accepts only the exact active muse and publishes a sanitized snapshot to spectators", () => {
  let reloj = 1000;
  const { gestor, io, roles } = crearContexto({ now: () => reloj, contieneOfensa: () => false });
  const musa = crearSocket("musa-1");
  registrarMusa(roles, musa, { nombre: "LUNA", clientId: "luna-client" });

  const resultado = enviar(gestor, musa, {
    texto: "  Hola\n <em>público</em>  ",
    client_id: "identidad-falsificada",
    request_id: "req-1"
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.id, "pre-1");
  assert.equal(resultado.request_id, "req-1");
  assert.equal(resultado.session_id, gestor.payload().session_id);
  assert.equal(resultado.phase_seq, gestor.payload().phase_seq);
  assert.deepEqual(gestor.payload().mensajes, [{
    id: "pre-1",
    texto: "Hola público",
    nombre_musa: "LUNA",
    equipo: musa.musa,
    creado_en: 1000
  }]);
  const espectador = io.eventos.filter(({ room }) => room === ROLE_ROOMS.SPECTATOR);
  assert.equal(espectador.length, 1);
  assert.equal(espectador[0].event, "pre_show_estado");
  assert.equal(espectador[0].payload.mensajes[0].texto, "Hola público");

  const falso = crearSocket("falso");
  falso.musa = 1;
  assert.deepEqual(
    enviar(gestor, falso, { texto: "intento" }).code,
    "MUSA_SESSION_INACTIVE"
  );
  assert.equal(gestor.payload().mensajes.length, 1);
  reloj += 3000;
});

test("pre-show rejects multilingual profanity and never echoes rejected text", () => {
  const { gestor, roles } = crearContexto();
  const musa = crearSocket("musa-offensive");
  registrarMusa(roles, musa);

  ["puta", "f u c k", "connard", "блядь", "개새끼"].forEach((texto, indice) => {
    const resultado = enviar(gestor, musa, {
      texto,
      request_id: `ofensa-${indice}`
    });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.code, "OFFENSIVE_TEXT");
    assert.equal(JSON.stringify(resultado).includes(texto), false);
  });
  assert.deepEqual(gestor.payload().mensajes, []);
});

test("pre-show enforces Unicode length before publishing", () => {
  const { gestor, roles } = crearContexto({ contieneOfensa: () => false });
  const musa = crearSocket("musa-long");
  registrarMusa(roles, musa);

  const exacto = "🎭".repeat(MAX_TEXTO_PRE_SHOW);
  assert.equal(enviar(gestor, musa, { texto: exacto }).ok, true);
  gestor.abrir();
  assert.deepEqual(
    enviar(gestor, musa, { texto: `${exacto}🎭` }).code,
    "TEXT_TOO_LONG"
  );
  gestor.abrir();
  assert.equal(
    enviar(gestor, musa, { texto: " \u200b".repeat((MAX_TEXTO_PRE_SHOW * 16) + 1) }).code,
    "TEXT_TOO_LONG"
  );
});

test("pre-show is idempotent by active identity and request id", () => {
  let reloj = 1000;
  const { gestor, roles } = crearContexto({ now: () => reloj, contieneOfensa: () => false });
  const musa = crearSocket("musa-idempotent");
  registrarMusa(roles, musa, { clientId: "stable-client" });

  const primero = enviar(gestor, musa, { texto: "Primero", request_id: "stable-1" });
  const repetido = enviar(gestor, musa, { texto: "contenido distinto", request_id: "stable-1" });
  assert.deepEqual(repetido, { ...primero, idempotente: true });
  assert.equal(gestor.payload().mensajes.length, 1);

  const reconectada = crearSocket("musa-idempotent-new");
  registrarMusa(roles, reconectada, { clientId: "stable-client" });
  const retryReconexion = enviar(gestor, reconectada, {
    texto: "tampoco se vuelve a publicar",
    request_id: "stable-1"
  });
  assert.deepEqual(retryReconexion, { ...primero, idempotente: true });
  assert.equal(gestor.payload().mensajes.length, 1);

  musa.musa = 1;
  assert.equal(enviar(gestor, musa, { texto: "forjado" }).code, "MUSA_SESSION_INACTIVE");
  reloj += 1;
});

test("pre-show rejects stale sessions and phases before moderation or publication", () => {
  let sessionSeq = 0;
  const { gestor, roles } = crearContexto({
    contieneOfensa: () => false,
    crearSessionId: () => `session-${++sessionSeq}`
  });
  const musa = crearSocket("musa-phase");
  registrarMusa(roles, musa);
  const inicial = gestor.payload();

  assert.equal(gestor.procesarEnvio(musa, { texto: "sin fase" }).code, "STALE_SESSION");
  assert.equal(gestor.procesarEnvio(musa, {
    texto: "sesión vieja",
    session_id: "otra",
    phase_seq: inicial.phase_seq
  }).code, "STALE_SESSION");
  assert.equal(gestor.procesarEnvio(musa, {
    texto: "fase vieja",
    session_id: inicial.session_id,
    phase_seq: inicial.phase_seq + 1
  }).code, "STALE_PHASE");
  assert.equal(enviar(gestor, musa, { texto: "válido" }).ok, true);

  gestor.abrir();
  const nueva = gestor.payload();
  assert.equal(nueva.session_id, "session-2");
  assert.equal(nueva.phase_seq, inicial.phase_seq + 1);
  assert.equal(gestor.procesarEnvio(musa, {
    texto: "replay de sesión anterior",
    session_id: inicial.session_id,
    phase_seq: inicial.phase_seq,
    request_id: "replay"
  }).code, "STALE_SESSION");
  assert.deepEqual(gestor.payload().mensajes, []);

  gestor.cerrar("tutorial");
  assert.equal(gestor.procesarEnvio(musa, {
    texto: "paquete tardío",
    session_id: nueva.session_id,
    phase_seq: nueva.phase_seq
  }).code, "STALE_PHASE");
});

test("pre-show rate limits the socket even if it re-registers with a different client id", () => {
  let reloj = 0;
  const { gestor, roles } = crearContexto({ now: () => reloj, contieneOfensa: () => false });
  const musa = crearSocket("musa-socket-bucket");
  registrarMusa(roles, musa, { clientId: "identidad-a" });
  assert.equal(enviar(gestor, musa, { texto: "primero" }).ok, true);

  roles.registrarMusa(musa, { nombre: "LUNA", clientId: "identidad-b" });
  reloj = 1000;
  assert.equal(enviar(gestor, musa, { texto: "segundo" }).code, "RATE_LIMITED");
});

test("pre-show replaces an offensive public muse name without echoing it", () => {
  const { gestor, roles } = crearContexto();
  const musa = crearSocket("musa-name");
  registrarMusa(roles, musa, { nombre: "PUTA", clientId: "name-client" });

  const resultado = enviar(gestor, musa, { texto: "Mensaje limpio" });
  assert.equal(resultado.ok, true);
  assert.equal(gestor.payload().mensajes[0].nombre_musa, "MUSA");
  assert.equal(JSON.stringify(gestor.payload()).includes("PUTA"), false);
});

test("pre-show applies cooldown, duplicate and rolling-window anti-spam across reconnects", () => {
  let reloj = 0;
  const { gestor, roles } = crearContexto({ now: () => reloj, contieneOfensa: () => false });
  const musa = crearSocket("musa-rate");
  registrarMusa(roles, musa, { clientId: "rate-client" });

  assert.equal(enviar(gestor, musa, { texto: "mensaje 0" }).ok, true);
  reloj = 1000;
  const cooldown = enviar(gestor, musa, { texto: "mensaje 1" });
  assert.equal(cooldown.code, "RATE_LIMITED");
  assert.equal(cooldown.retry_after_ms, 1500);

  reloj = 2500;
  assert.equal(enviar(gestor, musa, { texto: "mensaje 0" }).code, "DUPLICATE_MESSAGE");

  for (let indice = 1; indice <= 5; indice += 1) {
    reloj = 2500 + (indice * 2500);
    assert.equal(enviar(gestor, musa, { texto: `mensaje ${indice}` }).ok, true);
  }
  reloj = 15000;
  const ventana = enviar(gestor, musa, { texto: "mensaje 6" });
  assert.equal(ventana.code, "RATE_LIMITED");
  assert.equal(ventana.retry_after_ms, 15000);

  const reconectada = crearSocket("musa-rate-new");
  registrarMusa(roles, reconectada, { clientId: "rate-client" });
  assert.equal(
    enviar(gestor, reconectada, { texto: "reconectar no elude el límite" }).code,
    "RATE_LIMITED"
  );
});

test("pre-show caps invalid attempts and retained messages", () => {
  let reloj = 0;
  const { gestor, roles } = crearContexto({
    now: () => reloj,
    contieneOfensa: () => false,
    maxMensajes: 2,
    cooldownMs: 0
  });
  const musa = crearSocket("musa-cap");
  registrarMusa(roles, musa);

  for (let indice = 0; indice < 10; indice += 1) {
    reloj += 1;
    assert.equal(enviar(gestor, musa, { texto: "" }).code, "INVALID_TEXT");
  }
  reloj += 1;
  assert.equal(enviar(gestor, musa, { texto: "bloqueado" }).code, "RATE_LIMITED");

  reloj = 11000;
  ["uno", "dos", "tres"].forEach((texto) => {
    reloj += 1;
    assert.equal(enviar(gestor, musa, { texto }).ok, true);
  });
  assert.deepEqual(gestor.payload().mensajes.map(({ texto }) => texto), ["dos", "tres"]);
});

test("closing pre-show atomically clears state and rejects a late message; reset opens a clean lobby", () => {
  const { gestor, io, roles } = crearContexto({ contieneOfensa: () => false });
  const musa = crearSocket("musa-close");
  registrarMusa(roles, musa);
  assert.equal(enviar(gestor, musa, { texto: "antes" }).ok, true);

  gestor.cerrar("tutorial");
  assert.deepEqual(gestor.payload().mensajes, []);
  assert.equal(gestor.payload().activo, false);
  assert.deepEqual(
    enviar(gestor, musa, { texto: "llegó tarde", request_id: "late" }).code,
    "NOT_ACTIVE"
  );
  assert.equal(io.eventos.at(-3).payload.activo, false);
  assert.deepEqual(io.eventos.at(-3).payload.mensajes, []);

  gestor.abrir();
  assert.equal(gestor.payload().activo, true);
  assert.deepEqual(gestor.payload().mensajes, []);
  assert.equal(enviar(gestor, musa, { texto: "nueva sesión" }).ok, true);
});

test("socket handlers ACK without echo and synchronize only registered muses or spectators", () => {
  const { gestor, roles } = crearContexto({ contieneOfensa: () => false });
  const musa = crearSocket("musa-handler");
  const espectador = crearSocket("spectator-handler");
  const intruso = crearSocket("intruder-handler");
  registrarMusa(roles, musa);
  espectador.espectador = true;
  [musa, espectador, intruso].forEach((socket) => gestor.registrarHandlers(socket));

  let ack = null;
  const fase = gestor.payload();
  musa.trigger("pre_show_musa_enviar", {
    texto: "hola",
    request_id: "handler-1",
    session_id: fase.session_id,
    phase_seq: fase.phase_seq
  }, (resultado) => {
    ack = resultado;
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.id, "pre-1");
  assert.equal(ack.request_id, "handler-1");

  let estadoAck = null;
  espectador.trigger("pedir_pre_show_estado", {}, (resultado) => {
    estadoAck = resultado;
  });
  assert.equal(estadoAck.ok, true);
  assert.equal(estadoAck.estado.mensajes.length, 1);
  assert.equal(espectador.emitted.at(-1).event, "pre_show_estado");

  let rechazo = null;
  intruso.trigger("pedir_pre_show_estado", {}, (resultado) => {
    rechazo = resultado;
  });
  assert.deepEqual(rechazo, { ok: false, code: "NOT_AUTHORIZED" });
  assert.equal(intruso.emitted.length, 0);
});
