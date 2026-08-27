const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizarCuentaRol,
    resumirRolesActivos
} = require("../scripts/active-scrib-roles-probe.js");

test("active role probe counts every SCRIB role used by the watchdog", () => {
    const summary = resumirRolesActivos({
        connections: {
            control: { count: 1, connected: true },
            spectator: { count: 1, connected: true },
            jury: { count: 0, connected: false },
            dramaturgia: { count: 1, connected: true },
            writers: {
                1: { count: 1, connected: true },
                2: { count: 0, connected: false }
            },
            musas: {
                1: { count: 3, connected: true },
                2: { count: 2, connected: true }
            },
            actors: {
                1: { count: 0, connected: false },
                2: { count: 2, connected: true }
            }
        }
    });

    assert.deepEqual(summary, {
        ok: true,
        total: 11,
        roles: {
            control: 1,
            espectador: 1,
            dramaturgia: 1,
            escritxr1: 1,
            musas1: 3,
            musas2: 2,
            actorxs2: 2
        }
    });
});

test("active role probe is conservative with connected legacy entries and malformed counts", () => {
    assert.equal(normalizarCuentaRol({ connected: true }), 1);
    assert.equal(normalizarCuentaRol({ count: -5, connected: false }), 0);
    assert.equal(normalizarCuentaRol({ count: "2", connected: true }), 2);
    assert.deepEqual(resumirRolesActivos(null), { ok: true, total: 0, roles: {} });
});
