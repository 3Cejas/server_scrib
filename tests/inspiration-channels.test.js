const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { construirPostgameMusa, registrarCanalesInspiracion } = require("../inspiration_channels.js");

test("construirPostgameMusa incluye estadisticas personales y los dos textos", () => {
  const payload = construirPostgameMusa({
    regalo: { player: 1, client_id: "luna", musa_nombre: "LUNA" },
    musasAuxiliares: {
      payloadResumenPdf: () => ({
        equipos: {
          1: { musas: [{ client_id: "luna", nombre: "LUNA", stats: { enviadas: 8, introducidas: 5, efectividad_pct: 63 } }] }
        }
      })
    },
    writerChannels: {
      getNombre: (player) => (player === 1 ? "ANA MAR" : "BEA SOL"),
      snapshotTextos: () => ({
        1: { plano: "Texto propio" },
        2: { plano: "Texto contrario" }
      })
    },
    payloadStatsLive: () => ({
      players: {
        1: { palabrasTotal: 42, pulsacionesTotal: 320, ritmoPpm: 71 },
        2: { palabrasTotal: 38, pulsacionesTotal: 299, ritmoPpm: 66 }
      }
    })
  });

  assert.equal(payload.musa.nombre, "LUNA");
  assert.equal(payload.musa.stats.enviadas, 8);
  assert.equal(payload.escritores[1].nombre, "ANA MAR");
  assert.equal(payload.escritores[1].texto, "Texto propio");
  assert.equal(payload.escritores[2].texto, "Texto contrario");
  assert.deepEqual(payload.escritores[1].stats, { palabras: 42, pulsaciones: 320, ritmo_ppm: 71 });
});

function createFakeSocket() {
  const socket = new EventEmitter();
  socket.musa = 1;
  socket.nombre_musa = "LUNA";
  socket.musa_client_id = "socket_client";
  return socket;
}

test("enviar_inspiracion uses the active muse identity and ignores spoofed payload identity", () => {
  const socket = createFakeSocket();
  let queued = null;
  let cloud = null;
  let sentSummary = null;
  let cloudEmitted = false;
  let activeMuse = {
    player: 1,
    nombre: "LUNA",
    clientId: "socket_client"
  };

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
    obtenerMusaActiva: () => activeMuse,
    normalizarNombreMusa: (valor) => String(valor || "").trim().toUpperCase(),
    normalizarMusaClientId: (valor) => String(valor || "").trim(),
    emitirNubeInspiracionEstado: () => {
      cloudEmitted = true;
    }
  });

  socket.emit("enviar_inspiracion", {
    palabra: " cometa ",
    nombre: " impostora ",
    client_id: "client_falso"
  });

  assert.deepEqual(queued, {
    player: 1,
    payload: {
      palabra: "cometa",
      musa: "LUNA",
      client_id: "socket_client"
    }
  });
  assert.deepEqual(cloud, {
    equipo: 1,
    payload: {
      palabra: "cometa",
      musa: "LUNA",
      client_id: "socket_client",
      modo_actual: "palabras bonus"
    }
  });
  assert.deepEqual(sentSummary, {
    player: 1,
    target_player: 1,
    palabra: "cometa",
    musa: "LUNA",
    client_id: "socket_client",
    modo: "palabras bonus"
  });
  assert.equal(cloudEmitted, true);

  activeMuse = null;
  socket.emit("enviar_inspiracion", {
    palabra: "intrusion",
    nombre: "IMPOSTORA",
    client_id: "client_falso"
  });
  assert.equal(queued.payload.palabra, "cometa");
  assert.equal(cloud.payload.palabra, "cometa");

  activeMuse = {
    player: 1,
    nombre: "P.U.T.A",
    clientId: "offensive-name"
  };
  socket.emit("enviar_inspiracion", { palabra: "luz" });
  assert.equal(queued.payload.musa, "MUSA");
  assert.equal(cloud.payload.musa, "MUSA");
  assert.equal(JSON.stringify(queued).includes("P.U.T.A"), false);
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
        client_id: "socket_client"
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
  socket.escritxr = 1;
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

  let ack = null;
  socket.emit("regalo_pdf_musas", { player: 1, client_id: "client_1", data: "pdf" }, (payload) => {
    ack = payload;
  });

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
  assert.deepEqual(ack, { ok: true, player: 1, client_id: "client_1", destinatarios: 0 });
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

