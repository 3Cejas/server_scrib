const test = require("node:test");
const assert = require("node:assert/strict");

const { crearRegistroRoles, ROLE_ROOMS } = require("../role_connections.js");

function crearSocket(id) {
  const salas = new Set();
  return {
    id,
    salas,
    join: (sala) => salas.add(sala),
    leave: (sala) => salas.delete(sala)
  };
}

test("role registry tracks writers, control, spectators, jury, dramaturgy and actors", () => {
  const roles = crearRegistroRoles({ now: () => 1234 });
  const control = crearSocket("control");
  const spectator = crearSocket("spectator");
  const jury = crearSocket("jury");
  const writer1 = crearSocket("writer1");
  const actor = crearSocket("actor");

  roles.registrarControl(control);
  roles.registrarEspectador(spectator);
  roles.registrarJurado(jury);
  const writerResult = roles.registrarEscritor(writer1, 1);
  const actorResult = roles.registrarActor(actor, { player: 2 });

  assert.equal(writerResult.ok, true);
  assert.equal(actorResult.ok, true);
  assert.equal(writer1.salas.has("j1"), true);
  assert.equal(writer1.salas.has(ROLE_ROOMS.writer(1)), true);
  assert.equal(control.salas.has(ROLE_ROOMS.CONTROL), true);
  assert.equal(spectator.salas.has("j1"), true);
  assert.equal(spectator.salas.has("j2"), true);
  assert.equal(spectator.salas.has(ROLE_ROOMS.SPECTATOR), true);
  assert.equal(jury.salas.has("j1"), true);
  assert.equal(jury.salas.has("j2"), true);
  assert.equal(jury.salas.has(ROLE_ROOMS.JURY), true);
  assert.equal(actor.salas.has("j2"), true);
  assert.equal(actor.salas.has(ROLE_ROOMS.actor(2)), true);

  assert.deepEqual(roles.estadoEscritores(), {
    ts: 1234,
    players: {
      j1: true,
      j2: false,
      total: 1
    },
    connections: {
      control: { count: 1, connected: true },
      spectator: { count: 1, connected: true },
      jury: { count: 1, connected: true },
      dramaturgia: { count: 0, connected: false },
      writers: {
        1: { count: 1, connected: true },
        2: { count: 0, connected: false }
      },
      musas: {
        1: { count: 0, connected: false },
        2: { count: 0, connected: false }
      },
      actors: {
        1: { count: 0, connected: false },
        2: { count: 1, connected: true }
      }
    }
  });
});

test("role registry keeps dramaturgy registration idempotent and cleans it on disconnect", () => {
  const roles = crearRegistroRoles();
  const dramaturgy = crearSocket("dramaturgy");

  roles.registrarDramaturgia(dramaturgy);
  roles.registrarDramaturgia(dramaturgy);

  assert.equal(ROLE_ROOMS.DRAMATURGY, "role_dramaturgia");
  assert.equal(dramaturgy.dramaturgia, true);
  assert.equal(dramaturgy.salas.has("j1"), true);
  assert.equal(dramaturgy.salas.has("j2"), true);
  assert.equal(dramaturgy.salas.has(ROLE_ROOMS.DRAMATURGY), true);
  assert.deepEqual(
    roles.payloadConexiones().dramaturgia,
    { count: 1, connected: true }
  );

  roles.desregistrarSocket(dramaturgy);
  assert.deepEqual(
    roles.payloadConexiones().dramaturgia,
    { count: 0, connected: false }
  );
});

test("screen monitors join live rooms without becoming real roles or changing counters", () => {
  const roles = crearRegistroRoles();
  const writerMonitor = crearSocket("monitor-writer");
  const museMonitor = crearSocket("monitor-muse");
  const controlMonitor = crearSocket("monitor-control");

  const writer = roles.registrarMonitorPantalla(writerMonitor, { role: "writer", player: 1 });
  const muse = roles.registrarMonitorPantalla(museMonitor, { rol: "musa", equipo: 2 });
  const control = roles.registrarMonitorPantalla(controlMonitor, { rol: "control" });

  assert.deepEqual(writer, {
    ok: true,
    rol: "escritor",
    player: 1,
    solo_lectura: true,
    salas: ["j1", ROLE_ROOMS.writer(1)]
  });
  assert.equal(writerMonitor.salas.has("j1"), true);
  assert.equal(writerMonitor.salas.has(ROLE_ROOMS.writer(1)), true);
  assert.equal(muse.ok, true);
  assert.equal(museMonitor.salas.has("j2"), true);
  assert.equal(museMonitor.salas.has("musa_j2"), true);
  assert.equal(control.ok, true);
  assert.equal(controlMonitor.salas.has("j1"), true);
  assert.equal(controlMonitor.salas.has("j2"), true);
  assert.equal(controlMonitor.salas.has(ROLE_ROOMS.CONTROL), true);

  assert.deepEqual(roles.payloadConexiones(), {
    control: { count: 0, connected: false },
    spectator: { count: 0, connected: false },
    jury: { count: 0, connected: false },
    dramaturgia: { count: 0, connected: false },
    writers: {
      1: { count: 0, connected: false },
      2: { count: 0, connected: false }
    },
    musas: {
      1: { count: 0, connected: false },
      2: { count: 0, connected: false }
    },
    actors: {
      1: { count: 0, connected: false },
      2: { count: 0, connected: false }
    }
  });
});

