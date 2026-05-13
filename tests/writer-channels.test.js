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
