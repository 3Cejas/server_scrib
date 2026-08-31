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
  assert.equal(controlMonitor.salas.has(ROLE_ROOMS.CONTROL_HELP), false);

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

test("revoking Control removes both ordinary and private support rooms", () => {
  const roles = crearRegistroRoles();
  const control = crearSocket("control-revocable");
  roles.registrarControl(control);
  control.join(ROLE_ROOMS.CONTROL_HELP);
  assert.equal(roles.payloadConexiones().control.count, 1);
  roles.desregistrarControl(control);
  assert.equal(control.control, false);
  assert.equal(control.salas.has(ROLE_ROOMS.CONTROL), false);
  assert.equal(control.salas.has(ROLE_ROOMS.CONTROL_HELP), false);
  assert.equal(roles.payloadConexiones().control.count, 0);
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

test("role registry ignores requested musa teams and assigns the least populated team", () => {
  const roles = crearRegistroRoles();
  const musa1 = crearSocket("musa1");
  const invalid = crearSocket("invalid");

  const ok = roles.registrarMusa(musa1, { player: 1, nombre: "Luna", clientId: "luna" });

  assert.equal(ok.ok, true);
  assert.equal(ok.player, 1);
  assert.equal(musa1.musa, 1);
  assert.equal(musa1.nombre_musa, "Luna");
  assert.equal(musa1.salas.has("j1"), true);
  assert.equal(musa1.salas.has("musa_j1"), true);
  assert.equal(musa1.salas.has("musa_client_luna"), true);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });

  const second = roles.registrarMusa(invalid, { player: 9, nombre: "Nadie", clientId: "nadie" });
  assert.equal(second.ok, true);
  assert.equal(second.player, 2);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 1 });
  assert.deepEqual(roles.payloadConexiones().musas[1], { count: 1, connected: true });
  assert.deepEqual(roles.payloadConexiones().musas[2], { count: 1, connected: true });

  const disconnect = roles.desregistrarSocket(musa1);
  assert.equal(disconnect.musaId, 1);
  assert.deepEqual(disconnect.contador, { escritxr1: 0, escritxr2: 1 });
  roles.desregistrarSocket(invalid);
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

test("duplicate musa registration keeps its authoritative team even if the requested team changes", () => {
  const roles = crearRegistroRoles();
  const musa = crearSocket("musa-invalid-after-valid");

  roles.registrarMusa(musa, { player: 1, nombre: "Luna", clientId: "luna" });
  const duplicate = roles.registrarMusa(musa, { player: 9, nombre: "Luna", clientId: "luna" });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.previous, 1);
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
  const luna = roles.registrarMusa(blueMusa, { player: 1, nombre: "Luna Azul", clientId: "luna" });
  const sol = roles.registrarMusa(redMusa, { player: 2, nombre: "Sol Roja", clientId: "sol" });

  const inicioNuevaPartida = roles.reiniciarMusasCreditosPartidaDesdeActivas();
  assert.deepEqual(inicioNuevaPartida[luna.player === 1 ? "azules" : "rojas"], ["Luna Azul"]);
  assert.deepEqual(inicioNuevaPartida[sol.player === 1 ? "azules" : "rojas"], ["Sol Roja"]);

  roles.registrarMusaEnCreditosPartida({ player: 1, nombre: "Luna Azul reconectada", clientId: "luna", socketId: "otra" });
  roles.registrarMusaEnCreditosPartida({ player: 2, nombre: "Eva Roja", clientId: "eva", socketId: "eva" });

  assert.deepEqual(roles.obtenerMusasCreditosPartida(), {
    azules: [
      ...(sol.player === 1 ? ["Sol Roja"] : []),
      "Luna Azul reconectada"
    ],
    rojas: [
      ...(sol.player === 2 ? ["Sol Roja"] : []),
      "Eva Roja"
    ]
  });

  assert.deepEqual(roles.limpiarMusasCreditosPartida(), {
    azules: [],
    rojas: []
  });
});

test("automatic musa assignment stays balanced and alternates the extra slot on ties", () => {
  const roles = crearRegistroRoles();
  const assigned = [];

  for (let index = 0; index < 7; index += 1) {
    const socket = crearSocket(`musa-${index}`);
    const result = roles.registrarMusa(socket, {
      player: 1,
      nombre: `Musa ${index}`,
      clientId: `client-${index}`
    });
    assigned.push(result.player);
    const count = roles.obtenerContadorMusas();
    assert.ok(Math.abs(count.escritxr1 - count.escritxr2) <= 1);
  }

  assert.deepEqual(assigned, [1, 2, 2, 1, 1, 2, 2]);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 3, escritxr2: 4 });
});

