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
servidor.listen(puerto, () => console.log(`Servidor escuchando en el puerto: ${puerto}`));
