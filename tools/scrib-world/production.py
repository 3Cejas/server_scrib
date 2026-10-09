"""Shared cast readiness and inventory selection; planning never starts a game."""
TEAM_ROLES = ('Escritura', 'Interpretación')


def normalize_role(role):
    import unicodedata
    key = ''.join(c for c in unicodedata.normalize('NFD',role.casefold()) if not unicodedata.combining(c))
    if key.startswith(('escrit','writer')):
        return 'Escritura'
    if key.startswith(('interpret','actor','actriz')):
        return 'Interpretación'
    if key == 'tecnica':
        return 'Técnica videojuego'
    return role
REQUIRED = (('Escritura', 'blue'), ('Escritura', 'red'),
            ('Interpretación', 'blue'), ('Interpretación', 'red'),
            ('Presentador', 'general'), ('Jurado', 'general'),
            ('Técnica videojuego', 'general'), ('Técnica luminotecnia-sonido', 'general'))


def cast_requirements(cast):
    return [{'role': role, 'team': team,
             'complete': any(c['role'] == role and (c['team'] == team or team == 'general') for c in cast)}
            for role, team in REQUIRED]
