"""Authenticated, locally rendered SCRIB documents. Never fetch remote content."""
import io
import base64
import binascii
import re
import uuid
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TEAMS = {'blue': 'EQUIPO AZUL', 'red': 'EQUIPO ROJO'}
CATEGORIES = {'props': 'Utilería', 'costume': 'Vestuario', 'furniture': 'Mobiliario',
              'technical': 'Técnica', 'other': 'Otros'}


def generate(store, data, user, *, agreement_token=None):
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
    if kind in ('invoice', 'agreement') and user['role'] != 'admin' and not (kind == 'agreement' and agreement_token):
        raise problem('Documento reservado a administración.', 403)
    title = str(data.get('title') or '')
    if len(title) > 160:
        raise problem('El título debe tener hasta 160 caracteres.')
    font = 'ScribSans'
    for face,file in [('ScribSans','LiberationSans-Regular.ttf'),('ScribSansBold','LiberationSans-Bold.ttf')]:
        if face not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(face,str(ROOT/'assets'/file)))
    if 'ScribRetro' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('ScribRetro',str(ROOT/'materials/shared/retro.ttf')))
    pdfmetrics.registerFontFamily('ScribSans',normal=font,bold='ScribSansBold',italic=font,boldItalic='ScribSansBold')
    ink, muted = colors.HexColor('#f4f4f6'), colors.HexColor('#b0b8c7')
    gold = colors.HexColor('#f2d777')
    tones = {'blue': colors.HexColor('#46f0ff'), 'red': colors.HexColor('#ff6b6b'),
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
    styles.add(ParagraphStyle('Score',fontName='ScribSansBold',fontSize=27,leading=34,
                              textColor=ink,spaceAfter=12))
    styles.add(ParagraphStyle('Check',fontName=font,fontSize=9,leading=13,textColor=ink))
    styles.add(ParagraphStyle('AgreementBody', parent=styles['Normal'], fontSize=10.5, leading=15))
    styles.add(ParagraphStyle('AgreementClause', parent=styles['Heading3'], fontSize=10.5,
                              leading=16, spaceBefore=7, spaceAfter=5, textColor=gold))
    clean = lambda s: ''.join(c for c in str(s or '').replace('\u2014','-').replace('\u2013','-') if ord(c) < 0x1f000)
    def para(value, style='Normal'):
        return Paragraph(escape(clean(value)).replace('\n', '<br/>'), styles[style])
    story = []
    def heading(value, note=''):
        story.extend([para(value, 'Title')])
        if note:
            story.extend([para(note, 'Small'), Spacer(1, 12)])
    def section(value, team='general'):
        style = ParagraphStyle('section-'+team, parent=styles['Heading2'], textColor=tones[team],
                               borderColor=tones[team],borderWidth=0,borderPadding=7,
                               backColor=colors.HexColor('#102329' if team=='blue' else '#291417' if team=='red' else '#242116'))
        gap=Spacer(1,5);gap.keepWithNext=True
        story.extend([Paragraph(escape(clean(value)), style), gap])
    def image(value, size=56):
        if not re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|webp)', str(value or '')):
            return None
        path = store.directory/'images'/value
        if not path.is_file():
            return None
        try:
            # Only existing validated private images; never interpret a URL/path.
            reader = ImageReader(str(path))
            w, h = reader.getSize()
            return Image(str(path), width=size*min(1,w/h), height=size*min(1,h/w))
        except Exception:
            return None
    def card_style(team='general'):
        return TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
            ('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#101d22' if team=='blue' else '#241316' if team=='red' else '#1b1a15')),
            ('BOX',(0,0),(-1,-1),.5,tones[team]),
            ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
            ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)])
    def two_columns(cards):
        # Individual rows can move to the next page, without shrinking text or
        # splitting a material's photo away from its name. The gutter stays empty.
        for start in range(0,len(cards),2):
            row=Table([[cards[start],'',cards[start+1] if start+1<len(cards) else '']],
                      colWidths=[246.5,18,246.5],hAlign='LEFT')
            row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
                ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
            story.extend([row,Spacer(1,10)])
    def inventory(objects):
        for team in ('blue', 'red'):
            chosen = sorted([o for o in objects if o['team'] == team], key=lambda o: o['title'].casefold())
            if not chosen:
                continue
            if team == 'red' and story:
                story.append(PageBreak())
            section(TEAMS[team], team)
            story.append(para(str(len(chosen))+' objetos seleccionados', 'Small'))
            cards, long_notes = [], []
            for obj in chosen:
                photo = image(obj.get('image')) if data.get('photos', True) else None
                quantity = str(obj['quantity']) if obj.get('quantity') is not None else 'Sin especificar'
                texts = [para('Cantidad: '+quantity, 'Object'),
                         para(CATEGORIES.get(obj['category'], 'Otros'), 'Small')]
                if obj.get('imageReference'):
                    texts.append(para('Imagen de catálogo orientativa', 'Small'))
                title_row=Table([[CheckBox(False,tones[team]),para(obj['title'],'Object')]],colWidths=[22,204.5])
                title_row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
                    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
                details=Table([[photo,texts]],colWidths=[68,158.5]) if photo else texts
                if photo:
                    details.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
                content=[title_row,Spacer(1,5),details] if photo else [title_row,Spacer(1,5),*texts]
                if data.get('notes', True) and obj.get('description'):
                    if len(obj['description'])<=220 and obj['description'].count('\n')<6:
                        content.append(para(obj['description'],'Small'))
                    else:
                        # Unbounded notes must flow normally across pages, not
                        # become an unsplittable cell or lose any supplied text.
                        content.append(para('Notas completas a continuación','Small'))
                        long_notes.append(obj)
                block=Table([[content]],colWidths=[246.5],hAlign='LEFT')
                block.setStyle(card_style(team));cards.append(block)
            two_columns(cards)
            for obj in long_notes:
                story.extend([para('Notas - '+obj['title'],'Heading3'),para(obj['description']),Spacer(1,12)])
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
            story.append(PlanImage(data['planImage'],problem) if 'planImage' in data else StagePlan(plan,font))
            story.append(PageBreak())
            section('Leyenda del plano')
            for number,e in enumerate(plan['elements'],1):
                block=[para(str(number)+'. '+e['label'], 'Heading3')]
                if e.get('notes'):
                    block.append(para(e['notes']))
                if number==1:
                    # Keep the section banner with its first complete entry;
                    # later legend entries can move as a unit to the next page.
                    block=story[-2:]+block;del story[-2:]
                story.append(KeepTogether(block))
            if plan.get('notes'):
                section('Notas para la sala')
                story.append(para(plan['notes']))
            from lighting import material_counts
            section('Material técnico del show')
            story.append(para('Mínimo del plano. Longitudes, conectores, adaptadores y número de focos por grupo: según la sala.','Small'))
            for label,rows in [('Cables necesarios',material_counts(plan)['cables']),('Equipos y elementos',material_counts(plan)['equipment'])]:
                story.append(para(label,'Heading3'));cards=[]
                for name,count in rows:
                    if not count:continue
                    card=Table([[para(str(count),'Score'),para(name,'Check')]],colWidths=[64,182.5])
                    card.setStyle(card_style());cards.append(card)
                two_columns(cards)
            section('Walkies - cuatro unidades')
            for w in plan['walkies']:
                story.append(para(w['label']+' - CANAL '+w['channel'], 'Heading3'))
                if w.get('notes'):story.append(para(w['notes'],'Small'))
            section('Checklist de montaje técnico')
            for group in dict.fromkeys(c['category'] for c in plan['checklist']):
                story.append(para(group,'Heading3'))
                cards=[]
                for check in plan['checklist']:
                    if check['category']==group:
                        contents=[para(check['text'],'Check'),Spacer(1,5),para('Completado' if check['done'] else 'Por comprobar','Small')]
                        card=Table([[CheckBox(check['done'],gold),contents]],colWidths=[32,214.5])
                        card.setStyle(card_style());cards.append(card)
                two_columns(cards)
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
                    story.append(para(str(total)+' puntos','Score'))
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
            if agreement_token:
                authorized = store.business.lookup(db, agreement_token)
                if not authorized or authorized['id'] != data.get('id'):
                    raise problem('Este enlace no permite descargar este acuerdo.', 403)
            agreement = db.execute('SELECT body FROM agreements WHERE id=?',(data.get('id',''),)).fetchone()
            if not agreement:
                raise problem('Acuerdo no encontrado.',404)
            document = __import__('json').loads(agreement['body'])
            lines = document['text'].splitlines()
            standard = lines and lines[0].startswith('ACUERDO DE COLABORACIÓN')
            heading(title or ('Acuerdo de colaboración artística puntual' if standard else 'Acuerdo de colaboración'),
                    document.get('eventTitle', '') + ' · ' + document['name'])
            if standard:
                lines = lines[2:]
            acceptance_index = None
            for line in lines:
                if line.startswith('Fdo. LA COMPAÑÍA'):
                    break
                if not line.strip():
                    story.append(Spacer(1, 6))
                elif line == 'CLÁUSULAS' or re.match(r'^[A-ZÁÉÍÓÚÑ]+\. ', line):
                    if line.startswith('DECIMOCUARTA.'):
                        acceptance_index = len(story)
                    story.append(para(line, 'AgreementClause'))
                else:
                    story.append(para(line, 'AgreementBody'))
            if any(line.startswith('Fdo. LA COMPAÑÍA') for line in lines):
                names = lines[-1].split('                         ', 1)
                signatures = Table([[
                    [para('LA COMPAÑÍA', 'AgreementClause'), Spacer(1, 32),
                     para(document.get('representative') or names[0], 'Small')],
                    [para('LA PERSONA COLABORADORA', 'AgreementClause'), Spacer(1, 32),
                     para(names[-1] if len(names) > 1 else document['name'], 'Small')]]],
                     colWidths=[255.5,255.5])
                signatures.setStyle(card_style())
                closing = story[acceptance_index:] if acceptance_index is not None else []
                if acceptance_index is not None:
                    del story[acceptance_index:]
                story.append(KeepTogether(closing+[Spacer(1,12), signatures]))
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
            section('Concepto')
            story.append(para(invoice.get('concept') or 'Participación en <SCRI> B · '+invoice['eventTitle']))
            story.append(Spacer(1, 12))
            for line in invoice['lines']:
                story.append(para(str(line.get('concept') or line['date'])+' - '+f"{line['amount']/100:.2f} EUR"))
            for label,key in [('Base imponible','base'),('IVA','vat'),('Retención','withholding'),('Total','total')]:
                value = -invoice[key] if key=='withholding' else invoice[key]
                story.append(para(label+': '+f"{value/100:.2f} EUR",'Heading3'))
            story.append(para('Transferencia: '+str(invoice['issuer'].get('iban') or 'Cuenta pendiente de confirmar'),'Small'))
            story.append(para('No constituye una factura emitida, aceptación ni orden de pago.','Small'))
    created=datetime.now(timezone.utc).isoformat(timespec='seconds')
    stamp = datetime.fromisoformat(created).astimezone(ZoneInfo('Europe/Madrid')).strftime('%d/%m/%Y %H:%M')
    reference='SC-'+uuid.uuid4().hex
    labels={'inventory':'KIT DE ESCENA','event':'HOJA DE LLAMADA','lighting':'TÉCNICA',
            'report':'MEMORIA DE PARTIDA','agreement':'COLABORACIÓN','invoice':'GESTIÓN'}
    buffer = io.BytesIO()
    def frame(canvas, doc):
        w,h = A4
        canvas.saveState()
        canvas.setFillColor(colors.HexColor('#050505'));canvas.rect(0,0,w,h,fill=1,stroke=0)
        # Reuse the actual brackets-and-pen logo, softly behind the document.
        # Set alpha after the color, and restore before drawing foreground ink.
        canvas.saveState()
        canvas.setFillAlpha(.055)
        canvas.drawImage(str(ROOT/'assets/scrib-world-logo.png'),w/2-190,h/2-190,380,380,mask='auto')
        canvas.restoreState()
        # Same visual language as the videogame's report: black page, logos at
        # either end of a dark header, white heading and a cyan/red rule.
        canvas.setFillColor(colors.HexColor('#0c0c0c'));canvas.rect(0,h-82,w,82,fill=1,stroke=0)
        canvas.drawImage(str(ROOT/'assets/scrib-world-logo.png'),36,h-73,62,62,mask='auto')
        canvas.drawImage(str(ROOT/'materials/shared/logo_sutura.png'),w-89,h-66,47,47,preserveAspectRatio=True,mask='auto')
        canvas.setFont('ScribSansBold',16);canvas.setFillColor(ink)
        canvas.drawString(111,h-38,labels[kind])
        canvas.setFont('ScribSansBold',7.8);canvas.setFillColor(muted)
        canvas.drawString(111,h-57,'PRODUCCIÓN / SUTURA TEATRO')
        canvas.setFillColor(tones['blue']);canvas.rect(36,h-85,(w-72)/2,3,fill=1,stroke=0)
        canvas.setFillColor(tones['red']);canvas.rect(w/2,h-85,(w-72)/2,3,fill=1,stroke=0)
        canvas.setStrokeColor(colors.HexColor('#383838'));canvas.setLineWidth(.5);canvas.line(42,82,w-42,82)
        canvas.setFont('ScribSansBold',7);canvas.setFillColor(ink)
        for x,icon,label,url in [(42,'instagram','@scrib_show','https://www.instagram.com/scrib_show/'),
                                 (154,'instagram','@su.tu.ra','https://www.instagram.com/su.tu.ra/'),
                                 (254,'web','scribshow.es','https://scribshow.es/'),
                                 (358,'mail','scribaleatorio@gmail.com','mailto:scribaleatorio@gmail.com')]:
            draw_icon(canvas,icon,x,64,10,tones['blue'])
            canvas.drawString(x+15,66,label)
            canvas.linkURL(url,(x,63,x+15+pdfmetrics.stringWidth(label,'ScribSansBold',7),75),relative=0,thickness=0)
        draw_icon(canvas,'lock',42,46,9,gold)
        canvas.setFillColor(muted);canvas.setFont('ScribSansBold',6.5)
        canvas.drawString(57,48,'MATERIAL INTERNO. NO DISTRIBUIR, REPRODUCIR NI PUBLICAR SIN AUTORIZACIÓN DE SUTURA TEATRO.')
        draw_icon(canvas,'document',42,29,9,muted)
        canvas.setFont(font,6.2);canvas.setFillColor(muted);canvas.drawString(57,31,'Ref. '+reference)
        draw_icon(canvas,'clock',351,29,9,muted)
        canvas.drawString(365,31,stamp)
        canvas.setFont('ScribSansBold',9);canvas.setFillColor(ink)
        canvas.drawRightString(w-42,31,str(doc.page))
        canvas.restoreState()
    doc = SimpleDocTemplate(buffer,pagesize=A4,rightMargin=42,leftMargin=42,
                           topMargin=107,bottomMargin=96,title=title or 'SCRIB - '+kind,
                           author='SCRIB / Sutura Teatro')
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    from document_trace import seal_pdf
    return seal_pdf(store,buffer.getvalue(),user,kind,data.get('id',''),reference,created)


