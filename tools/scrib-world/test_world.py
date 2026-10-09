import concurrent.futures
import http.client
import importlib.util
import json
import sqlite3
import tempfile
import threading
import unittest
import uuid
import zipfile
import io
import time
from unittest.mock import Mock
from pathlib import Path
from whatsapp import Bridge, WhatsappProblem, phone_number, personalize
from import_cast import schedule_literal, public_history, import_roster
from import_history import import_history, published_day
from participations import with_participations, show_key, show_digest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("world", ROOT / "server.py")
world = importlib.util.module_from_spec(spec)
spec.loader.exec_module(world)
spec2 = importlib.util.spec_from_file_location("integrate", ROOT / "integrate.py")
integrate = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(integrate)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.store.identify("angela", "Ángela")
        self.store.identify("pablo", "Pablo")

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, kind, data, request=None):
        return self.store.create(kind, data, "angela", request or str(uuid.uuid4()))

    def task(self, **changes):
        return self.create("ticket", {"title":"Escribir", "boardId":"dramaturgia", **changes})

    def event(self, **changes):
        return self.create("event", {"title":"Bolo", "start":"2026-10-20T19:00", **changes})

    def test_default_checklist_matches_screenshots(self):
        template = next(x for x in self.store.snapshot()["items"] if x["id"] == "default-template")
        self.assertEqual(len(template["tasks"]), 34)
        self.assertEqual(template["tasks"][0]["title"], "Preparar Carnalizadores")
        self.assertEqual(template["tasks"][-1]["title"], "20. Intérpretes listos")

    def test_event_creates_board_and_all_tasks_in_todo(self):
        e = self.event()
        items = self.store.snapshot()["items"]
        tasks = [x for x in items if x["kind"] == "ticket" and x["boardId"] == e["boardId"]]
        self.assertEqual(len(tasks), 34)
        self.assertTrue(all(x["status"] == "todo" for x in tasks))
        board = next(x for x in items if x["id"] == e["boardId"])
        self.assertEqual(board["eventId"], e["id"])

    def test_event_retry_is_idempotent_even_concurrently(self):
        token = str(uuid.uuid4())
        payload = {"title": "Bolo", "start": "2026-10-20T19:00"}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.create("event", payload, token), range(4)))
        self.assertEqual(len({x["id"] for x in results}), 1)
        self.assertEqual(len([x for x in self.store.snapshot()["items"] if x["kind"] == "ticket"]), 34)

    def test_token_cannot_be_reused_with_other_payload(self):
        token = str(uuid.uuid4())
        self.create("person", {"name": "Pablo"}, token)
        with self.assertRaises(world.Problem) as caught:
            self.create("person", {"name": "Laura"}, token)
        self.assertEqual(caught.exception.status, 409)

    def test_event_update_does_not_duplicate_tasks(self):
        e = self.event()
        update = self.store.update(e["id"], dict(e, title="Nuevo nombre"), "angela", e["version"])
        self.assertEqual(update["boardId"], e["boardId"])
        self.assertEqual(len([x for x in self.store.snapshot()["items"] if x["kind"] == "ticket"]), 34)

    def test_custom_template_and_existing_events_independent(self):
        t = self.create("template", {"title":"Pequeño formato", "tasks":[{"title":"Preparar luz", "labels":["TÉCNICA"]}]})
        e = self.event(templateId=t["id"])
        self.store.update(t["id"], dict(t, tasks=[{"title":"Otra tarea","labels":[]}]), "angela",t["version"])
        tasks = [x for x in self.store.snapshot()["items"] if x["kind"] == "ticket" and x.get("boardId") == e["boardId"]]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["title"], "Preparar luz")

    def test_invalid_template_rolls_back_event(self):
        with self.assertRaises(world.Problem):
            self.event(templateId="does-not-exist")
        self.assertFalse(any(x["kind"] == "event" for x in self.store.snapshot()["items"]))

    def test_move_between_every_status_and_reorder(self):
        a, b, c = self.task(), self.task(), self.task()
        a = self.store.move(a["id"],"todo",b["id"],"angela",a["version"])
        for status in ["progress","blocked","done","todo"]:
            a = self.store.move(a["id"],status,"","angela",a["version"])
            self.assertEqual(a["status"],status)
        a = self.store.move(a["id"],"todo",c["id"],"angela",a["version"])
        tasks = sorted([x for x in self.store.snapshot()["items"] if x["kind"] == "ticket"],key=lambda x:x["position"])
        self.assertEqual([x["id"] for x in tasks],[b["id"],a["id"],c["id"]])

    def test_stale_update_does_not_overwrite(self):
        a = self.task()
        self.store.update(a["id"],dict(a,title="Pablo escribe"),"pablo",a["version"])
        with self.assertRaises(world.Problem) as caught:
            self.store.update(a["id"],dict(a,title="Cambio antiguo"),"angela",a["version"])
        self.assertEqual(caught.exception.status,409)
        self.assertEqual(self.store.details(a["id"])["item"]["title"],"Pablo escribe")

    def test_two_people_can_comment_without_losing_updates(self):
        t = self.task()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            list(pool.map(lambda i:self.store.comment(t["id"],f"Nota {i}","pablo",str(uuid.uuid4())),range(5)))
        self.assertEqual(len(self.store.details(t["id"])["comments"]),5)
        self.assertEqual(self.store.details(t["id"])["item"]["version"],t["version"])

    def test_comment_retry_not_duplicated_and_unicode_preserved(self):
        t = self.task()
        token=str(uuid.uuid4())
        self.store.comment(t["id"],"Ángela\nSegunda línea <script>","angela",token)
        self.store.comment(t["id"],"Ángela\nSegunda línea <script>","angela",token)
        comments = self.store.details(t["id"])["comments"]
        self.assertEqual(len(comments),1)
        self.assertIn("\n",comments[0]["body"])

    def test_assignees_are_authorised_users_only(self):
        task=self.task(assignees=["angela","pablo"],labels=["Luz","Luz"],checklist=[{"text":"Probar", "done":True}])
        self.assertEqual(task["labels"],["Luz"])
        with self.assertRaises(world.Problem):self.task(assignees=["unknown"])

    def test_person_reused_in_two_casts_and_roles(self):
        person=self.create("person",{"name":"ÁNGELA HARRIS BUENO","instagram":"https://instagram.com/example"})
        for team,role in [("blue","Escritura"),("red","Dramaturgia")]:
            e=self.event(cast=[{"personId":person["id"],"team":team,"role":role}])
            self.assertEqual(e["cast"][0]["personId"],person["id"])
        self.assertEqual(len([x for x in self.store.snapshot()["items"] if x["kind"] == "person"]),1)

    def test_bad_cast_rejected_atomically(self):
        with self.assertRaises(world.Problem):self.event(cast=[{"personId":"missing","role":"Técnica","team":"blue"}])
        self.assertFalse(any(x["kind"] == "event" for x in self.store.snapshot()["items"]))

    def test_archived_person_keeps_previous_cast_when_event_is_edited(self):
        person=self.create("person",{"name":"Elenco"})
        cast=[{"personId":person["id"],"role":"Interpretación","team":"blue"}]
        e=self.event(cast=cast)
        self.store.archive(person["id"],True,"angela",person["version"])
        updated=self.store.update(e["id"],dict(e,title="Otro título"),"angela",e["version"])
        self.assertEqual(updated["cast"],cast)
        with self.assertRaises(world.Problem):self.event(cast=cast)

    def test_event_archive_and_restore_preserve_previously_archived_tasks(self):
        e=self.event()
        tasks=[x for x in self.store.snapshot()["items"] if x["kind"] == "ticket"]
        self.store.archive(tasks[0]["id"],True,"angela",tasks[0]["version"])
        archived=self.store.archive(e["id"],True,"angela",e["version"])
        self.assertTrue(all(x["archived"] for x in self.store.snapshot()["items"] if x.get("boardId") == e["boardId"]))
        self.store.archive(e["id"],False,"angela",archived["version"])
        self.assertTrue(self.store.details(tasks[0]["id"])["item"]["archived"])
        self.assertFalse(self.store.details(tasks[1]["id"])["item"]["archived"])

    def test_archived_board_cannot_accept_task_or_comment(self):
        t=self.task();board=self.store.details("dramaturgia")["item"]
        self.store.archive(board["id"],True,"angela",board["version"])
        with self.assertRaises(world.Problem):self.task()
        with self.assertRaises(world.Problem):self.store.comment(t["id"],"Nota","angela",str(uuid.uuid4()))

    def test_default_template_not_archivable(self):
        with self.assertRaises(world.Problem):self.store.archive("default-template",True,"angela",1)

    def test_links_not_javascript_or_credentials(self):
        for url in ["javascript:alert(1)","http://example.com","https://user:pass@example.com"]:
            with self.assertRaises(world.Problem):self.create("person",{"name":"Nombre","website":url})

    def test_images_content_addressed_and_svg_rejected(self):
        import base64
        image=base64.b64encode(b"\x89PNG\r\n\x1a\n" + bytes(25)).decode()
        ident=self.store.upload(image)
        self.assertEqual(self.store.upload(image),ident)
        p=self.create("person",{"name":"Foto", "image":ident})
        self.assertEqual(p["image"],ident)
        with self.assertRaises(world.Problem):self.store.upload(base64.b64encode(b"<svg>payload</svg>").decode())
        with self.assertRaises(world.Problem):self.create("person",{"name":"Foto", "image":"../../secret"})

    def test_persistence_backups_and_export(self):
        t=self.task()
        again=world.Store(self.tmp.name)
        self.assertEqual(again.details(t["id"])["item"]["title"],"Escribir")
        self.assertTrue(list((Path(self.tmp.name)/"backups").glob("*.sqlite3")))
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as z:
            data=json.loads(z.read("mundo-scrib.json"))
            self.assertEqual(data["format"],"scrib-world-v1")
            self.assertNotIn("bridge-secret",z.namelist())
            self.assertNotIn("password",json.dumps(data))

    def test_calendar_utc_dst_and_unicode_folding(self):
        e=self.event(title="Función " + "Á" * 110,start="2026-10-20T19:00",description="Texto, con; salto\nDos líneas")
        data=world.ics(self.store.snapshot()).decode()
        self.assertIn("DTSTART:20261020T170000Z",data)
        self.assertIn("UID:"+e["id"],data)
        self.assertTrue(all(len(line.encode())<=75 for line in data.split("\r\n")))
        self.assertIn("\\nDos líneas",data)

    def test_bad_dates_and_end_before_start(self):
        for date in ["wrong","2026-02-30T19:00","2026-03-29T02:30"]:
            with self.assertRaises(world.Problem):self.event(start=date)
        with self.assertRaises(world.Problem):self.event(end="2026-10-20T18:00")

    def test_date_only_bolo_has_pending_hour_and_all_tasks(self):
        event = self.event(start="2026-11-07")
        self.assertEqual(event['start'], '2026-11-07')
        tasks=[x for x in self.store.snapshot()['items'] if x['kind']=='ticket' and x['boardId']==event['boardId']]
        self.assertEqual(len(tasks),34)
        self.assertTrue(all(t['status']=='todo' for t in tasks))
        data=world.ics(self.store.snapshot()).decode()
        self.assertIn('DTSTART;VALUE=DATE:20261107',data)
        self.assertIn('DTEND;VALUE=DATE:20261108',data)
        self.assertIn('TRANSP:TRANSPARENT',data)
        self.assertIn('Horario pendiente',data)
        self.assertNotIn('DTSTART:20261107T',data)
        for start in ['2026-02-30','2026-13-07']:
            with self.assertRaises(world.Problem):self.event(start=start)
        with self.assertRaises(world.Problem):self.event(start='2026-11-07',end='2026-11-07T21:00')

    def test_add_or_remove_bolo_hour_keeps_its_board_and_tasks(self):
        e=self.event(start='2026-11-07')
        with_hour=self.store.update(e['id'],dict(e,start='2026-11-07T20:00'),'angela',e['version'])
        self.assertEqual(with_hour['start'],'2026-11-07T20:00+01:00')
        no_hour=self.store.update(e['id'],dict(with_hour,start='2026-11-07'),'angela',with_hour['version'])
        self.assertEqual(no_hour['start'],'2026-11-07')
        self.assertEqual(no_hour['boardId'],e['boardId'])
        self.assertEqual(len([x for x in self.store.snapshot()['items'] if x['kind']=='ticket']),34)

    def test_max_lengths_and_invalid_kind(self):
        with self.assertRaises(world.Problem):self.task(title="x"*241)
        with self.assertRaises(world.Problem):self.create("system",{"title":"No"})
        with self.assertRaises(world.Problem):self.task(status="invented")


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=world.App(0,world.Store(self.tmp.name),secret="unit-test-secret-not-real")
        self.port=self.app.server_address[1]
        self.thread=threading.Thread(target=self.app.serve_forever,daemon=True);self.thread.start()
        self.headers={"X-Scrib-Bridge":"unit-test-secret-not-real","X-Scrib-User":"angela","X-Scrib-Role":"user"}

    def tearDown(self):
        self.app.shutdown();self.app.server_close();self.thread.join();self.tmp.cleanup()

    def req(self,path="api/state",data=None,headers=None,raw=False):
        conn=http.client.HTTPConnection("127.0.0.1",self.port,timeout=5)
        merged=dict(self.headers);merged.update(headers or {})
        if data is not None:merged["Content-Type"]="application/json"
        conn.request("POST" if data is not None else "GET",world.WORLD_ROOT if path=="" else world.PREFIX+path,body=json.dumps(data) if data is not None else None,headers=merged)
        resp=conn.getresponse();body=resp.read();status=resp.status;out=dict(resp.getheaders());conn.close()
        return status,body if raw else json.loads(body),out

    def csrf(self):
        status,body,headers=self.req()
        self.assertEqual(status,200)
        return {"X-CSRF-Token":body["csrf"],"Cookie":headers["Set-Cookie"].split(";")[0],"Origin":"https://sutura.ddns.net"}

    def test_every_asset_and_api_requires_bridge_identity(self):
        for path in ["","app.js","activity.js","app.css","api/state","api/calendar.ics","api/export.zip","images/fake.png"]:
            status,_,_=self.req(path,headers={"X-Scrib-Bridge":""})
            self.assertEqual(status,401)

    def test_world_activity_asset_is_authenticated_and_loaded_before_app(self):
        status, body, headers = self.req("activity.js", raw=True)
        self.assertEqual(status, 200)
        self.assertIn("application/javascript", headers["Content-Type"])
        self.assertIn(b"visibilityState", body)
        status, body, _ = self.req("", raw=True)
        self.assertEqual(status, 200)
        self.assertLess(body.index(b"activity.js"), body.index(b"app.js"))

    def test_csrf_required_and_cross_origin_blocked(self):
        payload={"kind":"person","data":{"name":"Persona"},"requestId":str(uuid.uuid4())}
        status,_,_=self.req("api/create",payload);self.assertEqual(status,403)
        headers=self.csrf();headers["Origin"]="https://evil.example"
        status,_,_=self.req("api/create",payload,headers);self.assertEqual(status,403)
        headers["Origin"]="https://sutura.ddns.net"
        status,body,_=self.req("api/create",payload,headers);self.assertEqual(status,200);self.assertEqual(body["item"]["name"],"Persona")

    def test_multi_tab_csrf_cookie_reused_not_rotated(self):
        h=self.csrf();_,body,headers=self.req(headers={"Cookie":h["Cookie"]})
        self.assertEqual(body["csrf"],h["X-CSRF-Token"])
        self.assertEqual(headers["Set-Cookie"].split(";")[0],h["Cookie"])

    def test_csrf_is_bound_to_user(self):
        h=self.csrf();h["X-Scrib-User"]="pablo"
        status,_,_=self.req("api/create",{"kind":"person","data":{"name":"Persona"},"requestId":str(uuid.uuid4())},h)
        self.assertEqual(status,403)

    def test_bad_csrf_cookie_does_not_cause_internal_error(self):
        payload={"kind":"person","data":{"name":"Persona"},"requestId":str(uuid.uuid4())}
        for cookie in ["scrib_world_csrf=broken", 'scrib_world_csrf="not.a.signature"']:
            h={"Cookie":cookie,"Origin":"https://sutura.ddns.net","X-CSRF-Token":"bad"}
            status,_,_=self.req("api/create",payload,h)
            self.assertEqual(status,403)

    def test_admin_export_and_csp(self):
        status,_,headers=self.req();self.assertEqual(status,200)
        self.assertIn("script-src 'self'",headers["Content-Security-Policy"])
        self.assertIn("Secure",headers["Set-Cookie"])
        status,_,_=self.req("api/export.zip");self.assertEqual(status,403)
        status,data,_=self.req("api/export.zip",headers={"X-Scrib-Role":"admin"},raw=True);self.assertEqual(status,200);self.assertTrue(data.startswith(b"PK"))

    def test_invalid_json_shape_not_internal_error(self):
        status,_,_=self.req("api/create",{"kind":None,"data":None,"requestId":str(uuid.uuid4())},self.csrf())
        self.assertEqual(status,400)

    def test_traversal_and_oversize(self):
        status,_,_=self.req("images/../../bridge-secret");self.assertEqual(status,404)
        headers=self.csrf();headers["Content-Length"]=str(world.MAX_BODY+1)
        status,_,_=self.req("api/create",{},headers);self.assertEqual(status,413)

    def test_whatsapp_routes_auth_csrf_and_owner_isolation(self):
        self.app.whatsapp=Mock()
        self.app.whatsapp.status.return_value={'configured':True,'ready':True,'message':'Conectado'}
        for path in ['api/whatsapp/status','api/whatsapp/messages']:
            self.assertEqual(self.req(path,headers={'X-Scrib-Bridge':''})[0],401)
        person=self.app.store.create('person',{'name':'Persona ficticia','phone':'+34900000001','phoneConfirmed':True},'angela',str(uuid.uuid4()))
        payload={'people':[person['id']],'text':'Hola {nombre}'}
        self.assertEqual(self.req('api/whatsapp/preview',payload)[0],403)
        h=self.csrf();status,body,_=self.req('api/whatsapp/preview',payload,h)
        self.assertEqual(status,200);self.app.whatsapp.send.assert_not_called()
        message={'draftId':body['item']['id'],'recipient':0,'confirmed':True}
        self.assertEqual(self.req('api/whatsapp/send',message)[0],403)
        h2=self.csrf();h2['X-Scrib-User']='pablo'
        self.assertEqual(self.req('api/whatsapp/send',message,h2)[0],403)
        self.assertEqual(self.req('api/whatsapp/send',message,h)[0],200)
        self.assertEqual(self.req('api/whatsapp/send',message,h)[0],200)
        self.app.whatsapp.send.assert_called_once()

    def test_demo_http_cannot_send_even_with_injected_bridge(self):
        self.app.demo=True;self.app.whatsapp=Mock()
        status,_,_=self.req('api/whatsapp/send',{'draftId':'fake','recipient':0,'confirmed':True},self.csrf())
        self.assertEqual(status,403);self.app.whatsapp.send.assert_not_called()


