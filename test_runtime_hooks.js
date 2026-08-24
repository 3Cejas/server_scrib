function crearRuntimeTestHooks({
    socket,
    io,
    motorModos,
    partidaSync,
    modeState,
    cycleState,
    limpiezasModo,
    limpiarTimersPalabras,
    limpiarTimersRonda,
    cancelarCambioPalabra,
    timersPartida,
    getModoMusas,
    registrarTimelineModo,
    emitirPedirInspiracionMusa,
    emitirActivarModo,
    statsLive,
    payloadStatsLive,
    emitirStatsLive,
    emitirNubeInspiracionEstado,
    construirEstadoTest,
    obtenerIdJugadorValido,
    construirPayloadCount,
    resurreccion,
    reiniciarEstadoPartida,
    calentamientoGestor,
    preShowMusas = null
}) {
    const forzarModoTest = (payload = {}) => {
        const modoSolicitado = typeof payload.mode === 'string'
            ? payload.mode.trim()
            : (typeof payload.modo === 'string' ? payload.modo.trim() : '');
        if (!modoSolicitado || !motorModos.tieneModo(modoSolicitado)) {
            return { ok: false, error: `Modo invalido: ${modoSolicitado}` };
        }
        if (preShowMusas && typeof preShowMusas.cerrar === 'function') {
            preShowMusas.cerrar('inicio_partida_test');
        }
        limpiarTimersPalabras();
        limpiarTimersRonda();
        if (modeState.modoActual && limpiezasModo[modeState.modoActual]) {
            limpiezasModo[modeState.modoActual](socket);
        }
        cycleState.finDelJuego = false;
        cycleState.finJ1 = false;
        cycleState.finJ2 = false;
        cycleState.estadoJugadores[1].finished = false;
        cycleState.estadoJugadores[2].finished = false;
        cycleState.estadoJugadores[1].inserts = -1;
        cycleState.estadoJugadores[2].inserts = -1;
        modeState.modoAnterior = modeState.modoActual;
        modeState.modoActual = modoSolicitado;
        partidaSync.siguienteModoSeq();
        registrarTimelineModo(modeState.modoActual, 'scrib_test:force_mode');

        if (modoSolicitado === 'letra bendita' || modoSolicitado === 'letra prohibida') {
            const letraSolicitada = typeof payload.letra === 'string' ? payload.letra.trim().slice(0, 1) : '';
            const modoMusas = getModoMusas();
            modoMusas.clearAll();
            modoMusas.start(1);
            modoMusas.start(2);
            if (modoSolicitado === 'letra bendita') {
                modeState.letraBendita = letraSolicitada || modeState.letraBendita || 'A';
                emitirPedirInspiracionMusa({ modo_actual: modeState.modoActual, letra_bendita: modeState.letraBendita });
                emitirActivarModo({ modo_actual: modeState.modoActual, letra_bendita: modeState.letraBendita });
            } else {
                modeState.letraProhibida = letraSolicitada || modeState.letraProhibida || 'E';
                emitirPedirInspiracionMusa({ modo_actual: modeState.modoActual, letra_prohibida: modeState.letraProhibida });
                emitirActivarModo({ modo_actual: modeState.modoActual, letra_prohibida: modeState.letraProhibida });
            }
        } else {
            motorModos.activarModo(modoSolicitado, socket);
        }

        statsLive.actualizar({
            ...payloadStatsLive(),
            modo_actual: modeState.modoActual
        });
        emitirStatsLive();
        emitirNubeInspiracionEstado(null, true);
        return { ok: true, mode: modeState.modoActual, state: construirEstadoTest() };
    };

    const forzarFinPlayerTest = (payload = {}) => {
        const playerId = obtenerIdJugadorValido(payload.player);
        if (!playerId) {
            return { ok: false, error: 'Player invalido' };
        }
        const finPayload = {
            player: playerId,
            motivo: payload.motivo === 'sin_palabras' ? 'sin_palabras' : 'scrib_test'
        };
        socket.broadcast.emit('fin_de_player_a_control', playerId);
        if (playerId === 1) {
            cycleState.finJ1 = true;
        } else {
            cycleState.finJ2 = true;
        }
        cancelarCambioPalabra(playerId);
        cycleState.estadoJugadores[playerId].finished = true;
        socket.broadcast.emit('fin', finPayload);
        const estadoConteoFin = partidaSync.obtenerConteo(playerId);
        const siguienteCountSeq = (
            estadoConteoFin
            && estadoConteoFin.modo_seq === partidaSync.obtenerModoSeq()
        )
            ? (Number(estadoConteoFin.count_seq) || 0) + 1
            : 1;
        const tiempoSeq = partidaSync.obtenerTiempoSeq(playerId);
        partidaSync.guardarConteo(playerId, {
            modo_seq: partidaSync.obtenerModoSeq(),
            count_seq: siguienteCountSeq,
            tiempo_seq: tiempoSeq,
            count_seconds: 0,
            count_text: 'Ãƒâ€šÃ‚Â¡Tiempo!'
        });
        io.emit('count', construirPayloadCount({
            player: playerId,
            count: 'Ã‚Â¡Tiempo!',
            count_seq: siguienteCountSeq,
            tiempo_seq: tiempoSeq
        }));
        if (modeState.modoActual && modeState.modoActual !== 'frase final' && payload.mostrar_resurreccion !== false) {
            resurreccion.mostrarMenuFinJugador(playerId);
        }
        timersPartida.cancelarCambioLetra();
        if (cycleState.finJ1 && cycleState.finJ2 && payload.reiniciar !== false) {
            reiniciarEstadoPartida(socket);
        }
        return { ok: true, player: playerId, state: construirEstadoTest() };
    };

    const forzarCalentamientoTest = (payload = {}) => {
        const resultado = calentamientoGestor.forzarEstado(payload);
        return { ...resultado, state: construirEstadoTest() };
    };

    return {
        forzarModoTest,
        forzarFinPlayerTest,
        forzarCalentamientoTest
    };
}

module.exports = {
    crearRuntimeTestHooks
};