function registrarProtocoloInspiracion({
  socket,
  mode,
  modoActual = "palabras bonus",
  modoSeq = 7,
  pausada = false,
  finalizada = false,
  aplicarTiempo = () => null,
  introduced = () => {},
  competition = () => {}
}) {
  const roomEvents = [];
  const globalEvents = [];
  const io = {
    emit(event, payload) {
      globalEvents.push({ event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          roomEvents.push({ room, event, payload });
        }
      };
    }
  };
  registrarCanalesInspiracion({
    socket,
    io,
    musasAuxiliares: {
      registrarInspiracionIntroducida: introduced
    },
    nubeInspiracion: {},
    getModoActual: () => modoActual,
    getModoBonus: () => mode,
    getModoMalditas: () => mode,
    getModoMusas: () => mode,
    getModoSeq: () => modoSeq,
    isPartidaPausada: () => pausada,
    isFinDelJuego: () => finalizada,
    aplicarAjusteTiempoInspiracion: aplicarTiempo,
    registrarInspiracionCompeticion: competition,
    obtenerIdJugadorValido: (valor) => {
      const id = Number(valor);
      return id === 1 || id === 2 ? id : null;
    },
    sesionesEscritor: {
      esActiva: (writerSocket, player) => writerSocket === socket && player === socket.escritxr
    },
    emitirNubeInspiracionEstado: () => {}
  });
  return { io, roomEvents, globalEvents };
}

test("V2 inspiration actions validate active mode and mode sequence before touching an engine", () => {
  const socket = createFakeSocket();
  socket.escritxr = 1;
  let requests = 0;
  const mode = {
    solicitarInspiracion() {
      requests += 1;
      return { ok: true, existente: false };
    },
    handleRequest() {
      requests += 1;
    }
  };
  registrarProtocoloInspiracion({ socket, mode, modoActual: "letra bendita", modoSeq: 8 });

  let wrongMode = null;
  socket.emit("nueva_palabra", { player: 1, accion: "solicitar", modo_seq: 8 }, (payload) => {
    wrongMode = payload;
  });
  assert.equal(wrongMode.code, "MODE_NOT_ACTIVE");

  let stale = null;
  socket.emit("nueva_palabra_musa", { player: 1, accion: "solicitar", modo_seq: 7 }, (payload) => {
    stale = payload;
  });
  assert.equal(stale.code, "STALE_MODE");
  assert.equal(stale.modo_seq, 8);
  assert.equal(requests, 0);
});

