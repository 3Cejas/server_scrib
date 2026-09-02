const TELEPROMPTER_TEXT_MAX = 50000;

const TELEPROMPTER_LIMITES = {
    fontMin: 18,
    fontMax: 96,
    speedMin: 5,
    speedMax: 300
};

const clampNumber = (valor, min, max) => Math.min(Math.max(valor, min), max);

const crearEstadoTeleprompter = (revision) => ({
    visible: false,
    preparing: false,
    text: "",
    fontSize: 36,
    speed: 25,
    playing: false,
    scroll: 0,
    source: 0,
    loadId: 0,
    revision
});

const crearFeedbackVacio = () => ({
    lastFeedback: null,
    ackBySource: {
        1: null,
        2: null
    }
});

const normalizarRevision = (valor) => {
    if (!Number.isFinite(valor)) {
        return null;
    }
    return Math.max(0, Math.trunc(Number(valor)));
};

function crearGestorTeleprompter({ io, getTextoEscritor = () => ({ 1: "", 2: "" }) }) {
    let revisionSeq = 0;
    const siguienteRevision = () => {
        revisionSeq += 1;
        return revisionSeq;
    };

    let state = crearEstadoTeleprompter(siguienteRevision());
    let feedbackState = crearFeedbackVacio();

    const normalizarPayload = (payload = {}) => {
        const salida = { ...state };
        if (typeof payload.visible === "boolean") {
            salida.visible = payload.visible;
        }
        if (typeof payload.preparing === "boolean") {
            salida.preparing = payload.preparing;
        }
        if (typeof payload.text === "string") {
            salida.text = payload.text.slice(0, TELEPROMPTER_TEXT_MAX);
        }
        if (Number.isFinite(payload.fontSize)) {
            salida.fontSize = clampNumber(payload.fontSize, TELEPROMPTER_LIMITES.fontMin, TELEPROMPTER_LIMITES.fontMax);
        }
        if (Number.isFinite(payload.speed)) {
            salida.speed = clampNumber(payload.speed, TELEPROMPTER_LIMITES.speedMin, TELEPROMPTER_LIMITES.speedMax);
        }
        if (Number.isFinite(payload.scroll)) {
            salida.scroll = payload.scroll;
        }
        if (typeof payload.playing === "boolean") {
            salida.playing = payload.playing;
        }
        if (payload.source !== undefined) {
            const fuente = Number(payload.source);
            salida.source = fuente === 1 || fuente === 2 ? fuente : 0;
        } else if (typeof salida.text === "string" && salida.text.trim().length > 0) {
            const textos = getTextoEscritor() || {};
            const textoPlano = salida.text.trim();
            const textoJ1 = (textos[1] || "").trim();
            const textoJ2 = (textos[2] || "").trim();
            if (textoPlano && textoPlano === textoJ1 && textoPlano !== textoJ2) {
                salida.source = 1;
            } else if (textoPlano && textoPlano === textoJ2 && textoPlano !== textoJ1) {
                salida.source = 2;
            }
        }
        if (Number.isFinite(payload.loadId)) {
            salida.loadId = Math.max(0, Math.trunc(Number(payload.loadId)));
        }
        const revision = normalizarRevision(payload.revision);
        if (revision !== null) {
            salida.revision = revision;
        }
        return salida;
    };

    const normalizarFeedback = (payload = {}) => {
        const type = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : "";
        const id = typeof payload.id === "string" ? payload.id.trim() : "";
        if (!id || (type !== "press" && type !== "held")) {
            return null;
        }
        return {
            type,
            id: id.slice(0, 64),
            active: Boolean(payload.active),
            duration: clampNumber(Math.trunc(Number(payload.duration) || 160), 60, 1200)
        };
    };

    const emitirEstado = (socketDestino = null) => {
        const payload = { state };
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("teleprompter_state", payload);
            return payload;
        }
        io.emit("teleprompter_state", payload);
        return payload;
    };

    const snapshot = () => ({
        state: { ...state },
        feedback: feedbackState.lastFeedback ? { ...feedbackState.lastFeedback } : null,
        ackBySource: {
            1: feedbackState.ackBySource[1] ? { ...feedbackState.ackBySource[1] } : null,
            2: feedbackState.ackBySource[2] ? { ...feedbackState.ackBySource[2] } : null
        }
    });

    const reset = () => {
        state = crearEstadoTeleprompter(siguienteRevision());
        feedbackState = crearFeedbackVacio();
        return snapshot();
    };

    const registrarHandlers = (socket) => {
        socket.on("teleprompter_control", (payload = {}) => {
            const incomingState = payload && payload.state && typeof payload.state === "object"
                ? payload.state
                : {};
            const incomingRevision = normalizarRevision(incomingState.revision);
            if (incomingRevision !== null && incomingRevision < revisionSeq) {
                emitirEstado(socket);
                return;
            }
            const nextState = normalizarPayload(incomingState);
            if (incomingRevision === null) {
                nextState.revision = siguienteRevision();
            } else {
                revisionSeq = Math.max(revisionSeq, incomingRevision);
                nextState.revision = revisionSeq;
            }
            state = nextState;
            emitirEstado();
        });

        socket.on("pedir_teleprompter_estado", () => {
            emitirEstado(socket);
        });

        socket.on("teleprompter_feedback", (payload = {}) => {
            const feedback = normalizarFeedback(payload);
            if (!feedback) {
                return;
            }
            feedbackState.lastFeedback = {
                ...feedback,
                ts: Date.now()
            };
            socket.broadcast.emit("teleprompter_feedback", {
                ...feedback,
                ts: feedbackState.lastFeedback.ts
            });
        });

        socket.on("teleprompter_ack", (payload = {}) => {
            const loadId = Number(payload.loadId);
            if (!Number.isFinite(loadId) || loadId <= 0) {
                return;
            }
            const normalizedLoadId = Math.max(1, Math.trunc(loadId));
            const source = Number(payload.source) === 2 ? 2 : 1;
            feedbackState.ackBySource[source] = {
                loadId: normalizedLoadId,
                source,
                rendered: Boolean(payload.rendered),
                overlayActive: Boolean(payload.overlayActive),
                timerActive: Boolean(payload.timerActive),
                ts: Date.now()
            };
            io.emit("teleprompter_ack", {
                loadId: normalizedLoadId,
                source,
                rendered: Boolean(payload.rendered),
                overlayActive: Boolean(payload.overlayActive),
                timerActive: Boolean(payload.timerActive),
                visible: Boolean(payload.visible),
                textLength: Math.max(0, Math.trunc(Number(payload.textLength) || 0)),
                ts: Date.now()
            });
        });
    };

    return {
        emitirEstado,
        registrarHandlers,
        reset,
        snapshot
    };
}

module.exports = {
    crearGestorTeleprompter
};
