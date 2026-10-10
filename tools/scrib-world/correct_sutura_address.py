"""One-time, explicit user-confirmed address correction; never rewrites contracts.

The floor conflict from imported documents was resolved by the user as 3B.
No other fiscal value or review/confirmation status is inferred or changed.
"""
import json
import unicodedata

ADDRESS='CALLE SEPÚLVEDA 26, 3B, 28011, MADRID'


def apply(store,actor='3cejas'):
    with store.transaction() as db:
        old=store.business.record(db,'settings','organizer')
        if not old['version']:raise store.business.problem('No existe la configuración de Sutura.')
        name=''.join(c for c in unicodedata.normalize('NFD',old.get('name','')).upper() if not unicodedata.combining(c))
        if 'SUTURA' not in name:raise store.business.problem('La entidad configurada no es Sutura; no se ha cambiado su domicilio.')
        if old.get('address')==ADDRESS:return {'changed':False,'version':old['version']}
        version=old.pop('version');old.update(address=ADDRESS,updated=store.business.now(),updatedBy=actor)
        db.execute("UPDATE business_records SET body=?,version=? WHERE type='settings' AND id='organizer' AND version=?",(json.dumps(old,ensure_ascii=False),version+1,version))
        store.activity(db,'organizer',actor,'domicilio social y fiscal corregido a 3B (confirmado por usuario)')
        return {'changed':True,'version':version+1}
