const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { registrarCanalesGenerales } = require("../general_channels.js");
const { crearGestorSincronizacionPartida } = require("../partida_sync.js");
const { crearGestorAccesoRoles } = require("../role_access.js");

function crearSocket() {
  const socket = new EventEmitter();
  socket.id = "writer-stale";
  socket.escritxr = 1;
  socket.emitidos = [];
  const originalEmit = socket.emit.bind(socket);
  socket.emit = (event, payload, ack) => {
    if (socket.listenerCount(event) > 0) {
      return originalEmit(event, payload, ack);
    }
    socket.emitidos.push({ event, payload });
    return true;
  };
  return socket;
}

test("inactive writer sessions cannot adjust writer time", () => {
  const socket = crearSocket();
  const ioEvents = [];
  const partidaSync = crearGestorSincronizacionPartida();
  partidaSync.guardarConteo(1, {
    modo_seq: 0,
    count_seq: 1,
    tiempo_seq: 0,
    count_seconds: 10,
    count_text: "00:10"
  });

  registrarCanalesGenerales({
    socket,
    io: {
      emit(event, payload) {
        ioEvents.push({ event, payload });
      }
    },
    passwordRoles: "pass",
    obtenerEstadoEscritores: () => ({}),
    obtenerIdJugadorValido: (player) => (Number(player) === 1 ? 1 : null),
    getModoActual: () => "palabras bonus",
    partidaSync,
    construirPayloadCount: (payload) => payload,
    sesionesEscritor: { esActiva: () => false }
  });

  socket.emit("aumentar_tiempo", { player: 1, secs: 2 });

  assert.deepEqual(ioEvents, []);
  assert.equal(partidaSync.obtenerConteo(1).count_seconds, 10);
});

test("password validation returns a temporary access token without echoing the password", () => {
  const socket = crearSocket();
  socket.handshake = { address: "127.0.0.1" };
  const accesoRoles = crearGestorAccesoRoles({
    passwordRoles: "secreta",
    crearToken: () => "token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  });
  registrarCanalesGenerales({
    socket,
    io: { emit() {} },
    passwordRoles: "secreta",
    accesoRoles,
    obtenerEstadoEscritores: () => ({}),
    obtenerIdJugadorValido: () => null,
    partidaSync: crearGestorSincronizacionPartida(),
    construirPayloadCount: (payload) => payload
  });

  let respuesta = null;
  socket.emit("validar_password_roles", { password: "secreta" }, (payload) => {
    respuesta = payload;
  });
  assert.equal(respuesta.ok, true);
  assert.match(respuesta.access_token, /^token_/);
  assert.equal(respuesta.expires_ts > Date.now(), true);
  assert.equal(JSON.stringify(respuesta).includes("secreta"), false);
});

test("control can remotely reload a targeted role page", () => {
  const socket = crearSocket();
  socket.control = true;
  const roomEvents = [];

  registrarCanalesGenerales({
    socket,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            roomEvents.push({ room, event, payload });
          }
        };
      },
      emit() {}
    },
    passwordRoles: "pass",
    obtenerEstadoEscritores: () => ({}),
    obtenerIdJugadorValido: () => null,
    partidaSync: crearGestorSincronizacionPartida(),
    construirPayloadCount: (payload) => payload
  });

  socket.emit("reiniciar_rol_remoto", { rol: "actorxs2" });
  socket.emit("reiniciar_rol_remoto", { rol: "jury" });

  assert.equal(roomEvents.length, 2);
  assert.equal(roomEvents[0].room, "role_actor_2");
  assert.equal(roomEvents[0].event, "recargar_rol_remoto");
  assert.equal(roomEvents[0].payload.rol, "actorxs2");
  assert.equal(roomEvents[1].room, "role_jurado");
  assert.equal(roomEvents[1].event, "recargar_rol_remoto");
  assert.equal(roomEvents[1].payload.rol, "jurado");
});

test("non-control sockets cannot remotely reload role pages", () => {
  const socket = crearSocket();
  const roomEvents = [];

  registrarCanalesGenerales({
    socket,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            roomEvents.push({ room, event, payload });
          }
        };
      },
      emit() {}
    },
    passwordRoles: "pass",
    obtenerEstadoEscritores: () => ({}),
    obtenerIdJugadorValido: () => null,
    partidaSync: crearGestorSincronizacionPartida(),
    construirPayloadCount: (payload) => payload
  });

  socket.emit("reiniciar_rol_remoto", { rol: "espectador" });

  assert.deepEqual(roomEvents, []);
});

