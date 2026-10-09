import unittest,uuid
import test_tasks as fixtures
world=fixtures.world

class DependenciesTests(unittest.TestCase):
    setUp=fixtures.TaskTests.setUp
    tearDown=fixtures.TaskTests.tearDown
    create=fixtures.TaskTests.create
    task=fixtures.TaskTests.task
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

if __name__=='__main__':unittest.main()