test("V2 bonus use scores inspiration once without granting life time", () => {
  const socket = createFakeSocket();
  socket.escritxr = 1;
  const handleOptions = [];
  const timeEvents = [];
  const introduced = [];
  const competition = [];
  let lastUse = null;
  const mode = {
    solicitarInspiracion: () => ({ ok: true, existente: false }),
    handleRequest: (_player, options) => {
      handleOptions.push(options);
    },
    aprovecharInspiracion: (_player, id) => {
      if (lastUse && lastUse.inspiracion_id === id) {
        return { ...lastUse, idempotente: true };
      }
      lastUse = {
        ok: true,
        aprovechada: true,
        idempotente: false,
        player: 1,
        inspiracion_id: id,
        valor_inspiracion: 0.75,
        tiempo_otorgado: 13,
        entrega_musa: {
          player: 1,
          palabra: "cometa",
          musa_nombre: "LUNA",
          musas: ["LUNA"]
        }
      };
      return { ...lastUse };
    },
    actualizarUltimoAprovechamientoInspiracion: (_player, _id, patch) => {
      lastUse = { ...lastUse, ...patch };
    }
  };
  const { globalEvents } = registrarProtocoloInspiracion({
    socket,
    mode,
    aplicarTiempo: (evento) => {
      timeEvents.push(evento);
      return { ...evento, tiempo_seq: 4 };
    },
    introduced: (payload) => introduced.push(payload),
    competition: (player, payload) => competition.push({ player, payload })
  });

  let requested = null;
  socket.emit("nueva_palabra", {
    player: 1,
    accion: "solicitar",
    modo_seq: 7
  }, (payload) => {
    requested = payload;
  });
  assert.equal(requested.ok, true);

  let first = null;
  socket.emit("nueva_palabra", {
    player: 1,
    accion: "aprovechar",
    inspiracion_id: 42,
    modo_seq: 7,
    valor_inspiracion: 999,
    tiempo_otorgado: 999
  }, (payload) => {
    first = payload;
  });
  let retry = null;
  socket.emit("nueva_palabra", {
    player: 1,
    accion: "aprovechar",
    inspiracion_id: 42,
    modo_seq: 7
  }, (payload) => {
    retry = payload;
  });

  assert.deepEqual(handleOptions, [{ contabilizar: false }, { contabilizar: false }]);
  assert.deepEqual(timeEvents, []);
  assert.equal(first.tiempo_seq, undefined);
  assert.equal(first.valor_inspiracion, 0.75);
  assert.equal(first.tiempo_otorgado, 0);
  assert.equal(retry.tiempo_seq, undefined);
  assert.equal(retry.valor_inspiracion, 0.75);
  assert.equal(retry.tiempo_otorgado, 0);
  assert.equal(retry.idempotente, true);
  assert.equal(introduced.length, 1);
  assert.equal(competition.length, 1);
  assert.equal(competition[0].payload.palabra, "cometa");
  assert.equal(globalEvents.length, 1);
  assert.equal(globalEvents[0].event, "inspiracion_aprovechada");
  assert.deepEqual(globalEvents[0].payload, {
    autoritativa: true,
    player: 1,
    equipo: 1,
    origen_musa: "musa",
    inspiracion_id: 42,
    valor_inspiracion: 0.75,
    tiempo_otorgado: 0,
    modo_actual: "palabras bonus",
    modo_seq: 7,
    palabra: "cometa",
    musas: ["LUNA"],
    musa_nombre: "LUNA",
    ts: globalEvents[0].payload.ts
  });
});

test("V2 discard is strict, idempotent and requests the next delivery without counting", () => {
  const socket = createFakeSocket();
  socket.escritxr = 1;
  const handleOptions = [];
  let discarded = false;
  const mode = {
    descartarInspiracion: (_player, id) => {
      if (discarded) {
        return { ok: true, descartada: true, idempotente: true, inspiracion_id: id };
      }
      discarded = true;
      return { ok: true, descartada: true, idempotente: false, inspiracion_id: id };
    },
    handleRequest: (_player, options) => handleOptions.push(options)
  };
  const { roomEvents } = registrarProtocoloInspiracion({ socket, mode });

  let first = null;
  socket.emit("descartar_inspiracion", {
    player: 1,
    inspiracion_id: 9,
    modo_seq: 7
  }, (payload) => {
    first = payload;
  });
  let retry = null;
  socket.emit("descartar_inspiracion", {
    player: 1,
    inspiracion_id: 9,
    modo_seq: 7
  }, (payload) => {
    retry = payload;
  });

  assert.equal(first.ok, true);
  assert.equal(retry.idempotente, true);
  assert.deepEqual(handleOptions, [{ contabilizar: false }]);
  assert.equal(roomEvents.filter((entry) => entry.event === "inspiracion_descartada").length, 1);
});

test("legacy inspiration cannot bypass delivery IDs after a writer has entered V2", () => {
  const socket = createFakeSocket();
  socket.escritxr = 1;
  let consumed = 0;
  let requested = 0;
  const mode = {
    usaProtocoloInspiracionV2: () => true,
    consumirEntregaMusaIntroducida: () => {
      consumed += 1;
    },
    handleRequest: () => {
      requested += 1;
    }
  };
  registrarProtocoloInspiracion({ socket, mode });

  let ack = null;
  socket.emit("nueva_palabra", 1, (payload) => {
    ack = payload;
  });

  assert.equal(ack.code, "V2_REQUIRED");
  assert.equal(consumed, 0);
  assert.equal(requested, 0);
});

