const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DRAMATURGIA_CHECKPOINT_EVENT,
  DRAMATURGIA_EVENT,
  DRAMATURGIA_ROOM,
  crearEstadoDramaturgia
} = require("../dramaturgia_state.js");

function estadoBase() {
  return {
    ts: 1000,
    connections: {
      control: { count: 0, connected: false },
      spectator: { count: 0, connected: false },
      jury: { count: 0, connected: false },
      dramaturgia: { count: 0, connected: false },
      writers: {
        1: { count: 0, connected: false },
        2: { count: 0, connected: false }
      },
      musas: {
        1: { count: 0, connected: false },
        2: { count: 0, connected: false }
      },
      actors: {
        1: { count: 0, connected: false },
        2: { count: 0, connected: false }
      }
    },
    partida: {
      modo_actual: "",
      fin_del_juego: false,
      timeline: []
    },
    textos: {
      1: { html: "", plano: "" },
      2: { html: "", plano: "" }
    },
    nombres: { 1: "", 2: "" },
    atributos: { 1: {}, 2: {} },
    conteos: {
      1: { modo_seq: 0 },
      2: { modo_seq: 0 }
    },
    inspiracion: {
      preview: { modo_actual: "", modo_seq: 0 },
      nube: {
        equipos: {
          1: { palabras: [] },
          2: { palabras: [] }
        }
      },
      ultimas: { 1: null, 2: null }
    },
    tutorial: {
      activo: false,
      vista: false,
      solicitud: "",
      equipos: {
        1: { estado: "", intentos: 0, aciertos: 0, bloqueado: false },
        2: { estado: "", intentos: 0, aciertos: 0, bloqueado: false }
      }
    },
    espectador: {
      modo: "partida",
      override: "partida",
      calentamiento_vista: false,
      stats_slide_step: 0,
      escala_ui: 1
    },
    votacion_ventaja: {
      activa: false,
      equipo: "",
      opciones: [],
      votos: {}
    },
    desventajas: [],
    teleprompter: {
      state: {
        visible: false,
        playing: false,
        text: "",
        source: 0,
        loadId: 0,
        fontSize: 36,
        speed: 25
      }
    },
    resurreccion: {
      1: { player: 1, menu: "hidden", visible: false },
      2: { player: 2, menu: "hidden", visible: false }
    },
    musas: {
      contador: { escritxr1: 0, escritxr2: 0 },
      corazones: {
        1: { count: 0, ts: 0 },
        2: { count: 0, ts: 0 }
      }
    },
    stats: { players: { 1: {}, 2: {} } }
  };
}

function crearIo() {
  const emisiones = [];
  return {
    emisiones,
    to(room) {
      return {
        emit(event, payload) {
          emisiones.push({ room, event, payload });
        }
      };
    }
  };
}

test("semantic events have the exact Spanish contract, monotonic IDs and room-only emission", () => {
  const io = crearIo();
  let reloj = 1000;
  const diario = crearEstadoDramaturgia({
    io,
    now: () => reloj
  });

  const primero = diario.registrarEvento({
    checkpoint_id: "checkpoint-importado",
    tipo: "prueba",
    titulo: "Primer hecho",
    detalle: "Detalle",
    espacio: "sistema",
    fase: "juego",
    modo: "tertulia",
    modo_seq: 3,
    causa_ids: [],
    hechos: { valor: 1 }
  });
  reloj += 10;
  const segundo = diario.registrarEvento({
    tipo: "prueba",
    titulo: "Segundo hecho",
    hechos: { valor: 2 }
  });

  assert.deepEqual(Object.keys(primero), [
    "id",
    "seq",
    "ts",
    "checkpoint_id",
    "tipo",
    "titulo",
    "detalle",
    "espacio",
    "fase",
    "modo",
    "modo_seq",
    "causa_ids",
    "hechos"
  ]);
  assert.equal(primero.seq, 1);
  assert.equal(segundo.seq, 2);
  assert.match(primero.id, /^scrib-[^:]+:1$/);
  assert.equal(primero.checkpoint_id, "checkpoint-importado");
  assert.match(segundo.checkpoint_id, /^scrib-[^:]+:checkpoint:1$/);
  assert.notEqual(segundo.checkpoint_id, primero.checkpoint_id);
  assert.deepEqual(segundo.causa_ids, [primero.id]);
  assert.equal(io.emisiones.length, 2);
  assert.equal(io.emisiones[0].room, DRAMATURGIA_ROOM);
  assert.equal(io.emisiones[0].event, DRAMATURGIA_EVENT);
  assert.equal(io.emisiones.some(({ event }) => event === DRAMATURGIA_CHECKPOINT_EVENT), false);

  primero.hechos.valor = 99;
  primero.checkpoint_id = "mutado";
  assert.equal(diario.snapshot().eventos[0].hechos.valor, 1);
  assert.equal(diario.snapshot().eventos[0].checkpoint_id, "checkpoint-importado");
});

