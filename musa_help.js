const { createHash, randomBytes } = require("node:crypto");

const { contieneLenguajeOfensivo } = require("./profanity_filter.js");
const { ROLE_ROOMS } = require("./role_connections.js");

const AYUDA_MUSAS_VERSION = 1;
const AYUDA_CONTROL_ROOM = ROLE_ROOMS.CONTROL_HELP;
const MAX_REQUESTS_RECORDADAS = 512;
const MAX_HISTORIAL = 50;
const COOLDOWN_SOLICITUD_MS = 3000;
const CONSENTIMIENTO_DIAGNOSTICO_MS = 30000;
const DURACION_DIAGNOSTICO_MS = 5 * 60 * 1000;
const MIN_INTERVALO_FRAME_MS = 250;
const MIN_INTERVALO_ESTADO_MS = 750;
const MAX_FRAME_BYTES = 450 * 1024;
const MAX_FRAME_BASE64 = Math.ceil(MAX_FRAME_BYTES / 3) * 4;
const MAX_COMANDOS_VENTANA = 40;
const VENTANA_COMANDOS_MS = 10000;
const MIN_INTERVALO_RECARGA_MS = 10000;

const PALETA_BANDERAS_AYUDA = Object.freeze([
    Object.freeze({ color: "#FFD60A", color_nombre: "AMARILLO" }),
    Object.freeze({ color: "#BF5AF2", color_nombre: "VIOLETA" }),
    Object.freeze({ color: "#32D74B", color_nombre: "VERDE" }),
    Object.freeze({ color: "#FF9F0A", color_nombre: "NARANJA" }),
    Object.freeze({ color: "#64D2FF", color_nombre: "CIAN" }),
    Object.freeze({ color: "#FF375F", color_nombre: "ROSA" })
]);

const MIME_FRAMES_PERMITIDOS = new Set(["image/jpeg", "image/webp", "image/png"]);
const COMANDOS_REMOTOS_PERMITIDOS = new Set(["tap", "scroll", "back", "reconnect"]);

const normalizarRequestId = (valor) => {
    if (typeof valor === "string" && valor.length > 256) return "";
    return String(valor || "")
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 96);
};

const normalizarIdOpaco = (valor, prefijo) => {
    if (typeof valor !== "string" || valor.length > 160) return "";
    const salida = valor.trim();
    const patron = new RegExp(`^${prefijo}_[A-Za-z0-9_-]{8,128}$`);
    return patron.test(salida) ? salida : "";
};

const limpiarTextoPublico = (valor, maximo, fallback = "") => {
    if (typeof valor !== "string" || valor.length > (maximo * 8)) return fallback;
    const salida = valor
        .normalize("NFKC")
        .replace(/[<>\u0000-\u001f\u007f-\u009f]/gu, "")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, maximo);
    return salida || fallback;
};

const nombreMusaPublico = (valor) => {
    const nombre = limpiarTextoPublico(String(valor || "MUSA"), 48, "MUSA");
    return contieneLenguajeOfensivo(nombre) ? "MUSA" : nombre;
};

const normalizarRuta = (valor) => {
    if (typeof valor !== "string" || valor.length > 2048) return "";
    const ruta = valor.normalize("NFKC").trim().split(/[?#]/u, 1)[0];
    if (!ruta.startsWith("/") || ruta.startsWith("//")) return "";
    if (/[^\u0020-\u007e]/u.test(ruta)) return "";
    return ruta.slice(0, 180);
};

const enteroAcotado = (valor, min, max) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return null;
    return Math.max(min, Math.min(max, Math.round(numero)));
};

const numeroAcotado = (valor, min, max) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return null;
    return Math.max(min, Math.min(max, numero));
};

