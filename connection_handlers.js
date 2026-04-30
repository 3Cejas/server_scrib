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

function registrarConexionScrib(socket, deps) {
    const {
        io,
        passwordRoles,
        testHooksEnabled,
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
        emitirNubeInspiracionEstado,
        emitirEstadoBanderasMusas,
        emitirCreditosShow,
        emitirFeedbackMusas,
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
        resurreccion,
        estadoMotorModos,
        registrarTimelineModo,
        emitirPedirInspiracionMusa,
        emitirActivarModo,
        payloadStatsLive,
        construirEstadoTest,
        resetearEstadoAuxiliarParaTests,
        emitirModoActual,
        emitirEstadoVotacionVentaja,
        calentamientoState,
        emitirEstadoCalentamiento,
        payloadEstadoResurreccion,
        cerrarVotacionVentajaForzada,
        abrirVotacionVentajaForzada
    } = deps;

    registrarCanalesGenerales({
        socket,
        io,
        passwordRoles,
        obtenerEstadoEscritores,
        obtenerIdJugadorValido,
        getModoActual,
        partidaSync,
        construirPayloadCount
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
        emitirNubeInspiracionEstado,
        emitirEstadoBanderasMusas,
        emitirCreditosShow,
        emitirFeedbackMusas,
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
        emitirEstadoBanderasMusas,
        sincronizarEstadoMusa,
        sincronizarSocketRecienConectado,
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
        normalizarNombreMusa,
        emitirNubeInspiracionEstado,
        emitirEstadoBanderasMusas,
        emitirFeedbackMusas,
        registrar
    });
    registrarCanalesVotacion({
        socket,
        votacionVentaja,
        votacionRepentizado
    });
    resurreccion.registrarHandlers(socket);

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
        resurreccion,
        reiniciarEstadoPartida,
        calentamientoGestor
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
        emitirEstadoVotacionVentaja,
        votacionVentaja,
        calentamiento: calentamientoState,
        emitirEstadoCalentamiento,
        payloadEstadoResurreccion,
        emitirNubeInspiracionEstado,
        emitirStatsLive,
        forzarModoTest,
        cerrarVotacionVentajaForzada,
        abrirVotacionVentajaForzada,
        forzarFinPlayerTest,
        obtenerIdJugadorValido,
        musasAuxiliares,
        forzarCalentamientoTest
    });
}

module.exports = {
    registrarConexionScrib
};
