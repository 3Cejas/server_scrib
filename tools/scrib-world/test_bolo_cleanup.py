import base64
import io
import json
import tempfile
import unittest
import uuid
from pathlib import Path

import test_business
from test_world import world
from lighting import coordinates, default_plan
from pdf_export import generate, PlanImage


class BoloCleanupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, kind, **data):
        return self.store.create(kind, data, 'admin', str(uuid.uuid4()))

    def test_manual_rehearsal_links_bolo_without_poll_or_production_tasks(self):
        bolo = self.create('event', title='León', start='2026-11-07')
        ensayo = self.create('event', title='Lectura', start='2026-11-01T19:00', end='2026-11-01T21:00',
                             parentEventId=bolo['id'], eventType='rehearsal')
        self.assertEqual(ensayo['parentEventId'], bolo['id'])
        self.assertNotIn('sourcePollId', ensayo)
        self.assertEqual(ensayo['boardId'], '')
        self.assertFalse(any(i['kind']=='ticket' or i.get('eventId') for i in self.store.snapshot()['items']))
        updated = self.store.update(ensayo['id'], dict(ensayo, title='Nuevo horario'), 'admin', ensayo['version'])
        self.assertEqual(updated['eventType'], 'rehearsal')
        self.assertEqual(updated['parentEventId'], bolo['id'])
        self.assertEqual(world.Store(self.tmp.name).details(updated['id'])['item'], updated)
        archived = self.store.archive(ensayo['id'], True, 'admin', updated['version'])
        self.assertTrue(archived['archived'])
        self.assertFalse(self.store.details(bolo['id'])['item']['archived'])

    def test_manual_rehearsal_rejects_missing_wrong_or_archived_parent(self):
        bolo = self.create('event', title='Bolo', start='2026-11-07')
        rehearsal = self.create('event', title='Ensayo', start='2026-11-01', eventType='rehearsal')
        for parent in ('missing', rehearsal['id']):
            with self.assertRaises(world.Problem):
                self.create('event', title='Ensayo', start='2026-11-02', eventType='rehearsal', parentEventId=parent)
        with self.assertRaises(world.Problem):
            self.create('event', title='Bolo', start='2026-11-02', parentEventId=bolo['id'])
        self.store.archive(bolo['id'], True, 'admin', bolo['version'])
        with self.assertRaises(world.Problem):
            self.create('event', title='Ensayo', start='2026-11-02', eventType='rehearsal', parentEventId=bolo['id'])

    def test_actor_room_below_full_width_technical_area_and_saved_positions_unchanged(self):
        plan = default_plan()
        actors = [coordinates(e) for e in plan['elements'] if e.get('zone')=='actors']
        technical = [coordinates(e) for e in plan['elements'] if e.get('zone')=='technical']
        self.assertGreater(min(y for _, y in actors), max(y for _, y in technical)+70)
        self.assertEqual(coordinates(dict(zone='technical',x=20,y=50)), (260,995))
        self.assertEqual(coordinates(dict(zone='actors',x=20,y=50)), (260,1415))

    def test_stacked_plan_png_and_previous_format_export_at_correct_aspect_ratio(self):
        from PIL import Image
        for height in (1250, 1600):
            raw=io.BytesIO()
            Image.new('RGB',(1000,height),'black').save(raw,format='PNG')
            image=PlanImage(base64.b64encode(raw.getvalue()).decode(),world.Problem)
            self.assertAlmostEqual(image.drawWidth/image.drawHeight,1000/height)
        raw=io.BytesIO();Image.new('RGB',(1000,1700),'black').save(raw,format='PNG')
        with self.assertRaises(world.Problem):
            PlanImage(base64.b64encode(raw.getvalue()).decode(),world.Problem)


