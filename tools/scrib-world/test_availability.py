import concurrent.futures
import http.client
import importlib.util
import io
import json
import secrets
import tempfile
import threading
import unittest
import uuid
import zipfile
from pathlib import Path
from gateway_availability import is_availability_location
from test_world import world, integrate


class PollTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.actor = 'angela'
        self.person = self.store.create('person', {'name':'Elenco ficticio', 'phone':'+34900000001'}, self.actor, str(uuid.uuid4()))
        self.poll = self.create()
        self.api = self.store.availability

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, **changes):
        return self.store.create('availability', dict(title='Ensayos', people=[self.person['id']], slots=[{'start':'2026-11-02T18:00','end':'2026-11-02T20:00'}, {'start':'2026-11-03T18:00','end':'2026-11-03T20:00'}], **changes),self.actor,str(uuid.uuid4()))

    def response(self, token=None, **changes):
        payload=dict(name='Invitada pública',editToken=secrets.token_urlsafe(32),version=0,answers={self.poll['slots'][0]['id']:'yes'},comment='Una nota')
        payload.update(changes)
        return self.api.submit(token or self.poll['publicToken'],payload)

    def test_public_privacy_and_own_edit(self):
        edit=secrets.token_urlsafe(32);r=self.response(editToken=edit)
        page=self.api.public(self.poll['publicToken'])
        self.assertIsNone(page['mine']);self.assertNotIn('people',page);self.assertNotIn('invites',page);self.assertNotIn('id',page)
        own=self.api.public(self.poll['publicToken'],edit)['mine'];self.assertEqual(own['id'],r['id']);self.assertNotIn('personId',own)
        self.assertIsNone(self.api.public(self.poll['publicToken'],secrets.token_urlsafe(32))['mine'])
        payload={'editToken':edit,'name':r['name'],'comment':r['comment'],'version':0,'answers':r['answers']}
        self.assertEqual(self.api.submit(self.poll['publicToken'],payload)['id'],r['id'])
        payload['comment']='Cambio';self.assertRaises(world.Problem,self.api.submit,self.poll['publicToken'],payload)
        payload['version']=1;self.assertEqual(self.api.submit(self.poll['publicToken'],payload)['version'],2)

    def test_personal_identity_and_isolation(self):
        token=self.poll['invites'][self.person['id']];r=self.response(token,name='Nombre falsificado')
        self.assertEqual(r['name'],self.person['name']);self.assertEqual(r['personId'],self.person['id'])
        self.assertEqual(self.api.public(token)['mine']['id'],r['id'])
        other=self.create();self.assertIsNone(self.api.public(other['publicToken'])['mine'])

    def test_validate_bad_values_no_internal_errors(self):
        for data in [{'slots':[{'start':'2026-11-02','end':'2026-11-03'}]}, {'people':[{}]}, {'slots':[{'id':{},'start':'2026-11-02T18:00','end':'2026-11-02T20:00'}]}, {'slots':[{'start':'2026-03-29T02:30','end':'2026-03-29T03:30'}]}, {'slots':[{'start':'2026-11-02T18:00','end':'2026-11-02T17:00'}]}]:
            original=dict(self.poll);original.update(data)
            with self.assertRaises(world.Problem):self.store.update(self.poll['id'],original,self.actor,1)
        for data in [{'editToken':[]},{'answers':{}},{'answers':{'missing':'yes'}},{'version':True}]:
            with self.assertRaises(world.Problem):self.response(**data)

    def test_close_archive_revoke_and_disable(self):
        token=self.poll['publicToken'];personal=self.poll['invites'][self.person['id']]
        p=self.store.update(self.poll['id'],dict(self.poll,publicEnabled=False,people=[]),self.actor,1)
        self.assertRaises(world.Problem,self.api.public,token);self.assertRaises(world.Problem,self.api.public,personal)
        p=self.store.update(p['id'],dict(p,publicEnabled=True,status='closed'),self.actor,p['version'])
        self.assertFalse(self.api.public(token)['open']);self.assertRaises(world.Problem,self.response)
        self.store.archive(p['id'],True,self.actor,p['version']);self.assertRaises(world.Problem,self.api.public,token)

    def test_dates_locked_after_reply_and_add_allowed(self):
        self.response();bad=dict(self.poll,slots=[self.poll['slots'][1]])
        self.assertRaises(world.Problem,self.store.update,self.poll['id'],bad,self.actor,1)
        good=dict(self.poll,slots=self.poll['slots']+[{'start':'2026-11-04T18:00','end':'2026-11-04T20:00'}])
        self.assertEqual(len(self.store.update(self.poll['id'],good,self.actor,1)['slots']),3)

    def test_confirm_idempotent_calendar_cast_no_show_tasks(self):
        r=self.response(self.poll['invites'][self.person['id']]);payload=dict(id=self.poll['id'],version=1,slotId=self.poll['slots'][0]['id'],responses=[dict(id=r['id'],version=r['version'])])
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            events=list(pool.map(lambda _:self.api.confirm(payload,self.actor),range(3)))
        self.assertEqual(len({e['id'] for e in events}),1);event=events[0]
        self.assertEqual(event['eventType'],'rehearsal');self.assertEqual(event['cast'][0]['personId'],self.person['id'])
        self.assertFalse(any(i['kind']=='ticket' and i['boardId']==event['boardId'] for i in self.store.snapshot()['items']))
        self.assertIn(event['id'].encode(),world.ics(self.store.snapshot()))
        event=self.store.update(event['id'],dict(event,status='completed'),self.actor,event['version'])
        self.assertEqual(next(i for i in self.store.snapshot()['items'] if i['id']==self.person['id'])['participationCount'],0)
        self.store.archive(event['id'],True,self.actor,event['version']);self.assertEqual(self.api.confirm(payload,self.actor)['id'],event['id'])

    def test_confirm_stale_reply_or_other_poll_blocked(self):
        r=self.response();payload=dict(id=self.poll['id'],version=1,slotId=self.poll['slots'][0]['id'],responses=[dict(id=r['id'],version=999)])
        self.assertRaises(world.Problem,self.api.confirm,payload,self.actor)
        payload['responses'][0]['version']=1;payload['id']=self.create()['id'];self.assertRaises(world.Problem,self.api.confirm,payload,self.actor)

    def test_signed_wake_only_exact_form_and_key(self):
        token=self.poll['publicToken'];key=str(Path(self.tmp.name)/'availability-wake-key')
        self.assertTrue(is_availability_location('/scrib-disponibilidad/'+token,key))
        for value in ['/mundo-scrib/','/scrib-disponibilidad/api/'+token,'/scrib-disponibilidad/'+secrets.token_urlsafe(32)]:self.assertFalse(is_availability_location(value,key))
        self.assertEqual((Path(key).stat().st_mode&0o777),0o600)

    def test_backup_contains_responses_not_secret(self):
        self.response();data=self.store.export()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            body=json.loads(z.read('mundo-scrib.json'));self.assertEqual(len(body['availabilityReplies']),1);self.assertNotIn('availability-wake-key',z.namelist())

    def test_integration_is_surgical_and_repeatable(self):
        code='before\n'+integrate.BRIDGE+'after\n'
        patched=integrate.availability_dashboard(code);self.assertEqual(integrate.availability_dashboard(patched),patched)
        self.assertTrue(patched.endswith('after\n'));self.assertIn(integrate.BRIDGE,patched)
        nginx='location = /_auth_check {\n}\n';out=integrate.availability_nginx(nginx)
        self.assertEqual(integrate.availability_nginx(out),out);self.assertTrue(out.startswith(nginx))
        gateway='location = /sutura {\n}\n';out=integrate.availability_gateway_nginx(gateway)
        self.assertEqual(integrate.availability_gateway_nginx(out),out);self.assertTrue(out.endswith(gateway))

    def test_deadline_and_rate_limit(self):
        p=self.store.update(self.poll['id'],dict(self.poll,deadline='2000-01-01T12:00'),self.actor,1)
        self.assertFalse(self.api.public(p['publicToken'])['open']);self.assertRaises(world.Problem,self.response)
        self.store.update(p['id'],dict(p,deadline=''),self.actor,p['version'])
        import availability,time
        self.api.rates[availability.token_hash(p['publicToken'])]=(time.monotonic(),240)
        with self.assertRaises(world.Problem) as e:self.response()
        self.assertEqual(e.exception.status,429)

    def test_multiple_slots_anonymous_cast_and_confirmation_conflict(self):
        r=self.response(answers={s['id']:'yes' for s in self.poll['slots']})
        payload=dict(id=self.poll['id'],version=1,slotId=self.poll['slots'][0]['id'],responses=[dict(id=r['id'],version=1)],close=False)
        e=self.api.confirm(payload,self.actor);self.assertEqual(e['cast'],[]);self.assertIn(r['name'],e['description'])
        self.assertTrue(self.api.public(self.poll['publicToken'])['open'])
        payload['slotId']=self.poll['slots'][1]['id'];self.assertRaises(world.Problem,self.api.confirm,payload,self.actor)
        payload['version']=self.api.details(self.poll['id'])['poll']['version'];e2=self.api.confirm(payload,self.actor)
        self.assertNotEqual(e['id'],e2['id']);self.assertEqual(len(self.api.details(self.poll['id'])['poll']['confirmed']),2)


