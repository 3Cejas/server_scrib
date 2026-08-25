const test = require("node:test");
const assert = require("node:assert/strict");

const { activarSocketsExtratextuales } = require("../extratextual_channels.js");

test("global match-clock finalization can run without an originating socket", () => {
  assert.equal(activarSocketsExtratextuales(null, { to() {} }), false);
});

test("extratextual handlers remain idempotent for a real socket", () => {
  const handlers = [];
  const socket = {
    broadcast: { emit() {} },
    on(event) { handlers.push(event); }
  };
  const io = { to: () => ({ emit() {} }) };

  assert.equal(activarSocketsExtratextuales(socket, io), true);
  const registered = handlers.length;
  assert.ok(registered > 0);
  assert.equal(activarSocketsExtratextuales(socket, io), false);
  assert.equal(handlers.length, registered);
});
