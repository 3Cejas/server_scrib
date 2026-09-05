const test = require("node:test");
const assert = require("node:assert/strict");

const { repartirDuracionPartida, normalizarListaModosPartida } = require("../mode_runtime.js");

test("reparte la duracion total entre todos los niveles sin perder segundos", () => {
  assert.deepEqual(repartirDuracionPartida(1800, 6), [300, 300, 300, 300, 300, 300]);
  assert.deepEqual(repartirDuracionPartida(301, 3), [101, 100, 100]);
  assert.equal(repartirDuracionPartida(301, 3).reduce((total, valor) => total + valor, 0), 301);
});

test("garantiza al menos un segundo para cada nivel activo", () => {
  assert.deepEqual(repartirDuracionPartida(2, 4), [1, 1, 1, 1]);
});

test("mantiene Letra maldita después de Letra bendita aunque el orden guardado sea antiguo", () => {
  assert.deepEqual(
    normalizarListaModosPartida(["tertulia", "letra prohibida", "letra bendita"]),
    ["letra bendita", "letra prohibida", "tertulia"]
  );
});

test("conserva solo los niveles activos, sin duplicados", () => {
  assert.deepEqual(
    normalizarListaModosPartida(["frase final", "palabras bonus", "palabras bonus", "desconocido"]),
    ["palabras bonus", "frase final"]
  );
});
