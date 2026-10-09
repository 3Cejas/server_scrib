import http.client
import json
import unittest
from urllib.parse import urlparse
import uuid
import integrate
import rename_world
import test_world as fixtures
from test_power import GATEWAY, isolated_functions


class UrlIntegrationTests(unittest.TestCase):
    def test_selector_and_bridge_migrate_idempotently_without_game_catchall(self):
        old = integrate.CSS + integrate.PREVIOUS_CARD + integrate.PUBLIC_BRIDGE + integrate.BRIDGE + '// unrelated routes'
        changed = rename_world.dashboard(old)
        self.assertEqual(changed,rename_world.dashboard(changed))
        self.assertIn('href="https://sutura-gateway.ddns.net/scrib/"',changed)
        self.assertIn(integrate.PUBLIC_BRIDGE,changed)
        self.assertTrue(changed.endswith('// unrelated routes'))
        self.assertNotIn('startsWith("/scrib/")',rename_world.BRIDGE)
        self.assertIn('startsWith("/scrib/backstage/")',rename_world.BRIDGE)
        self.assertIn('if (!session)',rename_world.BRIDGE)
        self.assertIn('externalHttpsUrl(req, "/scrib/")',rename_world.BRIDGE)

    def test_nginx_only_claims_world_root_and_backstage_not_game_assets(self):
        original='unrelated nginx routes\n'+integrate.PUBLIC_NGINX+integrate.WORLD_POWER_NGINX
        result=rename_world.nginx(original)
        self.assertEqual(result,rename_world.nginx(result))
        self.assertIn('location = /scrib/ {',result)
        self.assertIn('location ^~ /scrib/backstage/ {',result)
        self.assertNotIn('location ^~ /scrib/ {',result)
        self.assertNotIn('location = /scrib {',result) # The original parent config already defines it.
        self.assertNotIn('/scrib/game/',result)
        self.assertEqual(result.count('nginx-forward-auth-snippet.conf;'),3)
        self.assertIn(integrate.PUBLIC_NGINX,result)
        self.assertIn('location = /mundo-scrib/ {\n    return 302 https://sutura-gateway.ddns.net/scrib/$is_args$args;',result)

    def test_gateway_migration_preserves_wake_and_other_worlds(self):
        original=integrate.PUBLIC_GATEWAY_NGINX+integrate.WORLD_POWER_GATEWAY_NGINX+'location = /sutura { other worlds }'
        result=rename_world.gateway_nginx(original)
        self.assertEqual(result,rename_world.gateway_nginx(result))
        self.assertEqual(result.count('auth_request /_wake/check;'),4)
        self.assertIn('location = /scrib {',result)
        self.assertNotIn('location ^~ /scrib/ {',result)
        self.assertIn(integrate.PUBLIC_GATEWAY_NGINX,result)
        self.assertTrue(result.endswith('location = /sutura { other worlds }'))
        prepared=rename_world.gateway_prepare(original)
        self.assertIn(integrate.WORLD_POWER_GATEWAY_NGINX,prepared)
        self.assertEqual(result,rename_world.gateway_nginx(prepared))
        self.assertEqual(prepared,rename_world.gateway_prepare(prepared))

    def test_new_and_legacy_world_are_both_activity_and_sutura_wake_targets(self):
        original=integrate.world_power_gateway(GATEWAY)
        changed=rename_world.gateway(original)
        self.assertEqual(changed,rename_world.gateway(changed))
        ns=isolated_functions(changed,['world_service_key','service_theme','is_world_location'],{
            'urlparse':urlparse,'WORLD_ACTIVITY_PREFIXES':['/sutura/','/wit/','/impropios/','/trescejas/'],
            'is_availability_location':lambda _:False,
        })
        for path in ['/scrib','/scrib/','/scrib/backstage/api/state','/mundo-scrib/']:
            self.assertEqual(ns['world_service_key'](path),'sutura')
            self.assertTrue(ns['is_world_location'](path))
            self.assertEqual(ns['service_theme'](path)['label'],'<SCRI> B')
        for path in ['/scrib-evil','/scribble/','/scrib-disponibilidad/fake']:
            self.assertFalse(ns['is_world_location'](path))
            self.assertEqual(ns['world_service_key'](path),'')
        for key in ['sutura','wit','impropios','trescejas']:
            self.assertEqual(ns['world_service_key']('/'+key+'/'),key)

    def test_unknown_installed_config_fails_closed(self):
        for fn in [rename_world.dashboard,rename_world.nginx,rename_world.gateway_nginx,rename_world.gateway]:
            with self.assertRaises(ValueError):fn('modified source')

    def test_visible_brand_is_scrib_without_world_prefix(self):
        html=(fixtures.ROOT/'public/index.html').read_text()
        self.assertIn('<title>&lt;SCRI&gt; B</title>',html)
        self.assertIn('aria-label="&lt;SCRI&gt; B, inicio"',html)
        self.assertIn('class="sidebar-heading"',html)
        self.assertEqual(html.count('class="brand-logo"'),1)
        self.assertEqual(html.count('id="connection"'),1)
        self.assertLess(html.index('class="brand-logo"'),html.index('id="connection"'))
        for redundant in ['topbar-brand','brand-word','workspace-caption','id="breadcrumb"','class="topbar"']:
            self.assertNotIn(redundant,html)
        self.assertIn('href="/logout" aria-label="Cerrar sesión"',html)
        self.assertNotIn('Mundo SCRIB',html)
        js=(fixtures.ROOT/'public/app.js').read_text()
        self.assertNotIn('querySelector("#breadcrumb")',js)
        self.assertIn('x.setAttribute("aria-current","page")',js)
        css=(fixtures.ROOT/'public/tasks.css').read_text()
        self.assertIn('.sidebar .sidebar-heading .brand{margin:0;',css)
        self.assertIn('.sidebar .sidebar-bottom{display:block;',css)
        self.assertIn('&lt;SCRI&gt; B · ${niceDate(today())}',js)
        self.assertNotIn('MUNDO SCRIB',js)
        self.assertNotIn('Mundo SCRIB',js)


