const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const socketIo = require("socket.io");
const socketIoClient = require("socket.io-client");

const {
  AUTH_TTL_MS,
  SIMULATION_MODES,
  blockersFromConnections,
  createMatchSimulator,
  createSeededRandom,
  createSyntheticSocket,
  normalizeBoolean,
  normalizeSimulationConfig
} = require("../match_simulator.js");
const { crearRuntimeScrib } = require("../scrib_runtime.js");

function createIoProbe() {
  const emitted = [];
  const roomEmitted = [];
  return {
    emitted,
    roomEmitted,
    emit(eventName, ...args) {
      emitted.push({ eventName, args });
    },
    to(room) {
      return {
        emit(eventName, ...args) {
          roomEmitted.push({ room, eventName, args });
        }
      };
    }
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function closeSocketIo(io) {
  return new Promise((resolve) => {
    if (!io || typeof io.close !== "function") {
      resolve();
      return;
    }
    io.close(() => resolve());
  });
}

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const socket = socketIoClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timeout conectando a ${url}`));
    }, 5000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function emitAck(socket, eventName, payload = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout esperando ack de ${eventName}`));
    }, timeoutMs);
    socket.emit(eventName, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function waitFor(description, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastValue;
  while ((Date.now() - startedAt) < timeoutMs) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${description}: condición no satisfecha; último valor=${JSON.stringify(lastValue)}`);
}

async function createRuntimeHarness(t, { testHooksEnabled = true } = {}) {
  const httpServer = http.createServer();
  const io = socketIo(httpServer, {
    serveClient: false,
    cookie: false
  });
  const runtime = crearRuntimeScrib({
    io,
    passwordRoles: "clave-simulacion",
    testHooksEnabled
  });
  runtime.iniciar();
  const port = await listen(httpServer);
  const clients = new Set();

  const connect = async () => {
    const socket = await connectClient(`http://127.0.0.1:${port}`);
    clients.add(socket);
    return socket;
  };

  t.after(async () => {
    clients.forEach((socket) => {
      try {
        socket.close();
      } catch (_error) {
      }
    });
    runtime.dramaturgiaState.detener();
    await closeSocketIo(io);
    await closeHttpServer(httpServer);
  });

  return { connect, io, runtime };
}

test("normalizeSimulationConfig aplica defaults, límites, whitelist y copia defensiva", () => {
  const defaults = normalizeSimulationConfig();
  assert.equal(defaults.seed, "sutura-visual");
  assert.equal(defaults.total_seconds, 150);
  assert.equal(defaults.mode_seconds, 14);
  assert.equal(defaults.full_show, true);
  assert.deepEqual(defaults.modes, SIMULATION_MODES);

  const longSeed = `  ${"x".repeat(90)}  `;
  const config = normalizeSimulationConfig({
    seed: longSeed,
    total_seconds: -10,
    mode_seconds: 999,
    speed: 100,
    writer_ppm: 0,
    muse_interval_seconds: 0,
    muses_per_team: 9,
    votes: false,
    hearts: false,
    auto_finish: false,
    full_show: false,
    modes: [
      " TERTULIA ",
      "modo inexistente",
      "letra bendita",
      "tertulia",
      "FRASE FINAL"
    ],
    final_phrase_1: "a".repeat(300),
    final_phrase_2: " cierre "
  });

  assert.equal(config.seed.length, 64);
  assert.equal(config.total_seconds, 30);
  assert.equal(config.mode_seconds, 300);
  assert.equal(config.speed, 8);
  assert.equal(config.writer_ppm, 5);
  assert.equal(config.muse_interval_seconds, 1);
  assert.equal(config.muses_per_team, 4);
  assert.equal(config.votes, false);
  assert.equal(config.hearts, false);
  assert.equal(config.auto_finish, false);
  assert.equal(config.full_show, false);
  assert.deepEqual(config.modes, ["tertulia", "letra bendita", "frase final"]);
  assert.equal(config.final_phrase_1.length, 240);
  assert.equal(config.final_phrase_2, "cierre");

  config.modes.push("mutado");
  assert.deepEqual(normalizeSimulationConfig().modes, SIMULATION_MODES);
  assert.deepEqual(
    normalizeSimulationConfig({ modes: ["no existe"] }).modes,
    SIMULATION_MODES
  );
  assert.equal(normalizeSimulationConfig({ votes: "false" }).votes, false);
  assert.equal(normalizeSimulationConfig({ hearts: "0" }).hearts, false);
  assert.equal(normalizeSimulationConfig({ auto_finish: "on" }).auto_finish, true);
  assert.equal(normalizeBoolean("", false), false);
});

