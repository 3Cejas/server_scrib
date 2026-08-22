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
    control: Object.freeze(["warmup-lugares-open"]),
    writer1: Object.freeze([
        "warmup-lugares-open",
        "warmup-lugares",
        "warmup-acciones-open",
        "warmup-acciones",
        "warmup-frase-final-open",
        "warmup-frase-final",
        "level-letra-bendita",
        "level-letra-prohibida-feedback",
        "level-letra-prohibida",
        "level-tertulia",
        "level-palabras-bonus-feedback",
        "level-palabras-bonus",
        "level-palabras-prohibidas-feedback",
        "level-palabras-prohibidas",
        "level-frase-final-feedback",
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
        "level-letra-bendita",
        "vote-letra-bendita",
        "level-letra-prohibida",
        "level-tertulia",
        "vote-letra-prohibida",
        "level-palabras-bonus",
        "vote-palabras-bonus",
        "level-palabras-prohibidas",
        "vote-palabras-prohibidas",
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
        "level-letra-bendita",
        "vote-letra-bendita",
        "level-letra-prohibida",
        "level-tertulia",
        "vote-letra-prohibida",
        "level-palabras-bonus",
        "vote-palabras-bonus",
        "level-palabras-prohibidas",
        "vote-palabras-prohibidas",
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
        await page.goto(FRONTEND_URL, { waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForFunction(() => (
            window.ScribDramaturgiaRuntime?.socket?.connected
            && window.ScribDramaturgiaScreenPool?.getSources()?.length === 9
        ), { timeout: 30000 });
        await wait(3500);

        await page.evaluate((password) => {
            document.getElementById("dramaturgia_sim_password").value = password;
            document.getElementById("dramaturgia_sim_seed").value = "sutura-recorrido-completo-v1";
            document.getElementById("dramaturgia_sim_total_seconds").value = "40";
            document.getElementById("dramaturgia_sim_mode_seconds").value = "5";
            document.getElementById("dramaturgia_sim_speed").value = "2";
            document.getElementById("dramaturgia_sim_writer_ppm").value = "120";
            document.getElementById("dramaturgia_sim_muse_interval").value = "2";
            document.getElementById("dramaturgia_sim_muses").value = "2";
            document.getElementById("dramaturgia_sim_full_show").checked = true;
            document.getElementById("dramaturgia_sim_votes").checked = true;
            document.getElementById("dramaturgia_sim_hearts").checked = true;
            document.getElementById("dramaturgia_sim_auto_finish").checked = true;
            document.getElementById("dramaturgia_sim_form").requestSubmit();
        }, ROLE_PASSWORD);

        await page.waitForFunction(() => (
            document.getElementById("dramaturgia_sim_status")?.dataset.state === "running"
        ), { timeout: 15000 });
        await page.waitForFunction(() => {
            const state = document.getElementById("dramaturgia_sim_status")?.dataset.state;
            return ["completed", "error", "blocked", "aborted"].includes(state);
        }, { timeout: 130000, polling: 500 });

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
            const modeStarts = checkpoints
                .map((checkpoint, index) => ({ checkpoint, index }))
                .filter(({ checkpoint }) => events(checkpoint).some((event) => (
                    clean(event.tipo) === "modo"
                    && clean(event.modo || eventFacts(event).modo)
                )));
            const modeWindow = (mode) => {
                const startPosition = modeStarts.findIndex(({ checkpoint }) => (
                    events(checkpoint).some((event) => (
                        clean(event.tipo) === "modo"
                        && clean(event.modo || eventFacts(event).modo) === mode
                    ))
                ));
                if (startPosition < 0) return [];
                const startIndex = modeStarts[startPosition].index;
                const endIndex = modeStarts[startPosition + 1]?.index ?? checkpoints.length;
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
            const voteCheckpoints = checkpoints.filter((checkpoint) => (
                events(checkpoint).some((event) => (
                    clean(event.tipo) === "votacion"
                    && /iniciada|abierta/.test(clean(event.titulo || event.title))
                ))
            ));
            const voteInfo = (checkpoint) => {
                const event = events(checkpoint).find((candidate) => (
                    clean(candidate.tipo) === "votacion"
                    && /iniciada|abierta/.test(clean(candidate.titulo || candidate.title))
                ));
                const team = teamNumber(eventFacts(event).equipo);
                return team ? { checkpoint, team } : null;
            };
            const voteInfos = voteCheckpoints.map(voteInfo);
            const disadvantageByMode = {
                "letra prohibida": disadvantageInfo("letra prohibida"),
                "palabras bonus": disadvantageInfo("palabras bonus"),
                "palabras prohibidas": disadvantageInfo("palabras prohibidas"),
                "frase final": disadvantageInfo("frase final")
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
                "level-letra-bendita": modeCheckpoint("letra bendita"),
                "vote-letra-bendita": voteCheckpoints[0],
                "level-letra-prohibida-feedback": disadvantageByMode["letra prohibida"]?.checkpoint,
                "level-letra-prohibida": modeCheckpoint("letra prohibida"),
                "level-tertulia": modeCheckpoint("tertulia"),
                "vote-letra-prohibida": voteCheckpoints[1],
                "level-palabras-bonus-feedback": disadvantageByMode["palabras bonus"]?.checkpoint,
                "level-palabras-bonus": modeCheckpoint("palabras bonus"),
                "vote-palabras-bonus": voteCheckpoints[2],
                "level-palabras-prohibidas-feedback": disadvantageByMode["palabras prohibidas"]?.checkpoint,
                "level-palabras-prohibidas": modeCheckpoint("palabras prohibidas"),
                "vote-palabras-prohibidas": voteCheckpoints[3],
                "level-frase-final-feedback": disadvantageByMode["frase final"]?.checkpoint,
                "level-frase-final": modeCheckpoint("frase final"),
                "representation-preparation": teleprompterWith((facts) => facts.visible && !facts.reproduciendo),
                "representation-projection": teleprompterWith((facts) => facts.visible && facts.reproduciendo),
                "representation-final": teleprompterWith((facts) => !facts.visible, true)
            };
            const missing = Object.entries(selected)
                .filter(([, checkpoint]) => !checkpoint)
                .map(([milestoneId]) => milestoneId);
            if (
                voteCheckpoints.length !== 4
                || voteInfos.some((info) => !info)
                || Object.values(disadvantageByMode).some((info) => !info)
                || missing.length
            ) {
                throw new Error(JSON.stringify({
                    message: "Incomplete reference journey",
                    missing,
                    votingCheckpoints: voteCheckpoints.length,
                    votingTeams: voteInfos.map((info) => info && info.team),
                    disadvantageModes: Object.fromEntries(Object.entries(disadvantageByMode).map(([
                        mode,
                        info
                    ]) => [mode, info && info.player])),
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
                "level-letra-bendita": { moment: "stable", mode: "letra bendita" },
                "vote-letra-bendita": { moment: "voting", votingTeam: voteInfos[0].team },
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
                "level-tertulia": { moment: "stable", mode: "tertulia" },
                "vote-letra-prohibida": { moment: "voting", votingTeam: voteInfos[1].team },
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
                "vote-palabras-bonus": { moment: "voting", votingTeam: voteInfos[2].team },
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
                "vote-palabras-prohibidas": { moment: "voting", votingTeam: voteInfos[3].team },
                "level-frase-final-feedback": {
                    moment: "feedback",
                    mode: "frase final",
                    disadvantagedPlayer: disadvantageByMode["frase final"].player,
                    disadvantage: disadvantageByMode["frase final"].type
                },
                "level-frase-final": {
                    moment: "stable",
                    mode: "frase final",
                    disadvantagedPlayer: disadvantageByMode["frase final"].player
                },
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
                    if (screenId === "musa1" && context.votingTeam) {
                        sourceScreenId = `musa${context.votingTeam}`;
                    } else if (screenId === "writer1" && context.disadvantagedPlayer) {
                        sourceScreenId = `writer${context.disadvantagedPlayer}`;
                    }
                    const snapshot = await history.getSnapshot(checkpoint.id, sourceScreenId);
                    if (!snapshot?.html) {
                        throw new Error(`Missing ${milestoneId}/${screenId} from ${sourceScreenId}`);
                    }
                    if (
                        screenId === "musa1"
                        && context.moment === "voting"
                        && !/id="votacion_ventaja_modal"[^>]*class="[^"]*\bactiva\b/i.test(snapshot.html)
                    ) {
                        throw new Error(`${milestoneId}/${sourceScreenId}: voting modal is not active`);
                    }
                    if (
                        screenId === "writer1"
                        && context.moment === "feedback"
                        && !/DESVENTAJA!/i.test(snapshot.html)
                    ) {
                        throw new Error(`${milestoneId}/${sourceScreenId}: disadvantage feedback is missing`);
                    }
                    if (
                        screenId === "writer1"
                        && context.moment === "stable"
                        && context.disadvantagedPlayer
                        && /DESVENTAJA!/i.test(snapshot.html)
                    ) {
                        throw new Error(`${milestoneId}/${sourceScreenId}: transient feedback survived stable state`);
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
