import base64
import io
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
import test_world as fixtures
from inventory_seed import apply_initial_inventory
from inventory_teams import apply_team_inventory
from production import cast_requirements
from pdf_export import generate

ROOT=Path(__file__).resolve().parent
world=fixtures.world
ADMIN={'role':'admin','username':'tester'}


class ProductionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=world.Store(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def objects(self):
        with self.store.connect() as db:return self.store.all(db,'inventory')
    def seed(self):apply_initial_inventory(self.store);return apply_team_inventory(self.store)
    def create(self,kind,**body):return self.store.create(kind,body,'tester',str(uuid.uuid4()))

    def test_team_batch_22_objects_quantities_and_local_references_once(self):
        self.assertEqual(self.seed()['added'],11)
        objects=self.objects();self.assertEqual(len(objects),22)
        for team in ('blue','red'):
            rows=[o for o in objects if o['team']==team]
            self.assertEqual(len(rows),11);self.assertEqual(next(o['quantity'] for o in rows if o['title']=='Chaquetas'),3)
            self.assertEqual(next(o['quantity'] for o in rows if o['title']=='Linternas'),2)
            self.assertTrue(all(o['quantity']>=1 and o['condition']!='unchecked' for o in rows))
            self.assertGreaterEqual(sum(bool(o.get('image')) for o in rows),8)
        self.assertTrue(apply_team_inventory(self.store)['alreadyApplied'])
        self.assertEqual(len(self.objects()),22)

    def test_restart_does_not_replace_manual_photo_quantity_or_archived_item(self):
        self.seed();o=self.objects()[0]
        saved=self.store.update(o['id'],dict(o,quantity=23,sourceUrl='https://example.org/item'), 'tester',o['version'])
        self.store.archive(o['id'],True,'tester',saved['version'])
        apply_team_inventory(world.Store(self.tmp.name))
        kept=self.store.details(o['id'])['item'];self.assertEqual(kept['quantity'],23);self.assertTrue(kept['archived'])

    def test_batch_dry_run_and_rollback_never_resurrect_or_guess_objects(self):
        apply_initial_inventory(self.store);o=self.objects()[0]
        self.store.archive(o['id'],True,'tester',o['version'])
        unrelated=self.create('inventory',title='Objeto manual',team='general')
        result=apply_team_inventory(self.store,False)
        self.assertEqual(result['added'],10);self.assertEqual(len(self.objects()),12)
        apply_team_inventory(self.store)
        self.assertEqual(self.store.details(unrelated['id'])['item']['team'],'general')
        self.assertFalse(any(x['title']==o['title'] and not x['archived'] for x in self.objects()))

    def test_non_team_roles_normalized_and_incomplete_bolo_can_be_saved_as_draft(self):
        p=self.create('person',name='Persona',roles=['Jurado'])
        for role,team,expected in [('Técnica','red','general'),('Presentador','blue','general'),('Jurado','red','general'),('Escritora','red','red'),('Interpretación','blue','blue')]:
            e=self.create('event',title='Bolo',start='2026-11-07',cast=[dict(personId=p['id'],role=role,team=team)])
            self.assertEqual(e['cast'][0]['team'],expected)
        self.assertEqual(len(cast_requirements([])),8);self.assertFalse(any(r['complete'] for r in cast_requirements([])))
        self.assertNotIn('Participación',world.PERSON_ROLES);self.assertIn('Jurado',world.PERSON_ROLES)

    def test_new_bolo_inventory_defaults_to_all_and_explicit_selection_is_validated(self):
        self.seed();e=self.create('event',title='Bolo',start='2026-11-07')
        self.assertNotIn('inventoryIds',e)
        selected=self.store.update(e['id'],dict(e,inventoryIds=[self.objects()[0]['id']]),'tester',e['version'])
        self.assertEqual(len(selected['inventoryIds']),1)
        with self.assertRaises(world.Problem):self.create('event',title='Bolo',start='2026-11-07',inventoryIds=['missing'])

    def pdf_text(self,data):
        from pypdf import PdfReader
        raw=generate(self.store,data,ADMIN)
        self.assertTrue(raw.startswith(b'%PDF-'))
        reader=PdfReader(io.BytesIO(raw));self.assertTrue(all(p.images for p in reader.pages))
        return '\n'.join(p.extract_text() for p in reader.pages),reader

    def test_pdf_selection_groups_teams_embeds_logo_and_never_fetches_urls(self):
        self.seed();objects=self.objects();chosen=[o for o in objects if o['title']=='Gorra']
        with patch('urllib.request.urlopen',side_effect=AssertionError('No network')):
            text,reader=self.pdf_text({'kind':'inventory','ids':[o['id'] for o in chosen]})
        self.assertEqual(len(reader.pages),2)
        self.assertIn('EQUIPO AZUL',text);self.assertIn('EQUIPO ROJO',text);self.assertNotIn('Linternas',text)
        self.assertIn('Imagen de catálogo orientativa',text);self.assertIn('PRODUCCIÓN',text)

    def test_pdf_long_notes_flow_and_titles_are_escaped(self):
        o=self.create('inventory',title='Caja <b>original</b> & utilería',team='red',description=('Una nota extensa de utilería.\n'*400))
        text,reader=self.pdf_text({'kind':'inventory','ids':[o['id']],'photos':False})
        self.assertIn('<b>original</b>',text);self.assertGreater(len(reader.pages),5)
        self.assertEqual(text.count('Una nota extensa'),400)

    def test_pdf_dark_pages_logo_watermark_icons_links_and_number_only_pagination(self):
        from pypdf.generic import ContentStream
        self.seed();_,reader=self.pdf_text({'kind':'inventory','ids':[o['id'] for o in self.objects()]})
        for number,page in enumerate(reader.pages,1):
            text=page.extract_text()
            self.assertNotIn('Página ',text)
            self.assertIn('scribaleatorio@gmail.com',text)
            links=[a.get_object().get('/A',{}).get('/URI') for a in page.get('/Annots',[])]
            self.assertEqual(set(links),{'https://www.instagram.com/scrib_show/',
                'https://www.instagram.com/su.tu.ra/','https://scribshow.es/','mailto:scribaleatorio@gmail.com'})
            alpha=page['/Resources']['/ExtGState']
            self.assertTrue(any(abs(float(s.get('/ca',1))-.055)<.0001 for s in alpha.values()))
            ops=ContentStream(page.get_contents(),reader).operations
            # Opaque black full-page paint, and the same logo XObject used both
            # as the large watermark and in the header, not text masquerading as a logo.
            self.assertTrue(any(op==b're' and len(args)==4 and args[:2]==[0,0]
                and abs(float(args[2])-float(page.mediabox.width))<.01
                and abs(float(args[3])-float(page.mediabox.height))<.01 for args,op in ops))
            self.assertTrue(any(op==b'rg' and all(abs(float(v)-5/255)<.0001 for v in args) for args,op in ops))
            images=[str(args[0]) for args,op in ops if op==b'Do']
            self.assertTrue(any(images.count(name)==2 for name in images))
            footer=[]
            page.extract_text(visitor_text=lambda value,cm,tm,*_:footer.append(value.strip())
                if cm[4]+tm[4]>500 and 20<cm[5]+tm[5]<40 and value.strip() else None)
            self.assertEqual(footer,[str(number)])

    def test_inventory_and_technical_checklist_use_two_columns_without_ascii_checkboxes(self):
        self.seed();objects=[o for o in self.objects() if o['team']=='blue']
        _,reader=self.pdf_text({'kind':'inventory','ids':[o['id'] for o in objects]})
        chosen=sorted(objects,key=lambda o:o['title'].casefold())
        positions={}
        def capture(value,cm,tm,*_):
            if value.strip() in [o['title'] for o in chosen]:
                positions[value.strip()]=(cm[4]+tm[4],cm[5]+tm[5])
        reader.pages[0].extract_text(visitor_text=capture)
        left,right=positions[chosen[0]['title']],positions[chosen[1]['title']]
        self.assertLess(left[0],right[0]-200);self.assertAlmostEqual(left[1],right[1],places=3)
        from lighting import default_plan
        plan=default_plan();plan['checklist'][0]['done']=True
        text,reader=self.pdf_text({'kind':'lighting','plan':plan})
        self.assertNotIn('[ ]',text);self.assertNotIn('[OK]',text)
        self.assertIn('Completado',text);self.assertIn('Por comprobar',text)
        checks=[c for c in plan['checklist'] if c['category']==plan['checklist'][0]['category']][:2];positions={}
        for page in reader.pages:
            def capture_check(value,cm,tm,*_):
                for check in checks:
                    if value.startswith(check['text'][:25]):
                        positions[check['id']]=(cm[4]+tm[4],cm[5]+tm[5])
            page.extract_text(visitor_text=capture_check)
        left,right=positions[checks[0]['id']],positions[checks[1]['id']]
        self.assertLess(left[0],right[0]-200);self.assertAlmostEqual(left[1],right[1],places=3)

    def test_pdf_invalid_selection_stale_objects_financial_authorization_and_private_paths(self):
        for data in ({'kind':'other'},{'kind':'inventory','ids':[]},{'kind':'inventory','ids':['missing']}):
            with self.assertRaises(world.Problem):generate(self.store,data,ADMIN)
        for kind in ('invoice','agreement'):
            with self.assertRaises(world.Problem) as error:generate(self.store,{'kind':kind,'id':'missing'},{'role':'user'})
            self.assertEqual(error.exception.status,403)
        o=self.create('inventory',title='Caja',team='blue');self.store.archive(o['id'],True,'tester',o['version'])
        with self.assertRaises(world.Problem) as error:generate(self.store,{'kind':'inventory','ids':[o['id']]},ADMIN)
        self.assertEqual(error.exception.status,409)

    def test_event_and_lighting_pdf_keep_saved_data_and_do_not_save_draft(self):
        self.seed();e=self.create('event',title='León',start='2026-11-07T19:00',venue='Teatro')
        text,_=self.pdf_text({'kind':'event','id':e['id']});self.assertIn('HOJA DE LLAMADA',text);self.assertIn('Linternas',text)
        from lighting import default_plan
        plan=default_plan();plan['elements'][0]['label']='Calle personalizada';text,reader=self.pdf_text({'kind':'lighting','plan':plan})
        self.assertIn('Calle personalizada',text)
        for page in reader.pages:
            self.assertNotIn(page.extract_text().strip().splitlines()[-1],
                ['Leyenda del plano','Conexiones y cableado','Checklist de montaje técnico'])
        with self.store.connect() as db:self.assertEqual(self.store.all(db,'lighting'),[])

    def test_report_pdf_preserves_line_breaks_metrics_scores_and_muse_ranking(self):
        e=self.create('event',title='Función de prueba',start='2026-11-07')
        report={'version':1,'id':'pdf-report-test','bolo':{'id':e['id'],'title':e['title']},'startedAt':1794050000000,'endedAt':1794051000000,
                'writers':{'1':{'name':'Escritora azul','text':'Primera línea\nSegunda línea'},'2':{'name':'Escritora roja','text':'Otra historia'}},
                'stats':{'players':{'1':{'palabrasTotal':100,'palabrasUnicas':70,'ritmoPpm':80}}},
                'score':{'disponible':True,'jugadores':{'1':{'total':84.5},'2':{'total':63}}},
                'muses':{'equipos':{'1':{'musas':[{'nombre':'Musa ficticia','stats':{'introducidas':4,'enviadas':6}}]}}}}
        self.store.business.archive_report(report)
        text,_=self.pdf_text({'kind':'report','id':report['id']})
        for content in ['Primera línea','Segunda línea','84.5 puntos','70%','Musa ficticia','4 incorporadas de 6 enviadas']:
            self.assertIn(content,text)


class PdfHttpTests(unittest.TestCase):
    setUp=fixtures.HTTPTests.setUp;tearDown=fixtures.HTTPTests.tearDown;req=fixtures.HTTPTests.req;csrf=fixtures.HTTPTests.csrf
    def test_pdf_and_export_script_require_auth_and_pdf_requires_csrf(self):
        self.assertEqual(self.req('export.js',headers={'X-Scrib-Bridge':''},raw=True)[0],401)
        self.assertEqual(self.req('export.js',raw=True)[0],200)
        self.assertEqual(self.req('api/pdf',{'kind':'lighting'},raw=True)[0],403)
        self.assertEqual(self.req('api/pdf',{'kind':'lighting'},self.csrf(),raw=True)[0],200)
        self.assertEqual(self.req('api/pdf',{'kind':'invoice'},self.csrf(),raw=True)[0],403)


if __name__=='__main__':unittest.main()
