const { BOLZANO_EVENTS } = require("./bolzano_events.js");
const {
    MAX_PALABRA_CALENTAMIENTO,
    crearEstadoCalentamiento,
    limpiarPalabra,
    normalizarPalabra
} = require("./warmup.js");

const crearEstadoBase = () => ({
    activo: true,
    vista: true,
    equipos: {
        1: crearEstadoCalentamiento(),
        2: crearEstadoCalentamiento()
    }
});

function crearGestorCalentamientoBolzano({
    io,
    validarJugador
}) {
    const musasPorEquipo = { 1: new Map(), 2: new Map() };
    const estado = crearEstadoBase();

    const obtenerJugador = (valor) => {
        if (typeof validarJugador === "function") {
            return validarJugador(valor);
        }
        const id = Number(valor);
        return id === 1 || id === 2 ? id : null;
    };

    const obtenerSemillasPublicas = (data) => {
        if (data.semillas[1] && data.semillas[2]) {
            return data.semillas;
        }
        return { 1: null, 2: null };
    };

    const estadoEquipo = (equipo) => {
        const data = estado.equipos[equipo];
        return {
            semillas: obtenerSemillasPublicas(data),
            semillasTs: data.semillas_ts,
            semillasRecibidas: {
                1: Boolean(data.semillas[1]),
                2: Boolean(data.semillas[2])
            },
            intentos: data.intentos,
            aciertos: data.aciertos,
            estado: data.estado,
            pendiente: Boolean(data.pendiente),
            pendientePalabra: data.pendiente ? data.pendiente.palabra : null,
            pendienteSocketId: data.pendiente ? data.pendiente.socketId : null,
            ultimoIntento: data.ultimo_intento,
            usadas: Array.from(data.usadas.values()),
            historial: Array.isArray(data.historial) ? data.historial.slice(-6) : []
        };
    };

    const registrarHistorial = (data, palabra1, palabra2, exito) => {
        const padres = [data.semillas[1] || "--", data.semillas[2] || "--"];
        const hijos = exito ? [palabra1] : [palabra1, palabra2];
        data.historial.push({
            padres,
            hijos,
            exito: Boolean(exito)
        });
        if (data.historial.length > 8) {
            data.historial.shift();
        }
    };

    const elegirSemillasEquipo = (equipo) => {
        const ids = Array.from(musasPorEquipo[equipo].keys());
        const data = estado.equipos[equipo];
        if (ids.length === 0) {
            data.asignadas[1] = null;
            data.asignadas[2] = null;
            data.estado = "sin_musas";
            return;
        }
        if (ids.length === 1) {
            data.asignadas[1] = ids[0];
            data.asignadas[2] = ids[0];
            data.estado = "esperando_semillas";
            return;
        }
        const idx1 = Math.floor(Math.random() * ids.length);
        let idx2 = idx1;
        while (idx2 === idx1) {
            idx2 = Math.floor(Math.random() * ids.length);
        }
        data.asignadas[1] = ids[idx1];
        data.asignadas[2] = ids[idx2];
        data.estado = "esperando_semillas";
    };

    const revisarAsignacionesEquipo = (equipo) => {
        if (!estado.activo) return;
        const data = estado.equipos[equipo];
        const ids = Array.from(musasPorEquipo[equipo].keys());
        if (ids.length === 0) {
            data.asignadas[1] = null;
            data.asignadas[2] = null;
            if (!data.semillas[1] || !data.semillas[2]) {
                data.estado = "sin_musas";
            }
            return;
        }
        [1, 2].forEach((posicion) => {
            if (data.semillas[posicion]) return;
            const asignada = data.asignadas[posicion];
            if (asignada && musasPorEquipo[equipo].has(asignada)) return;
            const otra = posicion === 2 ? data.asignadas[1] : data.asignadas[2];
            const candidatos = ids.filter((id) => id !== otra || ids.length === 1);
            const elegido = candidatos[Math.floor(Math.random() * candidatos.length)];
            data.asignadas[posicion] = elegido || ids[0];
        });
        if (!data.semillas[1] || !data.semillas[2]) {
            data.estado = "esperando_semillas";
        }
    };

    const reiniciarEquipo = (equipo, mantenerAciertos = true) => {
        const aciertos = mantenerAciertos ? (estado.equipos[equipo].aciertos || 0) : 0;
        estado.equipos[equipo] = crearEstadoCalentamiento(aciertos);
        elegirSemillasEquipo(equipo);
    };

    const construirPayloadMusa = (equipo, socketId) => {
        const data = estado.equipos[equipo];
        const esSemilla1 = data.asignadas[1] === socketId;
        const esSemilla2 = data.asignadas[2] === socketId;
        const rol = esSemilla1 && esSemilla2
            ? "semilla_doble"
            : (esSemilla1 ? "semilla1" : (esSemilla2 ? "semilla2" : "musa"));
        return {
            activo: estado.activo,
            vista: estado.vista,
            equipo,
            rol,
            semillas: obtenerSemillasPublicas(data),
            semillasTs: data.semillas_ts,
            semillasRecibidas: {
                1: Boolean(data.semillas[1]),
                2: Boolean(data.semillas[2])
            },
            intentos: data.intentos,
            aciertos: data.aciertos,
            estado: data.estado,
            pendiente: Boolean(data.pendiente),
            pendientePalabra: data.pendiente ? data.pendiente.palabra : null,
            pendienteSocketId: data.pendiente ? data.pendiente.socketId : null,
            ultimoIntento: data.ultimo_intento,
            usadas: Array.from(data.usadas.values())
        };
    };

    const emitirEstadoMusa = (equipo, socketObjetivo = null) => {
        if (socketObjetivo) {
            const payload = construirPayloadMusa(equipo, socketObjetivo.id);
            socketObjetivo.emit(BOLZANO_EVENTS.STATE_MUSA, payload);
            return payload;
        }
        let ultimo = null;
        musasPorEquipo[equipo].forEach((info, socketId) => {
            ultimo = construirPayloadMusa(equipo, socketId);
            info.socket.emit(BOLZANO_EVENTS.STATE_MUSA, ultimo);
        });
        return ultimo;
    };

    const emitirEstado = () => {
        emitirEstadoMusa(1);
        emitirEstadoMusa(2);
    };

    const iniciar = () => {
        estado.activo = true;
        estado.vista = true;
        [1, 2].forEach((equipo) => {
            reiniciarEquipo(equipo, true);
        });
        emitirEstado();
    };

    const reiniciarMarcador = () => {
        [1, 2].forEach((equipo) => {
            const data = estado.equipos[equipo];
            data.intentos = 0;
            data.aciertos = 0;
        });
        emitirEstado();
    };

    const registrarMusa = (socket, equipo, nombre = "MUSA") => {
        const equipoPrevio = obtenerJugador(socket.musa_bolzano);
        if (equipoPrevio && equipoPrevio !== equipo) {
            musasPorEquipo[equipoPrevio].delete(socket.id);
            const previoData = estado.equipos[equipoPrevio];
            if (previoData.pendiente && previoData.pendiente.socketId === socket.id) {
                previoData.pendiente = null;
            }
            revisarAsignacionesEquipo(equipoPrevio);
        }

        socket.musa_bolzano = equipo;
        socket.nombre_musa_bolzano = nombre;
        socket.join(BOLZANO_EVENTS.roomMusa(equipo));
        musasPorEquipo[equipo].set(socket.id, { socket, nombre });

        if (estado.activo) {
            revisarAsignacionesEquipo(equipo);
            emitirEstado();
        } else {
            emitirEstadoMusa(equipo, socket);
        }
    };

    const desregistrarMusa = (socket, equipo) => {
        if (equipo !== 1 && equipo !== 2) return false;
        musasPorEquipo[equipo].delete(socket.id);
        const data = estado.equipos[equipo];
        if (data.pendiente && data.pendiente.socketId === socket.id) {
            data.pendiente = null;
        }
        if (!data.semillas[1] || !data.semillas[2]) {
            revisarAsignacionesEquipo(equipo);
        }
        emitirEstado();
        return true;
    };

    const manejarSemilla = (socket, payload = {}) => {
        const equipo = obtenerJugador(socket.musa_bolzano);
        if (!equipo || !estado.activo) {
            return;
        }
        const data = estado.equipos[equipo];
        if (data.estado === "sin_musas") {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "No hay musas suficientes." });
            return;
        }
        const posicion = Number(payload.posicion);
        if (posicion !== 1 && posicion !== 2) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Posicion invalida." });
            return;
        }
        if (data.asignadas[posicion] !== socket.id) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "No eres musa semilla." });
            return;
        }
        if (data.semillas[posicion]) {
            return;
        }
        const palabra = limpiarPalabra(payload.palabra);
        if (/\s/.test(palabra)) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Solo una palabra, sin espacios." });
            return;
        }
        const normalizada = normalizarPalabra(palabra);
        if (!normalizada) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Escribe una palabra valida." });
            return;
        }
        if (palabra.length > MAX_PALABRA_CALENTAMIENTO) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "La palabra es demasiado larga." });
            return;
        }
        if (data.usadas.has(normalizada)) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Esa palabra ya esta usada." });
            return;
        }
        data.semillas[posicion] = palabra;
        if (data.semillas[1] && data.semillas[2]) {
            data.semillas_ts = Date.now();
            const normalizada1 = normalizarPalabra(data.semillas[1]);
            const normalizada2 = normalizarPalabra(data.semillas[2]);
            if (normalizada1 === normalizada2) {
                registrarHistorial(data, data.semillas[1], data.semillas[2], true);
                data.intentos += 1;
                data.aciertos += 1;
                data.estado = "ganado";
                data.usadas.set(normalizada1, data.semillas[1]);
                data.pendiente = null;
                io.to(BOLZANO_EVENTS.roomMusa(equipo)).emit(BOLZANO_EVENTS.WON, {
                    equipo,
                    palabra: data.semillas[1]
                });
                emitirEstado();
                setTimeout(() => {
                    if (!estado.activo) return;
                    reiniciarEquipo(equipo, true);
                    emitirEstado();
                }, 2500);
                return;
            }
            data.usadas.set(normalizada1, data.semillas[1]);
            data.usadas.set(normalizada2, data.semillas[2]);
            data.estado = "jugando";
            data.pendiente = null;
        } else {
            data.estado = "esperando_semillas";
        }
        emitirEstado();
    };

    const manejarIntento = (socket, payload = {}) => {
        const equipo = obtenerJugador(socket.musa_bolzano);
        if (!equipo || !estado.activo) {
            return;
        }
        const data = estado.equipos[equipo];
        if (data.estado !== "jugando") {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "El calentamiento no esta listo." });
            return;
        }
        const palabra = limpiarPalabra(payload.palabra);
        if (/\s/.test(palabra)) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Solo una palabra, sin espacios." });
            return;
        }
        const normalizada = normalizarPalabra(palabra);
        if (!normalizada) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Escribe una palabra valida." });
            return;
        }
        if (palabra.length > MAX_PALABRA_CALENTAMIENTO) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "La palabra es demasiado larga." });
            return;
        }
        if (data.usadas.has(normalizada)) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Esa palabra ya esta usada." });
            return;
        }
        if (data.pendiente && data.pendiente.socketId === socket.id) {
            socket.emit(BOLZANO_EVENTS.ERROR, { mensaje: "Espera a otra musa." });
            return;
        }
        if (!data.pendiente) {
            data.pendiente = { socketId: socket.id, palabra, normalizada };
            emitirEstado();
            return;
        }
        data.intentos += 1;
        if (data.pendiente.normalizada === normalizada) {
            data.ultimo_intento = {
                palabras: [data.pendiente.palabra, palabra],
                exito: true,
                id: Date.now(),
                ts: Date.now()
            };
            registrarHistorial(data, data.pendiente.palabra, palabra, true);
            data.aciertos += 1;
            data.estado = "ganado";
            data.usadas.set(normalizada, palabra);
            data.pendiente = null;
            io.to(BOLZANO_EVENTS.roomMusa(equipo)).emit(BOLZANO_EVENTS.WON, {
                equipo,
                palabra
            });
            emitirEstado();
            setTimeout(() => {
                if (!estado.activo) return;
                reiniciarEquipo(equipo, true);
                emitirEstado();
            }, 11000);
            return;
        }
        data.ultimo_intento = {
            palabras: [data.pendiente.palabra, palabra],
            exito: false,
            id: Date.now(),
            ts: Date.now()
        };
        registrarHistorial(data, data.pendiente.palabra, palabra, false);
        data.usadas.set(data.pendiente.normalizada, data.pendiente.palabra);
        data.usadas.set(normalizada, palabra);
        data.semillas[1] = data.pendiente.palabra;
        data.semillas[2] = palabra;
        data.pendiente = null;
        data.estado = "jugando";
        emitirEstado();
    };

    const registrarHandlers = (socket) => {
        socket.on(BOLZANO_EVENTS.REQUEST_STATE, () => {
            const equipo = obtenerJugador(socket.musa_bolzano);
            if (!equipo) return;
            emitirEstadoMusa(equipo, socket);
        });

        socket.on(BOLZANO_EVENTS.RESET_WARMUP, () => {
            iniciar();
        });

        socket.on(BOLZANO_EVENTS.RESET_SCORE, () => {
            reiniciarMarcador();
        });

        socket.on(BOLZANO_EVENTS.SUBMIT_SEED, (payload = {}) => {
            manejarSemilla(socket, payload);
        });

        socket.on(BOLZANO_EVENTS.SUBMIT_ATTEMPT, (payload = {}) => {
            manejarIntento(socket, payload);
        });
    };

    return {
        desregistrarMusa,
        emitirEstado,
        emitirEstadoMusa,
        estado,
        estadoEquipo,
        iniciar,
        registrarHandlers,
        registrarMusa,
        reiniciarMarcador
    };
}

module.exports = {
    crearGestorCalentamientoBolzano
};
