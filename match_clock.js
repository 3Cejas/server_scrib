function crearRelojPartida({
    io,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    onFinish = () => {}
} = {}) {
    let duracionTotalSegundos = 0;
    let restanteSegundos = 0;
    let terminaEnTs = 0;
    let activo = false;
    let pausado = false;
    let intervalo = null;
    let revision = 0;
    let finalNotificado = false;

    const limpiarIntervalo = () => {
        if (intervalo) {
            clearIntervalFn(intervalo);
            intervalo = null;
        }
    };

    const calcularRestante = () => {
        if (!activo || pausado || !terminaEnTs) {
            return Math.max(0, Math.trunc(restanteSegundos));
        }
        return Math.max(0, Math.ceil((terminaEnTs - now()) / 1000));
    };

    const snapshot = () => {
        restanteSegundos = calcularRestante();
        return {
            activo,
            pausado,
            duracion_total_segundos: duracionTotalSegundos,
            tiempo_restante_segundos: restanteSegundos,
            termina_en_ts: activo && !pausado ? terminaEnTs : 0,
            revision,
            now: now()
        };
    };

    const emitir = (socketDestino = null) => {
        const payload = snapshot();
        const destino = socketDestino && typeof socketDestino.emit === "function" ? socketDestino : io;
        if (destino && typeof destino.emit === "function") {
            destino.emit("reloj_partida_estado", payload);
        }
        return payload;
    };

    const finalizar = () => {
        if (finalNotificado) return snapshot();
        finalNotificado = true;
        restanteSegundos = 0;
        activo = false;
        pausado = false;
        terminaEnTs = 0;
        limpiarIntervalo();
        revision += 1;
        const payload = emitir();
        onFinish(payload);
        return payload;
    };

    const tick = () => {
        if (!activo || pausado) return snapshot();
        restanteSegundos = calcularRestante();
        if (restanteSegundos <= 0) return finalizar();
        return emitir();
    };

    const asegurarIntervalo = () => {
        limpiarIntervalo();
        intervalo = setIntervalFn(tick, 1000);
    };

    const iniciar = (segundos) => {
        const duracion = Math.max(1, Math.trunc(Number(segundos) || 0));
        duracionTotalSegundos = duracion;
        restanteSegundos = duracion;
        terminaEnTs = now() + (duracion * 1000);
        activo = true;
        pausado = false;
        finalNotificado = false;
        revision += 1;
        asegurarIntervalo();
        return emitir();
    };

    const pausar = () => {
        if (!activo || pausado) return snapshot();
        restanteSegundos = calcularRestante();
        terminaEnTs = 0;
        pausado = true;
        revision += 1;
        limpiarIntervalo();
        return emitir();
    };

    const reanudar = () => {
        if (!activo || !pausado || restanteSegundos <= 0) return snapshot();
        terminaEnTs = now() + (restanteSegundos * 1000);
        pausado = false;
        revision += 1;
        asegurarIntervalo();
        return emitir();
    };

    const detener = ({ conservarRestante = false } = {}) => {
        if (conservarRestante) restanteSegundos = calcularRestante();
        else restanteSegundos = 0;
        activo = false;
        pausado = false;
        terminaEnTs = 0;
        finalNotificado = false;
        revision += 1;
        limpiarIntervalo();
        return emitir();
    };

    return {
        detener,
        emitir,
        iniciar,
        pausar,
        reanudar,
        snapshot,
        tick
    };
}

module.exports = { crearRelojPartida };
