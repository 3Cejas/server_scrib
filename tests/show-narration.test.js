const assert = require("node:assert/strict");
const test = require("node:test");

const {
    SHOW_NARRATION_AUDIO_SECONDS,
    SHOW_NARRATION_AUDIO_URL,
    SHOW_NARRATION_PREROLL_SECONDS,
    SHOW_NARRATION_SLIDE_URL,
    crearGestorNarracionShow
} = require("../show_narration.js");

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

test("show narration exposes the fixed five-second preroll and bundled media", () => {
    let now = 10_000;
    const gestor = crearGestorNarracionShow({ io: fakeIo(), now: () => now, crearSessionId: () => "show_test" });
    const initial = gestor.payload();
    assert.equal(initial.activa, false);
    assert.equal(initial.session_id, "show_test");
    assert.equal(initial.configuracion.pre_roll_segundos, SHOW_NARRATION_PREROLL_SECONDS);
    assert.equal(initial.configuracion.duracion_audio_segundos, SHOW_NARRATION_AUDIO_SECONDS);
    assert.equal(initial.configuracion.audio_url, SHOW_NARRATION_AUDIO_URL);
    assert.equal(initial.configuracion.slide_url, SHOW_NARRATION_SLIDE_URL);
});

test("only Control can start or stop and the final slide state persists", async () => {
    let now = 20_000;
    const io = fakeIo();
    const gestor = crearGestorNarracionShow({ io, now: () => now, crearSessionId: () => "show_test" });
    const intruder = fakeSocket();
    const control = fakeSocket({ control: true });
    gestor.registrarHandlers(intruder);
    gestor.registrarHandlers(control);

    const denied = await intruder.trigger("narracion_show_reproducir", { request_id: "bad" });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "NOT_AUTHORIZED");

    const started = await control.trigger("narracion_show_reproducir", { request_id: "play-1" });
    assert.equal(started.ok, true);
    assert.equal(started.estado.activa, true);
    assert.equal(started.estado.secuencia, 1);

    now += (SHOW_NARRATION_PREROLL_SECONDS + SHOW_NARRATION_AUDIO_SECONDS + 45) * 1000;
    const persistent = gestor.payload();
    assert.equal(persistent.activa, true, "the final slide must remain until Control pauses it");
    assert.ok(persistent.posicion_segundos > SHOW_NARRATION_PREROLL_SECONDS + SHOW_NARRATION_AUDIO_SECONDS);

    const stopped = await control.trigger("narracion_show_detener", { request_id: "stop-1" });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.estado.activa, false);
    assert.equal(stopped.estado.posicion_segundos, 0);
});

test("late clients receive the authoritative position and duplicate requests are idempotent", async () => {
    let now = 30_000;
    const gestor = crearGestorNarracionShow({ io: fakeIo(), now: () => now, crearSessionId: () => "show_test" });
    const control = fakeSocket({ control: true });
    const spectator = fakeSocket();
    gestor.registrarHandlers(control);
    gestor.registrarHandlers(spectator);

    const first = await control.trigger("narracion_show_reproducir", { request_id: "same" });
    const duplicate = await control.trigger("narracion_show_reproducir", { request_id: "same" });
    assert.equal(first.estado.secuencia, 1);
    assert.equal(duplicate.idempotente, true);
    assert.equal(gestor.payload().secuencia, 1);

    now += 12_500;
    const sync = await spectator.trigger("pedir_narracion_show_estado", {});
    assert.equal(sync.ok, true);
    assert.equal(sync.estado.activa, true);
    assert.equal(sync.estado.posicion_segundos, 12.5);
    assert.equal(spectator.emitted.at(-1).event, "narracion_show_estado");
});

test("show narration coordinates start and stop with the recurring tutorial", () => {
    const calls = [];
    const gestor = crearGestorNarracionShow({
        io: fakeIo(),
        crearSessionId: () => "show_test",
        onStart: () => calls.push("suspend-tutorial"),
        onStop: () => calls.push("resume-tutorial")
    });
    gestor.reproducir({ request_id: "play" });
    gestor.detener({ request_id: "stop" });
    gestor.detener({ request_id: "already-stopped" });
    assert.deepEqual(calls, ["suspend-tutorial", "resume-tutorial"]);
});
