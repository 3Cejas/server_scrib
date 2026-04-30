const { crearGestorCalentamientoBolzano } = require('./bolzano_warmup.js');
const { crearGestorCreditosShow } = require('./credits_show.js');
const { crearGestorMusasAuxiliares } = require('./musas_auxiliares.js');
const { crearGestorNubeInspiracion } = require('./nube_inspiracion.js');
const { crearGestorVotacionRepentizado, opcionConMasVotos } = require('./repentizado_voting.js');
const { crearGestorResurreccion } = require('./resurrection_channels.js');
const { crearRegistroRoles } = require('./role_connections.js');
const { crearGestorStatsLive } = require('./stats_live.js');
const { crearGestorVistaEspectador } = require('./spectator_state.js');
const { crearGestorTeleprompter } = require('./teleprompter.js');
const { crearGestorVotacionVentaja } = require('./ventaja_voting.js');
const { crearGestorCalentamiento } = require('./warmup.js');
const { crearRegistroSesionesEscritor } = require('./writer_sessions.js');
const {
    construirPayloadEstadoVotacionVentaja: construirPayloadEstadoVotacionVentajaBase
} = require('./server_state_utils');

function crearGestoresBase({
    io,
    obtenerIdJugadorValido,
    getTextoEscritor,
    onVistaCambiada,
    construirPayloadEstadoVotacionVentaja,
    getTiempoVotacion,
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
    io
}) {
    const sesionesEscritor = crearRegistroSesionesEscritor(obtenerIdJugadorValido);
    const musasAuxiliares = crearGestorMusasAuxiliares({
        io,
        validarEquipo: obtenerIdJugadorValido
    });
    const rolesConectados = crearRegistroRoles({
        validarJugador: obtenerIdJugadorValido,
        contarMusas: (equipo) => calentamientoGestor ? calentamientoGestor.contarMusas(equipo) : 0
    });

    return {
        emitirEstadoBanderasMusas: musasAuxiliares.emitirBanderas,
        emitirFeedbackMusas: musasAuxiliares.emitirFeedback,
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
    getMotores
}) {
    const espectador = crearGestorVistaEspectador({
        io,
        isCalentamientoVisible: () => Boolean(calentamiento && calentamiento.vista)
    });
    const creditosShow = crearGestorCreditosShow({
        io,
        isVisible: () => espectador.getOverride() === "creditos"
    });
    const statsLive = crearGestorStatsLive({
        io,
        getModoActual
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
        emitirStatsLive: statsLive.emitir,
        emitirVistaEspectadorModo: espectador.emitir,
        espectador,
        nubeInspiracion,
        payloadStatsLive: statsLive.payload,
        payloadVistaEspectadorModo: espectador.payload,
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
    getTextoPlano
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
        getTextoPlano
    });
}

module.exports = {
    crearGestorResurreccionRuntime,
    crearGestoresAuxiliares,
    crearGestoresBase,
    crearGestoresVistaEstado
};
