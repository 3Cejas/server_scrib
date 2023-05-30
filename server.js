const { RAE } = require('rae-api'); // Define el constructor del buscador de la RAE.
const http = require("http").createServer(); // Define el servidor http.
const io = require("socket.io")(http); // Define el socket.

const debug = false; // Modo desarrollador de rae-api.
const rae = new RAE(debug); // Creamos una instancia del buscador de la RAE.
const log = console.log; // Define la consola del servidor.

const port = process.env.PORT || 3000; // Define el puerto de comunicación con el servidor (puede ser o, el puerto dado por el entorno, o el 3000 si no lo encuentra).

const LIMPIEZAS = {
    'palabras bonus': function (socket) {
        clearTimeout(cambio_palabra);
        socket.removeAllListeners('nueva_palabra');
        // socket.removeAllListeners('enviar_palabra');
        socket.removeAllListeners('feedback_de_j1');
        socket.removeAllListeners('feedback_de_j2');
    },

    'letra prohibida': function (socket) {
        letra_prohibida = "";
    },

    'letra bendita': function (socket) {
        letra_bendita = "";
    },

    'texto borroso': function (socket) {
    },

    'psicodélico': function (socket) {
    },

    'texto inverso': function (socket) { },

    '': function (socket) { }
}

let cambio_palabra = false; // Variable que almacena el temporizador de cambio de palabra bonus.
var terminado = true; // Variable booleana que indica si el juego ha empezado o no.
// let puntuaciones_palabra = [50,75,100,125,150,175,200] // Variable que almacena las posibles puntuaciones de las palabras bonus.

