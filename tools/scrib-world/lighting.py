"""Shared scenic lighting plans. Planning only: no game, DMX or power integration."""
import copy
import json
import math
import re
from pathlib import Path

DEFAULT = json.loads((Path(__file__).parent / 'lighting_plan.json').read_text())
PREVIOUS = json.loads((Path(__file__).parent / 'lighting_legacy.json').read_text())
BLUEPRINT = {x['id']: x for x in DEFAULT['elements']}
ELEMENT_TYPES = {'street','spot','front','back','led-bar','desk','screen','monitor','projector','splitter','smoke','power','computer','console','controller','video-card','speaker','psu'}
BACKLIGHTS = {'blue-back','red-back'}
SEPARATE_FURNITURE = {'blue-writer-computer','red-writer-computer','actors-blue-desk','actors-red-desk'}
LED_BARS = {'blue-led-upper','blue-led-lower','red-led-upper','red-led-lower'}
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


def complete_v6(plan):
    """Add the new contras and missing monitor power once, preserving custom wiring."""
    elements=plan.get('elements',[])
    if not isinstance(elements,list) or not all(isinstance(e,dict) for e in elements):
        return plan
    nodes={e.get('id'):e for e in elements}
    if any(e.get('type') in ('street','spot','front','back') and e.get('zone','stage')=='stage' for e in elements):
        for e in DEFAULT['elements']:
            if len(elements)<100 and e['id'] in BACKLIGHTS and e['id'] not in nodes and not any(x.get('type')=='back' and x.get('color')==e['color'] for x in elements):
                elements.append(copy.deepcopy(e))
    connections=plan.get('connections',[])
    if isinstance(connections,list) and all(isinstance(c,dict) for c in connections):
        for c in DEFAULT['connections']:
            if c['id'] not in ('power-blue-monitor','power-red-monitor'):continue
            if nodes.get(c['to'],{}).get('type')!='monitor' or nodes.get(c['from'],{}).get('type')!='power':continue
            if any(x.get('type')=='power' and c['to'] in (x.get('from'),x.get('to')) for x in connections):continue
            if len(connections)<200 and not any(x.get('id')==c['id'] for x in connections):connections.append(copy.deepcopy(c))
    plan['schemaVersion']=DEFAULT['schemaVersion']
    return plan


def complete_v7(plan):
    """Separate furniture from PCs and route existing monitor power by side once."""
    elements=plan.get('elements',[]);connections=plan.get('connections',[])
    if not isinstance(elements,list) or not all(isinstance(e,dict) for e in elements):return plan
    if not isinstance(connections,list) or not all(isinstance(c,dict) for c in connections):return plan
    nodes={e.get('id'):e for e in elements}
    for color,x in (('blue',32),('red',68)):
        desk=nodes.get(color+'-desk');pc_id=color+'-writer-computer'
        if not desk or desk.get('type')!='desk' or (pc_id not in nodes and len(elements)>=100):continue
        if (desk.get('x'),desk.get('y'))==(x,34):desk['y']=BLUEPRINT[desk['id']]['y']
        if pc_id not in nodes:
            pc=copy.deepcopy(BLUEPRINT[pc_id]);pc.update(x=desk.get('x',x),y=max(10,desk.get('y',53)-19))
            if desk.get('zone'):pc['zone']=desk['zone']
            elements.append(pc);nodes[pc_id]=pc
        for c in connections:
            for endpoint in ('from','to'):
                if c.get(endpoint)==desk['id']:c[endpoint]=pc_id
        if desk.get('notes')==f'Mesa y portátil de la persona que escribe para el equipo {"azul" if color=="blue" else "rojo"}.':desk['notes']=BLUEPRINT[desk['id']]['notes']
    for color in ('blue','red'):
        pc=nodes.get('actors-'+color);desk_id='actors-'+color+'-desk'
        if not pc or pc.get('type') not in ('desk','computer') or (desk_id not in nodes and len(elements)>=100):continue
        pc['type']='computer'
        if desk_id not in nodes:
            desk=copy.deepcopy(BLUEPRINT[desk_id]);desk.update(x=pc.get('x',desk['x']),y=min(90,pc.get('y',30)+43))
            if pc.get('zone'):desk['zone']=pc['zone']
            elements.append(desk);nodes[desk_id]=desk
    for color in ('blue','red'):
        power=color+'-power';monitor=color+'-monitor'
        if nodes.get(power,{}).get('type')!='power' or nodes.get(monitor,{}).get('type')!='monitor':continue
        for c in connections:
            if c.get('type')!='power':continue
            for endpoint,other in (('from','to'),('to','from')):
                if c.get(other)==monitor and c.get(endpoint) in ('technical-power','blue-power','red-power'):c[endpoint]=power
    plan['schemaVersion']=DEFAULT['schemaVersion']
    return plan


