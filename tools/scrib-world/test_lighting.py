import concurrent.futures
import copy
import io
import json
import unittest
import uuid
import zipfile

from lighting import default_plan
import test_tasks as fixtures

world = fixtures.world


class LightingTests(unittest.TestCase):
    setUp = fixtures.TaskTests.setUp
    tearDown = fixtures.TaskTests.tearDown
    create = fixtures.TaskTests.create
    dispatch = fixtures.TaskTests.dispatch

    def save(self, plan=None, event_id='', version=0, token=None, actor='angela'):
        return self.store.save_lighting(dict(plan=plan or default_plan(),eventId=event_id,version=version,
                                             requestId=token or str(uuid.uuid4())), actor)

    def test_default_is_complete_with_correct_colors_and_independent_copies(self):
        plan = default_plan()
        nodes = {x['id']:x for x in plan['elements']}
        self.assertEqual(len(nodes), 7)
        self.assertEqual(nodes['blue-street']['color'], 'blue')
        self.assertEqual(nodes['red-street']['color'], 'red')
        self.assertLess(nodes['presenter']['x'], 50)
        self.assertLess(nodes['blue-desk']['x'], nodes['red-desk']['x'])
        self.assertEqual(nodes['screen']['type'], 'screen')
        self.assertEqual(nodes['frontals']['type'], 'front')
        plan['elements'][0]['label'] = 'Other'
        self.assertEqual(default_plan()['elements'][0]['label'], 'Calle azul')
        self.assertFalse(any(x['kind']=='lighting' for x in self.store.snapshot()['items']))

    def test_base_and_bolo_plans_are_independent_and_do_not_change_game_tasks(self):
        event = self.create('event', {'title':'León', 'start':'2026-11-07'})
        before = self.store.snapshot()['items']
        base = self.save()
        plan = default_plan();plan['elements'][0].update(x=20, intensity=37, channel='Circuito 3')
        plan['notes'] = 'Adaptación de sala'
        adapted = self.save(plan, event['id'])
        self.assertEqual(base['id'], 'lighting-base')
        self.assertEqual(adapted['eventId'], event['id'])
        self.assertEqual(self.store.details(base['id'])['item']['elements'][0]['intensity'], 75)
        self.assertEqual(self.store.details(adapted['id'])['item']['elements'][0]['channel'], 'Circuito 3')
        self.assertEqual([x for x in self.store.snapshot()['items'] if x['kind']!='lighting'], before)

    def test_saved_plan_survives_restart_and_zip_export(self):
        saved = self.save()
        reloaded = world.Store(self.tmp.name).details(saved['id'])['item']
        self.assertEqual(reloaded, saved)
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as backup:
            items = json.loads(backup.read('mundo-scrib.json'))['items']
        self.assertEqual(next(x for x in items if x['id']==saved['id']), saved)

    def test_save_retries_are_idempotent_and_old_edits_conflict(self):
        token = str(uuid.uuid4());plan=default_plan()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            saved=list(pool.map(lambda _:self.save(plan, token=token),range(4)))
        self.assertEqual(len({x['id'] for x in saved}),1)
        self.assertTrue(all(x['version']==1 for x in saved))
        changed=default_plan();changed['notes']='Nueva versión'
        latest=self.save(changed,version=1)
        self.assertEqual(latest['version'],2)
        for version in (0,1):
            with self.assertRaises(world.Problem) as caught:self.save(version=version)
            self.assertEqual(caught.exception.status,409)
        with self.assertRaises(world.Problem):self.save(changed,token=token)
        with self.assertRaises(world.Problem):self.save(plan,token=token,actor='otro')
        self.assertEqual(self.store.details(latest['id'])['item']['notes'],'Nueva versión')

    def test_fixed_identity_color_and_type_cannot_be_changed_by_client(self):
        plan=default_plan();plan['elements'][0].update(type='<script>',color='red injected',arbitrary='ignored')
        element=self.save(plan)['elements'][0]
        self.assertEqual(element['type'],'street');self.assertEqual(element['color'],'blue')
        self.assertNotIn('arbitrary',element)

    def test_missing_duplicate_unknown_and_invalid_elements_rejected(self):
        bad=[]
        plan=default_plan();plan['elements'].pop();bad.append(plan)
        plan=default_plan();plan['elements'][1]=copy.deepcopy(plan['elements'][0]);bad.append(plan)
        plan=default_plan();plan['elements'][0]['id']='extra';bad.append(plan)
        plan=default_plan();plan['elements'][0]=None;bad.append(plan)
        for plan in bad:
            with self.subTest(plan=plan),self.assertRaises(world.Problem):self.save(plan)

    def test_positions_intensities_flags_and_text_are_validated(self):
        for key,value in [('x',-1),('x',100),('y',None),('x',True),('y',float('nan')),('x',float('inf')),
                          ('intensity',101),('intensity',-1),('intensity',True),('intensity',20.5),
                          ('enabled','true'),('label',''),('label','a'*81),('notes','a'*2001),('channel','a'*81)]:
            with self.subTest(key=key,value=value):
                plan=default_plan();plan['elements'][0][key]=value
                with self.assertRaises(world.Problem):self.save(plan)
        for ident in ('screen','frontals'):
            plan=default_plan();next(x for x in plan['elements'] if x['id']==ident)['x']=10
            with self.assertRaises(world.Problem):self.save(plan)
        plan=default_plan();plan['elements'][0].update(x=12.345,enabled=False,intensity=0)
        saved=self.save(plan);self.assertEqual(saved['elements'][0]['x'],12.35)
        self.assertEqual(saved['elements'][0]['intensity'],0)

    def test_invalid_scope_and_versions_cannot_create_or_overwrite_plan(self):
        person=self.create('person',{'name':'Ana'})
        event=self.create('event',{'title':'Archivado','start':'2026-11-07'})
        self.store.archive(event['id'],True,'angela',event['version'])
        for scope in (person['id'],event['id'],'missing'):
            with self.assertRaises(world.Problem):self.save(event_id=scope)
        for version in (True,None,-1,'0'):
            with self.assertRaises(world.Problem):self.save(version=version)
        with self.assertRaises(world.Problem):self.save(token='short')
        with self.assertRaises(world.Problem):self.create('lighting',default_plan())
        self.assertFalse(any(x['kind']=='lighting' for x in self.store.snapshot()['items']))

    def test_new_routes_keep_authentication_and_csrf(self):
        data=dict(plan=default_plan(),eventId='',version=0,requestId=str(uuid.uuid4()))
        for route in ('lighting.js','lighting.css'):
            self.assertEqual(self.dispatch(route)[0],200)
            self.assertEqual(self.dispatch(route,**{'X-Scrib-Bridge':''})[0],401)
        for headers,status in (({'X-Scrib-Bridge':''},401),({'Origin':'https://evil.invalid'},403),({'X-CSRF-Token':''},403)):
            self.assertEqual(self.dispatch('api/lighting/save',data,**headers)[0],status)
        response=self.dispatch('api/lighting/save',data)
        self.assertEqual(response[0],200);self.assertEqual(response[1]['item']['kind'],'lighting')
        state=self.dispatch('api/state')[1]
        self.assertEqual(state['lightingDefaults'],default_plan())
        self.assertTrue(any(x['kind']=='lighting' for x in state['items']))


if __name__ == '__main__':unittest.main()
