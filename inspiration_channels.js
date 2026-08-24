const { contieneLenguajeOfensivo } = require("./profanity_filter.js");

const normalizarNombreMusaPorDefecto = (valor) => {
    if (typeof valor !== "string") return "";
    return valor.trim().slice(0, 10).toUpperCase();
};

const construirEventoFeedbackMusaInspiracion = (
    payload,
    escritxrId,
    normalizarNombreMusa = normalizarNombreMusaPorDefecto
) => {
    if (!payload || typeof payload !== "object") return null;
    const tipo = typeof payload.tipo === "string"
        ? payload.tipo.trim().toLowerCase()
        : "";
    if (tipo !== "inspiracion") return null;
    if (escritxrId !== 1 && escritxrId !== 2) return null;

    const origenRaw = typeof payload.origen_musa === "string"
        ? payload.origen_musa.trim().toLowerCase()
        : "";
    const origenMusa = (origenRaw === "musa_enemiga") ? "musa_enemiga" : "musa";
    const musaObjetivo = origenMusa === "musa_enemiga"
        ? (escritxrId === 1 ? 2 : 1)
        : escritxrId;
    const musaNombre = normalizarNombreMusa(payload.musa_nombre) || "";
    const palabra = typeof payload.palabra === "string"
        ? payload.palabra.trim().slice(0, 64)
        : "";

    return {
        ...payload,
        tipo: "inspiracion",
        origen_musa: origenMusa,
        musa_nombre: musaNombre,
        palabra,
        escritxr: escritxrId,
        musa_objetivo: musaObjetivo,
        ts: Date.now()
    };
};

const reenviarASalaUnaVez = (socket, io, entrada, salida, sala, permitir = () => true) => {
    if (!socket._inspiration_forwarded_room_events) {
        socket._inspiration_forwarded_room_events = new Set();
    }
    const key = `${entrada}->${salida}@${sala}`;
    if (socket._inspiration_forwarded_room_events.has(key)) return;
    socket._inspiration_forwarded_room_events.add(key);

    socket.on(entrada, (payload) => {
        if (!permitir(payload)) return;
        io.to(sala).emit(salida, payload);
    });
};

