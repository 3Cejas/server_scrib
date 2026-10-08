"""Scoped power integration tests. Never import the production power service."""
import ast
import io
import os
from pathlib import Path
import unittest
from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse
import integrate
import rename_world


GATEWAY = '''from gateway_availability import is_availability_location

''' + integrate.WORLD_SERVICE_KEY + '''        prefix = f"/{key}"
        if path == prefix or path.startswith(prefix + "/"):
            return key
    return ""

def service_theme(next_uri):
    path = urlparse(next_uri).path or next_uri or "/"
    if path.startswith("/wit/") or path == "/wit":
        return {"label": "WIT"}
    return {"label": "Sutura"}

def is_world_location(value):
    path = urlparse(str(value or "")).path or "/"
    return is_availability_location(value) or path == "/mundo-scrib" or path.startswith("/mundo-scrib/") or any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in WORLD_ACTIVITY_PREFIXES)

STYLES = """
    .theme-wit {{
    .theme-wit {{
"""
'''


def isolated_functions(source, names, namespace):
    tree = ast.parse(source)
    selected = [x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name in names]
    if len(selected) != len(names):
        raise ValueError("Gateway functions changed; review before testing/deploying.")
    exec(compile(ast.Module(body=selected, type_ignores=[]), "isolated-gateway", "exec"), namespace)
    return namespace


class PowerIntegrationTests(unittest.TestCase):
    def test_gateway_patch_preserves_other_code_and_is_idempotent(self):
        source = GATEWAY + "\nUNRELATED = 'preserve me'\n"
        changed = integrate.world_power_gateway(source)
        self.assertEqual(changed, integrate.world_power_gateway(changed))
        self.assertIn("UNRELATED = 'preserve me'", changed)
        self.assertEqual(changed.count(integrate.SCRIB_WAKE_STYLES),2)
        ns = isolated_functions(changed, ["world_service_key", "service_theme", "is_world_location"], {
            "urlparse":urlparse, "WORLD_ACTIVITY_PREFIXES":["/sutura/","/impropios/","/wit/","/trescejas/"],
            "is_availability_location":lambda _:False,
        })
        for path in ["/mundo-scrib", "/mundo-scrib/", "/mundo-scrib/?from=link", "/mundo-scrib/api/state"]:
            self.assertEqual(ns["world_service_key"](path), "sutura")
            self.assertTrue(ns["is_world_location"](path))
            self.assertEqual(ns["service_theme"](path)["label"], "<SCRI> B")
            self.assertEqual(ns["service_theme"](path)["class"], "theme-scrib")
        for path in ["/mundo-scrib-evil/", "/mundo-scribble", "/scrib-disponibilidad/signed"]:
            self.assertEqual(ns["world_service_key"](path), "")
            self.assertFalse(ns["is_world_location"](path))
        for key in ["sutura", "impropios", "wit", "trescejas"]:
            self.assertEqual(ns["world_service_key"]("/" + key + "/"), key)
        self.assertEqual(ns["service_theme"]("/wit/")["label"], "WIT")

    def test_changed_gateway_fails_closed(self):
        for source in [GATEWAY.replace('for key in (', 'for realm in ('), GATEWAY + integrate.SCRIB_WAKE_THEME, GATEWAY + GATEWAY]:
            with self.assertRaises(ValueError):integrate.world_power_gateway(source)

    def test_gateway_routes_reuse_existing_wake_and_do_not_change_other_worlds(self):
        original = "# Other routes unchanged\nlocation = /sutura {\n    return 302 /sutura/;\n}\n"
        result = integrate.world_power_gateway_nginx(original)
        self.assertEqual(result, integrate.world_power_gateway_nginx(result))
        self.assertIn(original.splitlines()[0], result)
        self.assertTrue(result.endswith('location = /sutura {\n    return 302 /sutura/;\n}\n'))
        for expected in ['auth_request /_wake/check;', 'error_page 401 = @wake_backend;', 'X-Sutura-Gateway-Entry 1;', 'sutura-proxy-common.conf;']:
            self.assertIn(expected, result)

    def test_primary_world_redirect_keeps_authentik_and_public_forms(self):
        original = 'location = /_auth_check {\n}\n' + integrate.PUBLIC_NGINX
        result = integrate.world_power_nginx(original)
        self.assertEqual(result, integrate.world_power_nginx(result))
        self.assertTrue(result.startswith(original))
        self.assertIn('https://sutura-gateway.ddns.net$request_uri', result)
        self.assertIn('nginx-forward-auth-snippet.conf;', result)
        self.assertIn('proxy_pass http://127.0.0.1:5099;', result)

    def test_changed_routes_fail_closed(self):
        for fn, original in [(integrate.world_power_nginx,'location = /_auth_check {\n}\n'), (integrate.world_power_gateway_nginx,'location = /sutura {\n}\n')]:
            for source in ["changed",original+'location = /mundo-scrib {}',original+'# SCRIB WORLD POWER ENTRY drift']:
                with self.assertRaises(ValueError):fn(source)