test("screen monitor registration validates team roles and moves rooms cleanly", () => {
  const roles = crearRegistroRoles();
  const monitor = crearSocket("monitor");

  assert.equal(roles.registrarMonitorPantalla(monitor, { rol: "actor" }).ok, false);
  roles.registrarMonitorPantalla(monitor, { rol: "musa", player: 1 });
  roles.registrarMonitorPantalla(monitor, { rol: "escritxr", player: 2 });

  assert.equal(monitor.salas.has("j1"), false);
  assert.equal(monitor.salas.has("musa_j1"), false);
  assert.equal(monitor.salas.has("j2"), true);
  assert.equal(monitor.salas.has(ROLE_ROOMS.writer(2)), true);
  assert.equal(monitor.monitor_pantalla.rol, "escritor");
  assert.equal(monitor.monitor_pantalla.player, 2);
});

test("role registry moves actors between teams and cleans disconnected sockets", () => {
  const roles = crearRegistroRoles();
  const actor = crearSocket("actor");
  const writer = crearSocket("writer");
  const control = crearSocket("control");
  const jury = crearSocket("jury");

  roles.registrarActor(actor, { player: 1 });
  roles.registrarActor(actor, { player: 2 });
  roles.registrarEscritor(writer, 2);
  roles.registrarControl(control);
  roles.registrarJurado(jury);

  assert.equal(actor.salas.has("j1"), false);
  assert.equal(actor.salas.has("j2"), true);
  assert.equal(actor.salas.has(ROLE_ROOMS.actor(1)), false);
  assert.equal(actor.salas.has(ROLE_ROOMS.actor(2)), true);

  roles.desregistrarSocket(actor);
  roles.desregistrarSocket(writer);
  roles.desregistrarSocket(control);
  roles.desregistrarSocket(jury);

  const conexiones = roles.payloadConexiones();
  assert.equal(conexiones.actors[2].count, 0);
  assert.equal(conexiones.writers[2].count, 0);
  assert.equal(conexiones.control.count, 0);
  assert.equal(conexiones.jury.count, 0);
});

test("role registry keeps one active writer connection per role", () => {
  const roles = crearRegistroRoles();
  const oldWriter = crearSocket("writer-old");
  const newWriter = crearSocket("writer-new");

  const first = roles.registrarEscritor(oldWriter, 1);
  const second = roles.registrarEscritor(newWriter, 1);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(second.previousSocketIds, ["writer-old"]);
  assert.equal(second.replaced, true);
  assert.deepEqual(roles.payloadConexiones().writers[1], { count: 1, connected: true });

  const disconnectOld = roles.desregistrarSocket(oldWriter);
  assert.equal(disconnectOld.escritorId, 1);
  assert.deepEqual(roles.payloadConexiones().writers[1], { count: 1, connected: true });

  roles.desregistrarSocket(newWriter);
  assert.deepEqual(roles.payloadConexiones().writers[1], { count: 0, connected: false });
});

test("role registry keeps writer tab client ids for replacement decisions", () => {
  const roles = crearRegistroRoles();
  const oldWriter = crearSocket("writer-old");
  const newWriter = crearSocket("writer-new");

  roles.registrarEscritor(oldWriter, { player: 1, client_id: "tab-a" });
  const second = roles.registrarEscritor(newWriter, { player: 1, client_id: "tab-a" });

  assert.equal(second.ok, true);
  assert.equal(second.clientId, "tab-a");
  assert.deepEqual(second.previousSessions, [{ socketId: "writer-old", clientId: "tab-a" }]);
  assert.equal(newWriter.escritxr_client_id, "tab-a");
});

