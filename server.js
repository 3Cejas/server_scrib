const { INSPECT_MAX_BYTES } = require('buffer');
const { RAE } = require('rae-api'); // Define el constructor del buscador de la RAE.
const http = require("http").createServer(); // Define el servidor http.
const io = require("socket.io")(http); // Define el socket.

const debug = false; // Modo desarrollador de rae-api.
const rae = new RAE(debug); // Creamos una instancia del buscador de la RAE.
const log = console.log; // Define la consola del servidor.

const port = process.env.PORT || 3000; // Define el puerto de comunicación con el servidor (puede ser o, el puerto dado por el entorno, o el 3000 si no lo encuentra).

const LIMPIEZAS = {
    'palabras bonus': function (socket) {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        socket.removeAllListeners('nueva_palabra');
        // socket.removeAllListeners('enviar_palabra');
        //socket.removeAllListeners('feedback_de_j1');
        //socket.removeAllListeners('feedback_de_j2');
    },

    'letra prohibida': function (socket) {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        letra_prohibida = "";
    },

    'letra bendita': function (socket) {
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
        palabras_prohibidas_restantes = [...palabras_prohibidas];
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        socket.removeAllListeners('nueva_palabra');
    },

    'ortografía perfecta': function (socket) {

    },

    'locura': function (socket) { },


    '': function (socket) { }
}

let cambio_palabra_j1 = false; // Variable que almacena el temporizador de cambio de palabra bonus.
let cambio_palabra_j2 = false; // Variable que almacena el temporizador de cambio de palabra bonus.
let listener_cambio_letra = false; // Variable que almacena el listener de cambio de letra.
let tiempo_voto = false;
var terminado = true; // Variable booleana que indica si el juego ha empezado o no.
// let puntuaciones_palabra = [50,75,100,125,150,175,200] // Variable que almacena las posibles puntuaciones de las palabras bonus.

// Variables del modo letra prohibida.
let modo_actual = "";
let modo_anterior = "";
let letra_prohibida = "";
let letra_bendita = "";
const letras_prohibidas = ['e','a','o','s','r','n','i','d','l','c'];
const letras_benditas= ['z','j','ñ','x','k','w'];
const palabras_prohibidas = [
    "de", "la", "que", "el", "en", "y", "a", "los", "se", "del",
    "las", "un", "por", "con", "no", "una", "su", "para", "es", "al",
    "lo", "como", "más", "o", "pero", "sus", "le", "ha", "me", "si",
    "sin", "sobre", "este", "ya", "entre", "cuando", "todo", "esta", "ser", "son",
    "dos", "también", "fue", "había", "era", "muy", "años", "hasta", "desde", "está"
];

const repentizados = [
    "\"A\" quiere que \"B\" se meta un pepino por el culo",
    "\"A\" va comprar el pan",
    "\"A\" le come el coño a \"B\""
];

let letras_benditas_restantes = [...letras_benditas];
let letras_prohibidas_restantes = [...letras_prohibidas];
let palabras_prohibidas_restantes = [...palabras_prohibidas];
let repentizados_restantes = [...repentizados];

var tiempos = [];
//1 + 5 + 1 + 5 + 1 + 5 + 5 + 1 + 5 + 5 (nuevo modo)
//const LISTA_MODOS = ["repentizado", "", "repentizado", "letra bendita", "repentizado", "palabras bonus", "tertulia", "repentizado", "letra prohibida"];

const LISTA_MODOS = ["ortografía perfecta",  "letra bendita", "palabras bonus", "tertulia", "letra prohibida", "palabras prohibidas", "tertulia", "locura"];
const LISTA_MODOS_LOCURA = [ "letra bendita", "palabras bonus", "letra prohibida", "palabras prohibidas"];
let modos_restantes = [...LISTA_MODOS];
let escritxr1 = "";
let escritxr2 = "";
let inspiracion_musas_j1 = [];
let inspiracion_musas_j2 = [];
let palabras_insertadas_j1 = -1;
let palabras_insertadas_j2 = -1;
let votos_ventaja = {
    //"🐢": 0,
    "⚡": 0,
    //"⌛": 0,
    "🌫️": 0,
    "🙃": 0
}

let votos_repentizado = {
    "1": 0,
    "2": 0,
    "3": 0
}

let fin_j1 = false;
let fin_j2 = false;
let nueva_palabra_j1 = false;
let nueva_palabra_j2 = false;
let locura = false;

