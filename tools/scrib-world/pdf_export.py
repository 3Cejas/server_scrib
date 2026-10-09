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
PLAN_SPLIT = 725
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
    paper = kind in ('invoice', 'agreement')
    ink, muted = (colors.HexColor('#182331'), colors.HexColor('#596577')) if paper else (colors.HexColor('#f4f4f6'), colors.HexColor('#b0b8c7'))
    gold = colors.HexColor('#73521e' if paper else '#f2d777')
    tones = {'blue': colors.HexColor('#14737f' if paper else '#46f0ff'), 'red': colors.HexColor('#ac3449' if paper else '#ff6b6b'),
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
    styles.add(ParagraphStyle('AgreementBody', parent=styles['Normal'], fontSize=10.5, leading=14))
    styles.add(ParagraphStyle('Money', parent=styles['Normal'], alignment=2))
    styles.add(ParagraphStyle('TotalMoney', parent=styles['Heading3'], alignment=2))
    styles.add(ParagraphStyle('AgreementClause', parent=styles['Heading3'], fontSize=10.5,
                              leading=15, spaceBefore=6, spaceAfter=3, textColor=gold))
    clean = lambda s: ''.join(c for c in str(s or '').replace('\u2014','-').replace('\u2013','-') if ord(c) < 0x1f000)
    def para(value, style='Normal'):
        return Paragraph(escape(clean(value)).replace('\n', '<br/>'), styles[style])
    story = []
    choice_number = 0
    def choice(line):
        nonlocal choice_number
        choice_number += 1
        match = re.fullmatch(r'\[([X ])\] (.+)', line)
        return AgreementChoice('participacion_'+str(choice_number), match[2], match[1]=='X', styles['AgreementBody'], ink)
    def heading(value, note=''):
        story.extend([para(value, 'Title')])
        if note:
            story.extend([para(note, 'Small'), Spacer(1, 12)])
    def section(value, team='general'):
        style = ParagraphStyle('section-'+team, parent=styles['Heading2'], textColor=tones[team],
                               borderColor=tones[team],borderWidth=0,borderPadding=7,
                               backColor=colors.HexColor('#f1f4f6' if paper else '#102329' if team=='blue' else '#291417' if team=='red' else '#242116'))
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
            ('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f7f8fa' if paper else '#101d22' if team=='blue' else '#241316' if team=='red' else '#1b1a15')),
            ('BOX',(0,0),(-1,-1),.5,tones[team]),
            ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
            ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)])
    def two_columns(cards, gap=10):
        # Individual rows can move to the next page, without shrinking text or
        # splitting a material's photo away from its name. The gutter stays empty.
        for start in range(0,len(cards),2):
            row=Table([[cards[start],'',cards[start+1] if start+1<len(cards) else '']],
                      colWidths=[246.5,18,246.5],hAlign='LEFT')
            row.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
                ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
            story.extend([row,Spacer(1,gap)])
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
            rehearsal=event.get('eventType')=='rehearsal'
            heading(title or event['title'], ('ENSAYO - ' if rehearsal else 'HOJA DE LLAMADA - ')+event['start'][:10])
            for label, value in [('Espacio', ' - '.join(filter(None,[event['venue'],event['city']]))),
                                  ('Ensayo' if rehearsal else 'Función',event['start'].replace('T',' ')),
                                  ('Fin',event['end'].replace('T',' ')),
                                  *([] if rehearsal else [('Convocatoria',event['arrival'].replace('T',' '))])]:
                story.extend([para(label, 'Heading3'), para(value or 'Pendiente'), Spacer(1, 8)])
            for team in ('blue','red','general'):
                rows = [c for c in event['cast'] if (c['team'] if c['role'] in ('Escritura','Interpretación') else 'general') == team]
                if not rows:
                    continue
                section('PERSONAS CONVOCADAS' if rehearsal else TEAMS.get(team,'EQUIPO DEL ESPECTÁCULO'), team)
                for row in rows:
                    person = store.item(db,row['personId'],'person')
                    story.append(para(person['name'] if rehearsal else person['name']+' - '+row['role']))
                story.append(Spacer(1, 15))
            if event['description']:
                section('Notas de producción')
                story.append(para(event['description']))
            allowed = event.get('inventoryIds')
            objects = [o for o in all_objects if allowed is None or o['id'] in allowed]
            if objects and not rehearsal:
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
            heading(title or 'Plano técnico', 'Escenario y público')
            story.append(PlanImage(data['planImage'],problem,'stage') if 'planImage' in data else StagePlan(plan,font,'stage'))
            story.append(PageBreak())
            heading('Técnica y sala de intérpretes', 'Continuación del mismo plano - conexiones y distribución')
            story.append(PlanImage(data['planImage'],problem,'backstage') if 'planImage' in data else StagePlan(plan,font,'backstage'))
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
            choice_lines = []
            def flush_choices():
                if choice_lines:
                    two_columns([choice(line) for line in choice_lines], gap=3)
                    choice_lines.clear()
            for line in lines:
                if re.fullmatch(r'\[[X ]\] .+', line):
                    choice_lines.append(line)
                    continue
                flush_choices()
                if line.startswith('Fdo. LA COMPAÑÍA'):
                    break
                if not line.strip():
                    story.append(Spacer(1, 4))
                elif line == 'CLÁUSULAS' or re.match(r'^[A-ZÁÉÍÓÚÑ]+\. ', line):
                    if line.startswith('DECIMOCUARTA.'):
                        acceptance_index = len(story)
                    story.append(para(line, 'AgreementClause'))
                else:
                    story.append(para(line, 'AgreementBody'))
            flush_choices()
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
            heading('Factura', 'BORRADOR - NO EMITIDO')
            story.append(para('N.º '+str(invoice.get('series',''))+' / '+str(invoice.get('number') or 'Pendiente')+
                              '  |  Fecha: '+str(invoice.get('date','')),'Small'))
            parties=[]
            for label, party, name in [('EMISOR',invoice['issuer'],invoice['issuer'].get('legalName','')),
                                       ('DESTINATARIO',invoice['recipient'],invoice['recipient'].get('name',''))]:
                parties.append([para(label,'AgreementClause'),para(name,'Heading3'),
                                para('NIF / CIF: '+str(party.get('taxId',''))),para(party.get('address',''))])
            party_table=Table([[parties[0],parties[1]]],colWidths=[255.5,255.5])
            party_table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),
                ('RIGHTPADDING',(0,0),(-1,-1),16),('BOTTOMPADDING',(0,0),(-1,-1),18)]))
            story.append(party_table)
            section('Concepto')
            story.append(para(invoice.get('concept') or 'Participación en <SCRI> B · '+invoice['eventTitle']))
            story.append(Spacer(1, 12))
            amounts=[[para('DÍA DE FUNCIÓN','Small'),para('HONORARIOS','Small')]]
            amounts.extend([[para(store.business.event_date(line['date'],True)),para(f"{line['amount']/100:.2f} EUR",'Money')]
                            for line in invoice['lines']])
            amounts_table=Table(amounts,colWidths=[380,131],hAlign='LEFT')
            amounts_table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(1,0),(1,-1),'RIGHT'),
                ('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#dbe0e6')),('LEFTPADDING',(0,0),(-1,-1),8),
                ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
            story.extend([amounts_table,Spacer(1,16)])
            totals=[]
            for label,key in [('Base imponible','base'),('IVA '+str(invoice['issuer'].get('vat',''))+' %','vat'),
                              ('IRPF '+str(invoice['issuer'].get('withholding',''))+' %','withholding'),('TOTAL A PERCIBIR','total')]:
                value = -invoice[key] if key=='withholding' else invoice[key]
                totals.append([para(label,'Heading3' if key=='total' else 'Normal'),
                               para(f"{value/100:.2f} EUR",'TotalMoney' if key=='total' else 'Money')])
            totals_table=Table(totals,colWidths=[210,100],hAlign='RIGHT')
            totals_table.setStyle(TableStyle([('ALIGN',(1,0),(1,-1),'RIGHT'),('TOPPADDING',(0,0),(-1,-1),8),
                ('BACKGROUND',(0,-1),(-1,-1),colors.HexColor('#edf4f5')),('LINEABOVE',(0,-1),(-1,-1),.8,tones['blue'])]))
            story.extend([totals_table,Spacer(1,14)])
            story.append(para('Transferencia: '+str(invoice['issuer'].get('iban') or 'Cuenta pendiente de confirmar'),'Small'))
    created=datetime.now(timezone.utc).isoformat(timespec='seconds')
    stamp = datetime.fromisoformat(created).astimezone(ZoneInfo('Europe/Madrid')).strftime('%d/%m/%Y %H:%M')
    reference='SC-'+uuid.uuid4().hex
    labels={'inventory':'KIT DE ESCENA','event':'HOJA DE LLAMADA','lighting':'TÉCNICA',
            'report':'MEMORIA DE PARTIDA','agreement':'COLABORACIÓN','invoice':'GESTIÓN'}
    buffer = io.BytesIO()
    def frame(canvas, doc):
        w,h = A4
        canvas.saveState()
        canvas.setFillColor(colors.white if paper else colors.HexColor('#050505'));canvas.rect(0,0,w,h,fill=1,stroke=0)
        # Reuse the actual brackets-and-pen logo, softly behind the document.
        # Set alpha after the color, and restore before drawing foreground ink.
        if not paper:
            canvas.saveState()
            canvas.setFillAlpha(.055)
            canvas.drawImage(str(ROOT/'assets/scrib-world-logo.png'),w/2-190,h/2-190,380,380,mask='auto')
            canvas.restoreState()
        # Same visual language as the videogame's report: black page, logos at
        # either end of a dark header, white heading and a cyan/red rule.
        canvas.setFillColor(colors.white if paper else colors.HexColor('#0c0c0c'));canvas.rect(0,h-82,w,82,fill=1,stroke=0)
        if paper:
            canvas.setFillColor(colors.HexColor('#182331'));canvas.roundRect(36,h-73,62,62,10,fill=1,stroke=0)
        canvas.drawImage(str(ROOT/'assets/scrib-world-logo.png'),36,h-73,62,62,mask='auto')
        if paper:
            canvas.drawImage(str(ROOT/'assets/sutura-document-logo.png'),w-195,h-58,155,36,preserveAspectRatio=True,mask='auto')
        else:
            canvas.drawImage(str(ROOT/'materials/shared/logo_sutura.png'),w-89,h-66,47,47,preserveAspectRatio=True,mask='auto')
        canvas.setFont('ScribSansBold',16);canvas.setFillColor(ink)
        canvas.drawString(111,h-38,labels[kind])
        canvas.setFont('ScribSansBold',7.8);canvas.setFillColor(muted)
        canvas.drawString(111,h-57,'PRODUCCIÓN / SUTURA TEATRO')
        canvas.setFillColor(tones['blue']);canvas.rect(36,h-85,(w-72)/2,3,fill=1,stroke=0)
        canvas.setFillColor(tones['red']);canvas.rect(w/2,h-85,(w-72)/2,3,fill=1,stroke=0)
        canvas.setStrokeColor(colors.HexColor('#dbe0e6' if paper else '#383838'));canvas.setLineWidth(.5);canvas.line(42,82,w-42,82)
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
        if not paper:
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


