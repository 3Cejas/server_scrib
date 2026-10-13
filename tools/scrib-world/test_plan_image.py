import base64
import io
import tempfile
import unittest
import test_world as fixtures
from lighting import default_plan,material_counts
from pdf_export import PlanImage,generate


class PlanImageTests(unittest.TestCase):
    def png(self,width=1000,height=1250):
        from PIL import Image
        image=Image.new('RGB',(width,height),'#0c101b');out=io.BytesIO();image.save(out,format='PNG')
        return base64.b64encode(out.getvalue()).decode()

    def test_material_counts_are_based_on_topology_without_double_counting_source_cables(self):
        plan=default_plan();summary=material_counts(plan)
        self.assertEqual(sum(n for _,n in summary['cables']),len(plan['connections']))
        self.assertEqual(dict(summary['cables'])['Vídeo'],5)
        self.assertEqual(dict(summary['equipment'])['Ordenadores y portátiles'],6)
        self.assertEqual(dict(summary['equipment'])['Monitores'],2)
        self.assertEqual(dict(summary['equipment'])['Walkies'],4)
        self.assertTrue(all(e['color']=='white' for e in plan['elements'] if e['type']=='monitor'))

    def test_only_bounded_pngs_are_accepted_not_paths_xml_or_other_shapes(self):
        image=PlanImage(self.png(),fixtures.world.Problem)
        self.assertEqual((image.drawWidth,image.drawHeight),(728,910))
        for bad in ['file:///etc/passwd','<svg/>','A'*3_145_729,'not a png',self.png(1000,1000),self.png(20,25),None]:
            with self.subTest(value=str(bad)[:25]),self.assertRaises(fixtures.world.Problem):
                PlanImage(bad,fixtures.world.Problem)

    def test_visible_plan_image_is_embedded_and_counts_export_without_old_circuit_fields(self):
        from pypdf import PdfReader
        with tempfile.TemporaryDirectory() as directory:
            store=fixtures.world.Store(directory)
            raw=generate(store,{'kind':'lighting','planImage':self.png()}, {'username':'ensayo','role':'admin'})
            reader=PdfReader(io.BytesIO(raw))
            images=[image for image in reader.pages[0].images if image.image.size==(1000,1250)]
            self.assertEqual(len(images),1)
            self.assertEqual(images[0].image.convert('RGB').getpixel((500,500)),(12,16,27))
            self.assertEqual(len([image for image in reader.pages[1].images if image.image.size==(1000,1250)]),0)
            self.assertIn('Leyenda del plano',reader.pages[1].extract_text())
            self.assertAlmostEqual(float(reader.pages[0].mediabox.width),841.8898,places=3)
            self.assertAlmostEqual(float(reader.pages[1].mediabox.width),595.2756,places=3)
            text='\n'.join(p.extract_text() for p in reader.pages)
            self.assertIn('Material técnico del show',text);self.assertIn('Cables necesarios',text)
            self.assertNotIn('Circuito / canal:',text);self.assertNotIn('Conexiones y cableado',text)

    def test_full_plan_preserves_inter_zone_cables_and_every_pixel_without_crops(self):
        from PIL import Image
        for height in (1250,1600):
            image=Image.new('RGB',(1500,round(height*1.5)),'#112233')
            image.paste('#ffd16e',(0,1088,1500,image.height));out=io.BytesIO();image.save(out,format='PNG')
            encoded=base64.b64encode(out.getvalue()).decode()
            full=PlanImage(encoded,fixtures.world.Problem)
            self.assertEqual(full._img.getSize(),image.size)
            self.assertEqual(full.drawHeight,910)
            self.assertEqual(full.drawWidth,910*1000/height)
            with tempfile.TemporaryDirectory() as directory:
                raw=generate(fixtures.world.Store(directory),{'kind':'lighting','planImage':encoded},{'username':'test','role':'admin'})
                from pypdf import PdfReader
                embedded=next(i.image for i in PdfReader(io.BytesIO(raw)).pages[0].images if i.image.size==image.size)
                self.assertEqual(embedded.convert('RGB').tobytes(),image.tobytes())

    def test_vector_fallback_has_one_intact_plan_and_all_cable_types(self):
        from pypdf import PdfReader
        from pypdf.generic import ContentStream
        with tempfile.TemporaryDirectory() as directory:
            raw=generate(fixtures.world.Store(directory),{'kind':'lighting'}, {'username':'ensayo','role':'admin'})
            reader=PdfReader(io.BytesIO(raw))
            plan_text=reader.pages[0].extract_text()
            self.assertNotIn('Calle azul',plan_text)
            self.assertNotIn('Calle roja',plan_text)
            self.assertIn('SALA INTÉRPRETES',plan_text)
            self.assertIn('TÉCNICA',plan_text)
            for page in reader.pages[:1]:
                ops=ContentStream(page.get_contents(),reader).operations
                transforms=[args for args,operator in ops if operator==b'cm']
                self.assertTrue(any(.54<float(args[0])<.57 and abs(float(args[0])+float(args[3]))<.0001 for args in transforms))
                for hexcolor in ('55d7ff','c9b8ff','ca93ff','ffd16e','6ce6a4'):
                    rgb=[int(hexcolor[i:i+2],16)/255 for i in (0,2,4)]
                    self.assertTrue(any(operator==b'RG' and all(abs(float(args[i])-rgb[i])<.00001 for i in range(3)) for args,operator in ops))

    def test_long_title_and_legend_notes_never_push_plan_onto_another_page_or_truncate_notes(self):
        from pypdf import PdfReader
        with tempfile.TemporaryDirectory() as directory:
            plan=default_plan();plan['elements'][0]['notes']='Montaje seguro. '*120+'FIN DE NOTAS'
            raw=generate(fixtures.world.Store(directory),{'kind':'lighting','plan':plan,'title':('Plano técnico completo para un espectáculo con escenario, técnica e intérpretes. '*2)[:160],'planImage':self.png()}, {'username':'test','role':'admin'})
            reader=PdfReader(io.BytesIO(raw))
            self.assertTrue(any(i.image.size==(1000,1250) for i in reader.pages[0].images))
            text='\n'.join(p.extract_text() for p in reader.pages)
            self.assertIn('Detalles de montaje',text);self.assertIn('FIN DE NOTAS',text)

    def test_material_pdf_includes_bolo_inventory_connectors_and_supplies_not_excluded_equipment(self):
        from pypdf import PdfReader
        import uuid
        with tempfile.TemporaryDirectory() as directory:
            store=fixtures.world.Store(directory)
            blue=store.create('inventory',dict(title='Gorra azul QA',team='blue',quantity=1,category='props'),'ensayo',str(uuid.uuid4()))
            red=store.create('inventory',dict(title='Taza roja QA',team='red',quantity=2,category='props'),'ensayo',str(uuid.uuid4()))
            event=store.create('event',dict(title='Bolo QA',start='2026-11-07T19:00',inventoryIds=[red['id']]),'ensayo',str(uuid.uuid4()))
            plan=default_plan();plan['connections'][0]['fromConnector']='Conector QA origen';plan['connections'][0]['toConnector']='Conector QA destino'
            plan['elements'][-1]['powerSupply']='Cargador LED QA'
            raw=generate(store,{'kind':'lighting','id':event['id'],'plan':plan},{'username':'ensayo','role':'admin'})
            text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(raw)).pages)
            self.assertIn('Conector QA origen',text);self.assertIn('Conector QA destino',text);self.assertIn('Cargador LED QA',text)
            self.assertIn('Taza roja QA',text);self.assertNotIn('Gorra azul QA',text);self.assertIn('Barras LED rojas',text)
            material=text.split('Material técnico del show',1)[1].split('Conectores - origen a destino',1)[0]
            self.assertNotIn('Pantalla de proyección',material);self.assertNotIn('Mesas de control',material);self.assertNotIn('Contras',material)


if __name__=='__main__':unittest.main()
