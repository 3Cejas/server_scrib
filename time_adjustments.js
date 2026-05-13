function aplicarAjusteTiempo({
    io,
    evento,
    obtenerIdJugadorValido,
    getModoActual = () => "",
    partidaSync,
    construirPayloadCount = (payload) => payload,
    permitirSinModo = true
} = {}) {
    if (!evento || !io || !partidaSync || typeof obtenerIdJugadorValido !== "function") {
        return null;
    }
    const id_jugador = obtenerIdJugadorValido(evento.player);
    if (!id_jugador) {
        return null;
    }
    const secs = Number(evento.secs);
    if (!Number.isFinite(secs) || secs === 0) {
        return null;
    }
    const modoActual = typeof getModoActual === "function" ? getModoActual() : "";
    if ((!permitirSinModo && !modoActual) || modoActual === "frase final") {
        return null;
    }
    const tiempoSeq = partidaSync.siguienteTiempoSeq(id_jugador);
    const payloadAjuste = {
        ...evento,
        player: id_jugador,
        secs,
        tiempo_seq: tiempoSeq
    };
    const estadoConteo = partidaSync.obtenerConteo(id_jugador) || { count_seq: 0, count_seconds: null };
    if (Number.isFinite(estadoConteo.count_seconds)) {
        const segundosActualizados = Math.max(0, Number(estadoConteo.count_seconds) + secs);
        const siguienteCountSeq = (Number(estadoConteo.count_seq) || 0) + 1;
        payloadAjuste.count_seconds_after = segundosActualizados;
        payloadAjuste.count_after = partidaSync.formatearTextoCountDesdeSegundos(segundosActualizados);
        const conteoActualizado = partidaSync.guardarConteo(id_jugador, {
            ...estadoConteo,
            modo_seq: partidaSync.obtenerModoSeq(),
            tiempo_seq: tiempoSeq,
            count_seq: siguienteCountSeq,
            count_seconds: segundosActualizados,
            count_text: payloadAjuste.count_after
        });
        io.emit("count", construirPayloadCount({
            player: id_jugador,
            count: conteoActualizado.count_text,
            count_seq: siguienteCountSeq,
            tiempo_seq: tiempoSeq
        }));
    }
    io.emit("aumentar_tiempo_control", payloadAjuste);
    return payloadAjuste;
}

module.exports = {
    aplicarAjusteTiempo
};
