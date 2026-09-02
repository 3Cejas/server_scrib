const DURACION_TEMPORIZADOR_POR_DEFECTO = 10 * 60;
const DURACION_TEMPORIZADOR_MAXIMA = 4 * 60 * 60;

function normalizarDuracionTemporizador(valor) {
    const duracion = Math.trunc(Number(valor));
    if (!Number.isFinite(duracion) || duracion <= 0) {
        return DURACION_TEMPORIZADOR_POR_DEFECTO;
    }
    return Math.min(duracion, DURACION_TEMPORIZADOR_MAXIMA);
}

function crearGestorTemporizadorShow({
    io = null,
    now = () => Date.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer)
} = {}) {
    let timerFin = null;
    let secuencia = 0;
    let estado = {
        estado: "oculto",
        duracion: 0,
        inicio_ts: 0,
        fin_ts: 0
    };

    const limpiarTimerFin = () => {
        if (timerFin !== null) {
            cancel(timerFin);
            timerFin = null;
        }
    };

    const payload = () => {
        const instante = now();
        const restante = estado.estado === "activo"
            ? Math.max(0, Math.ceil((estado.fin_ts - instante) / 1000))
            : 0;
        return {
            ...estado,
            activo: estado.estado === "activo",
            mostrar: estado.estado !== "oculto",
            restante,
            seq: secuencia,
            ts: instante
        };
    };

    const emitir = (socketDestino = null) => {
        const salida = payload();
        const destino = socketDestino && typeof socketDestino.emit === "function"
            ? socketDestino
            : io;
        if (destino && typeof destino.emit === "function") {
            destino.emit("temporizador_gigante_estado", salida);
        }
        return salida;
    };

    const finalizar = () => {
        limpiarTimerFin();
        if (estado.estado !== "activo") return payload();
        estado = { ...estado, estado: "finalizado" };
        secuencia += 1;
        if (io && typeof io.emit === "function") {
            io.emit("temporizador_gigante_final", payload());
        }
        return emitir();
    };

    const iniciar = (valorDuracion) => {
        limpiarTimerFin();
        const duracion = normalizarDuracionTemporizador(valorDuracion);
        const inicioTs = now();
        estado = {
            estado: "activo",
            duracion,
            inicio_ts: inicioTs,
            fin_ts: inicioTs + (duracion * 1000)
        };
        secuencia += 1;
        timerFin = schedule(finalizar, duracion * 1000);
        if (timerFin && typeof timerFin.unref === "function") timerFin.unref();
        return emitir();
    };

    const detener = () => {
        limpiarTimerFin();
        estado = {
            estado: "oculto",
            duracion: 0,
            inicio_ts: 0,
            fin_ts: 0
        };
        secuencia += 1;
        return emitir();
    };

    return {
        detener,
        emitir,
        finalizar,
        iniciar,
        payload,
        reset: detener
    };
}

module.exports = {
    DURACION_TEMPORIZADOR_MAXIMA,
    DURACION_TEMPORIZADOR_POR_DEFECTO,
    crearGestorTemporizadorShow,
    normalizarDuracionTemporizador
};
