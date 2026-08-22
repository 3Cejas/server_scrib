const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATEGORIAS_PUNTUACION,
  PUNTUACION_FORMULA_VERSION,
  calcularPuntuacionFinal,
  crearGestorPuntuacionFinal,
  repartirCuota
} = require("../final_scoring.js");

const crearStats = (player1 = {}, player2 = {}) => ({
  players: {
    1: {
      nombre: "AZUL",
      palabrasTotal: 100,
      palabrasUnicas: 60,
      ritmoPpm: 60,
      palabrasBenditas: ["luz", "mar", "sol", "voz"],
      intentosLetraProhibida: 1,
      intentosPalabraProhibida: 0,
      vida: { media: 80 },
      ...player1
    },
    2: {
      nombre: "ROJO",
      palabrasTotal: 50,
      palabrasUnicas: 25,
      ritmoPpm: 40,
      palabrasBenditas: ["nube", "sal"],
      intentosLetraProhibida: 1,
      intentosPalabraProhibida: 2,
      vida: { media: 40 },
      ...player2
    }
  }
});

test("final score uses the six documented categories and always distributes 100 points", () => {
  const resultado = calcularPuntuacionFinal(crearStats(), { now: 1234 });

  assert.equal(resultado.formula_version, PUNTUACION_FORMULA_VERSION);
  assert.equal(resultado.disponible, true);
  assert.equal(resultado.datos_suficientes, true);
  assert.equal(resultado.calculado_en_ts, 1234);
  assert.deepEqual(
    resultado.categorias.map((categoria) => categoria.id),
    CATEGORIAS_PUNTUACION.map((categoria) => categoria.id)
  );
  assert.deepEqual(
    resultado.categorias.map((categoria) => categoria.peso),
    [20, 15, 15, 20, 20, 10]
  );
  resultado.categorias.forEach((categoria) => {
    assert.equal(Number((categoria.puntos[1] + categoria.puntos[2]).toFixed(2)), categoria.peso);
    assert.equal(categoria.ganador, 1);
    assert.equal(categoria.empate, false);
  });
  assert.equal(resultado.jugadores[1].total + resultado.jugadores[2].total, 100);
  assert.equal(resultado.ganador, 1);
  assert.equal(resultado.empate, false);
  assert.equal(resultado.diferencia, 32.5);
  const ritmo = resultado.categorias.find((categoria) => categoria.id === "ritmo");
  assert.equal(ritmo.unidad, "pulsaciones/min");
  assert.match(ritmo.explicacion, /pulsaciones por minuto/i);
});

test("equal or zero category values split every weight fifty-fifty", () => {
  const vacio = {
    palabrasTotal: 0,
    palabrasUnicas: 0,
    ritmoPpm: 0,
    palabrasBenditas: [],
    intentosLetraProhibida: 0,
    intentosPalabraProhibida: 0,
    vida: { media: 0 }
  };
  const resultado = calcularPuntuacionFinal(crearStats(vacio, vacio));

  resultado.categorias.forEach((categoria) => {
    assert.equal(categoria.puntos[1], categoria.peso / 2);
    assert.equal(categoria.puntos[2], categoria.peso / 2);
    assert.equal(categoria.ganador, null);
    assert.equal(categoria.empate, true);
  });
  assert.equal(resultado.jugadores[1].total, 50);
  assert.equal(resultado.jugadores[2].total, 50);
  assert.equal(resultado.ganador, null);
  assert.equal(resultado.empate, true);
});

test("precision rewards fewer prohibited attempts without dividing by zero", () => {
  const resultado = calcularPuntuacionFinal(crearStats({
    intentosLetraProhibida: 0,
    intentosPalabraProhibida: 0
  }, {
    intentosLetraProhibida: 3,
    intentosPalabraProhibida: 1
  }));
  const precision = resultado.categorias.find((categoria) => categoria.id === "precision");

  assert.deepEqual(precision.valores, { 1: 0, 2: 4 });
  assert.equal(precision.mejor, "menor");
  assert.equal(precision.ganador, 1);
  assert.deepEqual(precision.puntos, { 1: 16.67, 2: 3.33 });
});

