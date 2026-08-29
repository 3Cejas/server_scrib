const test = require("node:test");
const assert = require("node:assert/strict");

const { crearSincronizadorConexion } = require("../connection_sync.js");

function crearSocket({ dramaturgia = false, escritxr = null, espectador = false, jurado = false, monitor = null } = {}) {
  const eventos = [];
  return {
    dramaturgia,
    escritxr,
    espectador,
    jurado,
    monitor_pantalla: monitor,
    eventos,
    emit(event, payload) {
      eventos.push({ event, payload });
    }
  };
}

function crearSincronizador({ modo = "", llamadas = [], restaurar = null, conteos = null } = {}) {
  return crearSincronizadorConexion({
    writerChannels: {
      emitirTextos(socket) {
        socket.emit("texto1", { text: "uno" });
        socket.emit("texto2", { text: "dos" });
      },
      getTextoHtml: () => ""
    },
    resurreccion: {
      sincronizarSocket(socket) {
        socket.emit("resucitar_menu", { player: 1 });
      }
    },
    emitirEstadoVotacionVentaja(_override, socket) {
      socket.emit("votacion_ventaja_estado", { activa: false });
    },
    emitirNubeInspiracionEstado(socket) {
      socket.emit("nube_inspiracion_estado", { equipos: {} });
    },
    teleprompter: {
      emitirEstado(socket) {
        socket.emit("teleprompter_state", { state: {} });
      }
    },
    emitirEstadoDramaturgia(socket) {
      socket.emit("dramaturgia_estado", { schema_version: 1 });
    },
    emitirEstadoPalabrasMusasControl(socket) {
      socket.emit("estado_palabras_musas_control", { players: {} });
    },
    emitirEstadoDesventajasActivas(socket) {
      llamadas.push("desventajas");
      socket.emit("desventaja_activa_estado", {});
    },
    emitirEstadoPreShow(socket) {
      socket.emit("pre_show_estado", {
        activo: true,
        session_id: "session-test",
        phase_seq: 1,
        mensajes: []
      });
    },
    emitirEstadoVideoTutorial(socket) {
      socket.emit("video_tutorial_estado", {
        activo: true,
        session_id: "video-session-test",
        phase_seq: 1,
        reproduccion_seq: 0,
        reproduciendo: false
      });
    },
    partidaSync: {
      withModoSeq: (payload) => ({ ...payload, modo_seq: 7 }),
      obtenerConteo: (player) => conteos && conteos[player] ? conteos[player] : null,
      formatearTextoCountDesdeSegundos: (seconds) => {
        const total = Math.max(0, Math.trunc(Number(seconds) || 0));
        if (total <= 0) return "¡Tiempo!";
        return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      },
      construirPayloadCount: (payload) => ({ ...payload, modo_seq: 7 })
    },
    getModoActual: () => modo,
    construirPayloadInspiracionMusaActual: () => ({ modo_actual: modo, modo_seq: 7 }),
    emitirActivarModo(payload, socket) {
      llamadas.push("activar");
      socket.emit("activar_modo", payload);
    },
    sincroModos(socket) {
      llamadas.push("sincro");
      socket.emit("modo_actual", { modo_actual: modo, modo_seq: 7 });
    },
    emitirTempModos(socket) {
      llamadas.push("temp");
      socket.emit("temp_modos", { modo_actual: modo, modo_seq: 7 });
    },
    obtenerIdJugadorValido: (valor) => {
      const id = Number(valor);
      return id === 1 || id === 2 ? id : null;
    },
    emitirEstadoCalentamientoMusa() {},
    emitirEntregaInspiracionActiva(player, socket) {
      if (typeof restaurar === "function") {
        llamadas.push("restaurar");
        return restaurar(player, socket);
      }
      return null;
    }
  });
}

test("dramaturgy receives its full snapshot before ordinary sync even when no mode is active", () => {
  const llamadas = [];
  const socket = crearSocket({ dramaturgia: true });
  const sincronizador = crearSincronizador({ modo: "", llamadas });

  sincronizador.sincronizarSocketRecienConectado(socket);

  assert.equal(socket.eventos[0].event, "dramaturgia_estado");
  assert.deepEqual(socket.eventos.at(-1), {
    event: "modo_actual",
    payload: { modo_actual: "", modo_seq: 7 }
  });
  assert.deepEqual(llamadas, []);
});

test("ordinary roles do not receive the dramaturgy snapshot", () => {
  const socket = crearSocket();
  const sincronizador = crearSincronizador({ modo: "" });

  sincronizador.sincronizarSocketRecienConectado(socket);

  assert.equal(
    socket.eventos.some(({ event }) => event === "dramaturgia_estado"),
    false
  );
  assert.equal(
    socket.eventos.some(({ event }) => event === "modo_actual"),
    true
  );
  assert.equal(
    socket.eventos.some(({ event }) => event === "pre_show_estado"),
    true
  );
  assert.equal(
    socket.eventos.some(({ event }) => event === "video_tutorial_estado"),
    true
  );
});

