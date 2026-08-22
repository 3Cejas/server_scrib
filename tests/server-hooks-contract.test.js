const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const io = require("socket.io-client");
const { REGALO_BANDERA_MUSAS_OBJETIVO } = require("../musas_auxiliares.js");

const ROOT_DIR = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(__dirname, "fixtures");

let serverProcess = null;
let adminSocket = null;
let serverPort = 0;
const roleSockets = new Set();

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = address && typeof address === "object" ? address.port : 0;
      srv.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

async function waitForPort(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for 127.0.0.1:${port}`);
}

function connectSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting socket"));
    }, 10000);
    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function emitAck(socket, eventName, payload = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ack: ${eventName}`));
    }, timeoutMs);
    socket.emit(eventName, payload, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function waitForSocketEvent(socket, eventName, predicate = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for socket event: ${eventName}`));
    }, timeoutMs);
    const handler = (payload) => {
      try {
        if (typeof predicate === "function" && !predicate(payload)) {
          return;
        }
        clearTimeout(timeout);
        socket.off(eventName, handler);
        resolve(payload);
      } catch (error) {
        clearTimeout(timeout);
        socket.off(eventName, handler);
        reject(error);
      }
    };
    socket.on(eventName, handler);
  });
}

function assertNoSocketEvent(socket, eventName, timeoutMs = 250) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      clearTimeout(timeout);
      socket.off(eventName, handler);
      reject(new Error(`Unexpected socket event ${eventName}: ${JSON.stringify(payload)}`));
    };
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      resolve();
    }, timeoutMs);
    socket.on(eventName, handler);
  });
}

async function waitForState(description, predicate, timeoutMs = 10000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const state = await emitAck(adminSocket, "scrib_test:get_state", {});
    if (predicate(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function connectRole(registerEvent, payload) {
  const socket = await connectSocket(serverPort);
  roleSockets.add(socket);
  socket.emit(registerEvent, payload);
  return socket;
}

async function connectPassiveSocket() {
  const socket = await connectSocket(serverPort);
  roleSockets.add(socket);
  return socket;
}

function sanitizeState(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeState(item, key));
  }
  if (!value || typeof value !== "object") {
    if ((key === "ts" || key === "actualizado_en" || key === "termina_en_ts" || key === "solicitado_en") && Number(value) > 0) {
      return "__TS__";
    }
    if ((key === "revision" || key === "modo_seq" || key === "count_seq" || key === "tiempo_seq") && Number.isFinite(Number(value)) && Number(value) > 0) {
      return "__SEQ__";
    }
    if ((key === "tiempo_restante_ms" || key === "restante_ms") && Number(value) > 0) {
      return "__POSITIVE_MS__";
    }
    return value;
  }
  const output = {};
  Object.keys(value).forEach((childKey) => {
    output[childKey] = sanitizeState(value[childKey], childKey);
  });
  return output;
}

async function assertSnapshot(snapshotName, value) {
  await ensureDir(FIXTURES_DIR);
  const fixturePath = path.join(FIXTURES_DIR, snapshotName);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_SNAPSHOTS === "1") {
    await fsp.writeFile(fixturePath, serialized, "utf8");
    return;
  }
  const expected = await fsp.readFile(fixturePath, "utf8");
  assert.equal(serialized, expected);
}

async function seedPopulatedState() {
  const control = await connectRole("registrar_control");
  const spectator = await connectRole("registrar_espectador");
  const writer1 = await connectRole("registrar_escritor", 1);
  const writer2 = await connectRole("registrar_escritor", 2);
  await connectRole("registrar_musa", { musa: 1, nombre: "Musa Uno", client_id: "musauno" });
  await connectRole("registrar_musa", { musa: 2, nombre: "Musa Dos", client_id: "musados" });
  await connectRole("registrar_actor", { player: 1 });
  await connectRole("registrar_actor", { player: 2 });

  await emitAck(adminSocket, "scrib_test:force_mode", { mode: "letra bendita", letra: "K" });

  writer1.emit("texto1", {
    text: "texto azul",
    points: "2 palabras",
    caretPos: 0,
    caretLine: 0,
    caretRatio: 1,
    caretPath: null,
    caretOffset: 0,
    texto_guardado: "texto azul"
  });
  writer2.emit("texto2", {
    text: "texto rojo",
    points: "2 palabras",
    caretPos: 0,
    caretLine: 0,
    caretRatio: 1,
    caretPath: null,
    caretOffset: 0,
    texto_guardado: "texto rojo"
  });

  control.emit("teleprompter_control", {
    state: {
      visible: true,
      text: "teleprompter snapshot",
      fontSize: 40,
      speed: 30,
      playing: true,
      scroll: 12,
      source: 1,
      loadId: 7
    }
  });
  spectator.emit("teleprompter_ack", {
    loadId: 7,
    source: 1,
    rendered: true,
    overlayActive: true,
    timerActive: false,
    visible: true,
    textLength: 21
  });
  control.emit("activar_banderas_musas", { activa: true });
  await waitForState(
    "flags active before seeded musa heart",
    (nextState) => nextState.musas.banderas.activa === true
  );
  writer1.emit("resucitar_menu", {
    player: 1,
    visible: true,
    menu: "quantity",
    mainIndex: 1,
    quantityIndex: 2,
    palabras: 3,
    max: 10,
    segundos: 15
  });
  await emitAck(adminSocket, "scrib_test:force_vote", {
    team: 1,
    opciones: ["UNO", "DOS"],
    duracion_ms: 9000
  });
  await emitAck(adminSocket, "scrib_test:simulate_musa_heart", {
    team: 1
  });
  await emitAck(adminSocket, "scrib_test:force_warmup_state", {
    activo: true,
    vista: true,
    solicitud: "lugares"
  });

  return waitForState(
    "populated server state",
    (nextState) => nextState.connections.control.connected
      && nextState.connections.spectator.connected
      && nextState.connections.writers[1].connected
      && nextState.connections.writers[2].connected
      && nextState.connections.musas[1].connected
      && nextState.connections.musas[2].connected
      && nextState.connections.actors[1].connected
      && nextState.connections.actors[2].connected
      && nextState.partida.modo_actual === "letra bendita"
      && nextState.textos[1].plano === "texto azul"
      && nextState.textos[2].plano === "texto rojo"
      && nextState.teleprompter.state.visible === true
      && nextState.votacion_ventaja.activa === true
      && nextState.resurreccion[1].visible === true
      && nextState.musas.banderas.activa === true
      && nextState.musas.corazones[1].count === 1
      && nextState.tutorial.activo === true
  );
}

test.before(async () => {
  serverPort = await getFreePort();
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(serverPort),
      NODE_ENV: "test",
      SCRIB_TEST_HOOKS: "1"
    },
    windowsHide: true
  });
  serverProcess.stdout.on("data", () => {});
  serverProcess.stderr.on("data", () => {});
  await waitForPort(serverPort);
  adminSocket = await connectSocket(serverPort);
});

test.after(async () => {
  for (const socket of roleSockets) {
    socket.close();
  }
  roleSockets.clear();
  if (adminSocket) {
    adminSocket.close();
    adminSocket = null;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

test.afterEach(async () => {
  for (const socket of roleSockets) {
    socket.close();
  }
  roleSockets.clear();
  await emitAck(adminSocket, "scrib_test:reset", {});
});

test("scrib_test:get_state initial snapshot matches contract", async () => {
  await emitAck(adminSocket, "scrib_test:reset", {});
  const state = await emitAck(adminSocket, "scrib_test:get_state", {});
  await assertSnapshot("get-state.initial.snapshot.json", sanitizeState(state));
});

test("dramaturgy registration returns current state and replays semantic live events", async () => {
  const dramaturgy = await connectPassiveSocket();
  const initialPromise = waitForSocketEvent(
    dramaturgy,
    "dramaturgia_estado",
    (payload) => payload && payload.connections
      && payload.connections.dramaturgia
      && payload.connections.dramaturgia.count === 1
  );

  dramaturgy.emit("registrar_dramaturgia");
  const initial = await initialPromise;

  assert.equal(initial.schema_version, 1);
  assert.deepEqual(Object.keys(initial.session), ["id", "started_at", "last_seq"]);
  assert.equal(typeof initial.session.id, "string");
  assert.ok(initial.session.started_at > 0);
  assert.equal(initial.partida.modo_actual, "");
  assert.equal(Object.prototype.hasOwnProperty.call(initial, "enabled"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(initial, "actual"), false);
  assert.deepEqual(initial.nombres, { 1: "", 2: "" });
  assert.deepEqual(initial.atributos, { 1: {}, 2: {} });
  assert.equal(typeof initial.conteos[1].modo_seq, "number");
  assert.ok(Array.isArray(initial.eventos));

  const modeEventPromise = waitForSocketEvent(
    dramaturgy,
    "dramaturgia_evento",
    (payload) => payload && payload.tipo === "modo"
      && payload.modo === "letra bendita"
  );
  await emitAck(adminSocket, "scrib_test:force_mode", {
    mode: "letra bendita",
    letra: "K"
  });
  const modeEvent = await modeEventPromise;
  assert.equal(typeof modeEvent.checkpoint_id, "string");
  assert.ok(modeEvent.checkpoint_id.length > 0);
  assert.deepEqual(Object.keys(modeEvent), [
    "id",
    "seq",
    "ts",
    "checkpoint_id",
    "tipo",
    "titulo",
    "detalle",
    "espacio",
    "fase",
    "modo",
    "modo_seq",
    "causa_ids",
    "hechos"
  ]);

  const replayPromise = waitForSocketEvent(
    dramaturgy,
    "dramaturgia_estado",
    (payload) => payload && Array.isArray(payload.eventos)
      && payload.eventos.some(({ id }) => id === modeEvent.id)
  );
  dramaturgy.emit("pedir_estado_dramaturgia");
  const replay = await replayPromise;
  assert.ok(replay.session.last_seq >= modeEvent.seq);
  assert.equal(
    replay.eventos.find(({ id }) => id === modeEvent.id).checkpoint_id,
    modeEvent.checkpoint_id
  );

  const passive = await connectPassiveSocket();
  const noState = assertNoSocketEvent(passive, "dramaturgia_estado");
  passive.emit("pedir_estado_dramaturgia");
  await noState;
});

test("scrib_test:force_vote open/close contracts remain stable", async () => {
  const opened = await emitAck(adminSocket, "scrib_test:force_vote", {
    team: 1,
    opciones: ["UNO", "DOS"],
    duracion_ms: 9000
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.vote.activa, true);
  assert.equal(opened.vote.equipo, "j1");
  assert.deepEqual(opened.vote.opciones, ["UNO", "DOS"]);
  assert.deepEqual(opened.state.votacion_ventaja.opciones, ["UNO", "DOS"]);
  assert.equal(opened.state.votacion_ventaja.activa, true);

  const closed = await emitAck(adminSocket, "scrib_test:force_vote", {
    active: false,
    emitir_resultado: false,
    seleccion: "DOS"
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.vote.equipo, "j1");
  assert.equal(closed.vote.perdedor, "j2");
  assert.equal(closed.vote.seleccion, "DOS");
  assert.equal(closed.state.votacion_ventaja.activa, false);
  assert.deepEqual(closed.state.votacion_ventaja.opciones, []);
});

test("scrib_test:force_vote close invalidates stale auto-close timers", async () => {
  const watcher = await connectPassiveSocket();

  const opened = await emitAck(adminSocket, "scrib_test:force_vote", {
    team: 1,
    opciones: ["UNO", "DOS"],
    duracion_ms: 60
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.state.votacion_ventaja.activa, true);

  const closed = await emitAck(adminSocket, "scrib_test:force_vote", {
    active: false,
    emitir_resultado: false,
    seleccion: "UNO"
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.state.votacion_ventaja.activa, false);

  await assertNoSocketEvent(watcher, "enviar_ventaja_j2", 180);

  const state = await emitAck(adminSocket, "scrib_test:get_state", {});
  assert.equal(state.votacion_ventaja.activa, false);
  assert.deepEqual(state.votacion_ventaja.opciones, []);
});

test("scrib_test:force_finish_player marks the requested player as finished", async () => {
  await emitAck(adminSocket, "scrib_test:force_mode", { mode: "letra bendita", letra: "K" });
  const result = await emitAck(adminSocket, "scrib_test:force_finish_player", {
    player: 1,
    reiniciar: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.player, 1);
  assert.equal(result.state.partida.fin_j1, true);
  assert.equal(result.state.partida.fin_j2, false);
  assert.equal(result.state.partida.modo_actual, "letra bendita");
});

test("stale writer sockets cannot overwrite the active writer text", async () => {
  const watcher = await connectPassiveSocket();
  const staleWriter = await connectRole("registrar_escritor", 1);
  await waitForState(
    "first writer socket registered",
    (state) => state.connections.writers[1].count === 1
  );

  const replacementNotice = waitForSocketEvent(
    staleWriter,
    "escritor_reemplazado",
    (payload) => payload && payload.player === 1
  );
  const currentWriter = await connectRole("registrar_escritor", 1);
  const replacedPayload = await replacementNotice;
  assert.match(replacedPayload.mensaje, /Otra sesi\u00f3n activa/);
  await waitForState(
    "second writer socket replaced first writer socket",
    (state) => state.connections.writers[1].count === 1
  );

  const currentEvent = waitForSocketEvent(
    watcher,
    "texto1",
    (payload) => payload && payload.text === "texto vigente"
  );
  currentWriter.emit("texto1", {
    text: "texto vigente",
    points: "2 palabras",
    caretPos: 0,
    caretLine: 0,
    caretRatio: 1,
    caretPath: null,
    caretOffset: 0,
    texto_guardado: "texto vigente"
  });
  await currentEvent;
  await waitForState(
    "current writer text stored",
    (state) => state.textos[1].plano === "texto vigente"
  );

  const staleEventBlocked = assertNoSocketEvent(watcher, "texto1", 250);
  staleWriter.emit("texto1", {
    text: "texto antiguo",
    points: "2 palabras",
    caretPos: 0,
    caretLine: 0,
    caretRatio: 1,
    caretPath: null,
    caretOffset: 0,
    texto_guardado: "texto antiguo"
  });
  await staleEventBlocked;

  const state = await emitAck(adminSocket, "scrib_test:get_state", {});
  assert.equal(state.textos[1].plano, "texto vigente");
});

test("scrib_test:force_mode updates mode-specific state for letter and bonus modes", async () => {
  const bendita = await emitAck(adminSocket, "scrib_test:force_mode", {
    mode: "letra bendita",
    letra: "Z"
  });
  assert.equal(bendita.ok, true);
  assert.equal(bendita.mode, "letra bendita");
  assert.equal(bendita.state.partida.modo_actual, "letra bendita");
  assert.equal(bendita.state.partida.letra_bendita, "Z");
  assert.equal(bendita.state.inspiracion.preview.modo_actual, "letra bendita");
  assert.equal(bendita.state.inspiracion.preview.letra_bendita, "Z");
  assert.equal(bendita.state.partida.timeline.at(-1).origen, "scrib_test:force_mode");

  const bonus = await emitAck(adminSocket, "scrib_test:force_mode", {
    mode: "palabras bonus"
  });
  assert.equal(bonus.ok, true);
  assert.equal(bonus.mode, "palabras bonus");
  assert.equal(bonus.state.partida.modo_actual, "palabras bonus");
  assert.equal(bonus.state.partida.fin_j1, false);
  assert.equal(bonus.state.partida.fin_j2, false);
  assert.equal(bonus.state.stats.modo_actual, "palabras bonus");
  assert.equal(bonus.state.inspiracion.preview.modo_actual, "palabras bonus");
});

test("scrib_test:simulate_musa_heart rejects invalid teams and accumulates feedback", async () => {
  const invalid = await emitAck(adminSocket, "scrib_test:simulate_musa_heart", {
    team: 9
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /equipo invalido/i);

  const first = await emitAck(adminSocket, "scrib_test:simulate_musa_heart", {
    team: 1
  });
  assert.equal(first.ok, true);
  assert.equal(first.equipo, 1);
  assert.equal(first.state.musas.corazones[1].count, 1);

  const second = await emitAck(adminSocket, "scrib_test:simulate_musa_heart", {
    team: 1
  });
  assert.equal(second.ok, true);
  assert.equal(second.state.musas.corazones[1].count, 2);
  assert.equal(second.state.musas.corazones[2].count, 0);
});

test("musa counters stay idempotent across duplicate registration and team changes", async () => {
  const musa = await connectPassiveSocket();

  musa.emit("registrar_musa", { musa: 1, nombre: "Luna", client_id: "luna" });
  await waitForState(
    "single musa counted for team 1",
    (state) => state.musas.contador.escritxr1 === 1
      && state.musas.contador.escritxr2 === 0
      && state.connections.musas[1].count === 1
      && state.musas.regalo_bandera.equipos[1].musas === 1
  );

  musa.emit("registrar_musa", { musa: 1, nombre: "Luna", client_id: "luna" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const duplicated = await emitAck(adminSocket, "scrib_test:get_state", {});
  assert.equal(duplicated.musas.contador.escritxr1, 1);
  assert.equal(duplicated.connections.musas[1].count, 1);
  assert.equal(duplicated.musas.regalo_bandera.equipos[1].musas, 1);

  musa.emit("registrar_musa", { musa: 2, nombre: "Sol", client_id: "sol" });
  await waitForState(
    "musa moved from team 1 to team 2",
    (state) => state.musas.contador.escritxr1 === 0
      && state.musas.contador.escritxr2 === 1
      && state.connections.musas[1].count === 0
      && state.connections.musas[2].count === 1
      && state.musas.regalo_bandera.equipos[1].musas === 0
      && state.musas.regalo_bandera.equipos[2].musas === 1
  );

  musa.close();
  await waitForState(
    "musa counter clears after disconnect",
    (state) => state.musas.contador.escritxr1 === 0
      && state.musas.contador.escritxr2 === 0
      && state.connections.musas[1].count === 0
      && state.connections.musas[2].count === 0
  );
});

test("musa flag hearts add time only while a match is running", async () => {
  const watcher = await connectPassiveSocket();
  const writer1 = await connectRole("registrar_escritor", 1);

  adminSocket.emit("activar_banderas_musas", { activa: true });
  await waitForState(
    "musa flags active outside a match",
    (state) => state.musas.banderas.activa === true
  );

  const sinRegaloFueraDePartida = assertNoSocketEvent(watcher, "aumentar_tiempo_control", 1000);
  for (let i = 0; i < REGALO_BANDERA_MUSAS_OBJETIVO; i += 1) {
    await emitAck(adminSocket, "scrib_test:simulate_musa_heart", { team: 1 });
  }
  await sinRegaloFueraDePartida;

  const inactiveState = await emitAck(adminSocket, "scrib_test:get_state", {});
  assert.equal(inactiveState.musas.regalo_bandera.equipos[1].visible, false);
  assert.equal(inactiveState.musas.regalo_bandera.equipos[1].progreso, 0);

  await emitAck(adminSocket, "scrib_test:reset", {});
  await emitAck(adminSocket, "scrib_test:force_mode", { mode: "letra bendita", letra: "K" });
  adminSocket.emit("activar_banderas_musas", { activa: true });
  await waitForState(
    "musa flags active during a match",
    (state) => state.partida.modo_actual === "letra bendita" && state.musas.banderas.activa === true
  );

  const countSeen = waitForSocketEvent(
    watcher,
    "count",
    (payload) => payload && Number(payload.player) === 1 && payload.count === "00:20"
  );
  writer1.emit("count", {
    player: 1,
    count: "00:20",
    count_seq: 1
  });
  await countSeen;

  const regaloPromise = waitForSocketEvent(
    watcher,
    "aumentar_tiempo_control",
    (payload) => payload
      && payload.origen === "musa_bandera"
      && Number(payload.player) === 1
  );

  for (let i = 0; i < REGALO_BANDERA_MUSAS_OBJETIVO; i += 1) {
    await emitAck(adminSocket, "scrib_test:simulate_musa_heart", { team: 1 });
  }

  const regalo = await regaloPromise;
  assert.equal(regalo.secs, 1);
  assert.equal(regalo.count_seconds_after, 21);
  assert.equal(regalo.count_after, "00:21");

  const activeState = await emitAck(adminSocket, "scrib_test:get_state", {});
  assert.equal(activeState.musas.regalo_bandera.equipos[1].visible, true);
  assert.equal(activeState.musas.regalo_bandera.equipos[1].progreso, 0);
  assert.equal(activeState.musas.regalo_bandera.equipos[1].regalo_secs, 1);
});

test("scrib_test:force_warmup_state toggles tutorial state and spectator view coherently", async () => {
  const enabled = await emitAck(adminSocket, "scrib_test:force_warmup_state", {
    activo: true,
    vista: true,
    solicitud: "acciones"
  });
  assert.equal(enabled.ok, true);
  assert.equal(enabled.tutorial.activo, true);
  assert.equal(enabled.tutorial.vista, true);
  assert.equal(enabled.tutorial.solicitud, "acciones");
  assert.equal(enabled.state.espectador.modo, "calentamiento");
  assert.equal(enabled.state.espectador.calentamiento_vista, true);

  const disabled = await emitAck(adminSocket, "scrib_test:force_warmup_state", {
    activo: false,
    vista: false,
    solicitud: "frase_final"
  });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.tutorial.activo, false);
  assert.equal(disabled.tutorial.vista, false);
  assert.equal(disabled.tutorial.solicitud, "frase_final");
  assert.equal(disabled.state.espectador.calentamiento_vista, false);
});

test("scrib_test:reset clears a populated state back to the initial contract", async () => {
  await seedPopulatedState();
  const reset = await emitAck(adminSocket, "scrib_test:reset", {});
  assert.equal(reset.ok, true);
  assert.equal(reset.state.partida.modo_actual, "");
  assert.equal(reset.state.teleprompter.state.visible, false);
  assert.equal(reset.state.votacion_ventaja.activa, false);
  assert.equal(reset.state.musas.corazones[1].count, 0);
  assert.equal(reset.state.tutorial.activo, false);
  await assertSnapshot("get-state.reset-connected.snapshot.json", sanitizeState(reset.state));
});

test("scrib_test:get_state populated snapshot matches contract", async () => {
  const state = await seedPopulatedState();
  await assertSnapshot("get-state.populated.snapshot.json", sanitizeState(state));
});

test("stats_live_estado event payload matches contract after a deterministic update", async () => {
  const watcher = await connectPassiveSocket();
  const control = await connectRole("registrar_control");

  const eventPromise = waitForSocketEvent(
    watcher,
    "stats_live_estado",
    (payload) => payload && payload.players && payload.players[1] && payload.players[1].nombre === "AZUL TEST"
  );

  control.emit("stats_live_actualizar", {
    modo_actual: "palabras bonus",
    players: {
      1: {
        id: 1,
        nombre: "AZUL TEST",
        palabrasTotal: 12,
        palabrasUnicas: 9,
        pulsacionesTotal: 58,
        teclasDistintas: 14,
        topTeclas: [
          { key: "a", count: 9 },
          { key: "e", count: 7 }
        ],
        heatmap: { a: 9, e: 7 },
        ritmoPpm: 61,
        tiempoTotalMs: 30000,
        tiempoEscrituraMs: 21000,
        vida: {
          actual: 13,
          min: 8,
          max: 20,
          media: 14
        },
        letrasBenditas: ["A"],
        letrasMalditas: ["K"],
        palabrasBenditas: ["aurora"],
        palabrasMalditas: ["tormenta"],
        intentosLetraProhibida: 2,
        intentosPalabraProhibida: 1
      },
      2: {
        id: 2,
        nombre: "ROJO TEST",
        palabrasTotal: 9,
        palabrasUnicas: 7,
        pulsacionesTotal: 41,
        teclasDistintas: 11,
        topTeclas: [
          { key: "o", count: 6 }
        ],
        heatmap: { o: 6 },
        ritmoPpm: 47,
        tiempoTotalMs: 28000,
        tiempoEscrituraMs: 18000,
        vida: {
          actual: 11,
          min: 6,
          max: 18,
          media: 12
        },
        letrasBenditas: ["O"],
        letrasMalditas: ["P"],
        palabrasBenditas: ["brasa"],
        palabrasMalditas: ["humo"],
        intentosLetraProhibida: 1,
        intentosPalabraProhibida: 3
      }
    }
  });

  const payload = await eventPromise;
  await assertSnapshot("stats-live.event.snapshot.json", sanitizeState(payload));
});

test("final score captures final control telemetry once after both players finish", async () => {
  const control = await connectRole("registrar_control");
  const passive = await connectPassiveSocket();
  await emitAck(adminSocket, "scrib_test:force_mode", { mode: "frase final" });

  await emitAck(control, "stats_live_actualizar", {
    players: {
      1: { palabrasTotal: 2, palabrasUnicas: 2, ritmoPpm: 5, vida: { media: 1 } },
      2: { palabrasTotal: 200, palabrasUnicas: 100, ritmoPpm: 100, vida: { media: 50 } }
    }
  });
  await emitAck(adminSocket, "scrib_test:force_finish_player", {
    player: 1,
    reiniciar: false,
    mostrar_resurreccion: false
  });
  const fin = await emitAck(adminSocket, "scrib_test:force_finish_player", {
    player: 2,
    mostrar_resurreccion: false
  });
  assert.equal(fin.state.puntuacion_final.disponible, false);
  assert.equal(fin.state.puntuacion_final.calculado_en_ts, 0);

  const finalStatsAck = await emitAck(control, "stats_live_actualizar", {
    modo_actual: "frase final",
    players: {
      1: {
        palabrasTotal: 100,
        palabrasUnicas: 70,
        ritmoPpm: 90,
        palabrasBenditas: ["luz", "mar", "sol"],
        intentosLetraProhibida: 0,
        intentosPalabraProhibida: 1,
        vida: { media: 45 }
      },
      2: {
        palabrasTotal: 40,
        palabrasUnicas: 20,
        ritmoPpm: 50,
        palabrasBenditas: ["fuego"],
        intentosLetraProhibida: 2,
        intentosPalabraProhibida: 2,
        vida: { media: 20 }
      }
    }
  });
  assert.deepEqual(finalStatsAck, { ok: true });

  const noAutorizada = await emitAck(passive, "capturar_puntuacion_final", {});
  assert.deepEqual(noAutorizada, { ok: false, code: "NOT_AUTHORIZED" });

  const primera = await emitAck(control, "capturar_puntuacion_final", {});
  assert.equal(primera.ok, true);
  assert.equal(primera.capturada, true);
  assert.equal(primera.puntuacion.disponible, true);
  assert.equal(primera.puntuacion.datos_suficientes, true);
  assert.equal(primera.puntuacion.ganador, 1);
  assert.equal(primera.puntuacion.categorias.length, 6);
  const totalFijado = primera.puntuacion.jugadores[1].total;
  const tsFijado = primera.puntuacion.calculado_en_ts;

  await emitAck(control, "stats_live_actualizar", {
    players: {
      1: { palabrasTotal: 1, palabrasUnicas: 1, ritmoPpm: 1, vida: { media: 1 } },
      2: { palabrasTotal: 999, palabrasUnicas: 999, ritmoPpm: 999, vida: { media: 999 } }
    }
  });
  const repetida = await emitAck(control, "capturar_puntuacion_final", {});
  assert.equal(repetida.ok, true);
  assert.equal(repetida.capturada, false);
  assert.equal(repetida.ya_capturada, true);
  assert.equal(repetida.puntuacion.jugadores[1].total, totalFijado);
  assert.equal(repetida.puntuacion.calculado_en_ts, tsFijado);
  assert.equal(repetida.puntuacion.ganador, 1);
});

test("teleprompter_state event payload matches contract after control update", async () => {
  const watcher = await connectPassiveSocket();
  const control = await connectRole("registrar_control");

  const eventPromise = waitForSocketEvent(
    watcher,
    "teleprompter_state",
    (payload) => payload
      && payload.state
      && payload.state.visible === true
      && payload.state.loadId === 42
  );

  control.emit("teleprompter_control", {
    state: {
      visible: true,
      text: "Teleprompter contract payload con texto estable",
      fontSize: 44,
      speed: 28,
      playing: false,
      scroll: 120,
      source: 2,
      loadId: 42
    }
  });

  const payload = await eventPromise;
  await assertSnapshot("teleprompter-state.event.snapshot.json", sanitizeState(payload));
});

test("teleprompter_ack event payload matches contract after spectator acknowledgement", async () => {
  const watcher = await connectPassiveSocket();
  const spectator = await connectRole("registrar_espectador");

  const eventPromise = waitForSocketEvent(
    watcher,
    "teleprompter_ack",
    (payload) => payload && payload.loadId === 42 && payload.source === 2
  );

  spectator.emit("teleprompter_ack", {
    loadId: 42,
    source: 2,
    rendered: true,
    overlayActive: true,
    timerActive: false,
    visible: true,
    textLength: 47
  });

  const payload = await eventPromise;
  await assertSnapshot("teleprompter-ack.event.snapshot.json", sanitizeState(payload));
});

test("nube_inspiracion_estado event payload matches contract after musa inspiration", async () => {
  const watcher = await connectPassiveSocket();
  const musa1 = await connectRole("registrar_musa", {
    musa: 1,
    nombre: "Musa Contract",
    client_id: "musa-contract"
  });

  await emitAck(adminSocket, "scrib_test:force_mode", { mode: "palabras bonus" });
  const eventPromise = waitForSocketEvent(
    watcher,
    "nube_inspiracion_estado",
    (payload) => payload
      && payload.modo_actual === "palabras bonus"
      && payload.equipos
      && Array.isArray(payload.equipos[1]?.palabras)
      && payload.equipos[1].palabras.includes("cometa")
  );

  musa1.emit("enviar_inspiracion", {
    palabra: "cometa",
    nombre: "Musa Contract"
  });

  const payload = await eventPromise;
  await assertSnapshot("nube-inspiracion.event.snapshot.json", sanitizeState(payload));
});

test("estado_banderas_musas event payload matches contract and stays compatible with activar_banderas_musas", async () => {
  const watcher = await connectPassiveSocket();
  const musa1 = await connectRole("registrar_musa", {
    musa: 1,
    nombre: "Musa Flag",
    client_id: "musa-flag"
  });

  const statePromise = waitForSocketEvent(
    watcher,
    "estado_banderas_musas",
    (payload) => payload && payload.activa === true
  );
  const compatibilityPromise = waitForSocketEvent(
    musa1,
    "activar_banderas_musas",
    (payload) => payload && payload.activa === true
  );

  watcher.emit("activar_banderas_musas", {
    activa: true,
    bloquear_desactivar: true
  });

  const statePayload = await statePromise;
  const compatibilityPayload = await compatibilityPromise;
  assert.deepEqual(sanitizeState(compatibilityPayload), sanitizeState(statePayload));
  await assertSnapshot("banderas-musas.event.snapshot.json", sanitizeState(statePayload));
});

test("votacion_ventaja events match contract for open state broadcasts", async () => {
  const watcher = await connectPassiveSocket();
  const musa1 = await connectRole("registrar_musa", {
    musa: 1,
    nombre: "Musa Vote",
    client_id: "musa-vote"
  });

  const pickerPromise = waitForSocketEvent(
    musa1,
    "elegir_ventaja_j1",
    (payload) => payload && payload.equipo === "j1"
  );
  const statePromise = waitForSocketEvent(
    watcher,
    "votacion_ventaja_estado",
    (payload) => payload && payload.activa === true && payload.equipo === "j1"
  );

  await emitAck(adminSocket, "scrib_test:force_vote", {
    team: 1,
    opciones: ["UNO", "DOS", "TRES"],
    duracion_ms: 9000
  });

  const pickerPayload = await pickerPromise;
  const statePayload = await statePromise;
  await assertSnapshot("votacion-ventaja-open.event.snapshot.json", sanitizeState(statePayload));
  await assertSnapshot("elegir-ventaja-j1.event.snapshot.json", sanitizeState(pickerPayload));
});

test("feedback_musas_estado event payload matches contract after requesting feedback", async () => {
  const control = await connectRole("registrar_control");
  const musa1 = await connectRole("registrar_musa", {
    musa: 1,
    nombre: "Musa Feedback",
    client_id: "musa-feedback"
  });

  const payloadPromise = waitForSocketEvent(
    musa1,
    "feedback_musas_estado",
    (payload) => payload && payload.activa === true
  );

  control.emit("pedir_feedback_musas", {
    url: "/feedback/custom-e2e"
  });

  const payload = await payloadPromise;
  await assertSnapshot("feedback-musas.event.snapshot.json", sanitizeState(payload));
});

test("creditos_estado event payload matches contract when spectator credits are shown", async () => {
  const watcher = await connectPassiveSocket();
  const control = await connectRole("registrar_control");

  const payloadPromise = waitForSocketEvent(
    watcher,
    "creditos_estado",
    (payload) => payload
      && payload.mostrar === true
      && payload.creditos
      && payload.creditos.escritxr_azul === "ESCRITORA AZUL TEST"
  );

  control.emit("mostrar_creditos_espectador", {
    creditos: {
      escritxr_azul: "ESCRITORA AZUL TEST",
      escritxr_rojo: "ESCRITORA ROJA TEST",
      programacion: "PROGRAMACION TEST",
      voz_off: "VOZ TEST",
      agradecimientos: ["Ana", "Luis", "Marta"]
    }
  });

  const payload = await payloadPromise;
  await assertSnapshot("creditos-estado.event.snapshot.json", sanitizeState(payload));
});

test("creditos_estado includes current match muses grouped by team", async () => {
  const watcher = await connectPassiveSocket();
  const control = await connectRole("registrar_control");
  const oldMusa = await connectRole("registrar_musa", {
    musa: 1,
    nombre: "Musa Antigua",
    client_id: "musa-antigua"
  });
  oldMusa.close();

  await emitAck(adminSocket, "scrib_test:force_mode", { mode: "letra bendita", letra: "K" });
  await connectRole("registrar_musa", {
    musa: 1,
    nombre: "Luna Azul",
    client_id: "luna-azul"
  });
  await connectRole("registrar_musa", {
    musa: 2,
    nombre: "Sol Roja",
    client_id: "sol-roja"
  });
  await waitForState(
    "current match muses registered",
    (state) => state.musas.contador.escritxr1 === 1 && state.musas.contador.escritxr2 === 1
  );

  const payloadPromise = waitForSocketEvent(watcher, "creditos_estado");

  control.emit("mostrar_creditos_espectador", { creditos: {} });

  const payload = await payloadPromise;
  assert.equal(payload.mostrar, true);
  assert.deepEqual(payload.creditos.musas, {
    azules: ["LUNA AZUL"],
    rojas: ["SOL ROJA"]
  });
});

test("vista_espectador_modo event payload matches contract when control changes the view", async () => {
  const watcher = await connectPassiveSocket();
  const control = await connectRole("registrar_control");

  const payloadPromise = waitForSocketEvent(
    watcher,
    "vista_espectador_modo",
    (payload) => payload && payload.override === "nube_inspiracion" && payload.modo === "nube_inspiracion"
  );

  control.emit("cambiar_vista_espectador_modo", {
    modo: "nube_inspiracion"
  });

  const payload = await payloadPromise;
  await assertSnapshot("vista-espectador-modo.event.snapshot.json", sanitizeState(payload));
});
