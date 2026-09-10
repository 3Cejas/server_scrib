const test = require("node:test");
const assert = require("node:assert/strict");

const { detenerExperienciasTutorialActivas } = require("../connection_handlers.js");

test("a view change stops both active tutorial experiences with authoritative video ids", () => {
  const calls = [];
  const resultado = detenerExperienciasTutorialActivas({
    narracionShow: {
      payload: () => ({ activa: true }),
      detener: () => calls.push({ tipo: "narracion" })
    },
    videoTutorialPreShow: {
      payload: () => ({ reproduciendo: true, session_id: "video-session", phase_seq: 8 }),
      detener: (payload) => calls.push({ tipo: "video", payload })
    }
  });

  assert.deepEqual(resultado, { narracion: true, videotutorial: true, repeticion: false });
  assert.deepEqual(calls, [
    { tipo: "narracion" },
    { tipo: "video", payload: { session_id: "video-session", phase_seq: 8 } }
  ]);
});

test("inactive experiences are left untouched when the view changes", () => {
  let stops = 0;
  const resultado = detenerExperienciasTutorialActivas({
    narracionShow: {
      payload: () => ({ activa: false }),
      detener: () => { stops += 1; }
    },
    videoTutorialPreShow: {
      payload: () => ({ reproduciendo: false }),
      detener: () => { stops += 1; }
    }
  });

  assert.equal(stops, 0);
  assert.deepEqual(resultado, { narracion: false, videotutorial: false, repeticion: false });
});

test("a view change disables automatic tutorial repetition", () => {
  let disabled = 0;
  const resultado = detenerExperienciasTutorialActivas({
    modoSiguiente: "juego",
    videoTutorialPreShow: {
      payload: () => ({ reproduciendo: false, configuracion: { habilitado: true } }),
      desactivarRepeticion: () => { disabled += 1; }
    }
  });

  assert.equal(disabled, 1);
  assert.deepEqual(resultado, { narracion: false, videotutorial: false, repeticion: true });
});

test("entering tutorial keeps automatic repetition configured", () => {
  let disabled = 0;
  const resultado = detenerExperienciasTutorialActivas({
    modoSiguiente: "tutorial",
    videoTutorialPreShow: {
      payload: () => ({ reproduciendo: false, configuracion: { habilitado: true } }),
      desactivarRepeticion: () => { disabled += 1; }
    }
  });

  assert.equal(disabled, 0);
  assert.deepEqual(resultado, { narracion: false, videotutorial: false, repeticion: false });
});
