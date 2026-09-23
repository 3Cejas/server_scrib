const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorCalentamiento } = require("../warmup.js");

function createIo() {
  const events = [];
  return {
    events,
    emit(event, payload) {
      events.push({ scope: "io", event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          events.push({ scope: "room", room, event, payload });
        }
      };
    }
  };
}

test("warmup state reaches muse rooms so read-only dramaturgy replicas stay exact", () => {
  const io = createIo();
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });

  warmup.iniciar();

  const museEvents = io.events.filter(({ event }) => event === "calentamiento_estado_musa");
  assert.deepEqual(museEvents.map(({ scope, room }) => [scope, room]), [
    ["room", "musa_j1"],
    ["room", "musa_j2"]
  ]);
  assert.equal(museEvents[0].payload.equipo, 1);
  assert.equal(museEvents[1].payload.equipo, 2);
  assert.equal(museEvents.every(({ payload }) => payload.activo), true);

  const writerEvents = io.events.filter(({ event }) => event === "calentamiento_estado_escritor");
  assert.deepEqual(writerEvents.map(({ scope, room }) => [scope, room]), [
    ["room", "role_escritor_1"],
    ["room", "role_escritor_2"]
  ]);
  assert.equal(writerEvents[0].payload.equipo_destino, 1);
  assert.equal(writerEvents[1].payload.equipo_destino, 2);
  assert.equal(writerEvents[0].payload.revision, writerEvents[1].payload.revision);
  assert.ok(writerEvents[0].payload.revision > 0);
});

test("each blue Muse detonator is confirmed to the blue writer room", () => {
  const io = createIo();
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });
  const musa = new (require("node:events").EventEmitter)();
  musa.id = "blue-muse";
  musa.musa = 1;
  warmup.registrarMusa(musa, 1, "LUNA");
  warmup.registrarHandlers(musa);
  warmup.forzarEstado({ activo: true, vista: true, solicitud: "lugares" });
  io.events.length = 0;

  musa.emit("calentamiento_intento", { palabra: "faro" });

  const blue = io.events.filter(({ room, event }) => (
    room === "role_escritor_1" && event === "calentamiento_estado_escritor"
  ));
  const red = io.events.filter(({ room, event }) => (
    room === "role_escritor_2" && event === "calentamiento_estado_escritor"
  ));
  assert.equal(blue.length, 1);
  assert.equal(red.length, 1);
  assert.deepEqual(
    blue[0].payload.equipos[1].palabras.map(({ palabra, nombre_musa }) => ({ palabra, nombre_musa })),
    [{ palabra: "faro", nombre_musa: "LUNA" }]
  );
  assert.equal(blue[0].payload.equipo_destino, 1);
  assert.equal(red[0].payload.equipo_destino, 2);
});

test("Debug detonators use the real warmup model and can be removed without touching real Muse words", () => {
  const io = createIo();
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });

  const result = warmup.inyectarDetonadoresDebug({ seq: 2, cantidad: 6 });
  const state = warmup.payloadEstado();

  assert.equal(result.ok, true);
  assert.equal(result.agregadas, 6);
  assert.equal(state.activo, true);
  assert.equal(state.vista, true);
  assert.equal(state.solicitud, "lugares");
  assert.equal(state.equipos[1].palabras.length, 3);
  assert.equal(state.equipos[2].palabras.length, 3);
  assert.match(state.equipos[1].palabras[0].nombre_musa, /^MUSA AZUL /);
  assert.match(state.equipos[2].palabras[0].nombre_musa, /^MUSA ROJA /);
  assert.ok(io.events.some(({ event }) => event === "calentamiento_estado_espectador"));

  const cleared = warmup.limpiarDetonadoresDebug();
  assert.equal(cleared.eliminadas, 6);
  assert.equal(warmup.payloadEstado().equipos[1].palabras.length, 0);
  assert.equal(warmup.payloadEstado().equipos[2].palabras.length, 0);
  assert.equal(warmup.payloadEstado().equipos[1].intentos, 0);
  assert.equal(warmup.payloadEstado().equipos[2].intentos, 0);
  assert.equal(warmup.payloadEstado().equipos[1].ultimoIntento, null);
  assert.equal(warmup.payloadEstado().equipos[2].ultimoIntento, null);
});
