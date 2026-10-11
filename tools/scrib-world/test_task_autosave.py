"""Autosave receipts, collaborative patches, and scoped obsolete-bolo cleanup."""
import concurrent.futures
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid
import unittest

import test_tasks as fixtures
import test_comments as comments

world=fixtures.world


class AutosaveTests(unittest.TestCase):
    setUp=fixtures.TaskTests.setUp
    tearDown=fixtures.TaskTests.tearDown
    create=fixtures.TaskTests.create
    task=fixtures.TaskTests.task
    dispatch=comments.CommentTests.dispatch

    def patch(self, task, **changes):
        return dict(id=task['id'],version=task['version'],changes=changes,
                    base={key:task.get(key) for key in changes},requestId=str(uuid.uuid4()))

    def test_create_and_update_retries_save_once_even_concurrently(self):
        create={'data':{'title':'Nueva','boardId':'dramaturgia'},'requestId':str(uuid.uuid4())}
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            outcomes=list(pool.map(lambda _:self.store.autosave_ticket(create,'angela'),range(4)))
        self.assertTrue(all(t==outcomes[0] for t in outcomes))
        task=outcomes[0];patch=self.patch(task,description='Uno\nDos')
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            outcomes=list(pool.map(lambda _:self.store.autosave_ticket(patch,'angela'),range(4)))
        self.assertTrue(all(t==outcomes[0] for t in outcomes))
        self.assertEqual(outcomes[0]['version'],2)
        self.assertEqual(len([t for t in self.store.snapshot()['items'] if t['kind']=='ticket']),1)

    def test_disjoint_collaborator_edits_and_board_move_are_preserved(self):
        task=self.task();patch=self.patch(task,description='Mi texto')
        moved=self.store.move(task['id'],'progress','','pablo',task['version'])
        remote=self.store.update(moved['id'],dict(moved,title='Título de Pablo'),'pablo',moved['version'])
        result=self.store.autosave_ticket(patch,'angela')
        self.assertEqual(result['title'],remote['title'])
        self.assertEqual(result['status'],'progress')
        self.assertEqual(result['description'],'Mi texto')

    def test_conflicting_field_is_not_overwritten_even_after_latest_version_ack(self):
        task=self.task();patch=self.patch(task,title='Mi título')
        remote=self.store.update(task['id'],dict(task,title='Título ajeno'),'pablo',task['version'])
        for version in (task['version'],remote['version']):
            with self.subTest(version=version),self.assertRaises(world.Problem) as caught:
                self.store.autosave_ticket(dict(patch,version=version),'angela')
            self.assertEqual(caught.exception.status,409)
        self.assertEqual(self.store.details(task['id'])['item'],remote)

    def test_same_concurrent_intent_can_merge(self):
        task=self.task();patch=self.patch(task,title='Compartido')
        self.store.update(task['id'],dict(task,title='Compartido'),'pablo',task['version'])
        self.assertEqual(self.store.autosave_ticket(patch,'angela')['title'],'Compartido')

    def test_future_version_invalid_fields_and_invalid_payload_do_not_write(self):
        task=self.task();base=self.patch(task,title='Nuevo')
        for changes in ({'version':999},{'version':True},{'changes':{'status':'done'},'base':{'status':'todo'}},
                        {'changes':{},'base':{}},{'changes':{'title':'Nuevo'},'base':{}},
                        {'changes':{'title':''}},{'id':'dramaturgia'},{'requestId':'short'}):
            with self.subTest(changes=changes),self.assertRaises(world.Problem):
                self.store.autosave_ticket(dict(base,**changes),'angela')
        self.assertEqual(self.store.details(task['id'])['item'],task)

    def test_reusing_token_for_other_payload_or_actor_is_rejected(self):
        task=self.task();patch=self.patch(task,description='Guardar')
        self.store.autosave_ticket(patch,'angela')
        for payload,actor in ((dict(patch,changes={'description':'Otro'}),'angela'),(patch,'pablo')):
            with self.assertRaises(world.Problem) as caught:self.store.autosave_ticket(payload,actor)
            self.assertEqual(caught.exception.status,409)

    def test_deleted_task_cannot_return_from_autosave_retry(self):
        task=self.task();patch=self.patch(task,description='Guardado')
        saved=self.store.autosave_ticket(patch,'angela')
        self.store.delete_ticket(saved['id'],'angela',saved['version'],str(uuid.uuid4()),True)
        with self.assertRaises(world.Problem) as caught:self.store.autosave_ticket(patch,'angela')
        self.assertEqual(caught.exception.status,410)

    def test_route_and_new_script_remain_authenticated_origin_and_csrf_protected(self):
        patch=self.patch(self.task(),description='API')
        for headers,status in (({'X-Scrib-Bridge':''},401),({'Origin':'https://evil.invalid'},403),({'X-CSRF-Token':''},403),({'Cookie':''},403)):
            self.assertEqual(self.dispatch('api/task-autosave',patch,**headers)[0],status)
        self.assertEqual(self.dispatch('api/task-autosave',patch)[0],200)
        self.assertEqual(self.dispatch('task-autosave.js')[0],200)
        self.assertEqual(self.dispatch('task-autosave.js',**{'X-Scrib-Bridge':''})[0],401)
        for changes in ({'id':{}},{'requestId':123},{'id':'','data':[]}):
            self.assertEqual(self.dispatch('api/task-autosave',dict(patch,**changes))[0],400)

    def obsolete(self):
        event=self.create('event',{'title':'Universidad de León','start':'2026-11-07T19:00'})
        board=self.create('board',{'title':'Preparación de León'})
        task=self.create('ticket',{'title':'Antigua preparación','boardId':board['id']})
        with self.store.transaction() as db:
            board=self.store.save(db,self.store.item(db,board['id']),{'eventId':event['id']},'angela')
        return event,board,task

    def test_retirement_is_exact_scoped_removes_comments_and_keeps_shared_photos(self):
        event,board,old=self.obsolete();general=self.task()
        image=self.store.upload(comments.PNG)
        self.store.comment(old['id'],'Foto vieja','angela',str(uuid.uuid4()),[image])
        self.store.comment(general['id'],'Foto conservada','angela',str(uuid.uuid4()),[image])
        with self.store.transaction() as db:
            general=self.store.save(db,self.store.item(db,general['id']),{'blockedBy':[old['id']],'status':'blocked'},'angela')
        before={t['id']:t for t in self.store.snapshot()['items']};manifest=self.store.retire_bolo_tasks()
        self.assertEqual(manifest,[dict(id=old['id'],version=old['version'],boardId=board['id'])])
        self.assertEqual({t['id']:t for t in self.store.snapshot()['items']},before)
        self.assertEqual(self.store.retire_bolo_tasks(manifest,True),manifest)
        after={t['id']:t for t in self.store.snapshot()['items']}
        self.assertEqual(after[event['id']],before[event['id']]);self.assertEqual(after[board['id']],before[board['id']])
        self.assertNotIn(old['id'],after)
        self.assertEqual(after[general['id']]['blockedBy'],[])
        self.assertEqual(after[general['id']]['status'],'blocked')
        self.assertEqual(self.store.details(general['id'])['comments'][0]['body'],'Foto conservada')
        self.assertTrue((Path(self.tmp.name)/'images'/image).exists())
        self.assertEqual(self.store.retire_bolo_tasks([],True),[])
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM comment_attachments').fetchone()[0],1)

    def test_stale_retirement_manifest_is_rejected_before_any_delete(self):
        _,_,old=self.obsolete();manifest=self.store.retire_bolo_tasks()
        newer=self.store.update(old['id'],dict(old,description='Nuevo'),'angela',old['version'])
        with self.assertRaises(world.Problem) as caught:self.store.retire_bolo_tasks(manifest,True)
        self.assertEqual(caught.exception.status,409)
        self.assertEqual(self.store.details(old['id'])['item'],newer)
        with self.assertRaises(world.Problem):self.task(blockedBy=[old['id']])
        with self.assertRaises(world.Problem):self.create('ticket',{'title':'No resucitar','boardId':old['boardId']})

    def test_retirement_cli_requires_manifest_and_keeps_recoverable_database(self):
        _,_,old=self.obsolete();general=self.task()
        path=Path(self.tmp.name)/'expected.json';path.write_text(json.dumps(self.store.retire_bolo_tasks()))
        script=str(Path(__file__).with_name('retire_bolo_tasks.py'))
        result=subprocess.run([sys.executable,script,'--data',self.tmp.name,'--expect',str(path),'--apply'],capture_output=True,text=True,check=True)
        outcome=json.loads(result.stdout);self.assertEqual(outcome['removedTasks'],1)
        backup=Path(outcome['backup']);self.assertEqual(backup.stat().st_mode&0o777,0o600)
        with sqlite3.connect(backup) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM items WHERE id=?',(old['id'],)).fetchone()[0],1)
        self.assertEqual(self.store.details(general['id'])['item'],general)


if __name__=='__main__':unittest.main()
