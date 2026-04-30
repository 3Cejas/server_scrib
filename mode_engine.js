function debeLanzarVentaja(prev, curr) {
    return (
        prev !== ''
        && curr !== 'tertulia'
    );
}

function elegirLetraPendiente({ pendientes, base }) {
    const lista = Array.isArray(pendientes) && pendientes.length > 0
        ? pendientes
        : [...base];
    const indice = Math.floor(Math.random() * lista.length);
    const letra = lista[indice];
    lista.splice(indice, 1);
    return {
        letra,
        pendientes: lista.length === 0 ? [...base] : lista
    };
}

function crearMotorModos({
    state,
    io,
    timersPartida,
    partidaSync,
    registrar = () => {},
    registrarTimelineModo = () => {},
    limpiarTodosLosModos = () => {},
    avanzarModoSeguro = () => false,
    finalizarPartida = () => {},
    emitirTempModos = () => {},
    emitirActivarModo = () => {},
    emitirModoActual = () => {},
    emitirPedirInspiracionMusa = () => {},
    emitirNuevaLetra = () => {},
    emitirNubeInspiracionEstado = () => {},
    statsLive,
    payloadStatsLive = () => ({}),
    emitirStatsLive = () => {},
    votacionVentaja,
    getModoBonus,
    getModoMalditas,
    getModoMusas,
    estadoJugadores,
    letrasBenditas,
    letrasProhibidas
}) {
    const modoBonus = () => getModoBonus();
    const modoMalditas = () => getModoMalditas();
    const modoMusas = () => getModoMusas();

    const reiniciarMusas = () => {
        const musas = modoMusas();
        musas.clearAll();
        musas.start(1);
        musas.start(2);
    };

    const programarLetraBendita = () => {
        timersPartida.programarCambioLetra("letra bendita", nueva_letra_bendita, state.tiempoCambioLetra);
    };

    const programarLetraProhibida = () => {
        timersPartida.programarCambioLetra("letra prohibida", nueva_letra_prohibida, state.tiempoCambioLetra);
    };

    const activarLetraBendita = () => {
        const seleccion = elegirLetraPendiente({
            pendientes: state.letrasBenditasPendientes,
            base: letrasBenditas
        });
        state.letraBendita = seleccion.letra;
        state.letrasBenditasPendientes = seleccion.pendientes;
        emitirPedirInspiracionMusa({ modo_actual: state.modoActual, letra_bendita: state.letraBendita });
        programarLetraBendita();
        Object.values(estadoJugadores).forEach((jugador) => {
            jugador.inserts = -1;
            jugador.finished = false;
        });
        reiniciarMusas();
        registrar(state.letraBendita);
        emitirActivarModo({ modo_actual: state.modoActual, letra_bendita: state.letraBendita });
    };

    const activarLetraProhibida = () => {
        const seleccion = elegirLetraPendiente({
            pendientes: state.letrasProhibidasPendientes,
            base: letrasProhibidas
        });
        state.letraProhibida = seleccion.letra;
        state.letrasProhibidasPendientes = seleccion.pendientes;
        emitirPedirInspiracionMusa({ modo_actual: state.modoActual, letra_prohibida: state.letraProhibida });
        programarLetraProhibida();
        reiniciarMusas();
        emitirActivarModo({ modo_actual: state.modoActual, letra_prohibida: state.letraProhibida });
    };

    const MODOS = {
        'palabras bonus': function () {
            emitirActivarModo({ modo_actual: state.modoActual });
            registrar("activado palabras bonus");
            emitirPedirInspiracionMusa({ modo_actual: state.modoActual });
            modoBonus().clearAll();
            modoBonus().start(1);
            modoBonus().start(2);
        },

        'letra prohibida': function () {
            registrar("activado letra prohibida");
            activarLetraProhibida();
        },

        'letra bendita': function () {
            registrar(state.modoActual);
            activarLetraBendita();
        },

        'texto borroso': function () {
            const jugador = Math.floor(Math.random() * 2) + 1;
            const duracion = state.tiempoBorroso;
            emitirActivarModo({ modo_actual: state.modoActual, jugador, duracion });
        },

        'psicodÃ©lico': function () {
            emitirActivarModo({ modo_actual: state.modoActual });
        },

        'texto inverso': function () {
            emitirActivarModo({ modo_actual: state.modoActual });
        },

        'tertulia': function () {
            emitirPedirInspiracionMusa({ modo_actual: state.modoActual });
            emitirActivarModo({ modo_actual: state.modoActual });
            io.emit('tiempo_muerto_control', '');
        },

        'palabras prohibidas': function () {
            emitirActivarModo({ modo_actual: state.modoActual });
            registrar("activado palabras prohibidas");
            emitirPedirInspiracionMusa({ modo_actual: state.modoActual });
            modoMalditas().clearAll();
            modoMalditas().start(1);
            modoMalditas().start(2);
        },

        'frase final': function () {
            emitirPedirInspiracionMusa({ modo_actual: state.modoActual });
            emitirActivarModo({ modo_actual: state.modoActual });
        },

        '': function () {}
    };

    const tieneModo = (modo) => Object.prototype.hasOwnProperty.call(MODOS, modo);

    const activarModo = (modo, socket) => {
        if (!tieneModo(modo)) {
            return false;
        }
        MODOS[modo](socket);
        return true;
    };

    function temp_modos(socket) {
        state.segundosTranscurridos = 0;
        timersPartida.programarIntervaloModos(() => {
            state.segundosTranscurridos += 1;
            emitirTempModos();
            if (state.segundosTranscurridos >= state.tiempoCambioModos) {
                if (state.modoActual === "frase final") {
                    return;
                }
                state.segundosTranscurridos = 0;
                avanzarModoSeguro(socket, () => modos_de_juego(socket), 'temp_modos');
            }
        }, 1000);
    }

    function lanzarVentaja(socket, ganador, perdedor) {
        votacionVentaja.lanzar({
            socket,
            ganador,
            perdedor,
            onCierreAutomatico: () => {
                sincro_modos();
                state.repentizadoEnviado = true;
            }
        });
    }

    function modos_de_juego(socket) {
        if (estadoJugadores[1].finished && estadoJugadores[2].finished) return;

        registrar('Modos restantes:', state.modosPendientes.slice(state.indiceModo));

        const prev = state.modoActual;
        const indiceActual = state.indiceModo;
        const curr = state.modosPendientes[indiceActual] || '';
        state.indiceModo = indiceActual + 1;
        if (!curr) {
            finalizarPartida(socket);
            return;
        }

        state.modoAnterior = prev;
        state.modoActual = curr;
        partidaSync.siguienteModoSeq();
        registrar(`MODO ANTERIOR: ${prev} | MODO ACTUAL: ${curr}`);
        registrarTimelineModo(curr, 'modos_de_juego');

        limpiarTodosLosModos();
        activarModo(curr, socket);
        emitirNubeInspiracionEstado(null, true);
        statsLive.actualizar({
            ...payloadStatsLive(),
            modo_actual: curr
        });
        emitirStatsLive();
        state.repentizadoEnviado = false;

        registrar('DEBE LANZAR VENTAJA:', debeLanzarVentaja(prev, curr));

        if (debeLanzarVentaja(prev, curr)) {
            let counterMode;
            if (prev === 'palabras bonus') {
                counterMode = modoBonus();
            } else if (prev === 'palabras prohibidas') {
                counterMode = modoMalditas();
            } else {
                counterMode = modoMusas();
            }

            registrar(counterMode);
            let j1 = counterMode.getInsertedCount(1);
            let j2 = counterMode.getInsertedCount(2);
            registrar(`Palabras pedidas -> J1: ${j1} | J2: ${j2}`);

            if (j1 === j2) {
                Math.random() < 0.5 ? j1++ : j2++;
            }

            if (j1 > j2) {
                lanzarVentaja(socket, 'j1', 'j2');
            } else {
                lanzarVentaja(socket, 'j2', 'j1');
            }

            counterMode.clearCounters();
            return;
        }

        if (
            !prev
            && curr !== 'tertulia'
            && !state.repentizadoEnviado
        ) {
            // Reservado para reactivar repentizado inicial si vuelve a usarse.
        }

        registrar('Fin modos_de_juego para modo:', curr);
    }

    function nueva_letra_bendita() {
        partidaSync.siguienteModoSeq();
        const seleccion = elegirLetraPendiente({
            pendientes: state.letrasBenditasPendientes,
            base: letrasBenditas
        });
        state.letraBendita = seleccion.letra;
        state.letrasBenditasPendientes = seleccion.pendientes;
        emitirNuevaLetra("bendita", state.letraBendita);
        modoMusas().clearAll();
        emitirPedirInspiracionMusa({ modo_actual: state.modoActual, letra_bendita: state.letraBendita });
        modoMusas().start(1);
        modoMusas().start(2);
        registrar("LETRA BENDITA", state.letraBendita);
        programarLetraBendita();
    }

    function nueva_letra_prohibida() {
        partidaSync.siguienteModoSeq();
        const seleccion = elegirLetraPendiente({
            pendientes: state.letrasProhibidasPendientes,
            base: letrasProhibidas
        });
        state.letraProhibida = seleccion.letra;
        state.letrasProhibidasPendientes = seleccion.pendientes;
        emitirNuevaLetra("prohibida", state.letraProhibida);
        modoMusas().clearAll();
        emitirPedirInspiracionMusa({ modo_actual: state.modoActual, letra_prohibida: state.letraProhibida });
        modoMusas().start(1);
        modoMusas().start(2);
        programarLetraProhibida();
    }

    function sincro_modos(socket = null) {
        if (
            state.modoActual === "letra prohibida"
            || state.modoActual === "letra bendita"
            || state.modoActual === "palabras bonus"
            || state.modoActual === "palabras prohibidas"
            || state.modoActual === "tertulia"
            || state.modoActual === "frase final"
        ) {
            emitirModoActual(socket || null);
        }
    }

    return {
        MODOS,
        activarModo,
        debeLanzarVentaja,
        modos_de_juego,
        nueva_letra_bendita,
        nueva_letra_prohibida,
        sincro_modos,
        temp_modos,
        tieneModo
    };
}

module.exports = {
    crearMotorModos,
    debeLanzarVentaja,
    elegirLetraPendiente
};