test("createSeededRandom es estable por semilla y separa semillas distintas", () => {
  const first = createSeededRandom("misma-semilla");
  const second = createSeededRandom("misma-semilla");
  const other = createSeededRandom("otra-semilla");
  const sequenceA = Array.from({ length: 8 }, () => first());
  const sequenceB = Array.from({ length: 8 }, () => second());
  const sequenceOther = Array.from({ length: 8 }, () => other());

  assert.deepEqual(sequenceA, sequenceB);
  assert.notDeepEqual(sequenceA, sequenceOther);
  sequenceA.forEach((value) => {
    assert.ok(value >= 0 && value < 1);
  });
});

test("autorización exige Dramaturgia real, valida la clave y caduca", () => {
  let currentTime = 10_000;
  const simulator = createMatchSimulator({
    passwordRoles: "secreta",
    now: () => currentTime
  });
  const owner = { id: "dramaturgia-1", dramaturgia: true };

  assert.equal(simulator.authorize({ id: "otro" }, "secreta").code, "NOT_DRAMATURGY");
  assert.equal(
    simulator.authorize({ id: "monitor", dramaturgia: true, monitor_pantalla: {} }, "secreta").code,
    "NOT_DRAMATURGY"
  );
  assert.equal(
    simulator.authorize({ id: "bot", dramaturgia: true, simulacion_scrib: {} }, "secreta").code,
    "NOT_DRAMATURGY"
  );
  assert.equal(simulator.authorize(owner, "incorrecta").code, "INVALID_PASSWORD");
  assert.equal(simulator.isAuthorized(owner), false);

  const authorized = simulator.authorize(owner, "secreta");
  assert.deepEqual(authorized, {
    ok: true,
    expires_at: currentTime + AUTH_TTL_MS
  });
  assert.equal(simulator.isAuthorized(owner), true);

  currentTime += AUTH_TTL_MS - 1;
  assert.equal(simulator.isAuthorized(owner), true);
  currentTime += 1;
  assert.equal(simulator.isAuthorized(owner), false);
});

test("blockersFromConnections y preflight bloquean roles humanos, modo y otra simulación", () => {
  const connections = {
    control: { count: 1, connected: true },
    spectator: { count: 2, connected: true },
    jury: { connected: true },
    writers: {
      1: { count: 1 },
      2: { count: 0 }
    },
    musas: {
      1: { count: 3 },
      2: { count: 0 }
    },
    actors: {
      1: { count: 0 },
      2: { count: 1 }
    }
  };
  assert.deepEqual(blockersFromConnections(connections), [
    "Control (1)",
    "Espectador (2)",
    "Jurado (1)",
    "Escritxr 1 (1)",
    "Musas 1 (3)",
    "Actorxs 2 (1)"
  ]);

  let currentConnections = connections;
  let currentMode = "";
  const simulator = createMatchSimulator({
    getConnections: () => currentConnections,
    getCurrentMode: () => currentMode
  });
  const blockedByRoles = simulator.preflight();
  assert.equal(blockedByRoles.can_start, false);
  assert.equal(blockedByRoles.code, "MATCH_ACTIVE");

  currentConnections = {};
  currentMode = "tertulia";
  const blockedByMode = simulator.preflight();
  assert.equal(blockedByMode.can_start, false);
  assert.deepEqual(blockedByMode.blockers, ["partida en modo tertulia"]);

  currentMode = "";
  assert.deepEqual(simulator.preflight(), {
    ok: true,
    can_start: true,
    blockers: [],
    code: "READY"
  });
});

