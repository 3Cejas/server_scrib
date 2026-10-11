import unittest,uuid
import test_tasks as fixtures
import test_comments as comments
world=fixtures.world

class DependenciesTests(unittest.TestCase):
    setUp=fixtures.TaskTests.setUp
    tearDown=fixtures.TaskTests.tearDown
    create=fixtures.TaskTests.create
    task=fixtures.TaskTests.task
    dispatch=comments.CommentTests.dispatch
    def set(self,task,**fields):
        return self.store.update(task['id'],dict(task,**fields),'angela',task['version'])
    def test_cross_board_dependencies_block_and_resolve_without_forcing_resume(self):
        board=self.create('board',{'title':'Programación'})
        source=self.create('ticket',{'title':'Publicar','boardId':board['id']})
        target=self.task(blockedBy=[source['id']],status='progress')
        self.assertEqual(target['status'],'blocked')
        with self.assertRaises(world.Problem):
            self.store.move(target['id'],'progress','','angela',target['version'])
        with self.assertRaises(world.Problem):self.set(target,status='done')
        self.set(source,status='done')
        resumed=self.store.move(target['id'],'progress','','angela',target['version'])
        self.assertEqual(resumed['status'],'progress')
        self.assertEqual(resumed['blockedBy'],[source['id']])
    def test_self_indirect_cycles_and_invalid_targets_are_rejected(self):
        a=self.task();b=self.task(blockedBy=[a['id']]);c=self.task(blockedBy=[b['id']])
        for refs in ([a['id']],[c['id']],['missing'],['dramaturgia']):
            with self.subTest(refs=refs),self.assertRaises(world.Problem):self.set(a,blockedBy=refs)
        self.assertEqual(self.store.details(a['id'])['item'],a)
    def test_archiving_or_deleting_does_not_silently_release_dependency(self):
        for delete in (False,True):
            source=self.task();target=self.task(blockedBy=[source['id']])
            if delete:self.store.delete_ticket(source['id'],'angela',source['version'],str(uuid.uuid4()),True)
            else:self.store.archive(source['id'],True,'angela',source['version'])
            with self.assertRaises(world.Problem):self.store.move(target['id'],'done','','angela',target['version'])
            updated=self.set(target,description='Conservar dependencia')
            self.assertEqual(updated['blockedBy'],[source['id']])
            cleared=self.set(updated,blockedBy=[],status='todo')
            self.assertEqual(cleared['status'],'todo')
    def test_concurrent_edits_use_existing_version_checks(self):
        source=self.task();target=self.task()
        saved=self.set(target,blockedBy=[source['id']])
        with self.assertRaises(world.Problem) as caught:self.set(target,blockedBy=[])
        self.assertEqual(caught.exception.status,409)
        self.assertEqual(self.store.details(saved['id'])['item'],saved)
    def test_reopening_a_prerequisite_reblocks_unfinished_tasks_with_new_versions(self):
        source=self.task(status='done');target=self.task(blockedBy=[source['id']],status='progress')
        self.set(source,status='todo')
        blocked=self.store.details(target['id'])['item']
        self.assertEqual(blocked['status'],'blocked')
        self.assertEqual(blocked['version'],target['version']+1)
        with self.assertRaises(world.Problem):self.set(target,description='Stale editor')

    def test_all_prerequisites_must_be_completed_before_final_column_and_no_reordering_on_rejection(self):
        board=self.create('board',{'title':'Otro tablero'})
        a=self.task();b=self.create('ticket',{'title':'Segunda dependencia','boardId':board['id']})
        target=self.task(blockedBy=[a['id'],b['id']]);done=self.task(status='done')
        for round in range(2):
            before=self.store.snapshot()
            with self.assertRaises(world.Problem) as caught:self.store.move(target['id'],'done',done['id'],'angela',target['version'])
            self.assertEqual(caught.exception.status,409)
            self.assertIn('completa todas las tareas',str(caught.exception))
            self.assertEqual(self.store.snapshot(),before)
            if round==0:self.set(a,status='done')
        self.set(b,status='done')
        completed=self.store.move(target['id'],'done',done['id'],'angela',target['version'])
        self.assertEqual(completed['status'],'done')
        self.assertEqual(completed['blockedBy'],[a['id'],b['id']])

    def test_api_rejects_completion_and_crafted_create_update_autosave_until_prerequisite_is_done(self):
        source=self.task();target=self.task(blockedBy=[source['id']])
        before=self.store.snapshot()
        response=self.dispatch('api/move',dict(id=target['id'],status='done',beforeId='',version=target['version']))
        self.assertEqual(response[0],409);self.assertIn('completa todas las tareas',response[1]['error'])
        for save in (lambda:self.set(target,status='done'),
                     lambda:self.create('ticket',{'title':'No saltar bloqueo','boardId':'dramaturgia','status':'done','blockedBy':[source['id']]}),
                     lambda:self.store.autosave_ticket({'id':target['id'],'version':target['version'],'requestId':str(uuid.uuid4()),'changes':{'status':'done'},'base':{'status':'blocked'}},'angela')):
            with self.assertRaises(world.Problem):save()
        self.assertEqual(self.store.snapshot(),before)
        self.set(source,status='done')
        response=self.dispatch('api/move',dict(id=target['id'],status='done',beforeId='',version=target['version']))
        self.assertEqual(response[0],200);self.assertEqual(self.store.details(target['id'])['item']['status'],'done')

    def test_manual_block_without_prerequisites_can_be_completed(self):
        target=self.task(status='blocked')
        completed=self.store.move(target['id'],'done','','angela',target['version'])
        self.assertEqual(completed['status'],'done')

if __name__=='__main__':unittest.main()