@unittest.skipUnless(os.getenv("SCRIB_GATEWAY_SOURCE"), "Optional isolated tests against an installed gateway source")
class InstalledGatewayTests(unittest.TestCase):
    def setUp(self):
        source = Path(os.environ["SCRIB_GATEWAY_SOURCE"]).read_text()
        self.source = source if rename_world.NEW_CONDITION in source else integrate.world_power_gateway(source)
        self.ns = isolated_functions(self.source, ["is_world_location", "world_service_key", "wake_target_is_supported", "wake_request_is_allowed"], {
            "urlparse":urlparse, "WORLD_ACTIVITY_PREFIXES":["/sutura/","/wit/","/impropios/","/trescejas/"],
            "WAKE_SUPPORT_PREFIXES":["/outpost.goauthentik.io/"], "is_availability_location":lambda _:False,
            "has_world_session_cookie":lambda cookie:cookie=="valid-signed-session",
        })

    def method(self, name, **extra):
        handler = next(x for x in ast.parse(self.source).body if isinstance(x, ast.ClassDef) and x.name=="Handler")
        method = next(x for x in handler.body if isinstance(x, ast.FunctionDef) and x.name==name)
        ns = dict(self.ns, parse_qs=parse_qs, safe_next=lambda path:path, print=lambda *a,**kw:None,
            read_wake_context=lambda *_:{}, is_authentik_wake_location=lambda _:False,
            is_automated_client=lambda _:False, **extra)
        exec(compile(ast.Module(body=[method],type_ignores=[]),"isolated-"+name,"exec"),ns)
        return ns

    def request(self, path="/wake?next=/mundo-scrib/"):
        request=Mock(path=path, headers={"X-Forwarded-For":"192.0.2.1", "User-Agent":"Test browser"}, client_address=("127.0.0.1",123))
        request.client_ip.return_value="192.0.2.1"
        return request

    def test_real_wake_policy_keeps_confirmation_and_only_accepts_verified_session(self):
        self.assertTrue(self.ns["wake_target_is_supported"]("/mundo-scrib/"))
        allowed = self.ns["wake_request_is_allowed"]
        self.assertFalse(allowed("/mundo-scrib/", forwarded_for="192.0.2.1"))
        self.assertFalse(allowed("/mundo-scrib/", cookie_header="authentik_session=unverified", forwarded_for="192.0.2.1"))
        self.assertTrue(allowed("/mundo-scrib/", cookie_header="valid-signed-session", forwarded_for="192.0.2.1"))
        self.assertTrue(allowed("/mundo-scrib/", has_context=True, forwarded_for="192.0.2.1"))
        self.assertFalse(allowed("/mundo-scribble", has_context=True, forwarded_for="192.0.2.1"))

    def test_real_activity_handler_only_records_visible_world_and_uses_sutura_identity(self):
        ns = self.method("handle_activity",
            activity_user_from_cookie=Mock(return_value="User (sutura)"), record_browser_activity=Mock())
        request=self.request()
        for path in ["/activity?visible=0&path=/mundo-scrib/", "/activity?visible=1&path=/mundo-scribble"]:
            request.path=path;ns["handle_activity"](request)
        ns["record_browser_activity"].assert_not_called()
        request.path="/activity?visible=1&path=/mundo-scrib/";ns["handle_activity"](request)
        ns["record_browser_activity"].assert_called_once_with("/mundo-scrib/","192.0.2.1","User (sutura)","Test browser","sutura")
        ns["activity_user_from_cookie"].assert_called_once_with("","192.0.2.1","Test browser","sutura")

    def test_offline_entry_shows_confirmation_and_does_not_power_on_without_click(self):
        ns=self.method("do_GET")
        request=self.request();ns["do_GET"](request)
        request.send_wake_confirmation.assert_called_once_with("/mundo-scrib/","192.0.2.1")
        request.send_wake_result.assert_not_called()

    def test_wake_button_consumes_same_origin_intent_then_starts_the_world(self):
        ns=self.method("do_POST", consume_wake_intent=Mock(return_value=(True,"")))
        request=self.request("/wake")
        body=b"next=%2Fmundo-scrib%2F&intent=test-confirmation"
        request.headers["Content-Length"]=str(len(body));request.rfile=io.BytesIO(body)
        request.same_origin_submission.return_value=True
        ns["do_POST"](request)
        ns["consume_wake_intent"].assert_called_once_with("test-confirmation","/mundo-scrib/","192.0.2.1","Test browser")
        request.send_wake_result.assert_called_once_with("/mundo-scrib/","192.0.2.1")

    def test_invalid_wake_intent_or_cross_origin_does_not_power_on(self):
        for same_origin, consumed in [(False,(True,"")),(True,(False,"Expired"))]:
            ns=self.method("do_POST",consume_wake_intent=Mock(return_value=consumed))
            request=self.request("/wake");body=b"next=%2Fmundo-scrib%2F&intent=invalid"
            request.headers["Content-Length"]=str(len(body));request.rfile=io.BytesIO(body)
            request.same_origin_submission.return_value=same_origin
            ns["do_POST"](request);request.send_wake_result.assert_not_called()

    def test_wake_result_goes_to_requested_world_only_when_ready(self):
        for status in ["ready","starting"]:
            ns=self.method("send_wake_result", update_state=Mock(), wake_context_cookie=Mock(return_value="signed context"),
                maybe_powerup=Mock(return_value=(status,"")), now=lambda:0, loading_page=Mock(return_value="Loading world"))
            request=self.request();request.command="POST"
            ns["send_wake_result"](request,"/mundo-scrib/","192.0.2.1")
            ns["maybe_powerup"].assert_called_once()
            ns["wake_context_cookie"].assert_called_once_with("/mundo-scrib/","Test browser")
            if status=="ready":
                request.send_response.assert_called_once_with(302)
                request.send_header.assert_any_call("Location","/mundo-scrib/")
            else:
                request.send_html.assert_called_once_with(200,"Loading world",{"Set-Cookie":"signed context"})


if __name__ == "__main__":unittest.main()
