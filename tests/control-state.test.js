const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorEstadoControl,
  normalizarModosControl,
  normalizarParametrosControl
} = require("../control_state.js");

test("control state persists panel parameters and clamps invalid values", () => {
  const events = [];
  const gestor = crearGestorEstadoControl({
    io: {
      emit(event, payload) {
        events.push({ event, payload });
      }
    }
  });

  const estado = gestor.actualizar({
    borrar_texto: true,
    frases_finales: { 1: " cierre azul ", 2: "cierre rojo" },
    parametros: {
      tiempo_modos: 9999,
      tiempo_minutos: -5,
      tiempo_segundos: 70,
      escala_espectador: 123
    },
    modos: ["stats", "tertulia", "frase final"],
    nombres: { 1: "ana", 2: "bea" }
  });

  assert.equal(estado.borrar_texto, true);
  assert.deepEqual(estado.frases_finales, { 1: "cierre azul", 2: "cierre rojo" });
  assert.equal(estado.parametros.tiempo_modos, 3600);
  assert.equal(estado.parametros.tiempo_minutos, 0);
  assert.equal(estado.parametros.tiempo_segundos, 55);
  assert.equal(estado.parametros.escala_espectador, 123);
  assert.deepEqual(estado.modos, ["tertulia", "frase final"]);
  assert.deepEqual(estado.nombres, { 1: "ANA", 2: "BEA" });

  gestor.emitir();
  assert.equal(events[0].event, "control_estado");
  assert.equal(events[0].payload.borrar_texto, true);
});

test("control state normalizers preserve previous values when fields are absent", () => {
  assert.deepEqual(
    normalizarParametrosControl({ tiempo_modos: 120 }, { tiempo_modos: 30, tiempo_votacion: 40 }),
    { tiempo_modos: 120, tiempo_votacion: 40 }
  );
  assert.deepEqual(
    normalizarModosControl(null, ["tertulia"]),
    ["tertulia"]
  );
});
