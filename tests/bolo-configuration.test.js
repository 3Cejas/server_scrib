const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createBoloConfigurationManager} = require('../bolo_configuration.js');
const {crearGestorEstadoControl, PARAMETROS_CONTROL_DEFECTO} = require('../control_state.js');
const schema = require('../tools/scrib-world/game_config_schema.json');

const profile = () => ({id: 'bolo-test', revision: 'a'.repeat(64), ready: true, config: {parametros: {}, modos: ['tertulia']}, errors: []});
function setup(options = {}) {
    const socket = new EventEmitter(); socket.control = true;
    let active = false, revision = 0, applied = [], broadcast = [];
    const manager = createBoloConfigurationManager({io: {to: () => ({emit: (event, value) => broadcast.push({event, value})})}, read: async () => [profile()], isMatchActive: () => active, getControlRevision: () => revision, apply: b => { applied.push(b); return {control: {revision: 1}}; }, ...options});
    manager.register(socket);
    const call = (event, payload = {}) => new Promise(resolve => socket.emit(event, payload, resolve));
    const load = () => call('bolo_configuracion_cargar', {id: 'bolo-test', revision: 'a'.repeat(64), controlRevision: 0});
    return {socket, call, load, applied, broadcast, setActive: value => { active = value; }, setRevision: value => {revision = value;}};
}

test('world schema agrees with real game defaults and limits', () => {
    for (const [key, rules] of Object.entries(schema.parameters)) {
        assert.equal(rules.default, PARAMETROS_CONTROL_DEFECTO[key], key);
        assert.equal(crearGestorEstadoControl().actualizar({parametros: {[key]: -1000}}).parametros[key], rules.min, key);
        assert.equal(crearGestorEstadoControl().actualizar({parametros: {[key]: 10000}}).parametros[key], rules.max, key);
    }
});
test('only authorised Control receives profiles or applies one', async () => {
    const s = setup(); s.socket.control = false;
    assert.equal((await s.call('bolos_configuracion_listar')).code, 'CONTROL_REQUIRED');
    assert.equal((await s.load()).code, 'CONTROL_REQUIRED');
    s.socket.control = true; s.socket.dramaturgia = true;
    assert.equal((await s.load()).code, 'CONTROL_REQUIRED');
    assert.equal(s.applied.length, 0);
});
test('confirmed import rereads the source and commits once to Control only', async () => {
    const s = setup();
    assert.equal((await s.call('bolos_configuracion_listar')).bolos.length, 1);
    assert.equal((await s.load()).ok, true);
    assert.equal(s.applied.length, 1);
    assert.equal(s.broadcast[0].event, 'bolo_configuracion_cargada');
});
test('running or paused match blocks imports', async () => {
    const s = setup(); s.setActive(true);
    assert.equal((await s.load()).code, 'MATCH_ACTIVE');
    assert.equal(s.applied.length, 0);
});
test('race: match or another control edit while fetching blocks the commit', async () => {
    for (const change of ['match', 'edit', 'disconnect']) {
        let resolve;
        const s = setup({read: () => new Promise(r => {resolve = r;})});
        const pending = s.load();
        if (change === 'match') s.setActive(true);
        if (change === 'edit') s.setRevision(1);
        if (change === 'disconnect') s.socket.connected = false;
        resolve([profile()]);
        assert.equal((await pending).ok, false);
        assert.equal(s.applied.length, 0);
    }
});
test('changed, missing and incomplete source never overwrite current settings', async () => {
    for (const data of [[], [{...profile(), revision: 'b'.repeat(64)}], [{...profile(), ready: false, errors: ['Falta escritora azul.']}]] ) {
        const s = setup({read: async () => data});
        assert.equal((await s.load()).ok, false);
        assert.equal(s.applied.length, 0);
    }
});
test('double click has one in-flight import and errors release its lock', async () => {
    let resolve;
    const s = setup({read: () => new Promise(r => {resolve = r;})});
    const first = s.load();
    assert.equal((await s.load()).code, 'IMPORT_BUSY');
    resolve([profile()]);
    assert.equal((await first).ok, true);
    assert.equal(s.applied.length, 1);
    const failed = setup({read: async () => {throw new Error('No conectado');}});
    assert.equal((await failed.load()).code, 'BACKSTAGE_UNAVAILABLE');
    assert.equal((await failed.load()).code, 'BACKSTAGE_UNAVAILABLE');
});
test('loading a bolo persists its source and settings through match start and recovery', () => {
    const state = crearGestorEstadoControl();
    state.actualizar({parametros: {duracion_minutos: 42}, nombres: {1: 'Ángela', 2: 'Pablo'}, bolo: {id: 'leon', title: 'León', start: '2026-11-07'}, modos: ['letra bendita', 'frase final']});
    const snapshot = state.reset({conservarNombres: true});
    assert.equal(snapshot.parametros.duracion_minutos, 42);
    assert.equal(snapshot.bolo.id, 'leon');
    const restored = crearGestorEstadoControl(); restored.restaurar(snapshot);
    assert.deepEqual(restored.snapshot().bolo, snapshot.bolo);
    assert.equal(restored.snapshot().nombres[1], 'ÁNGELA');
    assert.equal(restored.reset().bolo, null);
});
