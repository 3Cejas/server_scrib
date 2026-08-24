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

test("tutorial words keep their authoritative muse name through selection and reconnection", () => {
  const io = createIo();
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });
  const createMuse = (id, name) => {
    const socket = new EventEmitter();
    socket.id = id;
    socket.musa = 1;
    warmup.registrarMusa(socket, 1, name);
    warmup.registrarHandlers(socket);
    return socket;
  };
  const luna = createMuse("muse-luna", "LUNA");
  const sol = createMuse("muse-sol", "SOL");
  warmup.forzarEstado({ activo: true, vista: true, solicitud: "lugares" });

  luna.emit("calentamiento_intento", { palabra: "playa", nombre_musa: "FALSA" });
  sol.emit("calentamiento_intento", { palabra: "montaña", nombre_musa: "FALSA" });

  let team = warmup.payloadEstado().equipos[1];
  assert.deepEqual(
    team.palabras.map(({ palabra, nombre_musa }) => ({ palabra, nombre_musa })),
    [
      { palabra: "playa", nombre_musa: "LUNA" },
      { palabra: "montaña", nombre_musa: "SOL" }
    ]
  );
  assert.equal(team.ultimoIntento.nombre_musa, "SOL");
  assert.equal(Object.prototype.hasOwnProperty.call(team.palabras[0], "socketId"), false);

  warmup.desregistrarMusa(luna, 1);
  const lunaReconectada = createMuse("muse-luna-new", "LUNA");
  lunaReconectada.emit("calentamiento_intento", { palabra: "bosque" });
  team = warmup.payloadEstado().equipos[1];
  assert.deepEqual(
    team.palabras.map(({ palabra, nombre_musa }) => ({ palabra, nombre_musa })),
    [
      { palabra: "playa", nombre_musa: "LUNA" },
      { palabra: "montaña", nombre_musa: "SOL" },
      { palabra: "bosque", nombre_musa: "LUNA" }
    ]
  );

  const writer = new EventEmitter();
  writer.id = "writer-1";
  writer.escritxr = 1;
  warmup.registrarHandlers(writer);
  const selectedId = team.palabras[0].id;
  writer.emit("calentamiento_click_palabra", { id: selectedId });
  writer.emit("calentamiento_bloquear_equipo");
  writer.emit("calentamiento_click_palabra", { id: selectedId });

  team = warmup.payloadEstado().equipos[1];
  assert.equal(team.final.palabra, "playa");
  assert.equal(team.final.nombre_musa, "LUNA");
});

test("tutorial replaces an offensive muse name with the safe public fallback", () => {
  const io = createIo();
  const socket = new EventEmitter();
  socket.id = "muse-offensive-name";
  socket.musa = 1;
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null)
  });
  warmup.registrarMusa(socket, 1, "<b>p.u.t.a</b>");
  warmup.registrarHandlers(socket);
  warmup.forzarEstado({ activo: true, vista: true, solicitud: "acciones" });

  socket.emit("calentamiento_intento", { palabra: "volar" });

  const payload = warmup.payloadEstado().equipos[1];
  assert.equal(payload.palabras[0].nombre_musa, "MUSA");
  assert.equal(payload.ultimoIntento.nombre_musa, "MUSA");
  assert.equal(JSON.stringify(payload).includes("p.u.t.a"), false);
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

test("only control or the internal simulator can start or reconfigure the tutorial", () => {
  const io = createIo();
  const socket = new EventEmitter();
  socket.id = "intruder";
  let starts = 0;
  const warmup = crearGestorCalentamiento({
    io,
    validarJugador: (value) => ([1, 2].includes(Number(value)) ? Number(value) : null),
    onTutorialIniciado: () => {
      starts += 1;
    }
  });
  warmup.registrarHandlers(socket);

  socket.emit("reiniciar_calentamiento");
  socket.emit("cambiar_vista_calentamiento", { activo: true });
  socket.emit("calentamiento_solicitud", { tipo: "lugares" });
  assert.equal(warmup.payloadEstado().activo, false);
  assert.equal(warmup.payloadEstado().vista, false);
  assert.equal(warmup.payloadEstado().solicitud, "ninguna");
  assert.equal(starts, 0);

  socket.control = true;
  socket.emit("cambiar_vista_calentamiento", { activo: true });
  assert.equal(warmup.payloadEstado().activo, true);
  assert.equal(warmup.payloadEstado().vista, true);
  assert.equal(starts, 1);
});
