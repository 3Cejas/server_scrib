const DRAMATURGIA_UI_VERSION = "dramaturgia-competition-clock-v11";

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
    getNombreEscritxr = () => "",
    emitirEstadoBanderasMusas,
    sincronizarEstadoMusa,
    sincronizarSocketRecienConectado,
    emitirEstadoDramaturgia = () => null,
    simuladorPartidas = null,
    registrarMusaEnCreditosPartida = () => {},
    getPartidaActivaParaCreditos = () => false,
    emitirEstadoVideoTutorial = () => null,
    autorizarRegistroControl = () => ({ ok: true, rol: "control", expires_ts: 0 }),
    registrar = () => {}
}) {
    const normalizarRequestIdMusa = (valor) => String(valor || "")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 96);

    const normalizarModoAsignacionMusa = (valor) => (
        String(valor || "").trim().toLowerCase() === "manual"
            ? "manual"
            : "automatica"
    );

    const construirOpcionesEquipoMusa = () => {
        const contador = rolesConectados.obtenerContadorMusas();
        const crearEquipo = (player) => ({
            player,
            equipo: player,
            color: player === 1 ? "azul" : "rojo",
            nombre_equipo: player === 1 ? "EQUIPO AZUL" : "EQUIPO ROJO",
            nombre_escritxr: String(getNombreEscritxr(player) || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80)
                || `ESCRITXR ${player}`,
            musas_activas: player === 1 ? contador.escritxr1 : contador.escritxr2
        });
        return {
            ok: true,
            equipos: [crearEquipo(1), crearEquipo(2)],
            ts: Date.now()
        };
    };

    const emitirOpcionesEquipoMusa = (destino = socket) => {
        const payload = construirOpcionesEquipoMusa();
        if (destino && typeof destino.emit === "function") {
            destino.emit("musa_opciones_equipo", payload);
        }
        return payload;
    };

    const construirAsignacionMusa = (registro = {}, motivo = "entrada", requestId = "") => {
        const player = obtenerIdJugadorValido(registro.player);
        if (!player) {
            const rechazo = {
                ok: false,
                code: "MUSE_ASSIGNMENT_FAILED",
                mensaje: "No se ha podido asignar un equipo.",
                ts: Date.now()
            };
            const requestIdNormalizado = normalizarRequestIdMusa(requestId);
            if (requestIdNormalizado) rechazo.request_id = requestIdNormalizado;
            return rechazo;
        }
        const nombreEscritxr = String(getNombreEscritxr(player) || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80)
            || `ESCRITXR ${player}`;
        const asignacion = {
            ok: true,
            version: 1,
            player,
            equipo: player,
            color: player === 1 ? "azul" : "rojo",
            nombre_equipo: player === 1 ? "EQUIPO AZUL" : "EQUIPO ROJO",
            escritxr: nombreEscritxr,
            nombre_escritxr: nombreEscritxr,
            reasignada: Boolean(registro.reassigned || registro.changed || motivo === "reequilibrio"),
            reconexion: Boolean(registro.reconnected),
            idempotente: Boolean(registro.idempotent),
            motivo,
            modo_asignacion: normalizarModoAsignacionMusa(registro.modoAsignacion),
            ts: Date.now()
        };
        const requestIdNormalizado = normalizarRequestIdMusa(requestId);
        if (requestIdNormalizado) asignacion.request_id = requestIdNormalizado;
        return asignacion;
    };

    const emitirAsignacionMusa = (socketDestino, registro, motivo, requestId = "") => {
        const payload = construirAsignacionMusa(registro, motivo, requestId);
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("musa_asignacion", payload);
        }
        return payload;
    };

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

    socket.on("registrar_control", (payload = {}, callback = null) => {
        if (typeof payload === "function") {
            callback = payload;
            payload = {};
        }
        const autorizacion = autorizarRegistroControl(socket, payload && typeof payload === "object" ? payload : {});
        if (!autorizacion || autorizacion.ok !== true) {
            const rechazo = {
                ok: false,
                code: autorizacion && autorizacion.code ? autorizacion.code : "INVALID_ACCESS_TOKEN",
                rol: "control",
                ts: Date.now()
            };
            socket.emit("control_registro_estado", rechazo);
            if (typeof callback === "function") callback(rechazo);
            return;
        }
        protegerEntradaHumana("control");
        if (socket.control_access_timer) {
            clearTimeout(socket.control_access_timer);
            socket.control_access_timer = null;
        }
        rolesConectados.registrarControl(socket);
        const expiresTs = Number(autorizacion.expires_ts) || 0;
        socket.control_access_expires_ts = expiresTs;
        if (expiresTs > Date.now()) {
            const expiracionEsperada = expiresTs;
            socket.control_access_timer = setTimeout(() => {
                socket.control_access_timer = null;
                if (
                    socket.control
                    && Number(socket.control_access_expires_ts) === expiracionEsperada
                    && Date.now() >= expiracionEsperada
                ) {
                    rolesConectados.desregistrarControl(socket);
                    socket.emit("control_registro_estado", {
                        ok: false,
                        code: "ACCESS_TOKEN_EXPIRED",
                        rol: "control",
                        ts: Date.now()
                    });
                }
            }, Math.max(1, expiresTs - Date.now()));
            if (socket.control_access_timer && typeof socket.control_access_timer.unref === "function") {
                socket.control_access_timer.unref();
            }
        }
        sincronizarSocketRecienConectado(socket);
        const respuesta = {
            ok: true,
            rol: "control",
            expires_ts: expiresTs,
            ts: Date.now()
        };
        const accessTokenRenovado = typeof autorizacion.access_token === "string"
            ? autorizacion.access_token.trim().slice(0, 256)
            : "";
        if (accessTokenRenovado) respuesta.access_token = accessTokenRenovado;
        socket.emit("control_registro_estado", respuesta);
        if (typeof callback === "function") callback(respuesta);
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

    socket.on("registrar_musa", (evento, callback = null) => {
        protegerEntradaHumana("musa");
        const datos_musa = (evento && typeof evento === "object") ? evento : { musa: evento };
        const nombre_musa = normalizarNombreMusa(datos_musa.nombre) || "MUSA";
        const musa_client_id = normalizarMusaClientId(datos_musa.client_id);
        const request_id = normalizarRequestIdMusa(datos_musa.request_id);
        const registro = rolesConectados.registrarMusa(socket, {
            player: datos_musa.musa ?? datos_musa.player ?? datos_musa.equipo ?? datos_musa.team,
            nombre: nombre_musa,
            clientId: musa_client_id,
            modoAsignacion: datos_musa.modo_asignacion ?? datos_musa.assignment_mode
        });
        if (!registro.ok) {
            const rechazo = construirAsignacionMusa(registro, "error", request_id);
            socket.emit("musa_asignacion", rechazo);
            if (typeof callback === "function") callback(rechazo);
            return;
        }
        const id_jugador = registro.player;
        registrar(`Una musa (${nombre_musa}) se ha unido a la partida para el equipo asignado ${id_jugador}.`);
        const motivoAsignacion = registro.idempotent
            ? "confirmacion"
            : (registro.reconnected ? "reconexion" : "entrada");
        const asignacion = emitirAsignacionMusa(socket, registro, motivoAsignacion, request_id);
        if (typeof callback === "function") callback(asignacion);
        (registro.replaced || []).forEach((anterior) => {
            if (!anterior || !anterior.socket) return;
            calentamientoGestor.desregistrarMusa(anterior.socket, anterior.player);
            io.to(anterior.socketId).emit("musa_reemplazada", {
                player: id_jugador,
                active_socket_id: socket.id,
                mensaje: "Esta musa se ha reconectado en otra pestaña.",
                ts: Date.now()
            });
        });
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
        emitirOpcionesEquipoMusa(io);
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
        emitirEstadoVideoTutorial();
    });

    socket.on("pedir_opciones_equipo_musa", (callback = null) => {
        const payload = emitirOpcionesEquipoMusa(socket);
        if (typeof callback === "function") callback(payload);
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
        if (socket.control_access_timer) {
            clearTimeout(socket.control_access_timer);
            socket.control_access_timer = null;
        }
        const desconexion = rolesConectados.desregistrarSocket(socket);
        const id = desconexion.musaId;
        registrar(`[servidor] desconexion socket ${socket.id}, escritxr=${id}`);

        if (id !== 1 && id !== 2) {
            registrar("[servidor] desconexion de cliente sin escritxr valido, no se modifica contador.");
        }
        io.emit("actualizar_contador_musas", desconexion.contador);
        emitirOpcionesEquipoMusa(io);
        if (id === 1 || id === 2) {
            calentamientoGestor.desregistrarMusa(socket, id);
        }

        (desconexion.reasignacionesMusas || []).forEach((reasignacion) => {
            const socketReasignado = reasignacion && reasignacion.socket;
            if (!socketReasignado) return;
            emitirAsignacionMusa(socketReasignado, {
                ...reasignacion,
                changed: true,
                reassigned: true,
                reconnected: false,
                idempotent: false
            }, "reequilibrio");
            calentamientoGestor.desregistrarMusa(socketReasignado, reasignacion.previous);
            calentamientoGestor.registrarMusa(
                socketReasignado,
                reasignacion.player,
                reasignacion.nombre || "MUSA"
            );
            if (typeof getPartidaActivaParaCreditos === "function" && getPartidaActivaParaCreditos()) {
                registrarMusaEnCreditosPartida({
                    player: reasignacion.player,
                    nombre: reasignacion.nombre || "MUSA",
                    clientId: reasignacion.clientId || "",
                    socketId: reasignacion.socketId
                });
            }
            const regaloPdf = musasAuxiliares.obtenerRegalo(
                reasignacion.player,
                reasignacion.clientId || ""
            );
            if (regaloPdf) {
                socketReasignado.emit("regalo_pdf_musas", regaloPdf);
            } else {
                socketReasignado.emit("regalo_pdf_musas_reset");
            }
            emitirEstadoBanderasMusas(socketReasignado);
            sincronizarEstadoMusa(socketReasignado);
        });
        musasAuxiliares.emitirEstadoRegaloBandera();
        if (
            id === 1
            || id === 2
            || (desconexion.reasignacionesMusas || []).length > 0
        ) {
            emitirEstadoVideoTutorial();
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