class ClientCopyTests(unittest.TestCase):
    def test_cast_does_not_show_identity_review_or_import_provenance(self):
        client = (ROOT / "public" / "app.js").read_text()
        for removed in ("Revisar identidad", "Identidad y teléfono comprobados", "Importado de", "Coincidencia pública", "Nombre pendiente de contrastar", "Fuente: fechas publicadas", "p.sourceGroup", "p.publicName"):
            self.assertNotIn(removed, client)
        self.assertIn("personHistory(p)", client)
        self.assertIn("p.participations", client)
        self.assertIn("p.participationCount", client)
        self.assertIn('"open-participation"', client)
        self.assertIn('"show-calendar"', client)
        self.assertIn('id="calendar-month"', client)
        self.assertNotIn('phoneConfirmed', client)
        self.assertIn('!p.phone?"disabled"', client)
        self.assertIn('profile.roleEditor(p.roles)', client)


class ParticipationTests(unittest.TestCase):
    def person(self, history=None):
        return dict(id="ana", kind="person", name="Ana", history=history or [])

    def event(self, **changes):
        return dict(id="bolo", kind="event", start="2026-03-27T20:00", title="<SCRI> B", venue="Sala", city="Madrid", status="completed", archived=False,
                    cast=[dict(personId="ana", role="Escritura", team="blue"), dict(personId="ana", role="Interpretación", team="blue")], **changes)

    def derive(self, person, *events):
        return with_participations([person, *events], "2026-10-08")[0]

    def test_multiple_roles_count_as_one_show(self):
        p = self.derive(self.person(), self.event())
        self.assertEqual(p["participationCount"], 1)
        self.assertEqual(len(p["participations"][0]["roles"]), 2)
        self.assertEqual(p["participations"][0]["eventId"], "bolo")

    def test_legacy_rows_deduplicated_and_calendar_is_authoritative(self):
        legacy = [dict(date="2026-03-27", title="SCRIB", venue="Sala", role=role) for role in ("Escritura", "Interpretación")]
        p = self.derive(self.person(legacy))
        self.assertEqual(p["participationCount"], 1)
        self.assertEqual(len(p["participations"][0]["roles"]), 2)
        p = self.derive(self.person(legacy), self.event())
        self.assertEqual(p["participationCount"], 1)
        self.assertEqual(p["participations"][0]["eventId"], "bolo")

    def test_future_pending_cancelled_and_archived_are_not_performed(self):
        legacy = [dict(date="2026-03-27", title="SCRIB", venue="Sala", role="Escritura")]
        for patch in [dict(status="pending"), dict(status="cancelled"), dict(archived=True), dict(cast=[])]:
            e = self.event(); e.update(patch)
            self.assertEqual(self.derive(self.person(legacy), e)["participationCount"], 0)
        e = self.event(); e["start"] = "2026-11-07"
        self.assertEqual(self.derive(self.person(), e)["participationCount"], 0)

    def test_no_history_bad_dates_and_unknown_cast_do_not_invent_shows(self):
        for history in [[], [dict(date="2026-99-27")], [dict(date="2027-01-01")], [dict(date="")]]:
            self.assertEqual(self.derive(self.person(history))["participationCount"], 0)
        self.assertNotIn("participationCount", self.person())

    def test_calendar_edits_do_not_resurrect_old_import_rows(self):
        legacy = [dict(date="2026-03-27", title="SCRIB", venue="Sala", role="Escritura")]
        e = self.event()
        e["historyKey"] = show_digest(show_key(e["start"], e["title"], e["venue"]))
        e.update(title="Nombre corregido", venue="Sala corregida", cast=[])
        self.assertEqual(self.derive(self.person(legacy), e)["participationCount"], 0)


class HistoryImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.person = self.store.create("person", dict(name="Ana Sempere", phone="+34900000001", phoneConfirmed=False), "test", str(uuid.uuid4()))
        self.sections = [dict(events=[dict(date="27 de marzo de 2026", time="20:00", name="<SCRI> B", venue="Sala Madrid", teams=[dict(color="blue", writer="Ana Sempere", performers="Ana Sempere · Persona no registrada")])])]

    def tearDown(self):
        self.tmp.cleanup()

    def run_import(self, apply=True, instagram=None):
        return import_history(self.store, self.sections, instagram, apply, "2026-10-08")

    def test_dry_run_changes_nothing(self):
        revision = self.store.snapshot()["revision"]
        self.assertEqual(len(self.run_import(False)["events"]), 1)
        self.assertEqual(self.store.snapshot()["revision"], revision)
        self.assertFalse(any(x["kind"] == "event" for x in self.store.snapshot()["items"]))

    def test_completed_show_without_prep_tasks_and_one_participation(self):
        self.run_import()
        items = self.store.snapshot()["items"]
        e = next(x for x in items if x["kind"] == "event")
        self.assertEqual(e["status"], "completed")
        self.assertTrue(e["historical"])
        self.assertEqual(len(e["cast"]), 2)
        self.assertIn("Persona no registrada", e["description"])
        self.assertEqual(len([x for x in items if x["kind"] == "person"]), 1)
        self.assertFalse(any(x["kind"] == "ticket" for x in items))
        self.assertTrue(any(x["id"] == e["boardId"] and x["eventId"] == e["id"] for x in items))
        p = next(x for x in items if x["kind"] == "person")
        self.assertEqual(p["participationCount"], 1)
        self.assertEqual(len(p["participations"][0]["roles"]), 2)
        self.assertNotIn("participationCount", self.store.details(p["id"])["item"])

    def test_rerun_preserves_manual_cast_title_and_metadata(self):
        ident = self.run_import()["events"][0]["id"]
        e = self.store.details(ident)["item"]
        self.store.update(ident, dict(e, title="Título corregido", cast=[]), "test", e["version"])
        report = self.run_import()
        self.assertTrue(report["events"][0]["existing"])
        e = self.store.details(ident)["item"]
        self.assertEqual(e["title"], "Título corregido")
        self.assertEqual(e["cast"], [])
        self.assertTrue(e["historical"])
        self.assertIn("historyKey", e)
        self.assertEqual(len([x for x in self.store.snapshot()["items"] if x["kind"] == "event"]), 1)

    def test_no_time_or_team_invented_and_future_not_imported(self):
        self.sections[0]["events"] = [dict(date="1 de febrero de 2025", name="SCRIB", venue="Casa", writers="Ana Sempere"), dict(date="7 de noviembre de 2026", name="León", venue="Universidad")]
        self.run_import()
        e = next(x for x in self.store.snapshot()["items"] if x["kind"] == "event")
        self.assertEqual(e["start"], "2025-02-01")
        self.assertEqual(e["city"], "")
        self.assertEqual(e["cast"][0]["team"], "general")

    def test_instagram_preserves_phone_and_does_not_replace_existing_link(self):
        ig = {"Ana Sempere": dict(url="https://www.instagram.com/_anasempere/", evidence="https://anasempere.es/")}
        self.run_import(instagram=ig)
        p = self.store.details(self.person["id"])["item"]
        self.assertEqual(p["instagram"], ig["Ana Sempere"]["url"])
        self.assertEqual(p["phone"], self.person["phone"])
        self.assertFalse(p.get("phoneConfirmed", False))
        ig["Ana Sempere"]["url"] = "https://instagram.com/another/"
        self.assertTrue(self.run_import(instagram=ig)["instagram"][0]["keptExisting"])
        self.assertEqual(self.store.details(p["id"])["item"]["instagram"], p["instagram"])

    def test_unverified_instagram_rolls_back_import(self):
        with self.assertRaises(ValueError):
            self.run_import(instagram={"Ana Sempere": dict(url="https://instagram.com/name/")})
        self.assertFalse(any(x["kind"] == "event" for x in self.store.snapshot()["items"]))
        with self.assertRaises(ValueError):
            published_day("30 de febrero de 2026")


