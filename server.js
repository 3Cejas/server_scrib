const BonusMode = require('./palabras_bonus');
const CurseMode = require('./palabras_malditas');
const Musas = require('./musas');

const { INSPECT_MAX_BYTES } = require('buffer');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { clear } = require('console');
const https = require('https');
//require('dotenv').config();

// Variable de entorno para determinar el entorno
//const isProduction = process.env.NODE_ENV === 'production';
const isProduction = false;
let server;
let io;

console.log(process.env.NODE_ENV)
if (isProduction) {
    // Cargar certificados en entorno de producción
    const options = {
        key: fs.readFileSync('/etc/letsencrypt/live/sutura.ddns.net/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/sutura.ddns.net/fullchain.pem')
    };
    server = https.createServer(options); // Define el servidor HTTPS.
    console.log("HTTPS iniciado")
} else {
    // Usar servidor HTTP en entorno local
    server = require("http").createServer(); // Define el servidor HTTP.
    console.log("HTTP iniciado")
}

// Configurar Socket.IO con opciones de cookie y CORS
// Configurar Socket.IO con la cookie y CORS adecuados
io = require('socket.io')(server, {
    cookie: {
        name: 'io',
        // En producción: sameSite: 'none' y secure: true.
        // En desarrollo: sameSite: 'lax' y secure: false.
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction ? true : false
    },
});
const log = console.log; // Define la consola del servidor.
const port = process.env.PORT || 3000; // Define el puerto de comunicación con el servidor (puede ser o, el puerto dado por el entorno, o el 3000 si no lo encuentra).
const LIMPIEZAS = {

    'palabras bonus': function (socket) {
        
        bonusMode.clearAll();
        //socket.removeAllListeners('nueva_palabra');
        // socket.removeAllListeners('enviar_palabra');
        //socket.removeAllListeners('feedback_de_j1');
        //socket.removeAllListeners('feedback_de_j2');
    },

    'letra prohibida': function (socket) {
        // Reiniciar colas y timers
        musas.clearAll();
        // (Las colas de inspiración se rellenan con addMusa según vayan llegando)
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        letra_prohibida = "";
    },

    'letra bendita': function (socket) {
        // Reiniciar colas y timers
        musas.clearAll();
        // (Las colas de inspiración se rellenan con addMusa según vayan llegando)
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
        curseMode.clearAll();
    },

    'ortografía perfecta': function (socket) {

    },

    'locura': function (socket) { },

    'frase final': function (socket) {
        socket.broadcast.emit('fin', 1);
        socket.broadcast.emit('fin', 2);
        fin_j1 = true;
        fin_j2 = true;
        fin_del_juego = true;
        playersState[1].finished = true;
        playersState[2].finished = true;
        io.emit('fin_a_control');
    },


    '': function (socket) { }
}

let bonusMode;
let curseMode;
let musas;

let texto1 = ""; // Variable que almacena el texto del editor 1.
let texto2 = ""; // Variable que almacena el texto del editor 2.
let cambio_palabra_j1 = false; // Variable que almacena el temporizador de cambio de palabra bonus.
let cambio_palabra_j2 = false; // Variable que almacena el temporizador de cambio de palabra bonus.
let timeout_inicio = false; // Variable que almacena el temporizador de inicio de juego.
let listener_cambio_letra = false; // Variable que almacena el listener de cambio de letra.
let tiempo_voto = false;
// Estado de cada jugador para modos letra bendita/prohibida
const playersState = {
    1: { inserts: -1, finished: false },
    2: { inserts: -1, finished: false }
  };
let tiempo_modos;
let atributos = {1: {}, 2: {}};
// Variable global para almacenar los segundos transcurridos
let secondsPassed = 0;
let intervaloID_temp_modos;
// Variables del modo letra prohibida.
let modo_actual = "";
let modo_anterior = "";
// Índice global para recorrer modos_restantes sin usar shift()
let modoIndex = 0;
let letra_prohibida = "";
let letra_bendita = "";
const letras_prohibidas = ['e','a','o','s','r','n','i','d','l','c'];
const letras_benditas= ['z','j','ñ','x','k','w', 'y', 'q', 'h', 'f'];

const palabras_prohibidas = [
    "de", "la", "que", "el", "en", "y", "a", "los", "se", "del",
    "las", "un", "por", "con", "no", "una", "su", "para", "es", "al",
    "lo", "como", "más", "o", "pero", "sus", "le", "ha", "me", "si",
    "sin", "sobre", "este", "ya", "entre", "cuando", "todo", "esta", "ser", "son",
    "dos", "también", "fue", "había", "era", "muy", "años", "hasta", "desde", "está"
];

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
  

const DEFINICION_MUSA_BONUS = "<span style='color:lime;'>MUSA</span>: <span style='color: orange;'>Podrías escribir esta palabra ⬆️</span>";
const DEFINICION_MUSA_PROHIBIDA= "<span style='color:red;'>MUSA ENEMIGA</span>: <span style='color: orange;'>Podrías escribir esta palabra ⬆️</span>";

const convertirADivsASpans = repentizados.map(frase =>
    frase.replace(/<div(.*?)>/g, '<span$1>').replace(/<\/div>/g, '</span>')
);

console.log(convertirADivsASpans);


let letras_benditas_restantes = [...letras_benditas];
let letras_prohibidas_restantes = [...letras_prohibidas];
let palabras_prohibidas_restantes_j1 = [...palabras_prohibidas];
let palabras_prohibidas_restantes_j2 = [...palabras_prohibidas];
let repentizados_restantes = [...repentizados];

