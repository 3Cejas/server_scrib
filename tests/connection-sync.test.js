const test = require("node:test");
const assert = require("node:assert/strict");

const { crearSincronizadorConexion } = require("../connection_sync.js");

function crearSocket({ dramaturgia = false, escritxr = null } = {}) {
  const eventos = [];
  return {
    dramaturgia,
    escritxr,
    eventos,
    emit(event, payload) {
      eventos.push({ event, payload });
    }
  };
}

function crearSincronizador({ modo = "", llamadas = [], restaurar = null } = {}) {
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
    partidaSync: {
      withModoSeq: (payload) => ({ ...payload, modo_seq: 7 }),
      obtenerConteo: () => null
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
  assert.deepEqual(llamadas, ["activar", "sincro", "restaurar", "temp", "desventajas"]);
  assert.deepEqual(
    socket.eventos.find(({ event }) => event === "enviar_palabra_j1").payload,
    { inspiracion_id: 33, restaurando_inspiracion: true }
  );
});
