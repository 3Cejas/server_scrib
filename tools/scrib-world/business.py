"""Private production records. Fiscal data never enters the shared world snapshot.

Amounts are integer cents; invoices are explicitly drafts, never an issuing system.
Signed uploads preserve original bytes, not a claim of signature verification.
"""
import base64
import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

SCHEMA = '''
CREATE TABLE IF NOT EXISTS business_records (
 type TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
 PRIMARY KEY(type,id));
CREATE TABLE IF NOT EXISTS match_reports (
 id TEXT PRIMARY KEY, event TEXT NOT NULL, ended INTEGER NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS match_event ON match_reports(event,ended);
CREATE TABLE IF NOT EXISTS agreements (
 id TEXT PRIMARY KEY, event TEXT NOT NULL, person TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
 token TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, expires REAL NOT NULL);
CREATE INDEX IF NOT EXISTS agreement_event ON agreements(event);
CREATE TABLE IF NOT EXISTS agreement_uploads (
 id TEXT PRIMARY KEY, agreement TEXT NOT NULL, hash TEXT NOT NULL, name TEXT NOT NULL,
 created TEXT NOT NULL, UNIQUE(agreement,hash));
'''
PUBLIC_ORIGIN = 'https://sutura-gateway.ddns.net'


class Business:
    def __init__(self, store, problem, text, now, date_value):
        self.store, self.problem, self.text, self.now, self.date = store, problem, text, now, date_value

    def money(self, value):
        # No binary floats and no silent truncation or negative allocations.
        if not isinstance(value, str) or not re.fullmatch(r'\d{1,8}(?:[.,]\d{1,2})?', value):
            raise self.problem('Importe no válido: euros positivos con hasta dos decimales.')
        return int(Decimal(value.replace(',', '.')) * 100)

    def event_date(self, value, time_pending=False):
        dt=datetime.fromisoformat(value)
        if dt.tzinfo:
            dt=dt.astimezone(ZoneInfo('Europe/Madrid'))
        months=('enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre')
        return f'{dt.day} de {months[dt.month-1]} de {dt.year}' + ('' if time_pending else dt.strftime(' a las %H:%M'))

    def record(self, db, kind, ident):
        row = db.execute('SELECT * FROM business_records WHERE type=? AND id=?', (kind, ident)).fetchone()
        return dict(json.loads(row['body']), version=row['version']) if row else {'version': 0}

    def save(self, kind, data, actor):
        ident = self.text(data.get('id', ''), 100, True)
        with self.store.transaction() as db:
            old = self.record(db, kind, ident)
            if type(data.get('version')) is not int or data['version'] != old['version']:
                raise self.problem('Los datos han cambiado. Recarga antes de guardar.', 409)
            if kind == 'settings':
                if ident != 'organizer':
                    raise self.problem('Configuración no válida.')
                body = {k: self.text(data.get(k, ''), limit, k in ('name', 'taxId', 'address', 'representative', 'template'))
                        for k, limit in [('name',200), ('taxId',40), ('address',1000), ('representative',200), ('template',22000)]}
                if data.get('confirmed') is not True:
                    raise self.problem('Revisa y confirma los datos de la entidad y la plantilla.')
                body['confirmed'] = True
            elif kind == 'billing':
                self.store.item(db, ident, 'person', True)
                body = {k: self.text(data.get(k,''), limit) for k, limit in [('legalName',200), ('taxId',40), ('address',1000), ('iban',40), ('source',2000)]}
                body['verified'] = data.get('verified') is True
                # Taxes cannot be inherited blindly from another person's invoice.
                body['vat'] = self.rate(data.get('vat'))
                body['withholding'] = self.rate(data.get('withholding'))
            elif kind == 'settlement':
                event = self.store.item(db, ident, 'event', True)
                body = {'season': self.text(data.get('season',''),80,True), 'days': []}
                days = data.get('days')
                if not isinstance(days,list) or not 1 <= len(days) <= 60:
                    raise self.problem('Añade entre 1 y 60 días de función.')
                allowed = {c['personId'] for c in event['cast']}
                used = set()
                for day in days:
                    if not isinstance(day,dict):
                        raise self.problem('Día no válido.')
                    date = self.date(day.get('date',''))
                    if not date or date in used:
                        raise self.problem('Falta una fecha o hay días duplicados.')
                    used.add(date)
                    income, expenses = self.money(day.get('income')), self.money(day.get('expenses'))
                    if expenses > income:
                        raise self.problem('Los gastos superan los ingresos. Revisa los importes.')
                    allocations, people = [], set()
                    entries = day.get('allocations', [])
                    if not isinstance(entries,list) or len(entries) > 100:
                        raise self.problem('Reparto no válido.')
                    for a in entries:
                        if not isinstance(a,dict):
                            raise self.problem('Asignación no válida.')
                        person = self.text(a.get('personId',''),100,True)
                        if person not in allowed or person in people:
                            raise self.problem('Cada persona del reparto debe pertenecer al bolo y aparecer una vez por día.')
                        people.add(person)
                        amount = self.money(a.get('amount'))
                        allocations.append({'personId':person, 'amount':amount, 'paid':a.get('paid') is True,
                                            'paymentDate': self.date(a.get('paymentDate','')), 'reference':self.text(a.get('reference',''),200)})
                        if allocations[-1]['paid'] and not allocations[-1]['paymentDate']:
                            raise self.problem('Indica la fecha del pago registrado.')
                    if sum(a['amount'] for a in allocations) > income-expenses:
                        raise self.problem('El reparto supera el ingreso neto del día.')
                    body['days'].append({'date':date,'income':income,'expenses':expenses,'allocations':allocations})
            else:
                raise self.problem('Registro no válido.')
            body.update(updated=self.now(), updatedBy=actor)
            db.execute('INSERT INTO business_records VALUES(?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET body=excluded.body,version=excluded.version',
                       (kind,ident,json.dumps(body,ensure_ascii=False),old['version']+1))
            self.store.activity(db, ident, actor, 'gestión: '+kind+' actualizado')
            return dict(body,id=ident,version=old['version']+1)

    def rate(self, value):
        if value in ('',None):
            return None
        if not isinstance(value,str) or not re.fullmatch(r'\d{1,2}(?:[.,]\d{1,2})?',value) or Decimal(value.replace(',','.')) > 50:
            raise self.problem('Impuesto no válido (0–50%). Déjalo vacío si está pendiente de revisión.')
        return str(Decimal(value.replace(',','.')))

    def overview(self):
        with self.store.connect() as db:
            records = [dict(json.loads(r['body']),type=r['type'],id=r['id'],version=r['version']) for r in db.execute('SELECT * FROM business_records')]
            return {'records':records}

    def reports(self, event):
        with self.store.connect() as db:
            self.store.item(db,event,'event')
            result=[]
            for row in db.execute('SELECT body FROM match_reports WHERE event=? ORDER BY ended DESC,id', (event,)):
                report=json.loads(row['body'])
                result.append({k:report[k] for k in ('id','endedAt','startedAt','writers') } | {'writers':{p:{'name':w['name']} for p,w in report['writers'].items()}})
            return {'reports':result}

    def report(self, ident):
        with self.store.connect() as db:
            row=db.execute('SELECT body FROM match_reports WHERE id=?',(ident,)).fetchone()
            if not row:
                raise self.problem('Informe no encontrado.',404)
            return json.loads(row['body'])

    def archive_report(self, data):
        if type(data.get('version')) is not int or data.get('version') != 1 or not isinstance(data.get('bolo'),dict) or not isinstance(data.get('writers'),dict):
            raise self.problem('Informe no válido.')
        ident=self.text(data.get('id',''),100,True)
        event=self.text(data['bolo'].get('id',''),100,True)
        for key in ('startedAt','endedAt'):
            if type(data.get(key)) is not int or not 0 < data[key] < 4102444800000:
                raise self.problem('Fecha de partida no válida.')
        if data['endedAt'] < data['startedAt']:
            raise self.problem('Fechas incoherentes.')
        for p in ('1','2'):
            w=data['writers'].get(p)
            if not isinstance(w,dict) or not isinstance(w.get('text'),str) or len(w['text']) > 1500000:
                raise self.problem('Texto no válido.')
            self.text(w.get('name',''),200,True)
        encoded=json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':'))
        if len(encoded.encode()) > 4*1024*1024:
            raise self.problem('Informe demasiado grande.',413)
        digest=hashlib.sha256(encoded.encode()).hexdigest()
        with self.store.transaction() as db:
            self.store.item(db,event,'event')
            old=db.execute('SELECT digest FROM match_reports WHERE id=?',(ident,)).fetchone()
            if old:
                if old['digest'] != digest:
                    raise self.problem('Ya existe otro informe con este identificador.',409)
                return {'id':ident,'duplicate':True}
            db.execute('INSERT INTO match_reports VALUES(?,?,?,?,?)',(ident,event,data['endedAt'],digest,encoded))
            self.store.activity(db,event,'videojuego-control','informe de partida guardado')
        return {'id':ident,'duplicate':False}

    def agreements(self, event):
        with self.store.connect() as db:
            self.store.item(db,event,'event')
            result=[]
            for row in db.execute('SELECT * FROM agreements WHERE event=? ORDER BY rowid DESC',(event,)):
                uploads=[dict(r) for r in db.execute('SELECT id,name,created,hash FROM agreement_uploads WHERE agreement=? ORDER BY created DESC,id',(row['id'],))]
                result.append(dict(json.loads(row['body']),id=row['id'],personId=row['person'],status=row['status'],expires=row['expires'],
                                   link=PUBLIC_ORIGIN+'/scrib-disponibilidad/'+row['token'],uploads=uploads))
            return {'agreements':result}

    def render_agreement(self, event, person, billing, settings, preview=False):
        dates=self.event_date(event['start'],event.get('timePending',False))
        if event.get('end') and event['end'][:10] != event['start'][:10]:
            dates += ' — '+self.event_date(event['end'],event.get('timePending',False))
        roles=' / '.join(dict.fromkeys(c['role'] for c in event['cast'] if c['personId']==person.get('id')))
        fields={'persona':(billing.get('legalName') or person['name']) if billing.get('verified') else person['name'],
                'documento':(billing.get('taxId') or '________________') if billing.get('verified') else '________________',
                'entidad':settings.get('name',''),'cif':settings.get('taxId',''),'domicilio':settings.get('address',''),
                'representante':settings.get('representative',''),'bolo':event['title'],'fecha':dates,
                'lugar':' · '.join(filter(None,[event['venue'],event['city'],event['address']])),
                'papel':roles,'fecha_firma':self.now()[:10]}
        rendered=settings.get('template') or ((Path(__file__).parent/'agreement_template.txt').read_text() if preview else '')
        for key,value in fields.items():
            rendered=rendered.replace('{'+key+'}',value or ('['+key.replace('_',' ').capitalize()+' pendiente]' if preview else ''))
        if re.search(r'\{[a-z_]+\}',rendered):
            raise self.problem('La plantilla tiene un campo desconocido. Revisa sus variables.')
        return rendered

    def agreement_preview(self, event_id):
        # Read only: no links, documents, signatures or activity are created.
        with self.store.connect() as db:
            db.execute('BEGIN')
            event=self.store.item(db,event_id,'event',True)
            settings=self.record(db,'settings','organizer')
            people=list(dict.fromkeys(c['personId'] for c in event['cast']))
            previews=[]
            for ident in people:
                person=self.store.item(db,ident,'person')
                previews.append({'personId':ident,'name':person['name'],'text':self.render_agreement(event,person,self.record(db,'billing',ident),settings,True)})
            if not previews:
                previews.append({'personId':'','name':'Ejemplo sin elenco asignado','text':self.render_agreement(event,{'name':'[Persona pendiente]'}, {},settings,True)})
            return {'eventTitle':event['title'],'previews':previews,'templateVersion':settings['version'],'eventVersion':event['version'],
                    'pending':not settings.get('confirmed') or not event['venue']}

    def generate(self, data, actor):
        event_id=self.text(data.get('eventId',''),100,True)
        selected=data.get('people')
        if not isinstance(selected,list) or not 1<=len(selected)<=100 or any(not isinstance(p,str) for p in selected) or len(set(selected)) != len(selected):
            raise self.problem('Selecciona personas del bolo.')
        with self.store.transaction() as db:
            event=self.store.item(db,event_id,'event',True)
            settings=self.record(db,'settings','organizer')
            if not settings.get('confirmed'):
                raise self.problem('Completa primero la entidad y la plantilla en Producción y cuentas.')
            if type(data.get('eventVersion')) is not int or data['eventVersion'] != event['version'] or data.get('settingsVersion') != settings['version']:
                raise self.problem('El bolo o la plantilla han cambiado. Revisa de nuevo.',409)
            if event.get('eventType') == 'rehearsal' or event['status'] == 'cancelled' or not event['venue']:
                raise self.problem('Completa el espacio del bolo y comprueba su estado.')
            generated=[]
            for person_id in selected:
                person=self.store.item(db,person_id,'person',True)
                roles=' / '.join(dict.fromkeys(c['role'] for c in event['cast'] if c['personId']==person_id))
                if not roles:
                    raise self.problem('El destinatario no pertenece al bolo.')
                # Do not regenerate or revoke silently: signed versions remain immutable.
                old=db.execute("SELECT id FROM agreements WHERE event=? AND person=? AND status<>'revoked'",(event_id,person_id)).fetchone()
                if old:
                    generated.append(old['id']);continue
                billing=self.record(db,'billing',person_id)
                rendered=self.render_agreement(event,person,billing,settings)
                ident=str(uuid.uuid4());token=self.store.availability.new_token()
                body={'name':person['name'],'eventTitle':event['title'],'text':rendered,'created':self.now(),'templateVersion':settings['version'],'eventVersion':event['version']}
                db.execute('INSERT INTO agreements VALUES(?,?,?,?,?,?,?,?)', (ident,event_id,person_id,hashlib.sha256(token.encode()).hexdigest(),token,json.dumps(body,ensure_ascii=False),'generated',time.time()+90*86400))
                generated.append(ident)
            self.store.activity(db,event_id,actor,'acuerdos preparados (sin envío)')
            return {'ids':generated}

    def lookup(self, db, token):
        row=db.execute('SELECT * FROM agreements WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if row:
            if row['status']=='revoked' or row['expires'] < time.time():
                raise self.problem('Este enlace ha caducado o fue revocado.',404)
            self.store.item(db,row['event'],'event',True)
            self.store.item(db,row['person'],'person',True)
        return row

    def public(self, token):
        with self.store.connect() as db:
            row=self.lookup(db,token)
            if not row:return None
            body=json.loads(row['body'])
            uploads=[dict(r) for r in db.execute('SELECT name,created FROM agreement_uploads WHERE agreement=? ORDER BY created DESC',(row['id'],))]
            return dict(kind='agreement',name=body['name'],title=body['eventTitle'],text=body['text'],status=row['status'],uploads=uploads)

    def upload(self, token, data):
        encoded=data.get('base64','')
        if not isinstance(encoded,str) or len(encoded)>4*1024*1024:
            raise self.problem('PDF demasiado grande (máximo 3 MB).',413)
        try:raw=base64.b64decode(encoded,validate=True)
        except (ValueError,TypeError):raise self.problem('PDF no válido.') from None
        if not 1<=len(raw)<=3*1024*1024 or not raw.startswith(b'%PDF-') or b'%%EOF' not in raw[-4096:]:
            raise self.problem('Sube un archivo PDF completo, de hasta 3 MB.')
        name=self.text(data.get('name',''),160,True)
        if not name.lower().endswith('.pdf') or any(c in name for c in ('/','\\','\r','\n')):
            raise self.problem('Nombre de PDF no válido.')
        digest=hashlib.sha256(raw).hexdigest()
        with self.store.transaction() as db:
            row=self.lookup(db,token)
            if not row:raise self.problem('Enlace no disponible.',404)
            if row['status']=='reviewed':raise self.problem('El acuerdo ya fue revisado. Contacta con organización antes de sustituirlo.',409)
            if db.execute('SELECT 1 FROM agreement_uploads WHERE agreement=? AND hash=?',(row['id'],digest)).fetchone():return {'duplicate':True}
            if db.execute('SELECT COUNT(*) FROM agreement_uploads WHERE agreement=?',(row['id'],)).fetchone()[0]>=10:
                raise self.problem('Límite de versiones alcanzado. Contacta con organización.',429)
            folder=self.store.directory/'documents';folder.mkdir(mode=0o700,exist_ok=True)
            target=folder/(digest+'.pdf')
            try:
                with target.open('xb') as file:os.chmod(target,0o600);file.write(raw);file.flush();os.fsync(file.fileno())
            except FileExistsError:pass
            db.execute('INSERT INTO agreement_uploads VALUES(?,?,?,?,?)',(str(uuid.uuid4()),row['id'],digest,name,self.now()))
            db.execute("UPDATE agreements SET status='uploaded' WHERE id=?",(row['id'],))
            self.store.activity(db,row['event'],'enlace-personal','acuerdo subido; pendiente de revisión')
        return {'duplicate':False}

    def agreement_state(self, data, actor):
        with self.store.transaction() as db:
            row=db.execute('SELECT * FROM agreements WHERE id=?',(self.text(data.get('id',''),100,True),)).fetchone()
            if not row:raise self.problem('Acuerdo no encontrado.',404)
            status=data.get('status')
            if status not in ('revoked','reviewed') or row['status']=='revoked':raise self.problem('Estado no válido.')
            if status=='reviewed' and row['status']!='uploaded':raise self.problem('Descarga y revisa primero el PDF recibido.')
            db.execute('UPDATE agreements SET status=? WHERE id=?',(status,row['id']))
            self.store.activity(db,row['event'],actor,'acuerdo '+status)
        return {'status':status}

    def document(self, ident):
        with self.store.connect() as db:
            row=db.execute('SELECT hash FROM agreement_uploads WHERE id=?',(ident,)).fetchone()
            if not row:raise self.problem('Documento no encontrado.',404)
            return (self.store.directory/'documents'/(row['hash']+'.pdf')).read_bytes()

    def invoice(self,data,actor):
        event_id=self.text(data.get('eventId',''),100,True);person_id=self.text(data.get('personId',''),100,True)
        with self.store.transaction() as db:
            event=self.store.item(db,event_id,'event')
            settlement=self.record(db,'settlement',event_id);billing=self.record(db,'billing',person_id);settings=self.record(db,'settings','organizer')
            if not settings.get('confirmed') or not billing.get('verified') or not all(billing.get(k) for k in ('legalName','taxId','address')) or billing.get('vat') is None or billing.get('withholding') is None:
                raise self.problem('Confirma los datos fiscales de la entidad y de esta persona, incluido IVA y retención.')
            lines=[]
            for d in settlement.get('days',[]):
                lines.extend({'date':d['date'],'amount':a['amount']} for a in d['allocations'] if a['personId']==person_id)
            if not lines:raise self.problem('No hay importes asignados a esta persona en el bolo.')
            base=sum(l['amount'] for l in lines)
            vat=int((Decimal(base)*Decimal(billing['vat'])/100).quantize(Decimal(1),rounding=ROUND_HALF_UP))
            withholding=int((Decimal(base)*Decimal(billing['withholding'])/100).quantize(Decimal(1),rounding=ROUND_HALF_UP))
            ident=str(uuid.uuid4())
            body={'id':ident,'eventId':event_id,'personId':person_id,'eventTitle':event['title'],'issuer':billing,'recipient':settings,
                  'date':self.date(data.get('date','')),'series':self.text(data.get('series',''),60),'number':self.text(data.get('number',''),60),
                  'lines':lines,'base':base,'vat':vat,'withholding':withholding,'total':base+vat-withholding,'created':self.now(),'status':'draft'}
            if not body['date']:raise self.problem('Indica la fecha del borrador.')
            db.execute('INSERT INTO business_records VALUES(?,?,?,1)',('invoice',ident,json.dumps(body,ensure_ascii=False)))
            self.store.activity(db,event_id,actor,'borrador de factura preparado (no emitido ni pagado)')
            return body
