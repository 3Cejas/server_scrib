const { randomBytes } = require("node:crypto");

const CANTO_SHOW_VERSION = 1;
const CANTO_SHOW_AUDIO_URL = "../media/musica-iliada.mp3";
const CANTO_SHOW_AUDIO_SECONDS = 32;
const CANTO_SHOW_FADE_MS = 1800;
const CANTO_SHOW_TEXT = "Musas, con esta inspiración inicial, ha llegado el momento de que las historias se hagan realidad. La Odisea de Homero comienza diciendo ‘Cántame a mí, Musa, la historia’. Y eso es lo que debéis hacer hoy: contar una historia. Junto con vuestra escritora, junto con vuestro equipo. Es la única forma de ganar.";
const MAX_REQUESTS_REMEMBERED = 256;

const normalizarRequestId = (value) => String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 96);

function crearGestorCantoShow({
    io,
    now = () => Date.now(),
    crearSessionId = () => `canto_${randomBytes(12).toString("hex")}`,
    onActivate = () => {},
    onDeactivate = () => {}
} = {}) {
    const sessionId = String(crearSessionId() || "").trim() || `canto_${Date.now()}`;
    let secuencia = 0;
    let activo = false;
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
        version: CANTO_SHOW_VERSION,
        session_id: sessionId,
        secuencia,
        activo,
        inicio_ts: activo ? inicioTs : 0,
        posicion_segundos: activo ? Math.max(0, (now() - inicioTs) / 1000) : 0,
        configuracion: {
            audio_url: CANTO_SHOW_AUDIO_URL,
            duracion_audio_segundos: CANTO_SHOW_AUDIO_SECONDS,
            fade_ms: CANTO_SHOW_FADE_MS,
            loop: true,
            texto: CANTO_SHOW_TEXT
        }
    });

    const emitirEstado = (socketDestino = null) => {
        const estado = payload();
        const destino = socketDestino && typeof socketDestino.emit === "function"
            ? socketDestino
            : io;
        if (destino && typeof destino.emit === "function") {
            destino.emit("canto_estado", estado);
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

    const activar = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        return ejecutarIdempotente("activar", requestId, () => {
            if (!activo) {
                onActivate();
                secuencia += 1;
                activo = true;
                inicioTs = now();
            }
            const estado = emitirEstado();
            return {
                ok: true,
                request_id: requestId || undefined,
                secuencia,
                estado
            };
        });
    };

    const desactivar = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        return ejecutarIdempotente("desactivar", requestId, () => {
            const estabaActivo = activo;
            activo = false;
            inicioTs = 0;
            if (estabaActivo) onDeactivate();
            const estado = emitirEstado();
            return {
                ok: true,
                request_id: requestId || undefined,
                secuencia,
                estado
            };
        });
    };

    const reset = () => {
        requests.clear();
        return desactivar();
    };

    const registrarHandlers = (socket) => {
        socket.on("pedir_canto_estado", (_entrada = {}, callback = null) => {
            const responder = typeof _entrada === "function" ? _entrada : callback;
            const estado = emitirEstado(socket);
            if (typeof responder === "function") responder({ ok: true, estado });
        });
        socket.on("canto_activar", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            const datos = typeof entrada === "function" ? {} : entrada;
            const resultado = socket.control
                ? activar(datos)
                : respuestaError("NOT_AUTHORIZED", normalizarRequestId(datos.request_id));
            if (typeof responder === "function") responder(resultado);
        });
        socket.on("canto_desactivar", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            const datos = typeof entrada === "function" ? {} : entrada;
            const resultado = socket.control
                ? desactivar(datos)
                : respuestaError("NOT_AUTHORIZED", normalizarRequestId(datos.request_id));
            if (typeof responder === "function") responder(resultado);
        });
    };

    return Object.freeze({
        activar,
        desactivar,
        emitirEstado,
        payload,
        registrarHandlers,
        reset
    });
}

module.exports = {
    CANTO_SHOW_AUDIO_SECONDS,
    CANTO_SHOW_AUDIO_URL,
    CANTO_SHOW_FADE_MS,
    CANTO_SHOW_TEXT,
    CANTO_SHOW_VERSION,
    crearGestorCantoShow
};
