const DRAMATURGIA_UI_VERSION = "dramaturgia-complete-show-v10";

function registrarCanalesRoles({
    socket,
    io,
    bolzanoEvents,
    rolesConectados,
    sesionesEscritor,
    calentamientoGestor,
    bolzanoCalentamientoGestor,
    musasAuxiliares,
    normalizarMusaClientId,
    obtenerIdJugadorValido,
    normalizarNombreMusa,
    emitirEstadoBanderasMusas,
    sincronizarEstadoMusa,
    sincronizarSocketRecienConectado,
    emitirEstadoDramaturgia = () => null,
    simuladorPartidas = null,
    registrarMusaEnCreditosPartida = () => {},
    getPartidaActivaParaCreditos = () => false,
    registrar = () => {}
}) {
    const protegerEntradaHumana = (rol) => {
        if (
            simuladorPartidas
            && typeof simuladorPartidas.abortForHumanRole === "function"
        ) {
            simuladorPartidas.abortForHumanRole(socket, rol);
        }
    };

    socket.on("registrar_espectador", () => {
        protegerEntradaHumana("espectador");
        rolesConectados.registrarEspectador(socket);
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_jurado", () => {
        protegerEntradaHumana("jurado");
        rolesConectados.registrarJurado(socket);
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_dramaturgia", (payload = {}) => {
        const uiVersion = String(
            payload && typeof payload === "object"
                ? (payload.ui_version ?? payload.uiVersion ?? "")
                : payload
        ).trim();
        rolesConectados.registrarDramaturgia(socket);
        sincronizarSocketRecienConectado(socket);
        if (uiVersion !== DRAMATURGIA_UI_VERSION) {
            socket.emit("recargar_rol_remoto", {
                rol: "dramaturgia",
                motivo: "ui_desactualizada",
                ui_version: DRAMATURGIA_UI_VERSION,
                ts: Date.now()
            });
        }
    });

    socket.on("registrar_monitor_pantalla", (payload = {}, callback = null) => {
        const tieneRolReal = Boolean(
            socket.control
            || socket.espectador
            || socket.jurado
            || socket.escritxr
            || socket.musa
            || socket.actor
        );
        if (!socket.monitor_pantalla_solicitada || tieneRolReal) {
            const rechazo = {
                ok: false,
                code: tieneRolReal ? "ROLE_ALREADY_REGISTERED" : "MONITOR_HANDSHAKE_REQUIRED",
                rol: "",
                player: null,
                solo_lectura: true
            };
            if (typeof callback === "function") callback(rechazo);
            socket.emit("monitor_pantalla_estado", rechazo);
            return;
        }
        const resultado = rolesConectados.registrarMonitorPantalla(socket, payload);
        if (!resultado.ok) {
            if (typeof callback === "function") callback(resultado);
            socket.emit("monitor_pantalla_estado", resultado);
            return;
        }
        sincronizarSocketRecienConectado(socket);
        if (resultado.rol === "musa") {
            sincronizarEstadoMusa(socket);
        }
        socket.emit("monitor_pantalla_estado", resultado);
        if (typeof callback === "function") callback(resultado);
    });

    socket.on("pedir_estado_dramaturgia", () => {
        if (!socket.dramaturgia) {
            return;
        }
        emitirEstadoDramaturgia(socket);
    });

    socket.on("registrar_control", () => {
        protegerEntradaHumana("control");
        rolesConectados.registrarControl(socket);
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_escritor", (escritxr) => {
        protegerEntradaHumana("escritor");
        const registro = rolesConectados.registrarEscritor(socket, escritxr);
        if (!registro.ok) {
            console.warn(`[servidor] register_escritor: id invalido (${escritxr})`);
            return;
        }
        const id_jugador = registro.player;
        const sesion = sesionesEscritor.activar(socket, id_jugador);
        const clientIdActual = String(registro.clientId || "").trim();
        const socketsReemplazados = new Set();
        const debeAvisarReemplazo = (clientIdPrevio) => {
            const previo = String(clientIdPrevio || "").trim();
            return !clientIdActual || !previo || previo !== clientIdActual;
        };
        (registro.previousSessions || []).forEach((sesionPrevia) => {
            if (!sesionPrevia || !sesionPrevia.socketId || sesionPrevia.socketId === socket.id) return;
            if (debeAvisarReemplazo(sesionPrevia.clientId)) {
                socketsReemplazados.add(sesionPrevia.socketId);
            }
        });
        if (
            sesion
            && sesion.previousSocketId
            && sesion.previousSocketId !== socket.id
            && debeAvisarReemplazo(sesion.previousClientId)
        ) {
            socketsReemplazados.add(sesion.previousSocketId);
        }
        socketsReemplazados.forEach((socketId) => {
            io.to(socketId).emit("escritor_reemplazado", {
                player: id_jugador,
                role: `escritxr ${id_jugador}`,
                active_socket_id: socket.id,
                mensaje: "Otra sesi\u00f3n activa de este rol est\u00e1 activa. Esta pesta\u00f1a no va a funcionar."
            });
        });
        registrar(`[servidor] socket ${socket.id} registrado como escritor ${id_jugador}`);
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_actor", (payload = {}) => {
        protegerEntradaHumana("actor");
        const registro = rolesConectados.registrarActor(socket, payload);
        if (!registro.ok) return;
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_musa", (evento) => {
        protegerEntradaHumana("musa");
        const datos_musa = (evento && typeof evento === "object") ? evento : { musa: evento };
        const id_jugador = obtenerIdJugadorValido(datos_musa.musa);
        const nombre_musa = normalizarNombreMusa(datos_musa.nombre) || "MUSA";
        const musa_client_id = normalizarMusaClientId(datos_musa.client_id);
        const registro = rolesConectados.registrarMusa(socket, {
            player: id_jugador,
            nombre: nombre_musa,
            clientId: musa_client_id
        });
        registrar(`Una musa (${nombre_musa}) se ha unido a la partida para el equipo ${datos_musa.musa}.`);
        if (!registro.ok) {
            registrar(`[servidor] enviar_musa: escritxr=${datos_musa.musa} no es escritor valido; no cuento`);
            return;
        }
        if (typeof getPartidaActivaParaCreditos === "function" && getPartidaActivaParaCreditos()) {
            registrarMusaEnCreditosPartida({
                player: id_jugador,
                nombre: nombre_musa,
                clientId: musa_client_id,
                socketId: socket.id
            });
        }
        registrar("[servidor] contador_musas", registro.contador);
        io.emit("actualizar_contador_musas", registro.contador);
        if (registro.previous && registro.previous !== id_jugador) {
            calentamientoGestor.desregistrarMusa(socket, registro.previous);
        }
        calentamientoGestor.registrarMusa(socket, id_jugador, nombre_musa);
        const regaloPdf = musasAuxiliares.obtenerRegalo(id_jugador, musa_client_id);
        if (regaloPdf) {
            socket.emit("regalo_pdf_musas", regaloPdf);
        }
        emitirEstadoBanderasMusas(socket);
        musasAuxiliares.emitirEstadoRegaloBandera();
        sincronizarEstadoMusa(socket);
    });

    socket.on(bolzanoEvents.REGISTER_MUSA, (evento) => {
        const datos_musa = (evento && typeof evento === "object") ? evento : { musa: evento };
        const id_jugador = obtenerIdJugadorValido(datos_musa.musa);
        const nombre_musa = normalizarNombreMusa(datos_musa.nombre) || "MUSA";
        if (!id_jugador) {
            return;
        }
        bolzanoCalentamientoGestor.registrarMusa(socket, id_jugador, nombre_musa);
    });

    socket.on("disconnect", () => {
        const desconexion = rolesConectados.desregistrarSocket(socket);
        const id = desconexion.musaId;
        registrar(`[servidor] desconexion socket ${socket.id}, escritxr=${id}`);

        if (id !== 1 && id !== 2) {
            registrar("[servidor] desconexion de cliente sin escritxr valido, no se modifica contador.");
        }
        io.emit("actualizar_contador_musas", desconexion.contador);
        if (id === 1 || id === 2) {
            calentamientoGestor.desregistrarMusa(socket, id);
            musasAuxiliares.emitirEstadoRegaloBandera();
        }

        const idBolzano = Number(socket.musa_bolzano);
        if (idBolzano === 1 || idBolzano === 2) {
            bolzanoCalentamientoGestor.desregistrarMusa(socket, idBolzano);
        }

        const escritorId = desconexion.escritorId;
        if (escritorId === 1 || escritorId === 2) {
            const eraSesionActiva = sesionesEscritor.limpiarSiActiva(socket, escritorId);
            if (eraSesionActiva) {
                calentamientoGestor.desregistrarEscritor(socket, escritorId);
            }
        }
    });
}

module.exports = {
    DRAMATURGIA_UI_VERSION,
    registrarCanalesRoles
};
