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
