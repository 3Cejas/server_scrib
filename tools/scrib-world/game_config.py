"""Validated show presets and a minimal projection for the authorised game Control.

Never export phones, private notes, images, social profiles or the whole database.
"""
import hashlib
import json
import unicodedata
from pathlib import Path

SCHEMA = json.loads((Path(__file__).parent / 'game_config_schema.json').read_text())


def normalize(value, problem):
    if value is None:
        return None
    if not isinstance(value, dict) or type(value.get('version', 1)) is not int or value.get('version', 1) != 1:
        raise problem('Configuración del videojuego no válida.')
    params = value.get('parametros', {})
    if not isinstance(params, dict) or set(params) - set(SCHEMA['parameters']):
        raise problem('Hay parámetros del videojuego no reconocidos.')
    normalized = {}
    for key, rules in SCHEMA['parameters'].items():
        number = params.get(key, rules['default'])
        if type(number) is not int or not rules['min'] <= number <= rules['max']:
            raise problem(f"{rules['label']}: indica un entero entre {rules['min']} y {rules['max']}.")
        normalized[key] = number
    if normalized['duracion_minutos'] * 60 + normalized['duracion_segundos'] == 0:
        raise problem('La partida debe durar más de cero segundos.')
    modes = value.get('modos', list(SCHEMA['modes']))
    if not isinstance(modes, list) or not modes or any(not isinstance(m, str) or m not in SCHEMA['modes'] for m in modes) or len(set(modes)) != len(modes):
        raise problem('Selecciona al menos un nivel válido, sin duplicados.')
    # The live engine uses this canonical order; store exactly the same order.
    modes = [m for m in SCHEMA['modes'] if m in modes]
    language = value.get('idioma', 'es')
    if language not in ('es', 'en', 'fr'):
        raise problem('Idioma del videojuego no válido.')
    phrases = value.get('frases_finales', {})
    if not isinstance(phrases, dict):
        raise problem('Frases finales no válidas.')
    final = {}
    for player in ('1', '2'):
        phrase = phrases.get(player, '')
        if not isinstance(phrase, str) or len(phrase.strip()) > 220:
            raise problem('Cada frase final admite hasta 220 caracteres.')
        final[player] = phrase.strip()
    return {'version': 1, 'parametros': normalized, 'modos': modes, 'idioma': language, 'frases_finales': final}


def role_key(role):
    return ''.join(c for c in unicodedata.normalize('NFD', role.lower()) if unicodedata.category(c) != 'Mn').strip()


def profile(event, people):
    cast = [{'name': people[c['personId']]['name'], 'role': c['role'], 'team': c['team']} for c in event.get('cast', []) if c['personId'] in people]
    errors, warnings, names = [], [], {}
    if any(any(ch in c['name'] for ch in '<>') or any(ord(ch) < 32 for ch in c['name']) for c in cast):
        errors.append('Revisa los nombres del elenco: no pueden contener etiquetas HTML ni caracteres de control.')
    credits = {}
    for team, player, colour in [('blue', '1', 'azul'), ('red', '2', 'rojo')]:
        writers = [c['name'].upper() for c in cast if c['team'] == team and role_key(c['role']).startswith(('escrit', 'writer'))]
        if len(writers) != 1:
            errors.append(f'Asigna exactamente una persona de Escritura al equipo {colour}.')
        elif len(writers[0]) > 80:
            errors.append(f'El nombre de la escritora del equipo {colour} supera los 80 caracteres.')
        else:
            names[player] = writers[0]
        credits['escritxr_' + colour] = names.get(player, '')
        actors = list(dict.fromkeys(c['name'].upper() for c in cast if c['team'] == team and role_key(c['role']).startswith(('interpret', 'actor', 'actriz'))))
        if not actors:
            warnings.append(f'No hay intérpretes asignados al equipo {colour}.')
        credits['interprete_' + colour + '_1'] = actors[0] if actors else ''
        credits['interprete_' + colour + '_2'] = ' / '.join(actors[1:])
    for key, prefixes in [('dramaturgia', ('dramaturg',)), ('programacion', ('programa',)), ('iluminacion', ('ilumina',)), ('musica', ('musica',)), ('voz_off', ('voz', 'narracion'))]:
        assigned = list(dict.fromkeys(c['name'].upper() for c in cast if role_key(c['role']).startswith(prefixes)))
        # Do not erase permanent technical credits if the show has no assignment.
        if assigned:
            credits[key] = ' / '.join(assigned)
    if any(len(v) > 80 for v in credits.values()):
        errors.append('Algún crédito supera los 80 caracteres. Revisa los nombres del elenco.')
    if any(role_key(c['role']).startswith(('escrit', 'interpret', 'actor', 'actriz')) and c['team'] == 'general' for c in cast):
        warnings.append('Hay escritura o interpretación sin equipo: no se asignará automáticamente a azul o rojo.')
    config = event.get('gameConfig')
    if not config:
        errors.insert(0, 'Guarda los parámetros del videojuego en la ficha de este bolo.')
    result = {k: event.get(k, '') for k in ('id', 'title', 'start', 'venue', 'city', 'status')}
    result.update(config=config, elenco=cast, nombres=names, creditos=credits, errors=errors, warnings=warnings, ready=not errors)
    result['revision'] = hashlib.sha256(json.dumps(result, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return result
