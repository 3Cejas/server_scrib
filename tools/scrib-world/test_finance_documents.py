import base64
import io
import json
import threading
import unittest
import uuid
import zipfile
from pathlib import Path
import test_business as fixtures
world=fixtures.world


class FinanceDocumentsTests(unittest.TestCase):
    setUp=fixtures.BusinessTests.setUp
    tearDown=fixtures.BusinessTests.tearDown
    settings=fixtures.BusinessTests.settings
    settlement=fixtures.BusinessTests.settlement
    signed_agreement=fixtures.BusinessTests.signed_agreement

    def invoice(self, **changes):
        self.settings();self.settlement();self.signed_agreement()
        self.b.save('billing',dict(id=self.person['id'],version=0,legalName='PERSONA FICTICIA',taxId='PRUEBA',address='Domicilio ficticio',iban='ES00 CUENTA DE PRUEBA',vat='10',withholding='15'),'admin')
        return self.b.invoice(dict(eventId=self.event['id'],personId=self.person['id'],date='2026-11-08',**changes),'admin')

    def payload(self, invoice, raw=b'%PDF-1.7\noriginal signed bytes\n%%EOF\n'):
        return dict(id=invoice['id'],version=1,name='factura-firmada.pdf',base64=base64.b64encode(raw).decode())

    def delete(self, kind, ident, **extra):
        return self.b.delete_document(kind,dict(id=ident,confirmed=True,requestId=str(uuid.uuid4()),**extra),'admin')

    def test_invoice_upload_preserves_original_private_bytes_and_lost_ack_is_idempotent(self):
        invoice=self.invoice();payload=self.payload(invoice)
        result=self.b.invoice_upload(payload,'admin');retry=self.b.invoice_upload(payload,'admin')
        self.assertFalse(result['duplicate']);self.assertTrue(retry['duplicate']);self.assertEqual(result['uploadId'],retry['uploadId'])
        self.assertEqual(self.b.invoice_document(result['uploadId']),base64.b64decode(payload['base64']))
        record=next(r for r in self.b.overview()['records'] if r['type']=='invoice')
        self.assertEqual(record['version'],2);self.assertEqual(len(record['uploads']),1)
        self.assertEqual(record['issuer'],invoice['issuer']);self.assertEqual(record['total'],invoice['total'])
        self.assertNotIn(result['uploadId'],json.dumps(self.store.snapshot()))
        self.assertTrue(all(p.stat().st_mode&0o077==0 for p in (Path(self.tmp.name)/'documents').glob('*.pdf')))

    def test_invalid_uploads_stale_version_wrong_invoice_and_limit_never_add_files(self):
        invoice=self.invoice();payload=self.payload(invoice)
        for changes in [dict(id='missing'),dict(version=0),dict(name='../x.pdf'),dict(base64='invalid'),dict(base64=base64.b64encode(b'not a PDF').decode())]:
            with self.assertRaises(world.Problem):self.b.invoice_upload(dict(payload,**changes),'admin')
        self.assertEqual(next(r for r in self.b.overview()['records'] if r['type']=='invoice')['uploads'],[])
        for i in range(10):
            raw=b'%PDF-1.7\n'+str(i).encode()+b'\n%%EOF\n'
            self.b.invoice_upload(dict(self.payload(invoice,raw),version=i+1),'admin')
        with self.assertRaises(world.Problem) as error:self.b.invoice_upload(dict(self.payload(invoice,b'%PDF-1.7\n11\n%%EOF\n'),version=11),'admin')
        self.assertEqual(error.exception.status,429)

    def test_deleting_invoice_is_confirmed_versioned_idempotent_and_does_not_delete_shared_agreement_or_payments(self):
        invoice=self.invoice();payload=self.payload(invoice);upload=self.b.invoice_upload(payload,'admin')
        agreement=self.b.agreements(self.event['id'])['agreements'][0]
        # Same bytes belong to another independent record as well.
        self.delete('agreement-upload',agreement['uploads'][0]['id'],agreementId=agreement['id'])
        self.b.admin_upload(dict(eventId=self.event['id'],personId=self.person['id'],agreementId=agreement['id'],eventVersion=self.event['version'],**{k:payload[k] for k in ('name','base64')}),'admin')
        before=[r for r in self.b.overview()['records'] if r['type']!='invoice']
        with self.assertRaises(world.Problem):self.delete('invoice',invoice['id'],version=1)
        data=dict(id=invoice['id'],version=2,confirmed=True,requestId=str(uuid.uuid4()))
        result=self.b.delete_document('invoice',data,'admin')
        self.assertTrue(result['deleted']);self.assertEqual(self.b.delete_document('invoice',data,'admin'),result)
        with self.assertRaises(world.Problem):self.b.delete_document('invoice',data,'someone-else')
        self.assertEqual(before,self.b.overview()['records'])
        with self.assertRaises(world.Problem):self.b.invoice_document(upload['uploadId'])
        remaining=self.b.agreements(self.event['id'])['agreements'][0]['uploads'][0]
        self.assertEqual(self.b.document(remaining['id']),base64.b64decode(payload['base64']))
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as archive:
            backup=json.loads(archive.read('mundo-scrib.json'))
            self.assertEqual(backup['invoiceUploads'],[])
            self.assertEqual(backup['businessDeletions'][-1]['type'],'invoice')
            self.assertTrue(any(name.startswith('documents/') for name in archive.namelist()))

    def test_delete_last_reviewed_agreement_unlocks_reupload_and_blocks_new_invoice(self):
        invoice=self.invoice();agreement=self.b.agreements(self.event['id'])['agreements'][0]
        upload=agreement['uploads'][0]
        with self.assertRaises(world.Problem):self.delete('agreement-upload',upload['id'],agreementId='other')
        self.delete('agreement-upload',upload['id'],agreementId=agreement['id'])
        kept=self.b.agreements(self.event['id'])['agreements'][0]
        self.assertEqual(kept['uploads'],[]);self.assertEqual(kept['status'],'generated')
        with self.assertRaises(world.Problem):self.b.document(upload['id'])
        with self.assertRaisesRegex(world.Problem,'acuerdo firmado'):self.b.invoice(dict(eventId=self.event['id'],personId=self.person['id'],date='2026-11-08'),'admin')
        self.assertTrue(any(r['id']==invoice['id'] for r in self.b.overview()['records']))
        self.assertEqual(self.b.public(agreement['link'].split('/')[-1])['uploads'],[])

    def test_deleting_one_of_several_agreement_versions_requires_new_review_and_never_unrevokes_link(self):
        self.settings();self.signed_agreement();a=self.b.agreements(self.event['id'])['agreements'][0]
        with self.store.transaction() as db:db.execute("UPDATE agreements SET status='uploaded' WHERE id=?",(a['id'],))
        self.b.upload(a['link'].split('/')[-1],dict(name='segunda.pdf',base64=base64.b64encode(b'%PDF-1.7\nsecond\n%%EOF').decode()))
        self.b.agreement_state(dict(id=a['id'],status='reviewed'),'admin')
        uploads=self.b.agreements(self.event['id'])['agreements'][0]['uploads']
        self.delete('agreement-upload',uploads[0]['id'],agreementId=a['id'])
        self.assertEqual(self.b.agreements(self.event['id'])['agreements'][0]['status'],'uploaded')
        self.b.agreement_state(dict(id=a['id'],status='revoked'),'admin')
        self.delete('agreement-upload',uploads[1]['id'],agreementId=a['id'])
        self.assertEqual(self.b.agreements(self.event['id'])['agreements'][0]['status'],'revoked')

    def test_delete_requires_confirmation_and_valid_receipt_without_changing_invoice(self):
        invoice=self.invoice()
        for change in [dict(confirmed=False),dict(requestId='bad'),dict(version=True)]:
            data=dict(id=invoice['id'],version=1,confirmed=True,requestId=str(uuid.uuid4()));data.update(change)
            with self.assertRaises(world.Problem):self.b.delete_document('invoice',data,'admin')
        self.assertTrue(any(r['id']==invoice['id'] for r in self.b.overview()['records']))

    def test_invoice_pdf_is_final_without_blank_number_and_preserves_bank_account(self):
        from pypdf import PdfReader
        from pdf_export import generate
        invoice=self.invoice()
        raw=generate(self.store,dict(kind='invoice',id=invoice['id']),dict(role='admin',username='test'))
        pages=PdfReader(io.BytesIO(raw)).pages
        self.assertEqual(len(pages),1)
        text='\n'.join(p.extract_text() for p in pages)
        self.assertNotIn('BORRADOR',text);self.assertNotIn('Pendiente',text);self.assertNotIn('N.º',text)
        self.assertIn('transferencia bancaria a la cuenta ES00 CUENTA DE PRUEBA',text)
        self.assertEqual(text.count('Nombre de quien firma'),1)
        self.assertEqual(text.count('\nFirma\n'),1)
        with self.store.transaction() as db:
            invoice['number']='2026-001';invoice['series']='SCRIB'
            db.execute("UPDATE business_records SET body=? WHERE type='invoice' AND id=?",(json.dumps(invoice),invoice['id']))
        raw=generate(self.store,dict(kind='invoice',id=invoice['id']),dict(role='admin',username='test'))
        text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(raw)).pages)
        self.assertIn('N.º SCRIB / 2026-001',text)

    def test_long_invoice_keeps_signature_and_name_together_at_the_end(self):
        from pypdf import PdfReader
        from pdf_export import generate
        invoice=self.invoice()
        invoice['lines']*=35
        with self.store.transaction() as db:
            db.execute("UPDATE business_records SET body=? WHERE type='invoice' AND id=?",(json.dumps(invoice),invoice['id']))
        raw=generate(self.store,dict(kind='invoice',id=invoice['id']),dict(role='admin',username='test'))
        pages=[p.extract_text() for p in PdfReader(io.BytesIO(raw)).pages]
        self.assertGreater(len(pages),1)
        self.assertIn('\nFirma\n',pages[-1]);self.assertIn('Nombre de quien firma',pages[-1])
        self.assertNotIn('Nombre de quien firma','\n'.join(pages[:-1]))


