#!/usr/bin/env python3
"""Create an independent private SCRIB release key. Never overwrite a key."""
import os
from pathlib import Path
import secrets
import subprocess
import sys

def main():
    if len(sys.argv)!=2:raise SystemExit('Uso: create-signing-key.py /ruta/privada/firma-scrib')
    directory=Path(sys.argv[1]).resolve()
    directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    if directory.stat().st_mode&0o077:raise SystemExit('La carpeta de firma debe tener permisos 700.')
    key=directory/'scrib-release.jks';password=directory/'keystore-password'
    if key.exists() or password.exists():raise SystemExit('Ya hay material de firma. No se sobrescribe ni se regenera.')
    fd=os.open(password,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as output:output.write(secrets.token_urlsafe(48))
    os.umask(0o077)
    subprocess.run(['keytool','-genkeypair','-keystore',str(key),'-storepass:file',str(password),
                    '-keypass:file',str(password),'-alias','scrib','-dname','CN=SCRIB,O=Sutura Teatro,C=ES',
                    '-keyalg','RSA','-keysize','3072','-validity','10000'],check=True)
    print('Clave SCRIB creada. Conserva esta carpeta en una copia privada cifrada; no la subas a Git.')

if __name__=='__main__':main()
