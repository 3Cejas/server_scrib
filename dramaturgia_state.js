const DRAMATURGIA_EVENT = "dramaturgia_evento";
const DRAMATURGIA_CHECKPOINT_EVENT = "dramaturgia_checkpoint";
const DRAMATURGIA_ROOM = "role_dramaturgia";
const DRAMATURGIA_MAX_EVENTOS = 600;
const DRAMATURGIA_MAX_BYTES = 4 * 1024 * 1024;
const DRAMATURGIA_INTERVALO_MS = 1000;
const DRAMATURGIA_TEXTO_REPOSO_MS = 2500;
const DRAMATURGIA_TEXTO_ESPERA_MAX_MS = 10000;
const DRAMATURGIA_TEXTO_EVENTO_MAX = 6000;

const clonarJson = (valor, fallback = null) => {
    try {
        return JSON.parse(JSON.stringify(valor));
    } catch (_error) {
        return fallback;
    }
};

const numeroEntero = (valor, fallback = 0) => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.trunc(numero) : fallback;
};

const textoLimpio = (valor, maximo = 240) => {
    const texto = String(valor ?? "").replace(/\s+/g, " ").trim();
    return texto.length > maximo ? `${texto.slice(0, Math.max(0, maximo - 1)).trimEnd()}\u2026` : texto;
};

const firmaEstado = (valor) => {
    try {
        return JSON.stringify(valor);
    } catch (_error) {
        return "";
    }
};

