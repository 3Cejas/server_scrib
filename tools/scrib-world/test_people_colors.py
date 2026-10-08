"""Local persistence/security checks; no server sockets or production writes."""
import io
import json
import re
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
import test_world as fixtures

world = fixtures.world
ROOT = Path(__file__).resolve().parent


class PeopleColorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.store.identify('tester', 'Ensayo')

    def tearDown(self):
        self.tmp.cleanup()

    def person(self, **data):
        return self.store.create('person', {'name': 'Persona de prueba', **data}, 'tester', str(uuid.uuid4()))

    def test_automatic_default_and_all_explicit_options(self):
        self.assertEqual(self.person()['color'], 'auto')
        for color in world.PERSON_COLORS:
            with self.subTest(color=color):
                self.assertEqual(self.person(color=color)['color'], color)

    def test_arbitrary_classes_css_and_wrong_types_rejected_atomically(self):
        for color in ['#ff0000', 'red', 'rose another-class', 'url(secret)', '', None, True, [], {}]:
            before = self.store.snapshot()['revision']
            with self.subTest(color=color), self.assertRaises(world.Problem):
                self.person(color=color)
            self.assertEqual(self.store.snapshot()['revision'], before)

    def test_rename_partial_color_update_and_team_changes_preserve_identity(self):
        p = self.person(color='orchid')
        p = self.store.update(p['id'], {'name': 'Otro nombre'}, 'tester', p['version'])
        self.assertEqual(p['color'], 'orchid')
        e = self.store.create('event', {'title': 'Ensayo', 'start': '2026-11-07',
            'eventType': 'rehearsal', 'cast': [{'personId': p['id'], 'team': 'blue', 'role': 'Escritura'}]},
            'tester', str(uuid.uuid4()))
        self.store.update(e['id'], dict(e, cast=[{'personId': p['id'], 'team': 'red', 'role': 'Interpretación'}]),
                          'tester', e['version'])
        self.assertEqual(self.store.details(p['id'])['item']['color'], 'orchid')
        p = self.store.update(p['id'], dict(p, color='auto'), 'tester', p['version'])
        self.assertEqual(p['color'], 'auto')

    def test_restart_archive_restore_and_zip_keep_color(self):
        p = self.person(color='mint')
        archived = self.store.archive(p['id'], True, 'tester', p['version'])
        self.store.archive(p['id'], False, 'tester', archived['version'])
        restarted = world.Store(self.tmp.name)
        self.assertEqual(restarted.details(p['id'])['item']['color'], 'mint')
        with zipfile.ZipFile(io.BytesIO(restarted.export())) as archive:
            people = json.loads(archive.read('mundo-scrib.json'))['items']
        self.assertEqual(next(x for x in people if x['id'] == p['id'])['color'], 'mint')

    def test_old_record_without_color_can_be_updated_without_migration(self):
        p = self.person()
        legacy = {k: v for k, v in p.items() if k != 'color'}
        with self.store.connect() as db:
            db.execute('UPDATE items SET body=? WHERE id=?', (json.dumps(legacy), p['id']))
        updated = self.store.update(p['id'], {'name': 'Nombre cambiado'}, 'tester', p['version'])
        self.assertEqual(updated['color'], 'auto')
        self.assertEqual(updated['id'], p['id'])

    def test_palette_backend_css_and_asset_loading_stay_in_sync(self):
        script = (ROOT / 'public/people-colors.js').read_text()
        styles = (ROOT / 'public/people.css').read_text()
        palette = re.findall(r"\['([a-z]+)','[^']+','(#[a-f0-9]{6})'\]", script)
        self.assertEqual({'auto', *(key for key, _ in palette)}, set(world.PERSON_COLORS))
        for key, color in palette:
            self.assertIn(f'.person-tone-{key}{{--person-color:{color}}}', styles)
        html = (ROOT / 'public/index.html').read_text()
        self.assertLess(html.index('people-colors.js'), html.index('/app.js'))
        for asset in ['people.css', 'people-colors.js']:
            self.assertIn(f'/scrib/backstage/{asset}?v=', html)
            self.assertIn(f'"{asset}":', (ROOT / 'server.py').read_text())
        self.assertNotIn('style=', script)


if __name__ == '__main__':
    unittest.main()
