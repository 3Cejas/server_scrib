const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorVistaEspectador,
  ESCALA_UI_ESPECTADOR_DEFAULT,
  ESCALA_UI_ESPECTADOR_MAX
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