test("legacy inspiration events require the socket to own the active writer role", () => {
  const socket = createFakeSocket();
  delete socket.escritxr;
  let requested = 0;
  const mode = {
    usaProtocoloInspiracionV2: () => false,
    consumirEntregaMusaIntroducida: () => null,
    handleRequest: () => {
      requested += 1;
    }
  };
  registrarProtocoloInspiracion({ socket, mode });
  socket.emit("nueva_palabra", 1);
  assert.equal(requested, 0);
});

test("forbidden-word mode supports V2 request/use, ACKs before delivery and never permits discard", () => {
  const socket = createFakeSocket();
  socket.escritxr = 1;
  const order = [];
  let timeAdjustments = 0;
  const mode = {
    solicitarInspiracion: () => ({ ok: true, existente: false }),
    handleRequest: (_player, options) => {
      order.push(`handle:${String(options.contabilizar)}`);
    },
    aprovecharInspiracion: (_player, id) => ({
      ok: true,
      aprovechada: true,
      idempotente: false,
      inspiracion_id: id,
      tiempo_otorgado: 20,
      entrega_musa: null
    })
  };
  registrarProtocoloInspiracion({
    socket,
    mode,
    modoActual: "palabras prohibidas",
    aplicarTiempo: () => {
      timeAdjustments += 1;
      return { tiempo_seq: 99 };
    }
  });

  socket.emit("nueva_palabra_prohibida", {
    player: 1,
    accion: "solicitar",
    modo_seq: 7
  }, () => order.push("ack:solicitar"));
  socket.emit("nueva_palabra_prohibida", {
    player: 1,
    accion: "aprovechar",
    inspiracion_id: 5,
    modo_seq: 7
  }, () => order.push("ack:aprovechar"));
  let discard = null;
  socket.emit("descartar_inspiracion", {
    player: 1,
    inspiracion_id: 5,
    modo_seq: 7
  }, (payload) => {
    discard = payload;
  });

  assert.deepEqual(order, [
    "ack:solicitar",
    "handle:false",
    "ack:aprovechar",
    "handle:false"
  ]);
  assert.equal(timeAdjustments, 0);
  assert.equal(discard.code, "MODE_NOT_DISCARDABLE");
});

test("unregistered or false-role sockets cannot forge public writer inspiration feedback", () => {
  for (const escritxr of [undefined, 2]) {
    const socket = createFakeSocket();
    if (typeof escritxr === "undefined") delete socket.escritxr;
    else socket.escritxr = escritxr;
    const publicEvents = [];
    socket.broadcast = {
      emit(event, payload) {
        publicEvents.push({ scope: "broadcast", event, payload });
      }
    };
    const io = {
      emit(event, payload) {
        publicEvents.push({ scope: "io", event, payload });
      },
      to(room) {
        return {
          emit(event, payload) {
            publicEvents.push({ scope: room, event, payload });
          }
        };
      }
    };
    registrarCanalesInspiracion({
      socket,
      io,
      musasAuxiliares: {},
      nubeInspiracion: {},
      obtenerIdJugadorValido: (valor) => {
        const id = Number(valor);
        return id === 1 || id === 2 ? id : null;
      }
    });

    socket.emit("feedback_de_j1", {
      tipo: "inspiracion",
      palabra: "falsificada",
      musa_nombre: "ATAQUE"
    });
    socket.emit("feedback_musa_inspiracion", {
      player: 1,
      tipo: "inspiracion",
      palabra: "falsificada"
    });
    socket.emit("enviar_feedback_modificador", { player: 1, id_mod: "mod1" });
    socket.emit("intento_prohibido", { player: 1, palabra: "falsificada" });

    assert.deepEqual(publicEvents, []);
  }
});
