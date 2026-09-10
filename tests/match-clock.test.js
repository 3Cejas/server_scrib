const test = require("node:test");
const assert = require("node:assert/strict");
const { crearRelojPartida } = require("../match_clock.js");

test("el reloj global conserva autoridad al pausar y reanudar", () => {
  let ahora = 1000;
  let tickProgramado = null;
  let finProgramado = null;
  let finishes = 0;
  const eventos = [];
  const reloj = crearRelojPartida({
    io: { emit: (eventName, payload) => eventos.push({ eventName, payload }) },
    now: () => ahora,
    setIntervalFn: (fn) => { tickProgramado = fn; return 1; },
    clearIntervalFn: () => { tickProgramado = null; },
    setTimeoutFn: (fn) => { finProgramado = fn; return 2; },
    clearTimeoutFn: () => { finProgramado = null; },
    onFinish: () => { finishes += 1; }
  });

  reloj.iniciar(10);
  ahora += 3200;
  tickProgramado();
  assert.equal(reloj.snapshot().tiempo_restante_segundos, 7);

  reloj.pausar();
  assert.equal(finProgramado, null);
  ahora += 5000;
  assert.equal(reloj.snapshot().tiempo_restante_segundos, 7);

  reloj.reanudar();
  ahora += 7000;
  tickProgramado();
  assert.equal(reloj.snapshot().tiempo_restante_segundos, 0);
  assert.equal(finishes, 1);
  reloj.tick();
  assert.equal(finishes, 1);
  assert.ok(eventos.every((evento) => evento.eventName === "reloj_partida_estado"));
});

test("el reloj finaliza exactamente por timeout aunque el intervalo no llegue a ejecutar otro tick", () => {
  let ahora = 5000;
  let finProgramado = null;
  let esperaProgramada = null;
  let finishes = 0;
  const eventos = [];
  const reloj = crearRelojPartida({
    io: { emit: (eventName, payload) => eventos.push({ eventName, payload }) },
    now: () => ahora,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (fn, espera) => {
      finProgramado = fn;
      esperaProgramada = espera;
      return 2;
    },
    clearTimeoutFn: () => { finProgramado = null; },
    onFinish: () => { finishes += 1; }
  });

  reloj.iniciar(3);
  assert.equal(esperaProgramada, 3000);
  assert.equal(typeof finProgramado, "function");
  ahora = 8000;
  finProgramado();

  const estado = reloj.snapshot();
  assert.equal(estado.activo, false);
  assert.equal(estado.tiempo_restante_segundos, 0);
  assert.equal(finishes, 1);
  assert.equal(eventos.at(-1).payload.tiempo_restante_segundos, 0);
  reloj.tick();
  assert.equal(finishes, 1);
});
