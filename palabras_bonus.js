// palabras_bonus.js
// Módulo “palabras bonus” extendiendo MusasMode
// • Reúsa colas, timeouts y contadores de MusasMode.
// • Sólo suma punto si la última entrega fue de musa.
// • Entrega de musas de cola o, en su defecto, scrapper RAE.

const puppeteer = require('puppeteer');
const MusasMode = require('./musas.js');

class PalabrasBonusMode extends MusasMode {
  static _navegador      = null;
  static _palabraBuscada = null;

  /**
   * @param {import('socket.io').Server} io
   * @param {number} TIEMPO_CAMBIO_PALABRAS en ms
   */
  constructor(io, TIEMPO_CAMBIO_PALABRAS) {
    super(io, TIEMPO_CAMBIO_PALABRAS);

    // Inicializar contador y flag de musa previa
    [1, 2].forEach(id => {
      this.players[id].insertedCount           = 0;
      this.players[id].lastDeliveredFromMusa   = false;
    });
  }

  /**
   * Al solicitar palabra bonus:
   * 1) Si la última entrega fue musa → suma punto.
   * 2) Limpia pendingTimer previo.
   * 3) Si hay musa en cola → isMusa=true y extrae de queue.
   *    Sino → isMusa=false y scrappea RAE.
   * 4) Emite { modo_actual, palabras_var, palabra_bonus, tiempo_palabras_bonus }.
   * 5) Reprograma timeout.
   * 6) Marca lastDeliveredFromMusa = isMusa.
   *
   * @param {1|2} playerId
   */
  async handleRequest(playerId) {
    const st = this.players[playerId];
    if (!st) return;

    // 1) Sumar punto si la última entrega fue de musa
    if (st.lastDeliveredFromMusa) {
      st.insertedCount++;
      console.log(
        `[PalabrasBonusMode] J${playerId} usó musa anterior → insertedCount=${st.insertedCount}`
      );
    }

    // 2) Limpiar pendingTimer anterior
    if (st.pendingTimer) {
      clearTimeout(st.pendingTimer);
      st.pendingTimer = null;
    }

    const evento = `enviar_palabra_j${playerId}`;
    let palabras_var,
        palabra_bonus,
        tiempo_palabras_bonus;

    // 3) Decidir fuente: cola de musas o RAE
    let isMusa = false;
    if (st.queue.length > 0) {
      isMusa = true;
      const idx  = Math.floor(Math.random() * st.queue.length);
      const word = st.queue.splice(idx, 1)[0];

      palabras_var          = word;
      palabra_bonus         = [word, ''];                     // sin definición
      tiempo_palabras_bonus = this._puntuacionPalabra(word);

      console.log(
        `[PalabrasBonusMode] J${playerId} recibe musa de cola: "${word}"`
      );

    } else {
      // Scrapper RAE
      try {
        const [ rawPalabra, rawDef ] = await this._palabraRAE();
        palabras_var = rawPalabra;

        // Obtener Variante humanizada
        const variante = this._extraccionPalabraVar(rawPalabra);
        palabra_bonus  = [ variante, rawDef ];

        tiempo_palabras_bonus = this._puntuacionPalabra(variante[0]);

        console.log(
          `[PalabrasBonusMode] J${playerId} recibe RAE: "${rawPalabra}" → variante ${JSON.stringify(variante)}`
        );
      } catch (err) {
        console.error('[PalabrasBonusMode] Error RAE:', err);
        palabras_var          = '';
        palabra_bonus         = [[''], ''];
        tiempo_palabras_bonus = 10;
      }
    }

    // 4) Emitir payload unificado
    const payload = {
      modo_actual: 'palabras bonus',
      palabras_var,
      palabra_bonus,
      tiempo_palabras_bonus
    };
    console.log(`[PalabrasBonusMode] Emisión ${evento}:`);
    console.dir(payload, { depth: null, colors: true });

    this.io.emit(evento, payload);

    // 5) Reprogramar siguiente envío automático
    this._schedulePending(playerId);

    // 6) Marcar para siguiente petición si fue musa
    st.lastDeliveredFromMusa = isMusa;
  }

  // ───────── Métodos privados para RAE y procesados ────────────────────

  /** Inicializa el navegador Puppeteer (singleton). */
  static async _inicializarNavegador() {
    if (!PalabrasBonusMode._navegador) {
      PalabrasBonusMode._navegador = await puppeteer.launch({ headless: true });
    }
  }

  /**
   * Scrapea palabra y definición de la RAE mediante contextos de incógnito.
   * Reintenta hasta encontrar “No encontrada” distinto.
   * @returns {Promise<[string, string]>} [palabra, definición]
   */
  async _palabraRAE() {
    await PalabrasBonusMode._inicializarNavegador();
    const browser = PalabrasBonusMode._navegador;

    while (true) {
      let contexto, page;
      try {
        // 1) Crear contexto incógnito o fallback
        if (typeof browser.createBrowserContext === 'function') {
          contexto = await browser.createBrowserContext();
          page     = await contexto.newPage();
        } else {
          page     = await browser.newPage();
        }

        // 2) Emular navegador real
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        await page.setViewport({ width: 1366, height: 768 });

        // 3) Navegar y pulsar “Consultar”
        await page.goto('https://dle.rae.es/?m=random2', { waitUntil: 'networkidle2' });
        await page.waitForSelector('button[aria-label="Consultar"]', { visible: true });
        await page.click('button[aria-label="Consultar"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // 4) Extraer palabra
        let palabra = 'No encontrada';
        try {
          palabra = await page.$eval('h1.c-page-header__title', el => el.textContent.trim());
        } catch {}

        // 5) Extraer definición
        let definicion = 'Definición no encontrada';
        try {
          definicion = await page.$eval(
            'ol.c-definitions li.j div.c-definitions__item > div',
            el => el.textContent.trim()
          );
        } catch {}

        // 6) Cerrar recursos
        await page.close();
        if (contexto && typeof contexto.close === 'function') {
          await contexto.close();
        }

        // 7) Validar y retornar
        if (palabra && palabra !== 'No encontrada') {
          return [palabra, definicion];
        }
        throw new Error('Palabra inválida, reintentando');
      } catch (e) {
        console.error('[PalabrasBonusMode] retry RAE:', e);
        try { if (page)     await page.close();     } catch {}
        try { if (contexto) await contexto.close(); } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  /**
   * A partir de “palabra, terminación” genera [original, variante].
   * @param {string} raw
   * @returns {[string,string]|[string]}
   */
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
      const sinA = prefix
        .slice(0, idx - 1)
        + prefix[idx - 1].normalize('NFD').replace(/[\u0300-\u036f]/, '');
      variante = sinA + palabra.slice(idx);
    } else {
      variante = prefix + term;
    }
    return [palabra, variante];
  }

  /**
   * Calcula tiempo según frecuencias de letras (map estático).
   * @param {string} word
   * @returns {number}
   */
  _puntuacionPalabra(word) {
    if (!word) return 10;
    const freq = {
      a:1,b:2,c:3,d:4,e:5,f:1,g:2,h:1,i:5,
      j:1,k:1,l:1,m:2,n:2,o:5,p:1,q:1,r:1,
      s:1,t:1,u:5,v:1,w:1,x:1,y:1,z:1
    };
    const clean = word.toLowerCase().replace(/\s+/g, '');
    let sum = 0;
    for (const ch of clean) sum += freq[ch] || 0;
    const pts = Math.ceil((((10 - sum*0.5) + clean.length*3)) / 5) * 5;
    return isNaN(pts) ? 10 : pts;
  }
}

module.exports = PalabrasBonusMode;