test("manual muses keep the writer they choose while automatic muses fill the smaller team", () => {
  const roles = crearRegistroRoles();
  const manualRedA = crearSocket("manual-red-a");
  const manualRedB = crearSocket("manual-red-b");
  const automatic = crearSocket("automatic-blue");

  const first = roles.registrarMusa(manualRedA, {
    player: 2,
    modoAsignacion: "manual",
    nombre: "Roja A",
    clientId: "manual-red-a"
  });
  const second = roles.registrarMusa(manualRedB, {
    player: 2,
    modoAsignacion: "manual",
    nombre: "Roja B",
    clientId: "manual-red-b"
  });
  const balanced = roles.registrarMusa(automatic, {
    modoAsignacion: "automatica",
    nombre: "Auto",
    clientId: "automatic-blue"
  });

  assert.equal(first.player, 2);
  assert.equal(first.modoAsignacion, "manual");
  assert.equal(second.player, 2);
  assert.equal(balanced.player, 1);
  assert.equal(balanced.modoAsignacion, "automatica");
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 2 });

  roles.desregistrarSocket(automatic);
  assert.equal(manualRedA.musa, 2);
  assert.equal(manualRedB.musa, 2);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 0, escritxr2: 2 });
});

test("manual assignment survives an overlapping reconnect even if a different team is requested", () => {
  const roles = crearRegistroRoles();
  const firstSocket = crearSocket("manual-old");
  const nextSocket = crearSocket("manual-new");
  const first = roles.registrarMusa(firstSocket, {
    player: 2,
    modoAsignacion: "manual",
    nombre: "Luna",
    clientId: "manual-stable"
  });
  const reconnect = roles.registrarMusa(nextSocket, {
    player: 1,
    modoAsignacion: "manual",
    nombre: "Luna",
    clientId: "manual-stable"
  });

  assert.equal(first.player, 2);
  assert.equal(reconnect.player, 2);
  assert.equal(reconnect.modoAsignacion, "manual");
  assert.equal(reconnect.reconnected, true);
  assert.equal(firstSocket.musa, null);
  assert.equal(nextSocket.musa, 2);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 0, escritxr2: 1 });
});

test("manual assignment survives a full page refresh and ignores a different requested team", () => {
  const roles = crearRegistroRoles();
  const firstSocket = crearSocket("manual-before-refresh");
  const refreshedSocket = crearSocket("manual-after-refresh");
  const first = roles.registrarMusa(firstSocket, {
    player: 1,
    modoAsignacion: "manual",
    nombre: "Sol",
    clientId: "manual-refresh-stable"
  });

  roles.desregistrarSocket(firstSocket);
  const reconnect = roles.registrarMusa(refreshedSocket, {
    player: 2,
    modoAsignacion: "manual",
    nombre: "Sol",
    clientId: "manual-refresh-stable"
  });

  assert.equal(first.player, 1);
  assert.equal(reconnect.player, 1);
  assert.equal(reconnect.modoAsignacion, "manual");
  assert.equal(reconnect.reconnected, true);
  assert.equal(refreshedSocket.musa, 1);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });
});

test("a new match session releases every muse and forgets previous teams", () => {
  const roles = crearRegistroRoles({ now: () => 1000 });
  const previousSocket = crearSocket("musa-previous-match");
  const nextSocket = crearSocket("musa-next-match");
  const previousSession = roles.obtenerSesionMusas().session_id;

  roles.registrarMusa(previousSocket, {
    player: 2,
    modoAsignacion: "manual",
    nombre: "Luna",
    clientId: "returning-muse"
  });

  const reset = roles.iniciarNuevaSesionMusas();

  assert.notEqual(reset.session_id, previousSession);
  assert.equal(reset.musasDesvinculadas.length, 1);
  assert.equal(reset.musasDesvinculadas[0].socketId, previousSocket.id);
  assert.equal(previousSocket.musa, null);
  assert.equal(previousSocket.salas.has("j2"), false);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 0, escritxr2: 0 });

  const reassigned = roles.registrarMusa(nextSocket, {
    player: 1,
    modoAsignacion: "manual",
    nombre: "Luna",
    clientId: "returning-muse"
  });
  assert.equal(reassigned.player, 1);
  assert.equal(reassigned.reconnected, false);
});

