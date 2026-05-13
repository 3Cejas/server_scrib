const test = require("node:test");
const assert = require("node:assert/strict");

const {
  crearGestorNubeInspiracion,
  extraerPalabrasInfoNubeInspiracion,
  extraerPalabrasNubeInspiracion
} = require("../nube_inspiracion.js");

test("nube inspiration exposes repeated queued words as superbonus metadata", () => {
  const queue = [
    { palabra: "bruma", musa: "Musa Solo", client_id: "solo" },
    { palabra: "Cometa", musa: "Musa Uno", client_id: "uno" },
    { palabra: "cometa", musa: "Musa Dos", client_id: "dos" }
  ];

  assert.deepEqual(extraerPalabrasNubeInspiracion(queue), ["bruma", "Cometa"]);
  assert.deepEqual(extraerPalabrasInfoNubeInspiracion(queue, 120, { detectarSuperbonus: true }), [
    {
      palabra: "bruma",
      repeticiones: 1,
      superbonus: false,
      musas: ["Musa Solo"]
    },
    {
      palabra: "Cometa",
      repeticiones: 2,
      superbonus: true,
      musas: ["Musa Uno", "Musa Dos"]
    }
  ]);
});

test("nube inspiration counts distinct muses for superbonus", () => {
  const repeatedBySameMuse = [
    { palabra: "Cometa", musa: "Musa Uno", client_id: "misma" },
    { palabra: "cometa", musa: "Musa Uno", client_id: "misma" }
  ];
  const repeatedByDifferentMuses = [
    { palabra: "Cometa", musa: "Musa", client_id: "uno" },
    { palabra: "cometa", musa: "Musa", client_id: "dos" }
  ];

  assert.deepEqual(extraerPalabrasInfoNubeInspiracion(repeatedBySameMuse, 120, { detectarSuperbonus: true }), [
    {
      palabra: "Cometa",
      repeticiones: 1,
      superbonus: false,
      musas: ["Musa Uno"]
    }
  ]);
  assert.deepEqual(extraerPalabrasInfoNubeInspiracion(repeatedByDifferentMuses, 120, { detectarSuperbonus: true }), [
    {
      palabra: "Cometa",
      repeticiones: 2,
      superbonus: true,
      musas: ["Musa"]
    }
  ]);
});

test("nube inspiration payload keeps strings compatible and adds info when useful", () => {
  const gestor = crearGestorNubeInspiracion({
    getModoActual: () => "palabras bonus",
    getMotores: () => ({
      bonus: {
        players: {
          1: {
            queue: [
              { palabra: "cometa", musa: "Musa Uno" },
              { palabra: "COMETA", musa: "Musa Dos" }
            ]
          },
          2: { queue: [] }
        }
      }
    })
  });

  const payload = gestor.payload();

  assert.deepEqual(payload.equipos[1].palabras, ["cometa"]);
  assert.deepEqual(payload.equipos[1].palabras_info, [
    {
      palabra: "cometa",
      repeticiones: 2,
      superbonus: true,
      musas: ["Musa Uno", "Musa Dos"]
    }
  ]);
  assert.deepEqual(payload.equipos[2].palabras, []);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.equipos[2], "palabras_info"), false);
});
