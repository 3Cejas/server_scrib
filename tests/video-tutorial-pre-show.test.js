const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { crearRegistroRoles } = require("../role_connections.js");
const {
  CONFIG_VIDEO_TUTORIAL_DEFAULT,
  crearAlmacenConfigVideoTutorial,
  crearGestorVideoTutorialPreShow,
  normalizarConfigVideoTutorial,
  normalizarUrlVideo,
  validarPatchConfigVideoTutorial
} = require("../video_tutorial_pre_show.js");

function crearIo() {
  const eventos = [];
  return {
    eventos,
    emit(event, payload) {
      eventos.push({ event, payload });
    },
    to(room) {
      return {
        emit(event, payload) {
          eventos.push({ room, event, payload });
        }
      };
    }
  };
}

function crearSocket(id, extra = {}) {
  const handlers = {};
  const emitted = [];
  const rooms = new Set();
  return {
    id,
    handlers,
    emitted,
    rooms,
    ...extra,
    on(event, handler) {
      handlers[event] = handler;
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    join(room) {
      rooms.add(room);
    },
    leave(room) {
      rooms.delete(room);
    },
    trigger(event, ...args) {
      return handlers[event](...args);
    }
  };
}

function crearReloj(inicio = 0) {
  let actual = inicio;
  let secuencia = 0;
  const timers = new Map();
  const setTimeoutFn = (callback, delay) => {
    const id = ++secuencia;
    timers.set(id, { callback, at: actual + Math.max(0, Number(delay) || 0) });
    return id;
  };
  const clearTimeoutFn = (id) => timers.delete(id);
  const avanzar = (ms) => {
    const destino = actual + ms;
    while (true) {
      const siguiente = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= destino)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!siguiente) break;
      const [id, timer] = siguiente;
      timers.delete(id);
      actual = timer.at;
      timer.callback();
    }
    actual = destino;
  };
  return {
    avanzar,
    clearTimeoutFn,
    now: () => actual,
    pendientes: () => timers.size,
    setTimeoutFn
  };
}

function crearAlmacenMemoria(config = {}, { fallar = false } = {}) {
  const guardadas = [];
  return {
    guardadas,
    cargar: () => ({ ...CONFIG_VIDEO_TUTORIAL_DEFAULT, ...config }),
    async guardar(nuevaConfig) {
      if (fallar) throw new Error("disco no disponible");
      guardadas.push({ ...nuevaConfig });
    }
  };
}

function crearContexto({ config = {}, almacen = null, inicio = 0 } = {}) {
  const io = crearIo();
  const reloj = crearReloj(inicio);
  const roles = crearRegistroRoles();
  let secuenciaSesion = 0;
  const store = almacen || crearAlmacenMemoria(config);
  const gestor = crearGestorVideoTutorialPreShow({
    io,
    almacen: store,
    obtenerMusaActiva: (socket) => roles.obtenerMusaActiva(socket),
    listarMusasActivas: () => roles.listarMusasActivas(),
    now: reloj.now,
    setTimeoutFn: reloj.setTimeoutFn,
    clearTimeoutFn: reloj.clearTimeoutFn,
    crearSessionId: () => `video-session-${++secuenciaSesion}`
  });
  return { gestor, io, reloj, roles, almacen: store };
}

function faseActual(gestor, extra = {}) {
  const estado = gestor.payload();
  return {
    session_id: estado.session_id,
    phase_seq: estado.phase_seq,
    ...extra
  };
}

test("video tutorial validates bounded configuration and safe media URLs", () => {
  assert.equal(CONFIG_VIDEO_TUTORIAL_DEFAULT.duracion_segundos, 100);
  assert.equal(normalizarUrlVideo(" ../media/tutorial.mp4 "), "../media/tutorial.mp4");
  assert.equal(normalizarUrlVideo("/media/tutorial.mp4"), "/media/tutorial.mp4");
  assert.equal(normalizarUrlVideo("https://cdn.example/video.mp4"), "https://cdn.example/video.mp4");
  assert.equal(normalizarUrlVideo("http://inseguro.example/video.mp4"), "");
  assert.equal(normalizarUrlVideo("javascript:alert(1)"), "");
  assert.equal(normalizarUrlVideo("../media/video con espacios.mp4"), "");

  assert.equal(validarPatchConfigVideoTutorial({ intervalo_segundos: 14 }, CONFIG_VIDEO_TUTORIAL_DEFAULT).code, "INVALID_INTERVAL");
  assert.equal(validarPatchConfigVideoTutorial({ duracion_segundos: 3601 }, CONFIG_VIDEO_TUTORIAL_DEFAULT).code, "INVALID_DURATION");
  assert.equal(validarPatchConfigVideoTutorial({ habilitado: "sí" }, CONFIG_VIDEO_TUTORIAL_DEFAULT).code, "INVALID_CONFIG");
  assert.equal(validarPatchConfigVideoTutorial({ video_url: "data:text/html,x" }, CONFIG_VIDEO_TUTORIAL_DEFAULT).code, "INVALID_VIDEO_URL");

  assert.deepEqual(normalizarConfigVideoTutorial({ intervalo_segundos: -1 }), {
    ...CONFIG_VIDEO_TUTORIAL_DEFAULT,
    intervalo_segundos: 15
  });
});

