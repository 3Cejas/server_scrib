const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const io = require("socket.io-client");

const ROOT_DIR = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT_DIR, ".soak-artifacts");
const SUMMARY_PATH = path.join(ARTIFACTS_DIR, "latest-progressive-soak-summary.json");
const DURATION_MINUTES = Math.max(0.1, Number(process.env.SCRIB_PROGRESSIVE_SOAK_MINUTES) || 45);
const DURATION_MS = DURATION_MINUTES * 60 * 1000;
const TEXT_INTERVAL_MS = Math.max(80, Number(process.env.SCRIB_PROGRESSIVE_TEXT_INTERVAL_MS) || 250);
const MUSE_INSPIRATION_INTERVAL_MS = Math.max(
  500,
  Number(process.env.SCRIB_PROGRESSIVE_MUSE_INTERVAL_MS) || 4000
);
const STATE_INTERVAL_MS = Math.max(250, Math.min(2000, DURATION_MS / 100));
const SAMPLE_INTERVAL_MS = Math.max(500, Math.min(10000, DURATION_MS / 40));
const VOTE_INTERVAL_MS = Math.max(3000, Math.min(120000, DURATION_MS / 6));
const CHURN_INTERVAL_MS = Math.max(4000, Math.min(300000, DURATION_MS / 5));
const MAX_ACK_P95_MS = Number(process.env.SCRIB_PROGRESSIVE_MAX_ACK_P95_MS) || 2000;
const MAX_RSS_MIB = Number(process.env.SCRIB_PROGRESSIVE_MAX_RSS_MIB) || 768;
const MAX_HOLD_GROWTH_MIB = Number(process.env.SCRIB_PROGRESSIVE_MAX_HOLD_GROWTH_MIB) || 160;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const summaryLatency = (values) => ({
  samples: values.length,
  average_ms: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0,
  p50_ms: percentile(values, 50),
  p95_ms: percentile(values, 95),
  p99_ms: percentile(values, 99),
  max_ms: values.length ? Math.max(...values) : 0
});

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForPort = async (port, timeoutMs = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await sleep(75);
  }
  throw new Error(`server did not listen on ${port}`);
};

const connectSocket = (port) => new Promise((resolve, reject) => {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true
  });
  const timer = setTimeout(() => reject(new Error("socket connection timeout")), 10000);
  socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
  socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
});

const emitAck = (socket, event, payload = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), timeoutMs);
  socket.emit(event, payload, (response) => {
    clearTimeout(timer);
    resolve({ response, latencyMs: Date.now() - started });
  });
});

const readRssMib = async (pid) => {
  try {
    const status = await fsp.readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return match ? Number((Number(match[1]) / 1024).toFixed(2)) : null;
  } catch (_error) {
    return null;
  }
};

const targetMuseCount = (progress) => {
  if (progress < 0.1) return 4;
  if (progress < 0.25) return 10;
  if (progress < 0.45) return 20;
  return 30;
};

