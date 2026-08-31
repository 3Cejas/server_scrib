const ROLE_ROOMS = Object.freeze({
    CONTROL: "role_control",
    CONTROL_HELP: "role_control_ayuda_musas",
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

const MAX_ASIGNACIONES_MUSA_RECORDADAS = 4096;

function normalizarSesionMusaId(valor) {
    return String(valor || "")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 96);
}

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
    now = () => Date.now(),
    permitirEquipoMusaExplicito = false
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
    const socketMusaPorClientId = new Map();
    const ultimaAsignacionMusaPorClientId = new Map();
    let revisionSesionMusas = 1;
    let sesionMusasId = `partida_${Math.max(0, Math.trunc(Number(now()) || Date.now())).toString(36)}_${revisionSesionMusas.toString(36)}`;
    let proximoEquipoEmpate = 1;
    let ordenRegistroMusa = 0;
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

    const obtenerSesionMusas = () => ({
        session_id: sesionMusasId,
        revision: revisionSesionMusas
    });

    const normalizarModoAsignacionMusa = (valor) => {
        const modo = String(valor || "").trim().toLowerCase();
        return modo === "manual" ? "manual" : "automatica";
    };

    const recordarAsignacionMusa = (clientId, player, modoAsignacion = "automatica") => {
        const id = validarJugador(player);
        if (!clientId || !id) return;
        ultimaAsignacionMusaPorClientId.delete(clientId);
        ultimaAsignacionMusaPorClientId.set(clientId, {
            player: id,
            modoAsignacion: normalizarModoAsignacionMusa(modoAsignacion)
        });
        while (ultimaAsignacionMusaPorClientId.size > MAX_ASIGNACIONES_MUSA_RECORDADAS) {
            const masAntigua = ultimaAsignacionMusaPorClientId.keys().next().value;
            if (!masAntigua) break;
            ultimaAsignacionMusaPorClientId.delete(masAntigua);
        }
    };

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

    const desregistrarControl = (socket) => {
        if (!socket) return payloadConexiones();
        controles.delete(socket.id);
        if (typeof socket.leave === "function") {
            socket.leave(ROLE_ROOMS.CONTROL);
            socket.leave(ROLE_ROOMS.CONTROL_HELP);
        }
        socket.control = false;
        socket.control_access_expires_ts = 0;
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

    const equipoMusaConMenorCarga = (preferido = null) => {
        const equipoPreferido = validarJugador(preferido);
        const admitePreferido = equipoPreferido && Math.abs(
            (musas[equipoPreferido].size + 1) - musas[equipoPreferido === 1 ? 2 : 1].size
        ) <= 1;
        if (admitePreferido) {
            return equipoPreferido;
        }
        if (musas[1].size < musas[2].size) return 1;
        if (musas[2].size < musas[1].size) return 2;
        const elegido = proximoEquipoEmpate;
        proximoEquipoEmpate = elegido === 1 ? 2 : 1;
        return elegido;
    };

    const desvincularMusa = (socket, { limpiarSocket = true } = {}) => {
        const registro = musasActivas.get(socket.id);
        if (!registro) return null;
        const id = validarJugador(registro.player);
        if (id) {
            musas[id].delete(socket.id);
            socket.leave(`j${id}`);
            socket.leave(`musa_j${id}`);
        }
        if (registro.clientId) {
            socket.leave(`musa_client_${registro.clientId}`);
            if (socketMusaPorClientId.get(registro.clientId) === socket.id) {
                socketMusaPorClientId.delete(registro.clientId);
            }
        }
        musasActivas.delete(socket.id);
        if (limpiarSocket) {
            socket.musa = null;
            socket.nombre_musa = "";
            socket.musa_client_id = "";
            socket.musa_modo_asignacion = "";
        }
        return registro;
    };

    const iniciarNuevaSesionMusas = () => {
        const musasDesvinculadas = Array.from(musasActivas.values());
        musasDesvinculadas.forEach((registro) => {
            if (registro && registro.socket) {
                desvincularMusa(registro.socket);
            }
        });
        ultimaAsignacionMusaPorClientId.clear();
        limpiarMusasCreditosPartida();
        proximoEquipoEmpate = 1;
        revisionSesionMusas += 1;
        sesionMusasId = `partida_${Math.max(0, Math.trunc(Number(now()) || Date.now())).toString(36)}_${revisionSesionMusas.toString(36)}`;
        return {
            ...obtenerSesionMusas(),
            musasDesvinculadas,
            contador: clonarContadorMusas(),
            connections: payloadConexiones()
        };
    };

    const vincularMusa = (socket, { player, nombre, clientId, modoAsignacion = "automatica" }) => {
        const id = validarJugador(player);
        if (!id) return null;
        const modoNormalizado = normalizarModoAsignacionMusa(modoAsignacion);
        socket.musa = id;
        socket.nombre_musa = nombre;
        socket.musa_client_id = clientId;
        socket.musa_modo_asignacion = modoNormalizado;
        socket.join(`j${id}`);
        socket.join(`musa_j${id}`);
        if (clientId) {
            socket.join(`musa_client_${clientId}`);
            socketMusaPorClientId.set(clientId, socket.id);
            recordarAsignacionMusa(clientId, id, modoNormalizado);
        }
        musas[id].add(socket.id);
        const registro = {
            player: id,
            nombre,
            clientId,
            modoAsignacion: modoNormalizado,
            socketId: socket.id,
            socket,
            orden: ++ordenRegistroMusa
        };
        musasActivas.set(socket.id, registro);
        return registro;
    };

    const moverMusaActiva = (registro, player) => {
        const id = validarJugador(player);
        const anterior = validarJugador(registro && registro.player);
        const socket = registro && registro.socket;
        if (!id || !anterior || anterior === id || !socket) return null;
        musas[anterior].delete(socket.id);
        socket.leave(`j${anterior}`);
        socket.leave(`musa_j${anterior}`);
        musas[id].add(socket.id);
        socket.join(`j${id}`);
        socket.join(`musa_j${id}`);
        socket.musa = id;
        registro.player = id;
        registro.orden = ++ordenRegistroMusa;
        if (registro.clientId) {
            recordarAsignacionMusa(registro.clientId, id, registro.modoAsignacion);
        }
        return {
            socket,
            socketId: socket.id,
            previous: anterior,
            player: id,
            nombre: registro.nombre,
            clientId: registro.clientId,
            modoAsignacion: registro.modoAsignacion
        };
    };

    const reequilibrarMusasActivas = () => {
        const reasignaciones = [];
        while (Math.abs(musas[1].size - musas[2].size) > 1) {
            const origen = musas[1].size > musas[2].size ? 1 : 2;
            const destino = origen === 1 ? 2 : 1;
            const candidata = Array.from(musasActivas.values())
                .filter((registro) => (
                    registro.player === origen
                    && registro.modoAsignacion === "automatica"
                    && !registro.socket.simulacion_scrib
                ))
                .sort((a, b) => b.orden - a.orden)[0];
            if (!candidata) break;
            const reasignada = moverMusaActiva(candidata, destino);
            if (!reasignada) break;
            reasignaciones.push(reasignada);
        }
        return reasignaciones;
    };

    const registrarMusa = (socket, {
        player,
        nombre = "MUSA",
        clientId = "",
        modoAsignacion = "automatica"
    } = {}) => {
        const equipoSolicitado = validarJugador(player);
        const modoSolicitado = normalizarModoAsignacionMusa(modoAsignacion);
        const seleccionManualPermitida = modoSolicitado === "manual" && equipoSolicitado;
        const equipoConfiable = (
            seleccionManualPermitida
            || (socket && socket.simulacion_scrib)
            || permitirEquipoMusaExplicito
        ) ? equipoSolicitado : null;
        const gestionarReconexionClientId = !permitirEquipoMusaExplicito;
        const clientIdNormalizado = normalizarClientIdCreditoMusa(clientId);
        const nombreNormalizado = normalizarNombreCreditoMusa(nombre) || "MUSA";
        const registroActual = musasActivas.get(socket.id) || null;
        const mismaIdentidad = Boolean(
            registroActual
            && registroActual.clientId === clientIdNormalizado
        );

        if (mismaIdentidad) {
            registroActual.nombre = nombreNormalizado;
            socket.nombre_musa = nombreNormalizado;
            return {
                ok: true,
                player: registroActual.player,
                previous: registroActual.player,
                changed: false,
                idempotent: true,
                reconnected: false,
                modoAsignacion: registroActual.modoAsignacion,
                replaced: [],
                contador: clonarContadorMusas(),
                connections: payloadConexiones()
            };
        }

        const previous = registroActual ? registroActual.player : null;
        if (registroActual) {
            desvincularMusa(socket);
        }

        const replaced = [];
        let asignacionRecordada = gestionarReconexionClientId && clientIdNormalizado
            ? ultimaAsignacionMusaPorClientId.get(clientIdNormalizado)
            : null;
        let equipoRecordado = validarJugador(asignacionRecordada && asignacionRecordada.player);
        let modoRecordado = asignacionRecordada
            ? normalizarModoAsignacionMusa(asignacionRecordada.modoAsignacion)
            : null;
        if (gestionarReconexionClientId && clientIdNormalizado) {
            const socketIdAnterior = socketMusaPorClientId.get(clientIdNormalizado);
            const registroAnterior = socketIdAnterior ? musasActivas.get(socketIdAnterior) : null;
            if (registroAnterior && registroAnterior.socketId !== socket.id) {
                equipoRecordado = registroAnterior.player;
                modoRecordado = registroAnterior.modoAsignacion;
                const retirado = desvincularMusa(registroAnterior.socket);
                if (retirado) replaced.push(retirado);
            }
        }

        const modoFinal = modoRecordado || (equipoConfiable ? "manual" : modoSolicitado);
        const id = modoFinal === "manual"
            ? (equipoRecordado || equipoConfiable || equipoSolicitado)
            : equipoMusaConMenorCarga(equipoRecordado);
        if (!id) {
            return {
                ok: false,
                code: "EQUIPO_MUSA_INVALIDO",
                mensaje: "Selecciona un equipo válido."
            };
        }
        vincularMusa(socket, {
            player: id,
            nombre: nombreNormalizado,
            clientId: clientIdNormalizado,
            modoAsignacion: modoFinal
        });
        return {
            ok: true,
            player: id,
            previous,
            changed: Boolean(previous && previous !== id),
            idempotent: false,
            reconnected: replaced.length > 0 || Boolean(equipoRecordado),
            reassigned: Boolean(equipoRecordado && equipoRecordado !== id),
            modoAsignacion: modoFinal,
            replaced,
            contador: clonarContadorMusas(),
            connections: payloadConexiones()
        };
    };

    const obtenerMusaActiva = (socket) => {
        if (!socket || !socket.id) return null;
        const registro = musasActivas.get(socket.id);
        const player = validarJugador(registro && registro.player);
        if (
            !registro
            || !player
            || registro.socket !== socket
            || validarJugador(socket.musa) !== player
        ) {
            return null;
        }
        return {
            player,
            nombre: registro.nombre,
            clientId: registro.clientId,
            socketId: registro.socketId
        };
    };

    const listarMusasActivas = () => Array.from(musasActivas.values()).map((registro) => ({
        player: validarJugador(registro.player),
        nombre: registro.nombre,
        clientId: registro.clientId,
        socketId: registro.socketId
    }));

    const desregistrarSocket = (socket) => {
        const registroMusa = musasActivas.get(socket.id) || null;
        const musaId = validarJugador(registroMusa && registroMusa.player);
        if (registroMusa) {
            desvincularMusa(socket);
        }
        const reasignacionesMusas = registroMusa && !permitirEquipoMusaExplicito
            ? reequilibrarMusasActivas()
            : [];

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
            reasignacionesMusas,
            escritorId,
            actorId,
            contador: clonarContadorMusas(),
            connections: payloadConexiones()
        };
    };

    return {
        desregistrarSocket,
        desregistrarControl,
        estadoEscritores,
        iniciarNuevaSesionMusas,
        limpiarMusasCreditosPartida,
        listarMusasActivas,
        obtenerContadorMusas: clonarContadorMusas,
        obtenerSesionMusas,
        obtenerMusaActiva,
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
    normalizarSesionMusaId,
    ROLE_ROOMS
};
