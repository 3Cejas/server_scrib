# Mundo <SCRI> B

Aplicación independiente de producción y dramaturgia en `/scrib/`.
Guardar datos aquí no modifica las partidas del videojuego. Python 3.10+, SQLite y
JavaScript/CSS sin fuentes remotas ni animaciones continuas. El render de PDFs
usa ReportLab y pypdf (requirements.txt), instalados de forma aislada en
`SCRIB_WORLD_DATA/python-packages`; no cambia el Python del sistema.

## Producción y PDFs

- Inventario azul/rojo: dos kits completos, con selección de objetos al exportar.
  Cada bolo incluye por defecto todos los objetos activos, salvo selección explícita.
  Se preservan los datos antiguos de ubicación/responsable sin mostrarlos.
- La ampliación solicitada se aplica una sola vez con `inventory_teams.py`, dentro
  de una transacción y con recibo en `requests`. No resucita objetos archivados ni
  reemplaza fotos manuales. Fotografías de catálogo y URLs en
  `inventory_references.json`; las referencias no acreditan compras ni existencias.
- `POST /scrib/backstage/api/pdf` requiere identidad y CSRF. Inventario, hoja de
  llamada, técnica y memoria llevan el logo; acuerdos/facturas requieren admin.
  El render nunca descarga URLs ni acepta rutas de archivo aportadas por clientes.
- Todos los PDF generados usan fondo negro y la estética de la cabecera del
  informe del videojuego: logos originales de SCRIB y Sutura, título blanco y
  línea azul/roja. La marca de agua es el logo de los signos y la pluma, al 5,5%
  de opacidad. El pie lleva iconos vectoriales para redes, web, correo, aviso,
  referencia y fecha, con enlaces a `@scrib_show`, `@su.tu.ra`, `scribshow.es` y
  `scribaleatorio@gmail.com`. Se numeran solo con un número. Inventario y checklist
  técnica se presentan en tarjetas a dos columnas con casillas vectoriales;
  las notas largas fluyen completas a continuación sin truncarse. Fondo negro
  significa mayor consumo de tinta al imprimir. Los PDF firmados que se suben no
  se reescriben ni se alteran: este diseño no afecta a sus firmas existentes.
- Trazabilidad privada: cada exportación se vincula al usuario autenticado mediante
  una referencia aleatoria y un sello HMAC-SHA-256 en metadatos. El PDF no contiene
  su nombre/usuario; el registro privado `document_exports` guarda identidad, fecha,
  tipo y hashes. **Materiales → Comprobar PDF**, solo para administración, identifica
  al exportador del original y comprueba sus bytes. Si se ha modificado, no atribuye
  los cambios al exportador. No es una firma digital certificada ni un mecanismo
  anticopia: imprimir, reexportar o borrar la marca puede impedir reconocerlo.
- Respaldar juntos `world.sqlite3` y `document-trace.key` (32 bytes, modo 0600),
  dentro de `SCRIB_WORLD_DATA`. El ZIP administrativo incluye el registro JSON y
  la clave, no una DB SQLite; tratar ese ZIP como secreto y conservarlo cifrado.
  Una copia diaria solo de SQLite no sustituye la clave. Al recuperar, copiar también la misma clave
  privada, sin sustituirla por una nueva; una clave perdida no se regenera al
  verificar. Los PDF antiguos no se presentan como documentos verificados.
- La comprobación admite hasta 16 MiB de PDF (23 MiB en base64/JSON). Al desplegar,
  aplicar `document_routes.py nginx ORIGEN CANDIDATO` y el equivalente
  `gateway-nginx`, con copia previa y `nginx -t`, antes de activar la función.
  Se añade una sola ruta exacta, con el mismo forward-auth/encendido que backstage;
  ni los formularios públicos ni las demás mutaciones amplían su límite.
  Publicar también `world_proxy.js` y reiniciar únicamente `DASHBOARD_AUTH`.
- Reparto mínimo visible: escritura e interpretación por equipo, presentador,
  técnica y jurado. Se permiten borradores incompletos. Solo escritura e
  interpretación muestran selector de equipo; los demás roles son generales.
- Comunicación: vista previa y envío individual o lote, sin casilla de confirmación
  por destinatario. Se mantienen autoría, caducidad, versión del teléfono/bolo,
  CSRF y reserva durable para que un resultado incierto no se reintente solo.
