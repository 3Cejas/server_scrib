const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALFABETO_ES,
  elegirLetraPendientePonderada,
  elegirLetraPonderada,
  pesoLetraPorModo
} = require("../letter_frequency.js");

test("Spanish weighted alphabet includes enye and all A-Z letters", () => {
  assert.equal(ALFABETO_ES.length, 27);
  assert.equal(ALFABETO_ES.includes("\u00f1"), true);
  assert.deepEqual(ALFABETO_ES.slice(0, 5), ["a", "b", "c", "d", "e"]);
  assert.equal(ALFABETO_ES.at(-1), "z");
});

test("forbidden letters favor common letters and blessed letters favor rare letters", () => {
  assert.ok(pesoLetraPorModo("e", "prohibida") > pesoLetraPorModo("w", "prohibida"));
  assert.ok(pesoLetraPorModo("w", "bendita") > pesoLetraPorModo("e", "bendita"));
});

test("weighted picker uses opposite distributions for forbidden and blessed letters", () => {
  assert.equal(elegirLetraPonderada(["e", "w"], "prohibida", () => 0.5), "e");
  assert.equal(elegirLetraPonderada(["e", "w"], "bendita", () => 0.5), "w");
});

test("weighted pending picker removes selected letters and resets when exhausted", () => {
  const selected = elegirLetraPendientePonderada({
    pendientes: ["e"],
    base: ["e", "w"],
    tipo: "prohibida",
    random: () => 0
  });

  assert.equal(selected.letra, "e");
  assert.deepEqual(selected.pendientes, ["e", "w"]);
});
