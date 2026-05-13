const ALFABETO_ES = Object.freeze([
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
    '\u00f1', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
]);

const FRECUENCIA_LETRAS_ES = Object.freeze({
    a: 12.53,
    b: 1.42,
    c: 4.68,
    d: 5.86,
    e: 13.68,
    f: 0.69,
    g: 1.01,
    h: 0.70,
    i: 6.25,
    j: 0.44,
    k: 0.02,
    l: 4.97,
    m: 3.15,
    n: 6.71,
    '\u00f1': 0.31,
    o: 8.68,
    p: 2.51,
    q: 0.88,
    r: 6.87,
    s: 7.98,
    t: 4.63,
    u: 3.93,
    v: 0.90,
    w: 0.01,
    x: 0.22,
    y: 0.90,
    z: 0.52
});

const FRECUENCIA_MAXIMA_ES = Math.max(...Object.values(FRECUENCIA_LETRAS_ES));
const FRECUENCIA_MINIMA_ES = Math.min(...Object.values(FRECUENCIA_LETRAS_ES));

function normalizarLetraFrecuencia(letra) {
    return String(letra || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/([^n\u0300-\u036f]|n(?!\u0303(?![\u0300-\u036f])))[\u0300-\u036f]+/gi, '$1')
        .normalize('NFC')
        .slice(0, 1);
}

function frecuenciaLetraEs(letra) {
    const normalizada = normalizarLetraFrecuencia(letra);
    const frecuencia = FRECUENCIA_LETRAS_ES[normalizada];
    return Number.isFinite(frecuencia) && frecuencia > 0 ? frecuencia : FRECUENCIA_MINIMA_ES;
}

function tipoLetraBendita(tipo) {
    return String(tipo || '').toLowerCase().includes('bendita');
}

function pesoLetraPorModo(letra, tipo) {
    const frecuencia = frecuenciaLetraEs(letra);
    if (tipoLetraBendita(tipo)) {
        return Math.max(FRECUENCIA_MINIMA_ES, (FRECUENCIA_MAXIMA_ES + FRECUENCIA_MINIMA_ES) - frecuencia);
    }
    return frecuencia;
}

function elegirLetraPonderada(lista, tipo, random = Math.random) {
    const letras = (Array.isArray(lista) ? lista : [])
        .map(normalizarLetraFrecuencia)
        .filter((letra) => Object.prototype.hasOwnProperty.call(FRECUENCIA_LETRAS_ES, letra));
    if (!letras.length) {
        return '';
    }
    const pesos = letras.map((letra) => pesoLetraPorModo(letra, tipo));
    const total = pesos.reduce((suma, peso) => suma + peso, 0);
    const tirada = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
    let acumulado = 0;
    for (let i = 0; i < letras.length; i += 1) {
        acumulado += pesos[i];
        if (tirada < acumulado) {
            return letras[i];
        }
    }
    return letras[letras.length - 1];
}

function elegirLetraPendientePonderada({ pendientes, base = ALFABETO_ES, tipo, random = Math.random } = {}) {
    const lista = Array.isArray(pendientes) && pendientes.length > 0
        ? pendientes.map(normalizarLetraFrecuencia).filter(Boolean)
        : [...base];
    const letra = elegirLetraPonderada(lista, tipo, random);
    const indice = lista.indexOf(letra);
    if (indice >= 0) {
        lista.splice(indice, 1);
    }
    return {
        letra,
        pendientes: lista.length === 0 ? [...base] : lista
    };
}

module.exports = {
    ALFABETO_ES,
    FRECUENCIA_LETRAS_ES,
    elegirLetraPendientePonderada,
    elegirLetraPonderada,
    frecuenciaLetraEs,
    normalizarLetraFrecuencia,
    pesoLetraPorModo
};
