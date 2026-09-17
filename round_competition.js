const MODOS_COMPETITIVOS = Object.freeze([
    "letra bendita",
    "letra prohibida",
    "palabras bonus",
    "palabras prohibidas"
]);

const DESVENTAJAS_RONDA = Object.freeze(["⚡", "🌪️", "🙃", "🖊️"]);
const RACHA_INACTIVIDAD_MS = 4500;

const NOMBRES_MODO_PUBLICOS = Object.freeze({
    "letra bendita": "LETRA BENDITA",
    "letra prohibida": "LETRA MALDITA",
    "palabras bonus": "PALABRAS BENDITAS",
    "palabras prohibidas": "PALABRAS MALDITAS",
    tertulia: "TERTULIA",
    "frase final": "FRASE FINAL"
});

const redondearMarcador = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

const contarLetras = (texto) => {
    const coincidencias = String(texto || "").match(/\p{L}/gu);
    return coincidencias ? coincidencias.length : 0;
};

// El borrado se penaliza por cada caracter real retirado del texto. No usamos
// letras ni palabras para este cálculo porque dejaría sin coste espacios,
// signos, saltos de línea y borrados parciales dentro de una palabra.
const contarCaracteres = (texto) => Array.from(String(texto || "")).length;

const contarPalabras = (texto) => {
    const coincidencias = String(texto || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
    return coincidencias ? coincidencias.length : 0;
};

const palabrasCompletadas = (texto) => {
    const contenido = String(texto || "");
    const coincidencias = [...contenido.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*(?=[^\p{L}\p{N}'’\-]|$)/gu)];
    if (coincidencias.length && /[\p{L}\p{N}'’\-]$/u.test(contenido)) {
        coincidencias.pop();
    }
    return coincidencias.map((coincidencia) => coincidencia[0]);
};

const ultimaPalabra = (texto) => {
    const coincidencias = String(texto || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
    return coincidencias && coincidencias.length ? coincidencias[coincidencias.length - 1] : "";
};

const esModoCompetitivo = (modo) => MODOS_COMPETITIVOS.includes(String(modo || ""));

function crearCompeticionRondas({
    io,
    random = Math.random,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    getAtributos = () => ({ 1: {}, 2: {} }),
    getModoSeq = () => 0
} = {}) {
    let estado;
    let ultimoGanadorDesempate = 1;
    let historial = [];
    let pulsaciones = { 1: 0, 2: 0 };
    let temporizadoresRacha = { 1: null, 2: null };
    let revision = 0;

    const resetEstadoRonda = () => ({
        activa: false,
        fase: "inactiva",
        batalla_activa: false,
        modo: "",
        modo_publico: "",
        modo_seq: 0,
        ronda: 0,
        criterio: "",
        marcador: { 1: 0, 2: 0 },
        lider: null,
        empate: true,
        ganador_batalla: null,
        perdedor_batalla: null,
        batalla_desempate: false,
        votacion_duracion_ms: 0,
        votacion_termina_en_ts: 0,
        desventaja_player: null,
        desventaja: "",
        desventaja_duracion_ms: 0,
        intensidad: 1,
        rachas: { 1: 0, 2: 0 },
        revision: 0,
        ts: now()
    });

    estado = resetEstadoRonda();

    const criterioModo = (modo) => ({
        "letra bendita": "LETRAS + INSPIRACIONES DE MUSAS",
        "letra prohibida": "RITMO DE ESCRITURA - FALTAS DE LETRA MALDITA",
        "palabras bonus": "PALABRAS BENDITAS INCORPORADAS",
        "palabras prohibidas": "RITMO DE ESCRITURA - PALABRAS MALDITAS"
    }[modo] || "");

    const intensidadDestreza = (player) => {
        const atributos = getAtributos() || {};
        const destreza = Math.max(0, Math.min(10, Number(atributos[player]?.destreza) || 0));
        return redondearMarcador(Math.max(0.6, 1 - (destreza * 0.04)));
    };

    const snapshot = () => ({
        ...estado,
        marcador: { ...estado.marcador },
        rachas: { ...estado.rachas },
        pulsaciones: { ...pulsaciones },
        historial: historial.map((item) => ({ ...item, marcador: { ...item.marcador } })),
        revision,
        ts: now()
    });

    const emitir = (socketDestino = null, eventoPunto = null) => {
        const payload = snapshot();
        const destino = socketDestino && typeof socketDestino.emit === "function" ? socketDestino : io;
        if (destino && typeof destino.emit === "function") {
            destino.emit("competicion_ronda_estado", payload);
            if (eventoPunto) destino.emit("competicion_ronda_punto", { ...eventoPunto, estado: payload });
        }
        return payload;
    };

    const limpiarDesventajaVisual = (motivo = "cambio") => {
        if (io && typeof io.emit === "function") {
            io.emit("desventaja_ronda_limpiar", {
                motivo,
                modo: estado.modo,
                modo_seq: estado.modo_seq,
                revision
            });
        }
    };

    const calcularLider = () => {
        const a = Number(estado.marcador[1]) || 0;
        const b = Number(estado.marcador[2]) || 0;
        if (Math.abs(a - b) < 0.001) return null;
        return a > b ? 1 : 2;
    };

    const cancelarCaducidadRacha = (player) => {
        const id = Number(player);
        if (id !== 1 && id !== 2) return;
        if (temporizadoresRacha[id] !== null) {
            clearTimer(temporizadoresRacha[id]);
            temporizadoresRacha[id] = null;
        }
    };

    const cancelarTodasLasRachas = () => {
        cancelarCaducidadRacha(1);
        cancelarCaducidadRacha(2);
    };

    const programarCaducidadRacha = (player) => {
        const id = Number(player);
        if (id !== 1 && id !== 2) return;
        cancelarCaducidadRacha(id);
        const modoProgramado = estado.modo;
        const modoSeqProgramado = estado.modo_seq;
        const rondaProgramada = estado.ronda;
        const timer = setTimer(() => {
            temporizadoresRacha[id] = null;
            if (
                !estado.activa
                || estado.modo !== modoProgramado
                || estado.modo_seq !== modoSeqProgramado
                || estado.ronda !== rondaProgramada
                || (Number(estado.rachas[id]) || 0) <= 0
            ) {
                return;
            }
            estado.rachas[id] = 0;
            revision += 1;
            emitir();
        }, RACHA_INACTIVIDAD_MS);
        temporizadoresRacha[id] = timer;
        if (timer && typeof timer.unref === "function") timer.unref();
    };

    const sincronizarLider = () => {
        const lider = calcularLider();
        estado.lider = lider;
        estado.empate = lider === null;
    };

    const registrarPuntos = (player, delta, metadata = {}) => {
        const id = Number(player);
        const cantidad = Number(delta);
        if (!estado.activa || estado.fase !== "batalla" || (id !== 1 && id !== 2) || !Number.isFinite(cantidad) || cantidad === 0) {
            return snapshot();
        }
        // La inspiración representa una reserva visual: las penalizaciones
        // pueden agotarla, pero nunca convertirla en un valor negativo.
        estado.marcador[id] = redondearMarcador(Math.max(
            0,
            (Number(estado.marcador[id]) || 0) + cantidad
        ));
        if (cantidad > 0 && metadata.actualizar_racha !== false) {
            estado.rachas[id] = Math.max(0, Number(estado.rachas[id]) || 0) + 1;
            programarCaducidadRacha(id);
        } else if (cantidad < 0) {
            estado.rachas[id] = 0;
            cancelarCaducidadRacha(id);
        }
        revision += 1;
        sincronizarLider();
        return emitir(null, {
            player: id,
            delta: redondearMarcador(cantidad),
            total: estado.marcador[id],
            racha: estado.rachas[id],
            tipo: String(metadata.tipo || "mini_inspiracion"),
            etiqueta: String(metadata.etiqueta || metadata.palabra || ""),
            palabra: String(metadata.palabra || ""),
            musa_nombre: String(metadata.musa_nombre || ""),
            animar: metadata.animar !== false,
            modo: estado.modo,
            modo_seq: estado.modo_seq,
            ts: now()
        });
    };

    const factorFuerza = (player) => {
        const atributos = getAtributos() || {};
        const fuerza = Math.max(0, Math.min(10, Number(atributos[player]?.fuerza) || 0));
        return 1 + (fuerza * 0.05);
    };

    const registrarCambioTexto = (player, textoAnterior, textoActual) => {
        if (!estado.activa || estado.fase !== "batalla") return snapshot();
        const letrasAntes = contarLetras(textoAnterior);
        const letrasAhora = contarLetras(textoActual);
        const palabrasAntesLista = palabrasCompletadas(textoAnterior);
        const palabrasAhoraLista = palabrasCompletadas(textoActual);
        const palabrasAntes = palabrasAntesLista.length;
        const palabrasAhora = palabrasAhoraLista.length;
        const deltaCaracteres = contarCaracteres(textoActual) - contarCaracteres(textoAnterior);
        const deltaLetras = letrasAhora - letrasAntes;
        const deltaPalabras = palabrasAhora - palabrasAntes;
        let delta = 0;
        if (deltaCaracteres < 0) {
            delta = deltaCaracteres * 0.05;
        } else if (estado.modo === "letra bendita" || estado.modo === "letra prohibida") {
            delta = deltaLetras > 0
                ? deltaLetras * 0.1 * factorFuerza(player)
                : 0;
        } else if (estado.modo === "palabras bonus") {
            delta = deltaPalabras > 0
                ? deltaPalabras * factorFuerza(player)
                : 0;
        } else if (estado.modo === "palabras prohibidas") {
            delta = deltaPalabras > 0
                ? deltaPalabras * 0.25 * factorFuerza(player)
                : 0;
        }
        if (delta === 0) {
            if (deltaPalabras > 0 && (estado.modo === "letra bendita" || estado.modo === "letra prohibida")) {
                estado.rachas[Number(player)] = Math.max(0, Number(estado.rachas[Number(player)]) || 0) + deltaPalabras;
                programarCaducidadRacha(player);
                revision += 1;
                return emitir(null, {
                    player: Number(player),
                    delta: 0,
                    total: estado.marcador[Number(player)] || 0,
                    racha: estado.rachas[Number(player)],
                    tipo: "palabra",
                    etiqueta: palabrasAhoraLista[palabrasAhoraLista.length - 1] || "PALABRA",
                    palabra: palabrasAhoraLista[palabrasAhoraLista.length - 1] || "",
                    animar: true,
                    modo: estado.modo,
                    modo_seq: estado.modo_seq,
                    ts: now()
                });
            }
            return snapshot();
        }
        const esPalabraCompletada = deltaPalabras > 0;
        return registrarPuntos(player, delta, {
            tipo: delta > 0 ? "mini_inspiracion" : "borrado",
            etiqueta: delta > 0
                ? (esPalabraCompletada ? (palabrasAhoraLista[palabrasAhoraLista.length - 1] || "PALABRA") : "ESCRITURA")
                : "BORRADO",
            palabra: delta > 0 && esPalabraCompletada ? (palabrasAhoraLista[palabrasAhoraLista.length - 1] || ultimaPalabra(textoActual)) : "",
            animar: delta < 0 || esPalabraCompletada,
            actualizar_racha: esPalabraCompletada
        });
    };

    const registrarInfraccion = (player, payload = {}) => {
        if (!estado.activa || estado.fase !== "batalla") return snapshot();
        const tipo = String(payload.tipo || "").toLowerCase();
        if (estado.modo === "letra prohibida" && tipo === "letra") {
            return registrarPuntos(player, -1, { tipo: "letra_maldita", etiqueta: payload.valor });
        }
        if (estado.modo === "palabras prohibidas" && tipo === "palabra") {
            return registrarPuntos(player, -3, {
                tipo: "palabra_maldita",
                etiqueta: payload.valor,
                palabra: payload.valor
            });
        }
        return snapshot();
    };

    const registrarInspiracion = (player, payload = {}) => {
        if (!estado.activa || estado.fase !== "batalla") return snapshot();
        const valor = Math.max(0.25, Math.min(1, Number(payload.valor_inspiracion) || 1));
        const esMaldita = estado.modo === "letra prohibida" || estado.modo === "palabras prohibidas";
        const delta = (esMaldita ? -5 : 5) * valor;
        return registrarPuntos(player, delta, {
            tipo: "inspiracion_musa",
            etiqueta: payload.palabra,
            palabra: payload.palabra,
            musa_nombre: payload.musa_nombre,
            actualizar_racha: false
        });
    };

    const registrarPulsacion = (player, payload = {}) => {
        const id = Number(player);
        if (id !== 1 && id !== 2) return { ...pulsaciones };
        const key = String(payload.key || "");
        const code = String(payload.code || "");
        if (key.length === 1 || code === "Enter" || code === "Space") {
            pulsaciones[id] += 1;
        }
        return { ...pulsaciones };
    };

    const cerrarBatalla = (opciones = {}) => {
        if (!estado.activa || estado.fase !== "batalla") return null;
        const liderPorPuntos = calcularLider();
        const huboEmpate = liderPorPuntos === null;
        let ganador = liderPorPuntos;
        if (!ganador) {
            ganador = ultimoGanadorDesempate === 1 ? 2 : 1;
            ultimoGanadorDesempate = ganador;
        }
        const perdedor = ganador === 1 ? 2 : 1;
        estado.fase = "votacion";
        estado.batalla_activa = false;
        estado.lider = ganador;
        estado.empate = huboEmpate;
        estado.ganador_batalla = ganador;
        estado.perdedor_batalla = perdedor;
        estado.batalla_desempate = huboEmpate;
        estado.votacion_duracion_ms = Math.max(0, Number(opciones.duracion_votacion_ms) || 0);
        estado.votacion_termina_en_ts = estado.votacion_duracion_ms > 0
            ? now() + estado.votacion_duracion_ms
            : 0;
        revision += 1;
        const payload = emitir();
        if (io && typeof io.emit === "function") {
            io.emit("competicion_batalla_cerrada", {
                ...payload,
                tiempo_restante_segundos: Math.max(0, Number(opciones.tiempo_restante_segundos) || 0)
            });
        }
        return {
            ganador,
            perdedor,
            empate: huboEmpate,
            marcador: { ...estado.marcador },
            estado: payload
        };
    };

    const registrarDesventajaSeleccionada = (player, putada, opciones = {}) => {
        const id = Number(player);
        const seleccion = String(putada || "");
        if (!estado.activa || (id !== 1 && id !== 2) || !DESVENTAJAS_RONDA.includes(seleccion)) {
            return null;
        }
        const duracionMs = Math.max(0, Number(opciones.duracion_ms ?? opciones.duracionMs) || 0);
        estado.fase = "desventaja";
        estado.batalla_activa = false;
        estado.desventaja_player = id;
        estado.desventaja = seleccion;
        estado.desventaja_duracion_ms = duracionMs;
        estado.intensidad = intensidadDestreza(id);
        estado.votacion_termina_en_ts = 0;
        revision += 1;
        const payload = {
            player: id,
            putada: seleccion,
            seleccion,
            duracion_ms: duracionMs,
            intensidad: estado.intensidad,
            motivo: "votacion_musas",
            modo: estado.modo,
            modo_seq: estado.modo_seq,
            revision
        };
        emitir();
        if (io && typeof io.emit === "function") {
            io.emit("competicion_desventaja_elegida", { ...payload, estado: snapshot() });
        }
        return payload;
    };

    const cerrarRonda = (motivo = "fin_nivel") => {
        cancelarTodasLasRachas();
        if (estado.activa) {
            historial.push({
                modo: estado.modo,
                modo_publico: estado.modo_publico,
                modo_seq: estado.modo_seq,
                ronda: estado.ronda,
                marcador: { ...estado.marcador },
                ganador: estado.ganador_batalla || estado.lider,
                empate: estado.empate,
                desventaja: estado.desventaja,
                desventaja_player: estado.desventaja_player,
                motivo,
                ts: now()
            });
        }
        limpiarDesventajaVisual(motivo);
        estado = { ...resetEstadoRonda(), ronda: estado.ronda };
        revision += 1;
        return emitir();
    };

    const iniciarRonda = (modo, opciones = {}) => {
        const modoNormalizado = String(modo || "");
        if (estado.activa) cerrarRonda("cambio_nivel");
        if (!esModoCompetitivo(modoNormalizado)) {
            estado = {
                ...resetEstadoRonda(),
                modo: modoNormalizado,
                modo_publico: NOMBRES_MODO_PUBLICOS[modoNormalizado] || modoNormalizado.toUpperCase(),
                modo_seq: Number(opciones.modo_seq ?? getModoSeq()) || 0,
                ronda: historial.length
            };
            revision += 1;
            return emitir();
        }
        const ronda = historial.length + 1;
        estado = {
            ...resetEstadoRonda(),
            activa: true,
            fase: "batalla",
            batalla_activa: true,
            modo: modoNormalizado,
            modo_publico: NOMBRES_MODO_PUBLICOS[modoNormalizado] || modoNormalizado.toUpperCase(),
            modo_seq: Number(opciones.modo_seq ?? getModoSeq()) || 0,
            ronda,
            criterio: criterioModo(modoNormalizado)
        };
        revision += 1;
        limpiarDesventajaVisual("inicio_nivel");
        return emitir();
    };

    const reset = () => {
        cancelarTodasLasRachas();
        limpiarDesventajaVisual("reset");
        ultimoGanadorDesempate = random() < 0.5 ? 1 : 2;
        historial = [];
        pulsaciones = { 1: 0, 2: 0 };
        estado = resetEstadoRonda();
        revision += 1;
        return emitir();
    };

    reset();

    return {
        cerrarRonda,
        cerrarBatalla,
        emitir,
        iniciarRonda,
        registrarCambioTexto,
        registrarInfraccion,
        registrarInspiracion,
        registrarPulsacion,
        registrarPuntos,
        registrarDesventajaSeleccionada,
        reset,
        snapshot
    };
}

module.exports = {
    DESVENTAJAS_RONDA,
    MODOS_COMPETITIVOS,
    NOMBRES_MODO_PUBLICOS,
    RACHA_INACTIVIDAD_MS,
    contarLetras,
    contarPalabras,
    crearCompeticionRondas,
    esModoCompetitivo
};