var tiempos = [];

//const LISTA_MODOS = ["letra bendita","letra prohibida", "tertulia", "palabras bonus", "palabras prohibidas", "tertulia", "ortografía perfecta",  "locura"];
let LISTA_MODOS = ["letra bendita","letra prohibida", "tertulia", "palabras bonus", "palabras prohibidas", "tertulia", "locura"];
let LISTA_MODOS_LOCURA = [ "letra bendita", "letra prohibida", "palabras bonus", "palabras prohibidas"];
let modos_restantes;
let escritxr1 = "";
let escritxr2 = "";
let votos_ventaja = {
    //"🐢": 0,
    "⚡": 0,
    //"⌛": 0,
    "🌪️": 0,
    "🙃": 0
}

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

// Crea un objeto para llevar la cuenta de las musas
let contador_musas = {
    escritxr1: 0,
    escritxr2: 0
  };
  

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

// Comienza a escuchar.
server.listen(port, () => log(`Servidor escuchando en el puerto: ${port}`));

io.on('connection', (socket) => {

    socket.emit('actualizar_contador_musas', contador_musas);

    socket.on('registrar_espectador', () => {
        socket.join(`j${1}`);
        socket.join(`j${2}`);
  });
    socket.on('registrar_escritor', (escritxr) => {

        const id = Number(escritxr);
        if (![1,2].includes(id)) {
          console.warn(`[server] register_escritor: id inválido (${escritxr})`);
          return;
        }
        socket.escritxr = id;
        socket.join(`j${id}`);
        console.log(`[server] socket ${socket.id} registrado como escritor ${id}`);
      });

    socket.on('registrar_musa', (musa) => {
        socket.musa = musa;
        console.log(`Una musa se ha unido a la partida para el equipo ${musa}.`);
        const id = Number(musa);
        if (![1,2].includes(id)) {
          console.log(`[server] enviar_musa: escritxr=${musa} no es escritor válido → no cuento`);
          return;
        }
        // Actualizo contador porque SÍ es una musa legítima
        if (id === 1) contador_musas.escritxr1++;
        else             contador_musas.escritxr2++;
        console.log('[server] contador_musas →', contador_musas);
        io.emit('actualizar_contador_musas', contador_musas);
  });

  socket.on('disconnect', () => {
    const id = Number(socket.musa);
    console.log(`[server] desconexión socket ${socket.id}, escritxr=${id}`);
  
    if (id === 1) {
      if (contador_musas.escritxr1 > 0) {
        contador_musas.escritxr1--;
        console.log(`[server] decrementado contador_musas.escritxr1 →`, contador_musas.escritxr1);
      }
    } 
    else if (id === 2) {
      if (contador_musas.escritxr2 > 0) {
        contador_musas.escritxr2--;
        console.log(`[server] decrementado contador_musas.escritxr2 →`, contador_musas.escritxr2);
      }
    } 
    else {
      console.log('[server] desconexión de cliente sin escritxr válido, no se modifica contador.');
    }
  
    // Emitimos siempre el estado actualizado
    io.emit('actualizar_contador_musas', contador_musas);
  });
  
    // Da retroalimentación cuando se ha conectado con el ciente.

    io.emit('nombre1', escritxr1);
    io.emit('nombre2', escritxr2);

    // Envía el texto del editor 1.

    socket.on('texto1', (evt) => {
        texto1 = evt;
        socket.broadcast.emit('texto1', evt);
    });

    // Envía el texto del editor 2.

    socket.on('texto2', (evt) => {
        texto2 = evt;
        socket.broadcast.emit('texto2', evt);
    });

    socket.on('pedir_texto', () => {
        if(socket.musa == 1){
            socket.emit('texto1', texto1);
            }
        else{
            socket.emit('texto2', texto2);
        }
    });

    socket.on('pedir_nombre', () => {
        console.log("te escucho")
        if(socket.musa == 1){
        socket.emit('dar_nombre', escritxr1);
        }
        else{
            socket.emit('dar_nombre', escritxr2);
        }
        sincro_modos(socket);
        });

    // Envía el nombre del jugador 1.

    socket.on('envío_nombre1', (nombre) => {
        escritxr1 = nombre;
        socket.broadcast.emit('nombre1', nombre);
    });

    // Envía el nombre del jugador 2.

    socket.on('envío_nombre2', (nombre) => {
        escritxr2 = nombre;
        socket.broadcast.emit('nombre2', nombre);
    });
    //activa sockets no tienen que ver con los textos.
    activar_sockets_extratextuales(socket);
    // Envía el contador de tiempo.
    socket.on('count', (data) => {
        console.log(data)
        if(data.player == 1){
            playersState[1].finished = false;
            if (data.count == "¡Tiempo!") {
                playersState[1].finished = true;;
                nueva_palabra_j1 = false;
                clearTimeout(cambio_palabra_j1);
            }
            console.log(modos_restantes)
            console.log(modo_actual)
            console.log("TIEMPO LIMITE", TIEMPO_CAMBIO_MODOS)
        }
        if(data.player == 2){
            playersState[2].finished = false;;
            console.log("holaaaa", data)
            if (data.count == "¡Tiempo!") {
                playersState[2].finished = true;;
                nueva_palabra_j2 = false;
                clearTimeout(cambio_palabra_j2);
            }
        }
        if(fin_del_juego){
            clearInterval(intervaloID_temp_modos);
            LIMPIEZAS[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            modos_restantes = [...LISTA_MODOS];
            modo_anterior = "";
            modo_actual = "";
        }
        socket.broadcast.emit('count', data);
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
    
    // Comienza el juego.

    socket.on('inicio', (data) => {
        clearInterval(intervaloID_temp_modos);
        TIEMPO_CAMBIO_PALABRAS = data.parametros.TIEMPO_CAMBIO_PALABRAS;
        DURACION_TIEMPO_MODOS = data.parametros.DURACION_TIEMPO_MODOS;
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        TIEMPO_BORROSO = data.parametros.TIEMPO_BORROSO;
        PALABRAS_INSERTADAS_META = data.parametros.PALABRAS_INSERTADAS_META;
        TIEMPO_VOTACION = data.parametros.TIEMPO_VOTACION;
        TIEMPO_CAMBIO_LETRA = data.parametros.TIEMPO_CAMBIO_LETRA;
        LISTA_MODOS = data.parametros.LISTA_MODOS;
        LISTA_MODOS_LOCURA = data.parametros.LISTA_MODOS_LOCURA;
        modos_restantes = [...LISTA_MODOS];
        bonusMode = new BonusMode(io, TIEMPO_CAMBIO_PALABRAS, palabraRAE, puntuación_palabra);
        bonusMode.initPlayer(1, []); // lista inicial de musas vacía
        bonusMode.initPlayer(2, []);
        curseMode = new CurseMode(io, TIEMPO_CAMBIO_PALABRAS, palabras_prohibidas);
        curseMode.initPlayer(1, []);
        curseMode.initPlayer(2, []);
        musas = new Musas(io, TIEMPO_CAMBIO_PALABRAS);





        tiempos = getRanges(data.count, LISTA_MODOS.length + 1); 
        socket.removeAllListeners('vote');
        socket.removeAllListeners('exit');
        socket.removeAllListeners('envia_temas');
        socket.removeAllListeners('temas');
        socket.removeAllListeners('enviar_postgame1');
        socket.removeAllListeners('enviar_postgame2');
        //socket.removeAllListeners('scroll');
        playersState[1].finished = false;;
        playersState[2].finished = false;;
        fin_del_juego = false;
        locura = false;
        modos_restantes = [...LISTA_MODOS];
        modoIndex = 0
        letras_benditas_restantes = [...letras_benditas];
        letras_prohibidas_restantes = [...letras_prohibidas];
        palabras_prohibidas_restantes_j1 = [...palabras_prohibidas];
        palabras_prohibidas_restantes_j2 = [...palabras_prohibidas];
        modo_anterior = "";
        modo_actual = "";
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        socket.broadcast.emit('inicio', data);
        console.log(modos_restantes)
        modo_anterior = modo_actual;
        modo_actual = modos_restantes[0];
        modos_restantes.splice(0, 1);
        timeout_inicio = setTimeout(() => {
        socket.broadcast.emit('post-inicio', {borrar_texto : data.borrar_texto});
        MODOS[modo_actual](socket);
        //repentizado()
        temp_modos();
        }, 10000);
    });

    // Resetea el tablero de juego.

    socket.on('limpiar', (evt1) => {
        activar_sockets_extratextuales(socket);
        clearTimeout(tiempo_voto);
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(timeout_inicio);
        clearTimeout(listener_cambio_letra);
        clearInterval(intervaloID_temp_modos);
        playersState[1].finished = true;
        playersState[2].finished = true;
        if(musas) musas.clearAll();
        fin_del_juego = true;
        locura = false;
        modos_restantes = [...LISTA_MODOS];
        modoIndex = 0
        modo_anterior = "";
        modo_actual = "";
        nueva_palabra_j1 = false;
        nueva_palabra_j2 = false;
        TIEMPO_CAMBIO_MODOS = DURACION_TIEMPO_MODOS;
        socket.broadcast.emit('limpiar', evt1);
    });

    socket.on('pausar', (evt1) => {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        activar_sockets_extratextuales(socket);
        //socket.broadcast.emit('pausar_js', evt1);
    });

    socket.on('fin_de_control', (player) => {
        if(player == 1){
            fin_j1 = true;
            clearTimeout(cambio_palabra_j1);
            socket.broadcast.emit('fin', player);
        }
        else if(player == 2){
            fin_j2 = true;
            clearTimeout(cambio_palabra_j2);
            socket.broadcast.emit('fin', player);
        }
        clearTimeout(listener_cambio_letra);
        if(fin_j1 && fin_j2){
            fin_j1 = false;
            fin_j2 = false;
            playersState[1].finished = true;;
            playersState[2].finished = true;;
            fin_del_juego = true;
            clearTimeout(tiempo_voto);
            fin_del_juego = true;
            clearInterval(intervaloID_temp_modos);
            LIMPIEZAS[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            modos_restantes = [...LISTA_MODOS];
            modo_anterior = "";
            modo_actual = "";
        }
    });

    socket.on('fin_de_player', (player) => {
        socket.broadcast.emit('fin_de_player_a_control', player);
        if(player == 1){
            fin_j1 = true;
            clearTimeout(cambio_palabra_j1);
            socket.broadcast.emit('fin', player);
        }
        else if(player == 2){
            fin_j2 = true;
            clearTimeout(cambio_palabra_j2);
            socket.broadcast.emit('fin', player);
        }
        clearTimeout(listener_cambio_letra);
        if(fin_j1 && fin_j2){
            fin_j1 = false;
            fin_j2 = false;
            playersState[1].finished = true;;
            playersState[2].finished = true;;
            fin_del_juego = true;
            clearTimeout(tiempo_voto);
            fin_del_juego = true;
            clearInterval(intervaloID_temp_modos);
            LIMPIEZAS[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            modos_restantes = [...LISTA_MODOS];
            modo_anterior = "";
            modo_actual = "";
        }
    });

    socket.on('enviar_atributos', (data) => {
        atributos[data.player] = data.atributos;
    });

    socket.on('pedir_atributos', () => {
        socket.emit('recibir_atributos', atributos);
    });

    socket.on('tiempo_muerto_a_control', (evt1) => {
        socket.broadcast.emit('tiempo_muerto_control', '');
    });

    socket.on('reanudar', (evt1) => {
        if(modo_actual != ""){
        MODOS[modo_actual](socket);
        }
        socket.broadcast.emit('reanudar_js', evt1);
    });


    socket.on('tiempo_muerto_a_control', (evt1) => {
        socket.broadcast.emit('tiempo_muerto_control', '');
    });

    socket.on('reanudar', (evt1) => {
        if(modo_actual != ""){
        MODOS[modo_actual](socket);
        }
        socket.broadcast.emit('reanudar_js', evt1);
    });

    socket.on('reanudar_modo', (evt1) => {
        modos_de_juego(socket);
        socket.broadcast.emit('reanudar_js', evt1);
    });

    socket.on('enviar_putada_a_jx', (evt1) => {
        if(evt1.player == 1){
            socket.broadcast.emit('enviar_putada_de_j1', evt1.putada);
        }
        else{
            socket.broadcast.emit('enviar_putada_de_j2', evt1.putada);
        }
    });

    socket.on('enviar_feedback_modificador', (evt1) => {
        id_mod = evt1.id_mod.substring(0, evt1.id_mod.length - 1) + "2";
        player = evt1.player
        socket.broadcast.emit('recibir_feedback_modificador', {id_mod, player});
    });

    /*
    socket.on('limpiar_inverso', (evt1) => {
        socket.broadcast.emit('limpiar_texto_inverso', evt1);
    });

    socket.on('limpiar_psico', (evt1) => {
        socket.broadcast.emit('limpiar_psicodélico', evt1);
    });
    */

    socket.on('feedback_de_j1', (evt1) => {
        io.emit('feedback_a_j2', evt1);
    });

    socket.on('feedback_de_j2', (evt1) => {
        io.emit('feedback_a_j1', evt1);
    });
   
    /*socket.on('psico', (evt1) => {
        if (evt1 == 1){
            socket.broadcast.emit('psico_a_j2', evt1);
        }
        else{
            socket.broadcast.emit('psico_a_j1', evt1);
        }
    });*/
    
    socket.on('nueva_palabra', (playerId) => {
        bonusMode.handleRequest(Number(playerId));
      });

    socket.on('nueva_palabra_prohibida', (playerId) => {
        curseMode.handleRequest(Number(playerId));
      });
      

// 4) Cuando el escritor pida palabra:
socket.on('nueva_palabra_musa', escritxr => {
    const playerId = Number(escritxr);
    console.log(`[socket] petición de musa para jugador ${playerId}`);
    musas.handleRequest(playerId);
  });
  
      
    // Envía un comentario.
    socket.on('enviar_comentario', (evt1) => {
        io.emit('recibir_comentario', evt1);
    });

    socket.on('aumentar_tiempo', (evt1) => {
        io.emit('aumentar_tiempo_control', evt1);
    });

// 3) Añadir musa cuando llegue:
socket.on('enviar_inspiracion', palabra => {
    const playerId = Number(socket.musa);
    if (modo_actual.startsWith('letra ')) {
      musas.addMusa(playerId, palabra);
    }
  });
      

    socket.on('enviar_voto_ventaja', (voto) => {
        votos_ventaja[voto] += 1;
    });

    socket.on('enviar_voto_repentizado', (voto) => {
        votos_repentizado[voto] += 1;
    });

    
    socket.on('resucitar', (evt1) => {
        io.emit('resucitar_control', evt1);
        MODOS[modo_actual](socket);
    });




// Función que inicia el temporizador para una duración determinada
function temp_modos() {
    // Reiniciar la variable de contador
    secondsPassed = 0;
    
    // Crear un intervalo que se ejecute cada segundo (1000 ms)
    intervaloID_temp_modos = setInterval(() => {
    secondsPassed++;  // Incrementar el contador cada segundo
    //console.log(`Segundos pasados: ${secondsPassed}`);
    io.emit('temp_modos', {secondsPassed, modo_actual});
    //console.log(modo_actual)
    //console.log(modo_anterior)
    //console.log(modos_restantes)
      // Verificar si se alcanzó la duración deseada y reiniciar
      if (secondsPassed >= TIEMPO_CAMBIO_MODOS) {
        if(modo_actual == "frase final"){
            fin_del_juego = true;
            clearInterval(intervaloID_temp_modos);
            LIMPIEZAS[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            modos_restantes = [...LISTA_MODOS];
            modo_anterior = "";
            modo_actual = "";
        }
        else{
        secondsPassed = 0;  // Reiniciar el contador a 0
        LIMPIEZAS[modo_actual](socket);
        modos_de_juego(socket);
        //console.log(modo_actual)
        //console.log(modo_anterior)
        //console.log(modos_restantes)
        //console.log(modos_restantes.length)
        //console.log('Se alcanzó el tiempo límite. Reiniciando temporizador.');
        }
        
        // Si se requiere alguna acción adicional al reiniciar, colócala aquí
      }
    }, 1000);
  }

/**
 * Determina si toca lanzar la votación de ventajas/desventajas.
 */
function debeLanzarVentaja(prev, curr, locura) {
    return (
      prev !== ''          &&  // prev no ha de ser la cadena vacía
      curr !== 'tertulia'  &&  // curr no puede ser tertulia
      prev !== 'locura'    &&  // prev no puede haber sido locura
      locura === false        // no estar en estado locura
    );
  }

/**
 * Lanza la votación para el jugador ganador y programa el timeout de envío.
 */
function lanzarVentaja(socket, ganador, perdedor) {
  votos_ventaja = { '⚡': 0, '🌪️': 0, '🙃': 0 };
  io.emit(`elegir_ventaja_${ganador}`);

  tiempo_voto = setTimeout(() => {
    socket.removeAllListeners('enviar_voto_ventaja');
    io.emit(
      `enviar_ventaja_${perdedor}`,
      opcionConMasVotos(votos_ventaja)
    );
    sincro_modos();
    repentizado_enviado = true;
  }, TIEMPO_VOTACION);
}

/**
 * Bloque principal que avanza de modo:
 */
function modos_de_juego(socket) {
  // 1) si ambos han terminado, salimos
  if (playersState[1].finished && playersState[2].finished) return;

  console.log('Modos restantes:', modos_restantes.slice(modoIndex));

  // 2) seleccionamos siguiente modo en O(1) con un índice
  const prev = modo_actual;
  const curr = modos_restantes[modoIndex++] || '';
  modo_anterior = prev;
  modo_actual   = curr;
  console.log(`MODO ANTERIOR: ${prev} | MODO ACTUAL: ${curr}`);

  // ── BLOQUE “MUSAS” ───────────────────────────────────────
  musas.clearAll();    // <<-- solo limpia colas y timers, NO toca los contadores
  MODOS[curr](socket);              // ejecuta la lógica del modo
  repentizado_enviado = false;      // resetea flag
  // ─────────────────────────────────────────────────────────


  // 3) decidir si lanzar ventaja/desventaja
  console.log("DEBE LANZAR VENTAJA:", debeLanzarVentaja(prev, curr, locura))
  if (debeLanzarVentaja(prev, curr, locura)) {
    let j1 = musas.getInsertedCount(1);
    let j2 = musas.getInsertedCount(2);
    console.log(`Palabras de musas introducidas → J1: ${j1} | J2: ${j2}`);

    // desempate aleatorio
    if (j1 === j2) {
      Math.random() < 0.5 ? j1++ : j2++;
    }
    if (j1 > j2)         lanzarVentaja(socket, 'j1', 'j2');
    else /* j2 >= j1 */  lanzarVentaja(socket, 'j2', 'j1');
    musas.clearCounters();
    return;  // ya hemos programado la votación, salimos
  }

  // 4) caso inicial (sin prev) si lo necesitas
  if (
    !prev &&
    curr !== 'tertulia' &&
    curr !== 'locura' &&
    locura === false &&
    !repentizado_enviado
  ) {
    // repentizado();  // si toca, lo lanzas aquí
  }

  console.log('Fin modos_de_juego para modo:', curr);
}

  

    function activar_sockets_extratextuales(socket) {

        // Abre la pestaña de la votación.
        socket.on('vote', (evt1) => {
            socket.broadcast.emit('vote', evt1);
        });

        // Cierra la pestaña de votación.
        socket.on('exit', (evt1) => {
            socket.broadcast.emit('exit', evt1);
        });

        /* 
            Envía los temas elegidos aleatoriamente
            Para que también aparezcan en la pantalla
            del jugador 2. 
        */
        socket.on('envia_temas', (evt1) => {
            socket.broadcast.emit('recibe_temas', evt1);
        });

        // Envía la lista de temas y elige aleatoriamente uno de ellos.
        socket.on('temas', (evt1) => {
            socket.broadcast.emit('temas_espectador', evt1);
        });

        // Realiza el scroll.
        socket.on('scroll', (evt1) => {
            socket.broadcast.emit('scroll', evt1);
        });

        socket.on('scroll_sincro', (evt1) => {
            socket.broadcast.emit('scroll_sincro', evt1);
        });

        socket.on('impro', (evt1) => {
            socket.broadcast.emit('impro', evt1);
        });

        socket.on('enviar_postgame1', (evt1) => {
            io.emit('recibir_postgame2', evt1);
        });
        socket.on('enviar_postgame2', (evt1) => {
            io.emit('recibir_postgame1', evt1);
        });
    }

    //Función auxiliar recursiva que elige palabras bonus, las envía a jugador 1 y 2 y las cambia cada x segundos.
    function cambiar_palabra(escritxr) {
        console.log("TEMP CAMBOO",escritxr)
        if (!(playersState[1].finished && playersState[2].finished) && modo_actual != "palabras bonus") {
            clearTimeout(cambio_palabra_j1);
            clearTimeout(cambio_palabra_j2);
        }
            if(escritxr==1 && playersState[1].finished == false){
            clearTimeout(cambio_palabra_j1);
            cambio_palabra_j1 = setTimeout(
                function () {
                    if(inspiracion_musas_j1.length > 0){
                        console.log("PALABRA BONUS DE MUSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
                        indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                        palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [DEFINICION_MUSA_BONUS]];
                        inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                        palabras_var = palabra_bonus[0];
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        palabras_var = palabra_bonus[0];
                        io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                    else{
                    console.log("AQUI, AMOR", inspiracion_musas_j1)
                    palabraRAE().then(palabra_bonus => {
                        console.log(palabra_bonus)
                        palabras_var = palabra_bonus[0];
                        palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        if(inspiracion_musas_j1.length == 0){
                            console.log("ENVIO A J1: ", { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus })
                            io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                        }
                    })
                    }
                    cambiar_palabra(1);
                }, TIEMPO_CAMBIO_PALABRAS);
            }
            else if(escritxr==2 && playersState[2].finished == false){
            console.log("NO ME AFECTA")
            clearTimeout(cambio_palabra_j2);
            cambio_palabra_j2 = setTimeout(
                function () {
                        if(inspiracion_musas_j2.length > 0){
                        indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                        palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [DEFINICION_MUSA_BONUS]];
                        inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                        palabras_var = palabra_bonus[0];
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        palabras_var = palabra_bonus[0];
                        io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                    else{
                    console.log("AQUI, AMOR", inspiracion_musas_j2)
                    palabraRAE().then(palabra_bonus => {
                        palabras_var = palabra_bonus[0];
                        palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        if(inspiracion_musas_j2.length == 0){
                            io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                        }
                    })
                    }
                    cambiar_palabra(2);
                }, TIEMPO_CAMBIO_PALABRAS);
            }
    }

//Función auxiliar recursiva que elige palabras bonus, las envía a jugador 1 y 2 y las cambia cada x segundos.
function cambiar_palabra_prohibida(escritxr) {
    console.log("TEMP CAMBOO",escritxr)
    if (!(playersState[1].finished && playersState[2].finished) && modo_actual != "palabras prohibidas") {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
    }
        if(escritxr==2 && playersState[1].finished == false){
        clearTimeout(cambio_palabra_j2);
        cambio_palabra_j2 = setTimeout(
            function () {
                console.log("ESTA FUNCIONANDO$$$$$")
                if(inspiracion_musas_j1.length > 0){
                    console.log("PALABRA BONUS DE MUSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
                    indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                    palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [DEFINICION_MUSA_PROHIBIDA]];
                    inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                }
                else{
                    indice_palabra_j1 = Math.floor(Math.random() * palabras_prohibidas_restantes_j1.length);
                    palabra_bonus = [[palabras_prohibidas_restantes_j1[indice_palabra_j1]], [DEFINICION_MUSA_PROHIBIDA]];
                    palabras_prohibidas_restantes_j1.splice(indice_palabra_j1, 1);
                    if(palabras_prohibidas_restantes_j1.length == 0){
                        palabras_prohibidas_restantes_j1 = [...palabras_prohibidas];
                    }
                    palabras_var = palabra_bonus[0];
                    console.log(palabra_bonus)
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    console.log("AQUI, AMOR", inspiracion_musas_j1)
                    if(inspiracion_musas_j1.length == 0){
                        io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                }
                cambiar_palabra_prohibida(2);
            }, TIEMPO_CAMBIO_PALABRAS);
        }
        else if(escritxr==1 && playersState[2].finished == false){
        console.log("NO ME AFECTA")
        clearTimeout(cambio_palabra_j1);
        cambio_palabra_j1 = setTimeout(
            function () {
                if(inspiracion_musas_j2.length > 0){
                    console.log("ESTA FUNCIONANDO$$$$$")
                    indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                    palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [DEFINICION_MUSA_PROHIBIDA]];
                    inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                }
                else{
                    indice_palabra_j2 = Math.floor(Math.random() * palabras_prohibidas_restantes_j2.length);
                    palabra_bonus = [[palabras_prohibidas_restantes_j2[indice_palabra_j2]], [""]];
                    palabras_prohibidas_restantes_j2.splice(indice_palabra_j2, 1);
                    if(palabras_prohibidas_restantes_j2.length == 0){
                        palabras_prohibidas_restantes_j2 = [...palabras_prohibidas];
                    }
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    console.log("AQUI, AMOR", inspiracion_musas_j2)
                    if(inspiracion_musas_j2.length == 0){
                        io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                }
                cambiar_palabra_prohibida(1);
            }, TIEMPO_CAMBIO_PALABRAS);
        }
}

    const MODOS = {

        // Recibe y activa la palabra y el modo bonus.
        'palabras bonus': function () {
            io.emit('activar_modo', { modo_actual});
            log("activado palabras bonus");

            io.emit("pedir_inspiracion_musa", {modo_actual})

            bonusMode.start(1);
            bonusMode.start(2);
        },

        // Recibe y activa el modo letra prohibida.
        'letra prohibida': function (socket) {
            log("activado letra prohibida");
            indice_letra_prohibida = Math.floor(Math.random() * letras_prohibidas_restantes.length);
            letra_prohibida = letras_prohibidas_restantes[indice_letra_prohibida]
            letras_prohibidas_restantes.splice(indice_letra_prohibida, 1);
            if(letras_prohibidas_restantes.length == 0){
                letras_prohibidas_restantes = [...letras_prohibidas];
            }
            io.emit("pedir_inspiracion_musa", {modo_actual, letra_prohibida})
            // activar_sockets_feedback();
            //letra_prohibida = letras_prohibidas[Math.floor(Math.random() * letras_prohibidas.length)]
            listener_cambio_letra = setTimeout(nueva_letra_prohibida, TIEMPO_CAMBIO_LETRA);
            musas.clearAll();
            musas.start(1);
            musas.start(2);
            io.emit('activar_modo', { modo_actual, letra_prohibida });
        },

        // Recibe y activa el modo letra prohibida.
        'letra bendita': function (socket) {
            log(modo_actual);
            indice_letra_bendita = Math.floor(Math.random() * letras_benditas_restantes.length);
            letra_bendita = letras_benditas_restantes[indice_letra_bendita]
            letras_benditas_restantes.splice(indice_letra_bendita, 1);
            if(letras_benditas_restantes.length == 0){
                letras_benditas_restantes = [...letras_benditas];
            }
            io.emit("pedir_inspiracion_musa", {modo_actual, letra_bendita})
            listener_cambio_letra = setTimeout(nueva_letra_bendita, TIEMPO_CAMBIO_LETRA);
            // activar_sockets_feedback();
            //letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]
            Object.values(playersState).forEach(s => { s.inserts = -1; s.finished = false; });
            musas.clearAll();
            musas.start(1);
            musas.start(2);
            log(letra_bendita)
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
            log("activado palabras prohibidas");
            // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.
            // activar_socket_nueva_palabra(socket);
            io.emit("pedir_inspiracion_musa", {modo_actual})

            curseMode.start(1);
            curseMode.start(2);
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

    // Función auxiliar que dada una palabra devuelve una puntación de respecto de la frecuencia.
    function puntuación_palabra(palabra) {
        palabra = palabra.toLowerCase();
        let puntuación = 0;
        if (palabra != null) {
            palabra = palabra.replace(/\s+/g, '')
            let longitud = palabra.length;
            string_unico(toNormalForm(palabra)).split("").forEach(letra => puntuación += frecuencia_letras[letra]);
            puntuación = Math.ceil((((10 - puntuación*0.5) + longitud * 0.1 * 30)) / 5) * 5
            if(isNaN(puntuación)){
                puntuación = 10;
            }
            return puntuación;
        }
        else return 10;
    }

    function string_unico(names) {
        string = "";
        ss = "";
        namestring = names.split("");

        for (j = 0; j < namestring.length; j++) {
            for (i = j; i < namestring.length; i++) {
                if (string.includes(namestring[i])) // if contains not work then  
                    break;                          // use includes like in snippet
                else
                    string += namestring[i];
            }
            if (ss.length < string.length)
                ss = string;
            string = "";
        }
        return ss;
    }

    function toNormalForm(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
});

// Da retroalimentación cuando se ha conectado con el ciente.
io.on('disconnect', evt => {
    log('Un escritxr ha abandonado la partida.');
});

function nueva_letra_bendita(){
    indice_letra_bendita = Math.floor(Math.random() * letras_benditas_restantes.length);
    letra_bendita = letras_benditas_restantes[indice_letra_bendita]
    letras_benditas_restantes.splice(indice_letra_bendita, 1);
    if(letras_benditas_restantes.length == 0){
        letras_benditas_restantes = [...letras_benditas];
    }
    letra = letra_bendita;
    io.emit("nueva letra", letra);
    // Reinicia el modo “musas” (limpia colas y timers)
    musas.clearAll();
    io.emit("pedir_inspiracion_musa", {modo_actual, letra_bendita})
    // Arranca el scheduling automático de musa para cada jugador
    musas.start(1);
    musas.start(2);
    console.log("LETRA BENDITA", letra_bendita)
    listener_cambio_letra = setTimeout(nueva_letra_bendita, TIEMPO_CAMBIO_LETRA);
}

function nueva_letra_prohibida(){
    indice_letra_prohibida = Math.floor(Math.random() * letras_prohibidas_restantes.length);
    letra_prohibida = letras_prohibidas_restantes[indice_letra_prohibida]
    letras_prohibidas_restantes.splice(indice_letra_prohibida, 1);
    if(letras_prohibidas_restantes.length == 0){
        letras_prohibidas_restantes = [...letras_prohibidas];
    }
    letra = letra_prohibida;
    io.emit("nueva letra", letra);
    // Reinicia el modo “musas” (limpia colas y timers)
    musas.clearAll();
    io.emit("pedir_inspiracion_musa", {modo_actual, letra_prohibida})
        // Arranca el scheduling automático de musa para cada jugador
        musas.start(1);
        musas.start(2);
    listener_cambio_letra = setTimeout(nueva_letra_prohibida, TIEMPO_CAMBIO_LETRA);

}

/******************************************************
 * rae-scrapper.js
 * ----------------------------------------------------
 * No reutiliza la misma pestaña:
 *  - Cada búsqueda usa un contexto de incógnito (ahora se
 *    llama createBrowserContext() en las versiones nuevas
 *    de Puppeteer).
 *  - Evita que la RAE almacene cookies/session y devuelva
 *    la misma palabra.
 ******************************************************/

let navegador = null;

/**
 * Inicializa el navegador (una sola vez).
 */
async function inicializarNavegador() {
  if (!navegador) {
    // Lanza un navegador (headless por defecto).
    // Asegúrate de usar puppeteer (no puppeteer-core),
    // o de indicar un executablePath si fuera necesario.
    navegador = await puppeteer.launch({
      headless: true,
    });
  }
}

/**
 * Cierra el navegador si está abierto (opcional).
 */
async function cerrarNavegador() {
  if (navegador) {
    await navegador.close();
    navegador = null;
  }
}

/**
 * Crea un contexto de incógnito usando createBrowserContext()
 * (nueva API en versiones recientes de Puppeteer),
 * abre una pestaña dentro de ese contexto, navega a la RAE y
 * obtiene la palabra aleatoria y su primera definición.
 *
 * @returns {Promise<{ palabra: string, definicion: string }>}
 */
// Variable global para guardar la palabra y definición
// Inicialmente vacía, representada con null o un array vacío.
let palabra_buscada = null;

async function palabraRAE() {
    // Inicializamos el navegador si aún no se ha hecho
    if (!navegador) {
      await inicializarNavegador();
    }
  
    // Bucle infinito que reintenta la operación hasta obtener una palabra válida
    while (true) {
      try {
        // Si no hay palabra buscada previamente, procedemos a obtener una nueva
        if (!palabra_buscada) {
          // 1) Creamos un contexto de incógnito para aislar la sesión
          const contexto = await navegador.createBrowserContext();
          // 2) Abrimos una nueva pestaña en este contexto
          const page = await contexto.newPage();
          try {
            // Opcional: establecemos el user agent y el viewport para emular un navegador real
            await page.setUserAgent(
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
            );
            await page.setViewport({ width: 1366, height: 768 });
  
            // 3) Navegamos a la URL que devuelve una palabra aleatoria
            await page.goto('https://dle.rae.es/?m=random2', {
              waitUntil: 'networkidle2',
            });
  
            // 4) Esperamos el botón “Consultar” y simulamos un clic
            await page.waitForSelector('button[aria-label="Consultar"]', {
              visible: true,
              timeout: 30000,
            });
            await page.click('button[aria-label="Consultar"]');
  
            // 5) Esperamos la navegación que carga la palabra nueva
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
  
            // 6) Extraemos la palabra; en caso de fallo se asigna "No encontrada"
            let palabra = 'No encontrada';
            try {
              palabra = await page.$eval('h1.c-page-header__title', (el) =>
                el.textContent.trim()
              );
            } catch {
              // Se mantiene "No encontrada" en caso de error al extraer la palabra
            }
  
            // 7) Extraemos la definición; en caso de fallo se asigna "Definición no encontrada"
            let definicion = 'Definición no encontrada';
            try {
              definicion = await page.$eval(
                'ol.c-definitions li.j div.c-definitions__item > div',
                (el) => el.textContent.trim()
              );
            } catch {
              // Se mantiene "Definición no encontrada" en caso de error al extraer la definición
            }
  
            // Almacenamos la palabra y su definición en la variable global
            palabra_buscada = [palabra, definicion];
          } finally {
            // 8) Cerramos la pestaña y el contexto para liberar recursos
            await page.close();
            await contexto.close();
          }
        }
  
        // Guardamos el resultado obtenido y reiniciamos la variable para la próxima búsqueda
        const resultado = palabra_buscada;
        palabra_buscada = null;
  
        // Validamos que la palabra extraída sea válida (diferente de "No encontrada")
        if (resultado[0] && resultado[0] !== 'No encontrada') {
          // Se retorna el resultado cuando la palabra es válida
          return resultado;
        } else {
          // Si no se obtuvo una palabra válida, se lanza un error para activar el reintento
          throw new Error('Palabra no encontrada, reintentando.');
        }
      } catch (error) {
        // Se registra el error en consola y se espera 1 segundo antes de reintentar,
        // evitando sobrecargar el servidor
        console.error('Error en palabraRAE, reintentando:', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Se continúa el bucle para reintentar
      }
    }
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

// Función para determinar si una vocal está acentuada
function esVocalAcentuada(vocal) {
    const vocalesAcentuadas = "áéíóú";
    return vocalesAcentuadas.includes(vocal);
}

// Función para remover el acento de una vocal
function removerAcento(vocal) {
    const correspondencia = {'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u'};
    return correspondencia[vocal] || vocal;
}

// Función para extracción y modificación de palabras según la terminación especificada
function extraccion_palabra_var(palabra_var) {
    console.log(palabra_var,"HOLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    if (palabra_var == null) return [""];
    let palabra_var_lista = palabra_var.split(", ");
    let palabra = palabra_var_lista[0];
    
    if (palabra_var_lista.length > 1) {
        let terminacion = palabra_var_lista[1];
        let index = palabra.length - 1;
        
        if (terminacion.length != 1) {
            while (index >= 0 && palabra.charAt(index) !== terminacion.charAt(0)) {
                index--;
            }
        } else {
            while (index >= 0 && !esVocal(palabra.charAt(index))) {
                index--;
            }
        }

        // Calcular la base de la palabra para la nueva terminación
        let basePalabra = palabra.slice(0, index);
        let palabraFinal = palabra; // Inicialmente igual a la palabra original

        if (index > 0 && esVocalAcentuada(basePalabra.charAt(index - 1))) {
            // Si la última vocal antes de la terminación es acentuada, remover el acento para la nueva palabra
            let parteSinAcento = basePalabra.slice(0, index - 1) + removerAcento(basePalabra.charAt(index - 1));
            palabraFinal = parteSinAcento + palabra.slice(index);
        }

        return [palabra, palabraFinal.slice(0, index) + terminacion];
    } else return [palabra];
}

// Función para determinar si un carácter es una vocal (no considera acentos)
function esVocal(caracter) {
    const vocales = "aeiouAEIOU";
    return vocales.includes(caracter);
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
        console.log("AZAR");
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
        indice_repentizado = Math.floor(Math.random() * repentizados_restantes.length);
            seleccionados.push(repentizados_restantes[indice_repentizado]);
            repentizados_restantes.splice(indice_repentizado, 1);
            if(repentizados_restantes.length == 0){
                repentizados_restantes = [...repentizados];
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
