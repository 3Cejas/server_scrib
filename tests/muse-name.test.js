const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizarNombreMusa } = require("../runtime_config.js");

test("muse names accept Spanish accents and Ñ without accepting HTML or symbol-only names", () => {
    assert.equal(normalizarNombreMusa(" brétema "), "BRÉTEMA");
    assert.equal(normalizarNombreMusa("niña"), "NIÑA");
    assert.equal(normalizarNombreMusa("Üma"), "ÜMA");
    assert.equal(normalizarNombreMusa("<script>"), "");
    assert.equal(normalizarNombreMusa("1234--"), "");
});