const firmaTexto = (valor) => {
    const texto = String(valor ?? "");
    let hash = 2166136261;
    for (let i = 0; i < texto.length; i += 1) {
        hash ^= texto.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${texto.length}:${(hash >>> 0).toString(16)}`;
};

const contarPalabras = (valor) => {
    const texto = String(valor ?? "").trim();
    return texto ? texto.split(/\s+/).filter(Boolean).length : 0;
};

const textoPlanoJugador = (estado, jugador) => {
    const item = estado && estado.textos && estado.textos[jugador];
    if (!item) return "";
    if (typeof item.plano === "string") return item.plano;
    if (typeof item === "string") return item;
    if (item.html && typeof item.html.text === "string") return item.html.text;
    if (typeof item.text === "string") return item.text;
    return "";
};

const resolverModo = (estado) => textoLimpio(
    estado && estado.partida && estado.partida.modo_actual,
    80
).toLowerCase();

const resolverModoSeq = (estado) => {
    const preview = estado && estado.inspiracion && estado.inspiracion.preview;
    const previewSeq = numeroEntero(preview && preview.modo_seq, 0);
    if (previewSeq > 0) return previewSeq;
    const conteos = estado && estado.conteos;
    return Math.max(
        numeroEntero(conteos && conteos[1] && conteos[1].modo_seq, 0),
        numeroEntero(conteos && conteos[2] && conteos[2].modo_seq, 0)
    );
};

const resolverFase = (estado) => {
    const tutorial = estado && estado.tutorial ? estado.tutorial : {};
    const partida = estado && estado.partida ? estado.partida : {};
    const espectador = estado && estado.espectador ? estado.espectador : {};
    const teleprompter = estado && estado.teleprompter && estado.teleprompter.state
        ? estado.teleprompter.state
        : {};
    const modoEspectador = String(espectador.modo || "").toLowerCase();
    if (
        partida.fin_del_juego
        || teleprompter.visible
        || /represent|cr[eé]dit|stats|obra/.test(modoEspectador)
    ) {
        return "representacion";
    }
    if (resolverModo(estado)) {
        return "juego";
    }
    if (tutorial.activo || tutorial.vista || espectador.calentamiento_vista) {
        return "calentamiento";
    }
    return "espera";
};

const normalizarConteoConexion = (valor) => {
    if (valor && typeof valor === "object") {
        return Math.max(0, numeroEntero(valor.count, valor.connected ? 1 : 0));
    }
    return Math.max(0, numeroEntero(valor, 0));
};

const resumenConexiones = (estado) => {
    const conexiones = estado && estado.connections ? estado.connections : {};
    return {
        control: normalizarConteoConexion(conexiones.control),
        espectador: normalizarConteoConexion(conexiones.spectator),
        jurado: normalizarConteoConexion(conexiones.jury),
        dramaturgia: normalizarConteoConexion(conexiones.dramaturgia),
        escritxr1: normalizarConteoConexion(conexiones.writers && conexiones.writers[1]),
        escritxr2: normalizarConteoConexion(conexiones.writers && conexiones.writers[2]),
        musas1: normalizarConteoConexion(conexiones.musas && conexiones.musas[1]),
        musas2: normalizarConteoConexion(conexiones.musas && conexiones.musas[2]),
        actores1: normalizarConteoConexion(conexiones.actors && conexiones.actors[1]),
        actores2: normalizarConteoConexion(conexiones.actors && conexiones.actors[2])
    };
};

const claveTimeline = (item) => [
    numeroEntero(item && item.ts, 0),
    textoLimpio(item && item.modo, 80),
    textoLimpio(item && item.origen, 80)
].join("|");

const resumenCalentamiento = (estado) => {
    const tutorial = estado && estado.tutorial ? estado.tutorial : {};
    const equipo = (id) => {
        const data = tutorial.equipos && tutorial.equipos[id] ? tutorial.equipos[id] : {};
        return {
            estado: textoLimpio(data.estado, 48),
            intentos: Math.max(0, numeroEntero(data.intentos, 0)),
            aciertos: Math.max(0, numeroEntero(data.aciertos, 0)),
            bloqueado: Boolean(data.bloqueado),
            final: data.final ? clonarJson(data.final, null) : null
        };
    };
    return {
        activo: Boolean(tutorial.activo),
        vista: Boolean(tutorial.vista),
        solicitud: textoLimpio(tutorial.solicitud, 120),
        equipos: {
            1: equipo(1),
            2: equipo(2)
        }
    };
};

const resumenTeleprompter = (estado) => {
    const data = estado && estado.teleprompter && estado.teleprompter.state
        ? estado.teleprompter.state
        : {};
    const texto = typeof data.text === "string" ? data.text : "";
    return {
        visible: Boolean(data.visible),
        reproduciendo: Boolean(data.playing),
        fuente: numeroEntero(data.source, 0),
        carga_id: Math.max(0, numeroEntero(data.loadId, 0)),
        tamano_fuente: Number(data.fontSize) || 0,
        velocidad: Number(data.speed) || 0,
        caracteres: texto.length,
        firma_texto: firmaTexto(texto),
        texto: textoLimpio(texto, 1000)
    };
};

const resumenVistaEspectador = (estado) => {
    const data = estado && estado.espectador ? estado.espectador : {};
    return {
        modo: textoLimpio(data.modo, 48),
        override: textoLimpio(data.override, 48),
        calentamiento_vista: Boolean(data.calentamiento_vista),
        stats_slide_step: numeroEntero(data.stats_slide_step, 0),
        escala_ui: Number(data.escala_ui) || 1
    };
};

const resumenDesventajas = (estado) => {
    const lista = estado && Array.isArray(estado.desventajas) ? estado.desventajas : [];
    return lista.map((item) => ({
        player: numeroEntero(item && item.player, 0),
        putada: textoLimpio(item && item.putada, 80),
        pausada: Boolean(item && item.pausada),
        duracion_ms: Math.max(0, numeroEntero(item && item.duracion_ms, 0))
    })).filter((item) => item.player === 1 || item.player === 2);
};

const resumenCompeticionRonda = (estado) => {
    const data = estado && estado.competicion_ronda ? estado.competicion_ronda : {};
    const marcador = data.marcador && typeof data.marcador === "object" ? data.marcador : {};
    return {
        activa: Boolean(data.activa),
        modo: textoLimpio(data.modo, 48),
        ronda: Math.max(0, numeroEntero(data.ronda, 0)),
        marcador: { 1: Number(marcador[1]) || 0, 2: Number(marcador[2]) || 0 },
        lider: numeroEntero(data.lider, 0) || null,
        desventaja_player: numeroEntero(data.desventaja_player, 0) || null,
        desventaja: textoLimpio(data.desventaja, 16)
    };
};

const resumenRelojPartida = (estado) => {
    const data = estado && estado.reloj_partida ? estado.reloj_partida : {};
    return {
        activo: Boolean(data.activo),
        pausado: Boolean(data.pausado),
        tiempo_restante_segundos: Math.max(0, numeroEntero(data.tiempo_restante_segundos, 0)),
        duracion_total_segundos: Math.max(0, numeroEntero(data.duracion_total_segundos, 0))
    };
};

const resumenNube = (estado) => {
    const equipos = estado && estado.inspiracion && estado.inspiracion.nube
        && estado.inspiracion.nube.equipos
        ? estado.inspiracion.nube.equipos
        : {};
    const palabras = (jugador) => {
        const lista = equipos[jugador] && Array.isArray(equipos[jugador].palabras)
            ? equipos[jugador].palabras
            : [];
        return lista.slice(-120).map((item) => textoLimpio(item, 80)).filter(Boolean);
    };
    return { 1: palabras(1), 2: palabras(2) };
};

const diferenciaPalabras = (antes = [], despues = []) => {
    const restantes = [...antes];
    return despues.filter((palabra) => {
        const indice = restantes.indexOf(palabra);
        if (indice >= 0) {
            restantes.splice(indice, 1);
            return false;
        }
        return true;
    });
};

function crearEstadoDramaturgia({
    io = null,
    room = DRAMATURGIA_ROOM,
    obtenerEstadoActual = () => null,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    intervaloMs = DRAMATURGIA_INTERVALO_MS,
    maxEventos = DRAMATURGIA_MAX_EVENTOS,
    maxBytes = DRAMATURGIA_MAX_BYTES,
    textoReposoMs = DRAMATURGIA_TEXTO_REPOSO_MS,
    textoEsperaMaxMs = DRAMATURGIA_TEXTO_ESPERA_MAX_MS,
    textoEventoMax = DRAMATURGIA_TEXTO_EVENTO_MAX,
    registrar = () => {}
} = {}) {
    const limiteEventos = Math.max(20, numeroEntero(maxEventos, DRAMATURGIA_MAX_EVENTOS));
    const limiteBytes = Math.max(16 * 1024, numeroEntero(maxBytes, DRAMATURGIA_MAX_BYTES));
    const pulsoMs = Math.max(100, numeroEntero(intervaloMs, DRAMATURGIA_INTERVALO_MS));
    const reposoMs = Math.max(0, numeroEntero(textoReposoMs, DRAMATURGIA_TEXTO_REPOSO_MS));
    const esperaMaxMs = Math.max(reposoMs, numeroEntero(textoEsperaMaxMs, DRAMATURGIA_TEXTO_ESPERA_MAX_MS));
    const maxTexto = Math.max(200, numeroEntero(textoEventoMax, DRAMATURGIA_TEXTO_EVENTO_MAX));

    let numeroSesion = 0;
    let secuencia = 0;
    let secuenciaCheckpoint = 0;
    let eventos = [];
    let bytesEventos = 0;
    let descartados = 0;
    let intervalo = null;
    let inicializado = false;
    let contexto = { fase: "espera", modo: "", modo_seq: 0 };
    let huellas = {};
    let timelineVisto = new Set();
    let ultimaClaveTimelineInicial = "";
    let ultimoEventoModoId = "";
    let ultimoEventoPorClave = new Map();
    let pendientesTexto = { 1: null, 2: null };
    let ultimoTextoEmitido = { 1: "", 2: "" };
    let capturaActiva = null;

    const crearSesion = (ts = now()) => {
        numeroSesion += 1;
        return {
            id: `scrib-${Math.max(0, numeroEntero(ts, 0)).toString(36)}-${numeroSesion.toString(36)}`,
            started_at: Math.max(0, numeroEntero(ts, 0)),
            last_seq: 0
        };
    };

    let session = crearSesion();

    const idsRetenidos = () => new Set(eventos.map((evento) => evento.id));

    const reconciliarReferencias = () => {
        const retenidos = idsRetenidos();
        eventos = eventos.map((evento) => ({
            ...evento,
            causa_ids: evento.causa_ids.filter((id) => retenidos.has(id))
        }));
        for (const [clave, id] of ultimoEventoPorClave.entries()) {
            if (!retenidos.has(id)) {
                ultimoEventoPorClave.delete(clave);
            }
        }
        if (ultimoEventoModoId && !retenidos.has(ultimoEventoModoId)) {
            const ultimoModo = [...eventos].reverse().find((evento) => evento.tipo === "modo");
            ultimoEventoModoId = ultimoModo ? ultimoModo.id : "";
        }
    };

    const calcularBytesEvento = (evento) => {
        try {
            return Buffer.byteLength(JSON.stringify(evento), "utf8");
        } catch (_error) {
            return 0;
        }
    };

    const acotarEventos = () => {
        while (eventos.length > limiteEventos || (bytesEventos > limiteBytes && eventos.length > 1)) {
            const eliminado = eventos.shift();
            if (!eliminado) break;
            bytesEventos = Math.max(0, bytesEventos - calcularBytesEvento(eliminado));
            descartados += 1;
        }
        reconciliarReferencias();
    };

    const emitirEvento = (evento) => {
        if (!io || typeof io.to !== "function") return;
        const destino = io.to(room);
        if (destino && typeof destino.emit === "function") {
            destino.emit(DRAMATURGIA_EVENT, clonarJson(evento, evento));
        }
    };

    const emitirCheckpoint = (captura) => {
        if (!captura || !captura.eventos.length || !io || typeof io.to !== "function") {
            return null;
        }
        const eventIds = captura.eventos.map((evento) => evento.id);
        const idsPropios = new Set(eventIds);
        const causaIds = [...new Set(captura.eventos.flatMap((evento) => evento.causa_ids || []))]
            .filter((id) => !idsPropios.has(id));
        const payload = {
            id: captura.id,
            session_id: captura.session_id,
            ts: Math.max(0, numeroEntero(now(), 0)),
            seq_start: Math.min(...captura.eventos.map((evento) => evento.seq)),
            seq_end: Math.max(...captura.eventos.map((evento) => evento.seq)),
            event_ids: eventIds,
            causa_ids: causaIds
        };
        const destino = io.to(room);
        if (destino && typeof destino.emit === "function") {
            destino.emit(DRAMATURGIA_CHECKPOINT_EVENT, clonarJson(payload, payload));
        }
        return payload;
    };

    const crearCheckpointId = () => {
        secuenciaCheckpoint += 1;
        return `${session.id}:checkpoint:${secuenciaCheckpoint}`;
    };

    const resolverCheckpointId = (entrada) => {
        if (capturaActiva) {
            if (!capturaActiva.id) {
                capturaActiva.id = crearCheckpointId();
                capturaActiva.session_id = session.id;
            }
            return capturaActiva.id;
        }
        // Los eventos manuales son checkpoints atómicos: aceptan un id importado
        // o reciben uno propio, pero no emiten la envolvente final de una captura.
        const explicito = textoLimpio(entrada && entrada.checkpoint_id, 160);
        return explicito || crearCheckpointId();
    };

    const causasPorDefecto = (tipo, claveCausa = tipo) => {
        const causas = [];
        const previa = ultimoEventoPorClave.get(claveCausa);
        if (previa) causas.push(previa);
        if (tipo !== "modo" && ultimoEventoModoId) causas.push(ultimoEventoModoId);
        if (tipo === "modo" && ultimoEventoModoId) causas.push(ultimoEventoModoId);
        return [...new Set(causas)];
    };

    const acotarHechos = (valor) => {
        const hechos = clonarJson(valor && typeof valor === "object" ? valor : {}, {});
        let serializado = "";
        try {
            serializado = JSON.stringify(hechos);
        } catch (_error) {
            return {};
        }
        const maximoHechos = Math.min(64 * 1024, Math.max(4096, Math.floor(limiteBytes / 2)));
        if (Buffer.byteLength(serializado, "utf8") <= maximoHechos) {
            return hechos;
        }
        return {
            truncado: true,
            resumen: textoLimpio(serializado, Math.max(1000, Math.floor(maximoHechos / 2)))
        };
    };

    const registrarEvento = (entrada = {}) => {
        const tipo = textoLimpio(entrada.tipo || "estado", 64).toLowerCase() || "estado";
        const claveCausa = textoLimpio(entrada.clave_causa || tipo, 80) || tipo;
        const causasEntrada = Array.isArray(entrada.causa_ids)
            ? entrada.causa_ids.map((id) => textoLimpio(id, 160)).filter(Boolean)
            : causasPorDefecto(tipo, claveCausa);
        secuencia += 1;
        const evento = {
            id: `${session.id}:${secuencia}`,
            seq: secuencia,
            ts: Math.max(0, numeroEntero(entrada.ts, now())),
            checkpoint_id: resolverCheckpointId(entrada),
            tipo,
            titulo: textoLimpio(entrada.titulo || tipo, 120),
            detalle: textoLimpio(entrada.detalle, 360),
            espacio: textoLimpio(entrada.espacio || "sistema", 64).toLowerCase() || "sistema",
            fase: textoLimpio(entrada.fase || contexto.fase || "espera", 32).toLowerCase() || "espera",
            modo: textoLimpio(
                Object.prototype.hasOwnProperty.call(entrada, "modo") ? entrada.modo : contexto.modo,
                80
            ).toLowerCase(),
            modo_seq: Math.max(
                0,
                numeroEntero(
                    Object.prototype.hasOwnProperty.call(entrada, "modo_seq")
                        ? entrada.modo_seq
                        : contexto.modo_seq,
                    0
                )
            ),
            causa_ids: [...new Set(causasEntrada)].slice(0, 12),
            hechos: acotarHechos(entrada.hechos)
        };
        eventos.push(evento);
        bytesEventos += calcularBytesEvento(evento);
        session.last_seq = secuencia;
        ultimoEventoPorClave.set(claveCausa, evento.id);
        if (tipo === "modo") ultimoEventoModoId = evento.id;
        acotarEventos();
        if (capturaActiva) {
            capturaActiva.eventos.push(clonarJson(evento, evento));
        }
        emitirEvento(evento);
        return clonarJson(evento, evento);
    };

    const reiniciarDerivacion = () => {
        huellas = {};
        timelineVisto = new Set();
        ultimaClaveTimelineInicial = "";
        ultimoEventoModoId = "";
        ultimoEventoPorClave = new Map();
        pendientesTexto = { 1: null, 2: null };
        ultimoTextoEmitido = { 1: "", 2: "" };
    };

    const reiniciarDiario = () => {
        eventos = [];
        bytesEventos = 0;
        descartados = 0;
        reiniciarDerivacion();
        session.last_seq = secuencia;
    };

    const iniciarNuevaSesion = (ts, estado) => {
        secuencia = 0;
        eventos = [];
        bytesEventos = 0;
        descartados = 0;
        reiniciarDerivacion();
        session = crearSesion(ts);
        contexto = {
            fase: resolverFase(estado),
            modo: resolverModo(estado),
            modo_seq: resolverModoSeq(estado)
        };
        registrarEvento({
            tipo: "sesion",
            titulo: "Nueva sesi\u00f3n de juego",
            detalle: "El diario dramat\u00fargico comienza una nueva sesi\u00f3n.",
            espacio: "sistema",
            hechos: { motivo: "timeline_reiniciada" }
        });
    };

    const registrarSesionInicial = (estado) => {
        contexto = {
            fase: resolverFase(estado),
            modo: resolverModo(estado),
            modo_seq: resolverModoSeq(estado)
        };
        registrarEvento({
            tipo: "sesion",
            titulo: "Sesi\u00f3n dramat\u00fargica iniciada",
            detalle: "El servidor ha comenzado a observar los estados reales de SCRI-B.",
            espacio: "sistema",
            hechos: { origen: "runtime" }
        });
        inicializado = true;
    };

    const registrarCheckpointTexto = (jugador, pendiente, ts = now()) => {
        if (!pendiente || pendiente.firma === ultimoTextoEmitido[jugador]) return null;
        const texto = String(pendiente.texto || "");
        const textoGuardado = texto.length > maxTexto ? texto.slice(0, maxTexto) : texto;
        ultimoTextoEmitido[jugador] = pendiente.firma;
        return registrarEvento({
            tipo: "texto",
            clave_causa: `texto_${jugador}`,
            causa_ids: [
                ...causasPorDefecto("texto", `texto_${jugador}`),
                ultimoEventoPorClave.get(`inspiracion_${jugador}`)
            ].filter(Boolean),
            titulo: texto ? `Checkpoint de texto · Escritxr ${jugador}` : `Texto vaciado · Escritxr ${jugador}`,
            detalle: `${contarPalabras(texto)} palabras y ${texto.length} caracteres.`,
            espacio: `escritxr${jugador}`,
            ts,
            hechos: {
                player: jugador,
                texto: textoGuardado,
                texto_truncado: texto.length > maxTexto,
                extracto: textoLimpio(texto, 280),
                caracteres: texto.length,
                palabras: contarPalabras(texto),
                lineas: texto ? texto.split(/\r?\n/).length : 0,
                firma: pendiente.firma,
                actualizaciones: pendiente.actualizaciones,
                primera_actualizacion_ts: pendiente.primeraTs,
                ultima_actualizacion_ts: pendiente.ultimaTs
            }
        });
    };

    const capturarTextos = (estado, { forzar = false } = {}) => {
        const ahora = now();
        [1, 2].forEach((jugador) => {
            const texto = textoPlanoJugador(estado, jugador);
            const firma = firmaTexto(texto);
            const clave = `texto_observado_${jugador}`;
            const firmaAnterior = huellas[clave];
            if (firmaAnterior === undefined) {
                huellas[clave] = firma;
                ultimoTextoEmitido[jugador] = firmaTexto("");
                if (texto) {
                    pendientesTexto[jugador] = {
                        texto,
                        firma,
                        primeraTs: ahora,
                        ultimaTs: ahora,
                        actualizaciones: 1
                    };
                }
            } else if (firma !== firmaAnterior) {
                const pendienteAnterior = pendientesTexto[jugador];
                pendientesTexto[jugador] = {
                    texto,
                    firma,
                    primeraTs: pendienteAnterior ? pendienteAnterior.primeraTs : ahora,
                    ultimaTs: ahora,
                    actualizaciones: pendienteAnterior ? pendienteAnterior.actualizaciones + 1 : 1
                };
                huellas[clave] = firma;
            }
            const pendiente = pendientesTexto[jugador];
            if (!pendiente) return;
            const reposado = (ahora - pendiente.ultimaTs) >= reposoMs;
            const esperaAgotada = (ahora - pendiente.primeraTs) >= esperaMaxMs;
            const vaciado = pendiente.texto.length === 0;
            if (forzar || reposado || esperaAgotada || vaciado) {
                registrarCheckpointTexto(jugador, pendiente, ahora);
                pendientesTexto[jugador] = null;
            }
        });
    };

    const capturarTimeline = (estado) => {
        const timeline = estado && estado.partida && Array.isArray(estado.partida.timeline)
            ? estado.partida.timeline
            : [];
        const claves = timeline.map((item) => claveTimeline(item));
        const haySolape = claves.some((clave) => timelineVisto.has(clave));
        const claveInicial = claves[0] || "";
        if (
            inicializado
            && claveInicial
            && ultimaClaveTimelineInicial
            && claveInicial !== ultimaClaveTimelineInicial
            && timelineVisto.size > 0
            && !haySolape
        ) {
            iniciarNuevaSesion(now(), estado);
        }
        if (claveInicial) ultimaClaveTimelineInicial = claveInicial;

        let modoActualEmitido = false;
        timeline.forEach((item) => {
            const clave = claveTimeline(item);
            if (timelineVisto.has(clave)) return;
            timelineVisto.add(clave);
            const modo = textoLimpio(item && item.modo, 80).toLowerCase();
            if (!modo) return;
            registrarEvento({
                tipo: "modo",
                titulo: `Modo · ${modo}`,
                detalle: `El juego entra en ${modo}.`,
                espacio: "sistema",
                modo,
                ts: numeroEntero(item && item.ts, now()),
                hechos: {
                    modo,
                    origen: textoLimpio(item && item.origen, 80)
                }
            });
            if (modo === contexto.modo) modoActualEmitido = true;
        });
        return modoActualEmitido;
    };

    const capturarModoDirecto = (estado, modoActualEmitido) => {
        const modo = resolverModo(estado);
        const modoAnterior = huellas.modo_actual;
        const cambio = modoAnterior !== undefined && modoAnterior !== modo;
        if (modoAnterior === undefined) {
            huellas.modo_actual = modo;
            if (modo && !modoActualEmitido) {
                registrarEvento({
                    tipo: "modo",
                    titulo: `Modo · ${modo}`,
                    detalle: `Estado actual del modo ${modo}.`,
                    espacio: "sistema",
                    modo,
                    hechos: { modo, origen: "snapshot" }
                });
            }
            return Boolean(modo);
        }
        if (cambio && modo && !modoActualEmitido) {
            registrarEvento({
                tipo: "modo",
                titulo: `Modo · ${modo}`,
                detalle: `El juego cambia de ${modoAnterior || "espera"} a ${modo}.`,
                espacio: "sistema",
                modo,
                hechos: { modo, modo_anterior: modoAnterior, origen: "estado_actual" }
            });
        } else if (cambio && !modo && modoAnterior) {
            registrarEvento({
                tipo: "modo",
                titulo: "Modo finalizado",
                detalle: `Finaliza ${modoAnterior}.`,
                espacio: "sistema",
                modo: "",
                hechos: { modo_anterior: modoAnterior }
            });
        }
        huellas.modo_actual = modo;
        return cambio;
    };

    const capturarFase = (estado) => {
        const fase = resolverFase(estado);
        const anterior = huellas.fase;
        if (anterior === undefined) {
            huellas.fase = fase;
            if (fase !== "espera") {
                registrarEvento({
                    tipo: "fase",
                    titulo: `Fase · ${fase}`,
                    detalle: `La sesi\u00f3n se encuentra en ${fase}.`,
                    espacio: "escena",
                    fase,
                    hechos: { fase }
                });
            }
            return;
        }
        if (anterior !== fase) {
            registrarEvento({
                tipo: "fase",
                titulo: `Fase · ${fase}`,
                detalle: `La sesi\u00f3n pasa de ${anterior} a ${fase}.`,
                espacio: "escena",
                fase,
                hechos: { fase, fase_anterior: anterior }
            });
            huellas.fase = fase;
        }
    };

    const capturarInspiracion = (estado) => {
        const ultimas = estado && estado.inspiracion && estado.inspiracion.ultimas
            ? estado.inspiracion.ultimas
            : {};
        [1, 2].forEach((jugador) => {
            const item = ultimas[jugador];
            const clave = item
                ? firmaEstado([item.ts, item.palabra, item.musa, item.modo_actual])
                : "";
            const huellaClave = `inspiracion_ultima_${jugador}`;
            if (clave && clave !== huellas[huellaClave]) {
                registrarEvento({
                    tipo: "inspiracion",
                    clave_causa: `inspiracion_${jugador}`,
                    titulo: `Inspiraci\u00f3n · Equipo ${jugador}`,
                    detalle: item.musa
                        ? `${textoLimpio(item.musa, 48)} propone “${textoLimpio(item.palabra, 80)}”.`
                        : `Se propone “${textoLimpio(item.palabra, 80)}”.`,
                    espacio: "musas",
                    modo: item.modo_actual || contexto.modo,
                    ts: numeroEntero(item.ts, now()),
                    hechos: {
                        equipo: jugador,
                        palabra: textoLimpio(item.palabra, 120),
                        musa: textoLimpio(item.musa, 80)
                    }
                });
            }
            huellas[huellaClave] = clave;
        });

        const nube = resumenNube(estado);
        const nubeAnterior = huellas.nube_inspiracion;
        if (nubeAnterior) {
            const agregadas = {
                1: diferenciaPalabras(nubeAnterior[1], nube[1]),
                2: diferenciaPalabras(nubeAnterior[2], nube[2])
            };
            if (agregadas[1].length || agregadas[2].length) {
                registrarEvento({
                    tipo: "inspiracion_nube",
                    titulo: "Nube de inspiraci\u00f3n actualizada",
                    detalle: "Nuevas palabras han entrado en la reserva de las musas.",
                    espacio: "musas",
                    hechos: {
                        agregadas,
                        totales: { 1: nube[1].length, 2: nube[2].length }
                    }
                });
            }
        }
        huellas.nube_inspiracion = nube;
    };

    const capturarTeleprompter = (estado) => {
        const resumen = resumenTeleprompter(estado);
        const firma = firmaEstado(resumen);
        const anterior = huellas.teleprompter;
        huellas.teleprompter = firma;
        if (!anterior) {
            if (!resumen.visible && !resumen.reproduciendo && !resumen.caracteres) return;
        } else if (anterior === firma) {
            return;
        }
        registrarEvento({
            tipo: "teleprompter",
            causa_ids: [
                ...causasPorDefecto("teleprompter", "teleprompter"),
                (resumen.fuente === 1 || resumen.fuente === 2)
                    ? ultimoEventoPorClave.get(`texto_${resumen.fuente}`)
                    : ""
            ].filter(Boolean),
            titulo: resumen.visible
                ? (resumen.reproduciendo ? "Teleprompter en reproducci\u00f3n" : "Teleprompter visible")
                : "Teleprompter oculto",
            detalle: resumen.caracteres
                ? `${resumen.caracteres} caracteres preparados para escena.`
                : "Sin texto activo.",
            espacio: "escena",
            hechos: resumen
        });
    };

    const capturarCompeticion = (estado) => {
        const resumen = resumenCompeticionRonda(estado);
        const firma = firmaEstado(resumen);
        if (huellas.competicion === firma) return;
        huellas.competicion = firma;
        registrarEvento({
            tipo: "competicion_ronda",
            clave_causa: "competicion_ronda",
            titulo: resumen.activa ? `Competici\u00f3n · ${resumen.modo}` : "Competici\u00f3n en pausa",
            detalle: `Azul ${resumen.marcador[1]} · ${resumen.marcador[2]} Rojo`,
            espacio: "sistema",
            hechos: resumen
        });
    };

    const capturarRelojPartida = (estado) => {
        const resumen = resumenRelojPartida(estado);
        const bucket = Math.floor(resumen.tiempo_restante_segundos / 10);
        const firma = firmaEstado({ ...resumen, tiempo_restante_segundos: bucket });
        if (huellas.reloj_partida === firma) return;
        huellas.reloj_partida = firma;
        registrarEvento({
            tipo: "reloj_partida",
            clave_causa: "reloj_partida",
            titulo: resumen.pausado ? "Reloj de partida pausado" : "Reloj de partida",
            detalle: `${resumen.tiempo_restante_segundos} segundos restantes.`,
            espacio: "sistema",
            hechos: resumen
        });
    };

    const capturarCalentamiento = (estado) => {
        const resumen = resumenCalentamiento(estado);
        const firma = firmaEstado(resumen);
        const anterior = huellas.calentamiento;
        huellas.calentamiento = firma;
        if (!anterior && !resumen.activo && !resumen.vista) return;
        if (anterior === firma) return;
        registrarEvento({
            tipo: "calentamiento",
            titulo: resumen.activo || resumen.vista ? "Calentamiento activo" : "Calentamiento finalizado",
            detalle: resumen.solicitud || "Estado del calentamiento actualizado.",
            espacio: "musas",
            fase: "calentamiento",
            hechos: resumen
        });
    };

    const capturarVistaEspectador = (estado) => {
        const resumen = resumenVistaEspectador(estado);
        const firma = firmaEstado(resumen);
        const anterior = huellas.vista_espectador;
        huellas.vista_espectador = firma;
        const esVistaBase = (!resumen.modo || resumen.modo === "partida")
            && (!resumen.override || resumen.override === "partida")
            && !resumen.calentamiento_vista
            && resumen.stats_slide_step === 0;
        if (!anterior && esVistaBase) return;
        if (anterior === firma) return;
        registrarEvento({
            tipo: "vista_espectador",
            titulo: `Proyecci\u00f3n · ${resumen.modo || "partida"}`,
            detalle: `La vista p\u00fablica cambia a ${resumen.modo || "partida"}.`,
            espacio: "escena",
            hechos: resumen
        });
    };

    const capturarDesventajas = (estado) => {
        const resumen = resumenDesventajas(estado);
        const firma = firmaEstado(resumen);
        const anterior = huellas.desventajas;
        huellas.desventajas = firma;
        if (!anterior && !resumen.length) return;
        if (anterior === firma) return;
        registrarEvento({
            tipo: "desventaja",
            causa_ids: causasPorDefecto("desventaja", "desventaja"),
            titulo: resumen.length ? "Desventaja activa" : "Desventaja finalizada",
            detalle: resumen.length
                ? resumen.map((item) => `J${item.player}: ${item.putada}`).join(" · ")
                : "No quedan desventajas activas.",
            espacio: resumen.length === 1 ? `escritxr${resumen[0].player}` : "sistema",
            hechos: { activas: resumen }
        });
    };

    const capturarCorazones = (estado) => {
        const corazones = estado && estado.musas && estado.musas.corazones
            ? estado.musas.corazones
            : {};
        [1, 2].forEach((equipo) => {
            const data = corazones[equipo] || {};
            const count = Math.max(0, numeroEntero(data.count, 0));
            const clave = `corazones_${equipo}`;
            const anterior = huellas[clave];
            huellas[clave] = count;
            if (anterior === undefined || count <= anterior) return;
            registrarEvento({
                tipo: "corazones",
                clave_causa: clave,
                titulo: `Corazones · Equipo ${equipo}`,
                detalle: `${count - anterior} nueva${count - anterior === 1 ? "" : "s"} reacci\u00f3n de las musas.`,
                espacio: "musas",
                ts: numeroEntero(data.ts, now()),
                hechos: {
                    equipo,
                    total: count,
                    incremento: count - anterior
                }
            });
        });
    };

    const capturarPresencias = (estado) => {
        const actual = resumenConexiones(estado);
        const anterior = huellas.presencias;
        huellas.presencias = actual;
        if (!anterior) {
            const conectadas = Object.entries(actual)
                .filter(([, count]) => count > 0)
                .map(([rol, count]) => ({ rol, antes: 0, ahora: count }));
            if (!conectadas.length) return;
            registrarEvento({
                tipo: "presencias",
                titulo: "Roles conectados",
                detalle: `${conectadas.length} presencias activas al iniciar el diario.`,
                espacio: "sistema",
                hechos: { cambios: conectadas, conexiones: actual }
            });
            return;
        }
        const cambios = Object.keys(actual)
            .filter((rol) => actual[rol] !== anterior[rol])
            .map((rol) => ({ rol, antes: anterior[rol], ahora: actual[rol] }));
        if (!cambios.length) return;
        registrarEvento({
            tipo: "presencias",
            titulo: "Presencias actualizadas",
            detalle: cambios.map((item) => `${item.rol}: ${item.antes}→${item.ahora}`).join(" · "),
            espacio: "sistema",
            hechos: { cambios, conexiones: actual }
        });
    };

    const capturar = (estadoEntrada = undefined) => {
        let estado = estadoEntrada;
        try {
            if (estado === undefined) estado = obtenerEstadoActual();
        } catch (error) {
            registrar(`[dramaturgia] no se pudo obtener el estado actual: ${error && error.message ? error.message : error}`);
            return [];
        }
        if (!estado || typeof estado !== "object") return [];
        const capturaAnterior = capturaActiva;
        const captura = { id: "", session_id: "", eventos: [] };
        capturaActiva = captura;
        let completada = false;
        try {
            if (!inicializado) registrarSesionInicial(estado);

            contexto = {
                fase: resolverFase(estado),
                modo: resolverModo(estado),
                modo_seq: resolverModoSeq(estado)
            };
            const modoTimelineEmitido = capturarTimeline(estado);
            contexto = {
                fase: resolverFase(estado),
                modo: resolverModo(estado),
                modo_seq: resolverModoSeq(estado)
            };
            capturarFase(estado);
            const cambioModo = capturarModoDirecto(estado, modoTimelineEmitido);
            capturarInspiracion(estado);
            capturarTextos(estado, { forzar: cambioModo });
            capturarTeleprompter(estado);
            capturarCompeticion(estado);
            capturarRelojPartida(estado);
            capturarCalentamiento(estado);
            capturarVistaEspectador(estado);
            capturarDesventajas(estado);
            capturarCorazones(estado);
            capturarPresencias(estado);
            completada = true;
            return captura.eventos.map((evento) => clonarJson(evento, evento));
        } finally {
            capturaActiva = capturaAnterior;
            if (completada) emitirCheckpoint(captura);
        }
    };

    const snapshot = () => ({
        session: { ...session },
        eventos: eventos.map((evento) => clonarJson(evento, evento))
    });

    const metricas = () => ({
        session_id: session.id,
        seq: secuencia,
        eventos: eventos.length,
        bytes: bytesEventos,
        descartados,
        max_eventos: limiteEventos,
        max_bytes: limiteBytes,
        intervalo_activo: Boolean(intervalo)
    });

    const iniciar = () => {
        if (intervalo) return intervalo;
        capturar();
        intervalo = setIntervalFn(() => {
            capturar();
        }, pulsoMs);
        if (intervalo && typeof intervalo.unref === "function") {
            intervalo.unref();
        }
        return intervalo;
    };

    const detener = () => {
        if (!intervalo) return false;
        clearIntervalFn(intervalo);
        intervalo = null;
        return true;
    };

    return {
        capturar,
        detener,
        iniciar,
        metricas,
        registrarEvento,
        reiniciarDiario,
        snapshot
    };
}

module.exports = {
    DRAMATURGIA_CHECKPOINT_EVENT,
    DRAMATURGIA_EVENT,
    DRAMATURGIA_INTERVALO_MS,
    DRAMATURGIA_MAX_BYTES,
    DRAMATURGIA_MAX_EVENTOS,
    DRAMATURGIA_ROOM,
    crearEstadoDramaturgia,
    firmaTexto,
    resolverFase
};
