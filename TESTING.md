# Testing en `server_scrib`

Este repo tiene tres capas de tests:

1. Unit tests de lógica pura.
2. Contract tests de hooks/eventos Socket.IO.
3. Soak tests de carga ligera y latencia.

## Scripts

- `npm run test:unit`
  Ejecuta todos los tests de `tests/**/*.test.js`.
- `npm run test:soak`
  Ejecuta la suite de carga de `tests/server-load.soak.js`.
- `npm run test:soak:update-baseline`
  Actualiza `tests/fixtures/soak-latency-baseline.json` usando el último resumen de `.soak-artifacts/latest-soak-summary.json`.

## Unit tests de lógica pura

### `tests/musas.test.js`

Valida la clase `Musas`:

- normalización de items de musa desde strings y objetos
- incremento de contador cuando una escritora pide musa y no hay cola
- flush inmediato cuando la jugadora estaba pendiente
- aislamiento de pendientes y colas entre J1 y J2
- entrega independiente al room correcto para ambas escritoras
- `clearAll()` limpiando colas/flags sin perder contadores acumulados

### `tests/palabras-bonus.test.js`

Valida `PalabrasBonusMode`:

- entrega de palabras de musa en cola para J1 y J2
- fallback a RAE cuando la cola está vacía
- fallback local cuando RAE falla
- caso de petición vacía seguida de nueva palabra en cola antes de la siguiente entrega programada
- puntuación y metadatos de musa en el payload emitido

### `tests/palabras-malditas.test.js`

Valida `PalabrasMalditasMode`:

- las palabras enviadas por musa van a la cola del equipo rival
- la extracción de top palabras ignora ruido HTML/CSS y usa texto legible
- el payload emitido conserva metadatos de musa y escapa correctamente el nombre
- `handleRequest()` incrementa los contadores correctos tras una inserción de musa
- el fallback prioriza top palabras del rival antes de palabras estáticas

### `tests/server-state-utils.test.js`

Valida utilidades puras de estado:

- snapshots de resurrección por jugadora
- `payloadEstadoResurreccion()`
- payload de `votacion_ventaja` con tiempo restante y clamp a cero
- normalización del payload `stats_live`

### `tests/musa-help.test.js`

Valida la asistencia individual de musas:

- identidad autoritativa y tickets opacos sin filtrar IDs técnicos
- color de bandera, atención, resolución, cancelación y reconexión
- recarga dirigida únicamente al socket activo de la musa
- consentimiento y caducidad del diagnóstico temporal
- frames acotados por formato, tamaño, dimensiones, secuencia y frecuencia
- comandos remotos limitados a toque, desplazamiento, volver y reconectar
- sala privada exclusiva de Control, inaccesible a monitores de pantalla

### `tests/role-access.test.js`

Valida la autorización sensible de Control:

- comparación segura de contraseña y emisión de tokens opacos con caducidad
- propósito exclusivo `control`, almacenamiento acotado y ausencia de secretos en snapshots
- límite de intentos fallidos compartido entre reconexiones de la misma dirección
- rechazo de tokens ausentes, inválidos o caducados

## Contract tests de hooks y eventos

Archivo: `tests/server-hooks-contract.test.js`

Estos tests arrancan `server.js` en `NODE_ENV=test`, conectan sockets reales y comparan snapshots versionados en `tests/fixtures`.

### Hooks cubiertos

- `scrib_test:get_state`
  Snapshot inicial, snapshot poblado y snapshot tras `reset`.
- `scrib_test:force_vote`
  Apertura y cierre determinista de votación.
- `scrib_test:force_finish_player`
  Finalización forzada de una jugadora.
- `scrib_test:force_mode`
  Cambio forzado de modo y estado específico de letras/palabras.
- `scrib_test:simulate_musa_heart`
  Corazones/feedback de musas.
- `scrib_test:force_warmup_state`
  Estado de tutorial/calentamiento.
- `scrib_test:reset`
  Limpieza a contrato inicial.

### Eventos con snapshot fijado

- `stats_live_estado`
- `teleprompter_state`
- `teleprompter_ack`
- `nube_inspiracion_estado`
- `estado_banderas_musas`
- `elegir_ventaja_j1` y estado de `votacion_ventaja`
- `feedback_musas_estado`
- `creditos_estado`
- `vista_espectador_modo`

### Snapshots

Los snapshots viven en `tests/fixtures/`.

Si cambias intencionadamente el contrato:

- en PowerShell: `$env:UPDATE_SNAPSHOTS=1; npm run test:unit`
- después revisa y versiona solo los snapshots esperados

## Soak tests

Archivo: `tests/server-load.soak.js`

Esta suite arranca el servidor en modo test y mide comportamiento bajo carga ligera real de Socket.IO.

### Casos actuales

- `server survives a burst of simultaneous role connections and cleans all counters`
  Oleada de conexiones simultáneas y limpieza completa de contadores.
- `vote broadcasts reach all connected team musas under load`
  Broadcast de votación a varias musas con control de latencia.
- `server survives repeated connection waves without leaking counters`
  Varias rondas de conexión/desconexión sin fugas de estado.
- `teleprompter broadcast latency stays bounded under multi-role load`
  Broadcast de teleprompter a muchos roles con control de latencia.

### Métricas que genera

Cada run de soak guarda:

- `durationMs`
- `avgLatencyMs`
- `p95LatencyMs`
- `maxLatencyMs`
- tendencias contra el run anterior
- checks de regresión contra baseline

### Ficheros de soak

- `.soak-artifacts/latest-soak-summary.json`
  Resumen del último run.
- `.soak-artifacts/soak-history.ndjson`
  Histórico acumulado de runs.
- `tests/fixtures/soak-latency-baseline.json`
  Baseline versionada para detectar degradaciones.
- `scripts/update-soak-baseline.js`
  Script para refrescar esa baseline.

`.soak-artifacts/` está ignorado en git.

### Presupuesto actual de regresión

Por defecto, un run falla si una métrica comparada supera el mayor de estos dos límites respecto a la baseline:

- `baseline + 150ms`
- `baseline * 8`

Variables disponibles:

- `SCRIB_SOAK_REPEAT_ROUNDS`
- `SCRIB_SOAK_BROADCAST_MAX_LATENCY_MS`
- `SCRIB_SOAK_REGRESSION_MAX_DELTA_MS`
- `SCRIB_SOAK_REGRESSION_MAX_RATIO`

## CI actual

Workflows en `.github/workflows`:

- `unit-tests.yml`
  Corre en `push`, `pull_request` y manual. Ejecuta `npm run test:unit`.
- `soak-tests.yml`
  Corre nightly y manual. Ejecuta `npm run test:soak`, restaura/cachea historial, publica resumen y sube `.soak-artifacts` como artifact.

## Relación con `players_scrib`

La documentación del lado cliente/E2E está en `../players_scrib/TESTING.md`.
