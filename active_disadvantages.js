function crearGestorDesventajasActivas({
    validarJugador = (player) => Number(player) || null,
    getDuracionMs = () => 0,
    now = () => Date.now()
} = {}) {
    const estado = {
        1: null,
        2: null
    };

    const normalizarJugador = (player) => {
        const id = validarJugador(player);
        return id === 1 || id === 2 ? id : null;
    };

    const normalizarDuracion = (valor) => {
        const numero = Number(valor);
        if (Number.isFinite(numero) && numero > 0) {
            return Math.max(1, Math.trunc(numero));
        }
        const fallback = Number(getDuracionMs());
        return Number.isFinite(fallback) && fallback > 0
            ? Math.max(1, Math.trunc(fallback))
            : 0;
    };

    const restanteDe = (item, ahora = now()) => {
        if (!item) return 0;
        if (item.pausada) {
            return Math.max(0, Math.trunc(Number(item.restanteMs) || 0));
        }
        return Math.max(0, Math.trunc(Number(item.terminaEnTs) - ahora));
    };

    const snapshotJugador = (player) => {
        const id = normalizarJugador(player);
        if (!id || !estado[id]) return null;
        const ahora = now();
        const restanteMs = restanteDe(estado[id], ahora);
        if (restanteMs <= 0) {
            estado[id] = null;
            return null;
        }
        const item = estado[id];
        return {
            player: id,
            putada: item.putada,
            duracion_ms: item.duracionMs,
            tiempo_restante_ms: restanteMs,
            restante_ms: restanteMs,
            termina_en_ts: item.pausada ? 0 : item.terminaEnTs,
            pausada: Boolean(item.pausada),
            now: ahora
        };
    };

    const registrar = (player, putada, opciones = {}) => {
        const id = normalizarJugador(player);
        const clave = String(putada || opciones.putada || opciones.seleccion || "").trim();
        if (!id || !clave) return null;
        const duracion = normalizarDuracion(
            opciones.duracionMs
            ?? opciones.duracion_ms
            ?? opciones.tiempo_restante_ms
            ?? opciones.restante_ms
        );
        if (duracion <= 0) {
            estado[id] = null;
            return null;
        }
        const ahora = now();
        estado[id] = {
            player: id,
            putada: clave,
            inicioTs: ahora,
            duracionMs: duracion,
            terminaEnTs: ahora + duracion,
            pausada: false,
            restanteMs: duracion
        };
        return snapshotJugador(id);
    };

    const limpiarJugador = (player) => {
        const id = normalizarJugador(player);
        if (id) {
            estado[id] = null;
        }
    };

    const reset = () => {
        estado[1] = null;
        estado[2] = null;
    };

    const snapshotActivas = () => [snapshotJugador(1), snapshotJugador(2)].filter(Boolean);

    const pausar = () => {
        [1, 2].forEach((id) => {
            const item = estado[id];
            if (!item || item.pausada) return;
            const restanteMs = restanteDe(item);
            if (restanteMs <= 0) {
                estado[id] = null;
                return;
            }
            estado[id] = {
                ...item,
                pausada: true,
                restanteMs,
                terminaEnTs: 0
            };
        });
        return snapshotActivas();
    };

    const reanudar = () => {
        const ahora = now();
        [1, 2].forEach((id) => {
            const item = estado[id];
            if (!item || !item.pausada) return;
            const restanteMs = restanteDe(item, ahora);
            if (restanteMs <= 0) {
                estado[id] = null;
                return;
            }
            estado[id] = {
                ...item,
                pausada: false,
                inicioTs: ahora,
                duracionMs: restanteMs,
                restanteMs,
                terminaEnTs: ahora + restanteMs
            };
        });
        return snapshotActivas();
    };

    return {
        limpiarJugador,
        pausar,
        registrar,
        reset,
        reanudar,
        snapshotActivas,
        snapshotJugador
    };
}

module.exports = {
    crearGestorDesventajasActivas
};
