const CREDITOS_TEXT_MAX = 80;
const CREDITOS_AGRADECIMIENTOS_MAX = 420;
const CREDITOS_MUSAS_MAX = 60;
const CREDITOS_MUSA_NOMBRE_MAX = 48;

const ESTADO_CREDITOS_POR_DEFECTO = Object.freeze({
    escritxr_rojo: "\u00c1NGELA BUENO",
    escritxr_azul: "MIRIAM DEL VALLE",
    interprete_azul_1: "PAULA CM",
    interprete_azul_2: "DIEGO VALVERDE",
    interprete_rojo_1: "ANA SEMPERE",
    interprete_rojo_2: "PABLO PINE\u00d1O",
    programacion: "DAVID VI\u00d1AS",
    dramaturgia: "PABLO PINE\u00d1O",
    iluminacion: "TERESA TIMPER",
    musica: "ARNY RAM\u00cdREZ",
    voz_off: "NINACHASKA ZL",
    agradecimientos: "SALA EXL\u00cdMITE\nJUAN CEACERO",
    musas: Object.freeze({
        azules: Object.freeze([]),
        rojas: Object.freeze([])
    })
});

const CAMPOS_CREDITOS_ESTADO = Object.freeze([
    "escritxr_rojo",
    "escritxr_azul",
    "interprete_azul_1",
    "interprete_azul_2",
    "interprete_rojo_1",
    "interprete_rojo_2",
    "programacion",
    "dramaturgia",
    "iluminacion",
    "musica",
    "voz_off"
]);

const normalizarTextoCreditoShow = (valor, max = CREDITOS_TEXT_MAX) => String(valor ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalizarTextoAgradecimientosShow = (valor, max = CREDITOS_AGRADECIMIENTOS_MAX) => String(valor ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max);

const normalizarListaMusasCreditosShow = (valor = []) => (
    Array.isArray(valor) ? valor : []
)
    .map((nombre) => normalizarTextoCreditoShow(nombre, CREDITOS_MUSA_NOMBRE_MAX))
    .filter(Boolean)
    .filter((nombre, indice, lista) => (
        lista.findIndex((otro) => otro.toLocaleLowerCase() === nombre.toLocaleLowerCase()) === indice
    ))
    .slice(0, CREDITOS_MUSAS_MAX);

const normalizarMusasCreditosShow = (entrada = {}) => {
    const data = (entrada && typeof entrada === "object") ? entrada : {};
    return {
        azules: normalizarListaMusasCreditosShow(data.azules),
        rojas: normalizarListaMusasCreditosShow(data.rojas)
    };
};

const normalizarCreditosShow = (entrada = {}) => {
    const data = (entrada && typeof entrada === "object") ? entrada : {};
    const salida = { ...ESTADO_CREDITOS_POR_DEFECTO };
    CAMPOS_CREDITOS_ESTADO.forEach((campo) => {
        salida[campo] = normalizarTextoCreditoShow(data[campo], CREDITOS_TEXT_MAX);
    });
    salida.agradecimientos = normalizarTextoAgradecimientosShow(data.agradecimientos, CREDITOS_AGRADECIMIENTOS_MAX);
    salida.musas = normalizarMusasCreditosShow(data.musas);
    return salida;
};

function crearGestorCreditosShow({ io, isVisible = () => false, getMusasCreditos = () => null } = {}) {
    let estadoCreditos = { ...ESTADO_CREDITOS_POR_DEFECTO };
    let animacionId = 0;

    const payload = () => {
        const musasActuales = typeof getMusasCreditos === "function" ? getMusasCreditos() : null;
        const musas = normalizarMusasCreditosShow(
            musasActuales && typeof musasActuales === "object" ? musasActuales : estadoCreditos.musas
        );
        return {
            creditos: { ...estadoCreditos, musas },
            mostrar: Boolean(isVisible()),
            animacion_id: Number(animacionId) || 0,
            ts: Date.now()
        };
    };

    const emitir = (socketDestino = null) => {
        const salida = payload();
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("creditos_estado", salida);
            return salida;
        }
        if (io && typeof io.emit === "function") {
            io.emit("creditos_estado", salida);
        }
        return salida;
    };

    const actualizar = (entrada = {}) => {
        estadoCreditos = normalizarCreditosShow(entrada);
        return { ...estadoCreditos };
    };

    const incrementarAnimacion = () => {
        animacionId += 1;
        return animacionId;
    };

    const reset = () => {
        estadoCreditos = { ...ESTADO_CREDITOS_POR_DEFECTO };
        animacionId = 0;
        return payload();
    };

    return {
        actualizar,
        emitir,
        incrementarAnimacion,
        payload,
        reset
    };
}

module.exports = {
    CAMPOS_CREDITOS_ESTADO,
    CREDITOS_AGRADECIMIENTOS_MAX,
    CREDITOS_MUSAS_MAX,
    CREDITOS_MUSA_NOMBRE_MAX,
    CREDITOS_TEXT_MAX,
    ESTADO_CREDITOS_POR_DEFECTO,
    crearGestorCreditosShow,
    normalizarCreditosShow,
    normalizarListaMusasCreditosShow,
    normalizarMusasCreditosShow,
    normalizarTextoAgradecimientosShow,
    normalizarTextoCreditoShow
};
