(function () {
    const params = new URLSearchParams(window.location.search);
    const player = Number(params.get("player")) === 2 ? 2 : 1;
    const nombreMusa = player === 2 ? "MUSA ROJA" : "MUSA AZUL";
    const body = document.body;
    const subtitulo = document.getElementById("subtitulo");
    const estado = document.getElementById("estado");
    const semilla1 = document.getElementById("semilla1");
    const semilla2 = document.getElementById("semilla2");
    const objetivo = document.getElementById("objetivo");
    const input = document.getElementById("input_palabra");
    const btn = document.getElementById("btn_enviar");
    const feedback = document.getElementById("feedback");
    const metaRol = document.getElementById("meta_rol");
    const metaMarcador = document.getElementById("meta_marcador");
    const chipConexion = document.getElementById("chip_conexion");
    const textoConexion = document.getElementById("texto_conexion");
    const events = window.BolzanoEvents || {};

    if (body) {
        body.classList.add(player === 2 ? "equipo-rojo" : "equipo-azul");
    }

    if (subtitulo) {
        subtitulo.textContent = nombreMusa;
    }

    const serverUrl = window.isProduction ? window.SERVER_URL_PROD : window.SERVER_URL_DEV;
    const socket = window.io ? window.io(serverUrl) : null;

    let ultimoEstado = null;
    let pendienteEnviado = false;
    let semillaEnviada = null;

    function setConexion(ok, texto) {
        if (!chipConexion || !textoConexion) return;
        chipConexion.classList.remove("ok", "error");
        chipConexion.classList.add(ok ? "ok" : "error");
        textoConexion.textContent = texto;
    }

    function setFeedback(texto, esError) {
        if (!feedback) return;
        feedback.textContent = texto || "";
        feedback.style.color = esError ? "#ff9f7a" : "#ffcf6b";
    }

    function actualizarUI(data) {
        if (!data) return;
        ultimoEstado = data;

        const semillas = data.semillas || {};
        const semillasRecibidas = data.semillasRecibidas || {};
        const rol = data.rol || "musa";
        const estadoActual = data.estado || "inactivo";

        if (semilla1) semilla1.textContent = (semillas[1] || "--").toUpperCase();
        if (semilla2) semilla2.textContent = (semillas[2] || "--").toUpperCase();
        if (objetivo) objetivo.textContent = (data.pendientePalabra || "--").toUpperCase();
        if (metaRol) metaRol.textContent = `Rol: ${rol.toUpperCase()}`;
        if (metaMarcador) metaMarcador.textContent = `Intentos: ${data.intentos || 0} | Aciertos: ${data.aciertos || 0}`;

        const esSemillaDoble = rol === "semilla_doble";
        // The server has accepted this seed. A single musa can now supply the
        // second seed instead of remaining blocked by her first submission.
        if (semillaEnviada && semillasRecibidas[semillaEnviada]) {
            semillaEnviada = null;
        }
        let posicionSemilla = null;
        if (rol === "semilla1") posicionSemilla = 1;
        if (rol === "semilla2") posicionSemilla = 2;
        if (esSemillaDoble) {
            posicionSemilla = !semillasRecibidas[1] ? 1 : (!semillasRecibidas[2] ? 2 : null);
        }

        let puedeEnviar = false;
        let estadoTexto = "";
        let placeholder = "Escribe una palabra";
        input.dataset.modoEnvio = "none";
        input.dataset.posicionSemilla = "";

        if (estadoActual === "sin_musas") {
            estadoTexto = "Sin musas suficientes en este equipo.";
        } else if (estadoActual === "esperando_semillas") {
            const semillaRecibidaActual = posicionSemilla ? Boolean(semillasRecibidas[posicionSemilla]) : true;
            if (posicionSemilla && !semillaRecibidaActual && !semillaEnviada) {
                estadoTexto = `Eres musa semilla: escribe la palabra ${posicionSemilla}.`;
                placeholder = `Palabra semilla ${posicionSemilla}`;
                puedeEnviar = true;
                input.dataset.modoEnvio = "semilla";
                input.dataset.posicionSemilla = String(posicionSemilla);
            } else if (posicionSemilla && !semillaRecibidaActual && semillaEnviada) {
                estadoTexto = "Palabra semilla enviada. Espera al resto.";
            } else {
                estadoTexto = "Esperando palabras semilla.";
            }
            if (semillasRecibidas[1] && semillasRecibidas[2]) {
                semillaEnviada = null;
            }
            pendienteEnviado = false;
        } else if (estadoActual === "jugando") {
            const bloqueadoPorPendientePropia = Boolean(data.pendiente && data.pendienteSocketId === socket.id);
            if (bloqueadoPorPendientePropia || pendienteEnviado) {
                estadoTexto = "Esperando a otra musa.";
            } else {
                estadoTexto = "Escribe una palabra intermedia.";
                placeholder = "Palabra intermedia";
                puedeEnviar = true;
                input.dataset.modoEnvio = "intento";
            }
            semillaEnviada = null;
        } else if (estadoActual === "ganado") {
            estadoTexto = "Acierto del equipo. Preparando siguiente ronda...";
            pendienteEnviado = false;
            semillaEnviada = null;
        } else {
            estadoTexto = "Tutorial no disponible.";
            pendienteEnviado = false;
            semillaEnviada = null;
        }

        if (estado) estado.textContent = estadoTexto;
        if (input) {
            input.disabled = !puedeEnviar;
            input.placeholder = placeholder;
        }
        if (btn) {
            btn.disabled = !puedeEnviar;
        }
    }

    function enviar() {
        if (!socket || !ultimoEstado) return;
        const palabra = (input.value || "").trim();
        if (!palabra) {
            setFeedback("Escribe una palabra.", true);
            return;
        }
        if (/\s/.test(palabra)) {
            setFeedback("Solo una palabra, sin espacios.", true);
            return;
        }
        if (palabra.length > 10) {
            setFeedback("La palabra es demasiado larga.", true);
            return;
        }

        const modoEnvio = input.dataset.modoEnvio;
        if (modoEnvio === "semilla") {
            const posicion = Number(input.dataset.posicionSemilla);
            if (posicion !== 1 && posicion !== 2) {
                setFeedback("No eres musa semilla ahora mismo.", true);
                return;
            }
            socket.emit(events.SUBMIT_SEED, { posicion, palabra });
            semillaEnviada = posicion;
            input.value = "";
            btn.disabled = true;
            input.disabled = true;
            setFeedback("Palabra semilla enviada.");
            return;
        }

        if (modoEnvio !== "intento") {
            setFeedback("Ahora mismo no puedes enviar palabra.", true);
            return;
        }
        socket.emit(events.SUBMIT_ATTEMPT, { palabra });
        pendienteEnviado = true;
        input.value = "";
        btn.disabled = true;
        input.disabled = true;
        setFeedback("Intento enviado.");
    }

    if (!socket) {
        setConexion(false, "Socket no disponible");
        setFeedback("No se pudo inicializar la conexion.", true);
        return;
    }

    btn.addEventListener("click", enviar);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            enviar();
        }
    });

    socket.on("connect", () => {
        setConexion(true, "Conectado");
        socket.emit(events.REGISTER_MUSA, { musa: player, nombre: nombreMusa });
        socket.emit(events.REQUEST_STATE);
    });

    socket.on("connect_error", () => {
        setConexion(false, "Error de conexion");
    });

    socket.on("disconnect", () => {
        setConexion(false, "Desconectado");
    });

    socket.on(events.STATE_MUSA, (data) => {
        actualizarUI(data);
    });

    socket.on(events.ERROR, (data) => {
        pendienteEnviado = false;
        semillaEnviada = null;
        setFeedback((data && data.mensaje) ? data.mensaje : "Error.", true);
        if (ultimoEstado) {
            actualizarUI(ultimoEstado);
        }
    });

    socket.on(events.WON, (data) => {
        pendienteEnviado = false;
        semillaEnviada = null;
        const palabra = (data && data.palabra) ? data.palabra : "";
        setFeedback(palabra ? `Acierto: ${palabra}` : "Acierto del equipo");
    });
})();
