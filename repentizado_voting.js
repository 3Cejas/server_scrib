const crearVotosRepentizado = () => ({
    "1": 0,
    "2": 0,
    "3": 0
});

function opcionConMasVotos(votaciones, registrar = () => {}) {
    let maxVotos = -1;
    let opcionesConMaxVotos = [];
    const opciones = Object.keys(votaciones || {});

    for (const opcion of opciones) {
        if (votaciones[opcion] > maxVotos) {
            maxVotos = votaciones[opcion];
            opcionesConMaxVotos = [opcion];
        } else if (votaciones[opcion] === maxVotos) {
            opcionesConMaxVotos.push(opcion);
        }
    }

    if (opcionesConMaxVotos.length !== 1) {
        registrar("AZAR");
        const indiceAleatorio = Math.floor(Math.random() * opcionesConMaxVotos.length);
        return opcionesConMaxVotos[indiceAleatorio];
    }

    return opcionesConMaxVotos[0];
}

function crearGestorVotacionRepentizado({
    io,
    repentizados = [],
    getTiempoVotacion = () => 0,
    scheduleTimer = () => {},
    syncMode = () => {},
    registrar = () => {}
} = {}) {
    const baseRepentizados = Array.isArray(repentizados) ? [...repentizados] : [];
    let votos = crearVotosRepentizado();
    let pendientes = [...baseRepentizados];

    const reset = () => {
        votos = crearVotosRepentizado();
        pendientes = [...baseRepentizados];
    };

    const registrarVoto = (voto) => {
        const opcion = String(voto || "");
        if (!Object.prototype.hasOwnProperty.call(votos, opcion)) {
            return false;
        }
        votos[opcion] += 1;
        return true;
    };

    const escogerSeleccionados = () => {
        const seleccionados = [];
        for (let i = 0; i < 3; i += 1) {
            if (!pendientes.length) {
                pendientes = [...baseRepentizados];
            }
            if (!pendientes.length) {
                break;
            }
            const indice = Math.floor(Math.random() * pendientes.length);
            seleccionados.push(pendientes[indice]);
            pendientes.splice(indice, 1);
        }
        return seleccionados;
    };

    const lanzar = () => {
        const seleccionados = escogerSeleccionados();
        const tiempoVotacion = getTiempoVotacion();
        io.emit("elegir_repentizado", { seleccionados, TIEMPO_VOTACION: tiempoVotacion });
        scheduleTimer(() => {
            io.removeAllListeners("enviar_voto_repentizado");
            const opcionGanadora = opcionConMasVotos(votos, registrar);
            io.emit("enviar_repentizado", seleccionados[parseInt(opcionGanadora, 10) - 1]);
            votos = crearVotosRepentizado();
            syncMode();
        }, tiempoVotacion);
        return seleccionados;
    };

    const registrarHandlers = (socket) => {
        socket.on("enviar_voto_repentizado", (voto) => {
            registrarVoto(voto);
        });
    };

    return {
        lanzar,
        registrarHandlers,
        registrarVoto,
        reset,
        snapshotVotos: () => ({ ...votos })
    };
}

module.exports = {
    crearGestorVotacionRepentizado,
    crearVotosRepentizado,
    opcionConMasVotos
};
