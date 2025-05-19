// palabras_bonus.js
// Extiende MusasMode para implementar el modo “palabras bonus”
// • Reúsa colas y lógica de MusasMode.
// • Entrega automática cada timeout sin generar infinitos pendingTimers.
// • Añade contador de musas usadas y flag lastDeliveredFromMusa por cada jugador.

const puppeteer = require('puppeteer');
const MusasMode = require('./musas.js');

class PalabrasBonusMode extends MusasMode {
  // Puppeteer singleton y caché de última palabra buscada
  static _navegador      = null;
  static _palabraBuscada = null;

  /**
   * @param {import('socket.io').Server} io
   * @param {number} TIEMPO_CAMBIO_PALABRAS en ms
   */
  constructor(io, TIEMPO_CAMBIO_PALABRAS) {
    super(io, TIEMPO_CAMBIO_PALABRAS);
  }

  /**
   * Al cambiar de modo o reiniciar, limpiamos:
   * - Timers de MusasMode (pendingTimer)
   * - Nuestros timers de emisión (emitTimer)
   * - Contador insertedCount y flag lastDeliveredFromMusa de cada jugador
   */
  clearAll() {
    super.clearAll();
    [1, 2].forEach((pid) => {
      const st = this.players[pid];
      if (!st) return;
      if (st.emitTimer) {
        clearTimeout(st.emitTimer);
        st.emitTimer = null;
      }
      if (st.pendingTimer) {
        clearTimeout(st.pendingTimer);
        st.pendingTimer = null;
      }
      // Reiniciar control de flag
      st.lastDeliveredFromMusa = false;
    });
  }

  /**
   * Anulamos el schedulePending heredado.
   */
  _schedulePending(playerId) {
    // no-op
  }

  /**
   * Programa la próxima entrega automática tras timeout ms.
   */
  _scheduleNext(playerId) {
    const st = this.players[playerId];
    if (!st) return;
    if (st.emitTimer) clearTimeout(st.emitTimer);
    st.emitTimer = setTimeout(() => this.handleRequest(playerId), this.timeout);
  }

  /**
   * Procesa la petición de nueva palabra bonus:
   * 1) Extrae de cola si hay musas, aumenta insertedCount y setea lastDeliveredFromMusa=true.
   * 2) Si no, scrappea RAE y setea lastDeliveredFromMusa=false.
   * 3) Emite payload.
   * 4) Programa la siguiente entrega.
   *
   * @param {1|2} playerId
   */
  async handleRequest(playerId) {
    const st = this.players[playerId];
    if (!st) return;

    if (st.pendingTimer) {
      clearTimeout(st.pendingTimer);
      st.pendingTimer = null;
    }

    const evento = `enviar_palabra_j${playerId}`;
    let palabras_var, palabra_bonus, tiempo_palabras_bonus;

    // 1) Si hay musas en cola
    if (st.queue.length > 0) {
      const idx = Math.floor(Math.random() * st.queue.length);
      const rawPalabra = st.queue.splice(idx, 1)[0];

      // Actualizar flag y contador
      st.insertedCount = (st.insertedCount || 0) + 1;
      st.lastDeliveredFromMusa = true;

      palabras_var          = rawPalabra;
      palabra_bonus         = [[rawPalabra], ''];
      tiempo_palabras_bonus = this._puntuacionPalabra(rawPalabra);

      console.log(
        `[PalabrasBonusMode] J${playerId} recibe musa de cola: "${rawPalabra}" (musas usadas: ${st.insertedCount})`
      );
    } else {
      // 2) Cola vacía → scrappear RAE
      try {
        await PalabrasBonusMode._inicializarNavegador();
        const [rawPalabra, rawDef] = await this._palabraRAE();
        const variante = this._extraccionPalabraVar(rawPalabra);

        st.lastDeliveredFromMusa = false;

        palabras_var          = rawPalabra;
        palabra_bonus         = [variante, rawDef];
        tiempo_palabras_bonus = this._puntuacionPalabra(variante[0]);

        console.log(
          `[PalabrasBonusMode] J${playerId} recibe RAE: "${rawPalabra}" → variante ${JSON.stringify(variante)}`
        );
      } catch (err) {
        console.error('[PalabrasBonusMode] Error RAE:', err);
        st.lastDeliveredFromMusa = false;
        palabras_var          = '';
        palabra_bonus         = [[''], ''];
        tiempo_palabras_bonus = 10;
      }
    }

    // 3) Emitir payload
    const payload = {
      modo_actual:           'palabras bonus',
      palabras_var,
      palabra_bonus,
      tiempo_palabras_bonus
    };
    this.io.emit(evento, payload);

    // 4) Programar siguiente entrega automática
    this._scheduleNext(playerId);
  }

