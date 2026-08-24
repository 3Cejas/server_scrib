const PUNTUACION_SCHEMA_VERSION = 1;
const PUNTUACION_FORMULA_VERSION = "scrib-puntuacion-v2";

const CATEGORIAS_PUNTUACION = Object.freeze([
    Object.freeze({
        id: "produccion",
        etiqueta: "Producci\u00f3n",
        peso: 20,
        unidad: "palabras",
        mejor: "mayor",
        explicacion: "Compara el total de palabras escritas."
    }),
    Object.freeze({
        id: "ritmo",
        etiqueta: "Ritmo",
        peso: 15,
        unidad: "pulsaciones/min",
        mejor: "mayor",
        explicacion: "Compara las pulsaciones por minuto durante el tiempo de escritura."
    }),
    Object.freeze({
        id: "riqueza_lexica",
        etiqueta: "Riqueza l\u00e9xica",
        peso: 15,
        unidad: "palabras \u00fanicas",
        mejor: "mayor",
        explicacion: "Compara cu\u00e1ntas palabras distintas se han utilizado."
    }),
    Object.freeze({
        id: "bonus",
        etiqueta: "Inspiraci\u00f3n aprovechada",
        peso: 20,
        unidad: "puntos de inspiraci\u00f3n",
        mejor: "mayor",
        explicacion: "Compara el valor de las inspiraciones incorporadas; los descartes consecutivos reducen su valor."
    }),
    Object.freeze({
        id: "precision",
        etiqueta: "Precisi\u00f3n",
        peso: 20,
        unidad: "intentos",
        mejor: "menor",
        explicacion: "Premia cometer menos intentos con letras o palabras prohibidas."
    }),
    Object.freeze({
        id: "resistencia",
        etiqueta: "Resistencia",
        peso: 10,
        unidad: "vida media",
        mejor: "mayor",
        explicacion: "Compara la vida media mantenida durante la partida."
    })
]);

const redondear = (valor, decimales = 2) => {
    const factor = 10 ** decimales;
    return Math.round((Number(valor) + Number.EPSILON) * factor) / factor;
};

const numeroNoNegativo = (valor, fallback = 0) => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.max(0, numero) : fallback;
};

const nombreJugador = (valor, player) => {
    const nombre = typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, 28) : "";
    return nombre || `ESCRITXR ${player}`;
};

const tieneJugador = (players, player) => Boolean(
    players
    && Object.prototype.hasOwnProperty.call(players, player)
    && players[player]
    && typeof players[player] === "object"
);

const clonarCategoria = (categoria) => ({
    ...categoria,
    valores: { ...categoria.valores },
    puntos: { ...categoria.puntos }
});

function crearPuntuacionFinalVacia() {
    return {
        schema_version: PUNTUACION_SCHEMA_VERSION,
        formula_version: PUNTUACION_FORMULA_VERSION,
        disponible: false,
        datos_suficientes: false,
        calculado_en_ts: 0,
        fuentes_datos: { 1: false, 2: false },
        jugadores: {
            1: { id: 1, nombre: "ESCRITXR 1", total: 0 },
            2: { id: 2, nombre: "ESCRITXR 2", total: 0 }
        },
        categorias: [],
        ganador: null,
        empate: false,
        diferencia: 0
    };
}

function clonarPuntuacionFinal(estado) {
    const base = estado && typeof estado === "object" ? estado : crearPuntuacionFinalVacia();
    return {
        ...base,
        fuentes_datos: { ...(base.fuentes_datos || { 1: false, 2: false }) },
        jugadores: {
            1: { ...(base.jugadores && base.jugadores[1] ? base.jugadores[1] : { id: 1, nombre: "ESCRITXR 1", total: 0 }) },
            2: { ...(base.jugadores && base.jugadores[2] ? base.jugadores[2] : { id: 2, nombre: "ESCRITXR 2", total: 0 }) }
        },
        categorias: Array.isArray(base.categorias) ? base.categorias.map(clonarCategoria) : []
    };
}

