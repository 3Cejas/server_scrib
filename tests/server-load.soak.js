const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const io = require("socket.io-client");

const ROOT_DIR = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT_DIR, ".soak-artifacts");
const HISTORY_PATH = path.join(ARTIFACTS_DIR, "soak-history.ndjson");
const BASELINE_PATH = path.join(ROOT_DIR, "tests", "fixtures", "soak-latency-baseline.json");
const SOAK_REPEAT_ROUNDS = Number(process.env.SCRIB_SOAK_REPEAT_ROUNDS || 3);
const SOAK_BROADCAST_MAX_LATENCY_MS = Number(process.env.SCRIB_SOAK_BROADCAST_MAX_LATENCY_MS || 2000);
const SOAK_REGRESSION_MAX_DELTA_MS = Number(process.env.SCRIB_SOAK_REGRESSION_MAX_DELTA_MS || 150);
const SOAK_REGRESSION_MAX_RATIO = Number(process.env.SCRIB_SOAK_REGRESSION_MAX_RATIO || 8);

let serverProcess = null;
let adminSocket = null;
let serverPort = 0;
const sockets = new Set();
const soakMetrics = [];

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

function recordMetric(name, metric = {}) {
  soakMetrics.push({
    name,
    ...metric
  });
}

async function readJsonIfExists(filePath, fallbackValue = null) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallbackValue;
    }
    throw error;
  }
}