def draw_icon(canvas,kind,x,y,size,color):
    """Small vector icons: reliable in PDF viewers without emoji/font fallbacks."""
    canvas.saveState();canvas.translate(x,y);canvas.scale(size/12,size/12)
    canvas.setStrokeColor(color);canvas.setFillColor(color);canvas.setLineWidth(1)
    if kind=='instagram':
        canvas.roundRect(1,1,10,10,3,fill=0);canvas.circle(6,6,2.4,fill=0);canvas.circle(9,9,.6,fill=1)
    elif kind=='mail':
        canvas.roundRect(.5,2,11,8,1,fill=0)
        canvas.line(1,9,6,5);canvas.line(6,5,11,9)
    elif kind=='web':
        canvas.circle(6,6,5,fill=0);canvas.ellipse(3,1,9,11,fill=0);canvas.line(1,6,11,6)
    elif kind=='lock':
        canvas.roundRect(2,1,8,6,1,fill=0);canvas.roundRect(4,5,4,6,2,fill=0);canvas.circle(6,4,.6,fill=1)
    elif kind=='clock':
        canvas.circle(6,6,5,fill=0);canvas.line(6,6,6,9);canvas.line(6,6,9,5)
    elif kind=='document':
        p=canvas.beginPath();p.moveTo(2,1);p.lineTo(10,1);p.lineTo(10,8);p.lineTo(7,11);p.lineTo(2,11);p.close()
        canvas.drawPath(p);canvas.line(7,11,7,8);canvas.line(7,8,10,8)
        canvas.line(4,5,8,5);canvas.line(4,3,7,3)
    canvas.restoreState()