- Archivo recuperable se encuentra dentro de Tareas. El menú tiene una sola
  cabecera con el logo y el indicador de conexión, sin repetir el nombre de la
  sección encima del contenido. El cierre de sesión sigue accesible en móvil.
  La conexión al lado de SCRIB
  pertenece al backstage, no confirma la sesión del videojuego.

Verificación: `python -m unittest discover -s tools/scrib-world`, con ReportLab y
pypdf disponibles; `node --test --test-isolation=none tools/scrib-world/test_*.cjs`.
Renderizar los PDFs con `pdftoppm` e inspeccionarlos antes de desplegar.

## App Android

`android-app/` contiene la app privada Android 8+, con el enfoque WebView de
Impropios y firma de instalación independiente. Abre el gateway de `/scrib/`,
mantiene la sesión, integra atrás, teclado, fotos/documentos y guardado de PDFs
mediante el selector de Android. Materiales ofrece la APK firmada; el archivo y
su información de versión requieren autenticación. No incorpora notificaciones
ni conexiones en segundo plano. Ver `android-app/README.md` para compilar, proteger
la clave de instalación y las pruebas necesarias en un dispositivo real.

## Qué incluye

- Menú lateral: acceso a `scribshow.es` e indicador del servidor del videojuego,
  independiente del testigo de conexión del backstage. Permanece accesible también
  en móvil; Inicio ya no repite esta tarjeta.
- Inicio: calendario a todo el ancho disponible y próximos bolos debajo,
  mis tareas, bloqueos, vencimientos y actividad del equipo.
- **Tareas** reúne los tableros de dramaturgia, programación y producción, con
  tarjetas clicables y lápiz de edición independiente. Logo original de SCRIB
  en cabecera y favicon; sin los accesos a Mundo Sutura, cambiar mundo o videojuego.
  La autenticación sigue siendo la misma, aunque se retira su texto de la interfaz.
- Kanban de tareas y un tablero por bolo. Arrastre y reordenación de tarjetas
  con ratón o asa táctil; flechas entre columnas para teclado/móvil, sin
  desplegables de estado. Editar conserva la columna actual. Las tarjetas toman
  el color de su columna y muestran cada responsable con un chip de nombre.
- TO DO, EN PROGRESO, BLOQUEADA, COMPLETADAS; responsables, etiquetas, prioridad,
  fecha límite, motivo del bloqueo, checklist, comentarios e historial.
- Dependencias explícitas entre tareas de cualquier tablero. La tarjeta muestra
  quién la bloquea y, en el tablero de origen, qué tareas desbloquea, con enlaces.
  Añadir un requisito pendiente coloca la tarea en BLOQUEADA; no se puede
  comenzar/completar hasta resolverlo o retirarlo. Cuando se resuelve, aparece
  «Puedes reanudar», sin borrar bloqueos manuales ni moverla automáticamente.
  Reabrir un requisito bloquea los trabajos dependientes sin terminar. Se rechazan
  círculos y ediciones obsoletas. Archivar/eliminar un requisito pendiente no
  libera el bloqueo silenciosamente: hay que retirarlo.
- Calendario mensual, agenda, exportación ICS (horario Europe/Madrid), ficha de bolo,
  convocatoria del elenco, lugar, horario, información y hoja de llamada imprimible.
- Se pueden crear bolos con fecha y hora pendiente: se muestran como «Hora pendiente»,
  se exportan como fecha (sin inventar las 00:00) y bloquean `{hora}` en WhatsApp hasta
  completarla. Añadir la hora después no duplica ni reinicia las tareas del tablero.
- Fichas reutilizables de personas: nombre completo, especialidades, biografía,
  redes y foto privada. Un papel y equipo diferentes en cada función.
- Fichas visuales con tarjetas de teléfono y `@usuario` de Instagram, enlaces
  directos y roles con iconos y etiquetas seleccionables (varios por persona).
  El campo Instagram admite un arroba o una URL. Los roles nuevos se validan
  contra el catálogo; los antiguos fuera del catálogo se conservan al editar.
- Color de identidad estable por UUID, independiente del equipo azul/rojo y del
  nombre. Elenco, reparto, inventario, disponibilidad y gestión utilizan la misma
  paleta de 24 tonos; puede elegirse desde la ficha y queda incluido en las copias
  de seguridad. Las fichas existentes reciben un color automático sin migración.
  La hoja de ruta agrupa los equipos y diferencia sus secciones por color, sin
  animaciones continuas. Los nombres siguen visibles y legibles al imprimir.
