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
    registrar = () => {}
}) {
    socket.on("registrar_espectador", () => {
        rolesConectados.registrarEspectador(socket);
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_control", () => {
        rolesConectados.registrarControl(socket);
    });

    socket.on("registrar_escritor", (escritxr) => {
        const registro = rolesConectados.registrarEscritor(socket, escritxr);
        if (!registro.ok) {
            console.warn(`[servidor] register_escritor: id invalido (${escritxr})`);
            return;
        }
        const id_jugador = registro.player;
        sesionesEscritor.activar(socket, id_jugador);
        registrar(`[servidor] socket ${socket.id} registrado como escritor ${id_jugador}`);
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_actor", (payload = {}) => {
        const registro = rolesConectados.registrarActor(socket, payload);
        if (!registro.ok) return;
        sincronizarSocketRecienConectado(socket);
    });

    socket.on("registrar_musa", (evento) => {
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
        registrar("[servidor] contador_musas", registro.contador);
        io.emit("actualizar_contador_musas", registro.contador);
        calentamientoGestor.registrarMusa(socket, id_jugador, nombre_musa);
        const regaloPdf = musasAuxiliares.obtenerRegalo(id_jugador);
        if (regaloPdf) {
            socket.emit("regalo_pdf_musas", regaloPdf);
        }
        emitirEstadoBanderasMusas(socket);
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
        }

        const idBolzano = Number(socket.musa_bolzano);
        if (idBolzano === 1 || idBolzano === 2) {
            bolzanoCalentamientoGestor.desregistrarMusa(socket, idBolzano);
        }

        const escritorId = desconexion.escritorId;
        if (escritorId === 1 || escritorId === 2) {
            sesionesEscritor.limpiarSiActiva(socket, escritorId);
            calentamientoGestor.desregistrarEscritor(socket, escritorId);
        }
    });
}

module.exports = {
    registrarCanalesRoles
};
