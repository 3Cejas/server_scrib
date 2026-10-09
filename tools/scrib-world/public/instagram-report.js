(function initScribInstagramReport(global) {
    "use strict";

    const WIDTH = 1080;
    const HEIGHT = 1350;
    const STORY_LINE_LENGTH = 47;
    const STORY_LINES_PER_SLIDE = 14;
    const COLORS = Object.freeze({
        blue: "#46f0ff",
        blueSoft: "#9af8ff",
        red: "#ff5f73",
        redSoft: "#ffadb8",
        gold: "#ffd768",
        green: "#65ff99",
        pink: "#ff78d1",
        ink: "#030710",
        panel: "rgba(5, 13, 25, 0.9)",
        white: "#f5fbff",
        muted: "#91a1b5"
    });

    const numero = (valor, fallback = 0) => {
        const parsed = Number(valor);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const textoSeguro = (valor, fallback = "") => {
        const texto = String(valor ?? "").replace(/\r\n?/g, "\n").trim();
        return texto || fallback;
    };

    const nombreSeguro = (valor, fallback) => textoSeguro(valor, fallback)
        .toLocaleUpperCase("es-ES")
        .slice(0, 34);

    const redondear = (valor, decimales = 1) => {
        const factor = 10 ** decimales;
        return Math.round((numero(valor) + Number.EPSILON) * factor) / factor;
    };

    function normalizarJugador(valor, id) {
        const data = valor && typeof valor === "object" ? valor : {};
        return {
            id,
            nombre: nombreSeguro(data.nombre, `ESCRITXR ${id}`),
            texto: textoSeguro(data.texto),
            palabras: Math.max(0, Math.round(numero(data.palabras))),
            unicas: Math.max(0, Math.round(numero(data.unicas))),
            pulsaciones: Math.max(0, Math.round(numero(data.pulsaciones))),
            ppm: Math.max(0, Math.round(numero(data.ppm))),
            inspiraciones: Math.max(0, Math.round(numero(data.inspiraciones))),
            puntuacion: Math.max(0, Math.min(100, redondear(data.puntuacion))),
            letrasBenditas: Array.isArray(data.letrasBenditas) ? data.letrasBenditas.map(String).slice(0, 18) : [],
            letrasMalditas: Array.isArray(data.letrasMalditas) ? data.letrasMalditas.map(String).slice(0, 18) : [],
            palabrasBenditas: Array.isArray(data.palabrasBenditas) ? data.palabrasBenditas.map(String).slice(0, 24) : [],
            palabrasMalditas: Array.isArray(data.palabrasMalditas) ? data.palabrasMalditas.map(String).slice(0, 24) : []
        };
    }

    function normalizarMusas(valor, id) {
        const data = valor && typeof valor === "object" ? valor : {};
        const nombres = Array.isArray(data.nombres)
            ? data.nombres.map((nombre) => nombreSeguro(nombre, "MUSA")).filter(Boolean).slice(0, 12)
            : [];
        return {
            id,
            cantidad: Math.max(nombres.length, Math.round(numero(data.cantidad))),
            nombres,
            enviadas: Math.max(0, Math.round(numero(data.enviadas))),
            introducidas: Math.max(0, Math.round(numero(data.introducidas))),
            efectividad: Math.max(0, Math.min(100, Math.round(numero(data.efectividad)))),
            superbonus: Math.max(0, Math.round(numero(data.superbonus)))
        };
    }

    function normalizarPuntuacion(valor, jugadores) {
        const data = valor && typeof valor === "object" ? valor : {};
        const categorias = Array.isArray(data.categorias) ? data.categorias : [];
        const normalizadas = categorias.slice(0, 8).map((categoria = {}) => ({
            id: textoSeguro(categoria.id, "apartado").slice(0, 32),
            etiqueta: textoSeguro(categoria.etiqueta || categoria.id, "APARTADO").toLocaleUpperCase("es-ES").slice(0, 36),
            valor1: numero(categoria.valores && (categoria.valores[1] ?? categoria.valores["1"])),
            valor2: numero(categoria.valores && (categoria.valores[2] ?? categoria.valores["2"])),
            puntos1: Math.max(0, numero(categoria.puntos && (categoria.puntos[1] ?? categoria.puntos["1"]))),
            puntos2: Math.max(0, numero(categoria.puntos && (categoria.puntos[2] ?? categoria.puntos["2"])))
        }));
        const jugador1 = data.jugadores && (data.jugadores[1] || data.jugadores["1"]);
        const jugador2 = data.jugadores && (data.jugadores[2] || data.jugadores["2"]);
        return {
            disponible: data.disponible === true,
            total1: Math.max(0, Math.min(100, numero(jugador1 && jugador1.total, jugadores[1].puntuacion))),
            total2: Math.max(0, Math.min(100, numero(jugador2 && jugador2.total, jugadores[2].puntuacion))),
            ganador: Number(data.ganador) === 1 || Number(data.ganador) === 2 ? Number(data.ganador) : null,
            empate: data.empate === true,
            categorias: normalizadas
        };
    }

    function normalizarDatos(valor = {}) {
        const data = valor && typeof valor === "object" ? valor : {};
        const jugadoresRaw = data.jugadores && typeof data.jugadores === "object" ? data.jugadores : {};
        const jugadores = {
            1: normalizarJugador(jugadoresRaw[1] || jugadoresRaw["1"], 1),
            2: normalizarJugador(jugadoresRaw[2] || jugadoresRaw["2"], 2)
        };
        const musasRaw = data.musas && typeof data.musas === "object" ? data.musas : {};
        return {
            fecha: textoSeguro(data.fecha, new Date().toLocaleDateString("es-ES")),
            duracion: textoSeguro(data.duracion, "--:--"),
            jugadores,
            musas: {
                1: normalizarMusas(musasRaw[1] || musasRaw["1"], 1),
                2: normalizarMusas(musasRaw[2] || musasRaw["2"], 2)
            },
            puntuacion: normalizarPuntuacion(data.puntuacion, jugadores)
        };
    }

    function envolverTextoPorCaracteres(texto, limite = STORY_LINE_LENGTH) {
        const parrafos = textoSeguro(texto).split("\n");
        const lineas = [];
        parrafos.forEach((parrafo, indiceParrafo) => {
            const palabras = parrafo.trim().split(/\s+/).filter(Boolean);
            if (!palabras.length) {
                if (indiceParrafo < parrafos.length - 1) lineas.push("");
                return;
            }
            let linea = "";
            palabras.forEach((palabraOriginal) => {
                let palabra = palabraOriginal;
                while (palabra.length > limite) {
                    if (linea) {
                        lineas.push(linea);
                        linea = "";
                    }
                    lineas.push(palabra.slice(0, limite - 1) + "-");
                    palabra = palabra.slice(limite - 1);
                }
                const candidata = linea ? `${linea} ${palabra}` : palabra;
                if (candidata.length > limite && linea) {
                    lineas.push(linea);
                    linea = palabra;
                } else {
                    linea = candidata;
                }
            });
            if (linea) lineas.push(linea);
            if (indiceParrafo < parrafos.length - 1) lineas.push("");
        });
        return lineas.length ? lineas : ["ESTE TEXTO QUEDÓ VACÍO."];
    }

    function dividirHistoria(texto) {
        const lineas = envolverTextoPorCaracteres(texto);
        const paginas = [];
        for (let indice = 0; indice < lineas.length; indice += STORY_LINES_PER_SLIDE) {
            paginas.push(lineas.slice(indice, indice + STORY_LINES_PER_SLIDE));
        }
        return paginas.length ? paginas : [["ESTE TEXTO QUEDÓ VACÍO."]];
    }

    function crearPlan(valor = {}) {
        const datos = normalizarDatos(valor);
        const slides = [
            { tipo: "portada", nombre: "portada" },
            { tipo: "resumen", nombre: "resumen" },
            { tipo: "puntuacion", nombre: "resultado-videojuego" },
            { tipo: "niveles", nombre: "huella-niveles" },
            { tipo: "musas", nombre: "musas" }
        ];
        [1, 2].forEach((id) => {
            const paginas = dividirHistoria(datos.jugadores[id].texto);
            paginas.forEach((lineas, indice) => {
                slides.push({
                    tipo: "historia",
                    nombre: `historia-${id}-${indice + 1}`,
                    jugadorId: id,
                    pagina: indice + 1,
                    paginas: paginas.length,
                    lineas
                });
            });
        });
        slides.push({ tipo: "cierre", nombre: "cierre" });
        return { datos, slides };
    }

    function roundRect(ctx, x, y, width, height, radius) {
        const r = Math.max(0, Math.min(radius, width / 2, height / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function fuente(tamano, bold = false) {
        return `${bold ? "700" : "400"} ${tamano}px "Retro-gaming", "Courier New", monospace`;
    }

    function fondo(ctx, acento = COLORS.gold) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
        base.addColorStop(0, "#031c2b");
        base.addColorStop(0.48, COLORS.ink);
        base.addColorStop(1, "#2a0710");
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        const glow = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.42, 30, WIDTH * 0.5, HEIGHT * 0.42, 760);
        glow.addColorStop(0, `${acento}2d`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = "#c9f9ff";
        for (let y = 0; y < HEIGHT; y += 7) ctx.fillRect(0, y, WIDTH, 1);
        ctx.restore();

        ctx.strokeStyle = `${acento}72`;
        ctx.lineWidth = 3;
        roundRect(ctx, 28, 28, WIDTH - 56, HEIGHT - 56, 30);
        ctx.stroke();
    }

    function textoGlow(ctx, texto, x, y, tamano, color, opciones = {}) {
        ctx.save();
        ctx.font = fuente(tamano, opciones.bold !== false);
        ctx.textAlign = opciones.align || "left";
        ctx.textBaseline = opciones.baseline || "alphabetic";
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = opciones.glow ?? 18;
        ctx.fillText(String(texto), x, y, opciones.maxWidth);
        ctx.restore();
    }

    function cabecera(ctx, titulo, subtitulo, indice, total, acento) {
        textoGlow(ctx, "<SCRI> B", 64, 92, 34, COLORS.white, { glow: 13 });
        ctx.font = fuente(19, true);
        ctx.textAlign = "right";
        ctx.fillStyle = acento;
        ctx.fillText(`${String(indice).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, WIDTH - 64, 89);
        ctx.fillStyle = `${acento}88`;
        ctx.fillRect(64, 117, WIDTH - 128, 3);
        textoGlow(ctx, titulo, 64, 190, 46, COLORS.white, { glow: 15, maxWidth: WIDTH - 128 });
        ctx.font = fuente(20, true);
        ctx.fillStyle = acento;
        ctx.textAlign = "left";
        ctx.fillText(subtitulo, 65, 229, WIDTH - 130);
    }

    function pie(ctx, fecha) {
        ctx.font = fuente(17, true);
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = "left";
        ctx.fillText(fecha, 64, HEIGHT - 66);
        ctx.textAlign = "right";
        ctx.fillText("SUTURA TEATRO", WIDTH - 64, HEIGHT - 66);
    }

    function panel(ctx, x, y, width, height, color, alpha = "24") {
        ctx.fillStyle = COLORS.panel;
        ctx.strokeStyle = `${color}${alpha}`;
        ctx.lineWidth = 3;
        roundRect(ctx, x, y, width, height, 24);
        ctx.fill();
        ctx.stroke();
    }

    function etiqueta(ctx, texto, x, y, color) {
        ctx.font = fuente(17, true);
        const width = Math.min(430, ctx.measureText(texto).width + 38);
        ctx.fillStyle = `${color}20`;
        ctx.strokeStyle = `${color}88`;
        ctx.lineWidth = 2;
        roundRect(ctx, x, y - 27, width, 40, 20);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.fillText(texto, x + 18, y);
        return width;
    }

    function dibujarStat(ctx, x, y, width, label, value, color) {
        panel(ctx, x, y, width, 126, color, "42");
        ctx.font = fuente(16, true);
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = "left";
        ctx.fillText(label, x + 22, y + 35, width - 44);
        textoGlow(ctx, value, x + 22, y + 91, 39, color, { glow: 11, maxWidth: width - 44 });
    }

    function dibujarPortada(ctx, datos, indice, total) {
        fondo(ctx, COLORS.gold);
        textoGlow(ctx, "<SCRI> B", WIDTH / 2, 145, 58, COLORS.white, { align: "center", glow: 24 });
        ctx.font = fuente(21, true);
        ctx.textAlign = "center";
        ctx.fillStyle = COLORS.gold;
        ctx.fillText("INFORME DE PARTIDA · CARRUSEL", WIDTH / 2, 204);

        ctx.fillStyle = "rgba(3, 8, 18, 0.86)";
        ctx.strokeStyle = "rgba(255, 215, 104, 0.56)";
        ctx.lineWidth = 4;
        roundRect(ctx, 72, 300, WIDTH - 144, 690, 38);
        ctx.fill();
        ctx.stroke();

        textoGlow(ctx, "DOS HISTORIAS", WIDTH / 2, 420, 50, COLORS.white, { align: "center", glow: 13 });
        textoGlow(ctx, "UNA PARTIDA", WIDTH / 2, 485, 50, COLORS.gold, { align: "center", glow: 17 });
        [
            { id: 1, y: 558, color: COLORS.blue },
            { id: 2, y: 816, color: COLORS.red }
        ].forEach(({ id, y, color }) => {
            panel(ctx, 116, y, WIDTH - 232, 132, color, "70");
            ctx.fillStyle = color;
            roundRect(ctx, 116, y, 14, 132, 7);
            ctx.fill();
            ctx.font = fuente(16, true);
            ctx.fillStyle = color;
            ctx.textAlign = "left";
            ctx.fillText(`ESCRITXR ${id}`, 160, y + 38);
            textoGlow(ctx, datos.jugadores[id].nombre, 160, y + 94, 34, COLORS.white, {
                glow: 13,
                maxWidth: WIDTH - 330
            });
        });
        ctx.fillStyle = "rgba(4, 10, 20, 0.96)";
        ctx.strokeStyle = `${COLORS.gold}aa`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(WIDTH / 2, 753, 49, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        textoGlow(ctx, "VS.", WIDTH / 2, 766, 36, COLORS.gold, { align: "center", glow: 19 });

        ctx.font = fuente(20, true);
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = "center";
        ctx.fillText(`${datos.fecha}  ·  ${datos.duracion}`, WIDTH / 2, 1085);
        ctx.fillStyle = COLORS.white;
        ctx.fillText("DESLIZA PARA RECORRER LA FUNCIÓN", WIDTH / 2, 1170);
        pie(ctx, `${indice}/${total}`);
    }

    function dibujarResumen(ctx, datos, indice, total) {
        fondo(ctx, COLORS.blue);
        cabecera(ctx, "LA PARTIDA EN NÚMEROS", "DOS RITMOS · DOS VOCES", indice, total, COLORS.gold);
        const posiciones = { 1: 76, 2: 554 };
        [1, 2].forEach((id) => {
            const jugador = datos.jugadores[id];
            const color = id === 1 ? COLORS.blue : COLORS.red;
            const x = posiciones[id];
            panel(ctx, x, 286, 450, 840, color, "66");
            textoGlow(ctx, jugador.nombre, x + 28, 350, 29, color, { glow: 12, maxWidth: 394 });
            const cards = [
                ["PALABRAS", jugador.palabras],
                ["ÚNICAS", jugador.unicas],
                ["RITMO", `${jugador.ppm} PPM`],
                ["PULSACIONES", jugador.pulsaciones],
                ["INSPIRACIONES", jugador.inspiraciones],
                ["VIDEOJUEGO", `${redondear(jugador.puntuacion)} / 100`]
            ];
            cards.forEach(([label, value], cardIndex) => {
                const row = Math.floor(cardIndex / 2);
                const col = cardIndex % 2;
                dibujarStat(ctx, x + 24 + (col * 202), 404 + (row * 198), 188, label, String(value), color);
            });
            const riqueza = jugador.palabras > 0 ? Math.round((jugador.unicas / jugador.palabras) * 100) : 0;
            ctx.font = fuente(16, true);
            ctx.fillStyle = COLORS.muted;
            ctx.textAlign = "left";
            ctx.fillText("RIQUEZA LÉXICA", x + 25, 1025);
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            roundRect(ctx, x + 25, 1046, 400, 22, 11);
            ctx.fill();
            const grad = ctx.createLinearGradient(x + 25, 0, x + 425, 0);
            grad.addColorStop(0, color);
            grad.addColorStop(1, COLORS.gold);
            ctx.fillStyle = grad;
            roundRect(ctx, x + 25, 1046, Math.max(10, 400 * Math.min(1, riqueza / 100)), 22, 11);
            ctx.fill();
            ctx.textAlign = "right";
            ctx.fillStyle = color;
            ctx.fillText(`${riqueza}%`, x + 425, 1025);
        });
        pie(ctx, datos.fecha);
    }

    function dibujarPuntuacion(ctx, datos, indice, total) {
        fondo(ctx, COLORS.gold);
        cabecera(ctx, "RESULTADO DEL VIDEOJUEGO", "PUNTUACIÓN SOBRE 100", indice, total, COLORS.gold);
        const score = datos.puntuacion;
        const total1 = score.disponible ? score.total1 : datos.jugadores[1].puntuacion;
        const total2 = score.disponible ? score.total2 : datos.jugadores[2].puntuacion;
        [
            { id: 1, x: 76, color: COLORS.blue, total: total1 },
            { id: 2, x: 554, color: COLORS.red, total: total2 }
        ].forEach((item) => {
            panel(ctx, item.x, 285, 450, 222, item.color, "70");
            textoGlow(ctx, datos.jugadores[item.id].nombre, item.x + 26, 345, 25, item.color, { glow: 10, maxWidth: 398 });
            textoGlow(ctx, redondear(item.total), item.x + 26, 450, 76, item.color, { glow: 20 });
            ctx.font = fuente(20, true);
            ctx.fillStyle = COLORS.muted;
            ctx.fillText("PUNTOS", item.x + 250, 447);
        });

        const categorias = score.categorias.length ? score.categorias : [
            { etiqueta: "PRODUCCIÓN", valor1: datos.jugadores[1].palabras, valor2: datos.jugadores[2].palabras, puntos1: 0, puntos2: 0 },
            { etiqueta: "RITMO", valor1: datos.jugadores[1].ppm, valor2: datos.jugadores[2].ppm, puntos1: 0, puntos2: 0 },
            { etiqueta: "RIQUEZA LÉXICA", valor1: datos.jugadores[1].unicas, valor2: datos.jugadores[2].unicas, puntos1: 0, puntos2: 0 },
            { etiqueta: "INSPIRACIÓN", valor1: datos.jugadores[1].inspiraciones, valor2: datos.jugadores[2].inspiraciones, puntos1: 0, puntos2: 0 }
        ];
        categorias.slice(0, 6).forEach((categoria, row) => {
            const y = 558 + row * 100;
            panel(ctx, 76, y, 928, 76, COLORS.gold, "26");
            ctx.font = fuente(18, true);
            ctx.fillStyle = COLORS.blue;
            ctx.textAlign = "left";
            ctx.fillText(String(redondear(categoria.valor1)), 104, y + 47);
            ctx.fillStyle = COLORS.white;
            ctx.textAlign = "center";
            ctx.fillText(categoria.etiqueta, WIDTH / 2, y + 46, 500);
            ctx.fillStyle = COLORS.red;
            ctx.textAlign = "right";
            ctx.fillText(String(redondear(categoria.valor2)), 976, y + 47);
        });
        const ganador = score.empate ? null : score.ganador;
        const color = ganador === 1 ? COLORS.blue : ganador === 2 ? COLORS.red : COLORS.gold;
        const texto = ganador ? `GANA ${datos.jugadores[ganador].nombre}` : "DOS FORMAS DE GANAR";
        textoGlow(ctx, texto, WIDTH / 2, 1218, 30, color, { align: "center", glow: 16, maxWidth: 900 });
        pie(ctx, datos.fecha);
    }

    function chips(ctx, items, x, y, width, color, maxItems = 12) {
        let cx = x;
        let cy = y;
        ctx.font = fuente(16, true);
        items.slice(0, maxItems).forEach((item) => {
            const label = String(item).toLocaleUpperCase("es-ES");
            const w = Math.min(width, ctx.measureText(label).width + 34);
            if (cx + w > x + width) {
                cx = x;
                cy += 52;
            }
            ctx.fillStyle = `${color}20`;
            ctx.strokeStyle = `${color}88`;
            ctx.lineWidth = 2;
            roundRect(ctx, cx, cy - 29, w, 39, 18);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.textAlign = "left";
            ctx.fillText(label, cx + 17, cy - 2);
            cx += w + 12;
        });
        return cy;
    }

    function dibujarNiveles(ctx, datos, indice, total) {
        fondo(ctx, COLORS.pink);
        cabecera(ctx, "HUELLAS EN EL TEXTO", "LO QUE DEJÓ CADA NIVEL", indice, total, COLORS.pink);
        [1, 2].forEach((id) => {
            const jugador = datos.jugadores[id];
            const color = id === 1 ? COLORS.blue : COLORS.red;
            const x = id === 1 ? 64 : 552;
            panel(ctx, x, 278, 464, 860, color, "52");
            textoGlow(ctx, jugador.nombre, x + 26, 336, 26, color, { glow: 10, maxWidth: 412 });
            const grupos = [
                ["LETRAS BENDITAS", jugador.letrasBenditas, COLORS.green],
                ["LETRAS MALDITAS", jugador.letrasMalditas, COLORS.red],
                ["PALABRAS BENDITAS", jugador.palabrasBenditas, COLORS.gold],
                ["PALABRAS MALDITAS", jugador.palabrasMalditas, COLORS.pink]
            ];
            let y = 402;
            grupos.forEach(([label, values, groupColor]) => {
                ctx.font = fuente(16, true);
                ctx.fillStyle = groupColor;
                ctx.textAlign = "left";
                ctx.fillText(label, x + 27, y);
                const lista = values.length ? values : ["—"];
                y = chips(ctx, lista, x + 27, y + 51, 408, groupColor, 8) + 77;
            });
        });
        pie(ctx, datos.fecha);
    }

    function dibujarMusas(ctx, datos, indice, total) {
        fondo(ctx, COLORS.gold);
        cabecera(ctx, "LAS MUSAS", "INSPIRACIÓN EN EQUIPO", indice, total, COLORS.gold);
        [1, 2].forEach((id) => {
            const musas = datos.musas[id];
            const color = id === 1 ? COLORS.blue : COLORS.red;
            const x = id === 1 ? 76 : 554;
            panel(ctx, x, 286, 450, 842, color, "62");
            textoGlow(ctx, datos.jugadores[id].nombre, x + 25, 346, 25, color, { glow: 10, maxWidth: 398 });
            const stats = [
                ["MUSAS", musas.cantidad],
                ["ENVIADAS", musas.enviadas],
                ["EN EL TEXTO", musas.introducidas],
                ["EFECTIVIDAD", `${musas.efectividad}%`]
            ];
            stats.forEach(([label, value], idx) => {
                dibujarStat(ctx, x + 24 + ((idx % 2) * 202), 397 + (Math.floor(idx / 2) * 184), 188, label, String(value), color);
            });
            ctx.font = fuente(16, true);
            ctx.fillStyle = COLORS.gold;
            ctx.textAlign = "left";
            ctx.fillText(`SUPERBONUS · ${musas.superbonus}`, x + 25, 795);
            ctx.fillStyle = COLORS.muted;
            ctx.fillText("EL EQUIPO", x + 25, 862);
            let y = 915;
            (musas.nombres.length ? musas.nombres : ["SIN NOMBRES REGISTRADOS"]).slice(0, 6).forEach((nombre) => {
                ctx.fillStyle = color;
                ctx.fillRect(x + 26, y - 22, 8, 29);
                ctx.font = fuente(18, true);
                ctx.fillStyle = COLORS.white;
                ctx.fillText(nombre, x + 51, y, 360);
                y += 52;
            });
        });
        pie(ctx, datos.fecha);
    }

    function dibujarHistoria(ctx, datos, slide, indice, total) {
        const id = slide.jugadorId;
        const jugador = datos.jugadores[id];
        const color = id === 1 ? COLORS.blue : COLORS.red;
        fondo(ctx, color);
        cabecera(ctx, "LA HISTORIA", `${jugador.nombre} · ${slide.pagina}/${slide.paginas}`, indice, total, color);
        panel(ctx, 64, 278, WIDTH - 128, 858, color, "62");
        ctx.fillStyle = `${color}26`;
        ctx.fillRect(64, 278, 16, 858);
        ctx.font = fuente(28, false);
        ctx.fillStyle = id === 1 ? "#d6fbff" : "#ffe0e4";
        ctx.textAlign = "left";
        let y = 342;
        slide.lineas.forEach((linea) => {
            ctx.fillText(linea || " ", 106, y, WIDTH - 214);
            y += 54;
        });
        ctx.font = fuente(17, true);
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`${jugador.palabras} PALABRAS · ${jugador.unicas} ÚNICAS · ${jugador.ppm} PPM`, 82, 1190);
        pie(ctx, datos.fecha);
    }

    function dibujarCierre(ctx, datos, indice, total) {
        fondo(ctx, COLORS.gold);
        textoGlow(ctx, "<SCRI> B", WIDTH / 2, 190, 65, COLORS.white, { align: "center", glow: 28 });
        textoGlow(ctx, "DOS HISTORIAS.", WIDTH / 2, 470, 58, COLORS.blue, { align: "center", glow: 20 });
        textoGlow(ctx, "UNA FUNCIÓN.", WIDTH / 2, 550, 58, COLORS.red, { align: "center", glow: 20 });
        textoGlow(ctx, "UN PÚBLICO.", WIDTH / 2, 630, 58, COLORS.gold, { align: "center", glow: 20 });
        ctx.font = fuente(24, true);
        ctx.fillStyle = COLORS.white;
        ctx.textAlign = "center";
        ctx.fillText(`${datos.jugadores[1].nombre}  VS.  ${datos.jugadores[2].nombre}`, WIDTH / 2, 790, 900);
        ctx.fillStyle = COLORS.muted;
        ctx.font = fuente(20, true);
        ctx.fillText("HISTORIAS ESCRITAS EN DIRECTO", WIDTH / 2, 890);
        ctx.fillStyle = COLORS.gold;
        ctx.fillText("SUTURA TEATRO", WIDTH / 2, 1030);
        ctx.fillStyle = COLORS.white;
        ctx.fillText("@SCRIBSHOW", WIDTH / 2, 1090);
        pie(ctx, `${indice}/${total}`);
    }

    function renderizarSlide(ctx, slide, datos, indice, total) {
        switch (slide.tipo) {
            case "portada": dibujarPortada(ctx, datos, indice, total); break;
            case "resumen": dibujarResumen(ctx, datos, indice, total); break;
            case "puntuacion": dibujarPuntuacion(ctx, datos, indice, total); break;
            case "niveles": dibujarNiveles(ctx, datos, indice, total); break;
            case "musas": dibujarMusas(ctx, datos, indice, total); break;
            case "historia": dibujarHistoria(ctx, datos, slide, indice, total); break;
            default: dibujarCierre(ctx, datos, indice, total); break;
        }
    }

    const siguienteFrame = () => new Promise((resolve) => {
        if (typeof global.requestAnimationFrame === "function") {
            global.requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });

    function canvasABlob(canvas) {
        return new Promise((resolve, reject) => {
            if (typeof canvas.toBlob === "function") {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("No se pudo convertir la diapositiva a PNG."));
                }, "image/png");
                return;
            }
            try {
                const data = canvas.toDataURL("image/png");
                const bytes = atob(data.split(",")[1]);
                const salida = new Uint8Array(bytes.length);
                for (let i = 0; i < bytes.length; i += 1) salida[i] = bytes.charCodeAt(i);
                resolve(new Blob([salida], { type: "image/png" }));
            } catch (error) {
                reject(error);
            }
        });
    }

    async function generarPngs(valor = {}, opciones = {}) {
        if (!global.document || typeof global.document.createElement !== "function") {
            throw new Error("La exportación PNG necesita un navegador.");
        }
        if (global.document.fonts && global.document.fonts.ready) {
            await global.document.fonts.ready;
        }
        const plan = crearPlan(valor);
        const archivos = [];
        for (let indice = 0; indice < plan.slides.length; indice += 1) {
            await siguienteFrame();
            const canvas = global.document.createElement("canvas");
            canvas.width = WIDTH;
            canvas.height = HEIGHT;
            const ctx = canvas.getContext("2d", { alpha: false });
            renderizarSlide(ctx, plan.slides[indice], plan.datos, indice + 1, plan.slides.length);
            const blob = await canvasABlob(canvas);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const numeroArchivo = String(indice + 1).padStart(2, "0");
            archivos.push({
                nombre: `${numeroArchivo}_${plan.slides[indice].nombre}.png`,
                bytes,
                blob
            });
            if (typeof opciones.onProgress === "function") {
                opciones.onProgress(indice + 1, plan.slides.length, plan.slides[indice]);
            }
        }
        return { ...plan, archivos };
    }

    const tablaCrc = (() => {
        const tabla = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            tabla[n] = c >>> 0;
        }
        return tabla;
    })();

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i += 1) crc = tablaCrc[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function fechaDos(fecha = new Date()) {
        const year = Math.max(1980, fecha.getFullYear());
        return {
            time: ((fecha.getHours() & 31) << 11) | ((fecha.getMinutes() & 63) << 5) | ((fecha.getSeconds() / 2) & 31),
            date: (((year - 1980) & 127) << 9) | (((fecha.getMonth() + 1) & 15) << 5) | (fecha.getDate() & 31)
        };
    }

    function escritorBinario(tamano) {
        const bytes = new Uint8Array(tamano);
        const view = new DataView(bytes.buffer);
        return {
            bytes,
            u16(offset, value) { view.setUint16(offset, value, true); },
            u32(offset, value) { view.setUint32(offset, value >>> 0, true); }
        };
    }

    function concatenar(partes) {
        const total = partes.reduce((acc, parte) => acc + parte.length, 0);
        const salida = new Uint8Array(total);
        let offset = 0;
        partes.forEach((parte) => {
            salida.set(parte, offset);
            offset += parte.length;
        });
        return salida;
    }

    function crearZip(archivos = [], fecha = new Date()) {
        const encoder = new TextEncoder();
        const locales = [];
        const centrales = [];
        const dos = fechaDos(fecha);
        let offset = 0;
        archivos.forEach((archivo, indice) => {
            const nombre = textoSeguro(archivo && archivo.nombre, `slide-${indice + 1}.png`);
            const nombreBytes = encoder.encode(nombre);
            const data = archivo && archivo.bytes instanceof Uint8Array
                ? archivo.bytes
                : new Uint8Array(archivo && archivo.bytes ? archivo.bytes : []);
            const crc = crc32(data);
            const local = escritorBinario(30);
            local.u32(0, 0x04034b50);
            local.u16(4, 20);
            local.u16(6, 0x0800);
            local.u16(8, 0);
            local.u16(10, dos.time);
            local.u16(12, dos.date);
            local.u32(14, crc);
            local.u32(18, data.length);
            local.u32(22, data.length);
            local.u16(26, nombreBytes.length);
            local.u16(28, 0);
            locales.push(local.bytes, nombreBytes, data);

            const central = escritorBinario(46);
            central.u32(0, 0x02014b50);
            central.u16(4, 20);
            central.u16(6, 20);
            central.u16(8, 0x0800);
            central.u16(10, 0);
            central.u16(12, dos.time);
            central.u16(14, dos.date);
            central.u32(16, crc);
            central.u32(20, data.length);
            central.u32(24, data.length);
            central.u16(28, nombreBytes.length);
            central.u16(30, 0);
            central.u16(32, 0);
            central.u16(34, 0);
            central.u16(36, 0);
            central.u32(38, 0);
            central.u32(42, offset);
            centrales.push(central.bytes, nombreBytes);
            offset += local.bytes.length + nombreBytes.length + data.length;
        });
        const centralBytes = concatenar(centrales);
        const end = escritorBinario(22);
        end.u32(0, 0x06054b50);
        end.u16(4, 0);
        end.u16(6, 0);
        end.u16(8, archivos.length);
        end.u16(10, archivos.length);
        end.u32(12, centralBytes.length);
        end.u32(16, offset);
        end.u16(20, 0);
        return concatenar([...locales, centralBytes, end.bytes]);
    }

    const api = Object.freeze({
        WIDTH,
        HEIGHT,
        normalizarDatos,
        dividirHistoria,
        crearPlan,
        renderizarSlide,
        generarPngs,
        crearZip,
        crc32
    });

    global.ScribInstagramReport = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
