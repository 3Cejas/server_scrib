# Mundo <SCRI> B

Aplicación independiente de producción y dramaturgia en `/mundo-scrib/`.
No modifica el servidor del videojuego ni sus partidas. Python 3.10+, SQLite y
JavaScript/CSS sin dependencias de terceros, fuentes remotas ni animaciones continuas.

## Qué incluye

- Inicio: acceso al videojuego y web existentes, salud del servidor, próximos bolos,
  mis tareas, bloqueos, vencimientos y actividad del equipo.
- Kanban de dramaturgia y un tablero por bolo. Arrastre y reordenación de tarjetas
  con ratón o asa táctil; selector de estado para teclado/móvil.
- TO DO, EN PROGRESO, BLOQUEADA, COMPLETADAS; responsables, etiquetas, prioridad,
  fecha límite, motivo del bloqueo, checklist, comentarios e historial.
- Calendario mensual, agenda, exportación ICS (horario Europe/Madrid), ficha de bolo,
  convocatoria del elenco, lugar, horario, información y hoja de llamada imprimible.
- Se pueden crear bolos con fecha y hora pendiente: se muestran como «Hora pendiente»,
  se exportan como fecha (sin inventar las 00:00) y bloquean `{hora}` en WhatsApp hasta
  completarla. Añadir la hora después no duplica ni reinicia las tareas del tablero.
- Fichas reutilizables de personas: nombre completo, especialidades, biografía,
  redes y foto privada. Un papel y equipo diferentes en cada función.
- Plantilla inicial de 34 tareas transcritas de las tres capturas del usuario.
  Todas se crean en TO DO. Plantillas editables/duplicables; los cambios no alteran
  bolos anteriores ni reinician su progreso.
- Archivo recuperable. Archivar/recuperar un bolo opera también sobre su tablero y
  sus tareas, sin recuperar tareas que ya estaban archivadas por separado.
- Actualización compartida cada 15 segundos sin regenerar formularios mientras se
  escribe; conflictos de edición devuelven 409, nunca sobrescriben a otra persona.

## Autenticación y límites

Se conserva exactamente la entrada Sutura/Authentik existente: Nginx hace
forward-auth y `DASHBOARD_AUTH` valida la identidad con su directorio autorizado.
`world_proxy.js` recibe esa sesión, sobrescribe las cabeceras de identidad y usa
un secreto de puente en un archivo 0600. El servicio solo escucha en loopback.
No crea contraseñas, usuarios Authentik ni políticas de acceso nuevas.

Los miembros autorizados de Sutura colaboran sobre todo el espacio SCRIB. La
exportación ZIP completa está reservada a administradores. No se incluyen claves,
cookies, hashes de contraseña ni secretos en el estado ni en la exportación.
Las fichas del elenco NO son cuentas de acceso.

Mutaciones: JSON y tamaño máximo 6 MB; origen permitido + token CSRF firmado,
vinculado a usuario y cookie HttpOnly/Secure/SameSite=Strict. El token se reutiliza
entre pestañas para no invalidar formularios. Fotos PNG/JPG/WebP de hasta 4 MB,
guardadas fuera del árbol público y servidas tras autenticación. Sin SVG ni HTML.
Todo texto aportado se escapa en el cliente; CSP no permite scripts inline,
iframes externos ni objetos. Enlaces exclusivamente HTTPS, sin credenciales.

No se sincroniza automáticamente con la web pública, Instagram o correo:
crear/editar un bolo aquí no publica su información ni envía mensajes.
La herramienta anterior `/scrib-produccion/` y sus datos se conservan intactos.

## WhatsApp y fichas privadas del elenco

- Teléfono con prefijo internacional en cada ficha. Los números y la procedencia
  del grupo solo se sirven tras autenticación; no aparecen en la web pública o Git.
- Las fichas no muestran avisos de revisar identidad ni su procedencia de importación.
  Se conservan el historial de participaciones y los metadatos internos para recuperación
  e importaciones sin duplicados. La comprobación del teléfono para enviar sigue activa.
