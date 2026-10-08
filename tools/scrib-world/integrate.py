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
RELATIVE_CARD = '''      <a class="world world--scrib" href="/mundo-scrib/" aria-label="Entrar en SCRIB">
        <img class="world-logo world-scrib-logo" src="/favicons/scrib-world-logo.png?v=1" width="500" height="500" alt="&lt;SCRI&gt; B">
      </a>
'''
PREVIOUS_CARD = RELATIVE_CARD.replace('href="/mundo-scrib/"', 'href="https://sutura-gateway.ddns.net/mundo-scrib/"')
CARD = RELATIVE_CARD.replace('href="/mundo-scrib/"', 'href="https://sutura-gateway.ddns.net/scrib/"')
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
PUBLIC_BRIDGE = '''  // BEGIN SCRIB AVAILABILITY PUBLIC BRIDGE (no private identity)
  if (url.pathname.startsWith("/scrib-disponibilidad/")) {
    return require("/home/trescejas/dockers/scrib-world/public_proxy.js")(req, res);
  }
  // END SCRIB AVAILABILITY PUBLIC BRIDGE

'''
PUBLIC_NGINX = '''
# BEGIN SCRIB AVAILABILITY PUBLIC FORMS
location ^~ /scrib-disponibilidad/ {
    access_log off;
    error_log /dev/null crit;
    client_max_body_size 16k;
    proxy_pass http://127.0.0.1:5099;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 35s;
}
# END SCRIB AVAILABILITY PUBLIC FORMS
'''
PUBLIC_GATEWAY_NGINX = '''
# BEGIN SCRIB AVAILABILITY PUBLIC FORMS
location ^~ /scrib-disponibilidad/ {
    access_log off;
    error_log /dev/null crit;
    client_max_body_size 16k;
    auth_request /_wake/check;
    error_page 401 = @wake_backend;
    proxy_pass https://sutura_backend_https;
    include /etc/nginx/snippets/sutura-proxy-common.conf;
}
# END SCRIB AVAILABILITY PUBLIC FORMS

'''
WORLD_POWER_NGINX = '''
# BEGIN SCRIB WORLD POWER ENTRY
location = /mundo-scrib {
    return 302 https://sutura-gateway.ddns.net/mundo-scrib/$is_args$args;
}
location ^~ /mundo-scrib/ {
    # This header selects the route only; forward-auth still protects every request.
    if ($http_x_sutura_gateway_entry != "1") {
        return 302 https://sutura-gateway.ddns.net$request_uri;
    }
    include /home/trescejas/dockers/authentik/nginx-forward-auth-snippet.conf;
    proxy_pass http://127.0.0.1:5099;
    proxy_http_version 1.1;
    proxy_redirect off;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_connect_timeout 30s;
    proxy_send_timeout 30s;
    proxy_read_timeout 90s;
}
# END SCRIB WORLD POWER ENTRY
'''
WORLD_POWER_GATEWAY_NGINX = '''
# BEGIN SCRIB WORLD POWER ENTRY
location = /mundo-scrib {
    return 302 https://sutura-gateway.ddns.net/mundo-scrib/$is_args$args;
}
location ^~ /mundo-scrib/ {
    if ($host != "sutura-gateway.ddns.net") {
        return 302 https://sutura-gateway.ddns.net$request_uri;
    }
    auth_request /_wake/check;
    error_page 401 = @wake_backend;
    proxy_pass https://sutura_backend_https;
    proxy_set_header X-Sutura-Gateway-Entry 1;
    include /etc/nginx/snippets/sutura-proxy-common.conf;
}
# END SCRIB WORLD POWER ENTRY

'''
WORLD_SERVICE_KEY = '''def world_service_key(value):
    path = urlparse(str(value or "")).path or "/"
    for key in ("sutura", "impropios", "wit", "trescejas"):
'''
SCRIB_SERVICE_KEY = WORLD_SERVICE_KEY.replace('    for key in', '''    # SCRIB uses the same Authentik identity and wake context as Sutura.
    if path == "/mundo-scrib" or path.startswith("/mundo-scrib/"):
        return "sutura"
    for key in''')
SCRIB_WAKE_THEME = '''    if path == "/mundo-scrib" or path.startswith("/mundo-scrib/"):
        return {
            "class": "theme-scrib",
            "label": "<SCRI> B",
            "short": "<>",
            "logo": "/favicons/scrib-world-logo.png?v=1",
            "tagline": "el backstage",
        }
'''
SCRIB_WAKE_STYLES = '''    .theme-scrib {{ --accent:#64e7e2; --accent-soft:rgba(100,231,226,.2); --bg-a:#10121b; --bg-b:#24333f; --ink:#f4f5fa; --muted:#bec7d2; --line:rgba(255,255,255,.18); --logo-bg:#10121b; --logo-ring:rgba(100,231,226,.35); --logo-shadow:rgba(0,0,0,.25); }}
    .theme-scrib .logo-wrap {{ background:#10121b; }}
    .theme-scrib button {{ color:#10121b; }}
'''


def world_power_nginx(source):
    if WORLD_POWER_NGINX in source:
        return source
    if source.count('location = /_auth_check {') != 1 or 'location = /mundo-scrib' in source or 'SCRIB WORLD POWER ENTRY' in source:
        raise ValueError('Rutas privadas modificadas; revisar antes de aplicar.')
    return source + WORLD_POWER_NGINX


