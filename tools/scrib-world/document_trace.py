"""Private export provenance, not a certificate-based PDF signature or DRM.

No user identity or signing key is embedded in the PDF. The private SQLite
ledger maps the opaque reference to the authenticated exporter. HMAC validates
the ledger capsule; the final SHA-256 detects changes to the exported bytes.
Already-signed uploaded agreements are deliberately never rewritten.
"""
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import stat
import tempfile
from pathlib import Path

KEY_NAME='document-trace.key'
MAX_PDF_BYTES=16*1024*1024
SCHEMA='''
CREATE TABLE IF NOT EXISTS document_exports (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
 created TEXT NOT NULL, content_sha256 TEXT NOT NULL, pdf_sha256 TEXT NOT NULL,
 seal TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS document_exports_created ON document_exports(created);
'''


def key(directory, create=False):
    path=Path(directory)/KEY_NAME
    if create and not path.exists():
        # Atomic publication: another renderer never reads a half-written key.
        fd,name=tempfile.mkstemp(prefix='.document-trace-',dir=directory)
        try:
            with os.fdopen(fd,'wb') as output:
                output.write(secrets.token_bytes(32));output.flush();os.fsync(output.fileno())
            try:os.link(name,path)
            except FileExistsError:pass
        finally:os.unlink(name)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as source:
        info=os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size!=32 or info.st_mode&0o077:
            raise ValueError('La clave privada de trazabilidad no es válida.')
        return source.read(32)


def capsule(record):
    return json.dumps({k:record[k] for k in ('id','actor','kind','target','created','content_sha256')},sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()


def seal_pdf(store, raw, user, kind, target, ident, created):
    from pypdf import PdfReader, PdfWriter
    actor=user.get('username','')
    if not isinstance(actor,str) or not actor or len(actor)>100:
        raise store.business.problem('Es necesario un usuario autenticado para exportar.',401)
    record=dict(id=ident,actor=actor,kind=kind,target=str(target or '')[:100],created=created,
                content_sha256=hashlib.sha256(raw).hexdigest())
    signature=hmac.new(key(store.directory,True),capsule(record),hashlib.sha256).hexdigest()
    reader=PdfReader(io.BytesIO(raw));writer=PdfWriter();writer.clone_document_from_reader(reader)
    writer.add_metadata({'/SCRIBTrace':ident,'/SCRIBSeal':signature,'/SCRIBTraceVersion':'1'})
    output=io.BytesIO();writer.write(output);signed=output.getvalue()
    with store.connect() as db:
        db.execute('INSERT INTO document_exports VALUES(?,?,?,?,?,?,?,?)',
                   (ident,actor,kind,record['target'],created,record['content_sha256'],hashlib.sha256(signed).hexdigest(),signature))
    return signed


def verify_pdf(store, raw):
    # Read our fixed ASCII metadata only, without interpreting uploaded PDF
    # objects, decompression, scripts, links or fonts on the server.
    if not isinstance(raw,bytes) or len(raw)>MAX_PDF_BYTES or not raw.startswith(b'%PDF-'):
        raise store.business.problem('Selecciona un PDF de hasta 16 MB.')
    ids={value.replace(b'\\055',b'-') for value in re.findall(rb'/SCRIBTrace\s*\((SC(?:-|\\055)[a-f0-9]{32})\)',raw)}
    seals=set(re.findall(rb'/SCRIBSeal\s*\(([a-f0-9]{64})\)',raw))
    if len(ids)!=1 or len(seals)!=1:return {'status':'unknown','verified':False}
    ident=next(iter(ids)).decode();signature=next(iter(seals)).decode()
    with store.connect() as db:
        row=db.execute('SELECT * FROM document_exports WHERE id=?',(ident,)).fetchone()
        if not row:return {'status':'unknown','verified':False}
        record=dict(row)
        member=db.execute('SELECT name FROM members WHERE username=?',(record['actor'],)).fetchone()
    try:expected=hmac.new(key(store.directory),capsule(record),hashlib.sha256).hexdigest()
    except (OSError,ValueError):return {'status':'unverifiable','verified':False}
    if not hmac.compare_digest(expected,signature) or not hmac.compare_digest(record['seal'],signature):
        return {'status':'unknown','verified':False}
    intact=hmac.compare_digest(record['pdf_sha256'],hashlib.sha256(raw).hexdigest())
    return {'status':'original' if intact else 'modified','verified':intact,'reference':ident,
            'exportedBy':record['actor'],'name':member['name'] if member else record['actor'],
            'created':record['created'],'kind':record['kind'],'documentId':record['target']}
