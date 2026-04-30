const {
    actualizarEstadoResurreccionSnapshot,
    crearEstadoResurreccionVacio,
    payloadEstadoResurreccion
} = require("./server_state_utils");

const crearEstadoInicial = () => ({
    1: crearEstadoResurreccionVacio(1),
    2: crearEstadoResurreccionVacio(2)
});

function crearGestorResurreccion({
    io,
    partidaSync,
    validarJugador,
    getModoActual = () => "",
    isFinDelJuego = () => false,
    marcarFinJugador = () => {},
    estadoJugadores = {},
    construirPayloadCount = (payload) => payload,
    activarModo = () => {},
    getTextoPlano = () => ""
} = {}) {
    let estado = crearEstadoInicial();

    const actualizarEstado = (player, payload = {}) => {
        const snapshot = actualizarEstadoResurreccionSnapshot(estado, player, payload, {
            validarPlayer: validarJugador,
            now: Date.now()
        });
        if (!snapshot.value) return null;
        estado = snapshot.state;
        return snapshot.value;
    };

    const payload = () => payloadEstadoResurreccion(estado);

    const reset = () => {
        estado = crearEstadoInicial();
    };

    const ocultarMenu = (player) => actualizarEstado(player, {
        player,
        menu: "hidden",
        visible: false,
        mainIndex: 0,
        quantityIndex: 0,
        palabras: 0,
        max: 0,
        segundos: 0
    });

    const emitirOculto = (player) => {
        const estadoOculto = ocultarMenu(player);
        if (estadoOculto) {
            io.emit("resucitar_menu", estadoOculto);
        }
        return estadoOculto;
    };

    const mostrarMenuFinJugador = (player, { textoPlano = null } = {}) => {
        const playerId = validarJugador(player);
        const modoActual = getModoActual();
        if (!playerId || !modoActual || modoActual === "frase final") {
            return null;
        }
        const texto = String(textoPlano ?? getTextoPlano(playerId) ?? "").trim();
        const palabras = texto ? texto.split(/\s+/).filter(Boolean).length : 0;
        const estadoVisible = actualizarEstado(playerId, {
            player: playerId,
            menu: "quantity",
            visible: true,
            mainIndex: 0,
            quantityIndex: 0,
            palabras: 1,
            max: Math.max(1, palabras),
            segundos: 3
        });
        if (estadoVisible) {
            io.emit("resucitar_menu", estadoVisible);
        }
        return estadoVisible;
    };

    const resucitarJugador = (socket, evento = {}) => {
        const id_jugador = validarJugador(evento && evento.player);
        const payloadEvento = (evento && typeof evento === "object") ? evento : {};
        const estadoResurreccion = payload()[id_jugador];
        let palabrasSolicitadas = Math.max(0, Math.trunc(Number(payloadEvento.palabras) || 0));
        if (!palabrasSolicitadas && estadoResurreccion && estadoResurreccion.visible) {
            palabrasSolicitadas = Math.max(0, Math.trunc(Number(estadoResurreccion.palabras) || 0));
        }
        let secs = Number(payloadEvento.secs);
        if ((!Number.isFinite(secs) || secs <= 0) && palabrasSolicitadas > 0) {
            secs = palabrasSolicitadas * 3;
        }
        if (!id_jugador || !Number.isFinite(secs) || secs <= 0) {
            return false;
        }

        const modoActual = getModoActual();
        if (modoActual === "frase final") {
            return false;
        }

        marcarFinJugador(id_jugador, false);
        if (estadoJugadores[id_jugador]) {
            estadoJugadores[id_jugador].finished = false;
            estadoJugadores[id_jugador].inserts = -1;
        }

        emitirOculto(id_jugador);

        const tiempoSeq = partidaSync.siguienteTiempoSeq(id_jugador);
        const estadoConteo = partidaSync.obtenerConteo(id_jugador) || { count_seq: 0 };
        const siguienteCountSeq = (Number(estadoConteo.count_seq) || 0) + 1;
        const textoCount = partidaSync.formatearTextoCountDesdeSegundos(secs);
        partidaSync.guardarConteo(id_jugador, {
            ...estadoConteo,
            modo_seq: partidaSync.obtenerModoSeq(),
            tiempo_seq: tiempoSeq,
            count_seq: siguienteCountSeq,
            count_seconds: secs,
            count_text: textoCount
        });
        io.emit("count", construirPayloadCount({
            player: id_jugador,
            count: textoCount,
            count_seq: siguienteCountSeq,
            tiempo_seq: tiempoSeq
        }));
        io.emit("resucitar_control", { player: id_jugador, secs, tiempo_seq: tiempoSeq });
        activarModo(modoActual, socket);
        return true;
    };

    const actualizarMenuDesdeEscritor = (socket, evento = {}) => {
        const escritorId = validarJugador(socket.escritxr);
        const payloadEvento = (evento && typeof evento === "object") ? evento : {};
        const playerId = validarJugador(payloadEvento.player) || escritorId;
        if (!escritorId || !playerId || playerId !== escritorId) {
            return false;
        }

        const rondaActiva = Boolean(
            !isFinDelJuego()
            && typeof getModoActual() === "string"
            && getModoActual().trim().length > 0
        );

        if (!rondaActiva) {
            emitirOculto(playerId);
            return true;
        }

        const estadoVisible = actualizarEstado(playerId, {
            player: playerId,
            menu: typeof payloadEvento.menu === "string" ? payloadEvento.menu : "hidden",
            visible: Boolean(payloadEvento.visible),
            mainIndex: Number.isInteger(payloadEvento.mainIndex) ? payloadEvento.mainIndex : 0,
            quantityIndex: Number.isInteger(payloadEvento.quantityIndex) ? payloadEvento.quantityIndex : 0,
            palabras: Math.max(0, Number(payloadEvento.palabras) || 0),
            max: Math.max(0, Number(payloadEvento.max) || 0),
            segundos: Math.max(0, Number(payloadEvento.segundos) || 0)
        });
        if (estadoVisible) {
            io.emit("resucitar_menu", estadoVisible);
        }
        return true;
    };

    const registrarHandlers = (socket) => {
        socket.on("resucitar", (evento) => resucitarJugador(socket, evento));
        socket.on("resucitar_menu", (evento = {}) => actualizarMenuDesdeEscritor(socket, evento));
    };

    const sincronizarSocket = (socket) => {
        if (!socket || typeof socket.emit !== "function") return;
        const estadoActual = payload();
        socket.emit("resucitar_menu", estadoActual[1]);
        socket.emit("resucitar_menu", estadoActual[2]);
    };

    return {
        actualizarEstado,
        emitirOculto,
        mostrarMenuFinJugador,
        payload,
        registrarHandlers,
        reset,
        resucitarJugador,
        sincronizarSocket
    };
}

module.exports = {
    crearGestorResurreccion
};
