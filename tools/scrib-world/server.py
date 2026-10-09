#!/usr/bin/env python3
"""SCRIB backstage: SQLite, Authentik bridge and optional isolated PDF renderer."""
import argparse
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo
from whatsapp import Bridge, WhatsappProblem, phone_number, personalize
from participations import with_participations
from availability import Availability, SCHEMA as AVAILABILITY_SCHEMA, PUBLIC_PREFIX, TOKEN_RE
from game_config import normalize as normalize_game_config, profile as game_profile, SCHEMA as GAME_CONFIG_SCHEMA
from business import Business, SCHEMA as BUSINESS_SCHEMA
from materials import MaterialLibrary, POLICY as MATERIAL_POLICY, PREVIEW_POLICY as MATERIAL_PREVIEW_POLICY
from inventory_seed import apply_initial_inventory
from inventory_teams import apply_team_inventory
from presenter_assignment import apply_presenter_assignment
from production import TEAM_ROLES, normalize_role
from lighting import default_plan as default_lighting, normalize as normalize_lighting
from dependencies import validate as validate_dependencies, block_dependents
from document_trace import SCHEMA as DOCUMENT_TRACE_SCHEMA

ROOT = Path(__file__).resolve().parent
WORLD_ROOT = "/scrib/"
# The live game keeps /scrib/game/ and its older role/asset routes. Only the
# backstage root and this dedicated namespace go to this independent service.
PREFIX = "/scrib/backstage/"
LEGACY_PREFIX = "/mundo-scrib/"
STATUSES = ("todo", "progress", "blocked", "done")
KINDS = ("board", "ticket", "event", "person", "template", "availability", "inventory")
PERSON_COLORS = ('auto','rose','peach','amber','gold','citron','pistachio','mint','jade','turquoise','cyan','sky','azure','periwinkle','violet','lilac','orchid','fuchsia','pink','salmon','lavender','ice','seafoam','sand','clay')
PERSON_ROLES = ('Escritura','Interpretación','Presentador','Técnica','Jurado','Dramaturgia','Producción','Dirección','Música','Comunicación','Fotografía','Vídeo','Diseño','Coordinación')
MAX_BODY = 6 * 1024 * 1024
TZ = ZoneInfo("Europe/Madrid")
LOG = logging.getLogger("scrib-world")


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def text(value, limit=1000, required=False):
    if not isinstance(value, str):
        raise Problem("Se esperaba texto.")
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise Problem(f"Texto requerido o demasiado largo (máximo {limit}).")
    if "\x00" in value:
        raise Problem("Texto no válido.")
    return value


def values(value, limit=20, length=100):
    if not isinstance(value, list) or len(value) > limit:
        raise Problem("Lista demasiado larga o no válida.")
    return list(dict.fromkeys(text(x, length, True) for x in value))


def choice(value, allowed):
    if value not in allowed:
        raise Problem("Opción no válida.")
    return value


def date_value(value, with_time=False):
    value = text(value, 40)
    if not value:
        return ""
    try:
        if with_time:
            parsed = datetime.fromisoformat(value)
            if not parsed.tzinfo:
                parsed = parsed.replace(tzinfo=TZ)
            local = parsed.astimezone(TZ)
            # Reject nonexistent local times at the spring DST change.
            if local.astimezone(timezone.utc).astimezone(TZ).replace(tzinfo=None) != local.replace(tzinfo=None):
                raise ValueError()
            return local.isoformat(timespec="minutes")
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise Problem("Fecha u hora no válida. Zona horaria: Europe/Madrid.") from None


def link(value):
    value = text(value, 2000)
    if not value:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise Problem("Los enlaces deben empezar por https:// y no contener contraseñas.")
    return value


def instagram_link(value):
    value = text(value, 2000)
    if re.fullmatch(r'@?[A-Za-z0-9_.]{1,30}', value):
        return 'https://www.instagram.com/' + value.lstrip('@') + '/'
    return link(value)