def complete_v8(plan):
    """Add wireless LED bars and connector/supply descriptions without resetting edits."""
    elements=plan.get('elements',[]);connections=plan.get('connections',[])
    if not isinstance(elements,list) or not all(isinstance(e,dict) for e in elements):return plan
    if not isinstance(connections,list) or not all(isinstance(c,dict) for c in connections):return plan
    nodes={e.get('id'):e for e in elements}
    for color in ('blue','red'):
        desk=nodes.get(color+'-desk')
        if not desk:continue
        for part,offset in (('upper',-8),('lower',4)):
            ident=color+'-led-'+part
            if ident in nodes or len(elements)>=100:continue
            bar=copy.deepcopy(BLUEPRINT[ident]);bar.update(x=max(10,min(90,desk.get('x',32)+(-14 if color=='blue' else 14))),y=max(10,min(90,desk.get('y',53)+offset)))
            elements.append(bar);nodes[ident]=bar
    smoke=[e for e in elements if e.get('id') in ('blue-smoke','red-smoke') and e.get('type')=='smoke']
    if smoke:
        keep=smoke[0];retired={e['id'] for e in smoke[1:]}
        if keep.get('label') in ('Humo · azul','Humo · rojo'):keep['label']='Máquina de humo';keep['color']='white'
        notes=list(dict.fromkeys(e.get('notes','') for e in smoke if e.get('notes')))
        keep['notes']='\n'.join(notes)[:2000]
        plan['elements']=elements=[e for e in elements if e.get('id') not in retired]
        fixed=[];pairs={}
        for c in connections:
            if c.get('id') in ('dmx-red','power-red-smoke') and retired:continue
            c=copy.deepcopy(c)
            for key in ('from','to'):
                if c.get(key) in retired:c[key]=keep['id']
            if c.get('from')==c.get('to'):continue
            pair=(c.get('from'),c.get('to'),c.get('type'))
            if pair in pairs:
                if c.get('notes'):pairs[pair]['notes']='\n'.join(dict.fromkeys(filter(None,(pairs[pair].get('notes',''),c['notes']))))[:1000]
                continue
            pairs[pair]=c;fixed.append(c)
        plan['connections']=connections=fixed
    for e in elements:
        default=BLUEPRINT.get(e.get('id'),{})
        if 'powerSupply' in default:e.setdefault('powerSupply',default['powerSupply'])
    by_id={c['id']:c for c in DEFAULT['connections']}
    for c in connections:
        default=by_id.get(c.get('id'),{})
        for field in ('fromConnector','toConnector'):c.setdefault(field,default.get(field,'Por confirmar'))
        if c.get('label') in ('DMX · humo azul','Alimentación · humo azul') and default:c['label']=default['label']
    checks={c['id']:c for c in DEFAULT['checklist']}
    for check in plan.get('checklist',[]):
        if isinstance(check,dict) and check.get('id') in checks:
            for field in ('text','category'):check[field]=checks[check['id']][field]
    plan['schemaVersion']=DEFAULT['schemaVersion']
    return plan


