"use strict";

const MIB = 1024 * 1024;

const DEFAULTS = Object.freeze({
    sampleMs: 1000,
    reportStaleMs: 15000,
    warningSustainMs: 15000,
    dangerSustainMs: 15000,
    emergencySustainMs: 3000,
    minimumLevelMs: 60000,
    recoverySustainMs: 60000,
    warningLagMs: 50,
    dangerLagMs: 100,
    emergencyLagMs: 250,
    warningRssMb: 400,
    dangerRssMb: 550,
    emergencyRssMb: 680,
    warningGrowthMb: 100,
    dangerGrowthMb: 160,
    warningRttMs: 250,
    dangerRttMs: 500
});

const limitarNivel = (valor) => Math.max(0, Math.min(2, Math.trunc(Number(valor) || 0)));
const numeroFinito = (valor, fallback = 0) => Number.isFinite(Number(valor)) ? Number(valor) : fallback;

function percentil(valores, proporcion = 0.95) {
    if (!Array.isArray(valores) || !valores.length) return 0;
    const ordenados = valores.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!ordenados.length) return 0;
    const indice = Math.max(0, Math.ceil(ordenados.length * proporcion) - 1);
    return ordenados[Math.min(indice, ordenados.length - 1)];
}

function crearMaquinaProteccion(opciones = {}) {
    const config = { ...DEFAULTS, ...opciones };
    let level = 0;
    let levelSince = 0;
    let warningSince = 0;
    let dangerSince = 0;
    let emergencySince = 0;
    let healthySince = 0;

    const resetPressure = () => {
        warningSince = 0;
        dangerSince = 0;
        emergencySince = 0;
    };

    const updateSince = (activo, actual, now) => activo ? (actual || now) : 0;

    const evaluar = ({ warning = false, danger = false, emergency = false } = {}, now = Date.now()) => {
        warningSince = updateSince(warning || danger || emergency, warningSince, now);
        dangerSince = updateSince(danger || emergency, dangerSince, now);
        emergencySince = updateSince(emergency, emergencySince, now);
        healthySince = updateSince(!warning && !danger && !emergency, healthySince, now);

        const warningSostenido = warningSince && (now - warningSince) >= config.warningSustainMs;
        const dangerSostenido = dangerSince && (now - dangerSince) >= config.dangerSustainMs;
        const emergencySostenida = emergencySince && (now - emergencySince) >= config.emergencySustainMs;
        const recuperacionSostenida = healthySince && (now - healthySince) >= config.recoverySustainMs;
        const permanenciaCumplida = !levelSince || (now - levelSince) >= config.minimumLevelMs;
        const anterior = level;

        if (level === 0) {
            if (emergencySostenida || dangerSostenido) level = 2;
            else if (warningSostenido) level = 1;
        } else if (level === 1) {
            if (emergencySostenida || dangerSostenido) level = 2;
            else if (permanenciaCumplida && recuperacionSostenida) level = 0;
        } else if (permanenciaCumplida && recuperacionSostenida) {
            level = 1;
        }

        if (level !== anterior) {
            levelSince = now;
            healthySince = 0;
            resetPressure();
        }
        return { level, changed: level !== anterior, previous: anterior, levelSince };
    };

    return {
        evaluar,
        getLevel: () => level,
        snapshot: () => ({ level, levelSince, warningSince, dangerSince, emergencySince, healthySince })
    };
}

function resolverRolSocket(socket, reporte = {}) {
    if (socket && socket.control) return { role: "control", player: 0 };
    if (socket && socket.espectador) return { role: "spectator", player: 0 };
    if (socket && (Number(socket.escritxr) === 1 || Number(socket.escritxr) === 2)) {
        return { role: "writer", player: Number(socket.escritxr) };
    }
    if (socket && (Number(socket.actor) === 1 || Number(socket.actor) === 2)) {
        return { role: "actor", player: Number(socket.actor) };
    }
    if (socket && (Number(socket.tecnico) === 1 || Number(socket.tecnico) === 2)) {
        return { role: "technician", player: Number(socket.tecnico) };
    }
    return { role: "unknown", player: 0 };
}

