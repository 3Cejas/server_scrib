import base64
import hashlib
import http.client
import json
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from test_world import world
from import_billing import import_candidates, Problem as BillingImportProblem

class BusinessTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=world.Store(self.tmp.name);self.b=self.store.business
        self.person=self.store.create('person',{'name':'Elenco de prueba'},'admin',str(uuid.uuid4()))
        self.event=self.store.create('event',{'title':'Bolo de prueba','start':'2026-11-07T20:00','venue':'Teatro',
            'cast':[{'personId':self.person['id'],'role':'Escritura','team':'blue'}]},'admin',str(uuid.uuid4()))
    def tearDown(self):self.tmp.cleanup()
    def settings(self):
        return self.b.save('settings',{'id':'organizer','version':0,'name':'Entidad ficticia','taxId':'PRUEBA','address':'Domicilio ficticio',
            'representative':'Representante de ensayo','template':'{persona} / {bolo} / {fecha} / {lugar} / {papel} / {documento}','confirmed':True},'admin')
    def agreement(self):
        s=self.settings();self.b.generate({'eventId':self.event['id'],'eventVersion':self.event['version'],'settingsVersion':s['version'],'people':[self.person['id']]},'admin')
        return self.b.agreements(self.event['id'])['agreements'][0]
    def settlement(self,**changes):
        data={'id':self.event['id'],'version':0,'season':'2026–2027','days':[{'date':'2026-11-07','income':'100,00','expenses':'10',
            'allocations':[{'personId':self.person['id'],'amount':'42.35','paid':False}]}],**changes}
        return self.b.save('settlement',data,'admin')
    def report(self):
        return {'version':1,'id':'match-123','bolo':{'id':self.event['id']},'startedAt':1788888880000,'endedAt':1788888889000,
            'writers':{'1':{'name':'AZUL','text':'Primera línea\nSegunda línea'},'2':{'name':'ROJO','text':'Otra historia'}},'stats':{},'score':{}}
    def test_report_saved_as_json_idempotent_and_preserves_lines(self):
        self.assertFalse(self.b.archive_report(self.report())['duplicate']);self.assertTrue(self.b.archive_report(self.report())['duplicate'])
        self.assertEqual(len(self.b.reports(self.event['id'])['reports']),1)
        self.assertIn('\n',self.b.report('match-123')['writers']['1']['text'])
        self.assertFalse(list(Path(self.tmp.name).rglob('*.pdf')))
    def test_billing_import_exact_identity_private_unverified_and_no_overwrite(self):
        candidate={'id':self.person['id'],'expectedName':self.person['name'],'legalName':'Persona fiscal ficticia',
                   'taxId':'PRUEBA','source':'https://drive.google.com/file/d/example','vat':'10','withholding':'15','verified':True}
        self.assertEqual(import_candidates(self.store,[candidate])['importable'],1)
        self.assertEqual(self.b.overview()['records'],[])
        self.assertTrue(import_candidates(self.store,[candidate],True)['applied'])
        fiscal=self.b.overview()['records'][0]
        self.assertFalse(fiscal['verified']);self.assertIsNone(fiscal['vat']);self.assertIsNone(fiscal['withholding'])
        self.assertEqual(import_candidates(self.store,[candidate],True)['preserved'],1)
        candidate['expectedName']='Otra persona'
        with self.assertRaises(BillingImportProblem):import_candidates(self.store,[candidate],True)
        self.assertNotIn('PRUEBA',json.dumps(self.store.snapshot()))
    def test_agreement_includes_multiple_event_days(self):
        with self.store.transaction() as db:
            e=self.store.item(db,self.event['id'],'event')
            e['end']='2026-11-09T22:00'
            db.execute('UPDATE items SET body=? WHERE id=?',(json.dumps(e),self.event['id']))
        self.assertIn('9 de noviembre de 2026',self.agreement()['text'])
    def test_reports_keep_multiple_dates_and_immutable_identity(self):
        r=self.report();self.b.archive_report(r);r['id']='match-124';r['endedAt']+=20000;self.b.archive_report(r)
        self.assertEqual(self.b.reports(self.event['id'])['reports'][0]['id'],'match-124')
        r['writers']['1']['text']='changed'
        with self.assertRaises(world.Problem):self.b.archive_report(r)
    def test_unknown_bolo_and_bad_timestamp_rejected(self):
        r=self.report();r['bolo']['id']='missing'
        with self.assertRaises(world.Problem):self.b.archive_report(r)
        r=self.report();r['endedAt']=False
        with self.assertRaises(world.Problem):self.b.archive_report(r)
    def test_settings_require_review(self):
        with self.assertRaises(world.Problem):self.b.save('settings',{'id':'organizer','version':0},'admin')
    def test_generation_requires_current_template_and_event(self):
        s=self.settings()
        for version in (0,'1'):
            with self.assertRaises(world.Problem):self.b.generate({'eventId':self.event['id'],'eventVersion':version,'settingsVersion':s['version'],'people':[self.person['id']]},'admin')
    def test_generation_idempotent_and_personal_data_minimal(self):
        a=self.agreement();s=self.b.overview()['records'][0]
        self.b.generate({'eventId':self.event['id'],'eventVersion':self.event['version'],'settingsVersion':s['version'],'people':[self.person['id']]},'admin')
        self.assertEqual(len(self.b.agreements(self.event['id'])['agreements']),1)
        p=self.b.public(a['link'].split('/')[-1]);self.assertEqual(p['kind'],'agreement')
        for key in ('personId','token','phone','billing','iban','eventId'):self.assertNotIn(key,p)
        self.assertNotIn('FESTIVAL IMPARABLES',p['text']);self.assertIn('7 de noviembre de 2026',p['text'])
    def test_signed_original_bytes_and_duplicate_upload(self):
        a=self.agreement();token=a['link'].split('/')[-1];raw=b'%PDF-1.7\noriginal signature bytes\n%%EOF\n'
        data={'name':'firmado.pdf','base64':base64.b64encode(raw).decode()}
        self.assertFalse(self.b.upload(token,data)['duplicate']);self.assertTrue(self.b.upload(token,data)['duplicate'])
        a=self.b.agreements(self.event['id'])['agreements'][0]
        self.assertEqual(a['status'],'uploaded');self.assertEqual(self.b.document(a['uploads'][0]['id']),raw)
        self.b.agreement_state({'id':a['id'],'status':'reviewed'},'admin')
        with self.assertRaises(world.Problem):self.b.upload(token,data)
    def test_fake_pdf_revocation_expiry_and_paths(self):
        a=self.agreement();token=a['link'].split('/')[-1]
        for data in ({'name':'firmado.pdf','base64':'notbase64'},{'name':'../../test.pdf','base64':base64.b64encode(b'%PDF-1\n%%EOF').decode()}):
            with self.assertRaises(world.Problem):self.b.upload(token,data)
        self.b.agreement_state({'id':a['id'],'status':'revoked'},'admin')
        with self.assertRaises(world.Problem):self.b.public(token)
        self.assertEqual(self.b.agreements(self.event['id'])['agreements'][0]['status'],'revoked')
    def test_private_data_not_shared_snapshot(self):
        self.settings();self.settlement();self.b.save('billing',{'id':self.person['id'],'version':0,'legalName':'Privado','taxId':'PRIVADO'},'admin')
        snapshot=json.dumps(self.store.snapshot());self.assertNotIn('PRIVADO',snapshot);self.assertNotIn('42.35',snapshot)
    def test_cents_multiday_and_conflict(self):
        r=self.settlement();self.assertEqual(r['days'][0]['allocations'][0]['amount'],4235)
        with self.assertRaises(world.Problem):self.settlement()
        for v in ('-1','1.001','NaN',1.1,'1e4'):
            with self.assertRaises(world.Problem):self.b.money(v)
    def test_overallocation_paid_dates_duplicates_and_foreign_people(self):
        base={'date':'2026-11-07','income':'10','expenses':'0','allocations':[{'personId':self.person['id'],'amount':'11'}]}
        with self.assertRaises(world.Problem):self.settlement(days=[base])
        base['allocations'][0]['amount']='2';base['allocations'][0]['paid']=True
        with self.assertRaises(world.Problem):self.settlement(days=[base])
        base['allocations'][0]['paid']=False
        with self.assertRaises(world.Problem):self.settlement(days=[base,base])
        base['allocations'][0]['personId']='missing'
        with self.assertRaises(world.Problem):self.settlement(days=[base])
    def test_invoice_requires_verified_fiscal_data_and_individual_rates(self):
        self.settings();self.settlement();data={'eventId':self.event['id'],'personId':self.person['id'],'date':'2026-11-08'}
        with self.assertRaises(world.Problem):self.b.invoice(data,'admin')
        self.b.save('billing',{'id':self.person['id'],'version':0,'legalName':'Nombre de ensayo','taxId':'PRUEBA','address':'Domicilio de ensayo','vat':'10','withholding':'15','verified':True},'admin')
        r=self.b.invoice(data,'admin');self.assertEqual((r['base'],r['vat'],r['withholding'],r['total']),(4235,424,635,4024));self.assertEqual(r['status'],'draft')
        self.assertTrue(any(x['type']=='invoice' and x['id']==r['id'] for x in self.b.overview()['records']))
    def test_uploads_and_business_in_backup(self):
        self.settings();self.settlement()
        import zipfile,io
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as z:
            data=json.loads(z.read('mundo-scrib.json'));self.assertEqual(len(data['businessRecords']),2)

