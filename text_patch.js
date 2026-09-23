const MAX_TEXT_PATCH_INSERT = 2 * 1024 * 1024;

function normalizarTexto(valor) {
    return typeof valor === "string" ? valor : String(valor ?? "");
}

function crearParcheTexto(anterior, siguiente) {
    const base = normalizarTexto(anterior);
    const nuevo = normalizarTexto(siguiente);
    let inicio = 0;
    const limitePrefijo = Math.min(base.length, nuevo.length);
    while (inicio < limitePrefijo && base.charCodeAt(inicio) === nuevo.charCodeAt(inicio)) {
        inicio += 1;
    }

    let sufijo = 0;
    const limiteSufijo = Math.min(base.length - inicio, nuevo.length - inicio);
    while (
        sufijo < limiteSufijo
        && base.charCodeAt(base.length - 1 - sufijo) === nuevo.charCodeAt(nuevo.length - 1 - sufijo)
    ) {
        sufijo += 1;
    }

    return {
        start: inicio,
        deleteCount: base.length - inicio - sufijo,
        insert: nuevo.slice(inicio, nuevo.length - sufijo)
    };
}

function normalizarParcheTexto(parche, longitudBase) {
    if (!parche || typeof parche !== "object") return null;
    const start = Number(parche.start);
    const deleteCount = Number(parche.deleteCount ?? parche.delete_count);
    const insert = normalizarTexto(parche.insert);
    if (!Number.isInteger(start) || !Number.isInteger(deleteCount)) return null;
    if (start < 0 || deleteCount < 0 || start > longitudBase) return null;
    if ((start + deleteCount) > longitudBase || insert.length > MAX_TEXT_PATCH_INSERT) return null;
    return { start, deleteCount, insert };
}

function aplicarParcheTexto(base, parche) {
    const texto = normalizarTexto(base);
    const normalizado = normalizarParcheTexto(parche, texto.length);
    if (!normalizado) return null;
    return texto.slice(0, normalizado.start)
        + normalizado.insert
        + texto.slice(normalizado.start + normalizado.deleteCount);
}

module.exports = {
    MAX_TEXT_PATCH_INSERT,
    aplicarParcheTexto,
    crearParcheTexto,
    normalizarParcheTexto,
    normalizarTexto
};
