"""Contract-based allocations; deterministic cents, no transfers or tax inference.

Sources: SCRIB Exlímite agreement (2026) and reparto_gastos_funciones_2025-26.
The agreement's 15 EUR fixed fees are defaults; the workbook uses 20 EUR for
mounting. Each performance retains its own explicitly editable rule.
"""
from decimal import Decimal, ROUND_HALF_UP

GROUPS = {'creation':'Creación del proyecto', 'music':'Música',
          'publicity':'Publicidad y difusión', 'mount':'Montaje y desmontaje',
          'direction':'Dirección', 'dramaturgy':'Dramaturgia activa',
          'cast':'Elenco y técnica'}
DEFAULTS = {'creation':'10', 'music':'2', 'publicity':'15', 'mount':'15',
            'direction':'5', 'dramaturgy':'5', 'cast':'90'}


def split_cents(total, people):
    """Equal shares, stable ID order breaks rounding ties; sum is exact."""
    people=sorted(people)
    if not people:return {}
    base,remainder=divmod(total,len(people))
    return {p:base+(i<remainder) for i,p in enumerate(people)}


def calculate(net, rule, members, money, problem, allowed):
    if not isinstance(rule,dict) or not isinstance(members,dict):
        raise problem('Revisa la regla y las personas del reparto automático.')
    rates={}
    for group in GROUPS:
        value=rule.get(group,DEFAULTS[group])
        if group in ('mount','publicity'):
            rates[group]=money(value)
        else:
            # Reuse the strict decimal euro parser, interpreting cents as 1/100%.
            hundredths=money(value)
            if hundredths>10000:raise problem('Los porcentajes deben estar entre 0 y 100.')
            rates[group]=Decimal(hundredths)/100
        selected=members.get(group,[])
        if not isinstance(selected,list) or len(selected)>100 or any(not isinstance(p,str) or p not in allowed for p in selected) or len(set(selected))!=len(selected):
            raise problem('Personas no válidas en '+GROUPS[group]+'.')
    if rates['creation']+rates['music']>100:
        raise problem('Creación y música no pueden superar el 100% del neto.')
    pct=lambda value,rate:int((Decimal(value)*rate/100).quantize(Decimal(1),rounding=ROUND_HALF_UP))
    budgets={g:pct(net,rates[g]) for g in ('creation','music')}
    if sum(budgets.values())>net:  # half-up at a one-cent boundary
        budgets['music']=max(0,net-budgets['creation'])
    fixed={g:rates[g] if members.get(g) else 0 for g in ('publicity','mount')}
    pool=net-sum(budgets.values())-sum(fixed.values())
    if pool<0:raise problem('El neto no cubre los derechos y los importes fijos. Revisa la regla.')
    budgets.update(fixed)
    active=[g for g in ('direction','dramaturgy','cast') if members.get(g) and rates[g]>0]
    weight=sum(rates[g] for g in active)
    if active:
        # Largest remainder across active percentage categories, as SUMPRODUCT
        # in the source workbook; inactive direction/dramaturgy do not get paid.
        exact={g:Decimal(pool)*rates[g]/weight for g in active}
        parts={g:int(exact[g]) for g in active}
        for g in sorted(active,key=lambda g:(-(exact[g]-parts[g]),g))[:pool-sum(parts.values())]:parts[g]+=1
        budgets.update(parts)
    allocations={}
    for group,budget in budgets.items():
        for person,amount in split_cents(budget,members.get(group,[])).items():
            row=allocations.setdefault(person,{'personId':person,'amount':0,'breakdown':[]})
            row['amount']+=amount
            row['breakdown'].append({'group':group,'label':GROUPS[group],'amount':amount,
                                    'percent':round(amount*100/net,4) if net else 0})
    allocated=sum(row['amount'] for row in allocations.values())
    return {'allocations':[allocations[p] for p in sorted(allocations)],'net':net,
            'pool':pool,'unassigned':net-allocated,
            'rule':{g:str(rule.get(g,DEFAULTS[g])) for g in GROUPS},
            'members':{g:list(members.get(g,[])) for g in GROUPS}}