class IntegrationTests(unittest.TestCase):
    def test_gateway_entry_insertion_is_idempotent(self):
        old='    .world--wit {\n      <a class="world world--wit" href="/wit/">'
        new=integrate.entry_html(old)
        self.assertEqual(new,integrate.entry_html(new))
        self.assertIn('href="https://sutura-gateway.ddns.net/scrib/"',new)
        self.assertIn('href="/wit/"',new)
        self.assertIn('src="/favicons/scrib-world-logo.png?v=1"',new)
        self.assertIn(integrate.SUBTITLE,new)

    def test_selector_upgrade_preserves_other_worlds_and_auth_bridge(self):
        surrounding='    .world--wit {\n      <a class="world world--wit" href="/wit/">'
        old=integrate.LEGACY_CSS+integrate.LEGACY_CARD+surrounding+integrate.BRIDGE
        new=integrate.update_selector(old)
        self.assertEqual(new,integrate.CSS+integrate.CARD+surrounding+integrate.BRIDGE)
        self.assertEqual(new,integrate.update_selector(new))
        self.assertEqual(new,integrate.entry_html(old))
        self.assertNotIn('bolos',new)

    def test_installed_selector_drift_fails_closed(self):
        old=integrate.LEGACY_CSS+integrate.LEGACY_CARD
        for drift in [old.replace('gap: 18px','gap: 20px'),old.replace('bolos','otro texto'),old+integrate.LEGACY_CARD]:
            with self.assertRaises(ValueError):integrate.update_selector(drift)

    def test_new_selector_keeps_logo_accessible_with_requested_subtitle(self):
        self.assertIn('alt="&lt;SCRI&gt; B"',integrate.CARD)
        self.assertIn('aria-label="Entrar en SCRIB"',integrate.CARD)
        self.assertIn('<span class="world-scrib-copy">' + integrate.SUBTITLE + '</span>',integrate.CARD)
        self.assertIn('object-fit: contain',integrate.CSS)
        self.assertIn('clamp(',integrate.CSS)

    def test_installed_logo_only_card_adds_subtitle_without_changing_other_worlds(self):
        surrounding = 'other worlds preserved' + integrate.BRIDGE
        for old_card in (integrate.LOGO_ONLY_CARD, integrate.RELATIVE_CARD, integrate.PREVIOUS_CARD):
            source = integrate.LOGO_ONLY_CSS + old_card + surrounding
            changed = integrate.update_selector(source)
            self.assertEqual(changed, integrate.CSS + integrate.CARD + surrounding)
            self.assertEqual(changed, integrate.update_selector(changed))

    def test_logo_only_selector_drift_fails_closed(self):
        source = integrate.LOGO_ONLY_CSS + integrate.LOGO_ONLY_CARD
        for drift in (source.replace('gap: 0;', 'gap: 1px;'), source.replace('width="500"', 'width="501"'), source + integrate.LOGO_ONLY_CARD):
            with self.assertRaises(ValueError):
                integrate.update_selector(drift)

    def test_existing_logo_card_uses_gateway_even_when_primary_server_sleeps(self):
        source = integrate.CSS + integrate.RELATIVE_CARD + integrate.BRIDGE + "other worlds preserved"
        changed = integrate.update_selector(source)
        self.assertEqual(changed, integrate.CSS + integrate.CARD + integrate.BRIDGE + "other worlds preserved")
        self.assertEqual(changed, integrate.update_selector(changed))

    def test_subtitle_selector_upgrades_atomically_and_keeps_other_worlds(self):
        surrounding = '<a href="/sutura/">Sutura</a>' + integrate.BRIDGE
        source = integrate.SUBTITLE_CSS + integrate.SUBTITLE_CARD + surrounding
        changed = integrate.update_selector(source)
        self.assertEqual(changed, integrate.CSS + integrate.CARD + surrounding)
        self.assertEqual(changed, integrate.update_selector(changed))
        self.assertIn('world-scrib-stage', integrate.CARD)
        self.assertIn('prefers-reduced-motion: reduce', integrate.CSS)
        self.assertIn('scrib-world-reveal .5s ease-out 1', integrate.CSS)
        self.assertNotIn('infinite', integrate.CSS)
        self.assertNotIn('filter: blur', integrate.CSS)
        for drift in (source.replace('gap: 12px', 'gap: 13px'), source + integrate.SUBTITLE_CARD):
            with self.assertRaises(ValueError):
                integrate.update_selector(drift)

    def test_drift_fails_closed(self):
        with self.assertRaises(ValueError):integrate.entry_html("changed portal")


