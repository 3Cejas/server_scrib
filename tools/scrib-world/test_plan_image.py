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
            images=[image for image in reader.pages[0].images if image.image.size==(1000,1250)]
            self.assertEqual(len(images),1)
            self.assertEqual(images[0].image.convert('RGB').getpixel((500,500)),(12,16,27))
            text='\n'.join(p.extract_text() for p in reader.pages)
            self.assertIn('Material técnico del show',text);self.assertIn('Cables necesarios',text)
            self.assertNotIn('Circuito / canal:',text);self.assertNotIn('Conexiones y cableado',text)


if __name__=='__main__':unittest.main()
