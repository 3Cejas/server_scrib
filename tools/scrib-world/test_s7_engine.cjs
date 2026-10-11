const test = require("node:test");
const assert = require("node:assert/strict");
const s7 = require("./laboratory/s7/js/s7-engine.js");

test("S+7 transforms nouns and adjusts nearby grammar", () => {
  const result = s7.transformText("Una palabra secreta.", { mode: "s7", step: 7 });

  assert.equal(result.text, "Un pasillo secreto.");
  assert.equal(result.replacements.length, 1);
  assert.equal(result.replacements[0].label, "S");
  assert.match(result.replacements[0].note, /cambio de g/);
  assert.match(result.replacements[0].note, /ajuste Una > Un/);
  assert.match(result.replacements[0].note, /ajuste secreta > secreto/);
});

test("S+7 treats the dictionary as circular", () => {
  const result = s7.transformText("zuzón", { mode: "s7", step: 7 });

  assert.equal(result.text, "abalorio");
  assert.equal(result.replacements[0].wrapped, true);
  assert.match(result.replacements[0].note, /diccionario circular/);
});

test("S+7 uses the insertion point when a noun is missing", () => {
  const result = s7.transformText("los rejegos", { mode: "s7", step: 7 });

  assert.equal(result.text, "las sillas");
  assert.equal(result.replacements[0].exact, false);
  assert.match(result.replacements[0].note, /base rejera/);
});

test("variations support verbs, eclipse, Caradec, and auxiliary instruments", () => {
  const verbResult = s7.transformText("quiero escribir", { mode: "v7", step: 7 });
  assert.equal(verbResult.replacements.length, 1);
  assert.equal(verbResult.replacements[0].label, "V");
  assert.notEqual(verbResult.text, "quiero escribir");

  const eclipse = s7.transformText("La casa habla.", { mode: "eclipse", step: 7 });
  assert.match(eclipse.text, /--- eclipse S\+7 ---/);
  assert.match(eclipse.text, /La ceja habla\./);

  const caradec = s7.transformText("casa", { mode: "caradec", step: 7, caradecLength: 5 });
  assert.equal(caradec.text.split(" -> ").length, 5);

  const auxiliary = s7.transformText("la amapola", {
    mode: "s7",
    step: 1,
    instrument: "auxiliary",
    auxiliaryText: "amapola barco ciudad"
  });
  assert.equal(auxiliary.text, "el barco");
});

test("V+7 does not confuse adverbs or adjectives ending in ido with verbs", () => {
  const result = s7.transformText(
    "Intentas coger el cielo, pero todo es demasiado líquido para morir de viejo",
    { mode: "v7", step: 7 }
  );

  assert.equal(
    result.text,
    "Intentas cruzar el cielo, pero todo es demasiado líquido para perder de viejo"
  );
  assert.deepEqual(
    result.replacements.map((item) => item.original),
    ["coger", "morir"]
  );
});
