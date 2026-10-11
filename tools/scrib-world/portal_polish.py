"""Scoped, idempotent patches for the existing Sutura portal and login theme.

No authentication flows, users, world chooser or service routes are changed.
Call these pure transforms from a deployment that first backs up its targets.
"""
import re

OVERLAY_BEGIN = '/* SCRIB: full-card login loading veil */'
OVERLAY_CSS = '''/* SCRIB: full-card login loading veil */
.pf-c-login__main > ak-loading-overlay,
.pf-v5-c-login__main > ak-loading-overlay {
    position: absolute;
    inset: 0;
    width: auto;
    height: auto;
    z-index: 10;
    border-radius: inherit;
}
/* SCRIB: end login loading veil */
'''


def login_css(source):
    if OVERLAY_BEGIN in source:
        if source.count(OVERLAY_CSS) != 1:
            raise ValueError('Unknown existing loading veil patch')
        return source
    if '.pf-c-login__main::before' not in source:
        raise ValueError('Unexpected Sutura login theme')
    return source.rstrip() + '\n\n' + OVERLAY_CSS


def escena(source):
    match = re.search(r'(<section\b[^>]*\bid="escena-section"[^>]*>)(.*?)(</section>)', source, re.S)
    if not match:
        raise ValueError('Escena section not found')
    contents = match[2]
    for href in ('/scrib/game/', '/scrib-produccion/'):
        # These are the two obsolete SCRIB shortcuts in Sutura/Escena, not the
        # independent SCRIB world in the world selector.
        pattern = r'\s*<a\b[^>]*\bhref="' + re.escape(href) + r'"[^>]*>.*?</a>'
        contents, count = re.subn(pattern, '', contents, flags=re.S)
        if count > 1:
            raise ValueError('Duplicate SCRIB shortcut in Escena')
    updated = source[:match.start(2)] + contents + source[match.end(2):]
    # Avoid null-node errors and useless health polling after removing the tiles.
    for name, status, detail in [('checkScrib','scribServerStatus','scribServerDetail'),
                                 ('checkScribWeb','scribWebStatus','scribWebDetail')]:
        signature = 'async function ' + name + '() {'
        guard = signature + '\n      if (!' + status + ' || !' + detail + ') return;'
        if guard not in updated:
            if updated.count(signature) != 1:
                raise ValueError('Unexpected portal health function: ' + name)
            updated = updated.replace(signature, guard, 1)
    return updated
