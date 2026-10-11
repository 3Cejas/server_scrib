(function (root) {
    "use strict";

    const TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿÑñÜü]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿÑñÜü]+)?|\d+|\s+|./g;
    const WORD_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÑñÜü]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿÑñÜü]+)?$/;
    const DEFAULT_STEP = 7;
    const DEFAULT_CARADEC_LENGTH = 12;

    const DEFAULT_NOUNS = [
        ["abacería", "f"], ["abacero", "m"], ["ábaco", "m"], ["abad", "m"], ["abadía", "f"],
        ["abajo", "m"], ["abalorio", "m"], ["abandono", "m"], ["abanico", "m"], ["abeja", "f"],
        ["abismo", "m"], ["abogado", "m"], ["abrazo", "m"], ["abril", "m"], ["abuela", "f"],
        ["abuelo", "m"], ["academia", "f"], ["acantilado", "m"], ["acento", "m"], ["acera", "f"],
        ["acero", "m"], ["acertijo", "m"], ["acorde", "m"], ["actriz", "f"], ["actor", "m"],
        ["agua", "f"], ["aguja", "f"], ["aire", "m"], ["ajedrez", "m"], ["ala", "f"],
        ["alba", "f"], ["aldea", "f"], ["alegría", "f"], ["alfabeto", "m"], ["alfil", "m"],
        ["alma", "f"], ["almanaque", "m"], ["altar", "m"], ["altura", "f"], ["amapola", "f"],
        ["amigo", "m"], ["amor", "m"], ["ancla", "f"], ["andamio", "m"], ["ángel", "m"],
        ["animal", "m"], ["anillo", "m"], ["anochecer", "m"], ["antena", "f"], ["aparato", "m"],
        ["árbol", "m"], ["archivo", "m"], ["arena", "f"], ["argumento", "m"], ["armario", "m"],
        ["arpa", "f"], ["arte", "m"], ["asamblea", "f"], ["asesino", "m"], ["asombro", "m"],
        ["astro", "m"], ["atajo", "m"], ["atmósfera", "f"], ["aula", "f"], ["ausencia", "f"],
        ["autor", "m"], ["aventura", "f"], ["azotea", "f"], ["azúcar", "m"], ["bailarina", "f"],
        ["balanza", "f"], ["balcón", "m"], ["banco", "m"], ["bandera", "f"], ["barco", "m"],
        ["barrio", "m"], ["batalla", "f"], ["biblioteca", "f"], ["bicicleta", "f"], ["boca", "f"],
        ["bolígrafo", "m"], ["bosque", "m"], ["brasa", "f"], ["brillo", "m"], ["brújula", "f"],
        ["burbuja", "f"], ["caballo", "m"], ["cabaña", "f"], ["cabeza", "f"], ["cable", "m"],
        ["café", "m"], ["caja", "f"], ["calle", "f"], ["calor", "m"], ["cámara", "f"],
        ["campana", "f"], ["campo", "m"], ["canción", "f"], ["cansancio", "m"], ["capa", "f"],
        ["cara", "f"], ["caracol", "m"], ["caravana", "f"], ["carcajada", "f"], ["carta", "f"],
        ["casa", "f"], ["casco", "m"], ["castillo", "m"], ["catálogo", "m"], ["caudal", "m"],
        ["caverna", "f"], ["cebolla", "f"], ["ceja", "f"], ["celda", "f"], ["ceniza", "f"],
        ["centro", "m"], ["cereza", "f"], ["cerilla", "f"], ["cerro", "m"], ["charco", "m"],
        ["cielo", "m"], ["ciudad", "f"], ["claridad", "f"], ["clavo", "m"], ["cobijo", "m"],
        ["coche", "m"], ["cocina", "f"], ["cofre", "m"], ["cohete", "m"], ["colina", "f"],
        ["colmena", "f"], ["cometa", "m"], ["comida", "f"], ["compás", "m"], ["concierto", "m"],
        ["conjuro", "m"], ["corazón", "m"], ["corbata", "f"], ["cordillera", "f"], ["corona", "f"],
        ["cortina", "f"], ["cosecha", "f"], ["cráter", "m"], ["cristal", "m"], ["cuaderno", "m"],
        ["cuento", "m"], ["cuerpo", "m"], ["cuerda", "f"], ["cueva", "f"], ["cuchara", "f"],
        ["dado", "m"], ["dama", "f"], ["danza", "f"], ["dedo", "m"], ["desierto", "m"],
        ["destino", "m"], ["diccionario", "m"], ["diente", "m"], ["diosa", "f"], ["disfraz", "m"],
        ["domingo", "m"], ["dragón", "m"], ["eco", "m"], ["eclipse", "m"], ["edificio", "m"],
        ["ejército", "m"], ["elefante", "m"], ["embudo", "m"], ["emoción", "f"], ["enciclopedia", "f"],
        ["enemigo", "m"], ["ensayo", "m"], ["entusiasmo", "m"], ["escala", "f"], ["escena", "f"],
        ["escritura", "f"], ["escudo", "m"], ["esfera", "f"], ["espejo", "m"], ["espina", "f"],
        ["estrella", "f"], ["estuche", "m"], ["fábula", "f"], ["familia", "f"], ["fantasma", "m"],
        ["faro", "m"], ["fecha", "f"], ["felicidad", "f"], ["feria", "f"], ["figura", "f"],
        ["flauta", "f"], ["flor", "f"], ["foguera", "f"], ["frase", "f"], ["frontera", "f"],
        ["fuego", "m"], ["fuente", "f"], ["gacela", "f"], ["galaxia", "f"], ["gallina", "f"],
        ["gato", "m"], ["gesto", "m"], ["grieta", "f"], ["guante", "m"], ["guitarra", "f"],
        ["habitacion", "f"], ["hacha", "f"], ["hada", "f"], ["harina", "f"], ["hechizo", "m"],
        ["herida", "f"], ["héroe", "m"], ["hoguera", "f"], ["horizonte", "m"], ["humo", "m"],
        ["idea", "f"], ["iglesia", "f"], ["imagen", "f"], ["imperio", "m"], ["incendio", "m"],
        ["isla", "f"], ["jardín", "m"], ["jaula", "f"], ["jeringa", "f"], ["jornada", "f"],
        ["juego", "m"], ["lago", "m"], ["lámpara", "f"], ["lápiz", "m"], ["latido", "m"],
        ["leyenda", "f"], ["libro", "m"], ["llave", "f"], ["lluvia", "f"], ["lobo", "m"],
        ["luna", "f"], ["luz", "f"], ["madre", "f"], ["madera", "f"], ["magia", "f"],
        ["maleta", "f"], ["mano", "f"], ["mapa", "m"], ["mar", "m"], ["mariposa", "f"],
        ["máscara", "f"], ["memoria", "f"], ["mercado", "m"], ["mesa", "f"], ["método", "m"],
        ["minuto", "m"], ["mirada", "f"], ["montaña", "f"], ["mundo", "m"], ["muro", "m"],
        ["música", "f"], ["naranja", "f"], ["nave", "f"], ["noche", "f"], ["nombre", "m"],
        ["nube", "f"], ["océano", "m"], ["oficio", "m"], ["ojo", "m"], ["ola", "f"],
        ["olvido", "m"], ["orilla", "f"], ["oro", "m"], ["página", "f"], ["palabra", "f"],
        ["palabrista", "m"], ["palacio", "m"], ["papel", "m"], ["paraguas", "m"], ["pared", "f"],
        ["parque", "m"], ["pasillo", "m"], ["pájaro", "m"], ["paz", "f"], ["peine", "m"],
        ["pelota", "f"], ["pensamiento", "m"], ["persona", "f"], ["pescado", "m"], ["piedra", "f"],
        ["piel", "f"], ["pieza", "f"], ["pincel", "m"], ["pirámide", "f"], ["pizarra", "f"],
        ["planeta", "m"], ["planta", "f"], ["plato", "m"], ["playa", "f"], ["pluma", "f"],
        ["poema", "m"], ["poeta", "m"], ["puente", "m"], ["puerta", "f"], ["queso", "m"],
        ["rama", "f"], ["recuerdo", "m"], ["rejera", "f"], ["relámpago", "m"], ["reloj", "m"],
        ["río", "m"], ["rueda", "f"], ["sala", "f"], ["semilla", "f"], ["silla", "f"],
        ["sombra", "f"], ["sonrisa", "f"], ["sueño", "m"], ["teatro", "m"], ["texto", "m"],
        ["tinta", "f"], ["tormenta", "f"], ["torre", "f"], ["tren", "m"], ["universo", "m"],
        ["ventana", "f"], ["viaje", "m"], ["voz", "f"], ["zapato", "m"], ["zuzón", "m"]
    ];

    const DEFAULT_ADJECTIVES = [
        "abierto", "absurdo", "ácido", "admirable", "afilado", "ágil", "alegre", "alto",
        "amable", "amarillo", "antiguo", "ardiente", "áspero", "atento", "azul", "bajo",
        "bello", "blanco", "blando", "breve", "brillante", "brusco", "bueno", "cálido",
        "callado", "claro", "común", "confuso", "cruel", "curioso", "débil", "delgado",
        "difícil", "dulce", "duro", "eléctrico", "enorme", "extraño", "falso", "familiar",
        "feliz", "firme", "frágil", "frío", "fuerte", "generoso", "gigante", "grave",
        "gris", "hermoso", "hondo", "humilde", "imposible", "intenso", "joven", "lento",
        "ligero", "limpio", "lúcido", "luminoso", "mágico", "malo", "manso", "mínimo",
        "misterioso", "moderno", "negro", "nuevo", "oscuro", "pequeño", "perezoso", "pobre",
        "profundo", "rápido", "raro", "redondo", "rojo", "salvaje", "seco", "secreto",
        "simple", "suave", "tímido", "torpe", "tranquilo", "triste", "último", "vacío",
        "verde", "viejo", "violento", "visible", "vivo"
    ];

    const DEFAULT_VERBS = [
        "abrir", "acabar", "acercar", "acompañar", "adivinar", "amar", "andar", "apagar",
        "aparecer", "aprender", "arder", "arriesgar", "asombrar", "bailar", "beber", "buscar",
        "caer", "callar", "cambiar", "cantar", "cerrar", "cocinar", "comer", "comprender",
        "conducir", "contar", "correr", "crear", "crecer", "cruzar", "cuidar", "decir",
        "dejar", "despertar", "dibujar", "dormir", "dudar", "elegir", "empezar", "encender",
        "encontrar", "entrar", "esconder", "escuchar", "escribir", "esperar", "estar", "existir",
        "fabricar", "flotar", "ganar", "guardar", "hablar", "hallar", "imaginar", "inventar",
        "jugar", "leer", "levantar", "llamar", "llegar", "llover", "mirar", "morir",
        "nacer", "nadar", "nombrar", "ocultar", "olvidar", "ordenar", "perder", "preguntar",
        "proteger", "querer", "recibir", "reír", "responder", "romper", "saber", "salir",
        "sentir", "soñar", "subir", "temblar", "tener", "tocar", "transformar", "viajar",
        "vivir", "volar", "volver"
    ];

    const STOPWORDS = new Set([
        "a", "al", "algo", "ante", "aqui", "asi", "aunque", "bajo", "cada", "como", "con",
        "contra", "cuando", "de", "del", "demasiada", "demasiadas", "demasiado", "demasiados",
        "desde", "donde", "dos", "e", "el", "ella", "ellas",
        "ellos", "en", "entre", "era", "eran", "eres", "es", "esa", "ese", "eso", "esta",
        "estas", "este", "estos", "ha", "hay", "la", "las", "le", "les", "lo", "los", "mas",
        "me", "mi", "mis", "muy", "ni", "no", "nos", "o", "para", "pero", "por", "que",
        "quien", "se", "ser", "si", "sin", "su", "sus", "te", "tu", "tus", "un", "una",
        "unas", "unos", "y", "ya", "yo"
    ]);

    const DETERMINER_FORMS = {
        definite: {
            singular: { m: "el", f: "la" },
            plural: { m: "los", f: "las" }
        },
        indefinite: {
            singular: { m: "un", f: "una" },
            plural: { m: "unos", f: "unas" }
        },
        this: {
            singular: { m: "este", f: "esta" },
            plural: { m: "estos", f: "estas" }
        },
        that: {
            singular: { m: "ese", f: "esa" },
            plural: { m: "esos", f: "esas" }
        },
        far: {
            singular: { m: "aquel", f: "aquella" },
            plural: { m: "aquellos", f: "aquellas" }
        },
        other: {
            singular: { m: "otro", f: "otra" },
            plural: { m: "otros", f: "otras" }
        }
    };

    const DETERMINERS = new Map();
    Object.keys(DETERMINER_FORMS).forEach((family) => {
        ["singular", "plural"].forEach((number) => {
            ["m", "f"].forEach((gender) => {
                const value = DETERMINER_FORMS[family][number][gender];
                DETERMINERS.set(normalizeKey(value), { family, number, gender });
            });
        });
    });

    function normalizeKey(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function mod(index, length) {
        return ((index % length) + length) % length;
    }

    function toEntry(item, kind) {
        if (Array.isArray(item)) {
            return {
                word: item[0],
                key: normalizeKey(item[0]),
                kind,
                gender: item[1] || guessGender(item[0])
            };
        }
        return {
            word: item,
            key: normalizeKey(item),
            kind,
            gender: kind === "noun" ? guessGender(item) : undefined
        };
    }

    function makeLexicon(nounSource, adjectiveSource, verbSource) {
        const nouns = uniqueEntries(nounSource.map((item) => toEntry(item, "noun")));
        const adjectives = uniqueEntries(adjectiveSource.map((item) => toEntry(item, "adjective")));
        const verbs = uniqueEntries(verbSource.map((item) => toEntry(item, "verb")));
        return {
            noun: nouns,
            adjective: adjectives,
            verb: verbs,
            maps: {
                noun: mapEntries(nouns),
                adjective: mapEntries(adjectives),
                verb: mapEntries(verbs)
            }
        };
    }

    function uniqueEntries(entries) {
        const seen = new Set();
        return entries
            .filter((entry) => entry.word && entry.key && !STOPWORDS.has(entry.key))
            .filter((entry) => {
                if (seen.has(entry.key)) return false;
                seen.add(entry.key);
                return true;
            })
            .sort((a, b) => a.key.localeCompare(b.key, "es", { sensitivity: "base" }));
    }

    function mapEntries(entries) {
        const map = new Map();
        entries.forEach((entry, index) => {
            map.set(entry.key, { entry, index });
        });
        return map;
    }

    function tokenize(text) {
        return String(text || "").match(TOKEN_RE) || [];
    }

    function isWordToken(token) {
        return WORD_RE.test(token);
    }

    function isPluralKey(key) {
        return key.length > 3 && /s$/.test(key) && !/(is|us)$/.test(key);
    }

    function singularizeKey(key) {
        if (/ces$/.test(key) && key.length > 4) return `${key.slice(0, -3)}z`;
        if (/es$/.test(key) && key.length > 4) return key.slice(0, -2);
        if (/s$/.test(key) && key.length > 3 && !/(is|us)$/.test(key)) return key.slice(0, -1);
        return key;
    }

    function pluralizeWord(word) {
        if (!word) return word;
        const lower = normalizeKey(word);
        if (lower.endsWith("z")) return `${word.slice(0, -1)}ces`;
        if (/[aeiouáéíóú]$/i.test(word)) return `${word}s`;
        return `${word}es`;
    }

    function preserveCase(original, replacement) {
        if (!replacement) return replacement;
        const letters = original.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÑñÜü]/g, "");
        if (letters && letters === letters.toUpperCase()) {
            return replacement.toUpperCase();
        }
        if (letters && letters[0] === letters[0].toUpperCase()) {
            return `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`;
        }
        return replacement;
    }

    function guessGender(word) {
        const key = normalizeKey(word);
        if (/(cion|sion|dad|tad|tud|umbre|ie|ez|a)$/.test(key) && !/(ma|pa|ta)$/.test(key)) {
            return "f";
        }
        return "m";
    }

    function getPreviousWordIndex(tokens, currentIndex) {
        for (let index = currentIndex - 1; index >= 0; index--) {
            if (isWordToken(tokens[index])) return index;
        }
        return -1;
    }

    function getNextWordIndex(tokens, currentIndex) {
        for (let index = currentIndex + 1; index < tokens.length; index++) {
            if (isWordToken(tokens[index])) return index;
            if (String(tokens[index]).trim() && !/^[,;:]$/.test(tokens[index])) return -1;
        }
        return -1;
    }

    function getEntryLookup(lexicon, kind, rawWord) {
        const key = normalizeKey(rawWord);
        const singularKey = singularizeKey(key);
        const map = lexicon.maps[kind];
        if (map.has(key)) {
            return { ...map.get(key), key, baseKey: key, exact: true, plural: false };
        }
        if (map.has(singularKey)) {
            return { ...map.get(singularKey), key, baseKey: singularKey, exact: true, plural: true };
        }
        return {
            entry: null,
            index: insertionIndex(lexicon[kind], singularKey),
            key,
            baseKey: singularKey,
            exact: false,
            plural: isPluralKey(key)
        };
    }

    function insertionIndex(entries, key) {
        if (!entries.length) return 0;
        const found = entries.findIndex((entry) => entry.key.localeCompare(key, "es", { sensitivity: "base" }) >= 0);
        return found === -1 ? 0 : found;
    }

    function looksLikeVerb(key) {
        return /(ar|er|ir|ando|iendo|aba|aban|ara|aran|eria|erian|are|aran|ase|asen|amos|emos|imos)$/.test(key);
    }

    function looksLikeAdjective(key) {
        return /(able|ible|al|ar|ente|ante|ico|ica|ivo|iva|oso|osa|udo|uda|az|il|ero|era)$/.test(key);
    }

    function looksLikeNoun(key) {
        return /(cion|sion|dad|tad|tud|aje|ambre|anza|ario|aria|ero|era|ista|ismo|miento|mento|ncia|or|ura|ez|eza)$/.test(key);
    }

    function shouldTransformKind(kind, token, previousToken, lexicon) {
        const key = normalizeKey(token);
        if (!key || STOPWORDS.has(key)) return false;

        const lookup = getEntryLookup(lexicon, kind, token);
        if (lookup.exact) return true;

        if (kind === "noun") {
            const previousKey = normalizeKey(previousToken);
            return DETERMINERS.has(previousKey) || looksLikeNoun(key);
        }
        if (kind === "adjective") return looksLikeAdjective(key);
        if (kind === "verb") return looksLikeVerb(key);
        return false;
    }

    function allowedKinds(mode) {
        if (mode === "v7") return ["verb"];
        if (mode === "a7") return ["adjective"];
        if (mode === "sav7") return ["noun", "adjective", "verb"];
        return ["noun"];
    }

    function pickKind(token, previousToken, mode, lexicon) {
        const kinds = allowedKinds(mode);
        return kinds.find((kind) => shouldTransformKind(kind, token, previousToken, lexicon)) || null;
    }

    function shiftEntry(lexicon, kind, rawWord, step) {
        const entries = lexicon[kind];
        if (!entries.length) return null;
        const lookup = getEntryLookup(lexicon, kind, rawWord);
        const baseIndex = mod(lookup.index, entries.length);
        const targetIndex = mod(baseIndex + step, entries.length);
        return {
            originalEntry: lookup.entry || entries[baseIndex],
            replacementEntry: entries[targetIndex],
            exact: lookup.exact,
            plural: lookup.plural,
            baseIndex,
            targetIndex
        };
    }

    function inflectReplacement(rawWord, kind, shift) {
        let replacement = shift.replacementEntry.word;
        if (kind === "noun" || kind === "adjective") {
            const originalKey = normalizeKey(rawWord);
            if (shift.plural || isPluralKey(originalKey)) {
                replacement = pluralizeWord(replacement);
            }
            if (kind === "adjective") {
                replacement = matchAdjectiveEnding(rawWord, replacement);
            }
        }
        return preserveCase(rawWord, replacement);
    }

    function matchAdjectiveEnding(original, replacement) {
        const originalKey = normalizeKey(original);
        if (!/(a|as)$/.test(originalKey)) return replacement;
        if (/os$/.test(replacement)) return `${replacement.slice(0, -2)}as`;
        if (/o$/.test(replacement)) return `${replacement.slice(0, -1)}a`;
        return replacement;
    }

    function adjustDeterminer(tokens, outputTokens, determinerIndex, replacementEntry, originalNumber) {
        if (determinerIndex < 0 || !replacementEntry || !replacementEntry.gender) return null;
        const rawDeterminer = tokens[determinerIndex];
        const info = DETERMINERS.get(normalizeKey(rawDeterminer));
        if (!info) return null;
        const number = originalNumber || info.number;
        const gender = replacementEntry.gender || info.gender;
        const next = DETERMINER_FORMS[info.family][number][gender];
        if (!next || normalizeKey(next) === normalizeKey(rawDeterminer)) return null;
        outputTokens[determinerIndex] = preserveCase(rawDeterminer, next);
        return `${rawDeterminer} > ${outputTokens[determinerIndex]}`;
    }

    function adjustFollowingAdjective(tokens, outputTokens, nounIndex, replacementEntry, originalNumber) {
        if (!replacementEntry || !replacementEntry.gender) return null;
        const adjectiveIndex = getNextWordIndex(tokens, nounIndex);
        if (adjectiveIndex < 0) return null;
        const rawAdjective = outputTokens[adjectiveIndex];
        const key = normalizeKey(rawAdjective);
        if (!key || STOPWORDS.has(key)) return null;

        let adjusted = rawAdjective;
        if (originalNumber === "plural") {
            if (replacementEntry.gender === "m" && /as$/i.test(rawAdjective)) {
                adjusted = `${rawAdjective.slice(0, -2)}os`;
            } else if (replacementEntry.gender === "f" && /os$/i.test(rawAdjective)) {
                adjusted = `${rawAdjective.slice(0, -2)}as`;
            }
        } else if (replacementEntry.gender === "m" && /a$/i.test(rawAdjective)) {
            adjusted = `${rawAdjective.slice(0, -1)}o`;
        } else if (replacementEntry.gender === "f" && /o$/i.test(rawAdjective)) {
            adjusted = `${rawAdjective.slice(0, -1)}a`;
        }

        if (adjusted === rawAdjective) return null;
        outputTokens[adjectiveIndex] = preserveCase(rawAdjective, adjusted.toLowerCase());
        return `${rawAdjective} > ${outputTokens[adjectiveIndex]}`;
    }

    function kindLabel(kind) {
        if (kind === "verb") return "V";
        if (kind === "adjective") return "A";
        return "S";
    }

    function transformBaseText(text, options) {
        const mode = options.mode || "s7";
        const step = Number.isFinite(options.step) ? options.step : DEFAULT_STEP;
        const lexicon = options.lexicon || getDefaultLexicon();
        const tokens = tokenize(text);
        const outputTokens = tokens.slice();
        const replacements = [];

        tokens.forEach((token, index) => {
            if (!isWordToken(token)) return;
            const previousIndex = getPreviousWordIndex(tokens, index);
            const previousToken = previousIndex >= 0 ? tokens[previousIndex] : "";
            const kind = pickKind(token, previousToken, mode, lexicon);
            if (!kind) return;

            const shift = shiftEntry(lexicon, kind, token, step);
            if (!shift || !shift.replacementEntry) return;

            const replacement = inflectReplacement(token, kind, shift);
            outputTokens[index] = replacement;

            const originalNumber = shift.plural || isPluralKey(normalizeKey(token)) ? "plural" : "singular";
            const determinerChange = kind === "noun"
                ? adjustDeterminer(tokens, outputTokens, previousIndex, shift.replacementEntry, originalNumber)
                : null;
            const adjectiveChange = kind === "noun"
                ? adjustFollowingAdjective(tokens, outputTokens, index, shift.replacementEntry, originalNumber)
                : null;
            const wrapped = step > 0 ? shift.targetIndex < shift.baseIndex : shift.targetIndex > shift.baseIndex;

            const originalGender = kind === "noun" && shift.originalEntry ? shift.originalEntry.gender : undefined;
            const genderChanged = kind === "noun"
                && originalGender
                && shift.replacementEntry.gender
                && originalGender !== shift.replacementEntry.gender;

            replacements.push({
                original: token,
                replacement,
                kind,
                label: kindLabel(kind),
                base: shift.originalEntry.word,
                exact: shift.exact,
                wrapped,
                note: [
                    shift.exact ? "" : `no estaba en el léxico: base ${shift.originalEntry.word}`,
                    wrapped ? "diccionario circular" : "",
                    genderChanged ? "cambio de género" : "",
                    determinerChange ? `ajuste ${determinerChange}` : "",
                    adjectiveChange ? `ajuste ${adjectiveChange}` : ""
                ].filter(Boolean).join("; ")
            });
        });

        return {
            text: outputTokens.join(""),
            replacements,
            stats: summarize(tokens, replacements)
        };
    }

    function summarize(tokens, replacements) {
        const words = tokens.filter(isWordToken).length;
        return { words, replacements: replacements.length };
    }

    function transformText(text, options) {
        const merged = {
            mode: "s7",
            step: DEFAULT_STEP,
            caradecLength: DEFAULT_CARADEC_LENGTH,
            instrument: "default",
            auxiliaryText: "",
            ...options
        };
        merged.lexicon = buildLexicon(merged);

        if (merged.mode === "eclipse") {
            const transformed = transformBaseText(text, { ...merged, mode: "s7" });
            return {
                text: `${String(text || "").trimEnd()}\n\n--- eclipse S${formatStep(merged.step)} ---\n\n${transformed.text}`,
                replacements: transformed.replacements,
                stats: transformed.stats
            };
        }

        if (merged.mode === "caradec") {
            return buildCaradecText(text, merged);
        }

        return transformBaseText(text, merged);
    }

    function buildCaradecText(text, options) {
        const tokens = tokenize(text);
        const firstWord = tokens.find(isWordToken) || "palabra";
        const chain = buildCaradecChain(firstWord, options.lexicon, options.step, options.caradecLength);
        const replacements = chain.slice(1).map((entry, index) => ({
            original: chain[index].word,
            replacement: entry.word,
            kind: "noun",
            label: "S",
            base: chain[index].word,
            exact: true,
            wrapped: index > 0 && entry.index < chain[index].index,
            note: "cadena Caradec"
        }));

        return {
            text: chain.map((entry) => entry.word).join(" -> "),
            replacements,
            stats: { words: chain.length, replacements: Math.max(0, chain.length - 1) }
        };
    }

    function buildCaradecChain(seed, lexicon, step, length) {
        const entries = lexicon.noun || [];
        if (!entries.length) return [];
        const safeLength = Math.max(2, Math.min(40, Number(length) || DEFAULT_CARADEC_LENGTH));
        let lookup = getEntryLookup(lexicon, "noun", seed);
        let index = mod(lookup.index, entries.length);
        const chain = [{ word: entries[index].word, index }];

        for (let count = 1; count < safeLength; count++) {
            index = mod(index + step, entries.length);
            chain.push({ word: entries[index].word, index });
        }
        return chain;
    }

    function formatStep(step) {
        return step >= 0 ? `+${step}` : String(step);
    }

    let defaultLexicon = null;

    function getDefaultLexicon() {
        if (!defaultLexicon) {
            defaultLexicon = makeLexicon(DEFAULT_NOUNS, DEFAULT_ADJECTIVES, DEFAULT_VERBS);
        }
        return defaultLexicon;
    }

    function buildLexicon(options) {
        if (options.instrument !== "auxiliary" || !String(options.auxiliaryText || "").trim()) {
            return getDefaultLexicon();
        }
        const extracted = extractAuxiliaryEntries(options.auxiliaryText);
        return makeLexicon(
            extracted.nouns.length ? extracted.nouns : DEFAULT_NOUNS,
            extracted.adjectives.length ? extracted.adjectives : DEFAULT_ADJECTIVES,
            extracted.verbs.length ? extracted.verbs : DEFAULT_VERBS
        );
    }

    function extractAuxiliaryEntries(text) {
        const seen = new Set();
        const nouns = [];
        const adjectives = [];
        const verbs = [];

        tokenize(text).forEach((token) => {
            if (!isWordToken(token)) return;
            const key = normalizeKey(token);
            if (key.length < 3 || STOPWORDS.has(key) || seen.has(key)) return;
            seen.add(key);

            if (looksLikeVerb(key)) verbs.push(token.toLowerCase());
            if (looksLikeAdjective(key)) adjectives.push(token.toLowerCase());
            if (looksLikeNoun(key) || (!looksLikeVerb(key) && !looksLikeAdjective(key))) {
                nouns.push([token.toLowerCase(), guessGender(token)]);
            }
        });

        return { nouns, adjectives, verbs };
    }

    root.ScribS7 = {
        DEFAULT_STEP,
        buildCaradecChain,
        buildLexicon,
        getDefaultLexicon,
        normalizeKey,
        tokenize,
        transformText
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = root.ScribS7;
    }
})(typeof window !== "undefined" ? window : globalThis);
