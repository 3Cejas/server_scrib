"""Shared scenic lighting plans. Planning only: no game, DMX or power integration."""
import copy
import json
import math
import re
from pathlib import Path

DEFAULT = json.loads((Path(__file__).parent / 'lighting_plan.json').read_text())
PREVIOUS = json.loads((Path(__file__).parent / 'lighting_legacy.json').read_text())
BLUEPRINT = {x['id']: x for x in DEFAULT['elements']}
ELEMENT_TYPES = {'street','spot','front','desk','screen','monitor','projector','splitter','smoke','power','computer','console','controller','video-card','speaker','psu'}
CONNECTION_TYPES = {'hdmi','data','audio','power','dmx'}
LEGACY = {'blue-street', 'red-street', 'presenter', 'frontals', 'blue-desk', 'red-desk', 'screen'}
V2_ADDITIONS = {'blue-monitor', 'red-monitor', 'projector', 'splitter', 'blue-smoke', 'red-smoke',
                'blue-power', 'red-power', 'game-computer', 'sound-computer', 'sound-desk',
                'technical-power', 'dmx-desk', 'actors-blue', 'actors-red', 'actors-power'}
V2 = LEGACY | V2_ADDITIONS
NEW_CONNECTIONS = {'data-video', 'data-controller', 'power-video-psu', 'power-video-card',
                   'audio-left', 'audio-right', 'power-left-speaker', 'power-right-speaker'}
NEW_CHECKS = {'video-card', 'controller', 'speakers'}
RETIRED_CHECKS = {'room', 'cables', 'backup', 'sound-cues', 'speakers'}
OLD_POSITIONS = {'splitter': (50, 34), 'blue-power': (14, 28), 'red-power': (86, 28),
                 'game-computer': (25, 25), 'sound-computer': (75, 25), 'sound-desk': (75, 65),
                 'technical-power': (25, 65), 'dmx-desk': (50, 90)}
OLD_NOTES = {
    'projector': 'HDMI directo desde PC principal; ajustar posición y óptica a la sala.',
    'splitter': 'Segunda salida del PC principal; señal a ambos monitores. Confirmar salidas/adaptadores y duplicado.',
    'game-computer': 'Videojuego, proyector y señal de monitores. Audio del juego a mesa de sonido.'}
V3_NOTES = {
    'game-computer':'Conectado a tarjeta de vídeo y mando. Audio del juego a mesa de sonido.',
    'technical-power':'Tomas/cargadores para los dos ordenadores, la fuente de la tarjeta de vídeo y controles; validar distribución con sala.',
    'video-card':'Conexión al PC principal y fuente propia. HDMI 1 al proyector, HDMI 2 al splitter. Validar interfaz y conectores del modelo disponible.'}


def default_plan():
    return copy.deepcopy(DEFAULT)


