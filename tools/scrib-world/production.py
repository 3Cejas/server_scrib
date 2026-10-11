"""Shared cast readiness and inventory selection; planning never starts a game."""
TEAM_ROLES = ('Escritura', 'Interpretación')
TECHNICAL_ROLES = ('Técnica videojuego', 'Técnica luminotecnia-sonido')


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


def cast_conflict(cast, previous=()):
    """Reject new overlapping positions, retaining unchanged historical casts.

    Only the two technical positions can be combined. Existing overlaps can
    remain while editing other fields or be reduced, never expanded.
    """
    from collections import Counter, defaultdict

    def groups(rows):
        result = defaultdict(Counter)
        for row in rows:
            if row.get('personId'):
                role = normalize_role(row['role'])
                result[row['personId']][(role, row.get('team', 'general') if role in TEAM_ROLES else 'general')] += 1
        return result

    old = groups(previous)
    for person_id, positions in groups(cast).items():
        if sum(positions.values()) <= 1 or all(role in TECHNICAL_ROLES for role, _ in positions):
            continue
        if positions - old[person_id]:
            return person_id
    return None
