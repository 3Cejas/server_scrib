const { ProfanityEngine } = require("profanity-guard");

const IDIOMAS_FILTRO_OFENSIVO = Object.freeze([
    "ar",
    "br",
    "de",
    "en",
    "es",
    "fr",
    "hi",
    "ko",
    "ru",
    "zh"
]);

// El diccionario general incluye algunos términos descriptivos que no son
// palabrotas. Se permiten por defecto para no limitar las propuestas creativas.
const PALABRAS_PERMITIDAS_POR_DEFECTO = Object.freeze([
    "asesinato",
    "concha",
    "coprofagia",
    "drogas",
    "esperma",
    "haciendo el amor",
    "heroina",
    "infierno",
    "martillo",
    "orina",
    "pezon",
    "pis",
    "semen",
    "sexo",
    "sexo oral",
    "travesti",
    "trio",
    "vulva"
]);

const REGEX_CARACTERES_INVISIBLES = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
const MAPA_HOMOGLIFOS = Object.freeze({
    // Cirílico que suele usarse para imitar letras latinas.
    "а": "a",
    "в": "b",
    "е": "e",
    "і": "i",
    "ј": "j",
    "к": "k",
    "м": "m",
    "н": "h",
    "о": "o",
    "р": "p",
    "с": "c",
    "ѕ": "s",
    "т": "t",
    "у": "y",
    "х": "x",
    // Griego que suele usarse para la misma evasión visual.
    "α": "a",
    "β": "b",
    "ε": "e",
    "ι": "i",
    "κ": "k",
    "μ": "m",
    "ν": "v",
    "ο": "o",
    "ρ": "p",
    "τ": "t",
    "υ": "u",
    "χ": "x"
});

const normalizarListaConfigurada = (valor) => {
    if (Array.isArray(valor)) {
        return valor
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean);
    }
    if (typeof valor !== "string") return [];
    return valor
        .split(/[\n,;]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
};

const normalizarUnicodeParaFiltro = (valor) => {
    if (typeof valor !== "string") return "";
    return valor
        .normalize("NFKC")
        .replace(REGEX_CARACTERES_INVISIBLES, "")
        .trim();
};

const sustituirHomoglifos = (valor) => {
    let salida = "";
    for (const caracter of valor) {
        const minuscula = caracter.toLocaleLowerCase();
        salida += MAPA_HOMOGLIFOS[minuscula] || caracter;
    }
    return salida;
};

function crearFiltroLenguajeOfensivo({
    palabrasExtra = normalizarListaConfigurada(process.env.SCRIB_PROFANITY_EXTRA_WORDS),
    palabrasPermitidas = normalizarListaConfigurada(process.env.SCRIB_PROFANITY_ALLOW_WORDS)
} = {}) {
    const extras = normalizarListaConfigurada(palabrasExtra);
    const permitidas = [
        ...PALABRAS_PERMITIDAS_POR_DEFECTO,
        ...normalizarListaConfigurada(palabrasPermitidas)
    ];
    const motor = new ProfanityEngine({
        language: "all",
        addWords: extras,
        whitelist: permitidas
    });

    const contieneLenguajeOfensivo = (valor) => {
        const normalizado = normalizarUnicodeParaFiltro(valor);
        if (!normalizado) return false;
        const candidatos = new Set([
            normalizado,
            sustituirHomoglifos(normalizado)
        ]);
        return Array.from(candidatos).some((candidato) => motor.check(candidato));
    };

    return Object.freeze({
        contieneLenguajeOfensivo,
        idiomas: IDIOMAS_FILTRO_OFENSIVO
    });
}

const filtroLenguajeOfensivo = crearFiltroLenguajeOfensivo();

module.exports = {
    IDIOMAS_FILTRO_OFENSIVO,
    PALABRAS_PERMITIDAS_POR_DEFECTO,
    crearFiltroLenguajeOfensivo,
    normalizarListaConfigurada,
    normalizarUnicodeParaFiltro,
    sustituirHomoglifos,
    contieneLenguajeOfensivo: filtroLenguajeOfensivo.contieneLenguajeOfensivo
};