def person_roles(value, existing=None):
    roles = values(value, 24)
    canonical = {role.casefold(): role for role in PERSON_ROLES}
    legacy = set((existing or {}).get('roles', []))
    if any(role.casefold() not in canonical and role not in legacy for role in roles):
        raise Problem('Selecciona los roles de la lista de etiquetas.')
    return list(dict.fromkeys(canonical.get(role.casefold(), role) for role in roles))


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class Store:
    def __init__(self, directory, users_path=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / "world.sqlite3"
        self.users_path = users_path
        self.backup_lock = threading.Lock()
        self.availability = Availability(self, Problem, date_value, text, now)
        self.business = Business(self, Problem, text, now, date_value)
        with self.connect() as db:
            db.executescript("""
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0);
              CREATE INDEX IF NOT EXISTS item_kind ON items(kind, archived);
              CREATE TABLE IF NOT EXISTS members (
                username TEXT PRIMARY KEY, name TEXT NOT NULL, last_seen TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY, ticket TEXT NOT NULL, author TEXT NOT NULL,
                body TEXT NOT NULL, created TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS comment_ticket ON comments(ticket, created);
              CREATE TABLE IF NOT EXISTS activity (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL,
                actor TEXT NOT NULL, action TEXT NOT NULL, created TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS requests (
                token TEXT PRIMARY KEY, actor TEXT NOT NULL, payload_hash TEXT NOT NULL,
                response TEXT NOT NULL, created TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS message_drafts (
                id TEXT PRIMARY KEY, actor TEXT NOT NULL, body TEXT NOT NULL,
                created TEXT NOT NULL, expires REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS message_deliveries (
                draft TEXT NOT NULL, recipient INTEGER NOT NULL, status TEXT NOT NULL,
                updated TEXT NOT NULL, PRIMARY KEY(draft,recipient));
            """)
            db.executescript(AVAILABILITY_SCHEMA)
            db.executescript(BUSINESS_SCHEMA)
            db.executescript(DOCUMENT_TRACE_SCHEMA)
            if not db.execute("SELECT 1 FROM items WHERE kind='template'").fetchone():
                tasks = json.loads((ROOT / "default_tasks.json").read_text())
                self.insert(db, "template", {"title": "Preparación de un bolo", "tasks": tasks}, "sistema", "default-template")
                self.insert(db, "board", {"title": "Dramaturgia", "description": "Ideas, escritura, ensayos y decisiones creativas.", "eventId": "", "color": "violet"}, "sistema", "dramaturgia")
        os.chmod(self.path, 0o600)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=10000")
        return db

    @contextmanager
    def transaction(self):
        self.backup_if_due()
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def backup_if_due(self):
        with self.backup_lock:
            backups = self.directory / "backups"
            backups.mkdir(mode=0o700, exist_ok=True)
            dest = backups / f"world-{datetime.now(TZ).date()}.sqlite3"
            if not dest.exists():
                temp = dest.with_suffix(".tmp")
                with self.connect() as source, sqlite3.connect(temp, factory=ClosingConnection) as target:
                    source.backup(target)
                os.chmod(temp, 0o600)
                temp.replace(dest)

    def item(self, db, ident, kind=None, active=False):
        row = db.execute("SELECT * FROM items WHERE id=?", (ident,)).fetchone()
        if not row or (kind and row["kind"] != kind) or (active and row["archived"]):
            raise Problem("No encontrado o archivado.", 404)
        return dict(json.loads(row["body"]), id=row["id"], kind=row["kind"], version=row["version"], archived=bool(row["archived"]))

    def insert(self, db, kind, body, actor, ident=None):
        ident = ident or str(uuid.uuid4())
        stamp = now()
        body = dict(body, created=stamp, updated=stamp, createdBy=actor, updatedBy=actor)
        db.execute("INSERT INTO items(id,kind,body) VALUES(?,?,?)", (ident, kind, json.dumps(body, ensure_ascii=False)))
        self.activity(db, ident, actor, "creado")
        return self.item(db, ident)

    def activity(self, db, target, actor, action):
        db.execute("INSERT INTO activity(target,actor,action,created) VALUES(?,?,?,?)", (target, actor, action, now()))

    def check_version(self, item, expected):
        if type(expected) is not int or item["version"] != expected:
            raise Problem("Otra persona ha actualizado esta ficha. Recarga antes de guardar; tu borrador sigue abierto.", 409)

    def save(self, db, item, changes, actor, action="actualizado"):
        body = {k: v for k, v in item.items() if k not in ("id", "kind", "version", "archived")}
        body.update(changes, updated=now(), updatedBy=actor)
        db.execute("UPDATE items SET body=?,version=version+1 WHERE id=?", (json.dumps(body, ensure_ascii=False), item["id"]))
        self.activity(db, item["id"], actor, action)
        return self.item(db, item["id"])

    @staticmethod
    def board_title(value):
        if not re.search(r"\blaboratorios?\b", value, flags=re.IGNORECASE):
            return value
        value = re.sub(r"\blaboratorios?\b(?:\s+de\b)?", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s+", " ", value)
        value = re.sub(r"\s*([·|:–—-])(?:\s*[·|:–—-])+\s*", r" \1 ", value)
        return value.strip(" ·|:–—-") or "Tareas"

    def tidy_board_titles(self):
        # Only labels change: IDs, tasks, progress and links remain intact.
        with self.connect() as db:
            needed = any(self.board_title(x['title']) != x['title'] for x in self.all(db, 'board'))
        if not needed:
            return 0
        changed = 0
        with self.transaction() as db:
            for board in self.all(db, 'board'):
                title = self.board_title(board['title'])
                if title != board['title']:
                    self.save(db, board, {'title': title}, 'sistema', 'nombre del tablero simplificado')
                    changed += 1
        return changed

    def members(self, db):
        result = {r["username"]: dict(r) for r in db.execute("SELECT * FROM members")}
        # Same authorised directory as Sutura; never return password hashes or roles.
        if self.users_path:
            try:
                for u in json.loads(Path(self.users_path).read_text()):
                    if isinstance(u, dict) and u.get("username"):
                        name = u["username"]
                        result.setdefault(name, {"username": name, "name": name, "last_seen": ""})
            except (OSError, ValueError, TypeError):
                LOG.warning("No se pudo leer el directorio de Sutura")
        return sorted(result.values(), key=lambda x: x["name"].casefold())

    def identify(self, actor, name):
        with self.connect() as db:
            db.execute("INSERT INTO members VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen", (actor, name, now()))

    def validate(self, db, kind, data, existing=None):
        if kind not in KINDS or not isinstance(data, dict):
            raise Problem("Ficha no válida.")
        if kind == "availability":
            return self.availability.validate(db, data, existing)
        if kind == 'inventory':
            quantity=data.get('quantity',1)
            if quantity is not None and (type(quantity) is not int or not 0 <= quantity <= 9999):
                raise Problem('Cantidad no válida: número entero de 0 a 9999 o sin especificar.')
            body={'title':text(data.get('title',''),240,True),'description':text(data.get('description',''),15000),
                  'team':choice(data.get('team','general'),('blue','red','general')),'quantity':quantity,
                  'category':choice(data.get('category','props'),('props','costume','furniture','technical','other')),
                  'condition':choice(data.get('condition','good'),('good','repair','missing','loaned','unchecked')),
                  'location':text(data.get('location',''),1000),'custodianId':text(data.get('custodianId',''),100),
                  'eventId':text(data.get('eventId',''),100),'image':text(data.get('image',''),200)}
            body['sourceUrl'] = link(data.get('sourceUrl', (existing or {}).get('sourceUrl', '')))
            body['imageReference'] = data.get('imageReference', (existing or {}).get('imageReference', False)) is True
            for field,reference in [('custodianId','person'),('eventId','event')]:
                if body[field]:
                    linked=self.item(db,body[field],reference)
                    if linked['archived'] and body[field] != (existing or {}).get(field):
                        raise Problem('Recupera primero la ficha archivada para asociarla.')
            if body['image'] and (not re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|webp)',body['image']) or not (self.directory/'images'/body['image']).is_file()):
                raise Problem('Imagen no válida. Utiliza el botón de subir foto.')
            return body
        if kind == "person":
            body = {"name": text(data.get("name", ""), 160, True), "bio": text(data.get("bio", ""), 5000),
                    "roles": person_roles(data.get("roles", []), existing), "instagram": instagram_link(data.get("instagram", "")),
                    "website": link(data.get("website", "")), "otherSocial": link(data.get("otherSocial", "")),
                    "image": text(data.get("image", ""), 200)}
            body['color'] = choice(data.get('color',(existing or {}).get('color','auto')),PERSON_COLORS)
            body["phone"] = phone_number(data.get("phone", (existing or {}).get("phone", "")))
            # Old backups may still contain this flag. Preserve it for compatibility,
            # but it is no longer requested, set by the form, or used to gate sending.
            if existing and 'phoneConfirmed' in existing:
                body['phoneConfirmed'] = existing['phoneConfirmed']
            # Import provenance is preserved, not overwritten by a profile form.
            for key in ("sourceGroup", "sourceKey", "nameMatch", "history", "publicName"):
                if existing and key in existing:
                    body[key] = existing[key]
            if body["image"] and not re.fullmatch(r"[a-f0-9]{64}\.(png|jpg|webp)", body["image"]):
                raise Problem("Imagen no válida. Utiliza el botón de subir foto.")
            if body["image"] and not (self.directory / "images" / body["image"]).is_file():
                raise Problem("La imagen no está disponible.")
            return body
        body = {"title": text(data.get("title", ""), 240, True)}
        if kind == "board":
            body["title"] = self.board_title(body["title"])
        if kind == "template":
            tasks = data.get("tasks", [])
            if not isinstance(tasks, list) or not 1 <= len(tasks) <= 200:
                raise Problem("Una plantilla necesita entre 1 y 200 tareas.")
            body["tasks"] = [{"title": text(t.get("title", ""), 240, True), "description": text(t.get("description", ""), 10000), "labels": values(t.get("labels", []), 12, 60)} for t in tasks if isinstance(t, dict)]
            if len(body["tasks"]) != len(tasks):
                raise Problem("Tarea de plantilla no válida.")
            return body
        body["description"] = text(data.get("description", ""), 15000)
        if kind == "board":
            body["color"] = choice(data.get("color", "violet"), ("violet", "cyan", "coral", "gold"))
            body["eventId"] = existing.get("eventId", "") if existing else ""
        elif kind == "ticket":
            board = self.item(db, data.get("boardId", ""), "board", True)
            body.update(boardId=board["id"], status=choice(data.get("status", "todo"), STATUSES),
                        priority=choice(data.get("priority", "normal"), ("low", "normal", "high", "urgent")),
                        due=date_value(data.get("due", "")), labels=values(data.get("labels", []), 12, 60),
                        assignees=values(data.get("assignees", []), 30), blockedReason=text(data.get("blockedReason", ""), 2000))
            body['blockedBy'] = values(data.get('blockedBy', (existing or {}).get('blockedBy', [])), 30, 100)
            if validate_dependencies(self, db, body['blockedBy'], existing, Problem):
                if body['status'] == 'done':
                    raise Problem('Completa o retira las dependencias pendientes antes de completar esta tarea.')
                body['status'] = 'blocked'
            usernames = {m["username"] for m in self.members(db)}
            if any(a not in usernames for a in body["assignees"]):
                raise Problem("Selecciona responsables del directorio de Sutura.")
            checks = data.get("checklist", [])
            if not isinstance(checks, list) or len(checks) > 100:
                raise Problem("Checklist demasiado larga.")
            body["checklist"] = [{"text": text(c.get("text", ""), 240, True), "done": bool(c.get("done", False))} for c in checks if isinstance(c, dict)]
            if len(body["checklist"]) != len(checks):
                raise Problem("Checklist no válida.")
            if existing:
                if board["id"] != existing["boardId"]:
                    raise Problem("Para mover entre tableros usa una nueva tarea; el historial permanece en su tablero.")
                body["position"] = existing.get("position", 0)
            else:
                body["position"] = 1 + max((x.get("position", 0) for x in self.all(db, "ticket") if x["boardId"] == board["id"]), default=0)
        elif kind == "event":
            body['gameConfig'] = normalize_game_config(data.get('gameConfig', (existing or {}).get('gameConfig')), Problem)
            start_input = data.get("start", "")
            date_only = isinstance(start_input, str) and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_input))
            body.update(start=date_value(start_input, not date_only), end=date_value(data.get("end", ""), True),
                        eventType=choice(data.get("eventType", (existing or {}).get("eventType", "show")), ("show", "rehearsal")),
                        venue=text(data.get("venue", ""), 200), city=text(data.get("city", ""), 120),
                        address=text(data.get("address", ""), 1000), arrival=date_value(data.get("arrival", ""), True),
                        status=choice(data.get("status", "pending"), ("pending", "confirmed", "completed", "cancelled")),
                        ticketUrl=link(data.get("ticketUrl", "")), cast=[])
            if not body["start"]:
                raise Problem("Indica la fecha del bolo; la hora puede quedar pendiente.")
            if date_only and body["end"]:
                raise Problem("Indica la hora de inicio antes de añadir una hora de fin.")
            if body["end"] and datetime.fromisoformat(body["end"]) < datetime.fromisoformat(body["start"]):
                raise Problem("La hora de fin no puede ser anterior a la función.")
            cast = data.get("cast", [])
            if not isinstance(cast, list) or len(cast) > 100:
                raise Problem("Elenco demasiado largo.")
            for entry in cast:
                if not isinstance(entry, dict):
                    raise Problem("Ficha de elenco no válida.")
                person = self.item(db, entry.get("personId", ""), "person")
                role = normalize_role(text(entry.get("role", ""), 100, True))
                team = choice(entry.get("team", "general"), ("general", "blue", "red")) if role in TEAM_ROLES else 'general'
                cast_entry = {"personId": person["id"], "role": role, "team": team}
                if person["archived"] and not any(c['personId']==person['id'] and normalize_role(c['role'])==role and (c['team']==team or role not in TEAM_ROLES) for c in (existing or {}).get('cast', [])):
                    raise Problem("Recupera primero la ficha de esta persona para asignarle un nuevo papel.")
                body["cast"].append(cast_entry)
            if 'inventoryIds' in data or existing and 'inventoryIds' in existing:
                body['inventoryIds'] = values(data.get('inventoryIds', (existing or {}).get('inventoryIds', [])), 500, 100)
                for ident in body['inventoryIds']:
                    self.item(db, ident, 'inventory')
            if len({(c["personId"], c["role"], c["team"]) for c in body["cast"]}) != len(cast):
                raise Problem("Hay una entrada del elenco duplicada.")
            if existing:
                body["boardId"] = existing["boardId"]
                for key in ("historical", "historyKey", "sourcePollId", "sourceSlotId", "parentEventId"):
                    if key in existing:
                        body[key] = existing[key]
        return body

    def all(self, db, kind=None):
        rows = db.execute("SELECT id FROM items" + (" WHERE kind=?" if kind else ""), (kind,) if kind else ())
        return [self.item(db, r["id"]) for r in rows]

    def game_configurations(self):
        with self.connect() as db:
            people = {p['id']: {'name': p['name']} for p in self.all(db, 'person')}
            events = [e for e in self.all(db, 'event') if not e['archived'] and e.get('eventType', 'show') == 'show' and e['status'] != 'cancelled']
            events.sort(key=lambda e: e['start'], reverse=True)
            return {'bolos': [game_profile(e, people) for e in events[:300]]}

    def snapshot(self):
        with self.connect() as db:
            db.execute("BEGIN")
            return {"items": with_participations(self.all(db)), "members": self.members(db), "revision": db.execute("SELECT coalesce(max(seq),0) FROM activity").fetchone()[0],
                    "activity": [dict(r) for r in db.execute("SELECT * FROM activity ORDER BY seq DESC LIMIT 40")]}

    def create(self, kind, data, actor, request_id):
        if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", request_id or ""):
            raise Problem("Falta el identificador de la operación.")
        digest = hashlib.sha256(json.dumps({"kind": kind, "data": data}, sort_keys=True).encode()).hexdigest()
        with self.transaction() as db:
            prior = db.execute("SELECT * FROM requests WHERE token=?", (request_id,)).fetchone()
            if prior:
                if prior["actor"] != actor or prior["payload_hash"] != digest:
                    raise Problem("La operación ya se usó con otros datos.", 409)
                result = json.loads(prior["response"])
                if result.get('deleted'):
                    raise Problem("Esta tarea fue eliminada definitivamente.", 410)
                return result
            body = self.validate(db, kind, data)
            if kind == "event":
                template = self.item(db, data.get("templateId", "default-template"), "template", True) if body["eventType"] != "rehearsal" else {"tasks": []}
                event_id, board_id = str(uuid.uuid4()), str(uuid.uuid4())
                body["boardId"] = board_id
                result = self.insert(db, kind, body, actor, event_id)
                self.insert(db, "board", {"title": self.board_title(body["title"]), "description": f"Preparación · {body['venue']}", "color": "gold", "eventId": event_id}, actor, board_id)
                for pos, task in enumerate(template["tasks"]):
                    ticket = dict(task, boardId=board_id, status="todo", priority="normal", due="", assignees=[], checklist=[], blockedReason="", position=pos)
                    self.insert(db, "ticket", ticket, actor)
            else:
                result = self.insert(db, kind, body, actor)
                if kind == "availability":
                    self.availability.sync_links(db, result)
            db.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (request_id, actor, digest, json.dumps(result), now()))
            return result

    def update(self, ident, data, actor, expected):
        with self.transaction() as db:
            item = self.item(db, ident, active=True)
            self.check_version(item, expected)
            result = self.save(db, item, self.validate(db, item["kind"], data, item), actor)
            if item['kind'] == 'ticket':
                block_dependents(self, db, result, actor)
            if item["kind"] == "availability":
                self.availability.sync_links(db, result)
            return result

    def move(self, ident, status, before, actor, expected):
        choice(status, STATUSES)
        with self.transaction() as db:
            item = self.item(db, ident, "ticket", True)
            self.item(db, item["boardId"], "board", True)
            self.check_version(item, expected)
            if status != 'blocked' and validate_dependencies(self, db, item.get('blockedBy', []), item, Problem):
                raise Problem('Esta tarea sigue bloqueada por dependencias pendientes. Abre la ficha para consultarlas.', 409)
            siblings = sorted((x for x in self.all(db, "ticket") if not x["archived"] and x["boardId"] == item["boardId"] and x["status"] == status and x["id"] != ident), key=lambda x: (x.get("position", 0), x["created"]))
            if before:
                index = next((i for i, x in enumerate(siblings) if x["id"] == before), None)
                if index is None:
                    raise Problem("La tarea de destino ha cambiado. Recarga el tablero.", 409)
            else:
                index = len(siblings)
            siblings.insert(index, item)
            for pos, sibling in enumerate(siblings):
                if sibling["id"] == ident or sibling.get("position") != pos:
                    self.save(db, sibling, {"position": pos, "status": status}, actor, "movido a " + status if sibling["id"] == ident else "reordenado")
            result = self.item(db, ident)
            block_dependents(self, db, result, actor)
            return result

    def archive(self, ident, archived, actor, expected):
        with self.transaction() as db:
            item = self.item(db, ident)
            self.check_version(item, expected)
            if item["id"] == "default-template":
                raise Problem("La plantilla base no se puede archivar; sí se puede editar.")
            # Cascading soft archive; restore only the children archived in this operation.
            group = str(uuid.uuid4())
            targets = [item]
            if item["kind"] in ("event", "board"):
                board_id = item["boardId"] if item["kind"] == "event" else ident
                if archived:
                    targets += [x for x in self.all(db) if not x["archived"] and x["id"] != ident and (x.get("boardId") == board_id or x["id"] == board_id)]
                else:
                    targets += [x for x in self.all(db) if x["archived"] and x["id"] != ident and x.get("archiveGroup") == item.get("archiveGroup")]
            if item["kind"] == "board" and item.get("eventId"):
                raise Problem("Archiva o recupera el bolo desde su ficha, junto con su tablero.")
            if not archived and item["kind"] == "ticket":
                self.item(db, item["boardId"], "board", True)
            for target in targets:
                self.save(db, target, {"archiveGroup": group if archived else ""}, actor, "archivado" if archived else "recuperado")
                db.execute("UPDATE items SET archived=? WHERE id=?", (int(archived), target["id"]))
            return self.item(db, ident)

    def comment(self, ident, message, actor, request_id):
        message = text(message, 10000, True)
        if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", request_id or ""):
            raise Problem("Falta el identificador del comentario.")
        digest = hashlib.sha256((ident + message).encode()).hexdigest()
        with self.transaction() as db:
            prior = db.execute("SELECT * FROM requests WHERE token=?", (request_id,)).fetchone()
            if prior:
                if prior["actor"] != actor or prior["payload_hash"] != digest:
                    raise Problem("Operación duplicada con otros datos.", 409)
                result = json.loads(prior["response"])
                if result.get('deleted'):
                    raise Problem("Esta tarea fue eliminada definitivamente.", 410)
                return result
            ticket = self.item(db, ident, "ticket", True)
            self.item(db, ticket["boardId"], "board", True)
            result = {"id": str(uuid.uuid4()), "ticket": ident, "author": actor, "body": message, "created": now()}
            db.execute("INSERT INTO comments VALUES(:id,:ticket,:author,:body,:created)", result)
            self.activity(db, ident, actor, "comentario añadido")
            db.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (request_id, actor, digest, json.dumps(result), now()))
            return result

    def delete_ticket(self, ident, actor, expected, request_id, confirmed=False):
        if confirmed is not True:
            raise Problem("Confirma la eliminación definitiva de esta tarea.")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", request_id or ""):
            raise Problem("Falta el identificador de la operación.")
        digest = hashlib.sha256(json.dumps({'action': 'delete-ticket', 'id': ident, 'version': expected}, sort_keys=True).encode()).hexdigest()
        with self.transaction() as db:
            prior = db.execute("SELECT * FROM requests WHERE token=?", (request_id,)).fetchone()
            if prior:
                if prior['actor'] != actor or prior['payload_hash'] != digest:
                    raise Problem("La operación ya se usó con otros datos.", 409)
                return json.loads(prior['response'])
            ticket = self.item(db, ident, 'ticket')
            self.check_version(ticket, expected)
            db.execute('DELETE FROM comments WHERE ticket=?', (ident,))
            db.execute('DELETE FROM items WHERE id=? AND kind=\'ticket\'', (ident,))
            result = {'id': ident, 'kind': 'ticket', 'deleted': True}
            # Erase content from cached creation/comment receipts too, retaining
            # tombstones so retries cannot recreate or return a deleted task.
            for receipt in db.execute('SELECT token,response FROM requests').fetchall():
                body = json.loads(receipt['response'])
                if isinstance(body, dict) and (body.get('id') == ident or body.get('ticket') == ident):
                    db.execute('UPDATE requests SET response=? WHERE token=?', (json.dumps(result), receipt['token']))
            self.activity(db, ident, actor, 'tarea eliminada definitivamente')
            db.execute('INSERT INTO requests VALUES(?,?,?,?,?)', (request_id, actor, digest, json.dumps(result), now()))
            return result

    def save_lighting(self, data, actor):
        event_id = text(data.get('eventId', ''), 100)
        expected, token = data.get('version'), data.get('requestId')
        if type(expected) is not int or expected < 0:
            raise Problem('Versión del plano no válida.')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{16,100}', token or ''):
            raise Problem('Falta el identificador de la operación.')
        plan = normalize_lighting(data.get('plan'), Problem, text)
        ident = 'lighting-' + (event_id or 'base')
        digest = hashlib.sha256(json.dumps({'action':'lighting-save', 'eventId':event_id, 'version':expected, 'plan':plan}, sort_keys=True).encode()).hexdigest()
        with self.transaction() as db:
            prior = db.execute('SELECT * FROM requests WHERE token=?', (token,)).fetchone()
            if prior:
                if prior['actor'] != actor or prior['payload_hash'] != digest:
                    raise Problem('La operación ya se usó con otros datos.', 409)
                return json.loads(prior['response'])
            event = self.item(db, event_id, 'event', True) if event_id else None
            row = db.execute('SELECT 1 FROM items WHERE id=?', (ident,)).fetchone()
            body = dict(plan, eventId=event_id, title='Técnica · ' + (event['title'] if event else 'Plano base'))
            if row:
                existing = self.item(db, ident, 'lighting', True)
                self.check_version(existing, expected)
                result = self.save(db, existing, body, actor, 'plano técnico actualizado')
            else:
                if expected != 0:
                    raise Problem('El plano ha cambiado. Recarga antes de guardar; tu borrador se conserva.', 409)
                result = self.insert(db, 'lighting', body, actor, ident)
            db.execute('INSERT INTO requests VALUES(?,?,?,?,?)', (token, actor, digest, json.dumps(result), now()))
            return result

    def details(self, ident):
        with self.connect() as db:
            item = self.item(db, ident)
            return {"item": item, "comments": [dict(r) for r in db.execute("SELECT * FROM comments WHERE ticket=? ORDER BY created,rowid", (ident,))],
                    "activity": [dict(r) for r in db.execute("SELECT * FROM activity WHERE target=? ORDER BY seq DESC LIMIT 60", (ident,))]}

    def upload(self, encoded):
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            raise Problem("Imagen no válida.") from None
        if not 12 <= len(data) <= 4 * 1024 * 1024:
            raise Problem("La foto debe pesar menos de 4 MB.")
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            extension = "png"
        elif data.startswith(b"\xff\xd8\xff"):
            extension = "jpg"
        elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            extension = "webp"
        else:
            raise Problem("Solo fotos PNG, JPG o WebP. No se admiten SVG ni HTML.")
        ident = hashlib.sha256(data).hexdigest() + "." + extension
        folder = self.directory / "images"
        folder.mkdir(exist_ok=True, mode=0o700)
        target = folder / ident
        # Exclusive creation prevents corrupting a concurrent upload of the same image.
        try:
            with target.open("xb") as f:
                os.chmod(target, 0o600)
                f.write(data)
        except FileExistsError:
            pass
        return ident

    def export(self):
        with self.connect() as db:
            db.execute("BEGIN")
            payload = {"format": "scrib-world-v1", "exported": now(), "timezone": "Europe/Madrid", "items": self.all(db),
                       "comments": [dict(r) for r in db.execute("SELECT * FROM comments")], "activity": [dict(r) for r in db.execute("SELECT * FROM activity")], "members": self.members(db),
                       "messageDrafts": [dict(r) for r in db.execute("SELECT * FROM message_drafts")], "messageDeliveries": [dict(r) for r in db.execute("SELECT * FROM message_deliveries")],
                       "availabilityLinks": [dict(r) for r in db.execute("SELECT * FROM availability_links")], "availabilityReplies": [dict(r) for r in db.execute("SELECT * FROM availability_replies")],
                       "businessRecords": [dict(r) for r in db.execute("SELECT * FROM business_records")], "matchReports": [dict(r) for r in db.execute("SELECT * FROM match_reports")],
                       "agreements": [dict(r) for r in db.execute("SELECT * FROM agreements")], "agreementUploads": [dict(r) for r in db.execute("SELECT * FROM agreement_uploads")],
                       "documentExports": [dict(r) for r in db.execute("SELECT * FROM document_exports")]}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mundo-scrib.json", json.dumps(payload, ensure_ascii=False, indent=2))
            from document_trace import key as document_key, KEY_NAME
            if (self.directory/KEY_NAME).exists():
                z.writestr(KEY_NAME,document_key(self.directory))
            folder = self.directory / "images"
            if folder.exists():
                for file in folder.iterdir():
                    if re.fullmatch(r"[a-f0-9]{64}\.(png|jpg|webp)", file.name):
                        z.write(file, "images/" + file.name)
            folder = self.directory / 'documents'
            if folder.exists():
                for file in folder.iterdir():
                    if re.fullmatch(r'[a-f0-9]{64}\.pdf',file.name):
                        z.write(file, 'documents/' + file.name)
        return buffer.getvalue()

    def message_preview(self, data, actor):
        ids = values(data.get("people", []), 50, 100)
        if not ids:
            raise Problem("Selecciona al menos un destinatario.")
        template = text(data.get("text", ""), 4000, True)
        with self.transaction() as db:
            event = self.item(db, data["eventId"], "event", True) if data.get("eventId") else None
            context = {"bolo": event["title"] if event else "", "fecha": datetime.fromisoformat(event["start"]).strftime("%d/%m/%Y") if event else "",
                       "hora": datetime.fromisoformat(event["start"]).strftime("%H:%M") if event and len(event["start"]) > 10 else "", "lugar": " · ".join(filter(None, [event["venue"], event["city"]])) if event else "",
                       "convocatoria": datetime.fromisoformat(event["arrival"]).strftime("%d/%m/%Y %H:%M") if event and event["arrival"] else ""}
            people, phones = [], set()
            for ident in ids:
                person = self.item(db, ident, "person", True)
                phone = person.get("phone", "")
                if not phone:
                    raise Problem("Añade un teléfono a la ficha de " + person["name"] + " antes de enviar.")
                phone = phone_number(phone)
                if phone in phones:
                    raise Problem("Hay dos fichas con el mismo teléfono. Revisa los destinatarios.")
                phones.add(phone)
                role = " / ".join(dict.fromkeys(c["role"] for c in event["cast"] if c["personId"] == ident)) if event else ""
                if event and not role:
                    raise Problem(person["name"] + " no forma parte del elenco de este bolo.")
                agreement = None
                if data.get('agreements') is True:
                    if not event:
                        raise Problem('Selecciona el bolo del acuerdo.')
                    agreement = db.execute("SELECT * FROM agreements WHERE event=? AND person=? AND status<>'revoked' ORDER BY rowid DESC LIMIT 1",(event['id'],ident)).fetchone()
                    if not agreement or agreement['expires'] < time.time():
                        raise Problem('Genera primero un acuerdo vigente para '+person['name']+'.')
                message = personalize(template, dict(context, nombre=person["name"].split()[0], nombre_completo=person["name"], papel=role))
                if agreement:
                    message += '\n\nTu acuerdo y enlace personal para subirlo firmado:\nhttps://sutura-gateway.ddns.net/scrib-disponibilidad/' + agreement['token']
                people.append({"id": ident, "name": person["name"], "phone": phone, "version": person["version"], "text": message, 'agreementId':agreement['id'] if agreement else ''})
            ident = str(uuid.uuid4())
            draft = {"id": ident, "people": people, "eventId": event["id"] if event else "", "eventVersion": event["version"] if event else 0, "template": template}
            db.execute("INSERT INTO message_drafts VALUES(?,?,?,?,?)", (ident, actor, json.dumps(draft, ensure_ascii=False), now(), time.time() + 900))
            self.activity(db, ident, actor, "vista previa de WhatsApp creada (sin envío)")
            return draft

    def messages(self, actor):
        with self.connect() as db:
            result = []
            for row in db.execute("SELECT * FROM message_drafts WHERE actor=? ORDER BY created DESC LIMIT 20", (actor,)):
                draft = json.loads(row["body"])
                deliveries = {r["recipient"]: dict(r) for r in db.execute("SELECT * FROM message_deliveries WHERE draft=?", (row["id"],))}
                result.append(dict(draft, created=row["created"], expired=time.time() > row["expires"], people=[dict(p, delivery=deliveries.get(i, {"status": "pending"})) for i,p in enumerate(draft["people"])]))
            return result

    def message_send(self, data, actor, bridge):
        if type(data.get("recipient")) is not int:
            raise Problem("Selecciona un destinatario de la vista previa.")
        ident, index = data.get("draftId"), data["recipient"]
        with self.transaction() as db:
            row = db.execute("SELECT * FROM message_drafts WHERE id=? AND actor=?", (ident, actor)).fetchone()
            if not row:
                raise Problem("Vista previa no encontrada.", 404)
            draft = json.loads(row["body"])
            if not 0 <= index < len(draft["people"]):
                raise Problem("Destinatario no válido.")
            prior = db.execute("SELECT status FROM message_deliveries WHERE draft=? AND recipient=?", (ident, index)).fetchone()
            if prior:
                return {"status": "unknown" if prior["status"] == "sending" else prior["status"], "duplicate": True}
            if row["expires"] < time.time():
                raise Problem("La vista previa ha caducado. Genera otra antes de enviar.", 409)
            person = draft["people"][index]
            if person.get('agreementId'):
                agreement = db.execute('SELECT status,expires FROM agreements WHERE id=?',(person['agreementId'],)).fetchone()
                if not agreement or agreement['status']=='revoked' or agreement['expires'] < time.time():
                    raise Problem('El acuerdo ha caducado o fue revocado. Genera una nueva vista previa.',409)
            current = self.item(db, person["id"], "person", True)
            if current["version"] != person["version"] or current.get("phone") != person["phone"]:
                raise Problem("La ficha o el teléfono han cambiado. Genera una nueva vista previa.", 409)
            if draft["eventId"] and self.item(db, draft["eventId"], "event", True)["version"] != draft["eventVersion"]:
                raise Problem("El bolo ha cambiado. Genera una nueva vista previa.", 409)
            # Reserve durably BEFORE contacting WhatsApp. Never retry uncertain sends.
            db.execute("INSERT INTO message_deliveries VALUES(?,?,?,?)", (ident, index, "sending", now()))
        status = "sent"
        try:
            bridge.send(person["phone"], person["text"])
        except Exception:
            status = "unknown"
        with self.transaction() as db:
            db.execute("UPDATE message_deliveries SET status=?,updated=? WHERE draft=? AND recipient=?", (status, now(), ident, index))
            self.activity(db, person["id"], actor, "WhatsApp: " + ("envío confirmado" if status == "sent" else "envío sin confirmar; revisar en WhatsApp antes de reintentar"))
            if status=='sent' and person.get('agreementId'):
                db.execute("UPDATE agreements SET status='sent' WHERE id=? AND status='generated'",(person['agreementId'],))
        return {"status": status, "duplicate": False}


