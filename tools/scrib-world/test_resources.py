import base64
import io
import json
import re
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import test_world as fixtures
from materials import MaterialLibrary, POLICY, PREFIX

world=fixtures.world
ROOT=Path(__file__).resolve().parent


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=world.Store(self.tmp.name)
        self.store.identify('tester','Ensayo')

    def tearDown(self):self.tmp.cleanup()

    def create(self,kind='inventory',**data):
        return self.store.create(kind,data,'tester',str(uuid.uuid4()))

    def test_empty_real_inventory_and_independent_teams(self):
        self.assertFalse(any(o['kind']=='inventory' for o in self.store.snapshot()['items']))
        for team in ['blue','red','general']:
            o=self.create(title='Maleta',team=team,quantity=2)
            self.assertEqual((o['team'],o['quantity'],o['condition']),(team,2,'good'))
        self.assertEqual(len([o for o in self.store.snapshot()['items'] if o['kind']=='inventory']),3)

    def test_quantity_is_bounded_integer_not_bool_float_or_string(self):
        for quantity in [-1,10000,True,1.5,'2']:
            with self.subTest(quantity=quantity),self.assertRaises(world.Problem):self.create(title='Maleta',quantity=quantity)
        for quantity in [0,9999]:self.assertEqual(self.create(title='Maleta',quantity=quantity)['quantity'],quantity)
        self.assertIsNone(self.create(title='Sin contar',quantity=None)['quantity'])

    def test_invalid_options_and_empty_title(self):
        for patch in [{'title':''},{'team':'purple'},{'condition':'lost'},{'category':'invalid'}]:
            with self.subTest(patch=patch),self.assertRaises(world.Problem):self.create(**dict({'title':'Maleta'},**patch))

    def test_verified_references_and_archived_links_can_be_preserved(self):
        p=self.create('person',name='Ana');e=self.create('event',title='Ensayo',start='2026-11-07',eventType='rehearsal')
        o=self.create(title='Maleta',custodianId=p['id'],eventId=e['id'])
        for field,value in [('eventId',p['id']),('custodianId',e['id']),('eventId','missing')]:
            with self.subTest(field=field),self.assertRaises(world.Problem):self.create(**{'title':'Maleta',field:value})
        self.store.archive(p['id'],True,'tester',p['version']);self.store.archive(e['id'],True,'tester',e['version'])
        changed=self.store.update(o['id'],dict(o,quantity=3),'tester',o['version'])
        self.assertEqual(changed['eventId'],e['id']);self.assertFalse(changed['archived'])
        with self.assertRaises(world.Problem):self.create(title='Maleta',eventId=e['id'])
        with self.assertRaises(world.Problem):self.create(title='Maleta',custodianId=p['id'])

    def test_photo_is_private_and_in_backup_with_inventory(self):
        data=b'\x89PNG\r\n\x1a\n'+bytes(25)
        image=self.store.upload(base64.b64encode(data).decode())
        o=self.create(title='Maleta',image=image)
        for bad in ['../bridge-secret','https://example.com/a.png','0'*64+'.png']:
            with self.subTest(bad=bad),self.assertRaises(world.Problem):self.create(title='Maleta',image=bad)
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as z:
            self.assertEqual(z.read('images/'+image),data)
            items=json.loads(z.read('mundo-scrib.json'))['items']
            self.assertTrue(any(x['id']==o['id'] and x['image']==image for x in items))

    def test_concurrent_versions_archive_recover_and_restart(self):
        o=self.create(title='Maleta',team='blue',quantity=2)
        new=self.store.update(o['id'],dict(o,team='red',quantity=3),'tester',o['version'])
        with self.assertRaises(world.Problem) as err:self.store.update(o['id'],dict(o,quantity=9),'tester',o['version'])
        self.assertEqual(err.exception.status,409)
        archived=self.store.archive(o['id'],True,'tester',new['version'])
        restored=self.store.archive(o['id'],False,'tester',archived['version'])
        after=world.Store(self.tmp.name).details(o['id'])['item']
        self.assertEqual((after['team'],after['quantity'],after['archived']),('red',3,False))
        self.assertEqual(after['version'],restored['version'])