def upgrade(data):
    """Migrate known v1-v4 plans once; never resurrect deleted v5 elements."""
    plan=copy.deepcopy(data)
    if type(plan.get('schemaVersion')) is int and plan['schemaVersion']>=5:
        return plan
    elements=plan.get('elements',[])
    old_nodes={e['id']:e for e in PREVIOUS['elements']}
    if isinstance(elements,list) and all(isinstance(e,dict) and isinstance(e.get('id'),str) for e in elements):
        ids=[e['id'] for e in elements]
        known=(LEGACY,V2,set(old_nodes),set(BLUEPRINT))
        legacy=len(ids)==len(set(ids)) and set(ids) in known
        if legacy:
            for e in elements:
                previous=OLD_POSITIONS.get(e['id'])
                new=BLUEPRINT.get(e['id'])
                if new and set(ids) in (LEGACY,V2) and previous and (e.get('x'),e.get('y'))==previous:
                    e.update(x=new['x'],y=new['y'])
                if e['id']=='splitter':e['zone']='technical'
            elements.extend(copy.deepcopy(e) for e in DEFAULT['elements'] if e['id'] not in ids)
        plan['elements']=[e for e in elements if e['id']!='video-psu']
        for e in plan['elements']:
            new=BLUEPRINT.get(e['id']);old=old_nodes.get(e['id'])
            if not new or not old:continue
            if e.get('label')==old['label']:e['label']=new['label']
            previous_notes=(old.get('notes'),OLD_NOTES.get(e['id']),V3_NOTES.get(e['id']))
            if e.get('notes') and e['notes'] in previous_notes:e['notes']=new['notes']
    for field in ('connections','walkies','checklist'):
        plan.setdefault(field,copy.deepcopy(DEFAULT[field]))
    for field,retired,added in (('connections',{'power-game'},NEW_CONNECTIONS),
                                ('checklist',RETIRED_CHECKS,NEW_CHECKS)):
        rows=plan.get(field)
        if not isinstance(rows,list) or not all(isinstance(r,dict) and isinstance(r.get('id'),str) for r in rows):
            continue
        fixed={r['id']:r for r in DEFAULT[field]}
        previous={r['id'] for r in PREVIOUS[field]}|retired
        keys=[r['id'] for r in rows]
        known=(previous,previous-added,previous-retired,previous-retired-added,set(fixed),set(fixed)|retired,(set(fixed)|retired)-added)
        if len(keys)!=len(set(keys)) or set(keys) not in known:continue
        existing={r['id']:r for r in rows};updated=[]
        for ident,default in fixed.items():
            old=existing.get(ident,{})
            row=dict(copy.deepcopy(default),**{k:old[k] for k in ('notes','done') if k in old})
            if field=='checklist' and ident=='sound' and 'speakers' in existing:
                row['done']=old.get('done',False) and existing['speakers'].get('done',False)
                row['notes']='\n'.join(dict.fromkeys(r.get('notes','') for r in (old,existing['speakers']) if r.get('notes')))
            updated.append(row)
        plan[field]=updated
    plan['schemaVersion']=DEFAULT['schemaVersion']
    return plan


def coordinates(element):
    zone = element.get('zone', 'stage')
    if zone == 'technical':
        return 100 + 8 * element['x'], 755 + 4.8 * element['y']
    if zone == 'actors':
        return 100 + 8 * element['x'], 1290 + 2.5 * element['y']
    return 100 + 8 * element['x'], 100 + 5 * element['y']


def material_counts(plan):
    labels={'hdmi':'Vídeo','data':'Datos / USB','audio':'Audio','power':'Alimentación','dmx':'DMX'}
    cables=[(label,sum(c['type']==kind for c in plan['connections'])) for kind,label in labels.items()]
    groups=[('Ordenadores y portátiles',lambda e:e['type'] in ('computer','desk')),
            ('Mesas de escritura',lambda e:e['type']=='desk' and not e.get('zone')),
            ('Monitores',lambda e:e['type']=='monitor'),('Pantalla de proyección',lambda e:e['type']=='screen'),
            ('Proyector',lambda e:e['type']=='projector'),('Splitter HDMI',lambda e:e['type']=='splitter'),
            ('Interfaz de vídeo',lambda e:e['type']=='video-card'),('Fuente de alimentación',lambda e:e['type']=='psu'),
            ('Mando',lambda e:e['type']=='controller'),('Altavoces',lambda e:e['type']=='speaker'),
            ('Mesas de control',lambda e:e['type']=='console' and e['id']!='dmx-desk'),('Mesa DMX',lambda e:e['id']=='dmx-desk'),
            ('Máquinas de humo',lambda e:e['type']=='smoke'),('Puntos de alimentación / regletas',lambda e:e['type']=='power'),
            ('Calles de luz',lambda e:e['type']=='street'),('Puntual de presentador',lambda e:e['type']=='spot'),
            ('Grupo de frontales',lambda e:e['type']=='front')]
    equipment=[(label,sum(test(e) for e in plan['elements'])) for label,test in groups]
    equipment.append(('Walkies',len(plan['walkies'])))
    return {'cables':cables,'equipment':equipment}


