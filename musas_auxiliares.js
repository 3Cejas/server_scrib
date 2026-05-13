const FEEDBACK_MUSAS_URL_POR_DEFECTO = "/feedback/";
const COOLDOWN_MUSA_CORAZON_MS = 900;
const REGALO_BANDERA_MUSAS_OBJETIVO = 10;
const REGALO_BANDERA_MUSAS_SECS = 1;

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
    1: { equipo: null, musas: new Map() },
    2: { equipo: null, musas: new Map() }
});

const crearEstadoHistorialInspiracionMusas = () => ({
    1: new Map(),
    2: new Map()
});

const crearEstadoRegaloBandera = () => ({
    1: { progreso: 0, ultimo_regalo_ts: 0 },
    2: { progreso: 0, ultimo_regalo_ts: 0 }
});

const normalizarUrlFeedbackMusas = (valor) => {
    const url = typeof valor === "string" ? valor.trim() : "";
    return url.startsWith("/") ? url : FEEDBACK_MUSAS_URL_POR_DEFECTO;
};

const normalizarTextoCorto = (valor, max = 64) => (
    typeof valor === "string" ? valor.trim().slice(0, max) : ""
);

const normalizarClavePalabra = (valor) => {
    const texto = normalizarTextoCorto(valor, 64).toLowerCase();
    return texto.normalize ? texto.normalize("NFC") : texto;
};

const clonarRegaloPdf = (regalo) => (regalo ? { ...regalo } : null);

const modoInspiracionPdf = (modo) => {
    const texto = normalizarTextoCorto(modo, 40).toLowerCase();
    if (texto === "palabras bonus") return "palabras bonus";
    if (texto === "palabras prohibidas") return "palabras prohibidas";
    if (texto === "letra bendita") return "letra bendita";
    if (texto === "letra prohibida") return "letra prohibida";
    return texto;
};