test("control state updates are persisted only from registered control sockets", () => {
  const socket = crearSocket();
  const ioEvents = [];
  let stored = null;
  const controlState = {
    actualizar(payload) {
      stored = payload;
      return payload;
    },
    emitir(destino) {
      const payload = stored || { borrar_texto: false };
      if (destino && typeof destino.emit === "function") {
        destino.emit("control_estado", payload);
      } else {
        ioEvents.push({ event: "control_estado", payload });
      }
      return payload;
    }
  };

  registrarCanalesGenerales({
    socket,
    io: { emit() {} },
    passwordRoles: "pass",
    obtenerEstadoEscritores: () => ({}),
    obtenerIdJugadorValido: () => null,
    partidaSync: crearGestorSincronizacionPartida(),
    construirPayloadCount: (payload) => payload,
    controlState
  });

  socket.emit("control_estado_actualizar", { borrar_texto: true });
  assert.equal(stored, null);

  socket.control = true;
  socket.emit("control_estado_actualizar", { borrar_texto: true });

  assert.deepEqual(stored, { borrar_texto: true });
  assert.deepEqual(ioEvents, [{ event: "control_estado", payload: { borrar_texto: true } }]);
});

test("control can request muse word status and health ping includes it", () => {
  const socket = crearSocket();
  const payloadPalabrasMusas = {
    modo_actual: "palabras bonus",
    players: {
      1: { player: 1, activa: true, cola: 2, tiempo_restante_ms: 4000 },
      2: { player: 2, activa: false, cola: 0, tiempo_restante_ms: 0 }
    }
  };
  const estadoBase = { players: { j1: true, j2: false }, connections: {} };
  let emitidosDirectos = 0;

  registrarCanalesGenerales({
    socket,
    io: { emit() {} },
    passwordRoles: "pass",
    obtenerEstadoEscritores: () => ({ ...estadoBase }),
    obtenerIdJugadorValido: () => null,
    partidaSync: crearGestorSincronizacionPartida(),
    construirPayloadCount: (payload) => payload,
    emitirEstadoPalabrasMusasControl(destino) {
      emitidosDirectos += 1;
      destino.emit("estado_palabras_musas_control", payloadPalabrasMusas);
    },
    payloadEstadoPalabrasMusasControl: () => payloadPalabrasMusas
  });

  socket.emit("pedir_estado_palabras_musas_control");
  assert.equal(emitidosDirectos, 1);
  assert.deepEqual(socket.emitidos.at(-1), {
    event: "estado_palabras_musas_control",
    payload: payloadPalabrasMusas
  });

  let estadoHealth = null;
  socket.emit("health_ping", {}, (estado) => {
    estadoHealth = estado;
  });

  assert.deepEqual(estadoHealth, {
    ...estadoBase,
    palabras_musas_control: payloadPalabrasMusas
  });
});

test("giant timer delegates to the persistent show manager", () => {
  const socket = crearSocket();
  const ioEvents = [];
  const calls = [];
  const temporizadorShow = {
    emitir(destino) {
      calls.push(["emitir", destino === socket]);
      destino.emit("temporizador_gigante_estado", { estado: "oculto", mostrar: false });
    },
    iniciar(duracion) {
      calls.push(["iniciar", duracion]);
      return { estado: "activo", mostrar: true, duracion, fin_ts: 50_000 };
    },
    detener() {
      calls.push(["detener"]);
      return { estado: "oculto", mostrar: false };
    }
  };

  registrarCanalesGenerales({
    socket,
    io: { emit(event, payload) { ioEvents.push({ event, payload }); } },
    passwordRoles: "pass",
    obtenerEstadoEscritores: () => ({}),
    obtenerIdJugadorValido: () => null,
    partidaSync: crearGestorSincronizacionPartida(),
    construirPayloadCount: (payload) => payload,
    temporizadorShow
  });

  socket.emit("activar_temporizador_gigante", { duracion: 75 });
  socket.emit("temporizador_gigante_detener");

  assert.deepEqual(calls, [
    ["emitir", true],
    ["iniciar", 75],
    ["detener"]
  ]);
  assert.deepEqual(ioEvents.map(({ event }) => event), [
    "temporizador_gigante_inicio",
    "temporizador_gigante_detener"
  ]);
});
