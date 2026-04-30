const Musas = require('./musas');
const PalabrasBonusMode = require('./palabras_bonus.js');
const PalabrasMalditasMode = require('./palabras_malditas.js');
const { crearGestorTimersPartida } = require('./partida_timers.js');

const LETRAS_PROHIBIDAS = ['e', 'a', 'o', 's', 'r', 'n', 'i', 'd', 'l', 'c'];
const LETRAS_BENDITAS = ['z', 'j', 'ÃƒÂ±', 'x', 'k', 'w', 'y', 'q', 'h', 'f'];
const LISTA_MODOS_DEFAULT = ["letra bendita", "letra prohibida", "tertulia", "palabras bonus", "palabras prohibidas"];

function crearRuntimeModos({
    io,
    partidaSync,
    validarJugador,
    registrar = () => {}
}) {
    let cambio_palabra_j1 = false;
    let cambio_palabra_j2 = false;
    const estado_jugadores = {
        1: { inserts: -1, finished: false },
        2: { inserts: -1, finished: false }
    };

    let segundos_transcurridos = 0;
    let modo_actual = "";
    let modo_anterior = "";
    let indice_modo = 0;
    let letra_prohibida = "";
    let letra_bendita = "";
    let letras_benditas_pendientes = [...LETRAS_BENDITAS];
    let letras_prohibidas_pendientes = [...LETRAS_PROHIBIDAS];
    let tiempos = [];
    let lista_modos = [...LISTA_MODOS_DEFAULT];
    let modos_pendientes;

    let fin_j1 = false;
    let fin_j2 = false;
    let fin_del_juego = false;
    let nueva_palabra_j1 = false;
    let nueva_palabra_j2 = false;
    let TIEMPO_CAMBIO_PALABRAS;
    let DURACION_TIEMPO_MODOS;
    let TIEMPO_CAMBIO_MODOS;
    let TIEMPO_BORROSO;
    let PALABRAS_INSERTADAS_META;
    let TIEMPO_VOTACION;
    let TIEMPO_CAMBIO_LETRA;
    let repentizado_enviado = false;
    let transicion_modo_en_curso = false;

    const timersPartida = crearGestorTimersPartida({ getModoActual: () => modo_actual });

    const decorarPayloadModoMotor = (payload = {}) => {
        const salida = (payload && typeof payload === "object") ? payload : {};
        return partidaSync ? partidaSync.withModoSeq(salida) : { ...salida, modo_seq: 0 };
    };

    let modo_bonus = new PalabrasBonusMode(io, 300000, decorarPayloadModoMotor);
    let modo_malditas = new PalabrasMalditasMode(io, 30000, decorarPayloadModoMotor);
    let modo_musas = new Musas(io, 30000, decorarPayloadModoMotor);

    const actualizarTimeoutModo = (modo, tiempoMs) => {
        if (!modo) return;
        modo.timeout = tiempoMs;
        if (typeof modo.clearAll === 'function') {
            modo.clearAll();
        }
    };

    const limpiarTodosLosModos = () => {
        if (modo_musas) modo_musas.clearAll();
        if (modo_bonus) modo_bonus.clearAll();
        if (modo_malditas) modo_malditas.clearAll();
    };

    const limpiarTimersPalabras = () => {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        timersPartida.cancelarCambioLetra();
    };

    const cancelarCambioPalabra = (player) => {
        if (player === 1) {
            clearTimeout(cambio_palabra_j1);
        } else if (player === 2) {
            clearTimeout(cambio_palabra_j2);
        }
    };

    const limpiarTimersRonda = () => {
        timersPartida.cancelarRonda();
    };

    const limpiezasModo = {
        'palabras bonus': function () {
            modo_bonus.clearAll();
        },

        'letra prohibida': function () {
            modo_musas.clearAll();
            clearTimeout(cambio_palabra_j1);
            clearTimeout(cambio_palabra_j2);
            timersPartida.cancelarCambioLetra();
            letra_prohibida = "";
        },

        'letra bendita': function () {
            modo_musas.clearAll();
            clearTimeout(cambio_palabra_j1);
            clearTimeout(cambio_palabra_j2);
            timersPartida.cancelarCambioLetra();
            letra_bendita = "";
        },

        'texto borroso': function () {},

        'psicodÃƒÂ©lico': function () {},

        'texto inverso': function () {},

        'tertulia': function () {},

        'palabras prohibidas': function () {
            modo_malditas.clearAll();
        },

        'frase final': function () {
            fin_j1 = true;
            fin_j2 = true;
            fin_del_juego = true;
            estado_jugadores[1].finished = true;
            estado_jugadores[2].finished = true;
        },

        '': function () {}
    };

    function construirPayloadInspiracionMusaActual() {
        if (modo_actual === "letra prohibida") {
            return partidaSync.withModoSeq({ modo_actual, letra_prohibida });
        }
        if (modo_actual === "letra bendita") {
            return partidaSync.withModoSeq({ modo_actual, letra_bendita });
        }
        if (
            modo_actual === "palabras bonus" ||
            modo_actual === "palabras prohibidas" ||
            modo_actual === "tertulia" ||
            modo_actual === "frase final"
        ) {
            return partidaSync.withModoSeq({ modo_actual });
        }
        return null;
    }

    function emitirEventoModo(nombreEvento, payload = {}, socketDestino = null) {
        const salida = partidaSync.withModoSeq(payload);
        const destino = socketDestino && typeof socketDestino.emit === "function"
            ? socketDestino
            : io;
        destino.emit(nombreEvento, salida);
        return salida;
    }

    function emitirActivarModo(payload = {}, socketDestino = null) {
        const salida = emitirEventoModo("activar_modo", payload, socketDestino);
        emitirModoActual(socketDestino);
        return salida;
    }

    function emitirPedirInspiracionMusa(payload = {}, socketDestino = null) {
        return emitirEventoModo("pedir_inspiracion_musa", payload, socketDestino);
    }

    function emitirTempModos(socketDestino = null) {
        return emitirEventoModo("temp_modos", { segundos_transcurridos, modo_actual }, socketDestino);
    }

    function emitirNuevaLetra(tipo, letra, socketDestino = null) {
        const valor = String(letra || "").trim();
        const payload = { modo_actual, letra: valor };
        if (tipo === "bendita") {
            payload.letra_bendita = valor;
        } else if (tipo === "prohibida") {
            payload.letra_prohibida = valor;
        }
        return emitirEventoModo("nueva letra", payload, socketDestino);
    }

    function emitirModoActual(socketDestino = null) {
        const payload = construirPayloadInspiracionMusaActual() || partidaSync.withModoSeq({ modo_actual: "" });
        const destino = socketDestino && typeof socketDestino.emit === "function"
            ? socketDestino
            : io;
        destino.emit("modo_actual", payload);
        return payload;
    }

    function construirPayloadCount(datos = {}) {
        const payload = { ...((datos && typeof datos === "object") ? datos : {}) };
        const playerId = validarJugador(payload.player);
        payload.modo_actual = modo_actual;
        const salida = partidaSync.construirPayloadCount(payload);
        if (playerId && Number.isFinite(Number(salida.tiempo_seq))) {
            salida.tiempo_seq = Math.max(0, Math.trunc(Number(salida.tiempo_seq)));
        }
        return salida;
    }

    const avanzarModoSeguro = (socket, avanzarFn, origen = "", { limpiarActual = true } = {}) => {
        if (transicion_modo_en_curso) {
            registrar(`Transicion de modo ignorada por reentrada: ${origen}`);
            return false;
        }
        if (typeof avanzarFn !== 'function') {
            return false;
        }
        transicion_modo_en_curso = true;
        try {
            if (limpiarActual && modo_actual && limpiezasModo[modo_actual]) {
                limpiezasModo[modo_actual](socket);
            }
            avanzarFn();
            return true;
        } finally {
            transicion_modo_en_curso = false;
        }
    };

    const estadoMotorModos = {
        get segundosTranscurridos() { return segundos_transcurridos; },
        set segundosTranscurridos(valor) { segundos_transcurridos = Number(valor) || 0; },
        get modoActual() { return modo_actual; },
        set modoActual(valor) { modo_actual = typeof valor === 'string' ? valor : ''; },
        get modoAnterior() { return modo_anterior; },
        set modoAnterior(valor) { modo_anterior = typeof valor === 'string' ? valor : ''; },
        get indiceModo() { return Number(indice_modo) || 0; },
        set indiceModo(valor) { indice_modo = Math.max(0, Math.trunc(Number(valor) || 0)); },
        get modosPendientes() { return Array.isArray(modos_pendientes) ? modos_pendientes : []; },
        set modosPendientes(valor) { modos_pendientes = Array.isArray(valor) ? valor : []; },
        get letraProhibida() { return letra_prohibida; },
        set letraProhibida(valor) { letra_prohibida = typeof valor === 'string' ? valor : ''; },
        get letraBendita() { return letra_bendita; },
        set letraBendita(valor) { letra_bendita = typeof valor === 'string' ? valor : ''; },
        get letrasProhibidasPendientes() { return letras_prohibidas_pendientes; },
        set letrasProhibidasPendientes(valor) { letras_prohibidas_pendientes = Array.isArray(valor) ? valor : [...LETRAS_PROHIBIDAS]; },
        get letrasBenditasPendientes() { return letras_benditas_pendientes; },
        set letrasBenditasPendientes(valor) { letras_benditas_pendientes = Array.isArray(valor) ? valor : [...LETRAS_BENDITAS]; },
        get tiempoCambioModos() { return TIEMPO_CAMBIO_MODOS; },
        set tiempoCambioModos(valor) { TIEMPO_CAMBIO_MODOS = Number(valor) || 0; },
        get tiempoCambioLetra() { return TIEMPO_CAMBIO_LETRA; },
        get tiempoBorroso() { return TIEMPO_BORROSO; },
        get repentizadoEnviado() { return Boolean(repentizado_enviado); },
        set repentizadoEnviado(valor) { repentizado_enviado = Boolean(valor); }
    };

    const prepararParametrosInicio = (parametros = {}) => {
        TIEMPO_CAMBIO_PALABRAS = parametros.TIEMPO_CAMBIO_PALABRAS;
        DURACION_TIEMPO_MODOS = parametros.DURACION_TIEMPO_MODOS;
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        TIEMPO_BORROSO = parametros.TIEMPO_BORROSO;
        PALABRAS_INSERTADAS_META = parametros.PALABRAS_INSERTADAS_META;
        TIEMPO_VOTACION = parametros.TIEMPO_VOTACION;
        TIEMPO_CAMBIO_LETRA = parametros.TIEMPO_CAMBIO_LETRA;
        lista_modos = parametros.LISTA_MODOS || parametros.lista_modos || lista_modos;

        if (!modo_bonus) modo_bonus = new PalabrasBonusMode(io, TIEMPO_CAMBIO_PALABRAS, decorarPayloadModoMotor);
        if (!modo_malditas) modo_malditas = new PalabrasMalditasMode(io, TIEMPO_CAMBIO_PALABRAS, decorarPayloadModoMotor);
        if (!modo_musas) modo_musas = new Musas(io, TIEMPO_CAMBIO_PALABRAS, decorarPayloadModoMotor);
        actualizarTimeoutModo(modo_bonus, TIEMPO_CAMBIO_PALABRAS);
        actualizarTimeoutModo(modo_malditas, TIEMPO_CAMBIO_PALABRAS);
        actualizarTimeoutModo(modo_musas, TIEMPO_CAMBIO_PALABRAS);
    };

    const estadoCicloPartida = {
        estadoJugadores: estado_jugadores,
        get finJ1() { return fin_j1; },
        set finJ1(valor) { fin_j1 = Boolean(valor); },
        get finJ2() { return fin_j2; },
        set finJ2(valor) { fin_j2 = Boolean(valor); },
        get finDelJuego() { return fin_del_juego; },
        set finDelJuego(valor) { fin_del_juego = Boolean(valor); },
        get nuevaPalabraJ1() { return nueva_palabra_j1; },
        set nuevaPalabraJ1(valor) { nueva_palabra_j1 = Boolean(valor); },
        get nuevaPalabraJ2() { return nueva_palabra_j2; },
        set nuevaPalabraJ2(valor) { nueva_palabra_j2 = Boolean(valor); },
        get transicionModoEnCurso() { return transicion_modo_en_curso; },
        set transicionModoEnCurso(valor) { transicion_modo_en_curso = Boolean(valor); },
        get modoActual() { return modo_actual; },
        set modoActual(valor) { modo_actual = typeof valor === 'string' ? valor : ''; },
        get modoAnterior() { return modo_anterior; },
        set modoAnterior(valor) { modo_anterior = typeof valor === 'string' ? valor : ''; },
        get indiceModo() { return Number(indice_modo) || 0; },
        set indiceModo(valor) { indice_modo = Math.max(0, Math.trunc(Number(valor) || 0)); },
        get listaModos() { return Array.isArray(lista_modos) ? lista_modos : []; },
        set listaModos(valor) { lista_modos = Array.isArray(valor) ? valor : []; },
        get modosPendientes() { return Array.isArray(modos_pendientes) ? modos_pendientes : []; },
        set modosPendientes(valor) { modos_pendientes = Array.isArray(valor) ? valor : []; },
        get duracionTiempoModos() { return DURACION_TIEMPO_MODOS; },
        get tiempoCambioModos() { return TIEMPO_CAMBIO_MODOS; },
        set tiempoCambioModos(valor) { TIEMPO_CAMBIO_MODOS = Number(valor) || 0; },
        get tiempos() { return tiempos; },
        set tiempos(valor) { tiempos = Array.isArray(valor) ? valor : []; },
        marcarFinJugador: (player, terminado) => {
            if (player === 1) fin_j1 = Boolean(terminado);
            if (player === 2) fin_j2 = Boolean(terminado);
        },
        setNuevaPalabra: (player, valor) => {
            if (player === 1) nueva_palabra_j1 = Boolean(valor);
            if (player === 2) nueva_palabra_j2 = Boolean(valor);
        },
        reiniciarLetrasPendientes: () => {
            letras_benditas_pendientes = [...LETRAS_BENDITAS];
            letras_prohibidas_pendientes = [...LETRAS_PROHIBIDAS];
        }
    };

    const snapshotPartidaTest = (timeline = []) => ({
        modo_actual,
        modo_anterior,
        modos_pendientes: Array.isArray(modos_pendientes) ? [...modos_pendientes] : [],
        indice_modo: Number(indice_modo) || 0,
        fin_j1: Boolean(fin_j1),
        fin_j2: Boolean(fin_j2),
        fin_del_juego: Boolean(fin_del_juego),
        letra_prohibida,
        letra_bendita,
        timeline: [...timeline]
    });

    return {
        timersPartida,
        limpiezasModo,
        estadoMotorModos,
        estadoCicloPartida,
        letrasBenditas: LETRAS_BENDITAS,
        letrasProhibidas: LETRAS_PROHIBIDAS,
        estadoJugadores: estado_jugadores,
        construirPayloadInspiracionMusaActual,
        emitirEventoModo,
        emitirActivarModo,
        emitirPedirInspiracionMusa,
        emitirTempModos,
        emitirNuevaLetra,
        emitirModoActual,
        construirPayloadCount,
        prepararParametrosInicio,
        limpiarTodosLosModos,
        limpiarTimersPalabras,
        cancelarCambioPalabra,
        limpiarTimersRonda,
        avanzarModoSeguro,
        snapshotPartidaTest,
        getModoActual: () => modo_actual,
        getModoBonus: () => modo_bonus,
        getModoMalditas: () => modo_malditas,
        getModoMusas: () => modo_musas,
        getTiempoVotacion: () => TIEMPO_VOTACION,
        getPalabrasInsertadasMeta: () => PALABRAS_INSERTADAS_META
    };
}

module.exports = {
    crearRuntimeModos
};
