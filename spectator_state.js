const MODOS_VISTA_ESPECTADOR = new Set(["partida", "stats", "nube_inspiracion", "creditos"]);
const ESCALA_UI_ESPECTADOR_MIN = 0.82;
const ESCALA_UI_ESPECTADOR_MAX = 1.28;
const ESCALA_UI_ESPECTADOR_DEFAULT = 1;
const ESCALA_UI_ESPECTADOR_PASO = 0.06;

const clampNumber = (valor, min, max) => Math.min(Math.max(valor, min), max);

function crearGestorVistaEspectador({ io, isCalentamientoVisible = () => false }) {
    let override = "partida";
    let statsSlideStep = 0;
    let escalaUi = ESCALA_UI_ESPECTADOR_DEFAULT;

    const normalizarModo = (valor) => {
        const modo = typeof valor === "string" ? valor.trim().toLowerCase() : "";
        return MODOS_VISTA_ESPECTADOR.has(modo) ? modo : "partida";
    };

    const normalizarEscala = (valor, fallback = ESCALA_UI_ESPECTADOR_DEFAULT) => {
        const numero = Number(valor);
        if (!Number.isFinite(numero)) {
            return fallback;
        }
        return clampNumber(numero, ESCALA_UI_ESPECTADOR_MIN, ESCALA_UI_ESPECTADOR_MAX);
    };

    const normalizarPasoSlideStats = (valor) => {
        const numero = Number(valor);
        return Number.isFinite(numero) ? Math.trunc(numero) : 0;
    };

    const resolverModo = () => {
        const modoOverride = normalizarModo(override);
        if (modoOverride === "stats" || modoOverride === "nube_inspiracion" || modoOverride === "creditos") {
            return modoOverride;
        }
        return isCalentamientoVisible() ? "calentamiento" : "partida";
    };

    const payload = () => ({
        modo: resolverModo(),
        override: normalizarModo(override),
        calentamiento_vista: Boolean(isCalentamientoVisible()),
        stats_slide_step: normalizarPasoSlideStats(statsSlideStep),
        escala_ui: normalizarEscala(escalaUi),
        ts: Date.now()
    });

    const emitir = (socketDestino = null) => {
        const salida = payload();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("vista_espectador_modo", salida);
            return salida;
        }
        io.emit("vista_espectador_modo", salida);
        return salida;
    };

    const cambiarModo = (valor) => {
        override = normalizarModo(valor);
        statsSlideStep = 0;
        return override;
    };

    const navegarStats = (direccion) => {
        statsSlideStep = normalizarPasoSlideStats(statsSlideStep + direccion);
        return statsSlideStep;
    };

    const ajustarEscala = (payloadEscala = {}) => {
        const accion = typeof payloadEscala?.accion === "string"
            ? payloadEscala.accion.trim().toLowerCase()
            : "";
        const escalaActual = normalizarEscala(escalaUi);
        if (accion === "reset") {
            escalaUi = ESCALA_UI_ESPECTADOR_DEFAULT;
        } else if (accion === "down") {
            escalaUi = normalizarEscala(escalaActual - ESCALA_UI_ESPECTADOR_PASO, escalaActual);
        } else if (accion === "up") {
            escalaUi = normalizarEscala(escalaActual + ESCALA_UI_ESPECTADOR_PASO, escalaActual);
        } else if (Object.prototype.hasOwnProperty.call(payloadEscala || {}, "valor")) {
            escalaUi = normalizarEscala(payloadEscala.valor, escalaActual);
        }
        return escalaUi;
    };

    const reset = () => {
        override = "partida";
        statsSlideStep = 0;
        escalaUi = ESCALA_UI_ESPECTADOR_DEFAULT;
        return payload();
    };

    return {
        ajustarEscala,
        cambiarModo,
        emitir,
        getOverride: () => normalizarModo(override),
        navegarStats,
        normalizarModo,
        payload,
        resolverModo,
        reset
    };
}

module.exports = {
    crearGestorVistaEspectador,
    ESCALA_UI_ESPECTADOR_DEFAULT,
    ESCALA_UI_ESPECTADOR_MAX
};