class MessageTests(StoreTests):
    # Inherit the existing persistence tests as well as message-specific checks.
    def person(self, name="Elenco ficticio", phone="+34900000001", confirmed=True):
        return self.create("person",{"name":name,"phone":phone,"phoneConfirmed":confirmed})

    def preview(self, people=None, **changes):
        p = self.person() if people is None else None
        return self.store.message_preview({"people":people or [p['id']],"text":"Hola {nombre_completo}",**changes},"angela")

    def send(self, draft, bridge=None, **changes):
        bridge=bridge or Mock()
        return self.store.message_send({"draftId":draft['id'],"recipient":0,"confirmed":True,**changes},"angela",bridge)

    def test_phone_normalization_and_validation(self):
        self.assertEqual(phone_number('900 000 001'),'+34900000001')
        self.assertEqual(phone_number('0034 900 000 001'),'+34900000001')
        for invalid in ['+0123456789','+123','javascript:1','+12345678901234567','123ext45']:
            with self.assertRaises(WhatsappProblem):phone_number(invalid)

    def test_phone_confirmation_no_longer_requested_and_legacy_flag_is_not_asserted(self):
        p=self.person(confirmed=False)
        self.assertNotIn('phoneConfirmed',p)
        changed=self.store.update(p['id'],dict(p,bio='Nota'),'angela',p['version'])
        self.assertNotIn('phoneConfirmed',changed)
        # Preserve old metadata without pretending it was checked or using it to gate.
        with self.store.connect() as db:
            old=dict(changed,phoneConfirmed=False)
            db.execute('UPDATE items SET body=? WHERE id=?',(json.dumps(old),p['id']))
        updated=self.store.update(p['id'],dict(changed,phone='+34900000002'),'angela',changed['version'])
        self.assertFalse(updated['phoneConfirmed'])
        self.assertEqual(self.preview([p['id']])['people'][0]['phone'],'+34900000002')

    def test_preview_does_not_send_and_keeps_linebreaks(self):
        d=self.preview(text='Hola {nombre},\n\n¿Ensayamos?')
        self.assertIn('\n\n',d['people'][0]['text'])
        self.assertEqual(self.store.messages('angela')[0]['people'][0]['delivery']['status'],'pending')
        self.assertEqual(self.store.messages('pablo'),[])

    def test_valid_phone_needs_no_profile_confirmation_but_absent_phone_blocks(self):
        p=self.person(confirmed=False)
        draft=self.preview([p['id']]);bridge=Mock()
        self.assertEqual(self.send(draft,bridge)['status'],'sent')
        bridge.send.assert_called_once_with(p['phone'],draft['people'][0]['text'])
        p=self.person(phone='',confirmed=False)
        with self.assertRaises(world.Problem):self.preview([p['id']])

    def test_duplicate_phone_and_bad_variables_rejected(self):
        p,q=self.person(),self.person('Otro')
        with self.assertRaises(world.Problem):self.preview([p['id'],q['id']])
        for template in ['Hola {unknown}','Hola {{nombre}}','Hola {nombre','{hora}']:
            with self.assertRaises(WhatsappProblem):self.preview([p['id']],text=template)

    def test_event_personalization_and_non_cast_recipient_blocked(self):
        p=self.person();e=self.event(venue='Sala ficticia',cast=[{'personId':p['id'],'role':'Escritura','team':'blue'}])
        d=self.preview([p['id']],eventId=e['id'],text='{nombre} · {bolo} · {fecha} · {hora} · {lugar} · {papel}')
        self.assertIn('20/10/2026 · 19:00 · Sala ficticia · Escritura',d['people'][0]['text'])
        q=self.person('Otra persona','+34900000002')
        with self.assertRaises(world.Problem):self.preview([q['id']],eventId=e['id'])

    def test_pending_hour_is_never_invented_in_whatsapp(self):
        p=self.person();e=self.event(start='2026-11-07',cast=[{'personId':p['id'],'role':'Participación'}])
        with self.assertRaises(WhatsappProblem):self.preview([p['id']],eventId=e['id'],text='Nos vemos a las {hora}')
        d=self.preview([p['id']],eventId=e['id'],text='Nos vemos el {fecha}')
        self.assertEqual(d['people'][0]['text'],'Nos vemos el 07/11/2026')

    def test_idempotent_send_including_concurrent_double_click(self):
        d=self.preview();bridge=Mock()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.send(d,bridge),range(4)))
        self.assertEqual(bridge.send.call_count,1)
        self.assertEqual(sum(not r['duplicate'] for r in results),1)
        self.assertEqual(self.store.messages('angela')[0]['people'][0]['delivery']['status'],'sent')

    def test_network_failure_never_auto_retries(self):
        d=self.preview();bridge=Mock();bridge.send.side_effect=TimeoutError()
        self.assertEqual(self.send(d,bridge)['status'],'unknown')
        self.assertTrue(self.send(d,bridge)['duplicate'])
        self.assertEqual(bridge.send.call_count,1)

    def test_crash_in_flight_remains_uncertain_and_not_retryable(self):
        d=self.preview();bridge=Mock()
        with self.store.connect() as db:db.execute('INSERT INTO message_deliveries VALUES(?,?,?,?)',(d['id'],0,'sending',world.now()))
        self.assertEqual(self.send(d,bridge)['status'],'unknown')
        bridge.send.assert_not_called()

    def test_expired_and_changed_profile_or_event_previews_blocked(self):
        p=self.person();d=self.preview([p['id']]);bridge=Mock()
        self.store.update(p['id'],dict(p,name='Otro nombre'),'angela',p['version'])
        with self.assertRaises(world.Problem):self.send(d,bridge)
        d=self.preview([p['id']])
        with self.store.connect() as db:db.execute('UPDATE message_drafts SET expires=? WHERE id=?',(time.time()-1,d['id']))
        with self.assertRaises(world.Problem):self.send(d,bridge)
        e=self.event(cast=[{'personId':p['id'],'role':'Escritura'}]);d=self.preview([p['id']],eventId=e['id'])
        self.store.update(e['id'],dict(e,venue='Otra sala'),'angela',e['version'])
        with self.assertRaises(world.Problem):self.send(d,bridge)
        bridge.send.assert_not_called()

    def test_wrong_actor_or_non_integer_recipient_cannot_send(self):
        d=self.preview();bridge=Mock()
        with self.assertRaises(world.Problem):self.send(d,bridge,recipient=True)
        with self.assertRaises(world.Problem):self.store.message_send({'draftId':d['id'],'recipient':0,'confirmed':True},'pablo',bridge)
        bridge.send.assert_not_called()

    def test_demo_bridge_disabled_and_non_loopback_config_rejected(self):
        self.assertFalse(Bridge(disabled=True).status()['configured'])
        config=Path(self.tmp.name)/'config.json'
        config.write_text(json.dumps({'host':'example.org','port':5118,'token':'fake'}))
        with self.assertRaises(WhatsappProblem):Bridge(config).config()

    def test_export_contains_message_history_without_bridge_secrets(self):
        self.preview()
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as z:
            data=json.loads(z.read('mundo-scrib.json'))
        self.assertEqual(len(data['messageDrafts']),1)
        self.assertNotIn('token',data)

    def test_public_schedule_parser_never_executes_javascript(self):
        public='var scheduleSections = [{year:2026,events:[{date:"24 de septiembre de 2026",venue:"Sala",teams:[{color:"red",writer:"Persona Ficticia",performers:"Otra Persona"}]}]}]; other();'
        history=public_history(schedule_literal(public))
        self.assertEqual(history['Persona Ficticia'][0]['team'],'red')
        for malicious in ['var scheduleSections = [alert(1)];','var scheduleSections = [{get events(){return []}}];','var scheduleSections = [] + malicious();']:
            with self.assertRaises(ValueError):schedule_literal(malicious)

    def test_group_import_scoped_idempotent_and_keeps_manual_edits(self):
        history={'Persona Ficticia':[{'date':'2026-09-24','venue':'Sala','title':'SCRIB','role':'Escritura','team':'general','source':'https://scribshow.es/'}]}
        roster={'group':{'id':'fake@g.us','name':'<SCRI> B en la Universidad de León [7 de noviembre]'},'participants':[{'id':'34900000001@c.us','name':'Persona','pushname':'Persona Ficticia','phone':'34900000001'},{'id':'999999999999@lid','name':'Otra','phone':'999999999999'}]}
        report=import_roster(self.store,roster,history,apply=False)
        self.assertTrue(report[0]['matched']);self.assertFalse(report[1]['phoneAvailable'])
        self.assertFalse(any(x['kind']=='person' for x in self.store.snapshot()['items']))
        import_roster(self.store,roster,history,apply=True);import_roster(self.store,roster,history,apply=True)
        people=[p for p in self.store.snapshot()['items'] if p['kind']=='person']
        self.assertEqual(len(people),2)
        person=next(p for p in people if p.get('publicName')=='Persona Ficticia')
        self.assertFalse(person.get('phoneConfirmed',False))
        updated=self.store.update(person['id'],dict(person,bio='Manual'),'angela',person['version'])
        self.assertEqual(updated['history'][0]['venue'],'Sala')
        roster['group']['name']='Otro grupo'
        with self.assertRaises(ValueError):import_roster(self.store,roster,history,apply=True)


ProblemException = (world.Problem, WhatsappProblem)


if __name__ == "__main__":
    unittest.main()
