"""Private, explicit one-to-one messaging through the existing local bridge."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path


class WhatsappProblem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def phone_number(value):
    if not isinstance(value, str) or len(value) > 40:
        raise WhatsappProblem("Teléfono no válido.")
    if not value.strip():
        return ""
    if not re.fullmatch(r"[+\d\s().-]+", value):
        raise WhatsappProblem("Usa un teléfono con prefijo internacional, sin extensiones.")
    digits = re.sub(r"\D", "", value)
    if digits.startswith("00"):
        digits = digits[2:]
    elif len(digits) == 9 and not value.strip().startswith("+"):
        digits = "34" + digits
    if not re.fullmatch(r"[1-9]\d{7,14}", digits):
        raise WhatsappProblem("Indica un teléfono válido con prefijo internacional (por ejemplo, +34).")
    return "+" + digits


def personalize(template, context):
    if not isinstance(template, str) or not template.strip() or len(template) > 4000:
        raise WhatsappProblem("Escribe un mensaje de hasta 4.000 caracteres.")
    fields = set(re.findall(r"\{([^{}]+)\}", template))
    if fields - context.keys() or template.count("{") != len(re.findall(r"\{[^{}]+\}", template)) or template.count("}") != template.count("{"):
        raise WhatsappProblem("Variables disponibles: {nombre}, {nombre_completo}, {bolo}, {fecha}, {hora}, {lugar}, {convocatoria}, {papel}.")
    missing = [f for f in fields if not context[f]]
    if missing:
        raise WhatsappProblem("Faltan datos para estas variables: " + ", ".join(sorted(missing)) + ". Completa el bolo o cambia el mensaje.")
    result = re.sub(r"\{([^{}]+)\}", lambda m: context[m[1]], template).strip()
    if len(result) > 8000:
        raise WhatsappProblem("El mensaje personalizado es demasiado largo.")
    return result


class Bridge:
    def __init__(self, config_path=None, disabled=False):
        self.path = Path(config_path or os.environ.get("SCRIB_WORLD_WHATSAPP_CONFIG", "/home/trescejas/dockers/impropios/whatsapp-bridge/config.json"))
        self.disabled = disabled

    def config(self):
        if self.disabled:
            raise WhatsappProblem("WhatsApp está desactivado en el ensayo local.", 503)
        try:
            config = json.loads(self.path.read_text())
            local = self.path.with_name("config.local.json")
            if local.exists():
                config.update(json.loads(local.read_text()))
            host, port, token = config.get("host", "127.0.0.1"), int(config.get("port", 5118)), config.get("token", "")
            if host not in ("127.0.0.1", "localhost", "::1") or not 1 <= port <= 65535 or not isinstance(token, str) or not token:
                raise ValueError()
            return "http://127.0.0.1:" + str(port), token
        except (OSError, ValueError, TypeError):
            raise WhatsappProblem("No está configurada la conexión local de WhatsApp.", 503) from None

    def request(self, path, body=None):
        base, token = self.config()
        request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                         headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        # The bridge is loopback-only; never inherit proxy settings or follow redirects.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(request, timeout=12) as response:
                payload = json.loads(response.read(2 * 1024 * 1024))
            if not isinstance(payload, dict) or not payload.get("ok"):
                raise ValueError()
            return payload
        except (OSError, ValueError):
            # Provider errors may include credentials, phone numbers or unrelated chats.
            raise WhatsappProblem("WhatsApp no ha confirmado la operación. Comprueba su conexión.", 503) from None

    def status(self):
        try:
            self.config()
        except WhatsappProblem as error:
            return {"configured": False, "ready": False, "message": str(error)}
        try:
            state = self.request("/health")
            return {"configured": True, "ready": bool(state.get("ready") and state.get("authenticated")),
                    "message": "WhatsApp conectado" if state.get("ready") and state.get("authenticated") else "WhatsApp necesita reconectarse en Impropios"}
        except WhatsappProblem:
            return {"configured": True, "ready": False, "message": "No se puede contactar con el puente de WhatsApp"}

    def send(self, phone, message):
        result = self.request("/send-direct", {"phone": phone_number(phone).lstrip("+"), "text": message})
        if result.get("sent") is not True:
            raise WhatsappProblem("WhatsApp no ha confirmado el envío.", 503)
