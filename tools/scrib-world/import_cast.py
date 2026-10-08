"""Explicit, idempotent private roster import; no message-sending operations.

Parse public schedule data without eval or executing downloaded JavaScript.
Group roster and optional reviewed name mapping are PRIVATE JSON outside Git.
"""
import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from server import Store, Problem
from whatsapp import phone_number


def norm(value):
    value = ''.join(c for c in unicodedata.normalize('NFD', value.casefold()) if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', value).strip()


def schedule_literal(source):
    match = re.search(r'\bvar\s+scheduleSections\s*=\s*', source)
    if not match:
        raise ValueError('No se encuentra el calendario público')
    pos = match.end()
    def parse():
        nonlocal pos
        while pos < len(source) and source[pos].isspace():
            pos += 1
        if pos >= len(source):
            raise ValueError('Datos incompletos')
        char = source[pos]
        if char in '[{':
            pos += 1
            result = [] if char == '[' else {}
            close = ']' if char == '[' else '}'
            while True:
                while source[pos].isspace(): pos += 1
                if source[pos] == close:
                    pos += 1
                    return result
                if char == '{':
                    key = re.match(r'[a-zA-Z_$][\w$]*', source[pos:])
                    if not key: raise ValueError('Clave no válida')
                    pos += len(key[0])
                    while source[pos].isspace(): pos += 1
                    if source[pos] != ':': raise ValueError('Falta separador')
                    pos += 1
                    if key[0] in result: raise ValueError('Clave duplicada')
                    result[key[0]] = parse()
                else:
                    result.append(parse())
                while source[pos].isspace(): pos += 1
                if source[pos] == ',': pos += 1
                elif source[pos] != close: raise ValueError('Expresión no permitida en datos públicos')
        if char == '"' or char.isdigit() or source.startswith(('true','false','null'), pos):
            result, length = json.JSONDecoder().raw_decode(source[pos:])
            pos += length
            return result
        raise ValueError('No se ejecutan expresiones JavaScript')
    result = parse()
    if source[pos:].lstrip()[0] != ';' or not isinstance(result, list):
        raise ValueError('El calendario no es un literal estático')
    return result


def public_history(sections):
    months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
    people = {}
    for section in sections:
        for event in section['events']:
            parts = re.fullmatch(r'(\d+) de (\w+) de (\d{4})', event['date'])
            if not parts: raise ValueError('Fecha pública no válida')
            date = f'{int(parts[3]):04d}-{months.index(parts[2])+1:02d}-{int(parts[1]):02d}'
            def add(names, role, team='general'):
                for name in (n.strip() for n in names.split('·')):
                    if name:
                        people.setdefault(name, []).append({'date':date,'title':event.get('name','SCRIB'),'venue':event['venue'],'role':role,'team':team,'source':'https://scribshow.es/'})
            for team in event.get('teams', []):
                add(team.get('writer',''), 'Escritura', team.get('color','general'))
                add(team.get('performers',''), 'Interpretación', team.get('color','general'))
            add(event.get('writers',''), 'Escritura')
            add(event.get('performers',''), 'Interpretación')
            add(event.get('participants',''), 'Participación · papel no publicado')
    return people


def import_roster(store, roster, history, mapping=None, apply=False):
    mapping = mapping or {}
    expected = '<SCRI> B en la Universidad de León [7 de noviembre]'
    if norm(roster.get('group',{}).get('name','')) != norm(expected):
        raise ValueError('No es el grupo de León solicitado')
    actors = roster.get('participants', [])
    if not actors or len(actors) > 150:
        raise ValueError('Lista de participantes no válida')
    by_name = {norm(name): name for name in history}
    report = []
    existing = [p for p in store.snapshot()['items'] if p['kind'] == 'person']
    with store.transaction() as db:
        for index,p in enumerate(actors):
            key = hashlib.sha256((roster['group']['id']+'|'+p['id']).encode()).hexdigest()
            raw = p.get('name') or p.get('pushname') or p.get('shortName') or f'Integrante de León {index+1}'
            # A single short first name is NOT a safe identity match.
            names = [p.get('name',''),p.get('pushname',''),p.get('shortName','')]
            exact = {by_name[norm(n)] for n in names if len(norm(n).split()) >= 2 and norm(n) in by_name}
            if len(exact) > 1: raise ValueError('El contacto contiene dos identidades públicas distintas')
            candidate = mapping.get(key) or (next(iter(exact)) if exact else None)
            if candidate and candidate not in history:
                raise ValueError('La correspondencia revisada no existe en las fechas públicas')
            name = candidate or raw
            phone = phone_number(p.get('phone','')) if p.get('id','').endswith('@c.us') or p.get('phoneResolved') is True else ''
            matches = [x for x in existing if x.get('sourceKey') == key or (candidate and norm(x['name']) == norm(candidate)) or (phone and x.get('phone') == phone)]
            if len(matches) > 1:
                raise Problem('Conflicto entre fichas existentes: ' + name)
            prior = matches[0] if matches else None
            if prior and (prior['archived'] or (prior.get('phone') and phone and prior['phone'] != phone) or (prior.get('sourceKey') and prior['sourceKey'] != key)):
                raise Problem('Hay que revisar manualmente la ficha: ' + name)
            entries = history.get(candidate, [])
            report.append({'name':name,'groupName':raw,'matched':bool(candidate),'phoneAvailable':bool(phone),'participations':len(entries),'existing':bool(prior)})
            if apply:
                body = dict(prior or {}, name=candidate or (prior or {}).get('name',name), phone=phone or (prior or {}).get('phone',''),
                            phoneConfirmed=(prior or {}).get('phoneConfirmed',False),
                            roles=list(dict.fromkeys((prior or {}).get('roles',[])+[e['role'] for e in entries])))
                valid = store.validate(db,'person',body,prior)
                valid.update(sourceGroup=roster['group']['name'],sourceKey=key,nameMatch='matched' if candidate else 'review',publicName=candidate or '',history=entries)
                saved = store.save(db,prior,valid,'importacion-scrib','grupo de León y fechas públicas vinculados') if prior else store.insert(db,'person',valid,'importacion-scrib')
                existing = [x for x in existing if x['id'] != saved['id']] + [saved]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',required=True)
    parser.add_argument('--roster',required=True)
    parser.add_argument('--schedule',required=True)
    parser.add_argument('--mapping',help='JSON privado: hash de integrante -> nombre público revisado')
    parser.add_argument('--apply',action='store_true')
    args = parser.parse_args()
    history = public_history(schedule_literal(Path(args.schedule).read_text()))
    roster = json.loads(Path(args.roster).read_text())
    report = import_roster(Store(args.data),roster,history,json.loads(Path(args.mapping).read_text()) if args.mapping else None,args.apply)
    print(json.dumps({'applied':args.apply,'people':report},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
