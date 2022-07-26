
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

var nombre_modos = ["palabras bonus","letra prohibida"]
var modos = new Map();
modos.set("palabras bonus", false);
modos.set("letra prohibida", false);
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
        if (evt1 == "00:00"){
            limpiar_modo_de_juego()
            terminado = true;
        }
        if (evt1 == "00:20"){
            modos_de_juego()
        }
        if (evt1 == "00:10"){
            limpiar_modo_de_juego()
            modos_de_juego()
        }
        else{
            terminado = false;
        }
    socket.broadcast.emit('count', evt1);
    });

    // Envía el nombre del jugador 1.

    socket.on('nombre1', (evt1) => {
        socket.broadcast.emit('nombre1', evt1);
        
    });

    // Envía el nombre del jugador 2.

    socket.on('nombre2', (evt1) => {
        socket.broadcast.emit('nombre2', evt1);
    });

    // Comienza el juego.

    socket.on('inicio', (evt1) => {
        terminado = false;
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

    /* 
        Envía los temas elegidos aleatoriamente
        Para que también aparezcan en la pantalla
        del jugador 2. 
    */

    socket.on('envia_temas', (evt1) => {
        socket.broadcast.emit('recibe_temas', evt1);
    });

    // Inicia las palabras bonus cuando comienza el juego.

    /*if(!terminado){
        cambiar_palabra();
    }*/
    // Cambia la palabra bonus si alguno de los jugadores ha acertado la palabra.

    socket.on('nueva_palabra', (evt1) => {
        clearTimeout(cambio_palabra);
        if(terminado == false){
        puntuacion = puntuaciones_palabra[Math.floor(Math.random() * puntuaciones_palabra.length)];
        palabraRAE().then(palabra_bonus => io.emit('compartir_palabra', {palabra_bonus, puntuacion, modo_actual}));
        cambiar_palabra();
        }
    });

    //Función auxiliar recursiva que cambia los modos del juego a lo largo de toda la partida.
    function modos_de_juego(){
        if(terminado == false){
        console.log("AQUIsíentrooooo")  
            modo_actual = nombre_modos[Math.floor(Math.random() * nombre_modos.length)];
            switch (modo_actual){
                case "palabras bonus":
                    log("activado palabras bonus");
                    puntuacion = puntuaciones_palabra[Math.floor(Math.random() * puntuaciones_palabra.length)];
                    console.log("AQUIsí")  
                    palabraRAE().then(palabra_bonus => io.emit('compartir_palabra', {palabra_bonus, puntuacion, modo_actual}));
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
            }
    }
    }
    function limpiar_modo_de_juego(){
        log("limpio " + modo_actual)
        switch (modo_actual){
            case "palabras bonus":
                clearTimeout(cambio_palabra);
                break;
            case "letra prohibida":
                letra_prohibida = "";
                modo_letra_prohibida = false;
                break;
        }
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
                puntuacion = puntuaciones_palabra[Math.floor(Math.random() * puntuaciones_palabra.length)];
                console.log("AQUI")  
                palabraRAE().then(palabra_bonus => io.emit('compartir_palabra', {palabra_bonus, puntuacion, modo_actual}));
                cambiar_palabra();
            }, 5000);
        }
    }
});

// Da retroalimentación cuando se ha conectado con el ciente.

io.on('disconnect', evt => {
    log('Un escritxr ha abandonado la partida.');
});

// Buscador de palabra aletoria y su definición en la RAE.

async function palabraRAE(){
    word = await rae.getRandomWord();
	let search = await rae.searchWord(word);
	let first_result = search.getRes()[0];
	let wordId = first_result.getId();
	let result = await rae.fetchWord(wordId);
	let definitions = result.getDefinitions();
	let i = 1;
	console.log(`Definición de ${first_result.getHeader()}`);
    let definicion = "";
    while(definitions == ""){
        word = await rae.getRandomWord();
        search = await rae.searchWord(word);
        first_result = search.getRes()[0];
        wordId = first_result.getId();
        result = await rae.fetchWord(wordId);
        definitions = result.getDefinitions();
        i = 1;
        //console.log(`Definición de ${first_result.getHeader()}`);
        definicion = "";
    }
	for (const definition of definitions) {
        if(i <= 3){
        definicion += `${i}. ${definition.getDefinition()}<br><br/>`;
        //console.log(`${i}. Tipo: ${definition.getType()}\n`);
		//console.log(`    Definición: ${definition.getDefinition()}\n\n`);
        }
		i++;
    }
    return [word,definicion];
    
};