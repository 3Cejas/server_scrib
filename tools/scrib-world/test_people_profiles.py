"""Profile/catalog and the user's inventory batch, with isolated SQLite fixtures."""
import concurrent.futures
import io
import json
import re
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch
import test_world as fixtures
from inventory_seed import apply_initial_inventory, TOKEN

world = fixtures.world
ROOT = Path(__file__).resolve().parent


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.store.identify('tester', 'Prueba')

    def tearDown(self):
        self.tmp.cleanup()

    def person(self, **data):
        return self.store.create('person', {'name': 'Persona de prueba', **data}, 'tester', str(uuid.uuid4()))

    def test_roles_are_selected_from_catalog_not_free_text(self):
        p = self.person(roles=list(world.PERSON_ROLES))
        self.assertEqual(tuple(p['roles']), world.PERSON_ROLES)
        self.assertEqual(self.person(roles=['escritura', 'Escritura', 'Interpretación'])['roles'], ['Escritura', 'Interpretación'])
        for invalid in ['Escritura, Técnica', ['Un rol inventado'], ['<script>'], [1], None]:
            with self.subTest(roles=invalid), self.assertRaises(world.Problem):
                self.person(roles=invalid)

    def test_existing_legacy_labels_can_be_kept_or_removed_not_added_to_other_people(self):
        p = self.person(roles=['Técnica'])
        with self.store.connect() as db:
            legacy = dict(p, roles=['Rol histórico', 'Técnica'])
            db.execute('UPDATE items SET body=? WHERE id=?', (json.dumps(legacy), p['id']))
        changed = self.store.update(p['id'], dict(legacy, bio='Nota'), 'tester', p['version'])
        self.assertEqual(changed['roles'], ['Rol histórico', 'Técnica'])
        with self.assertRaises(world.Problem):
            self.person(roles=['Rol histórico'])
        changed = self.store.update(p['id'], dict(changed, roles=['Interpretación']), 'tester', changed['version'])
        self.assertEqual(changed['roles'], ['Interpretación'])

    def test_instagram_accepts_at_handle_url_or_empty_and_blocks_unsafe_urls(self):
        for value, expected in [('@_anasempere', 'https://www.instagram.com/_anasempere/'),
                                ('pinenocoronel', 'https://www.instagram.com/pinenocoronel/'),
                                ('https://instagram.com/elenacondemz/?igsh=abc', 'https://instagram.com/elenacondemz/?igsh=abc'),
                                ('', '')]:
            with self.subTest(value=value):
                self.assertEqual(self.person(instagram=value)['instagram'], expected)
        for value in ['@', '@wrong name', 'javascript:alert(1)', 'https://user:password@instagram.com/test']:
            with self.subTest(value=value), self.assertRaises(world.Problem):
                self.person(instagram=value)

    def test_phone_works_without_verification_but_send_still_requires_message_confirmation(self):
        p = self.person(phone='600 000 001', phoneConfirmed=False)
        self.assertEqual(p['phone'], '+34600000001')
        self.assertNotIn('phoneConfirmed', p)
        d = self.store.message_preview({'people': [p['id']], 'text': 'Hola {nombre}'}, 'tester')
        bridge = Mock()
        payload = {'draftId': d['id'], 'recipient': 0, 'confirmed': False}
        with self.assertRaises(world.Problem):
            self.store.message_send(payload, 'tester', bridge)
        bridge.send.assert_not_called()
        self.store.message_send(dict(payload, confirmed=True), 'tester', bridge)
        bridge.send.assert_called_once_with('+34600000001', 'Hola Persona')

    def test_number_change_after_preview_still_blocks_stale_send(self):
        p = self.person(phone='+34600000001')
        d = self.store.message_preview({'people': [p['id']], 'text': 'Hola'}, 'tester')
        self.store.update(p['id'], dict(p, phone='+34600000002'), 'tester', p['version'])
        bridge = Mock()
        with self.assertRaises(world.Problem):
            self.store.message_send({'draftId': d['id'], 'recipient': 0, 'confirmed': True}, 'tester', bridge)
        bridge.send.assert_not_called()

    def test_profile_module_is_ordered_registered_and_no_identity_checkbox_remains(self):
        html = (ROOT / 'public/index.html').read_text()
        self.assertLess(html.index('people-profile.js'), html.index('/app.js'))
        server = (ROOT / 'server.py').read_text()
        self.assertIn('"people-profile.js":', server)
        self.assertIn('personRoles=PERSON_ROLES', server)
        profile = (ROOT / 'public/people-profile.js').read_text()
        declared = json.loads(re.search(r'const catalog=(\[[^;]+\]);', profile).group(1).replace("'", '"'))
        self.assertEqual(tuple(declared), world.PERSON_ROLES)
        client = (ROOT / 'public/app.js').read_text()
        self.assertNotIn('phoneConfirmed', client)
        self.assertNotIn('Teléfono privado', client)
        self.assertIn('profile.roleEditor(p.roles)', client)
        self.assertIn("[name=roles]:checked", client)


