function registrarCanalesVotacion({
    socket,
    votacionRepentizado
}) {
    votacionRepentizado.registrarHandlers(socket);
}

module.exports = {
    registrarCanalesVotacion
};
