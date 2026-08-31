const { crearGestorDesventajasActivas } = require('./active_disadvantages.js');
const { crearSincronizadorConexion } = require('./connection_sync.js');
const { crearGestorEstadoControl } = require('./control_state.js');
const { crearEstadoDramaturgia } = require('./dramaturgia_state.js');
const { registrarConexionScrib } = require('./connection_handlers.js');
const { activarSocketsExtratextuales } = require('./extratextual_channels.js');
const { crearRuntimeModos } = require('./mode_runtime.js');
const { crearMotorModos } = require('./mode_engine.js');
const { createMatchSimulator } = require('./match_simulator.js');
const { crearCicloPartida } = require('./partida_lifecycle.js');
const { crearGestorPreShowMusas } = require('./pre_show_musas.js');
const { crearGestorAyudaMusas } = require('./musa_help.js');
const { crearGestorAccesoRoles } = require('./role_access.js');
const { crearGestorVideoTutorialPreShow } = require('./video_tutorial_pre_show.js');
const { crearGestorSincronizacionPartida } = require('./partida_sync.js');
const {
    crearGestorIdioma,
    extraerTextoPlano,
    normalizarNombreMusa,
    obtenerIdJugadorValido,
    repentizados
} = require('./runtime_config.js');
const {
    crearGestoresAuxiliares,
    crearGestoresBase,
    crearGestoresVistaEstado
} = require('./runtime_managers.js');
const { crearRuntimeStateSnapshot } = require('./runtime_state_snapshot.js');
const { getRanges } = require('./time_ranges.js');
const { crearCanalesEscritor } = require('./writer_channels.js');
const { crearCompeticionRondas } = require('./round_competition.js');
const { crearRelojPartida } = require('./match_clock.js');

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
    let dramaturgiaState;
    let simuladorPartidas;
    let preShowMusas;
    let ayudaMusas;
    let videoTutorialPreShow;
    let deps;
    let partidaPausada = false;

    const accesoRoles = crearGestorAccesoRoles({ passwordRoles });
    const controlState = crearGestorEstadoControl({ io });
    const partidaSync = crearGestorSincronizacionPartida({ validarJugador: obtenerIdJugadorValido });
    const competicionRondas = crearCompeticionRondas({
        io,
        getAtributos: () => writerChannels ? writerChannels.snapshotAtributos() : { 1: {}, 2: {} },
        getModoSeq: () => partidaSync.obtenerModoSeq()
    });
    const relojPartida = crearRelojPartida({
        io,
        onFinish: () => {
            if (partidaLifecycle && !estadoCicloPartida.finDelJuego) {
                partidaLifecycle.finalizarPartida(null);
            }
        }
    });
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
        emitirEstadoPalabrasMusasControl,
        payloadEstadoPalabrasMusasControl,
        emitirEntregaInspiracionActiva,
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
        getTiempoModificador,
        getTiempoVotacion
    } = runtimeModos;

    const { emitirIdiomaJuego, setIdiomaJuego } = crearGestorIdioma({ io });
    const desventajasActivas = crearGestorDesventajasActivas({
        validarJugador: obtenerIdJugadorValido,
        getDuracionMs: () => getTiempoModificador()
    });
    const registrarDesventajaAplicada = (evento = {}) => {
        const player = obtenerIdJugadorValido(
            evento.player
            || evento.target
            || (evento.perdedor === 'j1' ? 1 : (evento.perdedor === 'j2' ? 2 : null))
        );
        const putada = evento.putada || evento.seleccion || evento.ventaja;
        return desventajasActivas.registrar(player, putada, {
            duracion_ms: evento.duracion_ms,
            duracionMs: evento.duracionMs
        });
    };
    const emitirEstadoDesventajasActivas = (socketDestino = null) => {
        const snapshots = desventajasActivas.snapshotActivas();
        if (!snapshots.length) {
            return snapshots;
        }
        const destino = socketDestino && typeof socketDestino.emit === 'function' ? socketDestino : io;
        snapshots.forEach((payload) => {
            destino.emit('desventaja_activa_estado', payload);
        });
        return snapshots;
    };

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
        getTiempoModificador: () => getTiempoModificador(),
        onAplicarVentaja: registrarDesventajaAplicada,
        programarVotacionTimer,
        cancelarVotacionTimer: () => timersPartida.cancelarVotacion(),
        syncMode: () => sincro_modos(),
        onTutorialIniciado: () => {
            if (preShowMusas) preShowMusas.cerrar("tutorial");
        },
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
        partidaSync,
        permitirEquipoMusaExplicito: testHooksEnabled,
        getModoActual: () => estadoCicloPartida.modoActual,
        isFinDelJuego: () => estadoCicloPartida.finDelJuego,
        construirPayloadCount
    });
    const {
        emitirEstadoBanderasMusas,
        emitirFeedbackMusas,
        emitirEstadoRegaloBanderaMusas,
        musasAuxiliares,
        obtenerContadorMusas,
        obtenerEstadoEscritores,
        payloadConexionesRoles,
        rolesConectados,
        sesionesEscritor
    } = gestoresAuxiliares;

    preShowMusas = crearGestorPreShowMusas({
        io,
        obtenerMusaActiva: (socket) => rolesConectados.obtenerMusaActiva(socket)
    });
    ayudaMusas = crearGestorAyudaMusas({
        io,
        obtenerMusaActiva: (socket) => rolesConectados.obtenerMusaActiva(socket),
        logger: registrar
    });
    videoTutorialPreShow = crearGestorVideoTutorialPreShow({
        io,
        obtenerMusaActiva: (socket) => rolesConectados.obtenerMusaActiva(socket),
        listarMusasActivas: () => rolesConectados.listarMusasActivas(),
        logger: registrar
    });

    writerChannels = crearCanalesEscritor({
        io,
        validarJugador: obtenerIdJugadorValido,
        sesionesEscritor,
        extraerTextoPlano,
        actualizarTextoJugador: (player, texto) => getModoMalditas().actualizarTextoJugador(player, texto),
        onTextoActualizado: (player, anterior, actual) => (
            competicionRondas.registrarCambioTexto(player, anterior, actual)
        ),
        onNombreCambiado: () => emitirNubeInspiracionEstado(null, true),
        syncMode: (socket) => sincro_modos(socket),
        logger: registrar
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
        }),
        getMusasCreditos: () => rolesConectados.obtenerMusasCreditosPartida()
    });
    const {
        creditosShow,
        emitirCreditosShow,
        emitirNubeInspiracionEstado,
        emitirPuntuacionFinal,
        emitirStatsLive,
        emitirVistaEspectadorModo,
        espectador,
        nubeInspiracion,
        payloadPuntuacionFinal,
        payloadStatsLive,
        payloadVistaEspectadorModo,
        puntuacionFinal,
        resolverModoVistaEspectador,
        statsLive
    } = gestoresVistaEstado;

    const payloadEstadoCalentamiento = () => calentamientoGestor.payloadEstado();
    const emitirEstadoCalentamiento = () => calentamientoGestor.emitirEstado();
    const emitirEstadoCalentamientoMusa = (equipo, socketObjetivo = null) => (
        calentamientoGestor.emitirEstadoMusa(equipo, socketObjetivo)
    );

    const {
        construirEstadoDramaturgiaActual,
        construirEstadoTest,
        emitirEstadoDramaturgia,
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
        payloadDesventajasActivas: () => desventajasActivas.snapshotActivas(),
        payloadCompeticionRonda: () => competicionRondas.snapshot(),
        payloadRelojPartida: () => relojPartida.snapshot(),
        teleprompter,
        obtenerContadorMusas,
        musasAuxiliares,
        payloadStatsLive,
        payloadPuntuacionFinal,
        snapshotConteosDramaturgia: () => ({
            1: {
                ...(partidaSync.obtenerConteo(1) || {}),
                modo_seq: partidaSync.obtenerModoSeq(),
                tiempo_seq: partidaSync.obtenerTiempoSeq(1)
            },
            2: {
                ...(partidaSync.obtenerConteo(2) || {}),
                modo_seq: partidaSync.obtenerModoSeq(),
                tiempo_seq: partidaSync.obtenerTiempoSeq(2)
            }
        }),
        obtenerDiarioDramaturgia: () => (
            dramaturgiaState
                ? dramaturgiaState.snapshot()
                : { session: null, eventos: [] }
        )
    });
    dramaturgiaState = crearEstadoDramaturgia({
        io,
        obtenerEstadoActual: construirEstadoDramaturgiaActual,
        registrar
    });

    const resetearEstadoAuxiliarParaTests = () => {
        limpiarTimersRonda();
        limpiarTimersPalabras();
        writerChannels.reset();
        partidaSync.resetConteoSync();
        partidaSync.resetTiempoSeq();
        teleprompter.reset();
        nubeInspiracion.reset();
        musasAuxiliares.resetEstado();
        musasAuxiliares.emitirEstadoRegaloBandera();
        desventajasActivas.reset();
        competicionRondas.reset();
        relojPartida.detener();
        controlState.reset();
        estadoCicloPartida.transicionModoEnCurso = false;
        votacionVentaja.reset();
        votacionRepentizado.reset();
        espectador.reset();
        creditosShow.reset();
        rolesConectados.limpiarMusasCreditosPartida();
        resetearTimelineModosTest();
        calentamientoGestor.reset();
    };

    const reiniciarEstadoPartida = (socket, opciones = {}) => partidaLifecycle.reiniciarEstadoPartida(socket, opciones);
    const finalizarPartida = (socket) => partidaLifecycle.finalizarPartida(socket);

    const iniciarNuevaSesionMusas = () => {
        const resultado = rolesConectados.iniciarNuevaSesionMusas();
        const payload = {
            ok: true,
            session_id: resultado.session_id,
            revision: resultado.revision,
            contador: resultado.contador,
            ts: Date.now()
        };
        io.emit("actualizar_contador_musas", resultado.contador);
        io.emit("musa_sesion_actualizada", payload);
        registrar(`[servidor] nueva partida ${resultado.session_id}: las musas vuelven a elegir escritxr.`);
        return payload;
    };

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
        iniciarRondaCompeticion: (modo) => {
            if (modo === 'tertulia') relojPartida.pausar();
            else relojPartida.reanudar();
            return competicionRondas.iniciarRonda(modo, { modo_seq: partidaSync.obtenerModoSeq() });
        },
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
        musasAuxiliares,
        prepararParametrosInicio,
        getRanges,
        statsLive,
        emitirStatsLive,
        puntuacionFinal,
        emitirPuntuacionFinal,
        emitirNubeInspiracionEstado,
        emitirModoActual,
        limpiarDesventajasActivas: () => desventajasActivas.reset(),
        resetearCompeticion: () => competicionRondas.reset(),
        iniciarCompeticionRonda: (modo) => {
            if (modo === 'tertulia') relojPartida.pausar();
            else relojPartida.reanudar();
            return competicionRondas.iniciarRonda(modo, { modo_seq: partidaSync.obtenerModoSeq() });
        },
        iniciarRelojPartida: (segundos) => relojPartida.iniciar(segundos),
        detenerRelojPartida: () => relojPartida.detener(),
        setPartidaPausada: (valor) => {
            partidaPausada = Boolean(valor);
        },
        registrarTimelineModo,
        motorModos,
        programarInicioTimer,
        reiniciarMusasCreditosPartida: () => rolesConectados.reiniciarMusasCreditosPartidaDesdeActivas(),
        limpiarMusasCreditosPartida: () => rolesConectados.limpiarMusasCreditosPartida(),
        iniciarNuevaSesionMusas,
        preShowMusas,
        videoTutorialPreShow,
        registrar
    });

    simuladorPartidas = createMatchSimulator({
        io,
        passwordRoles,
        registerConnection: (socket) => registrarConexionScrib(socket, deps),
        getConnections: payloadConexionesRoles,
        getCurrentMode: () => estadoCicloPartida.modoActual,
        getVoteState: () => construirPayloadEstadoVotacionVentaja(),
        getWarmupState: payloadEstadoCalentamiento,
        resetWarmup: () => {
            calentamientoGestor.reset();
            calentamientoGestor.emitirEstado();
        },
        partidaLifecycle,
        registerDramaturgyEvent: (evento) => dramaturgiaState.registrarEvento(evento),
        logger: registrar
    });

    const {
        sincronizarEstadoMusa,
        sincronizarSocketRecienConectado
    } = crearSincronizadorConexion({
        writerChannels,
        emitirEstadoVotacionVentaja,
        emitirNubeInspiracionEstado,
        teleprompter,
        emitirEstadoDramaturgia,
        emitirEstadoDesventajasActivas,
        emitirEstadoCompeticion: (socketDestino) => competicionRondas.emitir(socketDestino),
        emitirEstadoRelojPartida: (socketDestino) => relojPartida.emitir(socketDestino),
        emitirEstadoPalabrasMusasControl,
        partidaSync,
        getModoActual: () => estadoCicloPartida.modoActual,
        isPartidaPausada: () => partidaPausada,
        construirPayloadInspiracionMusaActual,
        emitirActivarModo,
        sincroModos: (socket) => sincro_modos(socket),
        emitirTempModos,
        obtenerIdJugadorValido,
        emitirEstadoCalentamientoMusa,
        emitirEntregaInspiracionActiva,
        emitirEstadoPreShow: (socketDestino) => preShowMusas.emitirEstado(socketDestino),
        emitirEstadoVideoTutorial: (socketDestino) => videoTutorialPreShow.emitirEstado(socketDestino),
        sincronizarAyudaMusas: (socketDestino) => ayudaMusas.sincronizarMusa(socketDestino),
        emitirEstadoAyudaControl: (socketDestino) => ayudaMusas.emitirEstadoControl(socketDestino)
    });

    deps = {
        io,
        passwordRoles,
        accesoRoles,
        testHooksEnabled,
        controlState,
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
        emitirPuntuacionFinal,
        puntuacionFinal,
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
        dramaturgiaState,
        simuladorPartidas,
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
        estadoMotorModos,
        registrarTimelineModo,
        emitirPedirInspiracionMusa,
        emitirActivarModo,
        payloadStatsLive,
        payloadPuntuacionFinal,
        construirEstadoTest,
        resetearEstadoAuxiliarParaTests,
        emitirModoActual,
        emitirEstadoPalabrasMusasControl,
        payloadEstadoPalabrasMusasControl,
        emitirEstadoVotacionVentaja,
        emitirEstadoDesventajasActivas,
        competicionRondas,
        relojPartida,
        calentamientoState: calentamiento,
        emitirEstadoCalentamiento,
        cerrarVotacionVentajaForzada,
        abrirVotacionVentajaForzada,
        registrarDesventajaAplicada,
        pausarDesventajasActivas: () => desventajasActivas.pausar(),
        reanudarDesventajasActivas: () => desventajasActivas.reanudar(),
        setPartidaPausada: (valor) => {
            partidaPausada = Boolean(valor);
        },
        isPartidaPausada: () => partidaPausada,
        isFinDelJuego: () => Boolean(estadoCicloPartida.finDelJuego),
        registrarInspiracionCompeticion: (player, payload) => competicionRondas.registrarInspiracion(player, payload),
        registrarInfraccionCompeticion: (player, payload) => competicionRondas.registrarInfraccion(player, payload),
        pausarRelojPartida: () => relojPartida.pausar(),
        reanudarRelojPartida: () => relojPartida.reanudar(),
        registrarPulsacionCompeticion: (player, payload) => competicionRondas.registrarPulsacion(player, payload),
        getPulsacionesCompeticion: () => competicionRondas.snapshot().pulsaciones,
        ayudaMusas,
        preShowMusas,
        videoTutorialPreShow
    };

    function sincro_modos(socket = null) {
        return motorModos.sincro_modos(socket);
    }

    const registrarConexion = (socket) => registrarConexionScrib(socket, deps);

    const iniciar = () => {
        dramaturgiaState.iniciar();
        calentamientoGestor.iniciarIntervaloPurga();
        nubeInspiracion.iniciarIntervalo(1000);
        bolzanoCalentamientoGestor.iniciar();
        videoTutorialPreShow.iniciar();
        io.on('connection', registrarConexion);
        io.on('disconnect', () => {
            registrar('Un escritxr ha abandonado la partida.');
        });
    };

    return {
        deps,
        ayudaMusas,
        dramaturgiaState,
        simuladorPartidas,
        videoTutorialPreShow,
        iniciar,
        registrarConexion,
        sincro_modos
    };
}

module.exports = {
    crearRuntimeScrib
};
