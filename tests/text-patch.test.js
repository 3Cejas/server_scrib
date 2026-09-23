const test = require("node:test");
const assert = require("node:assert/strict");

const { aplicarParcheTexto, crearParcheTexto } = require("../text_patch.js");

test("text patch round-trips insertions, deletions and rich HTML", () => {
  const casos = [
    ["", "hola"],
    ["hola", "hola mundo"],
    ["hola mundo", "hola"],
    ["<span>hola</span>", '<span class="palabra-bendita">hola</span>'],
    ["línea uno\nlínea dos", "línea uno\nlínea roja\nlínea dos"]
  ];
  casos.forEach(([anterior, siguiente]) => {
    const parche = crearParcheTexto(anterior, siguiente);
    assert.equal(aplicarParcheTexto(anterior, parche), siguiente);
  });
});

test("text patch rejects ranges outside the current revision", () => {
  assert.equal(aplicarParcheTexto("hola", { start: 8, deleteCount: 0, insert: "x" }), null);
  assert.equal(aplicarParcheTexto("hola", { start: 2, deleteCount: 9, insert: "x" }), null);
});
