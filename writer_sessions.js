function jugadorValidoPorDefecto(valor) {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
}

function normalizarInicioSesion(valor, clientId = "") {
    const directo = Number(valor);
    if (Number.isFinite(directo) && directo > 0) {
        return Math.trunc(directo);
    }
    const match = String(clientId || "").match(/^writer-(?:1|2|x)-([0-9a-z]+)-/i);
    if (!match) return 0;
    const derivado = parseInt(match[1], 36);
    return Number.isFinite(derivado) && derivado > 0 ? derivado : 0;
}

function crearRegistroSesionesEscritor(validarJugador = jugadorValidoPorDefecto) {
    const socketActivo = { 1: null, 2: null };
    const clientActivo = { 1: "", 2: "" };
    const inicioActivo = { 1: 0, 2: 0 };
    const revisionActiva = { 1: 0, 2: 0 };

    const obtenerJugador = (valor) => {
        const id = validarJugador(valor);
        return id === 1 || id === 2 ? id : null;
    };

    return {
        puedeReclamar(jugador, identidad = {}) {
            const id = obtenerJugador(jugador);
            if (!id) return { ok: false, code: "INVALID_PLAYER" };
            const clientId = String(identidad.clientId || identidad.client_id || "").trim();
            const startedAt = normalizarInicioSesion(
                identidad.startedAt ?? identidad.session_started_at,
                clientId
            );
            const activeSocketId = socketActivo[id];
            const activeClientId = clientActivo[id];
            const activeStartedAt = inicioActivo[id];
            const esMismoCliente = Boolean(clientId && activeClientId && clientId === activeClientId);
            const esAnterior = Boolean(
                activeSocketId
                && !esMismoCliente
                && startedAt > 0
                && activeStartedAt > 0
                && startedAt < activeStartedAt
            );
            return {
                ok: !esAnterior,
                code: esAnterior ? "STALE_WRITER_SESSION" : "OK",
                jugador: id,
                clientId,
                startedAt,
                activeClientId,
                activeStartedAt,
                activeSocketId
            };
        },

        activar(socket, jugador) {
            const id = obtenerJugador(jugador);
            if (!id || !socket || !socket.id) {
                return null;
            }
            const previousSocketId = socketActivo[id];
            const previousClientId = clientActivo[id];
            const previousStartedAt = inicioActivo[id];
            const clientId = String(socket.escritxr_client_id || "").trim();
            const startedAt = normalizarInicioSesion(socket.escritxr_started_at, clientId);
            revisionActiva[id] += 1;
            socketActivo[id] = socket.id;
            clientActivo[id] = clientId;
            inicioActivo[id] = startedAt;
            socket.escritxr_revision = revisionActiva[id];
            return {
                jugador: id,
                socketId: socket.id,
                clientId,
                startedAt,
                revision: revisionActiva[id],
                previousClientId,
                previousStartedAt,
                previousSocketId: previousSocketId && previousSocketId !== socket.id ? previousSocketId : null
            };
        },

        esActiva(socket, jugador) {
            const id = obtenerJugador(jugador);
            if (!id || !socket) {
                return false;
            }
            return obtenerJugador(socket.escritxr) === id
                && socketActivo[id] === socket.id
                && socket.escritxr_revision === revisionActiva[id];
        },

        limpiarSiActiva(socket, jugador) {
            const id = obtenerJugador(jugador);
            if (!id || !socket) {
                return false;
            }
            if (socketActivo[id] !== socket.id) {
                return false;
            }
            socketActivo[id] = null;
            clientActivo[id] = "";
            inicioActivo[id] = 0;
            return true;
        },

        obtenerSocketActivo(jugador) {
            const id = obtenerJugador(jugador);
            return id ? socketActivo[id] : null;
        },

        esMismoClienteActivo(socket, jugador) {
            const id = obtenerJugador(jugador);
            if (!id || !socket) return false;
            const clientId = String(socket.escritxr_client_id || "").trim();
            return Boolean(clientId && clientActivo[id] && clientActivo[id] === clientId);
        },

        snapshot() {
            return {
                socketActivo: { ...socketActivo },
                clientActivo: { ...clientActivo },
                inicioActivo: { ...inicioActivo },
                revisionActiva: { ...revisionActiva }
            };
        }
    };
}

module.exports = {
    crearRegistroSesionesEscritor
};
