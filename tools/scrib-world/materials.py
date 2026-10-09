"""Read-only, repository-owned presentation library. Never serve user HTML.

All entries and assets have an exact allowlist built from trusted package files.
This module does not change access control: Handler authenticates first.
"""
import mimetypes
import re
from html import escape
from pathlib import Path

PREFIX='/scrib/backstage/materials/'
DECKS=(
    {'id':'tutorial','title':'Guía del espectáculo','description':'Cómo funciona el show: roles, niveles, votaciones, interpretación y teleprompter.',
     'tags':['Equipo','Antes del show'],'cover':'tutorial/cover.html'},
    {'id':'charla','title':'El origen de <SCRI> B','description':'La compañía, las referencias y la evolución del videojuego, con vídeos y esquemas escénicos.',
     'tags':['Charlas','Historia del proyecto'],'cover':'charla/cover.html'},
)
POLICY="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'"
PREVIEW_POLICY=POLICY.replace("script-src 'self'", "script-src 'none'").replace("media-src 'self'", "media-src 'none'")


class MaterialLibrary:
    def __init__(self, root):
        self.root=Path(root).resolve()
        self.files={}
        for folder in ('tutorial','charla','shared'):
            for path in (self.root/folder).rglob('*'):
                if path.is_file() and not path.is_symlink() and path.suffix.lower() in ('.html','.js','.css','.svg','.png','.jpg','.jpeg','.mp4','.webm','.ttf'):
                    self.files[path.relative_to(self.root).as_posix()]=path

    def list(self):
        result=[]
        for deck in DECKS:
            path=self.files.get(deck['id']+'/index.html')
            if not path:continue
            result.append(dict(deck,cover=PREFIX+deck['cover'],coverType='slide',url=PREFIX+deck['id']+'/',
                               slides=len(re.findall(r'<section class="slide\b',path.read_text()))))
        return {'materials':result}

    def preview(self, route):
        """Passive first-slide cover from the trusted original, without its player.

        Only two exact routes are accepted; this never renders uploaded HTML.
        Relative styles/fonts/images remain inside the authenticated library.
        """
        deck=next((d for d in DECKS if d['cover']==route),None)
        if not deck:return None
        found=self.file(deck['id']+'/')
        if not found:return None
        source=found[0].read_text()
        first=re.search(r'<section class="slide\b[^>]*>[\s\S]*?</section>',source)
        stylesheet=re.search(r'<link rel="stylesheet"[^>]*>',source)
        if not first or not stylesheet:return None
        slide=re.sub(r'<aside\b[^>]*class="speaker-notes"[\s\S]*?</aside>','',first[0])
        return ('<!doctype html><html lang="es"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                '<meta name="robots" content="noindex, nofollow">'
                f'<title>{escape(deck["title"])} · Primera diapositiva</title>'+stylesheet[0]+
                '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}'
                '*,*::before,*::after{animation:none!important;transition:none!important}'
                '.slides{inset:0!important}.slide,.slide>*{opacity:1!important;visibility:visible!important;transform:none!important;filter:none!important}'
                '</style></head><body><main class="deck"><div class="slides">'+slide+
                '</div></main></body></html>')

    def file(self, route):
        if route in ('tutorial/','charla/'):
            route+='index.html'
        path=self.files.get(route)
        if not path or not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(self.root):
            return None
        mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if path.suffix in ('.html','.css','.js'):mime+='; charset=utf-8'
        return path,mime

    @staticmethod
    def byte_range(value, length):
        if not value:return 0,length-1,False
        match=re.fullmatch(r'bytes=(\d*)-(\d*)',value)
        if not match or not any(match.groups()) or not length:raise ValueError('Range no válido')
        first,last=match.groups()
        if first:
            start=int(first);end=min(int(last) if last else length-1,length-1)
        else:
            suffix=int(last)
            if suffix<=0:raise ValueError('Range no válido')
            start=max(0,length-suffix);end=length-1
        if start>=length or end<start:raise ValueError('Range no válido')
        return start,end,True