- «Abrir web» abre `https://scribshow.es/`, no el propio backstage. Se retiran los
  accesos duplicados a la web y «Producción anterior», sin borrar datos antiguos.
- Cada ficha muestra sus bolos realizados y permite abrir el bolo o su mes del
  calendario. Se cuenta una participación por función, aunque tenga varios papeles.
  Solo se cuentan bolos realizados, no cancelados/archivados ni fechas futuras;
  el elenco del calendario prevalece sobre el historial antiguo. El mes se puede
  elegir directamente, sin recorrer todos los meses desde el presente.
- Las tarjetas del elenco abren una ficha de detalle al pulsarlas. En el listado
  aparece Instagram con su logo, pero no el teléfono ni el historial duplicado;
  los contactos y las participaciones están dentro de la ficha. Se retiran los
  botones de WhatsApp y Archivar de las personas, y los campos visibles de web y
  otras redes, conservando esos enlaces guardados al editar.
- Cada objeto del inventario es un botón accesible de edición de toda la tarjeta,
  sin lápiz aparte. Se retiran del editor el enlace de producto y la casilla de
  imagen de referencia; editar otros datos conserva las referencias existentes.
- Plantilla inicial de 34 tareas transcritas de las tres capturas del usuario.
  Todas se crean en TO DO. Plantillas editables/duplicables; los cambios no alteran
  bolos anteriores ni reinician su progreso.
- Archivo recuperable. Archivar/recuperar un bolo opera también sobre su tablero y
  sus tareas, sin recuperar tareas que ya estaban archivadas por separado.
- Papelera en cada ticket y en su ficha: eliminación definitiva con confirmación,
  versión y token idempotente. Borra comentarios/checklist y limpia el contenido
  de los recibos de operaciones; los reintentos no resucitan la tarea.
  Cancelar conserva el borrador. Se mantiene Archivar como alternativa recuperable.
  No se puede eliminar un tablero/bolo/persona mediante esta operación.
  Una tarea eliminada no aparece en Archivo; solo podría recuperarse de una copia
  de seguridad anterior que la contenga. Las copias previas no se reescriben.
- Los nombres de tableros existentes se simplifican al arrancar, retirando
  «Laboratorio», sin cambiar sus IDs, tareas, estado o reparto. La operación es
  idempotente y también cubre tableros archivados. Nuevos nombres se normalizan.
- Actualización compartida cada 15 segundos sin regenerar formularios mientras se
  escribe; conflictos de edición devuelven 409, nunca sobrescriben a otra persona.

## Técnica

- Se añaden dos monitores laterales de proscenio, proyector, splitter 1→2,
  alimentación de escritura y sala de intérpretes, dos PCs de técnica (juego y
  sonidos de interpretación) con entradas separadas a mesa de sonido, control
  DMX y dos máquinas de humo. Capas HDMI/audio/alimentación/DMX, recorridos que
  siguen las posiciones al arrastrar. Las notas anteriores del cableado se conservan.
- El plano abre con todas las conexiones visibles; los filtros permiten aislar
  alimentación, HDMI, audio, datos o DMX. Los cables llegan a conectores en el
  borde de cada equipo, también al moverlo; el splitter muestra una entrada y
  dos salidas. Las regletas representan los puntos de alimentación.
- Monitores de proscenio neutros, público representado con figuras y selección
  directa en el plano, sin el selector duplicado inferior ni campo de circuito.
- **Material técnico del show** resume los cables por tipo y los equipos del plano,
  separando el cable de la fuente de vídeo para no contarlo dos veces. El número
  de focos de cada calle/grupo y las longitudes dependen de la sala.
- Cuatro walkies: presentador canal 1, un equipo de intérpretes por canal 2 y
  técnica alternando 1/2 (doble escucha solo si el modelo la admite).
- Checklist de 18 pasos, compartida al guardar el plano y separada por bolo.
  Crear una adaptación hereda posiciones/cableado pero no pasos completados.
  Los antiguos planos de siete elementos se amplían sin sobreescribir posiciones,
  nombres, circuitos ni notas. No hay reescritura al leer: se guardan explícitamente.
  El PDF generado desde la web incorpora el mismo dibujo visible, sus capas de
  cableado, posiciones, colores y simulación. Captura local PNG de 1500×1875,
  validada y limitada en el servidor; no acepta SVG, rutas ni recursos externos.
  Incluye notas de los elementos, recuentos, walkies y checklist paginada. Se
  conserva el render de servidor para exportaciones API sin captura del navegador.
