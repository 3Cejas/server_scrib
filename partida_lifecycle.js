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
    resetearCompeticion = () => {},
    iniciarCompeticionRonda = () => {},
    iniciarRelojPartida = () => {},
    detenerRelojPartida = () => {},
    setPartidaPausada = () => {},
    registrarTimelineModo,
    motorModos,
    programarInicioTimer,
    reiniciarMusasCreditosPartida = () => {},
    limpiarMusasCreditosPartida = () => {},
    iniciarNuevaSesionMusas = () => ({ ok: true }),
    preShowMusas = null,
    videoTutorialPreShow = null,
    registrar = () => {}
}) {
    const cerrarPreShow = (motivo) => {
        if (preShowMusas && typeof preShowMusas.cerrar === "function") {
            preShowMusas.cerrar(motivo);
        }
        if (videoTutorialPreShow && typeof videoTutorialPreShow.cerrarFase === "function") {
            videoTutorialPreShow.cerrarFase(motivo);
        }
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
        cerrarPreShow("fin_partida");
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
        resetearCompeticion();
        detenerRelojPartida();
        activarSocketsExtratextuales(socket);
        resetearCursoPartida({
            reiniciarIndice: false,
            resetearStats: !conservarStats
        });
    };

    const finalizarPartida = (socket) => {
        if (state.finDelJuego) return false;
        cerrarPreShow("fin_partida");
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
        resetearCompeticion();
        detenerRelojPartida();
        activarSocketsExtratextuales(socket);
        resetearCursoPartida({ reiniciarIndice: true, resetearStats: false });
        io.emit('fin', {
            player: 1,
            partida_finalizada: true,
            origen: 'reloj_partida'
        });
        io.emit('fin', {
            player: 2,
            partida_finalizada: true,
            origen: 'reloj_partida'
        });
        io.emit('fin_a_control', { partida_finalizada: true });
        return true;
    };

    const iniciarPartida = (socket, datos = {}) => {
        cerrarPreShow("inicio_partida");
        const parametros = (datos && datos.parametros) || {};
        limpiarTimersRonda();
        resetearEstadoAuxiliarParaTests();
        resetearPuntuacionFinal();
        limpiarDesventajasActivas();
        resetearCompeticion();
        detenerRelojPartida();
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
            const nivelesEscritura = state.listaModos.filter((modo) => modo !== 'tertulia').length;
            const totalEscritura = Math.max(
                1,
                Math.trunc(Number(state.duracionTiempoModos) || 0) * Math.max(1, nivelesEscritura)
            );
            iniciarRelojPartida(totalEscritura);
            iniciarCompeticionRonda(state.modoActual);
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
        resetearCompeticion();
        detenerRelojPartida();
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
        if (preShowMusas && typeof preShowMusas.abrir === "function") {
            preShowMusas.abrir();
        }
        if (videoTutorialPreShow && typeof videoTutorialPreShow.abrirFase === "function") {
            videoTutorialPreShow.abrirFase();
        }
        emitirModoActual();
    };

    const prepararNuevaPartida = (socket) => {
        limpiarPartida(socket, { nueva_partida: true });
        return iniciarNuevaSesionMusas();
    };

    const registrarHandlers = (socket) => {
        socket.on('inicio', (datos) => {
            if (!socket.control && !socket.simulacion_scrib) return;
            iniciarPartida(socket, datos);
        });
        socket.on('limpiar', (evento) => {
            if (!socket.control && !socket.simulacion_scrib) return;
            limpiarPartida(socket, evento);
        });
        socket.on('nueva_partida', (_evento = {}, callback = null) => {
            if (!socket.control && !socket.simulacion_scrib) {
                if (typeof callback === "function") callback({ ok: false, code: "FORBIDDEN" });
                return;
            }
            const resultado = prepararNuevaPartida(socket);
            if (typeof callback === "function") callback({ ok: true, ...resultado });
        });
        socket.on('finalizar_partida', () => {
            if (!socket.control && !socket.simulacion_scrib) return;
            finalizarPartida(socket);
        });
    };

    return {
        finalizarPartida,
        iniciarPartida,
        prepararNuevaPartida,
        limpiarPartida,
        registrarHandlers,
        reiniciarEstadoPartida
    };
}

module.exports = {
    crearCicloPartida
};
