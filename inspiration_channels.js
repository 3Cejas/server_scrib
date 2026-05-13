const normalizarNombreMusaPorDefecto = (valor) => {
    if (typeof valor !== "string") return "";
    return valor.trim().slice(0, 10).toUpperCase();
};

const construirEventoFeedbackMusaInspiracion = (
    payload,
    escritxrId,
    normalizarNombreMusa = normalizarNombreMusaPorDefecto
) => {
    if (!payload || typeof payload !== "object") return null;
    const tipo = typeof payload.tipo === "string"
        ? payload.tipo.trim().toLowerCase()
        : "";
    if (tipo !== "inspiracion") return null;
    if (escritxrId !== 1 && escritxrId !== 2) return null;

    const origenRaw = typeof payload.origen_musa === "string"
        ? payload.origen_musa.trim().toLowerCase()
        : "";
    const origenMusa = (origenRaw === "musa_enemiga") ? "musa_enemiga" : "musa";
    const musaObjetivo = origenMusa === "musa_enemiga"
        ? (escritxrId === 1 ? 2 : 1)
        : escritxrId;
    const musaNombre = normalizarNombreMusa(payload.musa_nombre) || "";
    const palabra = typeof payload.palabra === "string"
        ? payload.palabra.trim().slice(0, 64)
        : "";

    return {
        ...payload,
        tipo: "inspiracion",
        origen_musa: origenMusa,
        musa_nombre: musaNombre,
        palabra,
        escritxr: escritxrId,
        musa_objetivo: musaObjetivo,
        ts: Date.now()
    };
};

const reenviarASalaUnaVez = (socket, io, entrada, salida, sala, permitir = () => true) => {
    if (!socket._inspiration_forwarded_room_events) {
        socket._inspiration_forwarded_room_events = new Set();
    }
    const key = `${entrada}->${salida}@${sala}`;
    if (socket._inspiration_forwarded_room_events.has(key)) return;
    socket._inspiration_forwarded_room_events.add(key);

    socket.on(entrada, (payload) => {
        if (!permitir(payload)) return;
        io.to(sala).emit(salida, payload);
    });
};

