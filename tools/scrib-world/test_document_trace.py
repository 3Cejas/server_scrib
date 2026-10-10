import base64
import concurrent.futures
import io
import json
import os
import tempfile
from types import SimpleNamespace
import unittest
import uuid
import zipfile

import test_world as fixtures
from document_trace import key, KEY_NAME, verify_pdf
from pdf_export import generate

world=fixtures.world
ADMIN={'role':'admin','username':'exportador'}


class TraceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=world.Store(self.tmp.name)
        self.store.identify('exportador','Nombre de quien exporta')
    def tearDown(self):self.tmp.cleanup()
    def pdf(self,user=ADMIN):return generate(self.store,{'kind':'lighting'},user)

    def test_private_identity_and_verifiable_signature_survive_restart(self):
        from pypdf import PdfReader
        raw=self.pdf();reader=PdfReader(io.BytesIO(raw));text='\n'.join(p.extract_text() for p in reader.pages)
        self.assertTrue(reader.metadata['/SCRIBTrace'].startswith('SC-'))
        self.assertNotIn('exportador',str(reader.metadata));self.assertNotIn('Nombre de quien exporta',text)
        self.assertIn('NO DISTRIBUIR',text);self.assertIn('@scrib_show',text);self.assertIn('@su.tu.ra',text)
        self.assertTrue(all('NO DISTRIBUIR' in p.extract_text() for p in reader.pages))
        result=verify_pdf(world.Store(self.tmp.name),raw)
        self.assertEqual(result['status'],'original');self.assertTrue(result['verified'])
        self.assertEqual(result['exportedBy'],'exportador');self.assertEqual(result['name'],'Nombre de quien exporta')
        self.assertEqual(os.stat(self.store.directory/KEY_NAME).st_mode&0o777,0o600)
        self.assertGreaterEqual(len(reader.pages[0].get('/Annots',[])),3)

    def test_changed_content_and_forged_seal_are_not_attributed_as_original(self):
        raw=self.pdf();changed=verify_pdf(self.store,raw+b'\n% modified')
        self.assertEqual(changed['status'],'modified');self.assertFalse(changed['verified'])
        self.assertEqual(changed['exportedBy'],'exportador')
        from pypdf import PdfReader
        seal=PdfReader(io.BytesIO(raw)).metadata['/SCRIBSeal'].encode()
        bad=raw.replace(seal,b'0'*64)
        self.assertEqual(verify_pdf(self.store,bad),{'status':'unknown','verified':False})
        with self.store.connect() as db:db.execute("UPDATE document_exports SET actor='otra-persona'")
        self.assertEqual(verify_pdf(self.store,raw),{'status':'unknown','verified':False})

    def test_key_not_regenerated_if_missing_or_corrupt_and_legacy_pdf_has_no_false_match(self):
        raw=self.pdf();path=self.store.directory/KEY_NAME;old=path.read_bytes();path.unlink()
        self.assertEqual(verify_pdf(self.store,raw)['status'],'unverifiable');self.assertFalse(path.exists())
        path.write_bytes(old[:8]);os.chmod(path,0o600)
        self.assertEqual(verify_pdf(self.store,raw)['status'],'unverifiable')
        self.assertEqual(verify_pdf(self.store,b'%PDF-1.4 legacy'),{'status':'unknown','verified':False})
        with self.assertRaises(world.Problem):verify_pdf(self.store,b'not a pdf')

    def test_atomic_private_key_creation_and_exports_never_reuse_trace_ids(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            keys=list(pool.map(lambda _:key(self.store.directory,True),range(18)))
        self.assertTrue(all(k==keys[0] for k in keys));self.assertEqual(len(keys[0]),32)
        first,second=self.pdf(),self.pdf()
        self.assertNotEqual(verify_pdf(self.store,first)['reference'],verify_pdf(self.store,second)['reference'])
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM document_exports').fetchone()[0],2)

    def test_zip_recovery_includes_private_key_and_ledger_never_in_public_state(self):
        raw=self.pdf()
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as archive:
            data=json.loads(archive.read('mundo-scrib.json'))
            self.assertEqual(len(data['documentExports']),1)
            self.assertEqual(archive.read(KEY_NAME),key(self.store.directory))
        self.assertNotIn('documentExports',self.store.snapshot())
        self.assertNotIn('document-trace.key',str(self.store.snapshot()))
        self.assertEqual(verify_pdf(self.store,raw)['status'],'original')

    def test_all_six_generated_document_types_share_branding_and_trace_but_not_uploaded_signatures(self):
        from test_business import BusinessTests
        from pypdf import PdfReader
        fixture=BusinessTests();fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture.store.identify('exportador','Exportador de prueba')
        obj=fixture.store.create('inventory',{'title':'Kit de muestra','team':'blue'},'exportador',str(uuid.uuid4()))
        fixture.b.archive_report(fixture.report())
        agreement=fixture.agreement();fixture.settlement()
        fixture.b.save('billing',{'id':fixture.person['id'],'version':0,'legalName':'Nombre ficticio',
            'taxId':'PRUEBA','address':'Domicilio ficticio','vat':'10','withholding':'15','verified':True},'admin')
        original=b'%PDF-1.7\noriginal signed upload, never rewrite\n%%EOF\n'
        fixture.b.upload(agreement['link'].split('/')[-1],{'name':'firmado.pdf','base64':base64.b64encode(original).decode()})
        fixture.b.agreement_state(dict(id=agreement['id'],status='reviewed'),'admin')
        invoice=fixture.b.invoice({'eventId':fixture.event['id'],'personId':fixture.person['id'],'date':'2026-11-08'},'admin')
        upload=fixture.b.agreements(fixture.event['id'])['agreements'][0]['uploads'][0]['id']
        for data in [{'kind':'inventory','ids':[obj['id']]},{'kind':'event','id':fixture.event['id']},
                     {'kind':'lighting'},{'kind':'report','id':'match-123'},{'kind':'agreement','id':agreement['id']},
                     {'kind':'invoice','id':invoice['id']}]:
            with self.subTest(kind=data['kind']):
                raw=generate(fixture.store,data,ADMIN);reader=PdfReader(io.BytesIO(raw))
                for page in reader.pages:
                    content=page.extract_text()
                    for phrase in ['PRODUCCIÓN / SUTURA TEATRO','@scrib_show','@su.tu.ra','NO DISTRIBUIR','MATERIAL INTERNO']:
                        self.assertIn(phrase,content)
                trace=verify_pdf(fixture.store,raw)
                self.assertTrue(trace['verified']);self.assertEqual(trace['exportedBy'],'exportador')
                self.assertEqual(trace['kind'],data['kind'])
        self.assertEqual(fixture.b.document(upload),original)

    def dispatch(self,raw,role='admin',csrf=True,secret='bridge-secret'):
        handler=object.__new__(world.Handler)
        handler.server=SimpleNamespace(store=self.store,demo=False,secret='bridge-secret',origins={'https://sutura-gateway.ddns.net'})
        handler.command='POST';handler.path=world.PREFIX+'api/pdf/verify'
        token=handler.csrf_token('exportador')
        handler.headers={'X-Scrib-Bridge':secret,'X-Scrib-User':'exportador','X-Scrib-Role':role,
                         'Origin':'https://sutura-gateway.ddns.net','Cookie':'scrib_world_csrf='+token,
                         'X-CSRF-Token':token if csrf else '','Content-Type':'application/json'}
        payload=json.dumps({'pdf':base64.b64encode(raw).decode()}).encode()
        handler.headers['Content-Length']=str(len(payload));handler.rfile=io.BytesIO(payload)
        handler.connection=SimpleNamespace(settimeout=lambda _:None);results=[]
        handler.reply=lambda *args,**kwargs:results.append(args);handler.dispatch();return results[0]

    def test_verification_requires_auth_admin_origin_and_csrf_without_sockets(self):
        raw=self.pdf()
        self.assertEqual(self.dispatch(raw,secret='')[0],401)
        self.assertEqual(self.dispatch(raw,csrf=False)[0],403)
        self.assertEqual(self.dispatch(raw,role='user')[0],403)
        status,data=self.dispatch(raw)
        self.assertEqual(status,200);self.assertEqual(data['status'],'original')
        self.assertEqual(self.dispatch(b'not a pdf')[0],400)

    def test_provenance_upload_route_has_own_nginx_limit_without_weakening_auth_or_other_routes(self):
        from document_routes import transform, BEGIN
        import rename_world
        for gateway,original in [(False,rename_world.NGINX),(True,rename_world.GATEWAY_NGINX)]:
            source='other routes\n'+original+'\nother trailing routes'
            updated=transform(source,gateway)
            self.assertEqual(updated,transform(updated,gateway));self.assertIn(original,updated)
            block=updated.split(BEGIN)[1]
            self.assertIn('location = /scrib/backstage/api/pdf/verify {',block)
            self.assertIn('client_max_body_size 23m;',block)
            self.assertIn('auth_request /_wake/check;' if gateway else 'nginx-forward-auth-snippet.conf;',block)
            self.assertTrue(updated.endswith('other trailing routes'))
            for bad in ['unknown routes',updated.replace('client_max_body_size 23m;','client_max_body_size 100m;'),updated+BEGIN]:
                with self.assertRaises(ValueError):transform(bad,gateway)


if __name__=='__main__':unittest.main()
