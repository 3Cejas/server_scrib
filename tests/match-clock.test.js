const test = require("node:test");
const assert = require("node:assert/strict");
const { crearRelojPartida } = require("../match_clock.js");

test("el reloj global conserva autoridad al pausar y reanudar", () => {
  let ahora = 1000;
  let tickProgramado = null;
  let finishes = 0;
  const eventos = [];
  const reloj = crearRelojPartida({
    io: { emit: (eventName, payload) => eventos.push({ eventName, payload }) },
    now: () => ahora,
    setIntervalFn: (fn) => { tickProgramado = fn; return 1; },
    clearIntervalFn: () => { tickProgramado = null; },
    onFinish: () => { finishes += 1; }
  });

  reloj.iniciar(10);
  ahora += 3200;
  tickProgramado();
  assert.equal(reloj.snapshot().tiempo_restante_segundos, 7);

  reloj.pausar();
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
