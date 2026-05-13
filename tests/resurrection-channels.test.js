const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorResurreccion } = require("../resurrection_channels.js");

function crearPartidaSyncFake() {
  const conteos = {};
  let tiempoSeq = 0;
  return {
    siguienteTiempoSeq() {
      tiempoSeq += 1;
      return tiempoSeq;
    },
    obtenerConteo(player) {
      return conteos[player] || { modo_seq: 0, count_seq: 0, tiempo_seq: 0 };
    },
    guardarConteo(player, payload) {
      conteos[player] = { ...payload };
    },
    obtenerModoSeq() {
      return 1;
    },
    formatearTextoCountDesdeSegundos(secs) {
      const total = Math.max(0, Math.trunc(Number(secs) || 0));
      const min = String(Math.floor(total / 60)).padStart(2, "0");
      const sec = String(total % 60).padStart(2, "0");
      return `${min}:${sec}`;
    }
  };
}

function crearGestorFake(overrides = {}) {
  const eventos = [];
  const activaciones = [];
  const fines = [];
  const estadoJugadores = {
    1: { finished: true, inserts: 4 },
    2: { finished: false, inserts: -1 }
  };
  const gestor = crearGestorResurreccion({
    io: {
      emit(eventName, payload) {
        eventos.push({ eventName, payload });
      }
    },
    partidaSync: crearPartidaSyncFake(),
    validarJugador: (player) => (Number(player) === 1 || Number(player) === 2 ? Number(player) : null),
    getModoActual: () => overrides.modoActual || "palabras bonus",
    isFinDelJuego: () => false,
    marcarFinJugador: (player, terminado) => fines.push({ player, terminado }),
    estadoJugadores,
    construirPayloadCount: (payload) => payload,
    activarModo: (modo) => activaciones.push(modo),
    getTextoPlano: (player) => (overrides.textos && overrides.textos[player]) || "",
    reanudarTertuliaTrasResurreccion: overrides.reanudarTertuliaTrasResurreccion || (() => false)
  });
  return { activaciones, estadoJugadores, eventos, fines, gestor };
}

test("mostrarMenuFinJugador hides resurrection when the writer has no words", () => {
  const ctx = crearGestorFake({ textos: { 1: "" } });

  const payload = ctx.gestor.mostrarMenuFinJugador(1);

  assert.equal(payload.visible, false);
  assert.equal(payload.menu, "hidden");
  assert.equal(payload.max, 0);
  assert.deepEqual(ctx.eventos.map((evt) => evt.eventName), ["resucitar_menu"]);
  assert.equal(ctx.eventos[0].payload.visible, false);
});

test("mostrarMenuFinJugador exposes the available word limit", () => {
  const ctx = crearGestorFake({ textos: { 1: "uno dos tres" } });

  const payload = ctx.gestor.mostrarMenuFinJugador(1);

  assert.equal(payload.visible, true);
  assert.equal(payload.menu, "quantity");
  assert.equal(payload.palabras, 1);
  assert.equal(payload.max, 3);
  assert.equal(payload.segundos, 3);
});

test("resucitarJugador rejects resurrection without stored writer words", () => {
  const ctx = crearGestorFake({ textos: { 1: "" } });

  const ok = ctx.gestor.resucitarJugador({}, { player: 1, palabras: 1, secs: 99 });

  assert.equal(ok, false);
  assert.deepEqual(ctx.fines, []);
  assert.deepEqual(ctx.activaciones, []);
  assert.equal(ctx.eventos.some((evt) => evt.eventName === "resucitar_control"), false);
});

test("resucitarJugador during tertulia asks control to resume instead of reactivating tertulia", () => {
  const reanudaciones = [];
  const ctx = crearGestorFake({
    modoActual: "tertulia",
    textos: { 1: "uno dos tres" },
    reanudarTertuliaTrasResurreccion: (_socket, payload) => {
      reanudaciones.push(payload);
      return true;
    }
  });

  const ok = ctx.gestor.resucitarJugador({}, { player: 1, palabras: 2, secs: 99 });

  assert.equal(ok, true);
  assert.deepEqual(ctx.fines, [{ player: 1, terminado: false }]);
  assert.equal(ctx.estadoJugadores[1].finished, false);
  assert.equal(ctx.estadoJugadores[1].inserts, -1);
  assert.deepEqual(ctx.activaciones, []);
  assert.equal(reanudaciones.length, 1);
  assert.deepEqual(reanudaciones[0], { player: 1, secs: 6, tiempo_seq: 1 });
  assert.equal(ctx.eventos.some((evt) => evt.eventName === "resucitar_control"), true);
});