def ics(snapshot):
    def esc(value):
        return str(value).replace("\\", "\\\\").replace("\r", "").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sutura//Mundo SCRIB//ES", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Bolos SCRIB", "X-WR-TIMEZONE:Europe/Madrid"]
    for event in snapshot["items"]:
        if event["kind"] != "event" or event["archived"]:
            continue
        start = datetime.fromisoformat(event["start"])
        end = datetime.fromisoformat(event["end"]) if event["end"] else start + timedelta(hours=1)
        utc = lambda d: d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        date_only = len(event["start"]) == 10
        timing = ["DTSTART;VALUE=DATE:" + start.strftime("%Y%m%d"), "DTEND;VALUE=DATE:" + (start + timedelta(days=1)).strftime("%Y%m%d"), "TRANSP:TRANSPARENT"] if date_only else ["DTSTART:" + utc(start), "DTEND:" + utc(end)]
        description = event["description"] + ("\nHorario pendiente de confirmar." if date_only else "")
        lines += ["BEGIN:VEVENT", "UID:" + event["id"] + "@sutura.ddns.net", "DTSTAMP:" + utc(datetime.now(timezone.utc)), *timing,
                  "SUMMARY:" + esc(event["title"]), "LOCATION:" + esc(", ".join(filter(None, [event["venue"], event["city"], event["address"]]))),
                  "DESCRIPTION:" + esc(description), "STATUS:" + ("CANCELLED" if event["status"] == "cancelled" else "CONFIRMED" if event["status"] == "confirmed" else "TENTATIVE"), "END:VEVENT"]
    lines += ["END:VCALENDAR"]
    # RFC5545 folding, UTF-8-safe, 75 octets including continuation space.
    folded = []
    for line in lines:
        segment = ""
        for char in line:
            if len((segment + char).encode()) > 75:
                folded.append(segment)
                segment = " "
            segment += char
        folded.append(segment)
    return ("\r\n".join(folded) + "\r\n").encode()