test("socket sintético separa entrada/salida, conserva salas y limpia una sola vez", () => {
  const io = createIoProbe();
  const socket = createSyntheticSocket({
    id: "sim-test-writer1",
    io,
    runId: "sim-test",
    role: "writer1"
  });
  const received = [];
  let disconnects = 0;
  socket.on("texto1", (payload) => received.push(payload));
  socket.on("texto1", (payload) => received.push({ duplicate: payload }));
  socket.on("disconnect", () => {
    disconnects += 1;
  });

  socket.emit("texto1", { text: "salida" });
  assert.deepEqual(received, []);
  assert.deepEqual(socket.emitted.at(-1), {
    event: "texto1",
    args: [{ text: "salida" }]
  });

  assert.equal(socket.receive("texto1", { text: "entrada" }), true);
  assert.deepEqual(received, [
    { text: "entrada" },
    { duplicate: { text: "entrada" } }
  ]);

  socket.join("j1").join("role_escritor_1");
  assert.deepEqual([...socket.rooms].sort(), ["j1", "role_escritor_1"]);
  socket.leave("j1");
  assert.deepEqual([...socket.rooms], ["role_escritor_1"]);

  socket.broadcast.emit("texto1", { text: "broadcast" });
  assert.deepEqual(io.emitted, [{
    eventName: "texto1",
    args: [{ text: "broadcast" }]
  }]);

  assert.equal(socket.disconnect(), true);
  assert.equal(socket.disconnect(), false);
  assert.equal(disconnects, 1);
  assert.equal(socket.rooms.size, 0);
  assert.equal(socket.receive("texto1", { text: "tarde" }), false);
});

test("la velocidad acelera interacciones sin adelantar el reloj real de la partida", () => {
  let currentTime = 1_000;
  let currentMode = "";
  let tick = null;
  const simulator = createMatchSimulator({
    passwordRoles: "secreta",
    now: () => currentTime,
    registerConnection: () => {},
    getConnections: () => ({}),
    getCurrentMode: () => currentMode,
    partidaLifecycle: {
      limpiarPartida() {}
    },
    setIntervalFn(callback) {
      tick = callback;
      return { unref() {} };
    },
    clearIntervalFn() {}
  });
  const owner = { id: "dramaturgia", dramaturgia: true, emit() {} };
  assert.equal(simulator.authorize(owner, "secreta").ok, true);
  assert.equal(simulator.start(owner, {
    full_show: false,
    total_seconds: 30,
    speed: 8,
    writer_ppm: 60,
    modes: ["tertulia"]
  }).ok, true);
  currentMode = "tertulia";

  for (let index = 0; index < 15; index += 1) {
    currentTime += 250;
    tick();
  }

  const state = simulator.publicState();
  assert.equal(state.state, "running");
  assert.equal(state.metrics.elapsed_seconds, 3.8);
  assert.ok(state.metrics.words_1 > 3);
  assert.equal(simulator.stop(owner).ok, true);
});

