"""Apply the requested David Viñas presenter role once, preserving his profile.

Only an unambiguous, exact full-name match is eligible. The receipt lives in the
normal SQLite backup; subsequent manual role changes are never undone at startup.
"""
import argparse
import hashlib
import json
import unicodedata
from datetime import datetime, timezone

TOKEN = 'requested_presenter_david_vinas_20261009_v1'
ACTOR = 'rol-solicitado'
NAME = 'David Viñas'
ROLE = 'Presentador'


def name_key(value):
    # Preserve accents: "David Vinas" or a nickname is not the confirmed person.
    return ' '.join(unicodedata.normalize('NFC', value).casefold().split())


def apply_presenter_assignment(store, apply=True):
    with store.transaction() as db:
        if db.execute('SELECT 1 FROM requests WHERE token=?', (TOKEN,)).fetchone():
            return {'status': 'alreadyApplied', 'changed': False}
        people = [p for p in store.all(db, 'person')
                  if name_key(p['name']) == name_key(NAME)]
        if len(people) != 1:
            return {'status': 'missing' if not people else 'ambiguous', 'changed': False}
        person = people[0]
        if person['archived']:
            return {'status': 'archived', 'changed': False}
        roles = list(person.get('roles', []))
        already = any(r.casefold() == ROLE.casefold() for r in roles)
        result = {'status': 'alreadyAssigned' if already else 'assigned',
                  'changed': not already, 'personId': person['id']}
        if not apply:
            return dict(result, dryRun=True)
        if not already:
            store.save(db, person, {'roles': roles + [ROLE]}, ACTOR,
                       'rol de presentador añadido por solicitud')
        digest = hashlib.sha256(json.dumps({'name': NAME, 'role': ROLE},
                                          sort_keys=True).encode()).hexdigest()
        stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?)',
                   (TOKEN, ACTOR, digest, json.dumps(result), stamp))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True)
    parser.add_argument('--apply', action='store_true',
                        help='Apply; otherwise preview without changing profiles')
    args = parser.parse_args()
    from server import Store
    print(json.dumps(apply_presenter_assignment(Store(args.data), args.apply),
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
