const {
    crearJugadorStatsLiveVacio,
    normalizarPayloadStatsLive
} = require('./server_state_utils');

function crearGestorStatsLive({ io, getModoActual = () => "" } = {}) {
    const normalizar = (payload = {}) => normalizarPayloadStatsLive(payload, {
        modoActual: getModoActual(),
        now: Date.now()
    });

    let estado = normalizar({});
    let datosRecibidos = { 1: false, 2: false };
    let datosServidorTexto = { 1: false, 2: false };
    let datosServidorPulsacion = { 1: false, 2: false };
    let datosServidorReglas = { 1: false, 2: false };
    let inicioTs = 0;
    let ultimoEmitTs = 0;
    let timerEmit = null;
    const heatmaps = { 1: new Map(), 2: new Map() };
    const STATS_EMIT_MIN_MS = 250;

    const tokenizar = (texto = "") => String(texto || "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}]|['’\u2010-\u2015-](?=[\p{L}\p{N}]))*/gu) || [];

    const numeroDesdeMarcador = (valor, fallback = 0) => {
        const match = String(valor ?? "").match(/-?\d+(?:[.,]\d+)?/);
        if (!match) return fallback;
        const numero = Number(match[0].replace(",", "."));
        return Number.isFinite(numero) ? Math.max(0, numero) : fallback;
    };

    const decodificarHtmlBasico = (texto = "") => String(texto || "")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");

    const extraerResumenInspiracion = (html = "") => {
        const palabras = new Set();
        let valor = 0;
        const patron = /<span\b([^>]*)class=["']([^"']*\b(?:palabra-bendita|palabra-bendita-musa|palabra-musa)\b[^"']*)["']([^>]*)>([\s\S]*?)<\/span>/gi;
        let match;
        let elementos = 0;
        while ((match = patron.exec(String(html || ""))) && elementos < 64) {
            elementos += 1;
            const atributos = `${match[1] || ""} ${match[3] || ""}`;
            const valorMatch = atributos.match(/\bdata-inspiration-value\s*=\s*["']([^"']*)["']/i);
            const numero = valorMatch
                ? Number(String(valorMatch[1] || "").trim().replace(",", "."))
                : 1;
            valor += Number.isFinite(numero) ? Math.min(1, Math.max(0, numero)) : 1;

            const texto = decodificarHtmlBasico(match[4])
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            texto.split(/\s+/).forEach((token) => {
                const limpio = token
                    .replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, "")
                    .trim();
                if (limpio && palabras.size < 64) palabras.add(limpio.toLocaleUpperCase());
            });
        }
        return {
            palabras: Array.from(palabras).sort(),
            valor: Math.round((valor + Number.EPSILON) * 100) / 100
        };
    };

    const socketsConectados = () => {
        const registro = io && io.sockets && io.sockets.sockets;
        if (!registro) return [];
        if (typeof registro.values === "function") return Array.from(registro.values());
        return Object.values(registro);
    };

    const esConsumidorStats = (socket) => {
        if (!socket) return false;
        if (
            socket.espectador
            || socket.jurado
            || socket.dramaturgia
            || socket.control
            || (socket.monitor_pantalla && ["espectador", "jurado", "control"].includes(socket.monitor_pantalla.rol))
        ) return true;
        const tieneRolSinStats = Boolean(
            socket.escritxr
            || socket.musa
            || socket.actor
            || socket.tecnico
            || socket.monitor_pantalla
        );
        return !tieneRolSinStats;
    };

    const payload = () => ({
        ts: estado.ts || Date.now(),
        modo_actual: estado.modo_actual || "",
        players: {
            1: { ...(estado.players && estado.players[1] ? estado.players[1] : crearJugadorStatsLiveVacio(1)) },
            2: { ...(estado.players && estado.players[2] ? estado.players[2] : crearJugadorStatsLiveVacio(2)) }
        }
    });

    const actualizar = (entrada = {}) => {
        estado = normalizar(entrada);
        return payload();
    };

    const actualizarDesdeControl = (entrada = {}) => {
        const players = entrada && entrada.players && typeof entrada.players === "object"
            ? entrada.players
            : {};
        [1, 2].forEach((player) => {
            if (
                Object.prototype.hasOwnProperty.call(players, player)
                && players[player]
                && typeof players[player] === "object"
            ) {
                datosRecibidos[player] = true;
            }
        });
        const combinados = {};
        [1, 2].forEach((player) => {
            const actual = estado.players[player] || crearJugadorStatsLiveVacio(player);
            const control = players[player] && typeof players[player] === "object" ? players[player] : {};
            const mezcla = { ...actual, ...control };
            if (datosServidorTexto[player]) {
                ["nombre", "palabrasTotal", "palabrasUnicas", "palabrasBenditas", "valorInspiracion"].forEach((clave) => {
                    mezcla[clave] = actual[clave];
                });
            }
            if (datosServidorPulsacion[player]) {
                ["pulsacionesTotal", "teclasDistintas", "topTeclas", "heatmap", "ritmoPpm"].forEach((clave) => {
                    mezcla[clave] = actual[clave];
                });
            }
            if (datosServidorReglas[player]) {
                [
                    "letrasBenditas",
                    "letrasMalditas",
                    "palabrasMalditas",
                    "intentosLetraProhibida",
                    "intentosPalabraProhibida"
                ].forEach((clave) => {
                    mezcla[clave] = actual[clave];
                });
            }
            combinados[player] = mezcla;
        });
        return actualizar({ ...entrada, players: combinados });
    };

    const reset = () => {
        datosRecibidos = { 1: false, 2: false };
        datosServidorTexto = { 1: false, 2: false };
        datosServidorPulsacion = { 1: false, 2: false };
        datosServidorReglas = { 1: false, 2: false };
        inicioTs = 0;
        heatmaps[1].clear();
        heatmaps[2].clear();
        if (timerEmit) clearTimeout(timerEmit);
        timerEmit = null;
        return actualizar({ modo_actual: "" });
    };

    const payloadDatosRecibidos = () => ({ ...datosRecibidos });

    const emitir = (socketDestino = null) => {
        const salida = payload();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("stats_live_estado", salida);
            return salida;
        }
        const destinos = socketsConectados();
        if (destinos.length) {
            destinos.filter(esConsumidorStats).forEach((destino) => destino.emit("stats_live_estado", salida));
        } else if (io && typeof io.emit === "function") {
            io.emit("stats_live_estado", salida);
        }
        ultimoEmitTs = Date.now();
        return salida;
    };

    const programarEmision = ({ inmediata = false } = {}) => {
        const espera = inmediata ? 0 : Math.max(0, STATS_EMIT_MIN_MS - (Date.now() - ultimoEmitTs));
        if (espera === 0) {
            if (timerEmit) clearTimeout(timerEmit);
            timerEmit = null;
            emitir();
            return;
        }
        if (timerEmit) return;
        timerEmit = setTimeout(() => {
            timerEmit = null;
            emitir();
        }, espera);
        if (typeof timerEmit.unref === "function") timerEmit.unref();
    };

    const registrarTexto = (player, entrada = {}) => {
        const id = Number(player);
        if (id !== 1 && id !== 2) return payload();
        datosServidorTexto[id] = true;
        if (!inicioTs) inicioTs = Date.now();
        const plano = typeof entrada.plano === "string" ? entrada.plano : "";
        const html = typeof entrada.html === "string" ? entrada.html : "";
        const palabras = tokenizar(plano);
        const actual = estado.players && estado.players[id] ? estado.players[id] : crearJugadorStatsLiveVacio(id);
        const pulsacionesTotal = Math.max(0, Number(actual.pulsacionesTotal) || 0);
        const tiempoTotalMs = Math.max(0, Number(actual.tiempoTotalMs) || 0);
        const tiempoEscrituraMs = Math.max(0, Number(actual.tiempoEscrituraMs) || 0);
        const resumenInspiracion = extraerResumenInspiracion(html);
        estado = normalizar({
            ...estado,
            modo_actual: getModoActual(),
            players: {
                ...estado.players,
                [id]: {
                    ...actual,
                    nombre: entrada.nombre || actual.nombre,
                    palabrasTotal: numeroDesdeMarcador(entrada.points, palabras.length),
                    palabrasUnicas: new Set(palabras).size,
                    palabrasBenditas: resumenInspiracion.palabras,
                    valorInspiracion: resumenInspiracion.valor,
                    tiempoTotalMs,
                    tiempoEscrituraMs,
                    ritmoPpm: tiempoEscrituraMs > 0
                        ? Math.round(pulsacionesTotal / Math.max(tiempoEscrituraMs / 60000, 0.001))
                        : 0
                }
            }
        });
        programarEmision();
        return payload();
    };

    const registrarNombre = (player, nombre) => {
        const id = Number(player);
        if (id !== 1 && id !== 2) return payload();
        const actual = estado.players[id] || crearJugadorStatsLiveVacio(id);
        estado = normalizar({
            ...estado,
            players: { ...estado.players, [id]: { ...actual, nombre } }
        });
        programarEmision();
        return payload();
    };

    const registrarPulsacion = (player, entrada = {}) => {
        const id = Number(player);
        const code = String(entrada && entrada.code || "").trim().slice(0, 24);
        if ((id !== 1 && id !== 2) || !code) return payload();
        datosServidorPulsacion[id] = true;
        if (!inicioTs) inicioTs = Date.now();
        heatmaps[id].set(code, (heatmaps[id].get(code) || 0) + 1);
        const heatmap = Object.fromEntries(heatmaps[id]);
        const topTeclas = Array.from(heatmaps[id], ([codigo, count]) => ({ code: codigo, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
        const pulsacionesTotal = Array.from(heatmaps[id].values()).reduce((total, count) => total + count, 0);
        const actual = estado.players[id] || crearJugadorStatsLiveVacio(id);
        const tiempoTotalMs = Math.max(0, Date.now() - inicioTs);
        const tiempoEscrituraMs = Math.max(1, tiempoTotalMs);
        estado = normalizar({
            ...estado,
            modo_actual: getModoActual(),
            players: {
                ...estado.players,
                [id]: {
                    ...actual,
                    heatmap,
                    topTeclas,
                    pulsacionesTotal,
                    teclasDistintas: heatmaps[id].size,
                    tiempoTotalMs,
                    tiempoEscrituraMs,
                    ritmoPpm: Math.round(pulsacionesTotal / Math.max(tiempoEscrituraMs / 60000, 0.001))
                }
            }
        });
        programarEmision();
        return payload();
    };

    const registrarLetra = (tipo, letra) => {
        const clave = String(tipo || "").toLowerCase() === "bendita"
            ? "letrasBenditas"
            : (String(tipo || "").toLowerCase() === "prohibida" ? "letrasMalditas" : "");
        const valor = String(letra || "").trim().toLocaleUpperCase("es-ES").slice(0, 8);
        if (!clave || !valor) return payload();
        const players = { ...estado.players };
        [1, 2].forEach((id) => {
            datosServidorReglas[id] = true;
            const actual = players[id] || crearJugadorStatsLiveVacio(id);
            players[id] = {
                ...actual,
                [clave]: Array.from(new Set([...(actual[clave] || []), valor])).slice(0, 26)
            };
        });
        estado = normalizar({ ...estado, modo_actual: getModoActual(), players });
        programarEmision();
        return payload();
    };

    const registrarInfraccion = (player, entrada = {}) => {
        const id = Number(player);
        const tipo = String(entrada && entrada.tipo || "").toLowerCase();
        if ((id !== 1 && id !== 2) || (tipo !== "letra" && tipo !== "palabra")) return payload();
        datosServidorReglas[id] = true;
        const actual = estado.players[id] || crearJugadorStatsLiveVacio(id);
        const valor = String(entrada && entrada.valor || "").trim().toLocaleUpperCase("es-ES").slice(0, 26);
        const cambios = tipo === "letra"
            ? { intentosLetraProhibida: (Number(actual.intentosLetraProhibida) || 0) + 1 }
            : {
                intentosPalabraProhibida: (Number(actual.intentosPalabraProhibida) || 0) + 1,
                palabrasMalditas: valor
                    ? Array.from(new Set([...(actual.palabrasMalditas || []), valor])).slice(0, 48)
                    : [...(actual.palabrasMalditas || [])]
            };
        estado = normalizar({
            ...estado,
            modo_actual: getModoActual(),
            players: { ...estado.players, [id]: { ...actual, ...cambios } }
        });
        programarEmision();
        return payload();
    };

    const restaurar = (snapshot = {}) => {
        estado = normalizar(snapshot);
        [1, 2].forEach((id) => {
            heatmaps[id].clear();
            Object.entries(estado.players[id].heatmap || {}).forEach(([code, count]) => {
                heatmaps[id].set(code, Math.max(0, Number(count) || 0));
            });
            // El checkpoint ya es la fotografía combinada y validada del
            // servidor. Tras reiniciar, Control no debe poder degradarla con
            // una copia local antigua mientras se resincronizan los textos.
            datosServidorTexto[id] = true;
            datosServidorPulsacion[id] = heatmaps[id].size > 0;
            datosServidorReglas[id] = true;
        });
        const maxTiempo = Math.max(
            Number(estado.players[1].tiempoTotalMs) || 0,
            Number(estado.players[2].tiempoTotalMs) || 0
        );
        inicioTs = maxTiempo > 0 ? Date.now() - maxTiempo : 0;
        return payload();
    };

    return {
        actualizar,
        actualizarDesdeControl,
        emitir,
        payload,
        payloadDatosRecibidos,
        programarEmision,
        registrarNombre,
        registrarInfraccion,
        registrarLetra,
        registrarPulsacion,
        registrarTexto,
        restaurar,
        reset
    };
}

module.exports = {
    crearGestorStatsLive
};