test("video tutorial persists configuration atomically and reloads it", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "scrib-video-config-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "estado", "video.json");
  const defaultPath = path.join(dir, "default.json");
  await fsp.writeFile(defaultPath, JSON.stringify(CONFIG_VIDEO_TUTORIAL_DEFAULT));
  const almacen = crearAlmacenConfigVideoTutorial({ configPath, defaultPath });

  assert.deepEqual(almacen.cargar(), CONFIG_VIDEO_TUTORIAL_DEFAULT);
  const nueva = {
    video_url: "../media/propio.mp4",
    intervalo_segundos: 45,
    duracion_segundos: 12,
    habilitado: true,
    silenciado: true
  };
  await almacen.guardar(nueva);
  assert.deepEqual(almacen.cargar(), nueva);
  assert.deepEqual(JSON.parse(await fsp.readFile(configPath, "utf8")), nueva);
  assert.deepEqual((await fsp.readdir(path.dirname(configPath))).sort(), ["video.json"]);
});

test("enabled video loops authoritatively only while the pre-tutorial phase is active", () => {
  const { gestor, io, reloj } = crearContexto({
    inicio: 1000,
    config: { habilitado: true, intervalo_segundos: 15, duracion_segundos: 3 }
  });

  const inicial = gestor.iniciar();
  assert.equal(inicial.activo, true);
  assert.equal(inicial.reproduciendo, false);
  assert.equal(inicial.proxima_reproduccion_ts, 16000);
  assert.equal(reloj.pendientes(), 1);

  reloj.avanzar(15000);
  const reproduccion = gestor.payload();
  assert.equal(reproduccion.reproduciendo, true);
  assert.equal(reproduccion.visible, true);
  assert.equal(reproduccion.reproduccion_seq, 1);
  assert.equal(reproduccion.origen, "periodico");
  assert.equal(reproduccion.inicio_ts, 16000);
  assert.equal(reproduccion.fin_ts, 19000);

  reloj.avanzar(3000);
  const terminado = gestor.payload();
  assert.equal(terminado.reproduciendo, false);
  assert.equal(terminado.visible, false);
  assert.equal(terminado.proxima_reproduccion_ts, 34000);
  assert.equal(reloj.pendientes(), 1);

  gestor.cerrarFase("tutorial");
  assert.equal(gestor.payload().activo, false);
  assert.equal(gestor.payload().proxima_reproduccion_ts, 0);
  assert.equal(reloj.pendientes(), 0);
  reloj.avanzar(60000);
  assert.equal(gestor.payload().reproduccion_seq, 1);
  assert.equal(io.eventos.every(({ event }) => event === "video_tutorial_estado"), true);
});

test("control can play now, stop and persist scheduling changes without races", async () => {
  const { gestor, reloj, almacen } = crearContexto({
    inicio: 2000,
    config: { habilitado: false, intervalo_segundos: 20, duracion_segundos: 5 }
  });
  gestor.iniciar();
  assert.equal(reloj.pendientes(), 0);

  const play = gestor.reproducir(faseActual(gestor, { request_id: "play-1" }));
  assert.equal(play.ok, true);
  assert.equal(play.estado.origen, "manual");
  assert.equal(play.reproduccion_seq, 1);
  assert.equal(reloj.pendientes(), 1);
  const retry = gestor.reproducir(faseActual(gestor, { request_id: "play-1" }));
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotente, true);
  assert.equal(retry.reproduccion_seq, 1);

  const stop = gestor.detener(faseActual(gestor, { request_id: "stop-1" }));
  assert.equal(stop.ok, true);
  assert.equal(stop.estado.visible, false);
  assert.equal(reloj.pendientes(), 0);

  const configurado = await gestor.configurar({
    video_url: "../media/nuevo.mp4",
    intervalo_segundos: 15,
    duracion_segundos: 3,
    habilitado: true,
    silenciado: true,
    request_id: "config-1"
  });
  assert.equal(configurado.ok, true);
  assert.equal(configurado.estado.revision, 2);
  assert.equal(configurado.estado.proxima_reproduccion_ts, 17000);
  assert.deepEqual(almacen.guardadas, [{
    video_url: "../media/nuevo.mp4",
    intervalo_segundos: 15,
    duracion_segundos: 3,
    habilitado: true,
    silenciado: true
  }]);

  const retryConfig = await gestor.configurar({ habilitado: false, request_id: "config-1" });
  assert.equal(retryConfig.ok, true);
  assert.equal(retryConfig.idempotente, true);
  assert.equal(retryConfig.estado.configuracion.habilitado, true);
  assert.equal(almacen.guardadas.length, 1);
});

