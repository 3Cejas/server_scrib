const { contieneLenguajeOfensivo } = require("./profanity_filter.js");

const REGEX_LIMPIEZA_PALABRA = /[^\p{L}\p{N}\p{M}\s-]/gu;
const MAX_PALABRA_CALENTAMIENTO = 24;
const MAX_FRASE_FINAL_CALENTAMIENTO = 48;
const MAX_PALABRAS_PANTALLA_CALENTAMIENTO = 220;
const MIN_Y_PALABRAS_CALENTAMIENTO = 20;
const MAX_Y_PALABRAS_CALENTAMIENTO = 94;
const DURACION_PALABRA_CALENTAMIENTO_MS = 10000;
const DURACION_PALABRA_CAMBIO_CONSIGNA_MS = 900;
const INTERVALO_PURGA_CALENTAMIENTO_MS = 1000;
const ORDEN_SOLICITUD_CALENTAMIENTO = ["lugares", "acciones", "frase_final"];
const SOLICITUD_CALENTAMIENTO_SIN_ACTIVA = "ninguna";
const SOLICITUD_CALENTAMIENTO_POR_DEFECTO = SOLICITUD_CALENTAMIENTO_SIN_ACTIVA;
const TIPOS_SOLICITUD_CALENTAMIENTO_ACTIVAS = new Set(ORDEN_SOLICITUD_CALENTAMIENTO);
const TIPOS_SOLICITUD_CALENTAMIENTO = new Set([
    SOLICITUD_CALENTAMIENTO_SIN_ACTIVA,
    ...ORDEN_SOLICITUD_CALENTAMIENTO
]);

const crearEstadoCalentamiento = (aciertos = 0) => ({
    semillas: { 1: null, 2: null },
    semillas_ts: 0,
    asignadas: { 1: null, 2: null },
    pendiente: null,
    usadas: new Map(),
    intentos: 0,
    aciertos,
    estado: "inactivo",
    historial: [],
    ultimo_intento: null,
    palabras: [],
    bloqueado: false,
    final: null
});

const crearCursorCalentamiento = () => ({
    x: 50,
    y: 50,
    visible: false,
    ts: 0
});

const crearEstadoBase = () => ({
    activo: false,
    vista: false,
    solicitud: SOLICITUD_CALENTAMIENTO_POR_DEFECTO,
    cursores: {
        1: crearCursorCalentamiento(),
        2: crearCursorCalentamiento()
    },
    equipos: {
        1: crearEstadoCalentamiento(),
        2: crearEstadoCalentamiento()
    }
});

const limpiarPalabra = (valor) => (typeof valor === "string" ? valor.trim() : "");

const limitarPorcentaje = (valor, min = 0, max = 100) => {
    const num = Number(valor);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
};

const normalizarPalabra = (valor) => {
    if (typeof valor !== "string") return "";
    const limpio = valor.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
    return limpio.replace(REGEX_LIMPIEZA_PALABRA, "").trim();
};

const normalizarDuracionPalabraCalentamiento = (valor, fallback = DURACION_PALABRA_CALENTAMIENTO_MS) => {
    const num = Number(valor);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return num;
};

const normalizarSolicitudCalentamiento = (valor) => {
    const tipo = typeof valor === "string" ? valor.trim().toLowerCase() : "";
    if (TIPOS_SOLICITUD_CALENTAMIENTO.has(tipo)) return tipo;
    return SOLICITUD_CALENTAMIENTO_POR_DEFECTO;
};

const distanciaCalentamiento = (a, b) => {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt((dx * dx) + (dy * dy));
};

const serializarFinalCalentamiento = (entrada) => {
    if (!entrada || typeof entrada !== "object") return null;
    if (typeof entrada.id !== "string" || !entrada.id) return null;
    if (typeof entrada.palabra !== "string" || !entrada.palabra) return null;
    return {
        id: entrada.id,
        palabra: entrada.palabra,
        ts: Number(entrada.ts) || 0,
        animTs: Number(entrada.animTs) || 0
    };
};

