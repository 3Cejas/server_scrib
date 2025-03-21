/******************************************************
 * rae-scrapper-simple.js
 * ----------------------------------------------------
 * Cada vez que se llama a "obtenerPalabra" se:
 *  1) Asegura un browser abierto
 *  2) Crea un contexto aislado (createBrowserContext)
 *  3) Abre página, hace random2, clica "Consultar"
 *  4) Devuelve la palabra y definición.
 *
 *  => Garantiza que en cada llamada se hace la navegación
 *     y se obtiene una palabra distinta (en la medida en que
 *     el random de la RAE lo permita).
 ******************************************************/
const puppeteer = require('puppeteer');

let navegador = null;

/** Lanza el navegador si no está ya abierto */
async function inicializarNavegador() {
  if (!navegador) {
    // Importante usar "puppeteer" completo, no "puppeteer-core"
    navegador = await puppeteer.launch({ headless: true });
  }
}

/** Cierra el navegador si quieres (opcional) */
async function cerrarNavegador() {
  if (navegador) {
    await navegador.close();
    navegador = null;
  }
}

/**
 * Abre un contexto nuevo, obtiene la palabra aleatoria y la devuelve.
 * Bloqueante: siempre tardará unos segundos, pero cada llamada
 * obtiene (generalmente) una palabra distinta.
 *
 * @returns {Promise<[string, string]>} [palabra, definicion]
 */
async function obtenerPalabra() {
  if (!navegador) {
    await inicializarNavegador();
  }

  const contexto = await navegador.createBrowserContext();
  const page = await contexto.newPage();

  try {
    // Recomendado: user agent "realista"
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
    );

    await page.goto('https://dle.rae.es/?m=random2', { waitUntil: 'networkidle2' });

    // Clic en "Consultar"
    await page.waitForSelector('button[aria-label="Consultar"]', {
      visible: true,
      timeout: 30000,
    });
    await page.click('button[aria-label="Consultar"]');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    let palabra = 'No encontrada';
    try {
      palabra = await page.$eval('h1.c-page-header__title', (el) => el.textContent.trim());
    } catch {}

    let definicion = 'Definición no encontrada';
    try {
      definicion = await page.$eval(
        'ol.c-definitions li.j div.c-definitions__item > div',
        (el) => el.textContent.trim()
      );
    } catch {}

    return [palabra, definicion];
  } finally {
    // Cerramos la pestaña y el contexto
    await page.close();
    await contexto.close();
  }
}

// Exponemos las funciones
module.exports = { inicializarNavegador, cerrarNavegador, obtenerPalabra };

// Prueba local
if (require.main === module) {
  (async () => {
    await inicializarNavegador();
    const primera = await obtenerPalabra();
    console.log('Primera:', primera);

    const segunda = await obtenerPalabra();
    console.log('Segunda:', segunda);

    await cerrarNavegador();
  })();
}