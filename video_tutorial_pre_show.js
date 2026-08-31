const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const { contieneLenguajeOfensivo } = require("./profanity_filter.js");
const { ROLE_ROOMS } = require("./role_connections.js");

const VIDEO_TUTORIAL_VERSION = 2;
const INTERVALO_VIDEO_MIN_SEGUNDOS = 15;
const INTERVALO_VIDEO_MAX_SEGUNDOS = 86400;
const DURACION_VIDEO_MIN_SEGUNDOS = 3;
const DURACION_VIDEO_MAX_SEGUNDOS = 3600;
const MAX_URL_VIDEO_TUTORIAL = 600;
const MAX_REQUESTS_VIDEO_RECORDADAS = 512;

const CONFIG_VIDEO_TUTORIAL_DEFAULT = Object.freeze({
    video_url: "../media/tutorial-scrib-audio.mp3",
    intervalo_segundos: 180,
    duracion_segundos: 153,
    habilitado: false,
    silenciado: false
});

const numeroEnteroAcotado = (valor, fallback, min, max) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numero)));
};

const normalizarRequestId = (valor) => {
    if (typeof valor === "string" && valor.length > 256) return "";
    return String(valor || "")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 96);
};

const normalizarUrlVideo = (valor) => {
    if (typeof valor !== "string" || valor.length > MAX_URL_VIDEO_TUTORIAL) return "";
    const url = valor.normalize("NFKC").trim();
    if (!url || /[\u0000-\u001f\u007f-\u009f\s]/u.test(url)) return "";
    if (/\.mp4(?:$|[?#])/iu.test(url)) return "";
    if (/^https:\/\/[^/]+/iu.test(url)) return url;
    if (/^\/(?!\/)/u.test(url)) return url;
    if (/^\.\.?\/(?!\/)/u.test(url)) return url;
    return "";
};

function normalizarConfigVideoTutorial(entrada = {}, fallback = CONFIG_VIDEO_TUTORIAL_DEFAULT) {
    const base = fallback && typeof fallback === "object" ? fallback : CONFIG_VIDEO_TUTORIAL_DEFAULT;
    const data = entrada && typeof entrada === "object" ? entrada : {};
    const urlEntradaCruda = String(data.video_url || base.video_url || "");
    const esConfiguracionMp4Anterior = /\.mp4(?:$|[?#])/iu.test(urlEntradaCruda);
    const duracionAnterior = Number(data.duracion_segundos ?? base.duracion_segundos);
    const esTimelineAudioAnterior = /tutorial-scrib-audio\.mp3(?:$|[?#])/iu.test(urlEntradaCruda)
        && duracionAnterior === 138;
    const duracionEntrada = (
        (esConfiguracionMp4Anterior && duracionAnterior === 120)
        || esTimelineAudioAnterior
    )
        ? CONFIG_VIDEO_TUTORIAL_DEFAULT.duracion_segundos
        : data.duracion_segundos;
    return {
        video_url: normalizarUrlVideo(data.video_url) || normalizarUrlVideo(base.video_url)
            || CONFIG_VIDEO_TUTORIAL_DEFAULT.video_url,
        intervalo_segundos: numeroEnteroAcotado(
            data.intervalo_segundos,
            numeroEnteroAcotado(
                base.intervalo_segundos,
                CONFIG_VIDEO_TUTORIAL_DEFAULT.intervalo_segundos,
                INTERVALO_VIDEO_MIN_SEGUNDOS,
                INTERVALO_VIDEO_MAX_SEGUNDOS
            ),
            INTERVALO_VIDEO_MIN_SEGUNDOS,
            INTERVALO_VIDEO_MAX_SEGUNDOS
        ),
        duracion_segundos: numeroEnteroAcotado(
            duracionEntrada,
            numeroEnteroAcotado(
                base.duracion_segundos,
                CONFIG_VIDEO_TUTORIAL_DEFAULT.duracion_segundos,
                DURACION_VIDEO_MIN_SEGUNDOS,
                DURACION_VIDEO_MAX_SEGUNDOS
            ),
            DURACION_VIDEO_MIN_SEGUNDOS,
            DURACION_VIDEO_MAX_SEGUNDOS
        ),
        habilitado: typeof data.habilitado === "boolean"
            ? data.habilitado
            : Boolean(base.habilitado),
        silenciado: typeof data.silenciado === "boolean"
            ? data.silenciado
            : Boolean(base.silenciado)
    };
}

function validarPatchConfigVideoTutorial(entrada, configActual) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
        return { ok: false, code: "INVALID_CONFIG" };
    }
    const salida = { ...configActual };
    if (Object.prototype.hasOwnProperty.call(entrada, "video_url")) {
        const url = normalizarUrlVideo(entrada.video_url);
        if (!url) return { ok: false, code: "INVALID_VIDEO_URL" };
        salida.video_url = url;
    }
    for (const [campo, min, max, codigo] of [
        ["intervalo_segundos", INTERVALO_VIDEO_MIN_SEGUNDOS, INTERVALO_VIDEO_MAX_SEGUNDOS, "INVALID_INTERVAL"],
        ["duracion_segundos", DURACION_VIDEO_MIN_SEGUNDOS, DURACION_VIDEO_MAX_SEGUNDOS, "INVALID_DURATION"]
    ]) {
        if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
        const numero = Number(entrada[campo]);
        if (!Number.isFinite(numero) || numero < min || numero > max) {
            return { ok: false, code: codigo };
        }
        salida[campo] = Math.round(numero);
    }
    for (const campo of ["habilitado", "silenciado"]) {
        if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
        if (typeof entrada[campo] !== "boolean") {
            return { ok: false, code: "INVALID_CONFIG" };
        }
        salida[campo] = entrada[campo];
    }
    return { ok: true, config: salida };
}

function crearAlmacenConfigVideoTutorial({
    configPath = process.env.SCRIB_PRE_SHOW_VIDEO_CONFIG
        || path.join(__dirname, "data", "pre_show_video.json"),
    defaultPath = path.join(__dirname, "config", "pre_show_video.default.json"),
    logger = () => {}
} = {}) {
    const rutaConfig = path.resolve(configPath);
    const rutaDefault = path.resolve(defaultPath);

    const leerJson = (ruta) => JSON.parse(fs.readFileSync(ruta, "utf8"));
    const cargar = () => {
        try {
            return leerJson(rutaConfig);
        } catch (errorConfig) {
            if (errorConfig && errorConfig.code !== "ENOENT") {
                logger(`[video_tutorial] configuración persistida inválida: ${errorConfig.message}`);
            }
            try {
                return leerJson(rutaDefault);
            } catch (errorDefault) {
                logger(`[video_tutorial] no se pudo leer la configuración por defecto: ${errorDefault.message}`);
                return { ...CONFIG_VIDEO_TUTORIAL_DEFAULT };
            }
        }
    };

    const guardar = async (config) => {
        const directorio = path.dirname(rutaConfig);
        await fsp.mkdir(directorio, { recursive: true });
        const temporal = `${rutaConfig}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
        try {
            await fsp.writeFile(temporal, `${JSON.stringify(config, null, 2)}\n`, {
                encoding: "utf8",
                mode: 0o640
            });
            await fsp.rename(temporal, rutaConfig);
        } catch (error) {
            await fsp.unlink(temporal).catch(() => {});
            throw error;
        }
        return config;
    };

    return Object.freeze({
        cargar,
        guardar,
        ruta: rutaConfig
    });
}

function crearGestorVideoTutorialPreShow({
    io,
    almacen = crearAlmacenConfigVideoTutorial(),
    obtenerMusaActiva = () => null,
    listarMusasActivas = () => [],
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    crearSessionId = () => `video_${randomBytes(12).toString("hex")}`,
    logger = () => {},
    onReproducir = () => {}
} = {}) {
    let config = normalizarConfigVideoTutorial(almacen.cargar());
    let revision = 1;
    let faseActiva = true;
    let phaseSeq = 1;
    let sessionId = String(crearSessionId() || "").trim() || `video_${Date.now()}`;
    let iniciado = false;
    let reproduciendo = false;
    let reproduccionSeq = 0;
    let inicioTs = 0;
    let finTs = 0;
    let proximaTs = 0;
    let origen = "";
    let timerProxima = null;
    let timerFin = null;
    let suspendidoExternamente = false;
    let colaConfiguracion = Promise.resolve();
    const verificaciones = new Set();
    const resultadosRequest = new Map();
    const configuracionesRequest = new Map();

    const limitarMapa = (mapa, maximo = MAX_REQUESTS_VIDEO_RECORDADAS) => {
        while (mapa.size > maximo) {
            const primera = mapa.keys().next().value;
            if (!primera) break;
            mapa.delete(primera);
        }
    };

    const claveMusa = (musa) => {
        const clientId = String(musa && musa.clientId || "").trim();
        if (clientId) return `client:${clientId}`;
        return `socket:${String(musa && musa.socketId || "").trim()}`;
    };

    const nombreMusaPublico = (valor) => {
        const nombre = String(valor || "MUSA")
            .normalize("NFKC")
            .replace(/[<>\u0000-\u001f\u007f-\u009f]/gu, "")
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 48);
        return nombre && !contieneLenguajeOfensivo(nombre) ? nombre : "MUSA";
    };

    const musasActivas = () => {
        const lista = typeof listarMusasActivas === "function" ? listarMusasActivas() : [];
        return Array.isArray(lista)
            ? lista.filter((musa) => musa && claveMusa(musa) !== "socket:")
            : [];
    };

    const payloadVerificacion = () => {
        const activas = musasActivas();
        const hayReproduccionVigente = faseActiva && reproduccionSeq > 0;
        const verificadas = hayReproduccionVigente
            ? activas.filter((musa) => verificaciones.has(claveMusa(musa)))
            : [];
        return {
            conectadas: activas.length,
            verificadas: verificadas.length,
            pendientes: hayReproduccionVigente
                ? Math.max(0, activas.length - verificadas.length)
                : 0,
            nombres_verificados: Array.from(new Set(verificadas.map((musa) => nombreMusaPublico(musa.nombre))))
        };
    };

    const payload = () => {
        const actual = now();
        return {
            version: VIDEO_TUTORIAL_VERSION,
            activo: Boolean(faseActiva),
            session_id: sessionId,
            phase_seq: phaseSeq,
            revision,
            reproduciendo: Boolean(faseActiva && reproduciendo),
            visible: Boolean(faseActiva && reproduciendo),
            reproduccion_seq: reproduccionSeq,
            inicio_ts: reproduciendo ? inicioTs : 0,
            fin_ts: reproduciendo ? finTs : 0,
            posicion_segundos: reproduciendo
                ? Math.max(0, Math.floor((actual - inicioTs) / 1000))
                : 0,
            proxima_reproduccion_ts: faseActiva && !reproduciendo ? proximaTs : 0,
            origen: reproduciendo ? origen : "",
            configuracion: { ...config },
            verificacion: payloadVerificacion()
        };
    };

    const emitirEstado = (socketDestino = null) => {
        const salida = payload();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("video_tutorial_estado", salida);
            return salida;
        }
        // El estado no contiene identidades técnicas ni secretos. Se publica a
        // todas las interfaces porque la musa necesita la secuencia exacta que
        // debe verificar, además de Control y Espectador que lo representan.
        if (io && typeof io.emit === "function") {
            io.emit("video_tutorial_estado", salida);
        } else if (io && typeof io.to === "function") {
            io.to(ROLE_ROOMS.SPECTATOR).emit("video_tutorial_estado", salida);
            io.to(ROLE_ROOMS.CONTROL).emit("video_tutorial_estado", salida);
        }
        return salida;
    };

    const cancelarTimer = (timer) => {
        if (timer) clearTimeoutFn(timer);
        return null;
    };

    const cancelarProxima = () => {
        timerProxima = cancelarTimer(timerProxima);
        proximaTs = 0;
    };

    const cancelarFin = () => {
        timerFin = cancelarTimer(timerFin);
    };

    const marcarTimerNoBloqueante = (timer) => {
        if (timer && typeof timer.unref === "function") timer.unref();
        return timer;
    };

    const programarProxima = () => {
        cancelarProxima();
        if (!iniciado || !faseActiva || reproduciendo || !config.habilitado || suspendidoExternamente) return 0;
        const delay = config.intervalo_segundos * 1000;
        const sessionProgramada = sessionId;
        const phaseProgramada = phaseSeq;
        proximaTs = now() + delay;
        timerProxima = marcarTimerNoBloqueante(setTimeoutFn(() => {
            timerProxima = null;
            proximaTs = 0;
            if (
                !faseActiva
                || reproduciendo
                || !config.habilitado
                || sessionId !== sessionProgramada
                || phaseSeq !== phaseProgramada
            ) return;
            reproducirInterno("periodico");
        }, delay));
        return proximaTs;
    };

    const detenerInterno = (motivo = "manual", { emitir = true, reprogramar = true } = {}) => {
        cancelarFin();
        reproduciendo = false;
        inicioTs = 0;
        finTs = 0;
        origen = "";
        if (reprogramar) programarProxima();
        else cancelarProxima();
        return emitir ? emitirEstado() : payload();
    };

    const programarFin = () => {
        cancelarFin();
        if (!reproduciendo) return 0;
        const seqProgramada = reproduccionSeq;
        const delay = Math.max(0, finTs - now());
        if (delay === 0) {
            detenerInterno("fin_automatico");
            return 0;
        }
        timerFin = marcarTimerNoBloqueante(setTimeoutFn(() => {
            timerFin = null;
            if (!reproduciendo || reproduccionSeq !== seqProgramada) return;
            detenerInterno("fin_automatico");
        }, delay));
        return finTs;
    };

    function reproducirInterno(tipo = "manual") {
        if (!faseActiva) return null;
        if (suspendidoExternamente && tipo === "periodico") return null;
        if (tipo !== "periodico") suspendidoExternamente = false;
        onReproducir({ tipo });
        cancelarProxima();
        cancelarFin();
        reproduciendo = true;
        reproduccionSeq += 1;
        inicioTs = now();
        finTs = inicioTs + (config.duracion_segundos * 1000);
        origen = tipo === "periodico" ? "periodico" : "manual";
        verificaciones.clear();
        programarFin();
        return emitirEstado();
    }

    const validarFase = (entrada = {}) => {
        const sessionEntrada = typeof entrada.session_id === "string" && entrada.session_id.length <= 128
            ? entrada.session_id.trim()
            : "";
        if (!sessionEntrada || sessionEntrada !== sessionId) return { ok: false, code: "STALE_SESSION" };
        const phaseEntrada = Number(entrada.phase_seq);
        if (!Number.isInteger(phaseEntrada) || phaseEntrada !== phaseSeq) {
            return { ok: false, code: "STALE_PHASE" };
        }
        if (!faseActiva) return { ok: false, code: "NOT_ACTIVE" };
        return { ok: true };
    };

    const respuestaError = (code, requestId = "", extra = {}) => ({
        ok: false,
        code,
        session_id: sessionId,
        phase_seq: phaseSeq,
        ...(requestId ? { request_id: requestId } : {}),
        ...extra
    });

    const ejecutarIdempotente = (accion, requestId, ejecutar) => {
        const clave = requestId ? `${sessionId}|${phaseSeq}|${accion}|${requestId}` : "";
        if (clave && resultadosRequest.has(clave)) {
            return {
                ...resultadosRequest.get(clave),
                idempotente: true,
                estado: payload()
            };
        }
        const resultado = ejecutar();
        if (clave && resultado && resultado.ok) {
            resultadosRequest.set(clave, { ...resultado, estado: undefined });
            limitarMapa(resultadosRequest);
        }
        return resultado;
    };

    const reproducir = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const fase = validarFase(entrada);
        if (!fase.ok) return respuestaError(fase.code, requestId);
        return ejecutarIdempotente("reproducir", requestId, () => {
            const estado = reproducirInterno("manual");
            return {
                ok: true,
                request_id: requestId || undefined,
                reproduccion_seq: reproduccionSeq,
                estado
            };
        });
    };

    const detener = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const fase = validarFase(entrada);
        if (!fase.ok) return respuestaError(fase.code, requestId);
        return ejecutarIdempotente("detener", requestId, () => ({
            ok: true,
            request_id: requestId || undefined,
            estado: detenerInterno("manual")
        }));
    };

    const verificar = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const musa = obtenerMusaActiva(socket);
        if (!musa) {
            return respuestaError(socket && socket.musa ? "MUSA_SESSION_INACTIVE" : "MUSA_NOT_REGISTERED", requestId);
        }
        const fase = validarFase(entrada);
        if (!fase.ok) return respuestaError(fase.code, requestId);
        const seqEntrada = Number(entrada.reproduccion_seq);
        if (!Number.isInteger(seqEntrada) || seqEntrada <= 0 || seqEntrada !== reproduccionSeq) {
            return respuestaError("STALE_REPRODUCTION", requestId);
        }
        return ejecutarIdempotente(
            `verificar:${claveMusa(musa)}:${reproduccionSeq}`,
            requestId,
            () => {
                const clave = claveMusa(musa);
                const yaVerificada = verificaciones.has(clave);
                verificaciones.add(clave);
                const estado = emitirEstado();
                return {
                    ok: true,
                    request_id: requestId || undefined,
                    reproduccion_seq: reproduccionSeq,
                    idempotente: yaVerificada,
                    estado
                };
            }
        );
    };

    const configurar = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const claveRequest = requestId ? `config:${requestId}` : "";
        if (claveRequest && configuracionesRequest.has(claveRequest)) {
            return configuracionesRequest.get(claveRequest).then((resultado) => ({
                ...resultado,
                idempotente: true,
                estado: payload()
            }));
        }
        const ejecutar = async () => {
            const validacion = validarPatchConfigVideoTutorial(entrada, config);
            if (!validacion.ok) return respuestaError(validacion.code, requestId);
            try {
                await almacen.guardar(validacion.config);
            } catch (error) {
                logger(`[video_tutorial] no se pudo persistir la configuración: ${error.message}`);
                return respuestaError("CONFIG_PERSIST_FAILED", requestId);
            }
            const anterior = config;
            config = normalizarConfigVideoTutorial(validacion.config, config);
            revision += 1;
            const cambioUrl = anterior.video_url !== config.video_url;
            if (reproduciendo && cambioUrl) {
                detenerInterno("configuracion", { emitir: false });
            } else if (reproduciendo && anterior.duracion_segundos !== config.duracion_segundos) {
                finTs = inicioTs + (config.duracion_segundos * 1000);
                programarFin();
            } else if (!reproduciendo) {
                programarProxima();
            }
            const estado = emitirEstado();
            return {
                ok: true,
                request_id: requestId || undefined,
                estado
            };
        };
        colaConfiguracion = colaConfiguracion.then(ejecutar, ejecutar);
        if (claveRequest) {
            configuracionesRequest.set(claveRequest, colaConfiguracion);
            limitarMapa(configuracionesRequest);
        }
        return colaConfiguracion;
    };

    const cerrarFase = (_motivo = "tutorial") => {
        if (faseActiva) phaseSeq += 1;
        faseActiva = false;
        verificaciones.clear();
        resultadosRequest.clear();
        cancelarProxima();
        detenerInterno("fase_cerrada", { emitir: false, reprogramar: false });
        return emitirEstado();
    };

    const abrirFase = () => {
        phaseSeq += 1;
        sessionId = String(crearSessionId() || "").trim() || `video_${Date.now()}_${phaseSeq}`;
        faseActiva = true;
        reproduccionSeq = 0;
        verificaciones.clear();
        resultadosRequest.clear();
        detenerInterno("fase_nueva", { emitir: false, reprogramar: false });
        programarProxima();
        return emitirEstado();
    };

    const iniciar = () => {
        if (iniciado) return payload();
        iniciado = true;
        programarProxima();
        return emitirEstado();
    };

    const detenerServicio = () => {
        iniciado = false;
        cancelarProxima();
        cancelarFin();
        return true;
    };

    const suspenderTemporalmente = () => {
        suspendidoExternamente = true;
        cancelarProxima();
        if (reproduciendo) {
            return detenerInterno("narracion_show", { emitir: true, reprogramar: false });
        }
        return emitirEstado();
    };

    const reanudarTemporalmente = () => {
        if (!suspendidoExternamente) return payload();
        suspendidoExternamente = false;
        programarProxima();
        return emitirEstado();
    };

    const registrarHandlers = (socket) => {
        socket.on("pedir_video_tutorial_estado", (_entrada = {}, callback = null) => {
            const responder = typeof _entrada === "function" ? _entrada : callback;
            const estado = emitirEstado(socket);
            if (typeof responder === "function") responder({ ok: true, estado });
        });
        socket.on("video_tutorial_configurar", async (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder(respuestaError("NOT_AUTHORIZED"));
                return;
            }
            const resultado = await configurar(typeof entrada === "function" ? {} : entrada);
            if (typeof responder === "function") responder(resultado);
        });
        socket.on("video_tutorial_reproducir", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder(respuestaError("NOT_AUTHORIZED"));
                return;
            }
            const resultado = reproducir(typeof entrada === "function" ? {} : entrada);
            if (typeof responder === "function") responder(resultado);
        });
        socket.on("video_tutorial_detener", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            if (!socket.control) {
                if (typeof responder === "function") responder(respuestaError("NOT_AUTHORIZED"));
                return;
            }
            const resultado = detener(typeof entrada === "function" ? {} : entrada);
            if (typeof responder === "function") responder(resultado);
        });
        socket.on("video_tutorial_verificar", (entrada = {}, callback = null) => {
            const responder = typeof entrada === "function" ? entrada : callback;
            const resultado = verificar(socket, typeof entrada === "function" ? {} : entrada);
            if (typeof responder === "function") responder(resultado);
        });
    };

    return {
        abrirFase,
        cerrarFase,
        configurar,
        detener,
        detenerServicio,
        emitirEstado,
        iniciar,
        payload,
        registrarHandlers,
        reproducir,
        reanudarTemporalmente,
        suspenderTemporalmente,
        verificar
    };
}

module.exports = {
    CONFIG_VIDEO_TUTORIAL_DEFAULT,
    DURACION_VIDEO_MAX_SEGUNDOS,
    DURACION_VIDEO_MIN_SEGUNDOS,
    INTERVALO_VIDEO_MAX_SEGUNDOS,
    INTERVALO_VIDEO_MIN_SEGUNDOS,
    VIDEO_TUTORIAL_VERSION,
    crearAlmacenConfigVideoTutorial,
    crearGestorVideoTutorialPreShow,
    normalizarConfigVideoTutorial,
    normalizarUrlVideo,
    validarPatchConfigVideoTutorial
};
