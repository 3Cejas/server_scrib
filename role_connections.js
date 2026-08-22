const ROLE_ROOMS = Object.freeze({
    CONTROL: "role_control",
    SPECTATOR: "role_espectador",
    JURY: "role_jurado",
    DRAMATURGY: "role_dramaturgia",
    writer: (player) => `role_escritor_${player}`,
    actor: (player) => `role_actor_${player}`
});

const MONITOR_ROLES = new Set([
    "control",
    "escritor",
    "musa",
    "actor",
    "espectador",
    "jurado"
]);

function normalizarRolMonitor(valor) {
    const rol = String(valor || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    if (rol === "writer" || rol === "escritora" || rol === "escritor" || rol === "escritxr") return "escritor";
    if (rol === "muse" || rol === "musa") return "musa";
    if (rol === "actors" || rol === "actores" || rol === "actorxs" || rol === "actor") return "actor";
    if (rol === "spectator" || rol === "publico" || rol === "espectador") return "espectador";
    if (rol === "jury" || rol === "judge" || rol === "jurado") return "jurado";
    if (rol === "control") return "control";
    return "";
}

function crearRegistroRoles({
    validarJugador = (valor) => {
        const id = Number(valor);
        return id === 1 || id === 2 ? id : null;
    },
    now = () => Date.now()
} = {}) {
    const escritores = {
        1: new Set(),
        2: new Set()
    };
    const escritoresClientIds = new Map();
    const musas = {
        1: new Set(),
        2: new Set()
    };
    const musasActivas = new Map();
    const musasPartida = {
        1: new Map(),
        2: new Map()
    };
    const controles = new Set();
    const espectadores = new Set();
    const jurados = new Set();
    const dramaturgos = new Set();
    const actores = {
        1: new Set(),
        2: new Set()
    };

    const clonarContadorMusas = () => ({
        escritxr1: musas[1].size,
        escritxr2: musas[2].size
    });

    const normalizarNombreCreditoMusa = (valor) => String(valor ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48);

    const normalizarClientIdCreditoMusa = (valor) => String(valor ?? "")
        .trim()
        .slice(0, 120);

    const claveCreditoMusa = ({ socketId = "", clientId = "", nombre = "" } = {}) => {
        const id = normalizarClientIdCreditoMusa(clientId);
        if (id) return `client:${id}`;
        const nombreNormalizado = normalizarNombreCreditoMusa(nombre).toLowerCase();
        if (nombreNormalizado) return `name:${nombreNormalizado}`;
        return `socket:${String(socketId || "").trim()}`;
    };

    const registrarMusaEnCreditosPartida = ({ player, nombre = "MUSA", clientId = "", socketId = "" } = {}) => {
        const id = validarJugador(player);
        if (!id) {
            return false;
        }
        const nombreNormalizado = normalizarNombreCreditoMusa(nombre) || "MUSA";
        const clave = claveCreditoMusa({ socketId, clientId, nombre: nombreNormalizado });
        if (!clave || clave === "socket:") {
            return false;
        }
        musasPartida[1].delete(clave);
        musasPartida[2].delete(clave);
        musasPartida[id].set(clave, nombreNormalizado);
        return true;
    };

    const obtenerMusasCreditosPartida = () => ({
        azules: Array.from(musasPartida[1].values()),
        rojas: Array.from(musasPartida[2].values())
    });

    const limpiarMusasCreditosPartida = () => {
        musasPartida[1].clear();
        musasPartida[2].clear();
        return obtenerMusasCreditosPartida();
    };

    const reiniciarMusasCreditosPartidaDesdeActivas = () => {
        limpiarMusasCreditosPartida();
        musasActivas.forEach((musa) => registrarMusaEnCreditosPartida(musa));
        return obtenerMusasCreditosPartida();
    };

    const payloadConexiones = () => ({
        control: {
            count: controles.size,
            connected: controles.size > 0
        },
        spectator: {
            count: espectadores.size,
            connected: espectadores.size > 0
        },
        jury: {
            count: jurados.size,
            connected: jurados.size > 0
        },
        dramaturgia: {
            count: dramaturgos.size,
            connected: dramaturgos.size > 0
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
                count: musas[1].size,
                connected: musas[1].size > 0
            },
            2: {
                count: musas[2].size,
                connected: musas[2].size > 0
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
        socket.join(ROLE_ROOMS.CONTROL);
        controles.add(socket.id);
        return payloadConexiones();
    };

    const registrarEspectador = (socket) => {
        socket.espectador = true;
        espectadores.add(socket.id);
        socket.join("j1");
        socket.join("j2");
        socket.join(ROLE_ROOMS.SPECTATOR);
        return payloadConexiones();
    };

    const registrarJurado = (socket) => {
        socket.jurado = true;
        jurados.add(socket.id);
        socket.join("j1");
        socket.join("j2");
        socket.join(ROLE_ROOMS.JURY);
        return payloadConexiones();
    };

    const registrarDramaturgia = (socket) => {
        socket.dramaturgia = true;
        dramaturgos.add(socket.id);
        socket.join("j1");
        socket.join("j2");
        socket.join(ROLE_ROOMS.DRAMATURGY);
        return payloadConexiones();
    };

    const salasMonitor = ({ rol, player }) => {
        if (rol === "musa") {
            return [`j${player}`, `musa_j${player}`];
        }
        if (rol === "escritor") {
            return [`j${player}`, ROLE_ROOMS.writer(player)];
        }
        if (rol === "actor") {
            return [`j${player}`, ROLE_ROOMS.actor(player)];
        }
        if (rol === "espectador") {
            return ["j1", "j2", ROLE_ROOMS.SPECTATOR];
        }
        if (rol === "jurado") {
            return ["j1", "j2", ROLE_ROOMS.JURY];
        }
        return ["j1", "j2", ROLE_ROOMS.CONTROL];
    };

    const registrarMonitorPantalla = (socket, payload = {}) => {
        const data = (payload && typeof payload === "object") ? payload : { rol: payload };
        const rol = normalizarRolMonitor(data.rol ?? data.role ?? data.tipo);
        const requiereEquipo = rol === "escritor" || rol === "musa" || rol === "actor";
        const player = validarJugador(data.player ?? data.equipo ?? data.team);
        if (!MONITOR_ROLES.has(rol) || (requiereEquipo && !player)) {
            return { ok: false, rol: "", player: null, solo_lectura: true };
        }

        const anterior = socket.monitor_pantalla;
        if (anterior && Array.isArray(anterior.salas)) {
            anterior.salas.forEach((sala) => socket.leave(sala));
        }
        const salas = salasMonitor({ rol, player });
        socket.monitor_pantalla = {
            rol,
            player: requiereEquipo ? player : null,
            salas
        };
        salas.forEach((sala) => socket.join(sala));
        return {
            ok: true,
            rol,
            player: requiereEquipo ? player : null,
            solo_lectura: true,
            salas: [...salas]
        };
    };

    const normalizarPayloadEscritor = (payload) => {
        const data = (payload && typeof payload === "object") ? payload : { player: payload };
        const id = validarJugador(data.player ?? data.escritxr ?? data.writer ?? data.jugador);
        const clientId = String(data.client_id ?? data.clientId ?? data.tab_id ?? data.tabId ?? "")
            .trim()
            .slice(0, 160);
        return { id, clientId };
    };

    const registrarEscritor = (socket, player) => {
        const { id, clientId } = normalizarPayloadEscritor(player);
        if (!id) {
            return { ok: false, player: null };
        }
        const anterior = validarJugador(socket.escritxr);
        if (anterior && anterior !== id) {
            escritores[anterior].delete(socket.id);
            socket.leave(`j${anterior}`);
            socket.leave(ROLE_ROOMS.writer(anterior));
        }
        const previousSocketIds = Array.from(escritores[id]).filter((socketId) => socketId !== socket.id);
        const previousSessions = previousSocketIds.map((socketId) => ({
            socketId,
            clientId: escritoresClientIds.get(socketId) || ""
        }));
        escritores[id].clear();
        previousSocketIds.forEach((socketId) => escritoresClientIds.delete(socketId));
        socket.escritxr = id;
        socket.escritxr_client_id = clientId;
        socket.join(`j${id}`);
        socket.join(ROLE_ROOMS.writer(id));
        escritores[id].add(socket.id);
        escritoresClientIds.set(socket.id, clientId);
        return {
            ok: true,
            player: id,
            clientId,
            previous: anterior || null,
            previousSocketIds,
            previousSessions,
            replaced: previousSocketIds.length > 0,
            connections: payloadConexiones()
        };
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
            socket.leave(ROLE_ROOMS.actor(anterior));
        }
        socket.actor = id;
        actores[id].add(socket.id);
        socket.join(`j${id}`);
        socket.join(ROLE_ROOMS.actor(id));
        return { ok: true, player: id, previous: anterior || null, connections: payloadConexiones() };
    };

    const registrarMusa = (socket, { player, nombre = "MUSA", clientId = "" } = {}) => {
        const id = validarJugador(player);
        const anterior = validarJugador(socket.musa);
        const clientIdAnterior = typeof socket.musa_client_id === "string" ? socket.musa_client_id : "";
        if (!id) {
            return {
                ok: false,
                player: null,
                previous: anterior || null,
                contador: clonarContadorMusas(),
                connections: payloadConexiones()
            };
        }
        if (anterior && anterior !== id) {
            musas[anterior].delete(socket.id);
            socket.leave(`j${anterior}`);
            socket.leave(`musa_j${anterior}`);
        }
        if (clientIdAnterior && clientIdAnterior !== clientId) {
            socket.leave(`musa_client_${clientIdAnterior}`);
        }
        socket.musa = id;
        socket.nombre_musa = nombre;
        socket.musa_client_id = clientId;
        socket.join(`j${id}`);
        socket.join(`musa_j${id}`);
        if (clientId) {
            socket.join(`musa_client_${clientId}`);
        }
        musas[id].add(socket.id);
        musasActivas.set(socket.id, {
            player: id,
            nombre,
            clientId,
            socketId: socket.id
        });
        return {
            ok: true,
            player: id,
            previous: anterior || null,
            changed: anterior !== id,
            contador: clonarContadorMusas(),
            connections: payloadConexiones()
        };
    };

    const desregistrarSocket = (socket) => {
        const musaId = validarJugador(socket.musa);
        if (musaId) {
            musas[musaId].delete(socket.id);
        }
        musasActivas.delete(socket.id);

        const escritorId = validarJugador(socket.escritxr);
        if (escritorId) {
            escritores[escritorId].delete(socket.id);
        }
        escritoresClientIds.delete(socket.id);
        if (socket.control) {
            controles.delete(socket.id);
        }
        if (socket.espectador) {
            espectadores.delete(socket.id);
        }
        if (socket.jurado) {
            jurados.delete(socket.id);
        }
        if (socket.dramaturgia) {
            dramaturgos.delete(socket.id);
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
        limpiarMusasCreditosPartida,
        obtenerContadorMusas: clonarContadorMusas,
        obtenerMusasCreditosPartida,
        payloadConexiones,
        registrarMusaEnCreditosPartida,
        registrarActor,
        registrarControl,
        registrarDramaturgia,
        registrarEscritor,
        registrarEspectador,
        registrarJurado,
        registrarMonitorPantalla,
        registrarMusa,
        reiniciarMusasCreditosPartidaDesdeActivas
    };
}

module.exports = {
    crearRegistroRoles,
    MONITOR_ROLES,
    normalizarRolMonitor,
    ROLE_ROOMS
};
