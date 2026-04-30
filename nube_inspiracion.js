const { recortarTextoStatsLive } = require('./server_state_utils');

const MAX_PALABRAS_NUBE_INSPIRACION = 120;

const crearUltimasInspiracionesVacias = () => ({
    1: null,
    2: null
});

const extraerPalabrasNubeInspiracion = (cola = [], limite = MAX_PALABRAS_NUBE_INSPIRACION) => {
    const lista = Array.isArray(cola) ? cola : [];
    const inicio = Math.max(0, lista.length - limite);
    const salida = [];
    const vistos = new Set();
    for (let i = inicio; i < lista.length; i += 1) {
        const item = lista[i];
        const palabra = typeof item === 'string'
            ? item.trim()
            : (item && typeof item.palabra === 'string' ? item.palabra.trim() : '');
        if (!palabra) continue;
        const clave = palabra.toLowerCase();
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        salida.push(palabra);
    }
    return salida.slice(-limite);
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
            palabrasJ1 = extraerPalabrasNubeInspiracion(motores.malditas.players[2] && motores.malditas.players[2].queue);
            palabrasJ2 = extraerPalabrasNubeInspiracion(motores.malditas.players[1] && motores.malditas.players[1].queue);
            return { 1: palabrasJ1, 2: palabrasJ2 };
        }

        const motor = modoActual === "palabras bonus" ? motores.bonus : motores.musas;
        if (motor && motor.players) {
            palabrasJ1 = extraerPalabrasNubeInspiracion(motor.players[1] && motor.players[1].queue);
            palabrasJ2 = extraerPalabrasNubeInspiracion(motor.players[2] && motor.players[2].queue);
        }
        return { 1: palabrasJ1, 2: palabrasJ2 };
    };

    const payload = () => {
        const modoActual = getModoActual();
        const palabras = obtenerPalabrasPorEquipo();
        return {
            ts: Date.now(),
            modo_actual: recortarTextoStatsLive(modoActual || "", 32),
            equipos: {
                1: {
                    nombre: recortarTextoStatsLive(getNombreEquipo(1) || "ESCRITXR 1", 28) || "ESCRITXR 1",
                    palabras: palabras[1]
                },
                2: {
                    nombre: recortarTextoStatsLive(getNombreEquipo(2) || "ESCRITXR 2", 28) || "ESCRITXR 2",
                    palabras: palabras[2]
                }
            }
        };
    };

    const construirFirma = (estado) => JSON.stringify({
        modo: estado.modo_actual,
        j1: estado.equipos[1].palabras,
        j2: estado.equipos[2].palabras
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
    extraerPalabrasNubeInspiracion
};
