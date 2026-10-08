#!/usr/bin/env python3
"""Rename the private world entry, preserving the live game's existing routes."""
import argparse
from pathlib import Path
import integrate

BRIDGE = '''  // BEGIN SCRIB WORLD BRIDGE (independent from live game)
  if (url.pathname === "/mundo-scrib" || url.pathname === "/mundo-scrib/") {
    return redirect(res, "/scrib/" + url.search);
  }
  if (url.pathname === "/scrib") {
    return redirect(res, "/scrib/" + url.search);
  }
  if (url.pathname === "/scrib/" || url.pathname.startsWith("/scrib/backstage/") || url.pathname.startsWith("/mundo-scrib/")) {
    if (!session) {
      if (req.method === "GET" && !url.pathname.includes("/api/")) {
        return redirect(res, "/outpost.goauthentik.io/start?rd=" + encodeURIComponent(externalHttpsUrl(req, "/scrib/")));
      }
      return sendJson(res, 401, {ok:false,error:"Entra con Sutura / Authentik."});
    }
    return require("/home/trescejas/dockers/scrib-world/world_proxy.js")(req, res, session);
  }
  // END SCRIB WORLD BRIDGE

'''


def dashboard(source):
    if BRIDGE in source:
        return integrate.update_selector(source)
    if source.count(integrate.BRIDGE) != 1:
        raise ValueError("Bridge privado modificado; revisar antes de migrar.")
    return integrate.update_selector(source.replace(integrate.BRIDGE, BRIDGE, 1))


def redirect_root(path):
    return f'''location = {path} {{
    return 302 https://sutura-gateway.ddns.net/scrib/$is_args$args;
}}
'''


def private_location(selector):
    # Copy the already reviewed private route body, not a weaker public proxy.
    body = integrate.WORLD_POWER_NGINX.split('location ^~ /mundo-scrib/ {\n', 1)[1].split('\n}\n# END', 1)[0]
    return f'location {selector} {{\n{body}\n}}\n'


def gateway_location(selector):
    body = integrate.WORLD_POWER_GATEWAY_NGINX.split('location ^~ /mundo-scrib/ {\n', 1)[1].split('\n}\n# END', 1)[0]
    return f'location {selector} {{\n{body}\n}}\n'


# /scrib/ already contains game assets and legacy role URLs. Exact root and a
# dedicated backstage namespace take precedence, without replacing /scrib/game/
# or the old /scrib/ alias. Keep old API/asset requests working for open tabs.
NGINX = '\n# BEGIN SCRIB WORLD POWER ENTRY\n' + redirect_root('/mundo-scrib') + redirect_root('/mundo-scrib/') + ''.join(private_location(x) for x in ['= /scrib/', '^~ /scrib/backstage/', '^~ /mundo-scrib/']) + '# END SCRIB WORLD POWER ENTRY\n'
GATEWAY_NGINX = '\n# BEGIN SCRIB WORLD POWER ENTRY\n' + ''.join(redirect_root(x) for x in ['/mundo-scrib','/mundo-scrib/','/scrib']) + ''.join(gateway_location(x) for x in ['= /scrib/', '^~ /scrib/backstage/', '^~ /mundo-scrib/']) + '# END SCRIB WORLD POWER ENTRY\n\n'
GATEWAY_PREPARE = integrate.WORLD_POWER_GATEWAY_NGINX + '\n# BEGIN SCRIB CANONICAL URL STAGING\n' + redirect_root('/scrib') + gateway_location('= /scrib/') + gateway_location('^~ /scrib/backstage/') + '# END SCRIB CANONICAL URL STAGING\n\n'


def replace_checked(source, old, new):
    if source.count(new) == 1:
        return source
    if source.count(old) != 1:
        raise ValueError("Rutas instaladas modificadas; revisar antes de migrar.")
    return source.replace(old, new, 1)


def nginx(source):
    return replace_checked(source, integrate.WORLD_POWER_NGINX, NGINX)


def gateway_nginx(source):
    if source.count(GATEWAY_PREPARE) == 1:
        return source.replace(GATEWAY_PREPARE,GATEWAY_NGINX,1)
    return replace_checked(source, integrate.WORLD_POWER_GATEWAY_NGINX, GATEWAY_NGINX)


def gateway_prepare(source):
    # Keep the old root working while the backend is upgraded. Install this
    # before the backend, then finalize with gateway_nginx and update selectors.
    return replace_checked(source, integrate.WORLD_POWER_GATEWAY_NGINX, GATEWAY_PREPARE)


OLD_CONDITION = 'path == "/mundo-scrib" or path.startswith("/mundo-scrib/")'
NEW_CONDITION = 'path == "/scrib" or path.startswith("/scrib/") or ' + OLD_CONDITION


def gateway(source):
    # Update only the three world recognition points: realm, theme and activity.
    # The signed wake confirmation/cookies and public poll capabilities stay intact.
    if source.count(NEW_CONDITION) == 3:
        return source
    if source.count(OLD_CONDITION) != 3 or NEW_CONDITION in source:
        raise ValueError("Reconocimiento de mundos modificado; revisar.")
    return source.replace(OLD_CONDITION, NEW_CONDITION)


def main():
    transforms={'dashboard':dashboard,'nginx':nginx,'gateway-nginx':gateway_nginx,'gateway-prepare':gateway_prepare,'gateway':gateway}
    parser=argparse.ArgumentParser()
    parser.add_argument('kind',choices=transforms)
    parser.add_argument('source');parser.add_argument('destination')
    args=parser.parse_args()
    Path(args.destination).write_text(transforms[args.kind](Path(args.source).read_text()),encoding='utf-8')


if __name__=='__main__':main()
