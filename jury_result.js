const JURY_RESULT_SCHEMA_VERSION = 2;
const JURY_RESULT_CRITERIA = Object.freeze([
    { id: "idea", scope: "writing", label: "Idea y mundo" },
    { id: "voz", scope: "writing", label: "Voz" },
    { id: "estructura", scope: "writing", label: "Estructura" },
    { id: "riesgo", scope: "writing", label: "Riesgo" },
    { id: "cierre", scope: "writing", label: "Cierre" },
    { id: "inspiracion", scope: "muses", label: "Inspiración útil" },
    { id: "escucha", scope: "muses", label: "Escucha" },
    { id: "ritmo", scope: "muses", label: "Ritmo" },
    { id: "cooperacion", scope: "muses", label: "Cooperación" }
]);
const JURY_RESULT_SLIDE_MAX = JURY_RESULT_CRITERIA.length + 1;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const cleanName = (value, player) => {
    const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return name || `ESCRITXR ${player}`;
};

const cleanScore = (value) => {
    const score = Number(value);
    return Number.isFinite(score) ? Math.round(clamp(score, 0, 10) * 10) / 10 : 0;
};

const cleanCriterion = (value = {}, expected = {}) => {
    const input = value && typeof value === "object" ? value : {};
    const scores = input.valores && typeof input.valores === "object" ? input.valores : {};
    const score1 = cleanScore(scores[1] ?? scores["1"]);
    const score2 = cleanScore(scores[2] ?? scores["2"]);
    const difference = Math.round(Math.abs(score1 - score2) * 10) / 10;
    const tie = difference < 0.05;
    return {
        id: expected.id,
        scope: expected.scope,
        label: expected.label,
        valores: { 1: score1, 2: score2 },
        ganador: tie ? null : (score1 > score2 ? 1 : 2),
        empate: tie
    };
};

const normalizeCriteria = (value) => {
    const input = Array.isArray(value) ? value : [];
    return JURY_RESULT_CRITERIA.map((expected) => {
        const match = input.find((criterion) => (
            criterion
            && String(criterion.id || "").trim().toLowerCase() === expected.id
            && String(criterion.scope || "").trim().toLowerCase() === expected.scope
        ));
        return cleanCriterion(match, expected);
    });
};

function emptyJuryResult() {
    return {
        schema_version: JURY_RESULT_SCHEMA_VERSION,
        disponible: false,
        actualizado_en_ts: 0,
        jugadores: {
            1: { id: 1, nombre: "ESCRITXR 1", total: 0 },
            2: { id: 2, nombre: "ESCRITXR 2", total: 0 }
        },
        criterios: normalizeCriteria([]),
        ganador: null,
        empate: false,
        diferencia: 0
    };
}

function normalizeJuryResult(payload = {}, now = Date.now()) {
    const players = payload && typeof payload === "object" && payload.jugadores
        ? payload.jugadores
        : {};
    const player1 = players[1] || players["1"] || {};
    const player2 = players[2] || players["2"] || {};
    const total1 = cleanScore(player1.total);
    const total2 = cleanScore(player2.total);
    const available = payload.disponible === true;
    const difference = Math.round(Math.abs(total1 - total2) * 10) / 10;
    const tie = available && difference < 0.05;
    return {
        schema_version: JURY_RESULT_SCHEMA_VERSION,
        disponible: available,
        actualizado_en_ts: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
        jugadores: {
            1: { id: 1, nombre: cleanName(player1.nombre, 1), total: total1 },
            2: { id: 2, nombre: cleanName(player2.nombre, 2), total: total2 }
        },
        criterios: normalizeCriteria(payload.criterios),
        ganador: available && !tie ? (total1 > total2 ? 1 : 2) : null,
        empate: tie,
        diferencia: difference
    };
}

const cloneRevealCriterion = (criterion = {}) => ({
    id: String(criterion.id || ""),
    scope: String(criterion.scope || "writing"),
    label: String(criterion.label || ""),
    referencias: {
        1: cleanScore(criterion.referencias?.[1] ?? criterion.referencias?.["1"]),
        2: cleanScore(criterion.referencias?.[2] ?? criterion.referencias?.["2"])
    },
    valores: {
        1: cleanScore(criterion.valores?.[1] ?? criterion.valores?.["1"]),
        2: cleanScore(criterion.valores?.[2] ?? criterion.valores?.["2"])
    },
    confirmado: criterion.confirmado === true,
    ganador: Number(criterion.ganador) === 1 || Number(criterion.ganador) === 2
        ? Number(criterion.ganador)
        : null,
    empate: criterion.empate === true
});

const emptyRevealState = () => ({
    activa: false,
    paso: 0,
    criterio_indice: null,
    actualizado_en_ts: 0,
    criterios: []
});

