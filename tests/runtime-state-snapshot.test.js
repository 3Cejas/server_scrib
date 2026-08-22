const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DRAMATURGIA_SCHEMA_VERSION,
  crearRuntimeStateSnapshot
} = require("../runtime_state_snapshot.js");

function crearGestor() {
  let nombre = "Equipo Azul";
  let contadorSnapshot = 0;
  const gestor = crearRuntimeStateSnapshot({
    testHooksEnabled: true,
    payloadConexionesRoles: () => ({
      dramaturgia: { count: 1, connected: true }
    }),
    snapshotPartidaTest: (timeline) => ({
      modo_actual: "tertulia",
      timeline: [...timeline]
    }),
    writerChannels: {
      snapshotTextos: () => ({
        1: { html: { text: "Texto azul" }, plano: "Texto azul" },
        2: { html: { text: "Texto rojo" }, plano: "Texto rojo" }
      }),
      getNombre: (player) => (player === 1 ? nombre : "Equipo Rojo"),
      snapshotAtributos: () => ({
        1: { genero: "comedia" },
        2: { genero: "tragedia" }
      })
    },
    construirPayloadInspiracionMusaActual: () => ({
      modo_actual: "tertulia",
      modo_seq: 4
    }),
    nubeInspiracion: {
      snapshot: () => ({
        nube: { equipos: { 1: { palabras: [] }, 2: { palabras: [] } } },
        ultimas: { 1: null, 2: null }
      })
    },
    payloadEstadoCalentamiento: () => ({ activo: false, vista: false }),
    payloadVistaEspectadorModo: () => ({ modo: "partida" }),
    construirPayloadEstadoVotacionVentaja: () => ({ activa: false }),
    payloadDesventajasActivas: () => [],
    teleprompter: {
      snapshot: () => ({ state: { visible: false } })
    },
    payloadEstadoResurreccion: () => ({
      1: { player: 1, visible: false },
      2: { player: 2, visible: false }
    }),
    obtenerContadorMusas: () => ({ escritxr1: 2, escritxr2: 3 }),
    musasAuxiliares: {
      snapshot: () => ({
        banderas: { activa: false },
        corazones: { 1: { count: 0 }, 2: { count: 0 } }
      })
    },
    payloadStatsLive: () => ({
      players: { 1: { nombre }, 2: { nombre: "Equipo Rojo" } }
    }),
    snapshotConteosDramaturgia: () => {
      contadorSnapshot += 1;
      return {
        1: { count_text: "00:30", snapshot: contadorSnapshot },
        2: { count_text: "00:40", snapshot: contadorSnapshot }
      };
    },
    obtenerDiarioDramaturgia: () => ({
      session: {
        id: "sesion-1",
        started_at: 1000,
        last_seq: 2
      },
      eventos: [
        {
          id: "sesion-1:2",
          seq: 2,
          ts: 2000,
          tipo: "modo",
          titulo: "Tertulia",
          detalle: "",
          espacio: "sistema",
          fase: "juego",
          modo: "tertulia",
          modo_seq: 4,
          causa_ids: [],
          hechos: {}
        }
      ]
    })
  });
  return {
    gestor,
    setNombre(valor) {
      nombre = valor;
    }
  };
}

test("production dramaturgy snapshot is separate from test state and matches the frontend envelope", () => {
  const { gestor } = crearGestor();
  gestor.registrarTimelineModo("tertulia", "test");

  const testState = gestor.construirEstadoTest();
  const dramaturgy = gestor.construirEstadoDramaturgia();

  assert.equal(testState.enabled, true);
  assert.equal(Object.prototype.hasOwnProperty.call(dramaturgy, "enabled"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dramaturgy, "actual"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dramaturgy, "sesion"), false);
  assert.equal(dramaturgy.schema_version, DRAMATURGIA_SCHEMA_VERSION);
  assert.deepEqual(dramaturgy.session, {
    id: "sesion-1",
    started_at: 1000,
    last_seq: 2
  });
  assert.equal(dramaturgy.partida.modo_actual, "tertulia");
  assert.equal(dramaturgy.textos[1].plano, "Texto azul");
  assert.equal(dramaturgy.nombres[1], "Equipo Azul");
  assert.deepEqual(dramaturgy.atributos[2], { genero: "tragedia" });
  assert.equal(dramaturgy.conteos[1].count_text, "00:30");
  assert.equal(dramaturgy.stats.players[1].nombre, "Equipo Azul");
  assert.equal(dramaturgy.eventos.length, 1);
});

test("dramaturgy snapshot is freshly built and targeted emission returns its payload", () => {
  const { gestor, setNombre } = crearGestor();
  const emisiones = [];
  const socket = {
    emit(event, payload) {
      emisiones.push({ event, payload });
    }
  };

  const primero = gestor.emitirEstadoDramaturgia(socket);
  setNombre("Azul Mutado");
  const segundo = gestor.emitirEstadoDramaturgia(socket);

  assert.equal(emisiones.length, 2);
  assert.equal(emisiones[0].event, "dramaturgia_estado");
  assert.equal(emisiones[0].payload, primero);
  assert.equal(emisiones[1].payload, segundo);
  assert.equal(primero.nombres[1], "Equipo Azul");
  assert.equal(segundo.nombres[1], "Azul Mutado");
  assert.equal(primero.conteos[1].snapshot, 1);
  assert.equal(segundo.conteos[1].snapshot, 2);
  assert.equal(gestor.emitirEstadoDramaturgia(null), null);
});