test("failed persistence leaves live configuration and timers unchanged", async () => {
  const almacen = crearAlmacenMemoria({ habilitado: false }, { fallar: true });
  const { gestor, reloj } = crearContexto({ almacen });
  gestor.iniciar();

  const resultado = await gestor.configurar({
    habilitado: true,
    intervalo_segundos: 15,
    request_id: "fallo-1"
  });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.code, "CONFIG_PERSIST_FAILED");
  assert.equal(resultado.estado, undefined);
  assert.equal(gestor.payload().configuracion.habilitado, false);
  assert.equal(gestor.payload().revision, 1);
  assert.equal(reloj.pendientes(), 0);
});

test("phase transitions cancel playback, reject stale commands and open a new clean session", () => {
  const { gestor, reloj } = crearContexto({ config: { duracion_segundos: 30 } });
  gestor.iniciar();
  const primera = gestor.payload();
  assert.equal(gestor.reproducir({ ...primera, request_id: "primera" }).ok, true);
  assert.equal(reloj.pendientes(), 1);

  const cerrada = gestor.cerrarFase("tutorial");
  assert.equal(cerrada.activo, false);
  assert.equal(cerrada.visible, false);
  assert.equal(cerrada.reproduciendo, false);
  assert.equal(reloj.pendientes(), 0);
  assert.equal(gestor.reproducir({
    session_id: cerrada.session_id,
    phase_seq: cerrada.phase_seq,
    request_id: "tarde"
  }).code, "NOT_ACTIVE");

  const nueva = gestor.abrirFase();
  assert.notEqual(nueva.session_id, primera.session_id);
  assert.ok(nueva.phase_seq > primera.phase_seq);
  assert.equal(nueva.reproduciendo, false);
  assert.equal(gestor.reproducir({
    session_id: primera.session_id,
    phase_seq: primera.phase_seq,
    request_id: "replay"
  }).code, "STALE_SESSION");
  assert.equal(gestor.detener({
    session_id: nueva.session_id,
    phase_seq: nueva.phase_seq + 1
  }).code, "STALE_PHASE");
});

test("only an exact active muse can verify the current reproduction, idempotently", () => {
  const { gestor, roles } = crearContexto({ config: { duracion_segundos: 30 } });
  const luna = crearSocket("musa-luna");
  const sol = crearSocket("musa-sol");
  roles.registrarMusa(luna, { nombre: "LUNA", clientId: "client-luna" });
  roles.registrarMusa(sol, { nombre: "SOL", clientId: "client-sol" });
  gestor.iniciar();
  const play = gestor.reproducir(faseActual(gestor, { request_id: "play-verify" }));

  const payload = faseActual(gestor, {
    reproduccion_seq: play.reproduccion_seq,
    request_id: "verify-luna"
  });
  const primera = gestor.verificar(luna, payload);
  assert.equal(primera.ok, true);
  assert.equal(primera.idempotente, false);
  assert.deepEqual(primera.estado.verificacion, {
    conectadas: 2,
    verificadas: 1,
    pendientes: 1,
    nombres_verificados: ["LUNA"]
  });

  const retry = gestor.verificar(luna, payload);
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotente, true);
  assert.deepEqual(retry.estado.verificacion, primera.estado.verificacion);

  const falsa = crearSocket("musa-falsa", { musa: luna.musa });
  assert.equal(gestor.verificar(falsa, payload).code, "MUSA_SESSION_INACTIVE");
  assert.equal(gestor.verificar(crearSocket("anonima"), payload).code, "MUSA_NOT_REGISTERED");
  assert.equal(gestor.verificar(sol, { ...payload, reproduccion_seq: 999 }).code, "STALE_REPRODUCTION");
  assert.equal(gestor.verificar(sol, { ...payload, session_id: "sesion-anterior" }).code, "STALE_SESSION");
});

