const { recortarTextoStatsLive } = require('./server_state_utils');

const MAX_PALABRAS_NUBE_INSPIRACION = 120;

const crearUltimasInspiracionesVacias = () => ({
    1: null,
    2: null
});

const normalizarClavePalabraNubeInspiracion = (palabra) => {
    const texto = String(palabra || "").trim().toLowerCase();
    return texto.normalize ? texto.normalize("NFC") : texto;
};

const extraerItemPalabraNubeInspiracion = (item) => {
    const palabra = typeof item === "string"
        ? item.trim()
        : (item && typeof item.palabra === "string" ? item.palabra.trim() : "");
    if (!palabra) return null;
    const musa = item && typeof item === "object" && typeof item.musa === "string"
        ? item.musa.trim()
        : "";
    const client_id = item && typeof item === "object" && typeof item.client_id === "string"
        ? item.client_id.trim()
        : (item && typeof item === "object" && typeof item.clientId === "string" ? item.clientId.trim() : "");
    const salida = { palabra, musa };
    if (client_id) salida.client_id = client_id;
    return salida;
};

const identidadMusaNubeInspiracion = (item, index = 0) => {
    if (!item || typeof item !== "object") return `anon:${index}`;
    if (item.client_id) return `client:${item.client_id}`;
    if (item.musa) return `name:${String(item.musa).trim().toLowerCase()}`;
    return `anon:${index}`;
};

const extraerPalabrasInfoNubeInspiracion = (cola = [], limite = MAX_PALABRAS_NUBE_INSPIRACION, opciones = {}) => {
    const lista = Array.isArray(cola) ? cola : [];
    const inicio = Math.max(0, lista.length - limite);
    const grupos = new Map();
    const detectarSuperbonus = opciones && opciones.detectarSuperbonus === true;
    for (let i = inicio; i < lista.length; i += 1) {
        const item = extraerItemPalabraNubeInspiracion(lista[i]);
        if (!item) continue;
        const clave = normalizarClavePalabraNubeInspiracion(item.palabra);
        if (!clave) continue;
        if (!grupos.has(clave)) {
            grupos.set(clave, {
                palabra: item.palabra,
                musas: [],
                identidades: new Set(),
                primerIndice: i
            });
        }
        const grupo = grupos.get(clave);
        grupo.identidades.add(identidadMusaNubeInspiracion(item, i));
        if (item.musa && !grupo.musas.includes(item.musa)) {
            grupo.musas.push(item.musa);
        }
    }
    return Array.from(grupos.values())
        .sort((a, b) => a.primerIndice - b.primerIndice)
        .map((grupo) => ({
            palabra: grupo.palabra,
            repeticiones: grupo.identidades.size || 1,
            superbonus: Boolean(detectarSuperbonus && (grupo.identidades.size || 1) >= 2),
            musas: grupo.musas.slice(0, 6)
        }))
        .slice(-limite);
};

const extraerPalabrasNubeInspiracion = (cola = [], limite = MAX_PALABRAS_NUBE_INSPIRACION, opciones = {}) => {
    return extraerPalabrasInfoNubeInspiracion(cola, limite, opciones).map((item) => item.palabra);
};

