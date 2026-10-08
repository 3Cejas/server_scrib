"use strict";
(() => {
  const BASE = "/mundo-scrib/";
  const STATUS = {todo: "TO DO", progress: "EN PROGRESO", blocked: "BLOQUEADA", done: "COMPLETADAS"};
  const PRIORITY = {low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente"};
  const EVENT_STATUS = {pending: "Por confirmar", confirmed: "Confirmado", completed: "Realizado", cancelled: "Cancelado"};
  const KIND = {ticket: "Tarea", board: "Tablero", event: "Bolo", person: "Elenco", template: "Plantilla", availability: "Encuesta"};
  const main = document.querySelector("#main");
  const dialog = document.querySelector("#editor");
  let state = null, calendarMode = "calendar", month = new Date(), saving = false, toastTimer;
  let health = {server: null, web: null};
  let filters = {search: "", mine: "", label: "", priority: "", due: ""};
  let dragId = "", pointerDrag = null;
  let renderedRoute = "", whatsappStatus = null, messageHistory = [];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const initials = name => String(name || "?").split(/[\s_.-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  const member = username => state.members.find(x => x.username === username)?.name || username;
  const item = id => state.items.find(x => x.id === id);
  const active = kind => state.items.filter(x => x.kind === kind && !x.archived);
  const today = () => new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Madrid", year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const niceDate = (value, full = true) => value ? new Intl.DateTimeFormat("es-ES", {timeZone:"Europe/Madrid", day:"numeric", month:full?"long":"short", ...(full ? {year:"numeric"} : {})}).format(new Date(value.length === 10 ? value + "T12:00:00" : value)) : "Sin fecha";
  const hour = value => value ? value.length === 10 ? "Hora pendiente" : new Intl.DateTimeFormat("es-ES", {timeZone:"Europe/Madrid", hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "";
  const dateTime = value => value ? niceDate(value, false) + " · " + hour(value) : "Sin indicar";
  const localInput = value => (value || "").slice(0, 16);
  const badge = (label, color = "") => `<span class="badge ${esc(color)}">${esc(label)}</span>`;
  const labelColor = value => /TÉCN|TECN/.test(value.toUpperCase()) ? "coral" : /PREVIO|SHOW/.test(value.toUpperCase()) ? "cyan" : /ESCR|DRAM/.test(value.toUpperCase()) ? "violet" : "gold";
  const option = (value, label, selected) => `<option value="${esc(value)}"${String(selected) === String(value) ? " selected" : ""}>${esc(label)}</option>`;
  const btn = (action, label, id = "", css = "") => `<button type="button" class="button ${css}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const field = (label, content, hint = "") => `<label class="field">${label}${content}${hint ? `<small class="hint">${hint}</small>` : ""}</label>`;
  const input = (name, value = "", type = "text", attrs = "") => `<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${attrs}>`;
  const area = (name, value = "", attrs = "") => `<textarea name="${esc(name)}" ${attrs}>${esc(value)}</textarea>`;
  const select = (name, options, selected, attrs = "") => `<select name="${esc(name)}" ${attrs}>${Object.entries(options).map(([v,l]) => option(v,l,selected)).join("")}</select>`;
  const titleOf = object => object?.title || object?.name || "Ficha";
  const tasksFor = board => active("ticket").filter(x => x.boardId === board);
  const progress = board => {
    const tasks = tasksFor(board), done = tasks.filter(x => x.status === "done").length;
    return {done, total: tasks.length, percent: tasks.length ? Math.round(100 * done / tasks.length) : 0};
  };
  const progressHtml = (p, css = "") => `<progress class="${css}" max="100" value="${p.percent}" aria-label="${p.done} de ${p.total} tareas completadas"></progress>`;
  const empty = (title, subtitle, action = "") => `<div class="empty"><span class="empty-icon" aria-hidden="true">✦</span><h3>${esc(title)}</h3><p>${esc(subtitle)}</p>${action}</div>`;
  const polls = window.ScribAvailability({state:()=>state, item, active, esc, btn, field, input, area, select, option, badge, pageHead, empty, dateTime, hour, localInput, request, refresh, toast, openDialog, formShell, renderPage, dialog});

  function toast(message) {
    const node = document.querySelector("#toast");
    node.textContent = message; node.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("show"), 6000);
  }
  async function request(path, data) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 25000);
    try {
      const response = await fetch(BASE + "api/" + path, {method: data ? "POST" : "GET", credentials:"same-origin", cache:"no-store", signal:abort.signal,
        ...(data ? {headers:{"Content-Type":"application/json","X-CSRF-Token":state.csrf},body:JSON.stringify(data)} : {})});
      if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Vuelve a iniciar sesión en Sutura. Tu borrador sigue abierto.");
      const result = await response.json();
      if (!response.ok) {const error = new Error(result.error || "No se pudo guardar."); error.status = response.status; throw error;}
      return result;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("La conexión está tardando. Comprueba el estado antes de reintentar; el borrador sigue abierto.");
      throw error;
    } finally {clearTimeout(timer);}
  }
  async function refresh(render = true) {
    const next = await request("state");
    const changed = !state || next.revision !== state.revision;
    state = next;
    document.querySelector("#user-name").textContent = state.user.name;
    document.querySelector("#user-avatar").textContent = initials(state.user.name);
    document.querySelector("#connection").textContent = state.demo ? "● Ensayo local" : "● Conectado";
    document.querySelector("#connection").classList.remove("offline");
    if (render && changed && !dialog.open) renderPage();
    return state;
  }
  function pageHead(eyebrow, title, subtitle, actions = "") {
    return `<div class="page-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
  }
  function route() {return location.hash.slice(1).split("/");}
  function renderPage() {
    if (!state) return;
    const keepScroll = renderedRoute === location.hash ? {
      left:main.querySelector(".kanban")?.scrollLeft || 0,
      columns:Object.fromEntries([...main.querySelectorAll(".column")].map(c=>[c.dataset.status,c.querySelector(".ticket-list").scrollTop]))
    } : null;
    const [page = "home", id] = route();
    const nav = page === "poll" ? "availability" : page === "board" ? (item(id)?.eventId ? "events" : "boards") : page === "event" ? "events" : page;
    document.querySelectorAll("[data-nav]").forEach(x => {x.classList.toggle("active",x.dataset.nav === nav); if(x.dataset.nav === nav)x.setAttribute("aria-current","page");else x.removeAttribute("aria-current");});
    document.querySelector("#breadcrumb").textContent = "MUNDO SCRIB / " + ({home:"INICIO", events:"BOLOS Y CALENDARIO",availability:"DISPONIBILIDAD",poll:titleOf(item(id)), boards:"DRAMATURGIA", board:titleOf(item(id)),event:titleOf(item(id)),people:"ELENCO",messages:"WHATSAPP",templates:"PLANTILLAS",archive:"ARCHIVO"}[page] || "INICIO").toUpperCase();
    let content;
    if (page === "events") content = renderEvents();
    else if (page === "availability") content = polls.list();
    else if (page === "poll") content = polls.detail(id);
    else if (page === "boards") content = renderBoards();
    else if (page === "board") content = renderBoard(id);
    else if (page === "event") content = renderEvent(id);
    else if (page === "people") content = renderPeople();
    else if (page === "messages") content = renderMessages();
    else if (page === "templates") content = renderTemplates();
    else if (page === "archive") content = renderArchive();
    else content = renderHome();
    main.innerHTML = (state.demo ? `<div class="notice demo-notice">ENSAYO LOCAL · Datos ficticios, sin conexión con una partida ni con datos de producción.</div>` : "") + content;
    if(page === "people")main.querySelectorAll('[data-person]').forEach(card=>{
      const p=item(card.dataset.person);
      card.querySelector('.person-body > .actions').insertAdjacentHTML('beforeend',btn("compose-person","◌ WhatsApp",p.id,"small"));
      card.querySelector('.bio').insertAdjacentHTML('afterend',`<p class="tiny">${esc(p.phone || "Sin teléfono")}</p>`);
    });
    if(keepScroll){const board=main.querySelector(".kanban");if(board)board.scrollLeft=keepScroll.left;main.querySelectorAll(".column").forEach(c=>{c.querySelector(".ticket-list").scrollTop=keepScroll.columns[c.dataset.status] || 0;});}
    renderedRoute=location.hash;
    if (page === "board") applyFilters();
    updateHealthUI();
  }
  function eventCard(event) {
    const p = progress(event.boardId);
    if(event.eventType === "rehearsal") return `<article class="panel event-card"><p class="eyebrow">◷ ENSAYO</p><h3>${esc(event.title)}</h3><p class="section">${esc(dateTime(event.start))} — ${hour(event.end)}</p><p class="muted">⌖ ${esc(event.venue || "Lugar pendiente")} · ${EVENT_STATUS[event.status]}</p><a class="button section" href="#event/${event.id}">Ver ensayo ↗</a></article>`;
    return `<article class="panel event-card"><div class="service-top"><span class="event-date">${esc(niceDate(event.start,false))} · ${hour(event.start)}</span>${badge(EVENT_STATUS[event.status],event.status === "confirmed" ? "green" : "gold")}</div><h3>${esc(event.title)}</h3><p class="venue">⌖ ${esc([event.venue,event.city].filter(Boolean).join(" · ") || "Lugar pendiente")}</p><div class="summary"><span>Preparación</span><strong>${p.done}/${p.total} · ${p.percent}%</strong></div>${progressHtml(p,"progress-gold")}<div class="actions"><a class="button small" href="#event/${event.id}">Ver bolo</a><a class="button small" href="#board/${event.boardId}">Abrir tareas ↗</a></div></article>`;
  }
  function renderHome() {
    const upcoming = active("event").filter(x => x.start.slice(0,10) >= today() && !["cancelled","completed"].includes(x.status)).sort((a,b)=>a.start.localeCompare(b.start));
    const tasks = active("ticket"), mine = tasks.filter(x => x.status !== "done" && x.assignees.includes(state.user.username));
    const blocked = tasks.filter(x=>x.status === "blocked"), late = tasks.filter(x=>x.status !== "done" && x.due && x.due < today());
    return pageHead("TU EQUIPO. TU ESCENARIO.", `Hola, ${state.user.name.split(" ")[0]}.`, "Aquí se prepara todo lo que luego parece magia.",btn("new-event","＋ Crear bolo","","primary")) +
      `<section class="hero"><div><p class="eyebrow">DEL LABORATORIO AL ESCENARIO</p><h2>Escribir es un juego.<br>Prepararlo, un trabajo en equipo.</h2><p>Bolos, ideas, elenco y tareas en un mismo backstage. Sin perder lo que importa entre mensajes.</p></div><div class="hero-orbit" aria-hidden="true">✳</div></section>
      <div class="grid cols2"><article class="panel service"><div class="service-top"><span class="service-icon" aria-hidden="true">▸</span><span id="server-health" class="badge">Comprobando servidor</span></div><div><h2>El videojuego</h2><p class="muted">Entra a los roles de &lt;SCRI&gt; B como en el mundo de Sutura.</p></div><div class="actions"><a href="/scrib/game/" target="_blank" rel="noopener" class="button cyan">Abrir videojuego ↗</a><a href="/scrib/" target="_blank" rel="noopener" class="button">Abrir web ↗</a></div></article>
      <article class="panel service"><div class="service-top"><span class="service-icon coral" aria-hidden="true">↗</span><span id="web-health" class="badge">Comprobando web</span></div><div><h2>El escaparate</h2><p class="muted">Fechas, prensa y la historia del show. Producción anterior permanece disponible.</p></div><div class="actions"><a class="button" target="_blank" rel="noopener" href="https://scribshow.es/">scribshow.es ↗</a><a href="/scrib-produccion/" class="button">Producción anterior</a></div></article></div>
      <section class="grid cols4 section">${[[upcoming.length,"Bolos por venir","El siguiente acto", "gold"],[mine.length,"Mis tareas abiertas","Asignadas a ti", "violet"],[blocked.length,"Tareas bloqueadas","Lo que necesita ayuda", "coral"],[late.length,"Fuera de plazo","Para poner al día", "cyan"]].map(([n,l,d,c])=>`<div class="panel kpi"><small>${l}</small><span class="number ${c}">${n}</span><p class="tiny">${d}</p></div>`).join("")}</section>
      <section class="section"><div class="panel-head"><h2>Próximos bolos</h2><a class="button small" href="#events">Ver calendario ↗</a></div><div class="grid cols3">${upcoming.slice(0,3).map(eventCard).join("") || empty("El siguiente escenario está por venir","Crea un bolo: su tablero aparecerá con todas las tareas de preparación.",btn("new-event","＋ Primer bolo","","primary"))}</div></section>
      <section class="grid cols2 section"><div class="panel"><div class="panel-head"><h2>Tu siguiente paso</h2>${badge(mine.length + " pendientes","violet")}</div>${mine.slice(0,5).map(x=>`<div class="activity-row"><span class="activity-dot">✦</span><div><button class="ticket-title" data-action="edit-ticket" data-id="${x.id}">${esc(x.title)}</button><small>${esc(titleOf(item(x.boardId)))} · ${STATUS[x.status]}</small></div></div>`).join("") || `<p class="muted">No tienes tareas asignadas pendientes. Abre un tablero y elige tu próximo reto.</p>`}</div><div class="panel"><div class="panel-head"><h2>El pulso del equipo</h2>${badge("ACTIVIDAD","cyan")}</div>${state.activity.slice(0,5).map(activityRow).join("")}</div></section>`;
  }
  function activityRow(log) {
    const target = item(log.target);
    return `<div class="activity-row"><span class="activity-dot">•</span><div>${esc(member(log.actor))} · ${esc(log.action)}<small>${esc(titleOf(target))} · ${esc(dateTime(log.created))}</small></div></div>`;
  }
  function renderEvents() {
    return pageHead("LA GIRA, BIEN ATADA", "Bolos y calendario", "Funciones y ensayos del elenco, juntos en el calendario. Los ensayos se pueden confirmar desde Disponibilidad. Horarios de Madrid.",btn("new-event","＋ Crear bolo","","primary")) +
      `<div class="toolbar"><div class="segmented" aria-label="Vista de los bolos"><button type="button" data-action="events-calendar" class="${calendarMode === "calendar"?"active":""}">Calendario</button><button type="button" data-action="events-agenda" class="${calendarMode === "agenda"?"active":""}">Agenda</button></div><a class="button small" href="${BASE}api/calendar.ics">↓ Exportar calendario</a></div>` +
      (calendarMode === "agenda" ? `<div class="grid cols3">${active("event").sort((a,b)=>a.start.localeCompare(b.start)).map(eventCard).join("") || empty("Todavía no hay bolos","Crea tu primera función y prepara el equipo.")}</div>` : renderCalendar());
  }
  function renderCalendar() {
    const year = month.getFullYear(), m = month.getMonth(), first = new Date(year,m,1), start = new Date(year,m,1 - (first.getDay()+6)%7);
    const events = active("event");
    const cells = Array.from({length:42},(_,i)=>{
      const date = new Date(start); date.setDate(date.getDate()+i);
      const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
      return `<div class="calendar-day ${date.getMonth() !== m ? "outside" : ""} ${day === today()?"today":""}"><button type="button" class="icon-button day-number" data-action="new-event-day" data-id="${day}" aria-label="Crear bolo el ${esc(niceDate(day))}">${date.getDate()}</button>${events.filter(x=>x.start.slice(0,10) === day).sort((a,b)=>a.start.localeCompare(b.start)).map(x=>`<button type="button" class="calendar-event ${x.status}" data-action="open-event" data-id="${x.id}">${esc(x.title)}<small>${hour(x.start)} · ${esc(x.venue || "Lugar pendiente")}</small></button>`).join("")}</div>`;
    });
    return `<div class="calendar"><div class="calendar-controls"><h2>${esc(new Intl.DateTimeFormat("es-ES",{month:"long",year:"numeric"}).format(month))}</h2><div class="actions"><label class="calendar-jump">Ir a mes <input type="month" id="calendar-month" value="${year}-${String(m+1).padStart(2,"0")}" aria-label="Elegir mes y año del calendario"></label>${btn("month-prev","←","","small")}${btn("month-today","Hoy","","small")}${btn("month-next","→","","small")}</div></div><div class="calendar-week">${["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"].map(x=>`<span>${x}</span>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div></div>`;
  }
  function renderBoards() {
    return pageHead("IDEAS QUE SE CONVIERTEN EN ESCENAS", "Dramaturgia", "Tableros para escribir, investigar, ensayar y desbloquear decisiones. Los tableros de cada bolo están en su ficha.",btn("new-board","＋ Nuevo tablero","","primary")) +
      `<div class="grid cols3">${active("board").filter(x=>!x.eventId).map(x=>{const p=progress(x.id);return `<article class="panel board-card ${x.color}"><span class="eyebrow">LABORATORIO</span><h2 class="board-title">${esc(x.title)}</h2><p class="muted">${esc(x.description)}</p><div class="summary">${p.done} de ${p.total} tareas · ${p.percent}% completado</div>${progressHtml(p)}<div class="actions"><a class="button" href="#board/${x.id}">Abrir tablero ↗</a>${btn("edit-board","Editar",x.id,"small")}</div></article>`;}).join("")}</div>`;
  }
  function renderBoard(id) {
    const board = item(id);
    if (!board || board.archived) return empty("Este tablero no está disponible","Puedes buscarlo en el archivo recuperable.",`<a class="button" href="#archive">Ir al archivo</a>`);
    const p = progress(id), tasks = tasksFor(id), labels = [...new Set(tasks.flatMap(x=>x.labels))].sort();
    return pageHead(board.eventId ? "PREPARACIÓN DEL BOLO" : "LABORATORIO DE DRAMATURGIA",board.title,`${p.done}/${p.total} tareas completadas · ${p.percent}% listo${board.description ? " · " + board.description : ""}`,
      (board.eventId ? `<a class="button" href="#event/${board.eventId}">Ficha del bolo</a>` : btn("edit-board","Editar tablero",id)) + btn("new-ticket","＋ Añadir tarea",id,"primary")) +
      `<div class="toolbar"><input type="search" id="board-search" aria-label="Buscar tareas" placeholder="Buscar título, descripción o etiqueta…" value="${esc(filters.search)}"><select id="board-mine" aria-label="Filtrar responsables">${option("","Todo el equipo",filters.mine)}${option("mine","Mis tareas",filters.mine)}${option("unassigned","Sin responsable",filters.mine)}</select><select id="board-label" aria-label="Filtrar etiquetas">${option("","Todas las etiquetas",filters.label)}${labels.map(x=>option(x,x,filters.label)).join("")}</select><select id="board-due" aria-label="Filtrar vencimiento">${option("","Todos los plazos",filters.due)}${option("late","Fuera de plazo",filters.due)}${option("urgent","Alta / urgente",filters.due)}</select></div>
      <div class="kanban" aria-label="Tablero de tareas: arrastra desde el asa o utiliza el selector de estado">${Object.entries(STATUS).map(([s,l])=>`<section class="column" data-status="${s}" aria-label="${l}"><div class="column-head"><span><i class="status-dot" aria-hidden="true"></i>${l}<span class="count">${tasks.filter(x=>x.status === s).length}</span></span><button type="button" class="icon-button" data-action="new-ticket-status" data-id="${id}" data-status="${s}" aria-label="Añadir tarea a ${l}">＋</button></div><div class="ticket-list">${tasks.filter(x=>x.status === s).sort((a,b)=>(a.position-b.position)||a.created.localeCompare(b.created)).map(ticketCard).join("")}</div><button type="button" class="add-ticket" data-action="new-ticket-status" data-id="${id}" data-status="${s}">＋ Añadir tarea</button></section>`).join("")}</div>`;
  }
  function ticketCard(ticket) {
    const checks = ticket.checklist?.length || 0;
    return `<article class="ticket ${ticket.priority === "urgent"?"urgent":""}" data-ticket="${ticket.id}" draggable="true"><div class="ticket-top"><button type="button" class="drag-handle" aria-label="Arrastrar ${esc(ticket.title)}" title="Arrastrar tarea">⠿</button><button type="button" class="ticket-title" data-action="edit-ticket" data-id="${ticket.id}">${esc(ticket.title)}</button></div><div class="ticket-tags">${ticket.labels.map(x=>badge(x,labelColor(x))).join("")}${["high","urgent"].includes(ticket.priority)?badge(PRIORITY[ticket.priority],"coral"):""}</div>${ticket.status === "blocked" && ticket.blockedReason?`<p class="muted">⚑ ${esc(ticket.blockedReason.slice(0,120))}</p>`:""}<div class="ticket-footer"><span class="avatars">${ticket.assignees.map(x=>`<span class="avatar" title="${esc(member(x))}">${esc(initials(member(x)))}</span>`).join("")}</span><span class="due ${ticket.due && ticket.due < today() && ticket.status !== "done" ? "overdue" : ""}">${ticket.due?"◷ " + esc(niceDate(ticket.due,false)):""}${checks ? ` · ☑ ${ticket.checklist.filter(x=>x.done).length}/${checks}` : ""}</span></div><div class="ticket-footer"><small>${ticket.assignees.length?ticket.assignees.length + " responsable(s)":"Sin responsable"}</small><select class="quick-status" data-ticket-status="${ticket.id}" aria-label="Cambiar estado de ${esc(ticket.title)}">${Object.entries(STATUS).map(([s,l])=>option(s,l,ticket.status)).join("")}</select></div></article>`;
  }
  function applyFilters() {
    main.querySelectorAll("[data-ticket]").forEach(node=>{
      const ticket = item(node.dataset.ticket), needle = filters.search.toLocaleLowerCase("es");
      node.hidden = !((!needle || [ticket.title,ticket.description,...ticket.labels].join(" ").toLocaleLowerCase("es").includes(needle)) && (!filters.mine || (filters.mine === "mine" ? ticket.assignees.includes(state.user.username) : !ticket.assignees.length)) && (!filters.label || ticket.labels.includes(filters.label)) && (!filters.due || (filters.due === "late" ? ticket.due && ticket.due < today() && ticket.status !== "done" : ["high","urgent"].includes(ticket.priority))));
    });
    main.querySelectorAll(".column").forEach(col=>col.querySelector(".count").textContent = col.querySelectorAll(".ticket:not([hidden])").length);
  }
  function renderEvent(id) {
    const event = item(id);
    if (!event || event.archived) return empty("Este bolo está archivado o no existe","Puedes recuperarlo junto con sus tareas desde el archivo.",`<a class="button" href="#archive">Ir al archivo</a>`);
    const p = progress(event.boardId), tasks = tasksFor(event.boardId), blocks = tasks.filter(x=>x.status === "blocked");
    const casts = event.cast.map(c=>{const person=item(c.personId);return `<button type="button" class="cast-chip ${c.team}" data-action="edit-person" data-id="${c.personId}">${esc(person?.name || "Ficha no disponible")}<small>${esc(c.role)}${c.team === "general"?"":" · Equipo " + (c.team === "blue"?"azul":"rojo")}</small></button>`;}).join("");
    return pageHead("HOJA DE RUTA",event.title,`${niceDate(event.start)} · ${hour(event.start)} · ${EVENT_STATUS[event.status]}`,
      btn("edit-event",event.eventType === "rehearsal"?"Editar ensayo":"Editar bolo",event.id) + btn("show-calendar","▦ Ver en calendario",event.start.slice(0,10)) + btn("compose-event","◌ WhatsApp al elenco",event.id) + btn("print","↓ Hoja de llamada",event.id) + (event.historical ? "" : `<a class="button primary" href="#board/${event.boardId}">Abrir tareas ↗</a>`) + (event.eventType === "rehearsal" ? `<a class="button" href="#poll/${esc(event.sourcePollId)}">Ver disponibilidades</a>` : btn("new-poll-event","◷ Buscar fecha de ensayo",event.id))) +
      `<div class="event-sheet"><section class="event-info"><div class="info-tile"><small>⌖ Espacio</small><strong>${esc(event.venue || "Pendiente")}</strong><p class="muted">${esc(event.city)}</p></div><div class="info-tile"><small>◷ Función · Europe/Madrid</small><strong>${hour(event.start)}${event.end?" — " + hour(event.end):""}</strong><p class="muted">${esc(niceDate(event.start))}</p></div><div class="info-tile"><small>☀ Convocatoria del elenco</small><strong>${esc(dateTime(event.arrival))}</strong></div></section>
      ${event.eventType === "rehearsal" ? `<section class="panel"><p class="eyebrow">◷ ENSAYO DEL ELENCO</p><h2>Una fecha elegida entre todos</h2><p class="muted section">Añadido desde la encuesta de disponibilidad. Puedes editar el horario o cancelar el ensayo desde esta ficha. No se han creado tareas de producción.</p>${event.parentEventId?`<a class="button section" href="#event/${esc(event.parentEventId)}">Ver bolo asociado ↗</a>`:""}</section>` : event.historical ? `<section class="panel"><p class="eyebrow">MEMORIA DEL SHOW</p><h2>✦ Bolo realizado</h2><p class="muted section">El elenco y sus participaciones quedan registrados aquí. Sin tareas de preparación pendientes.</p></section>` : `<section class="panel"><div class="panel-head"><h2>Preparación</h2>${badge(p.percent + "% listo",p.percent === 100?"green":"gold")}</div><div class="summary muted">${p.done} de ${p.total} tareas completadas · ${blocks.length} bloqueadas</div>${progressHtml(p,"progress-gold")}${blocks.length?`<div class="section"><h3>Necesita ayuda</h3>${blocks.map(x=>`<div class="activity-row"><button type="button" class="ticket-title" data-action="edit-ticket" data-id="${x.id}">⚑ ${esc(x.title)}</button></div>`).join("")}</div>`:""}</section>`}
      <section class="panel"><div class="panel-head"><h2>Elenco y equipo</h2>${badge(event.cast.length + " participaciones","violet")}</div><div class="team-row">${casts || `<p class="muted">Añade el elenco desde Editar bolo. Las fichas se reutilizan en todas las funciones.</p>`}</div></section>
      <section class="panel"><h2>Todo lo que hay que saber</h2><div class="section notes">${esc(event.description || "Sin notas de producción todavía.")}</div>${event.address?`<p class="section notes">⌖ ${esc(event.address)}</p>`:""}${event.ticketUrl?`<a class="button section" href="${esc(event.ticketUrl)}" target="_blank" rel="noopener noreferrer">Entradas / información ↗</a>`:""}<p class="print-only section">Mundo SCRIB · ${niceDate(today())} · Horario Europe/Madrid</p></section></div>`;
  }
  function renderPeople() {
    return pageHead("LAS PERSONAS QUE LO HACEN POSIBLE", "Elenco", "Una ficha por persona. Reutiliza sus datos y asigna un papel diferente en cada función.",btn("new-person","＋ Nueva persona","","primary")) +
      `<div class="toolbar"><input type="search" id="people-search" aria-label="Buscar en el elenco" placeholder="Buscar nombre o especialidad…"></div><div class="grid cols3">${active("person").sort((a,b)=>a.name.localeCompare(b.name,"es")).map(p=>`<article class="panel person-card" data-person="${p.id}">${p.image?`<img class="person-photo" src="${BASE}images/${p.image}" alt="${esc(p.name)}" loading="lazy">`:`<div class="person-placeholder" aria-hidden="true">${esc(initials(p.name))}</div>`}<div class="person-body"><h3>${esc(p.name)}</h3>${badge(`${p.participationCount || 0} ${(p.participationCount || 0) === 1 ? "bolo realizado" : "bolos realizados"}`,"gold")}<div class="label-group">${p.roles.map(x=>badge(x,"violet")).join("")}</div><p class="bio">${esc(p.bio)}</p>${personHistory(p,true)}<div class="socials">${[[p.instagram,"Instagram ↗"],[p.website,"Web ↗"],[p.otherSocial,"Otra red ↗"]].filter(([l])=>l).map(([l,n])=>`<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${n}</a>`).join("")}</div><div class="actions">${btn("edit-person","Ver / editar ficha",p.id,"small")}</div></div></article>`).join("") || empty("Todo empieza por el equipo","Añade a las personas del elenco; podrás elegirlas al crear cada bolo.",btn("new-person","＋ Añadir persona","","primary"))}</div>`;
  }
  function renderTemplates() {
    return pageHead("NO VOLVER A EMPEZAR DE CERO","Plantillas de tareas","Al crear un bolo, se copian sus tareas en TO DO. Editar una plantilla no modifica funciones ya creadas.",btn("new-template","＋ Nueva plantilla","","primary")) +
      `<div class="grid cols3">${active("template").map(t=>`<article class="panel template-card"><p class="eyebrow">${t.id === "default-template" ? "TU LISTA ORIGINAL" : "LISTA PERSONALIZADA"}</p><h2>${esc(t.title)}</h2><p class="muted">${t.tasks.length} tareas · ${[...new Set(t.tasks.flatMap(x=>x.labels))].map(x=>esc(x)).join(" / ")}</p><div class="actions">${btn("edit-template","Ver / editar tareas",t.id)}${btn("duplicate-template","Duplicar",t.id,"small")}</div></article>`).join("")}</div><div class="notice section">La lista incluye preparar el acceso a los ordenadores. No guardes contraseñas reales en tickets ni comentarios.</div>`;
  }
  function personHistory(p, compact=false) {
    const shows=p.participations || [];
    if(!shows.length)return compact ? "" : `<p class="muted section">Sin bolos realizados registrados todavía.</p>`;
    return `<details class="section participation-history"${compact ? "" : " open"}><summary>✦ ${shows.length} ${shows.length === 1 ? "participación" : "participaciones"} · Ver bolos</summary><div class="history-list">${shows.map(h=>`<article class="history-entry"><strong>${esc(niceDate(h.date))}</strong><span>${esc(h.title)} · ${esc(h.venue || h.city || "Lugar pendiente")}</span><small>${h.roles.map(r=>esc(r.role)+(r.team&&r.team!=="general"?" · Equipo " + (r.team === "red"?"rojo":"azul"):"")).join(" / ")}</small><div class="actions">${h.eventId?btn("open-participation","Ver bolo ↗",h.eventId,"small"):""}${btn("show-calendar","▦ Calendario",h.date,"small")}</div></article>`).join("")}</div></details>`;
  }
  const deliveryLabel = status => ({pending:"Sin enviar",sent:"Envío confirmado por WhatsApp",sending:"Envío en curso / por confirmar",unknown:"No confirmado: revisar WhatsApp antes de repetir"}[status] || status);
  async function loadMessages() {
    const [status,history] = await Promise.all([request("whatsapp/status"),request("whatsapp/messages")]);
    whatsappStatus=status;messageHistory=history.messages;
  }
  function renderMessages() {
    return pageHead("COORDINAR SIN PERDER EL TOQUE PERSONAL","WhatsApp al elenco","Un mensaje individual por persona, con su nombre y los datos del bolo. Nunca se envía automáticamente.",btn("compose-message","＋ Preparar mensaje","","primary")) +
      `<div class="panel service-top"><div>${badge(whatsappStatus?.ready?"CONECTADO":"COMPROBAR CONEXIÓN",whatsappStatus?.ready?"green":"gold")}<p class="muted">${esc(whatsappStatus?.message || "Comprueba la conexión del WhatsApp de Impropios antes de enviar.")}</p></div>${btn("message-history","↻ Actualizar","","small")}</div><div class="notice section">Primero confirma el teléfono en cada ficha. Después elige destinatarios y revisa el texto exacto. Cada envío necesita tu confirmación. Los números y mensajes quedan dentro de Sutura.</div><section class="section grid cols2">${messageHistory.map(d=>`<article class="panel"><p class="eyebrow">${d.expired?"VISTA PREVIA CADUCADA":"VISTA PREVIA"} · ${esc(dateTime(d.created))}</p><h3>${d.people.length} destinatarios${d.eventId?" · " + esc(titleOf(item(d.eventId))):""}</h3><p class="muted">${d.people.filter(p=>p.delivery.status === "sent").length} envíos confirmados</p>${btn("message-draft","Revisar mensajes",d.id)}</article>`).join("") || empty("El siguiente mensaje empieza aquí","Prepararlo no envía nada. Puedes elegir un bolo o escribir a personas concretas.")}</section>`;
  }
  function messageRecipients(eventId, personId="") {
    const event=eventId?item(eventId):null;
    const people=active("person").filter(p=>!event || event.cast.some(c=>c.personId === p.id)).sort((a,b)=>a.name.localeCompare(b.name,"es"));
    const target=dialog.querySelector('#message-recipients');
    target.innerHTML=people.map(p=>`<label class="recipient-option"><input type="checkbox" name="people" value="${p.id}" ${!p.phone||!p.phoneConfirmed?"disabled":""} ${p.id===personId&&p.phoneConfirmed?"checked":""}><span><strong>${esc(p.name)}</strong><small>${p.phone?esc(p.phone):"Sin teléfono"} · ${p.phoneConfirmed?"Teléfono confirmado":"Confirma el teléfono en la ficha"}</small></span>${btn("edit-person","Ficha",p.id,"small")}</label>`).join("") || `<p class="muted">Este bolo no tiene elenco. Añádelo en su ficha primero.</p>`;
  }
  function openMessage(eventId="",personId="") {
    openDialog("message","Un mensaje para cada persona",`<form id="message-form"><div class="notice">No se envía nada hasta revisar y confirmar cada mensaje.</div>${field("Contexto del mensaje",select("eventId",{"":"Sin bolo · mensaje libre",...Object.fromEntries(active("event").map(e=>[e.id,niceDate(e.start,false)+" · "+e.title]))},eventId,'id="message-event"'))}<fieldset class="recipient-list"><legend>Destinatarios · selección explícita</legend><div id="message-recipients"></div></fieldset>${field("Mensaje personalizado",area("text",eventId?"Hola {nombre},\n\nTe escribimos por {bolo}, el {fecha} a las {hora} en {lugar}. Tu papel: {papel}.\n\n¡Nos vemos en el escenario!":"Hola {nombre},\n\n",'required maxlength="4000" rows="8"'),"Variables: {nombre}, {nombre_completo}, {bolo}, {fecha}, {hora}, {lugar}, {convocatoria}, {papel}.")}<p class="form-error" role="alert"></p><div class="form-footer"><span>Hasta 50 destinatarios. Sin envíos en grupo.</span><button class="button primary" type="submit">Revisar vista previa →</button></div></form>`);
    messageRecipients(eventId,personId);
  }
  async function previewMessage(form) {
    if(saving)return;saving=true;
    const button=form.querySelector('[type=submit]');button.disabled=true;
    try {
      const data={eventId:form.querySelector('[name=eventId]').value,text:form.querySelector('[name=text]').value,people:[...form.querySelectorAll('[name=people]:checked')].map(x=>x.value)};
      const result=await request("whatsapp/preview",data);
      showMessagePreview(result.item);
    } catch(error){form.querySelector('.form-error').textContent=error.message;}
    finally{saving=false;button.disabled=false;}
  }
  function showMessagePreview(draft) {
    openDialog("message","Revisa antes de enviar",`<div class="notice">Esta vista previa caduca a los 15 minutos. El botón envía solo el mensaje de esa tarjeta. No reenviamos mensajes dudosos automáticamente.</div><div class="message-preview-list">${draft.people.map((p,i)=>{
      const status=p.delivery?.status || "pending",available=status==="pending" && !draft.expired && !state.demo;
      return `<article class="panel message-preview"><div class="service-top"><div><h3>${esc(p.name)}</h3><small>${esc(p.phone)}</small></div>${badge(deliveryLabel(status),status==="sent"?"green":"gold")}</div><div class="message-bubble">${esc(p.text)}</div>${available?`<label class="check-option"><input type="checkbox" class="message-confirm">Confirmo este teléfono y este texto</label><button type="button" class="button primary" data-action="send-message" data-id="${draft.id}" data-recipient="${i}">Enviar a ${esc(p.name.split(' ')[0])}</button>`:`<p class="hint">${state.demo?"Ensayo local: envío real bloqueado.":draft.expired&&status==="pending"?"Genera una nueva vista previa para enviar.":status==="unknown"||status==="sending"?"No repitas el envío sin comprobarlo antes en WhatsApp.":"Este mensaje ya no se enviará de nuevo."}</p>`}</article>`;
    }).join("")}</div><div class="actions section">${btn("close-dialog","Cerrar")}</div>`);
  }
  async function sendMessage(node) {
    if(saving)return;
    const card=node.closest('.message-preview');
    if(!card.querySelector('.message-confirm').checked){toast("Confirma el destinatario y el texto de esta tarjeta antes de enviar.");return;}
    saving=true;node.disabled=true;
    try {
      const result=await request("whatsapp/send",{draftId:node.dataset.id,recipient:Number(node.dataset.recipient),confirmed:true});
      await loadMessages();const draft=messageHistory.find(d=>d.id===node.dataset.id);if(draft)showMessagePreview(draft);
      toast(result.item.status === "sent"?"WhatsApp ha confirmado el envío.":"Envío no confirmado. Revísalo en WhatsApp antes de volver a enviar.");
    }catch(error){toast(error.message);}finally{saving=false;node.disabled=false;}
  }
  function renderArchive() {
    const archived = state.items.filter(x=>x.archived && !(x.kind === "board" && x.eventId) && !(x.kind === "ticket" && item(x.boardId)?.archived)).sort((a,b)=>b.updated.localeCompare(a.updated));
    return pageHead("NADA SE PIERDE POR ACCIDENTE", "Archivo recuperable", "Archivar un bolo también archiva su tablero y tareas. Recuperarlo los devuelve juntos.",state.user.role === "admin"?`<a class="button" href="${BASE}api/export.zip">↓ Copia completa ZIP</a>`:"") +
      `<section class="panel">${archived.map(x=>`<div class="archived-row"><div><strong>${esc(titleOf(x))}</strong><small>${KIND[x.kind]} · ${dateTime(x.updated)}</small></div>${btn("restore","Recuperar",x.id,"small")}</div>`).join("") || empty("El archivo está vacío","Las fichas archivadas aparecerán aquí y se podrán recuperar.")}</section>`;
  }

  function openDialog(kind, title, html) {
    document.querySelector("#dialog-title").textContent = title;
    document.querySelector("#dialog-kicker").textContent = KIND[kind]?.toUpperCase() || "BACKSTAGE";
    document.querySelector("#dialog-content").innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }
  function formShell(kind, object, body, extra = "") {
    return `<form id="edit-form" data-kind="${kind}" data-id="${esc(object.id || "")}" data-version="${object.version || 0}" data-request="${crypto.randomUUID()}">${body}<p class="form-error" role="alert"></p><div class="form-footer"><div>${object.id && object.id !== "default-template"?btn("archive", "Archivar",object.id,"danger small"):""}</div><div class="actions">${btn("close-dialog","Cancelar")}<button type="submit" class="button primary">Guardar ${KIND[kind].toLowerCase()}</button></div></div></form>${extra}`;
  }
  function openBoard(id) {
    const b = id ? item(id) : {title:"", description:"", color:"violet"};
    openDialog("board", id ? "Editar tablero" : "Nuevo tablero",formShell("board",b,
      field("Nombre del tablero",input("title",b.title,"text",'required maxlength="240"')) + field("Para qué lo vamos a usar",area("description",b.description,'maxlength="15000"')) + field("Color",select("color",{violet:"Violeta · dramaturgia",cyan:"Turquesa",coral:"Coral",gold:"Dorado"},b.color))));
  }
  function checkRow(check = {}) {
    return `<div class="checklist-row"><input type="checkbox" class="check-done" aria-label="Paso completado" ${check.done?"checked":""}><input type="text" class="check-text" aria-label="Texto del paso" value="${esc(check.text || "")}" maxlength="240" placeholder="Un paso concreto" required><button type="button" class="icon-button" data-action="remove-row" aria-label="Quitar paso">×</button></div>`;
  }
  async function openTicket(id, boardId, status = "todo") {
    const details = id ? await request("items/" + id) : null;
    const t = details?.item || {title:"",description:"",boardId,status,priority:"normal",labels:[],assignees:[],due:"",checklist:[],blockedReason:""};
    if (details) {const index = state.items.findIndex(x=>x.id === id); if(index>=0)state.items[index]=t;}
    const form = formShell("ticket",t,
      input("boardId",t.boardId,"hidden") + field("Título de la tarea",input("title",t.title,"text",'required maxlength="240"')) + field("Descripción",area("description",t.description,'maxlength="15000"')) +
      `<div class="form-row">${field("Estado",select("status",STATUS,t.status))}${field("Prioridad",select("priority",PRIORITY,t.priority))}</div>` +
      `<div class="form-row">${field("Fecha límite",input("due",t.due,"date"))}${field("Etiquetas",input("labels",t.labels.join(", "),"text",'maxlength="800"'),"Separadas por comas")}</div>` +
      field("Si está bloqueada, ¿qué necesita?",area("blockedReason",t.blockedReason,'maxlength="2000"')) +
      `<div><p class="field">Responsables</p><div class="assignee-options">${state.members.map(m=>`<label class="check-option"><input type="checkbox" name="assignees" value="${esc(m.username)}" ${t.assignees.includes(m.username)?"checked":""}>${esc(m.name)}</label>`).join("")}</div></div>` +
      `<div><div class="panel-head"><h3>Checklist</h3>${btn("add-check","＋ Paso","","small")}</div><div class="checklist-editor">${t.checklist.map(checkRow).join("")}</div></div>`);
    openDialog("ticket",id ? "Dentro de la tarea" : "Nueva tarea",`<div class="editor-grid"><div>${form}</div><aside class="discussion"><h3>Conversación del equipo</h3><div id="comments">${id?commentsHtml(details.comments):`<p class="muted">Guarda la tarea para añadir comentarios.</p>`}</div>${id?`<form class="comment-form" data-id="${id}" data-request="${crypto.randomUUID()}">${field("Tu comentario",area("comment","",'required maxlength="10000" placeholder="Añade contexto, una decisión o un bloqueo…"'))}<p class="form-error" role="alert"></p><button type="submit" class="button">Enviar comentario</button></form><details><summary>Historial de la tarea</summary>${details.activity.map(activityRow).join("")}</details>`:""}</aside></div>`);
  }
  function commentsHtml(comments) {return comments.map(c=>`<div class="comment"><small><strong>${esc(member(c.author))}</strong> · ${dateTime(c.created)}</small>${esc(c.body)}</div>`).join("") || `<p class="muted">Aquí empieza la conversación.</p>`;}
  function castRow(c = {}) {
    const choices=state.items.filter(p=>p.kind === "person" && (!p.archived || p.id === c.personId));
    return `<div class="cast-editor-row"><select class="cast-person" aria-label="Persona del elenco" required>${option("","Selecciona persona",c.personId)}${choices.map(p=>option(p.id,p.name+(p.archived?" (archivado)":""),c.personId)).join("")}</select><input class="cast-role" aria-label="Papel en el bolo" list="cast-roles" placeholder="Escritura, técnica…" value="${esc(c.role || "")}" required maxlength="100"><select class="cast-team" aria-label="Equipo">${option("general","General",c.team || "general")}${option("blue","Azul",c.team)}${option("red","Rojo",c.team)}</select><button type="button" class="icon-button cast-remove" data-action="remove-row" aria-label="Quitar persona del bolo">×</button></div>`;
  }
  function openEvent(id, day) {
    const e = id ? item(id) : {title:"",start:day || today(),end:"",arrival:"",status:"pending",venue:"",city:"",address:"",description:"",ticketUrl:"",cast:[]};
    openDialog("event",id ? "Editar bolo" : "Un nuevo escenario",formShell("event",e,
      field("Nombre del bolo",input("title",e.title,"text",'required maxlength="240" placeholder="SCRIB · sala / festival"')) +
      `<div class="form-row">${field("Fecha del bolo",input("start",e.start.slice(0,10),"date", "required"))}${field("Hora · horario Madrid",input("startTime",e.start.length > 10 ? e.start.slice(11,16) : "","time"),"Déjala vacía si todavía está pendiente.")}</div>` +
      field("Fin (opcional; requiere hora de inicio)",input("end",localInput(e.end),"datetime-local")) +
      `<div class="form-row">${field("Convocatoria del elenco",input("arrival",localInput(e.arrival),"datetime-local"))}${field("Estado del bolo",select("status",EVENT_STATUS,e.status))}</div>` +
      `<div class="form-row">${field("Espacio / sala",input("venue",e.venue,"text",'maxlength="200"'))}${field("Ciudad",input("city",e.city,"text",'maxlength="120"'))}</div>` + field("Dirección / instrucciones de llegada",input("address",e.address,"text",'maxlength="1000"')) +
      field("Entradas / información",input("ticketUrl",e.ticketUrl,"url",'placeholder="https://…" maxlength="2000"')) + field("Notas de producción",area("description",e.description,'maxlength="15000" placeholder="Acceso, necesidades de sala, contactos profesionales, ensayo…"')) +
      (id ? `<div class="notice">El tablero ya existe. Editar el bolo no reinicia ni duplica sus tareas.</div>` : field("Plantilla de tareas iniciales",select("templateId",Object.fromEntries(active("template").map(t=>[t.id,`${t.title} · ${t.tasks.length} tareas`])),"default-template"),"Se copiarán automáticamente en TO DO al guardar.")) +
      `<div><div class="panel-head"><h3>Elenco de esta función</h3>${btn("add-cast","＋ Persona","","small")}</div>${!active("person").length?`<p class="muted">Primero crea las fichas en Elenco. Puedes guardar el bolo y añadir su reparto después.</p>`:""}<div class="cast-editor">${e.cast.map(castRow).join("")}</div><datalist id="cast-roles">${["Escritura","Interpretación","Dramaturgia","Técnica","Producción","Dirección"].map(x=>`<option value="${x}">`).join("")}</datalist></div>`));
  }
  function openPerson(id) {
    const p = id ? item(id) : {name:"",roles:[],bio:"",instagram:"",website:"",otherSocial:"",image:""};
    if(p.archived){openDialog("person",p.name,`<div class="notice">Esta ficha está archivada. Se conserva en el reparto de sus funciones.</div><p class="notes">${esc(p.bio)}</p><div class="actions section">${btn("restore","Recuperar ficha",p.id,"primary")}${btn("close-dialog","Cerrar")}</div>`);return;}
    openDialog("person",id ? p.name : "Una persona del equipo",formShell("person",p,
      field("Nombre completo",input("name",p.name,"text",'required maxlength="160"')) + field("Especialidades / roles",input("roles",p.roles.join(", "),"text",'maxlength="800"'),"Por ejemplo: Escritura, Interpretación, Técnica. Separados por comas.") +
      field("Teléfono privado · WhatsApp",input("phone",p.phone || "","tel",'maxlength="40" placeholder="+34…" autocomplete="off"'),"Solo se guarda dentro del mundo autenticado. No se publica en scribshow.es.") +
      `<label class="check-option"><input type="checkbox" name="phoneConfirmed" ${p.phoneConfirmed?"checked":""}>He comprobado que este teléfono corresponde a esta persona</label>` +
      personHistory(p) +
      field("Biografía / notas profesionales",area("bio",p.bio,'maxlength="5000"')) +
      `<div class="form-row">${field("Instagram",input("instagram",p.instagram,"url",'placeholder="https://instagram.com/…" maxlength="2000"'))}${field("Web / portfolio",input("website",p.website,"url",'placeholder="https://…" maxlength="2000"'))}</div>` + field("Otra red social",input("otherSocial",p.otherSocial,"url",'placeholder="https://…" maxlength="2000"')) +
      input("image",p.image,"hidden") + `<div class="upload-preview">${p.image?`<img src="${BASE}images/${p.image}" alt="Foto actual">`:""}${field("Foto de la ficha",'<input type="file" name="photo" accept="image/png,image/jpeg,image/webp">',"PNG, JPG o WebP, hasta 4 MB. Solo visible dentro del mundo autenticado.")}</div>`));
  }
  function templateRow(t = {}) {
    return `<div class="template-row"><input class="template-title" value="${esc(t.title || "")}" placeholder="Título de la tarea" maxlength="240" required><input class="template-labels" value="${esc((t.labels || []).join(", "))}" placeholder="Etiquetas" maxlength="800"><button type="button" class="icon-button remove-template-row" data-action="remove-row" aria-label="Quitar tarea de plantilla">×</button><input class="template-description" type="hidden" value="${esc(t.description || "")}"></div>`;
  }
  function openTemplate(id, duplicate = false) {
    const original = id ? item(id) : {title:"",tasks:[{title:"",labels:[]}]};
    const t = duplicate ? {...original,id:"",version:0,title:original.title + " · copia"} : original;
    openDialog("template",duplicate ? "Duplicar plantilla" : id ? "Editar plantilla" : "Nueva plantilla",formShell("template",t,
      field("Nombre de la plantilla",input("title",t.title,"text",'required maxlength="240"')) + `<p class="muted">Cada fila se convertirá en una tarea en TO DO. No se modifican bolos ya creados.</p><div class="template-editor">${t.tasks.map(templateRow).join("")}</div>${btn("add-template-task","＋ Añadir tarea","","small")}`));
  }
  const splitValues = s => String(s || "").split(",").map(x=>x.trim()).filter(Boolean);
  async function formData(form) {
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.kind === "availability") return polls.formData(form, data);
    if (form.dataset.kind === "ticket") {
      data.labels = splitValues(data.labels);
      data.assignees = [...form.querySelectorAll('[name=assignees]:checked')].map(x=>x.value);
      data.checklist = [...form.querySelectorAll(".checklist-row")].map(row=>({text:row.querySelector(".check-text").value,done:row.querySelector(".check-done").checked}));
    } else if (form.dataset.kind === "person") {
      data.phoneConfirmed = form.querySelector('[name=phoneConfirmed]').checked;
      data.roles = splitValues(data.roles); const file = data.photo; delete data.photo;
      if (file?.size) {
        if (file.size > 4 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 4 MB.");
        const encoded = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("No se pudo leer la foto."));reader.readAsDataURL(file);});
        const result = await request("upload",{base64:encoded}); data.image = result.item.image;
        form.querySelector('[name=image]').value = data.image;
      }
    } else if (form.dataset.kind === "event") {
      if(data.startTime)data.start += "T" + data.startTime;
      delete data.startTime;
      data.cast = [...form.querySelectorAll(".cast-editor-row")].map(row=>({personId:row.querySelector(".cast-person").value,role:row.querySelector(".cast-role").value,team:row.querySelector(".cast-team").value}));
    } else if (form.dataset.kind === "template") {
      data.tasks = [...form.querySelectorAll(".template-row")].map(row=>({title:row.querySelector(".template-title").value,labels:splitValues(row.querySelector(".template-labels").value),description:row.querySelector(".template-description").value}));
    }
    return data;
  }
  async function saveForm(form) {
    if (saving) return;
    saving = true; const buttons = [...form.querySelectorAll("button")]; buttons.forEach(b=>b.disabled=true);
    const errorNode = form.querySelector(".form-error"); errorNode.textContent = "";
    try {
      if (form.matches(".comment-form")) {
        await request("comment",{id:form.dataset.id,body:form.querySelector("textarea").value,requestId:form.dataset.request});
        form.reset(); form.dataset.request = crypto.randomUUID();
        const details = await request("items/"+form.dataset.id); dialog.querySelector("#comments").innerHTML = commentsHtml(details.comments);
        toast("Comentario guardado. El equipo lo verá en la tarea."); await refresh(false);
      } else {
        const data = await formData(form), id = form.dataset.id;
        const result = await request(id ? "update" : "create",id ? {id,version:Number(form.dataset.version),data} : {kind:form.dataset.kind,data,requestId:form.dataset.request});
        const existingIndex = state.items.findIndex(x=>x.id === result.item.id);
        if(existingIndex >= 0)state.items[existingIndex]=result.item;else state.items.push(result.item);
        let refreshed = true;
        try {await refresh(false);} catch (_) {refreshed=false;}
        dialog.close();
        if (form.dataset.kind === "event") location.hash = "event/" + result.item.id;
        else if (form.dataset.kind === "availability") {polls.invalidate();location.hash = "poll/" + result.item.id;renderPage();}
        else if (form.dataset.kind === "board") location.hash = "board/" + result.item.id;
        else renderPage();
        toast(!refreshed ? "Guardado en el servidor. Recarga para ver todos los cambios cuando vuelva la conexión." : form.dataset.kind === "event" && !id ? "Bolo creado: tareas iniciales listas en TO DO." : "Guardado en el backstage.");
      }
    } catch(error) {errorNode.textContent=error.message; if(error.status === 409)await refresh(false).catch(()=>{});}
    finally {saving=false;buttons.forEach(b=>b.disabled=false);}
  }
  async function moveTicket(id, status, beforeId = "") {
    const ticket = item(id); if (!ticket || saving) return;
    saving = true;
    try {await request("move",{id,status,beforeId,version:ticket.version});await refresh(false); renderPage();toast("Tarea movida a " + STATUS[status] + ".");}
    catch(error) {toast(error.message);await refresh(false).catch(()=>{});renderPage();}
    finally {saving=false;}
  }
  async function archive(id, restore = false) {
    const object = item(id); if(!object || saving)return;
    saving=true;
    try {await request("archive",{id,version:object.version,archived:!restore});dialog.close();await refresh(false);renderPage();toast(restore?"Ficha recuperada.":"Archivado. Puedes recuperarlo desde Archivo.");}
    catch(error) {toast(error.message);}
    finally {saving=false;}
  }
  async function action(node) {
    const {action:a,id,status} = node.dataset;
    if(await polls.action(node))return;
    if(a === "new-event")openEvent();
    else if(a === "new-event-day")openEvent("",id);
    else if(a === "edit-event")openEvent(id);
    else if(a === "open-event")location.hash="event/"+id;
    else if(a === "open-participation") {if(!saving){dialog.close();location.hash="event/"+id;}}
    else if(a === "show-calendar") {if(!saving && /^\d{4}-\d{2}-\d{2}$/.test(id)){dialog.close();month=new Date(Number(id.slice(0,4)),Number(id.slice(5,7))-1,1);calendarMode="calendar";if(location.hash==="#events")renderPage();else location.hash="events";}}
    else if(a === "new-board")openBoard();
    else if(a === "edit-board")openBoard(id);
    else if(a === "new-ticket")await openTicket("",id);
    else if(a === "new-ticket-status")await openTicket("",id,status);
    else if(a === "edit-ticket")await openTicket(id);
    else if(a === "new-person")openPerson();
    else if(a === "edit-person")openPerson(id);
    else if(a === "compose-message")openMessage();
    else if(a === "compose-event")openMessage(id);
    else if(a === "compose-person")openMessage("",id);
    else if(a === "message-history") {await loadMessages();renderPage();}
    else if(a === "message-draft") {await loadMessages();const draft=messageHistory.find(x=>x.id===id);if(draft)showMessagePreview(draft);}
    else if(a === "send-message")await sendMessage(node);
    else if(a === "new-template")openTemplate();
    else if(a === "edit-template")openTemplate(id);
    else if(a === "duplicate-template")openTemplate(id,true);
    else if(a === "close-dialog") {if(!saving)dialog.close();}
    else if(a === "add-check")dialog.querySelector(".checklist-editor").insertAdjacentHTML("beforeend",checkRow());
    else if(a === "add-cast")dialog.querySelector(".cast-editor").insertAdjacentHTML("beforeend",castRow());
    else if(a === "add-template-task")dialog.querySelector(".template-editor").insertAdjacentHTML("beforeend",templateRow());
    else if(a === "remove-row")node.parentElement.remove();
    else if(a === "archive")await archive(id);
    else if(a === "restore")await archive(id,true);
    else if(a === "print")window.print();
    else if(a === "events-calendar" || a === "events-agenda") {calendarMode=a === "events-calendar"?"calendar":"agenda";renderPage();}
    else if(a === "month-next" || a === "month-prev") {month=new Date(month.getFullYear(),month.getMonth()+(a === "month-next"?1:-1),1);renderPage();}
    else if(a === "month-today") {month=new Date();renderPage();}
  }
  document.addEventListener("click",event=>{const node=event.target.closest("[data-action]");if(node)action(node).catch(error=>toast(error.message));});
  document.addEventListener("submit",event=>{if(event.target.matches("#edit-form,.comment-form")){event.preventDefault();saveForm(event.target);}else if(event.target.matches("#message-form")){event.preventDefault();previewMessage(event.target);}});
  document.addEventListener("change",event=>{
    const node=event.target;
    if(node.matches("#calendar-month") && /^\d{4}-\d{2}$/.test(node.value)){month=new Date(Number(node.value.slice(0,4)),Number(node.value.slice(5,7))-1,1);renderPage();return;}
    if(node.matches("[data-ticket-status]")) moveTicket(node.dataset.ticketStatus,node.value);
    if(node.id === "board-mine")filters.mine=node.value;
    if(node.id === "board-label")filters.label=node.value;
    if(node.id === "board-due")filters.due=node.value;
    if(node.id.startsWith("board-"))applyFilters();
    if(node.name === "phone" && dialog.querySelector('[name=phoneConfirmed]')) dialog.querySelector('[name=phoneConfirmed]').checked=false;
    if(node.id === "message-event")messageRecipients(node.value);
  });
  document.addEventListener("input",event=>{
    if(event.target.name === "phone" && dialog.querySelector('[name=phoneConfirmed]'))dialog.querySelector('[name=phoneConfirmed]').checked=false;
    if(event.target.id === "board-search"){filters.search=event.target.value;applyFilters();}
    if(event.target.id === "people-search")main.querySelectorAll("[data-person]").forEach(node=>{const p=item(node.dataset.person);node.hidden=![p.name,...p.roles].join(" ").toLowerCase().includes(event.target.value.toLowerCase());});
  });
  dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
  window.addEventListener("hashchange",()=>{polls.invalidate();filters={search:"",mine:"",label:"",priority:"",due:""};renderPage();if(route()[0]==="messages")loadMessages().then(()=>{if(route()[0]==="messages"&&!dialog.open)renderPage();}).catch(error=>toast(error.message));});

  function clearDrop() {document.querySelectorAll(".drop-active,.drop-before").forEach(n=>n.classList.remove("drop-active","drop-before"));}
  function targetAt(target, y) {
    const column = target?.closest(".column");
    if (!column)return null;
    const ticket = target.closest(".ticket");
    if(ticket?.dataset.ticket === dragId)return null;
    let before = ticket && ticket.dataset.ticket !== dragId ? ticket : null;
    if (before && y > before.getBoundingClientRect().top + before.getBoundingClientRect().height/2) before=[...column.querySelectorAll(".ticket:not([hidden])")].find(n=>n !== ticket && n.dataset.ticket !== dragId && n.getBoundingClientRect().top > ticket.getBoundingClientRect().top) || null;
    return {column,before};
  }
  function showDrop(drop) {clearDrop();if(drop){drop.column.classList.add("drop-active");drop.before?.classList.add("drop-before");}}
  document.addEventListener("dragstart",event=>{
    const ticket=event.target.closest(".ticket");if(!ticket)return;
    if(event.target.closest("select,input")){event.preventDefault();return;}
    dragId=ticket.dataset.ticket;ticket.classList.add("dragging");event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",dragId);
  });
  document.addEventListener("dragover",event=>{if(!dragId)return;const drop=targetAt(event.target,event.clientY);if(drop){event.preventDefault();event.dataTransfer.dropEffect="move";showDrop(drop);}});
  document.addEventListener("drop",event=>{
    if(!dragId)return;const drop=targetAt(event.target,event.clientY);if(!drop)return;
    event.preventDefault();const id=dragId;clearDrop();dragId="";moveTicket(id,drop.column.dataset.status,drop.before?.dataset.ticket || "");
  });
  document.addEventListener("dragend",()=>{clearDrop();document.querySelectorAll(".dragging").forEach(n=>n.classList.remove("dragging"));dragId="";});
  // Touch / pen: drag only from the handle so normal page scrolling remains available.
  document.addEventListener("pointerdown",event=>{
    if(event.pointerType === "mouse" || !event.target.closest(".drag-handle"))return;
    const handle=event.target.closest(".drag-handle"), ticket=handle.closest(".ticket");
    pointerDrag={id:ticket.dataset.ticket,x:event.clientX,y:event.clientY,handle,source:ticket,ghost:null};
    handle.setPointerCapture(event.pointerId);event.preventDefault();
  });
  document.addEventListener("pointermove",event=>{
    if(!pointerDrag)return;
    if(!pointerDrag.ghost && Math.hypot(event.clientX-pointerDrag.x,event.clientY-pointerDrag.y)>6){
      dragId=pointerDrag.id;pointerDrag.source.classList.add("dragging");pointerDrag.ghost=pointerDrag.source.cloneNode(true);pointerDrag.ghost.classList.remove("dragging");pointerDrag.ghost.classList.add("drag-ghost");pointerDrag.ghost.setAttribute("aria-hidden","true");document.body.append(pointerDrag.ghost);
    }
    if(!pointerDrag.ghost)return;
    pointerDrag.ghost.style.left=(event.clientX-100)+"px";pointerDrag.ghost.style.top=(event.clientY+15)+"px";
    const drop=targetAt(document.elementFromPoint(event.clientX,event.clientY),event.clientY);showDrop(drop);
    const board=main.querySelector(".kanban"), bounds=board?.getBoundingClientRect();
    if(bounds){if(event.clientX>bounds.right-35)board.scrollLeft+=18;else if(event.clientX<bounds.left+35)board.scrollLeft-=18;}
    if(drop){const list=drop.column.querySelector(".ticket-list"),r=list.getBoundingClientRect();if(event.clientY>r.bottom-40)list.scrollTop+=18;else if(event.clientY<r.top+40)list.scrollTop-=18;}
    event.preventDefault();
  });
  function stopPointer(event, cancel=false) {
    if(!pointerDrag)return;
    const drop=!cancel && pointerDrag.ghost?targetAt(document.elementFromPoint(event.clientX,event.clientY),event.clientY):null;
    const id=pointerDrag.id;pointerDrag.ghost?.remove();pointerDrag.source.classList.remove("dragging");pointerDrag=null;dragId="";clearDrop();
    if(drop)moveTicket(id,drop.column.dataset.status,drop.before?.dataset.ticket || "");
  }
  document.addEventListener("pointerup",event=>stopPointer(event));
  document.addEventListener("pointercancel",event=>stopPointer(event,true));

  async function checkHealth() {
    if(state?.demo){health={server:null,web:null};updateHealthUI();return;}
    const probe = async (url,options={}) => {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
      try {const r=await fetch(url,{...options,cache:"no-store",signal:controller.signal});return options.method === "HEAD" ? r.ok && !r.redirected : r.ok && !r.redirected ? await r.json() : null;}
      finally {clearTimeout(timer);}
    };
    const probes=[probe("/api/scrib-health"),probe("/scrib/game/",{method:"HEAD"})];
    const results=await Promise.allSettled(probes);
    const data=results[0].status === "fulfilled"?results[0].value:null;
    health.server=data ? Boolean(data.ok ?? data.online ?? data.connected ?? data.status === "online") : false;
    health.web=results[1].status === "fulfilled" && results[1].value;
    updateHealthUI();
  }
  function updateHealthUI() {
    for(const [id,value,label] of [["server-health",health.server,"Servidor"],["web-health",health.web,"Web"]]){
      const node=document.getElementById(id);if(!node)continue;
      node.className="badge " + (value===null?"":value?"green":"coral");
      node.textContent=state?.demo ? label + " · no consultado" : value===null ? "Comprobando " + label.toLowerCase() : value ? "● " + label + " activo" : "○ " + label + " no disponible";
    }
  }
  async function boot() {
    try {await refresh(false);renderPage();checkHealth().catch(()=>{});if(route()[0]==="messages")loadMessages().then(()=>{if(!dialog.open)renderPage();}).catch(error=>toast(error.message));}
    catch(error){main.innerHTML=empty("No se pudo abrir el backstage",error.message,`<a class="button" href="/sutura/">Entrar con Sutura / Authentik</a>`);document.querySelector("#connection").textContent="○ Sin conexión";}
  }
  setInterval(async()=>{
    if(!state || document.hidden || saving || dragId)return;
    if(dialog.open){
      const commentForm=dialog.querySelector(".comment-form");
      if(commentForm){
        try {
          const details=await request("items/"+commentForm.dataset.id);
          const html=commentsHtml(details.comments),pane=dialog.querySelector("#comments");
          if(pane.innerHTML !== html)pane.innerHTML=html;
        } catch(_) { /* Do not alter the draft if the connection drops. */ }
      }
      return;
    }
    if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName))return;
    try {await refresh();}catch(error){document.querySelector("#connection").textContent="○ Sin conexión · cambios no enviados";document.querySelector("#connection").classList.add("offline");}
  },15000);
  setInterval(()=>{if(state && !document.hidden)checkHealth().catch(()=>{});},30000);
  boot();
})();
