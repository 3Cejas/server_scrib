const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { crearGestorCalentamiento, normalizarPalabra } = require("../warmup.js");

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

function createActiveWarmup() {
  const io = createIo();
  const socket = new EventEmitter();
  socket.id = "muse-1";
  socket.musa = 1;
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });
  warmup.registrarMusa(socket, 1, "LUNA");
  warmup.registrarHandlers(socket);
  warmup.forzarEstado({ activo: true, vista: true, solicitud: "lugares" });
  return { io, socket, warmup };
}

for (const eventName of ["calentamiento_semilla", "calentamiento_intento"]) {
  test(`${eventName} rejects profanity before mutating or broadcasting warmup state`, () => {
    const { io, socket, warmup } = createActiveWarmup();
    let error = null;
    socket.on("calentamiento_error", (payload) => {
      error = payload;
    });
    const broadcastsBefore = io.events.length;

    socket.emit(eventName, { palabra: "p.u.t.a" });

    assert.deepEqual(error, {
      codigo: "CONTENIDO_NO_PERMITIDO",
      mensaje: "No se permiten palabrotas ni lenguaje ofensivo."
    });
    assert.equal(io.events.length, broadcastsBefore);
    assert.equal(warmup.payloadEstado().equipos[1].intentos, 0);
    assert.deepEqual(warmup.payloadEstado().equipos[1].palabras, []);
  });
}

test("clean non-Latin inspirations remain valid in the tutorial", () => {
  const { socket, warmup } = createActiveWarmup();
  let response = null;

  socket.emit("calentamiento_intento", { palabra: "مسرح" }, (payload) => {
    response = payload;
  });

  const team = warmup.payloadEstado().equipos[1];
  assert.deepEqual(response, { ok: true });
  assert.equal(team.intentos, 1);
  assert.equal(team.palabras.length, 1);
  assert.equal(team.palabras[0].palabra, "مسرح");
  assert.equal(normalizarPalabra("  ＴＥＡＴＲＯ  "), "teatro");
  assert.equal(normalizarPalabra("  Театр  "), "театр");
});

test("moderation rejections use an acknowledgement without echoing the raw input", () => {
  const { socket, warmup } = createActiveWarmup();
  let response = null;
  let legacyError = null;
  socket.on("calentamiento_error", (payload) => {
    legacyError = payload;
  });

  socket.emit("calentamiento_intento", { palabra: "f.u.c.k" }, (payload) => {
    response = payload;
  });

  assert.deepEqual(response, {
    ok: false,
    codigo: "CONTENIDO_NO_PERMITIDO",
    mensaje: "No se permiten palabrotas ni lenguaje ofensivo."
  });
  assert.equal(JSON.stringify(response).includes("f.u.c.k"), false);
  assert.equal(legacyError, null);
  assert.equal(warmup.payloadEstado().equipos[1].intentos, 0);
});