test("muse role sync receives the authoritative video sequence after registration", () => {
  const socket = crearSocket();
  socket.musa = 1;
  const sincronizador = crearSincronizador({ modo: "" });

  sincronizador.sincronizarEstadoMusa(socket);

  const video = socket.eventos.find(({ event }) => event === "video_tutorial_estado");
  assert.deepEqual(video.payload, {
    activo: true,
    session_id: "video-session-test",
    phase_seq: 1,
    reproduccion_seq: 0,
    reproduciendo: false
  });
});

test("active-mode sync keeps dramaturgy snapshot first and then sends live deltas", () => {
  const llamadas = [];
  const socket = crearSocket({ dramaturgia: true });
  const sincronizador = crearSincronizador({ modo: "tertulia", llamadas });

  sincronizador.sincronizarSocketRecienConectado(socket);

  assert.equal(socket.eventos[0].event, "dramaturgia_estado");
  assert.deepEqual(llamadas, ["activar", "sincro", "temp", "desventajas"]);
  assert.equal(socket.eventos.some(({ event }) => event === "post-inicio"), true);
});

test("writer reconnection restores the active delivery after mode sync without advancing it", () => {
  const llamadas = [];
  let restores = 0;
  const socket = crearSocket({ escritxr: 1 });
  const sincronizador = crearSincronizador({
    modo: "palabras bonus",
    llamadas,
    restaurar(player, socketDestino) {
      restores += 1;
      assert.equal(player, 1);
      socketDestino.emit("enviar_palabra_j1", {
        inspiracion_id: 33,
        restaurando_inspiracion: true
      });
    }
  });

  sincronizador.sincronizarSocketRecienConectado(socket);

  assert.equal(restores, 1);
  assert.deepEqual(llamadas, ["activar", "sincro", "temp", "desventajas", "restaurar"]);
  assert.deepEqual(
    socket.eventos.find(({ event }) => event === "enviar_palabra_j1").payload,
    { inspiracion_id: 33, restaurando_inspiracion: true }
  );
});

test("spectator reconnection restores both active muse deliveries with their authors after mode sync", () => {
  const llamadas = [];
  const restoredPlayers = [];
  const socket = crearSocket({ espectador: true });
  const sincronizador = crearSincronizador({
    modo: "palabras bonus",
    llamadas,
    restaurar(player, socketDestino) {
      restoredPlayers.push(player);
      socketDestino.emit(`enviar_palabra_j${player}`, {
        inspiracion_id: 40 + player,
        restaurando_inspiracion: true,
        musa_nombre: player === 1 ? "LUNA" : "SOL",
        musas: [player === 1 ? "LUNA" : "SOL"]
      });
    }
  });

  sincronizador.sincronizarSocketRecienConectado(socket);

  assert.deepEqual(restoredPlayers, [1, 2]);
  assert.deepEqual(llamadas, ["activar", "sincro", "temp", "desventajas", "restaurar", "restaurar"]);
  assert.deepEqual(
    socket.eventos.filter(({ event }) => event.startsWith("enviar_palabra_j")),
    [
      {
        event: "enviar_palabra_j1",
        payload: {
          inspiracion_id: 41,
          restaurando_inspiracion: true,
          musa_nombre: "LUNA",
          musas: ["LUNA"]
        }
      },
      {
        event: "enviar_palabra_j2",
        payload: {
          inspiracion_id: 42,
          restaurando_inspiracion: true,
          musa_nombre: "SOL",
          musas: ["SOL"]
        }
      }
    ]
  );
});

test("fresh spectator reconnection does not turn missing individual timers into time-up events", () => {
  const socket = crearSocket({ espectador: true });
  const sincronizador = crearSincronizador({
    modo: "palabras bonus",
    conteos: {
      1: { count_text: "", count_seconds: null, count_seq: 0, tiempo_seq: 0 },
      2: { count_text: "", count_seconds: null, count_seq: 0, tiempo_seq: 0 }
    }
  });

  sincronizador.sincronizarSocketRecienConectado(socket);

  assert.equal(socket.eventos.some(({ event }) => event === "count"), false);
});

test("spectator monitor restores both deliveries while unrelated roles receive no replay", () => {
  const destinos = [
    { socket: crearSocket({ monitor: { rol: "espectador", player: null } }), expected: [1, 2] },
    { socket: crearSocket({ jurado: true }), expected: [] },
    { socket: crearSocket(), expected: [] }
  ];

  destinos.forEach(({ socket, expected }) => {
    const restoredPlayers = [];
    const sincronizador = crearSincronizador({
      modo: "letra bendita",
      restaurar(player) {
        restoredPlayers.push(player);
      }
    });
    sincronizador.sincronizarSocketRecienConectado(socket);
    assert.deepEqual(restoredPlayers, expected);
  });
});