def AgreementChoice(name, label, checked, style, color):
    """Real editable AcroForm checkbox, preserved by the export trace wrapper."""
    from reportlab.platypus import Flowable, Paragraph
    class Choice(Flowable):
        def __init__(self):
            super().__init__()
            self.label = Paragraph(escape(label), style)
        def wrap(self, width, height):
            self.width = width
            _, self.label_height = self.label.wrap(max(30, width-22), height)
            self.height = max(16, self.label_height)
            return width, self.height
        def draw(self):
            self.canv.acroForm.checkbox(name=name, tooltip=label, checked=checked, relative=True,
                x=0, y=self.height-13, size=12, borderWidth=.8, borderColor=color,
                fillColor=__import__('reportlab.lib.colors',fromlist=['white']).white,
                textColor=color, buttonStyle='check', fieldFlags=0, forceBorder=True)
            self.label.drawOn(self.canv,22,self.height-self.label_height)
    return Choice()


def PlanImage(encoded,problem,region=None):
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
    if region is not None:
        if region not in ('stage','backstage'):raise problem('Zona del plano no válida.')
        logical_height=1600 if height*5==width*8 else 1250
        top,bottom=(0,PLAN_SPLIT) if region=='stage' else (PLAN_SPLIT,logical_height)
        # Crop only at the empty gap between zones, not through any element.
        try:
            with PillowImage.open(io.BytesIO(raw)) as image:
                cropped=image.crop((0,round(top*height/logical_height),width,round(bottom*height/logical_height)))
                output=io.BytesIO();cropped.save(output,format='PNG');raw=output.getvalue()
                width,height=cropped.size
        except (ValueError,OSError,PillowImage.DecompressionBombError):
            raise problem('No se pudo leer la imagen del plano. Vuelve a exportar desde Técnica.') from None
        scale=min(511/width,535/height)
        result=Image(io.BytesIO(raw),width=width*scale,height=height*scale)
    else:
        result=Image(io.BytesIO(raw),width=535*width/height,height=535)
    result.hAlign='CENTER'
    return result


