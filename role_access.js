const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");

const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_TOKENS_ACTIVOS = 256;
const MAX_CLAVES_INTENTOS = 512;
const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_INTENTOS_MS = 60 * 1000;
const MAX_TOKEN_LENGTH = 256;

const digest = (valor) => createHash("sha256")
    .update(String(valor || ""), "utf8")
    .digest();

const compararSecreto = (entrada, esperado) => timingSafeEqual(digest(entrada), digest(esperado));

const normalizarToken = (valor) => {
    if (typeof valor !== "string" || valor.length > MAX_TOKEN_LENGTH) return "";
    const token = valor.trim();
    return /^[A-Za-z0-9_-]{32,192}$/u.test(token) ? token : "";
};

const tokenHash = (token) => digest(token).toString("hex");

function crearGestorAccesoRoles({
    passwordRoles,
    now = () => Date.now(),
    crearToken = () => randomBytes(32).toString("base64url"),
    tokenTtlMs = ACCESS_TOKEN_TTL_MS
} = {}) {
    const password = String(passwordRoles || "");
    const tokens = new Map();
    const intentos = new Map();

    const limitarMapa = (mapa, maximo) => {
        while (mapa.size > maximo) {
            const primera = mapa.keys().next().value;
            if (!primera) break;
            mapa.delete(primera);
        }
    };

    const podarTokens = () => {
        const actual = now();
        for (const [hash, acceso] of tokens.entries()) {
            if (!acceso || acceso.expiresTs <= actual) tokens.delete(hash);
        }
        limitarMapa(tokens, MAX_TOKENS_ACTIVOS);
    };

    const claveIntentos = (socket) => {
        const handshake = socket && socket.handshake;
        const address = String(
            (handshake && (handshake.address || (handshake.headers && handshake.headers["x-forwarded-for"])))
            || (socket && socket.conn && socket.conn.remoteAddress)
            || (socket && socket.id)
            || "unknown"
        ).split(",", 1)[0].trim().slice(0, 120);
        return address || "unknown";
    };

    const intentosRecientes = (clave) => {
        const actual = now();
        const recientes = (intentos.get(clave) || []).filter((ts) => actual - ts < VENTANA_INTENTOS_MS);
        if (recientes.length) {
            intentos.delete(clave);
            intentos.set(clave, recientes);
        } else {
            intentos.delete(clave);
        }
        return recientes;
    };

    const validarPassword = (socket, entrada) => {
        const clave = claveIntentos(socket);
        const recientes = intentosRecientes(clave);
        if (recientes.length >= MAX_INTENTOS_FALLIDOS) {
            return {
                ok: false,
                code: "RATE_LIMITED",
                retry_after_ms: Math.max(1, VENTANA_INTENTOS_MS - (now() - recientes[0]))
            };
        }
        if (!compararSecreto(entrada, password)) {
            recientes.push(now());
            intentos.delete(clave);
            intentos.set(clave, recientes);
            limitarMapa(intentos, MAX_CLAVES_INTENTOS);
            return { ok: false, code: "INVALID_PASSWORD" };
        }
        intentos.delete(clave);
        podarTokens();
        let token = normalizarToken(crearToken());
        if (!token) token = randomBytes(32).toString("base64url");
        const hash = tokenHash(token);
        const issuedTs = now();
        const expiresTs = issuedTs + Math.max(60000, Number(tokenTtlMs) || ACCESS_TOKEN_TTL_MS);
        tokens.delete(hash);
        tokens.set(hash, {
            purpose: "control",
            issuedTs,
            expiresTs,
            ultimoUsoTs: 0
        });
        limitarMapa(tokens, MAX_TOKENS_ACTIVOS);
        return {
            ok: true,
            access_token: token,
            expires_ts: expiresTs
        };
    };

    const autorizarControl = (entrada) => {
        const token = normalizarToken(
            entrada && typeof entrada === "object"
                ? (entrada.access_token ?? entrada.accessToken)
                : entrada
        );
        if (!token) return { ok: false, code: "ACCESS_TOKEN_REQUIRED" };
        const hash = tokenHash(token);
        const acceso = tokens.get(hash);
        if (!acceso || acceso.purpose !== "control") {
            podarTokens();
            return { ok: false, code: "INVALID_ACCESS_TOKEN" };
        }
        if (acceso.expiresTs <= now()) {
            tokens.delete(hash);
            return { ok: false, code: "ACCESS_TOKEN_EXPIRED" };
        }
        acceso.ultimoUsoTs = now();
        tokens.delete(hash);
        tokens.set(hash, acceso);
        return {
            ok: true,
            rol: "control",
            expires_ts: acceso.expiresTs
        };
    };

    const reset = () => {
        tokens.clear();
        intentos.clear();
    };

    const snapshotSeguro = () => {
        podarTokens();
        return {
            tokens_activos: tokens.size,
            claves_bloqueadas: Array.from(intentos.keys()).filter((clave) => (
                intentosRecientes(clave).length >= MAX_INTENTOS_FALLIDOS
            )).length
        };
    };

    return Object.freeze({
        autorizarControl,
        reset,
        snapshotSeguro,
        validarPassword
    });
}

module.exports = {
    ACCESS_TOKEN_TTL_MS,
    MAX_INTENTOS_FALLIDOS,
    MAX_TOKENS_ACTIVOS,
    VENTANA_INTENTOS_MS,
    compararSecreto,
    crearGestorAccesoRoles,
    normalizarToken
};
