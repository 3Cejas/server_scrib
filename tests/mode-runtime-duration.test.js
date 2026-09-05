const test = require("node:test");
const assert = require("node:assert/strict");

const { crearRuntimeModos, repartirDuracionPartida, normalizarListaModosPartida } = require("../mode_runtime.js");

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

test("retains both final phrases in reconnect snapshots", () => {
  const runtime = crearRuntimeModos({
    io: { emit() {} },
    partidaSync: {
      withModoSeq: (payload) => ({ ...payload, modo_seq: 8 }),
      construirPayloadCount: (payload) => payload
    },
    validarJugador: (player) => Number(player) || null
  });
  runtime.prepararParametrosInicio({
    TIEMPO_CAMBIO_PALABRAS: 30,
    TIEMPO_BORROSO: 1,
    TIEMPO_MODIFICADOR: 1,
    TIEMPO_VOTACION: 1,
    TIEMPO_CAMBIO_LETRA: 1,
    DURACION_PARTIDA: 30,
    LISTA_MODOS: ["frase final"],
    FRASE_FINAL_J1: "Final azul",
    FRASE_FINAL_J2: "Final rojo"
  });
  runtime.estadoMotorModos.modoActual = "frase final";

  assert.deepEqual(runtime.construirPayloadInspiracionMusaActual(), {
    modo_actual: "frase final",
    FRASE_FINAL_J1: "Final azul",
    FRASE_FINAL_J2: "Final rojo",
    frases_finales: { 1: "Final azul", 2: "Final rojo" },
    modo_seq: 8
  });
});
