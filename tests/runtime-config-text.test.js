const test = require("node:test");
const assert = require("node:assert/strict");

const { extraerTextoPlano } = require("../runtime_config.js");

test("contenteditable HTML is converted to text without exposing DIV as a word", () => {
  const texto = extraerTextoPlano({
    text: '<div>La historia</div><div>continúa<br>sin etiquetas&nbsp;&amp; limpia</div>'
  });

  assert.equal(texto, "La historia\ncontinúa\nsin etiquetas & limpia");
  assert.doesNotMatch(texto, /\bdiv\b/i);
});

test("encoded angle brackets remain authored text after HTML is removed", () => {
  assert.equal(extraerTextoPlano({ text: '<p>&lt;SCRI&gt; B</p>' }), "<SCRI> B");
});
