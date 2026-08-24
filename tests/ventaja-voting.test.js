const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorVotacionVentaja } = require("../ventaja_voting.js");
const { crearGestoresBase } = require("../runtime_managers.js");

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
    getDuracionVotacionMs: () => 1200,
    getDuracionDesventajaMs: () => 9000,
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

  const estadoAbierto = gestor.abrirForzada({
    team: 1,
    opciones: ["rayo"],
    emitir_resultado: false
  });
  assert.equal(estadoAbierto.duracion_ms, 1200);
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

test("runtime keeps vote duration separate from applied disadvantage duration", () => {
  const events = [];
  const applied = [];
  let scheduled = null;
  const managers = crearGestoresBase({
    io: {
      emit(eventName, payload) {
        events.push({ eventName, payload });
      }
    },
    obtenerIdJugadorValido: (player) => {
      const id = Number(player);
      return id === 1 || id === 2 ? id : null;
    },
    getTextoEscritor: () => ({ 1: "", 2: "" }),
    onVistaCambiada: () => {},
    getTiempoVotacion: () => 3100,
    getTiempoModificador: () => 8700,
    onAplicarVentaja: (payload) => {
      applied.push(payload);
      return payload;
    },
    programarVotacionTimer: (callback, durationMs) => {
      scheduled = { callback, durationMs };
    },
    cancelarVotacionTimer: () => {},
    syncMode: () => {}
  });

  const estadoAbierto = managers.votacionVentaja.lanzar({
    ganador: "j1",
    perdedor: "j2"
  });

  assert.equal(estadoAbierto.duracion_ms, 3100);
  assert.equal(scheduled.durationMs, 3100);

  scheduled.callback();

  assert.equal(applied.length, 1);
  assert.equal(applied[0].duracion_ms, 8700);
  const resultado = events.find(({ eventName }) => eventName === "enviar_ventaja_j2");
  assert.equal(resultado.payload.duracion_ms, 8700);
});
