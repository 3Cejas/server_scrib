const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REGALO_BANDERA_MUSAS_OBJETIVO,
  REGALO_BANDERA_MUSAS_SECS,
  crearGestorMusasAuxiliares
} = require("../musas_auxiliares.js");

function crearIoFake() {
  const events = [];
  return {
    events,
    emit(event, payload) {
      events.push({ event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        }
      };
    }
  };
}

test("registrarCorazon mantiene los corazones visuales sin regalar tiempo fuera de partida", () => {
  const io = crearIoFake();
  const premios = [];
  const gestor = crearGestorMusasAuxiliares({
    io,
    getPartidaActiva: () => false,
    contarMusas: () => 2,
    aplicarRegaloBanderaTiempo: (payload) => {
      premios.push(payload);
      return payload;
    }
  });

  gestor.actualizarBanderas({ activa: true });
  for (let i = 0; i < REGALO_BANDERA_MUSAS_OBJETIVO + 2; i += 1) {
    gestor.registrarCorazon({ equipo: 1, respetarCooldown: false, now: 1000 + i });
  }

  assert.equal(premios.length, 0);
  assert.equal(gestor.payloadCorazones()[1].count, REGALO_BANDERA_MUSAS_OBJETIVO + 2);
  assert.equal(gestor.payloadRegaloBandera().equipos[1].visible, false);
  assert.equal(gestor.payloadRegaloBandera().equipos[1].progreso, 0);
  assert.ok(io.events.some((entry) => entry.event === "musa_corazon" && entry.room === "j1"));
});

test("registrarCorazon concede el regalo de bandera al llegar al objetivo durante una partida", () => {
  const io = crearIoFake();
  const premios = [];
  const gestor = crearGestorMusasAuxiliares({
    io,
    getPartidaActiva: () => true,
    contarMusas: (equipo) => (equipo === 1 ? 3 : 0),
    aplicarRegaloBanderaTiempo: (payload) => {
      const salida = { ...payload, tiempo_seq: premios.length + 1 };
      premios.push(salida);
      return salida;
    }
  });

  gestor.actualizarBanderas({ activa: true });
  for (let i = 0; i < REGALO_BANDERA_MUSAS_OBJETIVO - 1; i += 1) {
    const resultado = gestor.registrarCorazon({ equipo: 1, respetarCooldown: false, now: 2000 + i });
    assert.equal(resultado.regalo_bandera.premio, null);
  }

  const antesPremio = gestor.payloadRegaloBandera().equipos[1];
  assert.equal(antesPremio.visible, true);
  assert.equal(antesPremio.musas, 3);
  assert.equal(antesPremio.progreso, REGALO_BANDERA_MUSAS_OBJETIVO - 1);

  const resultadoPremio = gestor.registrarCorazon({
    equipo: 1,
    respetarCooldown: false,
    now: 3000
  });

  assert.equal(premios.length, 1);
  assert.equal(premios[0].player, 1);
  assert.equal(premios[0].secs, REGALO_BANDERA_MUSAS_SECS);
  assert.equal(premios[0].origen, "musa_bandera");
  assert.equal(resultadoPremio.regalo_bandera.premio.tiempo_seq, 1);

  const despuesPremio = gestor.payloadRegaloBandera().equipos[1];
  assert.equal(despuesPremio.progreso, 0);
  assert.equal(despuesPremio.ultimo_regalo_ts, 3000);
  assert.ok(io.events.some((entry) => entry.event === "musa_regalo_bandera_estado"));
});

test("guardarRegalo soporta regalos personalizados por musa y fallback de equipo", () => {
  const gestor = crearGestorMusasAuxiliares({ io: crearIoFake() });

  const generico = gestor.guardarRegalo({
    player: 1,
    data: "data:application/pdf;base64,generic",
    filename: "equipo.pdf"
  });
  const personalizado = gestor.guardarRegalo({
    player: 1,
    client_id: "musa_1",
    musa_nombre: "LUNA",
    data: "data:application/pdf;base64,luna",
    filename: "luna.pdf"
  });

  assert.equal(generico.client_id, undefined);
  assert.equal(personalizado.client_id, "musa_1");
  assert.equal(personalizado.personalizado, true);
  assert.equal(gestor.obtenerRegalo(1, "musa_1").filename, "luna.pdf");
  assert.equal(gestor.obtenerRegalo(1, "otra").filename, "equipo.pdf");
});

test("payloadResumenPdf marca palabras introducidas y calcula stats por musa", () => {
  const gestor = crearGestorMusasAuxiliares({ io: crearIoFake() });

  gestor.registrarInspiracionEnviada({
    player: 1,
    target_player: 1,
    palabra: "cometa",
    musa: "LUNA",
    client_id: "luna",
    modo: "palabras bonus",
    ts: 10
  });
  gestor.registrarInspiracionEnviada({
    player: 1,
    target_player: 2,
    palabra: "sombra",
    musa: "LUNA",
    client_id: "luna",
    modo: "palabras prohibidas",
    ts: 20
  });
  gestor.registrarInspiracionEnviada({
    player: 1,
    target_player: 1,
    palabra: "cometa",
    musa: "SOL",
    client_id: "sol",
    modo: "palabras bonus",
    ts: 30
  });

  assert.equal(gestor.registrarInspiracionIntroducida({
    player: 1,
    target_player: 1,
    palabra: "COMETA",
    modo: "palabras bonus",
    client_ids: ["luna", "sol"],
    musas: ["LUNA", "SOL"],
    tiempo: 20,
    superbonus: true,
    introducida_en: 40
  }), 2);
  assert.equal(gestor.registrarInspiracionIntroducida({
    player: 1,
    target_player: 2,
    palabra: "sombra",
    modo: "palabras prohibidas",
    client_id: "luna",
    musa_nombre: "LUNA",
    tiempo: 10,
    introducida_en: 50
  }), 1);

  const resumen = gestor.payloadResumenPdf();
  const luna = resumen.equipos[1].musas.find((musa) => musa.client_id === "luna");
  const sol = resumen.equipos[1].musas.find((musa) => musa.client_id === "sol");

  assert.equal(luna.stats.enviadas, 2);
  assert.equal(luna.stats.introducidas, 2);
  assert.equal(luna.stats.efectividad_pct, 100);
  assert.equal(luna.stats.bonus, 1);
  assert.equal(luna.stats.malditas, 1);
  assert.equal(luna.stats.superbonus, 1);
  assert.equal(luna.stats.impacto_positivo, 20);
  assert.equal(luna.stats.impacto_negativo, 10);
  assert.equal(luna.stats.impacto_neto, 10);
  assert.equal(luna.palabras.find((entrada) => entrada.palabra === "sombra").introducida_por, 2);

  assert.equal(sol.stats.enviadas, 1);
  assert.equal(sol.stats.introducidas, 1);
  assert.equal(sol.palabras[0].superbonus, true);
});
