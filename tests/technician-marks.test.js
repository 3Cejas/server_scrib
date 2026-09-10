const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorMarcasTecnico } = require("../technician_marks.js");

function crearIo() {
  const events = [];
  return {
    events,
    to(room) {
      return { emit: (event, payload) => events.push({ room, event, payload }) };
    }
  };
}

test("technician marks sync by team and debug marks never reach actors", () => {
  const io = crearIo();
  const manager = crearGestorMarcasTecnico({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null),
    isDebugMode: () => true
  });

  manager.cargarMarcasPrueba();
  const actorEvent = io.events.find((item) => item.room === "role_actor_1");
  const technicianEvent = io.events.find((item) => item.room === "role_tecnico_1");

  assert.ok(actorEvent);
  assert.ok(technicianEvent);
  assert.equal(actorEvent.payload.marks.length, 0);
  assert.ok(technicianEvent.payload.marks.length > 0);
  assert.equal(technicianEvent.payload.marks.every((mark) => mark.technicianOnly), true);
});

test("actor marks are visible to actor and technician rooms", () => {
  const io = crearIo();
  const manager = crearGestorMarcasTecnico({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });
  const mark = { id: "actor-note", start: 0, end: 4, quote: "Hola", note: "Respira" };
  const handlers = new Map();
  const socket = {
    actor: 1,
    on: (event, handler) => handlers.set(event, handler),
    emit: () => {}
  };
  manager.registrarHandlers(socket);
  handlers.get("actor_marcas_actualizar")({ marks: [mark] });

  const actor = io.events.filter((item) => item.room === "role_actor_1").pop();
  const technician = io.events.filter((item) => item.room === "role_tecnico_1").pop();
  assert.equal(actor.payload.marks[0].note, "Respira");
  assert.equal(technician.payload.marks[0].note, "Respira");
});
