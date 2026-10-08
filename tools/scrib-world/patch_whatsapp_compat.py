"""Reviewed minimal MsgKey compatibility patch; never opens a browser itself.

Underlying issue/fix: https://github.com/wwebjs/whatsapp-web.js/pull/201871
Applied only to the existing bridge dependency; restore its backup to roll back.
No replacement of cryptographic IDs, authentication data, or WhatsApp session.
"""
import argparse
import shutil
from pathlib import Path

MARKER = '// Compatibility with the July 2026 MsgKey rename; upstream PR #201871.'
PATCH = '''
    // Compatibility with the July 2026 MsgKey rename; upstream PR #201871.
    // Preserve existing own keys and restore only the former prototype accessor.
    try {
        const proto = window.require('WAWebMsgKey')?.prototype;
        if (proto && !Object.getOwnPropertyDescriptor(proto, '_serialized')) {
            Object.defineProperty(proto, '_serialized', {
                configurable: true,
                get() { return this.$1 || this.toString(); },
                set(value) {
                    Object.defineProperty(this, '_serialized', {
                        value, writable: true, enumerable: true, configurable: true,
                    });
                },
            });
        }
    } catch (_) {}
'''


def patched(source):
    if MARKER in source:
        return source
    anchor = 'exports.LoadUtils = () => {\n    window.WWebJS = {};\n'
    if source.count(anchor) != 1:
        raise ValueError('Ha cambiado la dependencia. No se aplicará un parche a ciegas.')
    return source.replace(anchor,anchor + PATCH,1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file',type=Path)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    if args.file.name != 'Utils.js' or args.file.is_symlink():
        raise ValueError('Se requiere el archivo Utils.js de la dependencia instalada')
    before=args.file.read_text()
    after=patched(before)
    if after == before:
        print('Compatibilidad ya instalada.')
    elif args.apply:
        backup=args.file.with_name('Utils.js.before-scrib-msgkey-compat')
        if backup.exists():
            raise ValueError('Ya existe una copia anterior; revisarla antes de sobrescribir.')
        shutil.copy2(args.file,backup)
        args.file.write_text(after)
        print('Parche instalado. Reiniciar únicamente IMPRO_WHATSAPP.')
    else:
        print('El parche es compatible. Sin cambios (añadir --apply para instalar).')


if __name__ == '__main__':
    main()
