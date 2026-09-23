const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const io = require("socket.io-client");

const ROOT_DIR = path.resolve(__dirname, "..");

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForPort = async (port, timeoutMs = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not listen on ${port}`);
};

const connect = (port) => new Promise((resolve, reject) => {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false
  });
  const timer = setTimeout(() => reject(new Error("socket connection timeout")), 5000);
  socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
  socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
});

const emitAck = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
  socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response); });
});

const spawnServer = async (port, stateFile) => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      SCRIB_TEST_HOOKS: "1",
      SCRIB_PERSIST_STATE: "1",
      SCRIB_STATE_FILE: stateFile,
      SCRIB_STATE_MAX_AGE_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitForPort(port);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${error.message}\n${output}`);
  }
  return { child, getOutput: () => output };
};

const stopServer = (child) => new Promise((resolve) => {
  const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 4000);
  child.once("exit", () => { clearTimeout(timer); resolve(); });
  child.kill("SIGTERM");
});

test("a real server restart restores live state and keeps it paused", { timeout: 30000 }, async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "scrib-restart-"));
  const stateFile = path.join(dir, "runtime-state.json");
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const firstPort = await getFreePort();
  const first = await spawnServer(firstPort, stateFile);
  const admin = await connect(firstPort);
  const writer = await connect(firstPort);

  await emitAck(admin, "scrib_test:force_mode", { mode: "letra prohibida", letra: "Ñ" });
  const writerRegistration = await emitAck(writer, "registrar_escritor", {
    player: 1,
    client_id: "restart-writer",
    session_started_at: Date.now()
  });
  assert.equal(writerRegistration.ok, true);
  const textUpdate = await emitAck(writer, "texto_delta_actualizar", {
    player: 1,
    baseRevision: 0,
    htmlPatch: { start: 0, deleteCount: 0, insert: "Texto persistente" },
    plainPatch: { start: 0, deleteCount: 0, insert: "Texto persistente" }
  });
  assert.equal(textUpdate.ok, true);
  await emitAck(admin, "scrib_test:force_vote", {
    team: 1,
    opciones: ["⚡", "🌪️"],
    duracion_ms: 20000
  });
  admin.emit("registrar_control");
  admin.emit("cambiar_vista_espectador_modo", { modo: "stats" });
  await new Promise((resolve) => setTimeout(resolve, 350));

  admin.close();
  writer.close();
  await stopServer(first.child);
  const stored = JSON.parse(await fsp.readFile(stateFile, "utf8"));
  assert.equal(stored.state.partida.modo_actual, "letra prohibida");
  assert.equal(stored.state.partida.letra_prohibida, "Ñ");
  assert.equal(stored.state.writer.textos[1].plano, "Texto persistente");

  const secondPort = await getFreePort();
  const second = await spawnServer(secondPort, stateFile);
  t.after(() => stopServer(second.child));
  const restoredClient = await connect(secondPort);
  t.after(() => restoredClient.close());
  const restored = await emitAck(restoredClient, "scrib_test:get_state", {});

  assert.equal(restored.partida.modo_actual, "letra prohibida", second.getOutput());
  assert.equal(restored.partida.letra_prohibida, "Ñ");
  assert.equal(restored.textos[1].plano, "Texto persistente");
  assert.equal(restored.votacion_ventaja.activa, true);
  assert.equal(restored.votacion_ventaja.pausada, true);
  assert.equal(restored.espectador.modo, "stats");
  assert.equal(restored.competicion_ronda.modo, "letra prohibida");
});