test("lexical richness cannot exceed total production and invalid numbers are safe", () => {
  const resultado = calcularPuntuacionFinal(crearStats({
    palabrasTotal: 10,
    palabrasUnicas: 999,
    ritmoPpm: Number.POSITIVE_INFINITY,
    vida: { media: -8 }
  }, {
    palabrasTotal: 20,
    palabrasUnicas: 8,
    ritmoPpm: Number.NaN,
    vida: { media: null }
  }));
  const riqueza = resultado.categorias.find((categoria) => categoria.id === "riqueza_lexica");
  const ritmo = resultado.categorias.find((categoria) => categoria.id === "ritmo");
  const resistencia = resultado.categorias.find((categoria) => categoria.id === "resistencia");

  assert.deepEqual(riqueza.valores, { 1: 10, 2: 8 });
  assert.deepEqual(ritmo.valores, { 1: 0, 2: 0 });
  assert.deepEqual(resistencia.valores, { 1: 0, 2: 0 });
});

test("incomplete telemetry is not available and never proclaims an overall winner", () => {
  const resultado = calcularPuntuacionFinal(crearStats(), {
    datosRecibidos: { 1: true, 2: false }
  });

  assert.equal(resultado.disponible, false);
  assert.equal(resultado.datos_suficientes, false);
  assert.deepEqual(resultado.fuentes_datos, { 1: true, 2: false });
  assert.equal(resultado.ganador, null);
  assert.equal(resultado.empate, false);
});

test("score manager snapshots authoritative names, emits clones and resets cleanly", () => {
  const eventos = [];
  const gestor = crearGestorPuntuacionFinal({
    io: {
      emit(event, payload) {
        eventos.push({ event, payload });
      }
    },
    getNombreEquipo: (player) => (player === 1 ? "EQUIPO AZUL" : "EQUIPO ROJO"),
    now: () => 5678
  });

  const resultado = gestor.capturar(crearStats(), {
    datosRecibidos: { 1: true, 2: true }
  });
  resultado.jugadores[1].nombre = "MUTADO";

  assert.equal(gestor.payload().jugadores[1].nombre, "EQUIPO AZUL");
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].event, "puntuacion_final_estado");
  assert.equal(eventos[0].payload.calculado_en_ts, 5678);
  assert.equal(gestor.reset().disponible, false);
});

test("pending capture waits for both data sources and fixes the result exactly once", () => {
  let now = 100;
  const gestor = crearGestorPuntuacionFinal({ now: () => now });

  assert.equal(gestor.prepararCaptura(), true);
  assert.equal(gestor.estaPendiente(), true);

  const incompleta = gestor.capturarPendiente(crearStats(), {
    datosRecibidos: { 1: true, 2: false }
  });
  assert.equal(incompleta.ok, false);
  assert.equal(incompleta.code, "DATOS_INSUFICIENTES");
  assert.equal(gestor.estaPendiente(), true);
  assert.equal(gestor.payload().disponible, false);

  const capturada = gestor.capturarPendiente(crearStats(), {
    datosRecibidos: { 1: true, 2: true }
  });
  assert.equal(capturada.ok, true);
  assert.equal(capturada.capturada, true);
  assert.equal(capturada.ya_capturada, false);
  assert.equal(capturada.puntuacion.calculado_en_ts, 100);
  const totalFijado = capturada.puntuacion.jugadores[1].total;

  now = 200;
  const repetida = gestor.capturarPendiente(crearStats({ palabrasTotal: 0 }, {
    palabrasTotal: 999
  }), {
    datosRecibidos: { 1: true, 2: true }
  });
  assert.equal(repetida.ok, true);
  assert.equal(repetida.capturada, false);
  assert.equal(repetida.ya_capturada, true);
  assert.equal(repetida.puntuacion.jugadores[1].total, totalFijado);
  assert.equal(repetida.puntuacion.calculado_en_ts, 100);
  assert.equal(gestor.prepararCaptura(), false);
});

test("reset clears both the published result and any pending capture", () => {
  const gestor = crearGestorPuntuacionFinal();
  gestor.prepararCaptura();
  assert.equal(gestor.estaPendiente(), true);

  const estado = gestor.reset();
  assert.equal(estado.disponible, false);
  assert.equal(gestor.estaPendiente(), false);
  assert.equal(gestor.capturarPendiente(crearStats()).code, "PUNTUACION_NO_PENDIENTE");
});

test("positive quota helper is deterministic for zero, ties and proportional values", () => {
  assert.deepEqual(repartirCuota(0, 0), { 1: 0.5, 2: 0.5, empate: true });
  assert.deepEqual(repartirCuota(7, 7), { 1: 0.5, 2: 0.5, empate: true });
  assert.deepEqual(repartirCuota(3, 1), { 1: 0.75, 2: 0.25, empate: false });
});
