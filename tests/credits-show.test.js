const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorCreditosShow,
  ESTADO_CREDITOS_POR_DEFECTO,
  normalizarMusasCreditosShow
} = require("../credits_show.js");

test("credits use the requested uppercase cast and dramaturgy defaults", () => {
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.escritxr_rojo, "PABLO PINEÑO");
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.escritxr_azul, "ALVARA STRINGANA");
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.interprete_azul_1, "ELENA CONDE");
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.interprete_azul_2, "ANA SEMPERE");
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.interprete_rojo_1, "LAURA ESCOBAR");
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.interprete_rojo_2, "VERÓNICA ANTONUCCI");
  assert.equal(ESTADO_CREDITOS_POR_DEFECTO.dramaturgia, "ÁNGELA BUENO Y PABLO PINEÑO");
});

test("credits show payload injects current match muses without storing stale names", () => {
  let musasActuales = {
    azules: [" Luna ", "luna", "<Sol>"],
    rojas: [" Eva "]
  };
  const gestor = crearGestorCreditosShow({
    isVisible: () => true,
    getMusasCreditos: () => musasActuales
  });

  gestor.actualizar({
    escritxr_azul: "ESCRITORA AZUL",
    musas: {
      azules: ["Musa vieja"],
      rojas: ["Musa vieja roja"]
    }
  });

  assert.deepEqual(gestor.payload().creditos.musas, {
    azules: ["Luna", "<Sol>"],
    rojas: ["Eva"]
  });

  musasActuales = { azules: [], rojas: ["Nueva Roja"] };
  assert.deepEqual(gestor.payload().creditos.musas, {
    azules: [],
    rojas: ["Nueva Roja"]
  });
});

test("credits show preserves explicit muse credits when no live getter is provided", () => {
  const gestor = crearGestorCreditosShow();

  gestor.actualizar({
    musas: {
      azules: ["Luna"],
      rojas: ["Sol"]
    }
  });

  assert.deepEqual(gestor.payload().creditos.musas, {
    azules: ["Luna"],
    rojas: ["Sol"]
  });
});

test("credits show normalizes muse credit lists defensively", () => {
  const normalizado = normalizarMusasCreditosShow({
    azules: [" Ana ".repeat(20), "Ana".repeat(20), "", null],
    rojas: "no-list"
  });

  assert.equal(normalizado.azules.length, 2);
  assert.equal(normalizado.azules[0].length, 48);
  assert.equal(normalizado.azules[0].startsWith("Ana Ana"), true);
  assert.equal(normalizado.azules[1].length, 48);
  assert.deepEqual(normalizado.rojas, []);
});
