function registrarCanalesRonda({
    socket,
    io,
    state,
    partidaSync,
    timersPartida,
    limpiezasModo,
    limpiarTimersPalabras,
    limpiarTimersRonda,
    activarSocketsExtratextuales,
    construirPayloadCount,
    obtenerIdJugadorValido,
    motorModos,
    avanzarModoSeguro,
    reiniciarEstadoPartida,
    emitirTempModos,
    cancelarCambioPalabra,
    registrarDesventajaAplicada = null,
    pausarDesventajasActivas = null,
    reanudarDesventajasActivas = null,
    pausarRelojPartida = null,
    reanudarRelojPartida = null,
    registrarPulsacionCompeticion = null,
    setPartidaPausada = null,
    sesionesEscritor = null,
    registrar = () => {}
}) {
    const esEventoEscritorInactivo = (player = socket && socket.escritxr) => {
        const idJugador = obtenerIdJugadorValido(player);
        return Boolean(
            idJugador
            && sesionesEscritor
            && socket
            && socket.escritxr
            && !sesionesEscritor.esActiva(socket, idJugador)
        );
    };

    socket.on('count', (datos = {}) => {
        const idJugador = obtenerIdJugadorValido(datos.player);
        if (!idJugador) {
            return;
        }
        if (esEventoEscritorInactivo(idJugador)) {
            return;
        }
        const modoSeqActual = partidaSync.obtenerModoSeq();
        const modoSeqPayload = Number(datos && datos.modo_seq);
        if (Number.isFinite(modoSeqPayload) && modoSeqPayload < modoSeqActual) {
            return;
        }
        const tiempoSeqPayload = Number(datos && datos.tiempo_seq);
        if (Number.isFinite(tiempoSeqPayload) && tiempoSeqPayload < partidaSync.obtenerTiempoSeq(idJugador)) {
            return;
        }
        const countSeqPayload = Number(datos && datos.count_seq);
        if (Number.isFinite(countSeqPayload) && countSeqPayload > 0) {
            const estadoConteo = partidaSync.obtenerConteo(idJugador) || { modo_seq: 0, count_seq: 0, tiempo_seq: 0 };
            const tiempoSeqActual = Number.isFinite(tiempoSeqPayload)
                ? Math.max(0, Math.trunc(tiempoSeqPayload))
                : partidaSync.obtenerTiempoSeq(idJugador);
            if (
                estadoConteo.modo_seq === modoSeqActual
                && estadoConteo.tiempo_seq === tiempoSeqActual
                && countSeqPayload <= estadoConteo.count_seq
            ) {
                return;
            }
            partidaSync.guardarConteo(idJugador, {
                modo_seq: modoSeqActual,
                count_seq: Math.trunc(countSeqPayload),
                tiempo_seq: tiempoSeqActual,
                count_seconds: partidaSync.convertirTextoCountASegundos(String(datos && datos.count ? datos.count : "")),
                count_text: typeof datos?.count === "string" ? datos.count : ""
            });
        }

        state.estadoJugadores[idJugador].finished = false;
        if (datos.count === "Ã‚Â¡Tiempo!") {
            state.estadoJugadores[idJugador].finished = true;
            state.setNuevaPalabra(idJugador, false);
            cancelarCambioPalabra(idJugador);
        }
        if (idJugador === 1) {
            registrar(state.modosPendientes);
            registrar(state.modoActual);
            registrar("TIEMPO LIMITE", state.tiempoCambioModos);
        } else {
            registrar("holaaaa", datos);
        }

        if (state.finDelJuego) {
            limpiarTimersRonda();
            const modo = state.modoActual;
            if (modo && limpiezasModo[modo]) {
                limpiezasModo[modo](socket);
            }
            activarSocketsExtratextuales(socket);
            state.modosPendientes = [...state.listaModos];
            state.modoAnterior = "";
            state.modoActual = "";
        }
        socket.broadcast.emit('count', construirPayloadCount(datos));
    });

    socket.on('pausar', (evento) => {
        if (esEventoEscritorInactivo()) {
            return;
        }
        timersPartida.cancelarIntervaloModos();
        if (timersPartida && typeof timersPartida.cancelarInicio === 'function') {
            timersPartida.cancelarInicio();
        }
        limpiarTimersPalabras();
        if (typeof setPartidaPausada === 'function') {
            setPartidaPausada(true);
        }
        if (typeof pausarDesventajasActivas === 'function') {
            pausarDesventajasActivas();
        }
        if (typeof pausarRelojPartida === 'function') {
            pausarRelojPartida();
        }
        activarSocketsExtratextuales(socket);
        socket.broadcast.emit('pausar_js', evento);
    });

    socket.on('reanudar', (evento) => {
        if (esEventoEscritorInactivo()) {
            return;
        }
        if (!state.modoActual) {
            return;
        }
        if (typeof reanudarDesventajasActivas === 'function') {
            reanudarDesventajasActivas();
        }
        if (typeof setPartidaPausada === 'function') {
            setPartidaPausada(false);
        }
        if (typeof reanudarRelojPartida === 'function') {
            reanudarRelojPartida();
        }
        partidaSync.siguienteModoSeq();
        motorModos.activarModo(state.modoActual, socket);
        motorModos.temp_modos(socket, { continuar: true });
        socket.broadcast.emit('reanudar_js', evento);
    });

    socket.on('reanudar_modo', (evento) => {
        if (esEventoEscritorInactivo()) {
            return;
        }
        if (state.modoActual !== 'tertulia') {
            return;
        }
        if (typeof reanudarDesventajasActivas === 'function') {
            reanudarDesventajasActivas();
        }
        if (typeof setPartidaPausada === 'function') {
            setPartidaPausada(false);
        }
        if (typeof reanudarRelojPartida === 'function') {
            reanudarRelojPartida();
        }
        state.segundosTranscurridos = 0;
        avanzarModoSeguro(socket, () => motorModos.modos_de_juego(socket), 'reanudar_modo');
        motorModos.temp_modos(socket);
        socket.broadcast.emit('reanudar_js', evento);
    });

    socket.on('saltar_tertulia', () => {
        if (esEventoEscritorInactivo()) {
            return;
        }
        if (state.modoActual !== 'tertulia') {
            return;
        }
        if (typeof reanudarDesventajasActivas === 'function') {
            reanudarDesventajasActivas();
        }
        if (typeof setPartidaPausada === 'function') {
            setPartidaPausada(false);
        }
        if (typeof reanudarRelojPartida === 'function') {
            reanudarRelojPartida();
        }
        state.segundosTranscurridos = 0;
        avanzarModoSeguro(socket, () => motorModos.modos_de_juego(socket), 'saltar_tertulia');
        motorModos.temp_modos(socket);
        emitirTempModos();
        socket.broadcast.emit('reanudar_js', { motivo: 'saltar_tertulia' });
    });

    socket.on('enviar_putada_a_jx', (evento) => {
        if (!evento) {
            return;
        }
        const idJugador = obtenerIdJugadorValido(evento.player);
        if (!idJugador) {
            return;
        }
        if (idJugador === 1) {
            let payloadDesventaja = null;
            if (typeof registrarDesventajaAplicada === 'function') {
                payloadDesventaja = registrarDesventajaAplicada({
                    player: 1,
                    putada: evento.putada,
                    duracion_ms: evento.duracion_ms
                });
            }
            socket.broadcast.emit('enviar_putada_de_j1', payloadDesventaja || {
                player: 1,
                putada: evento.putada,
                duracion_ms: evento.duracion_ms
            });
        } else {
            let payloadDesventaja = null;
            if (typeof registrarDesventajaAplicada === 'function') {
                payloadDesventaja = registrarDesventajaAplicada({
                    player: 2,
                    putada: evento.putada,
                    duracion_ms: evento.duracion_ms
                });
            }
            socket.broadcast.emit('enviar_putada_de_j2', payloadDesventaja || {
                player: 2,
                putada: evento.putada,
                duracion_ms: evento.duracion_ms
            });
        }
    });

    socket.on('tecla_jugador', (evento) => {
        if (!evento || typeof evento.code !== 'string') {
            return;
        }
        const idJugador = obtenerIdJugadorValido(socket && socket.escritxr);
        if (!idJugador || esEventoEscritorInactivo(idJugador)) {
            return;
        }
        io.emit('tecla_jugador_control', {
            player: idJugador,
            code: evento.code,
            key: evento.key || ''
        });
        if (typeof registrarPulsacionCompeticion === 'function') {
            registrarPulsacionCompeticion(idJugador, evento);
        }
    });
}

module.exports = {
    registrarCanalesRonda
};