// Variables del modo letra prohibida.
let modo_actual = "";
let letra_prohibida = "";
let letra_bendita = "";
const letras_prohibidas = "eaosrnidlc";
const letras_benditas= "zjñxkw";
var tiempos = [];
const LISTA_MODOS = ["letra bendita", "letra prohibida", "palabras bonus"];
let = modos_restantes = [...LISTA_MODOS];
let escritxr1 = "";
let escritxr2 = "";
let inspiracion_musas = [];
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
        if(modo_actual == "letra prohibida"){
        socket.emit('modo_actual', {modo_actual, letra_prohibida});
        }
        else if(modo_actual == "letra bendita"){
            letra = letra_bendita;
            socket.emit('modo_actual', {modo_actual, letra_bendita});
        }
        else if(modo_actual == "palabras bonus"){
            socket.emit('modo_actual', {modo_actual});
        }
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
            modo_actual = "";
            clearTimeout(cambio_palabra)
        }
        console.log(modos_restantes)

        if(data.secondsPassed == 54){
            inspiracion_musas = [];

            if(modos_restantes[0] == 'letra bendita'){
                console.log("paso")
                letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]
                modo = modos_restantes[0]
                io.emit("pedir_inspiracion_musa", {modo, letra_bendita})
            }
            if(modos_restantes[0] == "letra prohibida"){
                letra_prohibida = letras_prohibidas[Math.floor(Math.random() * letras_prohibidas.length)]
                modo = modos_restantes[0]
                console.log("Aqui",letra_prohibida)
                io.emit("pedir_inspiracion_musa", {modo, letra_prohibida})
            }
            if(modos_restantes[0] == "palabras bonus"){
                modo = modos_restantes[0]
                io.emit("pedir_inspiracion_musa", {modo})
            }
        }
        if(data.secondsPassed == 59){
            console.log(modo_actual)
            LIMPIEZAS[modo_actual](socket);
            modos_de_juego();
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
        modos_restantes = [...LISTA_MODOS];
        socket.broadcast.emit('inicio', data);
        inspiracion_musas = [];
        letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]

        modo = modos_restantes[0]
        io.emit("pedir_inspiracion_musa", {modo, letra_bendita})
        modos_de_juego();
    });

    // Resetea el tablero de juego.

    socket.on('limpiar', (evt1) => {
        activar_sockets_extratextuales(socket);
        clearTimeout(cambio_palabra);
        terminado = true;
        modos_restantes = [...LISTA_MODOS];
        socket.broadcast.emit('limpiar', evt1);
    });

    socket.on('pausar', (evt1) => {
        clearTimeout(cambio_palabra);
        activar_sockets_extratextuales(socket);
        socket.broadcast.emit('pausar_js', evt1);
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
    
    socket.on('nueva_palabra', (evt1) => {
        clearTimeout(cambio_palabra);
        if (terminado == false) {
            if(inspiracion_musas.length > 0){
                indice_palabra = Math.floor(Math.random() * inspiracion_musas.length);
                palabra_bonus = [[inspiracion_musas[indice_palabra]], [""]];
                console.log("PALABRA", palabra_bonus);
                inspiracion_musas.splice(indice_palabra, 1);
                console.log(inspiracion_musas)
                palabras_var = palabra_bonus[0];
                console.log(palabra_bonus);
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('enviar_palabra', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
            }
            else{
            palabraRAE().then(palabra_bonus => {
                palabras_var = palabra_bonus[0];
                palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                io.emit('enviar_palabra', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
            })
            }
            cambiar_palabra();
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
        socket.broadcast.emit('recibir_comentario', evt1);
    });

    socket.on('aumentar_tiempo', (evt1) => {
        io.emit('aumentar_tiempo_control', evt1);
    });

    socket.on('enviar_inspiracion', (palabra) => {
        if(palabra != '' && palabra != null){
            inspiracion_musas.push(palabra);
        }
        console.log(inspiracion_musas);
    });

    //Función auxiliar recursiva que cambia los modos del juego a lo largo de toda la partida.
    function modos_de_juego(socket) {
        if (terminado == false) {
            //let indice_modo = Math.floor(Math.random() * modos_restantes.length);
            console.log(modos_restantes)
            modo_actual = modos_restantes[0];
            modos_restantes.splice(0, 1);
            console.log(modos_restantes)
            if (modos_restantes.length == 0) {
                modos_restantes = [...LISTA_MODOS];
            }
            //modo_actual = "palabras bonus";
            MODOS[modo_actual](socket);
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
    function cambiar_palabra() {
        if (terminado == true && modo_actual != "palabras bonus") {
            clearTimeout(cambio_palabra);
        }
        if (terminado == false) {
            clearTimeout(cambio_palabra);
            cambio_palabra = setTimeout(
                function () {
                    if(inspiracion_musas.length > 0){
                        indice_palabra = Math.floor(Math.random() * inspiracion_musas.length);
                        palabra_bonus = [[inspiracion_musas[indice_palabra]], [""]];
                        inspiracion_musas.splice(indice_palabra, 1);
                        palabras_var = palabra_bonus[0];
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        palabras_var = palabra_bonus[0];
                        io.emit('enviar_palabra', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });

                    }
                    else{
                    palabraRAE().then(palabra_bonus => {

                        palabras_var = palabra_bonus[0];
                        palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                        tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                        io.emit('enviar_palabra', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });

                    })
                    }
                    cambiar_palabra();
                }, 15000);
        }
    }

    const MODOS = {

        // Recibe y activa la palabra y el modo bonus.
        'palabras bonus': function () {
            log("activado palabras bonus");
            // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.
            // activar_socket_nueva_palabra(socket);
            if(inspiracion_musas.length > 0){
                indice_palabra = Math.floor(Math.random() * inspiracion_musas.length);
                palabra_bonus = [[inspiracion_musas[indice_palabra]], [""]];
                inspiracion_musas.splice(indice_palabra, 1);
                palabras_var = palabra_bonus[0];
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                palabras_var = palabra_bonus[0];
                io.emit('activar_modo', { modo_actual});
                io.emit('enviar_palabra', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
            }
            else{
            palabraRAE().then(palabra_bonus => {
                palabras_var = palabra_bonus[0];
                palabra_bonus[0] = extraccion_palabra_var(palabra_bonus[0]);
                tiempo_palabras_bonus = puntuación_palabra(palabra_bonus[0][0]);
                io.emit('activar_modo', { modo_actual });
                io.emit('enviar_palabra', { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus });
            })
            }
            cambiar_palabra();
            /*setTimeout(function(){
                clearTimeout(cambio_palabra);
                modos_de_juego();
            }, 5000);*/
        },

        // Recibe y activa el modo letra prohibida.
        'letra prohibida': function (socket) {
            log("activado letra prohibida");
            // activar_sockets_feedback();
            //letra_prohibida = letras_prohibidas[Math.floor(Math.random() * letras_prohibidas.length)]
            musas();
            io.emit('activar_modo', { modo_actual, letra_prohibida });
        },

        // Recibe y activa el modo letra prohibida.
        'letra bendita': function (socket) {
            log(modo_actual);
            // activar_sockets_feedback();
            //letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]
            musas();
            log(letra_bendita)
            io.emit('activar_modo', { modo_actual, letra_bendita });
        },

        'texto borroso': function () {
            let jugador = Math.floor(Math.random() * 2) + 1
            duracion = diferencia_tiempo(tiempos[0], tiempos[1]) * 1000 / 2
            io.emit('activar_modo', { modo_actual, jugador, duracion });
        },

        'psicodélico': function () {
            io.emit('activar_modo', { modo_actual });
        },

        'texto inverso': function () {
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
            return Math.ceil((((10 - puntuación*0.5) + longitud * 0.1 * 30)) / 5) * 5;
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

  //Función auxiliar que, dados dos tiempos en string, devuelve el tiempo transcurrido en segundoS.
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
function musas() {
    indice_palabra = Math.floor(Math.random() * inspiracion_musas.length);
    inspiracion = inspiracion_musas[indice_palabra];
    console.log(inspiracion_musas)
    inspiracion_musas.splice(indice_palabra, 1);
    if(inspiracion){
        console.log(inspiracion)
        io.emit('inspirar', inspiracion);
    }
    clearTimeout(cambio_palabra)
        cambio_palabra = setTimeout(
        function(){
            musas();
        }, 5000);
}