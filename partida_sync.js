const crearEstadoConteoSync = () => ({
    1: { modo_seq: 0, count_seq: 0, tiempo_seq: 0, count_seconds: null, count_text: "" },
    2: { modo_seq: 0, count_seq: 0, tiempo_seq: 0, count_seconds: null, count_text: "" }
});

const convertirTextoCountASegundos = (valor) => {
    if (typeof valor !== "string") return null;
    const texto = valor.trim();
    if (!texto) return null;
    if (texto.toLowerCase().includes("tiempo")) {
        return 0;
    }
    const match = texto.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const minutos = Number(match[1]);
    const segundos = Number(match[2]);
    if (!Number.isFinite(minutos) || !Number.isFinite(segundos)) return null;
    return Math.max(0, (minutos * 60) + segundos);
};

const formatearTextoCountDesdeSegundos = (valor) => {
    const total = Math.max(0, Math.trunc(Number(valor) || 0));
    if (total <= 0) {
        return "¡Tiempo!";
    }
    const minutos = Math.floor(total / 60);
    const segundos = total % 60;
    return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
};

function crearGestorSincronizacionPartida({ validarJugador = (valor) => {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
} } = {}) {
    let modoSeq = 0;
    const tiempoSeq = { 1: 0, 2: 0 };
    let ultimoConteo = crearEstadoConteoSync();

    const obtenerModoSeq = () => Number(modoSeq) || 0;

    const siguienteModoSeq = () => {
        modoSeq += 1;
        return modoSeq;
    };

    const withModoSeq = (payload = {}) => ({
        ...((payload && typeof payload === "object") ? payload : {}),
        modo_seq: obtenerModoSeq()
    });

    const siguienteTiempoSeq = (player) => {
        const id = validarJugador(player);
        if (!id) return 0;
        tiempoSeq[id] = (Number(tiempoSeq[id]) || 0) + 1;
        return tiempoSeq[id];
    };

    const obtenerTiempoSeq = (player) => {
        const id = validarJugador(player);
        if (!id) return 0;
        return Number(tiempoSeq[id]) || 0;
    };

    const resetTiempoSeq = () => {
        tiempoSeq[1] = 0;
        tiempoSeq[2] = 0;
    };

    const resetConteoSync = () => {
        ultimoConteo = crearEstadoConteoSync();
        return ultimoConteo;
    };

    const obtenerConteo = (player) => {
        const id = validarJugador(player);
        if (!id) return null;
        return ultimoConteo[id] || crearEstadoConteoSync()[id];
    };

    const guardarConteo = (player, estado = {}) => {
        const id = validarJugador(player);
        if (!id) return null;
        ultimoConteo[id] = {
            ...crearEstadoConteoSync()[id],
            ...((estado && typeof estado === "object") ? estado : {})
        };
        return ultimoConteo[id];
    };

    const construirPayloadCount = (datos = {}) => {
        const payload = { ...((datos && typeof datos === "object") ? datos : {}) };
        payload.modo_seq = obtenerModoSeq();
        const playerId = validarJugador(payload.player);
        if (playerId && !Number.isFinite(Number(payload.tiempo_seq))) {
            payload.tiempo_seq = obtenerTiempoSeq(playerId);
        }
        return payload;
    };

    return {
        construirPayloadCount,
        convertirTextoCountASegundos,
        formatearTextoCountDesdeSegundos,
        guardarConteo,
        obtenerConteo,
        obtenerModoSeq,
        obtenerTiempoSeq,
        resetConteoSync,
        resetTiempoSeq,
        siguienteModoSeq,
        siguienteTiempoSeq,
        withModoSeq
    };
}

module.exports = {
    convertirTextoCountASegundos,
    crearEstadoConteoSync,
    crearGestorSincronizacionPartida,
    formatearTextoCountDesdeSegundos
};
