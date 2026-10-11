import unittest
from portal_polish import escena, login_css, OVERLAY_CSS


class PortalTests(unittest.TestCase):
    def test_theme_patch_is_scoped_idempotent_and_covers_top_edge(self):
        original='.pf-c-login__main::before { height: 6px; }\nother-theme'
        result=login_css(original)
        self.assertEqual(result,login_css(result))
        self.assertTrue(result.startswith(original))
        for rule in ['inset: 0','height: auto','width: auto','z-index: 10']:
            self.assertIn(rule,result)
        self.assertEqual(result.count(OVERLAY_CSS),1)
        with self.assertRaises(ValueError):login_css('unknown theme')
        with self.assertRaises(ValueError):login_css(result.replace('inset: 0','inset: 20px'))

    def test_remove_only_scrib_shortcuts_from_escena_preserving_world_and_other_tiles(self):
        source='''<a class="world--scrib" href="/scrib/">SCRIB world</a>
        <section id="escena-section"><div><a class="tile" href="/scrib/game/">Game</a>
        <a class="tile" href="/scrib-produccion/">Production</a><a href="/web/">Website</a></div></section>
        async function checkScrib() { check(); }
        async function checkScribWeb() { check(); }
        async function checkWeb() { check(); }'''
        result=escena(source)
        self.assertEqual(result,escena(result))
        self.assertNotIn('href="/scrib/game/"',result)
        self.assertNotIn('href="/scrib-produccion/"',result)
        self.assertIn('href="/scrib/"',result);self.assertIn('href="/web/"',result)
        self.assertIn('if (!scribServerStatus || !scribServerDetail) return;',result)
        self.assertIn('if (!scribWebStatus || !scribWebDetail) return;',result)
        self.assertIn('async function checkWeb() { check(); }',result)
        with self.assertRaises(ValueError):escena('<section>Unknown portal</section>')


if __name__=='__main__':unittest.main()
