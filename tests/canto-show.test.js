const assert = require("node:assert/strict");
const test = require("node:test");

const {
    CANTO_SHOW_AUDIO_SECONDS,
    CANTO_SHOW_AUDIO_URL,
    CANTO_SHOW_FADE_MS,
    CANTO_SHOW_TEXT,
    crearGestorCantoShow
} = require("../canto_show.js");

function fakeIo() {
    return {
        events: [],
        emit(event, payload) {
            this.events.push({ event, payload });
        }
    };
}

function fakeSocket({ control = false } = {}) {
    const handlers = new Map();
    return {
        control,
        emitted: [],
        on(event, handler) { handlers.set(event, handler); },
        emit(event, payload) { this.emitted.push({ event, payload }); },
        trigger(event, payload = {}) {
            return new Promise((resolve) => {
                const handler = handlers.get(event);
                assert.equal(typeof handler, "function", `missing handler ${event}`);
                handler(payload, resolve);
            });
        }
    };
}

test("canto exposes the bundled Iliad loop and the complete stage text", () => {
    const gestor = crearGestorCantoShow({ io: fakeIo(), crearSessionId: () => "canto_test" });
    const estado = gestor.payload();
    assert.equal(estado.activo, false);
    assert.equal(estado.session_id, "canto_test");
    assert.equal(estado.configuracion.audio_url, CANTO_SHOW_AUDIO_URL);
    assert.equal(estado.configuracion.duracion_audio_segundos, CANTO_SHOW_AUDIO_SECONDS);
    assert.equal(estado.configuracion.fade_ms, CANTO_SHOW_FADE_MS);
    assert.equal(estado.configuracion.loop, true);
    assert.equal(estado.configuracion.texto, CANTO_SHOW_TEXT);
    assert.match(estado.configuracion.texto, /Cántame a mí, Musa, la historia/);
});

test("only Control can toggle canto and activation selects the game view once", async () => {
    const calls = [];
    const gestor = crearGestorCantoShow({
        io: fakeIo(),
        crearSessionId: () => "canto_test",
        onActivate: () => calls.push("partida"),
        onDeactivate: () => calls.push("salida")
    });
    const intruder = fakeSocket();
    const control = fakeSocket({ control: true });
    gestor.registrarHandlers(intruder);
    gestor.registrarHandlers(control);

    const denied = await intruder.trigger("canto_activar", { request_id: "bad" });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "NOT_AUTHORIZED");

    const started = await control.trigger("canto_activar", { request_id: "start" });
    assert.equal(started.ok, true);
    assert.equal(started.estado.activo, true);
    assert.equal(started.estado.secuencia, 1);
    assert.deepEqual(calls, ["partida"]);

    const repeated = await control.trigger("canto_activar", { request_id: "start-again" });
    assert.equal(repeated.estado.secuencia, 1);
    assert.deepEqual(calls, ["partida"]);

    const stopped = await control.trigger("canto_desactivar", { request_id: "stop" });
    assert.equal(stopped.estado.activo, false);
    assert.deepEqual(calls, ["partida", "salida"]);
});

test("canto reconnects at the authoritative loop position and request ids are idempotent", async () => {
    let now = 10_000;
    const gestor = crearGestorCantoShow({
        io: fakeIo(),
        now: () => now,
        crearSessionId: () => "canto_test"
    });
    const control = fakeSocket({ control: true });
    const spectator = fakeSocket();
    gestor.registrarHandlers(control);
    gestor.registrarHandlers(spectator);

    const first = await control.trigger("canto_activar", { request_id: "same" });
    const duplicate = await control.trigger("canto_activar", { request_id: "same" });
    assert.equal(first.estado.secuencia, 1);
    assert.equal(duplicate.idempotente, true);

    now += 67_500;
    const sync = await spectator.trigger("pedir_canto_estado", {});
    assert.equal(sync.ok, true);
    assert.equal(sync.estado.activo, true);
    assert.equal(sync.estado.posicion_segundos, 67.5);
    assert.equal(spectator.emitted.at(-1).event, "canto_estado");
});
