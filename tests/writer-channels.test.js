const test = require("node:test");
const assert = require("node:assert/strict");

const { crearCanalesEscritor } = require("../writer_channels.js");

function crearSocket(id = "socket") {
  const handlers = {};
  const emitidos = [];
  const broadcastEmitidos = [];
  return {
    id,
    emitidos,
    handlers,
    broadcast: {
      emit: (event, payload) => broadcastEmitidos.push({ event, payload })
    },
    broadcastEmitidos,
    emit: (event, payload) => emitidos.push({ event, payload }),
    on: (event, handler) => {
      handlers[event] = handler;
    },
    trigger: (event, payload) => handlers[event](payload)
  };
}

test("writer channels stores writer text and broadcasts active writer updates", () => {
  const textosMalditas = [];
  const sesiones = {
    esActiva: (_socket, player) => player === 1
  };
  const canales = crearCanalesEscritor({
    sesionesEscritor: sesiones,
    extraerTextoPlano: (evento) => evento.text,
    actualizarTextoJugador: (player, text) => textosMalditas.push({ player, text })
  });
  const socket = crearSocket();

  canales.registrarHandlers(socket);
  socket.trigger("texto1", { text: "hola azul", html: "<p>hola azul</p>" });
  socket.trigger("texto2", { text: "rojo ignorado" });

  assert.equal(canales.getTextoPlano(1), "hola azul");
  assert.equal(canales.getTextoPlano(2), "");
  assert.deepEqual(textosMalditas, [{ player: 1, text: "hola azul" }]);
  assert.deepEqual(socket.broadcastEmitidos, [
    { event: "texto1", payload: { text: "hola azul", html: "<p>hola azul</p>" } }
  ]);
});

test("writer channels handles names, forced musa name requests and mode sync", () => {
  let syncCalls = 0;
  let nameChanges = [];
  const canales = crearCanalesEscritor({
    syncMode: () => { syncCalls += 1; },
    onNombreCambiado: (player, name) => nameChanges.push({ player, name })
  });
  const socket = crearSocket();
  socket.musa = 2;

  canales.registrarHandlers(socket);
  socket.trigger("env\u00edo_nombre1", "AZUL");
  socket.trigger("envÃ­o_nombre2", "ROJO");
  socket.trigger("pedir_nombre", {});
  socket.trigger("pedir_nombre", { musa: 1 });

  assert.equal(canales.getNombre(1), "AZUL");
  assert.equal(canales.getNombre(2), "ROJO");
  assert.equal(syncCalls, 1);
  assert.deepEqual(nameChanges, [
    { player: 1, name: "AZUL" },
    { player: 2, name: "ROJO" }
  ]);
  assert.deepEqual(socket.emitidos.filter((evt) => evt.event === "dar_nombre"), [
    { event: "dar_nombre", payload: "ROJO" },
    { event: "dar_nombre", payload: "AZUL" }
  ]);
});

test("writer channels resolve actor and monitor teams when requests omit a payload", () => {
  const canales = crearCanalesEscritor();
  const writer = crearSocket("names");
  const actor = crearSocket("actor-2");
  const monitor = crearSocket("monitor-actor-2");
  actor.actor = 2;
  monitor.monitor_pantalla = { rol: "actor", player: 2 };

  canales.registrarHandlers(writer);
  canales.registrarHandlers(actor);
  canales.registrarHandlers(monitor);
  writer.trigger("env\u00edo_nombre1", "AZUL");
  writer.trigger("env\u00edo_nombre2", "ROJO");
  actor.trigger("pedir_nombre");
  monitor.trigger("pedir_nombre");
  monitor.trigger("pedir_texto");

  assert.deepEqual(actor.emitidos.at(-1), { event: "dar_nombre", payload: "ROJO" });
  assert.deepEqual(monitor.emitidos, [
    { event: "dar_nombre", payload: "ROJO" },
    { event: "texto2", payload: "" }
  ]);
});

test("writer channels returns texts and attributes snapshots", () => {
  const canales = crearCanalesEscritor({
    sesionesEscritor: { esActiva: () => true },
    extraerTextoPlano: (evento) => evento.text
  });
  const socket = crearSocket();

  canales.registrarHandlers(socket);
  socket.trigger("texto1", { text: "uno" });
  socket.trigger("enviar_atributos", { player: 1, atributos: { rol: "A" } });
  socket.trigger("pedir_atributos");
  canales.emitirTextos(socket);

  assert.deepEqual(canales.snapshotTextos(), {
    1: { html: { text: "uno" }, plano: "uno" },
    2: { html: "", plano: "" }
  });
  assert.deepEqual(socket.emitidos.find((evt) => evt.event === "recibir_atributos"), {
    event: "recibir_atributos",
    payload: {
      1: { rol: "A" },
      2: {}
    }
  });
  assert.deepEqual(socket.emitidos.filter((evt) => evt.event.startsWith("texto")), [
    { event: "texto1", payload: { text: "uno" } },
    { event: "texto2", payload: "" }
  ]);
});

