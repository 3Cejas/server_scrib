#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

const FRONTEND_URL = process.env.SCRIB_REFERENCE_FRONTEND_URL
    || "http://127.0.0.1:4173/game/dramaturgia/#laboratorio";
const ROLE_PASSWORD = String(process.env.SCRIB_REFERENCE_ROLE_PASSWORD || "").trim();
if (!ROLE_PASSWORD) {
    throw new Error("SCRIB_REFERENCE_ROLE_PASSWORD es obligatoria para generar la referencia.");
}
const OUTPUT_DIR = process.env.SCRIB_REFERENCE_OUTPUT_DIR
    ? path.resolve(process.env.SCRIB_REFERENCE_OUTPUT_DIR)
    : path.resolve(__dirname, "../../players_scrib/game/dramaturgia/reference-show");
const CANONICAL_SCREENS = ["control", "writer1", "musa1", "spectator", "actor1"];
const INTERACTION_CHANGES = Object.freeze({
    control: Object.freeze([
        "warmup-lugares-open",
        "competition-letra-bendita",
        "competition-letra-prohibida",
        "competition-palabras-bonus",
        "competition-palabras-prohibidas",
        "representation-preparation"
    ]),
    writer1: Object.freeze([
        "warmup-lugares-open",
        "warmup-lugares",
        "warmup-acciones-open",
        "warmup-acciones",
        "warmup-frase-final-open",
        "warmup-frase-final",
        "level-letra-bendita-feedback",
        "level-letra-bendita",
        "competition-letra-bendita",
        "level-letra-prohibida-feedback",
        "level-letra-prohibida",
        "competition-letra-prohibida",
        "level-tertulia",
        "level-palabras-bonus-feedback",
        "level-palabras-bonus",
        "competition-palabras-bonus",
        "level-palabras-prohibidas-feedback",
        "level-palabras-prohibidas",
        "competition-palabras-prohibidas",
        "level-frase-final",
        "representation-preparation"
    ]),
    musa1: Object.freeze([
        "warmup-lugares-open",
        "warmup-lugares",
        "warmup-acciones-open",
        "warmup-acciones",
        "warmup-frase-final-open",
        "warmup-frase-final",
        "level-letra-bendita-feedback",
        "level-letra-bendita",
        "competition-letra-bendita",
        "level-letra-prohibida-feedback",
        "level-letra-prohibida",
        "competition-letra-prohibida",
        "level-tertulia",
        "level-palabras-bonus-feedback",
        "level-palabras-bonus",
        "competition-palabras-bonus",
        "level-palabras-prohibidas-feedback",
        "level-palabras-prohibidas",
        "competition-palabras-prohibidas",
        "level-frase-final",
        "representation-preparation"
    ]),
    spectator: Object.freeze([
        "warmup-lugares-open",
        "warmup-lugares",
        "warmup-acciones-open",
        "warmup-acciones",
        "warmup-frase-final-open",
        "warmup-frase-final",
        "level-letra-bendita-feedback",
        "level-letra-bendita",
        "competition-letra-bendita",
        "level-letra-prohibida-feedback",
        "level-letra-prohibida",
        "competition-letra-prohibida",
        "level-tertulia",
        "level-palabras-bonus-feedback",
        "level-palabras-bonus",
        "competition-palabras-bonus",
        "level-palabras-prohibidas-feedback",
        "level-palabras-prohibidas",
        "competition-palabras-prohibidas",
        "level-frase-final",
        "representation-preparation"
    ]),
    actor1: Object.freeze([
        "warmup-lugares-open",
        "level-letra-bendita",
        "level-letra-prohibida",
        "level-tertulia",
        "level-palabras-bonus",
        "level-palabras-prohibidas",
        "level-frase-final",
        "representation-preparation"
    ])
});
const BASE_BY_SCREEN = Object.freeze({
    control: "../../../control/",
    writer1: "../../../players/",
    musa1: "../../../public/players/",
    spectator: "../../../spectator/",
    actor1: "../../../actors/source/"
});

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function portableSnapshot(html, screenId) {
    const base = BASE_BY_SCREEN[screenId];
    if (!base) throw new Error(`No portable base configured for ${screenId}`);
    return String(html || "")
        .replace(/(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi, "")
        .replace(/localhost|127\.0\.0\.1/gi, "local-snapshot.invalid")
        .replace(/<base\s+href="[^"]*"\s*>/i, `<base href="${base}">`)
        .replace(
            /<link rel="icon" href="\/favicon\.ico" type="image\/x-icon">/g,
            '<link rel="icon" href="/favicon.ico" type="image/x-icon" />'
        )
        .replace(/\sdata-snapshot-captured-at="[^"]*"/i, "")
        .replace(
            /<html(\s|>)/i,
            `<html data-scrib-reference-show="complete-v1"$1`
        );
}

function assertSafeSnapshot(html, screenId, milestoneId) {
    const context = `${milestoneId}/${screenId}`;
    if (!html.includes("data-scrib-snapshot-frozen")) {
        throw new Error(`${context}: snapshot is not frozen`);
    }
    if (/localhost|127\.0\.0\.1/i.test(html)) {
        throw new Error(`${context}: local URL leaked into snapshot`);
    }
    if (/<script\b|<iframe\b|\son[a-z]+\s*=/i.test(html)) {
        throw new Error(`${context}: executable markup survived sanitization`);
    }
}

async function waitForStableArchive(page) {
    let stableIterations = 0;
    let previousCount = -1;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 45000) {
        const status = await page.evaluate(() => {
            const history = window.ScribDramaturgiaHistoryController;
            return {
                status: history.getStatus(),
                count: history.getCheckpoints({ limit: 720 }).length
            };
        });
        if (status.status.state !== "capturing" && status.count === previousCount) {
            stableIterations += 1;
        } else {
            stableIterations = 0;
        }
        if (stableIterations >= 3) return status;
        previousCount = status.count;
        await wait(1000);
    }
    throw new Error("The visual archive did not become stable after the simulation");
}