def normalize(data, problem, text):
    if not isinstance(data, dict):
        raise problem('Plano no válido.')
    data = upgrade(data)
    elements = data.get('elements')
    if not isinstance(elements, list) or len(elements) > 100:
        raise problem('El plano admite hasta 100 elementos técnicos.')
    normalized = {}
    for element in elements:
        if not isinstance(element, dict) or not isinstance(element.get('id'), str):
            raise problem('Elemento no válido.')
        ident = element['id']
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',ident) or ident in normalized:
            raise problem('Identificador de elemento no válido o duplicado.')
        kind=element.get('type');zone=element.get('zone','stage');color=element.get('color')
        if not all(isinstance(v,str) for v in (kind,zone,color)) or kind not in ELEMENT_TYPES or zone not in ('stage','technical','actors') or color not in ('blue','red','warm','white'):
            raise problem('Tipo, zona o color del elemento no válido.')
        body=dict(id=ident,type=kind,color=color)
        if zone!='stage':body['zone']=zone
        body['label'] = text(element.get('label',''), 80, True)
        body['notes'] = text(element.get('notes', ''), 2000)
        body['channel'] = text(element.get('channel', ''), 80)
        for axis in ('x', 'y'):
            value = element.get(axis)
            low, high = (20, 80) if axis == 'x' and kind in ('screen', 'front') else (10, 90)
            if axis == 'x' and ident in ('blue-power', 'red-power'):
                low, high = 0, 100
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise problem('La posición está fuera del plano.')
            body[axis] = round(value, 2)
        if type(element.get('enabled')) is not bool:
            raise problem('El estado del elemento no es válido.')
        if type(element.get('intensity')) is not int or not 0 <= element['intensity'] <= 100:
            raise problem('La intensidad debe estar entre 0 y 100.')
        body['enabled'], body['intensity'] = element['enabled'], element['intensity']
        normalized[ident] = body
    connections = data.get('connections')
    if not isinstance(connections, list) or len(connections) > 200:
        raise problem('El plano admite hasta 200 conexiones.')
    links=[];link_ids=set();endpoints=set()
    for c in connections:
        if not isinstance(c,dict) or not isinstance(c.get('id'),str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',c['id']) or c['id'] in link_ids:
            raise problem('Identificador de conexión no válido o duplicado.')
        if not isinstance(c.get('from'),str) or not isinstance(c.get('to'),str) or not isinstance(c.get('type'),str) or c['from'] not in normalized or c['to'] not in normalized or c['from']==c['to'] or c.get('type') not in CONNECTION_TYPES:
            raise problem('Selecciona dos elementos distintos y un tipo de conexión válido.')
        pair=(c['from'],c['to'],c['type'])
        if pair in endpoints:raise problem('Esta conexión ya existe.')
        endpoints.add(pair);link_ids.add(c['id'])
        links.append(dict(id=c['id'],**{'from':c['from'],'to':c['to']},type=c['type'],label=text(c.get('label',''),100,True),notes=text(c.get('notes',''),1000)))
    checks = data.get('checklist')
    if not isinstance(checks, list) or len(checks) != len(DEFAULT['checklist']):
        raise problem('La checklist debe conservar todos los pasos de montaje.')
    def records(rows, fixed, checklist=False):
        result = {}
        for row in rows:
            if not isinstance(row, dict) or row.get('id') not in fixed or row['id'] in result:
                raise problem('Registro técnico desconocido o duplicado.')
            body = dict(fixed[row['id']])
            if checklist:
                if type(row.get('done')) is not bool:
                    raise problem('Estado de checklist no válido.')
                body['done'] = row['done']
            body['notes'] = text(row.get('notes', ''), 2001 if checklist else 1000)
            result[row['id']] = body
        return [result[k] for k in fixed]
    return {'schemaVersion': DEFAULT['schemaVersion'], 'notes': text(data.get('notes', ''), 5000), 'elements': list(normalized.values()),
            'connections': links, 'walkies': copy.deepcopy(DEFAULT['walkies']),
            'checklist': records(checks, {c['id']:c for c in DEFAULT['checklist']}, True)}