function crearGestorNubeInspiracion({
    io,
    getModoActual = () => "",
    getNombreEquipo = (equipo) => `ESCRITXR ${equipo}`,
    getMotores = () => ({})
} = {}) {
    let firma = "";
    let ultimasInspiraciones = crearUltimasInspiracionesVacias();
    let intervaloEstado = null;

    const obtenerPalabrasPorEquipo = () => {
        const modoActual = getModoActual();
        const motores = getMotores() || {};
        let palabrasJ1 = [];
        let palabrasJ2 = [];

        if (modoActual === "palabras prohibidas" && motores.malditas && motores.malditas.players) {
            palabrasJ1 = extraerPalabrasInfoNubeInspiracion(motores.malditas.players[2] && motores.malditas.players[2].queue);
            palabrasJ2 = extraerPalabrasInfoNubeInspiracion(motores.malditas.players[1] && motores.malditas.players[1].queue);
            return { 1: palabrasJ1, 2: palabrasJ2 };
        }

        const motor = modoActual === "palabras bonus" ? motores.bonus : motores.musas;
        if (motor && motor.players) {
            const detectarSuperbonus = modoActual === "palabras bonus";
            palabrasJ1 = extraerPalabrasInfoNubeInspiracion(motor.players[1] && motor.players[1].queue, MAX_PALABRAS_NUBE_INSPIRACION, { detectarSuperbonus });
            palabrasJ2 = extraerPalabrasInfoNubeInspiracion(motor.players[2] && motor.players[2].queue, MAX_PALABRAS_NUBE_INSPIRACION, { detectarSuperbonus });
        }
        return { 1: palabrasJ1, 2: palabrasJ2 };
    };

    const construirEquipoPayload = (equipo, palabrasInfo) => {
        const info = Array.isArray(palabrasInfo) ? palabrasInfo : [];
        return {
            nombre: recortarTextoStatsLive(getNombreEquipo(equipo) || `ESCRITXR ${equipo}`, 28) || `ESCRITXR ${equipo}`,
            palabras: info.map((item) => item.palabra),
            palabras_info: info.map((item) => ({
                palabra: item.palabra,
                repeticiones: Math.max(1, Number(item.repeticiones) || 1),
                superbonus: Boolean(item.superbonus),
                musas: Array.isArray(item.musas) ? item.musas : []
            }))
        };
    };

    const payload = () => {
        const modoActual = getModoActual();
        const palabras = obtenerPalabrasPorEquipo();
        return {
            ts: Date.now(),
            modo_actual: recortarTextoStatsLive(modoActual || "", 32),
            equipos: {
                1: construirEquipoPayload(1, palabras[1]),
                2: construirEquipoPayload(2, palabras[2])
            }
        };
    };

    const construirFirma = (estado) => JSON.stringify({
        modo: estado.modo_actual,
        j1: estado.equipos[1].palabras,
        j1_info: estado.equipos[1].palabras_info || [],
        j2: estado.equipos[2].palabras,
        j2_info: estado.equipos[2].palabras_info || []
    });

    const emitir = (socketDestino = null, forzar = false) => {
        const salida = payload();
        const firmaActual = construirFirma(salida);
        if (!socketDestino && !forzar && firmaActual === firma) {
            return salida;
        }
        firma = firmaActual;
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("nube_inspiracion_estado", salida);
            return salida;
        }
        if (io && typeof io.emit === "function") {
            io.emit("nube_inspiracion_estado", salida);
        }
        return salida;
    };

    const registrarInspiracion = (equipo, payloadInspiracion = {}) => {
        const id = Number(equipo);
        if (id !== 1 && id !== 2) return null;
        const palabra = typeof payloadInspiracion.palabra === "string" ? payloadInspiracion.palabra.trim() : "";
        if (!palabra) return null;
        const musa = typeof payloadInspiracion.musa === "string" ? payloadInspiracion.musa.trim() : "";
        const salida = {
            palabra,
            musa,
            modo_actual: recortarTextoStatsLive(payloadInspiracion.modo_actual || getModoActual() || "", 32),
            ts: Date.now()
        };
        ultimasInspiraciones[id] = salida;
        return { ...salida };
    };

    const payloadUltimas = () => ({
        1: ultimasInspiraciones[1] ? { ...ultimasInspiraciones[1] } : null,
        2: ultimasInspiraciones[2] ? { ...ultimasInspiraciones[2] } : null
    });

    const snapshot = () => ({
        nube: payload(),
        ultimas: payloadUltimas()
    });

    const reset = () => {
        firma = "";
        ultimasInspiraciones = crearUltimasInspiracionesVacias();
    };

    const iniciarIntervalo = (intervaloMs = 1000) => {
        if (intervaloEstado) return intervaloEstado;
        intervaloEstado = setInterval(() => {
            emitir();
        }, intervaloMs);
        if (typeof intervaloEstado.unref === "function") {
            intervaloEstado.unref();
        }
        return intervaloEstado;
    };

    return {
        emitir,
        iniciarIntervalo,
        payload,
        payloadUltimas,
        registrarInspiracion,
        reset,
        snapshot
    };
}

module.exports = {
    MAX_PALABRAS_NUBE_INSPIRACION,
    crearGestorNubeInspiracion,
    extraerPalabrasInfoNubeInspiracion,
    extraerPalabrasNubeInspiracion
};
