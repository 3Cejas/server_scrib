const socketIoClient = require("socket.io-client");

const DEFAULT_SERVER_URL = "https://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 7000;

function normalizarCuentaRol(value) {
    if (!value || typeof value !== "object") return 0;
    const count = Math.max(0, Math.trunc(Number(value.count) || 0));
    return count || (value.connected === true ? 1 : 0);
}

function resumirRolesActivos(state = {}) {
    const connections = state && typeof state.connections === "object"
        ? state.connections
        : {};
    const roles = {};
    const add = (label, value) => {
        const count = normalizarCuentaRol(value);
        if (count > 0) roles[label] = count;
    };

    add("control", connections.control);
    add("espectador", connections.spectator);
    add("jurado", connections.jury);
    add("dramaturgia", connections.dramaturgia);
    add("escritxr1", connections.writers && connections.writers[1]);
    add("escritxr2", connections.writers && connections.writers[2]);
    add("musas1", connections.musas && connections.musas[1]);
    add("musas2", connections.musas && connections.musas[2]);
    add("actorxs1", connections.actors && connections.actors[1]);
    add("actorxs2", connections.actors && connections.actors[2]);

    return {
        ok: true,
        total: Object.values(roles).reduce((sum, count) => sum + count, 0),
        roles
    };
}

function consultarRolesActivos({
    serverUrl = process.env.SCRIB_ROLE_PROBE_URL || DEFAULT_SERVER_URL,
    timeoutMs = Number(process.env.SCRIB_ROLE_PROBE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    ioFactory = socketIoClient.io || socketIoClient
} = {}) {
    return new Promise((resolve) => {
        let finished = false;
        const socket = ioFactory(serverUrl, {
            rejectUnauthorized: false,
            timeout: Math.min(timeoutMs, 4000),
            reconnection: false
        });
        const finish = (payload) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.close();
            resolve(payload);
        };
        const timer = setTimeout(() => {
            finish({ ok: false, total: 0, roles: {}, reason: "timeout" });
        }, timeoutMs);

        socket.on("connect", () => {
            socket.emit("health_ping", {}, (state = {}) => {
                finish(resumirRolesActivos(state));
            });
        });
        socket.on("connect_error", () => {
            finish({ ok: false, total: 0, roles: {}, reason: "connect_error" });
        });
    });
}

async function main() {
    const result = await consultarRolesActivos();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) {
    main().catch(() => {
        process.stdout.write(`${JSON.stringify({ ok: false, total: 0, roles: {}, reason: "probe_error" })}\n`);
        process.exitCode = 2;
    });
}

module.exports = {
    consultarRolesActivos,
    normalizarCuentaRol,
    resumirRolesActivos
};
