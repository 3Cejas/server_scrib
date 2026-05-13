const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { registrarCanalesInspiracion } = require("../inspiration_channels.js");

function createFakeSocket() {
  const socket = new EventEmitter();
  socket.musa = 1;
  socket.nombre_musa = "LUNA";
  socket.musa_client_id = "socket_client";
  return socket;
}

test("enviar_inspiracion forwards muse client identity to bonus queues and cloud", () => {
  const socket = createFakeSocket();
  let queued = null;
  let cloud = null;
  let sentSummary = null;
  let cloudEmitted = false;

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: {
      registrarCorazon: () => null,
      registrarInspiracionEnviada: (payload) => {
        sentSummary = payload;
      }
    },
    nubeInspiracion: {
      registrarInspiracion: (equipo, payload) => {
        cloud = { equipo, payload };
      }
    },
    getModoActual: () => "palabras bonus",
    getModoBonus: () => ({
      addMusa: (player, payload) => {
        queued = { player, payload };
      }
    }),
    getModoMalditas: () => null,
    getModoMusas: () => null,
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null),
    normalizarNombreMusa: (valor) => String(valor || "").trim().toUpperCase(),
    normalizarMusaClientId: (valor) => String(valor || "").trim(),
    emitirNubeInspiracionEstado: () => {
      cloudEmitted = true;
    }
  });

  socket.emit("enviar_inspiracion", {
    palabra: " cometa ",
    nombre: " luna ",
    client_id: "client_1"
  });

  assert.deepEqual(queued, {
    player: 1,
    payload: {
      palabra: "cometa",
      musa: "LUNA",
      client_id: "client_1"
    }
  });
  assert.deepEqual(cloud, {
    equipo: 1,
    payload: {
      palabra: "cometa",
      musa: "LUNA",
      client_id: "client_1",
      modo_actual: "palabras bonus"
    }
  });
  assert.deepEqual(sentSummary, {
    player: 1,
    target_player: 1,
    palabra: "cometa",
    musa: "LUNA",
    client_id: "client_1",
    modo: "palabras bonus"
  });
  assert.equal(cloudEmitted, true);
});

test("enviar_inspiracion records forbidden words against the opposing writer", () => {
  const socket = createFakeSocket();
  let sentSummary = null;
  let queued = null;

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: {
      registrarCorazon: () => null,
      registrarInspiracionEnviada: (payload) => {
        sentSummary = payload;
      }
    },
    nubeInspiracion: { registrarInspiracion: () => {} },
    getModoActual: () => "palabras prohibidas",
    getModoBonus: () => null,
    getModoMalditas: () => ({
      addMusa: (player, payload) => {
        queued = { player, payload };
      }
    }),
    getModoMusas: () => null,
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 || Number(valor) === 2 ? Number(valor) : null),
    normalizarNombreMusa: (valor) => String(valor || "").trim().toUpperCase(),
    normalizarMusaClientId: (valor) => String(valor || "").trim()
  });

  socket.emit("enviar_inspiracion", {
    palabra: "sombra",
    nombre: "luna",
    client_id: "client_1"
  });

  assert.equal(queued.player, 1);
  assert.equal(sentSummary.target_player, 2);
  assert.equal(sentSummary.modo, "palabras prohibidas");
});

test("enviar_inspiracion pushes queued letter-mode muse words to active writers", () => {
  const socket = createFakeSocket();
  const calls = [];
  const mode = {
    addMusa: (player, payload) => {
      calls.push({ type: "add", player, payload });
    },
    obtenerEstadoPalabrasMusas: (player) => {
      calls.push({ type: "status", player });
      return {
        player,
        activa: true,
        origen_estado: "cola",
        palabra: "aurora",
        cola: 1,
        cola_palabras_musas: 1
      };
    },
    handleRequest: (player) => {
      calls.push({ type: "handle", player });
    }
  };

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: {
      registrarCorazon: () => null,
      registrarInspiracionEnviada: () => {}
    },
    nubeInspiracion: { registrarInspiracion: () => {} },
    getModoActual: () => "letra bendita",
    getModoBonus: () => null,
    getModoMalditas: () => null,
    getModoMusas: () => mode,
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null),
    normalizarNombreMusa: (valor) => String(valor || "").trim().toUpperCase(),
    normalizarMusaClientId: (valor) => String(valor || "").trim(),
    sesionesEscritor: {
      obtenerSocketActivo: (player) => (Number(player) === 1 ? "writer-1" : null)
    }
  });

  socket.emit("enviar_inspiracion", {
    palabra: "aurora",
    nombre: "luna",
    client_id: "client_1"
  });

  assert.deepEqual(calls, [
    {
      type: "add",
      player: 1,
      payload: {
        palabra: "aurora",
        musa: "LUNA",
        client_id: "client_1"
      }
    },
    { type: "status", player: 1 },
    { type: "handle", player: 1 }
  ]);
});

