const { ROLE_ROOMS } = require("./role_connections.js");

function crearGestorModoDebug({ io, now = () => Date.now() } = {}) {
    let activo = false;
    let revision = 0;

    const payload = () => ({
        activo,
        revision,
        ts: now()
    });

    const emitir = (destino = null) => {
        const estado = payload();
        if (destino && typeof destino.emit === "function") {
            destino.emit("modo_debug_estado", estado);
            return estado;
        }
        if (io && typeof io.to === "function") {
            io.to(ROLE_ROOMS.CONTROL).emit("modo_debug_estado", estado);
        } else if (io && typeof io.emit === "function") {
            io.emit("modo_debug_estado", estado);
        }
        return estado;
    };

    const establecer = (valor) => {
        const siguiente = Boolean(valor);
        if (siguiente !== activo) {
            activo = siguiente;
            revision += 1;
            if (!activo && io && typeof io.emit === "function") {
                io.emit("debug_detonadores_detener", { ts: now() });
            }
        }
        return emitir();
    };

    const registrarHandlers = (socket) => {
        socket.on("pedir_modo_debug_estado", (_payload = {}, callback = null) => {
            const responder = typeof _payload === "function" ? _payload : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder({ ok: false, code: "NOT_AUTHORIZED" });
                return;
            }
            const estado = emitir(socket);
            if (typeof responder === "function") responder({ ok: true, ...estado });
        });

        socket.on("modo_debug_establecer", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder({ ok: false, code: "NOT_AUTHORIZED" });
                return;
            }
            const valor = entrada && typeof entrada === "object" ? entrada.activo : entrada;
            const estado = establecer(valor === true);
            if (typeof responder === "function") responder({ ok: true, ...estado });
        });

        socket.on("debug_detonadores_prueba", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder({ ok: false, code: "NOT_AUTHORIZED" });
                return;
            }
            if (!activo) {
                if (typeof responder === "function") responder({ ok: false, code: "DEBUG_MODE_REQUIRED" });
                return;
            }
            const datos = entrada && typeof entrada === "object" ? entrada : {};
            const visual = {
                seq: Math.max(0, Math.round(Number(datos.seq) || 0)),
                cantidad: Math.min(8, Math.max(1, Math.round(Number(datos.cantidad) || 3))),
                velocidad: Math.min(10, Math.max(1, Number(datos.velocidad) || 5)),
                ts: now()
            };
            if (io && typeof io.emit === "function") io.emit("debug_detonadores_visual", visual);
            if (typeof responder === "function") responder({ ok: true, ...visual });
        });

        socket.on("debug_detonadores_detener", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder({ ok: false, code: "NOT_AUTHORIZED" });
                return;
            }
            if (!activo) {
                if (typeof responder === "function") responder({ ok: false, code: "DEBUG_MODE_REQUIRED" });
                return;
            }
            const estado = { ts: now() };
            if (io && typeof io.emit === "function") io.emit("debug_detonadores_detener", estado);
            if (typeof responder === "function") responder({ ok: true, ...estado });
        });
    };

    return {
        establecer,
        emitir,
        isActive: () => activo,
        payload,
        registrarHandlers
    };
}

module.exports = {
    crearGestorModoDebug
};