function repartirCuota(valor1, valor2) {
    const primero = numeroNoNegativo(valor1);
    const segundo = numeroNoNegativo(valor2);
    if (Math.abs(primero - segundo) < Number.EPSILON || (primero === 0 && segundo === 0)) {
        return { 1: 0.5, 2: 0.5, empate: true };
    }
    const total = primero + segundo;
    if (!Number.isFinite(total) || total <= 0) {
        return { 1: 0.5, 2: 0.5, empate: true };
    }
    return {
        1: primero / total,
        2: segundo / total,
        empate: false
    };
}

function construirCategoria(definicion, valores, valoresComparables = valores) {
    const cuota = repartirCuota(valoresComparables[1], valoresComparables[2]);
    const puntos1 = redondear(definicion.peso * cuota[1]);
    const puntos2 = redondear(definicion.peso - puntos1);
    const ganador = cuota.empate ? null : (cuota[1] > cuota[2] ? 1 : 2);
    return {
        id: definicion.id,
        etiqueta: definicion.etiqueta,
        peso: definicion.peso,
        unidad: definicion.unidad,
        mejor: definicion.mejor,
        valores: {
            1: redondear(valores[1]),
            2: redondear(valores[2])
        },
        puntos: { 1: puntos1, 2: puntos2 },
        ganador,
        empate: cuota.empate,
        explicacion: definicion.explicacion
    };
}

function extraerMetricasJugador(entrada = {}) {
    const palabrasTotal = numeroNoNegativo(entrada.palabrasTotal);
    const palabrasUnicasEntrada = numeroNoNegativo(entrada.palabrasUnicas);
    const palabrasUnicas = palabrasTotal > 0
        ? Math.min(palabrasUnicasEntrada, palabrasTotal)
        : 0;
    const vidaMedia = entrada.vida && typeof entrada.vida === "object"
        ? numeroNoNegativo(entrada.vida.media)
        : 0;
    const valorInspiracionEntrada = entrada.valorInspiracion;
    const valorInspiracionNumero = Number(valorInspiracionEntrada);
    const maximoValorInspiracion = Array.isArray(entrada.palabrasBenditas)
        ? entrada.palabrasBenditas.length
        : 0;
    const tieneValorInspiracion = valorInspiracionEntrada !== null
        && typeof valorInspiracionEntrada !== "undefined"
        && String(valorInspiracionEntrada).trim() !== ""
        && Number.isFinite(valorInspiracionNumero);
    return {
        produccion: palabrasTotal,
        ritmo: numeroNoNegativo(entrada.ritmoPpm),
        riqueza_lexica: palabrasUnicas,
        bonus: tieneValorInspiracion
            ? Math.min(maximoValorInspiracion, Math.max(0, valorInspiracionNumero))
            : maximoValorInspiracion,
        precision: numeroNoNegativo(entrada.intentosLetraProhibida)
            + numeroNoNegativo(entrada.intentosPalabraProhibida),
        resistencia: vidaMedia
    };
}

