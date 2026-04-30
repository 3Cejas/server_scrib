function crearSincronizadorConexion({
    writerChannels,
    resurreccion,
    emitirEstadoVotacionVentaja,
    emitirNubeInspiracionEstado,
    teleprompter,
    partidaSync,
    getModoActual,
    construirPayloadInspiracionMusaActual,
    emitirActivarModo,
    sincroModos,
    emitirTempModos,
    obtenerIdJugadorValido,
    emitirEstadoCalentamientoMusa
}) {
    const sincronizarEstadoMusa = (socket) => {
        if (!socket) return;
        const equipo = obtenerIdJugadorValido(socket.musa);

        if (equipo === 1) {
            socket.emit('texto1', writerChannels.getTextoHtml(1));
        } else if (equipo === 2) {
            socket.emit('texto2', writerChannels.getTextoHtml(2));
        }

        if (typeof sincroModos === 'function') {
            sincroModos(socket);
        }

        const payloadInspiracion = construirPayloadInspiracionMusaActual();
        if (payloadInspiracion) {
            socket.emit('pedir_inspiracion_musa', payloadInspiracion);
        }

        emitirEstadoVotacionVentaja(null, socket);

        if (equipo && typeof emitirEstadoCalentamientoMusa === 'function') {
            emitirEstadoCalentamientoMusa(equipo, socket);
        }
    };

    const sincronizarSocketRecienConectado = (socket) => {
        if (!socket || typeof socket.emit !== 'function') {
            return;
        }
        writerChannels.emitirTextos(socket);
        resurreccion.sincronizarSocket(socket);
        emitirEstadoVotacionVentaja(null, socket);
        emitirNubeInspiracionEstado(socket, true);
        teleprompter.emitirEstado(socket);
        if (!getModoActual()) {
            socket.emit('modo_actual', partidaSync.withModoSeq({ modo_actual: '' }));
            return;
        }
        const payloadModo = construirPayloadInspiracionMusaActual();
        emitirActivarModo(payloadModo, socket);
        sincroModos(socket);
        socket.emit('post-inicio', { borrar_texto: false });
        emitirTempModos(socket);
    };

    return {
        sincronizarEstadoMusa,
        sincronizarSocketRecienConectado
    };
}

module.exports = {
    crearSincronizadorConexion
};
