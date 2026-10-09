import hashlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import xml.etree.ElementTree as ET
import zipfile

from test_world import world

ROOT=Path(__file__).resolve().parent
APP=ROOT.parent.parent/'android-app'
ANDROID='{http://schemas.android.com/apk/res/android}'


class AndroidTests(unittest.TestCase):
    def request(self,route,secret='test-secret',command='GET'):
        handler=object.__new__(world.Handler)
        handler.server=SimpleNamespace(store=None,demo=False,secret='test-secret')
        handler.command=command;handler.path=world.PREFIX+route
        handler.headers={'X-Scrib-Bridge':secret,'X-Scrib-User':'tester'}
        handler.wfile=io.BytesIO();result={'headers':{}}
        handler.send_response=lambda status:result.update(status=status)
        handler.send_header=lambda name,value:result['headers'].update({name:value})
        handler.end_headers=lambda:None
        handler.dispatch();result['body']=handler.wfile.getvalue();return result

    def test_apk_version_and_downloads_remain_authenticated_no_arbitrary_assets(self):
        for route,mime in [('android/scrib.apk','application/vnd.android.package-archive'),('android/version.json','application/json'),('documents.js','application/javascript')]:
            self.assertEqual(self.request(route,secret='')['status'],401)
            downloaded=self.request(route);self.assertEqual(downloaded['status'],200)
            self.assertTrue(downloaded['headers']['Content-Type'].startswith(mime))
            self.assertEqual(downloaded['headers']['Cache-Control'],'no-store')
            head=self.request(route,command='HEAD');self.assertEqual(head['status'],200);self.assertFalse(head['body'])
            self.assertEqual(head['headers']['Content-Length'],str(len(downloaded['body'])))
        for route in ['android/../server.py','android/scrib-release.jks','android/keystore-password','android/other.apk']:
            self.assertEqual(self.request(route)['status'],404)
        version=json.loads(self.request('android/version.json')['body']);apk=self.request('android/scrib.apk')['body']
        self.assertEqual(version['package'],'es.suturateatro.scrib');self.assertEqual(version['versionCode'],1)
        self.assertEqual(version['sha256'],hashlib.sha256(apk).hexdigest())
        with zipfile.ZipFile(io.BytesIO(apk)) as archive:
            self.assertIn('classes.dex',archive.namelist());self.assertIn('AndroidManifest.xml',archive.namelist())
            self.assertFalse(any('.jks' in name or 'password' in name for name in archive.namelist()))

    def test_android_requests_no_broad_storage_permissions_or_backup_and_enforces_tls(self):
        manifest=ET.parse(APP/'AndroidManifest.xml').getroot()
        self.assertEqual([p.get(ANDROID+'name') for p in manifest.findall('uses-permission')],['android.permission.INTERNET'])
        application=manifest.find('application');self.assertEqual(application.get(ANDROID+'allowBackup'),'false')
        self.assertEqual(application.get(ANDROID+'usesCleartextTraffic'),'false')
        self.assertEqual(application.find('activity').get(ANDROID+'windowSoftInputMode'),'adjustResize')
        source=(APP/'src/es/suturateatro/scrib/MainActivity.java').read_text()
        self.assertIn('ssl.cancel()',source);self.assertNotIn('ssl.proceed()',source)
        self.assertIn('Intent.ACTION_CREATE_DOCUMENT',source);self.assertIn('setInstanceFollowRedirects(false)',source)


if __name__=='__main__':unittest.main()