test("enviar_inspiracion keeps letter-mode muse words queued when the writer is disconnected", () => {
  const socket = createFakeSocket();
  const calls = [];
  const mode = {
    addMusa: (player) => {
      calls.push({ type: "add", player });
    },
    obtenerEstadoPalabrasMusas: (player) => {
      calls.push({ type: "status", player });
      return { activa: true, origen_estado: "cola", cola: 1 };
    },
    handleRequest: (player) => {
      calls.push({ type: "handle", player });
    }
  };

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: {
      registrarCorazon: () => null,
      registrarInspiracionEnviada: () => {}
    },
    nubeInspiracion: { registrarInspiracion: () => {} },
    getModoActual: () => "letra prohibida",
    getModoBonus: () => null,
    getModoMalditas: () => null,
    getModoMusas: () => mode,
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null),
    sesionesEscritor: {
      obtenerSocketActivo: () => null
    }
  });

  socket.emit("enviar_inspiracion", { palabra: "sombra" });

  assert.deepEqual(calls, [{ type: "add", player: 1 }]);
});

test("nueva_palabra marks the delivered muse word before requesting the next bonus", () => {
  const socket = createFakeSocket();
  const order = [];
  let introduced = null;
  const mode = {
    consumirEntregaMusaIntroducida: (player) => {
      order.push(`consume:${player}`);
      return {
        player,
        target_player: player,
        palabra: "cometa",
        modo: "palabras bonus",
        client_id: "client_1",
        tiempo: 20
      };
    },
    handleRequest: (player) => {
      order.push(`handle:${player}`);
    }
  };

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: {
      registrarCorazon: () => null,
      registrarInspiracionIntroducida: (payload) => {
        introduced = payload;
      }
    },
    nubeInspiracion: { registrarInspiracion: () => {} },
    getModoActual: () => "palabras bonus",
    getModoBonus: () => mode,
    getModoMalditas: () => null,
    getModoMusas: () => null,
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null)
  });

  socket.emit("nueva_palabra", 1);

  assert.deepEqual(order, ["consume:1", "handle:1"]);
  assert.equal(introduced.palabra, "cometa");
  assert.equal(introduced.client_id, "client_1");
});

test("inactive writer sessions cannot request new inspiration words", () => {
  const socket = createFakeSocket();
  socket.escritxr = 1;
  let requests = 0;

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: { registrarCorazon: () => null },
    nubeInspiracion: { registrarInspiracion: () => {} },
    getModoActual: () => "palabras bonus",
    getModoBonus: () => ({
      consumirEntregaMusaIntroducida: () => null,
      handleRequest: () => {
        requests += 1;
      }
    }),
    getModoMalditas: () => null,
    getModoMusas: () => null,
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null),
    sesionesEscritor: { esActiva: () => false }
  });

  socket.emit("nueva_palabra", 1);

  assert.equal(requests, 0);
});

test("regalo_pdf_musas targets personalized gifts to the muse client room", () => {
  const socket = createFakeSocket();
  const events = [];
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        }
      };
    }
  };

  registrarCanalesInspiracion({
    socket,
    io,
    musasAuxiliares: {
      registrarCorazon: () => null,
      guardarRegalo: () => ({
        player: 1,
        client_id: "client_1",
        data: "pdf",
        filename: "musa.pdf"
      })
    },
    nubeInspiracion: { registrarInspiracion: () => {} },
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null)
  });

  socket.emit("regalo_pdf_musas", { player: 1, client_id: "client_1", data: "pdf" });

  assert.deepEqual(events, [{
    room: "musa_client_client_1",
    event: "regalo_pdf_musas",
    payload: {
      player: 1,
      client_id: "client_1",
      data: "pdf",
      filename: "musa.pdf"
    }
  }]);
});

test("pedir_resumen_musas_pdf responds through ack when available", () => {
  const socket = createFakeSocket();
  const resumen = { equipos: { 1: { musas: [{ client_id: "client_1" }] } } };
  let ackPayload = null;

  registrarCanalesInspiracion({
    socket,
    io: { to: () => ({ emit: () => {} }) },
    musasAuxiliares: {
      registrarCorazon: () => null,
      payloadResumenPdf: () => resumen
    },
    nubeInspiracion: { registrarInspiracion: () => {} },
    obtenerIdJugadorValido: (valor) => (Number(valor) === 1 ? 1 : null)
  });

  socket.emit("pedir_resumen_musas_pdf", {}, (payload) => {
    ackPayload = payload;
  });

  assert.equal(ackPayload, resumen);
});
