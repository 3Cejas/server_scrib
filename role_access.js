const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_TOKENS_ACTIVOS = 256;
const MAX_CLAVES_INTENTOS = 512;
const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_INTENTOS_MS = 60 * 1000;
const MAX_TOKEN_LENGTH = 256;
const ACCESS_TOKEN_PREFIX = "token_v1";

const digest = (valor) => createHash("sha256")
    .update(String(valor || ""), "utf8")
    .digest();

const compararSecreto = (entrada, esperado) => timingSafeEqual(digest(entrada), digest(esperado));

const normalizarToken = (valor) => {
    if (typeof valor !== "string" || valor.length > MAX_TOKEN_LENGTH) return "";
    const token = valor.trim();
    return /^[A-Za-z0-9_.-]{32,192}$/u.test(token) ? token : "";
};

const tokenHash = (token) => digest(token).toString("hex");

function crearGestorAccesoRoles({
    passwordRoles,
    now = () => Date.now(),
    crearToken = () => randomBytes(32).toString("base64url"),
    tokenTtlMs = ACCESS_TOKEN_TTL_MS
} = {}) {
    const password = String(passwordRoles || "");
    const tokenTtlNormalizado = Math.max(60000, Number(tokenTtlMs) || ACCESS_TOKEN_TTL_MS);
    const claveFirma = digest(`scrib-role-access-v1\u0000${password}`);
    const tokens = new Map();
    const intentos = new Map();

    const firmarToken = (contenido) => createHmac("sha256", claveFirma)
        .update(contenido, "utf8")
        .digest("base64url");

    const crearTokenFirmado = () => {
        const issuedTs = now();
        const expiresTs = issuedTs + tokenTtlNormalizado;
        const entropia = String(crearToken() || randomBytes(32).toString("base64url"));
        const nonce = createHash("sha256").update(entropia, "utf8").digest("base64url").slice(0, 32);
        const contenido = `${ACCESS_TOKEN_PREFIX}.${issuedTs.toString(36)}.${expiresTs.toString(36)}.${nonce}`;
        return {
            token: `${contenido}.${firmarToken(contenido)}`,
            issuedTs,
            expiresTs
        };
    };

    const leerTokenFirmado = (token) => {
        const partes = String(token || "").split(".");
        if (partes.length !== 5 || partes[0] !== ACCESS_TOKEN_PREFIX) return null;
        const [, issuedBase36, expiresBase36, nonce, firma] = partes;
        if (!/^[0-9a-z]+$/u.test(issuedBase36)
            || !/^[0-9a-z]+$/u.test(expiresBase36)
            || !/^[A-Za-z0-9_-]{16,64}$/u.test(nonce)
            || !/^[A-Za-z0-9_-]{32,64}$/u.test(firma)) return null;
        const issuedTs = Number.parseInt(issuedBase36, 36);
        const expiresTs = Number.parseInt(expiresBase36, 36);
        if (!Number.isSafeInteger(issuedTs)
            || !Number.isSafeInteger(expiresTs)
            || issuedTs <= 0
            || expiresTs <= issuedTs
            || expiresTs - issuedTs !== tokenTtlNormalizado) return null;
        const contenido = partes.slice(0, 4).join(".");
        if (!compararSecreto(firma, firmarToken(contenido))) return null;
        return { issuedTs, expiresTs };
    };

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
        const firmado = crearTokenFirmado();
        const token = firmado.token;
        const hash = tokenHash(token);
        tokens.delete(hash);
        tokens.set(hash, {
            purpose: "control",
            issuedTs: firmado.issuedTs,
            expiresTs: firmado.expiresTs,
            ultimoUsoTs: 0
        });
        limitarMapa(tokens, MAX_TOKENS_ACTIVOS);
        return {
            ok: true,
            access_token: token,
            expires_ts: firmado.expiresTs
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
        let acceso = tokens.get(hash);
        if (!acceso || acceso.purpose !== "control") {
            const firmado = leerTokenFirmado(token);
            if (firmado) {
                acceso = {
                    purpose: "control",
                    issuedTs: firmado.issuedTs,
                    expiresTs: firmado.expiresTs,
                    ultimoUsoTs: 0
                };
            }
        }
        if (!acceso || acceso.purpose !== "control") {
            podarTokens();
            return { ok: false, code: "INVALID_ACCESS_TOKEN" };
        }
        if (acceso.expiresTs <= now()) {
            tokens.delete(hash);
            return { ok: false, code: "ACCESS_TOKEN_EXPIRED" };
        }
        const actual = now();
        acceso.ultimoUsoTs = actual;
        const renovado = crearTokenFirmado();
        tokens.delete(hash);
        tokens.set(tokenHash(renovado.token), {
            purpose: "control",
            issuedTs: renovado.issuedTs,
            expiresTs: renovado.expiresTs,
            ultimoUsoTs: actual
        });
        podarTokens();
        return {
            ok: true,
            rol: "control",
            access_token: renovado.token,
            expires_ts: renovado.expiresTs
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
