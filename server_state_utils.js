function crearEstadoResurreccionVacio(player) {
  return {
    player,
    menu: "hidden",
    visible: false,
    mainIndex: 0,
    quantityIndex: 0,
    palabras: 0,
    max: 0,
    segundos: 0,
    ts: 0
  };
}

function actualizarEstadoResurreccionSnapshot(estadoActual, player, payload = {}, options = {}) {
  const validarPlayer = typeof options.validarPlayer === "function"
    ? options.validarPlayer
    : (value) => (value === 1 || value === 2 ? value : null);
  const now = typeof options.now === "number" ? options.now : Date.now();
  const id = validarPlayer(player);
  if (!id) {
    return { state: estadoActual, value: null };
  }
  const nextState = {
    1: { ...(estadoActual && estadoActual[1] ? estadoActual[1] : crearEstadoResurreccionVacio(1)) },
    2: { ...(estadoActual && estadoActual[2] ? estadoActual[2] : crearEstadoResurreccionVacio(2)) }
  };
  nextState[id] = {
    ...crearEstadoResurreccionVacio(id),
    ...nextState[id],
    ...(payload && typeof payload === "object" ? payload : {}),
    player: id,
    ts: now
  };
  return {
    state: nextState,
    value: { ...nextState[id] }
  };
}

function payloadEstadoResurreccion(estadoActual) {
  return {
    1: { ...(estadoActual && estadoActual[1] ? estadoActual[1] : crearEstadoResurreccionVacio(1)) },
    2: { ...(estadoActual && estadoActual[2] ? estadoActual[2] : crearEstadoResurreccionVacio(2)) }
  };
}

function construirPayloadEstadoVotacionVentaja(estado = {}) {
  const now = typeof estado.now === "number" ? estado.now : Date.now();
  const activa = Boolean(estado.activa);
  const terminaEnTs = Number(estado.termina_en_ts) || 0;
  const tiempoRestanteMs = (activa && terminaEnTs > 0)
    ? Math.max(0, terminaEnTs - now)
    : 0;
  const payload = {
    activa,
    equipo: typeof estado.equipo === "string" ? estado.equipo : "",
    opciones: Array.isArray(estado.opciones) ? [...estado.opciones] : [],
    votos: (estado.votos && typeof estado.votos === "object") ? { ...estado.votos } : {},
    duracion_ms: Math.max(0, Number(estado.duracion_ms) || 0),
    tiempo_restante_ms: tiempoRestanteMs,
    termina_en_ts: terminaEnTs || 0
  };
  if (typeof estado.ya_voto === "boolean") {
    payload.ya_voto = estado.ya_voto;
  }
  return payload;
}

function recortarTextoStatsLive(valor, max = 64) {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, max);
}