class MaterialTests(unittest.TestCase):
    def setUp(self):self.library=MaterialLibrary(ROOT/'materials')

    def test_real_decks_counts_and_allowed_assets(self):
        decks=self.library.list()['materials'];self.assertEqual([d['id'] for d in decks],['tutorial','charla'])
        self.assertEqual(decks[0]['slides'],19);self.assertGreater(decks[1]['slides'],25)
        for d in decks:
            self.assertIsNotNone(self.library.file(d['id']+'/'))
            self.assertIsNotNone(self.library.file(d['cover'].removeprefix(PREFIX)))

    def test_all_local_resource_references_resolve_inside_library(self):
        for route,path in self.library.files.items():
            if path.suffix not in ('.html','.css'):continue
            source=path.read_text()
            refs=re.findall(r'(?:src|href)="([^"]+)"',source) if path.suffix=='.html' else re.findall(r'url\([\"\']?([^\"\')]+)',source)
            for ref in refs:
                if ref.startswith(('#','https:','http:','data:')):continue
                resolved=urlsplit(urljoin(PREFIX+route,ref)).path
                self.assertTrue(resolved.startswith(PREFIX),(route,ref))
                self.assertIsNotNone(self.library.file(resolved[len(PREFIX):]),(route,ref,resolved))

    def test_no_scripts_inline_and_no_arbitrary_paths(self):
        for deck in ['charla','tutorial']:
            source=self.library.file(deck+'/')[0].read_text()
            self.assertNotRegex(source,r'<script(?:\s[^>]*)?>\s*[^<\s]')
        for route in ['../server.py','../../world.sqlite3','shared/../tutorial/index.html','charla/assets/../../server.py','charla','shared','server.py']:
            self.assertIsNone(self.library.file(route))
        self.assertIn("script-src 'self';",POLICY)
        self.assertNotIn("script-src 'self' 'unsafe-inline'",POLICY)

    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'materials';(root/'tutorial').mkdir(parents=True)
            outside=Path(directory)/'outside.html';outside.write_text('secret')
            (root/'tutorial'/'index.html').symlink_to(outside)
            self.assertIsNone(MaterialLibrary(root).file('tutorial/'))

    def test_ranges_open_suffix_clamped_and_unsatisfiable(self):
        for value,expected in [('',(0,99,False)),('bytes=10-19',(10,19,True)),('bytes=90-',(90,99,True)),('bytes=-5',(95,99,True)),('bytes=0-200',(0,99,True)),('bytes=-200',(0,99,True))]:
            self.assertEqual(self.library.byte_range(value,100),expected)
        for value in ['bytes=100-','bytes=10-9','bytes=-0','bytes=-','bytes=0-2,5-9','bad']:
            with self.subTest(value=value),self.assertRaises(ValueError):self.library.byte_range(value,100)


class HTTPResourceTests(unittest.TestCase):
    setUp=fixtures.HTTPTests.setUp
    tearDown=fixtures.HTTPTests.tearDown
    req=fixtures.HTTPTests.req
    csrf=fixtures.HTTPTests.csrf

    def test_every_new_route_requires_valid_auth(self):
        for route in ['inventory.js','library.js','resources.css','api/materials','materials/tutorial/','materials/shared/logo.png','materials/charla/charla.js']:
            self.assertEqual(self.req(route,headers={'X-Scrib-Bridge':''})[0],401)

    def test_metadata_viewer_and_strict_app_policy(self):
        status,body,_=self.req('api/materials');self.assertEqual(status,200);self.assertEqual(len(body['materials']),2)
        for route in ['inventory.js','library.js','resources.css','materials/tutorial/','materials/charla/']:
            status,body,headers=self.req(route,raw=True)
            self.assertEqual(status,200);self.assertTrue(body)
            if route.startswith('materials/'):
                self.assertEqual(headers['Content-Security-Policy'],POLICY);self.assertEqual(headers['Cache-Control'],'private, no-store')
            else:self.assertNotIn('unsafe-inline',headers['Content-Security-Policy'])

    def test_video_streaming_range_and_416(self):
        route=next(k for k in self.app.materials.files if k.endswith('.mp4'))
        original=self.app.materials.files[route].read_bytes()
        status,body,headers=self.req('materials/'+route,headers={'Range':'bytes=10-99'},raw=True)
        self.assertEqual(status,206);self.assertEqual(body,original[10:100]);self.assertEqual(headers['Content-Range'],f'bytes 10-99/{len(original)}')
        self.assertEqual(headers['Accept-Ranges'],'bytes')
        status,_,headers=self.req('materials/'+route,headers={'Range':f'bytes={len(original)}-'})
        self.assertEqual(status,416);self.assertEqual(headers['Content-Range'],f'bytes */{len(original)}')

    def test_http_inventory_csrf_and_shared_state(self):
        payload={'kind':'inventory','data':{'title':'Maleta','team':'blue','quantity':2},'requestId':str(uuid.uuid4())}
        self.assertEqual(self.req('api/create',payload)[0],403)
        status,body,_=self.req('api/create',payload,headers=self.csrf());self.assertEqual(status,200)
        ident=body['item']['id']
        status,state,_=self.req();self.assertEqual(status,200);self.assertTrue(any(o['id']==ident for o in state['items']))


if __name__=='__main__':unittest.main()
