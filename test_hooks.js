const resolverHookTestArgs = (payload, callback) => {
    if (typeof payload === 'function') {
        return {
            payload: {},
            callback: payload
        };
    }
    return {
        payload: (payload && typeof payload === 'object') ? payload : {},
        callback
    };
};

const responderHookTest = (socket, callback, eventName, payload) => {
    if (typeof callback === 'function') {
        callback(payload);
        return;
    }
    if (socket && typeof socket.emit === 'function') {
        socket.emit(eventName, payload);
    }
};

function registrarTestHooks({
    socket,
    enabled,
    construirEstadoTest,
    reiniciarEstadoPartida,
    resetearEstadoAuxiliarParaTests,
    partidaSync,
    io,
    emitirModoActual,
    teleprompter,
    emitirEstadoBanderasMusas,
    emitirFeedbackMusas,
    emitirEstadoRegaloBanderaMusas = () => {},
    emitirEstadoVotacionVentaja,
    votacionVentaja,
    calentamiento,
    emitirEstadoCalentamiento,
    emitirNubeInspiracionEstado,
    emitirStatsLive,
    forzarModoTest,
    cerrarVotacionVentajaForzada,
    abrirVotacionVentajaForzada,
    forzarFinPlayerTest,
    obtenerIdJugadorValido,
    musasAuxiliares,
    forzarCalentamientoTest,
    preShowMusas = null,
    videoTutorialPreShow = null,
    ayudaMusas = null
}) {
    if (!enabled) {
        return false;
    }

    socket.on('scrib_test:get_state', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        responderHookTest(socket, args.callback, 'scrib_test:state', construirEstadoTest());
    });

    socket.on('scrib_test:reset', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        reiniciarEstadoPartida(socket, {
            prepararPuntuacion: false,
            conservarStats: false,
            resetearPuntuacion: true
        });
        resetearEstadoAuxiliarParaTests();
        if (ayudaMusas && typeof ayudaMusas.reset === 'function') {
            ayudaMusas.reset();
        }
        partidaSync.siguienteModoSeq();
        io.emit('texto1', '');
        io.emit('texto2', '');
        io.emit('limpiar', { test: true });
        if (preShowMusas && typeof preShowMusas.abrir === 'function') {
            preShowMusas.abrir();
        }
        if (videoTutorialPreShow && typeof videoTutorialPreShow.abrirFase === 'function') {
            videoTutorialPreShow.abrirFase();
        }
        emitirModoActual();
        teleprompter.emitirEstado();
        emitirEstadoBanderasMusas();
        emitirFeedbackMusas();
        emitirEstadoRegaloBanderaMusas();
        emitirEstadoVotacionVentaja({
            activa: false,
            equipo: '',
            opciones: [],
            votos: votacionVentaja.snapshotVotos(),
            tiempo_restante_ms: 0,
            termina_en_ts: 0
        });
        io.emit('calentamiento_vista', { activo: calentamiento.vista });
        emitirEstadoCalentamiento();
        emitirNubeInspiracionEstado(null, true);
        emitirStatsLive();
        responderHookTest(socket, args.callback, 'scrib_test:reset:done', {
            ok: true,
            state: construirEstadoTest()
        });
    });

    socket.on('scrib_test:force_mode', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        responderHookTest(socket, args.callback, 'scrib_test:force_mode:done', forzarModoTest(args.payload));
    });

    socket.on('scrib_test:force_vote', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        const cerrar = args.payload.active === false || args.payload.activa === false || args.payload.close === true;
        const resultado = cerrar
            ? { ok: true, vote: cerrarVotacionVentajaForzada(args.payload), state: construirEstadoTest() }
            : { ok: true, vote: abrirVotacionVentajaForzada(args.payload), state: construirEstadoTest() };
        responderHookTest(socket, args.callback, 'scrib_test:force_vote:done', resultado);
    });

    socket.on('scrib_test:force_finish_player', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        responderHookTest(socket, args.callback, 'scrib_test:force_finish_player:done', forzarFinPlayerTest(args.payload));
    });

    socket.on('scrib_test:simulate_musa_heart', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        const equipo = obtenerIdJugadorValido(args.payload.player || args.payload.team || args.payload.equipo);
        if (!equipo) {
            responderHookTest(socket, args.callback, 'scrib_test:simulate_musa_heart:done', {
                ok: false,
                error: 'Equipo invalido'
            });
            return;
        }
        const resultado = musasAuxiliares.registrarCorazon({ equipo, respetarCooldown: false });
        responderHookTest(socket, args.callback, 'scrib_test:simulate_musa_heart:done', {
            ok: true,
            equipo,
            regalo_bandera: resultado && resultado.regalo_bandera ? resultado.regalo_bandera : null,
            state: construirEstadoTest()
        });
    });

    socket.on('scrib_test:force_warmup_state', (payload, callback) => {
        const args = resolverHookTestArgs(payload, callback);
        responderHookTest(socket, args.callback, 'scrib_test:force_warmup_state:done', forzarCalentamientoTest(args.payload));
    });

    return true;
}

module.exports = {
    registrarTestHooks,
    resolverHookTestArgs,
    responderHookTest
};
