// Reenvios simples entre roles/pantallas que no dependen del estado de partida.
function reenviarAOtros(socket, evento, eventoSalida = null) {
    if (!socket._forwarded_events) socket._forwarded_events = new Set();
    const key = eventoSalida ? `${evento}->${eventoSalida}` : evento;
    if (socket._forwarded_events.has(key)) return;
    socket._forwarded_events.add(key);

    socket.on(evento, (payload) => {
        const salida = eventoSalida || evento;
        socket.broadcast.emit(salida, payload);
    });
}

function reenviarASala(socket, io, evento, sala, eventoSalida = null) {
    if (!socket._forwarded_room_events) socket._forwarded_room_events = new Set();
    const key = `${evento}->${eventoSalida || evento}@${sala}`;
    if (socket._forwarded_room_events.has(key)) return;
    socket._forwarded_room_events.add(key);

    socket.on(evento, (payload) => {
        const salida = eventoSalida || evento;
        io.to(sala).emit(salida, payload);
    });
}

function reenviarGrupo(socket, eventos) {
    eventos.forEach((evento) => reenviarAOtros(socket, evento));
}

function reenviarMapeados(socket, pares) {
    pares.forEach(([entrada, salida]) => reenviarAOtros(socket, entrada, salida));
}

function reenviarMapeadosASala(socket, io, pares) {
    pares.forEach(([entrada, salida, sala]) => reenviarASala(socket, io, entrada, sala, salida));
}

function activarSocketsExtratextuales(socket, io) {
    if (socket._extratextuales_on) {
        return;
    }
    socket._extratextuales_on = true;

    reenviarGrupo(socket, ['vote', 'exit', 'scroll', 'scroll_sincro', 'impro']);
    reenviarMapeados(socket, [
        ['envia_temas', 'recibe_temas'],
        ['temas', 'temas_espectador'],
        ['tiempo_muerto_a_control', 'tiempo_muerto_control'],
    ]);

    reenviarMapeadosASala(socket, io, [
        ['enviar_postgame1', 'recibir_postgame2', 'j2'],
        ['enviar_postgame2', 'recibir_postgame1', 'j1'],
    ]);
}

module.exports = {
    activarSocketsExtratextuales,
    reenviarAOtros,
    reenviarASala,
    reenviarGrupo,
    reenviarMapeados,
    reenviarMapeadosASala
};
