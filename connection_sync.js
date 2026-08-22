function crearSincronizadorConexion({
    writerChannels,
    resurreccion,
    emitirEstadoVotacionVentaja,
    emitirNubeInspiracionEstado,
    teleprompter,
    emitirEstadoDramaturgia = null,
    emitirEstadoDesventajasActivas = null,
    emitirEstadoPalabrasMusasControl = null,
    partidaSync,
    getModoActual,
    isPartidaPausada = () => false,
    construirPayloadInspiracionMusaActual,
    emitirActivarModo,
    sincroModos,
    emitirTempModos,
    obtenerIdJugadorValido,
    emitirEstadoCalentamientoMusa
}) {
    const emitirConteosGuardados = (socketDestino) => {
        if (!socketDestino || typeof socketDestino.emit !== 'function' || !partidaSync) {
            return;
        }
        [1, 2].forEach((player) => {
            if (typeof partidaSync.obtenerConteo !== 'function') {
                return;
            }
            const estado = partidaSync.obtenerConteo(player);
            if (!estado || typeof estado !== 'object') {
                return;
            }
            let countText = typeof estado.count_text === 'string' ? estado.count_text.trim() : '';
            if (!countText && Number.isFinite(Number(estado.count_seconds)) && typeof partidaSync.formatearTextoCountDesdeSegundos === 'function') {
                countText = partidaSync.formatearTextoCountDesdeSegundos(estado.count_seconds);
            }
            if (!countText) {
                return;
            }
            const countSeq = Number(estado.count_seq);
            const tiempoSeq = Number(estado.tiempo_seq);
            const payload = {
                player,
                count: countText,
                count_seq: Number.isFinite(countSeq) ? Math.max(0, Math.trunc(countSeq)) : 0,
                tiempo_seq: Number.isFinite(tiempoSeq)
                    ? Math.max(0, Math.trunc(tiempoSeq))
                    : (typeof partidaSync.obtenerTiempoSeq === 'function' ? partidaSync.obtenerTiempoSeq(player) : 0)
            };
            socketDestino.emit('count', typeof partidaSync.construirPayloadCount === 'function'
                ? partidaSync.construirPayloadCount(payload)
                : payload);
        });
    };

    const sincronizarEstadoMusa = (socket) => {
        if (!socket) return;
        const monitor = socket.monitor_pantalla && socket.monitor_pantalla.rol === "musa"
            ? socket.monitor_pantalla.player
            : null;
        const equipo = obtenerIdJugadorValido(socket.musa) || obtenerIdJugadorValido(monitor);

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
        if (
            socket.dramaturgia
            && typeof emitirEstadoDramaturgia === 'function'
        ) {
            emitirEstadoDramaturgia(socket);
        }
        writerChannels.emitirTextos(socket);
        resurreccion.sincronizarSocket(socket);
        emitirEstadoVotacionVentaja(null, socket);
        emitirNubeInspiracionEstado(socket, true);
        if (typeof emitirEstadoPalabrasMusasControl === 'function') {
            emitirEstadoPalabrasMusasControl(socket);
        }
        teleprompter.emitirEstado(socket);
        if (!getModoActual()) {
            socket.emit('modo_actual', partidaSync.withModoSeq({ modo_actual: '' }));
            return;
        }
        const payloadModo = construirPayloadInspiracionMusaActual();
        emitirActivarModo(payloadModo, socket);
        sincroModos(socket);
        socket.emit('post-inicio', { borrar_texto: false });
        emitirConteosGuardados(socket);
        emitirTempModos(socket);
        if (typeof emitirEstadoDesventajasActivas === 'function') {
            emitirEstadoDesventajasActivas(socket);
        }
        if (typeof isPartidaPausada === 'function' && isPartidaPausada()) {
            socket.emit('pausar_js', { restaurando: true });
        }
    };

    return {
        sincronizarEstadoMusa,
        sincronizarSocketRecienConectado
    };
}

module.exports = {
    crearSincronizadorConexion
};
