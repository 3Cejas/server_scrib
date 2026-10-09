import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from game_config import normalize, SCHEMA

spec = importlib.util.spec_from_file_location('world', Path(__file__).parent / 'server.py')
world = importlib.util.module_from_spec(spec)
spec.loader.exec_module(world)


class GameConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.store.identify('ensayo', 'Ensayo')

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, kind, **data):
        return self.store.create(kind, data, 'ensayo', str(uuid.uuid4()))

    def event(self, **extra):
        a = self.create('person', name='Ángela Azul', phone='+34900000001', phoneConfirmed=True, bio='Nota privada', instagram='https://instagram.com/privado')
        b = self.create('person', name='Rosa Roja')
        actor = self.create('person', name='Elena Intérprete')
        return self.create('event', title='Bolo de prueba', start='2026-11-07', cast=[{'personId': a['id'], 'role': 'Escritura', 'team': 'blue'}, {'personId': b['id'], 'role': 'Escritora', 'team': 'red'}, {'personId': actor['id'], 'role': 'Interpretación', 'team': 'blue'}], **extra)

    def test_config_defaults_and_custom_values_persist_without_mutating_tasks(self):
        event = self.event(gameConfig={'parametros': {'duracion_minutos': 42, 'limite_tiempo_inspiracion': 15}, 'idioma': 'fr'})
        self.assertEqual(event['gameConfig']['parametros']['duracion_minutos'], 42)
        self.assertEqual(event['gameConfig']['parametros']['tiempo_votacion'], 30)
        self.assertEqual(len(event['gameConfig']['modos']), 6)
        edited = self.store.update(event['id'], dict(event, gameConfig={'parametros': {'duracion_minutos': 25}}), 'ensayo', event['version'])
        self.assertEqual(edited['gameConfig']['parametros']['duracion_minutos'], 25)
        self.assertEqual(len([i for i in self.store.snapshot()['items'] if i['kind'] == 'ticket']), 0)

    def test_older_clients_preserve_config_and_explicit_null_removes_it(self):
        event = self.event(gameConfig={})
        data = dict(event, title='Renombrado')
        data.pop('gameConfig')
        updated = self.store.update(event['id'], data, 'ensayo', event['version'])
        self.assertEqual(updated['gameConfig'], event['gameConfig'])
        cleared = self.store.update(event['id'], dict(updated, gameConfig=None), 'ensayo', updated['version'])
        self.assertIsNone(cleared['gameConfig'])

    def test_invalid_params_modes_phrases_and_languages_rejected(self):
        for config in [False, {'version': True}, {'parametros': {'limite_tiempo_inspiracion': 0}}, {'parametros': {'duracion_minutos': True}}, {'parametros': {'duracion_minutos': 0, 'duracion_segundos': 0}}, {'parametros': {'other': 5}}, {'parametros': {'escala_espectador': 100.5}}, {'modos': []}, {'modos': ['tertulia', 'tertulia']}, {'modos': ['no existe']}, {'modos': [{}]}, {'idioma': 'xx'}, {'frases_finales': {'1': 'a' * 221}}]:
            with self.subTest(config=config), self.assertRaises(world.Problem):
                normalize(config, world.Problem)

    def test_modes_match_canonical_live_order_and_new_events_have_no_fake_config(self):
        self.assertEqual(normalize({'modos': ['frase final', 'letra bendita']}, world.Problem)['modos'], ['letra bendita', 'frase final'])
        event = self.event()
        self.assertIsNone(event['gameConfig'])
        profile = self.store.game_configurations()['bolos'][0]
        self.assertFalse(profile['ready'])
        self.assertIn('Guarda los parámetros', profile['errors'][0])

    def test_minimal_projection_correct_teams_credits_and_no_private_contacts(self):
        self.event(gameConfig={})
        profile = self.store.game_configurations()['bolos'][0]
        self.assertTrue(profile['ready'])
        self.assertEqual(profile['nombres'], {'1': 'ÁNGELA AZUL', '2': 'ROSA ROJA'})
        self.assertEqual(profile['creditos']['escritxr_azul'], 'ÁNGELA AZUL')
        self.assertEqual(profile['creditos']['escritxr_rojo'], 'ROSA ROJA')
        self.assertEqual(profile['creditos']['interprete_azul_1'], 'ELENA INTÉRPRETE')
        self.assertEqual(profile['creditos']['interprete_rojo_1'], '')
        serialized = json.dumps(profile)
        for private in ['900000001', 'Nota privada', 'privado', '"phone"', '"bio"', '"instagram"', '"createdBy"']:
            self.assertNotIn(private, serialized)

    def test_cast_rename_invalidates_preview_revision(self):
        event = self.event(gameConfig={})
        before = self.store.game_configurations()['bolos'][0]
        person = self.store.details(event['cast'][0]['personId'])['item']
        self.store.update(person['id'], dict(person, name='Ángela Nueva'), 'ensayo', person['version'])
        after = self.store.game_configurations()['bolos'][0]
        self.assertNotEqual(before['revision'], after['revision'])
        self.assertEqual(self.store.details(event['id'])['item']['version'], event['version'])

    def test_archived_cancelled_and_rehearsal_events_not_importable(self):
        event = self.event(gameConfig={})
        self.store.archive(event['id'], True, 'ensayo', event['version'])
        self.event(gameConfig={}, status='cancelled')
        self.event(gameConfig={}, eventType='rehearsal')
        self.assertEqual(self.store.game_configurations()['bolos'], [])

    def test_ambiguous_writers_or_html_names_block_import(self):
        event = self.event(gameConfig={})
        person = self.create('person', name='Otra Azul')
        updated = self.store.update(event['id'], dict(event, cast=event['cast'] + [{'personId': person['id'], 'role': 'Escritura', 'team': 'blue'}]), 'ensayo', event['version'])
        self.assertFalse(self.store.game_configurations()['bolos'][0]['ready'])
        original = self.store.details(event['cast'][0]['personId'])['item']
        self.store.update(original['id'], dict(original, name='<img onerror=alert(1)>'), 'ensayo', original['version'])
        self.store.update(event['id'], dict(updated, cast=event['cast']), 'ensayo', updated['version'])
        self.assertFalse(self.store.game_configurations()['bolos'][0]['ready'])

    def test_game_api_and_script_still_require_private_bridge_identity(self):
        self.event(gameConfig={})
        app = world.App(0, self.store, secret='test-secret')
        thread = threading.Thread(target=app.serve_forever, daemon=True)
        thread.start()
        try:
            for route in ['api/game-configurations', 'game-config.js']:
                client = http.client.HTTPConnection('127.0.0.1', app.server_port)
                client.request('GET', world.PREFIX + route)
                response = client.getresponse()
                self.assertEqual(response.status, 401)
                response.read(); client.close()
            client = http.client.HTTPConnection('127.0.0.1', app.server_port)
            client.request('GET', world.PREFIX + 'api/game-configurations', headers={'X-Scrib-Bridge': 'test-secret', 'X-Scrib-User': 'videojuego-control'})
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertTrue(json.loads(response.read())['bolos'][0]['ready'])
            client.close()
        finally:
            app.shutdown(); app.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
