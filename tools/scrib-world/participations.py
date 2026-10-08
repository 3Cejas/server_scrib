"""Derive one participation per completed show, never per role or import row."""
import re
import hashlib
import json
import unicodedata
from datetime import date, datetime
from zoneinfo import ZoneInfo


def normalized(value):
    value = ''.join(c for c in unicodedata.normalize('NFD', str(value).casefold()) if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def show_key(day, title, venue):
    title = normalized(title)
    return (day[:10], 'scrib' if title in ('scrib', 'scri b') else title, normalized(venue))


def show_digest(key):
    return hashlib.sha256(json.dumps(key).encode()).hexdigest()


def past_day(value, today):
    try:
        return bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)) and date.fromisoformat(value) <= date.fromisoformat(today)
    except (ValueError, TypeError):
        return False


def with_participations(items, today=None):
    today = today or datetime.now(ZoneInfo('Europe/Madrid')).date().isoformat()
    events = [x for x in items if x['kind'] == 'event']
    represented = {show_key(e['start'], e['title'], e['venue']) for e in events}
    imported = {e.get('historyKey') for e in events if e.get('historyKey')}
    result = []
    for item in items:
        if item['kind'] != 'person':
            result.append(item)
            continue
        shows = {}
        for h in item.get('history', []):
            key = show_key(h.get('date', ''), h.get('title', 'SCRIB'), h.get('venue', ''))
            if key in represented or show_digest(key) in imported or not past_day(h.get('date', ''), today):
                continue
            row = shows.setdefault(key, dict(eventId='', date=h['date'], start=h['date'], title=h.get('title', 'SCRIB'), venue=h.get('venue', ''), city='', roles=[]))
            role = dict(role=h.get('role', 'Participación'), team=h.get('team', 'general'))
            if role not in row['roles']:
                row['roles'].append(role)
        for e in events:
            cast = [c for c in e.get('cast', []) if c['personId'] == item['id']]
            if not cast or e.get('eventType') == 'rehearsal' or e['archived'] or e['status'] != 'completed' or not past_day(e['start'][:10], today):
                continue
            roles = [dict(role=c['role'], team=c['team']) for c in cast]
            shows[e['id']] = dict(eventId=e['id'], date=e['start'][:10], start=e['start'], title=e['title'], venue=e['venue'], city=e.get('city', ''), roles=roles)
        rows = sorted(shows.values(), key=lambda x: (x['start'], x['title']), reverse=True)
        result.append(dict(item, participations=rows, participationCount=len(rows)))
    return result
