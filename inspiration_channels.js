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

const reenviarASalaUnaVez = (socket, io, entrada, salida, sala) => {
    if (!socket._inspiration_forwarded_room_events) {
        socket._inspiration_forwarded_room_events = new Set();
    }
    const key = `${entrada}->${salida}@${sala}`;
    if (socket._inspiration_forwarded_room_events.has(key)) return;
    socket._inspiration_forwarded_room_events.add(key);

    socket.on(entrada, (payload) => {
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
    emitirNubeInspiracionEstado = () => {},
    emitirEstadoBanderasMusas = () => {},
    emitirFeedbackMusas = () => {},
    registrar = () => {}
}) {
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
    });

    socket.on("regalo_pdf_musas", (payload = {}) => {
        const salida = musasAuxiliares.guardarRegalo(payload);
        if (!salida) {
            return;
        }
        io.to(`musa_j${salida.player}`).emit("regalo_pdf_musas", salida);
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
        socket.broadcast.emit("recibir_feedback_modificador", { id_mod, player: id_jugador });
    });

    reenviarASalaUnaVez(socket, io, "feedback_de_j1", "feedback_a_j2", "j2");
    reenviarASalaUnaVez(socket, io, "feedback_de_j2", "feedback_a_j1", "j1");

    const reenviarFeedbackInspiracionMusa = (eventoEntrada, escritxrId) => {
        socket.on(eventoEntrada, (payload) => {
            const salida = construirEventoFeedbackMusaInspiracion(payload, escritxrId, normalizarNombreMusa);
            if (!salida) return;
            io.to(`musa_j${salida.musa_objetivo}`).emit("feedback_musa_inspiracion", salida);
        });
    };
    reenviarFeedbackInspiracionMusa("feedback_de_j1", 1);
    reenviarFeedbackInspiracionMusa("feedback_de_j2", 2);

    socket.on("feedback_musa_inspiracion", (payload = {}) => {
        const escritxrId = obtenerIdJugadorValido(payload.player) || socket.escritxr;
        const salida = construirEventoFeedbackMusaInspiracion(payload, escritxrId, normalizarNombreMusa);
        if (!salida) return;
        io.to(`musa_j${salida.musa_objetivo}`).emit("feedback_musa_inspiracion", salida);
    });

    socket.on("intento_prohibido", (payload) => {
        const playerId = obtenerIdJugadorValido(payload && payload.player);
        if (!playerId) {
            return;
        }
        const salida = { ...(payload || {}), player: playerId };
        io.emit("intento_prohibido", salida);
    });

    socket.on("nueva_palabra", (id_jugador) => {
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        getModoBonus().handleRequest(id_jugador_valido);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_prohibida", (id_jugador) => {
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        getModoMalditas().handleRequest(id_jugador_valido);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_musa", (escritxr) => {
        const id_jugador = obtenerIdJugadorValido(escritxr);
        if (!id_jugador) {
            return;
        }
        registrar(`[socket] peticion de musa para jugador ${id_jugador}`);
        getModoMusas().handleRequest(id_jugador);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_bonus", ({ jugador } = {}) => {
        const id_jugador = obtenerIdJugadorValido(jugador);
        if (!id_jugador) {
            return;
        }
        getModoBonus().handleRequest(id_jugador);
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
        const payload_musa = { palabra, musa: nombre_musa };
        const modo_actual = getModoActual();
        nubeInspiracion.registrarInspiracion(id_jugador, {
            palabra,
            musa: nombre_musa,
            modo_actual
        });

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
                getModoMusas().addMusa(id_jugador, payload_musa);
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