function registrarCanalesInspiracion({
    socket,
    io,
    musasAuxiliares,
    nubeInspiracion,
    getModoActual = () => "",
    getModoBonus = () => null,
    getModoMalditas = () => null,
    getModoMusas = () => null,
    obtenerIdJugadorValido,
    obtenerMusaActiva = (socketActual) => {
        const player = obtenerIdJugadorValido(socketActual && socketActual.musa);
        if (!player) return null;
        return {
            player,
            nombre: socketActual && socketActual.nombre_musa,
            clientId: socketActual && socketActual.musa_client_id
        };
    },
    normalizarNombreMusa = normalizarNombreMusaPorDefecto,
    normalizarMusaClientId = () => "",
    emitirNubeInspiracionEstado = () => {},
    emitirEstadoBanderasMusas = () => {},
    emitirFeedbackMusas = () => {},
    emitirEstadoRegaloBanderaMusas = () => {},
    sesionesEscritor = null,
    getModoSeq = () => 0,
    isPartidaPausada = () => false,
    isFinDelJuego = () => false,
    aplicarAjusteTiempoInspiracion = () => null,
    registrar = () => {}
}) {
    const esEscritorActivoEstricto = (player) => {
        const id = obtenerIdJugadorValido(player);
        if (!id || obtenerIdJugadorValido(socket && socket.escritxr) !== id) return false;
        return !sesionesEscritor || sesionesEscritor.esActiva(socket, id);
    };

    const hayEscritorActivo = (player) => {
        const id = obtenerIdJugadorValido(player);
        if (!id) return false;
        if (sesionesEscritor && typeof sesionesEscritor.obtenerSocketActivo === "function") {
            return Boolean(sesionesEscritor.obtenerSocketActivo(id));
        }
        return true;
    };

    const nombreMusaPublico = (valor) => {
        const nombre = normalizarNombreMusa(valor);
        if (!nombre || contieneLenguajeOfensivo(nombre)) return "MUSA";
        return nombre;
    };

    const entregarInspiracionEnColaAEscritoraActiva = (modo, player) => {
        const id = obtenerIdJugadorValido(player);
        if (!id || !modo || !hayEscritorActivo(id)) {
            return false;
        }
        if (
            typeof modo.obtenerEstadoPalabrasMusas !== "function" ||
            typeof modo.handleRequest !== "function"
        ) {
            return false;
        }
        const estado = modo.obtenerEstadoPalabrasMusas(id);
        const hayPalabraEnColaVisible = Boolean(
            estado &&
            estado.activa === true &&
            estado.origen_estado === "cola" &&
            Number(estado.cola || estado.cola_palabras_musas || 0) > 0
        );
        if (!hayPalabraEnColaVisible) {
            return false;
        }
        const usaV2 = typeof modo.usaProtocoloInspiracionV2 === "function"
            && modo.usaProtocoloInspiracionV2(id);
        modo.handleRequest(id, { contabilizar: !usaV2 });
        return true;
    };

    socket.on("musa_corazon", () => {
        const equipo = obtenerIdJugadorValido(socket.musa);
        if (!equipo) {
            return;
        }
        musasAuxiliares.registrarCorazon({ socket, equipo });
    });

    socket.on("activar_banderas_musas", (payload = {}) => {
        const estadoPayload = musasAuxiliares.actualizarBanderas(payload);
        // Compatibilidad con clientes antiguos que solo escuchan este evento.
        musasAuxiliares.emitirBanderasCompat(estadoPayload);
        emitirEstadoBanderasMusas();
        emitirEstadoRegaloBanderaMusas();
    });

    socket.on("regalo_pdf_musas", (payload = {}) => {
        const salida = musasAuxiliares.guardarRegalo(payload);
        if (!salida) {
            return;
        }
        if (salida.client_id) {
            io.to(`musa_client_${salida.client_id}`).emit("regalo_pdf_musas", salida);
            return;
        }
        io.to(`musa_j${salida.player}`).emit("regalo_pdf_musas", salida);
    });

    socket.on("pedir_resumen_musas_pdf", (payload = {}, responder = null) => {
        let callback = responder;
        if (typeof payload === "function") {
            callback = payload;
        }
        const resumen = typeof musasAuxiliares.payloadResumenPdf === "function"
            ? musasAuxiliares.payloadResumenPdf()
            : { equipos: { 1: { musas: [] }, 2: { musas: [] } } };
        if (typeof callback === "function") {
            callback(resumen);
            return;
        }
        socket.emit("resumen_musas_pdf", resumen);
    });

    socket.on("pedir_feedback_musas", (payload = {}) => {
        musasAuxiliares.solicitarFeedback(payload);
        emitirFeedbackMusas();
    });

    socket.on("enviar_feedback_modificador", (evento) => {
        if (!evento || typeof evento.id_mod !== "string" || evento.id_mod.length === 0) {
            return;
        }
        const id_mod = evento.id_mod.substring(0, evento.id_mod.length - 1) + "2";
        const id_jugador = obtenerIdJugadorValido(evento.player);
        if (!id_jugador) {
            return;
        }
        if (!esEscritorActivoEstricto(id_jugador)) {
            return;
        }
        socket.broadcast.emit("recibir_feedback_modificador", { id_mod, player: id_jugador });
    });

    reenviarASalaUnaVez(socket, io, "feedback_de_j1", "feedback_a_j2", "j2", () => esEscritorActivoEstricto(1));
    reenviarASalaUnaVez(socket, io, "feedback_de_j2", "feedback_a_j1", "j1", () => esEscritorActivoEstricto(2));

    const reenviarFeedbackInspiracionMusa = (eventoEntrada, escritxrId) => {
        socket.on(eventoEntrada, (payload) => {
            if (!esEscritorActivoEstricto(escritxrId)) return;
            const salida = construirEventoFeedbackMusaInspiracion(payload, escritxrId, normalizarNombreMusa);
            if (!salida) return;
            io.to(`musa_j${salida.musa_objetivo}`).emit("feedback_musa_inspiracion", salida);
        });
    };
    reenviarFeedbackInspiracionMusa("feedback_de_j1", 1);
    reenviarFeedbackInspiracionMusa("feedback_de_j2", 2);

    socket.on("feedback_musa_inspiracion", (payload = {}) => {
        const escritxrId = obtenerIdJugadorValido(payload.player) || socket.escritxr;
        if (!esEscritorActivoEstricto(escritxrId)) return;
        const salida = construirEventoFeedbackMusaInspiracion(payload, escritxrId, normalizarNombreMusa);
        if (!salida) return;
        io.to(`musa_j${salida.musa_objetivo}`).emit("feedback_musa_inspiracion", salida);
    });

    socket.on("intento_prohibido", (payload) => {
        const playerId = obtenerIdJugadorValido(payload && payload.player);
        if (!playerId) {
            return;
        }
        if (!esEscritorActivoEstricto(playerId)) {
            return;
        }
        const salida = { ...(payload || {}), player: playerId };
        io.emit("intento_prohibido", salida);
    });

    const registrarInspiracionIntroducidaDesdeModo = (modo, playerId) => {
        if (!modo || typeof modo.consumirEntregaMusaIntroducida !== "function") {
            return;
        }
        const entrega = modo.consumirEntregaMusaIntroducida(playerId);
        if (entrega && typeof musasAuxiliares.registrarInspiracionIntroducida === "function") {
            musasAuxiliares.registrarInspiracionIntroducida(entrega);
        }
    };

    const registrarInspiracionIntroducidaDesdeResultado = (resultado) => {
        if (
            resultado
            && resultado.entrega_musa
            && typeof musasAuxiliares.registrarInspiracionIntroducida === "function"
        ) {
            musasAuxiliares.registrarInspiracionIntroducida(resultado.entrega_musa);
        }
    };

    const emitirInspiracionAprovechadaAutoritativa = (resultado, contexto, player) => {
        if (
            !resultado
            || resultado.idempotente
            || !resultado.entrega_musa
            || typeof io.emit !== "function"
        ) {
            return null;
        }
        const equipo = obtenerIdJugadorValido(resultado.entrega_musa.player);
        if (!equipo) return null;
        const valorRaw = Number(resultado.valor_inspiracion);
        const tiempoRaw = Number(resultado.tiempo_otorgado);
        const payload = {
            autoritativa: true,
            player,
            equipo,
            origen_musa: equipo === player ? "musa" : "musa_enemiga",
            inspiracion_id: Number(resultado.inspiracion_id) || 0,
            valor_inspiracion: Number.isFinite(valorRaw)
                ? Math.max(0, Math.min(1, valorRaw))
                : 0,
            tiempo_otorgado: Number.isFinite(tiempoRaw) ? tiempoRaw : 0,
            modo_actual: contexto.modo_actual,
            modo_seq: contexto.modo_seq,
            palabra: typeof resultado.entrega_musa.palabra === "string"
                ? resultado.entrega_musa.palabra.trim().slice(0, 64)
                : "",
            ts: Date.now()
        };
        const musasEntrega = Array.isArray(resultado.entrega_musa.musas)
            ? resultado.entrega_musa.musas
                .map(nombreMusaPublico)
                .filter((nombre, indice, lista) => nombre && lista.indexOf(nombre) === indice)
            : [];
        if (!musasEntrega.length && resultado.entrega_musa.musa_nombre) {
            musasEntrega.push(nombreMusaPublico(resultado.entrega_musa.musa_nombre));
        }
        payload.musas = musasEntrega.length ? musasEntrega : ["MUSA"];
        payload.musa_nombre = payload.musas.join(" + ");
        io.emit("inspiracion_aprovechada", payload);
        return payload;
    };

    const normalizarAccionInspiracion = (entrada = {}) => {
        if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;
        const accion = typeof entrada.accion === "string"
            ? entrada.accion.trim().toLowerCase()
            : "";
        if (accion !== "solicitar" && accion !== "aprovechar") return null;
        const player = obtenerIdJugadorValido(
            entrada.player ?? entrada.jugador ?? entrada.escritxr ?? entrada.writer
        );
        const incluyeModoSeq = Object.prototype.hasOwnProperty.call(entrada, "modo_seq");
        const modoSeqEntrada = incluyeModoSeq ? Number(entrada.modo_seq) : undefined;
        return {
            accion,
            player,
            inspiracion_id: Number(entrada.inspiracion_id) || 0,
            modo_seq: incluyeModoSeq && Number.isFinite(modoSeqEntrada)
                ? Math.max(0, Math.trunc(modoSeqEntrada))
                : undefined,
            modo_seq_invalido: incluyeModoSeq && !Number.isFinite(modoSeqEntrada)
        };
    };

    const obtenerModoSeqEntrada = (entrada) => {
        if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return undefined;
        if (!Object.prototype.hasOwnProperty.call(entrada, "modo_seq")) return undefined;
        const valor = Number(entrada.modo_seq);
        return Number.isFinite(valor) ? Math.max(0, Math.trunc(valor)) : Number.NaN;
    };

    const validarContextoInspiracion = ({
        modosPermitidos = [],
        modoSeq = undefined,
        modoSeqInvalido = false,
        codigoModo = "MODE_NOT_ACTIVE"
    } = {}) => {
        const modoActual = String(getModoActual() || "");
        const modoSeqActualRaw = Number(typeof getModoSeq === "function" ? getModoSeq() : 0);
        const modoSeqActual = Number.isFinite(modoSeqActualRaw)
            ? Math.max(0, Math.trunc(modoSeqActualRaw))
            : 0;
        if (typeof isFinDelJuego === "function" && isFinDelJuego()) {
            return { ok: false, code: "GAME_FINISHED", modo_actual: modoActual, modo_seq: modoSeqActual };
        }
        if (typeof isPartidaPausada === "function" && isPartidaPausada()) {
            return { ok: false, code: "GAME_PAUSED", modo_actual: modoActual, modo_seq: modoSeqActual };
        }
        if (modoSeqInvalido || (typeof modoSeq === "number" && !Number.isFinite(modoSeq))) {
            return { ok: false, code: "INVALID_MODE_SEQ", modo_actual: modoActual, modo_seq: modoSeqActual };
        }
        if (Number.isFinite(modoSeq) && Math.trunc(modoSeq) !== modoSeqActual) {
            return { ok: false, code: "STALE_MODE", modo_actual: modoActual, modo_seq: modoSeqActual };
        }
        if (!modosPermitidos.includes(modoActual)) {
            return { ok: false, code: codigoModo, modo_actual: modoActual, modo_seq: modoSeqActual };
        }
        return { ok: true, modo_actual: modoActual, modo_seq: modoSeqActual };
    };

    const responderAccionInspiracion = (callback, payload) => {
        if (typeof callback === "function") callback(payload);
        return payload;
    };

    const pedirSiguienteInspiracion = (modo, playerId) => {
        if (!modo || typeof modo.handleRequest !== "function") return false;
        Promise.resolve(modo.handleRequest(playerId, { contabilizar: false }))
            .catch((error) => console.error("[inspiracion] Error solicitando siguiente palabra:", error));
        return true;
    };

    const rechazarLegacySiV2Activo = (modo, playerId, callback = null) => {
        const usaV2 = modo
            && typeof modo.usaProtocoloInspiracionV2 === "function"
            && modo.usaProtocoloInspiracionV2(playerId);
        if (!usaV2) return false;
        responderAccionInspiracion(callback, { ok: false, code: "V2_REQUIRED" });
        return true;
    };

    const procesarAccionInspiracionV2 = (
        { accion, player, inspiracion_id, modo_seq, modo_seq_invalido },
        modo,
        callback,
        modosPermitidos
    ) => {
        if (!player || !esEscritorActivoEstricto(player)) {
            return responderAccionInspiracion(callback, { ok: false, code: "NOT_ACTIVE_WRITER" });
        }
        const contexto = validarContextoInspiracion({
            modosPermitidos,
            modoSeq: modo_seq,
            modoSeqInvalido: modo_seq_invalido
        });
        if (!contexto.ok) {
            return responderAccionInspiracion(callback, contexto);
        }
        if (!modo) {
            return responderAccionInspiracion(callback, { ok: false, code: "MODE_NOT_AVAILABLE" });
        }
        if (accion === "solicitar") {
            const solicitud = typeof modo.solicitarInspiracion === "function"
                ? modo.solicitarInspiracion(player)
                : { ok: true, existente: false };
            if (!solicitud || solicitud.ok === false) {
                return responderAccionInspiracion(callback, solicitud || { ok: false, code: "REQUEST_FAILED" });
            }
            if (solicitud.existente) {
                const respuesta = {
                    ok: true,
                    solicitada: false,
                    restaurada: true,
                    inspiracion_id: solicitud.inspiracion_id,
                    modo_actual: contexto.modo_actual,
                    modo_seq: contexto.modo_seq
                };
                responderAccionInspiracion(callback, respuesta);
                if (typeof modo.emitirEntregaInspiracionActiva === "function") {
                    modo.emitirEntregaInspiracionActiva(player, socket);
                }
                return respuesta;
            }
            const respuesta = {
                ok: true,
                solicitada: true,
                restaurada: false,
                modo_actual: contexto.modo_actual,
                modo_seq: contexto.modo_seq
            };
            responderAccionInspiracion(callback, respuesta);
            pedirSiguienteInspiracion(modo, player);
            return respuesta;
        }

        if (typeof modo.aprovecharInspiracion !== "function") {
            return responderAccionInspiracion(callback, { ok: false, code: "MODE_NOT_AVAILABLE" });
        }
        let resultado = modo.aprovecharInspiracion(player, inspiracion_id);
        if (!resultado || resultado.ok === false) {
            return responderAccionInspiracion(callback, resultado || { ok: false, code: "USE_FAILED" });
        }
        const debeAvanzar = !resultado.idempotente;
        if (debeAvanzar) {
            if (contexto.modo_actual === "palabras bonus" && Number(resultado.tiempo_otorgado) > 0) {
                const ajusteTiempo = aplicarAjusteTiempoInspiracion({
                    player,
                    secs: Number(resultado.tiempo_otorgado),
                    origen: "inspiracion_bonus",
                    inspiracion_id: resultado.inspiracion_id,
                    modo_seq: contexto.modo_seq
                });
                if (ajusteTiempo && Number.isFinite(Number(ajusteTiempo.tiempo_seq))) {
                    resultado = {
                        ...resultado,
                        tiempo_otorgado: Number(ajusteTiempo.secs),
                        tiempo_seq: Math.max(0, Math.trunc(Number(ajusteTiempo.tiempo_seq)))
                    };
                    if (typeof modo.actualizarUltimoAprovechamientoInspiracion === "function") {
                        modo.actualizarUltimoAprovechamientoInspiracion(
                            player,
                            resultado.inspiracion_id,
                            {
                                tiempo_otorgado: resultado.tiempo_otorgado,
                                tiempo_seq: resultado.tiempo_seq
                            }
                        );
                    }
                }
            }
            registrarInspiracionIntroducidaDesdeResultado(resultado);
            emitirInspiracionAprovechadaAutoritativa(resultado, contexto, player);
        }
        const respuesta = {
            ...resultado,
            modo_actual: contexto.modo_actual,
            modo_seq: contexto.modo_seq
        };
        responderAccionInspiracion(callback, respuesta);
        if (debeAvanzar) {
            pedirSiguienteInspiracion(modo, player);
            emitirNubeInspiracionEstado(null, true);
        }
        return respuesta;
    };

    socket.on("nueva_palabra", (id_jugador, callback = null) => {
        const accion = normalizarAccionInspiracion(id_jugador);
        if (accion) {
            return procesarAccionInspiracionV2(
                accion,
                getModoBonus(),
                callback,
                ["palabras bonus"]
            );
        }
        if (!validarContextoInspiracion({ modosPermitidos: ["palabras bonus"] }).ok) return;
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        if (!esEscritorActivoEstricto(id_jugador_valido)) {
            return;
        }
        const modoBonus = getModoBonus();
        if (rechazarLegacySiV2Activo(modoBonus, id_jugador_valido, callback)) return;
        registrarInspiracionIntroducidaDesdeModo(modoBonus, id_jugador_valido);
        modoBonus.handleRequest(id_jugador_valido);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_prohibida", (id_jugador, callback = null) => {
        const accion = normalizarAccionInspiracion(id_jugador);
        if (accion) {
            return procesarAccionInspiracionV2(
                accion,
                getModoMalditas(),
                callback,
                ["palabras prohibidas"]
            );
        }
        if (!validarContextoInspiracion({ modosPermitidos: ["palabras prohibidas"] }).ok) return;
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        if (!esEscritorActivoEstricto(id_jugador_valido)) {
            return;
        }
        const modoMalditas = getModoMalditas();
        if (rechazarLegacySiV2Activo(modoMalditas, id_jugador_valido, callback)) return;
        registrarInspiracionIntroducidaDesdeModo(modoMalditas, id_jugador_valido);
        modoMalditas.handleRequest(id_jugador_valido);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_musa", (escritxr, callback = null) => {
        const accion = normalizarAccionInspiracion(escritxr);
        if (accion) {
            return procesarAccionInspiracionV2(
                accion,
                getModoMusas(),
                callback,
                ["letra bendita", "letra prohibida"]
            );
        }
        if (!validarContextoInspiracion({
            modosPermitidos: ["letra bendita", "letra prohibida"]
        }).ok) return;
        const id_jugador = obtenerIdJugadorValido(escritxr);
        if (!id_jugador) {
            return;
        }
        if (!esEscritorActivoEstricto(id_jugador)) {
            return;
        }
        registrar(`[socket] peticion de musa para jugador ${id_jugador}`);
        const modoMusas = getModoMusas();
        if (rechazarLegacySiV2Activo(modoMusas, id_jugador, callback)) return;
        registrarInspiracionIntroducidaDesdeModo(modoMusas, id_jugador);
        modoMusas.handleRequest(id_jugador);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("nueva_palabra_bonus", (entrada = {}, callback = null) => {
        const accion = normalizarAccionInspiracion(entrada);
        if (accion) {
            return procesarAccionInspiracionV2(
                accion,
                getModoBonus(),
                callback,
                ["palabras bonus"]
            );
        }
        if (!validarContextoInspiracion({
            modosPermitidos: ["palabras bonus"],
            modoSeq: obtenerModoSeqEntrada(entrada)
        }).ok) return;
        const jugador = entrada && typeof entrada === "object" ? entrada.jugador : entrada;
        const id_jugador = obtenerIdJugadorValido(jugador);
        if (!id_jugador) {
            return;
        }
        if (!esEscritorActivoEstricto(id_jugador)) {
            return;
        }
        const modoBonus = getModoBonus();
        if (rechazarLegacySiV2Activo(modoBonus, id_jugador, callback)) return;
        registrarInspiracionIntroducidaDesdeModo(modoBonus, id_jugador);
        modoBonus.handleRequest(id_jugador);
        emitirNubeInspiracionEstado(null, true);
    });

    socket.on("descartar_inspiracion", (entrada = {}, callback = null) => {
        const player = obtenerIdJugadorValido(
            entrada && (entrada.player ?? entrada.jugador ?? entrada.escritxr ?? entrada.writer)
        );
        if (!player || !esEscritorActivoEstricto(player)) {
            return responderAccionInspiracion(callback, { ok: false, code: "NOT_ACTIVE_WRITER" });
        }
        const modoSeqEntrada = obtenerModoSeqEntrada(entrada);
        const contexto = validarContextoInspiracion({
            modosPermitidos: ["palabras bonus", "letra bendita", "letra prohibida"],
            modoSeq: modoSeqEntrada,
            modoSeqInvalido: typeof modoSeqEntrada === "number" && !Number.isFinite(modoSeqEntrada),
            codigoModo: "MODE_NOT_DISCARDABLE"
        });
        if (!contexto.ok) {
            return responderAccionInspiracion(callback, contexto);
        }
        const modoActual = contexto.modo_actual;
        const modo = modoActual === "palabras bonus" ? getModoBonus() : getModoMusas();
        if (!modo || typeof modo.descartarInspiracion !== "function") {
            return responderAccionInspiracion(callback, { ok: false, code: "MODE_NOT_AVAILABLE" });
        }
        const resultado = modo.descartarInspiracion(player, entrada && entrada.inspiracion_id);
        if (!resultado || resultado.ok === false) {
            return responderAccionInspiracion(callback, resultado || { ok: false, code: "DISCARD_FAILED" });
        }
        const respuesta = {
            ...resultado,
            modo_actual: modoActual,
            modo_seq: contexto.modo_seq
        };
        responderAccionInspiracion(callback, respuesta);
        if (!resultado.idempotente) {
            io.to(`j${player}`).emit("inspiracion_descartada", {
                ...resultado,
                modo_actual: modoActual,
                modo_seq: contexto.modo_seq
            });
            pedirSiguienteInspiracion(modo, player);
            emitirNubeInspiracionEstado(null, true);
        }
        return respuesta;
    });

    socket.on("enviar_inspiracion", (evento) => {
        const musaActiva = typeof obtenerMusaActiva === "function"
            ? obtenerMusaActiva(socket)
            : null;
        const id_jugador = obtenerIdJugadorValido(musaActiva && musaActiva.player);
        if (!id_jugador) {
            return;
        }
        const datos = (evento && typeof evento === "object") ? evento : { palabra: evento };
        const palabra = typeof datos.palabra === "string" ? datos.palabra.trim() : "";
        if (!palabra) {
            return;
        }
        const nombre_musa = nombreMusaPublico(musaActiva && musaActiva.nombre);
        const musa_client_id = normalizarMusaClientId(musaActiva && musaActiva.clientId);
        const payload_musa = { palabra, musa: nombre_musa, client_id: musa_client_id };
        const modo_actual = getModoActual();
        const target_player = modo_actual === "palabras prohibidas"
            ? (id_jugador === 1 ? 2 : 1)
            : id_jugador;
        nubeInspiracion.registrarInspiracion(id_jugador, {
            palabra,
            musa: nombre_musa,
            client_id: musa_client_id,
            modo_actual
        });
        if (
            typeof musasAuxiliares.registrarInspiracionEnviada === "function"
            && ["palabras bonus", "palabras prohibidas", "letra bendita", "letra prohibida"].includes(modo_actual)
        ) {
            musasAuxiliares.registrarInspiracionEnviada({
                player: id_jugador,
                target_player,
                palabra,
                musa: nombre_musa,
                client_id: musa_client_id,
                modo: modo_actual
            });
        }

        switch (modo_actual) {
            case "palabras bonus":
                getModoBonus().addMusa(id_jugador, payload_musa);
                registrar(`[bonus] Se anadio musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
                break;

            case "palabras prohibidas":
                getModoMalditas().addMusa(id_jugador, payload_musa);
                registrar(`[maldita] Se anadio musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
                break;

            case "letra bendita":
            case "letra prohibida":
                {
                    const modoMusas = getModoMusas();
                    modoMusas.addMusa(id_jugador, payload_musa);
                    entregarInspiracionEnColaAEscritoraActiva(modoMusas, id_jugador);
                }
                registrar(`[modo_musas] Se anadio musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
                break;
        }
        emitirNubeInspiracionEstado(null, true);
    });
}

module.exports = {
    construirEventoFeedbackMusaInspiracion,
    registrarCanalesInspiracion
};
