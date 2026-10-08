"""One requested inventory batch, applied atomically once on production startup.

Not a reusable demo/default inventory. Never overwrites, unarchives or duplicates
an existing item; preserves subsequent edits and is included in the normal backup.
"""
import argparse
import hashlib
import json
import unicodedata
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOKEN = 'requested_inventory_20261008_v1'
ACTOR = 'inventario-solicitado'


def title_key(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', value.casefold())
                           if not unicodedata.combining(c)).split())


def apply_initial_inventory(store, apply=True):
    requested = json.loads((ROOT / 'initial_inventory.json').read_text())
    with store.transaction() as db:
        if db.execute('SELECT 1 FROM requests WHERE token=?', (TOKEN,)).fetchone():
            return {'added': 0, 'alreadyApplied': True, 'preserved': []}
        objects = store.all(db, 'inventory')
        existing = {title_key(o['title']) for o in objects}
        existing_ids = {o['id'] for o in objects}
        pending, preserved = [], []
        for entry in requested:
            ident = str(uuid.uuid5(uuid.NAMESPACE_URL, TOKEN + '/' + entry['key']))
            if ident in existing_ids or title_key(entry['title']) in existing:
                preserved.append(entry['title'])
                continue
            body = store.validate(db, 'inventory', {k: v for k, v in dict(entry,
                team='general', condition='unchecked').items() if k != 'key'})
            pending.append((ident, body))
            existing.add(title_key(entry['title']))
        result = {'added': len(pending), 'alreadyApplied': False, 'preserved': preserved}
        if not apply:
            return dict(result, dryRun=True)
        # A single transaction also reserves the batch marker. Concurrent startups
        # and restarts cannot duplicate it; existing/archived objects remain intact.
        for ident, body in pending:
            store.insert(db, 'inventory', body, ACTOR, ident)
        digest = hashlib.sha256(json.dumps(requested, sort_keys=True).encode()).hexdigest()
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?)',
                   (TOKEN, ACTOR, digest, json.dumps(result), stamp))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True)
    parser.add_argument('--apply', action='store_true', help='Apply; otherwise preview without adding objects')
    args = parser.parse_args()
    from server import Store
    print(json.dumps(apply_initial_inventory(Store(args.data), args.apply), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
