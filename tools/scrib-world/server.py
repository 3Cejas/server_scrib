#!/usr/bin/env python3
"""Mundo SCRIB: SQLite, Authentik bridge, no third-party runtime dependencies."""
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

ROOT = Path(__file__).resolve().parent
PREFIX = "/mundo-scrib/"
STATUSES = ("todo", "progress", "blocked", "done")
KINDS = ("board", "ticket", "event", "person", "template")
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
            if not db.execute("SELECT 1 FROM items WHERE kind='template'").fetchone():
                tasks = json.loads((ROOT / "default_tasks.json").read_text())
                self.insert(db, "template", {"title": "Preparación de un bolo", "tasks": tasks}, "sistema", "default-template")
                self.insert(db, "board", {"title": "Dramaturgia · laboratorio", "description": "Ideas, escritura, ensayos y decisiones creativas.", "eventId": "", "color": "violet"}, "sistema", "dramaturgia")
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
        if kind == "person":
            body = {"name": text(data.get("name", ""), 160, True), "bio": text(data.get("bio", ""), 5000),
                    "roles": values(data.get("roles", []), 12), "instagram": link(data.get("instagram", "")),
                    "website": link(data.get("website", "")), "otherSocial": link(data.get("otherSocial", "")),
                    "image": text(data.get("image", ""), 200)}
            body["phone"] = phone_number(data.get("phone", (existing or {}).get("phone", "")))
            preserved = (existing or {}).get("phoneConfirmed", False) and body["phone"] == (existing or {}).get("phone", "")
            confirmed = data.get("phoneConfirmed", preserved)
            if type(confirmed) is not bool:
                raise Problem("Confirmación de teléfono no válida.")
            body["phoneConfirmed"] = bool(body["phone"] and confirmed)
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
            body.update(start=date_value(data.get("start", ""), True), end=date_value(data.get("end", ""), True),
                        venue=text(data.get("venue", ""), 200), city=text(data.get("city", ""), 120),
                        address=text(data.get("address", ""), 1000), arrival=date_value(data.get("arrival", ""), True),
                        status=choice(data.get("status", "pending"), ("pending", "confirmed", "completed", "cancelled")),
                        ticketUrl=link(data.get("ticketUrl", "")), cast=[])
            if not body["start"]:
                raise Problem("Indica la fecha y hora del bolo.")
            if body["end"] and datetime.fromisoformat(body["end"]) < datetime.fromisoformat(body["start"]):
                raise Problem("La hora de fin no puede ser anterior a la función.")
            cast = data.get("cast", [])
            if not isinstance(cast, list) or len(cast) > 100:
                raise Problem("Elenco demasiado largo.")
            for entry in cast:
                if not isinstance(entry, dict):
                    raise Problem("Ficha de elenco no válida.")
                person = self.item(db, entry.get("personId", ""), "person")
                cast_entry = {"personId": person["id"], "role": text(entry.get("role", ""), 100, True), "team": choice(entry.get("team", "general"), ("general", "blue", "red"))}
                if person["archived"] and (not existing or cast_entry not in existing.get("cast", [])):
                    raise Problem("Recupera primero la ficha de esta persona para asignarle un nuevo papel.")
                body["cast"].append(cast_entry)
            if len({(c["personId"], c["role"], c["team"]) for c in body["cast"]}) != len(cast):
                raise Problem("Hay una entrada del elenco duplicada.")
            if existing:
                body["boardId"] = existing["boardId"]
        return body

    def all(self, db, kind=None):
        rows = db.execute("SELECT id FROM items" + (" WHERE kind=?" if kind else ""), (kind,) if kind else ())
        return [self.item(db, r["id"]) for r in rows]

    def snapshot(self):
        with self.connect() as db:
            db.execute("BEGIN")
            return {"items": self.all(db), "members": self.members(db), "revision": db.execute("SELECT coalesce(max(seq),0) FROM activity").fetchone()[0],
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
                return json.loads(prior["response"])
            body = self.validate(db, kind, data)
            if kind == "event":
                template = self.item(db, data.get("templateId", "default-template"), "template", True)
                event_id, board_id = str(uuid.uuid4()), str(uuid.uuid4())
                body["boardId"] = board_id
                result = self.insert(db, kind, body, actor, event_id)
                self.insert(db, "board", {"title": body["title"], "description": f"Preparación · {body['venue']}", "color": "gold", "eventId": event_id}, actor, board_id)
                for pos, task in enumerate(template["tasks"]):
                    ticket = dict(task, boardId=board_id, status="todo", priority="normal", due="", assignees=[], checklist=[], blockedReason="", position=pos)
                    self.insert(db, "ticket", ticket, actor)
            else:
                result = self.insert(db, kind, body, actor)
            db.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (request_id, actor, digest, json.dumps(result), now()))
            return result

    def update(self, ident, data, actor, expected):
        with self.transaction() as db:
            item = self.item(db, ident, active=True)
            self.check_version(item, expected)
            return self.save(db, item, self.validate(db, item["kind"], data, item), actor)

    def move(self, ident, status, before, actor, expected):
        choice(status, STATUSES)
        with self.transaction() as db:
            item = self.item(db, ident, "ticket", True)
            self.item(db, item["boardId"], "board", True)
            self.check_version(item, expected)
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
            return self.item(db, ident)

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
                return json.loads(prior["response"])
            ticket = self.item(db, ident, "ticket", True)
            self.item(db, ticket["boardId"], "board", True)
            result = {"id": str(uuid.uuid4()), "ticket": ident, "author": actor, "body": message, "created": now()}
            db.execute("INSERT INTO comments VALUES(:id,:ticket,:author,:body,:created)", result)
            self.activity(db, ident, actor, "comentario añadido")
            db.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (request_id, actor, digest, json.dumps(result), now()))
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
                       "messageDrafts": [dict(r) for r in db.execute("SELECT * FROM message_drafts")], "messageDeliveries": [dict(r) for r in db.execute("SELECT * FROM message_deliveries")]}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mundo-scrib.json", json.dumps(payload, ensure_ascii=False, indent=2))
            folder = self.directory / "images"
            if folder.exists():
                for file in folder.iterdir():
                    if re.fullmatch(r"[a-f0-9]{64}\.(png|jpg|webp)", file.name):
                        z.write(file, "images/" + file.name)
        return buffer.getvalue()

    def message_preview(self, data, actor):
        ids = values(data.get("people", []), 50, 100)
        if not ids:
            raise Problem("Selecciona al menos un destinatario.")
        template = text(data.get("text", ""), 4000, True)
        with self.transaction() as db:
            event = self.item(db, data["eventId"], "event", True) if data.get("eventId") else None
            context = {"bolo": event["title"] if event else "", "fecha": datetime.fromisoformat(event["start"]).strftime("%d/%m/%Y") if event else "",
                       "hora": datetime.fromisoformat(event["start"]).strftime("%H:%M") if event else "", "lugar": " · ".join(filter(None, [event["venue"], event["city"]])) if event else "",
                       "convocatoria": datetime.fromisoformat(event["arrival"]).strftime("%d/%m/%Y %H:%M") if event and event["arrival"] else ""}
            people, phones = [], set()
            for ident in ids:
                person = self.item(db, ident, "person", True)
                phone = person.get("phone", "")
                if not phone or not person.get("phoneConfirmed"):
                    raise Problem("Revisa y confirma el teléfono de " + person["name"] + " en su ficha antes de enviar.")
                if phone in phones:
                    raise Problem("Hay dos fichas con el mismo teléfono. Revisa los destinatarios.")
                phones.add(phone)
                role = " / ".join(dict.fromkeys(c["role"] for c in event["cast"] if c["personId"] == ident)) if event else ""
                if event and not role:
                    raise Problem(person["name"] + " no forma parte del elenco de este bolo.")
                message = personalize(template, dict(context, nombre=person["name"].split()[0], nombre_completo=person["name"], papel=role))
                people.append({"id": ident, "name": person["name"], "phone": phone, "version": person["version"], "text": message})
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
        if data.get("confirmed") is not True or type(data.get("recipient")) is not int:
            raise Problem("Confirma expresamente el destinatario y el mensaje de la vista previa.")
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
            current = self.item(db, person["id"], "person", True)
            if current["version"] != person["version"] or not current.get("phoneConfirmed") or current.get("phone") != person["phone"]:
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
        lines += ["BEGIN:VEVENT", "UID:" + event["id"] + "@sutura.ddns.net", "DTSTAMP:" + utc(datetime.now(timezone.utc)), "DTSTART:" + utc(start), "DTEND:" + utc(end),
                  "SUMMARY:" + esc(event["title"]), "LOCATION:" + esc(", ".join(filter(None, [event["venue"], event["city"], event["address"]]))),
                  "DESCRIPTION:" + esc(event["description"]), "STATUS:" + ("CANCELLED" if event["status"] == "cancelled" else "CONFIRMED" if event["status"] == "confirmed" else "TENTATIVE"), "END:VEVENT"]
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
        LOG.info("%s %s", self.command, urlsplit(self.path).path)  # No cookie or query logging.

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
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

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

    def body(self):
        if self.headers.get("Transfer-Encoding") or not self.headers.get("Content-Type", "").startswith("application/json"):
            raise Problem("Se requiere JSON con longitud conocida.", 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise Problem("Tamaño no válido.") from None
        if not 0 < size <= MAX_BODY:
            raise Problem("Datos demasiado grandes.", 413)
        self.connection.settimeout(20)
        try:
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeDecodeError):
            raise Problem("JSON no válido.") from None

    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        try:
            user = self.identity()
            actor = user["username"]
            route = unquote(urlsplit(self.path).path)
            if not route.startswith(PREFIX):
                raise Problem("No encontrado.", 404)
            route = route[len(PREFIX):]
            store = self.server.store
            if self.command in ("GET", "HEAD"):
                if route == "api/state":
                    store.identify(actor, user["name"])
                    token = self.valid_cookie_token(actor) or self.csrf_token(actor)
                    cookie = f"scrib_world_csrf={token}; HttpOnly; SameSite=Strict; Path={PREFIX}; Max-Age=43200" + ("" if self.server.demo else "; Secure")
                    return self.reply(200, dict(store.snapshot(), user=user, csrf=token, demo=self.server.demo), extra={"Set-Cookie": cookie})
                if route.startswith("api/items/"):
                    return self.reply(200, store.details(route.split("/")[-1]))
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
                static = {"": ("index.html", "text/html; charset=utf-8"), "app.js": ("app.js", "application/javascript; charset=utf-8"), "app.css": ("app.css", "text/css; charset=utf-8")}
                if route in static:
                    file, mime = static[route]
                    return self.reply(200, (ROOT / "public" / file).read_bytes(), mime)
                raise Problem("No encontrado.", 404)
            self.csrf_check(actor)
            data = self.body()
            if route == "api/create":
                result = store.create(data.get("kind"), data.get("data"), actor, data.get("requestId"))
            elif route == "api/update":
                result = store.update(data.get("id"), data.get("data"), actor, data.get("version"))
            elif route == "api/move":
                result = store.move(data.get("id"), data.get("status"), data.get("beforeId", ""), actor, data.get("version"))
            elif route == "api/archive":
                if type(data.get("archived")) is not bool:
                    raise Problem("Archivo no válido.")
                result = store.archive(data.get("id"), data["archived"], actor, data.get("version"))
            elif route == "api/comment":
                result = store.comment(data.get("id"), data.get("body"), actor, data.get("requestId"))
            elif route == "api/upload":
                result = {"image": store.upload(data.get("base64"))}
            elif route == "api/whatsapp/preview":
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
    if args.demo:
        demo_data(store)
    app = App(args.port, store, args.demo)
    LOG.info("Mundo SCRIB en localhost:%s (demo=%s)", args.port, args.demo)
    app.serve_forever()


if __name__ == "__main__":
    main()
