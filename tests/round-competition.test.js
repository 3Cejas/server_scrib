const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DESVENTAJAS_RONDA,
  RACHA_INACTIVIDAD_MS,
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

test("una ronda competitiva empieza con batalla y sin desventaja permanente", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });

  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  const batalla = gestor.snapshot();
  gestor.iniciarRonda("tertulia", { modo_seq: 2 });
  const tertulia = gestor.snapshot();

  assert.equal(batalla.fase, "batalla");
  assert.equal(batalla.batalla_activa, true);
  assert.equal(batalla.desventaja_player, null);
  assert.equal(batalla.desventaja, "");
  assert.equal(tertulia.fase, "inactiva");
  assert.equal(tertulia.activa, false);
  assert.equal(tertulia.modo_publico, "TERTULIA");
});

test("al cerrar el 80 por ciento se congela el marcador y la votacion aplica la desventaja al perdedor", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({
    io,
    random: () => 0.1,
    getAtributos: () => ({ 1: { destreza: 0 }, 2: { destreza: 10 } })
  });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  gestor.registrarPuntos(1, 2, { tipo: "test" });
  const resultado = gestor.cerrarBatalla({
    duracion_votacion_ms: 30000,
    tiempo_restante_segundos: 60
  });
  gestor.registrarPuntos(2, 99, { tipo: "fuera_de_batalla" });
  const aplicada = gestor.registrarDesventajaSeleccionada(2, "⚡", { duracion_ms: 30000 });
  const estado = gestor.snapshot();

  assert.equal(resultado.ganador, 1);
  assert.equal(resultado.perdedor, 2);
  assert.equal(resultado.empate, false);
  assert.equal(estado.marcador[2], 0);
  assert.equal(estado.fase, "desventaja");
  assert.equal(estado.batalla_activa, false);
  assert.equal(estado.desventaja_player, 2);
  assert.equal(estado.desventaja, "⚡");
  assert.equal(estado.desventaja_duracion_ms, 30000);
  assert.equal(aplicada.intensidad, 0.6);
  assert.ok(io.eventos.some((evento) => evento.eventName === "competicion_batalla_cerrada"));
  assert.ok(io.eventos.some((evento) => evento.eventName === "competicion_desventaja_elegida"));
});

test("los empates se resuelven de forma aleatoria al principio y alternada despues", () => {
  const gestor = crearCompeticionRondas({ io: crearIo(), random: () => 0.1 });

  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  const primera = gestor.cerrarBatalla();
  gestor.iniciarRonda("letra prohibida", { modo_seq: 2 });
  const segunda = gestor.cerrarBatalla();

  assert.equal(primera.empate, true);
  assert.equal(segunda.empate, true);
  assert.notEqual(primera.ganador, segunda.ganador);
});

test("la escritura da impulsos de inspiracion, la fuerza los aumenta y borrar resta menos", () => {
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

test("cada caracter borrado resta 0.05 y nunca puede hacer avanzar la barra del equipo", () => {
  const io = crearIo();
  const gestor = crearCompeticionRondas({ io, random: () => 0.1 });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  gestor.registrarCambioTexto(1, "", "abcdefghij");

  const totales = [];
  let texto = "abcdefghij";
  while (texto.length > 5) {
    const anterior = texto;
    texto = texto.slice(0, -1);
    gestor.registrarCambioTexto(1, anterior, texto);
    totales.push(gestor.snapshot().marcador[1]);
  }

  assert.deepEqual(totales, [0.95, 0.9, 0.85, 0.8, 0.75]);
  const borrados = io.eventos.filter((evento) => evento.eventName === "competicion_ronda_punto" && evento.payload.tipo === "borrado");
  assert.equal(borrados.length, 5);
  assert.ok(borrados.every((evento) => evento.payload.delta === -0.05));
});

test("los criterios publicos explican el ritmo sin llamar mini inspiracion a los puntos", () => {
  const gestor = crearCompeticionRondas({ io: crearIo(), random: () => 0.1 });
  gestor.iniciarRonda("letra prohibida", { modo_seq: 1 });
  assert.equal(gestor.snapshot().criterio, "RITMO DE ESCRITURA - FALTAS DE LETRA MALDITA");
  gestor.iniciarRonda("palabras prohibidas", { modo_seq: 2 });
  assert.equal(gestor.snapshot().criterio, "RITMO DE ESCRITURA - PALABRAS MALDITAS");
  assert.doesNotMatch(gestor.snapshot().criterio, /mini insp/i);
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

test("una racha desaparece tras unos segundos sin escribir", () => {
  const io = crearIo();
  const timers = [];
  const gestor = crearCompeticionRondas({
    io,
    random: () => 0.1,
    setTimer(callback, delay) {
      const timer = { callback, delay, cancelado: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cancelado = true;
    }
  });
  gestor.iniciarRonda("palabras bonus", { modo_seq: 1 });
  gestor.registrarPuntos(1, 1, { tipo: "palabra", palabra: "uno" });
  gestor.registrarPuntos(1, 1, { tipo: "palabra", palabra: "dos" });

  assert.equal(gestor.snapshot().rachas[1], 2);
  const vigente = timers.filter((timer) => !timer.cancelado).at(-1);
  assert.equal(vigente.delay, RACHA_INACTIVIDAD_MS);
  vigente.callback();

  assert.equal(gestor.snapshot().rachas[1], 0);
  assert.equal(io.eventos.at(-1).eventName, "competicion_ronda_estado");
  assert.equal(io.eventos.at(-1).payload.rachas[1], 0);
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

test("una escritora reconectada recupera la fase, el marcador y la desventaja votada", () => {
  const gestor = crearCompeticionRondas({
    io: crearIo(),
    random: () => 0.1,
    getAtributos: () => ({ 1: { destreza: 10 }, 2: { destreza: 0 } })
  });
  gestor.iniciarRonda("letra bendita", { modo_seq: 1 });
  gestor.registrarPuntos(1, 3, { tipo: "test" });
  gestor.cerrarBatalla({ duracion_votacion_ms: 1000 });
  gestor.registrarDesventajaSeleccionada(2, "🌪️", { duracion_ms: 9000 });

  const socket = crearIo();
  gestor.emitir(socket);

  const estado = socket.eventos.find((evento) => evento.eventName === "competicion_ronda_estado");
  assert.equal(estado.payload.modo_publico, "LETRA BENDITA");
  assert.equal(estado.payload.fase, "desventaja");
  assert.equal(estado.payload.marcador[1], 3);
  assert.equal(estado.payload.desventaja_player, 2);
  assert.equal(estado.payload.desventaja, "🌪️");
  assert.equal(estado.payload.intensidad, 1);
});
