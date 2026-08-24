const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACCESS_TOKEN_TTL_MS,
  MAX_INTENTOS_FALLIDOS,
  MAX_TOKENS_ACTIVOS,
  crearGestorAccesoRoles,
  compararSecreto,
  normalizarToken
} = require("../role_access.js");

function crearReloj(inicio = 1000) {
  let actual = inicio;
  return {
    avanzar(ms) { actual += ms; },
    now: () => actual
  };
}

function socket(id = "socket", address = "127.0.0.1") {
  return { id, handshake: { address } };
}

test("role access compares secrets safely and accepts only bounded opaque tokens", () => {
  assert.equal(compararSecreto("correcta", "correcta"), true);
  assert.equal(compararSecreto("correcta", "incorrecta"), false);
  assert.equal(compararSecreto("á", "a"), false);
  assert.equal(normalizarToken("a".repeat(32)), "a".repeat(32));
  assert.equal(normalizarToken("short"), "");
  assert.equal(normalizarToken(`${"a".repeat(32)}!`), "");
});

test("a valid password issues a purpose-bound hashed token with an eight-hour expiry", () => {
  const reloj = crearReloj();
  let secuencia = 0;
  const acceso = crearGestorAccesoRoles({
    passwordRoles: "secreta",
    now: reloj.now,
    crearToken: () => `token_${String(++secuencia).padStart(40, "a")}`
  });
  const emitido = acceso.validarPassword(socket(), "secreta");
  assert.equal(emitido.ok, true);
  assert.equal(emitido.expires_ts, reloj.now() + ACCESS_TOKEN_TTL_MS);
  assert.equal(acceso.autorizarControl({ access_token: emitido.access_token }).ok, true);
  assert.equal(acceso.autorizarControl({ access_token: "x".repeat(43) }).code, "INVALID_ACCESS_TOKEN");
  assert.deepEqual(acceso.snapshotSeguro(), { tokens_activos: 1, claves_bloqueadas: 0 });

  reloj.avanzar(ACCESS_TOKEN_TTL_MS);
  assert.equal(acceso.autorizarControl({ access_token: emitido.access_token }).code, "ACCESS_TOKEN_EXPIRED");
  assert.equal(acceso.snapshotSeguro().tokens_activos, 0);
});

test("password failures are rate limited across reconnects from the same address", () => {
  const reloj = crearReloj();
  const acceso = crearGestorAccesoRoles({ passwordRoles: "secreta", now: reloj.now });
  for (let intento = 0; intento < MAX_INTENTOS_FALLIDOS; intento += 1) {
    const resultado = acceso.validarPassword(socket(`socket-${intento}`, "10.0.0.7"), "mala");
    assert.equal(resultado.code, "INVALID_PASSWORD");
  }
  const bloqueado = acceso.validarPassword(socket("nuevo", "10.0.0.7"), "secreta");
  assert.equal(bloqueado.code, "RATE_LIMITED");
  assert.equal(bloqueado.retry_after_ms, 60000);
  assert.equal(acceso.validarPassword(socket("otra-ip", "10.0.0.8"), "secreta").ok, true);
  reloj.avanzar(60000);
  assert.equal(acceso.validarPassword(socket("tras-espera", "10.0.0.7"), "secreta").ok, true);
});

test("active token storage is bounded without ever exposing token material in snapshots", () => {
  const reloj = crearReloj();
  let secuencia = 0;
  const acceso = crearGestorAccesoRoles({
    passwordRoles: "secreta",
    now: reloj.now,
    crearToken: () => `token_${String(++secuencia).padStart(40, "0")}`
  });
  let primero = null;
  for (let indice = 0; indice < MAX_TOKENS_ACTIVOS + 5; indice += 1) {
    const emitido = acceso.validarPassword(socket(`socket-${indice}`, `10.0.1.${indice}`), "secreta");
    if (!primero) primero = emitido.access_token;
    reloj.avanzar(1);
  }
  const snapshot = acceso.snapshotSeguro();
  assert.equal(snapshot.tokens_activos, MAX_TOKENS_ACTIVOS);
  assert.equal(JSON.stringify(snapshot).includes("token_"), false);
  assert.equal(acceso.autorizarControl({ access_token: primero }).code, "INVALID_ACCESS_TOKEN");
});
