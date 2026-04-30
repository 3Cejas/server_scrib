function jugadorValidoPorDefecto(valor) {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
}

function crearRegistroSesionesEscritor(validarJugador = jugadorValidoPorDefecto) {
    const socketActivo = { 1: null, 2: null };
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
            revisionActiva[id] += 1;
            socketActivo[id] = socket.id;
            socket.escritxr_revision = revisionActiva[id];
            return {
                jugador: id,
                socketId: socket.id,
                revision: revisionActiva[id]
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
            return true;
        },

        snapshot() {
            return {
                socketActivo: { ...socketActivo },
                revisionActiva: { ...revisionActiva }
            };
        }
    };
}

module.exports = {
    crearRegistroSesionesEscritor
};