- El humo está orientado hacia público en el esquema solicitado; su dirección,
  distancias, ventilación y uso deben validarse con sala/manual antes de utilizarlo.
  No se controla DMX real ni se disparan efectos desde esta aplicación.
- Plano interactivo SVG, visto desde el público y orientativo (sin escala): calle
  azul, calle roja, puntual izquierdo de presentador, dos mesas de escritura,
  pantalla de proyección al fondo y frontales de proscenio. Las calles/frontales
  representan grupos, no cantidades confirmadas del inventario de la sala.
- Selección por clic o teclado, arrastre con ratón/táctil, posiciones numéricas,
  simulación de encendido/intensidad y notas. Vistas Todo, Azul,
  Rojo, Presentador, Proscenio y Negro. No se conecta a DMX, sonido ni al videojuego.
- Plano base compartido y adaptación independiente por bolo/ensayo. Guardado
  explícito, versiones y reintentos idempotentes; los conflictos conservan el
  borrador. Cambiar de bolo o descartar pide confirmación si hay cambios.
  No se reemplaza la ficha ni el caret mientras se escribe una nota.
- Guardados como fichas internas `kind=lighting` en `world.sqlite3`, incluidos en
  SQLite/ZIP. Los planos no duplican tareas ni alteran parámetros del videojuego.
  Los circuitos empiezan vacíos y las intensidades son de simulación, para adaptar
  a cada sala. SVG/CSS locales, sin raster, filtros de desenfoque ni animación continua.

## Inventario y materiales

- **Inventario** registra objetos del equipo azul, rojo o compartidos: cantidad,
  categoría, estado, ubicación, responsable del elenco, descripción y foto privada.
  Filtros y búsqueda no duplican existencias; la ficha de cada bolo muestra los
  objetos asociados con miniaturas de sus fotos privadas. Cantidades enteras 0–9999 o «Sin especificar», referencias validadas, conflictos
  de versión y archivo recuperable. No se precargan objetos ficticios.
- La lista de 11 objetos solicitada el 8/10/2026 está en `initial_inventory.json`.
  Se añade atómicamente una sola vez al iniciar el servidor en producción, como
  compartidos y por revisar. Conserva las cantidades indicadas; cinta, pinturas,
  mochilas y sobres quedan sin cantidad, no en cero. Los totales lo explicitan.
  Reinicios no duplican objetos ni restablecen sus cantidades, equipos o archivo.
  Si ya existe un objeto con ese nombre, se conserva, sin sustituir sus datos.
  La importación manual puede revisarse con `python3 tools/scrib-world/inventory_seed.py
  --data /RUTA/PRIVADA`; añadir `--apply` la ejecuta. El modo demo no importa esta lista.
- Se guardan como `kind=inventory` en `world.sqlite3`, fotos en `images/`, dentro
  de los backups SQLite y ZIP existentes. La asociación con un bolo no archiva
  ni elimina el objeto cuando termina o se archiva ese bolo.
- **Materiales** conserva las dos presentaciones HTML completas antes alojadas en
  scribshow.es: «Guía del espectáculo» y «El origen de <SCRI> B». Las miniaturas
  muestran la primera diapositiva original en un lienzo proporcional, sin ejecutar
  el reproductor, animaciones, vídeos ni sonido. Visor con flechas,
  teclado, deslizado y pantalla completa. Actualizar otras tareas no reinicia las
  diapositivas. Los medios, tipografías y vídeos son locales.
- Biblioteca autenticada en `/scrib/backstage/materials/`: lista exacta de archivos
  empaquetados, sin HTML del usuario ni acceso por rutas arbitrarias. Vídeos con
  soporte Range/206, también a través del proxy autenticado. CSP de scripts sin
  `unsafe-inline`; estilos inline solo en estas presentaciones de confianza.
- El código y los medios se conservan en Git. Publicar Mundo SCRIB antes de retirar
  las carpetas públicas de players_scrib; sus enlaces antiguos redirigen a Sutura.
- La agenda prioriza bolos y ensayos por realizar, del más cercano al más lejano;
  después muestra el historial del más reciente al más antiguo. Los realizados
  tienen fondo, bordes e indicadores apagados tanto en las tarjetas como en el
  calendario y Producción y cuentas, sin desactivar sus enlaces ni cambiar sus datos. También
  se atenúan las fechas pasadas, aunque todavía no se haya editado su estado.
  Las tarjetas muestran fecha y hora inmediatamente debajo del título.
