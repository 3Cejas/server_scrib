function jugadorValidoPorDefecto(valor) {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
}

function crearRegistroSesionesEscritor(validarJugador = jugadorValidoPorDefecto) {
    const socketActivo = { 1: null, 2: null };
    const clientActivo = { 1: "", 2: "" };
    const revisionActiva = { 1: 0, 2: 0 };

    const obtenerJugador = (valor) => {
        const id = validarJugador(valor);
        return id === 1 || id === 2 ? id : null;
    };

    return {
        activar(socket, jugador) {
            const id = obtenerJugador(jugador);
            if (!id || !socket || !socket.id) {
                return null;
            }
            const previousSocketId = socketActivo[id];
            const previousClientId = clientActivo[id];
            const clientId = String(socket.escritxr_client_id || "").trim();
            revisionActiva[id] += 1;
            socketActivo[id] = socket.id;
            clientActivo[id] = clientId;
            socket.escritxr_revision = revisionActiva[id];
            return {
                jugador: id,
                socketId: socket.id,
                clientId,
                revision: revisionActiva[id],
                previousClientId,
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
            return true;
        },

        obtenerSocketActivo(jugador) {
            const id = obtenerJugador(jugador);
            return id ? socketActivo[id] : null;
        },

        snapshot() {
            return {
                socketActivo: { ...socketActivo },
                clientActivo: { ...clientActivo },
                revisionActiva: { ...revisionActiva }
            };
        }
    };
}

module.exports = {
    crearRegistroSesionesEscritor
};
