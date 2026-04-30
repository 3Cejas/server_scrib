const OPCIONES_VENTAJA_BASE = [
    "\u{1F422}",
    "\u26A1",
    "\u{1F32A}\uFE0F",
    "\u{1F643}",
    "\u{1F58A}\uFE0F"
];

const MAX_MUSA_CLIENT_ID = 64;
const REGEX_MUSA_CLIENT_ID = /^[A-Za-z0-9_-]+$/;

const crearEstadoVotosVentaja = () => Object.fromEntries(
    OPCIONES_VENTAJA_BASE.map((opcion) => [opcion, 0])
);

const normalizarMusaClientId = (valor) => {
    if (typeof valor !== "string") return "";
    const limpio = valor.trim().slice(0, MAX_MUSA_CLIENT_ID);
    if (!limpio) return "";
    return REGEX_MUSA_CLIENT_ID.test(limpio) ? limpio : "";
};

function crearGestorVotacionVentaja({
    io,
    construirPayloadBase,
    obtenerIdJugadorValido,
    getDuracionMs = () => 0,
    scheduleTimer,
    cancelTimer,
    escogerGanador
}) {
    let votos = crearEstadoVotosVentaja();
    let activa = false;
    let equipo = "";
    let opciones = [];
    let duracionMs = 0;
    let terminaEnTs = 0;
    let votantes = new Set();

    const obtenerClaveVotante = (socket, clientId = "") => {
        const persistente = normalizarMusaClientId(socket && socket.musa_client_id)
            || normalizarMusaClientId(clientId);
        if (persistente) {
            return `musa:${persistente}`;
        }
        if (socket && typeof socket.id === "string" && socket.id) {
            return `socket:${socket.id}`;
        }
        return "";
    };

    const musaYaVoto = (socket, clientId = "") => {
        const clave = obtenerClaveVotante(socket, clientId);
        return Boolean(clave && votantes.has(clave));
    };

    const construirPayloadEstado = (socketDestino = null) => construirPayloadBase({
        activa,
        equipo,
        opciones,
        votos,
        duracion_ms: duracionMs,
        termina_en_ts: terminaEnTs,
        ya_voto: socketDestino ? musaYaVoto(socketDestino) : undefined,
        now: Date.now()
    });

    const emitirEstado = (override = null, socketDestino = null) => {
        const basePayload = construirPayloadEstado(socketDestino);
        const payload = (override && typeof override === "object")
            ? { ...basePayload, ...override }
            : basePayload;
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("votacion_ventaja_estado", payload);
            return payload;
        }
        io.emit("votacion_ventaja_estado", payload);
        return payload;
    };

    const resetEstado = () => {
        activa = false;
        equipo = "";
        opciones = [];
        duracionMs = 0;
        terminaEnTs = 0;
        votantes = new Set();
        votos = crearEstadoVotosVentaja();
    };

    const cerrarConSeleccion = (payload = {}) => {
        const emitirResultado = payload.emitir_resultado !== false;
        if (typeof cancelTimer === "function") {
            cancelTimer();
        }
        const opcionesFinal = Array.isArray(opciones) ? [...opciones] : [];
        const votosFinal = { ...votos };
        const equipoGanador = equipo;
        const perdedor = equipoGanador === "j1" ? "j2" : (equipoGanador === "j2" ? "j1" : "");
        const seleccion = (typeof payload.seleccion === "string" && payload.seleccion)
            ? payload.seleccion
            : (escogerGanador(votos) || opcionesFinal[0] || "");
        activa = false;
        terminaEnTs = 0;
        emitirEstado({
            activa: false,
            equipo: equipoGanador,
            opciones: opcionesFinal,
            votos: votosFinal,
            tiempo_restante_ms: 0,
            termina_en_ts: 0
        });
        if (emitirResultado && perdedor && seleccion) {
            io.emit(`enviar_ventaja_${perdedor}`, seleccion);
        }
        equipo = "";
        opciones = [];
        duracionMs = 0;
        votantes = new Set();
        return {
            equipo: equipoGanador,
            perdedor,
            seleccion,
            opciones: opcionesFinal,
            votos: votosFinal
        };
    };

    const prepararEstadoAbierto = (equipoDestino, opcionesEntrada, duracionEntrada) => {
        votos = opcionesEntrada.reduce((acc, opcion) => {
            acc[opcion] = 0;
            return acc;
        }, {});
        activa = true;
        equipo = equipoDestino;
        opciones = [...opcionesEntrada];
        duracionMs = Math.max(0, Number(duracionEntrada) || 0);
        terminaEnTs = duracionMs > 0 ? Date.now() + duracionMs : 0;
        votantes = new Set();
        io.emit(`elegir_ventaja_${equipoDestino}`, {
            opciones: [...opcionesEntrada],
            equipo: equipoDestino,
            duracion_ms: duracionMs,
            tiempo_restante_ms: duracionMs,
            termina_en_ts: terminaEnTs
        });
        emitirEstado();
    };

    const abrirForzada = (payload = {}) => {
        if (typeof cancelTimer === "function") {
            cancelTimer();
        }
        const equipoId = obtenerIdJugadorValido(payload.team || payload.equipo);
        if (!equipoId) {
            return null;
        }
        const equipoDestino = `j${equipoId}`;
        const opcionesEntrada = Array.isArray(payload.opciones) ? payload.opciones : [];
        const opcionesNormalizadas = opcionesEntrada
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .slice(0, 3);
        if (!opcionesNormalizadas.length) {
            opcionesNormalizadas.push(...OPCIONES_VENTAJA_BASE.slice(0, 3));
        }
        prepararEstadoAbierto(
            equipoDestino,
            opcionesNormalizadas,
            Math.max(0, Number(payload.duracion_ms) || Number(getDuracionMs()) || 0)
        );
        if (duracionMs > 0 && typeof scheduleTimer === "function") {
            scheduleTimer(() => {
                cerrarConSeleccion({ emitir_resultado: payload.emitir_resultado !== false });
            }, duracionMs);
        }
        return construirPayloadEstado();
    };

    const elegirOpcionesAleatorias = () => {
        const emojis = [...OPCIONES_VENTAJA_BASE];
        for (let i = emojis.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [emojis[i], emojis[j]] = [emojis[j], emojis[i]];
        }
        return emojis.slice(0, 3);
    };

    const lanzar = ({ socket = null, ganador, perdedor, onCierreAutomatico = null } = {}) => {
        const opcionesSeleccionadas = elegirOpcionesAleatorias();
        prepararEstadoAbierto(ganador, opcionesSeleccionadas, Math.max(0, Number(getDuracionMs()) || 0));
        if (typeof scheduleTimer === "function") {
            scheduleTimer(() => {
                if (socket && typeof socket.removeAllListeners === "function") {
                    socket.removeAllListeners("enviar_voto_ventaja");
                }
                const seleccion = escogerGanador(votos);
                io.emit(`enviar_ventaja_${perdedor}`, seleccion);
                const opcionesFinal = Array.isArray(opciones) ? [...opciones] : [];
                const votosFinal = { ...votos };
                activa = false;
                terminaEnTs = 0;
                emitirEstado({
                    activa: false,
                    equipo,
                    opciones: opcionesFinal,
                    votos: votosFinal,
                    tiempo_restante_ms: 0,
                    termina_en_ts: 0
                });
                equipo = "";
                opciones = [];
                duracionMs = 0;
                votantes = new Set();
                if (typeof onCierreAutomatico === "function") {
                    onCierreAutomatico({ seleccion, opciones: opcionesFinal, votos: votosFinal });
                }
            }, duracionMs);
        }
        return construirPayloadEstado();
    };

    const registrarVoto = (socket, payload = {}) => {
        const data = (payload && typeof payload === "object") ? payload : { voto: payload };
        const clave = typeof data.voto === "string" ? data.voto : "";
        if (!activa || !Object.prototype.hasOwnProperty.call(votos, clave)) {
            return false;
        }
        const equipoMusa = obtenerIdJugadorValido(socket.musa);
        if (!equipoMusa || equipo !== `j${equipoMusa}`) {
            return false;
        }
        const musaClientId = normalizarMusaClientId(data.client_id);
        if (musaClientId && !socket.musa_client_id) {
            socket.musa_client_id = musaClientId;
        }
        const claveVotante = obtenerClaveVotante(socket, musaClientId);
        if (claveVotante && votantes.has(claveVotante)) {
            emitirEstado(null, socket);
            return false;
        }
        if (claveVotante) {
            votantes.add(claveVotante);
        }
        votos[clave] += 1;
        emitirEstado();
        return true;
    };

    const reset = () => {
        resetEstado();
        return construirPayloadEstado();
    };

    return {
        abrirForzada,
        cerrarForzada: cerrarConSeleccion,
        construirPayloadEstado,
        emitirEstado,
        lanzar,
        registrarVoto,
        reset,
        snapshotVotos: () => ({ ...votos })
    };
}

module.exports = {
    crearEstadoVotosVentaja,
    crearGestorVotacionVentaja,
    normalizarMusaClientId
};
