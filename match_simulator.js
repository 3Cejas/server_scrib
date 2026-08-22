const { ROLE_ROOMS } = require("./role_connections.js");

const SIMULATION_STATES_ACTIVE = new Set(["starting", "running", "paused"]);
const SIMULATION_MODES = Object.freeze([
    "letra bendita",
    "letra prohibida",
    "tertulia",
    "palabras bonus",
    "palabras prohibidas",
    "frase final"
]);
const AUTH_TTL_MS = 15 * 60 * 1000;
const TICK_MS = 250;
const FULL_SHOW_STEP_MS = 1250;
const FULL_SHOW_GAME_START_DELAY_MS = 4250;
const WARMUP_REQUESTS = Object.freeze(["lugares", "acciones", "frase_final"]);
const WARMUP_FINAL_PHRASE_MAX = 48;
const WARMUP_PROPOSALS = Object.freeze({
    lugares: Object.freeze({
        1: Object.freeze(["azotea", "bosque"]),
        2: Object.freeze(["estación", "laberinto"])
    }),
    acciones: Object.freeze({
        1: Object.freeze(["huir", "recordar"]),
        2: Object.freeze(["coser", "despertar"])
    })
});

const WORDS = Object.freeze([
    "umbral", "costura", "bosque", "latido", "memoria", "cuerpo", "eco", "ceniza",
    "puerta", "noche", "relámpago", "secreto", "arena", "órbita", "hambre", "pluma",
    "espejo", "raíz", "marea", "silencio", "máscara", "vértigo", "jardín", "hilo",
    "incendio", "respirar", "desvelo", "escena", "voz", "sombra", "tiempo", "herida"
]);
const INSPIRATIONS = Object.freeze([
    "meteorito", "ascensor", "medusa", "frontera", "telegrama", "niebla", "ritual", "azotea",
    "ballena", "archivo", "laberinto", "vendaval", "semilla", "fantasma", "estación", "escombro"
]);

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalizeBoolean(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["false", "0", "no", "off"].includes(normalized)) return false;
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
    }
    return Boolean(value);
}

function normalizeModes(value) {
    const input = Array.isArray(value) ? value : SIMULATION_MODES;
    const output = [];
    input.forEach((mode) => {
        const normalized = String(mode || "").trim().toLowerCase();
        if (SIMULATION_MODES.includes(normalized) && !output.includes(normalized)) {
            output.push(normalized);
        }
    });
    return output.length ? output : [...SIMULATION_MODES];
}

function normalizeSimulationConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const fullShow = normalizeBoolean(source.full_show, true);
    const finalPhraseMax = fullShow ? WARMUP_FINAL_PHRASE_MAX : 240;
    const normalizedMuses = Math.round(clampNumber(source.muses_per_team, 2, 0, 4));
    return {
        seed: String(source.seed || "sutura-visual").trim().slice(0, 64) || "sutura-visual",
        total_seconds: Math.round(clampNumber(source.total_seconds, 150, 30, 3600)),
        mode_seconds: Math.round(clampNumber(source.mode_seconds, 14, 5, 300)),
        speed: clampNumber(source.speed, 1, 0.25, 8),
        writer_ppm: Math.round(clampNumber(source.writer_ppm, 52, 5, 600)),
        muse_interval_seconds: clampNumber(source.muse_interval_seconds, 7, 1, 120),
        muses_per_team: fullShow ? Math.max(1, normalizedMuses) : normalizedMuses,
        votes: normalizeBoolean(source.votes, true),
        hearts: normalizeBoolean(source.hearts, true),
        auto_finish: normalizeBoolean(source.auto_finish, true),
        full_show: fullShow,
        modes: fullShow ? [...SIMULATION_MODES] : normalizeModes(source.modes),
        final_phrase_1: String(source.final_phrase_1 || "Y entonces la costura del mundo volvió a abrirse.")
            .trim()
            .slice(0, finalPhraseMax),
        final_phrase_2: String(source.final_phrase_2 || "Nadie supo si aquello era un final o una puerta.")
            .trim()
            .slice(0, finalPhraseMax)
    };
}

