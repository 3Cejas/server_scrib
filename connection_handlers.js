const { BOLZANO_EVENTS } = require('./bolzano_events.js');
const { registrarCanalesGenerales } = require('./general_channels.js');
const { registrarCanalesInspiracion } = require('./inspiration_channels.js');
const { registrarCanalesRonda } = require('./player_round_channels.js');
const { registrarCanalesRoles } = require('./role_channels.js');
const { registrarCanalesEspectador } = require('./spectator_channels.js');
const { registrarTestHooks } = require('./test_hooks.js');
const { crearRuntimeTestHooks } = require('./test_runtime_hooks.js');
const { normalizarMusaClientId } = require('./ventaja_voting.js');
const { registrarCanalesVotacion } = require('./voting_channels.js');
const { instalarGuardiaMonitor } = require('./monitor_guard.js');
const { registerSimulationChannels } = require('./simulation_channels.js');

function registrarConexionScrib(socket, deps) {
    const {
        io,
        passwordRoles,
        accesoRoles,
        testHooksEnabled,
        controlState,
        obtenerEstadoEscritores,
        obtenerIdJugadorValido,
        getModoActual,
        partidaSync,
        construirPayloadCount,
        calentamiento,
        obtenerContadorMusas,
        payloadEstadoCalentamiento,
        emitirIdiomaJuego,
        setIdiomaJuego,
        emitirVistaEspectadorModo,
        emitirStatsLive,
        statsLive,
        emitirPuntuacionFinal,
        puntuacionFinal,
        getPulsacionesCompeticion,
        emitirNubeInspiracionEstado,
        emitirEstadoBanderasMusas,
        emitirCreditosShow,
        emitirFeedbackMusas,
        emitirEstadoRegaloBanderaMusas,
        sincronizarEstadoMusa,
        espectador,
        creditosShow,
        resolverModoVistaEspectador,
        bolzanoCalentamientoGestor,
        rolesConectados,
        sesionesEscritor,
        calentamientoGestor,
        musasAuxiliares,
        normalizarNombreMusa,
        sincronizarSocketRecienConectado,
        emitirEstadoDramaturgia,
        simuladorPartidas,
        registrar,
        teleprompter,
        writerChannels,
        activarSocketsExtratextuales,
        partidaLifecycle,
        estadoCicloPartida,
        timersPartida,
        limpiezasModo,
        limpiarTimersPalabras,
        limpiarTimersRonda,
        motorModos,
        avanzarModoSeguro,
        reiniciarEstadoPartida,
        emitirTempModos,
        cancelarCambioPalabra,
        nubeInspiracion,
        getModoBonus,
        getModoMalditas,
        getModoMusas,
        votacionVentaja,
        votacionRepentizado,
        estadoMotorModos,
        registrarTimelineModo,
        emitirPedirInspiracionMusa,
        emitirActivarModo,
        payloadStatsLive,
        construirEstadoTest,
        resetearEstadoAuxiliarParaTests,
        emitirModoActual,
        emitirEstadoPalabrasMusasControl,
        payloadEstadoPalabrasMusasControl,
        emitirEstadoVotacionVentaja,
        calentamientoState,
        emitirEstadoCalentamiento,
        cerrarVotacionVentajaForzada,
        abrirVotacionVentajaForzada,
        registrarDesventajaAplicada,
        pausarDesventajasActivas,
        reanudarDesventajasActivas,
        setPartidaPausada,
        isPartidaPausada,
        isFinDelJuego,
        registrarInspiracionCompeticion,
        registrarInfraccionCompeticion,
        pausarRelojPartida,
        reanudarRelojPartida,
        registrarPulsacionCompeticion,
        competicionRondas,
        ayudaMusas,
        preShowMusas,
        videoTutorialPreShow
    } = deps;

    const query = socket && socket.handshake && socket.handshake.query;
    socket.monitor_pantalla_solicitada = Boolean(
        query
        && String(query.dramaturgia_monitor || "") === "1"
    );
    instalarGuardiaMonitor(socket);
    if (preShowMusas && typeof preShowMusas.registrarHandlers === "function") {
        preShowMusas.registrarHandlers(socket);
    }
    if (videoTutorialPreShow && typeof videoTutorialPreShow.registrarHandlers === "function") {
        videoTutorialPreShow.registrarHandlers(socket);
    }
    if (ayudaMusas && typeof ayudaMusas.registrarHandlers === "function") {
        ayudaMusas.registrarHandlers(socket);
    }

    registrarCanalesGenerales({
        socket,
        io,
        passwordRoles,
        accesoRoles,
        obtenerEstadoEscritores,
        obtenerIdJugadorValido,
        getModoActual,
        partidaSync,
        construirPayloadCount,
        sesionesEscritor,
        controlState,
        emitirEstadoPalabrasMusasControl,
        payloadEstadoPalabrasMusasControl
    });

    registrarCanalesEspectador({
        socket,
        calentamiento,
        obtenerContadorMusas,
        payloadEstadoCalentamiento,
        emitirIdiomaJuego,
        setIdiomaJuego,
        emitirVistaEspectadorModo,
        emitirStatsLive,
        statsLive,
        emitirPuntuacionFinal,
        puntuacionFinal,
        getPulsacionesCompeticion,
        emitirNubeInspiracionEstado,
        emitirEstadoBanderasMusas,
        emitirCreditosShow,
        emitirFeedbackMusas,
        emitirEstadoRegaloBanderaMusas,
        sincronizarEstadoMusa,
        espectador,
        creditosShow,
        resolverModoVistaEspectador
    });
    bolzanoCalentamientoGestor.registrarHandlers(socket);

    registrarCanalesRoles({
        socket,
        io,
        bolzanoEvents: BOLZANO_EVENTS,
        rolesConectados,
        sesionesEscritor,
        calentamientoGestor,
        bolzanoCalentamientoGestor,
        musasAuxiliares,
        normalizarMusaClientId,
        obtenerIdJugadorValido,
        normalizarNombreMusa,
        getNombreEscritxr: (player) => writerChannels.getNombreEquipo(player),
        emitirEstadoBanderasMusas,
        sincronizarEstadoMusa,
        sincronizarSocketRecienConectado,
        emitirEstadoDramaturgia,
        simuladorPartidas,
        registrarMusaEnCreditosPartida: rolesConectados.registrarMusaEnCreditosPartida,
        getPartidaActivaParaCreditos: () => Boolean(estadoCicloPartida && estadoCicloPartida.modoActual && !estadoCicloPartida.finDelJuego),
        emitirEstadoVideoTutorial: () => videoTutorialPreShow && videoTutorialPreShow.emitirEstado(),
        autorizarRegistroControl: (_socket, payload) => (
            testHooksEnabled
                ? { ok: true, rol: "control", expires_ts: 0 }
                : accesoRoles.autorizarControl(payload)
        ),
        registrar
    });

    teleprompter.registrarHandlers(socket);
    writerChannels.emitirNombres(io);
    writerChannels.registrarHandlers(socket);
    calentamientoGestor.registrarHandlers(socket);
    activarSocketsExtratextuales(socket);

    partidaLifecycle.registrarHandlers(socket);
    registrarCanalesRonda({
        socket,
        io,
        state: estadoCicloPartida,
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
        registrarDesventajaAplicada,
        pausarDesventajasActivas,
        reanudarDesventajasActivas,
        pausarRelojPartida,
        reanudarRelojPartida,
        registrarPulsacionCompeticion,
        setPartidaPausada,
        sesionesEscritor,
        registrar
    });
    registrarCanalesInspiracion({
        socket,
        io,
        musasAuxiliares,
        nubeInspiracion,
        getModoActual,
        getModoBonus,
        getModoMalditas,
        getModoMusas,
        obtenerIdJugadorValido,
        obtenerMusaActiva: rolesConectados.obtenerMusaActiva,
        normalizarNombreMusa,
        normalizarMusaClientId,
        emitirNubeInspiracionEstado,
        emitirEstadoBanderasMusas,
        emitirFeedbackMusas,
        emitirEstadoRegaloBanderaMusas,
        sesionesEscritor,
        getModoSeq: () => partidaSync.obtenerModoSeq(),
        isPartidaPausada,
        isFinDelJuego,
        registrarInspiracionCompeticion,
        registrarInfraccionCompeticion,
        registrar
    });
    registrarCanalesVotacion({
        socket,
        votacionRepentizado
    });
    registerSimulationChannels({
        socket,
        simulator: simuladorPartidas
    });

    const {
        forzarModoTest,
        forzarFinPlayerTest,
        forzarCalentamientoTest
    } = crearRuntimeTestHooks({
        socket,
        io,
        motorModos,
        partidaSync,
        modeState: estadoMotorModos,
        cycleState: estadoCicloPartida,
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
        reiniciarEstadoPartida,
        calentamientoGestor,
        preShowMusas,
        videoTutorialPreShow,
        iniciarRondaCompeticion: (modo) => competicionRondas && competicionRondas.iniciarRonda(modo)
    });
    registrarTestHooks({
        socket,
        enabled: testHooksEnabled,
        construirEstadoTest,
        reiniciarEstadoPartida,
        resetearEstadoAuxiliarParaTests,
        partidaSync,
        io,
        emitirModoActual,
        teleprompter,
        emitirEstadoBanderasMusas,
        emitirFeedbackMusas,
        emitirEstadoRegaloBanderaMusas,
        emitirEstadoVotacionVentaja,
        votacionVentaja,
        calentamiento: calentamientoState,
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
        preShowMusas,
        videoTutorialPreShow,
        ayudaMusas
    });
}

module.exports = {
    registrarConexionScrib
};
