const Musas = require('./musas');
const PalabrasBonusMode = require('./palabras_bonus.js');
const PalabrasMalditasMode= require('./palabras_malditas.js');

const fs = require('fs');
const https = require('https');
//require('dotenv').config();

// Password de acceso para roles protegidos (solo servidor).
const PASSWORD_ROLES = process.env.SCRIBSHOW_PASSWORD || process.env.PASSWORD_ROLES || "ScribshowAD1*";

// Entorno de ejecución (local vs producción).
const es_produccion = process.env.NODE_ENV === 'production';
//const es_produccion = false;
let servidor;
let io;

const DEPURACION_ACTIVA = process.env.DEBUG_SERVER === '1';
const registrar = DEPURACION_ACTIVA ? console.log : () => {};

registrar(process.env.NODE_ENV)
if (es_produccion) {
    // Certificados TLS en producción.
    const options = {
        key: fs.readFileSync('/etc/letsencrypt/live/sutura.ddns.net/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/sutura.ddns.net/fullchain.pem')
    };
    servidor = https.createServer(options);
    console.log("HTTPS iniciado")
} else {
    // Servidor HTTP en entorno local.
    servidor = require("http").createServer();
    console.log("HTTP iniciado")
}

// Configuración de Socket.IO (cookies y CORS).
io = require('socket.io')(servidor, {
    cookie: {
        name: 'io',
        // En producción: sameSite: 'none' y secure: true.
        // En desarrollo: sameSite: 'lax' y secure: false.
        sameSite: es_produccion ? 'none' : 'lax',
        secure: es_produccion ? true : false
    },
});

let modo_bonus = new PalabrasBonusMode(io, 300000);
let modo_malditas = new PalabrasMalditasMode(io, 30000);
let modo_musas = new Musas(io, 30000);
const puerto = process.env.PORT || 3000; // Puerto de escucha.
// Limpiezas por modo al salir de cada fase.
const LIMPIEZAS_MODO = {

    'palabras bonus': function (socket) {
        modo_bonus.clearAll();
    },

    'letra prohibida': function (socket) {
        // Limpiar colas y timers del modo de musas.
        modo_musas.clearAll();
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        letra_prohibida = "";
    },

    'letra bendita': function (socket) {
        // Limpiar colas y timers del modo de musas.
        modo_musas.clearAll();
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        letra_bendita = "";
    },

    'texto borroso': function (socket) {
    },

    'psicodélico': function (socket) {
    },

    'texto inverso': function (socket) { },

    'tertulia': function (socket) { },

    'palabras prohibidas': function (socket) {
        modo_malditas.clearAll();
    },

    'ortografía perfecta': function (socket) {

    },

    'locura': function (socket) { },

    'frase final': function (socket) {
        fin_j1 = true;
        fin_j2 = true;
        fin_del_juego = true;
        estado_jugadores[1].finished = true;
        estado_jugadores[2].finished = true;
    },


    '': function (socket) { }
}



let texto1 = ""; // Texto actual del escritor 1.
let texto2 = ""; // Texto actual del escritor 2.
let texto_escritor = { 1: "", 2: "" };
let cambio_palabra_j1 = false; // Timer de cambio de palabra (J1).
let cambio_palabra_j2 = false; // Timer de cambio de palabra (J2).
let timeout_inicio = false; // Timer de inicio de partida.
let listener_cambio_letra = false; // Timer de cambio de letra.
let tiempo_voto = false;
// Estado por jugador para modos con letra.
const estado_jugadores = {
    1: { inserts: -1, finished: false },
    2: { inserts: -1, finished: false }
  };
// Estado del teleprompter compartido con espectador.
const TELEPROMPTER_TEXT_MAX = 50000;
const teleprompter_limites = {
    fontMin: 18,
    fontMax: 96,
    speedMin: 5,
    speedMax: 300
};
let teleprompter_state = {
    visible: false,
    text: "",
    fontSize: 36,
    speed: 25,
    playing: false,
    scroll: 0,
    source: 0
};
const clampNumber = (valor, min, max) => Math.min(Math.max(valor, min), max);
const normalizarTeleprompterPayload = (payload = {}) => {
    const salida = { ...teleprompter_state };
    if (typeof payload.visible === 'boolean') {
        salida.visible = payload.visible;
    }
    if (typeof payload.text === 'string') {
        salida.text = payload.text.slice(0, TELEPROMPTER_TEXT_MAX);
    }
    if (Number.isFinite(payload.fontSize)) {
        salida.fontSize = clampNumber(payload.fontSize, teleprompter_limites.fontMin, teleprompter_limites.fontMax);
    }
    if (Number.isFinite(payload.speed)) {
        salida.speed = clampNumber(payload.speed, teleprompter_limites.speedMin, teleprompter_limites.speedMax);
    }
    if (Number.isFinite(payload.scroll)) {
        salida.scroll = payload.scroll;
    }
    if (typeof payload.playing === 'boolean') {
        salida.playing = payload.playing;
    }
    if (payload.source !== undefined) {
        const fuente = Number(payload.source);
        salida.source = fuente === 1 || fuente === 2 ? fuente : 0;
    } else if (typeof salida.text === 'string' && salida.text.trim().length > 0) {
        const textoPlano = salida.text.trim();
        const textoJ1 = (texto_escritor[1] || "").trim();
        const textoJ2 = (texto_escritor[2] || "").trim();
        if (textoPlano && textoPlano === textoJ1 && textoPlano !== textoJ2) {
            salida.source = 1;
        } else if (textoPlano && textoPlano === textoJ2 && textoPlano !== textoJ1) {
            salida.source = 2;
        }
    }
    return salida;
};
let tiempo_modos;
let atributos = {1: {}, 2: {}};
// Contador global de segundos del temporizador de modos.
let segundos_transcurridos = 0;
let id_intervalo_modos;
// Estado del modo de letras.
let modo_actual = "";
let modo_anterior = "";
// Índice global para recorrer modos pendientes sin mutar el array.
let indice_modo = 0;
let letra_prohibida = "";
let letra_bendita = "";
const letras_prohibidas = ['e','a','o','s','r','n','i','d','l','c'];
const letras_benditas= ['z','j','ñ','x','k','w', 'y', 'q', 'h', 'f'];

const repentizados = [
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> discute violentamente con <span style="color:yellow;" contenteditable="true">C</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> revela un secreto a <span style="color:yellow;" contenteditable="true">C</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> ridiculiza a <span style="color:green;" contenteditable="true">A</span>.</div>',
    '<div contenteditable="false"><span style="color:green;" contenteditable="true">A</span> quiere el perdón de <span style="color:red;" contenteditable="true">B</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> predice el futuro de <span style="color:green;" contenteditable="true">A</span>.</div>',
    '<div contenteditable="false"><span style="color:green;" contenteditable="true">A</span> interroga a <span style="color:red;" contenteditable="true">B</span> sobre su pasado.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> provoca a <span style="color:yellow;" contenteditable="true">C</span>.</div>',
    '<div contenteditable="false"><span style="color:yellow;" contenteditable="true">C</span> quiere convertir a <span style="color:red;" contenteditable="true">B</span>.</div>',
    '<div contenteditable="false"><span style="color:red;" contenteditable="true">B</span> quiere desenmascarar a <span style="color:green;" contenteditable="true">A</span>.</div>'
  ];
  

const DEFINICION_MUSA_BONUS = "<span style='color:lime;'>MUSA</span><span style='color: white;'>: </span><span style='color: white;'>Podrías escribir esta palabra ⬆️</span>";
const DEFINICION_MUSA_PROHIBIDA= "<span style='color:red;'>MUSA ENEMIGA</span><span style='color: white;'>: </span><span style='color: white;'>Podrías escribir esta palabra ⬆️</span>";

const convertirADivsASpans = repentizados.map(frase =>
    frase.replace(/<div(.*?)>/g, '<span$1>').replace(/<\/div>/g, '</span>')
);

// Log opcional para validar el preprocesado de repentizados.
registrar(convertirADivsASpans);


let letras_benditas_pendientes = [...letras_benditas];
let letras_prohibidas_pendientes = [...letras_prohibidas];
let repentizados_pendientes = [...repentizados];

var tiempos = [];

// const lista_modos = ["letra bendita","letra prohibida", "tertulia", "palabras bonus", "palabras prohibidas", "tertulia", "ortografía perfecta",  "locura"];
let lista_modos = ["letra bendita","letra prohibida", "tertulia", "palabras bonus", "palabras prohibidas", "tertulia", "locura"];
let lista_modos_locura = [ "letra bendita", "letra prohibida", "palabras bonus", "palabras prohibidas"];
let modos_pendientes;
let escritxr1 = "";
let escritxr2 = "";
let votos_ventaja = {
    "🐢": 0,
    "⚡": 0,
    //"⌛": 0,
    "🌪️": 0,
    "🙃": 0,
    "🖊️": 0
}

let votacion_ventaja_activa = false;
let votacion_ventaja_equipo = "";
let votacion_ventaja_opciones = [];

const emitirEstadoVotacionVentaja = (override = null) => {
    if (!io) return;
    const payload = override || {
        activa: votacion_ventaja_activa,
        equipo: votacion_ventaja_equipo,
        opciones: Array.isArray(votacion_ventaja_opciones) ? [...votacion_ventaja_opciones] : [],
        votos: { ...votos_ventaja }
    };
    io.emit('votacion_ventaja_estado', payload);
};

let votos_repentizado = {
    "1": 0,
    "2": 0,
    "3": 0
}

let fin_j1 = false;
let fin_j2 = false;
let fin_del_juego = false;
let nueva_palabra_j1 = false;
let nueva_palabra_j2 = false;
let locura = false;

let TIEMPO_CAMBIO_PALABRAS;
let DURACION_TIEMPO_MODOS;
let TIEMPO_CAMBIO_MODOS;
let TIEMPO_BORROSO;
let PALABRAS_INSERTADAS_META;
let TIEMPO_VOTACION;
let TIEMPO_CAMBIO_LETRA;

