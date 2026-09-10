const { ROLE_ROOMS } = require("./role_connections.js");

const MAX_MARKS = 500;
const MAX_NOTE = 280;
const MAX_QUOTE = 1200;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-zA-Z]+)$/;

function crearGestorMarcasTecnico({ io, validarJugador, isDebugMode = () => false } = {}) {
    const estado = {
        1: { revision: 0, marks: [] },
        2: { revision: 0, marks: [] }
    };

    const colorSeguro = (value) => {
        const color = String(value || "").trim().slice(0, 80);
        return COLOR_RE.test(color) ? color : "";
    };

    const normalizarMarca = (mark = {}, index = 0) => {
        const start = Math.max(0, Math.trunc(Number(mark.start) || 0));
        const end = Math.max(start + 1, Math.trunc(Number(mark.end) || start + 1));
        return {
            id: String(mark.id || `mark_${Date.now().toString(36)}_${index}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96),
            start,
            end,
            quote: String(mark.quote || "").slice(0, MAX_QUOTE),
            underline: Boolean(mark.underline),
            underlineColor: colorSeguro(mark.underlineColor),
            color: colorSeguro(mark.color),
            note: String(mark.note || "").trim().slice(0, MAX_NOTE),
            createdAt: Math.max(0, Math.trunc(Number(mark.createdAt) || Date.now())),
            technicianOnly: Boolean(mark.technicianOnly)
        };
    };

    const normalizarMarcas = (marks) => (Array.isArray(marks) ? marks : [])
        .slice(0, MAX_MARKS)
        .filter((mark) => mark && Number(mark.end) > Number(mark.start))
        .map(normalizarMarca);

    const payload = (player, { tecnico = false } = {}) => {
        const id = validarJugador(player);
        if (!id) return { ok: false, player: null, revision: 0, marks: [] };
        return {
            ok: true,
            player: id,
            revision: estado[id].revision,
            marks: estado[id].marks.filter((mark) => tecnico || !mark.technicianOnly)
        };
    };

    const emitir = (player) => {
        const id = validarJugador(player);
        if (!id || !io || typeof io.to !== "function") return;
        io.to(ROLE_ROOMS.actor(id)).emit("marcas_actor_estado", payload(id));
        io.to(ROLE_ROOMS.technician(id)).emit("marcas_tecnico_estado", payload(id, { tecnico: true }));
    };

    const actualizar = (player, marks, { tecnico = false } = {}) => {
        const id = validarJugador(player);
        if (!id) return { ok: false, code: "INVALID_PLAYER" };
        const recibidas = normalizarMarcas(marks);
        if (tecnico) {
            estado[id].marks = recibidas;
        } else {
            const soloTecnico = estado[id].marks.filter((mark) => mark.technicianOnly);
            estado[id].marks = recibidas.filter((mark) => !mark.technicianOnly).concat(soloTecnico);
        }
        estado[id].revision += 1;
        emitir(id);
        return payload(id, { tecnico });
    };

    const cargarMarcasPrueba = () => {
        const fixtures = {
            1: [
                { start: 3, end: 9, quote: "ciudad", underline: true, underlineColor: "#ffe95c", note: "Sube la luz al pronunciar esta imagen." },
                { start: 23, end: 30, quote: "volcán", color: "#ff8d55", note: "Pausa breve antes de esta palabra." }
            ],
            2: [
                { start: 3, end: 12, quote: "otro lado", underline: true, underlineColor: "#6bff83", note: "Cruce de escena." },
                { start: 34, end: 39, quote: "azul", color: "#46f0ff", note: "Cambio de atmósfera." }
            ]
        };
        [1, 2].forEach((id) => {
            const normales = estado[id].marks.filter((mark) => !mark.technicianOnly);
            const debug = fixtures[id].map((mark, index) => normalizarMarca({
                ...mark,
                id: `debug_tecnico_${id}_${index + 1}`,
                technicianOnly: true
            }, index));
            estado[id].marks = normales.concat(debug);
            estado[id].revision += 1;
            emitir(id);
        });
        return { ok: true };
    };

    const limpiarMarcasPrueba = () => {
        [1, 2].forEach((id) => {
            estado[id].marks = estado[id].marks.filter((mark) => !mark.technicianOnly);
            estado[id].revision += 1;
            emitir(id);
        });
        return { ok: true };
    };

    const registrarHandlers = (socket) => {
        socket.on("pedir_marcas_actor_estado", (_payload = {}, callback = null) => {
            const responder = typeof _payload === "function" ? _payload : callback;
            const id = validarJugador(socket.actor);
            const salida = id ? payload(id) : { ok: false, code: "NOT_AUTHORIZED" };
            socket.emit("marcas_actor_estado", salida);
            if (typeof responder === "function") responder(salida);
        });
        socket.on("pedir_marcas_tecnico_estado", (_payload = {}, callback = null) => {
            const responder = typeof _payload === "function" ? _payload : callback;
            const id = validarJugador(socket.tecnico);
            const salida = id ? payload(id, { tecnico: true }) : { ok: false, code: "NOT_AUTHORIZED" };
            socket.emit("marcas_tecnico_estado", salida);
            if (typeof responder === "function") responder(salida);
        });
        socket.on("actor_marcas_actualizar", (data = {}, callback = null) => {
            const id = validarJugador(socket.actor);
            const salida = id ? actualizar(id, data.marks, { tecnico: false }) : { ok: false, code: "NOT_AUTHORIZED" };
            if (typeof callback === "function") callback(salida);
        });
        socket.on("tecnico_marcas_actualizar", (data = {}, callback = null) => {
            const id = validarJugador(socket.tecnico);
            const salida = id ? actualizar(id, data.marks, { tecnico: true }) : { ok: false, code: "NOT_AUTHORIZED" };
            if (typeof callback === "function") callback(salida);
        });
        socket.on("debug_cargar_marcas_tecnico", (_data = {}, callback = null) => {
            const salida = socket.control && isDebugMode()
                ? cargarMarcasPrueba()
                : { ok: false, code: "NOT_AUTHORIZED" };
            if (typeof callback === "function") callback(salida);
        });
        socket.on("debug_limpiar_marcas_tecnico", (_data = {}, callback = null) => {
            const salida = socket.control && isDebugMode()
                ? limpiarMarcasPrueba()
                : { ok: false, code: "NOT_AUTHORIZED" };
            if (typeof callback === "function") callback(salida);
        });
    };

    const reset = () => {
        [1, 2].forEach((id) => {
            estado[id].marks = [];
            estado[id].revision += 1;
            emitir(id);
        });
    };

    return { cargarMarcasPrueba, emitir, limpiarMarcasPrueba, payload, registrarHandlers, reset };
}

module.exports = { crearGestorMarcasTecnico };
