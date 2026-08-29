# \<SCRI\> B

\<SCRI\> es un videojuego de escritura en vivo creado por la compañía de teatro SUTURA en el cual dos escritores se enfrentan para ver quién escribe el mejor texto. Actualmente se encuentra en desarrollo, por lo que toda ayuda es bienvenida.

## Testing
La documentacion de tests y CI esta en [TESTING.md](./TESTING.md).

## EL JUEGO
A continuación se explica en mayor profundidad el videojuego.
### ROLES 
  - Escritxr: Jugador que se enfrenta al videojuego.
  - Control: Maneja el comportamiento del juego.
  - Espectador: Ilustra a los dos jugadores para que se pueda observar desde terceros.
  ### FUNCIONAMIENTO
  Cuando el juego comience, los escritxres podrán comenzar a escribir. Cada carácter es un punto y, además, si dejan de escribir, el juego comenzará a borrarles su texto; a medida que escriban, el texto se borrará antes y más rápido. Los escritxres deberán conseguir la mayor puntuación posible.
#### MODOS
Cada cierto tiempo, el videojuego propondrá una serie de pruebas a medida que conforman su texto.
##### PALABRAS BENDITAS
Se extraerán palabras aleatorias de la RAE que los jugadoras podrán meter y, a cambio, recibirán una puntuación en concreto en función de la rareza de la palabra. La palabra será la misma para ambos y competirán por meterla.
##### LETRA MALDITA
Se escogerá una de las 10 letras más usadas en el lenguaje español y se prohíbe su uso. Si se escribe, se borra y se resta una cantidad de puntos al jugador.
##### LETRA BENDITA
Se escogerá una de las 10 letras más usadas en el lenguaje español y se premia su uso. Si se escribe se suma una cantidad de puntos al jugador.
##### TEXTO BORROSO
Se difumina de manera aleatoria a uno de los dos jugadores y después de alterna.
## INSTRUCCIONES PARA SU USO
### Desplegar el servidor
1. Descarga el repositorio 3Cejas/server_scrib y accede a ella
2. Instala las dependencias: `npm install`
2. Ejecuta la aplicación: `npm start`
### Comenzar a jugar
3. Descarga el repositorio 3Cejas/players_scrib e inicia el control y los jugadores desde el dashboard de inicio (HTML).
4. Desde control, pulsa el botón 'Escribir' y el juego comenzará.

### Videotutorial previo al tutorial

El servidor mantiene un ciclo autoritativo de vídeo mientras la partida siga en la fase previa al tutorial. Control puede activar la reproducción periódica, elegir su intervalo, reproducirlo en ese momento u ocultarlo. Al iniciar el tutorial o la partida, el servidor detiene el vídeo y cancela cualquier repetición pendiente.

La configuración versionada inicial está en `config/pre_show_video.default.json`. Los cambios realizados por Control se guardan de forma atómica en `data/pre_show_video.json`; se puede cambiar esa ruta con `SCRIB_PRE_SHOW_VIDEO_CONFIG`. El archivo de vídeo no se guarda en este repositorio: debe desplegarse junto al frontend en `game/media/tutorial-scrib.mp4` (en Sutura, `/var/www/dashboard/scrib/game/media/tutorial-scrib.mp4`) o configurarse mediante una URL HTTPS.

Los valores admitidos son de 15 a 86400 segundos para el intervalo y de 3 a 3600 segundos para la duración. La duración inicial es de 120 segundos para respetar la espera de acceso y las pausas de lectura del videotutorial. La reproducción automática viene desactivada hasta que Control la habilite.
## SUTURA
- Twitter: @ SU.TU.RA
- Instagram: @SU_TU_RA
