const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DESVENTAJAS_RONDA,
  crearCompeticionRondas
} = require("../round_competition.js");

function crearIo() {
  const eventos = [];
  return {
    eventos,
    emit(eventName, payload) {
      eventos.push({ eventName, payload });
    }
  };
}

test("la primera desventaja es aleatoria y los siguientes portadores se alternan", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });

  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  const primera = gestor.snapshot();
  gestor.iniciarRonda("tertulia", { modo_seq: 2 });
  gestor.iniciarRonda("letra prohibida", { modo_seq: 3 });
  const segunda = gestor.snapshot();

  assert.equal(primera.portador_inicial, 1);
  assert.equal(segunda.portador_inicial, 2);
  assert.equal(segunda.modo_publico, "LETRA MALDITA");
  assert.equal(DESVENTAJAS_RONDA.includes(primera.desventaja), true);
  assert.equal(DESVENTAJAS_RONDA.includes(segunda.desventaja), true);
  assert.notEqual(primera.desventaja, segunda.desventaja);
});

test("el empate conserva portador y un cambio de lider transfiere la desventaja", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });

  assert.equal(gestor.snapshot().desventaja_player, 1);
  gestor.registrarPuntos(1, 2, { tipo: "test" });
  assert.equal(gestor.snapshot().lider, 1);
  assert.equal(gestor.snapshot().desventaja_player, 2);

  gestor.registrarPuntos(2, 2, { tipo: "test" });
  assert.equal(gestor.snapshot().empate, true);
  assert.equal(gestor.snapshot().desventaja_player, 2);

  gestor.registrarPuntos(2, 1, { tipo: "test" });
  assert.equal(gestor.snapshot().lider, 2);
  assert.equal(gestor.snapshot().desventaja_player, 1);
  assert.ok(io.eventos.some((evento) => evento.eventName === "competicion_cambio_lider"));
});

test("la escritura da mini inspiracion, la fuerza la aumenta y borrar resta menos", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({
    io,
    random: () => 0.1,
    getAtributos: () => ({ 1: { fuerza: 10 }, 2: { fuerza: 0 } })
  });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });

  gestor.registrarCambioTexto(1, "", "abcd");
  gestor.registrarCambioTexto(2, "", "abcd");
  assert.equal(gestor.snapshot().marcador[1], 0.6);
  assert.equal(gestor.snapshot().marcador[2], 0.4);

  gestor.registrarCambioTexto(1, "abcd", "abc");
  assert.equal(gestor.snapshot().marcador[1], 0.55);
});

test("las musas pesan mas, los descartes escalan su valor y las faltas penalizan", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  gestor.registrarInspiracion(1, { valor_inspiracion: 0.5, palabra: "luz", musa_nombre: "ANA" });
  assert.equal(gestor.snapshot().marcador[1], 2.5);

  gestor.iniciarRonda("letra prohibida", { modo_seq: 2 });
  gestor.registrarInfraccion(1, { tipo: "letra", valor: "a" });
  assert.equal(gestor.snapshot().marcador[1], -1);
  gestor.registrarInspiracion(1, { valor_inspiracion: 1, palabra: "alarma" });
  assert.equal(gestor.snapshot().marcador[1], -6);
});

test("las rachas son cosmeticas y no multiplican puntos", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });
  gestor.iniciarRonda("palabras bonus", { modo_seq: 1 });
  gestor.registrarPuntos(1, 1, { tipo: "palabra", palabra: "uno" });
  gestor.registrarPuntos(1, 1, { tipo: "palabra", palabra: "dos" });
  gestor.registrarPuntos(1, 1, { tipo: "palabra", palabra: "tres" });
  const estado = gestor.snapshot();
  assert.equal(estado.marcador[1], 3);
  assert.equal(estado.rachas[1], 3);
});

test("las palabras se animan al completarse y las letras intermedias solo mueven el marcador", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });

  gestor.registrarCambioTexto(1, "", "luz");
  const letra = io.eventos.filter((evento) => evento.eventName === "competicion_ronda_punto").at(-1);
  assert.equal(letra.payload.animar, false);
  assert.equal(gestor.snapshot().rachas[1], 0);

  gestor.registrarCambioTexto(1, "luz", "luz ");
  const palabra = io.eventos.filter((evento) => evento.eventName === "competicion_ronda_punto").at(-1);
  assert.equal(palabra.payload.palabra, "luz");
  assert.equal(palabra.payload.animar, true);
  assert.equal(gestor.snapshot().rachas[1], 1);
});

test("una escritora reconectada recupera marcador y desventaja con su intensidad", () => {
  const gestor = crearCompeticionRondas({
    io: crearIo(),
    random: () => 0.1,
    getAtributos: () => ({ 1: { destreza: 10 }, 2: { destreza: 0 } })
  });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });

  const socket = crearIo();
  gestor.emitir(socket);

  const estado = socket.eventos.find((evento) => evento.eventName === "competicion_ronda_estado");
  const desventaja = socket.eventos.find((evento) => evento.eventName === "desventaja_activa_estado");
  assert.equal(estado.payload.modo_publico, "LETRA BENDITA");
  assert.equal(desventaja.payload.player, 1);
  assert.equal(desventaja.payload.intensidad, 0.6);
  assert.equal(desventaja.payload.motivo, "reconexion");
});
