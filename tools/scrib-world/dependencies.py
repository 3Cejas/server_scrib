"""Explicit acyclic task dependencies, checked in the same write transaction."""
def validate(store, db, identifiers, existing, problem):
    tasks = {t['id']: t for t in store.all(db, 'ticket')}
    own = (existing or {}).get('id')
    old = (existing or {}).get('blockedBy', [])
    for ident in identifiers:
        if ident == own:
            raise problem('Una tarea no puede depender de sí misma.')
        target = tasks.get(ident)
        board = store.item(db, target['boardId'], 'board') if target else None
        if (not target or target['archived'] or board['archived']) and ident not in old:
            raise problem('Selecciona una tarea activa para añadir una dependencia.')
        # Iterative graph traversal, including archived nodes: prevent indirect cycles.
        seen, pending = set(), [ident]
        while pending:
            node = pending.pop()
            if node == own:
                raise problem('Esta dependencia crearía un círculo entre tareas.')
            if node in seen:
                continue
            seen.add(node)
            pending.extend(tasks.get(node, {}).get('blockedBy', []))
    return any(not tasks.get(i) or tasks[i]['status'] != 'done' for i in identifiers)


def block_dependents(store, db, changed, actor):
    """Reopening a prerequisite blocks unfinished dependents, never rewrites done work."""
    if changed['status'] == 'done':
        return
    pending, seen = [changed['id']], set()
    tasks = store.all(db, 'ticket')
    while pending:
        ident = pending.pop()
        if ident in seen:
            continue
        seen.add(ident)
        for task in tasks:
            if task['archived'] or task['status'] == 'done' or ident not in task.get('blockedBy', []):
                continue
            pending.append(task['id'])
            if task['status'] != 'blocked':
                saved=store.save(db, task, {'status':'blocked'}, actor, 'bloqueada por dependencia pendiente')
                task.update(saved)