async function main() {
  const port = await getFreePort();
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      SCRIB_TEST_HOOKS: "1",
      SCRIB_PERSIST_STATE: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverOutputTail = "";
  const captureOutput = (chunk) => {
    serverOutputTail = `${serverOutputTail}${chunk}`.slice(-16000);
  };
  server.stdout.on("data", captureOutput);
  server.stderr.on("data", captureOutput);
  let serverExited = false;
  let serverExit = null;
  server.once("exit", (code, signal) => { serverExited = true; serverExit = { code, signal }; });

  const sockets = new Set();
  const muses = [];
  const metrics = {
    textAck: [],
    stateAck: [],
    museAck: [],
    memory: [],
    textUpdates: 0,
    inspirationsAccepted: 0,
    inspirationsVotingRejected: 0,
    votesOpened: 0,
    votesCast: 0,
    churnReconnects: 0,
    unexpectedDisconnects: 0,
    peakMuses: 0
  };
  const startedAt = Date.now();
  let admin;
  let spectator;
  const writers = {};
  let completed = false;

  const track = (socket) => {
    sockets.add(socket);
    socket.on("disconnect", () => {
      if (!socket._soakClosing) metrics.unexpectedDisconnects += 1;
    });
    return socket;
  };
  const closeSocket = (socket) => {
    if (!socket) return;
    socket._soakClosing = true;
    sockets.delete(socket);
    socket.close();
  };
  const openRole = async (event, payload) => {
    const socket = track(await connectSocket(port));
    socket.emit(event, payload);
    return socket;
  };
  const addMuse = async (index) => {
    const team = index % 2 === 0 ? 1 : 2;
    const identity = { team, clientId: `progressive-muse-${index + 1}`, name: `Musa ${index + 1}` };
    const socket = track(await connectSocket(port));
    const { response } = await emitAck(socket, "registrar_musa", {
      musa: team,
      nombre: identity.name,
      client_id: identity.clientId
    });
    assert.equal(response && response.ok, true, `muse registration failed: ${JSON.stringify(response)}`);
    muses.push({
      ...identity,
      socket,
      nextInspirationAt: Date.now() + ((index * 137) % MUSE_INSPIRATION_INTERVAL_MS)
    });
  };
  const reconnectMuse = async (entry) => {
    closeSocket(entry.socket);
    const socket = track(await connectSocket(port));
    const { response } = await emitAck(socket, "registrar_musa", {
      musa: entry.team,
      nombre: entry.name,
      client_id: entry.clientId
    });
    assert.equal(response && response.ok, true, `muse reconnect failed: ${JSON.stringify(response)}`);
    entry.socket = socket;
    metrics.churnReconnects += 1;
  };

  try {
    await waitForPort(port);
    admin = track(await connectSocket(port));
    admin.emit("registrar_control");
    spectator = await openRole("registrar_espectador");
    await emitAck(spectator, "suscribir_textos", { players: [1, 2], deltas: true, cursors: false });
    for (const team of [1, 2]) {
      const writer = track(await connectSocket(port));
      const { response } = await emitAck(writer, "registrar_escritor", {
        player: team,
        client_id: `progressive-writer-${team}`,
        session_started_at: Date.now()
      });
      assert.equal(response && response.ok, true, `writer ${team} registration failed`);
      writers[team] = { socket: writer, revision: 0, length: 0 };
      await openRole("registrar_actor", { player: team });
    }
    const forced = await emitAck(admin, "scrib_test:force_mode", { mode: "palabras bonus" });
    assert.equal(forced.response && forced.response.ok, true);

    let nextTextAt = Date.now();
    let nextStateAt = Date.now();
    let nextSampleAt = Date.now();
    let nextConsumeAt = Date.now() + 1000;
    let nextVoteAt = Date.now() + VOTE_INTERVAL_MS;
    let voteCloseAt = 0;
    let nextChurnAt = Date.now() + CHURN_INTERVAL_MS;
    let inspirationSeq = 0;
    let churnCursor = 0;
    const pendingConsume = { 1: 0, 2: 0 };

    while ((Date.now() - startedAt) < DURATION_MS) {
      if (serverExited) throw new Error(`server exited during soak: ${JSON.stringify(serverExit)}\n${serverOutputTail}`);
      const now = Date.now();
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      const target = targetMuseCount(progress);
      while (muses.length < target) await addMuse(muses.length);
      metrics.peakMuses = Math.max(metrics.peakMuses, muses.length);

      if (now >= nextTextAt) {
        nextTextAt = now + TEXT_INTERVAL_MS;
        const updates = [1, 2].map(async (team) => {
          const writer = writers[team];
          const insert = metrics.textUpdates % 17 === 0 ? " palabra" : (team === 1 ? "a" : "b");
          const { response, latencyMs } = await emitAck(writer.socket, "texto_delta_actualizar", {
            player: team,
            baseRevision: writer.revision,
            htmlPatch: { start: writer.length, deleteCount: 0, insert },
            plainPatch: { start: writer.length, deleteCount: 0, insert }
          });
          assert.equal(response && response.ok, true, `text delta rejected: ${JSON.stringify(response)}`);
          writer.revision = Number(response.revision);
          writer.length += insert.length;
          metrics.textAck.push(latencyMs);
          metrics.textUpdates += 1;
        });
        await Promise.all(updates);
      }

      const musesDue = muses.filter((entry) => now >= entry.nextInspirationAt);
      if (musesDue.length) {
        await Promise.all(musesDue.map(async (entry) => {
          entry.nextInspirationAt = now + MUSE_INSPIRATION_INTERVAL_MS;
          inspirationSeq += 1;
          const wordId = inspirationSeq;
          const { response, latencyMs } = await emitAck(entry.socket, "enviar_inspiracion", {
            palabra: `musa-${wordId}`
          });
          metrics.museAck.push(latencyMs);
          if (response && response.ok) {
            metrics.inspirationsAccepted += 1;
            pendingConsume[entry.team] += 1;
          } else if (response && response.code === "VOTING_IN_PROGRESS") {
            metrics.inspirationsVotingRejected += 1;
          } else {
            throw new Error(`unexpected inspiration rejection: ${JSON.stringify(response)}`);
          }
        }));
      }

      if (now >= nextConsumeAt) {
        nextConsumeAt = now + 1000;
        [1, 2].forEach((team) => {
          if (pendingConsume[team] <= 0) return;
          pendingConsume[team] -= 1;
          writers[team].socket.emit("nueva_palabra", team);
        });
      }

      if (now >= nextVoteAt && voteCloseAt === 0) {
        nextVoteAt = now + VOTE_INTERVAL_MS;
        const team = metrics.votesOpened % 2 === 0 ? 1 : 2;
        const opened = await emitAck(admin, "scrib_test:force_vote", {
          team,
          opciones: ["⚡", "🌪️", "🙃"],
          duracion_ms: Math.min(8000, Math.max(2000, VOTE_INTERVAL_MS / 3)),
          emitir_resultado: false
        });
        assert.equal(opened.response && opened.response.ok, true);
        metrics.votesOpened += 1;
        muses.filter((muse) => muse.team === team).forEach((muse, index) => {
          muse.socket.emit("enviar_voto_ventaja", {
            voto: ["⚡", "🌪️", "🙃"][index % 3],
            client_id: muse.clientId
          });
          metrics.votesCast += 1;
        });
        voteCloseAt = now + Math.min(4000, Math.max(1000, VOTE_INTERVAL_MS / 5));
      }

      if (voteCloseAt && now >= voteCloseAt) {
        await emitAck(admin, "scrib_test:force_vote", { close: true, emitir_resultado: false });
        voteCloseAt = 0;
      }

      if (muses.length >= 20 && now >= nextChurnAt) {
        nextChurnAt = now + CHURN_INTERVAL_MS;
        const first = muses[churnCursor % muses.length];
        const second = muses[(churnCursor + 1) % muses.length];
        churnCursor = (churnCursor + 2) % muses.length;
        await reconnectMuse(first);
        await reconnectMuse(second);
      }

      if (now >= nextStateAt) {
        nextStateAt = now + STATE_INTERVAL_MS;
        const { response: state, latencyMs } = await emitAck(admin, "scrib_test:get_state", {});
        metrics.stateAck.push(latencyMs);
        assert.equal(state.connections.musas[1].count + state.connections.musas[2].count, muses.length);
        assert.equal(state.connections.writers[1].count, 1);
        assert.equal(state.connections.writers[2].count, 1);
        assert.equal(state.textos[1].plano.length, writers[1].length);
        assert.equal(state.textos[2].plano.length, writers[2].length);
      }

      if (now >= nextSampleAt) {
        nextSampleAt = now + SAMPLE_INTERVAL_MS;
        const rssMib = await readRssMib(server.pid);
        if (rssMib !== null) metrics.memory.push({ elapsed_ms: now - startedAt, muses: muses.length, rss_mib: rssMib });
      }
      await sleep(25);
    }

    const finalStateResult = await emitAck(admin, "scrib_test:get_state", {});
    const finalState = finalStateResult.response;
    const textLatency = summaryLatency(metrics.textAck);
    const stateLatency = summaryLatency(metrics.stateAck);
    const museLatency = summaryLatency(metrics.museAck);
    const rssValues = metrics.memory.map((sample) => sample.rss_mib);
    const peakRssMib = rssValues.length ? Math.max(...rssValues) : null;
    const holdSamples = metrics.memory.filter((sample) => sample.elapsed_ms >= DURATION_MS * 0.5);
    const holdGrowthMib = holdSamples.length > 1
      ? Number((holdSamples.at(-1).rss_mib - holdSamples[0].rss_mib).toFixed(2))
      : 0;
    const summary = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_minutes_requested: DURATION_MINUTES,
      duration_ms_actual: Date.now() - startedAt,
      muse_inspiration_interval_ms: MUSE_INSPIRATION_INTERVAL_MS,
      ramp_total_muses: [4, 10, 20, 30],
      peak_muses: metrics.peakMuses,
      final_connections: {
        muses: finalState.connections.musas[1].count + finalState.connections.musas[2].count,
        writers: finalState.connections.writers[1].count + finalState.connections.writers[2].count,
        spectators: finalState.connections.spectator.count,
        actors: finalState.connections.actors[1].count + finalState.connections.actors[2].count,
        control: finalState.connections.control.count
      },
      traffic: {
        text_updates: metrics.textUpdates,
        final_text_lengths: { 1: finalState.textos[1].plano.length, 2: finalState.textos[2].plano.length },
        inspirations_accepted: metrics.inspirationsAccepted,
        inspirations_rejected_during_vote: metrics.inspirationsVotingRejected,
        votes_opened: metrics.votesOpened,
        votes_cast: metrics.votesCast,
        churn_reconnects: metrics.churnReconnects
      },
      latency: { text_ack: textLatency, state_ack: stateLatency, muse_ack: museLatency },
      process: { peak_rss_mib: peakRssMib, hold_growth_mib: holdGrowthMib, samples: metrics.memory },
      failures: { unexpected_disconnects: metrics.unexpectedDisconnects, server_exit: serverExit },
      thresholds: {
        max_ack_p95_ms: MAX_ACK_P95_MS,
        max_rss_mib: MAX_RSS_MIB,
        max_hold_growth_mib: MAX_HOLD_GROWTH_MIB
      }
    };

    assert.equal(metrics.peakMuses, 30);
    assert.equal(summary.final_connections.muses, 30);
    assert.equal(metrics.unexpectedDisconnects, 0);
    assert.ok(textLatency.p95_ms <= MAX_ACK_P95_MS, `text ack p95 ${textLatency.p95_ms}ms`);
    assert.ok(stateLatency.p95_ms <= MAX_ACK_P95_MS, `state ack p95 ${stateLatency.p95_ms}ms`);
    assert.ok(museLatency.p95_ms <= MAX_ACK_P95_MS, `muse ack p95 ${museLatency.p95_ms}ms`);
    if (peakRssMib !== null) assert.ok(peakRssMib <= MAX_RSS_MIB, `peak RSS ${peakRssMib} MiB`);
    assert.ok(holdGrowthMib <= MAX_HOLD_GROWTH_MIB, `hold RSS growth ${holdGrowthMib} MiB`);
    summary.passed = true;
    await fsp.mkdir(ARTIFACTS_DIR, { recursive: true });
    await fsp.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    completed = true;
    process.stdout.write(`${JSON.stringify({ event: "progressive_soak_complete", summary_path: SUMMARY_PATH, ...summary })}\n`);
  } finally {
    for (const socket of sockets) closeSocket(socket);
    if (!serverExited) server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      sleep(2500).then(() => { if (!serverExited) server.kill("SIGKILL"); })
    ]);
    if (!completed && serverOutputTail) process.stderr.write(`\nServer output tail:\n${serverOutputTail}\n`);
  }
}

main().catch(async (error) => {
  try {
    await fsp.mkdir(ARTIFACTS_DIR, { recursive: true });
    await fsp.writeFile(SUMMARY_PATH, `${JSON.stringify({
      passed: false,
      finished_at: new Date().toISOString(),
      error: error && error.stack ? error.stack : String(error)
    }, null, 2)}\n`, "utf8");
  } catch (_writeError) {}
  console.error(error);
  process.exitCode = 1;
});