async function readHistoryIfExists() {
  try {
    const raw = await fsp.readFile(HISTORY_PATH, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function metricByName(metrics, name) {
  return metrics.find((metric) => metric.name === name) || null;
}

function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function buildRegressionReport(metrics, baselineConfig) {
  const comparisons = baselineConfig && baselineConfig.comparisons ? baselineConfig.comparisons : {};
  const regressions = [];
  const checks = [];

  Object.entries(comparisons).forEach(([metricName, comparison]) => {
    const metric = metricByName(metrics, metricName);
    if (!metric) {
      checks.push({
        metric: metricName,
        field: comparison.field,
        skipped: true,
        reason: "metric_missing"
      });
      return;
    }
    const currentValue = Number(metric[comparison.field]);
    const baselineValue = Number(comparison.baseline);
    if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue)) {
      checks.push({
        metric: metricName,
        field: comparison.field,
        skipped: true,
        reason: "non_numeric_value"
      });
      return;
    }
    const allowedValue = Math.max(
      baselineValue + SOAK_REGRESSION_MAX_DELTA_MS,
      baselineValue * SOAK_REGRESSION_MAX_RATIO
    );
    const deltaMs = currentValue - baselineValue;
    const ratio = baselineValue > 0 ? currentValue / baselineValue : null;
    const result = {
      metric: metricName,
      field: comparison.field,
      baseline: baselineValue,
      current: currentValue,
      deltaMs,
      ratio,
      allowed: allowedValue
    };
    checks.push(result);
    if (currentValue > allowedValue) {
      regressions.push(result);
    }
  });

  return {
    checks,
    regressions
  };
}

function buildTrends(metrics, previousSummary) {
  if (!previousSummary || !Array.isArray(previousSummary.metrics)) {
    return [];
  }
  return metrics
    .filter((metric) => typeof metric.maxLatencyMs === "number")
    .map((metric) => {
      const previousMetric = metricByName(previousSummary.metrics, metric.name);
      const previousValue = previousMetric && typeof previousMetric.maxLatencyMs === "number"
        ? previousMetric.maxLatencyMs
        : null;
      const currentValue = metric.maxLatencyMs;
      return {
        metric: metric.name,
        field: "maxLatencyMs",
        current: currentValue,
        previous: previousValue,
        deltaMs: previousValue == null ? null : currentValue - previousValue,
        deltaPct: previousValue == null || previousValue === 0
          ? null
          : Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2))
      };
    });
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
      reject(new Error("Timed out connecting soak socket"));
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
      reject(new Error(`Timed out waiting ack for ${eventName}`));
    }, timeoutMs);
    socket.emit(eventName, payload, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

async function waitForState(description, predicate, timeoutMs = 15000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const state = await emitAck(adminSocket, "scrib_test:get_state", {});
    if (predicate(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function openRole(registerEvent, payload) {
  const socket = await connectSocket(serverPort);
  sockets.add(socket);
  socket.emit(registerEvent, payload);
  return socket;
}

async function openWave() {
  const wave = {
    control: [],
    spectator: [],
    writer1: [],
    writer2: [],
    musa1: [],
    musa2: [],
    actor1: [],
    actor2: []
  };

  for (let index = 0; index < 2; index += 1) {
    wave.control.push(await openRole("registrar_control"));
  }
  for (let index = 0; index < 3; index += 1) {
    wave.spectator.push(await openRole("registrar_espectador"));
  }
  for (let index = 0; index < 2; index += 1) {
    wave.writer1.push(await openRole("registrar_escritor", 1));
    wave.writer2.push(await openRole("registrar_escritor", 2));
    wave.actor1.push(await openRole("registrar_actor", { player: 1 }));
    wave.actor2.push(await openRole("registrar_actor", { player: 2 }));
  }
  for (let index = 0; index < 8; index += 1) {
    wave.musa1.push(await openRole("registrar_musa", {
      musa: 1,
      nombre: `Musa A ${index + 1}`,
      client_id: `musa-a-${index + 1}`
    }));
    wave.musa2.push(await openRole("registrar_musa", {
      musa: 2,
      nombre: `Musa B ${index + 1}`,
      client_id: `musa-b-${index + 1}`
    }));
  }
  return wave;
}

async function closeWaveSockets(items) {
  await Promise.all(items.map(async (socket) => {
    sockets.delete(socket);
    socket.close();
  }));
}

function flattenWave(wave) {
  return [
    ...wave.control,
    ...wave.spectator,
    ...wave.writer1,
    ...wave.writer2,
    ...wave.actor1,
    ...wave.actor2,
    ...wave.musa1,
    ...wave.musa2
  ];
}

async function closeEntireWave(wave) {
  await closeWaveSockets(flattenWave(wave));
}

function createTimedEventPromise(socket, eventName, predicate = null, timeoutMs = 10000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const handler = (payload) => {
      try {
        if (typeof predicate === "function" && !predicate(payload)) {
          return;
        }
        clearTimeout(timeout);
        socket.off(eventName, handler);
        resolve({
          payload,
          latencyMs: Date.now() - startedAt
        });
      } catch (error) {
        clearTimeout(timeout);
        socket.off(eventName, handler);
        reject(error);
      }
    };
    socket.on(eventName, handler);
  });
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
  await waitForPort(serverPort);
  adminSocket = await connectSocket(serverPort);
});

test.after(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.clear();
  if (adminSocket) {
    adminSocket.close();
    adminSocket = null;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  const baseline = await readJsonIfExists(BASELINE_PATH, { comparisons: {} });
  const history = await readHistoryIfExists();
  const previousSummary = history.length > 0 ? history[history.length - 1] : null;
  const regressionReport = buildRegressionReport(soakMetrics, baseline);
  const summary = {
    ts: new Date().toISOString(),
    repeatRounds: SOAK_REPEAT_ROUNDS,
    broadcastMaxLatencyMs: SOAK_BROADCAST_MAX_LATENCY_MS,
    regressionBudget: {
      deltaMs: SOAK_REGRESSION_MAX_DELTA_MS,
      ratio: SOAK_REGRESSION_MAX_RATIO
    },
    baselinePath: path.relative(ROOT_DIR, BASELINE_PATH),
    historyPath: path.relative(ROOT_DIR, HISTORY_PATH),
    historyLengthBeforeAppend: history.length,
    historyLengthAfterAppend: history.length + 1,
    metrics: soakMetrics,
    trends: buildTrends(soakMetrics, previousSummary),
    regressionChecks: regressionReport.checks,
    regressions: regressionReport.regressions
  };
  await ensureDir(ARTIFACTS_DIR);
  await fsp.writeFile(
    path.join(ARTIFACTS_DIR, "latest-soak-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  await fsp.appendFile(HISTORY_PATH, `${JSON.stringify(summary)}\n`, "utf8");
  assert.equal(
    regressionReport.regressions.length,
    0,
    `Soak latency regression detected: ${JSON.stringify(regressionReport.regressions)}`
  );
});

test.afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.clear();
  await emitAck(adminSocket, "scrib_test:reset", {});
});

test("server survives a burst of simultaneous role connections and cleans all counters", async () => {
  const startedAt = Date.now();
  const wave = await openWave();

  await waitForState(
    "all soak roles connected",
    (state) => state.connections.control.count === 2
      && state.connections.spectator.count === 3
      && state.connections.writers[1].count === 1
      && state.connections.writers[2].count === 1
      && state.connections.actors[1].count === 2
      && state.connections.actors[2].count === 2
      && state.connections.musas[1].count === 8
      && state.connections.musas[2].count === 8
  );

  await emitAck(adminSocket, "scrib_test:force_mode", {
    mode: "palabras bonus"
  });
  wave.musa1[0].emit("enviar_inspiracion", {
    palabra: "cometa",
    nombre: "Musa A 1"
  });

  await waitForState(
    "server still handles broadcasts under load",
    (state) => state.partida.modo_actual === "palabras bonus"
      && state.inspiracion.ultimas[1]
      && state.inspiracion.ultimas[1].palabra === "cometa"
  );

  await closeWaveSockets([
    ...wave.musa1.slice(0, 4),
    ...wave.musa2.slice(0, 4),
    wave.control[0],
    wave.spectator[0],
    wave.writer1[0],
    wave.writer2[0]
  ]);

  await waitForState(
    "partial disconnect reflected in counters",
    (state) => state.connections.control.count === 1
      && state.connections.spectator.count === 2
      && state.connections.writers[1].count === 1
      && state.connections.writers[2].count === 1
      && state.connections.musas[1].count === 4
      && state.connections.musas[2].count === 4
  );

  await closeWaveSockets([
    ...wave.control.slice(1),
    ...wave.spectator.slice(1),
    ...wave.writer1.slice(1),
    ...wave.writer2.slice(1),
    ...wave.actor1,
    ...wave.actor2,
    ...wave.musa1.slice(4),
    ...wave.musa2.slice(4)
  ]);

  await waitForState(
    "all counters drained after soak disconnect",
    (state) => state.connections.control.count === 0
      && state.connections.spectator.count === 0
      && state.connections.writers[1].count === 0
      && state.connections.writers[2].count === 0
      && state.connections.actors[1].count === 0
      && state.connections.actors[2].count === 0
      && state.connections.musas[1].count === 0
      && state.connections.musas[2].count === 0
  );
  recordMetric("burst-connect-disconnect", {
    durationMs: Date.now() - startedAt,
    peakConnections: {
      control: 2,
      spectator: 3,
      activeWritersPerTeam: 1,
      writerSocketsPerTeam: 2,
      actorsPerTeam: 2,
      musasPerTeam: 8
    },
    partialRemaining: {
      control: 1,
      spectator: 2,
      activeWritersPerTeam: 1,
      musasPerTeam: 4
    }
  });
});

test("vote broadcasts reach all connected team musas under load", async () => {
  const startedAt = Date.now();
  const wave = await openWave();

  const votePromises = wave.musa1.map((socket) => createTimedEventPromise(
    socket,
    "elegir_ventaja_j1",
    (payload) => payload && payload.equipo === "j1"
  ));

  await emitAck(adminSocket, "scrib_test:force_vote", {
    team: 1,
    opciones: ["UNO", "DOS", "TRES"],
    duracion_ms: 9000
  });

  const deliveries = await Promise.all(votePromises);
  assert.equal(deliveries.length, 8);
  deliveries.forEach(({ payload }) => {
    assert.equal(payload.equipo, "j1");
    assert.deepEqual(payload.opciones, ["UNO", "DOS", "TRES"]);
  });
  const maxLatency = Math.max(...deliveries.map((delivery) => delivery.latencyMs));
  const avgLatency = Number(
    (deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / deliveries.length).toFixed(2)
  );
  const p95Latency = percentile(deliveries.map((delivery) => delivery.latencyMs), 95);
  assert.ok(
    maxLatency <= SOAK_BROADCAST_MAX_LATENCY_MS,
    `Vote broadcast latency too high under load: ${maxLatency}ms > ${SOAK_BROADCAST_MAX_LATENCY_MS}ms`
  );
  recordMetric("vote-broadcast", {
    durationMs: Date.now() - startedAt,
    recipients: deliveries.length,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    maxLatencyMs: maxLatency,
    thresholdMs: SOAK_BROADCAST_MAX_LATENCY_MS
  });
});

test("server survives repeated connection waves without leaking counters", async () => {
  const startedAt = Date.now();
  for (let round = 1; round <= SOAK_REPEAT_ROUNDS; round += 1) {
    const wave = await openWave();

    await waitForState(
      `all soak roles connected in round ${round}`,
      (state) => state.connections.control.count === 2
        && state.connections.spectator.count === 3
        && state.connections.writers[1].count === 1
        && state.connections.writers[2].count === 1
        && state.connections.actors[1].count === 2
        && state.connections.actors[2].count === 2
        && state.connections.musas[1].count === 8
        && state.connections.musas[2].count === 8
    );

    await emitAck(adminSocket, "scrib_test:force_mode", {
      mode: round % 2 === 0 ? "palabras bonus" : "letra bendita",
      letra: "R"
    });
    wave.musa1[0].emit("enviar_inspiracion", {
      palabra: `oleada-${round}`,
      nombre: `Musa A ${round}`
    });

    await waitForState(
      `round ${round} server state updated`,
      (state) => state.inspiracion.ultimas[1]
        && state.inspiracion.ultimas[1].palabra === `oleada-${round}`,
      10000
    );

    await closeEntireWave(wave);
    await waitForState(
      `all counters drained after round ${round}`,
      (state) => state.connections.control.count === 0
        && state.connections.spectator.count === 0
        && state.connections.writers[1].count === 0
        && state.connections.writers[2].count === 0
        && state.connections.actors[1].count === 0
        && state.connections.actors[2].count === 0
        && state.connections.musas[1].count === 0
        && state.connections.musas[2].count === 0
    );
  }
  recordMetric("repeated-waves", {
    durationMs: Date.now() - startedAt,
    rounds: SOAK_REPEAT_ROUNDS,
    peakConnections: {
      control: 2,
      spectator: 3,
      activeWritersPerTeam: 1,
      writerSocketsPerTeam: 2,
      actorsPerTeam: 2,
      musasPerTeam: 8
    }
  });
});

test("teleprompter broadcast latency stays bounded under multi-role load", async () => {
  const startedAt = Date.now();
  const wave = await openWave();
  const recipients = flattenWave(wave);
  const loadId = 77;
  const watchers = recipients.map((socket) => createTimedEventPromise(
    socket,
    "teleprompter_state",
    (payload) => payload && payload.state && payload.state.loadId === loadId
  ));

  wave.control[0].emit("teleprompter_control", {
    state: {
      visible: true,
      text: "Soak teleprompter broadcast payload",
      fontSize: 42,
      speed: 27,
      playing: false,
      scroll: 0,
      source: 1,
      loadId
    }
  });

  const deliveries = await Promise.all(watchers);
  assert.equal(deliveries.length, recipients.length);
  const maxLatency = Math.max(...deliveries.map((delivery) => delivery.latencyMs));
  const avgLatency = Number(
    (deliveries.reduce((total, delivery) => total + delivery.latencyMs, 0) / deliveries.length).toFixed(2)
  );
  const p95Latency = percentile(deliveries.map((delivery) => delivery.latencyMs), 95);
  assert.ok(
    maxLatency <= SOAK_BROADCAST_MAX_LATENCY_MS,
    `Teleprompter broadcast latency too high under load: ${maxLatency}ms > ${SOAK_BROADCAST_MAX_LATENCY_MS}ms`
  );
  deliveries.forEach(({ payload }) => {
    assert.equal(payload.state.loadId, loadId);
    assert.equal(payload.state.source, 1);
    assert.equal(payload.state.visible, true);
  });
  recordMetric("teleprompter-broadcast", {
    durationMs: Date.now() - startedAt,
    recipients: deliveries.length,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    maxLatencyMs: maxLatency,
    thresholdMs: SOAK_BROADCAST_MAX_LATENCY_MS,
    loadId
  });
});