- Confirmar explícitamente que el número corresponde a esa persona antes de enviar.
  Cambiar el teléfono en la interfaz desmarca su confirmación.
- Sección **WhatsApp**, botón en cada persona y botón **WhatsApp al elenco** en el bolo.
  Selección explícita de hasta 50 destinatarios, sin seleccionar a todos por defecto.
- Variables permitidas: `{nombre}`, `{nombre_completo}`, `{bolo}`, `{fecha}`, `{hora}`,
  `{lugar}`, `{convocatoria}`, `{papel}`. Datos ausentes o variables desconocidas bloquean
  la vista previa. Los destinatarios de un bolo deben formar parte de su elenco.
- La vista previa guarda el texto y teléfono exactos, pertenece al usuario que la creó
  y caduca en 15 minutos. Cada tarjeta requiere confirmación y un clic de envío.
- Se reserva el envío en SQLite ANTES de contactar con WhatsApp. Dobles clics, peticiones
  concurrentes y reintentos no duplican un envío. Un fallo o reinicio durante el envío
  queda **sin confirmar**: revisar WhatsApp, nunca reintentar automáticamente.
- Cambios de persona/teléfono/bolo después de la vista previa obligan a regenerarla.
- Historial de los últimos 20 borradores del usuario. La copia ZIP de administración
  incluye borradores y estados de envío, pero nunca el token del puente.
- `sent` significa confirmación del puente, no confirmación de entrega/lectura del móvil.
- Ensayo local bloquea los envíos reales aunque exista el puente en ese equipo.

`whatsapp.py` reutiliza el puente existente de Impropios (loopback 5118).
Lee su `config.json` y `config.local.json` en el servidor, nunca desde el navegador;
no permite hosts externos, proxies heredados ni redirecciones. Se puede cambiar el
archivo mediante `SCRIB_WORLD_WHATSAPP_CONFIG`. El estado público solo devuelve
configurado/conectado y un texto seguro, no cuenta, QR, teléfono ni otros chats.

