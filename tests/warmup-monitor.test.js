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
