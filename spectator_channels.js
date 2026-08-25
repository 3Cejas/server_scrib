function registrarCanalesEspectador({
    socket,
    calentamiento,
    obtenerContadorMusas,
    payloadEstadoCalentamiento,
    emitirIdiomaJuego,
    setIdiomaJuego,
    emitirVistaEspectadorModo,
    emitirStatsLive,
    statsLive,
    emitirPuntuacionFinal = () => null,
    puntuacionFinal = null,
    getPulsacionesCompeticion = () => ({ 1: 0, 2: 0 }),
    emitirNubeInspiracionEstado,
    emitirEstadoBanderasMusas,
    emitirCreditosShow,
    emitirFeedbackMusas,
    emitirEstadoRegaloBanderaMusas = () => {},
    sincronizarEstadoMusa,
    espectador,
    creditosShow,
    resolverModoVistaEspectador
}) {
    const resolverCallback = (payload, callback) => (
        typeof payload === "function" ? payload : callback
    );
    const opcionesDatosPuntuacion = () => ({
        datosRecibidos: statsLive && typeof statsLive.payloadDatosRecibidos === "function"
            ? statsLive.payloadDatosRecibidos()
            : undefined
    });
    const capturarPuntuacionPendiente = () => {
        if (!puntuacionFinal || typeof puntuacionFinal.capturarPendiente !== "function") {
            return {
                ok: false,
                code: "PUNTUACION_NO_DISPONIBLE",
                puntuacion: puntuacionFinal && typeof puntuacionFinal.payload === "function"
                    ? puntuacionFinal.payload()
                    : null
            };
        }
        const statsBase = statsLive && typeof statsLive.payload === "function"
            ? statsLive.payload()
            : {};
        const pulsaciones = getPulsacionesCompeticion() || {};
        const playersBase = statsBase.players && typeof statsBase.players === "object" ? statsBase.players : {};
        const stats = {
            ...statsBase,
            players: {
                1: { ...(playersBase[1] || {}), pulsacionesTotal: Number(pulsaciones[1]) || 0 },
                2: { ...(playersBase[2] || {}), pulsacionesTotal: Number(pulsaciones[2]) || 0 }
            }
        };
        return puntuacionFinal.capturarPendiente(stats, opcionesDatosPuntuacion());
    };

    socket.emit("actualizar_contador_musas", obtenerContadorMusas());
    socket.emit("calentamiento_vista", { activo: calentamiento.vista });
    socket.emit("calentamiento_estado_espectador", payloadEstadoCalentamiento());
    emitirIdiomaJuego(socket);
    emitirVistaEspectadorModo(socket);
    emitirStatsLive(socket);
    emitirPuntuacionFinal(socket);
    emitirNubeInspiracionEstado(socket, true);
    emitirEstadoBanderasMusas(socket);
    emitirEstadoRegaloBanderaMusas(socket);
    emitirCreditosShow(socket);

    socket.on("pedir_calentamiento_estado", () => {
        socket.emit("calentamiento_estado_espectador", payloadEstadoCalentamiento());
    });

    socket.on("pedir_vista_espectador_modo", () => {
        emitirVistaEspectadorModo(socket);
    });

    socket.on("pedir_stats_live", () => {
        emitirStatsLive(socket);
    });

    socket.on("stats_live_actualizar", (payload = {}, callback = null) => {
        if (!socket.control) {
            if (typeof callback === "function") {
                callback({ ok: false, code: "NOT_AUTHORIZED" });
            }
            return;
        }
        if (typeof statsLive.actualizarDesdeControl === "function") {
            statsLive.actualizarDesdeControl(payload);
        } else {
            statsLive.actualizar(payload);
        }
        emitirStatsLive();
        if (typeof callback === "function") {
            callback({ ok: true });
        }
    });

    socket.on("pedir_puntuacion_final", (_payload = {}, callback = null) => {
        const responder = resolverCallback(_payload, callback);
        const salida = emitirPuntuacionFinal(socket);
        if (typeof responder === "function") {
            responder(salida);
        }
    });

    socket.on("capturar_puntuacion_final", (_payload = {}, callback = null) => {
        const responder = resolverCallback(_payload, callback);
        if (!socket.control) {
            if (typeof responder === "function") {
                responder({ ok: false, code: "NOT_AUTHORIZED" });
            }
            return;
        }
        const resultado = capturarPuntuacionPendiente();
        if (typeof responder === "function") {
            responder(resultado);
        }
    });

    socket.on("pedir_nube_inspiracion", () => {
        emitirNubeInspiracionEstado(socket, true);
    });

    socket.on("pedir_estado_banderas_musas", () => {
        emitirEstadoBanderasMusas(socket);
    });

    socket.on("pedir_estado_regalo_bandera_musas", () => {
        emitirEstadoRegaloBanderaMusas(socket);
    });

    socket.on("pedir_creditos_estado", () => {
        emitirCreditosShow(socket);
    });

    socket.on("pedir_feedback_musas_estado", () => {
        emitirFeedbackMusas(socket);
    });

    socket.on("pedir_idioma_actual", () => {
        emitirIdiomaJuego(socket);
    });

    socket.on("pedir_estado_musa", () => {
        sincronizarEstadoMusa(socket);
    });

    socket.on("creditos_actualizar", (payload = {}) => {
        const creditosRecibidos = (payload && typeof payload === "object" && payload.creditos)
            ? payload.creditos
            : payload;
        creditosShow.actualizar(creditosRecibidos);
        emitirCreditosShow();
    });

    socket.on("cambiar_idioma_global", (payload = {}) => {
        const idiomaRecibido = (payload && typeof payload === "object")
            ? payload.idioma
            : payload;
        setIdiomaJuego(idiomaRecibido);
        emitirIdiomaJuego();
    });

    socket.on("mostrar_creditos_espectador", (payload = {}) => {
        if (payload && typeof payload === "object" && payload.creditos) {
            creditosShow.actualizar(payload.creditos);
        }
        espectador.cambiarModo("creditos");
        creditosShow.incrementarAnimacion();
        emitirVistaEspectadorModo();
        emitirCreditosShow();
    });

    socket.on("cambiar_vista_espectador_modo", (payload = {}) => {
        const modoEntrada = payload && typeof payload.modo === "string"
            ? payload.modo.trim().toLowerCase()
            : "";
        if (
            !socket.control
            && (modoEntrada === "puntuacion" || resolverModoVistaEspectador() === "puntuacion")
        ) {
            return;
        }
        if (modoEntrada === "puntuacion") {
            const estadoPuntuacion = puntuacionFinal && typeof puntuacionFinal.payload === "function"
                ? puntuacionFinal.payload()
                : null;
            if (!estadoPuntuacion || estadoPuntuacion.disponible !== true) {
                return;
            }
        }
        const modoSolicitado = espectador.cambiarModo(modoEntrada);
        if (modoSolicitado === "creditos") {
            creditosShow.incrementarAnimacion();
        }
        emitirVistaEspectadorModo();
        emitirCreditosShow();
        if (modoSolicitado === "stats") {
            emitirStatsLive();
        } else if (modoSolicitado === "puntuacion") {
            emitirPuntuacionFinal();
        } else if (modoSolicitado === "nube_inspiracion") {
            emitirNubeInspiracionEstado(null, true);
        }
    });

    socket.on("mostrar_puntuacion_final", (_payload = {}, callback = null) => {
        const responder = resolverCallback(_payload, callback);
        if (!socket.control) {
            if (typeof responder === "function") {
                responder({ ok: false, code: "NOT_AUTHORIZED" });
            }
            return;
        }
        let estado = puntuacionFinal && typeof puntuacionFinal.payload === "function"
            ? puntuacionFinal.payload()
            : null;
        if (!estado || estado.disponible !== true) {
            const captura = capturarPuntuacionPendiente();
            if (captura && captura.ok && captura.puntuacion) {
                estado = captura.puntuacion;
            }
        }
        if (!estado || estado.disponible !== true) {
            if (typeof responder === "function") {
                responder({ ok: false, code: "PUNTUACION_NO_DISPONIBLE" });
            }
            return;
        }
        espectador.cambiarModo("puntuacion");
        const vista = emitirVistaEspectadorModo();
        emitirPuntuacionFinal();
        if (typeof responder === "function") {
            responder({ ok: true, vista, puntuacion: estado });
        }
    });

    const navegarPuntuacion = (direccion, callback = null) => {
        if (!socket.control) {
            if (typeof callback === "function") {
                callback({ ok: false, code: "NOT_AUTHORIZED" });
            }
            return;
        }
        if (resolverModoVistaEspectador() !== "puntuacion") {
            if (typeof callback === "function") {
                callback({ ok: false, code: "PUNTUACION_NO_VISIBLE" });
            }
            return;
        }
        const paso = espectador.navegarPuntuacion(direccion);
        const vista = emitirVistaEspectadorModo();
        if (typeof callback === "function") {
            callback({ ok: true, paso, vista });
        }
    };

    socket.on("puntuacion_final_siguiente", (_payload = {}, callback = null) => {
        navegarPuntuacion(1, resolverCallback(_payload, callback));
    });

    socket.on("puntuacion_final_anterior", (_payload = {}, callback = null) => {
        navegarPuntuacion(-1, resolverCallback(_payload, callback));
    });

    socket.on("ocultar_puntuacion_final", (_payload = {}, callback = null) => {
        const responder = resolverCallback(_payload, callback);
        if (!socket.control) {
            if (typeof responder === "function") {
                responder({ ok: false, code: "NOT_AUTHORIZED" });
            }
            return;
        }
        espectador.cambiarModo("partida");
        const vista = emitirVistaEspectadorModo();
        if (typeof responder === "function") {
            responder({ ok: true, vista });
        }
    });

    socket.on("stats_slide_control_navegar", (payload = {}) => {
        if (resolverModoVistaEspectador() !== "stats") {
            return;
        }
        const direccion = payload && payload.direccion === "prev"
            ? -1
            : payload && payload.direccion === "next"
                ? 1
                : 0;
        if (!direccion) {
            return;
        }
        espectador.navegarStats(direccion);
        emitirVistaEspectadorModo();
    });

    socket.on("ajustar_escala_espectador", (payload = {}) => {
        const accion = typeof payload?.accion === "string"
            ? payload.accion.trim().toLowerCase()
            : "";
        const tieneValor = Object.prototype.hasOwnProperty.call(payload || {}, "valor");
        if (accion !== "reset" && accion !== "down" && accion !== "up" && !tieneValor) {
            return;
        }
        espectador.ajustarEscala(payload);
        emitirVistaEspectadorModo();
    });
}

module.exports = {
    registrarCanalesEspectador
};
