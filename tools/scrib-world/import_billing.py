"""Import explicitly matched PRIVATE billing candidates; never infer tax rates.

Input stays outside Git. Existing fiscal edits are never overwritten. This tool
does not create agreements, invoices, allocations, WhatsApps or payments.
"""
import argparse
import json
import os
import sqlite3
import unicodedata
import uuid
from pathlib import Path
from server import Store, Problem, now, text


def identity(value):
    return unicodedata.normalize('NFKC', value).strip().casefold()


def import_candidates(store, candidates, apply=False):
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 100:
        raise Problem('Lista privada de candidatos no válida.')
    ids = set()
    prepared = []
    with store.transaction() as db:
        for candidate in candidates:
            ident = text(candidate.get('id', ''), 100, True)
            if ident in ids:
                raise Problem('Identificadores duplicados en la importación.')
            ids.add(ident)
            person = store.item(db, ident, 'person', True)
            if identity(person['name']) != identity(text(candidate.get('expectedName', ''), 200, True)):
                raise Problem('La identidad del elenco ha cambiado. No se importa ningún candidato.')
            if db.execute("SELECT 1 FROM business_records WHERE type='billing' AND id=?", (ident,)).fetchone():
                continue
            body = {k: text(candidate.get(k, ''), 1000 if k in ('address', 'source') else 200,
                            k in ('legalName', 'taxId', 'source'))
                    for k in ('legalName', 'taxId', 'address', 'iban', 'source')}
            if not body['source'].startswith('https://drive.google.com/'):
                raise Problem('Falta la referencia al documento de Drive revisado.')
            body.update(verified=False, vat=None, withholding=None, updated=now(), updatedBy='importación privada revisada')
            prepared.append((ident, body))
        if apply:
            for ident, body in prepared:
                db.execute('INSERT INTO business_records VALUES(?,?,?,1)', ('billing', ident, json.dumps(body, ensure_ascii=False)))
                store.activity(db, ident, 'importación privada revisada', 'datos fiscales recuperados · pendientes de confirmar')
    return {'candidates': len(candidates), 'importable': len(prepared), 'preserved': len(candidates)-len(prepared), 'applied': apply}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True, type=Path)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not (args.data/'world.sqlite3').is_file():
        parser.error('No existe la base de datos de producción indicada.')
    if args.input.stat().st_mode & 0o077:
        parser.error('El JSON privado debe tener permisos 0600.')
    candidates = json.loads(args.input.read_text())
    store = Store(args.data)
    if args.apply:
        backup = args.data/'backups'/('billing-before-'+uuid.uuid4().hex+'.sqlite3')
        backup.parent.mkdir(exist_ok=True, mode=0o700)
        with store.connect() as db, sqlite3.connect(backup) as out:
            db.backup(out)
        os.chmod(backup, 0o600)
    # Counts only: never print fiscal names, identifiers, addresses or accounts.
    print(json.dumps(import_candidates(store, candidates, args.apply)))


if __name__ == '__main__':
    main()