- Editar una persona conserva su color guardado, pero ya no muestra un selector
  de color ni el mensaje auxiliar de selección de varios roles.
- Los objetos de cada bolo se muestran a dos columnas por equipo, con su foto;
  en pantallas estrechas pasan a una sola columna.

## Configuración del videojuego por bolo

- En **Editar bolo**, activa «Guardar parámetros para esta función»: duración,
  cooldown de musas, votaciones, cambios de palabras/letras, desventajas,
  explicación manual/automática, tamaños de espectador, niveles, idioma y frases
  finales opcionales. El elenco debe tener una persona de Escritura en cada equipo.
- En el videojuego, **Control → Juego → Cargar configuración de un bolo** muestra
  una vista previa y, al confirmar, sincroniza nombres, créditos del elenco y
  parámetros. No inicia/limpia la partida ni cambia la escena del espectador.
- Solo Control autorizado puede consultar/importar. Partidas en marcha, pausadas
  o en cuenta atrás bloquean la importación. Cambios simultáneos en el bolo, sus
  personas o Control obligan a actualizar la vista previa antes de confirmar.
- Los bolos antiguos sin configuración no reciben parámetros inventados. Editarlos
  guarda la configuración en el JSON del evento de `world.sqlite3`, incluido en los
  backups habituales. Ensayos, bolos archivados o cancelados no se ofrecen.
- El servidor del videojuego consulta el servicio privado en loopback, puerto 5124,
  mediante `~/dockers/scrib-world-data/bridge-secret`. `SCRIB_WORLD_PORT` y
  `SCRIB_WORLD_SECRET` permiten configurar una instalación distinta. No se exportan
  teléfonos, imágenes, redes ni notas privadas al videojuego. No hace falta una
  migración de la base de datos ni añadir credenciales al navegador.

## Acuerdos, memoria de partidas y gestión económica

- **Ficha de bolo → Acuerdos y liquidación** permite preparar un acuerdo por
  persona, con el lugar, fechas (incluido un rango de varios días) y sus papeles.
  Antes, administración debe revisar **Producción y cuentas → Entidad y plantilla**. La
  plantilla conserva las 14 cláusulas del modelo Imparables 2026 de Drive, con
  variables; no se confirman automáticamente los datos fiscales ni el reparto.
- **Ver modelo de acuerdo** muestra el texto actual con los datos de cada persona
  y del bolo antes de generarlo; usa el mismo renderizado que el documento real.
  Consultarlo no crea acuerdos, enlaces ni actividad, ni envía mensajes. Si faltan
  datos, aparecen como pendientes. Acceso reservado a administración.
- La sección económica se llama **Producción y cuentas**. Cada tarjeta de bolo
  se abre al pulsarla, sin un botón redundante de «Gestionar bolo». Preparar
  acuerdos no exige la antigua casilla de revisión del bolo; mantiene versiones,
  revisión de entidad/plantilla y conservación de documentos ya firmados.
- Liquidación muestra fotos privadas (o iniciales si falta foto), papeles,
  importes asignados/pendientes y acciones con icono y texto por persona. No cambia
  el cálculo ni los registros de varios días; solo se elimina esa coletilla del
  título. Personas con importes ya asignados siguen visibles aunque hayan salido
  del elenco del bolo. Sin asignación se muestra «—», no un ingreso inventado.
- La tarjeta del selector de mundos conserva el logo original, con escenario
  neón azul/rojo, subtítulo de terminal y animación breve al pasar el ratón o enfocar.
  Sin animaciones continuas; respeta movimiento reducido. `integrate.py selector`
  actualiza únicamente las variantes conocidas de SCRIB y aborta ante cambios
  no reconocidos, preservando los demás mundos y la autenticación.
- Enlaces personales públicos de 90 días, revocables, con CSRF por capacidad.
  Descarga/impresión en PDF y subida de PDF firmado de hasta 3 MiB. Estados
  preparado, enviado, subido y revisado son distintos: subir no verifica firma.
  Cada revisión conserva el original y su hash. Revisar bloquea nuevas subidas;
  revocar conserva los archivos y permite generar un nuevo acuerdo.
- Enviar acuerdos permite seleccionar una persona o todas, revisar los mensajes
  y confirmar una sola vez los envíos individuales. Usa el puente WhatsApp ya
  existente y su protección frente a reintentos de resultado incierto. Generar,
  guardar o abrir un bolo nunca manda mensajes por sí solo.