class BusinessHttpTests(BusinessTests):
    def setUp(self):
        super().setUp();self.app=world.App(0,self.store,False,secret='test-secret',bridge=None);self.thread=threading.Thread(target=self.app.serve_forever,daemon=True);self.thread.start()
        self.app.origins.add('http://localhost')
    def tearDown(self):self.app.shutdown();self.app.server_close();self.thread.join();super().tearDown()
    def call(self,path,method='GET',data=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.app.server_address[1],timeout=5);h={'X-Scrib-Bridge':'test-secret','X-Scrib-User':'ordinary-user',**(headers or {})}
        body=json.dumps(data) if data is not None else None
        if body:h['Content-Type']='application/json'
        c.request(method,path,body,h);r=c.getresponse();raw=r.read();status=r.status;headers=dict(r.getheaders());c.close();return status,headers,json.loads(raw) if 'application/json' in headers.get('Content-Type','') else raw
    def test_browser_user_cannot_archive_or_read_finances(self):
        self.assertEqual(self.call('/scrib/backstage/api/business/overview')[0],403)
        self.assertEqual(self.call('/scrib/backstage/api/match-reports','POST',self.report())[0],403)
        self.assertEqual(self.call('/scrib/backstage/api/match-reports','POST',self.report(),{'X-Scrib-User':'videojuego-control'})[0],200)
        self.assertEqual(self.call('/scrib/backstage/api/reports/event/'+self.event['id'])[0],200)
    def test_public_upload_csrf_and_no_identity_required(self):
        a=self.agreement();token=a['link'].split('/')[-1];url='/scrib-disponibilidad/api/'+token
        status,headers,data=self.call(url);self.assertEqual(status,200);self.assertEqual(data['kind'],'agreement')
        payload={'name':'test.pdf','base64':base64.b64encode(b'%PDF-1.7\n%%EOF').decode()}
        self.assertEqual(self.call(url,'POST',payload,{'Origin':'http://localhost'})[0],403)
        head={'Origin':'http://localhost','Cookie':headers['Set-Cookie'].split(';')[0],'X-CSRF-Token':data['csrf']}
        self.assertEqual(self.call(url,'POST',payload,head)[0],200)
        self.assertEqual(self.call(url,'POST',payload,dict(head,Origin='http://evil'))[0],403)
    def test_documents_admin_only_and_unknown_tokens(self):
        self.assertEqual(self.call('/scrib/backstage/api/business/document/missing')[0],403)
        self.assertEqual(self.call('/scrib-disponibilidad/api/'+'A'*43)[0],404)

if __name__=='__main__':unittest.main()
