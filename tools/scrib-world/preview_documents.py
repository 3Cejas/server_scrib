"""Generate fictitious QA samples only; never touch the live world or cast."""
import argparse
from pathlib import Path
import tempfile
import uuid

from server import Store
from inventory_seed import apply_initial_inventory
from inventory_teams import apply_team_inventory
from pdf_export import generate


def main():
    parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='scrib-pdf-preview-') as directory:
        store=Store(directory);store.identify('demo-exportador','Muestra ficticia')
        apply_initial_inventory(store);apply_team_inventory(store)
        event=store.create('event',{'title':'León - función de muestra','start':'2026-11-07T19:00','arrival':'2026-11-07T17:00','venue':'Auditorio de ejemplo','city':'León','description':'DATOS FICTICIOS PARA REVISAR EL DISEÑO.\nConvocatoria del equipo y montaje técnico.'},'demo-exportador',str(uuid.uuid4()))
        report={'version':1,'id':'muestra-diseno','bolo':{'id':event['id'],'title':event['title']},'startedAt':1794050000000,'endedAt':1794051000000,
                'writers':{'1':{'name':'ESCRITXR AZUL - MUESTRA','text':'La ciudad despertó con un volcán de palabras bajo las calles.\n\nNadie quiso huir: por primera vez, todas las ventanas estaban escuchando.\nY la historia apenas empezaba.'},
                           '2':{'name':'ESCRITXR ROJO - MUESTRA','text':'Abrió la puerta del teatro y encontró el mar al otro lado.\n\nSobre las butacas flotaban cartas sin remitente.\nAlguien se atrevió a leer el final en voz alta.'}},
                'stats':{'players':{'1':{'palabrasTotal':238,'palabrasUnicas':151,'ritmoPpm':76,'valorInspiracion':27},'2':{'palabrasTotal':216,'palabrasUnicas':143,'ritmoPpm':72,'valorInspiracion':23}}},
                'score':{'disponible':True,'jugadores':{'1':{'total':84.5},'2':{'total':78.2}}},
                'muses':{'equipos':{'1':{'musas':[{'nombre':'NÉBULA','stats':{'introducidas':13,'enviadas':18}},{'nombre':'LUNA','stats':{'introducidas':7,'enviadas':14}}]},'2':{'musas':[{'nombre':'CASIOPEA','stats':{'introducidas':9,'enviadas':16}}]}}}}
        store.business.archive_report(report)
        with store.connect() as db:ids=[o['id'] for o in store.all(db,'inventory')]
        for name,data in [('inventario-scrib-muestra.pdf',{'kind':'inventory','ids':ids}),
                          ('tecnica-scrib-muestra.pdf',{'kind':'lighting'}),
                          ('memoria-scrib-muestra.pdf',{'kind':'report','id':'muestra-diseno'})]:
            (args.output/name).write_bytes(generate(store,data,{'role':'admin','username':'demo-exportador'}))
            print(args.output/name)

if __name__=='__main__':main()