class InventoryBatchTests(ProfileTests):
    def test_exact_requested_titles_counts_and_unknown_quantities(self):
        before = self.store.snapshot()['revision']
        preview = apply_initial_inventory(self.store, apply=False)
        self.assertEqual(preview['added'], 11)
        self.assertEqual(self.store.snapshot()['revision'], before)
        self.assertEqual(apply_initial_inventory(self.store)['added'], 11)
        inventory = [p for p in self.store.snapshot()['items'] if p['kind'] == 'inventory']
        expected = {'Gorra': 1, 'Balón de playa': 1, 'Chaquetas': 3, 'Taza': 1,
                    'Cinta adhesiva de color': None, 'Pinturas de cara': None, 'Mochilas': None,
                    'Pañuelo': 1, 'Linternas': 2, 'Sobres de color': None, 'Gafas de color': 2}
        self.assertEqual({p['title']: p['quantity'] for p in inventory}, expected)
        self.assertEqual(sum(p['quantity'] or 0 for p in inventory), 11)
        self.assertTrue(all(p['team'] == 'general' and p['condition'] == 'unchecked' for p in inventory))
        self.assertTrue(all(not p['eventId'] and not p['custodianId'] and not p['location'] for p in inventory))

    def test_restart_preserves_changes_and_archived_objects(self):
        apply_initial_inventory(self.store)
        o = next(p for p in self.store.snapshot()['items'] if p.get('title') == 'Gorra')
        changed = self.store.update(o['id'], dict(o, quantity=7, team='blue', location='Almacén'), 'tester', o['version'])
        self.store.archive(o['id'], True, 'tester', changed['version'])
        restarted = world.Store(self.tmp.name)
        before = restarted.snapshot()['revision']
        self.assertTrue(apply_initial_inventory(restarted)['alreadyApplied'])
        self.assertEqual(restarted.snapshot()['revision'], before)
        o = restarted.details(o['id'])['item']
        self.assertEqual((o['quantity'], o['team'], o['location'], o['archived']), (7, 'blue', 'Almacén', True))
        self.assertEqual(len([p for p in restarted.snapshot()['items'] if p['kind'] == 'inventory']), 11)

    def test_renamed_items_from_json_recovery_do_not_duplicate_without_batch_marker(self):
        apply_initial_inventory(self.store)
        o = next(p for p in self.store.snapshot()['items'] if p.get('title') == 'Gorra')
        changed = self.store.update(o['id'], dict(o, title='Gorra de David', quantity=4), 'tester', o['version'])
        with self.store.connect() as db:
            db.execute('DELETE FROM requests WHERE token=?', (TOKEN,))
        self.assertEqual(apply_initial_inventory(self.store)['added'], 0)
        self.assertEqual(self.store.details(o['id'])['item']['title'], 'Gorra de David')
        self.assertEqual(self.store.details(o['id'])['item']['quantity'], 4)

    def test_interrupted_insert_rolls_back_all_objects_and_marker(self):
        original = self.store.insert
        count = 0
        def fail_third(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 3:
                raise world.Problem('Fallo de prueba')
            return original(*args, **kwargs)
        with patch.object(self.store, 'insert', side_effect=fail_third), self.assertRaises(world.Problem):
            apply_initial_inventory(self.store)
        self.assertFalse(any(p['kind'] == 'inventory' for p in self.store.snapshot()['items']))
        with self.store.connect() as db:
            self.assertFalse(db.execute('SELECT 1 FROM requests WHERE token=?', (TOKEN,)).fetchone())
        self.assertEqual(apply_initial_inventory(self.store)['added'], 11)

    def test_existing_objects_are_never_overwritten_or_unarchived(self):
        o = self.store.create('inventory', {'title': '  BALON DE PLAYA ', 'quantity': 9, 'team': 'red'}, 'tester', str(uuid.uuid4()))
        self.store.archive(o['id'], True, 'tester', o['version'])
        result = apply_initial_inventory(self.store)
        self.assertEqual(result['added'], 10)
        self.assertEqual(result['preserved'], ['Balón de playa'])
        o = self.store.details(o['id'])['item']
        self.assertEqual((o['quantity'], o['team'], o['archived']), (9, 'red', True))

    def test_concurrent_startups_apply_one_atomic_batch(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: apply_initial_inventory(self.store), range(4)))
        self.assertEqual(sum(r['added'] for r in results), 11)
        self.assertEqual(sum(r['alreadyApplied'] for r in results), 3)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM requests WHERE token=?', (TOKEN,)).fetchone()[0], 1)

    def test_zip_includes_batch_and_null_quantities_without_private_contact_data(self):
        apply_initial_inventory(self.store)
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as archive:
            data = json.loads(archive.read('mundo-scrib.json'))
        objects = [p for p in data['items'] if p['kind'] == 'inventory']
        self.assertEqual(len(objects), 11)
        self.assertEqual(sum(p['quantity'] is None for p in objects), 4)


if __name__ == '__main__':
    unittest.main()
