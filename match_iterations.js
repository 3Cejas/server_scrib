const ITERACIONES_SCHEMA_VERSION = 1;
const MAX_ITERACIONES_POR_PARTIDA = 120000;
const MAX_BYTES_ITERACIONES = 8 * 1024 * 1024;

const clonarJson = (valor, fallback = null) => {
    try {
        return JSON.parse(JSON.stringify(valor));
    } catch (_error) {
        return fallback;
    }
};

const texto = (valor) => String(valor ?? "");

function calcularParcheTexto(anterior, actual) {
    const origen = texto(anterior);
    const destino = texto(actual);
    if (origen === destino) return null;

    if (destino.startsWith(origen)) {
        return [origen.length, 0, destino.slice(origen.length)];
    }
    if (origen.startsWith(destino)) {
        return [destino.length, origen.length - destino.length, ""];
    }

    const limitePrefijo = Math.min(origen.length, destino.length);
    let inicio = 0;
    while (inicio < limitePrefijo && origen[inicio] === destino[inicio]) inicio += 1;

    let sufijo = 0;
    const limiteSufijo = Math.min(origen.length - inicio, destino.length - inicio);
    while (
        sufijo < limiteSufijo
        && origen[origen.length - 1 - sufijo] === destino[destino.length - 1 - sufijo]
    ) {
        sufijo += 1;
    }

    return [
        inicio,
        origen.length - inicio - sufijo,
        destino.slice(inicio, destino.length - sufijo)
    ];
}

function aplicarParcheTexto(origen, operacion) {
    const base = texto(origen);
    const inicio = Math.max(0, Math.trunc(Number(operacion && operacion[3]) || 0));
    const borrar = Math.max(0, Math.trunc(Number(operacion && operacion[4]) || 0));
    const insertar = texto(operacion && operacion[5]);
    return `${base.slice(0, inicio)}${insertar}${base.slice(inicio + borrar)}`;
}

const normalizarTextoJugador = (valor) => {
    const entrada = valor && typeof valor === "object" ? valor : {};
    const htmlGuardado = entrada.html;
    const html = typeof htmlGuardado === "string"
        ? htmlGuardado
        : (htmlGuardado && typeof htmlGuardado.text === "string" ? htmlGuardado.text : "");
    return {
        plano: texto(entrada.plano ?? entrada.text ?? (typeof valor === "string" ? valor : "")),
        html
    };
};

const normalizarTextos = (valor = {}) => ({
    1: normalizarTextoJugador(valor[1]),
    2: normalizarTextoJugador(valor[2])
});

const normalizarNombres = (valor = {}) => ({
    1: texto(valor[1]),
    2: texto(valor[2])
});

const compactarEvento = (evento = {}, inicioTs = 0) => {
    const hechos = clonarJson(evento.hechos, {});
    if (evento.tipo === "texto" && hechos && typeof hechos === "object") {
        delete hechos.texto;
        delete hechos.extracto;
        delete hechos.firma;
    }
    return {
        s: Math.max(0, Math.trunc(Number(evento.seq) || 0)),
        t: Math.max(0, Math.trunc((Number(evento.ts) || inicioTs) - inicioTs)),
        tipo: texto(evento.tipo),
        fase: texto(evento.fase),
        modo: texto(evento.modo),
        modo_seq: Math.max(0, Math.trunc(Number(evento.modo_seq) || 0)),
        espacio: texto(evento.espacio),
        titulo: texto(evento.titulo),
        detalle: texto(evento.detalle),
        hechos
    };
};

