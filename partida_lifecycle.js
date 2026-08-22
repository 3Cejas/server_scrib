function crearCicloPartida({
    state,
    io,
    partidaSync,
    limpiezasModo,
    limpiarTimersPalabras,
    limpiarTimersRonda,
    limpiarTodosLosModos,
    activarSocketsExtratextuales,
    resetearEstadoAuxiliarParaTests,
    resetearEstadoResurreccion,
    payloadEstadoResurreccion,
    musasAuxiliares,
    prepararParametrosInicio,
    getRanges,
    statsLive,
    emitirStatsLive,
    puntuacionFinal = null,
    emitirPuntuacionFinal = () => null,
    emitirNubeInspiracionEstado,
    emitirModoActual,
    limpiarDesventajasActivas = () => {},
    setPartidaPausada = () => {},
    registrarTimelineModo,
    motorModos,
    programarInicioTimer,
    reiniciarMusasCreditosPartida = () => {},
    limpiarMusasCreditosPartida = () => {},
    registrar = () => {}
}) {
    const emitirMenusResurreccion = () => {
        io.emit('resucitar_menu', payloadEstadoResurreccion()[1]);
        io.emit('resucitar_menu', payloadEstadoResurreccion()[2]);
    };

    const limpiarModoActual = (socket) => {
        const modo = state.modoActual;
        if (modo && limpiezasModo[modo]) {
            limpiezasModo[modo](socket);
        }
    };

    const prepararCapturaPuntuacionFinal = () => {
        if (!puntuacionFinal || typeof puntuacionFinal.prepararCaptura !== "function") {
            return false;
        }
        return puntuacionFinal.prepararCaptura();
    };

    const resetearPuntuacionFinal = () => {
        if (puntuacionFinal && typeof puntuacionFinal.reset === "function") {
            puntuacionFinal.reset();
        }
        return emitirPuntuacionFinal();
    };

    const resetearCursoPartida = ({ reiniciarIndice = true, resetearStats = false } = {}) => {
        state.modosPendientes = [...state.listaModos];
        if (reiniciarIndice) {
            state.indiceModo = 0;
        }
        state.modoAnterior = "";
        state.modoActual = "";
        state.modoPendienteVentaja = "";
        partidaSync.siguienteModoSeq();
        partidaSync.resetTiempoSeq();
        partidaSync.resetConteoSync();
        if (resetearStats) {
            if (typeof statsLive.reset === "function") {
                statsLive.reset();
            } else {
                statsLive.actualizar({ modo_actual: "" });
            }
            emitirStatsLive();
        }
        emitirNubeInspiracionEstado(null, true);
    };

    const reiniciarEstadoPartida = (socket, opciones = {}) => {
        const prepararPuntuacion = opciones.prepararPuntuacion !== false
            && opciones.capturarPuntuacion !== false;
        const conservarStats = opciones.conservarStats !== false;
        if (prepararPuntuacion) {
            prepararCapturaPuntuacionFinal();
        } else if (opciones.resetearPuntuacion === true) {
            resetearPuntuacionFinal();
        }
        state.finJ1 = false;
        state.finJ2 = false;
        state.transicionModoEnCurso = false;
        state.estadoJugadores[1].finished = true;
        state.estadoJugadores[2].finished = true;
        state.finDelJuego = true;
        setPartidaPausada(false);
        limpiarTimersPalabras();
        limpiarTimersRonda();
        limpiarModoActual(socket);
        limpiarDesventajasActivas();
        activarSocketsExtratextuales(socket);
        resetearEstadoResurreccion();
        resetearCursoPartida({
            reiniciarIndice: false,
            resetearStats: !conservarStats
        });
        emitirMenusResurreccion();
    };

    const finalizarPartida = (socket) => {
        prepararCapturaPuntuacionFinal();
        state.finJ1 = true;
        state.finJ2 = true;
        state.transicionModoEnCurso = false;
        state.estadoJugadores[1].finished = true;
        state.estadoJugadores[2].finished = true;
        state.finDelJuego = true;
        setPartidaPausada(false);
        limpiarTimersPalabras();
        limpiarTimersRonda();
        limpiarModoActual(socket);
        limpiarDesventajasActivas();
        activarSocketsExtratextuales(socket);
        resetearEstadoResurreccion();
        resetearCursoPartida({ reiniciarIndice: true, resetearStats: false });
        emitirMenusResurreccion();
        io.emit('fin_a_control');
    };

    const iniciarPartida = (socket, datos = {}) => {
        const parametros = (datos && datos.parametros) || {};
        limpiarTimersRonda();
        resetearEstadoAuxiliarParaTests();
        resetearPuntuacionFinal();
        limpiarDesventajasActivas();
        setPartidaPausada(false);
        musasAuxiliares.resetRegalos({ emitir: true });
        reiniciarMusasCreditosPartida();
        prepararParametrosInicio(parametros);

        state.modosPendientes = [...state.listaModos];
        partidaSync.resetTiempoSeq();
        partidaSync.resetConteoSync();
        state.tiempos = getRanges(datos.count, state.listaModos.length + 1);
        state.estadoJugadores[1].finished = false;
        state.estadoJugadores[2].finished = false;
        state.finDelJuego = false;
        state.finJ1 = false;
        state.finJ2 = false;
        state.indiceModo = 0;
        state.reiniciarLetrasPendientes();
        state.modoAnterior = "";
        state.modoActual = "";
        state.modoPendienteVentaja = "";
        partidaSync.siguienteModoSeq();
        if (typeof statsLive.reset === "function") {
            statsLive.reset();
        } else {
            statsLive.actualizar({ modo_actual: "" });
        }
        emitirStatsLive();
        state.tiempoCambioModos = state.duracionTiempoModos;
        socket.broadcast.emit('inicio', datos);
        emitirModoActual();
        registrar(state.modosPendientes);

        state.modoAnterior = state.modoActual;
        state.modoActual = state.modosPendientes[0] || "";
        state.modosPendientes = state.modosPendientes.slice(1);
        partidaSync.siguienteModoSeq();
        registrarTimelineModo(state.modoActual, 'inicio');
        emitirNubeInspiracionEstado(null, true);
        programarInicioTimer(() => {
            socket.broadcast.emit('post-inicio', { borrar_texto: datos.borrar_texto });
            motorModos.activarModo(state.modoActual, socket);
            emitirNubeInspiracionEstado(null, true);
            motorModos.temp_modos(socket);
        }, 4000);
    };

    const limpiarPartida = (socket, evento) => {
        activarSocketsExtratextuales(socket);
        limpiarTimersPalabras();
        limpiarTimersRonda();
        resetearEstadoAuxiliarParaTests();
        resetearPuntuacionFinal();
        limpiarDesventajasActivas();
        setPartidaPausada(false);
        state.estadoJugadores[1].finished = true;
        state.estadoJugadores[2].finished = true;
        musasAuxiliares.resetRegalos({ emitir: true });
        limpiarMusasCreditosPartida();
        limpiarTodosLosModos();
        state.finDelJuego = true;
        state.modosPendientes = [...state.listaModos];
        state.indiceModo = 0;
        state.modoAnterior = "";
        state.modoActual = "";
        state.modoPendienteVentaja = "";
        partidaSync.siguienteModoSeq();
        if (typeof statsLive.reset === "function") {
            statsLive.reset();
        } else {
            statsLive.actualizar({ modo_actual: "" });
        }
        emitirStatsLive();
        state.nuevaPalabraJ1 = false;
        state.nuevaPalabraJ2 = false;
        state.tiempoCambioModos = state.duracionTiempoModos;
        emitirNubeInspiracionEstado(null, true);
        socket.broadcast.emit('limpiar', evento);
        emitirModoActual();
    };

    const registrarHandlers = (socket) => {
        socket.on('inicio', (datos) => iniciarPartida(socket, datos));
        socket.on('limpiar', (evento) => limpiarPartida(socket, evento));
    };

    return {
        finalizarPartida,
        iniciarPartida,
        limpiarPartida,
        registrarHandlers,
        reiniciarEstadoPartida
    };
}

module.exports = {
    crearCicloPartida
};
