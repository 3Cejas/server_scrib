import copy
import unittest
import uuid

from test_bolo_cleanup import BoloCleanupTests, world
from lighting import default_plan, normalize, upgrade, PREVIOUS
from seasons import for_date, label
Problem, text = world.Problem, world.text


class DynamicTechnicalTests(BoloCleanupTests):
    def save(self,plan,version=0):
        return self.store.save_lighting(dict(plan=plan,eventId='',version=version,requestId=str(uuid.uuid4())),'admin')

    def test_v4_upgrade_removes_psu_and_keeps_coordinates_notes_and_progress(self):
        old=copy.deepcopy(PREVIOUS);old['elements'][0].update(x=33,notes='Sala adaptada');old['checklist'][0]['done']=True
        updated=upgrade(old);self.assertEqual(old['schemaVersion'],4)
        self.assertEqual(updated['schemaVersion'],5);self.assertEqual(updated['elements'][0]['x'],33)
        self.assertEqual(updated['elements'][0]['notes'],'Sala adaptada');self.assertTrue(updated['checklist'][0]['done'])
        self.assertEqual(updated['notes'],default_plan()['notes'])
        custom=copy.deepcopy(old);custom['notes']='Recorrido ajustado para esta sala'
        self.assertEqual(upgrade(custom)['notes'],custom['notes'])
        self.assertNotIn('video-psu',[e['id'] for e in updated['elements']])
        links={c['id']:c for c in updated['connections']}
        self.assertEqual(links['power-video-card']['from'],'technical-power');self.assertEqual(links['data-video']['type'],'hdmi')
        self.assertNotIn('power-video-psu',links)
        self.save(old)

    def test_custom_nodes_wiring_and_deletions_survive_save_reload_without_resurrection(self):
        plan=default_plan();plan['elements'].append(dict(id='extra-monitor',type='monitor',zone='actors',color='white',label='Monitor auxiliar',x=55,y=55,enabled=True,intensity=100,notes='',channel=''))
        plan['connections'].append(dict(id='extra-cable',**{'from':'technical-power','to':'extra-monitor'},type='power',label='Alimentación auxiliar'))
        saved=self.save(plan);self.assertEqual(saved['elements'][-1]['label'],'Monitor auxiliar')
        plan=copy.deepcopy(saved);plan['elements']=[e for e in plan['elements'] if e['id'] not in ('extra-monitor','blue-street')]
        plan['connections']=[c for c in plan['connections'] if c['to']!='extra-monitor']
        updated=self.save(plan,saved['version']);self.assertNotIn('blue-street',[e['id'] for e in upgrade(updated)['elements']])
        self.assertEqual(self.store.details(updated['id'])['item']['elements'],updated['elements'])
        empty=default_plan();empty['elements']=[];empty['connections']=[]
        self.assertEqual(normalize(empty,Problem,text)['elements'],[])

    def test_wiring_rejects_dangling_duplicate_self_links_and_unknown_types(self):
        for change in ({'to':'missing'},{'to':'video-card'},{'type':'malicious'},{'id':'bad id'}):
            plan=default_plan();plan['connections'][0].update(change)
            with self.subTest(change=change),self.assertRaises(Problem):self.save(plan)
        plan=default_plan();plan['connections'].append(dict(plan['connections'][0],id='other'))
        with self.assertRaises(Problem):self.save(plan)
        plan=default_plan();plan['elements']*=4
        with self.assertRaises(Problem):self.save(plan)
        self.assertFalse(any(i['kind']=='lighting' for i in self.store.snapshot()['items']))

    def test_multiple_manual_rehearsals_have_independent_attendees_and_are_not_shows(self):
        p=self.create('person',name='Una persona');q=self.create('person',name='Otra persona')
        bolo=self.create('event',title='Función',start='2026-11-07',cast=[dict(personId=p['id'],role='Escritura',team='blue'),dict(personId=q['id'],role='Presentador',team='general')])
        rehearsals=[]
        for day,person in [('2026-11-01',p),('2026-11-02',q)]:
            e=self.create('event',title='Ensayo',start=day,parentEventId=bolo['id'],eventType='rehearsal',ticketUrl='https://example.org/old',cast=[dict(personId=person['id'],role='Escritura',team='blue')])
            self.assertEqual(e['cast'],[dict(personId=person['id'],role='Ensayo',team='general')]);self.assertEqual(e['ticketUrl'],'');self.assertEqual(e['boardId'],'')
            rehearsals.append(e)
        self.assertNotEqual(rehearsals[0]['id'],rehearsals[1]['id']);self.assertEqual(self.store.details(bolo['id'])['item']['cast'],bolo['cast'])
        self.assertNotIn(rehearsals[0]['id'],[e['id'] for e in self.store.game_configurations()['bolos']])

    def test_season_boundaries_and_aliases(self):
        for day,expected in [('2026-09-01','26-27'),('2026-10-09','26-27'),('2027-01-01','26-27'),('2027-06-30','26-27'),('2026-08-31',''),('2027-07-01',''),('2027-09-01','27-28')]:
            self.assertEqual(for_date(day),expected)
        for value in ('26-27','2026–2027','2026 / 2027','2026-27'):
            self.assertEqual(label(value,Problem),'26-27')
        for value in ('2026','26-28','not a season'):
            with self.assertRaises(Problem):label(value,Problem)

    def test_rehearsal_keeps_existing_archived_attendees_but_cannot_add_new_ones(self):
        p=self.create('person',name='Persona convocada');q=self.create('person',name='Persona sin convocar')
        rehearsal=self.create('event',title='Ensayo',start='2026-11-01',eventType='rehearsal',cast=[dict(personId=p['id'],role='Escritura',team='blue')])
        self.store.archive(p['id'],True,'admin',p['version']);self.store.archive(q['id'],True,'admin',q['version'])
        updated=self.store.update(rehearsal['id'],dict(rehearsal,title='Ensayo actualizado'),'admin',rehearsal['version'])
        self.assertEqual(updated['cast'][0]['personId'],p['id'])
        with self.assertRaises(Problem):
            self.store.update(updated['id'],dict(updated,cast=updated['cast']+[dict(personId=q['id'],role='Ensayo',team='general')]),'admin',updated['version'])