- Con la configuración del bolo cargada en Control, finalizar por botón o reloj
  archiva el informe JSON: textos con saltos de línea, estadísticas, puntuación,
  musas, créditos y configuración congelada al inicio. Varios informes se
  conservan por fecha; no se sustituyen. Consulta web adaptable y PDF opcional.
  Si Mundo SCRIB está desconectado, el videojuego deja una cola durable en
  `var/bolo-reports/` (0700 / archivos 0600), reintenta cada 30 s y solo elimina
  cada pendiente después de la confirmación durable de SQLite. Respaldar esa
  cola junto al checkpoint; limpiar o comenzar otra partida no la elimina.
- Liquidaciones de varios días con ingresos, gastos y reparto MANUAL en euros.
  Cálculo exacto en céntimos, límites y conflictos de versiones. Temporada
  editable; totales generado, pagado y pendiente por persona y en su ficha.
  «Pagado» registra un pago externo, nunca ejecuta una transferencia. Importes
  asignados son bases antes de impuestos, no el líquido a transferir.
- Datos fiscales PRIVADOS y borradores de factura con bases por día, IVA y
  retención explícitamente configurados. No se emiten facturas ni se aceptan en
  nombre del integrante. Verificar con cada persona la numeración, datos e
  impuestos; la emisión por destinatario requiere el acuerdo y aceptación
  correspondientes. No se aplican tipos fiscales por defecto.
- `import_billing.py --data /ruta/privada --input /candidatos-0600.json` previsualiza
  conteos sin revelar datos; `--apply` respalda SQLite e importa solo identidades
  exactas sin ficha fiscal previa. Los datos quedan sin verificar y sin tasas.
  Nunca importar fuentes fiscales en Git ni usar facturas antiguas como ingresos
  de una temporada actual.
- Tablas privadas `business_records`, `agreements`, `agreement_uploads` y
  `match_reports` en `world.sqlite3`; PDFs originales en `documents/` por hash,
  fuera del árbol público. SQLite + documentos están en el ZIP administrativo.
  Respaldar juntos base, documentos y la clave privada de enlaces. El estado
  compartido normal no revela datos fiscales, acuerdos, cuentas o importes.

Pruebas: `python3 -m unittest test_business`, además de la suite del mundo;
`node --test tests/bolo-reports.test.js tests/partida-lifecycle-score.test.js`
para archivo durable y cierre autoritativo. Los ensayos usan identidades y dinero
ficticios; no se envían WhatsApps reales.

## Disponibilidad y ensayos

- Sección **Disponibilidad** y acceso desde cada bolo: encuestas con 1–30 horarios,
  lugar, mensaje, fecha de cierre opcional y asociación a una función.
- Enlace público sin cuenta y enlaces personalizados por ficha del elenco. El
  formulario solo muestra la encuesta y la respuesta propia, nunca teléfonos,
  el resto del elenco ni respuestas ajenas. Los enlaces personales son credenciales
  por posesión: no reenviarlos. Un nombre escrito en el formulario público no
  vincula automáticamente a una ficha privada ni verifica identidad.
- Sí / Quizá / No / Sin responder, comentario y edición de la propia respuesta.
  El navegador conserva una clave privada; el enlace de edición usa un fragmento
  que no se envía al servidor. Guardarlo permite recuperarlo en otro dispositivo.
- Matriz privada de respuestas, fechas ordenadas por coincidencias y personas
  pendientes. Cada confirmación selecciona explícitamente asistentes; «Quizá»
  no se convoca por defecto. No se manda WhatsApp automáticamente.
- Confirmar crea un ensayo en el calendario e ICS y un tablero vacío opcional:
  no duplica el ensayo al reintentar ni genera las 34 tareas de producción.
  No se cuentan los ensayos como participaciones en bolos. Se pueden confirmar
  varias fechas, cerrar/reabrir encuestas y editar/cancelar ensayos desde su ficha.
- Tras recibir respuestas no se pueden alterar/eliminar horarios ya propuestos;
  sí añadir otros. Archivar una encuesta o desactivar el enlace público corta
  acceso; retirar un destinatario revoca su enlace personal.
- Respuestas y hashes de edición están en `world.sqlite3` (tablas
  `availability_replies` / `availability_links`), incluidos en backups y ZIP de
  administración. No se exporta `availability-wake-key`, que debe respaldarse
  de forma privada para conservar la validación de encendido de los enlaces.
