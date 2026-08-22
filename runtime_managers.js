const { crearGestorCalentamientoBolzano } = require('./bolzano_warmup.js');
const { crearGestorCreditosShow } = require('./credits_show.js');
const { crearGestorMusasAuxiliares } = require('./musas_auxiliares.js');
const { crearGestorNubeInspiracion } = require('./nube_inspiracion.js');
const { crearGestorVotacionRepentizado, opcionConMasVotos } = require('./repentizado_voting.js');
const { crearGestorResurreccion } = require('./resurrection_channels.js');
const { crearRegistroRoles } = require('./role_connections.js');
const { crearGestorPuntuacionFinal } = require('./final_scoring.js');
const { crearGestorStatsLive } = require('./stats_live.js');
const { crearGestorVistaEspectador } = require('./spectator_state.js');
const { crearGestorTeleprompter } = require('./teleprompter.js');
const { crearGestorVotacionVentaja } = require('./ventaja_voting.js');
const { crearGestorCalentamiento } = require('./warmup.js');
const { crearRegistroSesionesEscritor } = require('./writer_sessions.js');
const {
    construirPayloadEstadoVotacionVentaja: construirPayloadEstadoVotacionVentajaBase
} = require('./server_state_utils');
const { aplicarAjusteTiempo } = require('./time_adjustments.js');

function crearGestoresBase({
    io,
    obtenerIdJugadorValido,
    getTextoEscritor,
    onVistaCambiada,
    construirPayloadEstadoVotacionVentaja,
    getTiempoVotacion,
    onAplicarVentaja,
    programarVotacionTimer,
    cancelarVotacionTimer,
    syncMode,
    registrar = () => {},
    repentizados = []
}) {
    const teleprompter = crearGestorTeleprompter({
        io,
        getTextoEscritor
    });
    const calentamientoGestor = crearGestorCalentamiento({
        io,
        validarJugador: obtenerIdJugadorValido,
        onVistaCambiada
    });
    const calentamiento = calentamientoGestor.estado;
    const bolzanoCalentamientoGestor = crearGestorCalentamientoBolzano({
        io,
        validarJugador: obtenerIdJugadorValido
    });
    const votacionVentaja = crearGestorVotacionVentaja({
        io,
        construirPayloadBase: construirPayloadEstadoVotacionVentajaBase,
        obtenerIdJugadorValido,
        getDuracionMs: getTiempoVotacion,
        onAplicarVentaja,
        scheduleTimer: programarVotacionTimer,
        cancelTimer: cancelarVotacionTimer,
        escogerGanador: (votos) => opcionConMasVotos(votos, registrar)
    });
    const votacionRepentizado = crearGestorVotacionRepentizado({
        io,
        repentizados,
        getTiempoVotacion,
        scheduleTimer: programarVotacionTimer,
        syncMode,
        registrar
    });

    return {
        bolzanoCalentamientoGestor,
        calentamiento,
        calentamientoGestor,
        teleprompter,
        votacionRepentizado,
        votacionVentaja
    };
}

function crearGestoresAuxiliares({
    obtenerIdJugadorValido,
    calentamientoGestor,
    io,
    partidaSync,
    permitirEquipoMusaExplicito = false,
    getModoActual = () => "",
    isFinDelJuego = () => false,
    construirPayloadCount = (payload) => payload
}) {
    const sesionesEscritor = crearRegistroSesionesEscritor(obtenerIdJugadorValido);
    const rolesConectados = crearRegistroRoles({
        validarJugador: obtenerIdJugadorValido,
        permitirEquipoMusaExplicito
    });
    const musasAuxiliares = crearGestorMusasAuxiliares({
        io,
        validarEquipo: obtenerIdJugadorValido,
        contarMusas: (equipo) => {
            const contador = rolesConectados.obtenerContadorMusas();
            return Number(equipo) === 2 ? contador.escritxr2 : contador.escritxr1;
        },
        getPartidaActiva: () => {
            const modoActual = typeof getModoActual === "function" ? getModoActual() : "";
            return Boolean(modoActual) && modoActual !== "frase final" && !isFinDelJuego();
        },
        aplicarRegaloBanderaTiempo: (evento) => aplicarAjusteTiempo({
            io,
            evento,
            obtenerIdJugadorValido,
            getModoActual,
            partidaSync,
            construirPayloadCount,
            permitirSinModo: false
        })
    });

    return {
        emitirEstadoBanderasMusas: musasAuxiliares.emitirBanderas,
        emitirFeedbackMusas: musasAuxiliares.emitirFeedback,
        emitirEstadoRegaloBanderaMusas: musasAuxiliares.emitirEstadoRegaloBandera,
        musasAuxiliares,
        obtenerContadorMusas: rolesConectados.obtenerContadorMusas,
        obtenerEstadoEscritores: rolesConectados.estadoEscritores,
        payloadConexionesRoles: rolesConectados.payloadConexiones,
        rolesConectados,
        sesionesEscritor
    };
}

function crearGestoresVistaEstado({
    io,
    calentamiento,
    getModoActual,
    getNombreEquipo,
    getMotores,
    getMusasCreditos = () => null
}) {
    const espectador = crearGestorVistaEspectador({
        io,
        isCalentamientoVisible: () => Boolean(calentamiento && calentamiento.vista)
    });
    const creditosShow = crearGestorCreditosShow({
        io,
        isVisible: () => espectador.getOverride() === "creditos",
        getMusasCreditos
    });
    const statsLive = crearGestorStatsLive({
        io,
        getModoActual
    });
    const puntuacionFinal = crearGestorPuntuacionFinal({
        io,
        getNombreEquipo
    });
    const nubeInspiracion = crearGestorNubeInspiracion({
        io,
        getModoActual,
        getNombreEquipo,
        getMotores
    });

    return {
        creditosShow,
        emitirCreditosShow: (socketDestino = null) => creditosShow.emitir(socketDestino),
        emitirNubeInspiracionEstado: nubeInspiracion.emitir,
        emitirPuntuacionFinal: puntuacionFinal.emitir,
        emitirStatsLive: statsLive.emitir,
        emitirVistaEspectadorModo: espectador.emitir,
        espectador,
        nubeInspiracion,
        payloadPuntuacionFinal: puntuacionFinal.payload,
        payloadStatsLive: statsLive.payload,
        payloadVistaEspectadorModo: espectador.payload,
        puntuacionFinal,
        resolverModoVistaEspectador: espectador.resolverModo,
        statsLive
    };
}

function crearGestorResurreccionRuntime({
    io,
    partidaSync,
    validarJugador,
    getModoActual,
    isFinDelJuego,
    marcarFinJugador,
    estadoJugadores,
    construirPayloadCount,
    activarModo,
    getTextoPlano,
    reanudarTertuliaTrasResurreccion
}) {
    return crearGestorResurreccion({
        io,
        partidaSync,
        validarJugador,
        getModoActual,
        isFinDelJuego,
        marcarFinJugador,
        estadoJugadores,
        construirPayloadCount,
        activarModo,
        getTextoPlano,
        reanudarTertuliaTrasResurreccion
    });
}

module.exports = {
    crearGestorResurreccionRuntime,
    crearGestoresAuxiliares,
    crearGestoresBase,
    crearGestoresVistaEstado
};
