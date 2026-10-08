"""Task deletion, labels and real authenticated dispatch without network sockets."""
import concurrent.futures
import io
import json
import tempfile
from types import SimpleNamespace
import unittest
import uuid

import test_world as fixtures

world = fixtures.world


class TaskTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.store.identify('angela', 'Ángela')

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, kind, data, token=None):
        return self.store.create(kind, data, 'angela', token or str(uuid.uuid4()))

    def task(self, **data):
        return self.create('ticket', dict(title='Ensayar', boardId='dramaturgia', **data))

    def delete(self, task, token=None, **changes):
        return self.store.delete_ticket(task['id'], changes.get('actor', 'angela'),
                                      changes.get('version', task['version']),
                                      token or str(uuid.uuid4()), changes.get('confirmed', True))

    def test_deletion_removes_only_target_and_comments_and_retains_board(self):
        a, b = self.task(), self.task()
        for task in (a, b):
            self.store.comment(task['id'], 'Una nota', 'angela', str(uuid.uuid4()))
        self.delete(a)
        items = self.store.snapshot()['items']
        self.assertNotIn(a['id'], [x['id'] for x in items])
        self.assertEqual(self.store.details(b['id'])['item'], b)
        self.assertEqual(len(self.store.details(b['id'])['comments']), 1)
        self.assertIn('dramaturgia', [x['id'] for x in items])
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM comments WHERE ticket=?', (a['id'],)).fetchone()[0], 0)
        with self.assertRaises(world.Problem) as caught:
            self.store.details(a['id'])
        self.assertEqual(caught.exception.status, 404)

    def test_confirmation_required_and_non_ticket_ids_rejected(self):
        task = self.task()
        for value in (False, None, 1, 'true'):
            with self.assertRaises(world.Problem):
                self.delete(task, confirmed=value)
        board = self.store.details('dramaturgia')['item']
        with self.assertRaises(world.Problem):
            self.delete(board)
        self.assertEqual(self.store.details(task['id'])['item'], task)
        self.assertEqual(self.store.details(board['id'])['item'], board)

    def test_stale_version_and_invalid_operation_do_not_delete(self):
        task = self.task()
        newer = self.store.update(task['id'], dict(task, title='Otra edición'), 'pablo', task['version'])
        for version in (task['version'], True, None):
            with self.assertRaises(world.Problem) as caught:
                self.delete(task, version=version)
            self.assertEqual(caught.exception.status, 409)
        with self.assertRaises(world.Problem):
            self.delete(newer, token='short')
        self.assertEqual(self.store.details(task['id'])['item'], newer)

    def test_concurrent_retries_delete_once_and_cannot_reuse_token(self):
        task, token = self.task(), str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = list(pool.map(lambda _: self.delete(task, token), range(4)))
        self.assertTrue(all(x == outcomes[0] for x in outcomes))
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM activity WHERE target=? AND action='tarea eliminada definitivamente'", (task['id'],)).fetchone()[0], 1)
        for other, actor in ((self.task(), 'angela'), (task, 'pablo')):
            with self.assertRaises(world.Problem) as caught:
                self.delete(other, token, actor=actor)
            self.assertEqual(caught.exception.status, 409)

    def test_archived_ticket_can_be_permanently_deleted(self):
        task = self.task()
        archived = self.store.archive(task['id'], True, 'angela', task['version'])
        self.delete(archived)
        self.assertNotIn(task['id'], [x['id'] for x in self.store.snapshot()['items']])

    def test_receipts_no_longer_contain_task_or_comment_and_retries_cannot_resurrect_it(self):
        create_token, comment_token = str(uuid.uuid4()), str(uuid.uuid4())
        data = dict(title='PRIVATE TASK CONTENT', boardId='dramaturgia', description='PRIVATE DESCRIPTION')
        task = self.create('ticket', data, create_token)
        self.store.comment(task['id'], 'PRIVATE COMMENT', 'angela', comment_token)
        self.delete(task)
        with self.store.connect() as db:
            rows = db.execute('SELECT response FROM requests').fetchall()
        self.assertFalse(any('PRIVATE' in r['response'] for r in rows))
        for operation in (lambda: self.create('ticket', data, create_token),
                          lambda: self.store.comment(task['id'], 'PRIVATE COMMENT', 'angela', comment_token)):
            with self.assertRaises(world.Problem) as caught:
                operation()
            self.assertEqual(caught.exception.status, 410)
        self.assertFalse(any(x['kind'] == 'ticket' for x in self.store.snapshot()['items']))

    def test_archive_is_still_recoverable_with_comments(self):
        task = self.task()
        self.store.comment(task['id'], 'Conservar', 'angela', str(uuid.uuid4()))
        archived = self.store.archive(task['id'], True, 'angela', task['version'])
        restored = self.store.archive(task['id'], False, 'angela', archived['version'])
        self.assertFalse(restored['archived'])
        self.assertEqual(self.store.details(task['id'])['comments'][0]['body'], 'Conservar')

    def test_board_names_are_clean_on_create_and_edit(self):
        cases = {'Dramaturgia · laboratorio':'Dramaturgia', 'Laboratorio de escritura':'escritura',
                 'Programación · Laboratorio · juego':'Programación · juego', 'LABORATORIO':'Tareas',
                 'Laboratorios — Ideas':'Ideas', 'Investigación':'Investigación'}
        for old, title in cases.items():
            with self.subTest(old=old):
                board = self.create('board', {'title':old})
                self.assertEqual(board['title'], title)
                updated = self.store.update(board['id'], dict(board, title=old), 'angela', board['version'])
                self.assertEqual(updated['title'], title)

    def test_migration_is_idempotent_preserves_ids_tasks_archive_and_other_fields(self):
        task = self.task(status='progress', labels=['ESCRITURA'])
        archived_board = self.create('board', {'title':'Ideas', 'color':'gold', 'description':'Conservar'})
        self.store.archive(archived_board['id'], True, 'angela', archived_board['version'])
        with self.store.transaction() as db:
            for ident, title in (('dramaturgia','Dramaturgia · laboratorio'), (archived_board['id'],'Laboratorio — Ideas')):
                self.store.save(db, self.store.item(db, ident), {'title':title}, 'angela')
        before = {x['id']:x for x in self.store.snapshot()['items']}
        self.assertEqual(self.store.tidy_board_titles(), 2)
        revision = self.store.snapshot()['revision']
        self.assertEqual(self.store.tidy_board_titles(), 0)
        self.assertEqual(self.store.snapshot()['revision'], revision)
        after = {x['id']:x for x in self.store.snapshot()['items']}
        self.assertEqual(before.keys(), after.keys())
        self.assertEqual(before[task['id']], after[task['id']])
        for ident in ('dramaturgia', archived_board['id']):
            for key in ('id','archived','kind','description','color','eventId','created'):
                self.assertEqual(before[ident][key], after[ident][key])
            self.assertEqual(after[ident]['version'], before[ident]['version']+1)

    def dispatch(self, path, data=None, **changes):
        handler = object.__new__(world.Handler)
        handler.server = SimpleNamespace(store=self.store, demo=False, secret='isolated-secret',
                                         origins={'https://sutura-gateway.ddns.net'})
        handler.command = 'POST' if data is not None else 'GET'
        handler.path = world.PREFIX + path
        token = handler.csrf_token('angela')
        handler.headers = {'X-Scrib-Bridge':'isolated-secret', 'X-Scrib-User':'angela',
                           'Origin':'https://sutura-gateway.ddns.net', 'Cookie':'scrib_world_csrf='+token,
                           'X-CSRF-Token':token, **changes}
        body = json.dumps(data).encode() if data is not None else b''
        handler.headers['Content-Length'] = str(len(body))
        handler.headers['Content-Type'] = 'application/json'
        handler.rfile = io.BytesIO(body)
        handler.connection = SimpleNamespace(settimeout=lambda _: None)
        result = []
        handler.reply = lambda *args, **kwargs: result.append((args, kwargs))
        handler.dispatch()
        return result[0][0]

    def test_delete_route_keeps_identity_origin_csrf_and_confirmation_checks(self):
        task = self.task()
        data = dict(id=task['id'],version=task['version'],requestId=str(uuid.uuid4()),confirmed=True)
        for headers, status in (({'X-Scrib-Bridge':''},401), ({'Origin':'https://evil.invalid'},403),
                                ({'X-CSRF-Token':''},403), ({'Cookie':''},403)):
            self.assertEqual(self.dispatch('api/delete-ticket', data, **headers)[0], status)
            self.assertEqual(self.store.details(task['id'])['item'], task)
        self.assertEqual(self.dispatch('api/delete-ticket', dict(data, confirmed=False))[0], 400)
        result = self.dispatch('api/delete-ticket', data)
        self.assertEqual(result[0], 200)
        self.assertTrue(result[1]['item']['deleted'])
        self.assertEqual(self.dispatch('api/delete-ticket', data), result)

    def test_original_logo_and_styles_are_private_and_no_arbitrary_assets_allowed(self):
        for route, mime in (('logo.png','image/png'), ('tasks.css','text/css; charset=utf-8')):
            result = self.dispatch(route)
            self.assertEqual(result[0], 200)
            self.assertEqual(result[2], mime)
            self.assertEqual(self.dispatch(route, **{'X-Scrib-Bridge':''})[0], 401)
        self.assertEqual(self.dispatch('logo.png')[1], (fixtures.ROOT/'assets/scrib-world-logo.png').read_bytes())
        self.assertEqual(self.dispatch('assets/scrib-world-logo.png')[0], 404)

    def test_sidebar_copy_uses_scrib_and_tasks_without_removed_shortcuts(self):
        html = (fixtures.ROOT/'public/index.html').read_text()
        self.assertIn('src="/scrib/backstage/logo.png"', html)
        self.assertIn('data-nav="boards"><span aria-hidden="true">▤</span> Tareas', html)
        for removed in ('Acceso Sutura', 'Authentik', 'Mundo Sutura', 'Cambiar de mundo', 'Abrir videojuego', '/favicons/panel-32.png'):
            self.assertNotIn(removed, html)
        self.assertIn('href="/logout"', html)


if __name__ == '__main__':
    unittest.main()
