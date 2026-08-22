function normalizeArgs(payload, callback) {
    if (typeof payload === "function") {
        return { payload: {}, callback: payload };
    }
    return {
        payload: payload && typeof payload === "object" ? payload : {},
        callback
    };
}

function respond(socket, callback, eventName, payload) {
    if (typeof callback === "function") {
        callback(payload);
        return;
    }
    socket.emit(eventName, payload);
}

function registerSimulationChannels({ socket, simulator }) {
    if (!simulator) return false;

    socket.on("dramaturgia_sim_autorizar", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        respond(
            socket,
            args.callback,
            "dramaturgia_sim_autorizacion",
            simulator.authorize(socket, args.payload.password)
        );
    });

    socket.on("dramaturgia_sim_preflight", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        if (!socket.dramaturgia || socket.monitor_pantalla) {
            respond(socket, args.callback, "dramaturgia_sim_preflight_resultado", {
                ok: false,
                can_start: false,
                code: "NOT_DRAMATURGY",
                blockers: [],
                error: "Solo Dramaturgia puede comprobar el laboratorio."
            });
            return;
        }
        respond(
            socket,
            args.callback,
            "dramaturgia_sim_preflight_resultado",
            simulator.preflight()
        );
    });

    socket.on("dramaturgia_sim_iniciar", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        respond(socket, args.callback, "dramaturgia_sim_iniciar_resultado", simulator.start(socket, args.payload));
    });

    socket.on("dramaturgia_sim_pausar", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        respond(socket, args.callback, "dramaturgia_sim_pausar_resultado", simulator.pause(socket));
    });

    socket.on("dramaturgia_sim_reanudar", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        respond(socket, args.callback, "dramaturgia_sim_reanudar_resultado", simulator.resume(socket));
    });

    socket.on("dramaturgia_sim_paso", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        respond(socket, args.callback, "dramaturgia_sim_paso_resultado", simulator.step(socket));
    });

    socket.on("dramaturgia_sim_detener", (payload, callback) => {
        const args = normalizeArgs(payload, callback);
        respond(socket, args.callback, "dramaturgia_sim_detener_resultado", simulator.stop(socket));
    });

    socket.on("dramaturgia_sim_estado_pedir", () => {
        simulator.emitState(socket);
    });
    return true;
}

module.exports = {
    normalizeArgs,
    registerSimulationChannels,
    respond
};
