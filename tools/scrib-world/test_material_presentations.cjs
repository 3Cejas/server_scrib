const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "materials");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the show guide is manual, animated, silent and omits slide and timing counters", () => {
  const html = read("tutorial/index.html");
  const css = read("tutorial/tutorial.css");
  const js = read("tutorial/tutorial.js");

  assert.equal((html.match(/<section class="slide/g) || []).length, 19);
  assert.doesNotMatch(html, /data-minutes|deck__counter|deck__timing|id="slideTime"|id="totalTime"/);
  assert.doesNotMatch(js, /dataset\.minutes|slideTime|totalTime|INCLUYE PREGUNTAS/);
  assert.match(html, /id="prev"[\s\S]*id="next"/);
  assert.match(js, /ArrowRight[\s\S]*ArrowLeft/);
  assert.match(js, /touchstart[\s\S]*touchend/);
  assert.match(js, /resetSlideAnimations/);
  assert.match(html, /id="fullscreenToggle"[\s\S]*PANTALLA COMPLETA/);
  assert.match(html, /fullscreen-button__icon[\s\S]*<i><\/i><i><\/i><i><\/i><i><\/i>/);
  assert.match(js, /requestFullscreen/);
  assert.match(js, /exitFullscreen/);
  assert.match(js, /fullscreenchange/);
  assert.match(js, /classList\.toggle\("is-fullscreen", isFullscreen\)/);
  assert.match(css, /fullscreen-button\.is-fullscreen \.fullscreen-button__icon i:nth-child\(1\)[^{]*\{[^}]*rotate\(180deg\)/);
  assert.match(css, /\.slide\.is-active/);
  assert.match(css, /\.slide\.is-exiting-right/);
  assert.match(css, /\.deck\{[^}]*overflow:clip/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /<audio|<video/i);
  assert.doesNotMatch(js, /speechSynthesis|new Audio/i);
});

test("the writing and Muse examples explain their cause-and-effect animations", () => {
  const html = read("tutorial/index.html");
  const css = read("tutorial/tutorial.css");
  const js = read("tutorial/tutorial.js");

  assert.match(html, /ESCRIBIENDO[\s\S]*SE HA DETENIDO[\s\S]*EL VIDEOJUEGO BORRA EL TEXTO/);
  assert.match(html, /BARRA DE INSPIRACIÓN[\s\S]*inspiration-meter__track[\s\S]*AUMENTA[\s\S]*SE RESTA/);
  assert.match(css, /@keyframes writeThenErase[\s\S]*width:28ch[\s\S]*width:0/);
  assert.match(css, /inspiration-meter__track\{[^}]*background:var\(--red\)/);
  assert.match(css, /inspiration-meter__track i\{[^}]*background:var\(--cyan\)/);
  assert.match(css, /@keyframes inspirationShift[\s\S]*width:82%[\s\S]*width:12%/);
  assert.match(css, /inspiration-meter__track i::after\{[^}]*right:0/);
  assert.doesNotMatch(css, /@keyframes inspirationBoundary/);
  assert.match(html, /muse-phone[\s\S]*idea-path[\s\S]*idea-flight[\s\S]*writer-page/);
  assert.match(css, /@keyframes ideaFlight[\s\S]*left:0[\s\S]*left:calc\(100% - 94px\)/);
  assert.match(css, /@keyframes ideaFlightVertical[\s\S]*top:0[\s\S]*top:calc\(100% - 36px\)/);
  assert.match(css, /@keyframes wordUsed[\s\S]*72%\{opacity:0\}[\s\S]*opacity:1/);
  assert.match(js, /slide\.querySelectorAll\("\*"\)/);
});

test("the guide covers the complete live workflow with a visual tutorial sample", () => {
  const html = read("tutorial/index.html");

  [
    "Videotutorial del público",
    "Narración de apertura",
    "Presentación de equipos",
    "Escribir alimenta la inspiración",
    "Una idea utilizada vale más",
    "¿Qué desventajas pueden elegir?",
    "Batalla, voto y desventaja",
    "Los intérpretes observan y preparan",
    "PREPARAD LA ESCENA",
    "Representación sincronizada",
    "Lo que mide el videojuego",
    "Lo que valora el jurado",
    "GANADOR",
    "FOTO",
    "CRÉDITOS",
    "Preguntas"
  ].forEach((copy) => assert.match(html, new RegExp(copy, "i")));

  assert.match(html, /scribshow-musa-qr\.svg/);
  assert.match(html, /tutorial-scene--1[\s\S]*tutorial-scene--4/);
  assert.match(html, /Producción[\s\S]*Ritmo[\s\S]*Riqueza léxica[\s\S]*Inspiración[\s\S]*Precisión[\s\S]*Pulsaciones/);
  assert.match(html, /📝[\s\S]*Producción[\s\S]*💻[\s\S]*Pulsaciones/u);
  assert.match(html, /Palabras construidas[\s\S]*Pulsaciones por minuto[\s\S]*Palabras diferentes[\s\S]*Ideas de Musas aprovechadas[\s\S]*Menos intentos prohibidos[\s\S]*Total de teclas pulsadas/);
  assert.match(html, /Idea y mundo · Voz · Estructura · Riesgo · Cierre/);
  assert.match(html, /Inspiración útil · Escucha · Ritmo · Cooperación/);
});

test("the revised guide clarifies roles, game flow and live staging", () => {
  const html = read("tutorial/index.html");
  const css = read("tutorial/tutorial.css");

  assert.match(html, /Controla el videojuego, coordina el espectáculo y prepara la propuesta luminotécnica y sonora/);
  assert.doesNotMatch(html, /REPRODUCCIÓN DE MUESTRA · SIN NARRACIÓN|Cinco segundos de negro/);
  assert.match(html, /EL PRESENTADOR TOMA EL RELEVO[\s\S]*explica al público y a los equipos cómo se juega/);
  assert.match(html, /team__roles[\s\S]*ESCRITXR[\s\S]*INTÉRPRETE 1[\s\S]*INTÉRPRETE 2/);
  assert.match(css, /\.team-reveal__versus\{[^}]*place-items:center[^}]*color:var\(--gold\)/);

  assert.match(html, /Las Musas envían palabras\./);
  assert.doesNotMatch(html, /Las Musas envían letras o palabras\./);
  assert.match(html, /muse-balance[\s\S]*muse-balance__track/);
  assert.doesNotMatch(html, /PALABRA UTILIZADA/);
  assert.match(css, /@keyframes museBalanceFill[\s\S]*width:50%[\s\S]*width:72%/);

  assert.ok(
    html.indexOf('aria-label="Recorrido de niveles"') < html.indexOf('aria-label="Catálogo de desventajas"') &&
      html.indexOf('aria-label="Catálogo de desventajas"') < html.indexOf('aria-label="Niveles y desventajas"'),
    "the levels and disadvantage catalogue should precede battle, voting and the applied disadvantage"
  );
  assert.match(css, /\.level-ribbon div\{display:flex[\s\S]*align-items:center[\s\S]*justify-content:center/);
  assert.match(css, /level-ribbon div:nth-child\(1\)\{--level-color:#ffd65a\}[\s\S]*nth-child\(6\)\{--level-color:#ffad42\}/);
  assert.match(html, /TORTUGA[\s\S]*RAYO[\s\S]*BRUMA[\s\S]*INVERSO[\s\S]*BLOQUEO/);
  assert.match(html, /elige una de las desventajas anteriores entre las tres opciones/);
  assert.match(css, /duel-bar\{[^}]*background:var\(--red\)[\s\S]*@keyframes duelBlueFill[\s\S]*width:72%/);
  assert.match(css, /duel-bar i::after\{[^}]*right:0/);
  assert.match(html, /EXCEPCIÓN[\s\S]*80% \/ 20%[\s\S]*Tertulia[\s\S]*Frase final/);
  assert.match(html, /vote-picks__ray[\s\S]*vote-picks__mist[\s\S]*vote-picks__lock/);
  assert.match(html, /effect-scene--ray[\s\S]*effect-scene--mist[\s\S]*effect-scene--lock/);
  assert.doesNotMatch(html.slice(html.indexOf('aria-label="Niveles y desventajas"'), html.indexOf('aria-label="Rol de intérpretes')), />INVERSO</);
  assert.match(css, /@keyframes pickRay[\s\S]*@keyframes effectLockScene/);

  assert.match(html, /actor-console__note[\s\S]*ENTRAR DESDE PLATEA/);
  assert.match(html, /actor-console__toolbar/);
  assert.match(css, /@keyframes actorToolbar[\s\S]*@keyframes actorNote/);
  assert.match(html, /walkie-talkies[\s\S]*📻 WALKIE · TÉCNICA/u);
  assert.match(html, /Escritxres<\/strong><span>Responder alguna pregunta de última hora de sus intérpretes y sentarse a disfrutar de la representación\./);

  assert.match(html, /teleprompter-demo__scroll[\s\S]*<mark><b>01<\/b>¿Estás segura\?<\/mark>[\s\S]*MARCA 01/);
  assert.doesNotMatch(html, /TEXTO EN CURSO|SINCRONIZADO/);
  assert.match(css, /@keyframes teleprompterScroll[\s\S]*translateY\(250px\)[\s\S]*translateY\(-330px\)/);
  assert.match(html, /jury-balance__halo[\s\S]*jury-balance__beam[\s\S]*jury-balance__pan--blue[\s\S]*jury-balance__pan--red[\s\S]*jury-balance__core[\s\S]*VEREDICTO/);
  assert.doesNotMatch(html, /jury-balance__pivot|<b>50<\/b><span>50<\/span>|EL OTRO 50%/);
  assert.match(css, /@keyframes balanceHalo[\s\S]*@keyframes balanceCore/);
  assert.doesNotMatch(html, /Comprobación de equipo|Lista de comprobación/);
});