class UrlHTTPTests(unittest.TestCase):
    setUp=fixtures.HTTPTests.setUp
    tearDown=fixtures.HTTPTests.tearDown

    def http(self,path,headers=None,data=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        h=dict(self.headers);h.update(headers or {})
        if data is not None:h['Content-Type']='application/json'
        conn.request('GET' if data is None else 'POST',path,body=None if data is None else json.dumps(data),headers=h)
        r=conn.getresponse();result=(r.status,r.read(),dict(r.headers));conn.close();return result

    def test_root_and_assets_use_scrib_with_same_authentication(self):
        status,body,_=self.http('/scrib/')
        self.assertEqual(status,200)
        self.assertIn(b'/scrib/backstage/app.js',body)
        self.assertNotIn(b'/mundo-scrib/',body)
        for path in ['/scrib/','/scrib/backstage/app.js','/scrib/backstage/api/state','/mundo-scrib/api/state']:
            self.assertEqual(self.http(path,{'X-Scrib-Bridge':''})[0],401)

    def test_new_api_and_legacy_api_keep_their_cookie_scopes(self):
        for prefix in ['/scrib/backstage/','/mundo-scrib/']:
            status,body,h=self.http(prefix+'api/state')
            self.assertEqual(status,200)
            self.assertIn('Path='+prefix+';',h['Set-Cookie'])
            token=json.loads(body)['csrf']
            status,body,_=self.http(prefix+'api/create',{'Origin':'https://sutura-gateway.ddns.net','Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':token},{'kind':'person','data':{'name':'Isolated test'},'requestId':str(uuid.uuid4())})
            self.assertEqual(status,200)

    def test_service_does_not_claim_game_or_role_routes(self):
        for path in ['/scrib/game/','/scrib/control/','/scrib/players/','/scrib/js/runtime.js']:
            self.assertEqual(self.http(path)[0],404)


if __name__=='__main__':unittest.main()