test("writer channels ignores attributes from inactive writer sessions", () => {
  const canales = crearCanalesEscritor({
    sesionesEscritor: { esActiva: (socket, player) => socket.id === "active" && player === 1 }
  });
  const stale = crearSocket("stale");
  const active = crearSocket("active");

  canales.registrarHandlers(stale);
  canales.registrarHandlers(active);
  stale.trigger("enviar_atributos", { player: 1, atributos: { fuerza: 10 } });
  active.trigger("enviar_atributos", { player: 1, atributos: { fuerza: 4 } });

  assert.deepEqual(canales.snapshotAtributos(), {
    1: { fuerza: 4 },
    2: {}
  });
});

test("writer channels tells a stale connection when the same browser session can recover", () => {
  const canales = crearCanalesEscritor({
    sesionesEscritor: {
      esActiva: () => false,
      esMismoClienteActivo: () => true
    }
  });
  const socket = crearSocket("reconnecting-blue");
  canales.registrarHandlers(socket);

  socket.trigger("texto1", { text: "texto azul pendiente" });

  assert.deepEqual(socket.emitidos, [{
    event: "escritor_sesion_inactiva",
    payload: { player: 1, mismo_client_id: true }
  }]);
  assert.equal(canales.getTextoPlano(1), "");
});

test("writer channels preserves final texts when a finished writer reconnects empty", () => {
  let partidaFinalizada = false;
  const canales = crearCanalesEscritor({
    sesionesEscritor: { esActiva: () => true },
    extraerTextoPlano: (evento) => evento.texto_guardado || evento.text || "",
    puedeActualizarTexto: () => !partidaFinalizada
  });
  const socket = crearSocket("writer-final");
  canales.registrarHandlers(socket);

  socket.trigger("texto1", {
    text: "AZUL LÍNEA UNO<br>AZUL LÍNEA DOS",
    texto_guardado: "AZUL LÍNEA UNO\nAZUL LÍNEA DOS"
  });
  partidaFinalizada = true;
  socket.trigger("texto1", { text: "", texto_guardado: "" });
  socket.trigger("pedir_texto", { player: 1 });

  assert.equal(canales.getTextoPlano(1), "AZUL LÍNEA UNO\nAZUL LÍNEA DOS");
  assert.deepEqual(socket.emitidos.at(-1), {
    event: "texto1",
    payload: {
      text: "AZUL LÍNEA UNO<br>AZUL LÍNEA DOS",
      texto_guardado: "AZUL LÍNEA UNO\nAZUL LÍNEA DOS"
    }
  });
});

test("writer channels applies revisioned deltas and only sends them to subscribed clients", () => {
  const writer = crearSocket("writer");
  const deltaClient = crearSocket("delta-client");
  const otherTeam = crearSocket("other-team");
  writer.escritxr = 1;
  const sockets = new Map([
    [writer.id, writer],
    [deltaClient.id, deltaClient],
    [otherTeam.id, otherTeam]
  ]);
  const canales = crearCanalesEscritor({
    io: { sockets: { sockets } },
    sesionesEscritor: { esActiva: (socket, player) => socket === writer && player === 1 },
    extraerTextoPlano: (evento) => evento.texto_guardado || evento.text || ""
  });
  [writer, deltaClient, otherTeam].forEach((socket) => canales.registrarHandlers(socket));
  deltaClient.handlers.suscribir_textos({ players: [1], deltas: true, cursors: true });
  otherTeam.handlers.suscribir_textos({ players: [2], deltas: true });

  let ack = null;
  writer.handlers.texto_delta_actualizar({
    player: 1,
    baseRevision: 0,
    htmlPatch: { start: 0, deleteCount: 0, insert: "hola" },
    plainPatch: { start: 0, deleteCount: 0, insert: "hola" },
    meta: { points: 1 }
  }, (respuesta) => { ack = respuesta; });

  assert.deepEqual(ack, { ok: true, player: 1, revision: 1 });
  assert.equal(canales.getTextoPlano(1), "hola");
  assert.equal(deltaClient.emitidos.filter((evento) => evento.event === "texto_delta").length, 1);
  assert.equal(otherTeam.emitidos.filter((evento) => evento.event === "texto_delta").length, 0);
});

test("writer channels rejects an out-of-order delta with an authoritative snapshot", () => {
  const writer = crearSocket("writer-revision");
  const canales = crearCanalesEscritor({
    sesionesEscritor: { esActiva: () => true },
    extraerTextoPlano: (evento) => evento.texto_guardado || evento.text || ""
  });
  canales.registrarHandlers(writer);
  let ack = null;
  writer.handlers.texto_delta_actualizar({
    player: 1,
    baseRevision: 4,
    htmlPatch: { start: 0, deleteCount: 0, insert: "fuera de orden" },
    plainPatch: { start: 0, deleteCount: 0, insert: "fuera de orden" }
  }, (respuesta) => { ack = respuesta; });

  assert.equal(ack.code, "REVISION_MISMATCH");
  assert.equal(writer.emitidos.at(-1).event, "texto_snapshot");
  assert.equal(writer.emitidos.at(-1).payload.revision, 0);
});
