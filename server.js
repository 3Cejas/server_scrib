const Musas = require('./musas');
const PalabrasBonusMode = require('./palabras_bonus.js');
const PalabrasMalditasMode= require('./palabras_malditas.js');

const { INSPECT_MAX_BYTES } = require('buffer');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { clear, count } = require('console');
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

let bonusmode = new PalabrasBonusMode(io, 300000);
let malditasmode = new PalabrasMalditasMode(io, 30000);
let musas = new Musas(io, 30000);
const log = console.log; // Define la consola del servidor.
const port = process.env.PORT || 3000; // Define el puerto de comunicación con el servidor (puede ser o, el puerto dado por el entorno, o el 3000 si no lo encuentra).
const LIMPIEZAS = {

    'palabras bonus': function (socket) {
        
        bonusmode.clearAll();
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
        malditasmode.clearAll();
    },

    'ortografía perfecta': function (socket) {

    },

    'locura': function (socket) { },

    'frase final': function (socket) {
        //socket.broadcast.emit('fin', 1);
        //socket.broadcast.emit('fin', 2);
        fin_j1 = true;
        fin_j2 = true;
        fin_del_juego = true;
        playersState[1].finished = true;
        playersState[2].finished = true;
        //io.emit('fin_a_control');
    },


    '': function (socket) { }
}



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
        bonusmode = new PalabrasBonusMode(io, TIEMPO_CAMBIO_PALABRAS);
        malditasmode = new PalabrasMalditasMode(io, TIEMPO_CAMBIO_PALABRAS);
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
        fin_j1 = false;
        fin_j2 = false;
        locura = false;
        modos_restantes = [...LISTA_MODOS];
        modoIndex = 0
        letras_benditas_restantes = [...letras_benditas];
        letras_prohibidas_restantes = [...letras_prohibidas];
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
        if(bonusmode) bonusmode.clearAll();
        console.log(malditasmode)
        if(malditasmode) malditasmode.clearAll();
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
        bonusmode.handleRequest(Number(playerId));
      });

    socket.on('nueva_palabra_prohibida', (playerId) => {
        malditasmode.handleRequest(playerId);
      });
      

// 4) Cuando el escritor pida palabra:
socket.on('nueva_palabra_musa', escritxr => {
    const playerId = Number(escritxr);
    console.log(`[socket] petición de musa para jugador ${playerId}`);
    musas.handleRequest(playerId);
  });

  socket.on('nueva_palabra_bonus', ({ jugador }) => {
    bonusmode.handleRequest(jugador);
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
    const playerId = Number(socket.musa); // suponiendo que lo guardas así

    switch (modo_actual) {
      case 'palabras bonus':
        // Si estamos en bonus, encolas en bonusMode
        bonusmode.addMusa(playerId, palabra);
        console.log(`[bonus] Se añadió musa para J${playerId}: "${palabra}"`);
        break;

      case 'palabras prohibidas':
        // En modo malditas, encolas en malditasMode
        malditasmode.addMusa(playerId, palabra);
        console.log(`[maldita] Se añadió musa para J${playerId}: "${palabra}"`);
        break;

        case 'letra bendita':
        case 'letra prohibida':
          musas.addMusa(playerId, palabra);
          console.log(`[musas] Se añadió musa para J${playerId}: "${palabra}"`);
        break;
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
  const prev       = modo_actual;
  const curr       = modos_restantes[modoIndex++] || '';
  modo_anterior    = prev;
  modo_actual      = curr;
  console.log(`MODO ANTERIOR: ${prev} | MODO ACTUAL: ${curr}`);

  // ── BLOQUE “MUSAS” ───────────────────────────────────────
  // limpiamos colas y timers de **todas** las instancias
  musas.clearAll();
  bonusmode.clearAll();
  malditasmode.clearAll();

  // lanzamos la lógica del modo actual
  MODOS[curr](socket);
  repentizado_enviado = false;      // resetea flag
  // ─────────────────────────────────────────────────────────


  // 3) decidir si lanzar ventaja/desventaja
  console.log('DEBE LANZAR VENTAJA:', debeLanzarVentaja(prev, curr, locura));

  if (debeLanzarVentaja(prev, curr, locura)) {
    // elegimos la instancia que lleva el conteo en este modo
    let counterMode;
    if (prev === 'palabras bonus') {
      counterMode = bonusmode;
    } else if (prev === 'palabras prohibidas') {
      counterMode = malditasmode;
    } else {
      counterMode = musas;
    }

    // obtenemos los contadores de J1 y J2
    console.log(counterMode)
    let j1 = counterMode.getInsertedCount(1);
    let j2 = counterMode.getInsertedCount(2);
    console.log(`Palabras pedidas → J1: ${j1} | J2: ${j2}`);

    // desempate aleatorio si están igualados
    if (j1 === j2) {
      Math.random() < 0.5 ? j1++ : j2++;
    }

    // preparamos votos e iniciamos la votación
    votos_ventaja = { '⚡': 0, '🌪️': 0, '🙃': 0 };
    if (j1 > j2) {
      lanzarVentaja(socket, 'j1', 'j2');
    } else {
      lanzarVentaja(socket, 'j2', 'j1');
    }

    // limpiamos los contadores de la instancia usada
    counterMode.clearCounters();
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


    const MODOS = {

        // Recibe y activa la palabra y el modo bonus.
        'palabras bonus': function () {
            io.emit('activar_modo', { modo_actual});
            log("activado palabras bonus");

            io.emit("pedir_inspiracion_musa", {modo_actual})
            bonusmode.clearAll();
            bonusmode.start(1);
            bonusmode.start(2);
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

            malditasmode.clearAll();
            malditasmode.start(1);
            malditasmode.start(2);
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