- `/scrib-disponibilidad/` es el único prefijo público nuevo. `public_proxy.js`
  no reenvía identidad ni secreto de Sutura; limita rutas y métodos. El cuerpo
  general del puente está limitado a 4 MiB + 2 KiB para el PDF firmado en base64;
  las respuestas de disponibilidad conservan su límite de 16 KiB en el servicio.
  CSRF firmado por enlace + cookie HttpOnly/Secure/Strict + Origin,
  máximo 500 respuestas y 240 escrituras por enlace / 10 min. No hay listado
  público de encuestas ni permisos nuevos en los mundos privados.
- Tokens de 256 bits con firma HMAC permiten al gateway reconocer un enlace
  válido mientras el servidor está apagado. El encendido conserva su confirmación
  explícita existente; no basta una URL aleatoria. Solo una página visible manda
  actividad cada 45 s; no se cambia el apagado automático global. Los enlaces
  compartidos usan `sutura-gateway.ddns.net` para seguir accesibles en reposo.

Integración: `integrate.py availability-dashboard` añade el puente público antes
del privado; `availability-gateway` amplía únicamente el reconocimiento del mundo
SCRIB y formularios firmados. Copiar la clave privada de 32 bytes del servicio a
`/opt/sutura-gateway/scrib-availability-key` (0600); instalar también
`gateway_availability.py`. Nginx debe enrutar el prefijo público a DASHBOARD_AUTH
sin Authentik y sin registrar tokens en access logs. El resto de rutas conserva
forward-auth. Generar copia previa, validar sintaxis y reiniciar solo los servicios
afectados. Los datos de encuestas reales no se crean durante el despliegue.

## Autenticación y límites

### Encendido y actividad del mundo privado

La entrada canónica es `https://sutura-gateway.ddns.net/scrib/`, disponible
aunque el servidor principal esté apagado. El gateway reutiliza su confirmación
de encendido y espera al arranque antes de continuar con Authentik. SCRIB comparte
el contexto de acceso de Sutura, sin crear una cuenta ni una política nueva.
Los enlaces antiguos en el servidor principal redirigen al gateway cuando está
encendido; la web del servidor apagado no puede responder por sí sola.
La tarjeta del selector usa directamente el gateway, también desde Sutura.
Los enlaces `/mundo-scrib/` conservan sus fragmentos de tablero/bolo al redirigir
a `/scrib/`. La API y los recursos privados usan `/scrib/backstage/` para no
interceptar `/scrib/game/`, los roles antiguos ni sus JS/CSS. Las API antiguas
siguen funcionando para no perder ediciones en pestañas previamente abiertas;
su cookie CSRF conserva su ámbito y la nueva usa el namespace de backstage.

`public/activity.js` emite actividad al entrar y cada 45 segundos, únicamente con
la pestaña visible. Al ocultarla/dejar el mundo cesan los avisos; se conserva el
apagado automático global (actualmente cinco minutos sin actividad). Comparte el
guard del script global del gateway para no duplicar intervalos y no manda query,
fragmentos ni datos del tablero. La demo local no genera actividad en producción.

Aplicar `integrate.py world-power-gateway` al servicio de encendido,
`world-power-gateway-nginx` a las rutas del gateway y `world-power-nginx` al include
privado de DASHBOARD_AUTH. Los cambios son idempotentes y abortan ante rutas
modificadas. El indicador de entrada del gateway solo evita un bucle de redirección:
Nginx mantiene forward-auth y el puente sigue requiriendo la sesión autorizada.
Aplicar también `selector` a ambas páginas de selección (gateway y DASHBOARD_AUTH).
Respaldar ambos archivos, validar Python/Nginx, reiniciar solo el servicio de
encendido, SCRIB_WORLD y DASHBOARD_AUTH y recargar Nginx; no reiniciar el videojuego ni cambiar datos.

Después de las integraciones iniciales, `rename_world.py` migra `dashboard`,
`nginx`, `gateway-nginx` y `gateway` a la URL canónica. Respalda cada archivo y
valida Nginx/Python/Node antes de reiniciar solo los servicios afectados.
No sustituir el alias general `/scrib/` ni la ruta del videojuego en el Nginx principal.

Pruebas: `python3 -m unittest test_world test_availability test_power test_url` y
`node test_activity.cjs`. Opcionalmente `SCRIB_GATEWAY_SOURCE=/ruta/wake_gateway.py`
ejercita las funciones reales en aislamiento: sin importar el módulo completo,
sin llamadas de red y sin ejecutar órdenes de encendido/apagado.