function crearGestorAyudaMusas({
    io,
    obtenerMusaActiva = () => null,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    crearTicketId = () => `ayuda_${randomBytes(12).toString("hex")}`,
    crearSessionId = () => `diag_${randomBytes(12).toString("hex")}`,
    crearCommandId = () => `cmd_${randomBytes(10).toString("hex")}`,
    logger = () => {}
} = {}) {
    let revision = 1;
    let colorCursor = 0;
    const tickets = new Map();
    const ticketActivoPorIdentidad = new Map();
    const historial = [];
    const requests = new Map();
    const ultimaSolicitudPorIdentidad = new Map();
    const recargasPorTicket = new Map();
    const comandosPorTicket = new Map();
    const comandosPendientes = new Map();

    const limitarMapa = (mapa, maximo = MAX_REQUESTS_RECORDADAS) => {
        while (mapa.size > maximo) {
            const primera = mapa.keys().next().value;
            if (!primera) break;
            mapa.delete(primera);
        }
    };

    const claveMusa = (musa) => {
        const clientId = String(musa && musa.clientId || "").trim();
        if (clientId) return `client:${clientId}`;
        const socketId = String(musa && musa.socketId || "").trim();
        return socketId ? `socket:${socketId}` : "";
    };

    const ticketActivo = (ticket) => Boolean(
        ticket && (ticket.estado === "pendiente" || ticket.estado === "atendiendo")
    );

    const diagnosticoPublico = (ticket, { paraControl = false } = {}) => {
        const diagnostico = ticket && ticket.diagnostico ? ticket.diagnostico : {};
        const salida = {
            estado: diagnostico.estado || "inactivo",
            expires_ts: Number(diagnostico.expiresTs) || 0,
            ultimo_frame_ts: Number(diagnostico.ultimoFrameTs) || 0,
            ruta: diagnostico.ruta || "",
            viewport: diagnostico.viewport
                ? { ...diagnostico.viewport }
                : { width: 0, height: 0 },
            online: diagnostico.online !== false,
            socket_conectado: Boolean(ticket && ticket.conectada),
            ultimo_error: diagnostico.ultimoError || ""
        };
        if (paraControl && diagnostico.sessionId && diagnostico.estado !== "inactivo") {
            salida.session_id = diagnostico.sessionId;
        }
        return salida;
    };

    const ticketPublico = (ticket, opciones = {}) => ({
        ticket_id: ticket.ticketId,
        nombre_musa: ticket.nombre,
        equipo: ticket.player,
        player: ticket.player,
        color: ticket.color,
        color_nombre: ticket.colorNombre,
        estado: ticket.estado,
        solicitado_ts: ticket.solicitadoTs,
        actualizado_ts: ticket.actualizadoTs,
        atendido_ts: ticket.atendidoTs || 0,
        cerrado_ts: ticket.cerradoTs || 0,
        conectada: Boolean(ticket.conectada),
        diagnostico: diagnosticoPublico(ticket, opciones)
    });

    const activosOrdenados = () => Array.from(tickets.values())
        .filter(ticketActivo)
        .sort((a, b) => a.solicitadoTs - b.solicitadoTs);

    const payloadControl = () => {
        const activos = activosOrdenados();
        return {
            version: AYUDA_MUSAS_VERSION,
            revision,
            ts: now(),
            tickets: activos.map((ticket) => ticketPublico(ticket, { paraControl: true })),
            historial: historial.map((ticket) => ticketPublico(ticket, { paraControl: true })),
            resumen: {
                pendientes: activos.filter((ticket) => ticket.estado === "pendiente").length,
                atendiendo: activos.filter((ticket) => ticket.estado === "atendiendo").length,
                diagnosticos_activos: activos.filter((ticket) => ticket.diagnostico.estado === "activo").length,
                total: activos.length
            }
        };
    };

    const obtenerTicketDeMusa = (musa) => {
        const identidad = claveMusa(musa);
        const ticketId = identidad ? ticketActivoPorIdentidad.get(identidad) : "";
        const ticket = ticketId ? tickets.get(ticketId) : null;
        return ticketActivo(ticket) ? ticket : null;
    };

    const payloadMusa = (musa) => {
        const identidad = claveMusa(musa);
        const ticket = obtenerTicketDeMusa(musa);
        const ultimaSolicitud = Number(ultimaSolicitudPorIdentidad.get(identidad)) || 0;
        return {
            version: AYUDA_MUSAS_VERSION,
            revision,
            ts: now(),
            ticket: ticket ? ticketPublico(ticket) : null,
            puede_solicitar_desde_ts: ticket ? 0 : Math.max(0, ultimaSolicitud + COOLDOWN_SOLICITUD_MS)
        };
    };

    const emitirEstadoControl = (socketDestino = null) => {
        const estado = payloadControl();
        if (socketDestino) {
            if (socketDestino.control === true && typeof socketDestino.emit === "function") {
                if (typeof socketDestino.join === "function") socketDestino.join(AYUDA_CONTROL_ROOM);
                socketDestino.emit("ayuda_musas_estado", estado);
            }
        } else if (io && typeof io.to === "function") {
            io.to(AYUDA_CONTROL_ROOM).emit("ayuda_musas_estado", estado);
        }
        return estado;
    };

    const emitirExacto = (socketId, evento, payload) => {
        if (!socketId || !io || typeof io.to !== "function") return false;
        io.to(socketId).emit(evento, payload);
        return true;
    };

    const emitirEstadoTicket = (ticket) => {
        if (!ticket || !ticket.socketId || !ticket.conectada) return null;
        const estado = {
            version: AYUDA_MUSAS_VERSION,
            revision,
            ts: now(),
            ticket: ticketActivo(ticket) ? ticketPublico(ticket) : null,
            puede_solicitar_desde_ts: ticketActivo(ticket) ? 0 : now()
        };
        emitirExacto(ticket.socketId, "ayuda_musa_estado", estado);
        return estado;
    };

    const emitirTodo = (ticket = null) => {
        const estado = emitirEstadoControl();
        if (ticket) emitirEstadoTicket(ticket);
        return estado;
    };

    const marcarTimerNoBloqueante = (timer) => {
        if (timer && typeof timer.unref === "function") timer.unref();
        return timer;
    };

    const cancelarTimerDiagnostico = (ticket) => {
        if (ticket && ticket.diagnostico && ticket.diagnostico.timer) {
            clearTimeoutFn(ticket.diagnostico.timer);
            ticket.diagnostico.timer = null;
        }
    };

    const limpiarComandosTicket = (ticketId) => {
        comandosPorTicket.delete(ticketId);
        for (const [commandId, comando] of comandosPendientes.entries()) {
            if (comando.ticketId === ticketId) comandosPendientes.delete(commandId);
        }
    };

    const detenerDiagnosticoInterno = (ticket, motivo = "manual", { emitir = true } = {}) => {
        if (!ticket || !ticket.diagnostico) return null;
        const diagnostico = ticket.diagnostico;
        const sessionId = diagnostico.sessionId;
        cancelarTimerDiagnostico(ticket);
        diagnostico.estado = "inactivo";
        diagnostico.sessionId = "";
        diagnostico.expiresTs = 0;
        diagnostico.ultimoFrameRecibidoTs = 0;
        diagnostico.ultimoEstadoRecibidoTs = 0;
        diagnostico.ultimoSeq = -1;
        diagnostico.streamId = "";
        limpiarComandosTicket(ticket.ticketId);
        if (sessionId && ticket.conectada) {
            emitirExacto(ticket.socketId, "ayuda_musa_diagnostico_detener", {
                ticket_id: ticket.ticketId,
                session_id: sessionId,
                motivo,
                ts: now()
            });
        }
        if (emitir) {
            revision += 1;
            ticket.actualizadoTs = now();
            emitirTodo(ticket);
        }
        return ticket;
    };

    const programarExpiracionDiagnostico = (ticket, sessionId, duracionMs) => {
        cancelarTimerDiagnostico(ticket);
        ticket.diagnostico.expiresTs = now() + duracionMs;
        ticket.diagnostico.timer = marcarTimerNoBloqueante(setTimeoutFn(() => {
            if (
                !ticketActivo(ticket)
                || ticket.diagnostico.sessionId !== sessionId
                || ticket.diagnostico.estado === "inactivo"
            ) return;
            detenerDiagnosticoInterno(ticket, "caducado");
        }, duracionMs));
    };

    const respuestaError = (code, requestId = "", extra = {}) => ({
        ok: false,
        code,
        ...(requestId ? { request_id: requestId } : {}),
        ...extra
    });

    const ejecutarIdempotente = (clave, requestId, ejecutar) => {
        const requestKey = requestId ? `${clave}|${requestId}` : "";
        if (requestKey && requests.has(requestKey)) {
            return { ...requests.get(requestKey), idempotente: true };
        }
        const resultado = ejecutar();
        if (requestKey && resultado && resultado.ok) {
            const guardado = { ...resultado };
            delete guardado.estado;
            delete guardado.estado_musa;
            requests.set(requestKey, guardado);
            limitarMapa(requests);
        }
        return resultado;
    };

    const elegirColor = () => {
        const coloresUsados = new Set(activosOrdenados().map((ticket) => ticket.color));
        for (let offset = 0; offset < PALETA_BANDERAS_AYUDA.length; offset += 1) {
            const indice = (colorCursor + offset) % PALETA_BANDERAS_AYUDA.length;
            const opcion = PALETA_BANDERAS_AYUDA[indice];
            if (!coloresUsados.has(opcion.color)) {
                colorCursor = (indice + 1) % PALETA_BANDERAS_AYUDA.length;
                return opcion;
            }
        }
        const opcion = PALETA_BANDERAS_AYUDA[colorCursor % PALETA_BANDERAS_AYUDA.length];
        colorCursor = (colorCursor + 1) % PALETA_BANDERAS_AYUDA.length;
        return opcion;
    };

    const autenticarMusa = (socket, requestId = "") => {
        const musa = typeof obtenerMusaActiva === "function" ? obtenerMusaActiva(socket) : null;
        if (!musa) {
            return {
                ok: false,
                respuesta: respuestaError(
                    socket && socket.musa ? "MUSA_SESSION_INACTIVE" : "MUSA_NOT_REGISTERED",
                    requestId
                )
            };
        }
        const identidad = claveMusa(musa);
        if (!identidad) {
            return { ok: false, respuesta: respuestaError("MUSA_IDENTITY_INVALID", requestId) };
        }
        return { ok: true, musa, identidad };
    };

    const sincronizarMusa = (socket) => {
        const autenticacion = autenticarMusa(socket);
        if (!autenticacion.ok) return autenticacion.respuesta;
        const { musa, identidad } = autenticacion;
        const ticketId = ticketActivoPorIdentidad.get(identidad);
        const ticket = ticketId ? tickets.get(ticketId) : null;
        let cambio = false;
        if (ticketActivo(ticket)) {
            const socketId = String(musa.socketId || socket.id || "");
            cambio = !ticket.conectada
                || ticket.socketId !== socketId
                || ticket.player !== Number(musa.player)
                || ticket.nombre !== nombreMusaPublico(musa.nombre);
            const reemplazoSocket = ticket.socketId && ticket.socketId !== socketId;
            ticket.socketId = socketId;
            ticket.conectada = true;
            ticket.player = Number(musa.player) === 2 ? 2 : 1;
            ticket.nombre = nombreMusaPublico(musa.nombre);
            if (reemplazoSocket && ticket.diagnostico.estado !== "inactivo") {
                detenerDiagnosticoInterno(ticket, "reconexion", { emitir: false });
                cambio = true;
            }
            if (cambio) {
                ticket.actualizadoTs = now();
                revision += 1;
                emitirEstadoControl();
            }
        }
        const estado = payloadMusa(musa);
        if (socket && typeof socket.emit === "function") {
            socket.emit("ayuda_musa_estado", estado);
        }
        return { ok: true, estado };
    };

    const desconectarMusa = (socket) => {
        const musa = typeof obtenerMusaActiva === "function" ? obtenerMusaActiva(socket) : null;
        if (!musa) return false;
        const ticket = obtenerTicketDeMusa(musa);
        if (!ticket || ticket.socketId !== socket.id) return false;
        if (ticket.diagnostico.estado !== "inactivo") {
            detenerDiagnosticoInterno(ticket, "desconexion", { emitir: false });
        }
        ticket.conectada = false;
        ticket.actualizadoTs = now();
        revision += 1;
        emitirEstadoControl();
        return true;
    };

    const solicitar = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada && entrada.request_id);
        const autenticacion = autenticarMusa(socket, requestId);
        if (!autenticacion.ok) return autenticacion.respuesta;
        const { musa, identidad } = autenticacion;
        return ejecutarIdempotente(`solicitar:${identidad}`, requestId, () => {
            const existente = obtenerTicketDeMusa(musa);
            if (existente) {
                return {
                    ok: true,
                    idempotente: true,
                    request_id: requestId || undefined,
                    ticket: ticketPublico(existente),
                    estado_musa: payloadMusa(musa)
                };
            }
            const actual = now();
            const ultima = Number(ultimaSolicitudPorIdentidad.get(identidad)) || 0;
            if (ultima && actual - ultima < COOLDOWN_SOLICITUD_MS) {
                return respuestaError("RATE_LIMITED", requestId, {
                    retry_after_ms: COOLDOWN_SOLICITUD_MS - (actual - ultima)
                });
            }
            const color = elegirColor();
            let ticketId = normalizarIdOpaco(crearTicketId(), "ayuda");
            if (!ticketId || tickets.has(ticketId)) {
                ticketId = `ayuda_${randomBytes(16).toString("hex")}`;
            }
            const ticket = {
                ticketId,
                identidad,
                socketId: String(musa.socketId || socket.id || ""),
                nombre: nombreMusaPublico(musa.nombre),
                player: Number(musa.player) === 2 ? 2 : 1,
                color: color.color,
                colorNombre: color.color_nombre,
                estado: "pendiente",
                solicitadaPor: "musa",
                solicitadaRequestId: requestId,
                solicitadoTs: actual,
                actualizadoTs: actual,
                atendidoTs: 0,
                cerradoTs: 0,
                conectada: true,
                diagnostico: {
                    estado: "inactivo",
                    sessionId: "",
                    expiresTs: 0,
                    timer: null,
                    ultimoFrameTs: 0,
                    ultimoFrameRecibidoTs: 0,
                    ultimoEstadoRecibidoTs: 0,
                    ultimoSeq: -1,
                    streamId: "",
                    ruta: "",
                    viewport: { width: 0, height: 0 },
                    online: true,
                    ultimoError: ""
                }
            };
            tickets.set(ticketId, ticket);
            ticketActivoPorIdentidad.set(identidad, ticketId);
            ultimaSolicitudPorIdentidad.set(identidad, actual);
            limitarMapa(ultimaSolicitudPorIdentidad, 4096);
            revision += 1;
            emitirTodo(ticket);
            return {
                ok: true,
                request_id: requestId || undefined,
                ticket: ticketPublico(ticket),
                estado_musa: payloadMusa(musa)
            };
        });
    };

    const cerrarTicket = (ticket, estadoFinal, origen) => {
        if (!ticketActivo(ticket)) return null;
        if (ticket.diagnostico.estado !== "inactivo") {
            detenerDiagnosticoInterno(ticket, "ticket_cerrado", { emitir: false });
        }
        ticket.estado = estadoFinal;
        ticket.actualizadoTs = now();
        ticket.cerradoTs = now();
        ticket.cerradoPor = origen;
        ticketActivoPorIdentidad.delete(ticket.identidad);
        historial.unshift(ticket);
        while (historial.length > MAX_HISTORIAL) {
            const eliminado = historial.pop();
            if (eliminado) tickets.delete(eliminado.ticketId);
        }
        revision += 1;
        emitirTodo(ticket);
        return ticket;
    };

    const cancelarMusa = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada && entrada.request_id);
        const autenticacion = autenticarMusa(socket, requestId);
        if (!autenticacion.ok) return autenticacion.respuesta;
        const { musa, identidad } = autenticacion;
        return ejecutarIdempotente(`cancelar:${identidad}`, requestId, () => {
            const ticket = obtenerTicketDeMusa(musa);
            if (!ticket) return respuestaError("TICKET_NOT_FOUND", requestId);
            const ticketSolicitado = entrada && entrada.ticket_id
                ? normalizarIdOpaco(entrada.ticket_id, "ayuda")
                : ticket.ticketId;
            if (!ticketSolicitado || ticketSolicitado !== ticket.ticketId) {
                return respuestaError("TICKET_NOT_OWNED", requestId);
            }
            cerrarTicket(ticket, "cancelado", "musa");
            return {
                ok: true,
                request_id: requestId || undefined,
                ticket_id: ticket.ticketId,
                estado_musa: payloadMusa(musa)
            };
        });
    };

    const obtenerTicketControl = (entrada, requestId = "") => {
        const ticketId = normalizarIdOpaco(entrada && entrada.ticket_id, "ayuda");
        const ticket = ticketId ? tickets.get(ticketId) : null;
        if (!ticket || !ticketActivo(ticket)) {
            return { ok: false, respuesta: respuestaError("TICKET_NOT_FOUND", requestId) };
        }
        return { ok: true, ticket };
    };

    const atender = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const busqueda = obtenerTicketControl(entrada, requestId);
        if (!busqueda.ok) return busqueda.respuesta;
        const { ticket } = busqueda;
        return ejecutarIdempotente(`atender:${ticket.ticketId}`, requestId, () => {
            const yaAtendiendo = ticket.estado === "atendiendo";
            ticket.estado = "atendiendo";
            ticket.atendidoTs = ticket.atendidoTs || now();
            ticket.actualizadoTs = now();
            if (!yaAtendiendo) revision += 1;
            const estado = yaAtendiendo ? payloadControl() : emitirTodo(ticket);
            return {
                ok: true,
                idempotente: yaAtendiendo,
                request_id: requestId || undefined,
                ticket: ticketPublico(ticket, { paraControl: true }),
                estado
            };
        });
    };

    const resolver = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const busqueda = obtenerTicketControl(entrada, requestId);
        if (!busqueda.ok) return busqueda.respuesta;
        const { ticket } = busqueda;
        const resolucionRaw = String(entrada.resolucion || entrada.resultado || "resuelta").toLowerCase();
        const estadoFinal = resolucionRaw === "cancelada" || resolucionRaw === "cancelado"
            ? "cancelado"
            : "resuelto";
        return ejecutarIdempotente(`resolver:${ticket.ticketId}`, requestId, () => {
            cerrarTicket(ticket, estadoFinal, "control");
            return {
                ok: true,
                request_id: requestId || undefined,
                ticket: ticketPublico(ticket, { paraControl: true }),
                estado: payloadControl()
            };
        });
    };

    const solicitarDiagnostico = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const busqueda = obtenerTicketControl(entrada, requestId);
        if (!busqueda.ok) return busqueda.respuesta;
        const { ticket } = busqueda;
        if (!ticket.conectada || !ticket.socketId) return respuestaError("MUSA_DISCONNECTED", requestId);
        return ejecutarIdempotente(`diagnostico_solicitar:${ticket.ticketId}`, requestId, () => {
            if (ticket.diagnostico.estado !== "inactivo") {
                return {
                    ok: true,
                    idempotente: true,
                    request_id: requestId || undefined,
                    diagnostico: diagnosticoPublico(ticket, { paraControl: true }),
                    estado: payloadControl()
                };
            }
            let sessionId = normalizarIdOpaco(crearSessionId(), "diag");
            if (!sessionId) sessionId = `diag_${randomBytes(16).toString("hex")}`;
            ticket.diagnostico.estado = "solicitado";
            ticket.diagnostico.sessionId = sessionId;
            ticket.diagnostico.ultimoSeq = -1;
            ticket.diagnostico.streamId = "";
            programarExpiracionDiagnostico(ticket, sessionId, CONSENTIMIENTO_DIAGNOSTICO_MS);
            ticket.actualizadoTs = now();
            revision += 1;
            emitirExacto(ticket.socketId, "ayuda_musa_diagnostico_solicitud", {
                ticket_id: ticket.ticketId,
                session_id: sessionId,
                expires_ts: ticket.diagnostico.expiresTs,
                mensaje: "Control solicita ver y manejar temporalmente esta pantalla para prestarte ayuda.",
                ts: now()
            });
            const estado = emitirTodo(ticket);
            return {
                ok: true,
                request_id: requestId || undefined,
                diagnostico: diagnosticoPublico(ticket, { paraControl: true }),
                estado
            };
        });
    };

    const consentirDiagnostico = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const autenticacion = autenticarMusa(socket, requestId);
        if (!autenticacion.ok) return autenticacion.respuesta;
        const ticket = obtenerTicketDeMusa(autenticacion.musa);
        if (!ticket) return respuestaError("TICKET_NOT_FOUND", requestId);
        const ticketId = normalizarIdOpaco(entrada.ticket_id, "ayuda");
        const sessionId = normalizarIdOpaco(entrada.session_id, "diag");
        if (ticketId !== ticket.ticketId || sessionId !== ticket.diagnostico.sessionId) {
            return respuestaError("STALE_DIAGNOSTIC", requestId);
        }
        const aceptar = entrada.aceptar === true || entrada.consentir === true || entrada.ok === true;
        if (!aceptar && (ticket.diagnostico.estado === "solicitado" || ticket.diagnostico.estado === "activo")) {
            detenerDiagnosticoInterno(ticket, "rechazado");
            return {
                ok: true,
                aceptado: false,
                request_id: requestId || undefined,
                estado_musa: payloadMusa(autenticacion.musa)
            };
        }
        if (ticket.diagnostico.estado === "activo" && aceptar) {
            return {
                ok: true,
                aceptado: true,
                idempotente: true,
                request_id: requestId || undefined,
                session_id: sessionId,
                expires_ts: ticket.diagnostico.expiresTs,
                estado: payloadControl(),
                estado_musa: payloadMusa(autenticacion.musa)
            };
        }
        if (ticket.diagnostico.estado !== "solicitado" || ticket.diagnostico.expiresTs <= now()) {
            return respuestaError("DIAGNOSTIC_NOT_REQUESTED", requestId);
        }
        return ejecutarIdempotente(`diagnostico_consentir:${ticket.ticketId}:${sessionId}`, requestId, () => {
            ticket.diagnostico.estado = "activo";
            programarExpiracionDiagnostico(ticket, sessionId, DURACION_DIAGNOSTICO_MS);
            ticket.actualizadoTs = now();
            revision += 1;
            const estado = emitirTodo(ticket);
            return {
                ok: true,
                aceptado: true,
                request_id: requestId || undefined,
                session_id: sessionId,
                expires_ts: ticket.diagnostico.expiresTs,
                estado,
                estado_musa: payloadMusa(autenticacion.musa)
            };
        });
    };

    const detenerDiagnostico = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const busqueda = obtenerTicketControl(entrada, requestId);
        if (!busqueda.ok) return busqueda.respuesta;
        const { ticket } = busqueda;
        return ejecutarIdempotente(`diagnostico_detener:${ticket.ticketId}`, requestId, () => {
            const yaDetenido = ticket.diagnostico.estado === "inactivo";
            if (!yaDetenido) detenerDiagnosticoInterno(ticket, "control");
            return {
                ok: true,
                idempotente: yaDetenido,
                request_id: requestId || undefined,
                estado: payloadControl()
            };
        });
    };

    const autorizarDiagnosticoMusa = (socket, entrada, requestId = "") => {
        const autenticacion = autenticarMusa(socket, requestId);
        if (!autenticacion.ok) return autenticacion;
        const ticket = obtenerTicketDeMusa(autenticacion.musa);
        const ticketId = normalizarIdOpaco(entrada && entrada.ticket_id, "ayuda");
        const sessionId = normalizarIdOpaco(entrada && entrada.session_id, "diag");
        if (
            !ticket
            || ticket.ticketId !== ticketId
            || ticket.diagnostico.estado !== "activo"
            || ticket.diagnostico.sessionId !== sessionId
            || ticket.diagnostico.expiresTs <= now()
        ) {
            return { ok: false, respuesta: respuestaError("DIAGNOSTIC_NOT_ACTIVE", requestId) };
        }
        return { ok: true, autenticacion, ticket, sessionId };
    };

    const actualizarMetadatosDiagnostico = (ticket, entrada = {}) => {
        const diagnostico = ticket.diagnostico;
        if (Object.prototype.hasOwnProperty.call(entrada, "ruta")) {
            diagnostico.ruta = normalizarRuta(entrada.ruta);
        }
        const viewport = entrada.viewport && typeof entrada.viewport === "object" ? entrada.viewport : {};
        const width = enteroAcotado(viewport.width ?? entrada.width, 0, 3840);
        const height = enteroAcotado(viewport.height ?? entrada.height, 0, 3840);
        if (width !== null && height !== null && width > 0 && height > 0) {
            diagnostico.viewport = { width, height };
        }
        if (typeof entrada.online === "boolean") diagnostico.online = entrada.online;
        if (typeof entrada.socket_conectado === "boolean") {
            // La conexión autoritativa sigue siendo la del servidor; este dato
            // solo describe lo que cree el navegador para el diagnóstico.
            diagnostico.socketConectadoCliente = entrada.socket_conectado;
        }
        if (Object.prototype.hasOwnProperty.call(entrada, "ultimo_error")) {
            diagnostico.ultimoError = limpiarTextoPublico(String(entrada.ultimo_error || ""), 240, "");
        }
    };

    const validarFrame = (entrada) => {
        const mime = String(entrada && entrada.mime || "").trim().toLowerCase();
        if (!MIME_FRAMES_PERMITIDOS.has(mime)) return { ok: false, code: "INVALID_FRAME_MIME" };
        const data = entrada && entrada.data;
        if (
            typeof data !== "string"
            || !data
            || data.startsWith("data:")
            || data.length % 4 !== 0
            || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)
        ) {
            return { ok: false, code: "INVALID_FRAME_DATA" };
        }
        if (data.length > MAX_FRAME_BASE64) return { ok: false, code: "FRAME_TOO_LARGE" };
        const relleno = data.endsWith("==") ? 2 : (data.endsWith("=") ? 1 : 0);
        const bytes = Math.floor((data.length * 3) / 4) - relleno;
        if (bytes <= 0 || bytes > MAX_FRAME_BYTES) return { ok: false, code: "FRAME_TOO_LARGE" };
        const cabecera = Buffer.from(data.slice(0, 32), "base64");
        const firmaValida = (
            mime === "image/jpeg"
                ? cabecera.length >= 3 && cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff
                : (
                    mime === "image/png"
                        ? cabecera.length >= 8 && cabecera.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
                        : cabecera.length >= 12
                            && cabecera.subarray(0, 4).toString("ascii") === "RIFF"
                            && cabecera.subarray(8, 12).toString("ascii") === "WEBP"
                )
        );
        if (!firmaValida) return { ok: false, code: "INVALID_FRAME_SIGNATURE" };
        const width = enteroAcotado(entrada.width, 1, 1920);
        const height = enteroAcotado(entrada.height, 1, 3840);
        if (!width || !height || (width * height) > 3000000) {
            return { ok: false, code: "INVALID_FRAME_DIMENSIONS" };
        }
        const seq = Number(entrada.seq);
        if (!Number.isInteger(seq) || seq < 0 || seq > 2147483647) {
            return { ok: false, code: "INVALID_FRAME_SEQUENCE" };
        }
        return { ok: true, mime, data, width, height, seq };
    };

    const recibirFrame = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const autorizacion = autorizarDiagnosticoMusa(socket, entrada, requestId);
        if (!autorizacion.ok) return autorizacion.respuesta;
        const { ticket, sessionId } = autorizacion;
        const validacion = validarFrame(entrada);
        if (!validacion.ok) return respuestaError(validacion.code, requestId);
        const streamId = normalizarIdOpaco(entrada.stream_id, "mstream")
            || `mstream_${createHash("sha256").update(String(socket.id || "legacy")).digest("hex").slice(0, 24)}`;
        const actual = now();
        if (actual - ticket.diagnostico.ultimoFrameRecibidoTs < MIN_INTERVALO_FRAME_MS) {
            return respuestaError("RATE_LIMITED", requestId, {
                retry_after_ms: MIN_INTERVALO_FRAME_MS - (actual - ticket.diagnostico.ultimoFrameRecibidoTs)
            });
        }
        if (ticket.diagnostico.streamId === streamId && validacion.seq <= ticket.diagnostico.ultimoSeq) {
            return respuestaError("STALE_FRAME", requestId);
        }
        if (ticket.diagnostico.streamId !== streamId) ticket.diagnostico.ultimoSeq = -1;
        ticket.diagnostico.ultimoFrameRecibidoTs = actual;
        ticket.diagnostico.ultimoFrameTs = actual;
        ticket.diagnostico.ultimoSeq = validacion.seq;
        ticket.diagnostico.streamId = streamId;
        actualizarMetadatosDiagnostico(ticket, entrada);
        const frame = {
            ticket_id: ticket.ticketId,
            session_id: sessionId,
            stream_id: streamId,
            seq: validacion.seq,
            mime: validacion.mime,
            data: validacion.data,
            width: validacion.width,
            height: validacion.height,
            ts: actual,
            ruta: ticket.diagnostico.ruta,
            viewport: { ...ticket.diagnostico.viewport },
            online: ticket.diagnostico.online,
            socket_conectado: ticket.conectada,
            ultimo_error: ticket.diagnostico.ultimoError
        };
        if (io && typeof io.to === "function") {
            io.to(AYUDA_CONTROL_ROOM).emit("ayuda_musa_diagnostico_frame", frame);
        }
        return {
            ok: true,
            request_id: requestId || undefined,
            seq: validacion.seq,
            recibido_ts: actual
        };
    };

    const recibirEstadoDiagnostico = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const autorizacion = autorizarDiagnosticoMusa(socket, entrada, requestId);
        if (!autorizacion.ok) return autorizacion.respuesta;
        const { ticket } = autorizacion;
        const actual = now();
        if (actual - ticket.diagnostico.ultimoEstadoRecibidoTs < MIN_INTERVALO_ESTADO_MS) {
            return respuestaError("RATE_LIMITED", requestId, {
                retry_after_ms: MIN_INTERVALO_ESTADO_MS - (actual - ticket.diagnostico.ultimoEstadoRecibidoTs)
            });
        }
        ticket.diagnostico.ultimoEstadoRecibidoTs = actual;
        actualizarMetadatosDiagnostico(ticket, entrada);
        ticket.actualizadoTs = actual;
        revision += 1;
        const estado = emitirEstadoControl();
        return { ok: true, request_id: requestId || undefined, estado };
    };

    const comandoRemoto = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const busqueda = obtenerTicketControl(entrada, requestId);
        if (!busqueda.ok) return busqueda.respuesta;
        const { ticket } = busqueda;
        const sessionId = normalizarIdOpaco(entrada.session_id, "diag");
        if (
            !ticket.conectada
            || ticket.diagnostico.estado !== "activo"
            || !sessionId
            || ticket.diagnostico.sessionId !== sessionId
            || ticket.diagnostico.expiresTs <= now()
        ) {
            return respuestaError("DIAGNOSTIC_NOT_ACTIVE", requestId);
        }
        const tipo = String(entrada.tipo || entrada.type || "").trim().toLowerCase();
        if (!COMANDOS_REMOTOS_PERMITIDOS.has(tipo)) {
            return respuestaError("COMMAND_NOT_ALLOWED", requestId);
        }
        const actual = now();
        const recientes = (comandosPorTicket.get(ticket.ticketId) || [])
            .filter((ts) => actual - ts < VENTANA_COMANDOS_MS);
        if (recientes.length >= MAX_COMANDOS_VENTANA) {
            comandosPorTicket.set(ticket.ticketId, recientes);
            return respuestaError("RATE_LIMITED", requestId, {
                retry_after_ms: Math.max(1, VENTANA_COMANDOS_MS - (actual - recientes[0]))
            });
        }
        const comando = { tipo };
        if (tipo === "tap") {
            const x = numeroAcotado(entrada.x, 0, 1);
            const y = numeroAcotado(entrada.y, 0, 1);
            if (x === null || y === null) return respuestaError("INVALID_COMMAND", requestId);
            comando.x = x;
            comando.y = y;
        } else if (tipo === "scroll") {
            const deltaX = numeroAcotado(entrada.delta_x ?? entrada.x ?? 0, -1200, 1200);
            const deltaY = numeroAcotado(entrada.delta_y ?? entrada.y, -1200, 1200);
            if (deltaX === null || deltaY === null || (deltaX === 0 && deltaY === 0)) {
                return respuestaError("INVALID_COMMAND", requestId);
            }
            comando.delta_x = deltaX;
            comando.delta_y = deltaY;
        }
        let commandId = normalizarIdOpaco(crearCommandId(), "cmd");
        if (!commandId || comandosPendientes.has(commandId)) {
            commandId = `cmd_${randomBytes(14).toString("hex")}`;
        }
        recientes.push(actual);
        comandosPorTicket.set(ticket.ticketId, recientes);
        comandosPendientes.set(commandId, {
            ticketId: ticket.ticketId,
            sessionId,
            expiresTs: actual + 30000
        });
        limitarMapa(comandosPendientes, 256);
        emitirExacto(ticket.socketId, "ayuda_musa_comando_remoto", {
            ticket_id: ticket.ticketId,
            session_id: sessionId,
            command_id: commandId,
            ...comando,
            ts: actual
        });
        return {
            ok: true,
            request_id: requestId || undefined,
            command_id: commandId
        };
    };

    const resultadoComando = (socket, entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const autorizacion = autorizarDiagnosticoMusa(socket, entrada, requestId);
        if (!autorizacion.ok) return autorizacion.respuesta;
        const commandId = normalizarIdOpaco(entrada.command_id, "cmd");
        const pendiente = commandId ? comandosPendientes.get(commandId) : null;
        if (
            !pendiente
            || pendiente.ticketId !== autorizacion.ticket.ticketId
            || pendiente.sessionId !== autorizacion.sessionId
            || pendiente.expiresTs <= now()
        ) {
            return respuestaError("COMMAND_NOT_FOUND", requestId);
        }
        comandosPendientes.delete(commandId);
        const resultado = {
            ticket_id: autorizacion.ticket.ticketId,
            session_id: autorizacion.sessionId,
            command_id: commandId,
            ok: entrada.ok === true,
            detalle: limpiarTextoPublico(String(entrada.detalle || entrada.error || ""), 160, ""),
            ts: now()
        };
        if (io && typeof io.to === "function") {
            io.to(AYUDA_CONTROL_ROOM).emit("ayuda_musa_comando_resultado", resultado);
        }
        return { ok: true, request_id: requestId || undefined, command_id: commandId };
    };

    const recargar = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        const busqueda = obtenerTicketControl(entrada, requestId);
        if (!busqueda.ok) return busqueda.respuesta;
        const { ticket } = busqueda;
        if (!ticket.conectada || !ticket.socketId) return respuestaError("MUSA_DISCONNECTED", requestId);
        const actual = now();
        const ultima = Number(recargasPorTicket.get(ticket.ticketId)) || 0;
        if (ultima && actual - ultima < MIN_INTERVALO_RECARGA_MS) {
            return respuestaError("RATE_LIMITED", requestId, {
                retry_after_ms: MIN_INTERVALO_RECARGA_MS - (actual - ultima)
            });
        }
        if (ticket.diagnostico.estado !== "inactivo") {
            detenerDiagnosticoInterno(ticket, "recarga", { emitir: false });
        }
        recargasPorTicket.set(ticket.ticketId, actual);
        limitarMapa(recargasPorTicket);
        ticket.actualizadoTs = actual;
        revision += 1;
        emitirExacto(ticket.socketId, "recargar_rol_remoto", {
            rol: "musa",
            motivo: "soporte",
            ticket_id: ticket.ticketId,
            ts: actual
        });
        const estado = emitirTodo(ticket);
        return {
            ok: true,
            request_id: requestId || undefined,
            ticket_id: ticket.ticketId,
            estado
        };
    };

    const limpiar = (entrada = {}) => {
        const requestId = normalizarRequestId(entrada.request_id);
        return ejecutarIdempotente("limpiar_todo", requestId, () => {
            const activos = activosOrdenados();
            const socketsActivos = new Set(
                activos
                    .filter((ticket) => ticket.conectada && ticket.socketId)
                    .map((ticket) => ticket.socketId)
            );
            const eliminadas = tickets.size;
            activos.forEach((ticket) => {
                if (ticket.diagnostico.estado !== "inactivo") {
                    detenerDiagnosticoInterno(ticket, "incidencias_limpiadas", { emitir: false });
                } else {
                    cancelarTimerDiagnostico(ticket);
                }
            });
            tickets.clear();
            ticketActivoPorIdentidad.clear();
            historial.splice(0, historial.length);
            requests.clear();
            ultimaSolicitudPorIdentidad.clear();
            recargasPorTicket.clear();
            comandosPorTicket.clear();
            comandosPendientes.clear();
            colorCursor = 0;
            revision += 1;
            const actual = now();
            const estado = emitirEstadoControl();
            socketsActivos.forEach((socketId) => {
                emitirExacto(socketId, "ayuda_musa_estado", {
                    version: AYUDA_MUSAS_VERSION,
                    revision,
                    ts: actual,
                    ticket: null,
                    puede_solicitar_desde_ts: actual
                });
            });
            return {
                ok: true,
                request_id: requestId || undefined,
                eliminadas,
                estado
            };
        });
    };

    const reset = () => {
        Array.from(tickets.values()).forEach((ticket) => cancelarTimerDiagnostico(ticket));
        tickets.clear();
        ticketActivoPorIdentidad.clear();
        historial.splice(0, historial.length);
        requests.clear();
        ultimaSolicitudPorIdentidad.clear();
        recargasPorTicket.clear();
        comandosPorTicket.clear();
        comandosPendientes.clear();
        revision += 1;
        emitirEstadoControl();
        return payloadControl();
    };

    const registrarHandlers = (socket) => {
        const responder = (callback, resultado) => {
            if (typeof callback === "function") callback(resultado);
            return resultado;
        };
        const soloControl = (callback, ejecutar) => {
            if (!socket || !socket.control) {
                return responder(callback, respuestaError("NOT_AUTHORIZED"));
            }
            return responder(callback, ejecutar());
        };

        socket.on("pedir_ayuda_musa_estado", (_entrada = {}, callback = null) => {
            const resultado = sincronizarMusa(socket);
            responder(callback, resultado);
        });
        socket.on("pedir_ayuda_musas_estado", (_entrada = {}, callback = null) => {
            soloControl(callback, () => {
                const estado = emitirEstadoControl(socket);
                return { ok: true, estado };
            });
        });
        socket.on("ayuda_musas_limpiar", (entrada = {}, callback = null) => {
            soloControl(callback, () => limpiar(entrada));
        });
        socket.on("ayuda_musa_solicitar", (entrada = {}, callback = null) => {
            responder(callback, solicitar(socket, entrada));
        });
        socket.on("ayuda_musa_cancelar", (entrada = {}, callback = null) => {
            responder(callback, cancelarMusa(socket, entrada));
        });
        socket.on("ayuda_musa_atender", (entrada = {}, callback = null) => {
            soloControl(callback, () => atender(entrada));
        });
        socket.on("ayuda_musa_resolver", (entrada = {}, callback = null) => {
            soloControl(callback, () => resolver(entrada));
        });
        socket.on("ayuda_musa_recargar", (entrada = {}, callback = null) => {
            soloControl(callback, () => recargar(entrada));
        });
        socket.on("ayuda_musa_diagnostico_solicitar", (entrada = {}, callback = null) => {
            soloControl(callback, () => solicitarDiagnostico(entrada));
        });
        socket.on("ayuda_musa_diagnostico_detener", (entrada = {}, callback = null) => {
            soloControl(callback, () => detenerDiagnostico(entrada));
        });
        socket.on("ayuda_musa_diagnostico_consentir", (entrada = {}, callback = null) => {
            responder(callback, consentirDiagnostico(socket, entrada));
        });
        socket.on("ayuda_musa_diagnostico_frame", (entrada = {}, callback = null) => {
            responder(callback, recibirFrame(socket, entrada));
        });
        socket.on("ayuda_musa_diagnostico_estado", (entrada = {}, callback = null) => {
            responder(callback, recibirEstadoDiagnostico(socket, entrada));
        });
        socket.on("ayuda_musa_comando_remoto", (entrada = {}, callback = null) => {
            soloControl(callback, () => comandoRemoto(entrada));
        });
        socket.on("ayuda_musa_comando_resultado", (entrada = {}, callback = null) => {
            responder(callback, resultadoComando(socket, entrada));
        });
        socket.on("disconnect", () => {
            desconectarMusa(socket);
        });
    };

    return Object.freeze({
        atender,
        cancelarMusa,
        comandoRemoto,
        consentirDiagnostico,
        desconectarMusa,
        detenerDiagnostico,
        emitirEstadoControl,
        limpiar,
        payloadControl,
        payloadMusa,
        recibirEstadoDiagnostico,
        recibirFrame,
        recargar,
        registrarHandlers,
        reset,
        resolver,
        sincronizarMusa,
        solicitar,
        solicitarDiagnostico
    });
}

module.exports = {
    AYUDA_MUSAS_VERSION,
    AYUDA_CONTROL_ROOM,
    COMANDOS_REMOTOS_PERMITIDOS,
    CONSENTIMIENTO_DIAGNOSTICO_MS,
    DURACION_DIAGNOSTICO_MS,
    MAX_FRAME_BYTES,
    MIN_INTERVALO_FRAME_MS,
    PALETA_BANDERAS_AYUDA,
    crearGestorAyudaMusas,
    normalizarRequestId
};