class FinanceDocumentsHttpTests(unittest.TestCase):
    call=fixtures.BusinessHttpTests.call
    def setUp(self):
        self.fixture=FinanceDocumentsTests();self.fixture.setUp();self.store=self.fixture.store
        self.app=world.App(0,self.store,False,secret='test-secret',bridge=None);self.app.origins.add('http://localhost')
        self.thread=threading.Thread(target=self.app.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.app.shutdown();self.app.server_close();self.thread.join();self.fixture.tearDown()
    def test_private_upload_delete_and_download_require_admin_bridge_and_csrf(self):
        invoice=self.fixture.invoice();payload=self.fixture.payload(invoice)
        _,headers,state=self.call('/scrib/backstage/api/state')
        csrf={'Origin':'http://localhost','Cookie':headers['Set-Cookie'].split(';')[0],'X-CSRF-Token':state['csrf']}
        for route in ('invoice-upload','invoice-delete','agreement-upload-delete'):
            path='/scrib/backstage/api/business/'+route
            self.assertEqual(self.call(path,'POST',payload,csrf)[0],403)
            self.assertEqual(self.call(path,'POST',payload,{'X-Scrib-Role':'admin'})[0],403)
            self.assertEqual(self.call(path,'POST',payload,dict(csrf,**{'X-Scrib-Role':'admin','X-Scrib-Bridge':''}))[0],401)
        admin=dict(csrf,**{'X-Scrib-Role':'admin'})
        status,_,reply=self.call('/scrib/backstage/api/business/invoice-upload','POST',payload,admin)
        self.assertEqual(status,200);ident=reply['item']['uploadId']
        route='/scrib/backstage/api/business/invoice-document/'+ident
        self.assertEqual(self.call(route)[0],403);self.assertEqual(self.call(route,headers={'X-Scrib-Bridge':''})[0],401)
        status,headers,raw=self.call(route,headers=admin)
        self.assertEqual(status,200);self.assertTrue(headers['Content-Disposition'].startswith('inline;'))
        self.assertEqual(raw,base64.b64decode(payload['base64']))
        deletion=dict(id=invoice['id'],version=2,confirmed=True,requestId=str(uuid.uuid4()))
        self.assertEqual(self.call('/scrib/backstage/api/business/invoice-delete','POST',deletion,admin)[0],200)
        self.assertEqual(self.call(route,headers=admin)[0],404)


if __name__=='__main__':unittest.main()
