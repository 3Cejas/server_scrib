"""Shared scenic lighting plans. Planning only: no game, DMX or power integration."""
import copy
import json
import math
from pathlib import Path

DEFAULT = json.loads((Path(__file__).parent / 'lighting_plan.json').read_text())
BLUEPRINT = {x['id']: x for x in DEFAULT['elements']}
LEGACY = {'blue-street', 'red-street', 'presenter', 'frontals', 'blue-desk', 'red-desk', 'screen'}


def default_plan():
    return copy.deepcopy(DEFAULT)


def upgrade(data):
    """Extend only the known seven-node legacy version, without writing stored edits."""
    plan = copy.deepcopy(data)
    elements = plan.get('elements', [])
    if isinstance(elements, list) and all(isinstance(e, dict) for e in elements):
        ids = [e.get('id') for e in elements]
        if len(ids) == len(LEGACY) and set(ids) == LEGACY:
            elements.extend(copy.deepcopy(e) for e in DEFAULT['elements'] if e['id'] not in LEGACY)
    for field in ('connections', 'walkies', 'checklist'):
        plan.setdefault(field, copy.deepcopy(DEFAULT[field]))
    return plan


def coordinates(element):
    zone = element.get('zone', 'stage')
    if zone == 'technical':
        return 70 + 4 * element['x'], 735 + 2.5 * element['y']
    if zone == 'actors':
        return 530 + 4 * element['x'], 735 + 2.5 * element['y']
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
    return {'notes': text(data.get('notes', ''), 5000), 'elements': [normalized[k] for k in BLUEPRINT],
            'connections': records(connections, fixed_connections), 'walkies': copy.deepcopy(DEFAULT['walkies']),
            'checklist': records(checks, {c['id']:c for c in DEFAULT['checklist']}, True)}
