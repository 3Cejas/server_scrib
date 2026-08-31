function crearSincronizadorConexion({
    writerChannels,
    emitirEstadoVotacionVentaja,
    emitirNubeInspiracionEstado,
    teleprompter,
    emitirEstadoDramaturgia = null,
    emitirEstadoDesventajasActivas = null,
    emitirEstadoCompeticion = null,
    emitirEstadoRelojPartida = null,
    emitirEstadoPalabrasMusasControl = null,
    partidaSync,
    getModoActual,
    isPartidaPausada = () => false,
    construirPayloadInspiracionMusaActual,
    emitirActivarModo,
    sincroModos,
    emitirTempModos,
    obtenerIdJugadorValido,
    emitirEstadoCalentamientoMusa,
    emitirEntregaInspiracionActiva = null,
    emitirEstadoPreShow = null,
    emitirEstadoVideoTutorial = null,
    emitirEstadoNarracionShow = null,
    sincronizarAyudaMusas = null,
    emitirEstadoAyudaControl = null
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
            const countSeconds = estado.count_seconds;
            const tieneCountSeconds = countSeconds !== null
                && typeof countSeconds !== 'undefined'
                && countSeconds !== ''
                && Number.isFinite(Number(countSeconds));
            if (!countText && tieneCountSeconds && typeof partidaSync.formatearTextoCountDesdeSegundos === 'function') {
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
        if (typeof emitirEstadoPreShow === 'function') {
            emitirEstadoPreShow(socket);
        }
        if (typeof emitirEstadoVideoTutorial === 'function') {
            emitirEstadoVideoTutorial(socket);
        }
        if (typeof emitirEstadoNarracionShow === 'function') {
            emitirEstadoNarracionShow(socket);
        }
        if (typeof sincronizarAyudaMusas === 'function') {
            sincronizarAyudaMusas(socket);
        }
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
        emitirEstadoVotacionVentaja(null, socket);
        emitirNubeInspiracionEstado(socket, true);
        if (typeof emitirEstadoPalabrasMusasControl === 'function') {
            emitirEstadoPalabrasMusasControl(socket);
        }
        teleprompter.emitirEstado(socket);
        if (typeof emitirEstadoPreShow === 'function') {
            emitirEstadoPreShow(socket);
        }
        if (typeof emitirEstadoVideoTutorial === 'function') {
            emitirEstadoVideoTutorial(socket);
        }
        if (typeof emitirEstadoNarracionShow === 'function') {
            emitirEstadoNarracionShow(socket);
        }
        if (socket.control && typeof emitirEstadoAyudaControl === 'function') {
            emitirEstadoAyudaControl(socket);
        }
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
        if (typeof emitirEstadoCompeticion === 'function') {
            emitirEstadoCompeticion(socket);
        }
        if (typeof emitirEstadoRelojPartida === 'function') {
            emitirEstadoRelojPartida(socket);
        }
        if (typeof isPartidaPausada === 'function' && isPartidaPausada()) {
            socket.emit('pausar_js', { restaurando: true });
        }
        // La restauración de una inspiración debe ser el último paso visual:
        // `post-inicio` reinicia paneles transitorios en los clientes y borraría
        // una entrega emitida antes durante una reconexión.
        const escritxrId = obtenerIdJugadorValido(socket.escritxr);
        if (escritxrId && typeof emitirEntregaInspiracionActiva === 'function') {
            emitirEntregaInspiracionActiva(escritxrId, socket);
        } else if (
            typeof emitirEntregaInspiracionActiva === 'function'
            && (
                socket.espectador
                || (socket.monitor_pantalla && socket.monitor_pantalla.rol === 'espectador')
            )
        ) {
            emitirEntregaInspiracionActiva(1, socket);
            emitirEntregaInspiracionActiva(2, socket);
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
