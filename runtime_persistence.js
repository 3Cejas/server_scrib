const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const RUNTIME_STATE_SCHEMA = 1;

function crearPersistenciaRuntime({
    filePath = process.env.SCRIB_STATE_FILE || path.join(process.cwd(), "var", "runtime-state.json"),
    enabled = process.env.SCRIB_PERSIST_STATE === "1"
        || (process.env.SCRIB_PERSIST_STATE !== "0" && process.env.NODE_ENV !== "test"),
    debounceMs = 300,
    maxAgeMs = Number(process.env.SCRIB_STATE_MAX_AGE_MS) || (12 * 60 * 60 * 1000),
    logger = () => {}
} = {}) {
    let timer = null;
    let pendingFactory = null;
    let writing = Promise.resolve();

    const load = () => {
        if (!enabled) return null;
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = JSON.parse(raw);
            if (!parsed || Number(parsed.schema) !== RUNTIME_STATE_SCHEMA || !parsed.state) return null;
            if (maxAgeMs > 0 && (Date.now() - Number(parsed.saved_at || 0)) > maxAgeMs) return null;
            return parsed.state;
        } catch (error) {
            if (!error || error.code !== "ENOENT") logger(`[persistencia] no se pudo leer: ${error.message}`);
            return null;
        }
    };

    const writeSnapshot = async (state) => {
        if (!enabled || !state) return false;
        const dir = path.dirname(filePath);
        const temporal = `${filePath}.${process.pid}.tmp`;
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(temporal, `${JSON.stringify({
            schema: RUNTIME_STATE_SCHEMA,
            saved_at: Date.now(),
            state
        })}\n`, { encoding: "utf8", mode: 0o600 });
        await fsp.rename(temporal, filePath);
        return true;
    };

    const flush = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const factory = pendingFactory;
        pendingFactory = null;
        if (!factory || !enabled) return writing;
        let snapshot;
        try {
            snapshot = typeof factory === "function" ? factory() : factory;
        } catch (error) {
            logger(`[persistencia] no se pudo construir el checkpoint: ${error.message}`);
            return writing;
        }
        writing = writing
            .then(() => writeSnapshot(snapshot))
            .catch((error) => logger(`[persistencia] no se pudo escribir: ${error.message}`));
        return writing;
    };

    const schedule = (factory) => {
        if (!enabled) return false;
        pendingFactory = factory;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, Math.max(0, Number(debounceMs) || 0));
        if (timer && typeof timer.unref === "function") timer.unref();
        return true;
    };

    return {
        enabled,
        filePath,
        flush,
        load,
        schedule
    };
}

module.exports = {
    RUNTIME_STATE_SCHEMA,
    crearPersistenciaRuntime
};
