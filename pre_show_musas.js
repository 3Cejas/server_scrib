const { contieneLenguajeOfensivo, normalizarUnicodeParaFiltro } = require("./profanity_filter.js");
const { ROLE_ROOMS } = require("./role_connections.js");
const { randomBytes } = require("node:crypto");

const PRE_SHOW_VERSION = 1;
const MAX_TEXTO_PRE_SHOW = 180;
const MAX_MENSAJES_PRE_SHOW = 24;
const COOLDOWN_PRE_SHOW_MS = 2500;
const VENTANA_RATE_PRE_SHOW_MS = 30000;
const MAX_MENSAJES_POR_VENTANA = 6;
const VENTANA_INTENTOS_PRE_SHOW_MS = 10000;
const MAX_INTENTOS_POR_VENTANA = 10;
const VENTANA_DUPLICADO_PRE_SHOW_MS = 20000;
const REQUEST_ID_TTL_MS = 120000;
const MAX_REQUEST_IDS_RECORDADOS = 2048;
const MAX_BUCKETS_ACTIVIDAD_PRE_SHOW = 4096;

const REGEX_CONTROLES = /[\u0000-\u001f\u007f-\u009f]/gu;
const REGEX_ETIQUETA_HTML = /<[^>]*>/gu;
const REGEX_DELIMITADORES_HTML = /[<>]/gu;

function normalizarTextoPreShow(valor) {
    if (typeof valor !== "string") return "";
    return normalizarUnicodeParaFiltro(valor)
        .replace(REGEX_CONTROLES, " ")
        .replace(REGEX_ETIQUETA_HTML, " ")
        .replace(REGEX_DELIMITADORES_HTML, "")
        .replace(/\s+/gu, " ")
        .trim();
}

function longitudUnicode(valor) {
    return Array.from(String(valor || "")).length;
}

function normalizarRequestId(valor) {
    if (typeof valor === "string" && valor.length > 256) return "";
    return String(valor || "")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 96);
}