test("role registry tracks musa counters and ignores invalid musa teams", () => {
  const roles = crearRegistroRoles();
  const musa1 = crearSocket("musa1");
  const invalid = crearSocket("invalid");

  const ok = roles.registrarMusa(musa1, { player: 1, nombre: "Luna", clientId: "luna" });
  const bad = roles.registrarMusa(invalid, { player: 9, nombre: "Nadie", clientId: "nadie" });

  assert.equal(ok.ok, true);
  assert.equal(ok.player, 1);
  assert.equal(musa1.musa, 1);
  assert.equal(musa1.nombre_musa, "Luna");
  assert.equal(musa1.salas.has("j1"), true);
  assert.equal(musa1.salas.has("musa_j1"), true);
  assert.equal(musa1.salas.has("musa_client_luna"), true);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });

  assert.equal(bad.ok, false);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });
  assert.deepEqual(roles.payloadConexiones().musas[1], { count: 1, connected: true });

  const disconnect = roles.desregistrarSocket(musa1);
  assert.equal(disconnect.musaId, 1);
  assert.deepEqual(disconnect.contador, { escritxr1: 0, escritxr2: 0 });
});

test("role registry keeps musa registration idempotent for the same socket", () => {
  const roles = crearRegistroRoles();
  const musa = crearSocket("musa1");

  const first = roles.registrarMusa(musa, { player: 1, nombre: "Luna", clientId: "luna" });
  const second = roles.registrarMusa(musa, { player: 1, nombre: "Luna", clientId: "luna" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.previous, 1);
  assert.equal(second.changed, false);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });

  const disconnect = roles.desregistrarSocket(musa);
  assert.deepEqual(disconnect.contador, { escritxr1: 0, escritxr2: 0 });
});

test("role registry moves a musa socket between teams without leaking counters or rooms", () => {
  const roles = crearRegistroRoles();
  const musa = crearSocket("musa-move");

  roles.registrarMusa(musa, { player: 1, nombre: "Luna", clientId: "luna" });
  const moved = roles.registrarMusa(musa, { player: 2, nombre: "Sol", clientId: "sol" });

  assert.equal(moved.ok, true);
  assert.equal(moved.previous, 1);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.contador, { escritxr1: 0, escritxr2: 1 });
  assert.equal(musa.salas.has("j1"), false);
  assert.equal(musa.salas.has("musa_j1"), false);
  assert.equal(musa.salas.has("musa_client_luna"), false);
  assert.equal(musa.salas.has("j2"), true);
  assert.equal(musa.salas.has("musa_j2"), true);
  assert.equal(musa.salas.has("musa_client_sol"), true);

  const disconnect = roles.desregistrarSocket(musa);
  assert.equal(disconnect.musaId, 2);
  assert.deepEqual(disconnect.contador, { escritxr1: 0, escritxr2: 0 });
});

test("invalid musa registration does not unregister an already counted socket", () => {
  const roles = crearRegistroRoles();
  const musa = crearSocket("musa-invalid-after-valid");

  roles.registrarMusa(musa, { player: 1, nombre: "Luna", clientId: "luna" });
  const invalid = roles.registrarMusa(musa, { player: 9, nombre: "Nadie", clientId: "nadie" });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.previous, 1);
  assert.equal(musa.musa, 1);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });

  const disconnect = roles.desregistrarSocket(musa);
  assert.equal(disconnect.musaId, 1);
  assert.deepEqual(disconnect.contador, { escritxr1: 0, escritxr2: 0 });
});

test("role registry keeps match muse credits isolated from previous matches", () => {
  const roles = crearRegistroRoles();
  const oldMusa = crearSocket("old-musa");
  const blueMusa = crearSocket("blue-musa");
  const redMusa = crearSocket("red-musa");

  roles.registrarMusa(oldMusa, { player: 1, nombre: "Partida anterior", clientId: "old" });
  roles.registrarMusaEnCreditosPartida({ player: 1, nombre: "Partida anterior", clientId: "old", socketId: oldMusa.id });
  assert.deepEqual(roles.obtenerMusasCreditosPartida().azules, ["Partida anterior"]);

  roles.desregistrarSocket(oldMusa);
  roles.registrarMusa(blueMusa, { player: 1, nombre: "Luna Azul", clientId: "luna" });
  roles.registrarMusa(redMusa, { player: 2, nombre: "Sol Roja", clientId: "sol" });

  const inicioNuevaPartida = roles.reiniciarMusasCreditosPartidaDesdeActivas();
  assert.deepEqual(inicioNuevaPartida, {
    azules: ["Luna Azul"],
    rojas: ["Sol Roja"]
  });

  roles.registrarMusaEnCreditosPartida({ player: 1, nombre: "Luna Azul reconectada", clientId: "luna", socketId: "otra" });
  roles.registrarMusaEnCreditosPartida({ player: 2, nombre: "Eva Roja", clientId: "eva", socketId: "eva" });

  assert.deepEqual(roles.obtenerMusasCreditosPartida(), {
    azules: ["Luna Azul reconectada"],
    rojas: ["Sol Roja", "Eva Roja"]
  });

  assert.deepEqual(roles.limpiarMusasCreditosPartida(), {
    azules: [],
    rojas: []
  });
});
