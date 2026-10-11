"""Remove only obsolete per-bolo tasks after inspecting the exact planned IDs.

Dry run prints an expected manifest. --apply requires that same manifest and
creates a private SQLite backup first. Bolos and boards are never removed.
"""
import argparse
import json
import os
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from server import Store


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',required=True)
    parser.add_argument('--expect',help='Reviewed JSON manifest from the dry run')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    os.umask(0o077)
    store=Store(args.data)
    if not args.apply:
        print(json.dumps(store.retire_bolo_tasks(),indent=2))
        return
    if not args.expect:parser.error('--apply requires --expect')
    expected=json.loads(Path(args.expect).read_text())
    if expected!=store.retire_bolo_tasks():raise SystemExit('Las tareas han cambiado; revisa la selección.')
    directory=store.directory/'backups'
    directory.mkdir(mode=0o700,exist_ok=True)
    backup=directory/('before-retire-bolo-tasks-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.sqlite3')
    with store.connect() as original,sqlite3.connect(backup) as saved:
        original.backup(saved)
        assert saved.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    backup.chmod(0o600)
    removed=store.retire_bolo_tasks(expected,True,'3cejas')
    print(json.dumps({'removedTasks':len(removed),'backup':str(backup),'bolosAndBoardsPreserved':True}))


if __name__=='__main__':main()
