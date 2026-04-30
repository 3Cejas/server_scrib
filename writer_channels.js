const crearEstadoTextos = () => ({
    html: { 1: "", 2: "" },
    plano: { 1: "", 2: "" },
    nombres: { 1: "", 2: "" },
    atributos: { 1: {}, 2: {} }
});

function crearCanalesEscritor({
    io,
    validarJugador = (valor) => {
        const id = Number(valor);
        return id === 1 || id === 2 ? id : null;
    },
    sesionesEscritor,
    extraerTextoPlano = (evento) => {
        if (typeof evento === "string") return evento;
        if (evento && typeof evento.text === "string") return evento.text;
        return "";
    },
    actualizarTextoJugador = () => {},
    onNombreCambiado = () => {},
    syncMode = () => {},
    logger = () => {}
} = {}) {
    let estado = crearEstadoTextos();

    const getTextoHtml = (player) => {
        const id = validarJugador(player);
        return id ? estado.html[id] : "";
    };

    const getTextoPlano = (player) => {
        const id = validarJugador(player);
        return id ? estado.plano[id] : "";
    };

    const getTextosPlanos = () => ({ ...estado.plano });

    const getNombre = (player) => {
        const id = validarJugador(player);
        return id ? estado.nombres[id] : "";
    };

    const getNombreEquipo = (equipo) => getNombre(equipo);

    const snapshotTextos = () => ({
        1: { html: estado.html[1], plano: estado.plano[1] || "" },
        2: { html: estado.html[2], plano: estado.plano[2] || "" }
    });

    const snapshotAtributos = () => ({
        1: { ...(estado.atributos[1] || {}) },
        2: { ...(estado.atributos[2] || {}) }
    });

    const reset = () => {
        estado = crearEstadoTextos();
    };

    const emitirTextos = (socket) => {
        if (!socket || typeof socket.emit !== "function") return;
        socket.emit("texto1", estado.html[1]);
        socket.emit("texto2", estado.html[2]);
    };

    const emitirNombres = (destino = io) => {
        if (!destino || typeof destino.emit !== "function") return;
        destino.emit("nombre1", estado.nombres[1]);
        destino.emit("nombre2", estado.nombres[2]);
    };

    const actualizarTexto = (socket, player, evento) => {
        const id = validarJugador(player);
        if (!id) return false;
        if (sesionesEscritor && !sesionesEscritor.esActiva(socket, id)) {
            return false;
        }
        estado.html[id] = evento;
        estado.plano[id] = extraerTextoPlano(evento);
        actualizarTextoJugador(id, estado.plano[id]);
        socket.broadcast.emit(`texto${id}`, evento);
        return true;
    };

    const pedirTexto = (socket) => {
        const musa = validarJugador(socket && socket.musa);
        const player = musa || 2;
        socket.emit(`texto${player}`, estado.html[player]);
    };

    const pedirNombre = (socket, payload = {}) => {
        logger("te escucho pedir_nombre", payload);
        const musaParam = Number(payload && payload.musa);
        const hayMusaPorParametro = musaParam === 1 || musaParam === 2;
        const musaEfectiva = hayMusaPorParametro ? musaParam : Number(socket && socket.musa);
        const musaFinal = validarJugador(musaEfectiva) || 1;
        socket.emit("dar_nombre", estado.nombres[musaFinal]);
        if (!hayMusaPorParametro) {
            syncMode(socket);
        }
    };

    const actualizarNombre = (socket, player, nombre) => {
        const id = validarJugador(player);
        if (!id) return false;
        estado.nombres[id] = nombre;
        socket.broadcast.emit(`nombre${id}`, nombre);
        onNombreCambiado(id, nombre);
        return true;
    };

    const actualizarAtributos = (datos = {}) => {
        if (!datos || !datos.atributos) return false;
        const id = validarJugador(datos.player);
        if (!id) return false;
        estado.atributos[id] = datos.atributos;
        return true;
    };

    const registrarHandlers = (socket) => {
        socket.on("texto1", (evento) => actualizarTexto(socket, 1, evento));
        socket.on("texto2", (evento) => actualizarTexto(socket, 2, evento));
        socket.on("pedir_texto", () => pedirTexto(socket));
        socket.on("pedir_nombre", (payload = {}) => pedirNombre(socket, payload));
        socket.on("env\u00edo_nombre1", (nombre) => actualizarNombre(socket, 1, nombre));
        socket.on("env\u00edo_nombre2", (nombre) => actualizarNombre(socket, 2, nombre));
        socket.on("envÃ­o_nombre1", (nombre) => actualizarNombre(socket, 1, nombre));
        socket.on("envÃ­o_nombre2", (nombre) => actualizarNombre(socket, 2, nombre));
        socket.on("enviar_atributos", (datos) => actualizarAtributos(datos));
        socket.on("pedir_atributos", () => socket.emit("recibir_atributos", snapshotAtributos()));
    };

    return {
        emitirNombres,
        emitirTextos,
        getNombre,
        getNombreEquipo,
        getTextoHtml,
        getTextoPlano,
        getTextosPlanos,
        registrarHandlers,
        reset,
        snapshotAtributos,
        snapshotTextos
    };
}

module.exports = {
    crearCanalesEscritor,
    crearEstadoTextos
};
