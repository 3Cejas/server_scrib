const JURY_RESULT_SCHEMA_VERSION = 1;
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

function createJuryResultManager({ io, isVisible = () => false, now = () => Date.now() } = {}) {
    let state = emptyJuryResult();
    let testFixtureActive = false;

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
        if (testFixtureActive) return payload();
        state = normalizeJuryResult(input, now());
        return payload();
    };

    const loadTestFixture = (input = {}) => {
        state = normalizeJuryResult(input, now());
        testFixtureActive = true;
        return payload();
    };

    const reset = () => {
        testFixtureActive = false;
        state = emptyJuryResult();
        return payload();
    };

    return { emit, loadTestFixture, payload, reset, update };
}

module.exports = {
    JURY_RESULT_SCHEMA_VERSION,
    JURY_RESULT_CRITERIA,
    JURY_RESULT_SLIDE_MAX,
    createJuryResultManager,
    emptyJuryResult,
    normalizeJuryResult
};