def CheckBox(done,color):
    from reportlab.platypus import Flowable
    class Drawing(Flowable):
        def __init__(self):
            super().__init__();self.width,self.height=14,16
        def draw(self):
            c=self.canv;c.setStrokeColor(color);c.setLineWidth(1.2);c.roundRect(0,1,13,13,3,fill=0)
            if done:
                c.setLineWidth(1.8);p=c.beginPath();p.moveTo(3,7);p.lineTo(5.5,4.5);p.lineTo(10,10);c.drawPath(p)
    return Drawing()


def PlanImage(encoded,problem):
    # Decode a bounded local PNG only: never XML, a path or remote content.
    from PIL import Image as PillowImage
    from reportlab.platypus import Image
    if not isinstance(encoded,str) or len(encoded)>3*1024*1024:
        raise problem('La imagen del plano es demasiado grande o no es válida.')
    try:
        raw=base64.b64decode(encoded,validate=True)
        with PillowImage.open(io.BytesIO(raw)) as image:
            width,height=image.size
            if image.format!='PNG' or not 1000<=width<=2000 or (height*4!=width*5 and height*5!=width*8) or width*height>5_000_000:
                raise ValueError('Invalid plan dimensions')
            image.verify()
    except (ValueError,binascii.Error,OSError,PillowImage.DecompressionBombError):
        raise problem('No se pudo leer la imagen del plano. Vuelve a exportar desde Técnica.') from None
    result=Image(io.BytesIO(raw),width=535*width/height,height=535);result.hAlign='CENTER'
    return result


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
            c.setFillColor(colors.HexColor('#101217'));c.roundRect(0,10,511,520,8,fill=1,stroke=0)
            c.setStrokeColor(colors.HexColor('#596173'))
            c.rect(35,530-620*.31,430,540*.31,fill=0)
            c.rect(30,530-1240*.31,450,510*.31,fill=0)
            c.rect(30,530-1580*.31,450,300*.31,fill=0)
            c.setFont(font,9)
            for label,y in [('TÉCNICA',745),('SALA INTÉRPRETES',1310)]:
                c.setFillColor(colors.HexColor('#bec7da'));c.drawCentredString(255,530-y*.31,label)
            def point(e):
                x,y=coordinates(e);return x/2,530-y*.31
            nodes={e['id']:e for e in plan['elements']}
            # Numbered symbols avoid long labels colliding. Full names below the diagram.
            for connection in plan['connections']:
                if connection['type'] not in ('hdmi','dmx'):continue
                a,b=point(nodes[connection['from']]),point(nodes[connection['to']])
                c.setStrokeColor(colors.HexColor('#46c8ff' if connection['type']=='hdmi' else '#64d997'))
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
                color='#bec7da' if e['type']=='monitor' else {'blue':'#46f0ff','red':'#ff6b6b','warm':'#f2d777','white':'#bec7da'}[e['color']]
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
            c.setFillColor(colors.HexColor('#b0b8c7'));c.setFont(font,8)
            c.drawCentredString(255,260,'PÚBLICO / PROSCENIO')
            c.drawCentredString(137,229,'TÉCNICA');c.drawCentredString(367,229,'SALA DE INTÉRPRETES')
            c.drawCentredString(255,515,'HDMI: azul - DMX: verde - detalles de todas las conexiones a continuación')
    return Drawing()
