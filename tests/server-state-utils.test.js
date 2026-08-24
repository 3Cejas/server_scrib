const test = require("node:test");
const assert = require("node:assert/strict");

const {
  actualizarEstadoResurreccionSnapshot,
  construirPayloadEstadoVotacionVentaja,
  crearEstadoResurreccionVacio,
  normalizarPayloadStatsLive,
  payloadEstadoResurreccion
} = require("../server_state_utils.js");

test("resurrection state snapshots merge updates and preserve the other player", () => {
  const initial = {
    1: crearEstadoResurreccionVacio(1),
    2: { ...crearEstadoResurreccionVacio(2), visible: true, menu: "main" }
  };
  const result = actualizarEstadoResurreccionSnapshot(initial, "1", {
    visible: true,
    menu: "quantity",
    palabras: 3,
    segundos: 15
  }, {
    now: 1234,
    validarPlayer: (value) => {
      const id = Number(value);
      return id === 1 || id === 2 ? id : null;
    }
  });

  assert.equal(result.value.player, 1);
  assert.equal(result.value.visible, true);
  assert.equal(result.value.menu, "quantity");
  assert.equal(result.value.palabras, 3);
  assert.equal(result.value.segundos, 15);
  assert.equal(result.value.ts, 1234);
  assert.equal(result.state[2].visible, true);
  assert.equal(result.state[2].menu, "main");
});

test("payloadEstadoResurreccion always returns both players", () => {
  const payload = payloadEstadoResurreccion({
    1: { ...crearEstadoResurreccionVacio(1), visible: true }
  });
  assert.equal(payload[1].visible, true);
  assert.equal(payload[2].player, 2);
  assert.equal(payload[2].visible, false);
});

test("voting payload computes remaining time and includes ya_voto when provided", () => {
  const payload = construirPayloadEstadoVotacionVentaja({
    activa: true,
    equipo: "j1",
    opciones: ["🐢", "⚡"],
    votos: { "🐢": 2, "⚡": 1 },
    duracion_ms: 10000,
    termina_en_ts: 25000,
    ya_voto: true,
    now: 20000
  });

  assert.deepEqual(payload, {
    activa: true,
    equipo: "j1",
    opciones: ["🐢", "⚡"],
    votos: { "🐢": 2, "⚡": 1 },
    duracion_ms: 10000,
    tiempo_restante_ms: 5000,
    termina_en_ts: 25000,
    ya_voto: true
  });
});

test("voting payload clamps remaining time to zero when inactive or expired", () => {
  const expired = construirPayloadEstadoVotacionVentaja({
    activa: true,
    termina_en_ts: 1000,
    now: 5000
  });
  const inactive = construirPayloadEstadoVotacionVentaja({
    activa: false,
    termina_en_ts: 10000,
    now: 5000
  });
  assert.equal(expired.tiempo_restante_ms, 0);
  assert.equal(inactive.tiempo_restante_ms, 0);
});

test("stats payload normalizes text lengths, falls back heatmap from top keys and clamps negatives", () => {
  const payload = normalizarPayloadStatsLive({
    modo_actual: "palabras bonus con descripcion demasiado larga para stats",
    players: {
      1: {
        nombre: "ESCRITORA AZUL CON NOMBRE DEMASIADO LARGO PARA PANEL",
        palabrasTotal: -5,
        palabrasUnicas: "7",
        pulsacionesTotal: "12",
        topTeclas: [{ code: "KeyA", count: 4 }, { code: "KeyB", count: -1 }],
        heatmap: {},
        vida: { actual: "3", min: "x", max: 12, media: undefined },
        letrasBenditas: ["ABCDEFGHIJK", "Z"],
        palabrasMalditas: ["una palabra maldita larguisima que deberia recortarse"],
        intentosPalabraProhibida: -8
      },
      2: {
        valorInspiracion: "2.75",
        palabrasBenditas: ["luz", "mar", "sol"]
      }
    }
  }, {
    modoActual: "fallback",
    now: 777
  });

  assert.equal(payload.ts, 777);
  assert.equal(payload.modo_actual, "palabras bonus con descripcion d");
  assert.equal(payload.players[1].nombre, "ESCRITORA AZUL CON NOMBRE DE");
  assert.equal(payload.players[1].palabrasTotal, 0);
  assert.equal(payload.players[1].palabrasUnicas, 7);
  assert.equal(payload.players[1].pulsacionesTotal, 12);
  assert.deepEqual(payload.players[1].heatmap, { KeyA: 4, KeyB: 0 });
  assert.equal(payload.players[1].vida.actual, 3);
  assert.equal(payload.players[1].vida.min, null);
  assert.equal(payload.players[1].vida.max, 12);
  assert.equal(payload.players[1].vida.media, null);
  assert.deepEqual(payload.players[1].letrasBenditas, ["ABCDEFGH", "Z"]);
  assert.deepEqual(payload.players[1].palabrasMalditas, ["una palabra maldita largui"]);
  assert.equal(payload.players[1].intentosPalabraProhibida, 0);
  assert.equal(payload.players[2].nombre, "ESCRITXR 2");
  assert.equal(payload.players[2].valorInspiracion, 2.75);
});

test("stats normalization clamps weighted inspiration and omits it for legacy payloads", () => {
  const payload = normalizarPayloadStatsLive({
    players: {
      1: { valorInspiracion: 99, palabrasBenditas: ["luz", "mar"] },
      2: { palabrasBenditas: ["luz"] }
    }
  });

  assert.equal(payload.players[1].valorInspiracion, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.players[2], "valorInspiracion"), false);
});
