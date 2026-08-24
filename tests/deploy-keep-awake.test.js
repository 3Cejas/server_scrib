const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const HELPER = resolve(__dirname, "../deploy/keep-awake.sh");

function runBash(script, env = {}) {
  return spawnSync("bash", ["-c", script, "bash", HELPER], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function waitForFile(path, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      try {
        const value = readFileSync(path, "utf8").trim();
        if (value) return resolvePromise(value);
      } catch (_error) {
      }
      if (Date.now() - started >= timeoutMs) {
        return reject(new Error(`Timeout esperando ${path}`));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

test("deployment lease renews atomically and check returns 0/1/2", () => {
  const root = mkdtempSync(join(tmpdir(), "scrib-lease-test-"));
  try {
    const env = {
      SUTURA_KEEP_AWAKE_DIR: root,
      SUTURA_KEEP_AWAKE_TTL_SECONDS: "6",
      SUTURA_KEEP_AWAKE_REFRESH_SECONDS: "1"
    };
    const result = runBash(`
      set -euo pipefail
      source "$1"
      sutura_maintenance_lease_acquire scrib-test "despliegue de prueba"
      lease="$SUTURA_MAINTENANCE_LEASE_FILE"
      first="$(awk '{print $1}' "$lease")"
      "$1" check
      sleep 1.2
      second="$(awk '{print $1}' "$lease")"
      test "$second" -gt "$first"
      sutura_maintenance_lease_release
      test ! -e "$lease"
    `, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /active: despliegue de prueba/);

    const empty = spawnSync(HELPER, ["check"], { encoding: "utf8", env: { ...process.env, ...env } });
    assert.equal(empty.status, 1);

    writeFileSync(join(root, "scrib-corrupt.12345678.lease"), "inf roto\n", { mode: 0o600 });
    const corrupt = spawnSync(HELPER, ["check"], { encoding: "utf8", env: { ...process.env, ...env } });
    assert.equal(corrupt.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release interrupts a long refresh wait immediately without orphan children", () => {
  const root = mkdtempSync(join(tmpdir(), "scrib-lease-release-"));
  const env = {
    ...process.env,
    SUTURA_KEEP_AWAKE_DIR: root,
    SUTURA_KEEP_AWAKE_TTL_SECONDS: "360",
    SUTURA_KEEP_AWAKE_REFRESH_SECONDS: "120"
  };
  const started = Date.now();
  try {
    const result = spawnSync("bash", ["-c", `
      set -euo pipefail
      source "$1"
      sutura_maintenance_lease_acquire scrib-release "prueba de cierre rápido"
      lease="$SUTURA_MAINTENANCE_LEASE_FILE"
      renew_pid="$SUTURA_MAINTENANCE_RENEW_PID"
      sleep_pid=""
      for _attempt in $(seq 1 100); do
        if [[ -r "/proc/$renew_pid/task/$renew_pid/children" ]]; then
          read -r sleep_pid _rest < "/proc/$renew_pid/task/$renew_pid/children" || true
        fi
        [[ -n "$sleep_pid" ]] && break
        sleep 0.01
      done
      test -n "$sleep_pid"
      test -d "/proc/$renew_pid"
      test -d "/proc/$sleep_pid"
      sutura_maintenance_lease_release
      test ! -e "$lease"
      test ! -e "/proc/$renew_pid"
      test ! -e "/proc/$sleep_pid"
    `, "bash", HELPER], {
      encoding: "utf8",
      env,
      timeout: 5000
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.ok(Date.now() - started < 1500, `release tardó ${Date.now() - started} ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent deployments own distinct leases and release only their own", async () => {
  const root = mkdtempSync(join(tmpdir(), "scrib-lease-concurrency-"));
  const holds = join(root, "holds");
  const markerA = join(root, "a");
  const markerB = join(root, "b");
  const worker = `
    set -euo pipefail
    source "$1"
    cleanup() { code=$?; trap - EXIT; sutura_maintenance_lease_release; exit "$code"; }
    trap cleanup EXIT
    sutura_maintenance_lease_acquire scrib-same "despliegue concurrente"
    printf '%s\n' "$SUTURA_MAINTENANCE_LEASE_FILE" > "$2"
    sleep "$3"
  `;
  const env = {
    ...process.env,
    SUTURA_KEEP_AWAKE_DIR: holds,
    SUTURA_KEEP_AWAKE_TTL_SECONDS: "9",
    SUTURA_KEEP_AWAKE_REFRESH_SECONDS: "1"
  };
  const first = spawn("bash", ["-c", worker, "bash", HELPER, markerA, "1"], { env });
  const second = spawn("bash", ["-c", worker, "bash", HELPER, markerB, "3"], { env });
  try {
    const [leaseA, leaseB] = await Promise.all([waitForFile(markerA), waitForFile(markerB)]);
    assert.notEqual(leaseA, leaseB);
    await new Promise((resolvePromise, reject) => {
      first.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`worker A: ${code}`)));
    });
    assert.equal(spawnSync("test", ["!", "-e", leaseA]).status, 0);
    assert.equal(spawnSync("test", ["-f", leaseB]).status, 0);
    await new Promise((resolvePromise, reject) => {
      second.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`worker B: ${code}`)));
    });
    assert.equal(spawnSync("test", ["!", "-e", leaseB]).status, 0);
  } finally {
    first.kill("SIGTERM");
    second.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
