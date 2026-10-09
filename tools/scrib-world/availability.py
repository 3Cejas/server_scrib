"""Availability polls. Public capabilities never grant access to the backstage."""
import hashlib
import hmac
import base64
import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

PUBLIC_PREFIX = '/scrib-disponibilidad/'
TOKEN_RE = r'[A-Za-z0-9_-]{43}'
SCHEMA = '''
CREATE TABLE IF NOT EXISTS availability_links (
 token_hash TEXT PRIMARY KEY, poll TEXT NOT NULL, person TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS availability_link_poll ON availability_links(poll);
CREATE TABLE IF NOT EXISTS availability_replies (
 id TEXT PRIMARY KEY, poll TEXT NOT NULL, person TEXT NOT NULL, name TEXT NOT NULL,
 answers TEXT NOT NULL, comment TEXT NOT NULL, edit_hash TEXT NOT NULL,
 version INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS availability_person ON availability_replies(poll,person) WHERE person<>'';
CREATE UNIQUE INDEX IF NOT EXISTS availability_editor ON availability_replies(poll,edit_hash) WHERE edit_hash<>'';
'''


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Availability:
    def __init__(self, store, problem, date_value, text, now):
        self.store, self.problem, self.date_value, self.text, self.now = store, problem, date_value, text, now
        self.rates, self.rate_lock = {}, threading.Lock()
        key_path = store.directory / 'availability-wake-key'
        try:
            with os.fdopen(os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
                f.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
        self.wake_key = key_path.read_bytes()
        if len(self.wake_key) != 32:
            raise RuntimeError('Clave de disponibilidad no válida.')

    def new_token(self):
        # Independently verifiable on the gateway while the database server sleeps.
        nonce = secrets.token_bytes(16)
        signature = hmac.new(self.wake_key, b'scrib-availability|' + nonce, hashlib.sha256).digest()[:16]
        return base64.urlsafe_b64encode(nonce + signature).decode().rstrip('=')

    def validate(self, db, data, existing=None):
        existing = existing or {}
        slots = data.get('slots', [])
        if not isinstance(slots, list) or not 1 <= len(slots) <= 30:
            raise self.problem('Añade entre 1 y 30 fechas / horarios.')
        old_slots = {s['id']: s for s in existing.get('slots', [])}
        result = []
        for slot in slots:
            if not isinstance(slot, dict):
                raise self.problem('Horario no válido.')
            ident = slot.get('id', '')
            if not isinstance(ident, str) or (ident and ident not in old_slots):
                raise self.problem('Identificador de horario no válido.')
            if any(not isinstance(slot.get(k), str) or 'T' not in slot[k] for k in ('start', 'end')):
                raise self.problem('Indica fecha y hora de inicio y fin.')
            start, end = self.date_value(slot.get('start', ''), True), self.date_value(slot.get('end', ''), True)
            if not start or not end or not 0 < (datetime.fromisoformat(end)-datetime.fromisoformat(start)).total_seconds() <= 86400:
                raise self.problem('Cada horario necesita inicio y fin, con duración máxima de 24 horas.')
            result.append(dict(id=ident or str(uuid.uuid4()), start=start, end=end))
        if len({(s['start'], s['end']) for s in result}) != len(result) or len({s['id'] for s in result}) != len(result):
            raise self.problem('Hay horarios duplicados.')
        replied = existing and db.execute('SELECT 1 FROM availability_replies WHERE poll=?', (existing['id'],)).fetchone()
        if replied and any(s not in result for s in old_slots.values()):
            raise self.problem('Hay respuestas: conserva las fechas existentes. Puedes añadir otras o crear otra encuesta.', 409)
        targets = data.get('people', [])
        if not isinstance(targets, list) or len(targets) > 100 or any(not isinstance(p, str) for p in targets) or len(set(targets)) != len(targets):
            raise self.problem('Elenco de la encuesta no válido.')
        for ident in targets:
            p = self.store.item(db, ident, 'person')
            if p['archived'] and ident not in existing.get('people', []):
                raise self.problem('Recupera la ficha antes de invitarla.')
        event_id = self.text(data.get('eventId', ''), 100)
        if event_id:
            self.store.item(db, event_id, 'event', True)
        enabled = data.get('publicEnabled', True)
        if type(enabled) is not bool or data.get('status', 'open') not in ('open', 'closed'):
            raise self.problem('Estado de la encuesta no válido.')
        invites = {p: existing.get('invites', {}).get(p) or self.new_token() for p in targets}
        return dict(title=self.text(data.get('title', ''), 240, True), description=self.text(data.get('description', ''), 3000),
                    location=self.text(data.get('location', ''), 200), eventId=event_id, people=targets, slots=result,
                    deadline=self.date_value(data.get('deadline', ''), True), status=data.get('status', 'open'), publicEnabled=enabled,
                    publicToken=existing.get('publicToken') or self.new_token(), invites=invites, confirmed=existing.get('confirmed', {}))

    def sync_links(self, db, poll):
        db.execute('DELETE FROM availability_links WHERE poll=?', (poll['id'],))
        links = [(poll['publicToken'], ''), *[(t, p) for p, t in poll['invites'].items()]]
        db.executemany('INSERT INTO availability_links VALUES(?,?,?)', [(token_hash(t), poll['id'], p) for t, p in links])

    def lookup(self, db, token):
        if not isinstance(token, str) or not re.fullmatch(TOKEN_RE, token):
            raise self.problem('Este enlace ya no está disponible.', 404)
        row = db.execute('SELECT * FROM availability_links WHERE token_hash=?', (token_hash(token),)).fetchone()
        if not row:
            raise self.problem('Este enlace ya no está disponible.', 404)
        poll = self.store.item(db, row['poll'], 'availability', True)
        if not row['person'] and not poll['publicEnabled']:
            raise self.problem('Este enlace ya no está disponible.', 404)
        person = self.store.item(db, row['person'], 'person') if row['person'] else None
        return poll, person

    def is_open(self, poll):
        return poll['status'] == 'open' and (not poll['deadline'] or datetime.fromisoformat(poll['deadline']) > datetime.now(ZoneInfo('Europe/Madrid')))

    def own_reply(self, db, poll, person, edit):
        if person:
            return db.execute('SELECT * FROM availability_replies WHERE poll=? AND person=?', (poll['id'], person['id'])).fetchone()
        if isinstance(edit, str) and re.fullmatch(TOKEN_RE, edit):
            return db.execute('SELECT * FROM availability_replies WHERE poll=? AND person=? AND edit_hash=?', (poll['id'], '', token_hash(edit))).fetchone()
        return None

    @staticmethod
    def reply_view(row):
        return dict(id=row['id'], personId=row['person'], name=row['name'], answers=json.loads(row['answers']), comment=row['comment'], version=row['version'], updated=row['updated'])

    def public(self, token, edit=''):
        with self.store.connect() as db:
            poll, person = self.lookup(db, token)
            own = self.own_reply(db, poll, person, edit)
            mine = self.reply_view(own) if own else None
            if mine:
                mine.pop('personId')
            # Intentionally no roster, other replies, phone, Instagram, poll/event IDs or link keys.
            return dict(title=poll['title'], description=poll['description'], location=poll['location'], slots=poll['slots'],
                        deadline=poll['deadline'], open=self.is_open(poll), personal=bool(person), name=person['name'] if person else '', mine=mine)

    def submit(self, token, data):
        if not isinstance(data, dict):
            raise self.problem('Respuesta no válida.')
        with self.store.connect() as db:
            self.lookup(db, token)
        with self.rate_lock:
            stamp = time.monotonic()
            self.rates = {k: v for k, v in self.rates.items() if stamp-v[0] < 600}
            since, count = self.rates.get(token_hash(token), (stamp, 0))
            if count >= 240:
                raise self.problem('Demasiadas respuestas seguidas. Espera unos minutos.', 429)
            self.rates[token_hash(token)] = (since, count+1)
        with self.store.transaction() as db:
            poll, person = self.lookup(db, token)
            if not self.is_open(poll):
                raise self.problem('La encuesta está cerrada; ya no admite cambios.', 409)
            edit = data.get('editToken', '')
            if not person and (not isinstance(edit, str) or not re.fullmatch(TOKEN_RE, edit)):
                raise self.problem('No se pudo identificar tu respuesta. Recarga el formulario.')
            own = self.own_reply(db, poll, person, edit)
            name = person['name'] if person else self.text(data.get('name', ''), 160, True)
            comment = self.text(data.get('comment', ''), 500)
            answers = data.get('answers')
            ids = {s['id'] for s in poll['slots']}
            if not isinstance(answers, dict) or not set(answers).issubset(ids) or any(v not in ('yes','maybe','no','unknown') for v in answers.values()):
                raise self.problem('Selecciona respuestas válidas para las fechas propuestas.')
            answers = {s['id']: answers.get(s['id'], 'unknown') for s in poll['slots']}
            if all(v == 'unknown' for v in answers.values()):
                raise self.problem('Responde al menos a una fecha.')
            version = data.get('version', 0)
            if type(version) is not int:
                raise self.problem('Versión de respuesta no válida.')
            if own:
                same = name == own['name'] and comment == own['comment'] and answers == json.loads(own['answers'])
                if same:
                    return self.reply_view(own)  # A retry cannot duplicate a response.
                if version != own['version']:
                    raise self.problem('Tu respuesta cambió en otra pestaña. Recarga antes de guardarla.', 409)
                db.execute('UPDATE availability_replies SET name=?,answers=?,comment=?,version=version+1,updated=? WHERE id=?',
                           (name, json.dumps(answers), comment, self.now(), own['id']))
                ident = own['id']
            else:
                if version != 0:
                    raise self.problem('La respuesta no existe. Recarga el formulario.', 409)
                if db.execute('SELECT count(*) FROM availability_replies WHERE poll=?', (poll['id'],)).fetchone()[0] >= 500:
                    raise self.problem('La encuesta ha alcanzado su límite de respuestas.', 409)
                ident, stamp = str(uuid.uuid4()), self.now()
                db.execute('INSERT INTO availability_replies VALUES(?,?,?,?,?,?,?,?,?,?)',
                           (ident, poll['id'], person['id'] if person else '', name, json.dumps(answers), comment, '' if person else token_hash(edit), 1, stamp, stamp))
            self.store.activity(db, poll['id'], 'encuesta', 'disponibilidad recibida')
            return self.reply_view(db.execute('SELECT * FROM availability_replies WHERE id=?', (ident,)).fetchone())

    def details(self, ident):
        with self.store.connect() as db:
            poll = self.store.item(db, ident, 'availability', True)
            replies = [self.reply_view(r) for r in db.execute('SELECT * FROM availability_replies WHERE poll=? ORDER BY created,id', (ident,))]
            return dict(poll=poll, replies=replies, open=self.is_open(poll))

    def confirm(self, data, actor):
        with self.store.transaction() as db:
            poll = self.store.item(db, data.get('id'), 'availability', True)
            slot = next((s for s in poll['slots'] if s['id'] == data.get('slotId')), None)
            if not slot:
                raise self.problem('Horario no válido.')
            prior = poll['confirmed'].get(slot['id'])
            if prior:
                return self.store.item(db, prior, 'event')
            self.store.check_version(poll, data.get('version'))
            selections = data.get('responses', [])
            if not isinstance(selections, list) or not 1 <= len(selections) <= 500 or any(not isinstance(s, dict) or not isinstance(s.get('id'), str) for s in selections):
                raise self.problem('Selecciona las personas que asistirán.')
            if len({s.get('id') for s in selections}) != len(selections):
                raise self.problem('Participantes duplicados.')
            cast, names = [], []
            for selected in selections:
                row = db.execute('SELECT * FROM availability_replies WHERE id=? AND poll=?', (selected.get('id'), poll['id'])).fetchone()
                if not row or type(selected.get('version')) is not int or selected['version'] != row['version'] or json.loads(row['answers']).get(slot['id']) not in ('yes','maybe'):
                    raise self.problem('Una disponibilidad ha cambiado. Actualiza la encuesta antes de confirmar.', 409)
                names.append(row['name'] + (' · Por confirmar' if json.loads(row['answers'])[slot['id']] == 'maybe' else ''))
                if row['person']:
                    cast.append(dict(personId=row['person'], role='Ensayo', team='general'))
            title = self.text(data.get('title', ('Ensayo · ' + poll['title'])[:240]), 240, True)
            description = 'Asistentes seleccionados:\n' + '\n'.join(names)
            body = self.store.validate(db, 'event', dict(title=title, description=description, start=slot['start'], end=slot['end'], venue=self.text(data.get('location', poll['location']), 200), status='confirmed', eventType='rehearsal', cast=cast))
            event_id = str(uuid.uuid4())
            body.update(boardId='', sourcePollId=poll['id'], sourceSlotId=slot['id'], parentEventId=poll['eventId'])
            event = self.store.insert(db, 'event', body, actor, event_id)
            close = data.get('close', True)
            if type(close) is not bool:
                raise self.problem('Estado de cierre no válido.')
            self.store.save(db, poll, dict(confirmed=dict(poll['confirmed'], **{slot['id']: event_id}), status='closed' if close else poll['status']), actor, 'ensayo añadido al calendario')
            return event
