"use strict";
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {construirResumenMusasExportacion} = require('./match_iterations.js');

function sendReport(report, {port = Number(process.env.SCRIB_WORLD_PORT) || 5124, secretPath = process.env.SCRIB_WORLD_SECRET || path.join(os.homedir(), 'dockers/scrib-world-data/bridge-secret')} = {}) {
    return new Promise((resolve, reject) => {
        let secret;
        try { secret = fs.readFileSync(secretPath, 'utf8').trim(); } catch (e) { reject(e); return; }
        const body = JSON.stringify(report);
        const req = http.request({hostname: '127.0.0.1', port, path: '/scrib/backstage/api/match-reports', method: 'POST', timeout: 10000, headers: {
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
            'X-Scrib-Bridge': secret, 'X-Scrib-User': 'videojuego-control', 'X-Scrib-Role': 'user'
        }}, res => {
            res.resume(); res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error(`archive ${res.statusCode}`)));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('archive timeout')));
        req.on('error', reject); req.end(body);
    });
}

// Immutable per-match outbox. Queued on disk BEFORE network I/O, independent
// of the short-lived runtime checkpoint. An offline world cannot lose a report.
function createBoloReportArchive({directory = process.env.SCRIB_REPORT_OUTBOX || path.join(process.cwd(), 'var', 'bolo-reports'),
    enabled = process.env.SCRIB_ARCHIVE_REPORTS === '1' || process.env.NODE_ENV !== 'test', send = sendReport, logger = () => {}, notify = () => {}} = {}) {
    let busy = false;
    const flush = async () => {
        if (!enabled || busy) return;
        busy = true;
        try {
            fs.mkdirSync(directory, {recursive: true, mode: 0o700});
            for (const file of fs.readdirSync(directory).filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
                const location = path.join(directory, file);
                try {
                    const report = JSON.parse(fs.readFileSync(location, 'utf8'));
                    await send(report);
                    fs.unlinkSync(location); // Only after a durable idempotent ACK from SQLite.
                    notify({id: report.id, boloId: report.bolo.id, status: 'saved'});
                } catch (_) { logger('[bolos] informe pendiente; se reintentará sin duplicarlo'); break; }
            }
        } catch (_) {
            logger('[bolos] no se puede acceder al archivo de informes; se reintentará');
        } finally { busy = false; }
    };
    const enqueue = (context, diary, musas = {}, credits = {}) => {
        if (!enabled || !context?.bolo?.id || !diary?.partida?.fin_ts) return false;
        const equipos = {};
        musas = construirResumenMusasExportacion(musas);
        for (const player of ['1', '2']) {
            const group = musas.equipos?.[player] || {};
            equipos[player] = {resumen_grupal: group.resumen_grupal || {}, musas: (group.musas || []).map(m => ({nombre: m.nombre, stats: m.stats}))};
        }
        const report = {version: 1, id: diary.partida.id, bolo: context.bolo, configuration: context,
            startedAt: diary.partida.inicio_ts, endedAt: diary.partida.fin_ts,
            writers: Object.fromEntries(['1', '2'].map(p => [p, {name: diary.escritores[p].nombre, text: diary.escritores[p].texto_final}])),
            stats: diary.resumen.stats || {}, score: diary.resumen.puntuacion_final || {}, muses: {equipos}, credits};
        const encoded = JSON.stringify(report);
        if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) throw new Error('Informe demasiado grande');
        const key = require('node:crypto').createHash('sha256').update(report.id).digest('hex');
        fs.mkdirSync(directory, {recursive: true, mode: 0o700});
        const target = path.join(directory, key + '.json');
        // Original snapshot wins if lifecycle or acknowledgement is repeated.
        if (!fs.existsSync(target)) {
            const tmp = target + '.tmp';
            const fd = fs.openSync(tmp, 'w', 0o600);
            try { fs.writeFileSync(fd, encoded); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp, target);
        }
        notify({id: report.id, boloId: report.bolo.id, status: 'pending'});
        setImmediate(flush);
        return true;
    };
    if (enabled) {
        const timer = setInterval(flush, 30000); timer.unref();
        setImmediate(flush);
    }
    return {enqueue, flush};
}
module.exports = {createBoloReportArchive, sendReport};
