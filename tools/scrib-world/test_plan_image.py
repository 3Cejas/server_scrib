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
        self.assertEqual((image.drawWidth,image.drawHeight),(428,535))
        for bad in ['file:///etc/passwd','<svg/>','A'*3_145_729,'not a png',self.png(1000,1000),self.png(20,25),None]:
            with self.subTest(value=str(bad)[:25]),self.assertRaises(fixtures.world.Problem):
                PlanImage(bad,fixtures.world.Problem)

    def test_visible_plan_image_is_embedded_and_counts_export_without_old_circuit_fields(self):
        from pypdf import PdfReader
        with tempfile.TemporaryDirectory() as directory:
            store=fixtures.world.Store(directory)
            raw=generate(store,{'kind':'lighting','planImage':self.png()}, {'username':'ensayo','role':'admin'})
            reader=PdfReader(io.BytesIO(raw))
            images=[image for image in reader.pages[0].images if image.image.size==(1000,725)]
            self.assertEqual(len(images),1)
            self.assertEqual(images[0].image.convert('RGB').getpixel((500,500)),(12,16,27))
            self.assertEqual(len([image for image in reader.pages[1].images if image.image.size==(1000,525)]),1)
            self.assertIn('Técnica y sala de intérpretes',reader.pages[1].extract_text())
            text='\n'.join(p.extract_text() for p in reader.pages)
            self.assertIn('Material técnico del show',text);self.assertIn('Cables necesarios',text)
            self.assertNotIn('Circuito / canal:',text);self.assertNotIn('Conexiones y cableado',text)

    def test_detailed_pages_are_full_width_and_reassemble_the_entire_original_without_overlap_or_gaps(self):
        from PIL import Image
        for height in (1250,1600):
            image=Image.new('RGB',(1500,round(height*1.5)),'#112233')
            image.paste('#ffd16e',(0,1088,1500,image.height));out=io.BytesIO();image.save(out,format='PNG')
            encoded=base64.b64encode(out.getvalue()).decode()
            stage=PlanImage(encoded,fixtures.world.Problem,'stage');backstage=PlanImage(encoded,fixtures.world.Problem,'backstage')
            self.assertEqual(stage.drawWidth,511);self.assertEqual(backstage.drawWidth,511)
            self.assertEqual(stage._img.getSize(),(1500,1088));self.assertEqual(backstage._img.getSize(),(1500,image.height-1088))
            self.assertLessEqual(stage.drawHeight,535);self.assertLessEqual(backstage.drawHeight,535)
            with self.assertRaises(fixtures.world.Problem):PlanImage(encoded,fixtures.world.Problem,'invalid')

    def test_vector_fallback_uses_uniform_geometry_on_both_pages_and_exports_all_cable_types(self):
        from pypdf import PdfReader
        from pypdf.generic import ContentStream
        with tempfile.TemporaryDirectory() as directory:
            raw=generate(fixtures.world.Store(directory),{'kind':'lighting'}, {'username':'ensayo','role':'admin'})
            reader=PdfReader(io.BytesIO(raw))
            plan_text='\n'.join(page.extract_text() for page in reader.pages[:2])
            self.assertNotIn('Calle azul',plan_text)
            self.assertNotIn('Calle roja',plan_text)
            for page in reader.pages[:2]:
                ops=ContentStream(page.get_contents(),reader).operations
                transforms=[args for args,operator in ops if operator==b'cm']
                self.assertTrue(any(abs(float(args[0])-.511)<.0001 and abs(float(args[3])+.511)<.0001 for args in transforms))
                for hexcolor in ('55d7ff','c9b8ff','ca93ff','ffd16e','6ce6a4'):
                    rgb=[int(hexcolor[i:i+2],16)/255 for i in (0,2,4)]
                    self.assertTrue(any(operator==b'RG' and all(abs(float(args[i])-rgb[i])<.00001 for i in range(3)) for args,operator in ops))


if __name__=='__main__':unittest.main()