def upgrade(data):
    """Migrate known layouts; v8 respects subsequent deliberate removals."""
    plan=copy.deepcopy(data)
    if type(plan.get('schemaVersion')) is int and plan['schemaVersion']>=8:
        return plan
    if type(plan.get('schemaVersion')) is int and plan['schemaVersion']>=7:
        return complete_v8(plan)
    if type(plan.get('schemaVersion')) is int and plan['schemaVersion']>=6:
        return complete_v8(complete_v7(plan))
    if type(plan.get('schemaVersion')) is int and plan['schemaVersion']>=5:
        return complete_v8(complete_v7(complete_v6(plan)))
    if plan.get('notes')==PREVIOUS['notes']:
        plan['notes']=DEFAULT['notes']
    elements=plan.get('elements',[])
    old_nodes={e['id']:e for e in PREVIOUS['elements']}
    if isinstance(elements,list) and all(isinstance(e,dict) and isinstance(e.get('id'),str) for e in elements):
        ids=[e['id'] for e in elements]
        prior=set(BLUEPRINT)-LED_BARS|{'red-smoke'}
        known=(LEGACY,V2,set(old_nodes),set(BLUEPRINT),prior,prior-SEPARATE_FURNITURE,prior-BACKLIGHTS-SEPARATE_FURNITURE)
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
    return complete_v8(complete_v7(complete_v6(plan)))


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
    groups=[('Ordenadores y portátiles',lambda e:e['type']=='computer'),
            ('Mesas de escritura',lambda e:e['type']=='desk' and not e.get('zone')),
            ('Mesas de intérpretes',lambda e:e['type']=='desk' and e.get('zone')=='actors'),
            ('Monitores',lambda e:e['type']=='monitor'),
            ('Proyector',lambda e:e['type']=='projector'),('Splitter HDMI',lambda e:e['type']=='splitter'),
            ('Interfaz de vídeo',lambda e:e['type']=='video-card'),('Fuente de alimentación',lambda e:e['type']=='psu'),
            ('Mando',lambda e:e['type']=='controller'),('Altavoces',lambda e:e['type']=='speaker'),
            ('Máquinas de humo',lambda e:e['type']=='smoke'),('Puntos de alimentación / regletas',lambda e:e['type']=='power'),
            ('Barras LED azules · Bluetooth',lambda e:e['type']=='led-bar' and e['color']=='blue'),
            ('Barras LED rojas · Bluetooth',lambda e:e['type']=='led-bar' and e['color']=='red')]
    equipment=[(label,sum(test(e) for e in plan['elements'])) for label,test in groups]
    equipment.append(('Walkies',len(plan['walkies'])))
    return {'cables':cables,'equipment':equipment}


def material_details(plan):
    """Physical endpoint descriptions, separated from power/cable family totals."""
    nodes={e['id']:e for e in plan['elements']};groups={}
    for c in plan['connections']:
        key=(c['type'],c.get('fromConnector') or 'Por confirmar',c.get('toConnector') or 'Por confirmar')
        row=groups.setdefault(key,dict(type=key[0],source=key[1],target=key[2],count=0,routes=[]))
        row['count']+=1;row['routes'].append(nodes[c['from']]['label']+' → '+nodes[c['to']]['label'])
    supplies=[dict(label=e['label'],detail=e['powerSupply']) for e in plan['elements'] if e.get('powerSupply')]
    return {'cables':list(groups.values()),'supplies':supplies}


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
        if 'powerSupply' in element:body['powerSupply']=text(element['powerSupply'],500)
        if kind=='led-bar':
            rotation=element.get('rotation',0)
            if type(rotation) not in (int,float) or not math.isfinite(rotation) or not -180<=rotation<=180:raise problem('Ángulo de barra LED no válido.')
            body['rotation']=round(rotation,2)
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
        row=dict(id=c['id'],**{'from':c['from'],'to':c['to']},type=c['type'],label=text(c.get('label',''),100,True),notes=text(c.get('notes',''),1000))
        for field in ('fromConnector','toConnector'):
            if field in c:row[field]=text(c[field],120)
        links.append(row)
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
