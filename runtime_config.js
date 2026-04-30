const IDIOMAS_JUEGO_VALIDOS = new Set(["es", "en", "fr"]);
const MAX_NOMBRE_MUSA = 10;
const REGEX_NOMBRE_MUSA = /^[A-Za-zÃƒÂÃƒâ€°ÃƒÂÃƒâ€œÃƒÅ¡ÃƒÅ“Ãƒâ€˜ÃƒÂ¡ÃƒÂ©ÃƒÂ­ÃƒÂ³ÃƒÂºÃƒÂ¼ÃƒÂ±0-9 _.-]+$/;
const REGEX_LETRA_MUSA = /[A-Za-zÃƒÂÃƒâ€°ÃƒÂÃƒâ€œÃƒÅ¡ÃƒÅ“Ãƒâ€˜ÃƒÂ¡ÃƒÂ©ÃƒÂ­ÃƒÂ³ÃƒÂºÃƒÂ¼ÃƒÂ±]/;

const repentizados = [
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> discute violentamente con <span style="color:yellow;" contenteditable="true">C</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> revela un secreto a <span style="color:yellow;" contenteditable="true">C</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> ridiculiza a <span style="color:green;" contenteditable="true">A</span>.</div>',
    '<div contenteditable="false"><span style="color:green;" contenteditable="true">A</span> quiere el perdÃƒÂ³n de <span style="color:red;" contenteditable="true">B</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> predice el futuro de <span style="color:green;" contenteditable="true">A</span>.</div>',
    '<div contenteditable="false"><span style="color:green;" contenteditable="true">A</span> interroga a <span style="color:red;" contenteditable="true">B</span> sobre su pasado.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> provoca a <span style="color:yellow;" contenteditable="true">C</span>.</div>',
    '<div contenteditable="false"><span style="color:yellow;" contenteditable="true">C</span> quiere convertir a <span style="color:red;" contenteditable="true">B</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> quiere desenmascarar a <span style="color:green;" contenteditable="true">A</span>.</div>'
];

function obtenerIdJugadorValido(valor) {
    const id = Number(valor);
    return (id === 1 || id === 2) ? id : null;
}

function normalizarIdiomaJuego(valor) {
    const idioma = typeof valor === "string" ? valor.trim().toLowerCase() : "";
    return IDIOMAS_JUEGO_VALIDOS.has(idioma) ? idioma : "es";
}

function crearGestorIdioma({ io, idiomaInicial = "es" }) {
    let idiomaGlobalJuego = normalizarIdiomaJuego(idiomaInicial);

    const emitirIdiomaJuego = (socketDestino = null) => {
        const payload = { idioma: idiomaGlobalJuego };
        if (socketDestino && typeof socketDestino.emit === "function") {
            socketDestino.emit("idioma_actual", payload);
            return payload;
        }
        io.emit("idioma_actual", payload);
        return payload;
    };

    const setIdiomaJuego = (valor) => {
        idiomaGlobalJuego = normalizarIdiomaJuego(valor);
        return idiomaGlobalJuego;
    };

    return {
        emitirIdiomaJuego,
        getIdiomaJuego: () => idiomaGlobalJuego,
        setIdiomaJuego
    };
}

function normalizarNombreMusa(valor) {
    if (typeof valor !== 'string') return '';
    const limpio = valor.trim().slice(0, MAX_NOMBRE_MUSA);
    if (!limpio) return '';
    if (!REGEX_NOMBRE_MUSA.test(limpio)) return '';
    if (!REGEX_LETRA_MUSA.test(limpio)) return '';
    return limpio.toUpperCase();
}

function extraerTextoPlano(evento) {
    if (typeof evento === 'string') return evento;
    if (evento && typeof evento.text === 'string') return evento.text;
    return '';
}

module.exports = {
    crearGestorIdioma,
    extraerTextoPlano,
    normalizarIdiomaJuego,
    normalizarNombreMusa,
    obtenerIdJugadorValido,
    repentizados
};
