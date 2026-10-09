"""The explicit presenter assignment uses temporary data, never live profiles."""
import concurrent.futures
import io
import json
import sqlite3
import tempfile
import unittest
import uuid
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import test_world as fixtures
from presenter_assignment import apply_presenter_assignment, TOKEN


class PresenterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = fixtures.world.Store(self.tmp.name)
        self.store.identify('tester', 'Prueba')

    def tearDown(self):
        self.tmp.cleanup()

    def person(self, name='David Viñas', **data):
        return self.store.create('person', dict(name=name, **data), 'tester', str(uuid.uuid4()))

    def get(self, ident):
        with self.store.connect() as db:
            return self.store.item(db, ident)

    def receipts(self):
        with self.store.connect() as db:
            return db.execute('SELECT count(*) FROM requests WHERE token=?', (TOKEN,)).fetchone()[0]

    def test_presenter_is_a_valid_selectable_role(self):
        p = self.person(roles=['presentador', 'Presentador', 'Técnica'])
        self.assertEqual(p['roles'], ['Presentador', 'Técnica'])
        self.assertIn('Presentador', fixtures.world.PERSON_ROLES)

    def test_assignment_preserves_every_other_field_and_person(self):
        david = self.person(roles=['Técnica', 'Interpretación'], phone='+34600000001',
                            instagram='@david', bio='Nota privada', color='orchid')
        other = self.person('Otra persona', roles=['Escritura'])
        with self.store.connect() as db:
            # Also retain legacy data not included in current form validation.
            david = self.store.save(db, david, {'legacyField': {'keep': True}}, 'tester')
        result = apply_presenter_assignment(self.store)
        self.assertEqual(result['status'], 'assigned')
        updated = self.get(david['id'])
        self.assertEqual(updated['roles'], ['Técnica', 'Interpretación', 'Presentador'])
        for key, value in david.items():
            if key not in ('roles', 'version', 'updated', 'updatedBy'):
                self.assertEqual(updated[key], value, key)
        self.assertEqual(updated['version'], david['version'] + 1)
        self.assertEqual(self.get(other['id']), other)
        self.assertEqual(self.receipts(), 1)

    def test_preview_does_not_change_profiles_receipts_or_activity(self):
        p = self.person(roles=['Técnica'])
        revision = self.store.snapshot()['revision']
        self.assertTrue(apply_presenter_assignment(self.store, apply=False)['dryRun'])
        self.assertEqual(self.get(p['id']), p)
        self.assertEqual(self.store.snapshot()['revision'], revision)
        self.assertEqual(self.receipts(), 0)

    def test_missing_ambiguous_and_archived_profiles_are_not_guessed(self):
        for name in ('David Vinas', 'David', 'Tres', 'David Viñas López'):
            self.person(name)
        self.assertEqual(apply_presenter_assignment(self.store)['status'], 'missing')
        self.assertEqual(self.receipts(), 0)
        p = self.person()
        self.store.archive(p['id'], True, 'tester', p['version'])
        self.assertEqual(apply_presenter_assignment(self.store)['status'], 'archived')
        self.assertEqual(self.receipts(), 0)
        self.person('DAVID VIÑAS')
        before = self.store.snapshot()
        self.assertEqual(apply_presenter_assignment(self.store)['status'], 'ambiguous')
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(self.receipts(), 0)

    def test_normalized_full_name_matches_case_spaces_and_composed_accents(self):
        p = self.person('  DAVID   VIN\u0303AS  ', roles=['Técnica'])
        self.assertEqual(apply_presenter_assignment(self.store)['personId'], p['id'])
        self.assertIn('Presentador', self.get(p['id'])['roles'])

    def test_already_assigned_profile_is_not_rewritten(self):
        p = self.person(roles=['Presentador'])
        self.assertEqual(apply_presenter_assignment(self.store)['status'], 'alreadyAssigned')
        self.assertEqual(self.get(p['id']), p)
        self.assertEqual(self.receipts(), 1)

    def test_receipt_preserves_subsequent_manual_removal_and_restart(self):
        p = self.person(roles=['Técnica'])
        apply_presenter_assignment(self.store)
        current = self.get(p['id'])
        current = self.store.update(p['id'], dict(current, roles=['Técnica']), 'tester', current['version'])
        restarted = fixtures.world.Store(self.tmp.name)
        self.assertEqual(apply_presenter_assignment(restarted)['status'], 'alreadyApplied')
        self.assertEqual(self.get(p['id']), current)

    def test_concurrent_startups_assign_exactly_once(self):
        p = self.person(roles=['Técnica'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: apply_presenter_assignment(self.store), range(4)))
        self.assertEqual(sum(r['changed'] for r in results), 1)
        self.assertEqual(self.get(p['id'])['version'], p['version'] + 1)
        self.assertEqual(self.get(p['id'])['roles'].count('Presentador'), 1)
        self.assertEqual(self.receipts(), 1)

    def test_interrupted_assignment_rolls_back_profile_and_receipt(self):
        p = self.person(roles=['Técnica'])
        original = self.store.save

        def interrupted(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('Interrupted')

        with patch.object(self.store, 'save', side_effect=interrupted):
            with self.assertRaises(RuntimeError):
                apply_presenter_assignment(self.store)
        self.assertEqual(self.get(p['id']), p)
        self.assertEqual(self.receipts(), 0)
        self.assertEqual(apply_presenter_assignment(self.store)['status'], 'assigned')

    def test_sqlite_backup_receipt_and_export_preserve_the_role(self):
        p = self.person(roles=['Técnica'])
        apply_presenter_assignment(self.store)
        backup = Path(self.tmp.name) / 'recovery.sqlite3'
        with self.store.connect() as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        with closing(sqlite3.connect(backup)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM requests WHERE token=?', (TOKEN,)).fetchone()[0], 1)
            self.assertIn('Presentador', json.loads(db.execute('SELECT body FROM items WHERE id=?', (p['id'],)).fetchone()[0])['roles'])
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as archive:
            data = json.loads(archive.read('mundo-scrib.json'))
        self.assertIn('Presentador', next(x for x in data['items'] if x['id'] == p['id'])['roles'])


if __name__ == '__main__':
    unittest.main()