function normalizarArrayTextoStatsLive(arr, maxItems = 40, maxLen = 64) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((valor) => recortarTextoStatsLive(String(valor), maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizarTopTeclasStatsLive(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => ({
      code: recortarTextoStatsLive(item && item.code ? String(item.code) : "", 24),
      count: Math.max(0, Number(item && item.count) || 0)
    }))
    .filter((item) => item.code)
    .slice(0, 8);
}

function normalizarHeatmapStatsLive(entrada) {
  if (!entrada || typeof entrada !== "object") return {};
  const salida = {};
  const pushItem = (code, count) => {
    const codigo = recortarTextoStatsLive(String(code || ""), 24);
    const valor = Math.max(0, Number(count) || 0);
    if (!codigo || !Number.isFinite(valor) || valor <= 0) return;
    if (Object.prototype.hasOwnProperty.call(salida, codigo)) return;
    if (Object.keys(salida).length >= 128) return;
    salida[codigo] = valor;
  };
  if (Array.isArray(entrada)) {
    entrada.forEach((item) => {
      if (!item || typeof item !== "object") return;
      pushItem(item.code, item.count);
    });
    return salida;
  }
  Object.keys(entrada).forEach((code) => {
    pushItem(code, entrada[code]);
  });
  return salida;
}

function normalizarNumeroStatsLive(valor, fallback = 0) {
  const num = Number(valor);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function crearJugadorStatsLiveVacio(playerId) {
  return {
    id: playerId,
    nombre: `ESCRITXR ${playerId}`,
    palabrasTotal: 0,
    palabrasUnicas: 0,
    pulsacionesTotal: 0,
    teclasDistintas: 0,
    topTeclas: [],
    heatmap: {},
    ritmoPpm: 0,
    tiempoTotalMs: 0,
    tiempoEscrituraMs: 0,
    vida: { actual: null, min: null, max: null, media: null },
    letrasBenditas: [],
    letrasMalditas: [],
    palabrasBenditas: [],
    palabrasMalditas: [],
    intentosLetraProhibida: 0,
    intentosPalabraProhibida: 0
  };
}

function normalizarJugadorStatsLive(entrada, playerId) {
  const base = crearJugadorStatsLiveVacio(playerId);
  const data = (entrada && typeof entrada === "object") ? entrada : {};
  const vidaEntrada = (data.vida && typeof data.vida === "object") ? data.vida : {};
  const heatmapNormalizado = normalizarHeatmapStatsLive(data.heatmap);
  if (!Object.keys(heatmapNormalizado).length) {
    normalizarTopTeclasStatsLive(data.topTeclas).forEach((item) => {
      heatmapNormalizado[item.code] = item.count;
    });
  }
  const normalizarVida = (valor) => {
    const numero = normalizarNumeroStatsLive(valor, Number.NaN);
    return Number.isFinite(numero) ? numero : null;
  };
  return {
    ...base,
    id: playerId,
    nombre: recortarTextoStatsLive(data.nombre || base.nombre, 28) || base.nombre,
    palabrasTotal: Math.max(0, normalizarNumeroStatsLive(data.palabrasTotal, 0)),
    palabrasUnicas: Math.max(0, normalizarNumeroStatsLive(data.palabrasUnicas, 0)),
    pulsacionesTotal: Math.max(0, normalizarNumeroStatsLive(data.pulsacionesTotal, 0)),
    teclasDistintas: Math.max(0, normalizarNumeroStatsLive(data.teclasDistintas, 0)),
    topTeclas: normalizarTopTeclasStatsLive(data.topTeclas),
    heatmap: heatmapNormalizado,
    ritmoPpm: Math.max(0, normalizarNumeroStatsLive(data.ritmoPpm, 0)),
    tiempoTotalMs: Math.max(0, normalizarNumeroStatsLive(data.tiempoTotalMs, 0)),
    tiempoEscrituraMs: Math.max(0, normalizarNumeroStatsLive(data.tiempoEscrituraMs, 0)),
    vida: {
      actual: normalizarVida(vidaEntrada.actual),
      min: normalizarVida(vidaEntrada.min),
      max: normalizarVida(vidaEntrada.max),
      media: normalizarVida(vidaEntrada.media)
    },
    letrasBenditas: normalizarArrayTextoStatsLive(data.letrasBenditas, 26, 8),
    letrasMalditas: normalizarArrayTextoStatsLive(data.letrasMalditas, 26, 8),
    palabrasBenditas: normalizarArrayTextoStatsLive(data.palabrasBenditas, 48, 26),
    palabrasMalditas: normalizarArrayTextoStatsLive(data.palabrasMalditas, 48, 26),
    intentosLetraProhibida: Math.max(0, normalizarNumeroStatsLive(data.intentosLetraProhibida, 0)),
    intentosPalabraProhibida: Math.max(0, normalizarNumeroStatsLive(data.intentosPalabraProhibida, 0))
  };
}

function normalizarPayloadStatsLive(payload = {}, options = {}) {
  const data = (payload && typeof payload === "object") ? payload : {};
  const players = (data.players && typeof data.players === "object") ? data.players : {};
  const modoActual = typeof options.modoActual === "string" ? options.modoActual : "";
  const now = typeof options.now === "number" ? options.now : Date.now();
  return {
    ts: now,
    modo_actual: recortarTextoStatsLive(data.modo_actual || modoActual || "", 32),
    players: {
      1: normalizarJugadorStatsLive(players[1], 1),
      2: normalizarJugadorStatsLive(players[2], 2)
    }
  };
}

module.exports = {
  actualizarEstadoResurreccionSnapshot,
  construirPayloadEstadoVotacionVentaja,
  crearEstadoResurreccionVacio,
  crearJugadorStatsLiveVacio,
  normalizarArrayTextoStatsLive,
  normalizarHeatmapStatsLive,
  normalizarJugadorStatsLive,
  normalizarNumeroStatsLive,
  normalizarPayloadStatsLive,
  normalizarTopTeclasStatsLive,
  payloadEstadoResurreccion,
  recortarTextoStatsLive
};
