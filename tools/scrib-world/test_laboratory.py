import re
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urljoin, urlsplit, unquote
from laboratory import LaboratoryLibrary, POLICY, DEMO_POLICY, PREFIX
import test_world as fixtures

ROOT=Path(__file__).resolve().parent


class LaboratoryTests(unittest.TestCase):
    def setUp(self):self.library=LaboratoryLibrary(ROOT/'laboratory')

    def test_both_original_games_and_protocol_are_packaged(self):
        for route in ('bolzano/','bolzano/musa.html','s7/','shared/socket.io.js','shared/retro.ttf'):
            self.assertIsNotNone(self.library.file(route),route)
        self.assertIn('bolzano_calentamiento_semilla',self.library.file('bolzano/js/events.js')[0].read_text())
        self.assertIn('transformText',self.library.file('s7/js/s7-engine.js')[0].read_text())
        self.assertIn("script-src 'self'",POLICY)
        self.assertNotIn("script-src 'self' 'unsafe-inline'",POLICY)
        self.assertNotIn('localhost',POLICY)
        self.assertIn('ws://localhost:3000',DEMO_POLICY)

    def test_asset_references_and_return_links(self):
        for route,path in self.library.files.items():
            if path.suffix not in ('.html','.css'):continue
            text=path.read_text()
            refs=re.findall(r'(?:src|href)="([^"]+)"|url\("?([^"\)]+)',text)
            for groups in refs:
                ref=next(g for g in groups if g)
                resolved=unquote(urlsplit(urljoin(PREFIX+route,ref)).path)
                if resolved in ('/scrib/','/scrib/backstage/logo.png','/scrib/backstage/activity.js'):continue
                self.assertTrue(resolved.startswith(PREFIX),(route,ref))
                self.assertIsNotNone(self.library.file(resolved.removeprefix(PREFIX)),(route,ref))
        for route in ('bolzano/','bolzano/musa.html','s7/'):
            text=self.library.file(route)[0].read_text()
            self.assertIn('/scrib/#laboratory',text)
            self.assertNotRegex(text,r'<script\b[^>]*>\s*[^<\s]')

    def test_exact_allowlist_and_symlink_escape(self):
        for route in ('../server.py','s7/../bolzano/index.html','shared/../../bridge-secret','unknown/','bolzano//index.html'):
            self.assertIsNone(self.library.file(route))
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'laboratory';(root/'s7').mkdir(parents=True)
            (root/'s7/index.html').symlink_to(ROOT/'server.py')
            self.assertIsNone(LaboratoryLibrary(root).file('s7/'))


class LaboratoryHTTPTests(unittest.TestCase):
    setUp=fixtures.HTTPTests.setUp
    tearDown=fixtures.HTTPTests.tearDown
    req=fixtures.HTTPTests.req

    def test_games_and_support_assets_require_authentication(self):
        for route in ('laboratory.js','laboratory.css','laboratory/bolzano/','laboratory/bolzano/musa.html','laboratory/s7/','laboratory/shared/retro.ttf','laboratory/shared/socket.io.js'):
            self.assertEqual(self.req(route,headers={'X-Scrib-Bridge':''})[0],401,route)
            status,body,headers=self.req(route,raw=True)
            self.assertEqual(status,200,route);self.assertTrue(body)
            self.assertEqual(headers['Cache-Control'],'no-store')
            if route.startswith('laboratory/'):
                self.assertEqual(headers['Content-Security-Policy'],POLICY)

    def test_invalid_paths_fail_closed(self):
        for route in ('laboratory/../server.py','laboratory/shared/bridge-secret','laboratory/s7/missing.js'):
            self.assertEqual(self.req(route)[0],404,route)