function crearRegistroIteracionesPartida({
    now = () => Date.now(),
    getTextos = () => ({ 1: {}, 2: {} }),
    getNombres = () => ({ 1: "", 2: "" }),
    limiteIteraciones = MAX_ITERACIONES_POR_PARTIDA,
    limiteBytes = MAX_BYTES_ITERACIONES
} = {}) {
    let partida = null;

    const obtenerTextos = () => normalizarTextos(getTextos());
    const obtenerNombres = () => normalizarNombres(getNombres());

    const guardarCierre = (motivo = "fin_partida", resumen = {}) => {
        if (!partida || partida.fin_ts) return partida;
        partida.fin_ts = now();
        partida.motivo_fin = texto(motivo) || "fin_partida";
        partida.textos_finales = obtenerTextos();
        partida.nombres_finales = obtenerNombres();
        partida.resumen_final = clonarJson(resumen, {});
        return partida;
    };

    const iniciar = ({ parametros = {}, borrar_texto = null } = {}) => {
        if (partida && !partida.fin_ts) guardarCierre("nueva_partida");
        const inicioTs = now();
        partida = {
            id: `scrib-${inicioTs.toString(36)}`,
            inicio_ts: inicioTs,
            fin_ts: 0,
            motivo_fin: "",
            parametros: clonarJson(parametros, {}),
            borrar_texto: borrar_texto === true,
            textos_base: obtenerTextos(),
            nombres_inicio: obtenerNombres(),
            textos_finales: null,
            nombres_finales: null,
            resumen_final: {},
            operaciones: [],
            secuencia: 0,
            bytes_aprox: 0,
            truncada: false,
            operaciones_omitidas: 0
        };
        return partida.id;
    };

    const registrarCambio = (player, anterior, actual) => {
        const jugador = Number(player);
        if (!partida || partida.fin_ts || (jugador !== 1 && jugador !== 2)) return false;
        const parche = calcularParcheTexto(anterior, actual);
        if (!parche) return false;

        partida.secuencia += 1;
        const operacion = [
            partida.secuencia,
            Math.max(0, Math.trunc(now() - partida.inicio_ts)),
            jugador,
            parche[0],
            parche[1],
            parche[2]
        ];
        const bytesOperacion = 40 + Buffer.byteLength(parche[2], "utf8");
        if (
            partida.operaciones.length >= Math.max(1, limiteIteraciones)
            || partida.bytes_aprox + bytesOperacion > Math.max(1024, limiteBytes)
        ) {
            partida.truncada = true;
            partida.operaciones_omitidas += 1;
            return false;
        }
        partida.operaciones.push(operacion);
        partida.bytes_aprox += bytesOperacion;
        return true;
    };

    const finalizar = (motivo = "fin_partida", resumen = {}) => guardarCierre(motivo, resumen);

    const construirExportacion = ({ eventos = [], resumen = {} } = {}) => {
        if (!partida) return null;
        const finTs = partida.fin_ts || now();
        const textosFinales = partida.textos_finales || obtenerTextos();
        const nombresFinales = partida.nombres_finales || obtenerNombres();
        const eventosPartida = (Array.isArray(eventos) ? eventos : [])
            .filter((evento) => {
                const ts = Number(evento && evento.ts) || 0;
                return ts >= partida.inicio_ts && ts <= finTs;
            })
            .map((evento) => compactarEvento(evento, partida.inicio_ts));
        const resumenFinal = Object.keys(partida.resumen_final || {}).length
            ? partida.resumen_final
            : clonarJson(resumen, {});

        return {
            schema_version: ITERACIONES_SCHEMA_VERSION,
            tipo: "scrib_iteraciones_partida",
            creado_ts: now(),
            partida: {
                id: partida.id,
                inicio_ts: partida.inicio_ts,
                fin_ts: partida.fin_ts || null,
                duracion_ms: Math.max(0, finTs - partida.inicio_ts),
                motivo_fin: partida.motivo_fin || null,
                parametros: clonarJson(partida.parametros, {}),
                borrar_texto: partida.borrar_texto,
                completa: !partida.truncada,
                operaciones_omitidas: partida.operaciones_omitidas
            },
            formato_operacion: [
                "secuencia",
                "ms_desde_inicio",
                "escritxr",
                "indice_inicio",
                "caracteres_borrados",
                "texto_insertado"
            ],
            escritores: {
                1: {
                    nombre: nombresFinales[1] || partida.nombres_inicio[1],
                    texto_base: partida.textos_base[1].plano,
                    texto_final: textosFinales[1].plano,
                    html_final: textosFinales[1].html
                },
                2: {
                    nombre: nombresFinales[2] || partida.nombres_inicio[2],
                    texto_base: partida.textos_base[2].plano,
                    texto_final: textosFinales[2].plano,
                    html_final: textosFinales[2].html
                }
            },
            iteraciones: partida.operaciones.map((operacion) => [...operacion]),
            contexto: eventosPartida,
            resumen: {
                iteraciones: partida.operaciones.length,
                eventos_contexto: eventosPartida.length,
                bytes_memoria_aprox: partida.bytes_aprox,
                ...clonarJson(resumenFinal, {})
            }
        };
    };

    const snapshot = () => partida ? {
        id: partida.id,
        activa: !partida.fin_ts,
        iteraciones: partida.operaciones.length,
        bytes_aprox: partida.bytes_aprox,
        truncada: partida.truncada,
        operaciones_omitidas: partida.operaciones_omitidas
    } : null;

    return {
        construirExportacion,
        finalizar,
        iniciar,
        registrarCambio,
        snapshot
    };
}

module.exports = {
    ITERACIONES_SCHEMA_VERSION,
    MAX_BYTES_ITERACIONES,
    MAX_ITERACIONES_POR_PARTIDA,
    aplicarParcheTexto,
    calcularParcheTexto,
    crearRegistroIteracionesPartida
};