test("overlapping reconnect replaces the old socket by client_id without inflating counters", () => {
  const roles = crearRegistroRoles();
  const oldSocket = crearSocket("musa-old");
  const newSocket = crearSocket("musa-new");
  const first = roles.registrarMusa(oldSocket, {
    player: 2,
    nombre: "Luna",
    clientId: "same-client"
  });
  const reconnect = roles.registrarMusa(newSocket, {
    player: first.player === 1 ? 2 : 1,
    nombre: "Luna",
    clientId: "same-client"
  });

  assert.equal(reconnect.player, first.player);
  assert.equal(reconnect.reconnected, true);
  assert.equal(reconnect.replaced.length, 1);
  assert.equal(reconnect.replaced[0].socketId, oldSocket.id);
  assert.equal(oldSocket.musa, null);
  assert.equal(oldSocket.salas.has(`j${first.player}`), false);
  assert.equal(newSocket.salas.has(`j${first.player}`), true);
  assert.deepEqual(roles.obtenerContadorMusas(), first.player === 1
    ? { escritxr1: 1, escritxr2: 0 }
    : { escritxr1: 0, escritxr2: 1 });

  const staleDisconnect = roles.desregistrarSocket(oldSocket);
  assert.equal(staleDisconnect.musaId, null);
  assert.equal(roles.payloadConexiones().musas[first.player].count, 1);
});

test("role registry lists only exact active muses for aggregate verification", () => {
  const roles = crearRegistroRoles();
  const oldSocket = crearSocket("musa-list-old");
  const activeSocket = crearSocket("musa-list-active");
  roles.registrarMusa(oldSocket, {
    nombre: "Luna",
    clientId: "stable-list-client"
  });
  const active = roles.registrarMusa(activeSocket, {
    nombre: "Luna nueva",
    clientId: "stable-list-client"
  });

  assert.deepEqual(roles.listarMusasActivas(), [{
    player: active.player,
    nombre: "Luna nueva",
    clientId: "stable-list-client",
    socketId: "musa-list-active"
  }]);
  assert.equal(roles.obtenerMusaActiva(oldSocket), null);
  assert.equal(roles.obtenerMusaActiva(activeSocket).socketId, "musa-list-active");

  roles.desregistrarSocket(activeSocket);
  assert.deepEqual(roles.listarMusasActivas(), []);
});

test("disconnect rebalances active human muses and reports the moved socket", () => {
  const roles = crearRegistroRoles();
  const first = crearSocket("musa-first");
  const second = crearSocket("musa-second");
  const third = crearSocket("musa-third");
  roles.registrarMusa(first, { nombre: "Primera", clientId: "first" });
  roles.registrarMusa(second, { nombre: "Segunda", clientId: "second" });
  roles.registrarMusa(third, { nombre: "Tercera", clientId: "third" });

  const disconnect = roles.desregistrarSocket(first);

  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 1 });
  assert.equal(disconnect.reasignacionesMusas.length, 1);
  assert.equal(disconnect.reasignacionesMusas[0].socketId, third.id);
  assert.equal(disconnect.reasignacionesMusas[0].previous, 2);
  assert.equal(disconnect.reasignacionesMusas[0].player, 1);
  assert.equal(third.musa, 1);
  assert.equal(third.salas.has("j2"), false);
  assert.equal(third.salas.has("j1"), true);
});

test("test hooks keep explicit musa teams and legacy duplicate client ids", () => {
  const roles = crearRegistroRoles({ permitirEquipoMusaExplicito: true });
  const first = crearSocket("test-musa-1");
  const second = crearSocket("test-musa-2");

  const firstResult = roles.registrarMusa(first, {
    player: 2,
    nombre: "Test A",
    clientId: "shared-browser-id"
  });
  const secondResult = roles.registrarMusa(second, {
    player: 2,
    nombre: "Test B",
    clientId: "shared-browser-id"
  });

  assert.equal(firstResult.player, 2);
  assert.equal(secondResult.player, 2);
  assert.equal(secondResult.replaced.length, 0);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 0, escritxr2: 2 });
});

test("disconnecting a non-musa never rebalances explicit test teams", () => {
  const roles = crearRegistroRoles({ permitirEquipoMusaExplicito: true });
  const first = crearSocket("test-musa-a");
  const second = crearSocket("test-musa-b");
  const control = crearSocket("test-control");

  roles.registrarMusa(first, { player: 2, nombre: "A", clientId: "a" });
  roles.registrarMusa(second, { player: 2, nombre: "B", clientId: "b" });
  roles.registrarControl(control);

  const disconnected = roles.desregistrarSocket(control);

  assert.deepEqual(disconnected.reasignacionesMusas, []);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 0, escritxr2: 2 });
  assert.equal(first.musa, 2);
  assert.equal(second.musa, 2);
});
