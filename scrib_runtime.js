const { crearSincronizadorConexion } = require('./connection_sync.js');
const { registrarConexionScrib } = require('./connection_handlers.js');
const { activarSocketsExtratextuales } = require('./extratextual_channels.js');
const { crearRuntimeModos } = require('./mode_runtime.js');
const { crearMotorModos } = require('./mode_engine.js');
const { crearCicloPartida } = require('./partida_lifecycle.js');
const { crearGestorSincronizacionPartida } = require('./partida_sync.js');
const {
    crearGestorIdioma,
    extraerTextoPlano,
    normalizarNombreMusa,
    obtenerIdJugadorValido,
    repentizados
} = require('./runtime_config.js');
const {
    crearGestorResurreccionRuntime,
    crearGestoresAuxiliares,
    crearGestoresBase,
    crearGestoresVistaEstado
} = require('./runtime_managers.js');
const { crearRuntimeStateSnapshot } = require('./runtime_state_snapshot.js');
const { getRanges } = require('./time_ranges.js');
const { crearCanalesEscritor } = require('./writer_channels.js');

function crearRuntimeScrib({
    io,
    passwordRoles,
    testHooksEnabled = false,
    registrar = () => {}
}) {
    let partidaLifecycle;
    let motorModos;
    let writerChannels;
    let votacionVentaja;
    let votacionRepentizado;
    let calentamientoGestor;
    let calentamiento;

    const partidaSync = crearGestorSincronizacionPartida({ validarJugador: obtenerIdJugadorValido });
    const runtimeModos = crearRuntimeModos({
        io,
        partidaSync,
        validarJugador: obtenerIdJugadorValido,
        registrar
    });
    const {
        timersPartida,
        limpiezasModo,
        estadoMotorModos,
        estadoCicloPartida,
        estadoJugadores,
        construirPayloadInspiracionMusaActual,
        emitirActivarModo,
        emitirPedirInspiracionMusa,
        emitirTempModos,
        emitirNuevaLetra,
        emitirModoActual,
        construirPayloadCount,
        prepararParametrosInicio,
        limpiarTodosLosModos,
        limpiarTimersPalabras,
        cancelarCambioPalabra,
        limpiarTimersRonda,
        avanzarModoSeguro,
        snapshotPartidaTest,
        getModoBonus,
        getModoMalditas,
        getModoMusas,
        getTiempoVotacion
    } = runtimeModos;

    const { emitirIdiomaJuego, setIdiomaJuego } = crearGestorIdioma({ io });

    const construirPayloadEstadoVotacionVentaja = (socketDestino = null) => (
        votacionVentaja.construirPayloadEstado(socketDestino)
    );
    const emitirEstadoVotacionVentaja = (override = null, socketDestino = null) => (
        votacionVentaja.emitirEstado(override, socketDestino)
    );
    const cerrarVotacionVentajaForzada = (payload = {}) => votacionVentaja.cerrarForzada(payload);
    const abrirVotacionVentajaForzada = (payload = {}) => votacionVentaja.abrirForzada(payload);

    const programarVotacionTimer = (...args) => timersPartida.programarVotacion(...args);
    const programarInicioTimer = (...args) => timersPartida.programarInicio(...args);

    const gestoresBase = crearGestoresBase({
        io,
        obtenerIdJugadorValido,
        getTextoEscritor: () => writerChannels ? writerChannels.getTextosPlanos() : { 1: "", 2: "" },
        onVistaCambiada: () => emitirVistaEspectadorModo(),
        construirPayloadEstadoVotacionVentaja,
        getTiempoVotacion: () => getTiempoVotacion(),
        programarVotacionTimer,
        cancelarVotacionTimer: () => timersPartida.cancelarVotacion(),
        syncMode: () => sincro_modos(),
        registrar,
        repentizados
    });
    const {
        bolzanoCalentamientoGestor,
        teleprompter
    } = gestoresBase;
    ({ calentamiento, calentamientoGestor, votacionRepentizado, votacionVentaja } = gestoresBase);

    const gestoresAuxiliares = crearGestoresAuxiliares({
        obtenerIdJugadorValido,
        calentamientoGestor,
        io,
    });
    const {
        emitirEstadoBanderasMusas,
        emitirFeedbackMusas,
        musasAuxiliares,
        obtenerContadorMusas,
        obtenerEstadoEscritores,
        payloadConexionesRoles,
        rolesConectados,
        sesionesEscritor
    } = gestoresAuxiliares;

    writerChannels = crearCanalesEscritor({
        io,
        validarJugador: obtenerIdJugadorValido,
        sesionesEscritor,
        extraerTextoPlano,
        actualizarTextoJugador: (player, texto) => getModoMalditas().actualizarTextoJugador(player, texto),
        onNombreCambiado: () => emitirNubeInspiracionEstado(null, true),
        syncMode: (socket) => sincro_modos(socket),
        logger: registrar
    });

    const resurreccion = crearGestorResurreccionRuntime({
        io,
        partidaSync,
        validarJugador: obtenerIdJugadorValido,
        getModoActual: () => estadoCicloPartida.modoActual,
        isFinDelJuego: () => estadoCicloPartida.finDelJuego,
        marcarFinJugador: estadoCicloPartida.marcarFinJugador,
        estadoJugadores,
        construirPayloadCount,
        activarModo: (modo, socket) => motorModos.activarModo(modo, socket),
        getTextoPlano: (player) => writerChannels.getTextoPlano(player)
    });

    const activarSocketsExtratextualesConIo = (socket) => activarSocketsExtratextuales(socket, io);

    const gestoresVistaEstado = crearGestoresVistaEstado({
        io,
        calentamiento,
        getModoActual: () => estadoCicloPartida.modoActual,
        getNombreEquipo: (equipo) => writerChannels.getNombreEquipo(equipo),
        getMotores: () => ({
            bonus: getModoBonus(),
            malditas: getModoMalditas(),
            musas: getModoMusas()
        })
    });
    const {
        creditosShow,
        emitirCreditosShow,
        emitirNubeInspiracionEstado,
        emitirStatsLive,
        emitirVistaEspectadorModo,
        espectador,
        nubeInspiracion,
        payloadStatsLive,
        payloadVistaEspectadorModo,
        resolverModoVistaEspectador,
        statsLive
    } = gestoresVistaEstado;

    const payloadEstadoCalentamiento = () => calentamientoGestor.payloadEstado();
    const emitirEstadoCalentamiento = () => calentamientoGestor.emitirEstado();
    const emitirEstadoCalentamientoMusa = (equipo, socketObjetivo = null) => (
        calentamientoGestor.emitirEstadoMusa(equipo, socketObjetivo)
    );

    const resetearEstadoResurreccion = () => resurreccion.reset();
    const payloadEstadoResurreccion = () => resurreccion.payload();
    const {
        construirEstadoTest,
        registrarTimelineModo,
        resetearTimelineModosTest
    } = crearRuntimeStateSnapshot({
        testHooksEnabled,
        payloadConexionesRoles,
        snapshotPartidaTest,
        writerChannels,
        construirPayloadInspiracionMusaActual,
        nubeInspiracion,
        payloadEstadoCalentamiento,
        payloadVistaEspectadorModo,
        construirPayloadEstadoVotacionVentaja,
        teleprompter,
        payloadEstadoResurreccion,
        obtenerContadorMusas,
        musasAuxiliares,
        payloadStatsLive
    });

    const resetearEstadoAuxiliarParaTests = () => {
        limpiarTimersRonda();
        limpiarTimersPalabras();
        writerChannels.reset();
        partidaSync.resetConteoSync();
        partidaSync.resetTiempoSeq();
        teleprompter.reset();
        resurreccion.reset();
        nubeInspiracion.reset();
        musasAuxiliares.resetEstado();
        estadoCicloPartida.transicionModoEnCurso = false;
        votacionVentaja.reset();
        votacionRepentizado.reset();
        espectador.reset();
        creditosShow.reset();
        resetearTimelineModosTest();
        calentamientoGestor.reset();
    };

    const reiniciarEstadoPartida = (socket) => partidaLifecycle.reiniciarEstadoPartida(socket);
    const finalizarPartida = (socket) => partidaLifecycle.finalizarPartida(socket);

    motorModos = crearMotorModos({
        state: estadoMotorModos,
        io,
        timersPartida,
        partidaSync,
        registrar,
        registrarTimelineModo,
        limpiarTodosLosModos,
        avanzarModoSeguro,
        finalizarPartida,
        emitirTempModos,
        emitirActivarModo,
        emitirModoActual,
        emitirPedirInspiracionMusa,
        emitirNuevaLetra,
        emitirNubeInspiracionEstado,
        statsLive,
        payloadStatsLive,
        emitirStatsLive,
        votacionVentaja,
        getModoBonus,
        getModoMalditas,
        getModoMusas,
        estadoJugadores,
        letrasBenditas: runtimeModos.letrasBenditas,
        letrasProhibidas: runtimeModos.letrasProhibidas
    });

    partidaLifecycle = crearCicloPartida({
        state: estadoCicloPartida,
        io,
        partidaSync,
        limpiezasModo,
        limpiarTimersPalabras,
        limpiarTimersRonda,
        limpiarTodosLosModos,
        activarSocketsExtratextuales: activarSocketsExtratextualesConIo,
        resetearEstadoAuxiliarParaTests,
        resetearEstadoResurreccion,
        payloadEstadoResurreccion,
        musasAuxiliares,
        prepararParametrosInicio,
        getRanges,
        statsLive,
        emitirStatsLive,
        emitirNubeInspiracionEstado,
        emitirModoActual,
        registrarTimelineModo,
        motorModos,
        programarInicioTimer,
        registrar
    });

    const {
        sincronizarEstadoMusa,
        sincronizarSocketRecienConectado
    } = crearSincronizadorConexion({
        writerChannels,
        resurreccion,
        emitirEstadoVotacionVentaja,
        emitirNubeInspiracionEstado,
        teleprompter,
        partidaSync,
        getModoActual: () => estadoCicloPartida.modoActual,
        construirPayloadInspiracionMusaActual,
        emitirActivarModo,
        sincroModos: (socket) => sincro_modos(socket),
        emitirTempModos,
        obtenerIdJugadorValido,
        emitirEstadoCalentamientoMusa
    });

    const deps = {
        io,
        passwordRoles,
        testHooksEnabled,
        obtenerEstadoEscritores,
        obtenerIdJugadorValido,
        getModoActual: () => estadoCicloPartida.modoActual,
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
        activarSocketsExtratextuales: activarSocketsExtratextualesConIo,
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
        calentamientoState: calentamiento,
        emitirEstadoCalentamiento,
        payloadEstadoResurreccion,
        cerrarVotacionVentajaForzada,
        abrirVotacionVentajaForzada
    };

    function sincro_modos(socket = null) {
        return motorModos.sincro_modos(socket);
    }

    const registrarConexion = (socket) => registrarConexionScrib(socket, deps);

    const iniciar = () => {
        calentamientoGestor.iniciarIntervaloPurga();
        nubeInspiracion.iniciarIntervalo(1000);
        bolzanoCalentamientoGestor.iniciar();
        io.on('connection', registrarConexion);
        io.on('disconnect', () => {
            registrar('Un escritxr ha abandonado la partida.');
        });
    };

    return {
        deps,
        iniciar,
        registrarConexion,
        sincro_modos
    };
}

module.exports = {
    crearRuntimeScrib
};
