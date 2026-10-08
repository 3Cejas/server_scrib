"""Verify only a SCRIB form capability; never grant a private-world session."""
import base64
import hashlib
import hmac
import re
from pathlib import Path
from urllib.parse import urlparse


def is_availability_location(value, key_path='/opt/sutura-gateway/scrib-availability-key'):
    path = urlparse(str(value or '')).path
    match = re.fullmatch(r'/scrib-disponibilidad/([A-Za-z0-9_-]{43})/?', path)
    if not match:
        return False
    try:
        key = Path(key_path).read_bytes()
        decoded = base64.urlsafe_b64decode(match[1] + '=')
        expected = hmac.new(key, b'scrib-availability|' + decoded[:16], hashlib.sha256).digest()[:16]
        return len(key) == 32 and len(decoded) == 32 and hmac.compare_digest(decoded[16:], expected)
    except (OSError, ValueError):
        return False
