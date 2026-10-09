"""Authenticated, locally rendered SCRIB documents. Never fetch remote content."""
import io
import re
from datetime import datetime
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TEAMS = {'blue': 'EQUIPO AZUL', 'red': 'EQUIPO ROJO'}
CATEGORIES = {'props': 'Utilería', 'costume': 'Vestuario', 'furniture': 'Mobiliario',
              'technical': 'Técnica', 'other': 'Otros'}


def generate(store, data, user):
    # Optional imports keep diagnostics/legacy startup usable without the renderer.
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                   TableStyle, Image, PageBreak, KeepTogether)
    from reportlab.lib.utils import ImageReader
    from reportlab.lib.pagesizes import A4

    problem = store.business.problem
    kind = data.get('kind')
    if kind not in ('inventory', 'event', 'lighting', 'report', 'invoice', 'agreement'):
        raise problem('Este documento no se puede exportar.', 400)
    if kind in ('invoice', 'agreement') and user['role'] != 'admin':
        raise problem('Documento reservado a administración.', 403)
    title = str(data.get('title') or '')
    if len(title) > 160:
        raise problem('El título debe tener hasta 160 caracteres.')
    font = 'ScribSans'
    for face,file in [('ScribSans','LiberationSans-Regular.ttf'),('ScribSansBold','LiberationSans-Bold.ttf')]:
        if face not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(face,str(ROOT/'assets'/file)))
    pdfmetrics.registerFontFamily('ScribSans',normal=font,bold='ScribSansBold',italic=font,boldItalic='ScribSansBold')
    ink, muted = colors.HexColor('#182032'), colors.HexColor('#5e6576')
    gold = colors.HexColor('#d2a749')
    tones = {'blue': colors.HexColor('#087da4'), 'red': colors.HexColor('#c33250'),
             'general': gold}
    styles = getSampleStyleSheet()
    for name in ('Normal', 'Title', 'Heading1', 'Heading2', 'Heading3'):
        styles[name].fontName = font if name=='Normal' else 'ScribSansBold'
        styles[name].textColor = ink
        if name.startswith('Heading'):
            styles[name].keepWithNext = True
    styles['Normal'].fontSize = 10
    styles['Normal'].leading = 15
    styles['Title'].fontSize = 23
    styles['Title'].leading = 29
    styles['Title'].spaceAfter = 14
    styles['Heading2'].fontSize = 16
    styles['Heading2'].leading = 22
    styles['Heading2'].spaceAfter = 12
    styles.add(ParagraphStyle('Small', fontName=font, fontSize=8, leading=12,
                              textColor=muted, spaceAfter=5))
    styles.add(ParagraphStyle('Object', fontName=font, fontSize=13, leading=18,
                              textColor=ink, spaceAfter=6))
    clean = lambda s: ''.join(c for c in str(s or '').replace('\u2014','-').replace('\u2013','-') if ord(c) < 0x1f000)
    def para(value, style='Normal'):
        return Paragraph(escape(clean(value)).replace('\n', '<br/>'), styles[style])
    story = []
    def heading(value, note=''):
        story.extend([para(value, 'Title')])
        if note:
            story.extend([para(note, 'Small'), Spacer(1, 12)])
    def section(value, team='general'):
        style = ParagraphStyle('section-'+team, parent=styles['Heading2'], textColor=tones[team])
        gap=Spacer(1,5);gap.keepWithNext=True
        story.extend([Paragraph(escape(clean(value)), style), gap])
    def image(value):
        if not re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|webp)', str(value or '')):
            return None
        path = store.directory/'images'/value
        if not path.is_file():
            return None
        try:
            # Only existing validated private images; never interpret a URL/path.
            reader = ImageReader(str(path))
            w, h = reader.getSize()
            return Image(str(path), width=72*min(1,w/h), height=72*min(1,h/w))
        except Exception:
            return None
    def inventory(objects):
        for team in ('blue', 'red'):
            chosen = sorted([o for o in objects if o['team'] == team], key=lambda o: o['title'].casefold())
            if not chosen:
                continue
            if team == 'red' and story:
                story.append(PageBreak())
            section(TEAMS[team], team)
            story.append(para(str(len(chosen))+' objetos seleccionados', 'Small'))
            for obj in chosen:
                photo = image(obj.get('image')) if data.get('photos', True) else None
                quantity = str(obj['quantity']) if obj.get('quantity') is not None else 'Sin especificar'
                texts = [para(obj['title'], 'Object'),
                         para('Cantidad: '+quantity+'  |  '+CATEGORIES.get(obj['category'], 'Otros'), 'Small')]
                if obj.get('imageReference'):
                    texts.append(para('Imagen de catálogo orientativa', 'Small'))
                block = Table([[photo or '', texts]], colWidths=[96, 415], hAlign='LEFT')
                block.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                    ('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#eaf5fa' if team=='blue' else '#fff0f2')),
                    ('LINEBEFORE',(0,0),(0,-1),3,tones[team]),
                    ('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),
                    ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
                story.extend([block, Spacer(1, 7)])
                if data.get('notes', True) and obj.get('description'):
                    story.append(para(obj['description']))
                story.append(Spacer(1, 8))
    with store.connect() as db:
        all_objects = [o for o in store.all(db, 'inventory') if not o['archived']]
        if kind == 'inventory':
            ids = data.get('ids')
            if not isinstance(ids, list) or not ids or len(ids) > 500 or any(not isinstance(i,str) for i in ids):
                raise problem('Selecciona al menos un objeto para exportar.')
            available = {o['id']:o for o in all_objects}
            if set(ids)-available.keys():
                raise problem('El inventario ha cambiado. Actualiza la selección.', 409)
            objects = [available[i] for i in dict.fromkeys(ids)]
            if any(o['team'] not in TEAMS for o in objects):
                raise problem('Asigna los objetos al equipo azul o rojo antes de exportar.')
            heading(title or 'Inventario de escena', 'Objetos del equipo de intérpretes - selección personalizada')
            inventory(objects)
        elif kind == 'event':
            event = store.item(db, data.get('id',''), 'event', True)
            heading(title or event['title'], 'HOJA DE LLAMADA - '+event['start'][:10])
            for label, value in [('Espacio', ' - '.join(filter(None,[event['venue'],event['city']]))),
                                  ('Dirección', event['address']), ('Función',event['start'].replace('T',' ')),
                                  ('Convocatoria',event['arrival'].replace('T',' '))]:
                story.extend([para(label, 'Heading3'), para(value or 'Pendiente'), Spacer(1, 8)])
            for team in ('blue','red','general'):
                rows = [c for c in event['cast'] if (c['team'] if c['role'] in ('Escritura','Interpretación') else 'general') == team]
                if not rows:
                    continue
                section(TEAMS.get(team,'EQUIPO DEL ESPECTÁCULO'), team)
                for row in rows:
                    person = store.item(db,row['personId'],'person')
                    story.append(para(person['name']+' - '+row['role']))
                story.append(Spacer(1, 15))
            if event['description']:
                section('Notas de producción')
                story.append(para(event['description']))
            allowed = event.get('inventoryIds')
            objects = [o for o in all_objects if allowed is None or o['id'] in allowed]
            if objects:
                story.append(PageBreak())
                inventory(objects)
        elif kind == 'lighting':
            from lighting import normalize, default_plan, upgrade
            ident = data.get('id','')
            plans = [p for p in store.all(db,'lighting') if not p['archived']]
            plan = next((p for p in plans if p.get('eventId','') == ident), None)
            plan = plan or next((p for p in plans if not p.get('eventId')), None) or default_plan()
            plan = upgrade(plan)
            if 'plan' in data:
                from server import text
                plan = normalize(data['plan'], problem, text)
            heading(title or 'Plano técnico', 'Escenario, vídeo, sonido y sala de intérpretes - vista desde el público')
            story.append(StagePlan(plan,font))
            story.append(PageBreak())
            section('Leyenda del plano')
            for number,e in enumerate(plan['elements'],1):
                block=[para(str(number)+'. '+e['label'], 'Heading3')]
                if e['type'] in ('street','spot','front','smoke','console'):
                    block.append(para('Circuito / canal: '+(e.get('channel') or 'Pendiente'), 'Small'))
                if e.get('notes'):
                    block.append(para(e['notes']))
                story.append(KeepTogether(block))
            if plan.get('notes'):
                section('Notas para la sala')
                story.append(para(plan['notes']))
            section('Conexiones y cableado')
            for c in plan['connections']:
                nodes={e['id']:e for e in plan['elements']}
                block=[para(c['label'], 'Heading3'),para(nodes[c['from']]['label']+' → '+nodes[c['to']]['label'])]
                if c.get('notes'):block.append(para(c['notes'],'Small'))
                story.append(KeepTogether(block))
            section('Walkies - cuatro unidades')
            for w in plan['walkies']:
                story.append(para(w['label']+' - CANAL '+w['channel'], 'Heading3'))
                if w.get('notes'):story.append(para(w['notes'],'Small'))
            section('Checklist de montaje técnico')
            for group in dict.fromkeys(c['category'] for c in plan['checklist']):
                story.append(para(group,'Heading3'))
                for check in plan['checklist']:
                    if check['category']==group:
                        story.append(para(('[OK] ' if check['done'] else '[ ] ')+check['text']))
        elif kind == 'report':
            report = store.business.report(data.get('id',''))
            date = datetime.fromtimestamp(report['endedAt']/1000,ZoneInfo('Europe/Madrid')).strftime('%d/%m/%Y %H:%M')
            heading(title or 'Memoria de partida', report['bolo'].get('title','')+' - '+date)
            score = report.get('score') or {}
            players = (report.get('stats') or {}).get('players') or {}
            for team, key in (('blue','1'),('red','2')):
                if key=='2':
                    story.append(PageBreak())
                section(report['writers'][key]['name'],team)
                stats = players.get(key) or {}
                total = (score.get('jugadores') or {}).get(key,{}).get('total')
                if score.get('disponible'):
                    story.append(para(str(total)+' puntos','Heading3'))
                for label,value in [('Palabras',stats.get('palabrasTotal')),('Únicas',stats.get('palabrasUnicas')),
                                    ('PPM - pulsaciones/min',stats.get('ritmoPpm')),
                                    ('Inspiración',stats.get('valorInspiracion',(stats.get('vida') or {}).get('actual')))]:
                    story.append(para(label+': '+str(value if value is not None else 'No disponible'),'Small'))
                if stats.get('palabrasTotal'):
                    story.append(para('Riqueza léxica: '+str(round(100*stats.get('palabrasUnicas',0)/stats['palabrasTotal']))+'%','Small'))
                for category in score.get('categorias') or []:
                    name = category.get('etiqueta') or category.get('titulo') or category.get('nombre') or category.get('id') or ''
                    story.append(para(str(name)+': '+str((category.get('puntos') or {}).get(key,'No disponible')),'Small'))
                section('La historia',team)
                story.append(para(report['writers'][key]['text']))
                story.append(Spacer(1,18))
                section('Sus musas',team)
                muses = (((report.get('muses') or {}).get('equipos') or {}).get(key) or {}).get('musas') or []
                for n,muse in enumerate(sorted(muses,key=lambda m: -(m.get('stats') or {}).get('introducidas',0)),1):
                    s = muse.get('stats') or {}
                    story.append(para(str(n)+'. '+str(muse.get('nombre',''))+' - '+str(s.get('introducidas',0))+' incorporadas de '+str(s.get('enviadas',0))+' enviadas'))
                if not muses:
                    story.append(para('Sin musas registradas.','Small'))
        elif kind == 'agreement':
            agreement = db.execute('SELECT body FROM agreements WHERE id=?',(data.get('id',''),)).fetchone()
            if not agreement:
                raise problem('Acuerdo no encontrado.',404)
            document = __import__('json').loads(agreement['body'])
            heading(title or 'Acuerdo de colaboración',document['name'])
            story.append(para(document['text']))
        else:
            records = store.business.overview()['records']
            invoice = next((r for r in records if r['type']=='invoice' and r['id']==data.get('id')),None)
            if not invoice:
                raise problem('Borrador no encontrado.',404)
            heading('Borrador de factura', 'NO EMITIDO - pendiente de aceptación')
            story.append(para('Serie: '+str(invoice.get('series',''))+' | Número: '+str(invoice.get('number') or 'Pendiente'),'Small'))
            story.append(para('Fecha: '+str(invoice.get('date',''))+' | Bolo: '+str(invoice.get('eventTitle','')),'Small'))
            for label, party in [('Emisor',invoice['issuer']),('Destinatario',invoice['recipient'])]:
                section(label)
                story.append(para('\n'.join(str(party.get(k,'')) for k in ('legalName','name','taxId','address'))))
            for line in invoice['lines']:
                story.append(para(str(line['date'])+' - '+f"{line['amount']/100:.2f} EUR"))
            for label,key in [('Base imponible','base'),('IVA','vat'),('Retención','withholding'),('Total','total')]:
                value = -invoice[key] if key=='withholding' else invoice[key]
                story.append(para(label+': '+f"{value/100:.2f} EUR",'Heading3'))
            story.append(para('Transferencia: '+str(invoice['issuer'].get('iban') or 'Cuenta pendiente de confirmar'),'Small'))
            story.append(para('No constituye una factura emitida, aceptación ni orden de pago.','Small'))
    stamp = datetime.now(ZoneInfo('Europe/Madrid')).strftime('%d/%m/%Y %H:%M')
    buffer = io.BytesIO()
    def frame(canvas, doc):
        w,h = A4
        canvas.setFillColor(colors.HexColor('#101521'))
        canvas.rect(0,h-75,w,75,fill=1,stroke=0)
        canvas.drawImage(str(ROOT/'assets/scrib-world-logo.png'),32,h-65,48,48,preserveAspectRatio=True,mask='auto')
        canvas.setFont(font,14);canvas.setFillColor(colors.white)
        canvas.drawString(94,h-37,'<SCRI> B')
        canvas.setFont(font,8);canvas.setFillColor(colors.HexColor('#e8c96d'))
        canvas.drawString(94,h-53,'PRODUCCIÓN - SUTURA TEATRO')
        canvas.setFont(font,7);canvas.setFillColor(muted)
        canvas.drawString(42,25,'<SCRI> B - '+stamp)
        canvas.drawRightString(w-42,25,'Página '+str(doc.page))
    doc = SimpleDocTemplate(buffer,pagesize=A4,rightMargin=42,leftMargin=42,
                           topMargin=97,bottomMargin=48,title=title or 'SCRIB - '+kind,
                           author='SCRIB / Sutura Teatro')
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    return buffer.getvalue()


def StagePlan(plan,font='ScribSans'):
    from reportlab.platypus import Flowable
    from reportlab.lib import colors
    class Drawing(Flowable):
        def __init__(self):
            super().__init__()
            self.width,self.height = 511,535
        def draw(self):
            c=self.canv
            from lighting import coordinates
            c.setFillColor(colors.HexColor('#f4f5f9'));c.roundRect(0,10,511,520,8,fill=1,stroke=0)
            c.setStrokeColor(colors.HexColor('#b7c1d0'))
            c.rect(35,282,430,216,fill=0);c.rect(30,38,215,204,fill=0);c.rect(260,38,215,204,fill=0)
            def point(e):
                x,y=coordinates(e);return x/2,530-y*.4
            nodes={e['id']:e for e in plan['elements']}
            # Numbered symbols avoid long labels colliding. Full names below the diagram.
            for connection in plan['connections']:
                if connection['type'] not in ('hdmi','dmx'):continue
                a,b=point(nodes[connection['from']]),point(nodes[connection['to']])
                c.setStrokeColor(colors.HexColor('#2389b0' if connection['type']=='hdmi' else '#369b65'))
                c.setLineWidth(.7);c.setDash(3,2)
                p=c.beginPath();p.moveTo(*a)
                source,target=nodes[connection['from']],nodes[connection['to']]
                if source.get('zone')!=target.get('zone'):
                    margin=494 if target['x']>50 else 17
                    p.lineTo(margin,a[1]);p.lineTo(margin,b[1])
                else:
                    p.lineTo(a[0],(a[1]+b[1])/2);p.lineTo(b[0],(a[1]+b[1])/2)
                p.lineTo(*b);c.drawPath(p)
            c.setDash()
            for index,e in enumerate(plan['elements'],1):
                x,y=point(e)
                color={'blue':'#1682ae','red':'#d3405c','warm':'#cda548','white':'#5b6380'}[e['color']]
                c.setFillColor(colors.HexColor(color));c.setStrokeColor(colors.HexColor(color))
                if e['type']=='screen':c.rect(x-65,y-9,130,18,fill=0)
                elif e['type'] in ('desk','monitor','computer','console','projector','splitter','video-card','psu','controller'):c.roundRect(x-16,y-7,32,14,3,fill=0)
                elif e['type']=='power':
                    c.roundRect(x-5,y-5,10,10,2,fill=0)
                    c.line(x-2,y+5,x-2,y+9);c.line(x+2,y+5,x+2,y+9)
                    c.line(x,y-5,x,y-9);c.line(x,y-9,x+10,y-9)
                elif e['type']=='speaker':
                    c.roundRect(x-9,y-14,18,28,2,fill=0);c.circle(x,y-5,6,fill=0);c.circle(x,y+7,3,fill=0)
                elif e['type']=='front':
                    for offset in (-45,0,45):c.circle(x+offset,y,8,fill=1)
                else:c.circle(x,y,11,fill=1)
                c.setFont(font,7);c.drawCentredString(x,y+(15 if e['type']=='power' else -18),str(index))
                if e['type']=='smoke':
                    c.line(x,y-12,x,y-27);c.line(x,y-27,x-4,y-22);c.line(x,y-27,x+4,y-22)
            c.setFillColor(colors.HexColor('#5e6576'));c.setFont(font,8)
            c.drawCentredString(255,260,'PÚBLICO / PROSCENIO')
            c.drawCentredString(137,229,'TÉCNICA');c.drawCentredString(367,229,'SALA DE INTÉRPRETES')
            c.drawCentredString(255,515,'HDMI: azul - DMX: verde - detalles de todas las conexiones a continuación')
    return Drawing()
