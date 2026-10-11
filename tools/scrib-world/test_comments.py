"""Photo conversations, compatibility, deletion and authenticated API checks."""
import base64
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import uuid
import zipfile

import test_world as fixtures

world = fixtures.world
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='


class CommentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = world.Store(self.tmp.name)
        self.store.identify('angela','Ángela')
        self.ticket = self.store.create('ticket', {'title':'Fotos','boardId':'dramaturgia'}, 'angela', str(uuid.uuid4()))
        self.image = self.store.upload(PNG)

    def tearDown(self):
        self.tmp.cleanup()

    def comment(self, body='', attachments=None, token=None):
        return self.store.comment(self.ticket['id'],body,'angela',token or str(uuid.uuid4()),attachments)

    def delete(self, comment, token=None, **changes):
        return self.store.delete_comment(comment['id'], changes.get('ticket',self.ticket['id']), 'angela', token or str(uuid.uuid4()), changes.get('confirmed',True))

    def dispatch(self, path, data=None, **changes):
        handler = object.__new__(world.Handler)
        handler.server = SimpleNamespace(store=self.store,demo=False,secret='isolated-secret',origins={'https://sutura-gateway.ddns.net'})
        handler.command = 'POST' if data is not None else 'GET'
        handler.path = world.PREFIX + path
        token = handler.csrf_token('angela')
        handler.headers = {'X-Scrib-Bridge':'isolated-secret','X-Scrib-User':'angela','Origin':'https://sutura-gateway.ddns.net',
                           'Cookie':'scrib_world_csrf='+token,'X-CSRF-Token':token,**changes}
        body = json.dumps(data).encode() if data is not None else b''
        handler.headers.update({'Content-Length':str(len(body)),'Content-Type':'application/json'})
        handler.rfile=io.BytesIO(body);handler.connection=SimpleNamespace(settimeout=lambda _:None)
        results=[];handler.reply=lambda *args,**kwargs:results.append(args);handler.dispatch()
        return results[0]

    def test_image_only_and_text_with_photos_survive_reload_and_export(self):
        first=self.comment(attachments=[self.image]);second=self.comment('Uno\nDos <script>',[self.image,self.image])
        self.assertEqual(second['attachments'],[self.image])
        again=world.Store(self.tmp.name)
        self.assertEqual(again.details(self.ticket['id'])['comments'],[first,second])
        with zipfile.ZipFile(io.BytesIO(self.store.export())) as z:
            payload=json.loads(z.read('mundo-scrib.json'))
            self.assertEqual(len(payload['commentAttachments']),2)
            self.assertEqual(z.read('images/'+self.image),base64.b64decode(PNG))

    def test_attachment_validation_and_empty_message(self):
        for photos in ([self.image]*5,['../secret'],['https://example.invalid/x.png'],['0'*64+'.jpg'],[{}],{},'photo'):
            with self.subTest(photos=photos),self.assertRaises(world.Problem):self.comment(attachments=photos)
        with self.assertRaises(world.Problem):self.comment('  ')
        with self.assertRaises(world.Problem):self.comment('x'*10001,[self.image])

    def test_photo_send_is_idempotent_and_rejects_changed_payload(self):
        token=str(uuid.uuid4());first=self.comment('Foto',[self.image],token)
        self.assertEqual(self.comment('Foto',[self.image],token),first)
        with self.assertRaises(world.Problem) as error:self.comment('Distinta',[self.image],token)
        self.assertEqual(error.exception.status,409)
        self.assertEqual(len(self.store.details(self.ticket['id'])['comments']),1)

    def test_text_only_legacy_receipt_and_schema_remain_compatible(self):
        token=str(uuid.uuid4());old=self.comment('Texto previo',token=token)
        legacy={k:v for k,v in old.items() if k!='attachments'}
        with self.store.transaction() as db:
            self.assertEqual(len(db.execute('PRAGMA table_info(comments)').fetchall()),5)
            row=db.execute('SELECT payload_hash FROM requests WHERE token=?',(token,)).fetchone()
            self.assertEqual(row['payload_hash'],hashlib.sha256((self.ticket['id']+'Texto previo').encode()).hexdigest())
            db.execute('UPDATE requests SET response=? WHERE token=?',(json.dumps(legacy),token))
            db.execute('DROP TABLE comment_attachments')
        again=world.Store(self.tmp.name)
        self.assertEqual(again.comment(self.ticket['id'],'Texto previo','angela',token),legacy)
        self.assertEqual(again.details(self.ticket['id'])['comments'][0]['attachments'],[])

    def test_delete_keeps_other_comments_shared_images_and_creation_tombstone(self):
        creation=str(uuid.uuid4());first=self.comment('Eliminar',[self.image],creation);other=self.comment('Conservar',[self.image])
        token=str(uuid.uuid4());result=self.delete(first,token)
        self.assertEqual(self.delete(first,token),result)
        self.assertEqual(self.store.details(self.ticket['id'])['comments'],[other])
        self.assertTrue((Path(self.tmp.name)/'images'/self.image).exists())
        with self.assertRaises(world.Problem) as error:self.comment('Eliminar',[self.image],creation)
        self.assertEqual(error.exception.status,410)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM comment_attachments').fetchone()[0],1)
            self.assertNotIn('Eliminar',db.execute('SELECT response FROM requests WHERE token=?',(creation,)).fetchone()[0])

    def test_delete_rejects_wrong_ticket_and_unconfirmed_request(self):
        c=self.comment('Conservar')
        other=self.store.create('ticket',{'title':'Otra','boardId':'dramaturgia'},'angela',str(uuid.uuid4()))
        for changes in ({'ticket':other['id']},{'confirmed':False}):
            with self.assertRaises(world.Problem):self.delete(c,**changes)
        self.assertEqual(self.store.details(self.ticket['id'])['comments'],[c])

    def test_deleting_task_removes_photo_relations_without_deleting_files(self):
        self.comment('Foto',[self.image])
        self.store.delete_ticket(self.ticket['id'],'angela',self.ticket['version'],str(uuid.uuid4()),True)
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM comment_attachments').fetchone()[0],0)
        self.assertTrue((Path(self.tmp.name)/'images'/self.image).exists())

    def test_concurrent_comments_and_delete_do_not_erase_other_messages(self):
        old=self.comment('Viejo',[self.image])
        with concurrent.futures.ThreadPoolExecutor(5) as pool:
            futures=[pool.submit(self.comment,'Foto '+str(i),[self.image]) for i in range(4)]
            futures.append(pool.submit(self.delete,old))
            for future in futures:future.result()
        self.assertEqual(len(self.store.details(self.ticket['id'])['comments']),4)

    def test_read_snapshot_stays_consistent_while_photo_messages_arrive(self):
        def read_many():
            for _ in range(60):
                for comment in self.store.details(self.ticket['id'])['comments']:
                    self.assertEqual(comment['attachments'],[self.image])
        with concurrent.futures.ThreadPoolExecutor(5) as pool:
            readers=[pool.submit(read_many) for _ in range(2)]
            writers=[pool.submit(self.comment,'Foto '+str(i),[self.image]) for i in range(12)]
            for future in readers+writers:future.result()

    def test_malformed_api_ids_and_tokens_return_validation_errors(self):
        for changes in ({'id':None},{'id':{}},{'requestId':123}):
            data={'id':self.ticket['id'],'body':'Foto','attachments':[self.image],'requestId':str(uuid.uuid4()),**changes}
            self.assertEqual(self.dispatch('api/comment',data)[0],400)

    def test_private_assets_images_and_delete_route_keep_auth_csrf_and_origin(self):
        c=self.comment('Foto',[self.image])
        data={'id':c['id'],'ticket':self.ticket['id'],'requestId':str(uuid.uuid4()),'confirmed':True}
        for headers,status in (({'X-Scrib-Bridge':''},401),({'Origin':'https://evil.invalid'},403),({'X-CSRF-Token':''},403),({'Cookie':''},403)):
            self.assertEqual(self.dispatch('api/delete-comment',data,**headers)[0],status)
        self.assertEqual(self.dispatch('api/delete-comment',data)[0],200)
        self.assertEqual(self.dispatch('api/delete-comment',data)[0],200)
        for asset in ('task-comments.js','images/'+self.image):
            self.assertEqual(self.dispatch(asset)[0],200)
            self.assertEqual(self.dispatch(asset,**{'X-Scrib-Bridge':''})[0],401)
        self.assertEqual(self.dispatch('api/comment',{'id':self.ticket['id'],'body':'','attachments':[self.image],'requestId':str(uuid.uuid4())})[0],200)


if __name__ == '__main__':
    unittest.main()
