import uuid
from test_business import BusinessTests
from test_world import world


class EventDeletionTests(BusinessTests):
    def delete(self,event=None,**changes):
        event=event or self.event
        data=dict(ident=event['id'],actor='admin',expected=event['version'],request_id=str(uuid.uuid4()),confirmed=True)
        data.update(changes)
        return self.store.delete_event(**data)

    def test_permanent_delete_idempotent_tombstones_creation_and_preserves_people(self):
        token=str(uuid.uuid4());data=dict(title='Ensayo',start='2026-11-07',eventType='rehearsal')
        event=self.store.create('event',data,'admin',token)
        operation=str(uuid.uuid4());result=self.delete(event,request_id=operation)
        self.assertTrue(result['deleted']);self.assertEqual(self.delete(event,request_id=operation),result)
        with self.assertRaises(world.Problem):self.store.item(self.store.connect(),event['id'],'event')
        with self.assertRaises(world.Problem) as caught:self.store.create('event',data,'admin',token)
        self.assertEqual(caught.exception.status,410)
        self.assertEqual(self.store.details(self.person['id'])['item']['name'],self.person['name'])

    def test_stale_version_confirmation_reused_token_and_protected_records(self):
        with self.assertRaises(world.Problem):self.delete(confirmed=False)
        with self.assertRaises(world.Problem):self.delete(expected=0)
        self.settlement()
        with self.assertRaisesRegex(world.Problem,'trazabilidad'):self.delete()
        self.assertEqual(self.store.details(self.event['id'])['item']['version'],1)

    def test_signed_or_prepared_agreements_and_match_reports_prevent_loss(self):
        self.agreement()
        with self.assertRaisesRegex(world.Problem,'trazabilidad'):self.delete()
        event=self.store.create('event',dict(title='Partida',start='2026-11-07'),'admin',str(uuid.uuid4()))
        report=self.report();report['bolo']['id']=event['id'];self.b.archive_report(report)
        with self.assertRaisesRegex(world.Problem,'trazabilidad'):self.delete(event)

    def test_rehearsal_dependency_and_event_specific_plan_removed(self):
        rehearsal=self.store.create('event',dict(title='Ensayo',start='2026-11-06',eventType='rehearsal',parentEventId=self.event['id']),'admin',str(uuid.uuid4()))
        with self.assertRaisesRegex(world.Problem,'ensayos vinculados'):self.delete()
        self.delete(rehearsal)
        from lighting import default_plan
        plan=self.store.save_lighting(dict(eventId=self.event['id'],version=0,requestId=str(uuid.uuid4()),plan=default_plan()),'admin')
        self.delete()
        self.assertFalse(any(x['id']==plan['id'] for x in self.store.snapshot()['items']))

    def test_poll_links_and_confirmed_slot_are_cleared_together(self):
        poll=self.store.create('availability',dict(title='Ensayo',eventId=self.event['id'],people=[self.person['id']],slots=[{'start':'2026-11-02T18:00','end':'2026-11-02T20:00'}]),'admin',str(uuid.uuid4()))
        with self.store.transaction() as db:
            self.store.save(db,poll,{'confirmed':{poll['slots'][0]['id']:self.event['id']}},'admin')
        self.delete()
        updated=self.store.details(poll['id'])['item']
        self.assertEqual(updated['eventId'],'')
        self.assertEqual(updated['confirmed'],{})
