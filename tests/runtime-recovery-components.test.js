const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorDesventajasActivas } = require("../active_disadvantages.js");
const { crearRuntimeModos } = require("../mode_runtime.js");
const Musas = require("../musas.js");
const { crearGestorSincronizacionPartida } = require("../partida_sync.js");
const { crearCompeticionRondas } = require("../round_competition.js");
const { crearGestorVistaEspectador } = require("../spectator_state.js");
const { crearGestorVotacionVentaja } = require("../ventaja_voting.js");

const crearIo = () => ({ emit() {}, to() { return { emit() {} }; } });
const validarJugador = (valor) => {
  const id = Number(valor);
  return id === 1 || id === 2 ? id : null;
};

test("match sync restores revisions and last counters", () => {
  const original = crearGestorSincronizacionPartida({ validarJugador });
  original.siguienteModoSeq();
  original.siguienteTiempoSeq(1);
  original.guardarConteo(1, { modo_seq: 1, tiempo_seq: 1, count_seq: 7, count_seconds: 42, count_text: "00:42" });
  const restored = crearGestorSincronizacionPartida({ validarJugador });
  restored.restaurar(original.snapshot());
  assert.equal(restored.obtenerModoSeq(), 1);
  assert.equal(restored.obtenerTiempoSeq(1), 1);
  assert.equal(restored.obtenerConteo(1).count_seq, 7);
  assert.equal(restored.obtenerConteo(1).count_text, "00:42");
});

test("mode runtime restores current letter, remaining pools and elapsed level time", () => {
  const crear = () => crearRuntimeModos({
    io: crearIo(),
    partidaSync: crearGestorSincronizacionPartida({ validarJugador }),
    validarJugador
  });
  const original = crear();
  original.prepararParametrosInicio({
    DURACION_PARTIDA: 300,
    TIEMPO_CAMBIO_PALABRAS: 20000,
    TIEMPO_CAMBIO_LETRA: 15000,
    TIEMPO_MODIFICADOR: 9000,
    TIEMPO_VOTACION: 5000,
    TIEMPO_BORROSO: 1000,
    LISTA_MODOS: ["letra bendita", "letra prohibida"]
  });
  original.estadoMotorModos.modoActual = "letra bendita";
  original.estadoMotorModos.letraBendita = "R";
  original.estadoMotorModos.letrasBenditasPendientes = ["S", "T"];
  original.estadoMotorModos.segundosTranscurridos = 31;
  original.estadoCicloPartida.modosPendientes = ["letra prohibida"];
  const restored = crear();
  restored.restaurarEstado(original.snapshotEstado());
  assert.equal(restored.estadoMotorModos.modoActual, "letra bendita");
  assert.equal(restored.estadoMotorModos.letraBendita, "R");
  assert.deepEqual(restored.estadoMotorModos.letrasBenditasPendientes, ["S", "T"]);
  assert.equal(restored.estadoMotorModos.segundosTranscurridos, 31);
  assert.deepEqual(restored.estadoCicloPartida.modosPendientes, ["letra prohibida"]);
});

test("Muse queues restore without arming timers", () => {
  const original = new Musas(crearIo(), 30000);
  original.addMusa(1, { palabra: "cometa", musa: "Luna", client_id: "luna" });
  original.players[1].insertedCount = 3;
  const restored = new Musas(crearIo(), 30000);
  restored.restaurarEstado(original.snapshotEstado(), { forzarPausa: true });
  assert.equal(restored.players[1].queue.length, 1);
  assert.equal(restored.players[1].queue[0].palabra, "cometa");
  assert.equal(restored.players[1].insertedCount, 3);
  assert.equal(restored.players[1].pendingTimer, null);
  assert.equal(restored.players[1].emitTimer, null);
});

test("vote, disadvantage, competition and spectator restore frozen", () => {
  let scheduled = null;
  const voteFactory = () => crearGestorVotacionVentaja({
    io: crearIo(),
    construirPayloadBase: (payload) => payload,
    obtenerIdJugadorValido: validarJugador,
    getDuracionMs: () => 5000,
    scheduleTimer: (callback, ms) => { scheduled = { callback, ms }; },
    cancelTimer: () => { scheduled = null; },
    escogerGanador: () => "A"
  });
  const vote = voteFactory();
  vote.abrirForzada({ team: 1, opciones: ["A", "B"], duracion_ms: 5000 });
  const voteRestored = voteFactory();
  const restoredVote = voteRestored.restaurar(vote.snapshot(), { forzarPausa: true });
  assert.equal(restoredVote.activa, true);
  assert.equal(restoredVote.pausada, true);
  assert.equal(scheduled, null);

  let now = 1000;
  const disadvantage = crearGestorDesventajasActivas({ validarJugador, now: () => now });
  disadvantage.registrar(2, "⚡", { duracion_ms: 8000 });
  now += 2000;
  const disadvantageRestored = crearGestorDesventajasActivas({ validarJugador, now: () => now });
  const restoredDisadvantages = disadvantageRestored.restaurar(disadvantage.snapshotActivas(), { forzarPausa: true });
  assert.equal(restoredDisadvantages[0].pausada, true);
  assert.equal(restoredDisadvantages[0].tiempo_restante_ms, 6000);

  const competition = crearCompeticionRondas({ io: crearIo() });
  competition.iniciarRonda("letra bendita", { modo_seq: 4 });
  competition.registrarPuntos(1, 7, { actualizar_racha: false });
  const competitionRestored = crearCompeticionRondas({ io: crearIo() });
  const restoredCompetition = competitionRestored.restaurar(competition.snapshot());
  assert.equal(restoredCompetition.modo_seq, 4);
  assert.equal(restoredCompetition.marcador[1], 7);

  const spectator = crearGestorVistaEspectador({ io: crearIo() });
  spectator.cambiarModo("stats");
  spectator.navegarStats(3);
  spectator.ajustarEscala({ valor: 1.2 });
  const spectatorRestored = crearGestorVistaEspectador({ io: crearIo() });
  const restoredSpectator = spectatorRestored.restaurar(spectator.payload());
  assert.equal(restoredSpectator.modo, "stats");
  assert.equal(restoredSpectator.stats_slide_step, 3);
  assert.equal(restoredSpectator.escala_ui, 1.2);
});
