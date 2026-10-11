"""Trusted, authenticated games moved out of the public SCRIB terminal."""
import mimetypes
from pathlib import Path

PREFIX = '/scrib/backstage/laboratory/'
POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://sutura-gateway.ddns.net wss://sutura-gateway.ddns.net; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'"
DEMO_POLICY = POLICY.replace("; object-src", " http://localhost:3000 ws://localhost:3000 http://127.0.0.1:3000 ws://127.0.0.1:3000; object-src")


class LaboratoryLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.files = {}
        for folder in ('bolzano', 's7', 'shared'):
            for path in (self.root / folder).rglob('*'):
                if (path.is_file() and not path.is_symlink()
                        and path.resolve().is_relative_to(self.root)
                        and path.suffix.lower() in ('.html', '.js', '.css', '.ttf')):
                    self.files[path.relative_to(self.root).as_posix()] = path

    def file(self, route):
        if route in ('bolzano/', 's7/'):
            route += 'index.html'
        path = self.files.get(route)
        if (not path or not path.is_file() or path.is_symlink()
                or not path.resolve().is_relative_to(self.root)):
            return None
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if path.suffix in ('.html', '.css', '.js'):
            mime += '; charset=utf-8'
        return path, mime