def StagePlan(plan,font='ScribSans',region='stage'):
    """Vector fallback with the same coordinates and cable layers as the web."""
    from reportlab.platypus import Flowable
    from reportlab.lib import colors
    from reportlab.pdfbase import pdfmetrics
    from lighting import coordinates
    class Drawing(Flowable):
        def __init__(self):
            super().__init__()
            self.top,self.bottom=(0,PLAN_SPLIT) if region=='stage' else (PLAN_SPLIT,1600)
            self.scale=511/1000
            self.width,self.height=511,(self.bottom-self.top)*self.scale
        def draw(self):
            c=self.canv
            c.saveState()
            clip=c.beginPath();clip.rect(0,0,self.width,self.height);c.clipPath(clip,stroke=0)
            c.translate(0,self.height);c.scale(self.scale,-self.scale);c.translate(0,-self.top)
            c.setFillColor(colors.HexColor('#0c101b'));c.rect(0,0,1000,1600,fill=1,stroke=0)
            for x,y,w,h in ((70,80,860,540),(60,730,900,510),(60,1280,900,300)):
                c.setFillColor(colors.HexColor('#121825'));c.setStrokeColor(colors.HexColor('#607087'))
                c.setLineWidth(2);c.roundRect(x,y,w,h,18,fill=1,stroke=1)
            def text(label,x,y,size=16,color='#e7e1ff',anchor='center',halo=False):
                # Keep text upright inside the inverted SVG coordinate system.
                c.saveState();c.translate(x,y);c.scale(1,-1)
                c.setFillColor(colors.HexColor(color));c.setFont(font,size)
                width=pdfmetrics.stringWidth(label,font,size)
                offset=0 if anchor=='left' else -width if anchor=='right' else -width/2
                if halo:
                    # A dark backing keeps names readable across cable routes.
                    c.setFillColor(colors.HexColor('#0c101b'))
                    c.roundRect(offset-4,-4,width+8,size+5,3,fill=1,stroke=0)
                    c.setFillColor(colors.HexColor(color))
                c.drawString(offset,0,label)
                c.restoreState()
            for label,y in [('FONDO DEL ESCENARIO',43),('PÚBLICO',714),('TÉCNICA',770),('SALA INTÉRPRETES',1310)]:
                text(label,500,y,17,'#bdc6d9')
            palette={'blue':'#39ccff','red':'#ff708c','warm':'#ffcf81','white':'#e7e1ff'}
            cable_colors={'hdmi':'#55d7ff','data':'#c9b8ff','audio':'#ca93ff','power':'#ffd16e','dmx':'#6ce6a4'}
            nodes={e['id']:e for e in plan['elements']}
            for index,connection in enumerate(plan['connections']):
                source,target=nodes[connection['from']],nodes[connection['to']]
                ax,ay=coordinates(source);bx,by=coordinates(target)
                c.setStrokeColor(colors.HexColor(cable_colors[connection['type']]));c.setLineWidth(3)
                c.setDash(*({'power':(8,5),'dmx':(3,4),'data':(3,5)}.get(connection['type'],())))
                p=c.beginPath();p.moveTo(ax,ay)
                if source.get('zone')!=target.get('zone'):
                    margin=965-index*3 if target['x']>50 else 35+index*3
                    p.lineTo(margin,ay);p.lineTo(margin,by)
                else:p.lineTo(ax,(ay+by)/2);p.lineTo(bx,(ay+by)/2)
                p.lineTo(bx,by);c.drawPath(p)
            c.setDash()
            for e in plan['elements']:
                x,y=coordinates(e);kind=e['type']
                color=palette['white' if kind=='monitor' else e['color']]
                c.setStrokeColor(colors.HexColor(color));c.setFillColor(colors.HexColor('#171e2d'));c.setLineWidth(2)
                if kind=='screen':c.roundRect(x-150,y-30,300,60,5,fill=1,stroke=1)
                elif kind=='desk':c.roundRect(x-80,y-30,160,60,10,fill=1,stroke=1);c.rect(x-27,y-22,54,30,fill=0)
                elif kind in ('monitor','computer','console','projector','splitter','video-card','psu','controller'):
                    c.roundRect(x-35,y-24,70,43,5,fill=1,stroke=1)
                elif kind=='power':c.roundRect(x-13,y-22,26,44,6,fill=1,stroke=1)
                elif kind=='speaker':
                    c.roundRect(x-23,y-35,46,70,5,fill=1,stroke=1);c.circle(x,y-16,8,fill=0);c.circle(x,y+13,15,fill=0)
                elif kind=='front':
                    for offset in (-115,0,115):c.circle(x+offset,y,23,fill=1,stroke=1)
                elif kind=='smoke':
                    c.roundRect(x-28,y-15,56,30,5,fill=1,stroke=1);c.line(x,y+15,x,y+40);c.line(x,y+40,x-10,y+30);c.line(x,y+40,x+10,y+30)
                else:c.circle(x,y,25,fill=1,stroke=1)
                label=e['label']
                if kind!='monitor' and e['color'] in ('blue','red'):
                    label=re.sub(r'(?:\s*·)?\s+(?:azul(?:es)?|roj[oa]s?)$','',label,flags=re.I)
                parts=label.split(' · ') if e.get('zone') or kind=='spot' else [label]
                offset=67 if kind=='desk' and not e.get('zone') else 62 if kind=='screen' else -28 if kind=='smoke' else -60 if kind=='spot' else 45 if kind=='street' else 32 if kind=='power' and e.get('zone') else 43 if e.get('zone') else 57
                anchor='left' if e['id']=='blue-power' else 'right' if e['id']=='red-power' else 'center'
                for number,part in enumerate(parts):
                    text(part if len(part)<=29 else part[:28]+'…',x,y+offset+18*number,16,color,anchor,halo=True)
            for x in (280,350,420,500,580,650,720):
                c.setStrokeColor(colors.HexColor('#bdc6d9'));c.setLineWidth(2);c.circle(x,650,7,fill=0)
                c.line(x,660,x,680);c.line(x-7,680,x-7,690);c.line(x+7,680,x+7,690)
            c.restoreState()
    return Drawing()
