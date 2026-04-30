const test = require("node:test");
const assert = require("node:assert/strict");

const { crearRegistroRoles } = require("../role_connections.js");

function crearSocket(id) {
  const salas = new Set();
  return {
    id,
    salas,
    join: (sala) => salas.add(sala),
    leave: (sala) => salas.delete(sala)
  };
}

test("role registry tracks writers, control, spectators and actors", () => {
  const roles = crearRegistroRoles({ now: () => 1234 });
  const control = crearSocket("control");
  const spectator = crearSocket("spectator");
  const writer1 = crearSocket("writer1");
  const actor = crearSocket("actor");

  roles.registrarControl(control);
  roles.registrarEspectador(spectator);
  const writerResult = roles.registrarEscritor(writer1, 1);
  const actorResult = roles.registrarActor(actor, { player: 2 });

  assert.equal(writerResult.ok, true);
  assert.equal(actorResult.ok, true);
  assert.equal(writer1.salas.has("j1"), true);
  assert.equal(spectator.salas.has("j1"), true);
  assert.equal(spectator.salas.has("j2"), true);
  assert.equal(actor.salas.has("j2"), true);

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

test("role registry moves actors between teams and cleans disconnected sockets", () => {
  const roles = crearRegistroRoles();
  const actor = crearSocket("actor");
  const writer = crearSocket("writer");
  const control = crearSocket("control");

  roles.registrarActor(actor, { player: 1 });
  roles.registrarActor(actor, { player: 2 });
  roles.registrarEscritor(writer, 2);
  roles.registrarControl(control);

  assert.equal(actor.salas.has("j1"), false);
  assert.equal(actor.salas.has("j2"), true);

  roles.desregistrarSocket(actor);
  roles.desregistrarSocket(writer);
  roles.desregistrarSocket(control);

  const conexiones = roles.payloadConexiones();
  assert.equal(conexiones.actors[2].count, 0);
  assert.equal(conexiones.writers[2].count, 0);
  assert.equal(conexiones.control.count, 0);
});

test("role registry tracks musa counters and ignores invalid musa teams", () => {
  const roles = crearRegistroRoles({
    contarMusas: (equipo) => (equipo === 1 ? 2 : 0)
  });
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
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });

  assert.equal(bad.ok, false);
  assert.deepEqual(roles.obtenerContadorMusas(), { escritxr1: 1, escritxr2: 0 });
  assert.deepEqual(roles.payloadConexiones().musas[1], { count: 2, connected: true });

  const disconnect = roles.desregistrarSocket(musa1);
  assert.equal(disconnect.musaId, 1);
  assert.deepEqual(disconnect.contador, { escritxr1: 0, escritxr2: 0 });
});
