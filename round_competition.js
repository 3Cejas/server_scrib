const MODOS_COMPETITIVOS = Object.freeze([
    "letra bendita",
    "letra prohibida",
    "palabras bonus",
    "palabras prohibidas"
]);

const DESVENTAJAS_RONDA = Object.freeze(["⚡", "🌪️", "🙃", "🖊️"]);

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
    getAtributos = () => ({ 1: {}, 2: {} }),
    getModoSeq = () => 0
} = {}) {
    let estado;
    let primerPortador = 1;
    let ultimoPortadorInicial = null;
    let mazo = [];
    let historial = [];
    let pulsaciones = { 1: 0, 2: 0 };
    let revision = 0;

    const barajar = (entrada) => {
        const salida = [...entrada];
        for (let i = salida.length - 1; i > 0; i -= 1) {
            const j = Math.floor(random() * (i + 1));
            [salida[i], salida[j]] = [salida[j], salida[i]];
        }
        return salida;
    };

    const resetEstadoRonda = () => ({
        activa: false,
        modo: "",
        modo_publico: "",
        modo_seq: 0,
        ronda: 0,
        criterio: "",
        marcador: { 1: 0, 2: 0 },
        lider: null,
        empate: true,
        portador_inicial: null,
        desventaja_player: null,
        desventaja: "",
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
            if (socketDestino && estado.activa && estado.desventaja_player && estado.desventaja) {
                destino.emit("desventaja_activa_estado", {
                    player: estado.desventaja_player,
                    putada: estado.desventaja,
                    seleccion: estado.desventaja,
                    duracion_ms: 24 * 60 * 60 * 1000,
                    nivel_completo: true,
                    intensidad: estado.intensidad,
                    motivo: "reconexion",
                    modo: estado.modo,
                    modo_seq: estado.modo_seq,
                    revision
                });
            }
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

    const aplicarDesventaja = (player, motivo = "inicio") => {
        const id = Number(player);
        if ((id !== 1 && id !== 2) || !estado.desventaja) return null;
        const intensidad = intensidadDestreza(id);
        estado.desventaja_player = id;
        estado.intensidad = intensidad;
        const payload = {
            player: id,
            putada: estado.desventaja,
            seleccion: estado.desventaja,
            duracion_ms: 24 * 60 * 60 * 1000,
            nivel_completo: true,
            intensidad,
            motivo,
            modo: estado.modo,
            modo_seq: estado.modo_seq,
            revision
        };
        if (io && typeof io.emit === "function") {
            io.emit(`enviar_ventaja_j${id}`, payload);
            io.emit("desventaja_activa_estado", payload);
        }
        return payload;
    };

    const calcularLider = () => {
        const a = Number(estado.marcador[1]) || 0;
        const b = Number(estado.marcador[2]) || 0;
        if (Math.abs(a - b) < 0.001) return null;
        return a > b ? 1 : 2;
    };

    const sincronizarLiderYDesventaja = () => {
        const liderAnterior = estado.lider;
        const portadorAnterior = estado.desventaja_player;
        const lider = calcularLider();
        const portador = lider ? (lider === 1 ? 2 : 1) : portadorAnterior;
        estado.lider = lider;
        estado.empate = lider === null;
        if (portador && portador !== portadorAnterior) {
            limpiarDesventajaVisual("cambio_lider");
            aplicarDesventaja(portador, "cambio_lider");
            if (io && typeof io.emit === "function") {
                io.emit("competicion_cambio_lider", {
                    modo: estado.modo,
                    modo_publico: estado.modo_publico,
                    modo_seq: estado.modo_seq,
                    lider_anterior: liderAnterior,
                    lider,
                    desventaja_anterior: portadorAnterior,
                    desventaja_player: portador,
                    desventaja: estado.desventaja,
                    revision,
                    ts: now()
                });
            }
        }
    };

    const registrarPuntos = (player, delta, metadata = {}) => {
        const id = Number(player);
        const cantidad = Number(delta);
        if (!estado.activa || (id !== 1 && id !== 2) || !Number.isFinite(cantidad) || cantidad === 0) {
            return snapshot();
        }
        estado.marcador[id] = redondearMarcador((Number(estado.marcador[id]) || 0) + cantidad);
        if (cantidad > 0 && metadata.actualizar_racha !== false) {
            estado.rachas[id] = Math.max(0, Number(estado.rachas[id]) || 0) + 1;
        } else if (cantidad < 0) {
            estado.rachas[id] = 0;
        }
        revision += 1;
        sincronizarLiderYDesventaja();
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
        if (!estado.activa) return snapshot();
        const letrasAntes = contarLetras(textoAnterior);
        const letrasAhora = contarLetras(textoActual);
        const palabrasAntesLista = palabrasCompletadas(textoAnterior);
        const palabrasAhoraLista = palabrasCompletadas(textoActual);
        const palabrasAntes = palabrasAntesLista.length;
        const palabrasAhora = palabrasAhoraLista.length;
        const deltaLetras = letrasAhora - letrasAntes;
        const deltaPalabras = palabrasAhora - palabrasAntes;
        let delta = 0;
        if (estado.modo === "letra bendita" || estado.modo === "letra prohibida") {
            delta = deltaLetras > 0
                ? deltaLetras * 0.1 * factorFuerza(player)
                : deltaLetras * 0.05;
        } else if (estado.modo === "palabras bonus") {
            delta = deltaPalabras > 0
                ? deltaPalabras * factorFuerza(player)
                : deltaPalabras * 0.25;
        } else if (estado.modo === "palabras prohibidas") {
            delta = deltaPalabras > 0
                ? deltaPalabras * 0.25 * factorFuerza(player)
                : deltaPalabras * 0.1;
        }
        if (delta === 0) {
            if (deltaPalabras > 0 && (estado.modo === "letra bendita" || estado.modo === "letra prohibida")) {
                estado.rachas[Number(player)] = Math.max(0, Number(estado.rachas[Number(player)]) || 0) + deltaPalabras;
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
        if (!estado.activa) return snapshot();
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
        if (!estado.activa) return snapshot();
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

    const cerrarRonda = (motivo = "fin_nivel") => {
        if (estado.activa) {
            historial.push({
                modo: estado.modo,
                modo_publico: estado.modo_publico,
                modo_seq: estado.modo_seq,
                ronda: estado.ronda,
                marcador: { ...estado.marcador },
                ganador: estado.lider,
                empate: estado.empate,
                desventaja: estado.desventaja,
                portador_inicial: estado.portador_inicial,
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
        if (!mazo.length) mazo = barajar(DESVENTAJAS_RONDA);
        const ronda = historial.length + 1;
        const portadorInicial = ultimoPortadorInicial === null
            ? primerPortador
            : (ultimoPortadorInicial === 1 ? 2 : 1);
        ultimoPortadorInicial = portadorInicial;
        estado = {
            ...resetEstadoRonda(),
            activa: true,
            modo: modoNormalizado,
            modo_publico: NOMBRES_MODO_PUBLICOS[modoNormalizado] || modoNormalizado.toUpperCase(),
            modo_seq: Number(opciones.modo_seq ?? getModoSeq()) || 0,
            ronda,
            criterio: criterioModo(modoNormalizado),
            portador_inicial: portadorInicial,
            desventaja_player: portadorInicial,
            desventaja: mazo.shift(),
            intensidad: intensidadDestreza(portadorInicial)
        };
        revision += 1;
        limpiarDesventajaVisual("inicio_nivel");
        aplicarDesventaja(portadorInicial, "inicio_nivel");
        return emitir();
    };

    const reset = () => {
        limpiarDesventajaVisual("reset");
        primerPortador = random() < 0.5 ? 1 : 2;
        ultimoPortadorInicial = null;
        mazo = barajar(DESVENTAJAS_RONDA);
        historial = [];
        pulsaciones = { 1: 0, 2: 0 };
        estado = resetEstadoRonda();
        revision += 1;
        return emitir();
    };

    reset();

    return {
        cerrarRonda,
        emitir,
        iniciarRonda,
        registrarCambioTexto,
        registrarInfraccion,
        registrarInspiracion,
        registrarPulsacion,
        registrarPuntos,
        reset,
        snapshot
    };
}

module.exports = {
    DESVENTAJAS_RONDA,
    MODOS_COMPETITIVOS,
    NOMBRES_MODO_PUBLICOS,
    contarLetras,
    contarPalabras,
    crearCompeticionRondas,
    esModoCompetitivo
};
