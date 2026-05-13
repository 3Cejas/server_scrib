const test = require("node:test");
const assert = require("node:assert/strict");

const { crearGestorDesventajasActivas } = require("../active_disadvantages.js");

const validarJugador = (player) => {
  const id = Number(player);
  return id === 1 || id === 2 ? id : null;
};

test("active disadvantages expose remaining time and expire lazily", () => {
  let now = 1000;
  const gestor = crearGestorDesventajasActivas({
    validarJugador,
    getDuracionMs: () => 5000,
    now: () => now
  });

  const inicial = gestor.registrar(1, "bruma");
  assert.equal(inicial.player, 1);
  assert.equal(inicial.putada, "bruma");
  assert.equal(inicial.tiempo_restante_ms, 5000);

  now += 1750;
  assert.equal(gestor.snapshotJugador(1).tiempo_restante_ms, 3250);

  now += 4000;
  assert.equal(gestor.snapshotJugador(1), null);
  assert.deepEqual(gestor.snapshotActivas(), []);
});

test("active disadvantages pause and resume with the same remaining time", () => {
  let now = 2000;
  const gestor = crearGestorDesventajasActivas({
    validarJugador,
    getDuracionMs: () => 6000,
    now: () => now
  });

  gestor.registrar(2, "inverso");
  now += 2000;
  const pausadas = gestor.pausar();
  assert.equal(pausadas[0].player, 2);
  assert.equal(pausadas[0].pausada, true);
  assert.equal(pausadas[0].tiempo_restante_ms, 4000);

  now += 3000;
  assert.equal(gestor.snapshotJugador(2).tiempo_restante_ms, 4000);

  gestor.reanudar();
  now += 1500;
  const reanudada = gestor.snapshotJugador(2);
  assert.equal(reanudada.pausada, false);
  assert.equal(reanudada.tiempo_restante_ms, 2500);
});

test("active disadvantages replace the previous payload for the same player", () => {
  let now = 5000;
  const gestor = crearGestorDesventajasActivas({
    validarJugador,
    getDuracionMs: () => 3000,
    now: () => now
  });

  gestor.registrar(1, "tortuga");
  now += 1000;
  gestor.registrar(1, "rayo", { duracion_ms: 7000 });

  const snapshot = gestor.snapshotJugador(1);
  assert.equal(snapshot.putada, "rayo");
  assert.equal(snapshot.tiempo_restante_ms, 7000);
});