async function captureReferenceShow() {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        page.on("pageerror", (error) => process.stderr.write(`[browser] ${error.message}\n`));
        // The real role pages keep sockets and the activity heartbeat open, so
        // network-idle is deliberately never reached during a valid session.
        await page.goto(FRONTEND_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForFunction(() => (
            window.ScribDramaturgiaRuntime?.socket?.connected
            && window.ScribDramaturgiaScreenPool?.getSources()?.length === 9
        ), { timeout: 30000 });
        await page.waitForFunction(() => {
            const sources = window.ScribDramaturgiaScreenPool?.getSources?.() || [];
            const archive = window.ScribDramaturgiaHistoryController?.getStatus?.();
            return sources.length === 9
                && sources.every(({ frame }) => frame?.contentDocument?.readyState === "complete")
                && archive
                && archive.state !== "capturing"
                && archive.state !== "error";
        }, { timeout: 45000, polling: 250 });
        await wait(1500);

        await page.evaluate(async (password) => {
            window.initializeDramaturgiaTools?.();
            document.getElementById("dramaturgia_sim_password").value = password;
            document.getElementById("dramaturgia_sim_seed").value = "sutura-recorrido-completo-v1";
            document.getElementById("dramaturgia_sim_total_seconds").value = "40";
            document.getElementById("dramaturgia_sim_mode_seconds").value = "5";
            document.getElementById("dramaturgia_sim_speed").value = "2";
            document.getElementById("dramaturgia_sim_writer_ppm").value = "120";
            document.getElementById("dramaturgia_sim_muse_interval").value = "2";
            document.getElementById("dramaturgia_sim_muses").value = "2";
            document.getElementById("dramaturgia_sim_full_show").checked = true;
            document.getElementById("dramaturgia_sim_hearts").checked = true;
            document.getElementById("dramaturgia_sim_auto_finish").checked = true;
            await window.ScribDramaturgiaSimulatorControls.start();
        }, ROLE_PASSWORD);

        try {
            await page.waitForFunction(() => {
                const state = document.getElementById("dramaturgia_sim_status")?.dataset.state;
                return ["running", "completed", "error", "blocked", "aborted"].includes(state);
            }, { timeout: 15000 });
        } catch (error) {
            const diagnostic = await page.evaluate(() => ({
                status: document.getElementById("dramaturgia_sim_status")?.dataset.state,
                statusText: document.getElementById("dramaturgia_sim_status")?.textContent.trim(),
                preflight: document.getElementById("dramaturgia_sim_preflight")?.dataset.state,
                preflightText: document.getElementById("dramaturgia_sim_preflight")?.textContent.trim(),
                formValid: document.getElementById("dramaturgia_sim_form")?.checkValidity(),
                startDisabled: document.getElementById("dramaturgia_sim_start")?.disabled,
                toolsModel: typeof window.ScribDramaturgiaToolsModel,
                initializeTools: typeof window.initializeDramaturgiaTools
            }));
            throw new Error(`Simulation start timeout: ${JSON.stringify(diagnostic)}`, { cause: error });
        }
        const startState = await page.$eval(
            "#dramaturgia_sim_status",
            (node) => ({ state: node.dataset.state, message: node.textContent.trim() })
        );
        if (startState.state !== "running" && startState.state !== "completed") {
            throw new Error(`Simulation could not start (${startState.state}): ${startState.message}`);
        }
        try {
            await page.waitForFunction(() => {
                const state = document.getElementById("dramaturgia_sim_status")?.dataset.state;
                return ["completed", "error", "blocked", "aborted", "stopped"].includes(state);
            }, { timeout: 130000, polling: 500 });
        } catch (error) {
            const diagnostic = await page.evaluate(() => ({
                status: document.getElementById("dramaturgia_sim_status")?.dataset.state,
                statusText: document.getElementById("dramaturgia_sim_status")?.textContent.trim(),
                run: document.getElementById("dramaturgia_sim_run")?.textContent.trim(),
                elapsed: document.getElementById("dramaturgia_sim_elapsed")?.textContent.trim(),
                mode: document.getElementById("dramaturgia_sim_mode")?.textContent.trim(),
                log: document.getElementById("dramaturgia_sim_log")?.textContent.trim()
            }));
            throw new Error(`Simulation completion timeout: ${JSON.stringify(diagnostic)}`, { cause: error });
        }

        const simulationState = await page.$eval(
            "#dramaturgia_sim_status",
            (node) => node.dataset.state
        );
        if (simulationState !== "completed") {
            const message = await page.$eval("#dramaturgia_sim_status", (node) => node.textContent.trim());
            throw new Error(`Simulation ended as ${simulationState}: ${message}`);
        }
        await waitForStableArchive(page);

        return await page.evaluate(async (screenIds) => {
            const history = window.ScribDramaturgiaHistoryController;
            const checkpoints = history.getCheckpoints({ limit: 720 });
            const events = (checkpoint) => Array.isArray(checkpoint.events) ? checkpoint.events : [];
            const clean = (value) => String(value || "").trim().toLowerCase();
            const eventFacts = (event) => event && (event.hechos || event.facts) || {};

            const teamNumber = (value) => {
                const normalized = clean(value).replace(/\s+/g, "");
                if (["1", "j1", "equipo1", "team1"].includes(normalized)) return 1;
                if (["2", "j2", "equipo2", "team2"].includes(normalized)) return 2;
                return 0;
            };
            const warmupCheckpoint = (request, moment) => [...checkpoints].reverse().find((checkpoint) => (
                events(checkpoint).some((event) => {
                    if (clean(event.tipo) !== "calentamiento") return false;
                    const facts = eventFacts(event);
                    const teams = facts.equipos || {};
                    const entries = [1, 2].map((player) => teams[player] || teams[String(player)] || {});
                    if (clean(facts.solicitud) !== request) return false;
                    if (moment === "open") {
                        return entries.every((team) => (
                            Number(team.aciertos) > 0
                            && !team.bloqueado
                            && !team.final
                        ));
                    }
                    return entries.every((team) => Boolean(team.bloqueado && team.final));
                })
            ));
            const announcedModes = (checkpoint) => events(checkpoint)
                .filter((event) => clean(event.tipo) === "modo")
                .map((event) => clean(event.modo || eventFacts(event).modo))
                .filter(Boolean);
            const modeWindow = (mode) => {
                const startIndex = checkpoints.findIndex((checkpoint) => announcedModes(checkpoint).includes(mode));
                if (startIndex < 0) return [];
                const nextRelativeIndex = checkpoints.slice(startIndex + 1).findIndex((checkpoint) => (
                    announcedModes(checkpoint).some((announcedMode) => announcedMode !== mode)
                ));
                const endIndex = nextRelativeIndex < 0
                    ? checkpoints.length
                    : startIndex + 1 + nextRelativeIndex;
                return checkpoints.slice(startIndex, endIndex);
            };
            const modeCheckpoint = (mode) => {
                const source = modeWindow(mode);
                const stable = source.filter((checkpoint) => (
                    events(checkpoint).some((event) => (
                        clean(event.modo || eventFacts(event).modo) === mode
                    ))
                    && !events(checkpoint).some((event) => clean(event.tipo) === "teleprompter")
                ));
                return stable[stable.length - 1] || source[0] || null;
            };
            const disadvantageInfo = (mode) => {
                for (const checkpoint of modeWindow(mode)) {
                    for (const event of events(checkpoint)) {
                        if (clean(event.tipo) === "competicion_ronda") {
                            const facts = eventFacts(event);
                            const player = teamNumber(facts.desventaja_player);
                            if (facts.activa && clean(facts.modo) === mode && player) {
                                return {
                                    checkpoint,
                                    player,
                                    type: String(facts.desventaja || "").trim()
                                };
                            }
                            continue;
                        }
                        if (clean(event.tipo) !== "desventaja") continue;
                        const active = Array.isArray(eventFacts(event).activas)
                            ? eventFacts(event).activas
                            : [];
                        const disadvantage = active.find((item) => teamNumber(item && item.player));
                        const player = teamNumber(disadvantage && disadvantage.player);
                        if (player) {
                            return {
                                checkpoint,
                                player,
                                type: String(disadvantage.putada || disadvantage.tipo || "").trim()
                            };
                        }
                    }
                }
                return null;
            };
            const competitionInfo = (mode) => {
                const candidates = [];
                const source = modeWindow(mode);
                for (const checkpoint of source) {
                    const event = events(checkpoint).find((candidate) => {
                        if (clean(candidate.tipo) !== "competicion_ronda") return false;
                        const facts = eventFacts(candidate);
                        if (clean(facts.modo) !== mode || !facts.activa) return false;
                        const marker = facts.marcador || {};
                        return Math.abs(Number(marker[1]) || 0) + Math.abs(Number(marker[2]) || 0) > 0;
                    });
                    if (!event) continue;
                    const facts = eventFacts(event);
                    const marker = facts.marcador || {};
                    candidates.push({
                        checkpoint,
                        marker: {
                            1: Number(marker[1]) || 0,
                            2: Number(marker[2]) || 0
                        },
                        leader: teamNumber(facts.lider),
                        disadvantagedPlayer: teamNumber(facts.desventaja_player),
                        disadvantage: String(facts.desventaja || "").trim()
                    });
                }
                return candidates[Math.floor(candidates.length / 2)] || null;
            };
            const disadvantageByMode = {
                "letra bendita": disadvantageInfo("letra bendita"),
                "letra prohibida": disadvantageInfo("letra prohibida"),
                "palabras bonus": disadvantageInfo("palabras bonus"),
                "palabras prohibidas": disadvantageInfo("palabras prohibidas")
            };
            const competitionByMode = {
                "letra bendita": competitionInfo("letra bendita"),
                "letra prohibida": competitionInfo("letra prohibida"),
                "palabras bonus": competitionInfo("palabras bonus"),
                "palabras prohibidas": competitionInfo("palabras prohibidas")
            };
            const teleprompterCheckpoints = checkpoints.filter((checkpoint) => (
                events(checkpoint).some((event) => clean(event.tipo) === "teleprompter")
            ));
            const teleprompterWith = (predicate, reverse = false) => {
                const source = reverse ? [...teleprompterCheckpoints].reverse() : teleprompterCheckpoints;
                return source.find((checkpoint) => events(checkpoint).some((event) => (
                    clean(event.tipo) === "teleprompter" && predicate(eventFacts(event))
                )));
            };

            const selected = {
                "warmup-lugares-open": warmupCheckpoint("lugares", "open"),
                "warmup-lugares": warmupCheckpoint("lugares"),
                "warmup-acciones-open": warmupCheckpoint("acciones", "open"),
                "warmup-acciones": warmupCheckpoint("acciones"),
                "warmup-frase-final-open": warmupCheckpoint("frase_final", "open"),
                "warmup-frase-final": warmupCheckpoint("frase_final"),
                "level-letra-bendita-feedback": disadvantageByMode["letra bendita"]?.checkpoint,
                "level-letra-bendita": modeCheckpoint("letra bendita"),
                "competition-letra-bendita": competitionByMode["letra bendita"]?.checkpoint,
                "level-letra-prohibida-feedback": disadvantageByMode["letra prohibida"]?.checkpoint,
                "level-letra-prohibida": modeCheckpoint("letra prohibida"),
                "competition-letra-prohibida": competitionByMode["letra prohibida"]?.checkpoint,
                "level-tertulia": modeCheckpoint("tertulia"),
                "level-palabras-bonus-feedback": disadvantageByMode["palabras bonus"]?.checkpoint,
                "level-palabras-bonus": modeCheckpoint("palabras bonus"),
                "competition-palabras-bonus": competitionByMode["palabras bonus"]?.checkpoint,
                "level-palabras-prohibidas-feedback": disadvantageByMode["palabras prohibidas"]?.checkpoint,
                "level-palabras-prohibidas": modeCheckpoint("palabras prohibidas"),
                "competition-palabras-prohibidas": competitionByMode["palabras prohibidas"]?.checkpoint,
                "level-frase-final": modeCheckpoint("frase final"),
                "representation-preparation": teleprompterWith((facts) => facts.visible && !facts.reproduciendo),
                "representation-projection": teleprompterWith((facts) => facts.visible && facts.reproduciendo),
                "representation-final": teleprompterWith((facts) => !facts.visible, true)
            };
            const missing = Object.entries(selected)
                .filter(([, checkpoint]) => !checkpoint)
                .map(([milestoneId]) => milestoneId);
            if (
                Object.values(disadvantageByMode).some((info) => !info)
                || Object.values(competitionByMode).some((info) => !info)
                || missing.length
            ) {
                throw new Error(JSON.stringify({
                    message: "Incomplete reference journey",
                    missing,
                    disadvantageModes: Object.fromEntries(Object.entries(disadvantageByMode).map(([
                        mode,
                        info
                    ]) => [mode, info && info.player])),
                    competitionModes: Object.fromEntries(Object.entries(competitionByMode).map(([
                        mode,
                        info
                    ]) => [mode, info && info.marker])),
                    checkpointCount: checkpoints.length
                }));
            }

            const contextByMilestone = {
                "warmup-lugares-open": { moment: "open", request: "lugares" },
                "warmup-lugares": { moment: "closed", request: "lugares" },
                "warmup-acciones-open": { moment: "open", request: "acciones" },
                "warmup-acciones": { moment: "closed", request: "acciones" },
                "warmup-frase-final-open": { moment: "open", request: "frase_final" },
                "warmup-frase-final": { moment: "closed", request: "frase_final" },
                "level-letra-bendita-feedback": {
                    moment: "feedback",
                    mode: "letra bendita",
                    disadvantagedPlayer: disadvantageByMode["letra bendita"].player,
                    disadvantage: disadvantageByMode["letra bendita"].type
                },
                "level-letra-bendita": {
                    moment: "stable",
                    mode: "letra bendita",
                    disadvantagedPlayer: disadvantageByMode["letra bendita"].player
                },
                "competition-letra-bendita": {
                    moment: "competition",
                    mode: "letra bendita",
                    marker: competitionByMode["letra bendita"].marker,
                    leader: competitionByMode["letra bendita"].leader,
                    disadvantagedPlayer: competitionByMode["letra bendita"].disadvantagedPlayer,
                    disadvantage: competitionByMode["letra bendita"].disadvantage
                },
                "level-letra-prohibida-feedback": {
                    moment: "feedback",
                    mode: "letra prohibida",
                    disadvantagedPlayer: disadvantageByMode["letra prohibida"].player,
                    disadvantage: disadvantageByMode["letra prohibida"].type
                },
                "level-letra-prohibida": {
                    moment: "stable",
                    mode: "letra prohibida",
                    disadvantagedPlayer: disadvantageByMode["letra prohibida"].player
                },
                "competition-letra-prohibida": {
                    moment: "competition",
                    mode: "letra prohibida",
                    marker: competitionByMode["letra prohibida"].marker,
                    leader: competitionByMode["letra prohibida"].leader,
                    disadvantagedPlayer: competitionByMode["letra prohibida"].disadvantagedPlayer,
                    disadvantage: competitionByMode["letra prohibida"].disadvantage
                },
                "level-tertulia": { moment: "stable", mode: "tertulia" },
                "level-palabras-bonus-feedback": {
                    moment: "feedback",
                    mode: "palabras bonus",
                    disadvantagedPlayer: disadvantageByMode["palabras bonus"].player,
                    disadvantage: disadvantageByMode["palabras bonus"].type
                },
                "level-palabras-bonus": {
                    moment: "stable",
                    mode: "palabras bonus",
                    disadvantagedPlayer: disadvantageByMode["palabras bonus"].player
                },
                "competition-palabras-bonus": {
                    moment: "competition",
                    mode: "palabras bonus",
                    marker: competitionByMode["palabras bonus"].marker,
                    leader: competitionByMode["palabras bonus"].leader,
                    disadvantagedPlayer: competitionByMode["palabras bonus"].disadvantagedPlayer,
                    disadvantage: competitionByMode["palabras bonus"].disadvantage
                },
                "level-palabras-prohibidas-feedback": {
                    moment: "feedback",
                    mode: "palabras prohibidas",
                    disadvantagedPlayer: disadvantageByMode["palabras prohibidas"].player,
                    disadvantage: disadvantageByMode["palabras prohibidas"].type
                },
                "level-palabras-prohibidas": {
                    moment: "stable",
                    mode: "palabras prohibidas",
                    disadvantagedPlayer: disadvantageByMode["palabras prohibidas"].player
                },
                "competition-palabras-prohibidas": {
                    moment: "competition",
                    mode: "palabras prohibidas",
                    marker: competitionByMode["palabras prohibidas"].marker,
                    leader: competitionByMode["palabras prohibidas"].leader,
                    disadvantagedPlayer: competitionByMode["palabras prohibidas"].disadvantagedPlayer,
                    disadvantage: competitionByMode["palabras prohibidas"].disadvantage
                },
                "level-frase-final": { moment: "stable", mode: "frase final" },
                "representation-preparation": { moment: "preparation" },
                "representation-projection": { moment: "projection" },
                "representation-final": { moment: "final" }
            };
            const milestones = {};
            for (const [milestoneId, checkpoint] of Object.entries(selected)) {
                const roles = {};
                const sources = {};
                const context = contextByMilestone[milestoneId] || {};
                for (const screenId of screenIds) {
                    let sourceScreenId = screenId;
                    if (
                        screenId === "writer1"
                        && ["feedback", "stable"].includes(context.moment)
                        && context.disadvantagedPlayer
                    ) {
                        sourceScreenId = `writer${context.disadvantagedPlayer}`;
                    }
                    const snapshot = await history.getSnapshot(checkpoint.id, sourceScreenId);
                    if (!snapshot?.html) {
                        throw new Error(`Missing ${milestoneId}/${screenId} from ${sourceScreenId}`);
                    }
                    if (
                        context.moment === "competition"
                        && ["control", "writer1", "spectator"].includes(screenId)
                        && !/id="scrib_competition_hud"[^>]*data-active="1"/i.test(snapshot.html)
                    ) {
                        throw new Error(`${milestoneId}/${sourceScreenId}: competition marker is not active`);
                    }
                    if (
                        screenId === "writer1"
                        && context.moment === "feedback"
                        && !/DESVENTAJA!/i.test(snapshot.html)
                    ) {
                        throw new Error(`${milestoneId}/${sourceScreenId}: disadvantage feedback is missing`);
                    }
                    roles[screenId] = snapshot.html;
                    sources[screenId] = sourceScreenId;
                }
                milestones[milestoneId] = {
                    checkpointId: checkpoint.id,
                    seq: checkpoint.seq,
                    roles,
                    sources,
                    context
                };
            }
            return {
                sessionId: checkpoints.find((checkpoint) => checkpoint.sessionId)?.sessionId || "",
                checkpointCount: checkpoints.length,
                milestones
            };
        }, CANONICAL_SCREENS);
    } finally {
        await browser.close();
    }
}