function crearGestorProteccionRendimiento({
    io = null,
    registrar = () => {},
    now = () => Date.now(),
    memoryUsage = () => process.memoryUsage(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    opciones = {}
} = {}) {
    const config = { ...DEFAULTS, ...opciones };
    const maquina = crearMaquinaProteccion(config);
    const reportes = new Map();
    const muestrasLag = [];
    const historialRss = [];
    let intervalo = null;
    let ultimaMuestraTs = now();
    let metricasServidor = {
        event_loop_lag_p95_ms: 0,
        rss_mb: 0,
        rss_growth_5m_mb: 0,
        client_rtt_p95_ms: 0,
        client_reports: 0,
        client_rtt_warning_ratio: 0,
        client_rtt_danger_ratio: 0
    };
    let razonesServidor = [];

    const limpiarAntiguos = (ts) => {
        while (muestrasLag.length && (ts - muestrasLag[0].ts) > 20000) muestrasLag.shift();
        while (historialRss.length && (ts - historialRss[0].ts) > 300000) historialRss.shift();
        reportes.forEach((reporte, socketId) => {
            if ((ts - reporte.ts) > config.reportStaleMs) reportes.delete(socketId);
        });
    };

    const calcularPresion = () => {
        const lag = metricasServidor.event_loop_lag_p95_ms;
        const rss = metricasServidor.rss_mb;
        const growth = metricasServidor.rss_growth_5m_mb;
        const rtt = metricasServidor.client_rtt_p95_ms;
        const rttWarning = metricasServidor.client_reports >= 2
            && metricasServidor.client_rtt_warning_ratio >= 0.5
            && rtt > config.warningRttMs;
        const rttDanger = metricasServidor.client_reports >= 2
            && metricasServidor.client_rtt_danger_ratio >= 0.5
            && rtt > config.dangerRttMs;
        const warning = lag > config.warningLagMs
            || rss > config.warningRssMb
            || growth > config.warningGrowthMb
            || rttWarning;
        const danger = lag > config.dangerLagMs
            || rss > config.dangerRssMb
            || growth > config.dangerGrowthMb
            || rttDanger;
        const emergency = lag > config.emergencyLagMs || rss > config.emergencyRssMb;
        const razones = [];
        if (lag > config.warningLagMs) razones.push("server_lag");
        if (rss > config.warningRssMb) razones.push("server_memory");
        if (growth > config.warningGrowthMb) razones.push("server_memory_growth");
        if (rttWarning) razones.push("network_rtt");
        razonesServidor = razones;
        return { warning, danger, emergency };
    };

    const resumirReportes = (filtro) => {
        const lista = Array.from(reportes.values()).filter(filtro);
        const level = lista.reduce((maximo, item) => Math.max(maximo, limitarNivel(item.level)), 0);
        const reasons = Array.from(new Set(lista.flatMap((item) => item.reasons))).slice(0, 6);
        return {
            level,
            samples: lista.length,
            reasons,
            metrics: {
                lag_p95_ms: Math.max(0, ...lista.map((item) => numeroFinito(item.metrics.lag_p95_ms))),
                fps: lista.length ? Math.min(...lista.map((item) => numeroFinito(item.metrics.fps, 60))) : 0,
                rtt_p95_ms: Math.max(0, ...lista.map((item) => numeroFinito(item.metrics.rtt_p95_ms))),
                heap_ratio: Math.max(0, ...lista.map((item) => numeroFinito(item.metrics.heap_ratio)))
            }
        };
    };

    const payload = () => {
        const globalLevel = maquina.getLevel();
        const resumen = (role, player = 0) => {
            const base = resumirReportes((item) => item.role === role && (!player || item.player === player));
            return { ...base, level: Math.max(globalLevel, base.level) };
        };
        return {
            level: globalLevel,
            active: globalLevel > 0,
            updated_at: now(),
            server: {
                level: globalLevel,
                reasons: razonesServidor.slice(),
                metrics: { ...metricasServidor }
            },
            roles: {
                control: resumen("control"),
                spectator: resumen("spectator"),
                writers: { 1: resumen("writer", 1), 2: resumen("writer", 2) },
                actors: { 1: resumen("actor", 1), 2: resumen("actor", 2) },
                technicians: { 1: resumen("technician", 1), 2: resumen("technician", 2) }
            }
        };
    };

    const muestrear = () => {
        const ts = now();
        const elapsed = ts - ultimaMuestraTs;
        ultimaMuestraTs = ts;
        muestrasLag.push({ ts, value: Math.max(0, elapsed - config.sampleMs) });
        const rssMb = Math.max(0, numeroFinito(memoryUsage().rss) / MIB);
        historialRss.push({ ts, value: rssMb });
        limpiarAntiguos(ts);
        const reportesVigentes = Array.from(reportes.values());
        const rttsVigentes = reportesVigentes.map((item) => item.metrics.rtt_p95_ms);
        const totalRtts = rttsVigentes.length;
        metricasServidor = {
            event_loop_lag_p95_ms: Math.round(percentil(muestrasLag.map((item) => item.value)) * 10) / 10,
            rss_mb: Math.round(rssMb * 10) / 10,
            rss_growth_5m_mb: historialRss.length
                ? Math.round(Math.max(0, rssMb - historialRss[0].value) * 10) / 10
                : 0,
            client_rtt_p95_ms: Math.round(percentil(rttsVigentes) * 10) / 10,
            client_reports: totalRtts,
            client_rtt_warning_ratio: totalRtts
                ? Math.round((rttsVigentes.filter((value) => value > config.warningRttMs).length / totalRtts) * 1000) / 1000
                : 0,
            client_rtt_danger_ratio: totalRtts
                ? Math.round((rttsVigentes.filter((value) => value > config.dangerRttMs).length / totalRtts) * 1000) / 1000
                : 0
        };
        const cambio = maquina.evaluar(calcularPresion(), ts);
        if (cambio.changed) {
            const estado = payload();
            if (io && typeof io.emit === "function") io.emit("performance_protection_global", estado);
            registrar(`Proteccion de rendimiento: N${cambio.level} (antes N${cambio.previous}).`);
        }
        return payload();
    };

    const registrarReporte = (socket, reporte = {}) => {
        const identidad = resolverRolSocket(socket, reporte);
        const metrics = reporte && typeof reporte.metrics === "object" ? reporte.metrics : {};
        const reasons = Array.isArray(reporte.reasons)
            ? reporte.reasons.map(String).filter(Boolean).slice(0, 6)
            : [];
        const entrada = {
            ...identidad,
            ts: now(),
            level: limitarNivel(reporte.level),
            reasons,
            metrics: {
                lag_p95_ms: Math.max(0, numeroFinito(metrics.lag_p95_ms)),
                fps: Math.max(0, numeroFinito(metrics.fps)),
                rtt_p95_ms: Math.max(0, numeroFinito(metrics.rtt_p95_ms)),
                heap_ratio: Math.max(0, Math.min(1, numeroFinito(metrics.heap_ratio))),
                missed_heartbeats: Math.max(0, Math.trunc(numeroFinito(metrics.missed_heartbeats)))
            }
        };
        reportes.set(String((socket && socket.id) || reporte.client_id || "unknown"), entrada);
        return entrada;
    };

    const registrarHandlers = (socket) => {
        if (!socket || typeof socket.on !== "function") return;
        socket.on("performance_protection_report", (reporte = {}, callback) => {
            registrarReporte(socket, reporte);
            if (typeof callback === "function") {
                const estado = payload();
                callback({
                    ok: true,
                    protection: {
                        level: estado.level,
                        active: estado.active,
                        updated_at: estado.updated_at,
                        server: estado.server
                    }
                });
            }
        });
        socket.on("disconnect", () => reportes.delete(String(socket.id || "")));
    };

    const iniciar = () => {
        if (intervalo) return intervalo;
        ultimaMuestraTs = now();
        intervalo = setIntervalFn(muestrear, config.sampleMs);
        if (intervalo && typeof intervalo.unref === "function") intervalo.unref();
        return intervalo;
    };

    const detener = () => {
        if (intervalo) clearIntervalFn(intervalo);
        intervalo = null;
    };

    return {
        detener,
        getGlobalLevel: () => maquina.getLevel(),
        iniciar,
        muestrear,
        payload,
        registrarHandlers,
        registrarReporte
    };
}

module.exports = {
    DEFAULTS,
    crearGestorProteccionRendimiento,
    crearMaquinaProteccion,
    percentil,
    resolverRolSocket
};