test("full_show recorre las tres consignas, los seis modos y la representación real", () => {
  const createWarmupTeam = () => ({
    palabras: [],
    bloqueado: false,
    final: null
  });
  const createWarmupState = () => ({
    activo: false,
    vista: false,
    solicitud: "ninguna",
    equipos: {
      1: createWarmupTeam(),
      2: createWarmupTeam()
    }
  });

  let currentTime = 10_000;
  let currentMode = "";
  let warmup = createWarmupState();
  let wordSequence = 0;
  let timerSequence = 0;
  let intervalToken = null;
  let intervalCallback = null;
  let disconnectedRoles = 0;
  const timers = [];
  const requests = [];
  const warmupFinals = [];
  const teleprompterStates = [];
  const writerTexts = { 1: "", 2: "" };
  const writerFinCalls = { 1: 0, 2: 0 };
  let realPauseCalls = 0;
  let realResumeCalls = 0;
  let inicioPayload = null;

  const resetWarmup = () => {
    warmup = createWarmupState();
  };

  const setTimeoutFn = (callback, delay) => {
    const token = {
      id: ++timerSequence,
      callback,
      delay,
      cancelled: false,
      unref() {}
    };
    timers.push(token);
    return token;
  };
  const clearTimeoutFn = (token) => {
    if (token) token.cancelled = true;
  };
  const runNextTimer = () => {
    let token = timers.shift();
    while (token && token.cancelled) token = timers.shift();
    assert.ok(token, "se esperaba una transición temporizada del recorrido");
    currentTime += token.delay;
    token.callback();
  };
  const pendingStageTimers = () => timers.filter((token) => !token.cancelled).length;

  const registerConnection = (socket) => {
    const role = socket.simulacion_scrib.role;
    socket.on("disconnect", () => {
      disconnectedRoles += 1;
    });

    if (role === "control") {
      socket.on("registrar_control", () => {});
      socket.on("cambiar_vista_calentamiento", ({ activo }) => {
        warmup.vista = Boolean(activo);
        if (activo) warmup.activo = true;
        else warmup.solicitud = "ninguna";
      });
      socket.on("calentamiento_solicitud", ({ tipo }) => {
        warmup.solicitud = tipo;
        warmup.equipos[1] = createWarmupTeam();
        warmup.equipos[2] = createWarmupTeam();
        requests.push(tipo);
      });
      socket.on("inicio", (payload) => {
        inicioPayload = payload;
        currentMode = payload.parametros.LISTA_MODOS[0];
      });
      socket.on("teleprompter_control", ({ state }) => {
        teleprompterStates.push({ ...state });
      });
      socket.on("stats_live_actualizar", () => {});
      socket.on("pausar", () => {
        realPauseCalls += 1;
      });
      socket.on("reanudar", () => {
        realResumeCalls += 1;
      });
      return;
    }

    if (role === "writer1" || role === "writer2") {
      const player = role === "writer2" ? 2 : 1;
      socket.on("registrar_escritor", (payload) => {
        socket.escritxr = payload.player;
      });
      socket.on("calentamiento_click_palabra", ({ id }) => {
        const team = warmup.equipos[player];
        const word = team.palabras.find((entry) => entry.id === id);
        assert.ok(word);
        if (team.bloqueado) {
          team.final = { id: word.id, palabra: word.palabra };
          warmupFinals.push({
            request: warmup.solicitud,
            player,
            palabra: word.palabra
          });
        } else {
          word.destacada = !word.destacada;
        }
      });
      socket.on("calentamiento_bloquear_equipo", () => {
        const team = warmup.equipos[player];
        team.palabras = team.palabras.filter((entry) => entry.destacada);
        team.bloqueado = team.palabras.length > 0;
      });
      socket.on(`texto${player}`, (payload) => {
        writerTexts[player] = payload.text;
      });
      socket.on("fin_de_player", () => {
        writerFinCalls[player] += 1;
      });
      socket.on("count", () => {});
      socket.on("nueva_palabra", () => {});
      socket.on("nueva_palabra_prohibida", () => {});
      socket.on("nueva_palabra_musa", () => {});
      return;
    }

    if (role.startsWith("musa")) {
      const player = Number(role.slice(4, 5));
      socket.on("registrar_musa", (payload) => {
        socket.musa = payload.musa;
      });
      socket.on("calentamiento_intento", ({ palabra }) => {
        warmup.equipos[player].palabras.push({
          id: `warm-${++wordSequence}`,
          palabra,
          destacada: false
        });
      });
      socket.on("enviar_inspiracion", () => {});
      socket.on("musa_corazon", () => {});
      socket.on("enviar_voto_ventaja", () => {});
      return;
    }

    socket.on("registrar_espectador", () => {});
    socket.on("registrar_jurado", () => {});
    socket.on("registrar_actor", () => {});
  };

  const simulator = createMatchSimulator({
    passwordRoles: "secreta",
    now: () => currentTime,
    registerConnection,
    getConnections: () => ({}),
    getCurrentMode: () => currentMode,
    getWarmupState: () => warmup,
    resetWarmup,
    partidaLifecycle: {
      limpiarPartida() {}
    },
    setTimeoutFn,
    clearTimeoutFn,
    setIntervalFn(callback) {
      intervalCallback = callback;
      intervalToken = { cancelled: false, unref() {} };
      return intervalToken;
    },
    clearIntervalFn(token) {
      if (token) token.cancelled = true;
      if (token === intervalToken) intervalCallback = null;
    }
  });
  const owner = { id: "dramaturgia-full-show", dramaturgia: true, emit() {} };
  assert.equal(simulator.authorize(owner, "secreta").ok, true);

  const started = simulator.start(owner, {
    full_show: true,
    total_seconds: 30,
    mode_seconds: 5,
    writer_ppm: 60,
    muse_interval_seconds: 120,
    muses_per_team: 1,
    votes: false,
    hearts: false,
    auto_finish: true,
    modes: ["tertulia"],
    final_phrase_1: "La costura volvió a abrirse.",
    final_phrase_2: "El bosque guardó la última voz."
  });
  assert.equal(started.ok, true);
  assert.equal(started.state.stage, "warmup");
  assert.equal(started.state.metrics.words_1, 0);
  assert.equal(intervalCallback, null);
  assert.equal(pendingStageTimers(), 1);

  const pausedWarmup = simulator.pause(owner);
  assert.equal(pausedWarmup.ok, true);
  assert.equal(pausedWarmup.state.state, "paused");
  assert.equal(pendingStageTimers(), 0);
  assert.equal(realPauseCalls, 0);

  const warmupStep = simulator.step(owner);
  assert.equal(warmupStep.ok, true);
  assert.equal(warmupStep.state.state, "paused");
  assert.equal(warmupStep.state.stage, "warmup");
  assert.equal(warmupStep.state.metrics.steps, 1);
  assert.deepEqual(requests, ["lugares"]);
  assert.equal(pendingStageTimers(), 0);
  assert.equal(intervalCallback, null);
  assert.equal(realPauseCalls, 0);
  assert.equal(realResumeCalls, 0);

  const resumedWarmup = simulator.resume(owner);
  assert.equal(resumedWarmup.ok, true);
  assert.equal(resumedWarmup.state.state, "running");
  assert.equal(pendingStageTimers(), 1);
  assert.equal(realResumeCalls, 0);

  let guard = 0;
  while (simulator.publicState().stage !== "game" && guard < 30) {
    runNextTimer();
    guard += 1;
  }
  assert.equal(simulator.publicState().stage, "game");
  assert.equal(intervalCallback, null);
  assert.equal(pendingStageTimers(), 1, "la cuenta atrás conserva una continuación pendiente");
  assert.deepEqual(requests, ["lugares", "acciones", "frase_final"]);
  assert.deepEqual(
    warmupFinals.map(({ request, player }) => `${request}:${player}`),
    [
      "lugares:1", "lugares:2",
      "acciones:1", "acciones:2",
      "frase_final:1", "frase_final:2"
    ]
  );
  assert.equal(warmup.activo, false);
  assert.equal(warmup.vista, false);
  assert.deepEqual(inicioPayload.parametros.LISTA_MODOS, SIMULATION_MODES);
  assert.equal(simulator.publicState().stage, "game");
  assert.equal(simulator.publicState().metrics.words_1, 0);

  const pausedCountdown = simulator.pause(owner);
  assert.equal(pausedCountdown.ok, true);
  assert.equal(pausedCountdown.state.state, "paused");
  assert.equal(pendingStageTimers(), 0);
  assert.equal(realPauseCalls, 1, "la pausa de cuenta atrás congela también el motor real");

  const countdownStep = simulator.step(owner);
  assert.equal(countdownStep.ok, true);
  assert.equal(countdownStep.state.state, "paused");
  assert.equal(countdownStep.state.stage, "game");
  assert.equal(countdownStep.state.metrics.steps, 2);
  assert.equal(intervalCallback, null, "el paso de cuenta atrás no deja el tick automático activo");
  assert.equal(pendingStageTimers(), 0);
  assert.equal(realResumeCalls, 1, "el paso despierta el modo real una sola vez");
  assert.equal(realPauseCalls, 2, "el paso vuelve a congelar el modo real");

  const resumedGame = simulator.resume(owner);
  assert.equal(resumedGame.ok, true);
  assert.equal(resumedGame.state.state, "running");
  assert.equal(typeof intervalCallback, "function");
  assert.equal(realResumeCalls, 2);

  for (let index = 0; index < 15; index += 1) {
    assert.equal(typeof intervalCallback, "function");
    currentTime += 2000;
    intervalCallback();
  }

  const representing = simulator.publicState();
  assert.equal(representing.state, "running");
  assert.equal(representing.stage, "representation");
  assert.deepEqual(writerFinCalls, { 1: 1, 2: 1 });
  assert.equal(teleprompterStates.length, 1);
  assert.equal(teleprompterStates[0].playing, false);
  assert.match(teleprompterStates[0].text, /La costura volvió a abrirse\.$/);
  assert.match(writerTexts[2], /El bosque guardó la última voz\.$/);
  assert.equal(disconnectedRoles, 0);
  assert.equal(intervalCallback, null);
  assert.equal(pendingStageTimers(), 1);

  const pausedRepresentation = simulator.pause(owner);
  assert.equal(pausedRepresentation.ok, true);
  assert.equal(pausedRepresentation.state.state, "paused");
  assert.equal(pendingStageTimers(), 0);
  assert.equal(realPauseCalls, 2, "representación no toca la pausa del motor de juego");

  const representationStep = simulator.step(owner);
  assert.equal(representationStep.ok, true);
  assert.equal(representationStep.state.state, "paused");
  assert.equal(representationStep.state.stage, "representation");
  assert.equal(representationStep.state.metrics.steps, 3);
  assert.equal(teleprompterStates.length, 2);
  assert.equal(teleprompterStates[1].playing, true);
  assert.equal(pendingStageTimers(), 0);
  assert.equal(intervalCallback, null);
  assert.equal(realResumeCalls, 2);
  assert.equal(realPauseCalls, 2);

  const resumedRepresentation = simulator.resume(owner);
  assert.equal(resumedRepresentation.ok, true);
  assert.equal(resumedRepresentation.state.state, "running");
  assert.equal(pendingStageTimers(), 1);

  while (teleprompterStates.length < 7) runNextTimer();
  assert.equal(simulator.publicState().state, "running");
  assert.equal(disconnectedRoles, 0);
  assert.deepEqual(teleprompterStates.map((state) => state.source), [1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(
    teleprompterStates.map((state) => state.playing),
    [false, true, false, false, true, false, false]
  );
  assert.equal(teleprompterStates[2].scroll, Number.MAX_SAFE_INTEGER);
  assert.equal(teleprompterStates[5].scroll, Number.MAX_SAFE_INTEGER);
  assert.ok(teleprompterStates.slice(0, 6).every((state) => state.visible));
  assert.equal(teleprompterStates[6].visible, false);

  runNextTimer();
  assert.equal(simulator.publicState().state, "completed");
  assert.equal(simulator.publicState().stage, "representation");
  assert.deepEqual(writerFinCalls, { 1: 1, 2: 1 });
  assert.equal(disconnectedRoles, 9);
});

test("integración real: autorización, bloqueo y ciclo start/pause/step/resume/stop limpian runtime", async (t) => {
  const harness = await createRuntimeHarness(t);
  const owner = await harness.connect();
  owner.emit("registrar_dramaturgia");

  const getState = () => emitAck(owner, "scrib_test:get_state", {});
  await waitFor(
    "Dramaturgia registrada",
    async () => {
      const state = await getState();
      return state.connections.dramaturgia.count === 1 && state;
    }
  );

  const unauthorized = await emitAck(owner, "dramaturgia_sim_iniciar", {
    config: { full_show: false, modes: ["tertulia"] }
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.code, "NOT_AUTHORIZED");

  const wrongPassword = await emitAck(owner, "dramaturgia_sim_autorizar", {
    password: "incorrecta"
  });
  assert.equal(wrongPassword.ok, false);
  assert.equal(wrongPassword.code, "INVALID_PASSWORD");

  const authorized = await emitAck(owner, "dramaturgia_sim_autorizar", {
    password: "clave-simulacion"
  });
  assert.equal(authorized.ok, true);
  assert.ok(authorized.expires_at > Date.now());

  const humanControl = await harness.connect();
  humanControl.emit("registrar_control");
  await waitFor("Control humano registrado", async () => {
    const state = await getState();
    return state.connections.control.count === 1 && state;
  });

  const blockedPreflight = await emitAck(owner, "dramaturgia_sim_preflight", {});
  assert.equal(blockedPreflight.can_start, false);
  assert.ok(blockedPreflight.blockers.some((item) => item.startsWith("Control (1)")));
  const blockedStart = await emitAck(owner, "dramaturgia_sim_iniciar", {
    config: { full_show: false, modes: ["tertulia"] }
  });
  assert.equal(blockedStart.ok, false);
  assert.equal(blockedStart.code, "MATCH_ACTIVE");

  humanControl.close();
  await waitFor("Control humano desconectado", async () => {
    const state = await getState();
    return state.connections.control.count === 0 && state;
  });

  const started = await emitAck(owner, "dramaturgia_sim_iniciar", {
    config: {
      seed: "integracion",
      total_seconds: 60,
      mode_seconds: 30,
      speed: 1,
      writer_ppm: 30,
      muse_interval_seconds: 10,
      muses_per_team: 1,
      votes: true,
      hearts: true,
      auto_finish: false,
      full_show: false,
      modes: ["tertulia"],
      final_phrase_1: "secreto uno",
      final_phrase_2: "secreto dos"
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.state.state, "running");
  assert.equal(Object.hasOwn(started.state.config, "final_phrase_1"), false);
  assert.equal(Object.hasOwn(started.state.config, "final_phrase_2"), false);

  const populated = await waitFor("Roles sintéticos registrados", async () => {
    const state = await getState();
    const ready = state.connections.control.count === 1
      && state.connections.spectator.count === 1
      && state.connections.jury.count === 1
      && state.connections.writers[1].count === 1
      && state.connections.writers[2].count === 1
      && state.connections.musas[1].count === 1
      && state.connections.musas[2].count === 1
      && state.connections.actors[1].count === 1
      && state.connections.actors[2].count === 1;
    return ready && state;
  });
  assert.equal(populated.partida.modo_actual, "tertulia");

  const secondPanel = await harness.connect();
  secondPanel.emit("registrar_dramaturgia");
  await waitFor("Segundo panel Dramaturgia registrado", () => (
    harness.runtime.deps.rolesConectados.payloadConexiones().dramaturgia.count === 2
  ));
  const protectedPause = await emitAck(secondPanel, "dramaturgia_sim_pausar", {});
  assert.equal(protectedPause.code, "NOT_AUTHORIZED");
  assert.equal((await emitAck(secondPanel, "dramaturgia_sim_autorizar", {
    password: "clave-simulacion"
  })).ok, true);

  const paused = await emitAck(secondPanel, "dramaturgia_sim_pausar", {});
  assert.equal(paused.ok, true);
  assert.equal(paused.state.state, "paused");
  secondPanel.close();
  await waitFor("Segundo panel Dramaturgia desconectado", () => (
    harness.runtime.deps.rolesConectados.payloadConexiones().dramaturgia.count === 1
  ));

  const stepped = await emitAck(owner, "dramaturgia_sim_paso", {});
  assert.equal(stepped.ok, true);
  assert.equal(stepped.state.metrics.steps, 1);
  assert.equal(stepped.state.metrics.words_1, 1);
  assert.equal(stepped.state.metrics.words_2, 1);
  assert.equal(stepped.state.metrics.inspirations, 2);

  const stateAfterStep = await getState();
  assert.ok(stateAfterStep.textos[1].plano.length > 0);
  assert.ok(stateAfterStep.textos[2].plano.length > 0);
  assert.equal(stateAfterStep.stats.players[1].palabrasTotal, 1);
  assert.equal(stateAfterStep.stats.players[2].palabrasTotal, 1);
  assert.equal(stateAfterStep.stats.players[1].pulsacionesTotal, 6);
  assert.equal(stateAfterStep.stats.players[2].pulsacionesTotal, 6);

  const resumed = await emitAck(owner, "dramaturgia_sim_reanudar", {});
  assert.equal(resumed.ok, true);
  assert.equal(resumed.state.state, "running");
  await waitFor("El reloj sintético avanza tras reanudar", () => (
    harness.runtime.simuladorPartidas.publicState().metrics.elapsed_seconds > 0
  ));

  const stopped = await emitAck(owner, "dramaturgia_sim_detener", {});
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state.state, "stopped");

  const clean = await waitFor("Roles sintéticos y partida limpiados", async () => {
    const state = await getState();
    const connections = state.connections;
    const ready = connections.control.count === 0
      && connections.spectator.count === 0
      && connections.jury.count === 0
      && connections.writers[1].count === 0
      && connections.writers[2].count === 0
      && connections.musas[1].count === 0
      && connections.musas[2].count === 0
      && connections.actors[1].count === 0
      && connections.actors[2].count === 0;
    return ready && state.partida.modo_actual === "" && state;
  });
  assert.equal(clean.connections.dramaturgia.count, 1);
  assert.equal(clean.partida.fin_del_juego, true);
  assert.equal(clean.textos[1].plano, "");
  assert.equal(clean.textos[2].plano, "");
  assert.equal(clean.stats.players[1].palabrasTotal, 0);
  assert.equal(clean.stats.players[2].palabrasTotal, 0);

  const stoppedAgain = await emitAck(owner, "dramaturgia_sim_detener", {});
  assert.equal(stoppedAgain.ok, true);
  assert.equal(stoppedAgain.state.state, "stopped");

  const titles = harness.runtime.dramaturgiaState.snapshot().eventos
    .filter((event) => event.tipo === "simulacion")
    .map((event) => event.titulo);
  assert.ok(titles.includes("Simulación iniciada"));
  assert.ok(titles.includes("Simulación pausada"));
  assert.ok(titles.includes("Simulación reanudada"));
  assert.ok(titles.includes("Simulación finalizada"));
});

test("integración real: el Control sintético obtiene y usa un token aunque los test hooks estén desactivados", async (t) => {
  const harness = await createRuntimeHarness(t, { testHooksEnabled: false });
  const owner = await harness.connect();
  owner.emit("registrar_dramaturgia");
  await waitFor("Dramaturgia de producción registrada", () => (
    harness.runtime.deps.rolesConectados.payloadConexiones().dramaturgia.count === 1
  ));

  const authorized = await emitAck(owner, "dramaturgia_sim_autorizar", {
    password: "clave-simulacion"
  });
  assert.equal(authorized.ok, true);
  assert.equal(harness.runtime.deps.accesoRoles.snapshotSeguro().tokens_activos, 0);

  const started = await emitAck(owner, "dramaturgia_sim_iniciar", {
    config: {
      modes: ["tertulia"],
      total_seconds: 60,
      mode_seconds: 30,
      muses_per_team: 0,
      auto_finish: false,
      full_show: false
    }
  });
  assert.equal(started.ok, true);
  assert.equal(
    harness.runtime.deps.rolesConectados.payloadConexiones().control.count,
    1
  );
  assert.equal(harness.runtime.deps.accesoRoles.snapshotSeguro().tokens_activos, 1);

  const stopped = await emitAck(owner, "dramaturgia_sim_detener", {});
  assert.equal(stopped.ok, true);
  assert.equal(
    harness.runtime.deps.rolesConectados.payloadConexiones().control.count,
    0
  );
});

test("integración real: un rol humano aborta la simulación antes de reemplazar roles", async (t) => {
  const harness = await createRuntimeHarness(t);
  const owner = await harness.connect();
  owner.emit("registrar_dramaturgia");
  await waitFor("Dramaturgia conectada", () => (
    harness.runtime.deps.rolesConectados.payloadConexiones().dramaturgia.count === 1
  ));

  const authorized = await emitAck(owner, "dramaturgia_sim_autorizar", {
    password: "clave-simulacion"
  });
  assert.equal(authorized.ok, true);

  const started = await emitAck(owner, "dramaturgia_sim_iniciar", {
    config: {
      modes: ["tertulia"],
      total_seconds: 60,
      mode_seconds: 30,
      muses_per_team: 0,
      auto_finish: false,
      full_show: false
    }
  });
  assert.equal(started.ok, true);
  assert.equal(harness.runtime.simuladorPartidas.isActive(), true);

  const humanWriter = await harness.connect();
  humanWriter.emit("registrar_escritor", {
    player: 1,
    client_id: "human-writer-1"
  });

  await waitFor("La entrada humana aborta y sustituye solo al bot", () => {
    const sim = harness.runtime.simuladorPartidas.publicState();
    const connections = harness.runtime.deps.rolesConectados.payloadConexiones();
    return sim.state === "aborted"
      && connections.writers[1].count === 1
      && connections.writers[2].count === 0
      && connections.control.count === 0
      && connections.spectator.count === 0
      && connections.jury.count === 0
      && connections.actors[1].count === 0
      && connections.actors[2].count === 0;
  });

  const state = await emitAck(owner, "scrib_test:get_state", {});
  assert.equal(state.partida.modo_actual, "");
  assert.equal(state.connections.writers[1].count, 1);
  assert.equal(state.connections.writers[2].count, 0);

  humanWriter.close();
  await waitFor("Escritxr humano desconectado", () => (
    harness.runtime.deps.rolesConectados.payloadConexiones().writers[1].count === 0
  ));
});
