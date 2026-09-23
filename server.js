const fs = require('fs');
const http = require('http');
const https = require('https');
const { crearRuntimeScrib } = require('./scrib_runtime.js');

// require('dotenv').config();

const PASSWORD_ROLES = process.env.SCRIBSHOW_PASSWORD || process.env.PASSWORD_ROLES || "ScribshowAD1*";
const esProduccion = process.env.NODE_ENV === 'production';
const DEPURACION_ACTIVA = process.env.DEBUG_SERVER === '1';
const TEST_HOOKS_ENABLED = process.env.NODE_ENV === 'test' || process.env.SCRIB_TEST_HOOKS === '1';
const puerto = process.env.PORT || 3000;
const host = process.env.HOST || (esProduccion ? '127.0.0.1' : '0.0.0.0');
const registrar = DEPURACION_ACTIVA ? console.log : () => {};

function crearServidorHttp() {
    if (!esProduccion) {
        console.log("HTTP iniciado");
        return http.createServer();
    }

    const options = {
        key: fs.readFileSync('/etc/letsencrypt/live/sutura.ddns.net/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/sutura.ddns.net/fullchain.pem')
    };
    console.log("HTTPS iniciado");
    return https.createServer(options);
}

registrar(process.env.NODE_ENV);

const servidor = crearServidorHttp();
const io = require('socket.io')(servidor, {
    cookie: {
        name: 'io',
        sameSite: esProduccion ? 'none' : 'lax',
        secure: esProduccion
    },
});

const runtime = crearRuntimeScrib({
    io,
    passwordRoles: PASSWORD_ROLES,
    testHooksEnabled: TEST_HOOKS_ENABLED,
    registrar
});

runtime.iniciar();
servidor.listen(puerto, host, () => console.log(`Servidor escuchando en ${host}:${puerto}`));

let cierreEnCurso = false;
const cerrarConCheckpoint = async (signal) => {
    if (cierreEnCurso) return;
    cierreEnCurso = true;
    try {
        if (runtime && typeof runtime.persistirAhora === 'function') await runtime.persistirAhora();
    } catch (_error) {}
    servidor.close(() => process.exit(0));
    const forceTimer = setTimeout(() => process.exit(0), 1500);
    if (forceTimer && typeof forceTimer.unref === 'function') forceTimer.unref();
};
process.once('SIGTERM', () => cerrarConCheckpoint('SIGTERM'));
process.once('SIGINT', () => cerrarConCheckpoint('SIGINT'));