  /** Inicializa Puppeteer solo una vez. */
  static async _inicializarNavegador() {
    if (!PalabrasBonusMode._navegador) {
      PalabrasBonusMode._navegador = await puppeteer.launch({ headless: true });
    }
  }

  /** Scrapea palabra y definición de la RAE. */
  async _palabraRAE() {
    await PalabrasBonusMode._inicializarNavegador();
    const browser = PalabrasBonusMode._navegador;
    while (true) {
      let contexto, page;
      try {
        if (typeof browser.createBrowserContext === 'function') {
          contexto = await browser.createBrowserContext();
          page     = await contexto.newPage();
        } else page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        await page.setViewport({ width: 1366, height: 768 });
        await page.goto('https://dle.rae.es/?m=random2', { waitUntil: 'networkidle2' });
        await page.waitForSelector('button[aria-label="Consultar"]', { visible: true });
        await page.click('button[aria-label="Consultar"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        let palabra = 'No encontrada';
        try { palabra = await page.$eval('h1.c-page-header__title', el => el.textContent.trim()); } catch {}
        let definicion = 'Definición no encontrada';
        try { definicion = await page.$eval('ol.c-definitions li.j div.c-definitions__item > div', el => el.textContent.trim()); } catch {}

        await page.close();
        if (contexto && typeof contexto.close === 'function') await contexto.close();

        if (palabra !== 'No encontrada') return [palabra, definicion];
        throw new Error('Palabra inválida, reintentando');
      } catch (error) {
        console.error('[PalabrasBonusMode] retry RAE:', error);
        try { if (page) await page.close(); } catch {}
        try { if (contexto) await contexto.close(); } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  /** Genera variante de la palabra. */
  _extraccionPalabraVar(raw) {
    if (!raw) return [''];
    const partes = raw.split(', ');
    const palabra = partes[0];
    if (partes.length < 2) return [palabra];
    const term = partes[1];
    let idx = palabra.length - 1;
    if (term.length === 1) {
      while (idx >= 0 && !/[aeiouáéíóúü]/i.test(palabra[idx])) idx--;
    } else {
      while (idx >= 0 && palabra[idx] !== term[0]) idx--;
    }
    const prefix = palabra.slice(0, idx);
    let variante;
    if (idx > 0 && /[áéíóú]/.test(prefix[idx - 1])) {
      const sinA = prefix.slice(0, idx - 1).normalize('NFD').replace(/[\u0300-\u036f]/, '');
      variante = sinA + palabra.slice(idx);
    } else variante = prefix + term;
    return [palabra, variante];
  }

  /** Calcula “tiempo” según frecuencias de letras. */
  _puntuacionPalabra(word) {
    if (!word) return 10;
    const freq = { a:1,b:2,c:3,d:4,e:5,f:1,g:2,h:1,i:5,j:1,k:1,l:1,m:2,n:2,o:5,p:1,q:1,r:1,s:1,t:1,u:5,v:1,w:1,x:1,y:1,z:1 };
    const clean = word.toLowerCase().replace(/\s+/g, '');
    let sum = 0; for (const ch of clean) sum += freq[ch] || 0;
    const pts = Math.ceil((((10 - sum * 0.5) + clean.length * 3)) / 5) * 5;
    return isNaN(pts) ? 10 : pts;
  }

  /** Devuelve cuántas musas ha usado cada jugador. */
  getInsertedCount(playerId) {
    return this.players[playerId]?.insertedCount || 0;
  }

  /** Flag: devuelve si la última palabra fue de musa. */
  getlastDeliveredFromMusa(playerId) {
    return !!this.players[playerId]?.lastDeliveredFromMusa;
  }
}

module.exports = PalabrasBonusMode;