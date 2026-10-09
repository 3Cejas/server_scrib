"""Shared scenic lighting plans. Planning only: no game, DMX or power integration."""
import copy
import json
import math
from pathlib import Path

DEFAULT = json.loads((Path(__file__).parent / 'lighting_plan.json').read_text())
BLUEPRINT = {x['id']: x for x in DEFAULT['elements']}
LEGACY = {'blue-street', 'red-street', 'presenter', 'frontals', 'blue-desk', 'red-desk', 'screen'}
V2_ADDITIONS = {'blue-monitor', 'red-monitor', 'projector', 'splitter', 'blue-smoke', 'red-smoke',
                'blue-power', 'red-power', 'game-computer', 'sound-computer', 'sound-desk',
                'technical-power', 'dmx-desk', 'actors-blue', 'actors-red', 'actors-power'}
V2 = LEGACY | V2_ADDITIONS
NEW_CONNECTIONS = {'data-video', 'data-controller', 'power-video-psu', 'power-video-card',
                   'audio-left', 'audio-right', 'power-left-speaker', 'power-right-speaker'}
NEW_CHECKS = {'video-card', 'controller', 'speakers'}
OLD_POSITIONS = {'splitter': (50, 34), 'blue-power': (14, 28), 'red-power': (86, 28),
                 'game-computer': (25, 25), 'sound-computer': (75, 25), 'sound-desk': (75, 65),
                 'technical-power': (25, 65), 'dmx-desk': (50, 90)}
OLD_NOTES = {
    'projector': 'HDMI directo desde PC principal; ajustar posición y óptica a la sala.',
    'splitter': 'Segunda salida del PC principal; señal a ambos monitores. Confirmar salidas/adaptadores y duplicado.',
    'game-computer': 'Videojuego, proyector y señal de monitores. Audio del juego a mesa de sonido.'}


def default_plan():
    return copy.deepcopy(DEFAULT)


def upgrade(data):
    """Extend exact known legacy schemas in memory; preserve custom edits and progress."""
    plan = copy.deepcopy(data)
    elements = plan.get('elements', [])
    if isinstance(elements, list) and all(isinstance(e, dict) for e in elements):
        ids = [e.get('id') for e in elements]
        if len(ids) == len(set(ids)) and set(ids) in (LEGACY, V2):
            for e in elements:
                previous = OLD_POSITIONS.get(e['id'])
                if previous and (e.get('x'), e.get('y')) == previous:
                    e.update(x=BLUEPRINT[e['id']]['x'], y=BLUEPRINT[e['id']]['y'])
                if e['id'] == 'splitter':
                    e['zone'] = 'technical'
                if e.get('notes') and e.get('notes') == OLD_NOTES.get(e['id']):
                    e['notes'] = BLUEPRINT[e['id']]['notes']
            elements.extend(copy.deepcopy(e) for e in DEFAULT['elements'] if e['id'] not in ids)
            for field, additions in (('connections', NEW_CONNECTIONS), ('checklist', NEW_CHECKS)):
                rows = plan.get(field)
                fixed = {c['id']: c for c in DEFAULT[field]}
                if isinstance(rows, list) and all(isinstance(r, dict) for r in rows):
                    keys = [r.get('id') for r in rows]
                    if len(keys) == len(set(keys)) and set(keys) == set(fixed) - additions:
                        # Keep user notes and done flags; replace only fixed topology/text.
                        plan[field] = [dict(copy.deepcopy(fixed[r['id']]),
                                            **{k:r[k] for k in ('notes', 'done') if k in r}) for r in rows]
                        plan[field].extend(copy.deepcopy(fixed[k]) for k in fixed if k in additions)
    for field in ('connections', 'walkies', 'checklist'):
        plan.setdefault(field, copy.deepcopy(DEFAULT[field]))
    plan['schemaVersion'] = DEFAULT['schemaVersion']
    return plan


def coordinates(element):
    zone = element.get('zone', 'stage')
    if zone == 'technical':
        return 70 + 4 * element['x'], 755 + 4.8 * element['y']
    if zone == 'actors':
        return 530 + 4 * element['x'], 755 + 4.8 * element['y']
    return 100 + 8 * element['x'], 100 + 5 * element['y']


def normalize(data, problem, text):
    if not isinstance(data, dict):
        raise problem('Plano no válido.')
    data = upgrade(data)
    elements = data.get('elements')
    if not isinstance(elements, list) or len(elements) != len(BLUEPRINT):
        raise problem('El plano debe conservar todos los elementos técnicos.')
    normalized = {}
    for element in elements:
        if not isinstance(element, dict) or not isinstance(element.get('id'), str):
            raise problem('Elemento no válido.')
        ident = element['id']
        if ident not in BLUEPRINT or ident in normalized:
            raise problem('Elemento desconocido o duplicado.')
        fixed = BLUEPRINT[ident]
        body = dict(fixed)
        body['label'] = text(element.get('label', fixed['label']), 80, True)
        body['notes'] = text(element.get('notes', ''), 2000)
        body['channel'] = text(element.get('channel', ''), 80)
        for axis in ('x', 'y'):
            value = element.get(axis)
            low, high = (20, 80) if axis == 'x' and fixed['type'] in ('screen', 'front') else (10, 90)
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
    if not isinstance(connections, list) or len(connections) != len(DEFAULT['connections']):
        raise problem('El plano debe conservar todas las conexiones.')
    fixed_connections = {c['id']: c for c in DEFAULT['connections']}
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
            body['notes'] = text(row.get('notes', ''), 1000)
            result[row['id']] = body
        return [result[k] for k in fixed]
    return {'schemaVersion': DEFAULT['schemaVersion'], 'notes': text(data.get('notes', ''), 5000), 'elements': [normalized[k] for k in BLUEPRINT],
            'connections': records(connections, fixed_connections), 'walkies': copy.deepcopy(DEFAULT['walkies']),
            'checklist': records(checks, {c['id']:c for c in DEFAULT['checklist']}, True)}
