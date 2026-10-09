"""Requested two-team kits and supplier references; one atomic, recoverable batch.

Only the exact original seed records are expanded. Never guesses other objects,
resurrects archived records, replaces a manual photo, or reapplies on restart.
"""
import base64
import hashlib
import json
import uuid
from pathlib import Path
from inventory_seed import TOKEN as INITIAL_TOKEN

ROOT = Path(__file__).resolve().parent
TOKEN = 'requested_inventory_teams_20261009_v1'
ACTOR = 'inventario-solicitado'


def apply_team_inventory(store, apply=True):
    entries = json.loads((ROOT/'initial_inventory.json').read_text())
    references = json.loads((ROOT/'inventory_references.json').read_text())
    with store.transaction() as db:
        if db.execute('SELECT 1 FROM requests WHERE token=?', (TOKEN,)).fetchone():
            return {'alreadyApplied': True, 'added': 0, 'updated': 0}
        all_objects = store.all(db, 'inventory')
        originals = {o['id']: o for o in all_objects}
        planned = []
        for entry in entries:
            original_id = str(uuid.uuid5(uuid.NAMESPACE_URL, INITIAL_TOKEN+'/'+entry['key']))
            original = originals.get(original_id)
            if not original or original['archived']:
                continue
            for team in ('blue', 'red'):
                found = next((o for o in all_objects if o['team']==team and o['title']==original['title']), None)
                if found and found['archived']:
                    continue
                target = found or (original if original['team'] in ('general',team) and team=='blue' else None)
                ident = target['id'] if target else str(uuid.uuid5(uuid.NAMESPACE_URL,TOKEN+'/'+entry['key']+'/'+team))
                source = target or original
                body = {k: source.get(k) for k in ('title','quantity','category','condition','location','custodianId','eventId','description','image')}
                body['team'] = team
                if body['quantity'] is None:
                    body['quantity'] = 1
                if body['condition']=='unchecked':
                    body['condition'] = 'good'
                reference = references.get(entry['key'], {}).get(team, {})
                if not source.get('sourceUrl') and reference.get('url'):
                    body['sourceUrl'] = reference['url']
                if not source.get('image') and reference.get('file') and apply:
                    photo = ROOT/'assets/inventory'/reference['file']
                    body['image'] = store.upload(base64.b64encode(photo.read_bytes()).decode())
                    body['imageReference'] = True
                # Do not clone hidden ownership/location metadata into the other kit.
                if not target:
                    body.update(location='',custodianId='',eventId='')
                body = store.validate(db,'inventory',body,target)
                planned.append((target,ident,body))
        result = {'alreadyApplied':False,'added':sum(o is None for o,_,_ in planned),
                  'updated':sum(o is not None for o,_,_ in planned)}
        if not apply:
            return dict(result,dryRun=True)
        for target,ident,body in planned:
            if target:
                store.save(db,target,body,ACTOR,'kit de equipo y referencia añadidos')
            else:
                store.insert(db,'inventory',body,ACTOR,ident)
        from server import now
        digest = hashlib.sha256(json.dumps(references,sort_keys=True).encode()).hexdigest()
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?)',(TOKEN,ACTOR,digest,json.dumps(result),now()))
        return result
