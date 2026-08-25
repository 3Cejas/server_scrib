const { ROLE_ROOMS } = require("./role_connections.js");

const DESTINOS_REINICIO_ROL = Object.freeze({
    escritxr1: { rol: "escritxr1", room: ROLE_ROOMS.writer(1) },
    escritxr2: { rol: "escritxr2", room: ROLE_ROOMS.writer(2) },
    espectador: { rol: "espectador", room: ROLE_ROOMS.SPECTATOR },
    jurado: { rol: "jurado", room: ROLE_ROOMS.JURY },
    actorxs1: { rol: "actorxs1", room: ROLE_ROOMS.actor(1) },
    actorxs2: { rol: "actorxs2", room: ROLE_ROOMS.actor(2) }
});

function normalizarDestinoReinicioRol(valor) {
    const normalizado = String(valor || "")
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    if (normalizado === "escritora1" || normalizado === "escritor1" || normalizado === "writer1") return "escritxr1";
    if (normalizado === "escritora2" || normalizado === "escritor2" || normalizado === "writer2") return "escritxr2";
    if (normalizado === "spectator") return "espectador";
    if (normalizado === "jury" || normalizado === "judge") return "jurado";
    if (normalizado === "actor1" || normalizado === "actores1") return "actorxs1";
    if (normalizado === "actor2" || normalizado === "actores2") return "actorxs2";
    return Object.prototype.hasOwnProperty.call(DESTINOS_REINICIO_ROL, normalizado) ? normalizado : "";
}

function registrarCanalesGenerales({
    socket,
    io,
    passwordRoles,
    accesoRoles = null,
    obtenerEstadoEscritores,
    obtenerIdJugadorValido,
    getModoActual = () => "",
    partidaSync,
    construirPayloadCount,
    sesionesEscritor = null,
    controlState = null,
    emitirEstadoPalabrasMusasControl = null,
    payloadEstadoPalabrasMusasControl = null
}) {
    const esEventoEscritorInactivo = (player) => (
        sesionesEscritor
        && socket
        && socket.escritxr
        && !sesionesEscritor.esActiva(socket, player)
    );

    socket.on("validar_password_roles", (payload, callback) => {
        const pass = (typeof payload === "string")
            ? payload
            : (payload && typeof payload.password === "string" ? payload.password : "");
        const resultado = accesoRoles && typeof accesoRoles.validarPassword === "function"
            ? accesoRoles.validarPassword(socket, pass)
            : { ok: pass === passwordRoles };
        if (typeof callback === "function") {
            callback(resultado);
        } else {
            socket.emit("validar_password_roles", resultado);
        }
    });

    socket.on("health_ping", (_payload, callback) => {
        const estado = obtenerEstadoEscritores();
        if (typeof payloadEstadoPalabrasMusasControl === "function") {
            estado.palabras_musas_control = payloadEstadoPalabrasMusasControl();
        }
        if (typeof callback === "function") {
            callback(estado);
        } else {
            socket.emit("health_pong", estado);
        }
    });

    socket.on("reiniciar_rol_remoto", (payload = {}) => {
        if (!socket.control) {
            return;
        }
        const valor = typeof payload === "string"
            ? payload
            : (payload.rol || payload.role || payload.destino || payload.target);
        const clave = normalizarDestinoReinicioRol(valor);
        const destino = DESTINOS_REINICIO_ROL[clave];
        if (!destino || !io || typeof io.to !== "function") {
            return;
        }
        io.to(destino.room).emit("recargar_rol_remoto", {
            rol: destino.rol,
            ts: Date.now()
        });
    });

    socket.on("borrar_texto_guardado", () => {
        io.emit("borrar_texto_guardado");
    });

    socket.on("pedir_estado_control", () => {
        if (controlState && typeof controlState.emitir === "function") {
            controlState.emitir(socket);
        }
    });

    socket.on("pedir_estado_palabras_musas_control", () => {
        if (typeof emitirEstadoPalabrasMusasControl === "function") {
            emitirEstadoPalabrasMusasControl(socket);
        }
    });

    socket.on("control_estado_actualizar", (payload = {}) => {
        if (!socket.control || !controlState || typeof controlState.actualizar !== "function") {
            return;
        }
        controlState.actualizar(payload);
        if (typeof controlState.emitir === "function") {
            controlState.emitir();
        }
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

}

module.exports = {
    registrarCanalesGenerales,
    normalizarDestinoReinicioRol
};
