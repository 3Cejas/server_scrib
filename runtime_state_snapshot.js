const TIMELINE_MODOS_TEST_MAX = 80;

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
    teleprompter,
    payloadEstadoResurreccion,
    obtenerContadorMusas,
    musasAuxiliares,
    payloadStatsLive
}) {
    let timelineModosTest = [];

    const registrarTimelineModo = (modo, origen = 'runtime') => {
        const nombre = typeof modo === 'string' ? modo.trim() : '';
        timelineModosTest.push({
            modo: nombre,
            origen,
            ts: Date.now()
        });
        if (timelineModosTest.length > TIMELINE_MODOS_TEST_MAX) {
            timelineModosTest = timelineModosTest.slice(-TIMELINE_MODOS_TEST_MAX);
        }
    };

    const resetearTimelineModosTest = () => {
        timelineModosTest = [];
    };

    const construirEstadoTest = () => ({
        ts: Date.now(),
        enabled: testHooksEnabled,
        connections: payloadConexionesRoles(),
        partida: snapshotPartidaTest(timelineModosTest),
        textos: writerChannels.snapshotTextos(),
        inspiracion: {
            preview: construirPayloadInspiracionMusaActual(),
            ...nubeInspiracion.snapshot()
        },
        tutorial: payloadEstadoCalentamiento(),
        espectador: payloadVistaEspectadorModo(),
        votacion_ventaja: construirPayloadEstadoVotacionVentaja(),
        teleprompter: teleprompter.snapshot(),
        resurreccion: payloadEstadoResurreccion(),
        musas: {
            contador: obtenerContadorMusas(),
            ...musasAuxiliares.snapshot()
        },
        stats: payloadStatsLive()
    });

    return {
        construirEstadoTest,
        registrarTimelineModo,
        resetearTimelineModosTest
    };
}

module.exports = {
    crearRuntimeStateSnapshot
};
