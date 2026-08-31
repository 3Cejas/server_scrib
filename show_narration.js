const { randomBytes } = require("node:crypto");

const SHOW_NARRATION_VERSION = 1;
const SHOW_NARRATION_PREROLL_SECONDS = 5;
const SHOW_NARRATION_AUDIO_SECONDS = 80.013;
const SHOW_NARRATION_AUDIO_URL = "../media/narracion-show.mp3";
const SHOW_NARRATION_SLIDE_URL = "../media/narracion-final.png";
const MAX_REQUESTS_REMEMBERED = 256;

const normalizarRequestId = (value) => String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 96);

function restaurarPreShowTrasNarracion({
    resolverModoVista = () => "",
    preShowMusas = null
} = {}) {
    if (
        !preShowMusas
        || typeof resolverModoVista !== "function"
        || resolverModoVista() !== "tutorial"
    ) {
        return false;
    }
    if (
        typeof preShowMusas.estaActivo === "function"
        && preShowMusas.estaActivo()
    ) {
        if (typeof preShowMusas.emitirEstado === "function") {
            preShowMusas.emitirEstado();
        }
        return true;
    }
    if (typeof preShowMusas.abrir !== "function") return false;
    preShowMusas.abrir();
    return true;
}

function crearGestorNarracionShow({
    io,
    now = () => Date.now(),
    crearSessionId = () => `narracion_${randomBytes(12).toString("hex")}`,
    onStart = () => {},
    onStop = () => {}
} = {}) {
    const sessionId = String(crearSessionId() || "").trim() || `narracion_${Date.now()}`;
    let secuencia = 0;
    let activa = false;
    let inicioTs = 0;
    const requests = new Map();

    const limitarRequests = () => {
        while (requests.size > MAX_REQUESTS_REMEMBERED) {
            const first = requests.keys().next().value;
            if (!first) break;
            requests.delete(first);
        }
    };

    const payload = () => ({
        version: SHOW_NARRATION_VERSION,
        session_id: sessionId,
        secuencia,
        activa,
        reproduciendo: activa,
        inicio_ts: activa ? inicioTs : 0,
        posicion_segundos: activa ? Math.max(0, (now() - inicioTs) / 1000) : 0,
        configuracion: {
            pre_roll_segundos: SHOW_NARRATION_PREROLL_SECONDS,
            duracion_audio_segundos: SHOW_NARRATION_AUDIO_SECONDS,
            audio_url: SHOW_NARRATION_AUDIO_URL,
            slide_url: SHOW_NARRATION_SLIDE_URL
        }
    });

    const emitirEstado = (socketDestino = null) => {
        const estado = payload();
        const destino = socketDestino && typeof socketDestino.emit === "function"
            ? socketDestino
            : io;
        if (destino && typeof destino.emit === "function") {
            destino.emit("narracion_show_estado", estado);
        }
        return estado;
    };

    const respuestaError = (code, requestId = "") => ({
        ok: false,
        code,
        ...(requestId ? { request_id: requestId } : {}),
        estado: payload()
    });

    const ejecutarIdempotente = (accion, requestId, callback) => {
        const key = requestId ? `${accion}:${requestId}` : "";
        if (key && requests.has(key)) {
            return { ...requests.get(key), idempotente: true, estado: payload() };
        }
        const resultado = callback();
        if (key && resultado && resultado.ok) {
            requests.set(key, { ...resultado, estado: undefined });
            limitarRequests();
        }
        return resultado;
    };

    const reproducir = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        return ejecutarIdempotente("reproducir", requestId, () => {
            onStart();
            secuencia += 1;
            activa = true;
            inicioTs = now();
            const estado = emitirEstado();
            return {
                ok: true,
                request_id: requestId || undefined,
                secuencia,
                estado
            };
        });
    };

    const detener = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        return ejecutarIdempotente("detener", requestId, () => {
            const estabaActiva = activa;
            activa = false;
            inicioTs = 0;
            if (estabaActiva) onStop();
            // La vista que estaba debajo se restaura antes de retirar la capa
            // de narracion, evitando un fotograma vacio en musas y espectador.
            const estado = emitirEstado();
            return {
                ok: true,
                request_id: requestId || undefined,
                secuencia,
                estado
            };
        });
    };

    const registrarHandlers = (socket) => {
        socket.on("pedir_narracion_show_estado", (_entrada = {}, callback = null) => {
            const responder = typeof _entrada === "function" ? _entrada : callback;
            const estado = emitirEstado(socket);
            if (typeof responder === "function") responder({ ok: true, estado });
        });
        socket.on("narracion_show_reproducir", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            const datos = typeof entrada === "function" ? {} : entrada;
            const resultado = socket.control
                ? reproducir(datos)
                : respuestaError("NOT_AUTHORIZED", normalizarRequestId(datos.request_id));
            if (typeof responder === "function") responder(resultado);
        });
        socket.on("narracion_show_detener", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            const datos = typeof entrada === "function" ? {} : entrada;
            const resultado = socket.control
                ? detener(datos)
                : respuestaError("NOT_AUTHORIZED", normalizarRequestId(datos.request_id));
            if (typeof responder === "function") responder(resultado);
        });
    };

    return Object.freeze({
        detener,
        emitirEstado,
        payload,
        registrarHandlers,
        reproducir
    });
}

module.exports = {
    SHOW_NARRATION_AUDIO_SECONDS,
    SHOW_NARRATION_AUDIO_URL,
    SHOW_NARRATION_PREROLL_SECONDS,
    SHOW_NARRATION_SLIDE_URL,
    SHOW_NARRATION_VERSION,
    crearGestorNarracionShow,
    restaurarPreShowTrasNarracion
};
