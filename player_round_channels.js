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
    registrar = () => {}
}) {
    socket.on('count', (datos = {}) => {
        const idJugador = obtenerIdJugadorValido(datos.player);
        if (!idJugador) {
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
        limpiarTimersPalabras();
        activarSocketsExtratextuales(socket);
    });

    socket.on('fin_de_control', (evento) => {
        const payload = (evento && typeof evento === 'object') ? evento : { player: evento };
        const idJugador = obtenerIdJugadorValido(payload && payload.player);
        if (!idJugador) {
            return;
        }
        const finPayload = {
            player: idJugador,
            forzar_fin: payload.forzar_fin !== false,
            origen: 'control',
            suprimir_confetti_espectador: payload.suprimir_confetti_espectador !== false
        };
        state.marcarFinJugador(idJugador, true);
        cancelarCambioPalabra(idJugador);
        socket.broadcast.emit('fin', finPayload);
        timersPartida.cancelarCambioLetra();
        if (state.finJ1 && state.finJ2) {
            reiniciarEstadoPartida(socket);
        }
    });

    socket.on('fin_de_player', (evento) => {
        const payload = (evento && typeof evento === 'object') ? evento : { player: evento };
        const idJugador = obtenerIdJugadorValido(payload && payload.player);
        if (!idJugador) {
            return;
        }
        const finPayload = {
            player: idJugador,
            motivo: payload && payload.motivo === 'sin_palabras' ? 'sin_palabras' : undefined
        };
        socket.broadcast.emit('fin_de_player_a_control', idJugador);
        state.marcarFinJugador(idJugador, true);
        cancelarCambioPalabra(idJugador);
        socket.broadcast.emit('fin', finPayload);
        timersPartida.cancelarCambioLetra();
        if (state.finJ1 && state.finJ2) {
            reiniciarEstadoPartida(socket);
        }
    });

    socket.on('reanudar', (evento) => {
        if (!state.modoActual) {
            return;
        }
        partidaSync.siguienteModoSeq();
        motorModos.activarModo(state.modoActual, socket);
        socket.broadcast.emit('reanudar_js', evento);
    });

    socket.on('reanudar_modo', (evento) => {
        avanzarModoSeguro(socket, () => motorModos.modos_de_juego(socket), 'reanudar_modo');
        socket.broadcast.emit('reanudar_js', evento);
    });

    socket.on('saltar_tertulia', () => {
        if (state.modoActual !== 'tertulia') {
            return;
        }
        state.segundosTranscurridos = 0;
        avanzarModoSeguro(socket, () => motorModos.modos_de_juego(socket), 'saltar_tertulia');
        emitirTempModos();
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
            socket.broadcast.emit('enviar_putada_de_j1', evento.putada);
        } else {
            socket.broadcast.emit('enviar_putada_de_j2', evento.putada);
        }
    });

    socket.on('tecla_jugador', (evento) => {
        if (!evento || typeof evento.code !== 'string') {
            return;
        }
        const idJugador = obtenerIdJugadorValido(evento.player) || socket.escritxr;
        if (!idJugador) {
            return;
        }
        io.emit('tecla_jugador_control', {
            player: idJugador,
            code: evento.code,
            key: evento.key || ''
        });
    });
}

module.exports = {
    registrarCanalesRonda
};
