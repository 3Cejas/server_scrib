# <SCRI> B para Android

App privada Android 8 o posterior, basada en el enfoque WebView de Impropios.
Abre el mundo real en el gateway, incluido su acceso de Sutura y encendido del
servidor. No replica la base de datos ni crea nuevas contraseñas.

- Sesión/cookies persistentes; atrás integrado, sin forzar recargas al regresar.
- Interfaz web actualizada desde el servidor y adaptable a móvil/tablet.
- Reintento cuando falla la conexión; teclado con ajuste del espacio disponible.
- Selector de fotos/documentos y PDF autenticados guardados con el selector de
  Android. No solicita acceso general al almacenamiento ni comparte PDFs solo.
- Presentaciones/vídeos a pantalla completa y enlaces externos en su propia app.
- TLS obligatorio; errores de certificado cancelados; ninguna contraseña en código.
- Identidad y clave de firma propias, independientes de la APK de Impropios.

Esta primera versión no incorpora el servicio de notificaciones de Impropios:
SCRIB todavía no tiene ese buzón de avisos. No consulta ni despierta el servidor
en segundo plano. Al abrir la app se usa el gateway y el heartbeat web existente.

## Compilación y firma

Necesita JDK 17, Android SDK 35/build-tools 35.0.0 y `rg`; sin Gradle ni AndroidX.

```bash
SCRIB_ANDROID_SDK=/ruta/sdk bash scripts/build.sh
python3 scripts/create-signing-key.py /ruta/privada/firma-scrib
SCRIB_ANDROID_SDK=/ruta/sdk SCRIB_SIGNING_DIR=/ruta/privada/firma-scrib bash scripts/build.sh --release
```

APK: `build/outputs/scrib-android-1.0.0.apk`. La compilación de producción copia
la APK firmada y su SHA-256 a `tools/scrib-world/assets/android/`, para la descarga
autenticada desde Materiales. Incrementar nombre/código de versión para futuras
actualizaciones y usar siempre la misma clave. Las claves jamás entran en Git;
conservarlas en una copia privada cifrada antes de publicar. Perderlas impide
actualizar la instalación existente.

Prueba de política URL: `bash scripts/test.sh`. La APK debe probarse también en
un dispositivo con el gateway publicado: login, salida/regreso, teclado, fotos,
descargas y pantalla completa. Compilar no acredita esas pruebas reales.
