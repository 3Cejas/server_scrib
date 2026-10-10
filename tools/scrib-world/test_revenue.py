import json
import uuid
from test_business import BusinessTests
from test_world import world
from revenue import DEFAULTS, calculate, split_cents


class RevenueTests(BusinessTests):
    def calculate(self,net=10000,**changes):
        rule=dict(DEFAULTS,**changes.pop('rule',{}))
        members={'creation':['a'],'music':['b'],'publicity':['c'],'mount':['d'],
                 'direction':['a'],'dramaturgy':['b'],'cast':['c','d']}
        members.update(changes.pop('members',{}))
        return calculate(net,rule,members,self.b.money,world.Problem,set('abcd'))

    def test_contract_rule_fixed_fees_before_pool_and_exact_cents(self):
        result=self.calculate()
        self.assertEqual(result['pool'],5800)
        self.assertEqual(result['unassigned'],0)
        self.assertEqual({a['personId']:a['amount'] for a in result['allocations']},dict(a=1290,b=490,c=4110,d=4110))
        self.assertEqual(result['rule']['mount'],'15')
        self.assertEqual(self.calculate(rule={'mount':'20'})['pool'],5300)

    def test_missing_rights_reserved_and_inactive_pool_roles_normalized(self):
        result=self.calculate(members={'creation':[],'music':[],'direction':[],'dramaturgy':[]})
        self.assertEqual(result['unassigned'],1200)
        self.assertEqual(sum(a['amount'] for a in result['allocations']),8800)
        for a in result['allocations']:self.assertEqual(a['amount'],4400)

    def test_rounding_input_validation_and_no_overallocation(self):
        self.assertEqual(split_cents(5,['c','a','b']),dict(a=2,b=2,c=1))
        for net in range(0,301):
            result=self.calculate(net,members={'publicity':[],'mount':[]})
            self.assertEqual(sum(a['amount'] for a in result['allocations'])+result['unassigned'],net)
        for args in [dict(net=1),dict(rule={'music':'101'}),dict(rule={'creation':'99','music':'2'}),dict(members={'creation':['foreign']}),dict(members={'cast':['a','a']})]:
            with self.assertRaises(world.Problem):self.calculate(**args)

    def auto_day(self,**changes):
        return dict(date='2026-11-07',income='100',expenses='0',mode='auto',rule=DEFAULTS,
                    members={'cast':[self.person['id']]},allocations=[],**changes)

    def test_preview_readonly_save_authoritative_and_paid_amount_protected(self):
        day=self.auto_day()
        revision=self.store.snapshot()['revision']
        result=self.b.settlement_preview(dict(id=self.event['id'],eventVersion=self.event['version'],day=day))
        self.assertEqual(result['allocations'][0]['amount'],8800)
        self.assertEqual(self.store.snapshot()['revision'],revision)
        day['allocations']=[dict(personId=self.person['id'],amount='999999',paid=True,paymentDate='2026-11-08')]
        saved=self.settlement(days=[day])
        self.assertEqual(saved['days'][0]['allocations'][0]['amount'],8800)
        day['income']='200'
        with self.assertRaisesRegex(world.Problem,'pago registrado'):self.settlement(version=1,days=[day])
        self.assertEqual(self.b.overview()['records'][0]['version'],1)
        day['allocations'][0]['paid']=False
        with self.assertRaisesRegex(world.Problem,'pago registrado'):self.settlement(version=1,days=[day])
        day['income']='100';self.settlement(version=1,days=[day])
        day['income']='200';self.settlement(version=2,days=[day])

    def test_financial_participant_can_have_own_agreement_without_cast_slot(self):
        creator=self.store.create('person',{'name':'Autora de proyecto'},'admin',str(uuid.uuid4()))
        day=self.auto_day();day['members']['creation']=[creator['id']]
        self.settlement(days=[day]);settings=self.settings()
        self.b.generate(dict(eventId=self.event['id'],eventVersion=self.event['version'],settingsVersion=settings['version'],people=[creator['id']]),'admin')
        agreement=self.b.agreements(self.event['id'])['agreements'][0]
        self.assertIn('Creación del proyecto',agreement['text'])
        self.assertEqual(agreement['personId'],creator['id'])

    def test_invoice_requires_matching_reviewed_upload_not_any_agreement(self):
        self.settings();self.settlement()
        self.b.save('billing',dict(id=self.person['id'],version=0,legalName='Prueba',taxId='TEST',address='Test',vat='0',withholding='0',verified=True),'admin')
        data=dict(eventId=self.event['id'],personId=self.person['id'],date='2026-11-08')
        with self.assertRaisesRegex(world.Problem,'acuerdo firmado'):self.b.invoice(data,'admin')
        settings=next(r for r in self.b.overview()['records'] if r['type']=='settings')
        self.b.generate(dict(eventId=self.event['id'],eventVersion=self.event['version'],settingsVersion=settings['version'],people=[self.person['id']]),'admin')
        with self.assertRaisesRegex(world.Problem,'acuerdo firmado'):self.b.invoice(data,'admin')
        agreement=self.signed_agreement()
        invoice=self.b.invoice(data,'admin');self.assertEqual(invoice['agreementId'],agreement['id'])
        self.b.agreement_state(dict(id=agreement['id'],status='revoked'),'admin')
        with self.assertRaisesRegex(world.Problem,'acuerdo firmado'):self.b.invoice(data,'admin')

    def test_address_correction_idempotent_preserves_template_and_confirmation(self):
        from correct_sutura_address import apply,ADDRESS
        settings=self.b.save('settings',dict(id='organizer',version=0,name='ASOCIACIÓN SUTURA',taxId='TEST',address='',representative='Prueba',template='Texto {persona}',confirmed=False),'admin')
        self.assertTrue(apply(self.store)['changed'])
        record=next(r for r in self.b.overview()['records'] if r['type']=='settings')
        self.assertEqual(record['address'],ADDRESS);self.assertFalse(record['confirmed'])
        self.assertEqual(record['template'],settings['template']);self.assertEqual(record['version'],2)
        self.assertFalse(apply(self.store)['changed'])
