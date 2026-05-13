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
    socket.emit("actualizar_contador_musas", obtenerContadorMusas());
    socket.emit("calentamiento_vista", { activo: calentamiento.vista });
    socket.emit("calentamiento_estado_espectador", payloadEstadoCalentamiento());
    emitirIdiomaJuego(socket);
    emitirVistaEspectadorModo(socket);
    emitirStatsLive(socket);
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

    socket.on("stats_live_actualizar", (payload = {}) => {
        statsLive.actualizar(payload);
        emitirStatsLive();
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
        const modoSolicitado = espectador.cambiarModo(payload && payload.modo);
        if (modoSolicitado === "creditos") {
            creditosShow.incrementarAnimacion();
        }
        emitirVistaEspectadorModo();
        emitirCreditosShow();
        if (modoSolicitado === "stats") {
            emitirStatsLive();
        } else if (modoSolicitado === "nube_inspiracion") {
            emitirNubeInspiracionEstado(null, true);
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
