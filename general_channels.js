function registrarCanalesGenerales({
    socket,
    io,
    passwordRoles,
    obtenerEstadoEscritores,
    obtenerIdJugadorValido,
    getModoActual = () => "",
    partidaSync,
    construirPayloadCount
}) {
    socket.on("validar_password_roles", (payload, callback) => {
        const pass = (typeof payload === "string")
            ? payload
            : (payload && typeof payload.password === "string" ? payload.password : "");
        const ok = pass === passwordRoles;
        if (typeof callback === "function") {
            callback({ ok });
        } else {
            socket.emit("validar_password_roles", { ok });
        }
    });

    socket.on("health_ping", (_payload, callback) => {
        const estado = obtenerEstadoEscritores();
        if (typeof callback === "function") {
            callback(estado);
        } else {
            socket.emit("health_pong", estado);
        }
    });

    socket.on("borrar_texto_guardado", () => {
        io.emit("borrar_texto_guardado");
    });

    socket.on("activar_temporizador_gigante", (evento) => {
        const duracion = Number(evento?.duracion) || (10 * 60);
        io.emit("temporizador_gigante_inicio", { duracion });
    });

    socket.on("temporizador_gigante_detener", () => {
        io.emit("temporizador_gigante_detener");
    });

    socket.on("enviar_comentario", (evento) => {
        if (evento == null) {
            return;
        }
        io.emit("recibir_comentario", evento);
    });

    socket.on("aumentar_tiempo", (evento) => {
        if (!evento) {
            return;
        }
        const id_jugador = obtenerIdJugadorValido(evento.player);
        if (!id_jugador) {
            return;
        }
        const secs = Number(evento.secs);
        if (!Number.isFinite(secs) || secs === 0) {
            return;
        }
        if (getModoActual() === "frase final") {
            return;
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
    });
}

module.exports = {
    registrarCanalesGenerales
};
