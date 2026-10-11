"""A person has one show position, except for the two technical positions."""
import json
import tempfile
import unittest
import uuid
import test_world as fixtures
from production import cast_conflict

world = fixtures.world


class CastExclusivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = world.Store(self.tmp.name)
        self.person = self.create('person', name='Persona de prueba')

    def create(self, kind, **data):
        return self.store.create(kind, data, 'tester', str(uuid.uuid4()))

    def position(self, role, team='general'):
        return dict(personId=self.person['id'], role=role, team=team)

    def show(self, cast):
        return self.create('event', title='Bolo de prueba', start='2026-11-07', cast=cast)

    def test_new_bolo_cannot_repeat_writer_interpreter_staff_or_teams(self):
        for cast in [
            [self.position('Escritura', 'blue'), self.position('Escritura', 'red')],
            [self.position('Interpretación', 'blue'), self.position('Interpretación', 'red')],
            [self.position('Escritora', 'blue'), self.position('Intérprete', 'red')],
            [self.position('Presentador'), self.position('Jurado')],
            [self.position('Escritura', 'red'), self.position('Técnica videojuego')],
            [self.position('Presentador'), self.position('Técnica luminotecnia-sonido')],
        ]:
            with self.subTest(cast=cast), self.assertRaisesRegex(world.Problem, 'ya ocupa otro puesto'):
                self.show(cast)
        self.assertFalse(any(i['kind']=='event' for i in self.store.snapshot()['items']))

    def test_only_both_technical_positions_can_be_combined_including_legacy_alias(self):
        e = self.show([self.position('Técnica', 'red'), self.position('Técnica luminotecnia-sonido', 'blue')])
        self.assertEqual([c['role'] for c in e['cast']], ['Técnica videojuego', 'Técnica luminotecnia-sonido'])
        self.assertTrue(all(c['team']=='general' for c in e['cast']))
        with self.assertRaisesRegex(world.Problem, 'duplicada'):
            self.show([self.position('Técnica'), self.position('Técnica videojuego')])

    def test_update_cannot_bypass_check_and_leaves_saved_bolo_intact(self):
        e = self.show([self.position('Escritura', 'blue')])
        with self.assertRaisesRegex(world.Problem, 'ya ocupa otro puesto'):
            self.store.update(e['id'], dict(e, cast=e['cast']+[self.position('Jurado')]), 'tester', e['version'])
        self.assertEqual(self.store.details(e['id'])['item'], e)

    def test_drafts_rehearsals_and_different_bolos_are_independent(self):
        self.show([])
        e = self.show([self.position('Escritura', 'blue')])
        other = self.show([self.position('Jurado')])
        self.assertNotEqual(e['id'], other['id'])
        r = self.create('event', title='Ensayo', eventType='rehearsal', start='2026-11-06', parentEventId=e['id'], cast=[self.position('Ensayo')])
        self.assertEqual(r['cast'][0]['role'], 'Ensayo')

    def test_historical_overlaps_remain_editable_but_cannot_be_expanded(self):
        e = self.show([self.position('Escritura', 'blue')])
        legacy = e['cast']+[self.position('Interpretación', 'blue')]
        # Simulate a pre-existing record, not a bypass available via the API.
        with self.store.connect() as db:
            body = json.loads(db.execute('SELECT body FROM items WHERE id=?', (e['id'],)).fetchone()[0])
            body['cast'] = legacy
            db.execute('UPDATE items SET body=? WHERE id=?', (json.dumps(body), e['id']))
        e = self.store.details(e['id'])['item']
        saved = self.store.update(e['id'], dict(e, title='Notas actualizadas'), 'tester', e['version'])
        self.assertEqual(saved['cast'], legacy)
        with self.assertRaises(world.Problem):
            self.store.update(saved['id'], dict(saved, cast=legacy+[self.position('Jurado')]), 'tester', saved['version'])
        reduced = self.store.update(saved['id'], dict(saved, cast=legacy[:1]), 'tester', saved['version'])
        self.assertEqual(len(reduced['cast']), 1)

    def test_historical_allowance_is_per_person_and_cannot_move_conflicts(self):
        old = [self.position('Escritura', 'blue'), self.position('Interpretación', 'blue')]
        self.assertIsNone(cast_conflict(old, old))
        changed = [old[0], self.position('Interpretación', 'red')]
        self.assertEqual(cast_conflict(changed, old), self.person['id'])
        self.assertEqual(cast_conflict([dict(c, personId='someone-else') for c in old], old), 'someone-else')

    def test_pending_invitation_does_not_occupy_a_position_and_assignment_consumes_it(self):
        pending=self.position('Papel pendiente de confirmar')
        e=self.show([pending])
        assigned=self.position('Presentador')
        self.assertIsNone(cast_conflict([pending,assigned],e['cast']))
        saved=self.store.update(e['id'],dict(e,cast=[pending,assigned]),'tester',e['version'])
        self.assertEqual(saved['cast'],[assigned])
        with self.assertRaisesRegex(world.Problem,'ya ocupa otro puesto'):
            self.store.update(saved['id'],dict(saved,cast=saved['cast']+[self.position('Jurado')]),'tester',saved['version'])

    def test_leon_legacy_roster_allows_each_pending_person_without_losing_other_invitations(self):
        people=[self.create('person',name=name) for name in (
            'Ana Sempere','Fer','David Viñas','Diego Valverde','Miriam del Valle',
            'Ángela Harris Bueno','Pablo Pineño','Elena Conde','Verónica Antonucci')]
        occupied=[dict(personId=people[0]['id'],role=role,team='blue') for role in ('Escritura','Interpretación')]
        pending=[dict(personId=p['id'],role='Papel pendiente de confirmar',team='general') for p in people]
        e=self.show([])
        with self.store.connect() as db:
            body=json.loads(db.execute('SELECT body FROM items WHERE id=?',(e['id'],)).fetchone()[0])
            body['cast']=occupied+pending
            db.execute('UPDATE items SET body=? WHERE id=?',(json.dumps(body),e['id']))
        e=self.store.details(e['id'])['item']
        for person in people[1:]:
            with self.subTest(person=person['name']):
                assigned=dict(personId=person['id'],role='Escritura',team='red')
                saved=self.store.update(e['id'],dict(e,cast=e['cast']+[assigned]),'tester',e['version'])
                self.assertEqual(saved['cast'][:2],occupied)
                self.assertIn(assigned,saved['cast'])
                remaining=[c['personId'] for c in saved['cast'] if c['role']=='Papel pendiente de confirmar']
                self.assertEqual(set(remaining),{p['id'] for p in people[1:] if p!=person})
                # Revert only this isolated fixture for the next independent choice.
                with self.store.connect() as db:
                    body=json.loads(db.execute('SELECT body FROM items WHERE id=?',(e['id'],)).fetchone()[0])
                    body['cast']=occupied+pending
                    db.execute('UPDATE items SET body=? WHERE id=?',(json.dumps(body),e['id']))
                e=self.store.details(e['id'])['item']

    def test_new_bolo_consumes_only_assigned_pending_people_and_preserves_technical_exception(self):
        other=self.create('person',name='Otra persona')
        pending=self.position('Papel pendiente de confirmar')
        unassigned=dict(personId=other['id'],role='Papel pendiente de confirmar',team='general')
        e=self.show([pending,unassigned,self.position('Técnica videojuego'),self.position('Técnica luminotecnia-sonido')])
        self.assertEqual(e['cast'],[unassigned,self.position('Técnica videojuego'),self.position('Técnica luminotecnia-sonido')])


if __name__ == '__main__':
    unittest.main()
