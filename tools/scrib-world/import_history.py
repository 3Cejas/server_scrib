"""Import published past shows and confirmed social links; never send messages.

Only exact, unambiguous existing cast names are linked. Other published names
remain in the show notes, without inventing identities or creating profiles.
"""
import argparse
import json
import re
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from import_cast import norm, schedule_literal
from participations import show_key, show_digest
from server import Store, Problem


def published_day(value):
    months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
    parts = re.fullmatch(r'(\d+) de (\w+) de (\d{4})', value)
    if not parts or parts[2] not in months:
        raise ValueError('Fecha pública no válida')
    return datetime(int(parts[3]), months.index(parts[2]) + 1, int(parts[1])).date().isoformat()


def published_cast(event):
    result = []
    def add(names, role, team='general'):
        for name in (n.strip() for n in names.split('·')):
            entry = dict(name=name, role=role, team=team)
            if name and entry not in result:
                result.append(entry)
    for team in event.get('teams', []):
        add(team.get('writer', ''), 'Escritura', team.get('color', 'general'))
        add(team.get('performers', ''), 'Interpretación', team.get('color', 'general'))
    add(event.get('writers', ''), 'Escritura')
    add(event.get('performers', ''), 'Interpretación')
    add(event.get('participants', ''), 'Participación · papel no publicado')
    return result


def import_history(store, sections, instagram=None, apply=False, today=None):
    today = today or datetime.now(ZoneInfo('Europe/Madrid')).date().isoformat()
    report = {'events': [], 'instagram': []}
    with store.transaction() as db:
        people = store.all(db, 'person')
        events = store.all(db, 'event')
        for section in sections:
            for event in section['events']:
                day = published_day(event['date'])
                if day >= today:
                    continue
                title, venue = event.get('name', '<SCRI> B'), event.get('venue', '')
                key = show_key(day, title, venue)
                digest = show_digest(key)
                prior = [e for e in events if e.get('historyKey') == digest or show_key(e['start'], e['title'], e['venue']) == key]
                if len(prior) > 1:
                    raise Problem('Dos bolos coinciden; revisar antes de importar: ' + day)
                cast, notes = [], []
                for c in published_cast(event):
                    matches = [p for p in people if norm(p['name']) == norm(c['name']) or (p.get('publicName') and norm(p['publicName']) == norm(c['name']))]
                    if len(matches) > 1:
                        raise Problem('Nombre ambiguo en las fichas: ' + c['name'])
                    if matches and not matches[0]['archived']:
                        cast.append(dict(personId=matches[0]['id'], role=c['role'], team=c['team']))
                    notes.append(c['name'] + ' · ' + c['role'] + ((' · Equipo rojo' if c['team'] == 'red' else ' · Equipo azul') if c['team'] != 'general' else ''))
                time = event.get('time', '').strip()
                clock = re.fullmatch(r'(\d{2}:\d{2})(?:\s*hrs?\.?)?', time)
                if time and not clock:
                    raise ValueError('Horario público no válido: ' + time)
                address = event.get('address', '')
                city = next((c for c in ('Leganés', 'Barcelona', 'Cusco', 'Lima', 'Madrid') if c.casefold() in (venue + ' ' + address).casefold()), '')
                description = '\n\n'.join(filter(None, [event.get('support', ''), 'Elenco:\n' + '\n'.join(notes) if notes else '', 'Elenco completo pendiente de documentar.' if event.get('castPending') else '']))
                body = dict(title=title, start=day + 'T' + clock[1] if clock else day, venue=venue, city=city, address=address, status='completed', description=description, cast=cast)
                record = dict(date=day, title=title, venue=venue, linked=len(cast), existing=bool(prior))
                report['events'].append(record)
                if prior:
                    record['id'] = prior[0]['id']
                    continue  # Preserve manual edits, archived state, cast and board progress.
                if apply:
                    body = store.validate(db, 'event', body)
                    board_id = str(uuid.uuid4())
                    body.update(boardId=board_id, historical=True, historyKey=digest)
                    saved = store.insert(db, 'event', body, 'historial-scrib')
                    store.insert(db, 'board', dict(title=title, description='Bolo realizado · ' + venue, color='gold', eventId=saved['id']), 'historial-scrib', board_id)
                    events.append(saved)
                    record['id'] = saved['id']
        for name, entry in (instagram or {}).items():
            url = entry.get('url', '')
            if not entry.get('evidence') or not re.fullmatch(r'https://(?:www\.)?instagram\.com/[A-Za-z0-9_.]{1,30}/?', url):
                raise ValueError('Instagram sin comprobación o enlace no válido: ' + name)
            matches = [p for p in people if norm(p['name']) == norm(name)]
            if len(matches) != 1 or matches[0]['archived']:
                raise Problem('No hay una única ficha activa para el Instagram: ' + name)
            person = matches[0]
            report['instagram'].append(dict(name=person['name'], keptExisting=bool(person.get('instagram'))))
            if apply and not person.get('instagram'):
                changes = store.validate(db, 'person', dict(person, instagram=url), person)
                store.save(db, person, changes, 'historial-scrib', 'Instagram añadido')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True)
    parser.add_argument('--schedule', required=True)
    parser.add_argument('--instagram', help='JSON revisado: nombre -> {url,evidence}; nunca teléfonos')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    store = Store(args.data)
    if args.apply:
        backup = store.directory / 'backups' / ('world-before-history-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8] + '.sqlite3')
        backup.parent.mkdir(mode=0o700, exist_ok=True)
        with store.connect() as source, sqlite3.connect(backup) as target:
            source.backup(target)
        backup.chmod(0o600)
    sections = schedule_literal(Path(args.schedule).read_text())
    instagram = json.loads(Path(args.instagram).read_text()) if args.instagram else {}
    print(json.dumps(import_history(store, sections, instagram, args.apply), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
