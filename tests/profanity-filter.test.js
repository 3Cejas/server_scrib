const test = require("node:test");
const assert = require("node:assert/strict");

const {
  IDIOMAS_FILTRO_OFENSIVO,
  crearFiltroLenguajeOfensivo,
  contieneLenguajeOfensivo
} = require("../profanity_filter.js");

test("the profanity filter covers its multilingual dictionaries", () => {
  assert.deepEqual(IDIOMAS_FILTRO_OFENSIVO, [
    "ar", "br", "de", "en", "es", "fr", "hi", "ko", "ru", "zh"
  ]);

  [
    ["Spanish", "puta"],
    ["English", "fuck"],
    ["French", "connard"],
    ["German", "arschloch"],
    ["Hindi", "chutiya"],
    ["Korean", "개새끼"],
    ["Russian", "блядь"],
    ["Mandarin", "草泥马"],
    ["Arabic", "اعور"]
  ].forEach(([language, value]) => {
    assert.equal(contieneLenguajeOfensivo(value), true, `${language} should be blocked`);
  });
});

test("the profanity filter catches common obfuscation variants", () => {
  [
    "P.U.T.A",
    "puuutaaa",
    "f*ck",
    "f u c k",
    "fu\u200bck",
    "ｆｕｃｋ",
    "рuta"
  ].forEach((value) => {
    assert.equal(contieneLenguajeOfensivo(value), true, `${JSON.stringify(value)} should be blocked`);
  });
});

test("clean multilingual inspirations and creative terms remain allowed", () => {
  [
    "mariposa",
    "martillo",
    "asesinato",
    "una frase en el bosque",
    "مسرح",
    "你好朋友",
    "театр",
    "연극",
    "Scunthorpe",
    "classical"
  ].forEach((value) => {
    assert.equal(contieneLenguajeOfensivo(value), false, `${JSON.stringify(value)} should be allowed`);
  });
});

test("project-specific block and allow lists are configurable", () => {
  const filter = crearFiltroLenguajeOfensivo({
    palabrasExtra: ["terminointerno"],
    palabrasPermitidas: ["mierda"]
  });

  assert.equal(filter.contieneLenguajeOfensivo("terminointerno"), true);
  assert.equal(filter.contieneLenguajeOfensivo("mierda"), false);
});