// Helpers de sincronización y limpieza de estado.
const actualizarTimeoutModo = (modo, tiempo_ms) => {
    if (!modo) return;
    modo.timeout = tiempo_ms;
    if (typeof modo.clearAll === 'function') {
        modo.clearAll();
    }
};
const limpiarTodosLosModos = () => {
    if (modo_musas) modo_musas.clearAll();
    if (modo_bonus) modo_bonus.clearAll();
    if (modo_malditas) modo_malditas.clearAll();
};
const limpiarTimersPalabras = () => {
    clearTimeout(cambio_palabra_j1);
    clearTimeout(cambio_palabra_j2);
    clearTimeout(listener_cambio_letra);
};
const limpiarTimersRonda = () => {
    clearTimeout(tiempo_voto);
    clearTimeout(timeout_inicio);
    clearInterval(id_intervalo_modos);
};
const obtenerIdJugadorValido = (valor) => {
    const id = Number(valor);
    return (id === 1 || id === 2) ? id : null;
};
const MAX_NOMBRE_MUSA = 10;
const REGEX_NOMBRE_MUSA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _.-]+$/;
const REGEX_LETRA_MUSA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
const normalizarNombreMusa = (valor) => {
    if (typeof valor !== 'string') return '';
    const limpio = valor.trim().slice(0, MAX_NOMBRE_MUSA);
    if (!limpio) return '';
    if (!REGEX_NOMBRE_MUSA.test(limpio)) return '';
    if (!REGEX_LETRA_MUSA.test(limpio)) return '';
    return limpio.toUpperCase();
};
const extraerTextoPlano = (evento) => {
    if (typeof evento === 'string') return evento;
    if (evento && typeof evento.text === 'string') return evento.text;
    return '';
};
const reiniciarEstadoPartida = (socket) => {
    fin_j1 = false;
    fin_j2 = false;
    estado_jugadores[1].finished = true;
    estado_jugadores[2].finished = true;
    fin_del_juego = true;
    limpiarTimersPalabras();
    limpiarTimersRonda();
    LIMPIEZAS_MODO[modo_actual](socket);
    activar_sockets_extratextuales(socket);
    modos_pendientes = [...lista_modos];
    modo_anterior = "";
    modo_actual = "";
};

const finalizarPartida = (socket) => {
    fin_j1 = true;
    fin_j2 = true;
    estado_jugadores[1].finished = true;
    estado_jugadores[2].finished = true;
    fin_del_juego = true;
    limpiarTimersPalabras();
    limpiarTimersRonda();
    if (modo_actual && LIMPIEZAS_MODO[modo_actual]) {
        LIMPIEZAS_MODO[modo_actual](socket);
    }
    activar_sockets_extratextuales(socket);
    modos_pendientes = [...lista_modos];
    indice_modo = 0;
    modo_anterior = "";
    modo_actual = "";
    io.emit('fin_a_control');
};

// Helpers para reenviar eventos sin duplicar listeners.
function reenviarAOtros(socket, evento, evento_salida = null) {
    if (!socket._forwarded_events) socket._forwarded_events = new Set();
    const key = evento_salida ? `${evento}->${evento_salida}` : evento;
    if (socket._forwarded_events.has(key)) return;
    socket._forwarded_events.add(key);

    socket.on(evento, (payload) => {
        const salida = evento_salida || evento;
        socket.broadcast.emit(salida, payload);
    });
}

function reenviarASala(socket, evento, sala, evento_salida = null) {
    if (!socket._forwarded_room_events) socket._forwarded_room_events = new Set();
    const key = `${evento}->${evento_salida || evento}@${sala}`;
    if (socket._forwarded_room_events.has(key)) return;
    socket._forwarded_room_events.add(key);

    socket.on(evento, (payload) => {
        const salida = evento_salida || evento;
        io.to(sala).emit(salida, payload);
    });
}

function reenviarGrupo(socket, eventos) {
    eventos.forEach((evento) => reenviarAOtros(socket, evento));
}

function reenviarMapeados(socket, pares) {
    pares.forEach(([entrada, salida]) => reenviarAOtros(socket, entrada, salida));
}

function reenviarMapeadosASala(socket, pares) {
    pares.forEach(([entrada, salida, sala]) => reenviarASala(socket, entrada, sala, salida));
}

function activar_sockets_extratextuales(socket) {
    if (socket._extratextuales_on) {
        return;
    }
    socket._extratextuales_on = true;

    reenviarGrupo(socket, ['vote', 'exit', 'scroll', 'scroll_sincro', 'impro']);
    reenviarMapeados(socket, [
        ['envia_temas', 'recibe_temas'],
        ['temas', 'temas_espectador'],
        ['tiempo_muerto_a_control', 'tiempo_muerto_control'],
    ]);

    reenviarMapeadosASala(socket, [
        ['enviar_postgame1', 'recibir_postgame2', 'j2'],
        ['enviar_postgame2', 'recibir_postgame1', 'j1'],
    ]);
}

// Contador de musas conectadas por equipo.
let contador_musas = {
    escritxr1: 0,
    escritxr2: 0
  };

// Estado de escritores conectados (players J1/J2).
const escritores_conectados = {
    1: new Set(),
    2: new Set()
};
const obtenerEstadoEscritores = () => ({
    ts: Date.now(),
    players: {
        j1: escritores_conectados[1].size > 0,
        j2: escritores_conectados[2].size > 0,
        total: escritores_conectados[1].size + escritores_conectados[2].size
    }
});

const regalos_pdf_musas = { 1: null, 2: null };