async function writeReferenceShow(capture) {
    const temporary = fs.mkdtempSync(path.join(path.dirname(OUTPUT_DIR), ".reference-show-"));
    fs.chmodSync(temporary, 0o755);
    const blobsDirectory = path.join(temporary, "blobs");
    fs.mkdirSync(blobsDirectory, { recursive: true });
    fs.chmodSync(blobsDirectory, 0o755);
    const manifest = {
        schemaVersion: 1,
        id: "scrib-complete-reference-show-v1",
        generatedAt: new Date().toISOString(),
        source: "isolated-match-simulator",
        sessionId: capture.sessionId,
        checkpointCount: capture.checkpointCount,
        screenIds: [...CANONICAL_SCREENS],
        interactionChanges: INTERACTION_CHANGES,
        milestones: {}
    };
    const written = new Set();
    for (const [milestoneId, milestone] of Object.entries(capture.milestones)) {
        const roles = {};
        for (const [screenId, rawHtml] of Object.entries(milestone.roles)) {
            const html = portableSnapshot(rawHtml, screenId);
            assertSafeSnapshot(html, screenId, milestoneId);
            const hash = sha256(html);
            const filename = `${hash}.html`;
            if (!written.has(hash)) {
                fs.writeFileSync(path.join(blobsDirectory, filename), html, "utf8");
                written.add(hash);
            }
            roles[screenId] = `reference-show/blobs/${filename}`;
        }
        manifest.milestones[milestoneId] = {
            checkpointId: milestone.checkpointId,
            seq: milestone.seq,
            roles,
            sources: { ...milestone.sources },
            context: { ...milestone.context }
        };
    }
    fs.writeFileSync(
        path.join(temporary, "manifest.js"),
        `(function(root){root.ScribDramaturgiaReferenceShowManifest=Object.freeze(${JSON.stringify(manifest)});})(window);\n`,
        "utf8"
    );
    fs.writeFileSync(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (fs.existsSync(OUTPUT_DIR)) fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.renameSync(temporary, OUTPUT_DIR);
    fs.chmodSync(OUTPUT_DIR, 0o755);
    return { manifest, blobs: written.size };
}

(async () => {
    const capture = await captureReferenceShow();
    const written = await writeReferenceShow(capture);
    process.stdout.write(
        `Reference show generated: ${Object.keys(written.manifest.milestones).length} milestones, `
        + `${written.manifest.screenIds.length} roles, ${written.blobs} HTML blobs.\n`
    );
})().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
});
