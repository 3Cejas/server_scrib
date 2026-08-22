const test = require("node:test");
const assert = require("node:assert/strict");

const {
  eventoPermitidoParaMonitor,
  instalarGuardiaMonitor
} = require("../monitor_guard.js");

function crearSocket() {
  const emitted = [];
  let middleware = null;
  return {
    emitted,
    monitor_pantalla: { rol: "escritor", player: 1 },
    use(handler) {
      middleware = handler;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    packet(packet) {
      let continued = false;
      middleware(packet, () => {
        continued = true;
      });
      return continued;
    }
  };
}

test("monitor guard permits only explicit read requests", () => {
  assert.equal(eventoPermitidoParaMonitor("pedir_texto"), true);
  assert.equal(eventoPermitidoParaMonitor("pedir_stats_live"), true);
  assert.equal(eventoPermitidoParaMonitor("registrar_monitor_pantalla"), true);
  assert.equal(eventoPermitidoParaMonitor("texto1"), false);
  assert.equal(eventoPermitidoParaMonitor("stats_live_actualizar"), false);
  assert.equal(eventoPermitidoParaMonitor("inicio"), false);
  assert.equal(eventoPermitidoParaMonitor("enviar_voto_ventaja"), false);
});

test("monitor guard drops mutations and responds to acknowledgements", () => {
  const socket = crearSocket();
  instalarGuardiaMonitor(socket, { now: () => 1234 });

  assert.equal(socket.packet(["pedir_texto", { musa: 1 }]), true);
  assert.equal(socket.packet(["texto1", { text: "mutacion" }]), false);

  let ack = null;
  assert.equal(socket.packet(["inicio", {}, (payload) => {
    ack = payload;
  }]), false);
  assert.deepEqual(ack, {
    ok: false,
    solo_lectura: true,
    evento: "inicio",
    ts: 1234
  });
  assert.deepEqual(socket.emitted.map((item) => item.event), [
    "monitor_pantalla_bloqueo",
    "monitor_pantalla_bloqueo"
  ]);
});

test("monitor guard does not constrain ordinary role sockets", () => {
  const socket = crearSocket();
  socket.monitor_pantalla = null;
  instalarGuardiaMonitor(socket);
  assert.equal(socket.packet(["inicio", {}]), true);
});

test("monitor guard protects the socket from the handshake before role registration", () => {
  const socket = crearSocket();
  socket.monitor_pantalla = null;
  socket.monitor_pantalla_solicitada = true;
  instalarGuardiaMonitor(socket);

  assert.equal(socket.packet(["registrar_monitor_pantalla", {
    rol: "escritor",
    player: 1
  }]), true);
  assert.equal(socket.packet(["registrar_escritor", { player: 1 }]), false);
  assert.equal(socket.packet(["inicio", {}]), false);
});
