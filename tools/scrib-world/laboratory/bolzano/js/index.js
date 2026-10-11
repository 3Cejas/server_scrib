(function () {
    const modo = new URLSearchParams(window.location.search).get("modo");
    const estadoTexto = document.getElementById("estado_texto");
    const estadoChip = document.getElementById("estado_chip");
    const panelControl = document.getElementById("panel_control");
    const panelMusa = document.getElementById("panel_musa");
    const menuControl = document.getElementById("menu_control");
    const menuMusa = document.getElementById("menu_musa");
    const serverUrl = window.isProduction ? window.SERVER_URL_PROD : window.SERVER_URL_DEV;
    const socket = window.io ? window.io(serverUrl) : null;
    const events = window.BolzanoEvents || {};

    function escribirEstado(texto, esError) {
        if (estadoTexto) {
            estadoTexto.textContent = texto || "";
            estadoTexto.classList.toggle("error", Boolean(esError));
        }
        if (estadoChip) {
            estadoChip.classList.toggle("error", Boolean(esError));
        }
    }

    function mostrarPanel(clave) {
        panelControl.classList.toggle("activo", clave === "control");
        panelMusa.classList.toggle("activo", clave === "musa");
        menuControl.classList.toggle("is-selected", clave === "control");
        menuMusa.classList.toggle("is-selected", clave === "musa");
    }

    function emitir(evento, payload, mensajeOk) {
        if (!socket) {
            escribirEstado("No hay conexion con el servidor.", true);
            return;
        }
        socket.emit(evento, payload);
        if (mensajeOk) {
            escribirEstado(mensajeOk, false);
        }
    }

    function abrirComoMusa(playerId) {
        const player = Number(playerId) === 2 ? 2 : 1;
        setTimeout(() => {
            window.location.href = `./musa.html?player=${player}`;
        }, 40);
    }

    if (estadoChip) {
        estadoChip.classList.remove("ok", "error");
    }

    if (socket) {
        socket.on("connect", () => {
            if (estadoChip) {
                estadoChip.classList.remove("error");
                estadoChip.classList.add("ok");
            }
            escribirEstado("Conectado al servidor.");
        });
        socket.on("connect_error", () => {
            if (estadoChip) {
                estadoChip.classList.remove("ok");
                estadoChip.classList.add("error");
            }
            escribirEstado("No se pudo conectar al servidor.", true);
        });
    } else {
        if (estadoChip) {
            estadoChip.classList.add("error");
        }
        escribirEstado("Socket.io no esta disponible.", true);
    }

    menuControl.addEventListener("click", () => {
        mostrarPanel("control");
    });
    menuMusa.addEventListener("click", () => {
        mostrarPanel("musa");
    });

    document.getElementById("btn_rejugar").addEventListener("click", () => {
        emitir(events.RESET_WARMUP, undefined, "Tutorial reiniciado.");
    });

    document.getElementById("btn_reiniciar_marcador").addEventListener("click", () => {
        emitir(events.RESET_SCORE, undefined, "Marcador del tutorial reiniciado.");
    });

    panelMusa.querySelectorAll("button[data-player]").forEach((btn) => {
        btn.addEventListener("click", () => {
            abrirComoMusa(btn.dataset.player);
        });
    });

    if (modo === "control" || modo === "musa") {
        mostrarPanel(modo);
    }
})();
