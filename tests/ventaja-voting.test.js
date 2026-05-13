const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorVotacionVentaja } = require("../ventaja_voting.js");

test("advantage voting emits applied disadvantage payload with duration", () => {
  const events = [];
  const applied = [];
  const gestor = crearGestorVotacionVentaja({
    io: {
      emit(eventName, payload) {
        events.push({ eventName, payload });
      }
    },
    construirPayloadBase: (payload) => payload,
    obtenerIdJugadorValido: (player) => {
      const id = Number(player);
      return id === 1 || id === 2 ? id : null;
    },
    getDuracionMs: () => 9000,
    onAplicarVentaja: (payload) => {
      applied.push(payload);
      return {
        player: payload.player,
        putada: payload.putada,
        duracion_ms: payload.duracion_ms,
        tiempo_restante_ms: payload.duracion_ms
      };
    },
    escogerGanador: () => "rayo"
  });

  gestor.abrirForzada({
    team: 1,
    opciones: ["rayo"],
    duracion_ms: 1200,
    emitir_resultado: false
  });
  gestor.cerrarForzada({ seleccion: "rayo" });

  assert.deepEqual(applied, [
    {
      player: 2,
      perdedor: "j2",
      seleccion: "rayo",
      putada: "rayo",
      duracion_ms: 9000
    }
  ]);
  assert.deepEqual(events.at(-1), {
    eventName: "enviar_ventaja_j2",
    payload: {
      player: 2,
      putada: "rayo",
      duracion_ms: 9000,
      tiempo_restante_ms: 9000
    }
  });
});
