function registrarCanalesVotacion({
    socket,
    votacionVentaja,
    votacionRepentizado
}) {
    socket.on("enviar_voto_ventaja", (payload = {}) => {
        votacionVentaja.registrarVoto(socket, payload);
    });

    votacionRepentizado.registrarHandlers(socket);
}

module.exports = {
    registrarCanalesVotacion
};
