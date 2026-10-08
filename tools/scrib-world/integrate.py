#!/usr/bin/env python3
"""Generate surgical integration patches; never copy secrets or replace unrelated code."""
import argparse
from pathlib import Path

LEGACY_CARD = '''      <a class="world world--scrib" href="/mundo-scrib/" aria-label="Entrar en SCRIB">
        <span class="world-scrib-logo" aria-hidden="true">&lt;SCRI&gt; B</span>
        <span class="world-scrib-copy">Videojuego · dramaturgia · bolos · elenco</span>
      </a>
'''
LEGACY_CSS = '''    /* Mundo SCRIB: lightweight, no continuous GPU effects. */
    .world--scrib { background: linear-gradient(120deg, #152f36, #20162b 55%, #40212b); border-color: #71506b; flex-direction: column; gap: 18px; }
    .world-scrib-logo { color: #fff; font: 900 clamp(2.4rem, 5vw, 4rem)/1.1 ui-monospace, Consolas, monospace; letter-spacing: -.09em; text-shadow: -2px 0 #64e7e2, 2px 0 #ff8495; }
    .world-scrib-copy { color: #c0c7d7; font: 600 .78rem/1.5 ui-sans-serif, system-ui, sans-serif; text-align: center; }
'''
CARD = '''      <a class="world world--scrib" href="/mundo-scrib/" aria-label="Entrar en SCRIB">
        <img class="world-logo world-scrib-logo" src="/favicons/scrib-world-logo.png?v=1" width="500" height="500" alt="&lt;SCRI&gt; B">
      </a>
'''
CSS = '''    /* Mundo SCRIB: lightweight, no continuous GPU effects. */
    .world--scrib { --accent: #64e7e2; background: linear-gradient(120deg, #152f36, #20162b 55%, #40212b); border-color: #71506b; gap: 0; }
    .world--scrib .world-scrib-logo { height: clamp(136px, 18vw, 160px); width: min(220px, 85%); object-fit: contain; }
'''
BRIDGE = '''  // BEGIN SCRIB WORLD BRIDGE (independent from live game)
  if (url.pathname === "/mundo-scrib") {
    return redirect(res, "/mundo-scrib/");
  }
  if (url.pathname.startsWith("/mundo-scrib/")) {
    if (!session) {
      if (req.method === "GET" && !url.pathname.includes("/api/")) {
        return redirect(res, "/outpost.goauthentik.io/start?rd=" + encodeURIComponent(externalHttpsUrl(req, "/mundo-scrib/")));
      }
      return sendJson(res, 401, {ok:false,error:"Entra con Sutura / Authentik."});
    }
    return require("/home/trescejas/dockers/scrib-world/world_proxy.js")(req, res, session);
  }
  // END SCRIB WORLD BRIDGE

'''


def update_selector(source):
    """Upgrade only the known installed card/CSS, leaving routes and worlds intact."""
    if source.count('aria-label="Entrar en SCRIB"') != 1:
        raise ValueError("La tarjeta SCRIB ha cambiado: revisar manualmente.")
    if source.count(CARD) == 1 and source.count(CSS) == 1:
        return source
    if source.count(LEGACY_CARD) != 1 or source.count(LEGACY_CSS) != 1:
        raise ValueError("El selector ha cambiado: revisar manualmente, no sobrescribir.")
    return source.replace(LEGACY_CARD, CARD, 1).replace(LEGACY_CSS, CSS, 1)


def entry_html(source):
    if 'aria-label="Entrar en SCRIB"' in source:
        return update_selector(source)
    css_marker = "    .world--wit {"
    card_marker = '      <a class="world world--wit"'
    if source.count(css_marker) != 1 or source.count(card_marker) != 1:
        raise ValueError("El portal ha cambiado: revisar manualmente, no sobrescribir.")
    return source.replace(css_marker, CSS + css_marker, 1).replace(card_marker, CARD + card_marker, 1)


def dashboard_js(source):
    if "BEGIN SCRIB WORLD BRIDGE" in source:
        raise ValueError("La integración ya existe; actualizar solo el servicio independiente.")
    source = entry_html(source)
    marker = '  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/sutura") {'
    if source.count(marker) != 1:
        raise ValueError("Las rutas han cambiado: revisar manualmente.")
    return source.replace(marker, BRIDGE + marker, 1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("kind", choices=["dashboard", "gateway", "selector"])
    p.add_argument("source")
    p.add_argument("destination")
    args = p.parse_args()
    source = Path(args.source).read_text(encoding="utf-8-sig")
    transform = {"dashboard": dashboard_js, "gateway": entry_html, "selector": update_selector}[args.kind]
    transformed = transform(source)
    Path(args.destination).write_text(transformed)


if __name__ == "__main__":
    main()