class App(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, port, store, demo=False, secret=None, bridge=None):
        self.store, self.demo = store, demo
        self.materials = MaterialLibrary(ROOT/'materials')
        self.whatsapp = bridge or Bridge(disabled=demo)
        self.secret_path = store.directory / "bridge-secret"
        if secret is None:
            try:
                with self.secret_path.open("x") as f:
                    os.chmod(self.secret_path, 0o600)
                    f.write(secrets.token_hex(32))
            except FileExistsError:
                pass
            secret = self.secret_path.read_text().strip()
        self.secret = secret
        self.origins = {"https://sutura.ddns.net", "https://sutura-gateway.ddns.net"}
        if demo:
            self.origins.add(f"http://127.0.0.1:{port}")
            self.origins.add(f"http://localhost:{port}")
        super().__init__(("127.0.0.1", port), Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "SCRIBWorld/1"
    def log_message(self, fmt, *args):
        path = urlsplit(self.path).path
        LOG.info("%s %s", self.command, PUBLIC_PREFIX + "[enlace privado]" if path.startswith(PUBLIC_PREFIX) else path)

    def reply(self, status, body, content_type="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header("Content-Security-Policy", (extra or {}).get('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"))
        for key, value in (extra or {}).items():
            if key != 'Content-Security-Policy':
                self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def material_file(self, route):
        preview=self.server.materials.preview(route)
        if preview is not None:
            return self.reply(200,preview,'text/html; charset=utf-8',extra={'Content-Security-Policy':MATERIAL_PREVIEW_POLICY})
        found=self.server.materials.file(route)
        if not found:raise Problem('Material no encontrado.',404)
        path,mime=found;length=path.stat().st_size
        try:
            start,end,partial=self.server.materials.byte_range(self.headers.get('Range',''),length)
        except ValueError:
            return self.reply(416,{'error':'Fragmento no válido.'},extra={'Content-Range':f'bytes */{length}'})
        self.send_response(206 if partial else 200)
        headers={'Content-Type':mime,'Content-Length':str(end-start+1),'Accept-Ranges':'bytes',
                 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
                 'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow',
                 'Content-Security-Policy':MATERIAL_POLICY}
        if partial:headers['Content-Range']=f'bytes {start}-{end}/{length}'
        for key,value in headers.items():self.send_header(key,value)
        self.end_headers()
        if self.command=='HEAD':return
        with path.open('rb') as source:
            source.seek(start);remaining=end-start+1
            while remaining:
                chunk=source.read(min(remaining,65536))
                if not chunk:break
                self.wfile.write(chunk);remaining-=len(chunk)

    def identity(self):
        if self.server.demo:
            return {"username": "ensayo", "name": "Equipo de ensayo", "role": "admin"}
        token = self.headers.get("X-Scrib-Bridge", "")
        if not hmac.compare_digest(token.encode(), self.server.secret.encode()):
            raise Problem("Acceso no autenticado.", 401)
        actor = self.headers.get("X-Scrib-User", "")
        if not actor or len(actor) > 100 or any(ord(c) < 32 for c in actor):
            raise Problem("Acceso no autenticado.", 401)
        try:
            name = base64.b64decode(self.headers.get("X-Scrib-Name", ""), validate=True).decode()[:200] or actor
        except (ValueError, UnicodeDecodeError):
            name = actor
        return {"username": actor, "name": name, "role": "admin" if self.headers.get("X-Scrib-Role") == "admin" else "user"}

    def csrf_token(self, actor):
        raw = f"{actor}|{int(time.time()) + 43200}|{secrets.token_hex(16)}".encode()
        body = base64.urlsafe_b64encode(raw).decode()
        return body + "." + hmac.new(self.server.secret.encode(), body.encode(), hashlib.sha256).hexdigest()

    def valid_cookie_token(self, actor):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            if "scrib_world_csrf" not in cookie:
                raise ValueError()
            candidate = cookie["scrib_world_csrf"].value
            if len(candidate) > 1000 or not candidate.isascii():
                raise ValueError()
            body, signature = candidate.split(".")
            if not hmac.compare_digest(signature, hmac.new(self.server.secret.encode(), body.encode(), hashlib.sha256).hexdigest()):
                raise ValueError()
            user, expiry, _ = base64.urlsafe_b64decode(body).decode().split("|")
            if user != actor or int(expiry) < time.time():
                raise ValueError()
            return candidate
        except (ValueError, KeyError, CookieError):
            return ""

    def csrf_check(self, actor):
        if self.headers.get("Origin") not in self.server.origins:
            raise Problem("Origen no permitido.", 403)
        candidate = self.valid_cookie_token(actor)
        if not candidate or not hmac.compare_digest(candidate.encode(), self.headers.get("X-CSRF-Token", "").encode()):
            raise Problem("La sesión de edición ha caducado. Recarga; no se ha guardado ningún cambio.", 403)

    def body(self, limit=MAX_BODY):
        if self.headers.get("Transfer-Encoding") or not self.headers.get("Content-Type", "").startswith("application/json"):
            raise Problem("Se requiere JSON con longitud conocida.", 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise Problem("Tamaño no válido.") from None
        if not 0 < size <= limit:
            raise Problem("Datos demasiado grandes.", 413)
        self.connection.settimeout(20)
        try:
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeDecodeError):
            raise Problem("JSON no válido.") from None

    def availability_csrf(self, token, supplied=None):
        scope = hashlib.sha256(token.encode()).hexdigest()
        name = 'scrib_availability_' + scope[:12]
        candidate = ''
        try:
            cookie = SimpleCookie()
            cookie.load(self.headers.get('Cookie', ''))
            candidate = cookie[name].value
            if len(candidate) > 1000 or not candidate.isascii():
                raise ValueError()
            body, signature = candidate.split('.')
            expected = hmac.new(self.server.secret.encode(), ('availability|' + body).encode(), hashlib.sha256).hexdigest()
            bound, expiry, _ = base64.urlsafe_b64decode(body).decode().split('|')
            if not hmac.compare_digest(signature, expected) or bound != scope or int(expiry) < time.time():
                raise ValueError()
        except (ValueError, KeyError, CookieError, UnicodeDecodeError):
            candidate = ''
        if supplied is not None:
            if not candidate or not hmac.compare_digest(candidate.encode(), supplied.encode()):
                raise Problem('El formulario ha caducado. Recarga antes de guardar.', 403)
        elif not candidate:
            body = base64.urlsafe_b64encode(f'{scope}|{int(time.time())+43200}|{secrets.token_hex(16)}'.encode()).decode()
            candidate = body + '.' + hmac.new(self.server.secret.encode(), ('availability|' + body).encode(), hashlib.sha256).hexdigest()
        return name, candidate

    def public_availability(self, route):
        tail = route[len(PUBLIC_PREFIX):]
        if self.command in ('GET', 'HEAD') and tail in ('form.js', 'form.css'):
            return self.reply(200, (ROOT / 'public' / tail).read_bytes(), 'application/javascript; charset=utf-8' if tail.endswith('.js') else 'text/css; charset=utf-8')
        match = re.fullmatch('(api/)?(' + TOKEN_RE + ')/?', tail)
        if not match:
            raise Problem('Este enlace ya no está disponible.', 404)
        api, token = match.groups()
        polls = self.server.store.availability
        agreement = self.server.store.business.public(token)
        if self.command in ('GET', 'HEAD'):
            result = agreement or polls.public(token, self.headers.get('X-Availability-Edit', ''))
            if not api:
                return self.reply(200, (ROOT / 'public' / 'availability.html').read_bytes(), 'text/html; charset=utf-8')
            name, csrf = self.availability_csrf(token)
            cookie = f'{name}={csrf}; HttpOnly; SameSite=Strict; Path={PUBLIC_PREFIX}; Max-Age=43200' + ('' if self.server.demo else '; Secure')
            return self.reply(200, dict(result, csrf=csrf), extra={'Set-Cookie': cookie})
        if not api or self.headers.get('Origin') not in self.server.origins:
            raise Problem('Origen no permitido.', 403)
        self.availability_csrf(token, self.headers.get('X-CSRF-Token', ''))
        if agreement:
            self.server.store.business.upload(token, self.body(4*1024*1024+2048))
            return self.reply(200, {'ok':True, 'agreement': self.server.store.business.public(token)})
        mine = polls.submit(token, self.body(16384))
        mine.pop('personId', None)
        return self.reply(200, {'ok': True, 'mine': mine})

    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        try:
            route = unquote(urlsplit(self.path).path)
            if route.startswith(PUBLIC_PREFIX):
                return self.public_availability(route)
            user = self.identity()
            actor = user["username"]
            route = unquote(urlsplit(self.path).path)
            if route == WORLD_ROOT:
                if self.command not in ("GET", "HEAD"):
                    raise Problem("No encontrado.", 404)
                route = ""
                cookie_prefix = PREFIX
            elif route.startswith(PREFIX) or route.startswith(LEGACY_PREFIX):
                cookie_prefix = PREFIX if route.startswith(PREFIX) else LEGACY_PREFIX
                route = route[len(cookie_prefix):]
            else:
                raise Problem("No encontrado.", 404)
            store = self.server.store
            if route == 'api/match-reports' and self.command == 'POST':
                # Only the private loopback game bridge may archive; browser
                # proxies always overwrite identity and cannot impersonate it.
                if self.server.demo or actor != 'videojuego-control':
                    raise Problem('Archivo reservado al servidor del videojuego.',403)
                return self.reply(200, store.business.archive_report(self.body(4*1024*1024)))
            if self.command in ("GET", "HEAD"):
                if route in ('android/scrib.apk','android/version.json'):
                    file=ROOT/'assets'/route
                    if not file.is_file():raise Problem('La app aún no está publicada en este servidor.',404)
                    if route.endswith('.apk'):
                        return self.reply(200,file.read_bytes(),'application/vnd.android.package-archive',{'Content-Disposition':'attachment; filename="SCRIB-Android.apk"'})
                    return self.reply(200,file.read_bytes(),'application/json; charset=utf-8')
                if route == 'api/materials':
                    return self.reply(200,self.server.materials.list())
                if route.startswith('materials/'):
                    return self.material_file(route[len('materials/'):])
                if route.startswith('api/reports/event/'):
                    return self.reply(200,store.business.reports(route.split('/')[-1]))
                if route.startswith('api/reports/match/'):
                    return self.reply(200,store.business.report(route.split('/')[-1]))
                if route.startswith('api/business/'):
                    if user['role'] != 'admin':
                        raise Problem('Los datos económicos, fiscales y acuerdos están reservados a administración.',403)
                    if route == 'api/business/overview':
                        return self.reply(200,store.business.overview())
                    if route == 'api/business/template':
                        return self.reply(200,{'text':(ROOT/'agreement_template.txt').read_text(),'source':'Modelo SCRIB Imparables 2026 · Drive','url':'https://drive.google.com/file/d/1ciafKCpO6H6jgw6uVvO75C9xb2ZRkaCy/view'})
                    if route.startswith('api/business/agreement-preview/'):
                        return self.reply(200,store.business.agreement_preview(route.split('/')[-1]))
                    if route.startswith('api/business/agreements/'):
                        return self.reply(200,store.business.agreements(route.split('/')[-1]))
                    if route.startswith('api/business/document/'):
                        return self.reply(200,store.business.document(route.split('/')[-1]),'application/pdf',{'Content-Disposition':'attachment; filename="acuerdo-firmado.pdf"','Content-Security-Policy':"sandbox; default-src 'none'"})
                    raise Problem('No encontrado.',404)
                if route == 'api/game-configurations':
                    return self.reply(200, store.game_configurations())
                if route == 'api/game-config-schema':
                    return self.reply(200, GAME_CONFIG_SCHEMA)
                if route == "api/state":
                    store.identify(actor, user["name"])
                    token = self.valid_cookie_token(actor) or self.csrf_token(actor)
                    cookie = f"scrib_world_csrf={token}; HttpOnly; SameSite=Strict; Path={cookie_prefix}; Max-Age=43200" + ("" if self.server.demo else "; Secure")
                    return self.reply(200, dict(store.snapshot(), user=user, csrf=token, demo=self.server.demo, gameConfigSchema=GAME_CONFIG_SCHEMA, personRoles=PERSON_ROLES, lightingDefaults=default_lighting()), extra={"Set-Cookie": cookie})
                if route.startswith("api/items/"):
                    return self.reply(200, store.details(route.split("/")[-1]))
                if route.startswith('api/availability/'):
                    return self.reply(200, store.availability.details(route.split('/')[-1]))
                if route == "api/whatsapp/status":
                    return self.reply(200, self.server.whatsapp.status())
                if route == "api/whatsapp/messages":
                    return self.reply(200, {"messages": store.messages(actor)})
                if route == "api/calendar.ics":
                    return self.reply(200, ics(store.snapshot()), "text/calendar; charset=utf-8", {"Content-Disposition": 'attachment; filename="bolos-scrib.ics"'})
                if route == "api/export.zip":
                    if user["role"] != "admin":
                        raise Problem("La copia completa está reservada a administración.", 403)
                    return self.reply(200, store.export(), "application/zip", {"Content-Disposition": 'attachment; filename="mundo-scrib-backup.zip"'})
                if route.startswith("images/"):
                    name = route.split("/")[-1]
                    if not re.fullmatch(r"[a-f0-9]{64}\.(png|jpg|webp)", name) or route != "images/" + name:
                        raise Problem("No encontrado.", 404)
                    file = store.directory / "images" / name
                    if not file.is_file():
                        raise Problem("No encontrado.", 404)
                    return self.reply(200, file.read_bytes(), "image/" + ("jpeg" if file.suffix == ".jpg" else file.suffix[1:]))
                if route == 'logo.png':
                    return self.reply(200, (ROOT / 'assets' / 'scrib-world-logo.png').read_bytes(), 'image/png')
                if route == 'tasks.css':
                    return self.reply(200, (ROOT / 'public' / 'tasks.css').read_bytes(), 'text/css; charset=utf-8')
                if route == 'export.js':
                    return self.reply(200, (ROOT / 'public' / 'export.js').read_bytes(), 'application/javascript; charset=utf-8')
                if route == 'documents.js':
                    return self.reply(200,(ROOT/'public/documents.js').read_bytes(),'application/javascript; charset=utf-8')
                if route in ('lighting.js', 'lighting.css'):
                    mime = 'application/javascript; charset=utf-8' if route.endswith('.js') else 'text/css; charset=utf-8'
                    return self.reply(200, (ROOT / 'public' / route).read_bytes(), mime)
                static = {"people-profile.js": ("people-profile.js", "application/javascript; charset=utf-8"), "people.css": ("people.css", "text/css; charset=utf-8"), "people-colors.js": ("people-colors.js", "application/javascript; charset=utf-8"), "inventory.js": ("inventory.js", "application/javascript; charset=utf-8"), "library.js": ("library.js", "application/javascript; charset=utf-8"), "resources.css": ("resources.css", "text/css; charset=utf-8"), "": ("index.html", "text/html; charset=utf-8"), "business.js": ('business.js','application/javascript; charset=utf-8'), 'business.css': ('business.css','text/css; charset=utf-8'), "app.js": ("app.js", "application/javascript; charset=utf-8"), "game-config.js": ("game-config.js", "application/javascript; charset=utf-8"), "activity.js": ("activity.js", "application/javascript; charset=utf-8"), "availability.js": ("availability.js", "application/javascript; charset=utf-8"), "app.css": ("app.css", "text/css; charset=utf-8")}
                if route in static:
                    file, mime = static[route]
                    return self.reply(200, (ROOT / "public" / file).read_bytes(), mime)
                raise Problem("No encontrado.", 404)
            self.csrf_check(actor)
            if route == 'api/pdf/verify':
                if user['role'] != 'admin':raise Problem('La trazabilidad está reservada a administración.',403)
                from document_trace import verify_pdf, MAX_PDF_BYTES
                data=self.body(23*1024*1024)
                encoded=data.get('pdf','')
                if not isinstance(encoded,str) or len(encoded)>((MAX_PDF_BYTES+2)//3)*4:
                    raise Problem('Selecciona un PDF de hasta 16 MB.')
                try:raw=base64.b64decode(encoded,validate=True)
                except ValueError:raise Problem('El PDF no es válido.') from None
                return self.reply(200,verify_pdf(store,raw))
            data = self.body()
            if route == 'api/pdf':
                # Isolated renderer packages, not global/system dependency changes.
                import sys
                packages = str(store.directory/'python-packages')
                if packages not in sys.path and Path(packages).is_dir():
                    sys.path.insert(0,packages)
                from pdf_export import generate
                return self.reply(200, generate(store, data, user), 'application/pdf',
                                  {'Content-Disposition': 'attachment; filename="SCRIB-'+str(data.get('kind','document'))+'.pdf"'})
            if route.startswith('api/business/'):
                if user['role'] != 'admin':
                    raise Problem('Gestión reservada a administración.',403)
                if route in ('api/business/settings','api/business/billing','api/business/settlement'):
                    result=store.business.save(route.split('/')[-1],data,actor)
                elif route == 'api/business/generate':
                    result=store.business.generate(data,actor)
                elif route == 'api/business/agreement-state':
                    result=store.business.agreement_state(data,actor)
                elif route == 'api/business/invoice':
                    result=store.business.invoice(data,actor)
                else:
                    raise Problem('No encontrado.',404)
                return self.reply(200,{'ok':True,'item':result})
            if route == "api/create":
                result = store.create(data.get("kind"), data.get("data"), actor, data.get("requestId"))
            elif route == "api/update":
                result = store.update(data.get("id"), data.get("data"), actor, data.get("version"))
            elif route == 'api/availability/confirm':
                result = store.availability.confirm(data, actor)
            elif route == "api/move":
                result = store.move(data.get("id"), data.get("status"), data.get("beforeId", ""), actor, data.get("version"))
            elif route == "api/archive":
                if type(data.get("archived")) is not bool:
                    raise Problem("Archivo no válido.")
                result = store.archive(data.get("id"), data["archived"], actor, data.get("version"))
            elif route == "api/delete-ticket":
                result = store.delete_ticket(data.get('id'), actor, data.get('version'), data.get('requestId'), data.get('confirmed'))
            elif route == 'api/lighting/save':
                result = store.save_lighting(data, actor)
            elif route == "api/comment":
                result = store.comment(data.get("id"), data.get("body"), actor, data.get("requestId"))
            elif route == "api/upload":
                result = {"image": store.upload(data.get("base64"))}
            elif route == "api/whatsapp/preview":
                if data.get('agreements') is True and user['role'] != 'admin':
                    raise Problem('Envío de acuerdos reservado a administración.',403)
                result = store.message_preview(data, actor)
            elif route == "api/whatsapp/send":
                if self.server.demo:
                    raise Problem("El ensayo local nunca envía mensajes reales.", 403)
                result = store.message_send(data, actor, self.server.whatsapp)
            else:
                raise Problem("No encontrado.", 404)
            return self.reply(200, {"ok": True, "item": result})
        except (Problem, WhatsappProblem) as error:
            self.reply(error.status, {"ok": False, "error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            LOG.exception("Error interno en Mundo SCRIB")
            self.reply(500, {"ok": False, "error": "No se pudo completar la operación. El borrador no se ha descartado."})


def demo_data(store):
    store.identify("ensayo", "Equipo de ensayo")
    with store.connect() as db:
        if db.execute("SELECT 1 FROM items WHERE kind='event'").fetchone():
            return
    person = store.create("person", {"name": "Elenco de prueba", "roles": ["Escritura", "Interpretación"]}, "ensayo", "demo_person_request")
    event = store.create("event", {"title": "Ensayo general · datos ficticios", "start": (datetime.now(TZ) + timedelta(days=8)).isoformat(timespec="minutes"), "venue": "Sala de ensayo", "city": "Madrid", "status": "pending", "cast": [{"personId": person["id"], "role": "Escritura", "team": "blue"}]}, "ensayo", "demo_event_request")
    store.create("ticket", {"title": "Explorar la frase final", "description": "Probar dos cierres y compartir sensaciones en los comentarios.", "boardId": "dramaturgia", "labels": ["ESCRITURA"], "assignees": ["ensayo"], "priority": "high", "checklist": [{"text": "Lectura en voz alta", "done": False}]}, "ensayo", "demo_ticket_request")
    items = store.snapshot()["items"]
    first = next(x for x in items if x["kind"] == "ticket" and x["boardId"] == event["boardId"])
    store.move(first["id"], "done", "", "ensayo", first["version"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=os.environ.get("SCRIB_WORLD_DATA", str(Path.home() / "dockers/scrib-world-data")))
    parser.add_argument("--port", type=int, default=5124)
    parser.add_argument("--users", default=os.environ.get("SCRIB_WORLD_USERS"))
    parser.add_argument("--demo", action="store_true", help="Isolated localhost demo; never enable in production")
    args = parser.parse_args()
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    store = Store(args.data, args.users)
    renamed = store.tidy_board_titles()
    if renamed:
        LOG.info('Tableros: %s nombres simplificados sin modificar sus tareas', renamed)
    if args.demo:
        demo_data(store)
    else:
        seeded = apply_initial_inventory(store)
        if seeded['added']:
            LOG.info('Inventario solicitado: %s fichas añadidas', seeded['added'])
        kits = apply_team_inventory(store)
        if not kits['alreadyApplied']:
            LOG.info('Kits solicitados: %s añadidos, %s actualizados', kits['added'],kits['updated'])
        presenter = apply_presenter_assignment(store)
        if presenter['status'] == 'assigned':
            LOG.info('Rol solicitado de presentador añadido a David Viñas')
        elif presenter['status'] in ('missing', 'ambiguous', 'archived'):
            LOG.warning('Asignación de presentador pendiente: %s', presenter['status'])
    app = App(args.port, store, args.demo)
    LOG.info("Mundo SCRIB en localhost:%s (demo=%s)", args.port, args.demo)
    app.serve_forever()


if __name__ == "__main__":
    main()
