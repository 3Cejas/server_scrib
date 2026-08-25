const TIMELINE_MODOS_MAX = 80;
const DRAMATURGIA_SCHEMA_VERSION = 1;

function crearRuntimeStateSnapshot({
    testHooksEnabled = false,
    payloadConexionesRoles,
    snapshotPartidaTest,
    writerChannels,
    construirPayloadInspiracionMusaActual,
    nubeInspiracion,
    payloadEstadoCalentamiento,
    payloadVistaEspectadorModo,
    construirPayloadEstadoVotacionVentaja,
    payloadDesventajasActivas = () => [],
    payloadCompeticionRonda = () => null,
    payloadRelojPartida = () => null,
    teleprompter,
    obtenerContadorMusas,
    musasAuxiliares,
    payloadStatsLive,
    payloadPuntuacionFinal = () => null,
    snapshotConteosDramaturgia = () => ({ 1: {}, 2: {} }),
    obtenerDiarioDramaturgia = () => ({ session: null, eventos: [] })
}) {
    let timelineModos = [];

    const registrarTimelineModo = (modo, origen = 'runtime') => {
        const nombre = typeof modo === 'string' ? modo.trim() : '';
        timelineModos.push({
            modo: nombre,
            origen,
            ts: Date.now()
        });
        if (timelineModos.length > TIMELINE_MODOS_MAX) {
            timelineModos = timelineModos.slice(-TIMELINE_MODOS_MAX);
        }
    };

    const resetearTimelineModosTest = () => {
        timelineModos = [];
    };

    const construirEstadoTest = () => ({
        ts: Date.now(),
        enabled: testHooksEnabled,
        connections: payloadConexionesRoles(),
        partida: snapshotPartidaTest(timelineModos),
        textos: writerChannels.snapshotTextos(),
        inspiracion: {
            preview: construirPayloadInspiracionMusaActual(),
            ...nubeInspiracion.snapshot()
        },
        tutorial: payloadEstadoCalentamiento(),
        espectador: payloadVistaEspectadorModo(),
        votacion_ventaja: construirPayloadEstadoVotacionVentaja(),
        desventajas: payloadDesventajasActivas(),
        competicion_ronda: payloadCompeticionRonda(),
        reloj_partida: payloadRelojPartida(),
        teleprompter: teleprompter.snapshot(),
        musas: {
            contador: obtenerContadorMusas(),
            ...musasAuxiliares.snapshot()
        },
        stats: payloadStatsLive(),
        puntuacion_final: payloadPuntuacionFinal()
    });

    const construirEstadoDramaturgiaActual = () => ({
        ts: Date.now(),
        connections: payloadConexionesRoles(),
        partida: snapshotPartidaTest(timelineModos),
        textos: writerChannels.snapshotTextos(),
        nombres: {
            1: writerChannels.getNombre(1),
            2: writerChannels.getNombre(2)
        },
        atributos: writerChannels.snapshotAtributos(),
        conteos: snapshotConteosDramaturgia(),
        inspiracion: {
            preview: construirPayloadInspiracionMusaActual(),
            ...nubeInspiracion.snapshot()
        },
        tutorial: payloadEstadoCalentamiento(),
        espectador: payloadVistaEspectadorModo(),
        votacion_ventaja: construirPayloadEstadoVotacionVentaja(),
        desventajas: payloadDesventajasActivas(),
        competicion_ronda: payloadCompeticionRonda(),
        reloj_partida: payloadRelojPartida(),
        teleprompter: teleprompter.snapshot(),
        musas: {
            contador: obtenerContadorMusas(),
            ...musasAuxiliares.snapshot()
        },
        stats: payloadStatsLive(),
        puntuacion_final: payloadPuntuacionFinal()
    });

    const construirEstadoDramaturgia = () => {
        const actual = construirEstadoDramaturgiaActual();
        const diario = obtenerDiarioDramaturgia() || {};
        const { ts, ...estadoActual } = actual;
        return {
            schema_version: DRAMATURGIA_SCHEMA_VERSION,
            ts,
            session: diario.session || null,
            ...estadoActual,
            eventos: Array.isArray(diario.eventos) ? diario.eventos : []
        };
    };

    const emitirEstadoDramaturgia = (socketDestino) => {
        if (!socketDestino || typeof socketDestino.emit !== 'function') {
            return null;
        }
        const payload = construirEstadoDramaturgia();
        socketDestino.emit('dramaturgia_estado', payload);
        return payload;
    };

    return {
        construirEstadoDramaturgia,
        construirEstadoDramaturgiaActual,
        construirEstadoTest,
        emitirEstadoDramaturgia,
        registrarTimelineModo,
        resetearTimelineModosTest
    };
}

module.exports = {
    DRAMATURGIA_SCHEMA_VERSION,
    crearRuntimeStateSnapshot
};