test("verification survives a stable muse reconnect, resets per playback and hides technical ids", () => {
  const { gestor, roles } = crearContexto({ config: { duracion_segundos: 30 } });
  const anterior = crearSocket("socket-viejo");
  roles.registrarMusa(anterior, { nombre: "PUTA", clientId: "identidad-secreta" });
  gestor.iniciar();
  let play = gestor.reproducir(faseActual(gestor, { request_id: "play-a" }));
  assert.equal(gestor.verificar(anterior, faseActual(gestor, {
    reproduccion_seq: play.reproduccion_seq,
    request_id: "verify-a"
  })).ok, true);

  const reconectada = crearSocket("socket-nuevo");
  roles.registrarMusa(reconectada, { nombre: "PUTA", clientId: "identidad-secreta" });
  assert.deepEqual(gestor.payload().verificacion, {
    conectadas: 1,
    verificadas: 1,
    pendientes: 0,
    nombres_verificados: ["MUSA"]
  });
  assert.equal(gestor.verificar(anterior, faseActual(gestor, {
    reproduccion_seq: play.reproduccion_seq
  })).code, "MUSA_NOT_REGISTERED");
  const publico = JSON.stringify(gestor.payload());
  assert.equal(publico.includes("identidad-secreta"), false);
  assert.equal(publico.includes("socket-viejo"), false);
  assert.equal(publico.includes("socket-nuevo"), false);
  assert.equal(publico.includes("PUTA"), false);

  play = gestor.reproducir(faseActual(gestor, { request_id: "play-b" }));
  assert.equal(play.reproduccion_seq, 2);
  assert.deepEqual(play.estado.verificacion, {
    conectadas: 1,
    verificadas: 0,
    pendientes: 1,
    nombres_verificados: []
  });
  const mismaCorrelacionNuevaReproduccion = gestor.verificar(reconectada, faseActual(gestor, {
    reproduccion_seq: play.reproduccion_seq,
    request_id: "verify-a"
  }));
  assert.equal(mismaCorrelacionNuevaReproduccion.ok, true);
  assert.equal(mismaCorrelacionNuevaReproduccion.idempotente, false);
  assert.equal(mismaCorrelacionNuevaReproduccion.estado.verificacion.verificadas, 1);
});

test("socket handlers authorize Control mutations, sync reconnects and ACK muse verification", async () => {
  const { gestor, roles, reloj } = crearContexto({ config: { duracion_segundos: 30 } });
  const control = crearSocket("control", { control: true });
  const espectador = crearSocket("espectador", { espectador: true });
  const intruso = crearSocket("intruso");
  const musa = crearSocket("musa");
  roles.registrarMusa(musa, { nombre: "LUNA", clientId: "musa-client" });
  [control, espectador, intruso, musa].forEach((socket) => gestor.registrarHandlers(socket));
  gestor.iniciar();

  let rechazo = null;
  await intruso.trigger("video_tutorial_configurar", { habilitado: true }, (ack) => {
    rechazo = ack;
  });
  assert.equal(rechazo.code, "NOT_AUTHORIZED");
  intruso.trigger("video_tutorial_reproducir", faseActual(gestor), (ack) => {
    rechazo = ack;
  });
  assert.equal(rechazo.code, "NOT_AUTHORIZED");
  intruso.trigger("video_tutorial_detener", faseActual(gestor), (ack) => {
    rechazo = ack;
  });
  assert.equal(rechazo.code, "NOT_AUTHORIZED");

  let playAck = null;
  control.trigger("video_tutorial_reproducir", faseActual(gestor, { request_id: "handler-play" }), (ack) => {
    playAck = ack;
  });
  assert.equal(playAck.ok, true);
  reloj.avanzar(2500);

  let syncAck = null;
  espectador.trigger("pedir_video_tutorial_estado", {}, (ack) => {
    syncAck = ack;
  });
  assert.equal(syncAck.ok, true);
  assert.equal(syncAck.estado.reproduciendo, true);
  assert.equal(syncAck.estado.posicion_segundos, 2);
  assert.equal(espectador.emitted.at(-1).event, "video_tutorial_estado");

  let verifyAck = null;
  musa.trigger("video_tutorial_verificar", faseActual(gestor, {
    reproduccion_seq: playAck.reproduccion_seq,
    request_id: "handler-verify"
  }), (ack) => {
    verifyAck = ack;
  });
  assert.equal(verifyAck.ok, true);
  assert.equal(verifyAck.estado.verificacion.verificadas, 1);

  let forgedAck = null;
  espectador.trigger("video_tutorial_verificar", faseActual(gestor, {
    reproduccion_seq: playAck.reproduccion_seq
  }), (ack) => {
    forgedAck = ack;
  });
  assert.equal(forgedAck.code, "MUSA_NOT_REGISTERED");
});