function hashSeed(seed) {
    const text = String(seed || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createSeededRandom(seed) {
    let state = hashSeed(seed) || 0x6d2b79f5;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function formatClock(secondsValue) {
    const seconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function createSyntheticSocket({ id, io, runId, role }) {
    const handlers = new Map();
    const rooms = new Set();
    const emitted = [];
    let disconnected = false;

    const socket = {
        id,
        rooms,
        emitted,
        simulacion_scrib: {
            run_id: runId,
            role
        },
        broadcast: {
            emit(eventName, ...args) {
                if (io && typeof io.emit === "function") {
                    io.emit(eventName, ...args);
                }
            }
        },
        on(eventName, handler) {
            const list = handlers.get(eventName) || [];
            list.push(handler);
            handlers.set(eventName, list);
            return socket;
        },
        emit(eventName, ...args) {
            emitted.push({ event: eventName, args });
            if (emitted.length > 80) emitted.shift();
            return true;
        },
        receive(eventName, ...args) {
            const list = handlers.get(eventName) || [];
            list.slice().forEach((handler) => handler(...args));
            return list.length > 0;
        },
        join(room) {
            rooms.add(room);
            return socket;
        },
        leave(room) {
            rooms.delete(room);
            return socket;
        },
        removeAllListeners(eventName) {
            if (eventName) handlers.delete(eventName);
            else handlers.clear();
            return socket;
        },
        disconnect() {
            if (disconnected) return false;
            disconnected = true;
            socket.receive("disconnect", "simulacion_finalizada");
            handlers.clear();
            rooms.clear();
            return true;
        }
    };
    return socket;
}

function connectionCount(entry) {
    if (entry && typeof entry === "object") {
        return Math.max(0, Number(entry.count) || (entry.connected ? 1 : 0));
    }
    return Math.max(0, Number(entry) || 0);
}

function blockersFromConnections(connections = {}) {
    const blockers = [];
    const add = (label, entry) => {
        const count = connectionCount(entry);
        if (count > 0) blockers.push(`${label} (${count})`);
    };
    add("Control", connections.control);
    add("Espectador", connections.spectator);
    add("Jurado", connections.jury);
    add("Escritxr 1", connections.writers && connections.writers[1]);
    add("Escritxr 2", connections.writers && connections.writers[2]);
    add("Musas 1", connections.musas && connections.musas[1]);
    add("Musas 2", connections.musas && connections.musas[2]);
    add("Actorxs 1", connections.actors && connections.actors[1]);
    add("Actorxs 2", connections.actors && connections.actors[2]);
    return blockers;
}

function createMatchSimulator({
    io,
    passwordRoles,
    registerConnection,
    getConnections = () => ({}),
    getCurrentMode = () => "",
    getVoteState = () => ({}),
    getWarmupState = () => null,
    resetWarmup = () => {},
    partidaLifecycle,
    registerDramaturgyEvent = () => {},
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = () => {}
} = {}) {
    let sequence = 0;
    let run = null;

    const isDramaturgySocket = (socket) => Boolean(
        socket
        && socket.dramaturgia
        && !socket.monitor_pantalla
        && !socket.simulacion_scrib
    );

    const isAuthorized = (socket) => Boolean(
        isDramaturgySocket(socket)
        && Number(socket.dramaturgia_sim_auth_until) > now()
    );

    const isActive = () => Boolean(run && SIMULATION_STATES_ACTIVE.has(run.state));

    const publicState = () => {
        if (!run) {
            return {
                revision: 0,
                state: "idle",
                stage: "idle",
                run_id: "",
                mode: String(getCurrentMode() || ""),
                config: null,
                metrics: {
                    elapsed_seconds: 0,
                    words_1: 0,
                    words_2: 0,
                    inspirations: 0,
                    votes: 0,
                    steps: 0
                },
                log: []
            };
        }
        return {
            revision: run.revision,
            state: run.state,
            stage: run.stage || "game",
            run_id: run.id,
            started_at: run.startedAt,
            ended_at: run.endedAt || 0,
            mode: String(getCurrentMode() || ""),
            message: run.message || "",
            config: { ...run.config, final_phrase_1: undefined, final_phrase_2: undefined },
            metrics: {
                elapsed_seconds: Math.max(0, Math.round(run.elapsed * 10) / 10),
                words_1: run.words[1],
                words_2: run.words[2],
                inspirations: run.inspirations,
                votes: run.votes,
                steps: run.steps
            },
            log: run.log.map((entry) => ({ ...entry }))
        };
    };

    const emitState = (target = null) => {
        const payload = publicState();
        // A manual stage step temporarily satisfies the existing `running`
        // guards while it consumes one continuation.  Do not expose that
        // implementation detail: observers receive only the final paused (or
        // terminal) state emitted by `step`.
        if (!target && run && run.manualStepActive) {
            return payload;
        }
        if (target && typeof target.emit === "function") {
            target.emit("dramaturgia_sim_estado", payload);
            return payload;
        }
        if (io && typeof io.to === "function") {
            const room = io.to(ROLE_ROOMS.DRAMATURGY);
            if (room && typeof room.emit === "function") {
                room.emit("dramaturgia_sim_estado", payload);
            }
        } else if (io && typeof io.emit === "function") {
            io.emit("dramaturgia_sim_estado", payload);
        }
        return payload;
    };

    const addLog = (message, kind = "info") => {
        if (!run) return null;
        run.revision += 1;
        const entry = {
            id: `${run.id}:${run.revision}`,
            ts: now(),
            kind,
            message: String(message || "").trim().slice(0, 240)
        };
        run.log.push(entry);
        while (run.log.length > 36) run.log.shift();
        return entry;
    };

    const dramaturgyEvent = (title, detail, facts = {}) => {
        try {
            registerDramaturgyEvent({
                tipo: "simulacion",
                clave_causa: "simulacion",
                titulo: title,
                detalle: detail,
                espacio: "sistema",
                hechos: {
                    run_id: run ? run.id : "",
                    ...facts
                }
            });
        } catch (error) {
            logger("[simulador] no se pudo registrar evento dramaturgia", error);
        }
    };

    const authorize = (socket, password) => {
        if (!isDramaturgySocket(socket)) {
            return { ok: false, code: "NOT_DRAMATURGY", error: "Solo Dramaturgia puede autorizar el laboratorio." };
        }
        if (String(password || "") !== String(passwordRoles || "")) {
            socket.dramaturgia_sim_auth_until = 0;
            return { ok: false, code: "INVALID_PASSWORD", error: "Clave de roles incorrecta." };
        }
        socket.dramaturgia_sim_auth_until = now() + AUTH_TTL_MS;
        return {
            ok: true,
            expires_at: socket.dramaturgia_sim_auth_until
        };
    };

    const preflight = () => {
        const blockers = blockersFromConnections(getConnections() || {});
        const mode = String(getCurrentMode() || "").trim();
        if (mode) blockers.push(`partida en modo ${mode}`);
        if (isActive()) blockers.push("simulación ya activa");
        return {
            ok: true,
            can_start: blockers.length === 0,
            blockers,
            code: blockers.length ? "MATCH_ACTIVE" : "READY"
        };
    };

    const createRole = (role) => {
        const socket = createSyntheticSocket({
            id: `sim-${run.id}-${role}-${run.sockets.length + 1}`,
            io,
            runId: run.id,
            role
        });
        run.sockets.push(socket);
        registerConnection(socket);
        return socket;
    };

    const setupSyntheticRoles = () => {
        const roles = {
            control: createRole("control"),
            spectator: createRole("spectator"),
            jury: createRole("jury"),
            writers: {
                1: createRole("writer1"),
                2: createRole("writer2")
            },
            actors: {
                1: createRole("actor1"),
                2: createRole("actor2")
            },
            muses: {
                1: [],
                2: []
            }
        };

        roles.control.receive("registrar_control");
        roles.spectator.receive("registrar_espectador");
        roles.jury.receive("registrar_jurado");
        [1, 2].forEach((player) => {
            roles.writers[player].receive("registrar_escritor", {
                player,
                client_id: `sim_writer_${run.id}_${player}`
            });
            roles.actors[player].receive("registrar_actor", { player });
            for (let index = 0; index < run.config.muses_per_team; index += 1) {
                const muse = createRole(`musa${player}-${index + 1}`);
                muse.receive("registrar_musa", {
                    musa: player,
                    nombre: `BOT ${player}${index + 1}`,
                    client_id: `sim_musa_${run.id}_${player}_${index + 1}`
                });
                roles.muses[player].push(muse);
            }
        });
        roles.writers[1].receive("envío_nombre1", "BOT AZUL");
        roles.writers[2].receive("envío_nombre2", "BOT ROJO");
        return roles;
    };

    const emitWriterText = (player) => {
        const writer = run.roles.writers[player];
        const text = run.texts[player];
        writer.receive(`texto${player}`, {
            text,
            texto_guardado: text,
            points: `${run.words[player]} palabras`,
            caretPos: text.length,
            caretLine: 0,
            caretRatio: 1
        });
    };

    const addWords = (player, amount = 1) => {
        const count = Math.max(0, Math.min(24, Math.floor(Number(amount) || 0)));
        if (!count) return 0;
        const additions = [];
        for (let index = 0; index < count; index += 1) {
            let word = WORDS[Math.floor(run.random() * WORDS.length)] || "palabra";
            if ((run.words[player] + index + 1) % 17 === 0) word = `${word}.`;
            additions.push(word);
        }
        run.texts[player] = `${run.texts[player]}${run.texts[player] ? " " : ""}${additions.join(" ")}`;
        run.words[player] += additions.length;
        emitWriterText(player);
        return additions.length;
    };

    const emitCountsAndStats = () => {
        const remaining = Math.max(0, run.config.total_seconds - Math.floor(run.elapsed));
        [1, 2].forEach((player) => {
            run.countSeq[player] += 1;
            run.roles.writers[player].receive("count", {
                player,
                count: formatClock(remaining),
                count_seq: run.countSeq[player]
            });
        });
        run.roles.control.receive("stats_live_actualizar", {
            ts: now(),
            modo_actual: String(getCurrentMode() || ""),
            players: {
                1: {
                    nombre: "BOT AZUL",
                    palabrasTotal: run.words[1],
                    ritmoPpm: Math.round(run.config.writer_ppm * run.config.speed),
                    pulsacionesTotal: run.words[1] * 6,
                    vida: { actual: remaining }
                },
                2: {
                    nombre: "BOT ROJO",
                    palabrasTotal: run.words[2],
                    ritmoPpm: Math.round(run.config.writer_ppm * run.config.speed),
                    pulsacionesTotal: run.words[2] * 6,
                    vida: { actual: remaining }
                }
            }
        });
    };

    const consumeMuseWord = (player, mode) => {
        const writer = run.roles.writers[player];
        if (mode === "palabras bonus") writer.receive("nueva_palabra", player);
        else if (mode === "palabras prohibidas") writer.receive("nueva_palabra_prohibida", player);
        else if (mode === "letra bendita" || mode === "letra prohibida") {
            writer.receive("nueva_palabra_musa", player);
        }
    };

    const sendInspirations = () => {
        const mode = String(getCurrentMode() || "");
        [1, 2].forEach((player) => {
            const muses = run.roles.muses[player];
            if (!muses.length) return;
            const index = run.museCursor[player] % muses.length;
            run.museCursor[player] += 1;
            const muse = muses[index];
            const word = INSPIRATIONS[Math.floor(run.random() * INSPIRATIONS.length)] || "umbral";
            muse.receive("enviar_inspiracion", {
                palabra: word,
                nombre: `BOT ${player}${index + 1}`,
                client_id: `sim_musa_${run.id}_${player}_${index + 1}`
            });
            run.inspirations += 1;
            consumeMuseWord(player, mode);
        });
        addLog(`Musas bot envían inspiración en ${mode || "espera"}.`);
    };

    const sendHearts = () => {
        [1, 2].forEach((player) => {
            const muse = run.roles.muses[player][0];
            if (muse) muse.receive("musa_corazon");
        });
        addLog("Las musas bot envían corazones.");
    };

    const sendVotes = () => {
        if (!run.config.votes) return;
        const vote = getVoteState() || {};
        if (!vote.activa || !Array.isArray(vote.opciones) || !vote.opciones.length) {
            return;
        }
        const signature = `${vote.equipo}:${vote.termina_en_ts}:${vote.opciones.join("|")}`;
        if (signature === run.lastVoteSignature) return;
        run.lastVoteSignature = signature;
        const player = vote.equipo === "j2" ? 2 : 1;
        const muses = run.roles.muses[player];
        muses.forEach((muse, index) => {
            const option = vote.opciones[index % vote.opciones.length];
            muse.receive("enviar_voto_ventaja", {
                voto: option,
                client_id: `sim_musa_${run.id}_${player}_${index + 1}`
            });
            run.votes += 1;
        });
        addLog(`Votación automática del equipo ${player}: ${muses.length} votos.`);
    };

    const clearTick = () => {
        if (!run || !run.interval) return;
        clearIntervalFn(run.interval);
        run.interval = null;
    };

    const clearStageTimer = (forgetContinuation = true) => {
        if (!run) return;
        if (run.stageTimer) clearTimeoutFn(run.stageTimer);
        run.stageTimer = null;
        if (forgetContinuation) {
            run.stageContinuation = null;
            run.stageDelay = 0;
        }
    };

    const scheduleStage = (continuation, delay = FULL_SHOW_STEP_MS) => {
        if (!run || typeof continuation !== "function") return null;
        clearStageTimer(false);
        const expectedRun = run;
        run.stageContinuation = continuation;
        run.stageDelay = Math.max(0, Number(delay) || 0);
        run.stageTimer = setTimeoutFn(() => {
            if (run !== expectedRun) return;
            const next = run.stageContinuation;
            run.stageTimer = null;
            run.stageContinuation = null;
            run.stageDelay = 0;
            if (run.state !== "running") {
                run.stageContinuation = next;
                run.stageDelay = Math.max(0, Number(delay) || 0);
                return;
            }
            try {
                next();
            } catch (error) {
                logger("[simulador] error en recorrido completo", error);
                finish({
                    state: "error",
                    message: `Error durante el recorrido: ${error.message}`,
                    clearGame: true,
                    reason: "full_show_error"
                });
            }
        }, run.stageDelay);
        if (run.stageTimer && typeof run.stageTimer.unref === "function") run.stageTimer.unref();
        return run.stageTimer;
    };

    const suspendStageTimer = () => {
        if (!run || !run.stageTimer) return false;
        clearTimeoutFn(run.stageTimer);
        run.stageTimer = null;
        return true;
    };

    const resumeStageTimer = () => {
        if (!run || typeof run.stageContinuation !== "function") return false;
        const continuation = run.stageContinuation;
        const delay = run.stageDelay || FULL_SHOW_STEP_MS;
        scheduleStage(continuation, delay);
        return true;
    };

    const finalizeSyntheticRoles = () => {
        if (!run || run.writersFinalized) return false;
        run.writersFinalized = true;
        run.roles.writers[1].receive("fin_de_player", {
            player: 1,
            motivo: "simulacion"
        });
        run.roles.writers[2].receive("fin_de_player", {
            player: 2,
            motivo: "simulacion"
        });
        return true;
    };

    const disconnectSyntheticRoles = () => {
        if (!run) return;
        run.sockets.slice().forEach((socket) => socket.disconnect());
    };

    const finish = ({ state, message, clearGame = false, reason = "" }) => {
        if (!run) return publicState();
        clearTick();
        clearStageTimer();
        if (clearGame && partidaLifecycle && typeof partidaLifecycle.limpiarPartida === "function") {
            partidaLifecycle.limpiarPartida(run.roles.control, {
                simulacion: true,
                run_id: run.id,
                reason
            });
        }
        disconnectSyntheticRoles();
        run.state = state;
        run.message = message;
        run.endedAt = now();
        addLog(message, state === "error" ? "error" : "system");
        dramaturgyEvent(
            state === "completed" ? "Simulación completada" : "Simulación finalizada",
            message,
            { estado: state, motivo: reason }
        );
        emitState();
        return publicState();
    };

    const consumePausedStageContinuation = () => {
        if (
            !run
            || run.state !== "paused"
            || typeof run.stageContinuation !== "function"
        ) {
            return { ok: false, error: null };
        }

        const expectedRun = run;
        const continuation = expectedRun.stageContinuation;
        clearStageTimer(false);
        expectedRun.stageContinuation = null;
        expectedRun.stageDelay = 0;
        expectedRun.manualStepActive = true;
        expectedRun.state = "running";

        let continuationError = null;
        try {
            // During the pre-game countdown the real match engine is paused as
            // well.  Wake it only for this single transition so the first mode
            // is actually activated before the role views are frozen again.
            if (expectedRun.stage === "game") {
                expectedRun.roles.control.receive("reanudar", { simulacion: true });
            }
            continuation();
        } catch (error) {
            continuationError = error;
            logger("[simulador] error en paso manual del recorrido", error);
            finish({
                state: "error",
                message: `Error durante el paso manual: ${error.message}`,
                clearGame: true,
                reason: "manual_step_error"
            });
        } finally {
            if (run === expectedRun) {
                // Warmup and representation schedule their next transition;
                // pre-game starts the writing interval.  A manual step must
                // retain the former and stop both kinds of scheduler.
                suspendStageTimer();
                clearTick();
                if (expectedRun.stage === "game") {
                    expectedRun.roles.control.receive("pausar", { simulacion: true });
                }
                expectedRun.manualStepActive = false;
                if (expectedRun.state === "running") {
                    expectedRun.state = "paused";
                }
            }
        }

        return { ok: !continuationError, error: continuationError };
    };

    const requireSyntheticHandler = (socket, eventName, payload) => {
        if (socket.receive(eventName, payload)) return true;
        throw new Error(`El rol sintético no registró el handler ${eventName}.`);
    };

    const warmupProposals = (request, player) => {
        if (request === "frase_final") {
            const principal = run.config[`final_phrase_${player}`];
            const alternativa = player === 1
                ? "La noche cosió otra salida para los dos."
                : "El umbral guardó la última voz del bosque.";
            return [principal, alternativa];
        }
        return [...(WARMUP_PROPOSALS[request] && WARMUP_PROPOSALS[request][player] || [])];
    };

    const warmupTeamState = (player) => {
        const state = getWarmupState();
        const team = state && state.equipos && state.equipos[player];
        if (!team || !Array.isArray(team.palabras)) {
            throw new Error(`No se pudo leer el calentamiento del equipo ${player}.`);
        }
        return { state, team };
    };

    const submitWarmupProposals = (request) => {
        [1, 2].forEach((player) => {
            const muse = run.roles.muses[player][0];
            if (!muse) throw new Error(`Falta una musa sintética en el equipo ${player}.`);
            const proposals = warmupProposals(request, player);
            proposals.forEach((palabra) => {
                requireSyntheticHandler(muse, "calentamiento_intento", { palabra });
            });
            const { state, team } = warmupTeamState(player);
            if (state.solicitud !== request) {
                throw new Error(`La consigna ${request} no quedó activa.`);
            }
            const chosen = [...team.palabras].reverse().find((entry) => (
                entry && entry.palabra === proposals[0]
            ));
            if (!chosen || !chosen.id) {
                throw new Error(`La propuesta del equipo ${player} no llegó al calentamiento.`);
            }
            run.warmupSelections[player] = {
                request,
                id: chosen.id,
                palabra: chosen.palabra
            };
        });
    };

    const selectWarmupProposals = () => {
        [1, 2].forEach((player) => {
            const selection = run.warmupSelections[player];
            if (!selection || !selection.id) throw new Error(`Falta la selección del equipo ${player}.`);
            requireSyntheticHandler(run.roles.writers[player], "calentamiento_click_palabra", {
                id: selection.id
            });
        });
    };

    const lockWarmupTeams = () => {
        [1, 2].forEach((player) => {
            requireSyntheticHandler(run.roles.writers[player], "calentamiento_bloquear_equipo", {});
            const { team } = warmupTeamState(player);
            if (!team.bloqueado) throw new Error(`El equipo ${player} no cerró la consigna.`);
        });
    };

    const finalizeWarmupSelections = (request) => {
        [1, 2].forEach((player) => {
            const selection = run.warmupSelections[player];
            requireSyntheticHandler(run.roles.writers[player], "calentamiento_click_palabra", {
                id: selection.id
            });
            const { team } = warmupTeamState(player);
            if (!team.final || team.final.id !== selection.id) {
                throw new Error(`El equipo ${player} no fijó su final para ${request}.`);
            }
        });
    };

    const emitGameStart = () => {
        run.roles.control.receive("inicio", {
            count: formatClock(run.config.total_seconds),
            borrar_texto: false,
            parametros: {
                DURACION_TIEMPO_MODOS: run.config.mode_seconds,
                LISTA_MODOS: [...run.config.modes],
                TIEMPO_CAMBIO_LETRA: Math.max(1000, Math.round(run.config.mode_seconds * 500)),
                TIEMPO_CAMBIO_PALABRAS: Math.max(1000, Math.round(run.config.muse_interval_seconds * 1000)),
                TIEMPO_VOTACION: Math.max(2500, Math.min(10000, Math.round(run.config.mode_seconds * 650))),
                TIEMPO_MODIFICADOR: Math.max(2500, Math.min(12000, Math.round(run.config.mode_seconds * 700))),
                LIMITE_TIEMPO_INSPIRACION: Math.max(1000, Math.round(run.config.muse_interval_seconds * 1000)),
                FRASE_FINAL_J1: run.config.final_phrase_1,
                FRASE_FINAL_J2: run.config.final_phrase_2
            }
        });
    };

    const startGameLoop = () => {
        if (!run || run.state !== "running" || run.stage !== "game" || run.gameLoopStarted) return;
        run.gameLoopStarted = true;
        run.gameStartedAt = now();
        run.lastTickAt = run.gameStartedAt;
        run.message = "Escritura automática en curso.";
        addLog("Comienza la escritura automática.");
        emitCountsAndStats();
        run.interval = setIntervalFn(tick, TICK_MS);
        if (run.interval && typeof run.interval.unref === "function") run.interval.unref();
        emitState();
    };

    const beginGame = () => {
        if (!run || run.state !== "running") return;
        clearStageTimer();
        run.stage = "game";
        run.message = "Cuenta atrás para la escritura automática.";
        emitGameStart();
        addLog(`Partida iniciada con los seis modos normales y semilla “${run.config.seed}”.`);
        emitState();
        if (run.config.full_show) {
            scheduleStage(startGameLoop, FULL_SHOW_GAME_START_DELAY_MS);
        } else {
            startGameLoop();
        }
    };

    const advanceWarmup = () => {
        if (!run || run.state !== "running" || run.stage !== "warmup") return;
        const action = run.stageActions[run.stageActionIndex];
        run.stageActionIndex += 1;
        if (!action) {
            beginGame();
            return;
        }
        action();
        emitState();
        scheduleStage(advanceWarmup);
    };

    const beginWarmup = () => {
        resetWarmup();
        run.stage = "warmup";
        run.message = "Calentamiento automático en curso.";
        run.stageActionIndex = 0;
        run.stageActions = [
            () => {
                requireSyntheticHandler(run.roles.control, "cambiar_vista_calentamiento", { activo: true });
                addLog("Se abre el calentamiento para ambos equipos.");
            }
        ];
        WARMUP_REQUESTS.forEach((request) => {
            run.stageActions.push(
                () => {
                    requireSyntheticHandler(run.roles.control, "calentamiento_solicitud", { tipo: request });
                    addLog(`Consigna de calentamiento: ${request}.`);
                },
                () => {
                    submitWarmupProposals(request);
                    addLog(`Las musas proponen opciones para ${request}.`);
                },
                () => {
                    selectWarmupProposals();
                    addLog(`Ambos escritxres seleccionan una opción para ${request}.`);
                },
                () => {
                    lockWarmupTeams();
                    addLog(`Ambos equipos bloquean la consigna ${request}.`);
                },
                () => {
                    finalizeWarmupSelections(request);
                    addLog(`Ambos equipos fijan su resultado de ${request}.`);
                }
            );
        });
        run.stageActions.push(() => {
            requireSyntheticHandler(run.roles.control, "cambiar_vista_calentamiento", { activo: false });
            addLog("Se cierra la vista del calentamiento.");
        });
        run.stageActions.push(() => {
            resetWarmup();
            const state = getWarmupState();
            if (state && (state.activo || state.vista)) {
                throw new Error("El calentamiento no quedó inactivo antes de la partida.");
            }
            addLog("Finaliza el calentamiento y se libera la fase de juego.");
        });
        advanceWarmup();
    };

    const appendFinalPhrases = () => {
        [1, 2].forEach((player) => {
            const phrase = String(run.config[`final_phrase_${player}`] || "").trim();
            const current = String(run.texts[player] || "").trimEnd();
            run.texts[player] = phrase && !current.endsWith(phrase)
                ? `${current}${current ? " " : ""}${phrase}`
                : current;
            run.words[player] = run.texts[player].trim()
                ? run.texts[player].trim().split(/\s+/).length
                : 0;
            emitWriterText(player);
        });
    };

    const emitTeleprompterPhase = ({ player, phase, loadId }) => {
        const isPlaying = phase === "playing";
        const isFinal = phase === "final";
        const isHidden = phase === "hidden";
        requireSyntheticHandler(run.roles.control, "teleprompter_control", {
            state: {
                visible: !isHidden,
                text: run.texts[player],
                fontSize: 36,
                speed: 25,
                playing: isPlaying,
                scroll: isFinal ? Number.MAX_SAFE_INTEGER : 0,
                source: player,
                loadId
            }
        });
        addLog(`Representación del equipo ${player}: ${phase}.`);
    };

    const advanceRepresentation = () => {
        if (!run || run.state !== "running" || run.stage !== "representation") return;
        const phase = run.representationPhases[run.representationIndex];
        run.representationIndex += 1;
        if (!phase) {
            finish({
                state: "completed",
                message: run.completionMessage,
                clearGame: false,
                reason: "auto_finish"
            });
            return;
        }
        emitTeleprompterPhase(phase);
        emitState();
        scheduleStage(advanceRepresentation);
    };

    const beginRepresentation = (message) => {
        if (!run || run.representationStarted) return publicState();
        clearTick();
        clearStageTimer();
        run.representationStarted = true;
        run.completionMessage = message;
        appendFinalPhrases();
        finalizeSyntheticRoles();
        run.stage = "representation";
        run.message = "Representación automática en curso.";
        const loadId1 = ++run.teleprompterLoadId;
        const loadId2 = ++run.teleprompterLoadId;
        run.representationPhases = [
            { player: 1, phase: "paused", loadId: loadId1 },
            { player: 1, phase: "playing", loadId: loadId1 },
            { player: 1, phase: "final", loadId: loadId1 },
            { player: 2, phase: "paused", loadId: loadId2 },
            { player: 2, phase: "playing", loadId: loadId2 },
            { player: 2, phase: "final", loadId: loadId2 },
            { player: 2, phase: "hidden", loadId: loadId2 }
        ];
        run.representationIndex = 0;
        addLog("Los textos reales pasan al teleprompter para su representación.");
        advanceRepresentation();
        return publicState();
    };

    const complete = (message = "La simulación ha completado el guion.") => {
        if (!isActive()) return publicState();
        if (run.config.auto_finish) {
            if (run.config.full_show) return beginRepresentation(message);
            finalizeSyntheticRoles();
            return finish({ state: "completed", message, clearGame: false, reason: "auto_finish" });
        }
        clearTick();
        run.state = "paused";
        run.message = "Reloj agotado. La partida queda pausada para inspección manual.";
        addLog(run.message, "system");
        emitState();
        return publicState();
    };

    const tick = () => {
        if (!run || run.state !== "running" || run.stage !== "game" || !run.gameLoopStarted) return;
        const tickNow = now();
        const realDelta = Math.max(0, Math.min(2, (tickNow - run.lastTickAt) / 1000));
        run.lastTickAt = tickNow;
        const interactionDelta = realDelta * run.config.speed;
        run.elapsed += realDelta;
        run.interactionElapsed += interactionDelta;
        run.heartElapsed += interactionDelta;

        [1, 2].forEach((player) => {
            const targetWords = Math.floor(
                (run.elapsed / 60)
                * run.config.writer_ppm
                * run.config.speed
            );
            const missing = Math.max(0, targetWords - run.words[player]);
            if (missing) addWords(player, missing);
        });

        const wholeSecond = Math.floor(run.elapsed);
        if (wholeSecond !== run.lastCountSecond) {
            run.lastCountSecond = wholeSecond;
            emitCountsAndStats();
        }

        if (run.interactionElapsed >= run.config.muse_interval_seconds) {
            run.interactionElapsed %= run.config.muse_interval_seconds;
            sendInspirations();
        }
        if (
            run.config.hearts
            && run.heartElapsed >= run.config.muse_interval_seconds * 3
        ) {
            run.heartElapsed %= run.config.muse_interval_seconds * 3;
            sendHearts();
        }
        sendVotes();

        const mode = String(getCurrentMode() || "");
        if (mode) run.seenMode = true;
        if (mode !== run.lastMode) {
            run.lastMode = mode;
            addLog(mode ? `El servidor entra en ${mode}.` : "El servidor sale del último modo.");
            emitState();
        } else if (wholeSecond % 2 === 0 && wholeSecond !== run.lastStatusSecond) {
            run.lastStatusSecond = wholeSecond;
            run.revision += 1;
            emitState();
        }

        if (run.elapsed >= run.config.total_seconds) {
            complete("El reloj del guion automático ha terminado.");
        } else if (!mode && run.seenMode && (tickNow - (run.gameStartedAt || run.startedAt)) > 6000) {
            complete("El motor ha recorrido todos los modos seleccionados.");
        }
    };

    const start = (socket, input = {}) => {
        if (!isDramaturgySocket(socket)) {
            return { ok: false, code: "NOT_DRAMATURGY", error: "Solo Dramaturgia puede iniciar una simulación." };
        }
        if (!isAuthorized(socket)) {
            return { ok: false, code: "NOT_AUTHORIZED", error: "Autoriza el laboratorio con la clave de roles." };
        }
        const check = preflight();
        if (!check.can_start) {
            return { ...check, ok: false, error: "Hay una partida o roles humanos activos." };
        }

        sequence += 1;
        const config = normalizeSimulationConfig(input.config || input);
        run = {
            id: `sim-${now().toString(36)}-${sequence.toString(36)}`,
            ownerSocketId: socket.id,
            state: "starting",
            stage: config.full_show ? "warmup" : "game",
            revision: 1,
            message: "Preparando roles sintéticos.",
            config,
            startedAt: now(),
            endedAt: 0,
            elapsed: 0,
            lastTickAt: now(),
            lastCountSecond: -1,
            lastStatusSecond: -1,
            interactionElapsed: 0,
            heartElapsed: 0,
            words: { 1: 0, 2: 0 },
            texts: { 1: "", 2: "" },
            countSeq: { 1: 0, 2: 0 },
            inspirations: 0,
            votes: 0,
            steps: 0,
            museCursor: { 1: 0, 2: 0 },
            lastVoteSignature: "",
            lastMode: "",
            seenMode: false,
            sockets: [],
            roles: null,
            interval: null,
            stageTimer: null,
            stageContinuation: null,
            stageDelay: 0,
            stageActions: [],
            stageActionIndex: 0,
            gameLoopStarted: false,
            gameStartedAt: 0,
            writersFinalized: false,
            representationStarted: false,
            representationPhases: [],
            representationIndex: 0,
            teleprompterLoadId: 0,
            completionMessage: "",
            warmupSelections: { 1: null, 2: null },
            manualStepActive: false,
            log: [],
            random: createSeededRandom(config.seed)
        };

        try {
            run.roles = setupSyntheticRoles();
            addLog("Roles sintéticos registrados: Control, escritxres, musas, actorxs, Espectador y Jurado.");
            run.state = "running";
            run.message = config.full_show
                ? "Calentamiento automático en curso."
                : "Simulación automática en curso.";
            addLog(`Recorrido iniciado con semilla “${config.seed}”.`);
            dramaturgyEvent(
                "Simulación iniciada",
                "El laboratorio pone en marcha una partida con roles sintéticos.",
                {
                    seed: config.seed,
                    modos: config.modes,
                    segundos: config.total_seconds
                }
            );
            if (config.full_show) beginWarmup();
            else beginGame();
            return { ok: true, state: publicState() };
        } catch (error) {
            logger("[simulador] error al iniciar", error);
            if (run && run.roles) {
                finish({
                    state: "error",
                    message: `Error al iniciar: ${error.message}`,
                    clearGame: true,
                    reason: "start_error"
                });
            } else if (run) {
                disconnectSyntheticRoles();
                run.state = "error";
                run.message = `Error al iniciar: ${error.message}`;
                run.endedAt = now();
                addLog(run.message, "error");
                emitState();
            }
            return { ok: false, code: "START_ERROR", error: error.message, state: publicState() };
        }
    };

    const canControl = (socket) => Boolean(
        isDramaturgySocket(socket)
        && run
        && (socket.id === run.ownerSocketId || isAuthorized(socket))
    );

    const pause = (socket) => {
        if (!run || run.state !== "running") {
            return { ok: false, code: "NOT_RUNNING", error: "No hay una simulación en curso para pausar." };
        }
        if (!canControl(socket)) {
            return { ok: false, code: "NOT_AUTHORIZED", error: "Autoriza este panel para controlar la simulación." };
        }
        const gameStage = run.stage === "game";
        const activeGame = gameStage && run.gameLoopStarted;
        if (gameStage) run.roles.control.receive("pausar", { simulacion: true });
        if (!activeGame) suspendStageTimer();
        run.state = "paused";
        run.message = "Simulación pausada para inspección.";
        if (activeGame) clearTick();
        addLog(run.message, "system");
        dramaturgyEvent("Simulación pausada", run.message);
        emitState();
        return { ok: true, state: publicState() };
    };

    const resume = (socket) => {
        if (!run || run.state !== "paused") {
            return { ok: false, code: "NOT_PAUSED", error: "La simulación no está pausada." };
        }
        if (!canControl(socket)) {
            return { ok: false, code: "NOT_AUTHORIZED", error: "Autoriza este panel para controlar la simulación." };
        }
        const gameStage = run.stage === "game";
        const activeGame = gameStage && run.gameLoopStarted;
        if (gameStage) run.roles.control.receive("reanudar", { simulacion: true });
        run.state = "running";
        run.message = "Simulación reanudada.";
        if (activeGame) {
            run.lastTickAt = now();
            run.interval = setIntervalFn(tick, TICK_MS);
            if (run.interval && typeof run.interval.unref === "function") run.interval.unref();
        } else {
            resumeStageTimer();
        }
        addLog(run.message, "system");
        dramaturgyEvent("Simulación reanudada", run.message);
        emitState();
        return { ok: true, state: publicState() };
    };

    const step = (socket) => {
        if (!run || run.state !== "paused") {
            return { ok: false, code: "NOT_PAUSED", error: "Pausa la simulación antes de ejecutar un paso." };
        }
        if (!canControl(socket)) {
            return { ok: false, code: "NOT_AUTHORIZED", error: "Autoriza este panel para controlar la simulación." };
        }
        let stepLabel = "interacción de escritura";
        if (typeof run.stageContinuation === "function") {
            const stageBeforeStep = run.stage;
            const result = consumePausedStageContinuation();
            if (!result.ok) {
                emitState();
                return {
                    ok: false,
                    code: "STEP_ERROR",
                    error: result.error ? result.error.message : "No se pudo avanzar este momento.",
                    state: publicState()
                };
            }
            stepLabel = stageBeforeStep === "warmup"
                ? "calentamiento"
                : (stageBeforeStep === "representation" ? "representación" : "cuenta atrás");
        } else if (run.stage === "game" && run.gameLoopStarted) {
            addWords(1, 1);
            addWords(2, 1);
            sendInspirations();
            sendVotes();
            emitCountsAndStats();
        } else {
            return {
                ok: false,
                code: "WRONG_STAGE",
                error: "No hay un siguiente momento disponible en esta fase."
            };
        }
        run.steps += 1;
        addLog(`Paso manual #${run.steps} · ${stepLabel}.`);
        emitState();
        return { ok: true, state: publicState() };
    };

    const stop = (socket, reason = "manual") => {
        if (!canControl(socket)) {
            return { ok: false, code: "NOT_AUTHORIZED", error: "No puedes detener esta simulación." };
        }
        if (!run || run.state === "stopped") {
            return { ok: true, state: publicState() };
        }
        const state = finish({
            state: "stopped",
            message: "Simulación detenida y estado de prueba limpiado.",
            clearGame: true,
            reason
        });
        return { ok: true, state };
    };

    const abortForHumanRole = (socket, role) => {
        if (
            !isActive()
            || !socket
            || socket.simulacion_scrib
            || socket.monitor_pantalla
            || socket.dramaturgia
        ) {
            return false;
        }
        finish({
            state: "aborted",
            message: `Simulación abortada: ha entrado un rol humano (${role}).`,
            clearGame: true,
            reason: `human_role:${role}`
        });
        return true;
    };

    return {
        abortForHumanRole,
        authorize,
        emitState,
        isActive,
        isAuthorized,
        pause,
        preflight,
        publicState,
        resume,
        start,
        step,
        stop
    };
}

module.exports = {
    AUTH_TTL_MS,
    SIMULATION_MODES,
    SIMULATION_STATES_ACTIVE,
    blockersFromConnections,
    createMatchSimulator,
    createSeededRandom,
    createSyntheticSocket,
    normalizeBoolean,
    normalizeSimulationConfig
};