El 8 de octubre de 2026 se detectó el error minificado `r` de `getChats()` en la
dependencia instalada: renombrado de `_serialized` a `$1` en MsgKey. El parche mínimo
revisado de `patch_whatsapp_compat.py` restaura solo el accessor del prototipo (referencia:
https://github.com/wwebjs/whatsapp-web.js/pull/201871). No modifica IDs cifrados ni la
sesión. Copia anterior en el puente: `Utils.js.before-scrib-20261008`.
Tras reinstalar dependencias, comprobar si sigue siendo necesario antes de reaplicarlo.

`import_cast.py` importa SOLO el grupo de León solicitado a partir de una copia privada,
con ID del grupo verificado. Nunca envía mensajes. Lee `scheduleSections` como datos
con un parser restrictivo: no ejecuta el JavaScript descargado de scribshow.es.
Coincidencias exactas de nombre completo (incluyendo pushname), sin asignar identidades
por un primer nombre/apodo. Otras correspondencias requieren un mapping privado revisado.
Cada ficha enlaza sus participaciones públicas con fecha, sala, papel y equipo solo si
se publicó. No se inventan horarios ni equipos; no crea tareas de preparación de bolos
pasados. Importación idempotente por hash de grupo+integrante; conserva notas/foto/redes.

```bash
python3 import_cast.py --data /RUTA/PRIVADA --roster /RUTA/PRIVADA/leon.json \
  --schedule /RUTA/main.js
# Primero revisar el informe. Añadir --apply para crear/actualizar las fichas.
# --mapping /RUTA/PRIVADA/nombres.json solo para identidades confirmadas por el equipo.
```

## Pruebas locales

```bash
python3 -m unittest discover -s tools/scrib-world -p 'test_world.py' -v
node --check tools/scrib-world/public/app.js
node --check tools/scrib-world/world_proxy.js
python3 tools/scrib-world/server.py --demo --port 5131 --data /tmp/scrib-world-demo
```

Abrir `http://127.0.0.1:5131/mundo-scrib/`. El modo demo solo escucha en localhost,
avisa claramente, crea datos ficticios y no consulta el videojuego. Nunca usar
`--demo` en producción. Las pruebas HTTP utilizan secretos y usuarios ficticios
en directorios temporales, no credenciales del servidor.

## Despliegue de Sutura

Código: `/home/trescejas/dockers/scrib-world/`.
Datos: `/home/trescejas/dockers/scrib-world-data/` (fuera de Git).
Servicio PM2 `SCRIB_WORLD`, puerto loopback 5124, config `ecosystem.config.js`.

Integración mínima en `/home/trescejas/dockers/dashboard-auth/server.js`:
`integrate.py dashboard ORIGINAL DESTINO` añade el puente antes de las rutas
Sutura y una tarjeta en el portal. No se reemplaza todo el panel por una copia
antigua: comprobar SHA256 del original, guardar copia, validar JS y aplicar el
archivo transformado. `integrate.py gateway ORIGINAL DESTINO` añade también la
tarjeta al portal estático de la Raspberry (`/srv/sutura-front/index.html`).
Ambos transformadores fallan si el HTML/rutas han cambiado inesperadamente.

La tarjeta del selector utiliza el logo original de los signos y la pluma, sin
subtítulo. Copiar `assets/scrib-world-logo.png` a `/srv/sutura-front/favicons/` en
el gateway y `/var/www/dashboard/favicons/` en el backend. Es el PNG original
de `players_scrib/img/logo.png`, sin modificar. Para actualizar un selector ya
instalado, `integrate.py selector ORIGINAL DESTINO` sustituye únicamente la
tarjeta y su CSS conocidos, preservando el puente de autenticación y otros mundos.

Nginx ya protege `/mundo-scrib/` a través de su `location /` con el snippet de
Authentik. No necesita cambios de Nginx ni nuevas políticas. El gateway lo
proxya por su ruta general y conserva su pantalla de encendido del servidor.

1. Copiar código al backend, sin cachés, bases de datos ni secretos de desarrollo.
2. Ejecutar pruebas en Python 3.10 del backend y comprobar puerto 5124 libre.
3. `pm2 start /home/trescejas/dockers/scrib-world/ecosystem.config.js` (sin demo).
4. Comprobar 401 sin puente en `http://127.0.0.1:5124/mundo-scrib/api/state`.
5. Aplicar puente con copia previa y comprobación de hash; reiniciar únicamente
   `DASHBOARD_AUTH`, NO `SCRIB` ni los otros mundos.
6. Comprobar acceso anónimo redirige a Authentik incluso enviando cabeceras falsas;
   probar entrada normal con usuario existente, persistencia y vista móvil.
7. Añadir tarjeta al gateway mediante sustitución atómica y copia previa.
8. `pm2 save` conserva el nuevo servicio en el próximo arranque.

Rollback: restaurar SOLO las copias previas del `server.js` y la entrada HTML,
reiniciar `DASHBOARD_AUTH` y parar `SCRIB_WORLD`. NO borrar el directorio de datos.

## Dónde están los datos / recuperación

- `world.sqlite3`: fichas, tareas, posiciones, comentarios, responsables e historial.
- `images/`: fotos privadas, identificadas por SHA256.
- `backups/world-YYYY-MM-DD.sqlite3`: copia consistente automática antes de la
  primera escritura de cada día. Sin eliminación automática de copias antiguas.
- `bridge-secret`: únicamente credencial local del puente; no es parte del ZIP.

Desde Archivo, administración puede descargar un ZIP con `mundo-scrib.json`
(incluye archivados, comentarios e historial) y todas las fotos. Es una copia
portable; no contiene credenciales. La restauración operativa usa la copia SQLite:
parar SOLO `SCRIB_WORLD`, preservar la DB actual con su WAL/SHM, copiar la copia
elegida como `world.sqlite3` (modo 0600), y volver a iniciar `SCRIB_WORLD`.
Las fotos deben conservarse o recuperarse del ZIP. No mezclar un WAL viejo con una
DB restaurada. Una restauración requiere elegir la copia y verificar su fecha.
