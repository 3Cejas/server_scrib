const test = require("node:test");
const assert = require("node:assert/strict");

const { crearRegistroSesionesEscritor } = require("../writer_sessions.js");

test("writer sessions keep only the latest socket active per writer", () => {
  const sesiones = crearRegistroSesionesEscritor((valor) => {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
  });
  const socketViejo = { id: "old", escritxr: 1 };
  const socketNuevo = { id: "new", escritxr: 1 };

  const primera = sesiones.activar(socketViejo, 1);
  assert.equal(primera.jugador, 1);
  assert.equal(primera.revision, 1);
  assert.equal(sesiones.esActiva(socketViejo, 1), true);

  const segunda = sesiones.activar(socketNuevo, 1);
  assert.equal(segunda.revision, 2);
  assert.equal(segunda.previousSocketId, "old");
  assert.equal(sesiones.obtenerSocketActivo(1), "new");
  assert.equal(sesiones.esActiva(socketNuevo, 1), true);
  assert.equal(sesiones.esActiva(socketViejo, 1), false);
});

test("writer sessions remember tab client ids across reconnects", () => {
  const sesiones = crearRegistroSesionesEscritor();
  const socketViejo = { id: "old", escritxr: 1, escritxr_client_id: "tab-a" };
  const socketNuevo = { id: "new", escritxr: 1, escritxr_client_id: "tab-a" };

  const primera = sesiones.activar(socketViejo, 1);
  const segunda = sesiones.activar(socketNuevo, 1);

  assert.equal(primera.clientId, "tab-a");
  assert.equal(segunda.previousSocketId, "old");
  assert.equal(segunda.previousClientId, "tab-a");
  assert.equal(segunda.clientId, "tab-a");
});

test("writer sessions isolate writers and ignore inactive disconnects", () => {
  const sesiones = crearRegistroSesionesEscritor();
  const writer1 = { id: "writer-1", escritxr: 1 };
  const writer2 = { id: "writer-2", escritxr: 2 };
  const staleWriter1 = { id: "stale-writer-1", escritxr: 1 };

  sesiones.activar(writer1, 1);
  sesiones.activar(writer2, 2);

  assert.equal(sesiones.limpiarSiActiva(staleWriter1, 1), false);
  assert.equal(sesiones.esActiva(writer1, 1), true);
  assert.equal(sesiones.esActiva(writer2, 2), true);

  assert.equal(sesiones.limpiarSiActiva(writer1, 1), true);
  assert.equal(sesiones.esActiva(writer1, 1), false);
  assert.equal(sesiones.esActiva(writer2, 2), true);
});