def world_power_gateway_nginx(source):
    if WORLD_POWER_GATEWAY_NGINX in source:
        return source
    marker = 'location = /sutura {\n'
    if source.count(marker) != 1 or 'location = /mundo-scrib' in source or 'SCRIB WORLD POWER ENTRY' in source:
        raise ValueError('Entrada del gateway modificada; revisar antes de aplicar.')
    return source.replace(marker, WORLD_POWER_GATEWAY_NGINX + marker, 1)


def world_power_gateway(source):
    # Preserve the shared wake confirmation, signed cookies and activity handler.
    source = availability_gateway(source)
    previous_theme = SCRIB_WAKE_THEME.replace('"class": "theme-scrib"', '"class": "theme-sutura"')
    if SCRIB_SERVICE_KEY in source and source.count(previous_theme) == 1:
        source = source.replace(previous_theme, SCRIB_WAKE_THEME, 1)
    if not (SCRIB_SERVICE_KEY in source and source.count(SCRIB_WAKE_THEME) == 1):
        marker = '    if path.startswith("/wit/") or path == "/wit":\n'
        if source.count(WORLD_SERVICE_KEY) != 1 or source.count(marker) != 1 or SCRIB_WAKE_THEME in source:
            raise ValueError('Identidad/tema de encendido modificados; revisar.')
        source = source.replace(WORLD_SERVICE_KEY, SCRIB_SERVICE_KEY, 1)
        source = source.replace(marker, SCRIB_WAKE_THEME + marker, 1)
    if source.count(SCRIB_WAKE_STYLES) == 2:
        return source
    css_marker = '    .theme-wit {{'
    if source.count(css_marker) != 2 or SCRIB_WAKE_STYLES in source:
        raise ValueError('Estilos de encendido modificados; revisar.')
    return source.replace(css_marker, SCRIB_WAKE_STYLES + css_marker)


def availability_nginx(source):
    if PUBLIC_NGINX in source:
        return source
    if source.count('location = /_auth_check {') != 1 or 'SCRIB AVAILABILITY' in source:
        raise ValueError('Configuración de autenticación modificada; revisar.')
    return source + PUBLIC_NGINX


def availability_gateway_nginx(source):
    if PUBLIC_GATEWAY_NGINX in source:
        return source
    marker = 'location = /sutura {\n'
    if source.count(marker) != 1 or 'SCRIB AVAILABILITY' in source:
        raise ValueError('Rutas del gateway modificadas; revisar.')
    return source.replace(marker, PUBLIC_GATEWAY_NGINX + marker, 1)


def availability_dashboard(source):
    if PUBLIC_BRIDGE in source:
        return source
    if source.count(BRIDGE) != 1:
        raise ValueError('El bridge privado ha cambiado; no sobrescribir.')
    return source.replace(BRIDGE, PUBLIC_BRIDGE + BRIDGE, 1)


def availability_gateway(source):
    marker = 'def is_world_location(value):\n'
    if 'from gateway_availability import is_availability_location' in source:
        return source
    if source.count(marker) != 1:
        raise ValueError('Gateway modificado; revisar antes de aplicar.')
    source = source.replace(marker, 'from gateway_availability import is_availability_location\n\n\n' + marker, 1)
    old = '    return any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in WORLD_ACTIVITY_PREFIXES)'
    if source.count(old) != 1:
        raise ValueError('Validación de mundos modificada; revisar.')
    source = source.replace(old, '    return is_availability_location(value) or path == "/mundo-scrib" or path.startswith("/mundo-scrib/") or any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in WORLD_ACTIVITY_PREFIXES)', 1)
    # Capability paths must not leak into routine diagnostics/activity histories.
    source = source.replace('next_uri[:300]', "('[encuesta SCRIB]' if is_availability_location(next_uri) else next_uri[:300])")
    old = '            record_browser_activity(\n                path,\n'
    if source.count(old) != 1:
        raise ValueError('Registro de actividad modificado; revisar.')
    return source.replace(old, '            record_browser_activity(\n                "/scrib-disponibilidad/[encuesta]" if is_availability_location(path) else path,\n', 1)


def update_selector(source):
    """Upgrade only the known installed card/CSS, leaving routes and worlds intact."""
    if source.count('aria-label="Entrar en SCRIB"') != 1:
        raise ValueError("La tarjeta SCRIB ha cambiado: revisar manualmente.")
    if source.count(CARD) == 1 and source.count(CSS) == 1:
        return source
    if source.count(RELATIVE_CARD) == 1 and source.count(CSS) == 1:
        return source.replace(RELATIVE_CARD, CARD, 1)
    if source.count(PREVIOUS_CARD) == 1 and source.count(CSS) == 1:
        return source.replace(PREVIOUS_CARD, CARD, 1)
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
    transforms = {"dashboard": dashboard_js, "gateway": entry_html, "selector": update_selector, "availability-dashboard": availability_dashboard, "availability-gateway": availability_gateway, "availability-nginx": availability_nginx, "availability-gateway-nginx": availability_gateway_nginx, "world-power-nginx": world_power_nginx, "world-power-gateway-nginx": world_power_gateway_nginx, "world-power-gateway": world_power_gateway}
    p.add_argument("kind", choices=list(transforms))
    p.add_argument("source")
    p.add_argument("destination")
    args = p.parse_args()
    source = Path(args.source).read_text(encoding="utf-8-sig")
    transform = transforms[args.kind]
    transformed = transform(source)
    Path(args.destination).write_text(transformed)


if __name__ == "__main__":
    main()