function crearGestorMusasAuxiliares({ io, validarEquipo = (valor) => {
    const id = Number(valor);
    return id === 1 || id === 2 ? id : null;
}, getPartidaActiva = () => false, contarMusas = () => 0, aplicarRegaloBanderaTiempo = () => null } = {}) {
    let estadoBanderas = crearEstadoBanderas();
    let estadoFeedback = crearEstadoFeedback();
    let estadoCorazones = crearEstadoCorazones();
    let estadoRegalos = crearEstadoRegalos();
    let estadoRegaloBandera = crearEstadoRegaloBandera();
    let historialInspiracionMusas = crearEstadoHistorialInspiracionMusas();
    let secuenciaInspiracionMusa = 0;

    const normalizarEquipo = (valor) => {
        const equipo = validarEquipo(valor);
        return equipo === 1 || equipo === 2 ? equipo : null;
    };

    const normalizarClientId = (valor) => normalizarTextoCorto(valor, 96);
    const normalizarNombreMusa = (valor) => normalizarTextoCorto(valor, 24) || "MUSA";

    const claveMusa = (clientId, nombre) => {
        const id = normalizarClientId(clientId);
        if (id) return `client:${id}`;
        return `name:${normalizarNombreMusa(nombre).toLowerCase()}`;
    };

    const obtenerRegistroMusa = (equipo, clientId, nombre, crear = true) => {
        const id = normalizarEquipo(equipo);
        if (!id) return null;
        const key = claveMusa(clientId, nombre);
        const equipoHistorial = historialInspiracionMusas[id];
        if (!equipoHistorial.has(key)) {
            if (!crear) return null;
            equipoHistorial.set(key, {
                player: id,
                client_id: normalizarClientId(clientId),
                nombre: normalizarNombreMusa(nombre),
                palabras: []
            });
        }
        const registro = equipoHistorial.get(key);
        const clientIdNormalizado = normalizarClientId(clientId);
        const nombreNormalizado = normalizarNombreMusa(nombre);
        if (clientIdNormalizado) registro.client_id = clientIdNormalizado;
        if (nombreNormalizado) registro.nombre = nombreNormalizado;
        return registro;
    };

    const buscarEntradaIntroducible = (registro, { palabra, modo, targetPlayer }) => {
        if (!registro || !Array.isArray(registro.palabras)) return null;
        const clavePalabra = normalizarClavePalabra(palabra);
        const modoNormalizado = modoInspiracionPdf(modo);
        for (let i = registro.palabras.length - 1; i >= 0; i -= 1) {
            const entrada = registro.palabras[i];
            if (!entrada || entrada.introducida) continue;
            if (entrada.palabra_key !== clavePalabra) continue;
            if (modoNormalizado && entrada.modo !== modoNormalizado) continue;
            if (targetPlayer && entrada.target_player && entrada.target_player !== targetPlayer) continue;
            return entrada;
        }
        return null;
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

    const partidaActivaParaRegalo = () => {
        try {
            return Boolean(getPartidaActiva());
        } catch (_error) {
            return false;
        }
    };

    const contarMusasEquipo = (equipo) => {
        try {
            const total = Number(contarMusas(equipo));
            return Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
        } catch (_error) {
            return 0;
        }
    };

    const payloadRegaloBanderaEquipo = (equipo) => {
        const id = normalizarEquipo(equipo);
        if (!id) return null;
        const partidaActiva = partidaActivaParaRegalo();
        const visible = Boolean(estadoBanderas.activa) && partidaActiva;
        const estado = estadoRegaloBandera[id] || { progreso: 0, ultimo_regalo_ts: 0 };
        const progreso = visible
            ? Math.max(0, Math.min(REGALO_BANDERA_MUSAS_OBJETIVO, Number(estado.progreso) || 0))
            : 0;
        return {
            equipo: id,
            visible,
            partida_activa: partidaActiva,
            musas: contarMusasEquipo(id),
            progreso,
            objetivo: REGALO_BANDERA_MUSAS_OBJETIVO,
            progreso_pct: Math.round((progreso / REGALO_BANDERA_MUSAS_OBJETIVO) * 100),
            regalo_secs: REGALO_BANDERA_MUSAS_SECS,
            cooldown_ms: 0,
            ultimo_regalo_ts: Number(estado.ultimo_regalo_ts) || 0
        };
    };

    const payloadRegaloBandera = () => ({
        activa: Boolean(estadoBanderas.activa),
        partida_activa: partidaActivaParaRegalo(),
        objetivo: REGALO_BANDERA_MUSAS_OBJETIVO,
        regalo_secs: REGALO_BANDERA_MUSAS_SECS,
        equipos: {
            1: payloadRegaloBanderaEquipo(1),
            2: payloadRegaloBanderaEquipo(2)
        }
    });

    const emitirEstadoRegaloBandera = (socketDestino = null) => {
        const payload = payloadRegaloBandera();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("musa_regalo_bandera_estado", payload);
            return payload;
        }
        if (io && typeof io.emit === "function") {
            io.emit("musa_regalo_bandera_estado", payload);
        }
        return payload;
    };

    const registrarProgresoRegaloBandera = ({ equipo, now }) => {
        const id = normalizarEquipo(equipo);
        if (!id || !estadoBanderas.activa || !partidaActivaParaRegalo()) {
            return null;
        }
        const estadoActual = estadoRegaloBandera[id] || { progreso: 0, ultimo_regalo_ts: 0 };
        const progresoSiguiente = Math.max(0, Number(estadoActual.progreso) || 0) + 1;
        let premio = null;
        if (progresoSiguiente >= REGALO_BANDERA_MUSAS_OBJETIVO) {
            estadoRegaloBandera[id] = {
                progreso: 0,
                ultimo_regalo_ts: now
            };
            premio = aplicarRegaloBanderaTiempo({
                player: id,
                secs: REGALO_BANDERA_MUSAS_SECS,
                origen: "musa_bandera",
                motivo: "musa_corazon",
                regalo_bandera: true,
                objetivo: REGALO_BANDERA_MUSAS_OBJETIVO
            });
        } else {
            estadoRegaloBandera[id] = {
                ...estadoActual,
                progreso: progresoSiguiente
            };
        }
        emitirEstadoRegaloBandera();
        return {
            premio,
            estado: payloadRegaloBanderaEquipo(id)
        };
    };

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
        const regalo = registrarProgresoRegaloBandera({ equipo: id, now });
        if (regalo) {
            payload.regalo_bandera = regalo;
        }
        return payload;
    };

    const guardarRegalo = (payload = {}) => {
        const playerId = normalizarEquipo(payload && payload.player);
        if (!playerId || !payload || !payload.data) {
            return null;
        }
        const clientId = normalizarClientId(payload.client_id);
        const salida = {
            player: playerId,
            data: payload.data,
            filename: payload.filename || `regalo_j${playerId}.pdf`
        };
        if (clientId) {
            salida.client_id = clientId;
            salida.musa_nombre = normalizarNombreMusa(payload.musa_nombre || payload.musa);
            salida.personalizado = true;
            estadoRegalos[playerId].musas.set(clientId, salida);
        } else {
            estadoRegalos[playerId].equipo = salida;
        }
        return clonarRegaloPdf(salida);
    };

    const obtenerRegalo = (playerId, clientId = "") => {
        const id = normalizarEquipo(playerId);
        if (!id || !estadoRegalos[id]) return null;
        const clientIdNormalizado = normalizarClientId(clientId);
        if (clientIdNormalizado && estadoRegalos[id].musas.has(clientIdNormalizado)) {
            return clonarRegaloPdf(estadoRegalos[id].musas.get(clientIdNormalizado));
        }
        return clonarRegaloPdf(estadoRegalos[id].equipo);
    };

    const registrarInspiracionEnviada = (payload = {}) => {
        const equipo = normalizarEquipo(payload.player || payload.equipo);
        const palabra = normalizarTextoCorto(payload.palabra, 64);
        if (!equipo || !palabra) return null;
        const targetPlayer = normalizarEquipo(payload.target_player || payload.destinatario || equipo) || equipo;
        const registro = obtenerRegistroMusa(equipo, payload.client_id, payload.musa || payload.nombre);
        if (!registro) return null;
        const entrada = {
            id: ++secuenciaInspiracionMusa,
            player: equipo,
            target_player: targetPlayer,
            palabra,
            palabra_key: normalizarClavePalabra(palabra),
            modo: modoInspiracionPdf(payload.modo || payload.modo_actual),
            enviada_en: Number(payload.ts) || Date.now(),
            introducida: false,
            introducida_por: null,
            introducida_en: 0,
            tiempo: 0,
            superbonus: false
        };
        registro.palabras.push(entrada);
        return { ...entrada };
    };

    const registrarInspiracionIntroducida = (payload = {}) => {
        const equipo = normalizarEquipo(payload.player || payload.equipo);
        const palabra = normalizarTextoCorto(payload.palabra, 64);
        if (!equipo || !palabra) return 0;
        const targetPlayer = normalizarEquipo(payload.target_player || payload.introducida_por) || equipo;
        const modo = modoInspiracionPdf(payload.modo || payload.modo_actual);
        const clientIds = Array.from(new Set(
            []
                .concat(Array.isArray(payload.client_ids) ? payload.client_ids : [])
                .concat(payload.client_id ? [payload.client_id] : [])
                .map(normalizarClientId)
                .filter(Boolean)
        ));
        const nombres = Array.from(new Set(
            []
                .concat(Array.isArray(payload.musas) ? payload.musas : [])
                .concat(payload.musa_nombre ? [payload.musa_nombre] : [])
                .concat(payload.musa ? [payload.musa] : [])
                .map(normalizarNombreMusa)
                .filter(Boolean)
        ));
        const claves = clientIds.length
            ? clientIds.map((clientId, index) => ({ clientId, nombre: nombres[index] || nombres[0] || "MUSA" }))
            : nombres.map((nombre) => ({ clientId: "", nombre }));
        const objetivos = claves.length ? claves : [{ clientId: "", nombre: "MUSA" }];
        let actualizadas = 0;
        objetivos.forEach(({ clientId, nombre }) => {
            const registro = obtenerRegistroMusa(equipo, clientId, nombre, false)
                || obtenerRegistroMusa(equipo, clientId, nombre, true);
            if (!registro) return;
            let entrada = buscarEntradaIntroducible(registro, { palabra, modo, targetPlayer });
            if (!entrada) {
                entrada = {
                    id: ++secuenciaInspiracionMusa,
                    player: equipo,
                    target_player: targetPlayer,
                    palabra,
                    palabra_key: normalizarClavePalabra(palabra),
                    modo,
                    enviada_en: Number(payload.ts) || Date.now(),
                    introducida: false,
                    introducida_por: null,
                    introducida_en: 0,
                    tiempo: 0,
                    superbonus: false
                };
                registro.palabras.push(entrada);
            }
            entrada.introducida = true;
            entrada.introducida_por = targetPlayer;
            entrada.introducida_en = Number(payload.introducida_en) || Date.now();
            entrada.tiempo = Math.max(0, Number(payload.tiempo) || 0);
            entrada.superbonus = Boolean(payload.superbonus);
            actualizadas += 1;
        });
        return actualizadas;
    };

    const statsResumenMusa = (palabras = []) => {
        const enviadas = palabras.length;
        const introducidas = palabras.filter((entrada) => entrada.introducida).length;
        const superbonus = palabras.filter((entrada) => entrada.superbonus).length;
        const bonus = palabras.filter((entrada) => entrada.modo === "palabras bonus").length;
        const malditas = palabras.filter((entrada) => entrada.modo === "palabras prohibidas").length;
        const letras = palabras.filter((entrada) => entrada.modo === "letra bendita" || entrada.modo === "letra prohibida").length;
        const impactoPositivo = palabras
            .filter((entrada) => entrada.introducida && entrada.modo === "palabras bonus")
            .reduce((acc, entrada) => acc + (Number(entrada.tiempo) || 0), 0);
        const impactoNegativo = palabras
            .filter((entrada) => entrada.introducida && entrada.modo === "palabras prohibidas")
            .reduce((acc, entrada) => acc + (Number(entrada.tiempo) || 0), 0);
        return {
            enviadas,
            introducidas,
            efectividad_pct: enviadas ? Math.round((introducidas / enviadas) * 100) : 0,
            superbonus,
            bonus,
            malditas,
            letras,
            impacto_positivo: impactoPositivo,
            impacto_negativo: impactoNegativo,
            impacto_neto: impactoPositivo - impactoNegativo
        };
    };

    const clonarEntradaInspiracion = (entrada) => ({
        id: entrada.id,
        player: entrada.player,
        target_player: entrada.target_player,
        palabra: entrada.palabra,
        modo: entrada.modo,
        enviada_en: entrada.enviada_en,
        introducida: Boolean(entrada.introducida),
        introducida_por: entrada.introducida_por,
        introducida_en: entrada.introducida_en,
        tiempo: Number(entrada.tiempo) || 0,
        superbonus: Boolean(entrada.superbonus)
    });

    const payloadResumenPdf = () => {
        const equipos = {};
        [1, 2].forEach((equipo) => {
            const musas = Array.from(historialInspiracionMusas[equipo].values())
                .map((registro) => {
                    const palabras = registro.palabras
                        .slice()
                        .sort((a, b) => (a.enviada_en || 0) - (b.enviada_en || 0))
                        .map(clonarEntradaInspiracion);
                    return {
                        player: equipo,
                        client_id: registro.client_id || "",
                        nombre: registro.nombre || "MUSA",
                        stats: statsResumenMusa(palabras),
                        palabras
                    };
                })
                .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "") || (a.client_id || "").localeCompare(b.client_id || ""));
            equipos[equipo] = { player: equipo, musas };
        });
        return {
            ts: Date.now(),
            equipos
        };
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
        estadoRegaloBandera = crearEstadoRegaloBandera();
        historialInspiracionMusas = crearEstadoHistorialInspiracionMusas();
        secuenciaInspiracionMusa = 0;
    };

    const snapshot = () => ({
        banderas: payloadBanderas(),
        feedback: payloadFeedback(),
        corazones: payloadCorazones(),
        regalo_bandera: payloadRegaloBandera()
    });

    return {
        actualizarBanderas,
        emitirBanderas,
        emitirBanderasCompat,
        emitirFeedback,
        emitirResetRegalos,
        emitirEstadoRegaloBandera,
        guardarRegalo,
        obtenerRegalo,
        payloadBanderas,
        payloadCorazones,
        payloadFeedback,
        payloadRegaloBandera,
        payloadResumenPdf,
        registrarCorazon,
        registrarInspiracionEnviada,
        registrarInspiracionIntroducida,
        resetEstado,
        resetRegalos,
        solicitarFeedback,
        snapshot
    };
}

module.exports = {
    COOLDOWN_MUSA_CORAZON_MS,
    FEEDBACK_MUSAS_URL_POR_DEFECTO,
    REGALO_BANDERA_MUSAS_OBJETIVO,
    REGALO_BANDERA_MUSAS_SECS,
    crearGestorMusasAuxiliares,
    normalizarUrlFeedbackMusas
};