class DocumentCleanupTests(unittest.TestCase):
    def setUp(self):
        self.fixture=test_business.BusinessTests()
        self.fixture.setUp()
        self.store=self.fixture.store
        self.business=self.fixture.b

    def tearDown(self):
        self.fixture.tearDown()

    def test_partial_organization_autofill_never_generates_with_unconfirmed_address(self):
        settings=self.business.save('settings',dict(id='organizer',version=0,name='ASOCIACIÓN DE PRUEBA',
            taxId='G00000000',address='',representative='Representante ficticio',
            template=(Path(__file__).parent/'agreement_template.txt').read_text(),confirmed=False),'admin')
        e=self.fixture.event
        preview=self.business.agreement_preview(e['id'])
        self.assertTrue(preview['pending'])
        self.assertIn('ASOCIACIÓN DE PRUEBA',preview['previews'][0]['text'])
        self.assertIn('[Domicilio pendiente]',preview['previews'][0]['text'])
        with self.assertRaises(world.Problem):
            self.business.generate(dict(eventId=e['id'],eventVersion=e['version'],settingsVersion=settings['version'],
                people=[self.fixture.person['id']]),'admin')

    def test_invoice_auto_concept_roles_dates_and_private_fiscal_details(self):
        self.fixture.settings()
        self.business.save('billing',dict(id=self.fixture.person['id'],version=0,legalName='Nombre fiscal',
            taxId='PRUEBA-P',address='Domicilio de prueba',vat='10',withholding='15',verified=True),'admin')
        event=self.fixture.event
        event=self.store.update(event['id'],dict(event,cast=event['cast']+[dict(personId=self.fixture.person['id'],
            role='Interpretación',team='blue')]),'admin',event['version'])
        self.fixture.settlement(days=[
            dict(date='2026-11-07',income='100',expenses='0',allocations=[dict(personId=self.fixture.person['id'],amount='10')]),
            dict(date='2026-11-08',income='100',expenses='0',allocations=[dict(personId=self.fixture.person['id'],amount='20')])])
        invoice=self.business.invoice(dict(eventId=event['id'],personId=self.fixture.person['id'],date='2026-11-09'),'admin')
        for word in ('Escritura e Interpretación','Bolo de prueba','Teatro','7 de noviembre de 2026','8 de noviembre de 2026'):
            self.assertIn(word,invoice['concept'])
        self.assertEqual(invoice['recipient']['taxId'],'PRUEBA')
        self.assertEqual(invoice['series'],'SUTURA')
        self.assertEqual((invoice['base'],invoice['total']),(3000,2850))
        self.assertNotIn('Domicilio ficticio',json.dumps(self.store.snapshot()))

    def test_full_agreement_clause_layout_logos_and_scoped_public_pdf(self):
        from pypdf import PdfReader
        settings=self.fixture.settings()
        template=(Path(__file__).parent/'agreement_template.txt').read_text()
        settings=self.business.save('settings',dict(settings,id='organizer',template=template,confirmed=True),'admin')
        e=self.fixture.event
        self.business.generate(dict(eventId=e['id'],eventVersion=e['version'],settingsVersion=settings['version'],
            people=[self.fixture.person['id']]),'admin')
        agreement=self.business.agreements(e['id'])['agreements'][0]
        with self.store.connect() as db:
            token=db.execute('SELECT token FROM agreements WHERE id=?',(agreement['id'],)).fetchone()['token']
        raw=generate(self.store,dict(kind='agreement',id=agreement['id']),
                     dict(role='public',username='enlace-personal'),agreement_token=token)
        reader=PdfReader(io.BytesIO(raw))
        text='\n'.join(p.extract_text() for p in reader.pages)
        for clause in ('PRIMERA. OBJETO','QUINTA. SISTEMA ECONÓMICO','DECIMOCUARTA. ACEPTACIÓN',self.fixture.person['name']):
            self.assertIn(clause,text)
        self.assertIn('Representante de ensayo',text)
        self.assertNotIn('{entidad}',text)
        self.assertGreaterEqual(len(reader.pages[0]['/Resources']['/XObject']),2)
        with self.assertRaises(world.Problem):
            generate(self.store,dict(kind='agreement',id=agreement['id']),dict(role='viewer',username='otro'))
        with self.assertRaises(world.Problem):
            generate(self.store,dict(kind='agreement',id='wrong'),dict(role='public',username='otro'),agreement_token=token)
        self.business.agreement_state(dict(id=agreement['id'],status='revoked'),'admin')
        with self.assertRaises(world.Problem):
            generate(self.store,dict(kind='agreement',id=agreement['id']),dict(role='public',username='otro'),agreement_token=token)
