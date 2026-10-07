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

No se sincroniza automáticamente con la web pública, Instagram, correo o WhatsApp:
crear/editar un bolo aquí no publica su información ni envía mensajes.
La herramienta anterior `/scrib-produccion/` y sus datos se conservan intactos.

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
