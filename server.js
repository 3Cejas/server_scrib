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
const LISTA_MODOS = ["palabras bonus", "letra prohibida", "letra bendita", "texto borroso"];

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

    // Da retroalimentación cuando se ha conectado con el ciente.

    log('Un escritxr se ha unido a la partida.');

    // Envía el texto del editor 1.

    socket.on('texto1', (evt) => {
        socket.broadcast.emit('texto1', evt);
    });

    // Envía el texto del editor 2.

    socket.on('texto2', (evt1) => {
        socket.broadcast.emit('texto2', evt1);
    });

    //activa sockets no tienen que ver con los textos.
    activar_sockets_extratextuales(socket);
    // Envía el contador de tiempo.
    socket.on('count', (evt1) => {
        if (evt1 == "¡Tiempo!") {
            LIMPIEZAS[modo_actual](socket);
            activar_sockets_extratextuales(socket);
            terminado = true;
            modos_restantes = [...LISTA_MODOS];
        }
        encontrado = false;
        for (let i = 1; i < tiempos.length - 1 && !encontrado; i++) {
            if (evt1 == tiempos[i]) {
                LIMPIEZAS[modo_actual](socket);
                modos_de_juego(socket);
                tiempos.splice(i, 1);
                encontrado = true;
            }
        }
        if (evt1 == tiempos[0]) {
            terminado = true;
            modos_restantes = [...LISTA_MODOS];
        }
        if (evt1 == tiempos[tiempos.length - 2]) {
            modos_de_juego(socket);
        }
        else {
            terminado = false;
        }
        socket.broadcast.emit('count', evt1);
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
        socket.removeAllListeners('envío_nombre1');
        socket.removeAllListeners('envío_nombre2');
        socket.removeAllListeners('envia_temas');
        socket.removeAllListeners('temas');
        socket.removeAllListeners('enviar_comentario');
        socket.removeAllListeners('enviar_postgame1');
        socket.removeAllListeners('enviar_postgame2');
        //socket.removeAllListeners('scroll');

        terminado = false;
        modos_restantes = [...LISTA_MODOS];
        socket.broadcast.emit('inicio', data);
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

    socket.on('reanudar', (evt1) => {
        MODOS[modo_actual](socket);
        socket.broadcast.emit('reanudar_js', evt1);
    });

    socket.on('aumentar_tiempo_borrado_a_jx', (evt1) => {
        if(evt1 == 1){
            socket.broadcast.emit('aumentar_tiempo_borrado_de_j1', evt1);
        }
        else{
            socket.broadcast.emit('aumentar_tiempo_borrado_de_j2', evt1);
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
            palabraRAE().then(palabra_bonus => {
                puntuacion = puntuación_palabra(palabra_bonus[0]);
                io.emit('enviar_palabra', { modo_actual, palabra_bonus, puntuacion });
            })
            cambiar_palabra();
        }
    });

    socket.on('enviar_puntuacion_final', (evt1) => {
        io.emit('recibir_puntuacion_final', evt1);
    });

    socket.on('enviar_clasificacion', (evt1) => {
        console.log(evt1)
        io.emit('recibir_clasificacion', evt1);
    });

    //Función auxiliar recursiva que cambia los modos del juego a lo largo de toda la partida.
    function modos_de_juego(socket) {
        if (terminado == false) {
            let indice_modo = Math.floor(Math.random() * modos_restantes.length);
            modo_actual = modos_restantes[indice_modo];
            console.log("MODO ACTUAL: " + modo_actual);
            modos_restantes.splice(indice_modo, 1);
            console.log("MODOS RESTANTES: ", modos_restantes);
            //modo_actual = "palabras bonus";
            MODOS[modo_actual](socket);
        }
    }
    function activar_sockets_extratextuales(socket) {
        // Envía el nombre del jugador 1.

        socket.on('envío_nombre1', (evt1) => {
            socket.broadcast.emit('nombre1', evt1);
        });

        // Envía el nombre del jugador 2.

        socket.on('envío_nombre2', (evt1) => {
            socket.broadcast.emit('nombre2', evt1);
        });

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

        // Envía un comentario.
        socket.on('enviar_comentario', (evt1) => {
            socket.broadcast.emit('recibir_comentario', evt1);
        });

        // Realiza el scroll.
        socket.on('scroll', (evt1) => {
            socket.broadcast.emit('scroll', evt1);
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
                    palabraRAE().then(palabra_bonus => {
                        puntuacion = puntuación_palabra(palabra_bonus[0]);
                        io.emit('enviar_palabra', { modo_actual, palabra_bonus, puntuacion });
                    })
                    cambiar_palabra();
                }, 15000);
        }
    }

    const MODOS = {

        // Recibe y activa la palabra y el modo bonus.
        'palabras bonus': function () {
            log("activado palabras bonus");
            // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.
            console.log("ACTIVADO");
            // activar_socket_nueva_palabra(socket);
            palabraRAE().then(palabra_bonus => {
                console.log("AQUII", palabra_bonus)
                puntuacion = puntuación_palabra(palabra_bonus[0]);
                io.emit('activar_modo', { modo_actual });
                io.emit('enviar_palabra', { modo_actual, palabra_bonus, puntuacion });
            })
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
            letra_prohibida = letras_prohibidas[Math.floor(Math.random() * letras_prohibidas.length)]
            io.emit('activar_modo', { modo_actual, letra_prohibida });
        },

        // Recibe y activa el modo letra prohibida.
        'letra bendita': function (socket) {
            log("activado letra bendita");
            // activar_sockets_feedback();
            letra_bendita = letras_benditas[Math.floor(Math.random() * letras_benditas.length)]
            console.log(letra_bendita)
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
        }
    }

    // Función auxiliar que dada una palabra devuelve una puntación de respecto de la frecuencia.
    function puntuación_palabra(palabra) {
        let puntuación = 0;
        if (palabra != null) {
            palabra = palabra.replace(/\s+/g, '')
            let longitud = palabra.length;
            string_unico(toNormalForm(palabra)).split("").forEach(letra => puntuación += frecuencia_letras[letra]);
            return Math.ceil((((100 - puntuación) + longitud * 0.1 * 100)) / 25) * 25;
        }
        else return 100;
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
            
            // console.log(`Definición de ${first_result.getHeader()}`);
        }
        for (var i = 0; i < definiciones.length; i++) {
            console.log(i)
            if (i < 3) {
                definicion_final += `${i+1}. ${definiciones[i].getDefinition()}<br><br/>`;
                //console.log(`${i+1}. Tipo: ${definiciones[i].getType()}\n`);
                //console.log(`    Definición: ${definiciones[i].getDefinition()}\n\n`);
            }
        console.log("HOLAAA")
        }
    }
    catch {
        return palabraRAE;
    }
    console.log('JAAAAAA',palabra_final, definicion_final)
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

  //Función que, dada una palabra, devuelve su definición en la RAE.
  async function definicion_palabra(palabra) {
    let definicion = ""
    try {
        let search = await rae.searchWord(palabra);
        let first_result = search.getRes()[0];
        let wordId = first_result.getId();
        let result = await rae.fetchWord(wordId);
        let definitions = result.getDefinitions();
        let i = 1;
        
        // console.log(`Definición de ${first_result.getHeader()}`);
        definicion = "";
        while (definitions == "") {
            search = await rae.searchWord(palabra);
            first_result = search.getRes()[0];
            wordId = first_result.getId();
            result = await rae.fetchWord(wordId);
            definitions = result.getDefinitions();
            i = 1;
            
            // console.log(`Definición de ${first_result.getHeader()}`);
            definicion = "";
        }
        for (const definition of definitions) {
            if (i <= 3) {
                definicion += `${i}. ${definition.getDefinition()}<br><br/>`;
                // console.log(`${i}. Tipo: ${definition.getType()}\n`);
                // console.log(`    Definición: ${definition.getDefinition()}\n\n`);
            }
            i++;
        }
    }
    catch {
        return definicion_palabra;
    }
    return definicion;
};