//PARAMETROS DEL JUEGO
const TIEMPO_CAMBIO_PALABRAS = 30000;
const CONST_TIEMPO_CAMBIO_MODOS = 29;
let TIEMPO_CAMBIO_MODOS = CONST_TIEMPO_CAMBIO_MODOS;
const TIEMPO_BORROSO = 60000;
const PALABRAS_INSERTADAS_META = 5;
const TIEMPO_VOTACION = 20000;

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
http.listen(port, () => log(`Servidor escuchando en el puerto: ${port}`));

io.on('connection', (socket) => {

    socket.on('enviar_musa', (escritxr) => {
        console.log("ENVIOOOO")
        // Aumenta la cuenta del escritor correspondiente.
        console.log(escritxr);
        if (escritxr == 1) {
        contador_musas.escritxr1++;
        } else if (escritxr == 2) {
        contador_musas.escritxr2++;
        }

        socket.escritxr = escritxr;

        console.log(contador_musas);
        io.emit('actualizar_contador_musas', contador_musas)
    });

    // Cuando un cliente se desconecta, disminuye la cuenta del escritor correspondiente.
    socket.on('disconnect', () => {
        if (socket.escritxr == 1) {
            contador_musas.escritxr1--;
        } else if (socket.escritxr == 2) {
            contador_musas.escritxr2--;
        }

        console.log(contador_musas);
        io.emit('actualizar_contador_musas', contador_musas)

    });
    // Da retroalimentación cuando se ha conectado con el ciente.

    log('Un escritxr se ha unido a la partida.');

    io.emit('nombre1', escritxr1);
    io.emit('nombre2', escritxr2);

    // Envía el texto del editor 1.

    socket.on('texto1', (evt) => {
        socket.broadcast.emit('texto1', evt);
    });

    // Envía el texto del editor 2.

    socket.on('texto2', (evt1) => {
        socket.broadcast.emit('texto2', evt1);
    });

    socket.on('pedir_nombre', () => {
        console.log("te escucho")
        if(socket.escritxr == 1){
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
        if (data.count == "¡Tiempo!") {
            LIMPIEZAS[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            terminado = true;
            modos_restantes = [...LISTA_MODOS];
            modo_anterior = "";
            modo_actual = "";
            nueva_palabra_j1 = false;
            nueva_palabra_j2 = false;
            clearTimeout(cambio_palabra_j1);
            clearTimeout(cambio_palabra_j2);
        }
        console.log(modos_restantes)
        console.log(modo_actual)
        console.log("BUSCO",inspiracion_musas_j1)

        if(data.secondsPassed == TIEMPO_CAMBIO_MODOS){
            LIMPIEZAS[modo_actual](socket);
            modos_de_juego(socket);

        }
        else {
            terminado = false;
        }
        console.log(data)
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
        tiempos = getRanges(data.count, LISTA_MODOS.length + 1);
        
        socket.removeAllListeners('vote');
        socket.removeAllListeners('exit');
        socket.removeAllListeners('envia_temas');
        socket.removeAllListeners('temas');
        socket.removeAllListeners('enviar_postgame1');
        socket.removeAllListeners('enviar_postgame2');
        //socket.removeAllListeners('scroll');

        terminado = false;
        locura = false;
        modos_restantes = [...LISTA_MODOS];
        letras_benditas_restantes = [...letras_benditas];
        letras_prohibidas_restantes = [...letras_prohibidas];
        palabras_prohibidas_restantes = [...palabras_prohibidas];
        modo_anterior = "";
        modo_actual = "";
        palabras_insertadas_j1 = -1;
        palabras_insertadas_j2 = -1;
        inspiracion_musas_j1 = [];
        inspiracion_musas_j2 = [];
        TIEMPO_CAMBIO_MODOS = CONST_TIEMPO_CAMBIO_MODOS;
        socket.broadcast.emit('inicio', data);
    });

    // Resetea el tablero de juego.

    socket.on('limpiar', (evt1) => {
        activar_sockets_extratextuales(socket);
        clearTimeout(tiempo_voto);
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        terminado = true;
        locura = false;
        modos_restantes = [...LISTA_MODOS];
        modo_anterior = "";
        modo_actual = "";
        inspiracion_musas_j1 = [];
        inspiracion_musas_j2 = [];
        palabras_insertadas_j1 = -1;
        palabras_insertadas_j2 = -1;
        nueva_palabra_j1 = false;
        nueva_palabra_j2 = false;
        TIEMPO_CAMBIO_MODOS = CONST_TIEMPO_CAMBIO_MODOS;
        socket.broadcast.emit('limpiar', evt1);
    });

    socket.on('pausar', (evt1) => {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
        clearTimeout(listener_cambio_letra);
        activar_sockets_extratextuales(socket);
        socket.broadcast.emit('pausar_js', evt1);
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
            terminado = true;
        }
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
    
    socket.on('nueva_palabra', (escritxr) => {
        console.log("NUEVA", escritxr)
        if(escritxr == 1){
        clearTimeout(cambio_palabra_j1);
        nueva_palabra_j1 = true;
        }
        else{
        clearTimeout(cambio_palabra_j2);
        nueva_palabra_j2 = true;
        }
        if (terminado == false) {
            if(inspiracion_musas_j1.length > 0 && escritxr == 1){
                console.log("PERRRRACAAA")
                paso = false;
                indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [""]];
                inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                nueva_palabra_j1 = false;
            }
            if(inspiracion_musas_j2.length > 0 && escritxr == 2){
                paso = false;
                indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [""]];
                inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                nueva_palabra_j2 = false;
            }
            else if(nueva_palabra_j1 == true && escritxr == 1 || nueva_palabra_j2 == true && escritxr2 == 2) {
            palabraRAE().then(palabra_bonus => {
                palabras_var = palabra_bonus[0];
                palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                if(inspiracion_musas_j1.length == 0 && escritxr == 1){
                    io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                }
                if(inspiracion_musas_j2.length == 0 && escritxr == 2){
                    io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                }
            })
            }
            cambiar_palabra(escritxr);
        }
    });


    socket.on('nueva_palabra_prohibida', (escritxr) => {
        console.log("NUEVA", escritxr)
        if(escritxr == 1){
        clearTimeout(cambio_palabra_j1);
        nueva_palabra_j1 = true;
        palabras_insertadas_j2++;
        }
        else{
        clearTimeout(cambio_palabra_j2);
        nueva_palabra_j2 = true;
        palabras_insertadas_j1++;
        }
        if (terminado == false) {
            if(inspiracion_musas_j1.length > 0 && escritxr == 1){
                console.log("PERRRRACAAA")
                paso = false;
                indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [""]];
                inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                nueva_palabra_j1 = false;
            }
            if(inspiracion_musas_j2.length > 0 && escritxr == 2){
                paso = false;
                indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [""]];
                inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                nueva_palabra_j2 = false;
            }
            else if(nueva_palabra_j1 == true && escritxr == 1 || nueva_palabra_j2 == true && escritxr2 == 2) {
                indice_palabra_j1 = Math.floor(Math.random() * palabras_prohibidas_restantes.length);
                palabra_bonus = [[palabras_prohibidas_restantes[indice_palabra_j1]], [""]];
                palabras_prohibidas_restantes.splice(indice_palabra_j1, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                console.log("AQUI, AMOR", inspiracion_musas_j1)
                if(inspiracion_musas_j1.length == 0){
                    io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    clearTimeout(cambio_palabra_j1);
                    cambiar_palabra_prohibida(1);
                }
                if(inspiracion_musas_j2.length == 0){
                    io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    clearTimeout(cambio_palabra_j2);
                    cambiar_palabra_prohibida(2);
                }
            }
            cambiar_palabra_prohibida(escritxr);
        }
    });

    socket.on('nueva_palabra_musa', (escritxr) => {
        console.log("ESTO ES UN ERROR DE AHORA")
        if(escritxr == 1){
            palabras_insertadas_j1++;
            nueva_palabra_j1 = true;
            clearTimeout(cambio_palabra_j1);
        }
        else{
            palabras_insertadas_j2++;
            nueva_palabra_j2 = true;
            clearTimeout(cambio_palabra_j2);
        }
        if (terminado == false) {
            if(escritxr == 1){
                indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                inspiracion_j1 = inspiracion_musas_j1[indice_palabra_j1];
                inspiracion_musas_j1.splice(indice_palabra_j1, 1);
            if(inspiracion_j1){
                console.log(inspiracion_j1)
                io.emit('inspirar_j1', inspiracion_j1);
            }
            }
            else{
                indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                inspiracion_j2 = inspiracion_musas_j2[indice_palabra_j2];
                inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                if(inspiracion_j2){
                    console.log(inspiracion_j2)
                    io.emit('inspirar_j2', inspiracion_j2);
                }
            }
            musas(escritxr);
        }
    });

    socket.on('enviar_puntuacion_final', (evt1) => {
        io.emit('recibir_puntuacion_final', evt1);
    });

    socket.on('enviar_clasificacion', (evt1) => {
        io.emit('recibir_clasificacion', evt1);
    });

    // Envía un comentario.
    socket.on('enviar_comentario', (evt1) => {
        io.emit('recibir_comentario', evt1);
    });

    socket.on('aumentar_tiempo', (evt1) => {
        io.emit('aumentar_tiempo_control', evt1);
    });

    socket.on('enviar_inspiracion', (palabra) => {
        if(palabra != '' && palabra != null){
            if(socket.escritxr == 1){
                console.log("QUÉEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE")
                inspiracion_musas_j1.push(palabra);
                if(inspiracion_musas_j1.length == 1 && nueva_palabra_j1 == true){
                    nueva_palabra_j1 = false;
                    if(modo_actual == "palabras bonus"){
                        console.log("SCALIAN,", modo_actual)
                        cambiar_palabra(1);
                    }
                    if(modo_actual == "palabras prohibidas"){
                        console.log("SCALIAN,", modo_actual)
                        cambiar_palabra_prohibida(1);
                    }
                    else if(modo_actual != "palabras bonus" && modo_actual != "palabras prohibidas"){
                    musas(1);
                    }
                }
            }
            else if (socket.escritxr == 2){
                inspiracion_musas_j2.push(palabra);
                if(inspiracion_musas_j2.length == 1 && nueva_palabra_j2 == true){
                    nueva_palabra_j2 = false;
                    if(modo_actual == "palabras bonus"){
                        console.log("ERRRRRROR")
                        cambiar_palabra(2);
                    }
                    if(modo_actual == "palabras prohibidas"){
                        console.log("ERRRRRROR")
                        cambiar_palabra_prohibida(2);
                    }
                    else if(modo_actual != "palabras bonus" && modo_actual != "palabras prohibidas"){
                        musas(2);
                    }
                }
                }
        }
        console.log("guardao", inspiracion_musas_j1);
        console.log(inspiracion_musas_j2);
    });

    socket.on('enviar_voto_ventaja', (voto) => {
        votos_ventaja[voto] += 1;
    });

    socket.on('enviar_voto_repentizado', (voto) => {
        votos_repentizado[voto] += 1;
    });

    //Función auxiliar recursiva que cambia los modos del juego a lo largo de toda la partida.
    function modos_de_juego(socket) {
        if (terminado == false) {
            //let indice_modo = Math.floor(Math.random() * modos_restantes.length);
            console.log(modos_restantes)
            //modo = modos_restantes[0]
            modo_anterior = modo_actual;
            modo_actual = modos_restantes[0];
            modos_restantes.splice(0, 1);
            console.log(modos_restantes)
            console.log("MODO ACTUAL", modo_actual)
            if (modos_restantes.length == 0) {
                modos_restantes = [...LISTA_MODOS_LOCURA];
            }
            //modo_actual = "palabras bonus";
            MODOS[modo_actual](socket);
            console.log("MODO ANTERIOR:", modo_anterior)
            if(modo_anterior != "" && modo_anterior != "tertulia"  && modo_actual != "tertulia" && modo_anterior != "palabras bonus" && modo_anterior != "palabras prohibidas" && modo_anterior != "locura" && locura == false){
                console.log("HOTY ENTRO")
            if(palabras_insertadas_j1 == palabras_insertadas_j2 ){
                randomNum = Math.random();
                if (randomNum < 0.5) {
                    palabras_insertadas_j1 += 1;
                } else {
                    palabras_insertadas_j2 += 1;
                }
            }
            if(palabras_insertadas_j1 > palabras_insertadas_j2){
                votos_ventaja = {
                    //"🐢": 0,
                    "⚡": 0,
                    //"⌛": 0,
                    "🌫️": 0,
                    "🙃": 0
                }
                io.emit('elegir_ventaja_j1')
                console.log("TONTOOOO")
                tiempo_voto = setTimeout(
                    function () {
                        console.log("TUUUU")
                        socket.removeAllListeners('enviar_voto_ventaja');
                        console.log("AQUI", opcionConMasVotos(votos_ventaja));
                        io.emit('enviar_ventaja_j1', opcionConMasVotos(votos_ventaja));
                        sincro_modos();
                        repentizado();
                    }, TIEMPO_VOTACION);
            }
            else if(palabras_insertadas_j2 > palabras_insertadas_j1){
                votos_ventaja = {
                    //"🐢": 0,
                    "⚡": 0,
                    //"⌛": 0,
                    "🌫️": 0,
                    "🙃": 0
                }
                io.emit('elegir_ventaja_j2')
                tiempo_voto = setTimeout(
                    function () {
                        socket.removeAllListeners('enviar_voto_ventaja');
                        io.emit('enviar_ventaja_j2', opcionConMasVotos(votos_ventaja));
                        sincro_modos();
                        repentizado();
                    }, TIEMPO_VOTACION);
            }
            }

            inspiracion_musas_j1 = [];
            inspiracion_musas_j2 = [];
            palabras_insertadas_j1 = -1;
            palabras_insertadas_j2 = -1;
        }
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
        if (terminado == true && modo_actual != "palabras bonus") {
            clearTimeout(cambio_palabra_j1);
            clearTimeout(cambio_palabra_j2);
        }
        if (terminado == false) {
            if(escritxr==1){
            clearTimeout(cambio_palabra_j1);
            cambio_palabra_j1 = setTimeout(
                function () {
                    if(inspiracion_musas_j1.length > 0){
                        console.log("PALABRA BONUS DE MUSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
                        indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                        palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [""]];
                        inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                        palabras_var = palabra_bonus[0];
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        palabras_var = palabra_bonus[0];
                        io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                    else{
                    console.log("AQUI, AMOR", inspiracion_musas_j1)
                    palabraRAE().then(palabra_bonus => {
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
            else if(escritxr==2){
            console.log("NO ME AFECTA")
            clearTimeout(cambio_palabra_j2);
            cambio_palabra_j2 = setTimeout(
                function () {
                        if(inspiracion_musas_j2.length > 0){
                        indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                        palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [""]];
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
    }

//Función auxiliar recursiva que elige palabras bonus, las envía a jugador 1 y 2 y las cambia cada x segundos.
function cambiar_palabra_prohibida(escritxr) {
    console.log("TEMP CAMBOO",escritxr)
    if (terminado == true && modo_actual != "palabras prohibidas") {
        clearTimeout(cambio_palabra_j1);
        clearTimeout(cambio_palabra_j2);
    }
    if (terminado == false) {
        if(escritxr==1){
        clearTimeout(cambio_palabra_j1);
        cambio_palabra_j1 = setTimeout(
            function () {
                if(inspiracion_musas_j1.length > 0){
                    console.log("PALABRA BONUS DE MUSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
                    indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                    palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [""]];
                    inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                }
                else{
                    indice_palabra_j1 = Math.floor(Math.random() * palabras_prohibidas_restantes.length);
                    palabra_bonus = [[palabras_prohibidas_restantes[indice_palabra_j1]], [""]];
                    palabras_prohibidas_restantes.splice(indice_palabra_j1, 1);
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    console.log("AQUI, AMOR", inspiracion_musas_j1)
                    if(inspiracion_musas_j1.length == 0){
                        io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                }
                cambiar_palabra_prohibida(1);
            }, TIEMPO_CAMBIO_PALABRAS);
        }
        else if(escritxr==2){
        console.log("NO ME AFECTA")
        clearTimeout(cambio_palabra_j2);
        cambio_palabra_j2 = setTimeout(
            function () {
                if(inspiracion_musas_j2.length > 0){
                    indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                    palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [""]];
                    inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                }
                else{
                    indice_palabra_j2 = Math.floor(Math.random() * palabras_prohibidas_restantes.length);
                    palabra_bonus = [[palabras_prohibidas_restantes[indice_palabra_j2]], [""]];
                    palabras_prohibidas_restantes.splice(indice_palabra_j2, 1);
                    palabras_var = palabra_bonus[0];
                    tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                    palabras_var = palabra_bonus[0];
                    console.log("AQUI, AMOR", inspiracion_musas_j2)
                    if(inspiracion_musas_j2.length == 0){
                        io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    }
                }
                cambiar_palabra_prohibida(2);
            }, TIEMPO_CAMBIO_PALABRAS);
        }
    }
}

    const MODOS = {

        // Recibe y activa la palabra y el modo bonus.
        'palabras bonus': function () {
            io.emit('activar_modo', { modo_actual});
            log("activado palabras bonus");
            // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.
            // activar_socket_nueva_palabra(socket);
            io.emit("pedir_inspiracion_musa", {modo_actual})

            if(inspiracion_musas_j1.length > 0){
                indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [""]];
                inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                clearTimeout(cambio_palabra_j1);
                cambiar_palabra(1);
            }
            if(inspiracion_musas_j2.length > 0){
                indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [""]];
                inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                clearTimeout(cambio_palabra_j2);
                cambiar_palabra(2);
            }
            else{
            palabraRAE().then(palabra_bonus => {
                palabras_var = palabra_bonus[0];
                palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                if(inspiracion_musas_j1.length == 0){
                    io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    clearTimeout(cambio_palabra_j1);
                    cambiar_palabra(1);
                }
                if(inspiracion_musas_j2.length == 0){
                    io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    clearTimeout(cambio_palabra_j2);
                    cambiar_palabra(2);
                }
            })
            }
            /*setTimeout(function(){
                clearTimeout(cambio_palabra);
                modos_de_juego();
            }, 5000);*/
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
            listener_cambio_letra = setTimeout(function(){
                indice_letra_prohibida = Math.floor(Math.random() * letras_prohibidas_restantes.length);
                letra_prohibida = letras_prohibidas_restantes[indice_letra_prohibida]
                letras_prohibidas_restantes.splice(indice_letra_prohibida, 1);
                if(letras_prohibidas_restantes.length == 0){
                    letras_prohibidas_restantes = [...letras_prohibidas];
                }
                letra = letra_prohibida;
                io.emit("nueva letra", letra);
                inspiracion_musas_j1 = [];
                inspiracion_musas_j2 = [];
                io.emit("pedir_inspiracion_musa", {modo_actual, letra_prohibida})
            }, 60000);
            musas(1);
            musas(2);
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
            listener_cambio_letra = setTimeout(function(){
                indice_letra_bendita = Math.floor(Math.random() * letras_benditas_restantes.length);
                letra_bendita = letras_benditas_restantes[indice_letra_bendita]
                letras_benditas_restantes.splice(indice_letra_bendita, 1);
                if(letras_benditas_restantes.length == 0){
                    letras_benditas_restantes = [...letras_benditas];
                }
                letra = letra_bendita;
                io.emit("nueva letra", letra);
                inspiracion_musas_j1 = [];
                inspiracion_musas_j2 = [];
                io.emit("pedir_inspiracion_musa", {modo_actual, letra_bendita})
            }, 60000);
            // activar_sockets_feedback();
            //letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]
            musas(1);
            musas(2);
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

            if(inspiracion_musas_j1.length > 0){
                indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
                palabra_bonus = [[inspiracion_musas_j1[indice_palabra_j1]], [""]];
                inspiracion_musas_j1.splice(indice_palabra_j1, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                clearTimeout(cambio_palabra_j1);
                cambiar_palabra_prohibida(1);
            }
            if(inspiracion_musas_j2.length > 0){
                indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
                palabra_bonus = [[inspiracion_musas_j2[indice_palabra_j2]], [""]];
                inspiracion_musas_j2.splice(indice_palabra_j2, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                clearTimeout(cambio_palabra_j2);
                cambiar_palabra_prohibida(2);
            }
            else{
                indice_palabra_j1 = Math.floor(Math.random() * palabras_prohibidas_restantes.length);
                palabra_bonus = [[palabras_prohibidas_restantes[indice_palabra_j1]], [""]];
                palabras_prohibidas_restantes.splice(indice_palabra_j1, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                console.log("AQUI, AMOR", inspiracion_musas_j1)
                if(inspiracion_musas_j1.length == 0){
                    io.emit('enviar_palabra_j2', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    clearTimeout(cambio_palabra_j1);
                    cambiar_palabra_prohibida(1);
                }
                if(inspiracion_musas_j2.length == 0){
                    io.emit('enviar_palabra_j1', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
                    clearTimeout(cambio_palabra_j2);
                    cambiar_palabra_prohibida(2);
                }
            }
            /*setTimeout(function(){
                clearTimeout(cambio_palabra);
                modos_de_juego();
            }, 5000);*/
        },

        'locura': function (socket) {
            locura = true;
            TIEMPO_CAMBIO_MODOS = 4
            io.emit('locura', { modo_actual });
            modos_de_juego(socket);
        },
        'ortografía perfecta': function (socket) {
            io.emit('activar_modo', { modo_actual});
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

// Buscador de palabra aletoria y su definición en la RAE.

async function palabraRAE() {
    let palabra_final = ""
    let definicion_final = ""
    try {
        palabra = await new RAE().getRandomWord();
        palabra_final = palabra.getHeader();
        definiciones = palabra.getDefinitions();

        while (definiciones == "") {
            palabra = await new RAE().getRandomWord();
            palabra_final = palabra.getHeader();
            definiciones = palabra.getDefinitions();
        }
        for (var i = 0; i < definiciones.length; i++) {
            if (i < 3) {
                definicion_final += `${i+1}. ${definiciones[i].getDefinition()}<br><br/>`;
            }
        }
    }
    catch {
        return palabraRAE;
    }
    return [palabra_final, definicion_final];
};

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

//Función auxiliar para la extracción de las variaciones de una palabra.
function extraccion_palabra_var(palabra_var) {
    palabra_var_lista = palabra_var.split(", ")
    let palabra = palabra_var_lista[0];
    
    if(palabra_var_lista.length > 1){
        let terminacion = palabra_var_lista[1];
        let index = palabra.length - 1;
        if(terminacion.length != 1){
            while (index >= 0 && palabra.charAt(index) !== terminacion.charAt(0)) {
                index--;
            }
        }
        else{
            while (index >= 0 && !esVocal(palabra.charAt(index))) {
                index--;
            }
        }
        return [palabra, palabra.slice(0, index) + terminacion];
    }
    else return[palabra];
  }

// Función auxiliar que devuelve si un caracter es vocal o no.
  function esVocal(caracter) {
    var vocales = ['a', 'e', 'i', 'o', 'u'];
    return vocales.includes(caracter.toLowerCase());
  }

// Función auxiliar que responde una palabra de las musas casa x segundos:
function musas(escritxr) {
    if(escritxr == 1){
        console.log("ENTRO",inspiracion_musas_j1)
        indice_palabra_j1 = Math.floor(Math.random() * inspiracion_musas_j1.length);
        inspiracion_j1 = inspiracion_musas_j1[indice_palabra_j1];
        console.log("AQUI2", inspiracion_musas_j1, inspiracion_musas_j2)
        inspiracion_musas_j1.splice(indice_palabra_j1, 1);
        if(inspiracion_j1){
        io.emit('inspirar_j1', inspiracion_j1);
        }
        clearTimeout(cambio_palabra_j1)
        cambio_palabra_j1 = setTimeout(
        function(){
            musas(escritxr);
        }, TIEMPO_CAMBIO_PALABRAS);
    }
    else{
        indice_palabra_j2 = Math.floor(Math.random() * inspiracion_musas_j2.length);
        inspiracion_j2 = inspiracion_musas_j2[indice_palabra_j2];
        inspiracion_musas_j2.splice(indice_palabra_j2, 1);
        if(inspiracion_j2){
            console.log(inspiracion_j2)
            io.emit('inspirar_j2', inspiracion_j2);
        }
        clearTimeout(cambio_palabra_j2)
        cambio_palabra_j2 = setTimeout(
        function(){
            musas(escritxr);
        }, TIEMPO_CAMBIO_PALABRAS);
    }
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
    else if(modo_actual == "palabras bonus"){
        emitter.emit('modo_actual', {modo_actual});
    }
    else if(modo_actual == "palabras prohibidas"){
        emitter.emit('modo_actual', {modo_actual});
    }
}


function repentizado(socket){
    seleccionados = [];
    for (let i = 0; i < 3; i++) {
        indice_repentizado = Math.floor(Math.random() * repentizados_restantes.length);
            seleccionados.push(repentizados_restantes[indice_repentizado]);
            repentizados_restantes.splice(indice_repentizado, 1);
            if(repentizados_restantes.length == 0){
                repentizados_restantes = [...repentizados];
            }
    }
    io.emit('elegir_repentizado', seleccionados)
                tiempo_voto = setTimeout(
                    function () {
                        io.removeAllListeners('enviar_voto_repentizado');
                        io.emit('enviar_repentizado', seleccionados[parseInt(opcionConMasVotos(votos_repentizado))]);
                        sincro_modos();
                    }, TIEMPO_VOTACION);
}