function registrarCanalesInspiracion({
    socket,
    io,
    musasAuxiliares,
    nubeInspiracion,
    getModoActual = () => "",
    getModoBonus = () => null,
    getModoMalditas = () => null,
    getModoMusas = () => null,
    obtenerIdJugadorValido,
    normalizarNombreMusa = normalizarNombreMusaPorDefecto,
    normalizarMusaClientId = () => "",
    emitirNubeInspiracionEstado = () => {},
    emitirEstadoBanderasMusas = () => {},
    emitirFeedbackMusas = () => {},
    emitirEstadoRegaloBanderaMusas = () => {},
    sesionesEscritor = null,
    registrar = () => {}
}) {
    const esEscritorActivo = (player) => {
        const id = obtenerIdJugadorValido(player);
        if (!id) return false;
        if (!sesionesEscritor || !socket.escritxr) return true;
        return sesionesEscritor.esActiva(socket, id);
    };

    const hayEscritorActivo = (player) => {
        const id = obtenerIdJugadorValido(player);
        if (!id) return false;
        if (sesionesEscritor && typeof sesionesEscritor.obtenerSocketActivo === "function") {
            return Boolean(sesionesEscritor.obtenerSocketActivo(id));
        }
        return true;
    };

    const entregarInspiracionEnColaAEscritoraActiva = (modo, player) => {
        const id = obtenerIdJugadorValido(player);
        if (!id || !modo || !hayEscritorActivo(id)) {
            return false;
        }
        if (
            typeof modo.obtenerEstadoPalabrasMusas !== "function" ||
            typeof modo.handleRequest !== "function"
        ) {
            return false;
        }
        const estado = modo.obtenerEstadoPalabrasMusas(id);
        const hayPalabraEnColaVisible = Boolean(
            estado &&
            estado.activa === true &&
            estado.origen_estado === "cola" &&
            Number(estado.cola || estado.cola_palabras_musas || 0) > 0
        );
        if (!hayPalabraEnColaVisible) {
            return false;
        }
        modo.handleRequest(id);
        return true;
    };

    socket.on("musa_corazon", () => {
        const equipo = obtenerIdJugadorValido(socket.musa);
        if (!equipo) {
            return;
        }
        musasAuxiliares.registrarCorazon({ socket, equipo });
    });

    socket.on("activar_banderas_musas", (payload = {}) => {
        const estadoPayload = musasAuxiliares.actualizarBanderas(payload);
        // Compatibilidad con clientes antiguos que solo escuchan este evento.
        musasAuxiliares.emitirBanderasCompat(estadoPayload);
        emitirEstadoBanderasMusas();
        emitirEstadoRegaloBanderaMusas();
    });

    socket.on("regalo_pdf_musas", (payload = {}) => {
        const salida = musasAuxiliares.guardarRegalo(payload);
        if (!salida) {
            return;
        }
        if (salida.client_id) {
            io.to(`musa_client_${salida.client_id}`).emit("regalo_pdf_musas", salida);
            return;
        }
        io.to(`musa_j${salida.player}`).emit("regalo_pdf_musas", salida);
    });

    socket.on("pedir_resumen_musas_pdf", (payload = {}, responder = null) => {
        let callback = responder;
        if (typeof payload === "function") {
            callback = payload;
        }
        const resumen = typeof musasAuxiliares.payloadResumenPdf === "function"
            ? musasAuxiliares.payloadResumenPdf()
            : { equipos: { 1: { musas: [] }, 2: { musas: [] } } };
        if (typeof callback === "function") {
            callback(resumen);
            return;
        }
        socket.emit("resumen_musas_pdf", resumen);
    });

    socket.on("pedir_feedback_musas", (payload = {}) => {
        musasAuxiliares.solicitarFeedback(payload);
        emitirFeedbackMusas();
    });

    socket.on("enviar_feedback_modificador", (evento) => {
        if (!evento || typeof evento.id_mod !== "string" || evento.id_mod.length === 0) {
            return;
        }
        const id_mod = evento.id_mod.substring(0, evento.id_mod.length - 1) + "2";
        const id_jugador = obtenerIdJugadorValido(evento.player);
        if (!id_jugador) {
            return;
        }
        if (!esEscritorActivo(id_jugador)) {
            return;
        }
        socket.broadcast.emit("recibir_feedback_modificador", { id_mod, player: id_jugador });
    });

    reenviarASalaUnaVez(socket, io, "feedback_de_j1", "feedback_a_j2", "j2", () => esEscritorActivo(1));
    reenviarASalaUnaVez(socket, io, "feedback_de_j2", "feedback_a_j1", "j1", () => esEscritorActivo(2));

    const reenviarFeedbackInspiracionMusa = (eventoEntrada, escritxrId) => {
        socket.on(eventoEntrada, (payload) => {
            if (!esEscritorActivo(escritxrId)) return;
            const salida = construirEventoFeedbackMusaInspiracion(payload, escritxrId, normalizarNombreMusa);
            if (!salida) return;
            io.to(`musa_j${salida.musa_objetivo}`).emit("feedback_musa_inspiracion", salida);
        });
    };
    reenviarFeedbackInspiracionMusa("feedback_de_j1", 1);
    reenviarFeedbackInspiracionMusa("feedback_de_j2", 2);

    socket.on("feedback_musa_inspiracion", (payload = {}) => {
        const escritxrId = obtenerIdJugadorValido(payload.player) || socket.escritxr;
        if (!esEscritorActivo(escritxrId)) return;
        const salida = construirEventoFeedbackMusaInspiracion(payload, escritxrId, normalizarNombreMusa);
        if (!salida) return;
        io.to(`musa_j${salida.musa_objetivo}`).emit("feedback_musa_inspiracion", salida);
    });

    socket.on("intento_prohibido", (payload) => {
        const playerId = obtenerIdJugadorValido(payload && payload.player);
        if (!playerId) {
            return;
        }
        if (!esEscritorActivo(playerId)) {
            return;
        }
        const salida = { ...(payload || {}), player: playerId };
        io.emit("intento_prohibido", salida);
    });

    const registrarInspiracionIntroducidaDesdeModo = (modo, playerId) => {
        if (!modo || typeof modo.consumirEntregaMusaIntroducida !== "function") {
            return;
        }
        const entrega = modo.consumirEntregaMusaIntroducida(playerId);
        if (entrega && typeof musasAuxiliares.registrarInspiracionIntroducida === "function") {
            musasAuxiliares.registrarInspiracionIntroducida(entrega);
        }
    };

    socket.on("nueva_palabra", (id_jugador) => {
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        if (!esEscritorActivo(id_jugador_valido)) {
            return;
        }
        const modoBonus = getModoBonus();
        registrarInspiracionIntroducidaDesdeModo(modoBonus, id_jugador_valido);
        modoBonus.handleRequest(id_jugador_valido);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_prohibida", (id_jugador) => {
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        if (!esEscritorActivo(id_jugador_valido)) {
            return;
        }
        const modoMalditas = getModoMalditas();
        registrarInspiracionIntroducidaDesdeModo(modoMalditas, id_jugador_valido);
        modoMalditas.handleRequest(id_jugador_valido);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_musa", (escritxr) => {
        const id_jugador = obtenerIdJugadorValido(escritxr);
        if (!id_jugador) {
            return;
        }
        if (!esEscritorActivo(id_jugador)) {
            return;
        }
        registrar(`[socket] peticion de musa para jugador ${id_jugador}`);
        const modoMusas = getModoMusas();
        registrarInspiracionIntroducidaDesdeModo(modoMusas, id_jugador);
        modoMusas.handleRequest(id_jugador);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_bonus", ({ jugador } = {}) => {
        const id_jugador = obtenerIdJugadorValido(jugador);
        if (!id_jugador) {
            return;
        }
        if (!esEscritorActivo(id_jugador)) {
            return;
        }
        const modoBonus = getModoBonus();
        registrarInspiracionIntroducidaDesdeModo(modoBonus, id_jugador);
        modoBonus.handleRequest(id_jugador);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("enviar_inspiracion", (evento) => {
        const id_jugador = obtenerIdJugadorValido(socket.musa);
        if (!id_jugador) {
            return;
        }
        const datos = (evento && typeof evento === "object") ? evento : { palabra: evento };
        const palabra = typeof datos.palabra === "string" ? datos.palabra.trim() : "";
        if (!palabra) {
            return;
        }
        const nombre_musa = normalizarNombreMusa(datos.nombre) || socket.nombre_musa || "MUSA";
        const musa_client_id = normalizarMusaClientId(datos.client_id || socket.musa_client_id || "");
        const payload_musa = { palabra, musa: nombre_musa, client_id: musa_client_id };
        const modo_actual = getModoActual();
        const target_player = modo_actual === "palabras prohibidas"
            ? (id_jugador === 1 ? 2 : 1)
            : id_jugador;
        nubeInspiracion.registrarInspiracion(id_jugador, {
            palabra,
            musa: nombre_musa,
            client_id: musa_client_id,
            modo_actual
        });
        if (
            typeof musasAuxiliares.registrarInspiracionEnviada === "function"
            && ["palabras bonus", "palabras prohibidas", "letra bendita", "letra prohibida"].includes(modo_actual)
        ) {
            musasAuxiliares.registrarInspiracionEnviada({
                player: id_jugador,
                target_player,
                palabra,
                musa: nombre_musa,
                client_id: musa_client_id,
                modo: modo_actual
            });
        }

        switch (modo_actual) {
            case "palabras bonus":
                getModoBonus().addMusa(id_jugador, payload_musa);
                registrar(`[bonus] Se anadio musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
                break;

            case "palabras prohibidas":
                getModoMalditas().addMusa(id_jugador, payload_musa);
                registrar(`[maldita] Se anadio musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
                break;

            case "letra bendita":
            case "letra prohibida":
                {
                    const modoMusas = getModoMusas();
                    modoMusas.addMusa(id_jugador, payload_musa);
                    entregarInspiracionEnColaAEscritoraActiva(modoMusas, id_jugador);
                }
                registrar(`[modo_musas] Se anadio musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
                break;
        }
        emitirNubeInspiracionEstado(null, true);
    });
}

module.exports = {
    construirEventoFeedbackMusaInspiracion,
    registrarCanalesInspiracion
};
