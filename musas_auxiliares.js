const FEEDBACK_MUSAS_URL_POR_DEFECTO = "/feedback/";
const COOLDOWN_MUSA_CORAZON_MS = 900;

const crearEstadoBanderas = () => ({
    activa: false,
    bloqueado_por_control: false,
    actualizado_en: 0
});

const crearEstadoFeedback = () => ({
    activa: false,
    url: FEEDBACK_MUSAS_URL_POR_DEFECTO,
    solicitado_en: 0
});

const crearEstadoCorazones = () => ({
    1: { count: 0, ts: 0 },
    2: { count: 0, ts: 0 }
});

const crearEstadoRegalos = () => ({
    1: null,
    2: null
});

const normalizarUrlFeedbackMusas = (valor) => {
    const url = typeof valor === "string" ? valor.trim() : "";
    return url.startsWith("/") ? url : FEEDBACK_MUSAS_URL_POR_DEFECTO;
};

function crearGestorMusasAuxiliares({ io, validarEquipo = (valor) => {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
} } = {}) {
    let estadoBanderas = crearEstadoBanderas();
    let estadoFeedback = crearEstadoFeedback();
    let estadoCorazones = crearEstadoCorazones();
    let estadoRegalos = crearEstadoRegalos();

    const normalizarEquipo = (valor) => {
        const equipo = validarEquipo(valor);
        return equipo === 1 || equipo === 2 ? equipo : null;
    };

    const payloadBanderas = () => ({
        activa: Boolean(estadoBanderas.activa),
        bloqueado_por_control: Boolean(estadoBanderas.bloqueado_por_control),
        actualizado_en: Number(estadoBanderas.actualizado_en) || 0
    });

    const emitirBanderas = (socketDestino = null) => {
        const payload = payloadBanderas();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("estado_banderas_musas", payload);
            return payload;
        }
        if (io && typeof io.emit === "function") {
            io.emit("estado_banderas_musas", payload);
        }
        return payload;
    };

    const actualizarBanderas = (payload = {}) => {
        const datos = (payload && typeof payload === "object") ? payload : {};
        const activaSolicitada = (typeof datos.activa === "boolean")
            ? datos.activa
            : !estadoBanderas.activa;
        const bloquearDesactivar = activaSolicitada
            ? (typeof datos.bloquear_desactivar === "boolean" ? datos.bloquear_desactivar : true)
            : false;
        estadoBanderas = {
            activa: activaSolicitada,
            bloqueado_por_control: bloquearDesactivar,
            actualizado_en: Date.now()
        };
        return payloadBanderas();
    };

    const emitirBanderasCompat = (payload = payloadBanderas()) => {
        if (!io) return payload;
        io.to("musa_j1").emit("activar_banderas_musas", payload);
        io.to("musa_j2").emit("activar_banderas_musas", payload);
        return payload;
    };

    const payloadFeedback = () => ({
        activa: Boolean(estadoFeedback.activa),
        url: normalizarUrlFeedbackMusas(estadoFeedback.url),
        solicitado_en: Number(estadoFeedback.solicitado_en) || 0
    });

    const emitirFeedback = (socketDestino = null) => {
        const payload = payloadFeedback();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("feedback_musas_estado", payload);
            return payload;
        }
        if (io) {
            io.to("musa_j1").emit("feedback_musas_estado", payload);
            io.to("musa_j2").emit("feedback_musas_estado", payload);
        }
        return payload;
    };

    const solicitarFeedback = (payload = {}) => {
        estadoFeedback = {
            activa: true,
            url: normalizarUrlFeedbackMusas(payload && payload.url),
            solicitado_en: Date.now()
        };
        return payloadFeedback();
    };

    const payloadCorazones = () => ({
        1: { ...estadoCorazones[1] },
        2: { ...estadoCorazones[2] }
    });

    const registrarCorazon = ({ socket = null, equipo, respetarCooldown = true, now = Date.now() } = {}) => {
        const id = normalizarEquipo(equipo);
        if (!id) return null;
        if (
            respetarCooldown
            && socket
            && Number(socket._ultimo_corazon)
            && (now - Number(socket._ultimo_corazon)) < COOLDOWN_MUSA_CORAZON_MS
        ) {
            return null;
        }
        if (socket) {
            socket._ultimo_corazon = now;
        }
        estadoCorazones[id] = {
            count: Math.max(0, Number(estadoCorazones[id] && estadoCorazones[id].count) || 0) + 1,
            ts: now
        };
        const payload = { equipo: id, ts: now };
        if (io) {
            io.to(`j${id}`).emit("musa_corazon", payload);
        }
        return payload;
    };

    const guardarRegalo = (payload = {}) => {
        const playerId = normalizarEquipo(payload && payload.player);
        if (!playerId || !payload || !payload.data) {
            return null;
        }
        const salida = {
            player: playerId,
            data: payload.data,
            filename: payload.filename || `regalo_j${playerId}.pdf`
        };
        estadoRegalos[playerId] = salida;
        return { ...salida };
    };

    const obtenerRegalo = (playerId) => {
        const id = normalizarEquipo(playerId);
        if (!id || !estadoRegalos[id]) return null;
        return { ...estadoRegalos[id] };
    };

    const emitirResetRegalos = () => {
        if (!io) return;
        io.to("musa_j1").emit("regalo_pdf_musas_reset");
        io.to("musa_j2").emit("regalo_pdf_musas_reset");
    };

    const resetRegalos = ({ emitir = false } = {}) => {
        estadoRegalos = crearEstadoRegalos();
        if (emitir) {
            emitirResetRegalos();
        }
    };

    const resetEstado = () => {
        estadoBanderas = crearEstadoBanderas();
        estadoFeedback = crearEstadoFeedback();
        estadoCorazones = crearEstadoCorazones();
    };

    const snapshot = () => ({
        banderas: payloadBanderas(),
        feedback: payloadFeedback(),
        corazones: payloadCorazones()
    });

    return {
        actualizarBanderas,
        emitirBanderas,
        emitirBanderasCompat,
        emitirFeedback,
        emitirResetRegalos,
        guardarRegalo,
        obtenerRegalo,
        payloadBanderas,
        payloadCorazones,
        payloadFeedback,
        registrarCorazon,
        resetEstado,
        resetRegalos,
        solicitarFeedback,
        snapshot
    };
}

module.exports = {
    COOLDOWN_MUSA_CORAZON_MS,
    FEEDBACK_MUSAS_URL_POR_DEFECTO,
    crearGestorMusasAuxiliares,
    normalizarUrlFeedbackMusas
};
