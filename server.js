const { RAE } = require('rae-api'); //Define el constructor del buscador de la RAE.
const debug = false; // Modo desarrollador de rae-api.
const rae = new RAE(debug); //Creamos una instancia del buscador de la RAE.
const log = console.log; // Define la consola del servidor.
const http = require("http").createServer(); // Define el servidor http.
const io = require("socket.io")(http); // Define el socket.
const port = process.env.PORT || 3000; // Define el puerto de comunicación con el servidor (puede ser o, el puerto dado por el entorno, o el 8000 si no lo encuentra).

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

    // Envía la palabra bonus aleatoria al jugador 2.
 /*   
    socket.on('envio_palabra', (evt1) => {
        socket.broadcast.emit('envio_palabra', evt1);
    });
*/
    // Envia la definiciones de la palabra. enviada.

    socket.on('envio_palabra1', (evt1) => {
        definicion_palabra(evt1).then(value => socket.broadcast.emit('envio_definicion1', value));
        
    });

    socket.on('envio_palabra2', (evt1) => {
        definicion_palabra(evt1).then(value => socket.broadcast.emit('envio_definicion2', value));
        
    });

    socket.on('envio_palabra1', (evt1) => {
        socket.broadcast.emit('recibe_palabra2', evt1);
        
    });

    socket.on('envio_palabra2', (evt1) => {
        socket.broadcast.emit('recibe_palabra1', evt1);
        
    });

});

// Da retroalimentación cuando se ha conectado con el ciente.

io.on('disconnect', evt => {
    log('Un escritxr ha abandonado la partida.');
});

// Buscador de definiciones en la RAE de una palabra.

async function definicion_palabra(palabra){
	const search = await rae.searchWord(palabra);
	const first_result = search.getRes()[0];

	const wordId = first_result.getId();
	const result = await rae.fetchWord(wordId);
	const definitions = result.getDefinitions();
	let i = 1;
	console.log(`Definición de ${first_result.getHeader()}`);
    let definicion = "";
	for (const definition of definitions) {
        if(i <= 3){
        definicion += `${i}. ${definition.getDefinition()}<br><br/>`;
        console.log(`${i}. Tipo: ${definition.getType()}\n`);
		console.log(`    Definición: ${definition.getDefinition()}\n\n`);
        }
		i++;
    }
    return definicion;
    
};