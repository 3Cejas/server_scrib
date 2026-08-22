const MONITOR_EVENTOS_LECTURA = new Set([
    "health_ping",
    "pedir_atributos",
    "pedir_calentamiento_estado",
    "pedir_creditos_estado",
    "pedir_estado_banderas_musas",
    "pedir_estado_control",
    "pedir_estado_dramaturgia",
    "pedir_estado_musa",
    "pedir_estado_palabras_musas_control",
    "pedir_estado_regalo_bandera_musas",
    "pedir_feedback_musas_estado",
    "pedir_idioma_actual",
    "pedir_nombre",
    "pedir_nube_inspiracion",
    "pedir_resumen_musas_pdf",
    "pedir_stats_live",
    "pedir_teleprompter_estado",
    "pedir_texto",
    "pedir_vista_espectador_modo",
    "registrar_monitor_pantalla",
    "validar_password_roles"
]);

function eventoPermitidoParaMonitor(evento) {
    return MONITOR_EVENTOS_LECTURA.has(String(evento || ""));
}

function instalarGuardiaMonitor(socket, { now = () => Date.now() } = {}) {
    if (!socket || typeof socket.use !== "function") {
        return false;
    }

    socket.use((packet = [], next) => {
        const evento = Array.isArray(packet) ? packet[0] : "";
        const esMonitor = Boolean(socket.monitor_pantalla || socket.monitor_pantalla_solicitada);
        if (!esMonitor || eventoPermitidoParaMonitor(evento)) {
            next();
            return;
        }

        const args = Array.isArray(packet) ? packet.slice(1) : [];
        const callback = args.length && typeof args[args.length - 1] === "function"
            ? args[args.length - 1]
            : null;
        const respuesta = {
            ok: false,
            solo_lectura: true,
            evento: String(evento || ""),
            ts: now()
        };
        if (callback) {
            callback(respuesta);
        }
        if (typeof socket.emit === "function") {
            socket.emit("monitor_pantalla_bloqueo", respuesta);
        }
    });
    return true;
}

module.exports = {
    MONITOR_EVENTOS_LECTURA,
    eventoPermitidoParaMonitor,
    instalarGuardiaMonitor
};