Se conserva exactamente la entrada Sutura/Authentik existente: Nginx hace
forward-auth y `DASHBOARD_AUTH` valida la identidad con su directorio autorizado.
`world_proxy.js` recibe esa sesión, sobrescribe las cabeceras de identidad y usa
un secreto de puente en un archivo 0600. El servicio solo escucha en loopback.
No crea contraseñas, usuarios Authentik ni políticas de acceso nuevas.

Los miembros autorizados de Sutura colaboran sobre todo el espacio SCRIB. La
exportación ZIP completa está reservada a administradores. El estado compartido
no incluye claves, cookies, hashes de contraseña ni secretos. El ZIP no incluye
credenciales de acceso, pero sí la clave privada de trazabilidad de documentos:
guardarlo cifrado y no distribuirlo.
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
  e importaciones sin duplicados. El campo se llama «Teléfono», sin casilla de
  comprobación de identidad. Los metadatos de confirmación antiguos no bloquean
  envíos ni se fabrican nuevas verificaciones. Se sigue validando el número y
  se mantienen la vista previa, la confirmación del mensaje y los controles anti-duplicado.
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

`import_history.py` incorpora los bolos pasados publicados como realizados. Crea
su ficha y un tablero vacío, sin checklist retrospectiva. Solo vincula personas
ya registradas con coincidencia inequívoca; el resto del reparto publicado se
conserva en las notas del bolo. No inventa horarios, equipos ni nuevas identidades.
Una segunda ejecución no duplica funciones ni sobrescribe ediciones manuales.
Los Instagram requieren un mapping revisado con URL y evidencia y solo rellenan
campos vacíos. Antes de aplicar se guarda una copia consistente privada de SQLite.

```bash
python3 import_history.py --data /RUTA/PRIVADA --schedule /RUTA/main.js \
  --instagram /RUTA/PRIVADA/instagram-confirmados.json
# Revisar el informe antes de añadir --apply. No envía mensajes ni publica datos.
```

## Pruebas locales

```bash
python3 -m unittest discover -s tools/scrib-world -p 'test_world.py' -v
python3 -m unittest discover -s tools/scrib-world -p 'test_people_colors.py' -v
python3 -m unittest discover -s tools/scrib-world -p 'test_people_profiles.py' -v
node tools/scrib-world/test_people_colors.cjs
python3 -m unittest discover -s tools/scrib-world -p 'test_lighting.py' -v
node tools/scrib-world/test_lighting.cjs
node --check tools/scrib-world/public/app.js
node --check tools/scrib-world/world_proxy.js
python3 tools/scrib-world/server.py --demo --port 5131 --data /tmp/scrib-world-demo
```

Abrir `http://127.0.0.1:5131/scrib/`. El modo demo solo escucha en localhost,
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

La tarjeta del selector utiliza el logo original de los signos y la pluma, con
el subtítulo «el primer videojuego- espectáculo de escritura en vivo», adaptable
al ancho de la tarjeta. Copiar `assets/scrib-world-logo.png` a `/srv/sutura-front/favicons/` en
el gateway y `/var/www/dashboard/favicons/` en el backend. Es el PNG original
de `players_scrib/img/logo.png`, sin modificar. Para actualizar un selector ya
instalado, `integrate.py selector ORIGINAL DESTINO` sustituye únicamente la
tarjeta y su CSS conocidos, preservando el puente de autenticación y otros mundos.

La integración inicial protegía `/mundo-scrib/` a través de su `location /` con el snippet de
Authentik. No necesita cambios de Nginx ni nuevas políticas. El gateway lo
proxya por su ruta general y conserva su pantalla de encendido del servidor.

1. Copiar código al backend, sin cachés, bases de datos ni secretos de desarrollo.
2. Ejecutar pruebas en Python 3.10 del backend y comprobar puerto 5124 libre.
3. `pm2 start /home/trescejas/dockers/scrib-world/ecosystem.config.js` (sin demo).
4. Comprobar 401 sin puente en `http://127.0.0.1:5124/scrib/backstage/api/state`.
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
DB restaurada. Conservar también `document-trace.key` con permisos 0600 para la
trazabilidad de los PDF; el JSON del ZIP incluye `documentExports`. Una restauración
requiere elegir la copia y verificar su fecha.