function createJuryResultManager({ io, isVisible = () => false, now = () => Date.now() } = {}) {
    let state = emptyJuryResult();
    let revealState = emptyRevealState();
    let testFixtureActive = false;

    const touch = () => {
        const timestamp = Number(now());
        return Number.isFinite(timestamp) ? timestamp : Date.now();
    };

    const cloneReveal = () => ({
        ...revealState,
        criterios: revealState.criterios.map(cloneRevealCriterion)
    });

    const payload = () => ({
        ...state,
        jugadores: {
            1: { ...state.jugadores[1] },
            2: { ...state.jugadores[2] }
        },
        criterios: state.criterios.map((criterion) => ({
            ...criterion,
            valores: { ...criterion.valores }
        })),
        revelacion: cloneReveal(),
        mostrar: Boolean(isVisible())
    });

    const emit = (socketTarget = null) => {
        const output = payload();
        const target = socketTarget && typeof socketTarget.emit === "function" ? socketTarget : io;
        if (target && typeof target.emit === "function") {
            target.emit("jurado_resultado_estado", output);
        }
        return output;
    };

    const update = (input = {}) => {
        if (testFixtureActive || revealState.activa) return payload();
        state = normalizeJuryResult(input, now());
        revealState = emptyRevealState();
        return payload();
    };

    const loadTestFixture = (input = {}) => {
        state = normalizeJuryResult(input, now());
        revealState = emptyRevealState();
        testFixtureActive = true;
        return payload();
    };

    const startReveal = () => {
        if (revealState.activa && revealState.criterios.length === state.criterios.length) {
            return payload();
        }
        revealState = {
            activa: true,
            paso: 0,
            criterio_indice: null,
            actualizado_en_ts: touch(),
            criterios: state.criterios.map((criterion) => ({
                id: criterion.id,
                scope: criterion.scope,
                label: criterion.label,
                referencias: { ...criterion.valores },
                valores: { 1: 0, 2: 0 },
                confirmado: false,
                ganador: null,
                empate: true
            }))
        };
        return payload();
    };

    const setRevealStep = (step = 0) => {
        if (!revealState.activa) startReveal();
        const normalizedStep = Math.trunc(clamp(Number(step) || 0, 0, JURY_RESULT_SLIDE_MAX));
        revealState.paso = normalizedStep;
        revealState.criterio_indice = normalizedStep > 0 && normalizedStep <= JURY_RESULT_CRITERIA.length
            ? normalizedStep - 1
            : null;
        revealState.actualizado_en_ts = touch();
        return payload();
    };

    const activeRevealCriterion = () => {
        const index = Number(revealState.criterio_indice);
        return Number.isInteger(index) && index >= 0 && index < revealState.criterios.length
            ? revealState.criterios[index]
            : null;
    };

    const updateReveal = (input = {}) => {
        const criterion = activeRevealCriterion();
        if (!revealState.activa || !criterion) return { ok: false, code: "JURY_REVEAL_NOT_ACTIVE", resultado: payload() };
        if (criterion.confirmado) return { ok: false, code: "JURY_REVEAL_ALREADY_CONFIRMED", resultado: payload() };
        const player = Number(input.jugador ?? input.player);
        if (player !== 1 && player !== 2) return { ok: false, code: "INVALID_PLAYER", resultado: payload() };
        criterion.valores[player] = cleanScore(input.valor ?? input.value);
        criterion.ganador = null;
        criterion.empate = Math.abs(criterion.valores[1] - criterion.valores[2]) < 0.05;
        revealState.actualizado_en_ts = touch();
        return { ok: true, resultado: payload() };
    };

    const recalculateTotals = () => {
        [1, 2].forEach((player) => {
            const values = state.criterios.map((criterion) => cleanScore(criterion.valores[player]));
            const total = values.length
                ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
                : 0;
            state.jugadores[player].total = total;
        });
        const difference = Math.round(Math.abs(state.jugadores[1].total - state.jugadores[2].total) * 10) / 10;
        state.diferencia = difference;
        state.empate = state.disponible && difference < 0.05;
        state.ganador = state.disponible && !state.empate
            ? (state.jugadores[1].total > state.jugadores[2].total ? 1 : 2)
            : null;
        state.actualizado_en_ts = touch();
    };

    const confirmReveal = () => {
        const criterion = activeRevealCriterion();
        if (!revealState.activa || !criterion) return { ok: false, code: "JURY_REVEAL_NOT_ACTIVE", resultado: payload() };
        if (criterion.confirmado) return { ok: true, alreadyConfirmed: true, resultado: payload() };
        const difference = Math.abs(criterion.valores[1] - criterion.valores[2]);
        criterion.empate = difference < 0.05;
        criterion.ganador = criterion.empate
            ? null
            : (criterion.valores[1] > criterion.valores[2] ? 1 : 2);
        criterion.confirmado = true;
        const index = Number(revealState.criterio_indice);
        state.criterios[index] = cleanCriterion({
            id: criterion.id,
            scope: criterion.scope,
            valores: criterion.valores
        }, JURY_RESULT_CRITERIA[index]);
        recalculateTotals();
        revealState.actualizado_en_ts = touch();
        return { ok: true, resultado: payload() };
    };

    const isCurrentRevealConfirmed = () => {
        const criterion = activeRevealCriterion();
        return !criterion || criterion.confirmado === true;
    };

    const areAllRevealsConfirmed = () => (
        revealState.activa
        && revealState.criterios.length === JURY_RESULT_CRITERIA.length
        && revealState.criterios.every((criterion) => criterion.confirmado === true)
    );

    const reset = () => {
        testFixtureActive = false;
        state = emptyJuryResult();
        revealState = emptyRevealState();
        return payload();
    };

    return {
        areAllRevealsConfirmed,
        confirmReveal,
        emit,
        isCurrentRevealConfirmed,
        loadTestFixture,
        payload,
        reset,
        setRevealStep,
        startReveal,
        update,
        updateReveal
    };
}

module.exports = {
    JURY_RESULT_SCHEMA_VERSION,
    JURY_RESULT_CRITERIA,
    JURY_RESULT_SLIDE_MAX,
    createJuryResultManager,
    emptyJuryResult,
    normalizeJuryResult
};