test("each non-empty capture emits one causal checkpoint and empty captures emit none", () => {
  const io = crearIo();
  let reloj = 1800;
  const estado = estadoBase();
  const diario = crearEstadoDramaturgia({
    io,
    now: () => reloj
  });
  const causaExterna = diario.registrarEvento({
    tipo: "modo",
    titulo: "Modo previo",
    modo: "espera"
  });
  io.emisiones.length = 0;

  estado.partida.modo_actual = "tertulia";
  estado.partida.timeline = [
    { modo: "tertulia", origen: "inicio", ts: reloj }
  ];
  const nuevos = diario.capturar(estado);
  const emisionesCheckpoint = io.emisiones.filter(
    ({ event }) => event === DRAMATURGIA_CHECKPOINT_EVENT
  );

  assert.ok(nuevos.length > 1);
  assert.equal(new Set(nuevos.map(({ checkpoint_id }) => checkpoint_id)).size, 1);
  assert.equal(emisionesCheckpoint.length, 1);
  assert.deepEqual(Object.keys(emisionesCheckpoint[0].payload), [
    "id",
    "session_id",
    "ts",
    "seq_start",
    "seq_end",
    "event_ids",
    "causa_ids"
  ]);
  assert.equal(emisionesCheckpoint[0].room, DRAMATURGIA_ROOM);
  assert.equal(emisionesCheckpoint[0].payload.id, nuevos[0].checkpoint_id);
  assert.equal(emisionesCheckpoint[0].payload.session_id, diario.snapshot().session.id);
  assert.equal(emisionesCheckpoint[0].payload.ts, reloj);
  assert.equal(emisionesCheckpoint[0].payload.seq_start, nuevos[0].seq);
  assert.equal(emisionesCheckpoint[0].payload.seq_end, nuevos.at(-1).seq);
  assert.deepEqual(
    emisionesCheckpoint[0].payload.event_ids,
    nuevos.map(({ id }) => id)
  );
  assert.equal(emisionesCheckpoint[0].payload.causa_ids.includes(causaExterna.id), true);
  assert.equal(
    emisionesCheckpoint[0].payload.causa_ids.some((id) => nuevos.some((evento) => evento.id === id)),
    false
  );
  const guardados = diario.snapshot().eventos.filter(({ id }) =>
    nuevos.some((evento) => evento.id === id)
  );
  assert.deepEqual(
    guardados.map(({ checkpoint_id }) => checkpoint_id),
    nuevos.map(({ checkpoint_id }) => checkpoint_id)
  );

  io.emisiones.length = 0;
  reloj += 1000;
  assert.deepEqual(diario.capturar(estado), []);
  assert.equal(
    io.emisiones.some(({ event }) => event === DRAMATURGIA_CHECKPOINT_EVENT),
    false
  );
});