const serializarPalabrasCalentamiento = (palabras = []) => palabras.map((entrada) => ({
    id: entrada.id,
    palabra: entrada.palabra,
    equipo: entrada.equipo,
    x: entrada.x,
    y: entrada.y,
    destacada: Boolean(entrada.destacada),
    ts: entrada.ts || 0,
    animOnTs: Number(entrada.animOnTs) || 0,
    animOffTs: Number(entrada.animOffTs) || 0,
    duracionMs: normalizarDuracionPalabraCalentamiento(entrada.duracionMs)
}));

function crearGestorCalentamiento({
    io,
    validarJugador,
    detectarLenguajeOfensivo = contieneLenguajeOfensivo,
    onVistaCambiada = () => {},
    onTutorialIniciado = () => {}
}) {
    const musasPorEquipo = { 1: new Map(), 2: new Map() };
    const estado = crearEstadoBase();
    let intervaloPurga = null;

    const obtenerJugador = (valor) => {
        if (typeof validarJugador === "function") {
            return validarJugador(valor);
        }
        const id = Number(valor);
        return id === 1 || id === 2 ? id : null;
    };

    const esSolicitudActiva = () => TIPOS_SOLICITUD_CALENTAMIENTO_ACTIVAS.has(estado.solicitud);
    const esSolicitudFraseFinal = () => esSolicitudActiva() && estado.solicitud === "frase_final";
    const obtenerMaxLongitud = () => (
        esSolicitudFraseFinal()
            ? MAX_FRASE_FINAL_CALENTAMIENTO
            : MAX_PALABRA_CALENTAMIENTO
    );

    const generarPosicion = (equipo) => {
        const todas = [
            ...(estado.equipos[1]?.palabras || []),
            ...(estado.equipos[2]?.palabras || [])
        ];
        const minX = 6;
        const maxX = 94;
        const minY = MIN_Y_PALABRAS_CALENTAMIENTO;
        const maxY = MAX_Y_PALABRAS_CALENTAMIENTO;
        const minimoDistancia = todas.length < 40 ? 8 : (todas.length < 100 ? 5 : 3);
        for (let i = 0; i < 60; i += 1) {
            const x = Number((Math.random() * (maxX - minX) + minX).toFixed(2));
            const y = Number((Math.random() * (maxY - minY) + minY).toFixed(2));
            const candidato = { x, y, equipo };
            const choca = todas.some((word) => distanciaCalentamiento(word, candidato) < minimoDistancia);
            if (!choca) {
                return { x, y };
            }
        }
        return {
            x: Number((Math.random() * (maxX - minX) + minX).toFixed(2)),
            y: Number((Math.random() * (maxY - minY) + minY).toFixed(2))
        };
    };

    const resetearPalabrasEquipo = (equipo, mantenerAciertos = true) => {
        const previo = estado.equipos[equipo];
        const aciertos = mantenerAciertos ? (previo.aciertos || 0) : 0;
        const siguiente = crearEstadoCalentamiento(aciertos);
        siguiente.estado = musasPorEquipo[equipo].size > 0 ? "jugando" : "sin_musas";
        estado.equipos[equipo] = siguiente;
    };

    const acelerarPalabrasCambioSolicitud = () => {
        const ahora = Date.now();
        [1, 2].forEach((equipo) => {
            const data = estado.equipos[equipo];
            if (!data || !Array.isArray(data.palabras)) return;
            data.bloqueado = false;
            data.final = null;
            data.estado = musasPorEquipo[equipo].size > 0 ? "jugando" : "sin_musas";
            data.palabras.forEach((entrada) => {
                if (!entrada) return;
                const duracionActual = normalizarDuracionPalabraCalentamiento(entrada.duracionMs);
                const edadActual = Math.max(0, ahora - (Number(entrada.ts) || ahora));
                const progreso = Math.max(0, Math.min(1, edadActual / duracionActual));
                entrada.destacada = false;
                entrada.animOnTs = 0;
                entrada.animOffTs = ahora;
                entrada.duracionMs = DURACION_PALABRA_CAMBIO_CONSIGNA_MS;
                entrada.ts = ahora - Math.floor(progreso * DURACION_PALABRA_CAMBIO_CONSIGNA_MS);
            });
        });
    };

    const agregarPalabra = (equipo, socketId, valorPalabra) => {
        if (!estado.activo || !estado.vista) {
            return { ok: false, mensaje: "El calentamiento no esta disponible." };
        }
        if (!esSolicitudActiva()) {
            return { ok: false, mensaje: "No hay detonador activo." };
        }
        const data = estado.equipos[equipo];
        if (!data) {
            return { ok: false, mensaje: "Equipo invalido." };
        }
        if (data.bloqueado) {
            return { ok: false, mensaje: "Tu escritxr cerro esta consigna. Espera a la siguiente." };
        }
        const esFraseFinal = esSolicitudFraseFinal();
        const etiqueta = esFraseFinal ? "frase" : "palabra";
        const palabra = limpiarPalabra(valorPalabra).replace(/\s+/g, " ");
        if (!palabra) {
            return { ok: false, mensaje: `Escribe una ${etiqueta}.` };
        }
        if (!esFraseFinal && /\s/.test(palabra)) {
            return { ok: false, mensaje: "Solo una palabra, sin espacios." };
        }
        const maxLongitud = obtenerMaxLongitud();
        if (palabra.length > maxLongitud) {
            return { ok: false, mensaje: `Maximo ${maxLongitud} caracteres.` };
        }
        if (detectarLenguajeOfensivo(palabra)) {
            return {
                ok: false,
                codigo: "CONTENIDO_NO_PERMITIDO",
                mensaje: "No se permiten palabrotas ni lenguaje ofensivo."
            };
        }
        const normalizada = normalizarPalabra(palabra);
        if (!normalizada) {
            return { ok: false, mensaje: `Escribe una ${etiqueta} valida.` };
        }
        const posicion = generarPosicion(equipo);
        const registro = {
            id: `${equipo}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            palabra,
            normalizada,
            equipo,
            x: posicion.x,
            y: posicion.y,
            destacada: false,
            ts: Date.now(),
            animOnTs: 0,
            animOffTs: 0,
            duracionMs: DURACION_PALABRA_CALENTAMIENTO_MS,
            socketId
        };
        data.palabras.push(registro);
        if (data.palabras.length > MAX_PALABRAS_PANTALLA_CALENTAMIENTO) {
            data.palabras.shift();
        }
        data.intentos += 1;
        data.estado = "jugando";
        data.ultimo_intento = {
            id: registro.id,
            palabra: registro.palabra,
            exito: false,
            ts: registro.ts
        };
        return { ok: true, registro };
    };

    const bloquearEquipo = (equipo) => {
        if (equipo !== 1 && equipo !== 2) {
            return { ok: false, mensaje: "Equipo invalido." };
        }
        const data = estado.equipos[equipo];
        if (!data || !Array.isArray(data.palabras)) {
            return { ok: false, mensaje: "Equipo invalido." };
        }
        if (data.bloqueado) {
            return { ok: false, mensaje: "La consigna ya esta cerrada para tu equipo." };
        }
        const destacadas = data.palabras.filter((entrada) => entrada && entrada.destacada);
        if (destacadas.length === 0) {
            return { ok: false, mensaje: "Selecciona al menos una palabra antes de cerrar." };
        }
        data.palabras = destacadas;
        data.bloqueado = true;
        data.final = null;
        data.estado = "bloqueado";
        return { ok: true, seleccionadas: data.palabras.length };
    };

    const seleccionarPalabraFinal = (equipo, idPalabra) => {
        if (!idPalabra || (equipo !== 1 && equipo !== 2)) {
            return { ok: false, mensaje: "Seleccion invalida." };
        }
        const data = estado.equipos[equipo];
        if (!data || !data.bloqueado || !Array.isArray(data.palabras)) {
            return { ok: false, mensaje: "Primero cierra la consigna de tu equipo." };
        }
        const palabra = data.palabras.find((item) => item && item.id === idPalabra && item.destacada);
        if (!palabra) {
            return { ok: false, mensaje: "Solo puedes elegir entre las palabras seleccionadas." };
        }
        const ahora = Date.now();
        const previa = serializarFinalCalentamiento(data.final);
        data.final = {
            id: palabra.id,
            palabra: palabra.palabra,
            ts: ahora,
            animTs: (previa && previa.id === palabra.id) ? (previa.animTs || ahora) : ahora
        };
        data.estado = "final";
        return {
            ok: true,
            cambio: !previa || previa.id !== palabra.id,
            final: serializarFinalCalentamiento(data.final)
        };
    };

    const alternarPalabraDestacada = (equipo, idPalabra) => {
        if (!idPalabra || (equipo !== 1 && equipo !== 2)) return false;
        const data = estado.equipos[equipo];
        if (!data || !Array.isArray(data.palabras)) return false;
        if (data.bloqueado) return false;
        const palabra = data.palabras.find((item) => item.id === idPalabra);
        if (!palabra) return false;
        data.final = null;
        const destacada = !Boolean(palabra.destacada);
        const ahora = Date.now();
        palabra.destacada = destacada;
        if (destacada) {
            palabra.animOnTs = ahora;
            palabra.animOffTs = 0;
            data.aciertos += 1;
            return {
                id: palabra.id,
                palabra: palabra.palabra,
                equipo,
                destacada: true,
                socketId: palabra.socketId || null
            };
        }
        data.aciertos = Math.max(0, data.aciertos - 1);
        palabra.ts = ahora;
        palabra.animOnTs = 0;
        palabra.animOffTs = ahora;
        return {
            id: palabra.id,
            palabra: palabra.palabra,
            equipo,
            destacada: false,
            socketId: palabra.socketId || null
        };
    };

    const depurarPalabras = () => {
        if (!estado.activo) return false;
        const ahora = Date.now();
        let cambio = false;
        [1, 2].forEach((equipo) => {
            const data = estado.equipos[equipo];
            if (!data || !Array.isArray(data.palabras) || data.palabras.length === 0) return;
            const totalPrevio = data.palabras.length;
            data.palabras = data.palabras.filter((entrada) => {
                if (!entrada) return false;
                if (entrada.destacada) return true;
                const edad = ahora - (Number(entrada.ts) || ahora);
                const duracion = normalizarDuracionPalabraCalentamiento(entrada.duracionMs);
                return edad < duracion;
            });
            if (data.palabras.length !== totalPrevio) {
                cambio = true;
            }
        });
        return cambio;
    };

    const actualizarCursor = (equipo, payload = {}) => {
        const cursor = estado.cursores[equipo];
        if (!cursor) return false;
        const visible = payload && payload.visible === false ? false : true;
        if (!visible) {
            if (!cursor.visible) return false;
            cursor.visible = false;
            cursor.ts = Date.now();
            return true;
        }
        const x = limitarPorcentaje(payload.x, 0, 100);
        const y = limitarPorcentaje(payload.y, 0, 100);
        const cambio = !cursor.visible || Math.abs(cursor.x - x) > 0.15 || Math.abs(cursor.y - y) > 0.15;
        cursor.x = x;
        cursor.y = y;
        cursor.visible = true;
        cursor.ts = Date.now();
        return cambio;
    };

    const ocultarCursor = (equipo) => {
        const cursor = estado.cursores[equipo];
        if (!cursor || !cursor.visible) return false;
        cursor.visible = false;
        cursor.ts = Date.now();
        return true;
    };

    const payloadCursores = () => ({
        1: { ...estado.cursores[1] },
        2: { ...estado.cursores[2] }
    });

    const estadoEquipo = (equipo) => {
        const data = estado.equipos[equipo];
        const palabrasSerializadas = serializarPalabrasCalentamiento(data.palabras || []);
        const seleccionadas = (data.palabras || []).reduce((total, entrada) => (
            total + (entrada && entrada.destacada ? 1 : 0)
        ), 0);
        return {
            semillas: { 1: null, 2: null },
            semillasTs: data.semillas_ts,
            semillasRecibidas: {
                1: false,
                2: false
            },
            intentos: data.intentos,
            aciertos: data.aciertos,
            estado: data.estado,
            pendiente: false,
            pendientePalabra: null,
            ultimoIntento: data.ultimo_intento,
            usadas: [],
            historial: [],
            palabras: palabrasSerializadas,
            seleccionadas,
            bloqueado: Boolean(data.bloqueado),
            final: serializarFinalCalentamiento(data.final)
        };
    };

    const payloadEstado = () => ({
        activo: estado.activo,
        vista: estado.vista,
        solicitud: estado.solicitud,
        cursores: payloadCursores(),
        equipos: {
            1: estadoEquipo(1),
            2: estadoEquipo(2)
        }
    });

    const payloadEstadoMusa = (equipo) => {
        const data = estadoEquipo(equipo);
        return {
            activo: estado.activo,
            vista: estado.vista,
            solicitud: estado.solicitud,
            equipo,
            rol: "musa",
            estado: data.estado,
            intentos: data.intentos,
            aciertos: data.aciertos,
            palabras: data.palabras,
            seleccionadas: data.seleccionadas,
            bloqueado: data.bloqueado,
            final: data.final
        };
    };

    const emitirEstadoMusa = (equipo, socketObjetivo = null) => {
        const payload = payloadEstadoMusa(equipo);
        if (socketObjetivo) {
            socketObjetivo.emit("calentamiento_estado_musa", payload);
            return payload;
        }
        // La sala incluye tanto a las musas participantes como a sus réplicas
        // de Dramaturgia. Así la vista de solo lectura recorre el calentamiento
        // sin registrarse como jugadora ni alterar el estado del equipo.
        if (io && typeof io.to === "function") {
            io.to(`musa_j${equipo}`).emit("calentamiento_estado_musa", payload);
        } else {
            musasPorEquipo[equipo].forEach((info) => {
                info.socket.emit("calentamiento_estado_musa", payload);
            });
        }
        return payload;
    };

    const emitirEstado = () => {
        io.emit("calentamiento_estado_espectador", payloadEstado());
        emitirEstadoMusa(1);
        emitirEstadoMusa(2);
        return payloadEstado();
    };

    const revisarAsignacionesEquipo = (equipo) => {
        if (!estado.activo) return;
        const data = estado.equipos[equipo];
        if (!data) return;
        data.estado = musasPorEquipo[equipo].size > 0 ? "jugando" : "sin_musas";
    };

    const iniciar = () => {
        estado.activo = true;
        onTutorialIniciado();
        estado.solicitud = SOLICITUD_CALENTAMIENTO_POR_DEFECTO;
        estado.cursores[1] = crearCursorCalentamiento();
        estado.cursores[2] = crearCursorCalentamiento();
        [1, 2].forEach((equipo) => {
            resetearPalabrasEquipo(equipo, true);
        });
        return emitirEstado();
    };

    const reset = () => {
        estado.activo = false;
        estado.vista = false;
        estado.solicitud = SOLICITUD_CALENTAMIENTO_POR_DEFECTO;
        estado.cursores[1] = crearCursorCalentamiento();
        estado.cursores[2] = crearCursorCalentamiento();
        estado.equipos[1] = crearEstadoCalentamiento();
        estado.equipos[2] = crearEstadoCalentamiento();
        return payloadEstado();
    };

    const registrarMusa = (socket, equipo, nombre = "MUSA") => {
        musasPorEquipo[equipo].set(socket.id, { socket, nombre });
        if (estado.activo) {
            revisarAsignacionesEquipo(equipo);
            emitirEstado();
        } else {
            emitirEstadoMusa(equipo);
        }
    };

    const desregistrarMusa = (socket, equipo) => {
        if (equipo !== 1 && equipo !== 2) return false;
        musasPorEquipo[equipo].delete(socket.id);
        const data = estado.equipos[equipo];
        if (data.pendiente && data.pendiente.socketId === socket.id) {
            data.pendiente = null;
        }
        if (!data.semillas[1] || !data.semillas[2]) {
            revisarAsignacionesEquipo(equipo);
        }
        emitirEstado();
        return true;
    };

    const desregistrarEscritor = (socket, equipo) => {
        if (equipo !== 1 && equipo !== 2) return false;
        if (!ocultarCursor(equipo)) return false;
        io.emit("calentamiento_cursor", { equipo, ...estado.cursores[equipo] });
        return true;
    };

    const cambiarVista = (payload = {}) => {
        if (payload && typeof payload.activo === "boolean") {
            estado.vista = payload.activo;
        } else {
            estado.vista = !estado.vista;
        }
        if (estado.solicitud !== SOLICITUD_CALENTAMIENTO_POR_DEFECTO) {
            acelerarPalabrasCambioSolicitud();
        }
        estado.solicitud = SOLICITUD_CALENTAMIENTO_POR_DEFECTO;
        if (estado.vista && !estado.activo) {
            iniciar();
        } else if (estado.vista) {
            onTutorialIniciado();
        }
        io.emit("calentamiento_vista", { activo: estado.vista });
        emitirEstado();
        onVistaCambiada();
        return payloadEstado();
    };

    const reiniciarMarcador = () => {
        [1, 2].forEach((equipo) => {
            const data = estado.equipos[equipo];
            data.intentos = 0;
            data.aciertos = 0;
            data.bloqueado = false;
            data.final = null;
            data.estado = musasPorEquipo[equipo].size > 0 ? "jugando" : "sin_musas";
            if (Array.isArray(data.palabras)) {
                data.palabras.forEach((palabra) => {
                    palabra.destacada = false;
                    palabra.animOnTs = 0;
                    palabra.animOffTs = Date.now();
                });
            }
        });
        return emitirEstado();
    };

    const cambiarSolicitud = (tipoEntrada) => {
        const tipo = normalizarSolicitudCalentamiento(tipoEntrada);
        if (tipo !== estado.solicitud) {
            acelerarPalabrasCambioSolicitud();
        }
        estado.solicitud = tipo;
        return emitirEstado();
    };

    const forzarEstado = (payload = {}) => {
        const activo = typeof payload.activo === "boolean" ? payload.activo : true;
        const vista = typeof payload.vista === "boolean" ? payload.vista : activo;
        const solicitud = normalizarSolicitudCalentamiento(payload.solicitud);
        estado.activo = activo;
        estado.vista = vista;
        estado.solicitud = solicitud;
        if (payload.reset !== false) {
            estado.cursores[1] = crearCursorCalentamiento();
            estado.cursores[2] = crearCursorCalentamiento();
            estado.equipos[1] = crearEstadoCalentamiento();
            estado.equipos[2] = crearEstadoCalentamiento();
        }
        if (activo || vista) {
            onTutorialIniciado();
        }
        if (activo) {
            revisarAsignacionesEquipo(1);
            revisarAsignacionesEquipo(2);
        }
        io.emit("calentamiento_vista", { activo: estado.vista });
        emitirEstado();
        return { ok: true, tutorial: payloadEstado() };
    };

    const registrarHandlers = (socket) => {
        const procesarPalabraMusa = (payload = {}, responder = null) => {
            const equipo = obtenerJugador(socket.musa);
            if (!equipo) {
                if (typeof responder === "function") {
                    responder({ ok: false, codigo: "MUSA_NO_REGISTRADA", mensaje: "Musa no registrada." });
                }
                return;
            }
            const resultado = agregarPalabra(equipo, socket.id, payload.palabra);
            if (!resultado.ok) {
                const error = {
                    ok: false,
                    codigo: resultado.codigo || "",
                    mensaje: resultado.mensaje || "No se pudo enviar la palabra."
                };
                if (typeof responder === "function") {
                    responder(error);
                } else {
                    socket.emit("calentamiento_error", {
                        codigo: error.codigo,
                        mensaje: error.mensaje
                    });
                }
                return;
            }
            emitirEstado();
            if (typeof responder === "function") {
                responder({ ok: true });
            }
        };

        socket.on("cambiar_vista_calentamiento", (payload = {}) => {
            if (!socket.control && !socket.simulacion_scrib) return;
            cambiarVista(payload);
        });

        socket.on("reiniciar_calentamiento", () => {
            if (!socket.control && !socket.simulacion_scrib) return;
            iniciar();
        });

        socket.on("reiniciar_marcador_calentamiento", () => {
            if (!socket.control && !socket.simulacion_scrib) return;
            reiniciarMarcador();
        });

        socket.on("calentamiento_solicitud", (payload = {}) => {
            if (!socket.control && !socket.simulacion_scrib) return;
            cambiarSolicitud(payload.tipo);
        });

        socket.on("calentamiento_semilla", procesarPalabraMusa);

        socket.on("calentamiento_intento", procesarPalabraMusa);

        socket.on("calentamiento_click_palabra", (payload = {}) => {
            const equipo = obtenerJugador(socket.escritxr);
            if (!equipo) return;
            if (!estado.activo || !estado.vista) return;
            const id = typeof payload.id === "string" ? payload.id : "";
            if (!id) return;
            const dataEquipo = estado.equipos[equipo];
            if (dataEquipo && dataEquipo.bloqueado) {
                const seleccion = seleccionarPalabraFinal(equipo, id);
                if (!seleccion.ok) {
                    socket.emit("calentamiento_error_escritor", {
                        mensaje: seleccion.mensaje || "No se pudo fijar la palabra final."
                    });
                    return;
                }
                emitirEstado();
                return;
            }
            const cambio = alternarPalabraDestacada(equipo, id);
            if (!cambio) {
                socket.emit("calentamiento_error_escritor", {
                    mensaje: "No se pudo actualizar esa palabra."
                });
                return;
            }
            if (cambio.destacada && cambio.socketId) {
                io.to(cambio.socketId).emit("calentamiento_ganado", {
                    equipo: cambio.equipo,
                    palabra: cambio.palabra,
                    id: cambio.id
                });
            }
            emitirEstado();
        });

        socket.on("calentamiento_bloquear_equipo", () => {
            const equipo = obtenerJugador(socket.escritxr);
            if (!equipo) return;
            if (!estado.activo || !estado.vista) {
                socket.emit("calentamiento_error_escritor", {
                    mensaje: "El calentamiento no esta activo."
                });
                return;
            }
            const resultado = bloquearEquipo(equipo);
            if (!resultado.ok) {
                socket.emit("calentamiento_error_escritor", {
                    mensaje: resultado.mensaje || "No se pudo cerrar la consigna."
                });
                return;
            }
            emitirEstado();
        });

        socket.on("calentamiento_cursor", (payload = {}) => {
            const equipo = obtenerJugador(socket.escritxr);
            if (!equipo) return;
            if (!actualizarCursor(equipo, payload)) return;
            io.emit("calentamiento_cursor", { equipo, ...estado.cursores[equipo] });
        });
    };

    const iniciarIntervaloPurga = () => {
        if (intervaloPurga) return;
        intervaloPurga = setInterval(() => {
            if (!depurarPalabras()) return;
            emitirEstado();
        }, INTERVALO_PURGA_CALENTAMIENTO_MS);
        if (typeof intervaloPurga.unref === "function") {
            intervaloPurga.unref();
        }
    };

    return {
        cambiarSolicitud,
        cambiarVista,
        contarMusas: (equipo) => (musasPorEquipo[equipo] ? musasPorEquipo[equipo].size : 0),
        desregistrarEscritor,
        desregistrarMusa,
        emitirEstado,
        emitirEstadoMusa,
        estado,
        forzarEstado,
        iniciar,
        iniciarIntervaloPurga,
        normalizarSolicitud: normalizarSolicitudCalentamiento,
        payloadEstado,
        registrarHandlers,
        registrarMusa,
        reiniciarMarcador,
        reset,
        vistaActiva: () => Boolean(estado.vista)
    };
}

module.exports = {
    MAX_PALABRA_CALENTAMIENTO,
    SOLICITUD_CALENTAMIENTO_POR_DEFECTO,
    crearCursorCalentamiento,
    crearEstadoCalentamiento,
    crearGestorCalentamiento,
    limpiarPalabra,
    normalizarPalabra
};
