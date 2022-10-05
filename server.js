
const { LOADIPHLPAPI } = require('dns');
const { RAE } = require('rae-api'); //Define el constructor del buscador de la RAE.
const debug = false; // Modo desarrollador de rae-api.
const rae = new RAE(debug); //Creamos una instancia del buscador de la RAE.
const log = console.log; // Define la consola del servidor.
const http = require("http").createServer(); // Define el servidor http.
const io = require("socket.io")(http); // Define el socket.
const port = process.env.PORT || 3000; // Define el puerto de comunicación con el servidor (puede ser o, el puerto dado por el entorno, o el 8000 si no lo encuentra).


let cambio_palabra = false; // Variable que almacena el temporizador de cambio de palabra bonus.
var terminado = true; // Variable booleana que indica si el juego ha empezado o no.
let puntuaciones_palabra = [50,75,100,125,150,175,200] // Variable que almacena las posibles puntuaciones de las palabras bonus.
let tiempo = "";
// Variables del modo letra prohibida.

let modo_letra_prohibida = false;
let modo_actual = "";
let letra_prohibida = "";
const alfabeto = "eaosrnidlc"


const nombre_modos = ["palabras bonus","letra prohibida", "texto borroso", "psicodélico", "texto inverso"]
var modos_restantes = ["palabras bonus","letra prohibida", "texto borroso", "psicodélico", "texto inverso"]
var modos = new Map();
modos.set("palabras bonus", false);
modos.set("letra prohibida", false);

