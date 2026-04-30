const normalizarDelay = (valor) => Math.max(0, Number(valor) || 0);

function crearGestorTimersPartida({ getModoActual = () => "" } = {}) {
    let cambioLetraTimer = null;
    let votacionTimer = null;
    let inicioTimer = null;
    let intervaloModos = null;

    let cambioLetraSeq = 0;
    let votacionSeq = 0;
    let inicioSeq = 0;
    let intervaloModosSeq = 0;

    const cancelarCambioLetra = () => {
        clearTimeout(cambioLetraTimer);
        cambioLetraTimer = null;
        cambioLetraSeq += 1;
        return cambioLetraSeq;
    };

    const programarCambioLetra = (modoEsperado, callback, tiempoMs) => {
        const seq = cancelarCambioLetra();
        cambioLetraTimer = setTimeout(() => {
            if (seq !== cambioLetraSeq) return;
            if (modoEsperado && getModoActual() !== modoEsperado) return;
            callback();
        }, normalizarDelay(tiempoMs));
        return seq;
    };

    const cancelarVotacion = () => {
        clearTimeout(votacionTimer);
        votacionTimer = null;
        votacionSeq += 1;
        return votacionSeq;
    };

    const programarVotacion = (callback, tiempoMs) => {
        const seq = cancelarVotacion();
        votacionTimer = setTimeout(() => {
            if (seq !== votacionSeq) return;
            callback();
        }, normalizarDelay(tiempoMs));
        return seq;
    };

    const cancelarInicio = () => {
        clearTimeout(inicioTimer);
        inicioTimer = null;
        inicioSeq += 1;
        return inicioSeq;
    };

    const programarInicio = (callback, tiempoMs) => {
        const seq = cancelarInicio();
        inicioTimer = setTimeout(() => {
            if (seq !== inicioSeq) return;
            callback();
        }, normalizarDelay(tiempoMs));
        return seq;
    };

    const cancelarIntervaloModos = () => {
        clearInterval(intervaloModos);
        intervaloModos = null;
        intervaloModosSeq += 1;
        return intervaloModosSeq;
    };

    const programarIntervaloModos = (callback, tiempoMs = 1000) => {
        const seq = cancelarIntervaloModos();
        intervaloModos = setInterval(() => {
            if (seq !== intervaloModosSeq) return;
            callback();
        }, normalizarDelay(tiempoMs));
        return seq;
    };

    const cancelarRonda = () => {
        cancelarVotacion();
        cancelarInicio();
        cancelarIntervaloModos();
    };

    return {
        cancelarCambioLetra,
        cancelarInicio,
        cancelarIntervaloModos,
        cancelarRonda,
        cancelarVotacion,
        programarCambioLetra,
        programarInicio,
        programarIntervaloModos,
        programarVotacion
    };
}

module.exports = {
    crearGestorTimersPartida
};
