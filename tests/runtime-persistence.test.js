const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { RUNTIME_STATE_SCHEMA, crearPersistenciaRuntime } = require("../runtime_persistence.js");

async function crearRutaTemporal(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "scrib-runtime-state-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "runtime-state.json");
}

test("runtime persistence writes an atomic private checkpoint and loads it", async (t) => {
  const filePath = await crearRutaTemporal(t);
  const persistence = crearPersistenciaRuntime({
    filePath,
    enabled: true,
    debounceMs: 5,
    maxAgeMs: 60_000
  });
  const state = {
    writer: { textos: { 1: { html: "hola", plano: "hola" } } },
    reloj: { activo: true, tiempo_restante_segundos: 42 }
  };

  assert.equal(persistence.schedule(() => state), true);
  await persistence.flush();

  const stored = JSON.parse(await fsp.readFile(filePath, "utf8"));
  assert.equal(stored.schema, RUNTIME_STATE_SCHEMA);
  assert.deepEqual(stored.state, state);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.deepEqual(persistence.load(), state);
});

test("runtime persistence coalesces pending snapshots and rejects stale or corrupt files", async (t) => {
  const filePath = await crearRutaTemporal(t);
  const persistence = crearPersistenciaRuntime({
    filePath,
    enabled: true,
    debounceMs: 50,
    maxAgeMs: 100
  });

  persistence.schedule(() => ({ revision: 1 }));
  persistence.schedule(() => ({ revision: 2 }));
  await persistence.flush();
  assert.deepEqual(persistence.load(), { revision: 2 });

  await fsp.writeFile(filePath, JSON.stringify({
    schema: RUNTIME_STATE_SCHEMA,
    saved_at: Date.now() - 10_000,
    state: { revision: 3 }
  }));
  assert.equal(persistence.load(), null);

  await fsp.writeFile(filePath, "{not-json");
  assert.equal(persistence.load(), null);
});

test("runtime persistence stays inert when disabled", async (t) => {
  const filePath = await crearRutaTemporal(t);
  const persistence = crearPersistenciaRuntime({ filePath, enabled: false });
  assert.equal(persistence.schedule({ revision: 1 }), false);
  await persistence.flush();
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(persistence.load(), null);
});