const frecuencia_letras = {
    'a' : 12.53,
    'b' : 1.42,
    'c' : 4.68,
    'd' : 5.86,
    'e' : 13.68,
    'f' : 0.69,
    'g' : 1.01,
    'h' : 0.7,
    'i' : 6.25,
    'j' : 0.44,
    'k' : 0.02,
    'l' : 4.97,
    'm' : 3.15,
    'n' : 6.71,
    'ñ' : 0.31,
    'o' : 8.68,
    'p' : 2.51,
    'q' : 0.88,
    'r' : 6.87,
    's' : 7.98,
    't' : 4.63,
    'u' : 3.93,
    'v' : 0.90,
    'w' : 0.01,
    'x' : 0.22,
    'y' : 0.90,
    'z' : 0.52

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
    
    // Envía el contador de tiempo.

    socket.on('count', (evt1) => {
        tiempo = evt1;
        console.log(tiempo);
        console.log(terminado);
        if (evt1 == "¡Tiempo!"){
            //limpiar_modo_de_juego()
            terminado = true;
            modos_restantes = ["palabras bonus","letra prohibida", "texto borroso", "psicodélico", "texto inverso"];
        }
        if (evt1 == "00:00"){
            terminado = true;
            modos_restantes = ["palabras bonus","letra prohibida", "texto borroso", "psicodélico", "texto inverso"];
        }
        if (evt1 == "05:30"){
            modos_de_juego()
        }
        if (evt1 == "04:30"){
            limpiar_modo_de_juego()
            modos_de_juego()
        }
        if (evt1 == "03:30"){
            limpiar_modo_de_juego()
            modos_de_juego()
        }
        if (evt1 == "02:30"){
            limpiar_modo_de_juego()
            modos_de_juego()
        }
        if (evt1 == "00:40"){
            limpiar_modo_de_juego()
            modos_de_juego()
        }
        if (evt1 == "00:30"){
            limpiar_modo_de_juego()
            activar_modo_emplatar()
        }
        else{
            terminado = false;
        }
    socket.broadcast.emit('count', evt1);
    });

    // Envía el nombre del jugador 1.

    socket.on('nombre1', (evt1) => {
        console.log(evt1)
        socket.broadcast.emit('nombre1', evt1);
        
    });

    // Envía el nombre del jugador 2.

    socket.on('nombre2', (evt1) => {
        socket.broadcast.emit('nombre2', evt1);
    });

    // Comienza el juego.

    socket.on('inicio', (evt1) => {
        terminado = false;
        modos_restantes = ["palabras bonus","letra prohibida", "texto borroso", "psicodélico", "texto inverso"];
        socket.broadcast.emit('inicio', evt1);
    });

    // Abre la pestaña de la votación.

    socket.on('vote', (evt1) => {
        socket.broadcast.emit('vote', evt1);
    });

    // Cierra la pestaña de votación.

    socket.on('exit', (evt1) => {
        socket.broadcast.emit('exit', evt1);
    });

    // Envía la lista de temas y elige aleatoriamente uno de ellos.

    socket.on('temas', (evt1) => {
        socket.broadcast.emit('temasj1', evt1);
    });

    // Resetea el tablero de juego.

    socket.on('limpiar', (evt1) => {
        clearTimeout(cambio_palabra);
        terminado = true;
        modos_restantes = ["palabras bonus","letra prohibida", "texto borroso", "psicodélico", "texto inverso"];
        ;
        socket.broadcast.emit('limpiar', evt1);
    });

    // Realiza scroll hacia arriba.

    socket.on('subir', (evt1) => {
        socket.broadcast.emit('subir', evt1);
    });

    // Realiza scroll hacia abajo.

    socket.on('bajar', (evt1) => {
        socket.broadcast.emit('bajar', evt1);
    });

    socket.on('limpiar_psico', (evt1) => {
        socket.broadcast.emit('limpiar_psicodélico', evt1);
    });

    socket.on('limpiar_inverso', (evt1) => {
        socket.broadcast.emit('limpiar_texto_inverso', evt1);
    });
    /* 
        Envía los temas elegidos aleatoriamente
        Para que también aparezcan en la pantalla
        del jugador 2. 
    */

    socket.on('envia_temas', (evt1) => {
        socket.broadcast.emit('recibe_temas', evt1);
    });

    socket.on('psico_de_j1', (evt1) => {
        socket.broadcast.emit('psico_a_j2', evt1);
    });

    socket.on('psico_de_j2', (evt1) => {
        socket.broadcast.emit('psico_a_j1', evt1);
    });

    socket.on('feedback_de_j1', (evt1) => {
        socket.broadcast.emit('feedback_a_j2', evt1);
    });

    socket.on('feedback_de_j2', (evt1) => {
        socket.broadcast.emit('feedback_a_j1', evt1);
    });

    // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.
    socket.on('nueva_palabra', (evt1) => {
        clearTimeout(cambio_palabra);
        if(terminado == false){
        palabraRAE().then(palabra_bonus => {
            puntuacion = puntuación_palabra(palabra_bonus[0]);
            io.emit('compartir_palabra', {palabra_bonus, puntuacion, modo_actual});
            })
        cambiar_palabra();
        }
    });

    //Función auxiliar recursiva que cambia los modos del juego a lo largo de toda la partida.
    function modos_de_juego(){
        if(terminado == false){
            console.log("ANTES: "+modos_restantes);
            let indice_modo = Math.floor(Math.random() * modos_restantes.length)
            modo_actual = modos_restantes[indice_modo];
            console.log("MODO ACTUAL: "+ modo_actual);
            modo_actual = "psicodélico"
            modos_restantes.splice(indice_modo, 1);
            console.log(modos_restantes);
            switch (modo_actual){
                case "palabras bonus":
                    log("activado palabras bonus");
                    palabraRAE().then(palabra_bonus => {
                    puntuacion = puntuación_palabra(palabra_bonus[0]);
                    io.emit('compartir_palabra', {palabra_bonus, puntuacion, modo_actual});
                        })
                    cambiar_palabra();
                    /*setTimeout(function(){
                        clearTimeout(cambio_palabra);
                        modos_de_juego();
                    }, 5000);*/
                    break;
                case "letra prohibida":
                    log("activado letra prohibida");
                    letra_prohibida = alfabeto[Math.floor(Math.random() * alfabeto.length)]
                    io.emit('letra_prohibida', letra_prohibida);
                    /*setTimeout(function(){
                        clearTimeout(cambio_palabra);
                        modo_letra_prohibida = false;
                        modos_de_juego();
                    }, 5000);*/
                    break;
                case "texto borroso":
                    io.emit('texto_borroso', Math.floor(Math.random() * 2) + 1);
                    break;
                case "psicodélico":
                    io.emit('psicodélico');
                    break;
                    case "texto inverso":
                        io.emit('texto_inverso');
                        break;
            }
    }
    }
    function limpiar_modo_de_juego(){
        log("limpio " + modo_actual)
        if(modos_restantes.length != 0){
        switch (modo_actual){
            case "palabras bonus":
                clearTimeout(cambio_palabra);
                io.emit('limpiar_palabras_bonus');
                break;
            case "letra prohibida":
                letra_prohibida = "";
                modo_letra_prohibida = false;
                io.emit('limpiar_letra_prohibida');
                break;
            case "texto borroso":
                modo_letra_prohibida = false;
                io.emit('limpiar_texto_borroso');
                break;
            case "psicodélico":
                io.emit('limpiar_psicodélico');
                break;
            case "texto inverso":
                io.emit('limpiar_texto_inverso');
                break;
        }
    }
    }

    //Función auxiliar que activa el modo emplatar en los jugadores.
    function activar_modo_emplatar(){
        io.emit('modo_emplatar');
    }
    
    //Función auxiliar recursiva que elige palabras bonus, las envía a jugador 1 y 2 y las cambia cada x segundos.
    function cambiar_palabra(){
        if(terminado == true && modo_actual != "palabras bonus"){
            clearTimeout(cambio_palabra);
        }
        if(terminado == false){
            clearTimeout(cambio_palabra);
            cambio_palabra = setTimeout(
            function(){
                palabraRAE().then(palabra_bonus => {
                    puntuacion = puntuación_palabra(palabra_bonus[0]);
                    io.emit('compartir_palabra', {palabra_bonus, puntuacion, modo_actual});
                    })
                cambiar_palabra();
            }, 25000);
        }
    }

    //Función auxiliar que dada una palabra devuelve una puntación de respecto de la frecuencia.
    function puntuación_palabra(palabra){
        let puntuación = 0;
        if(palabra != null){
        palabra = palabra.replace(/\s+/g, '')
        let longitud = palabra.length;
        string_unico(toNormalForm(palabra)).split("").forEach(letra => puntuación +=frecuencia_letras[letra]);
        console.log(puntuación)
        console.log(longitud*0.1 *100)
        return Math.ceil((((100 - puntuación) + longitud*0.1* 100)  )/25)*25;
        }
        else return 100;
    }
    function string_unico(names)
{
    string="";
    ss="";
    console.log(names)
    namestring=names.split("");

    for(j=0;j<namestring.length;j++) {
        for(i=j;i<namestring.length;i++) {
            if(string.includes(namestring[i])) // if contains not work then  
                break;                         //use includes like in snippet
            else
                string+=namestring[i];
         }
         if(ss.length<string.length)
             ss=string;
         string="";
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

async function palabraRAE(){
    let word = ""
    let definicion = ""
    try{
    word = await rae.getRandomWord();
	let search = await rae.searchWord(word);
	let first_result = search.getRes()[0];
	let wordId = first_result.getId();
	let result = await rae.fetchWord(wordId);
	let definitions = result.getDefinitions();
	let i = 1;
	console.log(`Definición de ${first_result.getHeader()}`);
    definicion = "";
    while(definitions == ""){
        word = await rae.getRandomWord();
        search = await rae.searchWord(word);
        first_result = search.getRes()[0];
        wordId = first_result.getId();
        result = await rae.fetchWord(wordId);
        definitions = result.getDefinitions();
        i = 1;
        console.log(`Definición de ${first_result.getHeader()}`);
        definicion = "";
    }
	for (const definition of definitions) {
        if(i <= 3){
        definicion += `${i}. ${definition.getDefinition()}<br><br/>`;
        console.log(`${i}. Tipo: ${definition.getType()}\n`);
		console.log(`    Definición: ${definition.getDefinition()}\n\n`);
        }
		i++;
    }
    }
    catch{
        return palabraRAE;
    }
    return [word,definicion];
    
};