test("periodic capture derives all requested semantic state families without duplicate ticks", () => {
  const io = crearIo();
  let reloj = 2000;
  const estado = estadoBase();
  const diario = crearEstadoDramaturgia({
    io,
    now: () => reloj,
    textoReposoMs: 100,
    textoEsperaMaxMs: 500
  });

  diario.capturar(estado);
  const eventosIniciales = diario.snapshot().eventos.length;

  reloj = 3000;
  estado.connections.control = { count: 1, connected: true };
  estado.connections.dramaturgia = { count: 1, connected: true };
  estado.partida.modo_actual = "tertulia";
  estado.partida.timeline = [
    { modo: "tertulia", origen: "inicio", ts: reloj }
  ];
  estado.conteos[1].modo_seq = 4;
  estado.conteos[2].modo_seq = 4;
  estado.inspiracion.preview = { modo_actual: "tertulia", modo_seq: 4 };
  estado.textos[1].plano = "Una escena empieza junto al río.";
  estado.inspiracion.ultimas[1] = {
    palabra: "río",
    musa: "Luna",
    modo_actual: "tertulia",
    ts: reloj
  };
  estado.inspiracion.nube.equipos[1].palabras = ["río"];
  estado.votacion_ventaja = {
    activa: true,
    equipo: "j1",
    opciones: ["A", "B"],
    votos: { A: 0, B: 0 },
    duracion_ms: 5000,
    termina_en_ts: 8000
  };
  estado.teleprompter.state = {
    ...estado.teleprompter.state,
    visible: true,
    playing: true,
    source: 1,
    text: "Una escena empieza junto al río.",
    loadId: 8
  };
  estado.resurreccion[2] = {
    player: 2,
    menu: "quantity",
    visible: true,
    palabras: 3,
    max: 20,
    segundos: 9
  };
  estado.tutorial = {
    ...estado.tutorial,
    activo: true,
    vista: true,
    solicitud: "Encuentra una palabra"
  };
  estado.espectador = {
    ...estado.espectador,
    modo: "stats",
    override: "stats"
  };
  estado.desventajas = [
    { player: 2, putada: "espejo", duracion_ms: 5000, pausada: false }
  ];
  estado.musas.corazones[1] = { count: 2, ts: reloj };

  const nuevos = diario.capturar(estado);
  const tipos = new Set(nuevos.map(({ tipo }) => tipo));

  [
    "modo",
    "fase",
    "texto",
    "inspiracion",
    "inspiracion_nube",
    "votacion",
    "teleprompter",
    "resurreccion",
    "calentamiento",
    "vista_espectador",
    "desventaja",
    "corazones",
    "presencias"
  ].forEach((tipo) => assert.equal(tipos.has(tipo), true, `falta ${tipo}`));

  const texto = nuevos.find(({ tipo }) => tipo === "texto");
  const inspiracion = nuevos.find(({ tipo }) => tipo === "inspiracion");
  const teleprompter = nuevos.find(({ tipo }) => tipo === "teleprompter");
  assert.equal(texto.causa_ids.includes(inspiracion.id), true);
  assert.equal(teleprompter.causa_ids.includes(texto.id), true);

  const total = diario.snapshot().eventos.length;
  reloj += 1000;
  diario.capturar(estado);
  assert.equal(diario.snapshot().eventos.length, total);
  assert.ok(total > eventosIniciales);
});

test("text checkpoints are coalesced independently, suppress duplicates and flush at max wait", () => {
  let reloj = 1000;
  const estado = estadoBase();
  const diario = crearEstadoDramaturgia({
    now: () => reloj,
    textoReposoMs: 100,
    textoEsperaMaxMs: 300
  });
  diario.capturar(estado);

  estado.textos[1].plano = "A";
  reloj = 1050;
  diario.capturar(estado);
  estado.textos[1].plano = "AB";
  estado.textos[2].plano = "Rojo";
  reloj = 1100;
  diario.capturar(estado);
  estado.textos[1].plano = "ABC";
  reloj = 1150;
  diario.capturar(estado);

  assert.equal(
    diario.snapshot().eventos.filter(({ tipo }) => tipo === "texto").length,
    0
  );

  reloj = 1250;
  diario.capturar(estado);
  let textos = diario.snapshot().eventos.filter(({ tipo }) => tipo === "texto");
  assert.equal(textos.length, 2);
  assert.deepEqual(textos.map(({ hechos }) => hechos.player).sort(), [1, 2]);
  assert.equal(textos.find(({ hechos }) => hechos.player === 1).hechos.texto, "ABC");

  reloj = 1400;
  diario.capturar(estado);
  assert.equal(
    diario.snapshot().eventos.filter(({ tipo }) => tipo === "texto").length,
    2
  );

  estado.textos[1].plano = "ABCD";
  reloj = 1450;
  diario.capturar(estado);
  estado.textos[1].plano = "ABCDE";
  reloj = 1600;
  diario.capturar(estado);
  estado.textos[1].plano = "ABCDEF";
  reloj = 1760;
  diario.capturar(estado);

  textos = diario.snapshot().eventos.filter(({ tipo }) => tipo === "texto");
  assert.equal(textos.length, 3);
  assert.equal(textos.at(-1).hechos.texto, "ABCDEF");
});