function calcularPuntuacionFinal(stats = {}, opciones = {}) {
    const players = stats && stats.players && typeof stats.players === "object" ? stats.players : {};
    const fuentesEntrada = opciones.datosRecibidos && typeof opciones.datosRecibidos === "object"
        ? opciones.datosRecibidos
        : {
            1: tieneJugador(players, 1),
            2: tieneJugador(players, 2)
        };
    const fuentesDatos = {
        1: Boolean(fuentesEntrada[1]),
        2: Boolean(fuentesEntrada[2])
    };
    const datosSuficientes = fuentesDatos[1] && fuentesDatos[2];
    const nombres = opciones.nombres && typeof opciones.nombres === "object" ? opciones.nombres : {};
    const jugador1 = tieneJugador(players, 1) ? players[1] : {};
    const jugador2 = tieneJugador(players, 2) ? players[2] : {};
    const metricas = {
        1: extraerMetricasJugador(jugador1),
        2: extraerMetricasJugador(jugador2)
    };

    const categorias = CATEGORIAS_PUNTUACION.map((definicion) => {
        const valores = {
            1: metricas[1][definicion.id],
            2: metricas[2][definicion.id]
        };
        if (definicion.id !== "precision") {
            return construirCategoria(definicion, valores);
        }
        const comparables = {
            1: 1 / (1 + valores[1]),
            2: 1 / (1 + valores[2])
        };
        return construirCategoria(definicion, valores, comparables);
    });

    const total1SinRedondear = categorias.reduce((total, categoria) => total + categoria.puntos[1], 0);
    const total1 = redondear(total1SinRedondear);
    const total2 = redondear(100 - total1);
    const diferencia = redondear(Math.abs(total1 - total2));
    const empate = datosSuficientes && diferencia < 0.01;
    const ganador = !datosSuficientes || empate ? null : (total1 > total2 ? 1 : 2);
    const now = Number(opciones.now);

    return {
        schema_version: PUNTUACION_SCHEMA_VERSION,
        formula_version: PUNTUACION_FORMULA_VERSION,
        disponible: datosSuficientes,
        datos_suficientes: datosSuficientes,
        calculado_en_ts: Number.isFinite(now) && now >= 0 ? now : Date.now(),
        fuentes_datos: fuentesDatos,
        jugadores: {
            1: {
                id: 1,
                nombre: nombreJugador(nombres[1] || jugador1.nombre, 1),
                total: total1
            },
            2: {
                id: 2,
                nombre: nombreJugador(nombres[2] || jugador2.nombre, 2),
                total: total2
            }
        },
        categorias,
        ganador,
        empate,
        diferencia
    };
}

function crearGestorPuntuacionFinal({ io, getNombreEquipo = () => "", now = () => Date.now() } = {}) {
    let estado = crearPuntuacionFinalVacia();
    let capturaPendiente = false;

    const payload = () => clonarPuntuacionFinal(estado);

    const emitir = (socketDestino = null) => {
        const salida = payload();
        const destino = socketDestino && typeof socketDestino.emit === "function" ? socketDestino : io;
        if (destino && typeof destino.emit === "function") {
            destino.emit("puntuacion_final_estado", salida);
        }
        return salida;
    };

    const calcular = (stats = {}, opciones = {}) => calcularPuntuacionFinal(stats, {
        ...opciones,
        now: now(),
        nombres: {
            1: getNombreEquipo(1),
            2: getNombreEquipo(2),
            ...(opciones.nombres || {})
        }
    });

    const capturar = (stats = {}, opciones = {}) => {
        if (estado.disponible === true && opciones.forzar !== true) {
            return payload();
        }
        estado = calcular(stats, opciones);
        capturaPendiente = false;
        emitir();
        return payload();
    };

    const prepararCaptura = () => {
        if (estado.disponible === true) {
            return false;
        }
        capturaPendiente = true;
        return true;
    };

    const capturarPendiente = (stats = {}, opciones = {}) => {
        if (estado.disponible === true) {
            return {
                ok: true,
                capturada: false,
                ya_capturada: true,
                puntuacion: payload()
            };
        }
        if (!capturaPendiente) {
            return {
                ok: false,
                code: "PUNTUACION_NO_PENDIENTE",
                puntuacion: payload()
            };
        }

        const candidata = calcular(stats, opciones);
        if (candidata.datos_suficientes !== true) {
            return {
                ok: false,
                code: "DATOS_INSUFICIENTES",
                puntuacion: payload()
            };
        }

        estado = candidata;
        capturaPendiente = false;
        emitir();
        return {
            ok: true,
            capturada: true,
            ya_capturada: false,
            puntuacion: payload()
        };
    };

    const reset = () => {
        capturaPendiente = false;
        estado = crearPuntuacionFinalVacia();
        return payload();
    };

    return {
        capturar,
        capturarPendiente,
        emitir,
        estaPendiente: () => capturaPendiente,
        payload,
        prepararCaptura,
        reset
    };
}

module.exports = {
    CATEGORIAS_PUNTUACION,
    PUNTUACION_FORMULA_VERSION,
    PUNTUACION_SCHEMA_VERSION,
    calcularPuntuacionFinal,
    crearGestorPuntuacionFinal,
    crearPuntuacionFinalVacia,
    repartirCuota
};
