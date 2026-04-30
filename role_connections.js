function crearRegistroRoles({
    validarJugador = (valor) => {
        const id = Number(valor);
        return id === 1 || id === 2 ? id : null;
    },
    contarMusas = () => 0,
    now = () => Date.now()
} = {}) {
    const contadorMusas = {
        escritxr1: 0,
        escritxr2: 0
    };
    const escritores = {
        1: new Set(),
        2: new Set()
    };
    const controles = new Set();
    const espectadores = new Set();
    const actores = {
        1: new Set(),
        2: new Set()
    };

    const clonarContadorMusas = () => ({ ...contadorMusas });

    const payloadConexiones = () => ({
        control: {
            count: controles.size,
            connected: controles.size > 0
        },
        spectator: {
            count: espectadores.size,
            connected: espectadores.size > 0
        },
        writers: {
            1: {
                count: escritores[1].size,
                connected: escritores[1].size > 0
            },
            2: {
                count: escritores[2].size,
                connected: escritores[2].size > 0
            }
        },
        musas: {
            1: {
                count: contarMusas(1),
                connected: contarMusas(1) > 0
            },
            2: {
                count: contarMusas(2),
                connected: contarMusas(2) > 0
            }
        },
        actors: {
            1: {
                count: actores[1].size,
                connected: actores[1].size > 0
            },
            2: {
                count: actores[2].size,
                connected: actores[2].size > 0
            }
        }
    });

    const estadoEscritores = () => ({
        ts: now(),
        players: {
            j1: escritores[1].size > 0,
            j2: escritores[2].size > 0,
            total: escritores[1].size + escritores[2].size
        },
        connections: payloadConexiones()
    });

    const registrarControl = (socket) => {
        socket.control = true;
        controles.add(socket.id);
        return payloadConexiones();
    };

    const registrarEspectador = (socket) => {
        socket.espectador = true;
        espectadores.add(socket.id);
        socket.join("j1");
        socket.join("j2");
        return payloadConexiones();
    };

    const registrarEscritor = (socket, player) => {
        const id = validarJugador(player);
        if (!id) {
            return { ok: false, player: null };
        }
        socket.escritxr = id;
        socket.join(`j${id}`);
        escritores[id].add(socket.id);
        return { ok: true, player: id, connections: payloadConexiones() };
    };

    const registrarActor = (socket, payload = {}) => {
        const actorData = (payload && typeof payload === "object") ? payload : { player: payload };
        const id = validarJugador(actorData.player);
        if (!id) {
            return { ok: false, player: null };
        }
        const anterior = validarJugador(socket.actor);
        if (anterior && anterior !== id) {
            actores[anterior].delete(socket.id);
            socket.leave(`j${anterior}`);
        }
        socket.actor = id;
        actores[id].add(socket.id);
        socket.join(`j${id}`);
        return { ok: true, player: id, previous: anterior || null, connections: payloadConexiones() };
    };

    const registrarMusa = (socket, { player, nombre = "MUSA", clientId = "" } = {}) => {
        const id = validarJugador(player);
        socket.musa = id;
        socket.nombre_musa = nombre;
        socket.musa_client_id = clientId;
        if (!id) {
            return { ok: false, player: null, contador: clonarContadorMusas() };
        }
        socket.join(`j${id}`);
        socket.join(`musa_j${id}`);
        if (id === 1) {
            contadorMusas.escritxr1 += 1;
        } else {
            contadorMusas.escritxr2 += 1;
        }
        return { ok: true, player: id, contador: clonarContadorMusas(), connections: payloadConexiones() };
    };

    const desregistrarSocket = (socket) => {
        const musaId = validarJugador(socket.musa);
        if (musaId === 1 && contadorMusas.escritxr1 > 0) {
            contadorMusas.escritxr1 -= 1;
        } else if (musaId === 2 && contadorMusas.escritxr2 > 0) {
            contadorMusas.escritxr2 -= 1;
        }

        const escritorId = validarJugador(socket.escritxr);
        if (escritorId) {
            escritores[escritorId].delete(socket.id);
        }
        if (socket.control) {
            controles.delete(socket.id);
        }
        if (socket.espectador) {
            espectadores.delete(socket.id);
        }
        const actorId = validarJugador(socket.actor);
        if (actorId) {
            actores[actorId].delete(socket.id);
        }

        return {
            musaId,
            escritorId,
            actorId,
            contador: clonarContadorMusas(),
            connections: payloadConexiones()
        };
    };

    return {
        desregistrarSocket,
        estadoEscritores,
        obtenerContadorMusas: clonarContadorMusas,
        payloadConexiones,
        registrarActor,
        registrarControl,
        registrarEscritor,
        registrarEspectador,
        registrarMusa
    };
}

module.exports = {
    crearRegistroRoles
};