test("timeline window shifts keep the same session while a disjoint new timeline opens another", () => {
  let reloj = 1000;
  const estado = estadoBase();
  const diario = crearEstadoDramaturgia({ now: () => reloj });
  diario.capturar(estado);

  estado.partida.modo_actual = "uno";
  estado.partida.timeline = [
    { modo: "uno", origen: "runtime", ts: 1100 },
    { modo: "dos", origen: "runtime", ts: 1200 },
    { modo: "tres", origen: "runtime", ts: 1300 }
  ];
  reloj = 1400;
  diario.capturar(estado);
  const primeraSesion = diario.snapshot().session.id;

  estado.partida.modo_actual = "tres";
  estado.partida.timeline = [
    { modo: "dos", origen: "runtime", ts: 1200 },
    { modo: "tres", origen: "runtime", ts: 1300 },
    { modo: "cuatro", origen: "runtime", ts: 1500 }
  ];
  reloj = 1500;
  diario.capturar(estado);
  assert.equal(diario.snapshot().session.id, primeraSesion);

  estado.partida.modo_actual = "nuevo";
  estado.partida.timeline = [
    { modo: "nuevo", origen: "inicio", ts: 2000 }
  ];
  reloj = 2000;
  diario.capturar(estado);
  assert.notEqual(diario.snapshot().session.id, primeraSesion);
  assert.equal(diario.snapshot().eventos[0].tipo, "sesion");
});

test("journal is bounded by count and bytes and snapshots are defensive", () => {
  const diario = crearEstadoDramaturgia({
    maxEventos: 20,
    maxBytes: 16 * 1024
  });

  for (let i = 0; i < 30; i += 1) {
    diario.registrarEvento({
      tipo: "carga",
      titulo: `Evento ${i}`,
      hechos: { texto: "x".repeat(3000), indice: i }
    });
  }

  const snapshot = diario.snapshot();
  const metricas = diario.metricas();
  assert.ok(snapshot.eventos.length <= 20);
  assert.ok(metricas.bytes <= metricas.max_bytes);
  assert.ok(metricas.descartados > 0);
  assert.equal(snapshot.session.last_seq, 30);
  snapshot.eventos[0].titulo = "mutado";
  assert.notEqual(diario.snapshot().eventos[0].titulo, "mutado");
});

test("interval starts once, unrefs, stops and recovers after a transient state-provider error", () => {
  const callbacks = [];
  const cleared = [];
  const logs = [];
  let unrefs = 0;
  let intentos = 0;
  const handle = {
    unref() {
      unrefs += 1;
    }
  };
  const diario = crearEstadoDramaturgia({
    obtenerEstadoActual() {
      intentos += 1;
      if (intentos === 1) throw new Error("temporal");
      return estadoBase();
    },
    setIntervalFn(callback, ms) {
      callbacks.push({ callback, ms });
      return handle;
    },
    clearIntervalFn(value) {
      cleared.push(value);
    },
    registrar(message) {
      logs.push(message);
    }
  });

  assert.equal(diario.iniciar(), handle);
  assert.equal(diario.iniciar(), handle);
  assert.equal(callbacks.length, 1);
  assert.equal(unrefs, 1);
  assert.match(logs[0], /temporal/);

  callbacks[0].callback();
  assert.equal(diario.snapshot().eventos[0].tipo, "sesion");
  assert.equal(diario.detener(), true);
  assert.equal(diario.detener(), false);
  assert.deepEqual(cleared, [handle]);
});