// Estado del calentamiento entre musas.
const musas_por_equipo = { 1: new Map(), 2: new Map() };
const crearEstadoCalentamiento = (aciertos = 0) => ({
    semillas: { 1: null, 2: null },
    semillas_ts: 0,
    asignadas: { 1: null, 2: null },
    pendiente: null,
    usadas: new Map(),
    intentos: 0,
    aciertos,
    estado: 'inactivo',
    historial: [],
    ultimo_intento: null,
    palabras: []
});
const crearCursorCalentamiento = () => ({
    x: 50,
    y: 50,
    visible: false,
    ts: 0
});
const calentamiento = {
    activo: false,
    vista: false,
    solicitud: 'libre',
    cursores: {
        1: crearCursorCalentamiento(),
        2: crearCursorCalentamiento()
    },
    equipos: {
        1: crearEstadoCalentamiento(),
        2: crearEstadoCalentamiento()
    }
};
const REGEX_LIMPIEZA_PALABRA = /[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1\s-]/gi;
const MAX_PALABRA_CALENTAMIENTO = 24;
const MAX_PALABRAS_PANTALLA_CALENTAMIENTO = 220;
const MIN_Y_PALABRAS_CALENTAMIENTO = 20;
const MAX_Y_PALABRAS_CALENTAMIENTO = 94;
const DURACION_PALABRA_CALENTAMIENTO_MS = 10000;
const DURACION_PALABRA_CAMBIO_CONSIGNA_MS = 900;
const INTERVALO_PURGA_CALENTAMIENTO_MS = 1000;
const COOLDOWN_MUSA_CORAZON_MS = 900;
const TIPOS_SOLICITUD_CALENTAMIENTO = new Set(['libre', 'lugares', 'acciones', 'frase_final']);
const normalizarPalabra = (valor) => {
    if (typeof valor !== 'string') return '';
    const limpio = valor.trim().toLowerCase().replace(/\s+/g, ' ');
    return limpio.replace(REGEX_LIMPIEZA_PALABRA, '').trim();
};
const normalizarSolicitudCalentamiento = (valor) => {
    const tipo = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
    if (TIPOS_SOLICITUD_CALENTAMIENTO.has(tipo)) return tipo;
    return 'libre';
};
const normalizarDuracionPalabraCalentamiento = (valor, fallback = DURACION_PALABRA_CALENTAMIENTO_MS) => {
    const num = Number(valor);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return num;
};
const limpiarPalabra = (valor) => (typeof valor === 'string' ? valor.trim() : '');
const limitarPorcentaje = (valor, min = 0, max = 100) => {
    const num = Number(valor);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
};
const distanciaCalentamiento = (a, b) => {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt((dx * dx) + (dy * dy));
};
const serializarPalabrasCalentamiento = (palabras = []) => {
    return palabras.map((entrada) => ({
        id: entrada.id,
        palabra: entrada.palabra,
        equipo: entrada.equipo,
        x: entrada.x,
        y: entrada.y,
        destacada: Boolean(entrada.destacada),
        ts: entrada.ts || 0,
        animOnTs: Number(entrada.animOnTs) || 0,
        animOffTs: Number(entrada.animOffTs) || 0,
        duracionMs: normalizarDuracionPalabraCalentamiento(entrada.duracionMs)
    }));
};
const generarPosicionCalentamiento = (equipo) => {
    const todas = [
        ...(calentamiento.equipos[1]?.palabras || []),
        ...(calentamiento.equipos[2]?.palabras || [])
    ];
    const minX = 6;
    const maxX = 94;
    const minY = MIN_Y_PALABRAS_CALENTAMIENTO;
    const maxY = MAX_Y_PALABRAS_CALENTAMIENTO;
    const minimoDistancia = todas.length < 40 ? 8 : (todas.length < 100 ? 5 : 3);
    for (let i = 0; i < 60; i += 1) {
        const x = Number((Math.random() * (maxX - minX) + minX).toFixed(2));
        const y = Number((Math.random() * (maxY - minY) + minY).toFixed(2));
        const candidato = { x, y, equipo };
        const choca = todas.some((word) => distanciaCalentamiento(word, candidato) < minimoDistancia);
        if (!choca) {
            return { x, y };
        }
    }
    return {
        x: Number((Math.random() * (maxX - minX) + minX).toFixed(2)),
        y: Number((Math.random() * (maxY - minY) + minY).toFixed(2))
    };
};
const resetearPalabrasCalentamiento = (equipo, mantenerAciertos = true) => {
    const previo = calentamiento.equipos[equipo];
    const aciertos = mantenerAciertos ? (previo.aciertos || 0) : 0;
    const siguiente = crearEstadoCalentamiento(aciertos);
    siguiente.estado = musas_por_equipo[equipo].size > 0 ? 'jugando' : 'sin_musas';
    calentamiento.equipos[equipo] = siguiente;
};
const acelerarPalabrasCambioSolicitudCalentamiento = () => {
    const ahora = Date.now();
    [1, 2].forEach((equipo) => {
        const data = calentamiento.equipos[equipo];
        if (!data || !Array.isArray(data.palabras)) return;
        data.palabras.forEach((entrada) => {
            if (!entrada) return;
            const duracionActual = normalizarDuracionPalabraCalentamiento(entrada.duracionMs);
            const edadActual = Math.max(0, ahora - (Number(entrada.ts) || ahora));
            const progreso = Math.max(0, Math.min(1, edadActual / duracionActual));
            entrada.destacada = false;
            entrada.animOnTs = 0;
            entrada.animOffTs = ahora;
            entrada.duracionMs = DURACION_PALABRA_CAMBIO_CONSIGNA_MS;
            entrada.ts = ahora - Math.floor(progreso * DURACION_PALABRA_CAMBIO_CONSIGNA_MS);
        });
    });
};
const agregarPalabraCalentamiento = (equipo, socketId, valorPalabra) => {
    if (!calentamiento.activo || !calentamiento.vista) {
        return { ok: false, mensaje: 'El calentamiento no esta disponible.' };
    }
    const data = calentamiento.equipos[equipo];
    if (!data) {
        return { ok: false, mensaje: 'Equipo invalido.' };
    }
    const palabra = limpiarPalabra(valorPalabra);
    if (!palabra) {
        return { ok: false, mensaje: 'Escribe una palabra.' };
    }
    if (/\s/.test(palabra)) {
        return { ok: false, mensaje: 'Solo una palabra, sin espacios.' };
    }
    const normalizada = normalizarPalabra(palabra);
    if (!normalizada) {
        return { ok: false, mensaje: 'Escribe una palabra valida.' };
    }
    if (palabra.length > MAX_PALABRA_CALENTAMIENTO) {
        return { ok: false, mensaje: 'La palabra es demasiado larga.' };
    }
    const posicion = generarPosicionCalentamiento(equipo);
    const registro = {
        id: `${equipo}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        palabra,
        normalizada,
        equipo,
        x: posicion.x,
        y: posicion.y,
        destacada: false,
        ts: Date.now(),
        animOnTs: 0,
        animOffTs: 0,
        duracionMs: DURACION_PALABRA_CALENTAMIENTO_MS,
        socketId
    };
    data.palabras.push(registro);
    if (data.palabras.length > MAX_PALABRAS_PANTALLA_CALENTAMIENTO) {
        data.palabras.shift();
    }
    data.intentos += 1;
    data.estado = 'jugando';
    data.ultimo_intento = {
        id: registro.id,
        palabra: registro.palabra,
        exito: false,
        ts: registro.ts
    };
    return { ok: true, registro };
};
const alternarPalabraDestacadaCalentamiento = (equipo, idPalabra) => {
    if (!idPalabra || (equipo !== 1 && equipo !== 2)) return false;
    const data = calentamiento.equipos[equipo];
    if (!data || !Array.isArray(data.palabras)) return false;
    const palabra = data.palabras.find((item) => item.id === idPalabra);
    if (!palabra) return false;
    const destacada = !Boolean(palabra.destacada);
    const ahora = Date.now();
    palabra.destacada = destacada;
    if (destacada) {
        palabra.animOnTs = ahora;
        palabra.animOffTs = 0;
        data.aciertos += 1;
        return {
            id: palabra.id,
            palabra: palabra.palabra,
            equipo,
            destacada: true,
            socketId: palabra.socketId || null
        };
    }
    data.aciertos = Math.max(0, data.aciertos - 1);
    // Al desiluminar, la palabra vuelve a su ciclo de vida completo.
    palabra.ts = ahora;
    palabra.animOnTs = 0;
    palabra.animOffTs = ahora;
    return {
        id: palabra.id,
        palabra: palabra.palabra,
        equipo,
        destacada: false,
        socketId: palabra.socketId || null
    };
};
const depurarPalabrasCalentamiento = () => {
    if (!calentamiento.activo) return false;
    const ahora = Date.now();
    let cambio = false;
    [1, 2].forEach((equipo) => {
        const data = calentamiento.equipos[equipo];
        if (!data || !Array.isArray(data.palabras) || data.palabras.length === 0) return;
        const totalPrevio = data.palabras.length;
        data.palabras = data.palabras.filter((entrada) => {
            if (!entrada) return false;
            if (entrada.destacada) return true;
            const edad = ahora - (Number(entrada.ts) || ahora);
            const duracion = normalizarDuracionPalabraCalentamiento(entrada.duracionMs);
            return edad < duracion;
        });
        if (data.palabras.length !== totalPrevio) {
            cambio = true;
        }
    });
    return cambio;
};
const actualizarCursorCalentamiento = (equipo, payload = {}) => {
    const cursor = calentamiento.cursores[equipo];
    if (!cursor) return false;
    const visible = payload && payload.visible === false ? false : true;
    if (!visible) {
        if (!cursor.visible) return false;
        cursor.visible = false;
        cursor.ts = Date.now();
        return true;
    }
    const x = limitarPorcentaje(payload.x, 0, 100);
    const y = limitarPorcentaje(payload.y, 0, 100);
    const cambio = !cursor.visible || Math.abs(cursor.x - x) > 0.15 || Math.abs(cursor.y - y) > 0.15;
    cursor.x = x;
    cursor.y = y;
    cursor.visible = true;
    cursor.ts = Date.now();
    return cambio;
};
const ocultarCursorCalentamiento = (equipo) => {
    const cursor = calentamiento.cursores[equipo];
    if (!cursor || !cursor.visible) return false;
    cursor.visible = false;
    cursor.ts = Date.now();
    return true;
};
const payloadCursoresCalentamiento = () => ({
    1: { ...calentamiento.cursores[1] },
    2: { ...calentamiento.cursores[2] }
});
const estadoEquipoCalentamiento = (equipo) => {
    const data = calentamiento.equipos[equipo];
    return {
        semillas: { 1: null, 2: null },
        semillasTs: data.semillas_ts,
        semillasRecibidas: {
            1: false,
            2: false
        },
        intentos: data.intentos,
        aciertos: data.aciertos,
        estado: data.estado,
        pendiente: false,
        pendientePalabra: null,
        ultimoIntento: data.ultimo_intento,
        usadas: [],
        historial: [],
        palabras: serializarPalabrasCalentamiento(data.palabras || [])
    };
};
const payloadEstadoCalentamiento = () => ({
    activo: calentamiento.activo,
    vista: calentamiento.vista,
    solicitud: calentamiento.solicitud,
    cursores: payloadCursoresCalentamiento(),
    equipos: {
        1: estadoEquipoCalentamiento(1),
        2: estadoEquipoCalentamiento(2)
    }
});
const payloadEstadoCalentamientoMusa = (equipo) => {
    const data = estadoEquipoCalentamiento(equipo);
    return {
        activo: calentamiento.activo,
        vista: calentamiento.vista,
        solicitud: calentamiento.solicitud,
        equipo,
        rol: 'musa',
        estado: data.estado,
        intentos: data.intentos,
        aciertos: data.aciertos,
        palabras: data.palabras
    };
};
const reiniciarEquipoCalentamiento = (equipo, mantenerAciertos = true) => {
    resetearPalabrasCalentamiento(equipo, mantenerAciertos);
};
const emitirEstadoCalentamiento = () => {
    io.emit('calentamiento_estado_espectador', payloadEstadoCalentamiento());
    emitirEstadoCalentamientoMusa(1);
    emitirEstadoCalentamientoMusa(2);
};
const emitirEstadoCalentamientoMusa = (equipo, socketObjetivo = null) => {
    const payload = payloadEstadoCalentamientoMusa(equipo);
    if (socketObjetivo) {
        socketObjetivo.emit('calentamiento_estado_musa', payload);
        return;
    }
    musas_por_equipo[equipo].forEach((info) => {
        info.socket.emit('calentamiento_estado_musa', payload);
    });
};
const elegirSemillasEquipo = (equipo) => {
    const data = calentamiento.equipos[equipo];
    data.asignadas[1] = null;
    data.asignadas[2] = null;
    data.estado = musas_por_equipo[equipo].size > 0 ? 'jugando' : 'sin_musas';
};
const revisarAsignacionesEquipo = (equipo) => {
    if (!calentamiento.activo) return;
    const data = calentamiento.equipos[equipo];
    if (!data) return;
    data.estado = musas_por_equipo[equipo].size > 0 ? 'jugando' : 'sin_musas';
};
const iniciarCalentamiento = () => {
    calentamiento.activo = true;
    calentamiento.solicitud = 'libre';
    calentamiento.cursores[1] = crearCursorCalentamiento();
    calentamiento.cursores[2] = crearCursorCalentamiento();
    [1, 2].forEach((equipo) => {
        reiniciarEquipoCalentamiento(equipo, true);
    });
    emitirEstadoCalentamiento();
};
setInterval(() => {
    if (!depurarPalabrasCalentamiento()) return;
    emitirEstadoCalentamiento();
}, INTERVALO_PURGA_CALENTAMIENTO_MS);

// ──────────────────────────────────────────────────────────────────────────────
// Canal de calentamiento independiente para BOLZANO (sin mezcla con players_scrib)
// ──────────────────────────────────────────────────────────────────────────────
const bolzano_musas_por_equipo = { 1: new Map(), 2: new Map() };
const bolzano_calentamiento = {
    activo: true,
    vista: true,
    equipos: {
        1: crearEstadoCalentamiento(),
        2: crearEstadoCalentamiento()
    }
};
const bolzano_obtenerSemillasPublicas = (data) => {
    if (data.semillas[1] && data.semillas[2]) {
        return data.semillas;
    }
    return { 1: null, 2: null };
};
const bolzano_estadoEquipoCalentamiento = (equipo) => {
    const data = bolzano_calentamiento.equipos[equipo];
    return {
        semillas: bolzano_obtenerSemillasPublicas(data),
        semillasTs: data.semillas_ts,
        semillasRecibidas: {
            1: Boolean(data.semillas[1]),
            2: Boolean(data.semillas[2])
        },
        intentos: data.intentos,
        aciertos: data.aciertos,
        estado: data.estado,
        pendiente: Boolean(data.pendiente),
        pendientePalabra: data.pendiente ? data.pendiente.palabra : null,
        pendienteSocketId: data.pendiente ? data.pendiente.socketId : null,
        ultimoIntento: data.ultimo_intento,
        usadas: Array.from(data.usadas.values()),
        historial: Array.isArray(data.historial) ? data.historial.slice(-6) : []
    };
};
const bolzano_registrarHistorialCalentamiento = (data, palabra1, palabra2, exito) => {
    const padres = [data.semillas[1] || "--", data.semillas[2] || "--"];
    const hijos = exito ? [palabra1] : [palabra1, palabra2];
    data.historial.push({
        padres,
        hijos,
        exito: Boolean(exito)
    });
    if (data.historial.length > 8) {
        data.historial.shift();
    }
};
const bolzano_elegirSemillasEquipo = (equipo) => {
    const ids = Array.from(bolzano_musas_por_equipo[equipo].keys());
    const data = bolzano_calentamiento.equipos[equipo];
    if (ids.length === 0) {
        data.asignadas[1] = null;
        data.asignadas[2] = null;
        data.estado = 'sin_musas';
        return;
    }
    if (ids.length === 1) {
        data.asignadas[1] = ids[0];
        data.asignadas[2] = ids[0];
        data.estado = 'esperando_semillas';
        return;
    }
    const idx1 = Math.floor(Math.random() * ids.length);
    let idx2 = idx1;
    while (idx2 === idx1) {
        idx2 = Math.floor(Math.random() * ids.length);
    }
    data.asignadas[1] = ids[idx1];
    data.asignadas[2] = ids[idx2];
    data.estado = 'esperando_semillas';
};
const bolzano_revisarAsignacionesEquipo = (equipo) => {
    if (!bolzano_calentamiento.activo) return;
    const data = bolzano_calentamiento.equipos[equipo];
    const ids = Array.from(bolzano_musas_por_equipo[equipo].keys());
    if (ids.length === 0) {
        data.asignadas[1] = null;
        data.asignadas[2] = null;
        if (!data.semillas[1] || !data.semillas[2]) {
            data.estado = 'sin_musas';
        }
        return;
    }
    [1, 2].forEach((posicion) => {
        if (data.semillas[posicion]) return;
        const asignada = data.asignadas[posicion];
        if (asignada && bolzano_musas_por_equipo[equipo].has(asignada)) return;
        const otra = posicion === 2 ? data.asignadas[1] : data.asignadas[2];
        const candidatos = ids.filter((id) => id !== otra || ids.length === 1);
        const elegido = candidatos[Math.floor(Math.random() * candidatos.length)];
        data.asignadas[posicion] = elegido || ids[0];
    });
    if (!data.semillas[1] || !data.semillas[2]) {
        data.estado = 'esperando_semillas';
    }
};
const bolzano_reiniciarEquipoCalentamiento = (equipo, mantenerAciertos = true) => {
    const aciertos = mantenerAciertos ? (bolzano_calentamiento.equipos[equipo].aciertos || 0) : 0;
    bolzano_calentamiento.equipos[equipo] = crearEstadoCalentamiento(aciertos);
    bolzano_elegirSemillasEquipo(equipo);
};
const bolzano_emitirEstadoCalentamientoMusa = (equipo, socketObjetivo = null) => {
    const data = bolzano_calentamiento.equipos[equipo];
    const construirPayload = (socketId) => {
        const esSemilla1 = data.asignadas[1] === socketId;
        const esSemilla2 = data.asignadas[2] === socketId;
        const rol = esSemilla1 && esSemilla2
            ? 'semilla_doble'
            : (esSemilla1 ? 'semilla1' : (esSemilla2 ? 'semilla2' : 'musa'));
        return {
            activo: bolzano_calentamiento.activo,
            vista: bolzano_calentamiento.vista,
            equipo,
            rol,
            semillas: bolzano_obtenerSemillasPublicas(data),
            semillasTs: data.semillas_ts,
            semillasRecibidas: {
                1: Boolean(data.semillas[1]),
                2: Boolean(data.semillas[2])
            },
            intentos: data.intentos,
            aciertos: data.aciertos,
            estado: data.estado,
            pendiente: Boolean(data.pendiente),
            pendientePalabra: data.pendiente ? data.pendiente.palabra : null,
            pendienteSocketId: data.pendiente ? data.pendiente.socketId : null,
            ultimoIntento: data.ultimo_intento,
            usadas: Array.from(data.usadas.values())
        };
    };
    if (socketObjetivo) {
        socketObjetivo.emit('bolzano_calentamiento_estado_musa', construirPayload(socketObjetivo.id));
        return;
    }
    bolzano_musas_por_equipo[equipo].forEach((info, socketId) => {
        info.socket.emit('bolzano_calentamiento_estado_musa', construirPayload(socketId));
    });
};
const bolzano_emitirEstadoCalentamiento = () => {
    bolzano_emitirEstadoCalentamientoMusa(1);
    bolzano_emitirEstadoCalentamientoMusa(2);
};
const iniciarCalentamientoBolzano = () => {
    bolzano_calentamiento.activo = true;
    bolzano_calentamiento.vista = true;
    [1, 2].forEach((equipo) => {
        bolzano_reiniciarEquipoCalentamiento(equipo, true);
    });
    bolzano_emitirEstadoCalentamiento();
};
iniciarCalentamientoBolzano();
  

const frecuencia_letras = {
    'a': 12.53,
    'b': 1.42,
    'c': 4.68,
    'd': 5.86,
    'e': 13.68,
    'f': 0.69,
    'g': 1.01,
    'h': 0.7,
    'i': 6.25,
    'j': 0.44,
    'k': 0.02,
    'l': 4.97,
    'm': 3.15,
    'n': 6.71,
    'ñ': 0.31,
    'o': 8.68,
    'p': 2.51,
    'q': 0.88,
    'r': 6.87,
    's': 7.98,
    't': 4.63,
    'u': 3.93,
    'v': 0.90,
    'w': 0.01,
    'x': 0.22,
    'y': 0.90,
    'z': 0.52
}

// Arranque del servidor.
servidor.listen(puerto, () => console.log(`Servidor escuchando en el puerto: ${puerto}`));

io.on('connection', (socket) => {

    socket.on('validar_password_roles', (payload, callback) => {
        const pass = (typeof payload === 'string')
            ? payload
            : (payload && typeof payload.password === 'string' ? payload.password : '');
        const ok = pass === PASSWORD_ROLES;
        if (typeof callback === 'function') {
            callback({ ok });
        } else {
            socket.emit('validar_password_roles', { ok });
        }
    });

    socket.on('health_ping', (_payload, callback) => {
        const estado = obtenerEstadoEscritores();
        if (typeof callback === 'function') {
            callback(estado);
        } else {
            socket.emit('health_pong', estado);
        }
    });

    socket.emit('actualizar_contador_musas', contador_musas);
    socket.emit('calentamiento_vista', { activo: calentamiento.vista });
    socket.emit('calentamiento_estado_espectador', payloadEstadoCalentamiento());
    socket.on('pedir_calentamiento_estado', () => {
        socket.emit('calentamiento_estado_espectador', payloadEstadoCalentamiento());
    });
    socket.on('pedir_calentamiento_estado_bolzano', () => {
        const equipo = obtenerIdJugadorValido(socket.musa_bolzano);
        if (!equipo) return;
        bolzano_emitirEstadoCalentamientoMusa(equipo, socket);
    });

    // Registro de roles y salas.
    socket.on('registrar_espectador', () => {
        socket.espectador = true;
        socket.join(`j${1}`);
        socket.join(`j${2}`);
        socket.emit('teleprompter_state', { state: teleprompter_state });
  });
    socket.on('registrar_escritor', (escritxr) => {

        const id_jugador = obtenerIdJugadorValido(escritxr);
        if (!id_jugador) {
          console.warn(`[servidor] register_escritor: id inválido (${escritxr})`);
          return;
        }
        socket.escritxr = id_jugador;
        socket.join(`j${id_jugador}`);
        if (escritores_conectados[id_jugador]) {
            escritores_conectados[id_jugador].add(socket.id);
        }
        registrar(`[servidor] socket ${socket.id} registrado como escritor ${id_jugador}`);
      });

    socket.on('registrar_musa', (evento) => {
        const datos_musa = (evento && typeof evento === 'object') ? evento : { musa: evento };
        const id_jugador = obtenerIdJugadorValido(datos_musa.musa);
        const nombre_musa = normalizarNombreMusa(datos_musa.nombre) || 'MUSA';
        socket.musa = id_jugador;
        socket.nombre_musa = nombre_musa;
        registrar(`Una musa (${nombre_musa}) se ha unido a la partida para el equipo ${datos_musa.musa}.`);
        if (!id_jugador) {
          registrar(`[servidor] enviar_musa: escritxr=${datos_musa.musa} no es escritor válido → no cuento`);
          return;
        }
        socket.join(`j${id_jugador}`);
        socket.join(`musa_j${id_jugador}`);
        // Actualiza contador solo si la musa es válida.
        if (id_jugador === 1) contador_musas.escritxr1++;
        else             contador_musas.escritxr2++;
        registrar('[servidor] contador_musas →', contador_musas);
        io.emit('actualizar_contador_musas', contador_musas);
        musas_por_equipo[id_jugador].set(socket.id, { socket, nombre: nombre_musa });
        if (regalos_pdf_musas[id_jugador]) {
            socket.emit('regalo_pdf_musas', regalos_pdf_musas[id_jugador]);
        }
        if (calentamiento.activo) {
            revisarAsignacionesEquipo(id_jugador);
            emitirEstadoCalentamiento();
        } else {
            emitirEstadoCalentamientoMusa(id_jugador);
        }
  });

    socket.on('registrar_musa_bolzano', (evento) => {
        const datos_musa = (evento && typeof evento === 'object') ? evento : { musa: evento };
        const id_jugador = obtenerIdJugadorValido(datos_musa.musa);
        const nombre_musa = normalizarNombreMusa(datos_musa.nombre) || 'MUSA';
        if (!id_jugador) {
            return;
        }

        const equipoPrevio = obtenerIdJugadorValido(socket.musa_bolzano);
        if (equipoPrevio && equipoPrevio !== id_jugador) {
            bolzano_musas_por_equipo[equipoPrevio].delete(socket.id);
            const previoData = bolzano_calentamiento.equipos[equipoPrevio];
            if (previoData.pendiente && previoData.pendiente.socketId === socket.id) {
                previoData.pendiente = null;
            }
            bolzano_revisarAsignacionesEquipo(equipoPrevio);
        }

        socket.musa_bolzano = id_jugador;
        socket.nombre_musa_bolzano = nombre_musa;
        socket.join(`bolzano_musa_j${id_jugador}`);
        bolzano_musas_por_equipo[id_jugador].set(socket.id, { socket, nombre: nombre_musa });

        if (bolzano_calentamiento.activo) {
            bolzano_revisarAsignacionesEquipo(id_jugador);
            bolzano_emitirEstadoCalentamiento();
        } else {
            bolzano_emitirEstadoCalentamientoMusa(id_jugador, socket);
        }
  });

  socket.on('teleprompter_control', (payload = {}) => {
    const state = normalizarTeleprompterPayload(payload.state || {});
    teleprompter_state = state;
    io.emit('teleprompter_state', { state: teleprompter_state });
  });

  socket.on('musa_corazon', () => {
    const equipo = obtenerIdJugadorValido(socket.musa);
    if (!equipo) {
        return;
    }
    const ahora = Date.now();
    if (socket._ultimo_corazon && (ahora - socket._ultimo_corazon) < COOLDOWN_MUSA_CORAZON_MS) {
        return;
    }
    socket._ultimo_corazon = ahora;
    io.to(`j${equipo}`).emit('musa_corazon', { equipo, ts: ahora });
  });

  socket.on('disconnect', () => {
    const id = Number(socket.musa);
    registrar(`[servidor] desconexión socket ${socket.id}, escritxr=${id}`);
  
    if (id === 1) {
      if (contador_musas.escritxr1 > 0) {
        contador_musas.escritxr1--;
        registrar(`[servidor] decrementado contador_musas.escritxr1 →`, contador_musas.escritxr1);
      }
    } 
    else if (id === 2) {
      if (contador_musas.escritxr2 > 0) {
        contador_musas.escritxr2--;
        registrar(`[servidor] decrementado contador_musas.escritxr2 →`, contador_musas.escritxr2);
      }
    } 
    else {
      registrar('[servidor] desconexión de cliente sin escritxr válido, no se modifica contador.');
    }
  
    // Emite el estado actualizado del contador.
    io.emit('actualizar_contador_musas', contador_musas);
    if (id === 1 || id === 2) {
        musas_por_equipo[id].delete(socket.id);
        const data = calentamiento.equipos[id];
        if (data.pendiente && data.pendiente.socketId === socket.id) {
            data.pendiente = null;
        }
        if (!data.semillas[1] || !data.semillas[2]) {
            revisarAsignacionesEquipo(id);
        }
        emitirEstadoCalentamiento();
    }

    const idBolzano = Number(socket.musa_bolzano);
    if (idBolzano === 1 || idBolzano === 2) {
        bolzano_musas_por_equipo[idBolzano].delete(socket.id);
        const dataBolzano = bolzano_calentamiento.equipos[idBolzano];
        if (dataBolzano.pendiente && dataBolzano.pendiente.socketId === socket.id) {
            dataBolzano.pendiente = null;
        }
        if (!dataBolzano.semillas[1] || !dataBolzano.semillas[2]) {
            bolzano_revisarAsignacionesEquipo(idBolzano);
        }
        bolzano_emitirEstadoCalentamiento();
    }

    const escritorId = Number(socket.escritxr);
    if (escritorId === 1 || escritorId === 2) {
        escritores_conectados[escritorId].delete(socket.id);
        if (ocultarCursorCalentamiento(escritorId)) {
            io.emit('calentamiento_cursor', { equipo: escritorId, ...calentamiento.cursores[escritorId] });
        }
    }
  });
  
    // Envía nombres actuales al conectar.

    io.emit('nombre1', escritxr1);
    io.emit('nombre2', escritxr2);

    // Canales de texto de los escritores.

    socket.on('texto1', (evento) => {
        texto1 = evento;
        if (socket.escritxr === 1) {
            texto_escritor[1] = extraerTextoPlano(evento);
            modo_malditas.actualizarTextoJugador(1, texto_escritor[1]);
        }
        socket.broadcast.emit('texto1', evento);
    });

    // Envía el texto del editor 2.

    socket.on('texto2', (evento) => {
        texto2 = evento;
        if (socket.escritxr === 2) {
            texto_escritor[2] = extraerTextoPlano(evento);
            modo_malditas.actualizarTextoJugador(2, texto_escritor[2]);
        }
        socket.broadcast.emit('texto2', evento);
    });

    socket.on('pedir_texto', () => {
        if(socket.musa == 1){
            socket.emit('texto1', texto1);
            }
        else{
            socket.emit('texto2', texto2);
        }
    });

socket.on('pedir_nombre', (payload = {}) => {
    registrar("te escucho pedir_nombre", payload);

    // Prioriza musa explícita si se pasa por parámetro.
    const musa_param = Number(payload.musa);
    const hayMusaPorParametro = (musa_param === 1 || musa_param === 2);

    // Musa efectiva: parámetro válido o socket.musa.
    const musa_efectiva = hayMusaPorParametro ? musa_param : Number(socket.musa);

    // Fallback defensivo si socket.musa es inválida o no existe.
    const musa_final = (musa_efectiva === 1 || musa_efectiva === 2) ? musa_efectiva : 1;

    // Emite el nombre correspondiente.
    socket.emit('dar_nombre', musa_final === 1 ? escritxr1 : escritxr2);

    // Solo sincroniza modos si no hay musa forzada por parámetro.
    if (!hayMusaPorParametro) {
        sincro_modos(socket);
    }
});



    // Actualiza nombre del jugador 1.

    socket.on('envío_nombre1', (nombre) => {
        escritxr1 = nombre;
        socket.broadcast.emit('nombre1', nombre);
    });

    // Actualiza nombre del jugador 2.

    socket.on('envío_nombre2', (nombre) => {
        escritxr2 = nombre;
        socket.broadcast.emit('nombre2', nombre);
    });

    socket.on('cambiar_vista_calentamiento', (payload = {}) => {
        if (payload && typeof payload.activo === 'boolean') {
            calentamiento.vista = payload.activo;
        } else {
            calentamiento.vista = !calentamiento.vista;
        }
        if (calentamiento.vista && !calentamiento.activo) {
            iniciarCalentamiento();
        }
        io.emit('calentamiento_vista', { activo: calentamiento.vista });
        emitirEstadoCalentamiento();
    });

    socket.on('reiniciar_calentamiento', () => {
        iniciarCalentamiento();
    });
    socket.on('reiniciar_marcador_calentamiento', () => {
        [1, 2].forEach((equipo) => {
            const data = calentamiento.equipos[equipo];
            data.intentos = 0;
            data.aciertos = 0;
            if (Array.isArray(data.palabras)) {
                data.palabras.forEach((palabra) => {
                    palabra.destacada = false;
                });
            }
        });
        emitirEstadoCalentamiento();
    });

    socket.on('calentamiento_solicitud', (payload = {}) => {
        const tipo = normalizarSolicitudCalentamiento(payload.tipo);
        if (tipo !== calentamiento.solicitud) {
            acelerarPalabrasCambioSolicitudCalentamiento();
        }
        calentamiento.solicitud = tipo;
        emitirEstadoCalentamiento();
    });

    socket.on('bolzano_reiniciar_calentamiento', () => {
        iniciarCalentamientoBolzano();
    });

    socket.on('bolzano_reiniciar_marcador_calentamiento', () => {
        [1, 2].forEach((equipo) => {
            const data = bolzano_calentamiento.equipos[equipo];
            data.intentos = 0;
            data.aciertos = 0;
        });
        bolzano_emitirEstadoCalentamiento();
    });

    socket.on('activar_banderas_musas', () => {
        // Solo enviar a musas registradas en salas de equipo.
        io.to('musa_j1').emit('activar_banderas_musas');
        io.to('musa_j2').emit('activar_banderas_musas');
    });

    socket.on('calentamiento_semilla', (payload = {}) => {
        const equipo = obtenerIdJugadorValido(socket.musa);
        if (!equipo) return;
        const resultado = agregarPalabraCalentamiento(equipo, socket.id, payload.palabra);
        if (!resultado.ok) {
            socket.emit('calentamiento_error', { mensaje: resultado.mensaje || 'No se pudo enviar la palabra.' });
            return;
        }
        emitirEstadoCalentamiento();
    });

    socket.on('calentamiento_intento', (payload = {}) => {
        const equipo = obtenerIdJugadorValido(socket.musa);
        if (!equipo) return;
        const resultado = agregarPalabraCalentamiento(equipo, socket.id, payload.palabra);
        if (!resultado.ok) {
            socket.emit('calentamiento_error', { mensaje: resultado.mensaje || 'No se pudo enviar la palabra.' });
            return;
        }
        emitirEstadoCalentamiento();
    });

    socket.on('calentamiento_click_palabra', (payload = {}) => {
        const equipo = obtenerIdJugadorValido(socket.escritxr);
        if (!equipo) return;
        if (!calentamiento.activo || !calentamiento.vista) return;
        const id = typeof payload.id === 'string' ? payload.id : '';
        if (!id) return;
        const cambio = alternarPalabraDestacadaCalentamiento(equipo, id);
        if (!cambio) return;
        if (cambio.destacada && cambio.socketId) {
            io.to(cambio.socketId).emit('calentamiento_ganado', {
                equipo: cambio.equipo,
                palabra: cambio.palabra,
                id: cambio.id
            });
        }
        emitirEstadoCalentamiento();
    });

    socket.on('calentamiento_cursor', (payload = {}) => {
        const equipo = obtenerIdJugadorValido(socket.escritxr);
        if (!equipo) return;
        if (!actualizarCursorCalentamiento(equipo, payload)) return;
        io.emit('calentamiento_cursor', { equipo, ...calentamiento.cursores[equipo] });
    });

    socket.on('bolzano_calentamiento_semilla', (payload = {}) => {
        const equipo = obtenerIdJugadorValido(socket.musa_bolzano);
        if (!equipo || !bolzano_calentamiento.activo) {
            return;
        }
        const data = bolzano_calentamiento.equipos[equipo];
        if (data.estado === 'sin_musas') {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'No hay musas suficientes.' });
            return;
        }
        const posicion = Number(payload.posicion);
        if (posicion !== 1 && posicion !== 2) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Posicion invalida.' });
            return;
        }
        if (data.asignadas[posicion] !== socket.id) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'No eres musa semilla.' });
            return;
        }
        if (data.semillas[posicion]) {
            return;
        }
        const palabra = limpiarPalabra(payload.palabra);
        if (/\s/.test(palabra)) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Solo una palabra, sin espacios.' });
            return;
        }
        const normalizada = normalizarPalabra(palabra);
        if (!normalizada) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Escribe una palabra valida.' });
            return;
        }
        if (palabra.length > MAX_PALABRA_CALENTAMIENTO) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'La palabra es demasiado larga.' });
            return;
        }
        if (data.usadas.has(normalizada)) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Esa palabra ya esta usada.' });
            return;
        }
        data.semillas[posicion] = palabra;
        if (data.semillas[1] && data.semillas[2]) {
            data.semillas_ts = Date.now();
            const normalizada1 = normalizarPalabra(data.semillas[1]);
            const normalizada2 = normalizarPalabra(data.semillas[2]);
            if (normalizada1 === normalizada2) {
                bolzano_registrarHistorialCalentamiento(data, data.semillas[1], data.semillas[2], true);
                data.intentos += 1;
                data.aciertos += 1;
                data.estado = 'ganado';
                data.usadas.set(normalizada1, data.semillas[1]);
                data.pendiente = null;
                io.to(`bolzano_musa_j${equipo}`).emit('bolzano_calentamiento_ganado', {
                    equipo,
                    palabra: data.semillas[1]
                });
                bolzano_emitirEstadoCalentamiento();
                setTimeout(() => {
                    if (!bolzano_calentamiento.activo) return;
                    bolzano_reiniciarEquipoCalentamiento(equipo, true);
                    bolzano_emitirEstadoCalentamiento();
                }, 2500);
                return;
            }
            data.usadas.set(normalizada1, data.semillas[1]);
            data.usadas.set(normalizada2, data.semillas[2]);
            data.estado = 'jugando';
            data.pendiente = null;
        } else {
            data.estado = 'esperando_semillas';
        }
        bolzano_emitirEstadoCalentamiento();
    });

    socket.on('bolzano_calentamiento_intento', (payload = {}) => {
        const equipo = obtenerIdJugadorValido(socket.musa_bolzano);
        if (!equipo || !bolzano_calentamiento.activo) {
            return;
        }
        const data = bolzano_calentamiento.equipos[equipo];
        if (data.estado !== 'jugando') {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'El calentamiento no esta listo.' });
            return;
        }
        const palabra = limpiarPalabra(payload.palabra);
        if (/\s/.test(palabra)) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Solo una palabra, sin espacios.' });
            return;
        }
        const normalizada = normalizarPalabra(palabra);
        if (!normalizada) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Escribe una palabra valida.' });
            return;
        }
        if (palabra.length > MAX_PALABRA_CALENTAMIENTO) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'La palabra es demasiado larga.' });
            return;
        }
        if (data.usadas.has(normalizada)) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Esa palabra ya esta usada.' });
            return;
        }
        if (data.pendiente && data.pendiente.socketId === socket.id) {
            socket.emit('bolzano_calentamiento_error', { mensaje: 'Espera a otra musa.' });
            return;
        }
        if (!data.pendiente) {
            data.pendiente = { socketId: socket.id, palabra, normalizada };
            bolzano_emitirEstadoCalentamiento();
            return;
        }
        data.intentos += 1;
        if (data.pendiente.normalizada === normalizada) {
            data.ultimo_intento = {
                palabras: [data.pendiente.palabra, palabra],
                exito: true,
                id: Date.now(),
                ts: Date.now()
            };
            bolzano_registrarHistorialCalentamiento(data, data.pendiente.palabra, palabra, true);
            data.aciertos += 1;
            data.estado = 'ganado';
            data.usadas.set(normalizada, palabra);
            data.pendiente = null;
            io.to(`bolzano_musa_j${equipo}`).emit('bolzano_calentamiento_ganado', {
                equipo,
                palabra
            });
            bolzano_emitirEstadoCalentamiento();
            setTimeout(() => {
                if (!bolzano_calentamiento.activo) return;
                bolzano_reiniciarEquipoCalentamiento(equipo, true);
                bolzano_emitirEstadoCalentamiento();
            }, 11000);
            return;
        }
        data.ultimo_intento = {
            palabras: [data.pendiente.palabra, palabra],
            exito: false,
            id: Date.now(),
            ts: Date.now()
        };
        bolzano_registrarHistorialCalentamiento(data, data.pendiente.palabra, palabra, false);
        data.usadas.set(data.pendiente.normalizada, data.pendiente.palabra);
        data.usadas.set(normalizada, palabra);
        data.semillas[1] = data.pendiente.palabra;
        data.semillas[2] = palabra;
        data.pendiente = null;
        data.estado = 'jugando';
        bolzano_emitirEstadoCalentamiento();
    });
    // Activa sockets extratextuales.
    activar_sockets_extratextuales(socket);
    // Contador de tiempo y finalización de ronda.
    socket.on('count', (datos) => {
        registrar(datos)
        const id_jugador = obtenerIdJugadorValido(datos.player);
        if (!id_jugador) {
            return;
        }
        if(id_jugador == 1){
            estado_jugadores[1].finished = false;
            if (datos.count == "¡Tiempo!") {
                estado_jugadores[1].finished = true;;
                nueva_palabra_j1 = false;
                clearTimeout(cambio_palabra_j1);
            }
            registrar(modos_pendientes)
            registrar(modo_actual)
            registrar("TIEMPO LIMITE", TIEMPO_CAMBIO_MODOS)
        }
        if(id_jugador == 2){
            estado_jugadores[2].finished = false;;
            registrar("holaaaa", datos)
            if (datos.count == "¡Tiempo!") {
                estado_jugadores[2].finished = true;;
                nueva_palabra_j2 = false;
                clearTimeout(cambio_palabra_j2);
            }
        }
        if(fin_del_juego){
            clearInterval(id_intervalo_modos);
            LIMPIEZAS_MODO[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            modos_pendientes = [...lista_modos];
            modo_anterior = "";
            modo_actual = "";
        }
        socket.broadcast.emit('count', datos);
    });

    /*if (modo_actual == 'palabras bonus') {
        socket.on('nueva_palabra', (evt1) => {
            console.log("RECIBIDO");
            clearTimeout(cambio_palabra);
            if (terminado == false) {
                palabraRAE().then(palabra_bonus => {
                    puntuacion = puntuación_palabra(palabra_bonus[0]);
                    io.emit('enviar_palabra', { modo_actual, palabra_bonus, puntuacion });
                })
                cambiar_palabra();
            }
        });
    }*/
    
    // Inicio de partida.

    socket.on('inicio', (datos) => {
        clearInterval(id_intervalo_modos);
        regalos_pdf_musas[1] = null;
        regalos_pdf_musas[2] = null;
        io.to('musa_j1').emit('regalo_pdf_musas_reset');
        io.to('musa_j2').emit('regalo_pdf_musas_reset');
        TIEMPO_CAMBIO_PALABRAS = datos.parametros.TIEMPO_CAMBIO_PALABRAS;
        DURACION_TIEMPO_MODOS = datos.parametros.DURACION_TIEMPO_MODOS;
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        TIEMPO_BORROSO = datos.parametros.TIEMPO_BORROSO;
        PALABRAS_INSERTADAS_META = datos.parametros.PALABRAS_INSERTADAS_META;
        TIEMPO_VOTACION = datos.parametros.TIEMPO_VOTACION;
        TIEMPO_CAMBIO_LETRA = datos.parametros.TIEMPO_CAMBIO_LETRA;
        lista_modos = datos.parametros.LISTA_MODOS || datos.parametros.lista_modos || lista_modos;
        lista_modos_locura = datos.parametros.LISTA_MODOS_LOCURA || datos.parametros.lista_modos_locura || lista_modos_locura;
        modos_pendientes = [...lista_modos];
        if (!modo_bonus) modo_bonus = new PalabrasBonusMode(io, TIEMPO_CAMBIO_PALABRAS);
        if (!modo_malditas) modo_malditas = new PalabrasMalditasMode(io, TIEMPO_CAMBIO_PALABRAS);
        if (!modo_musas) modo_musas = new Musas(io, TIEMPO_CAMBIO_PALABRAS);
        actualizarTimeoutModo(modo_bonus, TIEMPO_CAMBIO_PALABRAS);
        actualizarTimeoutModo(modo_malditas, TIEMPO_CAMBIO_PALABRAS);
        actualizarTimeoutModo(modo_musas, TIEMPO_CAMBIO_PALABRAS);

        tiempos = getRanges(datos.count, lista_modos.length + 1); 
        // Los forwarders se registran una sola vez por socket.
        //socket.removeAllListeners('scroll');
        estado_jugadores[1].finished = false;;
        estado_jugadores[2].finished = false;;
        fin_del_juego = false;
        fin_j1 = false;
        fin_j2 = false;
        locura = false;
        modos_pendientes = [...lista_modos];
        indice_modo = 0
        letras_benditas_pendientes = [...letras_benditas];
        letras_prohibidas_pendientes = [...letras_prohibidas];
        modo_anterior = "";
        modo_actual = "";
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        socket.broadcast.emit('inicio', datos);
        registrar(modos_pendientes)
        modo_anterior = modo_actual;
        modo_actual = modos_pendientes[0];
        modos_pendientes.splice(0, 1);
        timeout_inicio = setTimeout(() => {
        socket.broadcast.emit('post-inicio', {borrar_texto : datos.borrar_texto});
        MODOS[modo_actual](socket);
        //repentizado()
        temp_modos();
        }, 4000);
    });

    // Resetea el tablero de juego.

    socket.on('limpiar', (evento) => {
        activar_sockets_extratextuales(socket);
        limpiarTimersPalabras();
        limpiarTimersRonda();
        estado_jugadores[1].finished = true;
        estado_jugadores[2].finished = true;
        regalos_pdf_musas[1] = null;
        regalos_pdf_musas[2] = null;
        io.to('musa_j1').emit('regalo_pdf_musas_reset');
        io.to('musa_j2').emit('regalo_pdf_musas_reset');
        limpiarTodosLosModos();
        fin_del_juego = true;
        locura = false;
        modos_pendientes = [...lista_modos];
        indice_modo = 0
        modo_anterior = "";
        modo_actual = "";
        nueva_palabra_j1 = false;
        nueva_palabra_j2 = false;
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        socket.broadcast.emit('limpiar', evento);
    });

    socket.on('borrar_texto_guardado', () => {
        io.emit('borrar_texto_guardado');
    });

    socket.on('regalo_pdf_musas', (payload = {}) => {
        const playerId = obtenerIdJugadorValido(payload && payload.player);
        if (!playerId || !payload || !payload.data) {
            return;
        }
        const salida = {
            player: playerId,
            data: payload.data,
            filename: payload.filename || `regalo_j${playerId}.pdf`
        };
        regalos_pdf_musas[playerId] = salida;
        io.to(`musa_j${playerId}`).emit('regalo_pdf_musas', salida);
    });

    socket.on('pausar', (evento) => {
        limpiarTimersPalabras();
        activar_sockets_extratextuales(socket);
        //socket.broadcast.emit('pausar_js', evento);
    });

    socket.on('fin_de_control', (player) => {
        const id_jugador = obtenerIdJugadorValido(player);
        if (!id_jugador) {
            return;
        }
        if(id_jugador == 1){
            fin_j1 = true;
            clearTimeout(cambio_palabra_j1);
            socket.broadcast.emit('fin', id_jugador);
        }
        else if(id_jugador == 2){
            fin_j2 = true;
            clearTimeout(cambio_palabra_j2);
            socket.broadcast.emit('fin', id_jugador);
        }
        clearTimeout(listener_cambio_letra);
        if(fin_j1 && fin_j2){
            reiniciarEstadoPartida(socket);
        }
    });

    socket.on('fin_de_player', (player) => {
        const id_jugador = obtenerIdJugadorValido(player);
        if (!id_jugador) {
            return;
        }
        socket.broadcast.emit('fin_de_player_a_control', id_jugador);
        if(id_jugador == 1){
            fin_j1 = true;
            clearTimeout(cambio_palabra_j1);
            socket.broadcast.emit('fin', id_jugador);
        }
        else if(id_jugador == 2){
            fin_j2 = true;
            clearTimeout(cambio_palabra_j2);
            socket.broadcast.emit('fin', id_jugador);
        }
        clearTimeout(listener_cambio_letra);
        if(fin_j1 && fin_j2){
            reiniciarEstadoPartida(socket);
        }
    });

    socket.on('enviar_atributos', (datos) => {
        if (!datos || !datos.atributos) {
            return;
        }
        const id_jugador = obtenerIdJugadorValido(datos.player);
        if (!id_jugador) {
            return;
        }
        atributos[id_jugador] = datos.atributos;
    });

    socket.on('pedir_atributos', () => {
        socket.emit('recibir_atributos', atributos);
    });

    socket.on('reanudar', (evento) => {
        if (!modo_actual) {
            return;
        }
        MODOS[modo_actual](socket);
        socket.broadcast.emit('reanudar_js', evento);
    });

    socket.on('reanudar_modo', (evento) => {
        modos_de_juego(socket);
        socket.broadcast.emit('reanudar_js', evento);
    });

    socket.on('activar_temporizador_gigante', (evento) => {
        const duracion = Number(evento?.duracion) || (10 * 60);
        io.emit('temporizador_gigante_inicio', { duracion });
    });

    socket.on('temporizador_gigante_detener', () => {
        io.emit('temporizador_gigante_detener');
    });

    socket.on('enviar_putada_a_jx', (evento) => {
        if (!evento) {
            return;
        }
        const id_jugador = obtenerIdJugadorValido(evento.player);
        if (!id_jugador) {
            return;
        }
        if(id_jugador == 1){
            socket.broadcast.emit('enviar_putada_de_j1', evento.putada);
        }
        else{
            socket.broadcast.emit('enviar_putada_de_j2', evento.putada);
        }
    });

    socket.on('enviar_feedback_modificador', (evento) => {
        if (!evento || typeof evento.id_mod !== 'string' || evento.id_mod.length === 0) {
            return;
        }
        const id_mod = evento.id_mod.substring(0, evento.id_mod.length - 1) + "2";
        const id_jugador = obtenerIdJugadorValido(evento.player);
        if (!id_jugador) {
            return;
        }
        socket.broadcast.emit('recibir_feedback_modificador', {id_mod, player: id_jugador});
    });

    socket.on('tecla_jugador', (evento) => {
        if (!evento || typeof evento.code !== 'string') {
            return;
        }
        const id_jugador = obtenerIdJugadorValido(evento.player) || socket.escritxr;
        if (!id_jugador) {
            return;
        }
        io.emit('tecla_jugador_control', {
            player: id_jugador,
            code: evento.code,
            key: evento.key || ''
        });
    });

    /*
    socket.on('limpiar_inverso', (evt1) => {
        socket.broadcast.emit('limpiar_texto_inverso', evt1);
    });

    socket.on('limpiar_psico', (evt1) => {
        socket.broadcast.emit('limpiar_psicodélico', evt1);
    });
    */

    reenviarMapeadosASala(socket, [
        ['feedback_de_j1', 'feedback_a_j2', 'j2'],
        ['feedback_de_j2', 'feedback_a_j1', 'j1'],
    ]);

    socket.on('intento_prohibido', (payload) => {
        const playerId = obtenerIdJugadorValido(payload && payload.player);
        if (!playerId) {
            return;
        }
        const salida = { ...(payload || {}), player: playerId };
        io.emit('intento_prohibido', salida);
    });
   
    /*socket.on('psico', (evt1) => {
        if (evt1 == 1){
            socket.broadcast.emit('psico_a_j2', evt1);
        }
        else{
            socket.broadcast.emit('psico_a_j1', evt1);
        }
    });*/
    
    socket.on('nueva_palabra', (id_jugador) => {
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        modo_bonus.handleRequest(id_jugador_valido);
      });

    socket.on('nueva_palabra_prohibida', (id_jugador) => {
        const id_jugador_valido = obtenerIdJugadorValido(id_jugador);
        if (!id_jugador_valido) {
            return;
        }
        modo_malditas.handleRequest(id_jugador_valido);
      });
      

// 4) Cuando el escritor pide palabra:
    socket.on('nueva_palabra_musa', escritxr => {
        const id_jugador = obtenerIdJugadorValido(escritxr);
        if (!id_jugador) {
            return;
        }
        registrar(`[socket] petición de musa para jugador ${id_jugador}`);
        modo_musas.handleRequest(id_jugador);
  });

  socket.on('nueva_palabra_bonus', ({ jugador } = {}) => {
    const id_jugador = obtenerIdJugadorValido(jugador);
    if (!id_jugador) {
        return;
    }
    modo_bonus.handleRequest(id_jugador);
  });
  
      
    // Eventos generales de interacción.
    socket.on('enviar_comentario', (evento) => {
        if (evento == null) {
            return;
        }
        io.emit('recibir_comentario', evento);
    });

    socket.on('aumentar_tiempo', (evento) => {
        if (!evento) {
            return;
        }
        const id_jugador = obtenerIdJugadorValido(evento.player);
        if (!id_jugador) {
            return;
        }
        const secs = Number(evento.secs);
        if (!Number.isFinite(secs) || secs === 0) {
            return;
        }
        // En frase final no se permite ganar tiempo (solo perderlo por inactividad).
        if (modo_actual === "frase final" && secs > 0) {
            return;
        }
        io.emit('aumentar_tiempo_control', {
            ...evento,
            player: id_jugador,
            secs
        });
    });

// 3) Añadir musa cuando llegue:
socket.on('enviar_inspiracion', (evento) => {
    const id_jugador = obtenerIdJugadorValido(socket.musa);
    if (!id_jugador) {
        return;
    }
    const datos = (evento && typeof evento === 'object') ? evento : { palabra: evento };
    const palabra = typeof datos.palabra === 'string' ? datos.palabra.trim() : '';
    if (!palabra) {
        return;
    }
    const nombre_musa = normalizarNombreMusa(datos.nombre) || socket.nombre_musa || 'MUSA';
    const payload_musa = { palabra, musa: nombre_musa };

    switch (modo_actual) {
      case 'palabras bonus':
        // En modo bonus, encola en el modo bonus.
        modo_bonus.addMusa(id_jugador, payload_musa);
        registrar(`[bonus] Se añadió musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
        break;

      case 'palabras prohibidas':
        // En modo malditas, encola en el modo malditas.
        modo_malditas.addMusa(id_jugador, payload_musa);
        registrar(`[maldita] Se añadió musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
        break;

        case 'letra bendita':
        case 'letra prohibida':
          modo_musas.addMusa(id_jugador, payload_musa);
          registrar(`[modo_musas] Se añadió musa para J${id_jugador}: "${palabra}" (${nombre_musa})`);
        break;
    }
  });
      

    socket.on('enviar_voto_ventaja', (voto) => {
        const clave = typeof voto === 'string' ? voto : '';
        if (!Object.prototype.hasOwnProperty.call(votos_ventaja, clave)) {
            return;
        }
        votos_ventaja[clave] += 1;
        if (votacion_ventaja_activa) {
            emitirEstadoVotacionVentaja();
        }
    });

    socket.on('enviar_voto_repentizado', (voto) => {
        votos_repentizado[voto] += 1;
    });

    
    socket.on('resucitar', (evento) => {
        const id_jugador = obtenerIdJugadorValido(evento && evento.player);
        const secs = Number(evento && evento.secs);
        if (!id_jugador || !Number.isFinite(secs) || secs <= 0) {
            return;
        }
        // En frase final no se permite resucitar.
        if (modo_actual === "frase final") {
            return;
        }
        io.emit('resucitar_control', { player: id_jugador, secs });
        MODOS[modo_actual](socket);
    });

    socket.on('resucitar_menu', (evento) => {
        io.emit('resucitar_menu', evento);
    });




// Temporizador principal de cambio de modos.
function temp_modos() {
    // Reinicia contador.
    segundos_transcurridos = 0;
    
    // Intervalo por segundo.
    id_intervalo_modos = setInterval(() => {
    segundos_transcurridos++;
    //console.log(`Segundos pasados: ${segundos_transcurridos}`);
    io.emit('temp_modos', {segundos_transcurridos, modo_actual});
    //console.log(modo_actual)
    //console.log(modo_anterior)
    //console.log(modos_pendientes)
      // Si alcanza la duración, avanza de modo.
      if (segundos_transcurridos >= TIEMPO_CAMBIO_MODOS) {
        if (modo_actual == "frase final") {
            return;
        } else {
            segundos_transcurridos = 0;
            LIMPIEZAS_MODO[modo_actual](socket);
            modos_de_juego(socket);
            //console.log(modo_actual)
            //console.log(modo_anterior)
            //console.log(modos_pendientes)
            //console.log(modos_pendientes.length)
            //console.log('Se alcanzó el tiempo límite. Reiniciando temporizador.');
        }
        
        // Hook opcional al reiniciar.
      }
    }, 1000);
  }

// Determina si toca lanzar la votación de ventajas/desventajas.
function debeLanzarVentaja(prev, curr, locura) {
    return (
      prev !== '' &&
      curr !== 'tertulia' &&
      prev !== 'locura' &&
      locura === false
    );
  }

// Lanza la votación para el jugador ganador y programa el timeout de envío.
function lanzarVentaja(socket, ganador, perdedor) {
  votos_ventaja = { '🐢': 0, '⚡': 0, '🌪️': 0, '🙃': 0, '🖊️': 0 };
  const opciones_ventaja = (() => {
    const emojis = Object.keys(votos_ventaja);
    for (let i = emojis.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emojis[i], emojis[j]] = [emojis[j], emojis[i]];
    }
    return emojis.slice(0, 3);
  })();
  votacion_ventaja_activa = true;
  votacion_ventaja_equipo = ganador;
  votacion_ventaja_opciones = [...opciones_ventaja];
  io.emit(`elegir_ventaja_${ganador}`, { opciones: opciones_ventaja });
  emitirEstadoVotacionVentaja();

  tiempo_voto = setTimeout(() => {
    socket.removeAllListeners('enviar_voto_ventaja');
    const seleccion = opcionConMasVotos(votos_ventaja);
    io.emit(
      `enviar_ventaja_${perdedor}`,
      seleccion
    );
    const opcionesFinal = Array.isArray(votacion_ventaja_opciones)
        ? [...votacion_ventaja_opciones]
        : [];
    const votosFinal = { ...votos_ventaja };
    votacion_ventaja_activa = false;
    emitirEstadoVotacionVentaja({
        activa: false,
        equipo: votacion_ventaja_equipo,
        opciones: opcionesFinal,
        votos: votosFinal
    });
    votacion_ventaja_equipo = "";
    votacion_ventaja_opciones = [];
    sincro_modos();
    repentizado_enviado = true;
  }, TIEMPO_VOTACION);
}

// Avanza el estado global de modos.
function modos_de_juego(socket) {
  // Si ambos han terminado, no avanzar.
  if (estado_jugadores[1].finished && estado_jugadores[2].finished) return;

  registrar('Modos restantes:', modos_pendientes.slice(indice_modo));

  // Selecciona el siguiente modo en O(1).
  const prev       = modo_actual;
  const curr       = modos_pendientes[indice_modo++] || '';
  if (!curr) {
    finalizarPartida(socket);
    return;
  }
  modo_anterior    = prev;
  modo_actual      = curr;
  registrar(`MODO ANTERIOR: ${prev} | MODO ACTUAL: ${curr}`);

  // Limpia colas y timers de todas las instancias.
  limpiarTodosLosModos();

  // Ejecuta la lógica del modo actual.
  MODOS[curr](socket);
  repentizado_enviado = false;


  // Decide si lanza ventaja/desventaja.
  registrar('DEBE LANZAR VENTAJA:', debeLanzarVentaja(prev, curr, locura));

  if (debeLanzarVentaja(prev, curr, locura)) {
    // Selecciona la instancia que lleva el conteo de este modo.
    let counterMode;
    if (prev === 'palabras bonus') {
      counterMode = modo_bonus;
    } else if (prev === 'palabras prohibidas') {
      counterMode = modo_malditas;
    } else {
      counterMode = modo_musas;
    }

    // Obtiene los contadores de J1 y J2.
    registrar(counterMode)
    let j1 = counterMode.getInsertedCount(1);
    let j2 = counterMode.getInsertedCount(2);
    registrar(`Palabras pedidas → J1: ${j1} | J2: ${j2}`);

    // Desempate aleatorio si están igualados.
    if (j1 === j2) {
      Math.random() < 0.5 ? j1++ : j2++;
    }

    // Prepara votos e inicia la votación.
    votos_ventaja = { '🐢': 0, '⚡': 0, '🌪️': 0, '🙃': 0, '🖊️': 0 };
    if (j1 > j2) {
      lanzarVentaja(socket, 'j1', 'j2');
    } else {
      lanzarVentaja(socket, 'j2', 'j1');
    }

    // Limpia los contadores de la instancia usada.
    counterMode.clearCounters();
    return;
  }

  // Caso inicial (sin prev), reservado si se necesita.
  if (
    !prev &&
    curr !== 'tertulia' &&
    curr !== 'locura' &&
    locura === false &&
    !repentizado_enviado
  ) {
    // repentizado();
  }

  registrar('Fin modos_de_juego para modo:', curr);
}
  
    const MODOS = {

        // Recibe y activa la palabra y el modo bonus.
        'palabras bonus': function () {
            io.emit('activar_modo', { modo_actual});
            registrar("activado palabras bonus");

            io.emit("pedir_inspiracion_musa", {modo_actual})
            modo_bonus.clearAll();
            modo_bonus.start(1);
            modo_bonus.start(2);
        },

        // Recibe y activa el modo letra prohibida.
        'letra prohibida': function (socket) {
            registrar("activado letra prohibida");
            indice_letra_prohibida = Math.floor(Math.random() * letras_prohibidas_pendientes.length);
            letra_prohibida = letras_prohibidas_pendientes[indice_letra_prohibida]
            letras_prohibidas_pendientes.splice(indice_letra_prohibida, 1);
            if(letras_prohibidas_pendientes.length == 0){
                letras_prohibidas_pendientes = [...letras_prohibidas];
            }
            io.emit("pedir_inspiracion_musa", {modo_actual, letra_prohibida})
            // activar_sockets_feedback();
            //letra_prohibida = letras_prohibidas[Math.floor(Math.random() * letras_prohibidas.length)]
            listener_cambio_letra = setTimeout(nueva_letra_prohibida, TIEMPO_CAMBIO_LETRA);
            modo_musas.clearAll();
            modo_musas.start(1);
            modo_musas.start(2);
            io.emit('activar_modo', { modo_actual, letra_prohibida });
        },

        // Recibe y activa el modo letra prohibida.
        'letra bendita': function (socket) {
            registrar(modo_actual);
            indice_letra_bendita = Math.floor(Math.random() * letras_benditas_pendientes.length);
            letra_bendita = letras_benditas_pendientes[indice_letra_bendita]
            letras_benditas_pendientes.splice(indice_letra_bendita, 1);
            if(letras_benditas_pendientes.length == 0){
                letras_benditas_pendientes = [...letras_benditas];
            }
            io.emit("pedir_inspiracion_musa", {modo_actual, letra_bendita})
            listener_cambio_letra = setTimeout(nueva_letra_bendita, TIEMPO_CAMBIO_LETRA);
            // activar_sockets_feedback();
            //letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]
            Object.values(estado_jugadores).forEach(s => { s.inserts = -1; s.finished = false; });
            modo_musas.clearAll();
            modo_musas.start(1);
            modo_musas.start(2);
            registrar(letra_bendita)
            io.emit('activar_modo', { modo_actual, letra_bendita });
        },

        'texto borroso': function () {
            let jugador = Math.floor(Math.random() * 2) + 1
            duracion = TIEMPO_BORROSO;
            io.emit('activar_modo', { modo_actual, jugador, duracion });
        },

        'psicodélico': function () {
            io.emit('activar_modo', { modo_actual });
        },

        'texto inverso': function () {
            io.emit('activar_modo', { modo_actual });
        },

        'tertulia': function () {
            io.emit("pedir_inspiracion_musa", {modo_actual})
            io.emit('activar_modo', { modo_actual });
            io.emit('tiempo_muerto_control', '');
                },

        'palabras prohibidas': function () {
            io.emit('activar_modo', { modo_actual});
            registrar("activado palabras prohibidas");
            // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.
            // activar_socket_nueva_palabra(socket);
            io.emit("pedir_inspiracion_musa", {modo_actual})

            modo_malditas.clearAll();
            modo_malditas.start(1);
            modo_malditas.start(2);
        },

        'locura': function (socket) {
            locura = true;
            TIEMPO_CAMBIO_MODOS = TIEMPO_LOCURA;
            io.emit('locura', { modo_actual });
            modos_de_juego(socket);
        },
        'ortografía perfecta': function (socket) {
            io.emit('activar_modo', { modo_actual});
        },

        'frase final': function (socket) {
            io.emit("pedir_inspiracion_musa", {modo_actual})
            io.emit('activar_modo', { modo_actual });
        },

        '': function () { }
    }
});

// Da retroalimentación cuando se ha conectado con el ciente.
io.on('disconnect', evt => {
registrar('Un escritxr ha abandonado la partida.');
});

function nueva_letra_bendita(){
    indice_letra_bendita = Math.floor(Math.random() * letras_benditas_pendientes.length);
    letra_bendita = letras_benditas_pendientes[indice_letra_bendita]
    letras_benditas_pendientes.splice(indice_letra_bendita, 1);
    if(letras_benditas_pendientes.length == 0){
        letras_benditas_pendientes = [...letras_benditas];
    }
    letra = letra_bendita;
    io.emit("nueva letra", letra);
    // Reinicia el modo “modo_musas” (limpia colas y timers)
    modo_musas.clearAll();
    io.emit("pedir_inspiracion_musa", {modo_actual, letra_bendita})
    // Arranca el scheduling automático de musa para cada jugador
    modo_musas.start(1);
    modo_musas.start(2);
    registrar("LETRA BENDITA", letra_bendita)
    listener_cambio_letra = setTimeout(nueva_letra_bendita, TIEMPO_CAMBIO_LETRA);
}

function nueva_letra_prohibida(){
    indice_letra_prohibida = Math.floor(Math.random() * letras_prohibidas_pendientes.length);
    letra_prohibida = letras_prohibidas_pendientes[indice_letra_prohibida]
    letras_prohibidas_pendientes.splice(indice_letra_prohibida, 1);
    if(letras_prohibidas_pendientes.length == 0){
        letras_prohibidas_pendientes = [...letras_prohibidas];
    }
    letra = letra_prohibida;
    io.emit("nueva letra", letra);
    // Reinicia el modo “modo_musas” (limpia colas y timers)
    modo_musas.clearAll();
    io.emit("pedir_inspiracion_musa", {modo_actual, letra_prohibida})
        // Arranca el scheduling automático de musa para cada jugador
        modo_musas.start(1);
        modo_musas.start(2);
    listener_cambio_letra = setTimeout(nueva_letra_prohibida, TIEMPO_CAMBIO_LETRA);

}

//Función que dadas dos horas en string devuelve los trozos en x invervalos de tiempo.
function getRanges(timeString, n) {
    // Convertimos el tiempo en segundos
    let totalTimeInSeconds = parseInt(timeString.split(":")[0]) * 60 + parseInt(timeString.split(":")[1]);
  
    // Si el número n es mayor o igual al tiempo total en segundos, devolvemos el tiempo completo
    if (n >= totalTimeInSeconds) {
      return [timeString];
    }
    const rangeDurationInSeconds = Math.ceil(totalTimeInSeconds / n);
    const ranges = ['00:00'];
    
    let start = 0;
    let end = rangeDurationInSeconds;
    
    while (end < totalTimeInSeconds) {
      ranges.push(formatTime(end));
      start = end;
      end += rangeDurationInSeconds;
    }
    
    ranges.push(formatTime(totalTimeInSeconds));
    
    return ranges;
  }
  
  function formatTime(timeInSeconds) {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return ('0' + minutes).slice(-2) + ':' + ('0' + seconds).slice(-2);
  }

  //Función auxiliar que, dados dos tiempos en string, devuelve el tiempo transcurrido en segundos.
  function diferencia_tiempo(tiempo_inicial, tiempo_final) {
    let tiempo_inicial_segundos = parseInt(tiempo_inicial.split(":")[0]) * 60 + parseInt(tiempo_inicial.split(":")[1]);
    let tiempo_final_segundos = parseInt(tiempo_final.split(":")[0]) * 60 + parseInt(tiempo_final.split(":")[1]);
    return tiempo_final_segundos - tiempo_inicial_segundos;
  }

function opcionConMasVotos(votaciones) {
    let maxVotos = -1;
    let opcionesConMaxVotos = [];

    // Crear un array con las claves del objeto votos
    let opciones = Object.keys(votaciones);

    for (let opcion of opciones) {
        if (votaciones[opcion] > maxVotos) {
            maxVotos = votaciones[opcion];
            opcionesConMaxVotos = [opcion];  // Reiniciar el array con la nueva opción de máximo voto
        } else if (votaciones[opcion] === maxVotos) {
            opcionesConMaxVotos.push(opcion);  // Añadir la opción al array de opciones con máximo voto
        }
    }

    // Si hay un empate o no se encontró una opción con votos, seleccionar una al azar
    if (opcionesConMaxVotos.length !== 1) {
        registrar("AZAR");
        let indiceAleatorio = Math.floor(Math.random() * opcionesConMaxVotos.length);
        return opcionesConMaxVotos[indiceAleatorio];
    }

    return opcionesConMaxVotos[0];
}

function sincro_modos(socket = null) {
    const emitter = socket || io; // Usa el socket si se pasa, de lo contrario, usa io.
    if(modo_actual == "letra prohibida"){
        emitter.emit('modo_actual', {modo_actual, letra_prohibida});
    }
    else if(modo_actual == "letra bendita"){
        emitter.emit('modo_actual', {modo_actual, letra_bendita});
    }
    else if(modo_actual == "palabras bonus" || modo_actual == "palabras prohibidas" || modo_actual == "tertulia" || modo_actual == "frase final"){
        emitter.emit('modo_actual', {modo_actual});
    }
}


function repentizado(){
    seleccionados = [];
    for (let i = 0; i < 3; i++) {
        indice_repentizado = Math.floor(Math.random() * repentizados_pendientes.length);
            seleccionados.push(repentizados_pendientes[indice_repentizado]);
            repentizados_pendientes.splice(indice_repentizado, 1);
            if(repentizados_pendientes.length == 0){
                repentizados_pendientes = [...repentizados];
            }
    }
    io.emit('elegir_repentizado', {seleccionados, TIEMPO_VOTACION})
                tiempo_voto = setTimeout(
                    function () {
                        io.removeAllListeners('enviar_voto_repentizado');
                        io.emit('enviar_repentizado', seleccionados[parseInt(opcionConMasVotos(votos_repentizado)) - 1]);
                        votos_repentizado = {
                            "1": 0,
                            "2": 0,
                            "3": 0
                        }
                        sincro_modos();
                    }, TIEMPO_VOTACION);
}