function crearGestorPreShowMusas({
    io,
    obtenerMusaActiva = () => null,
    now = () => Date.now(),
    contieneOfensa = contieneLenguajeOfensivo,
    crearSessionId = () => `pre_${randomBytes(12).toString("hex")}`,
    maxTexto = MAX_TEXTO_PRE_SHOW,
    maxMensajes = MAX_MENSAJES_PRE_SHOW,
    cooldownMs = COOLDOWN_PRE_SHOW_MS
} = {}) {
    let activo = true;
    let phaseSeq = 1;
    let sessionId = String(crearSessionId() || "").trim() || `pre_${Date.now()}`;
    let secuencia = 0;
    let mensajes = [];
    const actividadPorOrigen = new Map();
    const resultadosPorRequest = new Map();

    const clonarMensaje = (mensaje) => ({ ...mensaje });

    const payload = () => ({
        version: PRE_SHOW_VERSION,
        activo: Boolean(activo),
        session_id: sessionId,
        phase_seq: phaseSeq,
        mensajes: mensajes.map(clonarMensaje),
        limite_texto: maxTexto,
        cooldown_ms: cooldownMs
    });

    const emitirEstado = (socketDestino = null) => {
        const salida = payload();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("pre_show_estado", salida);
            return salida;
        }
        if (io && typeof io.to === "function") {
            io.to(ROLE_ROOMS.SPECTATOR).emit("pre_show_estado", salida);
            io.to("musa_j1").emit("pre_show_estado", salida);
            io.to("musa_j2").emit("pre_show_estado", salida);
        }
        return salida;
    };

    const identidadMusa = (musa) => {
        const clientId = String(musa && musa.clientId || "").trim();
        if (clientId) return `client:${clientId}`;
        const player = Number(musa && musa.player) === 2 ? 2 : 1;
        const nombre = String(musa && musa.nombre || "MUSA").trim().toLocaleLowerCase();
        return `musa:${player}:${nombre}`;
    };

    const estadoActividad = (clave) => {
        if (!actividadPorOrigen.has(clave)) {
            while (actividadPorOrigen.size >= MAX_BUCKETS_ACTIVIDAD_PRE_SHOW) {
                const claveIdentidad = Array.from(actividadPorOrigen.keys())
                    .find((item) => item.startsWith("identidad:"));
                const masAntigua = claveIdentidad || actividadPorOrigen.keys().next().value;
                if (!masAntigua) break;
                actividadPorOrigen.delete(masAntigua);
            }
            actividadPorOrigen.set(clave, {
                aceptados: [],
                intentos: [],
                ultimoAceptadoEn: 0,
                ultimoTexto: "",
                ultimoTextoEn: 0
            });
        }
        return actividadPorOrigen.get(clave);
    };

    const podarTiempos = (lista, desde) => {
        while (lista.length && lista[0] <= desde) lista.shift();
    };

    const podarRequests = (ts) => {
        resultadosPorRequest.forEach((registro, clave) => {
            if (!registro || registro.expira_en <= ts) resultadosPorRequest.delete(clave);
        });
        while (resultadosPorRequest.size > MAX_REQUEST_IDS_RECORDADOS) {
            const masAntigua = resultadosPorRequest.keys().next().value;
            if (!masAntigua) break;
            resultadosPorRequest.delete(masAntigua);
        }
    };

    const resultadoError = (code, requestId = "", extra = {}) => ({
        ok: false,
        code,
        session_id: sessionId,
        phase_seq: phaseSeq,
        ...(requestId ? { request_id: requestId } : {}),
        ...extra
    });

    const procesarEnvio = (socket, entrada = {}) => {
        const datos = entrada && typeof entrada === "object" ? entrada : { texto: entrada };
        const requestId = normalizarRequestId(datos.request_id);
        const musa = obtenerMusaActiva(socket);
        if (!musa) {
            const estabaMarcadaComoMusa = Boolean(socket && socket.musa);
            return resultadoError(
                estabaMarcadaComoMusa ? "MUSA_SESSION_INACTIVE" : "MUSA_NOT_REGISTERED",
                requestId
            );
        }

        const claveMusa = identidadMusa(musa);
        const phaseSeqEntrada = Number(datos.phase_seq);
        const sessionIdRaw = typeof datos.session_id === "string" ? datos.session_id : "";
        const sessionIdEntrada = sessionIdRaw.length <= 128 ? sessionIdRaw.trim() : "";
        if (!sessionIdEntrada || sessionIdEntrada !== sessionId) {
            return resultadoError("STALE_SESSION", requestId);
        }
        if (!Number.isInteger(phaseSeqEntrada) || phaseSeqEntrada !== phaseSeq) {
            return resultadoError("STALE_PHASE", requestId);
        }
        const claveRequest = requestId ? `${phaseSeq}|${sessionId}|${claveMusa}|${requestId}` : "";
        const ts = now();
        podarRequests(ts);
        if (claveRequest && resultadosPorRequest.has(claveRequest)) {
            return {
                ...resultadosPorRequest.get(claveRequest).resultado,
                idempotente: true
            };
        }
        if (!activo) return resultadoError("NOT_ACTIVE", requestId);

        const actividadSocket = estadoActividad(`socket:${String(socket && socket.id || "")}`);
        podarTiempos(actividadSocket.intentos, ts - VENTANA_INTENTOS_PRE_SHOW_MS);
        if (actividadSocket.intentos.length >= MAX_INTENTOS_POR_VENTANA) {
            const retryAfter = Math.max(
                1,
                actividadSocket.intentos[0] + VENTANA_INTENTOS_PRE_SHOW_MS - ts
            );
            return resultadoError("RATE_LIMITED", requestId, { retry_after_ms: retryAfter });
        }
        const actividadIdentidad = estadoActividad(`identidad:${claveMusa}`);
        podarTiempos(actividadIdentidad.intentos, ts - VENTANA_INTENTOS_PRE_SHOW_MS);
        if (actividadIdentidad.intentos.length >= MAX_INTENTOS_POR_VENTANA) {
            const retryAfter = Math.max(
                1,
                actividadIdentidad.intentos[0] + VENTANA_INTENTOS_PRE_SHOW_MS - ts
            );
            return resultadoError("RATE_LIMITED", requestId, { retry_after_ms: retryAfter });
        }
        const actividades = [actividadIdentidad, actividadSocket];
        actividades.forEach((actividad) => actividad.intentos.push(ts));

        if (typeof datos.texto !== "string") return resultadoError("INVALID_TEXT", requestId);
        if (datos.texto.length > (maxTexto * 16)) return resultadoError("TEXT_TOO_LONG", requestId);
        const texto = normalizarTextoPreShow(datos.texto);
        if (!texto) return resultadoError("INVALID_TEXT", requestId);
        if (longitudUnicode(texto) > maxTexto) return resultadoError("TEXT_TOO_LONG", requestId);
        if (contieneOfensa(texto)) return resultadoError("OFFENSIVE_TEXT", requestId);

        actividades.forEach((actividad) => {
            podarTiempos(actividad.aceptados, ts - VENTANA_RATE_PRE_SHOW_MS);
        });
        const reintentos = actividades.map((actividad) => ({
            cooldown: actividad.aceptados.length
                ? actividad.ultimoAceptadoEn + cooldownMs - ts
                : 0,
            ventana: actividad.aceptados.length >= MAX_MENSAJES_POR_VENTANA
                ? actividad.aceptados[0] + VENTANA_RATE_PRE_SHOW_MS - ts
                : 0
        }));
        const retryAfter = Math.max(0, ...reintentos.flatMap(({ cooldown, ventana }) => [cooldown, ventana]));
        if (retryAfter > 0) {
            return resultadoError("RATE_LIMITED", requestId, {
                retry_after_ms: Math.max(1, retryAfter)
            });
        }

        const textoComparable = texto.toLocaleLowerCase();
        if (actividades.some((actividad) => (
            actividad.ultimoTexto === textoComparable
            && (ts - actividad.ultimoTextoEn) < VENTANA_DUPLICADO_PRE_SHOW_MS
        ))) {
            return resultadoError("DUPLICATE_MESSAGE", requestId);
        }

        const equipo = Number(musa.player) === 2 ? 2 : 1;
        const nombreNormalizado = normalizarTextoPreShow(String(musa.nombre || "MUSA")).slice(0, 48);
        const nombrePublico = nombreNormalizado && !contieneOfensa(nombreNormalizado)
            ? nombreNormalizado
            : "MUSA";
        const mensaje = {
            id: `pre-${++secuencia}`,
            texto,
            nombre_musa: nombrePublico,
            equipo,
            creado_en: ts
        };
        mensajes.push(mensaje);
        if (mensajes.length > maxMensajes) mensajes = mensajes.slice(-maxMensajes);
        actividades.forEach((actividad) => {
            actividad.ultimoAceptadoEn = ts;
            actividad.ultimoTexto = textoComparable;
            actividad.ultimoTextoEn = ts;
            actividad.aceptados.push(ts);
        });

        const resultado = {
            ok: true,
            id: mensaje.id,
            session_id: sessionId,
            phase_seq: phaseSeq,
            ...(requestId ? { request_id: requestId } : {})
        };
        if (claveRequest) {
            resultadosPorRequest.set(claveRequest, {
                resultado,
                expira_en: ts + REQUEST_ID_TTL_MS
            });
            podarRequests(ts);
        }
        emitirEstado();
        return resultado;
    };

    const cerrar = (_motivo = "") => {
        if (activo) phaseSeq += 1;
        activo = false;
        mensajes = [];
        actividadPorOrigen.clear();
        resultadosPorRequest.clear();
        return emitirEstado();
    };

    const abrir = () => {
        phaseSeq += 1;
        sessionId = String(crearSessionId() || "").trim() || `pre_${Date.now()}_${phaseSeq}`;
        activo = true;
        mensajes = [];
        actividadPorOrigen.clear();
        resultadosPorRequest.clear();
        return emitirEstado();
    };

    const registrarHandlers = (socket) => {
        socket.on("pre_show_musa_enviar", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            const payloadEntrada = typeof entrada === "function" ? {} : entrada;
            const resultado = procesarEnvio(socket, payloadEntrada);
            if (typeof responder === "function") responder(resultado);
        });
        socket.on("pedir_pre_show_estado", (_entrada = {}, callback = null) => {
            const responder = typeof _entrada === "function" ? _entrada : callback;
            const musa = obtenerMusaActiva(socket);
            if (!socket.espectador && !musa) {
                if (typeof responder === "function") responder({ ok: false, code: "NOT_AUTHORIZED" });
                return;
            }
            const salida = emitirEstado(socket);
            if (typeof responder === "function") responder({ ok: true, estado: salida });
        });
    };

    return {
        abrir,
        cerrar,
        emitirEstado,
        estaActivo: () => Boolean(activo),
        payload,
        procesarEnvio,
        registrarHandlers
    };
}

module.exports = {
    COOLDOWN_PRE_SHOW_MS,
    MAX_MENSAJES_PRE_SHOW,
    MAX_TEXTO_PRE_SHOW,
    PRE_SHOW_VERSION,
    crearGestorPreShowMusas,
    longitudUnicode,
    normalizarRequestId,
    normalizarTextoPreShow
};
