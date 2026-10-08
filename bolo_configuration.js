"use strict";
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { ROLE_ROOMS } = require('./role_connections.js');

function createWorldConfigurationReader({port = Number(process.env.SCRIB_WORLD_PORT) || 5124, secretPath = process.env.SCRIB_WORLD_SECRET || path.join(os.homedir(), 'dockers/scrib-world-data/bridge-secret')} = {}) {
    return () => new Promise((resolve, reject) => {
        const unavailable = () => new Error('No se puede conectar con Mundo SCRIB. Comprueba que el servidor esté encendido.');
        let secret;
        try { secret = fs.readFileSync(secretPath, 'utf8').trim(); } catch (_) { reject(unavailable()); return; }
        const req = http.get({hostname: '127.0.0.1', port, path: '/scrib/backstage/api/game-configurations', timeout: 4500, headers: {
            'X-Scrib-Bridge': secret, 'X-Scrib-User': 'videojuego-control',
            'X-Scrib-Name': Buffer.from('Control del videojuego').toString('base64'), 'X-Scrib-Role': 'user'
        }}, res => {
            if (res.statusCode !== 200) { res.resume(); reject(unavailable()); return; }
            let chunks = [], size = 0;
            res.on('data', chunk => {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) { req.destroy(); reject(unavailable()); return; }
                chunks.push(chunk);
            });
            res.on('error', () => reject(unavailable()));
            res.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (!Array.isArray(data.bolos)) throw new Error();
                    resolve(data.bolos);
                } catch (_) { reject(unavailable()); }
            });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => reject(unavailable()));
    });
}

function createBoloConfigurationManager({io, read = createWorldConfigurationReader(), isMatchActive, getControlRevision, apply}) {
    let applying = false;
    const register = socket => {
        const allowed = callback => {
            if (socket.control === true && socket.connected !== false && !socket.dramaturgia) return true;
            if (typeof callback === 'function') callback({ok: false, code: 'CONTROL_REQUIRED', error: 'Solo Control puede cargar un bolo.'});
            return false;
        };
        socket.on('bolos_configuracion_listar', async (_payload, callback) => {
            if (!allowed(callback) || typeof callback !== 'function') return;
            try {
                const bolos = await read();
                if (allowed(callback)) callback({ok: true, bolos, matchActive: isMatchActive()});
            } catch (error) { callback({ok: false, error: error.message}); }
        });
        socket.on('bolo_configuracion_cargar', async (payload = {}, callback) => {
            if (!allowed(callback) || typeof callback !== 'function') return;
            const fail = (code, error) => callback({ok: false, code, error});
            if (isMatchActive()) return fail('MATCH_ACTIVE', 'Finaliza la partida antes de cargar otro bolo. Pausarla no basta.');
            if (applying) return fail('IMPORT_BUSY', 'Ya se está cargando una configuración. Espera a que termine.');
            if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.id)
                || typeof payload.revision !== 'string' || !/^[a-f0-9]{64}$/.test(payload.revision)
                || !Number.isSafeInteger(payload.controlRevision)) return fail('INVALID_REQUEST', 'Selecciona un bolo y revisa su vista previa.');
            applying = true;
            try {
                const bolos = await read();
                // Recheck after I/O: a game, another edit or a disconnect may occur while fetching.
                if (!allowed(callback)) return;
                if (isMatchActive()) return fail('MATCH_ACTIVE', 'Ha comenzado una partida. No se ha cargado ni cambiado nada.');
                if (payload.controlRevision !== getControlRevision()) return fail('CONTROL_CHANGED', 'Los parámetros de Control han cambiado. Actualiza la vista previa antes de cargarlos.');
                const bolo = bolos.find(b => b.id === payload.id);
                if (!bolo || bolo.revision !== payload.revision) return fail('BOLO_CHANGED', 'El bolo o su elenco han cambiado. Actualiza la lista antes de cargar.');
                if (!bolo.ready || !bolo.config) return fail('INCOMPLETE_BOLO', (bolo.errors || ['Completa la configuración del bolo.']).join(' '));
                // Commit synchronously, without a restart, clean, scene switch or asynchronous gap.
                const result = apply(bolo);
                io.to(ROLE_ROOMS.CONTROL).emit('bolo_configuracion_cargada', result);
                callback({ok: true, ...result});
            } catch (error) { fail('BACKSTAGE_UNAVAILABLE', error.message); }
            finally { applying = false; }
        });
    };
    return {register};
}

module.exports = {createWorldConfigurationReader, createBoloConfigurationManager};
