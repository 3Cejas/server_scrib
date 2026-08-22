const {
    crearJugadorStatsLiveVacio,
    normalizarPayloadStatsLive
} = require('./server_state_utils');

function crearGestorStatsLive({ io, getModoActual = () => "" } = {}) {
    const normalizar = (payload = {}) => normalizarPayloadStatsLive(payload, {
        modoActual: getModoActual(),
        now: Date.now()
    });

    let estado = normalizar({});
    let datosRecibidos = { 1: false, 2: false };

    const payload = () => ({
        ts: estado.ts || Date.now(),
        modo_actual: estado.modo_actual || "",
        players: {
            1: { ...(estado.players && estado.players[1] ? estado.players[1] : crearJugadorStatsLiveVacio(1)) },
            2: { ...(estado.players && estado.players[2] ? estado.players[2] : crearJugadorStatsLiveVacio(2)) }
        }
    });

    const actualizar = (entrada = {}) => {
        estado = normalizar(entrada);
        return payload();
    };

    const actualizarDesdeControl = (entrada = {}) => {
        const players = entrada && entrada.players && typeof entrada.players === "object"
            ? entrada.players
            : {};
        [1, 2].forEach((player) => {
            if (
                Object.prototype.hasOwnProperty.call(players, player)
                && players[player]
                && typeof players[player] === "object"
            ) {
                datosRecibidos[player] = true;
            }
        });
        return actualizar(entrada);
    };

    const reset = () => {
        datosRecibidos = { 1: false, 2: false };
        return actualizar({ modo_actual: "" });
    };

    const payloadDatosRecibidos = () => ({ ...datosRecibidos });

    const emitir = (socketDestino = null) => {
        const salida = payload();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("stats_live_estado", salida);
            return salida;
        }
        if (io && typeof io.emit === "function") {
            io.emit("stats_live_estado", salida);
        }
        return salida;
    };

    return {
        actualizar,
        actualizarDesdeControl,
        emitir,
        payload,
        payloadDatosRecibidos,
        reset
    };
}

module.exports = {
    crearGestorStatsLive
};
