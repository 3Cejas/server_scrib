const test = require("node:test");
const assert = require("node:assert/strict");
const { crearRuntimeScrib } = require("../scrib_runtime.js");
const { DURACION_CUENTA_ATRAS_INICIO_MS } = require("../partida_lifecycle.js");

test("runtime retains configured names across start, new connections and subsequent matches", (t) => {
  const persistenciaAnterior = process.env.SCRIB_PERSIST_STATE;
  process.env.SCRIB_PERSIST_STATE = "0";
  t.after(() => {
    if (persistenciaAnterior === undefined) delete process.env.SCRIB_PERSIST_STATE;
    else process.env.SCRIB_PERSIST_STATE = persistenciaAnterior;
  });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });

  const sockets = new Map();
  const broadcastEvents = [];
  const io = {
    sockets: { sockets },
    emit: (event, payload) => {
      broadcastEvents.push({ event, payload });
      for (const socket of sockets.values()) socket.emit(event, payload);
    },
    to: () => ({ emit: (event, payload) => io.emit(event, payload) })
  };
  const runtime = crearRuntimeScrib({ io, passwordRoles: "test", testHooksEnabled: true });
  const crearSocket = (id) => {
    const handlers = new Map();
    const emitidos = [];
    const socket = {
      id,
      connected: true,
      handshake: { query: {} },
      emitidos,
      emit: (event, payload) => emitidos.push({ event, payload }),
      on: (event, handler) => handlers.set(event, handler),
      off: (event) => handlers.delete(event),
      removeAllListeners: (event) => handlers.delete(event),
      broadcast: { emit: (event, payload) => io.emit(event, payload) },
      join: () => {},
      leave: () => {},
      trigger: (event, ...args) => handlers.get(event)(...args)
    };
    sockets.set(id, socket);
    runtime.registrarConexion(socket);
    return socket;
  };
  const control = crearSocket("control");
  control.control = true;
  const nombres = { 1: "ÁNGELA BUENO", 2: "PABLO PINEÑO" };
  control.trigger("env\u00edo_nombre1", nombres[1]);
  control.trigger("envÃ­o_nombre2", nombres[2]);
  control.trigger("control_estado_actualizar", { nombres });
  const { writerChannels, statsLive, controlState, partidaLifecycle, estadoCicloPartida } = runtime.deps;

  const verificarNombres = () => {
    assert.equal(writerChannels.getNombre(1), nombres[1]);
    assert.equal(writerChannels.getNombre(2), nombres[2]);
    assert.deepEqual(controlState.snapshot().nombres, nombres);
    assert.equal(statsLive.payload().players[1].nombre, nombres[1]);
    assert.equal(statsLive.payload().players[2].nombre, nombres[2]);
  };
  const iniciar = () => {
    control.trigger("inicio", {
      count: "1:00",
      parametros: {
        LISTA_MODOS: ["palabras bonus"],
        DURACION_PARTIDA: 60,
        DURACION_TIEMPO_MODOS: 60
      }
    });
    verificarNombres();
    assert.equal(writerChannels.getTextoPlano(1), "");
    t.mock.timers.tick(DURACION_CUENTA_ATRAS_INICIO_MS);
    assert.equal(estadoCicloPartida.modoActual, "palabras bonus");
    verificarNombres();
  };
  writerChannels.restaurar({
    textos: { 1: { html: "Historia anterior", plano: "Historia anterior" } }
  });
  broadcastEvents.length = 0;
  iniciar();
  crearSocket("new-spectator");
  verificarNombres();
  assert.deepEqual(broadcastEvents.filter(({ event }) => /^nombre[12]$/.test(event)), [
    { event: "nombre1", payload: nombres[1] },
    { event: "nombre2", payload: nombres[2] }
  ]);
  control.trigger("pedir_estado_control");
  assert.deepEqual(control.emitidos.findLast(({ event }) => event === "control_estado").payload.nombres, nombres);

  partidaLifecycle.finalizarPartida(control);
  verificarNombres();
  control.trigger("limpiar", {});
  verificarNombres();
  let nuevaPartida;
  control.trigger("nueva_partida", {}, (respuesta) => { nuevaPartida = respuesta; });
  assert.equal(nuevaPartida.ok, true);
  verificarNombres();
  iniciar();
  crearSocket("reconnected-writer");
  verificarNombres();

  runtime.deps.resetearEstadoAuxiliarParaTests();
  statsLive.reset();
  assert.equal(writerChannels.getNombre(1), "");
  assert.deepEqual(controlState.snapshot().nombres, { 1: "ESCRITXR 1", 2: "ESCRITXR 2" });
});
