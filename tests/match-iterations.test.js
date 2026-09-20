const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aplicarParcheTexto,
  calcularParcheTexto,
  crearRegistroIteracionesPartida
} = require("../match_iterations.js");

test("text patches reconstruct insertions, replacements and deletions", () => {
  const casos = [
    ["", "Hola"],
    ["Hola", "Hola mundo"],
    ["Hola mundo", "Hola musa"],
    ["Hola musa", "Hola"],
    ["A🙂B", "A🎭B"]
  ];

  casos.forEach(([anterior, actual], indice) => {
    const parche = calcularParcheTexto(anterior, actual);
    const operacion = [indice + 1, indice * 10, 1, ...parche];
    assert.equal(aplicarParcheTexto(anterior, operacion), actual);
  });
  assert.equal(calcularParcheTexto("igual", "igual"), null);
});

test("a match export contains every compact text iteration and reconstructs both final texts", () => {
  let reloj = 1000;
  let textos = {
    1: { plano: "", html: { text: "" } },
    2: { plano: "", html: "" }
  };
  const registro = crearRegistroIteracionesPartida({
    now: () => reloj,
    getTextos: () => textos,
    getNombres: () => ({ 1: "Ada", 2: "Lorca" })
  });

  registro.iniciar({ parametros: { duracion: 120 }, borrar_texto: true });
  const cambios = [
    [1, "", "H"],
    [2, "", "Mar"],
    [1, "H", "Hola"],
    [1, "Hola", "Ola"]
  ];
  cambios.forEach(([player, anterior, actual]) => {
    reloj += 15;
    textos[player] = player === 1
      ? { plano: actual, html: { text: `<p>${actual}</p>`, caretPos: actual.length } }
      : { plano: actual, html: `<p>${actual}</p>` };
    assert.equal(registro.registrarCambio(player, anterior, actual), true);
  });
  reloj += 50;
  registro.finalizar("fin_partida", { marcador: { 1: 8, 2: 5 } });

  const exportacion = registro.construirExportacion({
    eventos: [
      { seq: 1, ts: 900, tipo: "sesion" },
      {
        seq: 2,
        ts: 1020,
        tipo: "texto",
        hechos: { player: 1, texto: "duplicado", extracto: "dup", firma: "x", palabras: 1 }
      },
      { seq: 3, ts: 1080, tipo: "modo", modo: "tertulia", hechos: { origen: "inicio" } }
    ]
  });

  assert.equal(exportacion.tipo, "scrib_iteraciones_partida");
  assert.equal(exportacion.partida.completa, true);
  assert.equal(exportacion.resumen.iteraciones, cambios.length);
  assert.equal(exportacion.contexto.length, 2);
  assert.equal(Object.hasOwn(exportacion.contexto[0].hechos, "texto"), false);
  assert.equal(Object.hasOwn(exportacion.contexto[0].hechos, "extracto"), false);
  assert.deepEqual(exportacion.resumen.marcador, { 1: 8, 2: 5 });

  const reconstruidos = {
    1: exportacion.escritores[1].texto_base,
    2: exportacion.escritores[2].texto_base
  };
  exportacion.iteraciones.forEach((operacion) => {
    reconstruidos[operacion[2]] = aplicarParcheTexto(reconstruidos[operacion[2]], operacion);
  });
  assert.equal(reconstruidos[1], exportacion.escritores[1].texto_final);
  assert.equal(reconstruidos[2], exportacion.escritores[2].texto_final);
  assert.equal(exportacion.escritores[1].html_final, "<p>Ola</p>");
});

test("the recorder has a bounded memory guard for pathological matches", () => {
  let reloj = 2000;
  const registro = crearRegistroIteracionesPartida({
    now: () => ++reloj,
    limiteIteraciones: 2,
    limiteBytes: 1024
  });
  registro.iniciar();

  assert.equal(registro.registrarCambio(1, "", "a"), true);
  assert.equal(registro.registrarCambio(1, "a", "ab"), true);
  assert.equal(registro.registrarCambio(1, "ab", "abc"), false);

  const exportacion = registro.construirExportacion();
  assert.equal(exportacion.iteraciones.length, 2);
  assert.equal(exportacion.partida.completa, false);
  assert.equal(exportacion.partida.operaciones_omitidas, 1);
});
