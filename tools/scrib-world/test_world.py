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
from pathlib import Path

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
        conn.request("POST" if data is not None else "GET",world.PREFIX+path,body=json.dumps(data) if data is not None else None,headers=merged)
        resp=conn.getresponse();body=resp.read();status=resp.status;out=dict(resp.getheaders());conn.close()
        return status,body if raw else json.loads(body),out

    def csrf(self):
        status,body,headers=self.req()
        self.assertEqual(status,200)
        return {"X-CSRF-Token":body["csrf"],"Cookie":headers["Set-Cookie"].split(";")[0],"Origin":"https://sutura.ddns.net"}

    def test_every_asset_and_api_requires_bridge_identity(self):
        for path in ["","app.js","app.css","api/state","api/calendar.ics","api/export.zip","images/fake.png"]:
            status,_,_=self.req(path,headers={"X-Scrib-Bridge":""})
            self.assertEqual(status,401)

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


class IntegrationTests(unittest.TestCase):
    def test_gateway_entry_insertion_is_idempotent(self):
        old='    .world--wit {\n      <a class="world world--wit" href="/wit/">'
        new=integrate.entry_html(old)
        self.assertEqual(new,integrate.entry_html(new))
        self.assertIn('href="/mundo-scrib/"',new)
        self.assertIn('href="/wit/"',new)

    def test_drift_fails_closed(self):
        with self.assertRaises(ValueError):integrate.entry_html("changed portal")


if __name__ == "__main__":
    unittest.main()
