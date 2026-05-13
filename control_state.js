const MODOS_CONTROL_DISPONIBLES = Object.freeze([
    "letra bendita",
    "letra prohibida",
    "tertulia",
    "palabras bonus",
    "palabras prohibidas",
    "frase final"
]);

const PARAMETROS_CONTROL_DEFECTO = Object.freeze({
    tiempo_modificador: 60,
    tiempo_votacion: 30,
    tiempo_modos: 300,
    tiempo_minutos: 5,
    tiempo_segundos: 0,
    tiempo_cambio_letra: 60,
    tiempo_cambio_palabras: 20,
    limite_tiempo_inspiracion: 30,
    escala_espectador: 100
});

const LIMITES_PARAMETROS_CONTROL = Object.freeze({
    tiempo_modificador: [1, 360],
    tiempo_votacion: [1, 360],
    tiempo_modos: [1, 3600],
    tiempo_minutos: [0, 59],
    tiempo_segundos: [0, 55],
    tiempo_cambio_letra: [1, 360],
    tiempo_cambio_palabras: [1, 360],
    limite_tiempo_inspiracion: [5, 120],
    escala_espectador: [82, 128]
});

const crearEstadoControlBase = () => ({
    borrar_texto: false,
    frases_finales: { 1: "", 2: "" },
    parametros: { ...PARAMETROS_CONTROL_DEFECTO },
    modos: [...MODOS_CONTROL_DISPONIBLES],
    nombres: {
        1: "ESCRITXR 1",
        2: "ESCRITXR 2"
    },
    revision: 0,
    ts: 0
});

const limitarNumeroControl = (valor, fallback, min, max) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(numero)));
};

const normalizarTextoControl = (valor, max = 180) => String(valor ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);

const normalizarParametrosControl = (entrada = {}, previos = PARAMETROS_CONTROL_DEFECTO) => {
    const data = entrada && typeof entrada === "object" ? entrada : {};
    const salida = { ...previos };
    Object.entries(PARAMETROS_CONTROL_DEFECTO).forEach(([clave, defecto]) => {
        if (!Object.prototype.hasOwnProperty.call(data, clave)) return;
        const [min, max] = LIMITES_PARAMETROS_CONTROL[clave] || [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
        salida[clave] = limitarNumeroControl(data[clave], salida[clave] ?? defecto, min, max);
    });
    return salida;
};

const normalizarModosControl = (entrada = [], fallback = MODOS_CONTROL_DISPONIBLES) => {
    if (!Array.isArray(entrada)) return [...fallback];
    return entrada
        .map((modo) => String(modo || "").trim().toLowerCase())
        .filter((modo) => MODOS_CONTROL_DISPONIBLES.includes(modo));
};

const normalizarFrasesFinalesControl = (entrada = {}, previas = {}) => {
    const data = entrada && typeof entrada === "object" ? entrada : {};
    return {
        1: Object.prototype.hasOwnProperty.call(data, 1)
            ? normalizarTextoControl(data[1], 220)
            : normalizarTextoControl(previas[1], 220),
        2: Object.prototype.hasOwnProperty.call(data, 2)
            ? normalizarTextoControl(data[2], 220)
            : normalizarTextoControl(previas[2], 220)
    };
};

const normalizarNombresControl = (entrada = {}, previos = {}) => {
    const data = entrada && typeof entrada === "object" ? entrada : {};
    return {
        1: Object.prototype.hasOwnProperty.call(data, 1)
            ? (normalizarTextoControl(data[1], 80).toUpperCase() || "ESCRITXR 1")
            : (normalizarTextoControl(previos[1], 80).toUpperCase() || "ESCRITXR 1"),
        2: Object.prototype.hasOwnProperty.call(data, 2)
            ? (normalizarTextoControl(data[2], 80).toUpperCase() || "ESCRITXR 2")
            : (normalizarTextoControl(previos[2], 80).toUpperCase() || "ESCRITXR 2")
    };
};

function crearGestorEstadoControl({ io } = {}) {
    let estado = crearEstadoControlBase();

    const snapshot = () => ({
        borrar_texto: Boolean(estado.borrar_texto),
        frases_finales: { ...estado.frases_finales },
        parametros: { ...estado.parametros },
        modos: [...estado.modos],
        nombres: { ...estado.nombres },
        revision: Number(estado.revision) || 0,
        ts: Number(estado.ts) || 0
    });

    const emitir = (socketDestino = null) => {
        const payload = snapshot();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("control_estado", payload);
            return payload;
        }
        if (io && typeof io.emit === "function") {
            io.emit("control_estado", payload);
        }
        return payload;
    };

    const actualizar = (payload = {}) => {
        const data = payload && typeof payload === "object" ? payload : {};
        if (Object.prototype.hasOwnProperty.call(data, "borrar_texto")) {
            estado.borrar_texto = data.borrar_texto === true;
        }
        if (Object.prototype.hasOwnProperty.call(data, "frases_finales")) {
            estado.frases_finales = normalizarFrasesFinalesControl(data.frases_finales, estado.frases_finales);
        }
        if (Object.prototype.hasOwnProperty.call(data, "parametros")) {
            estado.parametros = normalizarParametrosControl(data.parametros, estado.parametros);
        }
        if (Object.prototype.hasOwnProperty.call(data, "modos")) {
            estado.modos = normalizarModosControl(data.modos, estado.modos);
        }
        if (Object.prototype.hasOwnProperty.call(data, "nombres")) {
            estado.nombres = normalizarNombresControl(data.nombres, estado.nombres);
        }
        estado.revision += 1;
        estado.ts = Date.now();
        return snapshot();
    };

    const reset = () => {
        estado = crearEstadoControlBase();
        return snapshot();
    };

    return {
        actualizar,
        emitir,
        reset,
        snapshot
    };
}

module.exports = {
    MODOS_CONTROL_DISPONIBLES,
    PARAMETROS_CONTROL_DEFECTO,
    crearGestorEstadoControl,
    normalizarModosControl,
    normalizarParametrosControl
};
