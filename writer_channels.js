const { aplicarParcheTexto, crearParcheTexto } = require("./text_patch.js");

const crearEstadoTextos = () => ({
    html: { 1: "", 2: "" },
    plano: { 1: "", 2: "" },
    nombres: { 1: "", 2: "" },
    atributos: { 1: {}, 2: {} },
    revisiones: { 1: 0, 2: 0 }
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
    puedeActualizarTexto = () => true,
    onTextoActualizado = () => {},
    onNombreCambiado = () => {},
    onStateChanged = () => {},
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
        onStateChanged(snapshotEstado());
    };

    const textoHtmlDesdeEvento = (evento) => {
        if (typeof evento === "string") return evento;
        return evento && typeof evento.text === "string" ? evento.text : "";
    };

    const payloadSnapshotTexto = (player) => ({
        player,
        revision: estado.revisiones[player] || 0,
        payload: estado.html[player],
        text: textoHtmlDesdeEvento(estado.html[player]),
        plain: estado.plano[player] || ""
    });

    const snapshotEstado = () => ({
        textos: snapshotTextos(),
        nombres: { ...estado.nombres },
        atributos: snapshotAtributos(),
        revisiones: { ...estado.revisiones }
    });

    const restaurar = (snapshot = {}) => {
        const textos = snapshot && snapshot.textos && typeof snapshot.textos === "object"
            ? snapshot.textos
            : snapshot;
        [1, 2].forEach((player) => {
            const entrada = textos && (textos[player] || textos[String(player)]);
            if (!entrada || typeof entrada !== "object") return;
            estado.html[player] = Object.prototype.hasOwnProperty.call(entrada, "html")
                ? entrada.html
                : (Object.prototype.hasOwnProperty.call(entrada, "payload") ? entrada.payload : "");
            estado.plano[player] = typeof entrada.plano === "string"
                ? entrada.plano
                : (typeof entrada.plain === "string" ? entrada.plain : extraerTextoPlano(estado.html[player]));
            const revisiones = snapshot && snapshot.revisiones;
            estado.revisiones[player] = Math.max(0, Math.trunc(Number(
                entrada.revision ?? (revisiones && revisiones[player])
            ) || 0));
        });
        const nombres = snapshot && snapshot.nombres;
        const atributos = snapshot && snapshot.atributos;
        [1, 2].forEach((player) => {
            if (nombres && typeof nombres[player] === "string") estado.nombres[player] = nombres[player];
            if (atributos && atributos[player] && typeof atributos[player] === "object") {
                estado.atributos[player] = { ...atributos[player] };
            }
        });
        return snapshotEstado();
    };

    const emitirTextos = (socket) => {
        if (!socket || typeof socket.emit !== "function") return;
        socket.emit("texto1", estado.html[1]);
        socket.emit("texto2", estado.html[2]);
    };

    const socketsConectados = () => {
        const registro = io && io.sockets && io.sockets.sockets;
        if (!registro) return [];
        if (typeof registro.values === "function") return Array.from(registro.values());
        return Object.values(registro);
    };

    const socketSuscrito = (socketDestino, player) => {
        const suscripciones = socketDestino && socketDestino.scrib_text_subscriptions;
        if (!(suscripciones instanceof Set)) return null;
        return suscripciones.has(player);
    };

    const emitirActualizacionTexto = (socketOrigen, player, evento, delta) => {
        const destinos = socketsConectados();
        if (!destinos.length) {
            if (socketOrigen && socketOrigen.broadcast && typeof socketOrigen.broadcast.emit === "function") {
                socketOrigen.broadcast.emit(`texto${player}`, evento);
            }
            return;
        }
        destinos.forEach((destino) => {
            if (!destino || destino.id === socketOrigen.id || typeof destino.emit !== "function") return;
            const suscrito = socketSuscrito(destino, player);
            if (suscrito === false) return;
            if (suscrito === true && destino.scrib_text_deltas === true) {
                destino.emit("texto_delta", delta);
                return;
            }
            destino.emit(`texto${player}`, evento);
        });
    };

    const metaEventoTexto = (evento = {}) => {
        if (!evento || typeof evento !== "object") return {};
        const permitidos = [
            "points", "level", "caretPos", "caretLine", "caretRatio", "caretPath", "caretOffset"
        ];
        const meta = {};
        permitidos.forEach((clave) => {
            if (Object.prototype.hasOwnProperty.call(evento, clave)) meta[clave] = evento[clave];
        });
        return meta;
    };

    const emitirNombres = (destino = io) => {
        if (!destino || typeof destino.emit !== "function") return;
        destino.emit("nombre1", estado.nombres[1]);
        destino.emit("nombre2", estado.nombres[2]);
    };

    const esSocketActivoParaJugador = (socket, player) => (
        !sesionesEscritor || sesionesEscritor.esActiva(socket, player)
    );

    const actualizarTexto = (socket, player, evento) => {
        const id = validarJugador(player);
        if (!id) return false;
        if (!esSocketActivoParaJugador(socket, id)) {
            if (socket && typeof socket.emit === "function") {
                socket.emit("escritor_sesion_inactiva", {
                    player: id,
                    mismo_client_id: Boolean(
                        sesionesEscritor
                        && typeof sesionesEscritor.esMismoClienteActivo === "function"
                        && sesionesEscritor.esMismoClienteActivo(socket, id)
                    )
                });
            }
            return false;
        }
        if (!puedeActualizarTexto({ socket, player: id, evento })) {
            return false;
        }
        const textoAnterior = estado.plano[id] || "";
        const htmlAnterior = textoHtmlDesdeEvento(estado.html[id]);
        estado.html[id] = evento;
        estado.plano[id] = extraerTextoPlano(evento);
        const revisionAnterior = estado.revisiones[id] || 0;
        estado.revisiones[id] = revisionAnterior + 1;
        actualizarTextoJugador(id, estado.plano[id]);
        onTextoActualizado(id, textoAnterior, estado.plano[id], evento);
        emitirActualizacionTexto(socket, id, evento, {
            player: id,
            baseRevision: revisionAnterior,
            revision: estado.revisiones[id],
            htmlPatch: crearParcheTexto(htmlAnterior, textoHtmlDesdeEvento(evento)),
            plainPatch: crearParcheTexto(textoAnterior, estado.plano[id]),
            meta: metaEventoTexto(evento)
        });
        onStateChanged(snapshotEstado());
        return true;
    };

    const actualizarTextoDelta = (socket, entrada = {}, callback = null) => {
        const id = validarJugador(entrada && entrada.player);
        const responder = (payload) => {
            if (typeof callback === "function") callback(payload);
            return payload;
        };
        if (!id || !esSocketActivoParaJugador(socket, id)) {
            return responder({ ok: false, code: "INACTIVE_WRITER", player: id });
        }
        if (!puedeActualizarTexto({ socket, player: id, evento: entrada })) {
            return responder({ ok: false, code: "TEXT_LOCKED", player: id });
        }
        const revisionActual = estado.revisiones[id] || 0;
        const baseRevision = Number(entrada.baseRevision ?? entrada.base_revision);
        if (!Number.isInteger(baseRevision) || baseRevision !== revisionActual) {
            socket.emit("texto_snapshot", payloadSnapshotTexto(id));
            return responder({ ok: false, code: "REVISION_MISMATCH", player: id, revision: revisionActual });
        }
        const htmlAnterior = textoHtmlDesdeEvento(estado.html[id]);
        const planoAnterior = estado.plano[id] || "";
        const htmlSiguiente = aplicarParcheTexto(htmlAnterior, entrada.htmlPatch || entrada.html_patch);
        const planoPropuesto = aplicarParcheTexto(planoAnterior, entrada.plainPatch || entrada.plain_patch);
        if (htmlSiguiente === null || planoPropuesto === null) {
            socket.emit("texto_snapshot", payloadSnapshotTexto(id));
            return responder({ ok: false, code: "INVALID_PATCH", player: id, revision: revisionActual });
        }
        const meta = metaEventoTexto(entrada.meta || {});
        const evento = {
            ...meta,
            text: htmlSiguiente,
            texto_guardado: planoPropuesto
        };
        const planoSiguiente = extraerTextoPlano(evento);
        estado.html[id] = evento;
        estado.plano[id] = planoSiguiente;
        estado.revisiones[id] = revisionActual + 1;
        actualizarTextoJugador(id, planoSiguiente);
        onTextoActualizado(id, planoAnterior, planoSiguiente, evento);
        const delta = {
            player: id,
            baseRevision: revisionActual,
            revision: estado.revisiones[id],
            htmlPatch: crearParcheTexto(htmlAnterior, htmlSiguiente),
            plainPatch: crearParcheTexto(planoAnterior, planoSiguiente),
            meta
        };
        emitirActualizacionTexto(socket, id, evento, delta);
        onStateChanged(snapshotEstado());
        return responder({ ok: true, player: id, revision: estado.revisiones[id] });
    };

    const actualizarCursor = (socket, entrada = {}) => {
        const id = validarJugador(entrada && entrada.player);
        if (!id || !esSocketActivoParaJugador(socket, id)) return false;
        const payload = { player: id, ...metaEventoTexto(entrada) };
        delete payload.points;
        delete payload.level;
        socketsConectados().forEach((destino) => {
            if (!destino || destino.id === socket.id || destino.scrib_text_cursor !== true) return;
            if (socketSuscrito(destino, id) !== true || typeof destino.emit !== "function") return;
            destino.emit("texto_cursor", payload);
        });
        return true;
    };

    const suscribirTextos = (socket, payload = {}, callback = null) => {
        const solicitados = Array.isArray(payload.players) ? payload.players : [payload.player];
        const players = Array.from(new Set(solicitados.map(validarJugador).filter(Boolean)));
        socket.scrib_text_subscriptions = new Set(players);
        socket.scrib_text_deltas = payload.deltas === true;
        socket.scrib_text_cursor = payload.cursors === true;
        players.forEach((player) => socket.emit("texto_snapshot", payloadSnapshotTexto(player)));
        const respuesta = {
            ok: true,
            protocol: 2,
            players,
            deltas: socket.scrib_text_deltas,
            cursors: socket.scrib_text_cursor
        };
        if (typeof callback === "function") callback(respuesta);
        return respuesta;
    };

    const jugadorSolicitado = (socket, payload = {}) => {
        const solicitado = validarJugador(
            payload && (payload.musa ?? payload.player ?? payload.equipo ?? payload.team)
        );
        if (solicitado) return solicitado;
        const rolSocket = validarJugador(
            socket && (socket.musa ?? socket.actor ?? socket.escritxr)
        );
        if (rolSocket) return rolSocket;
        const monitor = socket && socket.monitor_pantalla;
        if (
            monitor
            && ["musa", "actor", "escritor"].includes(monitor.rol)
        ) {
            return validarJugador(monitor.player);
        }
        return null;
    };

    const pedirTexto = (socket, payload = {}) => {
        const player = jugadorSolicitado(socket, payload) || 2;
        socket.emit(`texto${player}`, estado.html[player]);
    };

    const pedirNombre = (socket, payload = {}) => {
        logger("te escucho pedir_nombre", payload);
        const solicitado = validarJugador(
            payload && (payload.musa ?? payload.player ?? payload.equipo ?? payload.team)
        );
        const player = jugadorSolicitado(socket, payload) || 1;
        socket.emit("dar_nombre", estado.nombres[player]);
        if (!solicitado) {
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

    const actualizarAtributos = (socket, datos = {}) => {
        if (!datos || !datos.atributos) return false;
        const id = validarJugador(datos.player);
        if (!id) return false;
        if (!esSocketActivoParaJugador(socket, id)) {
            return false;
        }
        estado.atributos[id] = datos.atributos;
        onStateChanged(snapshotEstado());
        return true;
    };

    const registrarHandlers = (socket) => {
        socket.on("texto1", (evento) => actualizarTexto(socket, 1, evento));
        socket.on("texto2", (evento) => actualizarTexto(socket, 2, evento));
        socket.on("texto_delta_actualizar", (evento, callback) => actualizarTextoDelta(socket, evento, callback));
        socket.on("texto_cursor_actualizar", (evento) => actualizarCursor(socket, evento));
        socket.on("suscribir_textos", (payload, callback) => suscribirTextos(socket, payload, callback));
        socket.on("pedir_texto", (payload = {}) => pedirTexto(socket, payload));
        socket.on("pedir_nombre", (payload = {}) => pedirNombre(socket, payload));
        socket.on("env\u00edo_nombre1", (nombre) => actualizarNombre(socket, 1, nombre));
        socket.on("env\u00edo_nombre2", (nombre) => actualizarNombre(socket, 2, nombre));
        socket.on("envÃ­o_nombre1", (nombre) => actualizarNombre(socket, 1, nombre));
        socket.on("envÃ­o_nombre2", (nombre) => actualizarNombre(socket, 2, nombre));
        socket.on("enviar_atributos", (datos) => actualizarAtributos(socket, datos));
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
        restaurar,
        snapshotEstado,
        snapshotAtributos,
        snapshotTextos
    };
}

module.exports = {
    crearCanalesEscritor,
    crearEstadoTextos
};
