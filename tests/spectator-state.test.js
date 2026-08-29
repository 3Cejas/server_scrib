const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorVistaEspectador,
  ESCALA_UI_ESPECTADOR_DEFAULT,
  ESCALA_UI_ESPECTADOR_MAX,
  PUNTUACION_SLIDE_MAX
} = require("../spectator_state.js");

test("spectator view scale defaults to the parameter baseline and clamps remote values", () => {
  const events = [];
  const gestor = crearGestorVistaEspectador({
    io: {
      emit(event, payload) {
        events.push({ event, payload });
      }
    }
  });

  assert.equal(gestor.payload().escala_ui, ESCALA_UI_ESPECTADOR_DEFAULT);
  assert.equal(gestor.ajustarEscala({ valor: 9 }), ESCALA_UI_ESPECTADOR_MAX);
  assert.equal(gestor.reset().escala_ui, ESCALA_UI_ESPECTADOR_DEFAULT);
});

test("dedicated score view has an independent reveal step clamped from intro to final", () => {
  const gestor = crearGestorVistaEspectador({ io: { emit() {} } });

  assert.equal(gestor.cambiarModo("puntuacion"), "puntuacion");
  assert.equal(gestor.payload().modo, "puntuacion");
  assert.equal(gestor.payload().puntuacion_slide_step, 0);

  for (let index = 0; index < 20; index += 1) {
    gestor.navegarPuntuacion(1);
  }
  assert.equal(gestor.getPuntuacionSlideStep(), PUNTUACION_SLIDE_MAX);
  assert.equal(gestor.payload().puntuacion_slide_step, 7);

  for (let index = 0; index < 20; index += 1) {
    gestor.navegarPuntuacion(-1);
  }
  assert.equal(gestor.getPuntuacionSlideStep(), 0);

  gestor.navegarPuntuacion(1);
  gestor.cambiarModo("partida");
  gestor.cambiarModo("puntuacion");
  assert.equal(gestor.getPuntuacionSlideStep(), 0);
});

test("tutorial is an authoritative spectator view distinct from the game and warmup", () => {
  let warmupVisible = false;
  const gestor = crearGestorVistaEspectador({
    io: { emit() {} },
    isCalentamientoVisible: () => warmupVisible
  });

  assert.equal(gestor.cambiarModo("tutorial"), "tutorial");
  assert.equal(gestor.resolverModo(), "tutorial");
  warmupVisible = true;
  assert.equal(gestor.resolverModo(), "tutorial");
  gestor.cambiarModo("partida");
  assert.equal(gestor.resolverModo(), "calentamiento");
  warmupVisible = false;
  assert.equal(gestor.resolverModo(), "partida");
});