class PublicHTTPTests(PollTests):
    def setUp(self):
        super().setUp();self.app=world.App(0,self.store,secret='unit-test-secret-not-real');self.thread=threading.Thread(target=self.app.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.app.shutdown();self.app.server_close();self.thread.join();super().tearDown()
    def http(self,path,data=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.app.server_address[1],timeout=5);head=headers or {}
        if data is not None:head=dict(head,**{'Content-Type':'application/json'})
        conn.request('POST' if data is not None else 'GET',path,json.dumps(data) if data is not None else None,head);r=conn.getresponse();body=r.read();status=r.status;out=dict(r.getheaders());conn.close();return status,body,out
    def test_public_no_auth_csrf_and_private_still_auth(self):
        path=world.PUBLIC_PREFIX+'api/'+self.poll['publicToken'];status,body,headers=self.http(path);self.assertEqual(status,200);p=json.loads(body)
        self.assertEqual(headers['Referrer-Policy'],'no-referrer')
        h={'Origin':'https://sutura.ddns.net','X-CSRF-Token':p['csrf'],'Cookie':headers['Set-Cookie'].split(';')[0]}
        data=dict(editToken=secrets.token_urlsafe(32),name='Pública',version=0,answers={self.poll['slots'][0]['id']:'yes'})
        self.assertEqual(self.http(path,data)[0],403)
        self.assertEqual(self.http(path,data,dict(h,Origin='https://evil.example'))[0],403)
        status,body,_=self.http(path,data,h);self.assertEqual(status,200);self.assertNotIn('personId',json.loads(body)['mine'])
        self.assertEqual(self.http('/mundo-scrib/api/state')[0],401)
        self.assertEqual(self.http(world.PUBLIC_PREFIX+'api/../../mundo-scrib/api/state')[0],404)
        self.assertEqual(self.http(world.PUBLIC_PREFIX+'api/'+secrets.token_urlsafe(32))[0],404)
        _,body2,headers2=self.http(path,headers={'Cookie':h['Cookie']});self.assertEqual(json.loads(body2)['csrf'],p['csrf'])


if __name__=='__main__':unittest.main()
