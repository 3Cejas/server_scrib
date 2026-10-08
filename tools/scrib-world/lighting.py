"""Shared scenic lighting plans. Planning only: no game, DMX or power integration."""
import copy
import json
import math
from pathlib import Path

DEFAULT = json.loads((Path(__file__).parent / 'lighting_plan.json').read_text())
BLUEPRINT = {x['id']: x for x in DEFAULT['elements']}


def default_plan():
    return copy.deepcopy(DEFAULT)


def normalize(data, problem, text):
    if not isinstance(data, dict):
        raise problem('Plano no válido.')
    elements = data.get('elements')
    if not isinstance(elements, list) or len(elements) != len(BLUEPRINT):
        raise problem('El plano debe conservar las dos calles, el puntual, los frontales, las mesas y la pantalla.')
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
    return {'notes': text(data.get('notes', ''), 5000), 'elements': [normalized[k] for k in BLUEPRINT]}
