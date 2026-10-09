"use strict";
(() => {
  // Keep legacy links on the gateway too, including their selected board/event.
  if (location.hostname === "sutura.ddns.net" || location.pathname === "/mundo-scrib/" || location.pathname === "/mundo-scrib") {
    const pathname = /^\/mundo-scrib\/?$/.test(location.pathname) ? "/scrib/" : location.pathname;
    const origin = location.hostname === "sutura.ddns.net" ? "https://sutura-gateway.ddns.net" : location.origin;
    location.replace(origin + pathname + location.search + location.hash);
    return;
  }
  const BASE = "/scrib/backstage/";
  const STATUS = {todo: "TO DO", progress: "EN PROGRESO", blocked: "BLOQUEADA", done: "COMPLETADAS"};
  const PRIORITY = {low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente"};
  const EVENT_STATUS = {pending: "Por confirmar", confirmed: "Confirmado", completed: "Realizado", cancelled: "Cancelado"};
  const KIND = {ticket: "Tarea", board: "Tablero", event: "Bolo", person: "Elenco", template: "Plantilla", availability: "Encuesta", inventory:"Objeto",lighting:"Plano técnico"};
  const TEAM_ROLES=new Set(['Escritura','Interpretación']);
  const REQUIRED_CAST=[['Escritura','blue'],['Escritura','red'],['Interpretación','blue'],['Interpretación','red'],['Presentador','general'],['Técnica','general'],['Jurado','general']];
  const main = document.querySelector("#main");
  const dialog = document.querySelector("#editor");
  const deleteDialog = document.querySelector("#delete-confirmation");
  let pendingDelete = null;
  let state = null, calendarMode = "calendar", month = new Date(), saving = false, toastTimer;
  let health = {server: null};
  let filters = {search: "", mine: "", label: "", priority: "", due: ""};
  let dragId = "", pointerDrag = null;
  let renderedRoute = "", whatsappStatus = null, messageHistory = [];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const initials = name => String(name || "?").split(/[\s_.-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  const member = username => state.members.find(x => x.username === username)?.name || username;
  const item = id => state.items.find(x => x.id === id);
  const active = kind => state.items.filter(x => x.kind === kind && !x.archived);
  const colors = window.ScribPeopleColors;
  const personLabel = (id,label) => `<span class="person-label ${colors.className(item(id))}">${esc(label ?? item(id)?.name ?? 'Ficha archivada')}</span>`;
  const today = () => new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Madrid", year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  // Civil dates, independent of the browser timezone and the full calendar view.
  let homeMonth = today().slice(0,7), homeDay = today();
  const niceDate = (value, full = true) => value ? new Intl.DateTimeFormat("es-ES", {timeZone:"Europe/Madrid", day:"numeric", month:full?"long":"short", ...(full ? {year:"numeric"} : {})}).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value)) : "Sin fecha";
  const hour = value => value ? value.length === 10 ? "Hora pendiente" : new Intl.DateTimeFormat("es-ES", {timeZone:"Europe/Madrid", hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "";
  const dateTime = value => value ? niceDate(value, false) + " · " + hour(value) : "Sin indicar";
  const localInput = value => (value || "").slice(0, 16);
  const badge = (label, color = "") => `<span class="badge ${esc(color)}">${esc(label)}</span>`;
  const labelColor = value => /TÉCN|TECN/.test(value.toUpperCase()) ? "coral" : /PREVIO|SHOW/.test(value.toUpperCase()) ? "cyan" : /ESCR|DRAM/.test(value.toUpperCase()) ? "violet" : "gold";
  const option = (value, label, selected) => `<option value="${esc(value)}"${String(selected) === String(value) ? " selected" : ""}>${esc(label)}</option>`;
  const ICONS = {
    edit:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m14 5 5 5"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    archive:'<path d="M4 8v13h16V8M9 12h6"/><rect x="3" y="3" width="18" height="5" rx="1"/>',
    restore:'<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6M12 7v5l3 2"/>',
    copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    print:'<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6Z"/>',
    prev:'<path d="m15 5-7 7 7 7"/>', next:'<path d="m9 5 7 7-7 7"/>',
    wallet:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M16 13h5v4h-5Z"/>',
    document:'<path d="M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h8"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
    refresh:'<path d="M20 8a9 9 0 0 0-15-3L2 8M2 2v6h6M4 16a9 9 0 0 0 15 3l3-3M22 22v-6h-6"/>'
  };
  const icon = name => `<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  const btn = (action, label, id = "", css = "") => {
    const symbol = action.startsWith("edit-") ? "edit" : ({"delete-ticket":"trash",archive:"archive",restore:"restore","duplicate-template":"copy",print:"print","month-prev":"prev","month-next":"next","home-month-prev":"prev","home-month-next":"next","business-settlement":"edit","business-person":"wallet","business-billing":"edit","business-invoice":"document","business-agreement-view":"document","business-copy":"copy","business-review":"check","business-revoke":"close","business-send-links":"send","business-refresh":"refresh"})[action];
    const only = symbol && !["archive","restore"].includes(action) && !action.startsWith('business-');
    const name = action.endsWith("month-prev") ? "Mes anterior" : action.endsWith("month-next") ? "Mes siguiente" : label;
    return `<button type="button" class="button ${css}${only ? " icon-only" : ""}" data-action="${esc(action)}" data-id="${esc(id)}"${symbol ? ` aria-label="${esc(name)}" title="${esc(name)}"` : ""}>${symbol ? icon(symbol) : ""}${only ? "" : label}</button>`;
  };
  const field = (label, content, hint = "") => `<label class="field">${label}${content}${hint ? `<small class="hint">${hint}</small>` : ""}</label>`;
  const input = (name, value = "", type = "text", attrs = "") => `<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${attrs}>`;
  const area = (name, value = "", attrs = "") => `<textarea name="${esc(name)}" ${attrs}>${esc(value)}</textarea>`;
  const select = (name, options, selected, attrs = "") => `<select name="${esc(name)}" ${attrs}>${Object.entries(options).map(([v,l]) => option(v,l,selected)).join("")}</select>`;
  const boardTitle = value => {
    const title = String(value || "");
    if (!/\blaboratorios?\b/i.test(title)) return title || "Tareas";
    return title.replace(/\blaboratorios?\b(?:\s+de\b)?/gi, "").replace(/\s+/g, " ").replace(/\s*([·|:–—-])(?:\s*[·|:–—-])+\s*/g, " $1 ").replace(/^[ ·|:–—-]+|[ ·|:–—-]+$/g, "") || "Tareas";
  };
  const titleOf = object => object?.kind === "board" ? boardTitle(object.title) : object?.title || object?.name || "Ficha";
  const tasksFor = board => active("ticket").filter(x => x.boardId === board);
  const progress = board => {
    const tasks = tasksFor(board), done = tasks.filter(x => x.status === "done").length;
    return {done, total: tasks.length, percent: tasks.length ? Math.round(100 * done / tasks.length) : 0};
  };
  const progressHtml = (p, css = "") => `<progress class="${css}" max="100" value="${p.percent}" aria-label="${p.done} de ${p.total} tareas completadas"></progress>`;
  const empty = (title, subtitle, action = "") => `<div class="empty"><span class="empty-icon" aria-hidden="true">✦</span><h3>${esc(title)}</h3><p>${esc(subtitle)}</p>${action}</div>`;
  const profile = window.ScribPersonProfile({esc,roles:()=>state?.personRoles});
  const polls = window.ScribAvailability({state:()=>state, item, active, personLabel, esc, btn, field, input, area, select, option, badge, pageHead, empty, dateTime, hour, localInput, request, refresh, toast, openDialog, formShell, renderPage, dialog});
  const business = window.ScribBusiness({state:()=>state,item,active,personLabel,esc,btn,field,input,area,request,openDialog,dialog,toast,renderPage,niceDate,hour,eventInactive});
  const inventory = window.ScribInventory({state:()=>state,item,active,personLabel,esc,btn,field,input,area,select,option,badge,pageHead,empty,openDialog,formShell,renderPage,dialog});
  const isAdmin=()=>state?.user.role==='admin';
  const documents = window.ScribDocuments({esc,request,openDialog,isAdmin});
  const library = window.ScribMaterials({esc,btn,badge,pageHead,empty,request,renderPage,isAdmin});
  const lighting = window.ScribLighting({state:()=>state,esc,btn,pageHead,request,toast,refresh,renderPage});
  dialog.addEventListener('close', () => { if (state) renderPage(); });

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
    document.querySelectorAll('[data-admin]').forEach(n=>n.hidden=state.user.role!=='admin');
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
    // Background collaboration updates must never reload a playing presentation.
    if(renderedRoute===location.hash && /^#material\//.test(location.hash) && main.querySelector('.material-viewer iframe'))return;
    const keepScroll = renderedRoute === location.hash ? {
      left:main.querySelector(".kanban")?.scrollLeft || 0,
      columns:Object.fromEntries([...main.querySelectorAll(".column")].map(c=>[c.dataset.status,c.querySelector(".ticket-list").scrollTop]))
    } : null;
    const [page = "home", id] = route();
    const nav = page === "person" ? "people" : page === "archive" ? "boards" : page === "material" ? "materials" : page === "poll" ? "availability" : page === "board" ? (item(id)?.eventId ? "events" : "boards") : page === "event" ? "events" : page;
    document.querySelectorAll("[data-nav]").forEach(x => {x.classList.toggle("active",x.dataset.nav === nav); if(x.dataset.nav === nav)x.setAttribute("aria-current","page");else x.removeAttribute("aria-current");});
    let content;
    if (page === "events") content = renderEvents();
    else if (page === "availability") content = polls.list();
    else if (page === "poll") content = polls.detail(id);
    else if (page === "boards") content = renderBoards();
    else if (page === "board") content = renderBoard(id);
    else if (page === "event") content = renderEvent(id);
    else if (page === "people") content = renderPeople();
    else if (page === "person") content = renderPerson(id);
    else if (page === "inventory") content = inventory.list();
    else if (page === "lighting") content = lighting.render();
    else if (page === "materials") content = library.list();
    else if (page === "material") content = library.detail(id);
    else if (page === 'finance') content = business.overview();
    else if (page === 'production') content = business.production(id);
    else if (page === 'report') content = business.report(id);
    else if (page === 'invoice') content = business.invoice(id);
    else if (page === "messages") content = renderMessages();
    else if (page === "templates") content = renderTemplates();
    else if (page === "archive") content = renderArchive();
    else content = renderHome();
    main.innerHTML = (state.demo ? `<div class="notice demo-notice">ENSAYO LOCAL · Datos ficticios, sin conexión con una partida ni con datos de producción.</div>` : "") + content;
    library.afterRender?.();
    if(page==='inventory')inventory.applyFilters();
    if(keepScroll){const board=main.querySelector(".kanban");if(board)board.scrollLeft=keepScroll.left;main.querySelectorAll(".column").forEach(c=>{c.querySelector(".ticket-list").scrollTop=keepScroll.columns[c.dataset.status] || 0;});}
    renderedRoute=location.hash;
    if (page === "board") applyFilters();
    updateHealthUI();
  }
  function eventCard(event) {
    const p = progress(event.boardId);
    const completed = eventInactive(event) ? ' is-completed' : '';
    const link = `<a class="event-card-link" href="#event/${esc(event.id)}" aria-label="Abrir ${event.eventType === 'rehearsal' ? 'ensayo' : 'bolo'} ${esc(event.title)} · ${esc(niceDate(event.start))}">`;
    if(event.eventType === "rehearsal") return `<article class="panel event-card${completed}">${link}<p class="eyebrow">◷ ENSAYO</p><h3>${esc(event.title)}</h3><p>${esc(dateTime(event.start))} — ${esc(hour(event.end))}</p><p class="muted">⌖ ${esc(event.venue || "Lugar pendiente")} · ${esc(EVENT_STATUS[event.status])}</p><span class="event-enter" aria-hidden="true">Ver ensayo ↗</span></a></article>`;
    return `<article class="panel event-card${completed}">${link}<div class="event-card-heading"><h3>${esc(event.title)}</h3>${badge(EVENT_STATUS[event.status],completed ? 'inactive' : event.status === "confirmed" ? "green" : "gold")}</div><p class="event-date"><time datetime="${esc(event.start)}">${esc(niceDate(event.start))} · ${esc(hour(event.start))}</time></p><p class="venue">⌖ ${esc([event.venue,event.city].filter(Boolean).join(" · ") || "Lugar pendiente")}</p><div class="summary"><span>Preparación</span><strong>${p.done}/${p.total} · ${p.percent}%</strong></div>${progressHtml(p,"progress-gold")}<span class="event-enter" aria-hidden="true">Ver bolo ↗</span></a>${event.boardId ? `<a class="button small event-task-link" href="#board/${esc(event.boardId)}">Abrir tareas ↗</a>` : ""}</article>`;
  }
  function eventInactive(event) {
    return ['completed','cancelled'].includes(event.status) || event.start.slice(0,10) < today();
  }
  function homeCalendarDays(value) {
    const first = new Date(value + "-01T12:00:00Z");
    const offset = (first.getUTCDay()+6)%7;
    return Array.from({length:42},(_,i)=>{
      const date = new Date(first); date.setUTCDate(1-offset+i);
      return date.toISOString().slice(0,10);
    });
  }
  function renderHomeCalendar() {
    const current = today(), groups = new Map();
    for(const event of active("event").sort((a,b)=>a.start.localeCompare(b.start))) {
      const key = event.start.slice(0,10);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(event);
    }
    const title = new Intl.DateTimeFormat("es-ES",{timeZone:"Europe/Madrid",month:"long",year:"numeric"}).format(new Date(homeMonth+"-01T12:00:00Z"));
    const cells = homeCalendarDays(homeMonth).map(day=>{
      const events = groups.get(day) || [];
      const label = niceDate(day) + (events.length ? ` · ${events.length} ${events.length === 1 ? 'evento' : 'eventos'}` : ' · Sin eventos');
      const marks = events.slice(0,3).map(e=>`<i class="home-calendar-dot ${e.eventType === 'rehearsal' ? 'rehearsal' : 'show'}${eventInactive(e) ? ' inactive' : ''}${e.status === 'cancelled' ? ' cancelled' : ''}" aria-hidden="true"></i>`).join("");
      return `<button type="button" class="home-calendar-day${day.slice(0,7) !== homeMonth ? ' outside' : ''}${events.length ? ' has-events' : ''}${day === current ? ' today' : ''}" data-action="home-calendar-day" data-id="${day}" aria-label="${esc(label)}" aria-pressed="${day === homeDay}"><time datetime="${day}"${day === current ? ' aria-current="date"' : ''}>${Number(day.slice(8))}</time><span class="home-calendar-marks" aria-hidden="true">${marks}${events.length > 3 ? `<small>+${events.length-3}</small>` : ''}</span></button>`;
    }).join("");
    const selected = homeDay ? groups.get(homeDay) || [] : [];
    return `<aside class="panel home-calendar" aria-label="Calendario de bolos y ensayos"><div class="home-calendar-head"><p class="eyebrow">EN EL CALENDARIO</p><a class="tiny" href="#events">Ampliar ↗</a></div><h3>${esc(title)}</h3><div class="home-calendar-controls">${btn('home-month-prev','Mes anterior','','small')}${btn('home-month-today','Hoy','','small')}${btn('home-month-next','Mes siguiente','','small')}</div><div class="home-calendar-week" aria-hidden="true">${['L','M','X','J','V','S','D'].map(x=>`<span>${x}</span>`).join('')}</div><div class="home-calendar-grid">${cells}</div><div class="home-calendar-legend"><span><i class="home-calendar-dot show" aria-hidden="true"></i>Bolo</span><span><i class="home-calendar-dot rehearsal" aria-hidden="true"></i>Ensayo</span></div><div class="home-calendar-agenda" aria-live="polite">${homeDay ? `<p class="tiny">${esc(niceDate(homeDay))}</p>${selected.length ? selected.map(e=>`<a href="#event/${esc(e.id)}" class="home-calendar-entry${eventInactive(e) ? ' is-completed' : ''}${e.status === 'cancelled' ? ' cancelled' : ''}"><i class="home-calendar-dot ${e.eventType === 'rehearsal' ? 'rehearsal' : 'show'}" aria-hidden="true"></i><span><strong>${esc(e.title)}</strong><small>${esc(hour(e.start))} · ${e.eventType === 'rehearsal' ? 'Ensayo' : 'Bolo'} · ${esc(EVENT_STATUS[e.status])}</small></span></a>`).join('') : '<p class="muted tiny">No hay bolos ni ensayos este día.</p>'}` : '<p class="muted tiny">Toca un día para ver sus bolos y ensayos.</p>'}</div></aside>`;
  }
  function updateHomeCalendarFocus(action, id="") {
    renderPage();
    main.querySelector(`[data-action="${action}"][data-id="${id}"]`)?.focus({preventScroll:true});
  }
  function renderHome() {
    const upcoming = active("event").filter(x => x.start.slice(0,10) >= today() && !["cancelled","completed"].includes(x.status)).sort((a,b)=>a.start.localeCompare(b.start));
    const tasks = active("ticket"), mine = tasks.filter(x => x.status !== "done" && x.assignees.includes(state.user.username));
    const blocked = tasks.filter(x=>x.status === "blocked"), late = tasks.filter(x=>x.status !== "done" && x.due && x.due < today());
    return pageHead("TU EQUIPO. TU ESCENARIO.", `Hola, ${state.user.name.split(" ")[0]}.`, "Aquí se prepara todo lo que luego parece magia.",btn("new-event","＋ Crear bolo","","primary")) +
      `<section class="hero"><div><p class="eyebrow">DEL LABORATORIO AL ESCENARIO</p><h2>Escribir es un juego.<br>Prepararlo, un trabajo en equipo.</h2><p>Bolos, ideas, elenco y tareas en un mismo backstage. Sin perder lo que importa entre mensajes.</p></div><div class="hero-orbit" aria-hidden="true">✳</div></section>
      <section class="grid cols4 section">${[[upcoming.length,"Bolos por venir","El siguiente acto", "gold"],[mine.length,"Mis tareas abiertas","Asignadas a ti", "violet"],[blocked.length,"Tareas bloqueadas","Lo que necesita ayuda", "coral"],[late.length,"Fuera de plazo","Para poner al día", "cyan"]].map(([n,l,d,c])=>`<div class="panel kpi"><small>${l}</small><span class="number ${c}">${n}</span><p class="tiny">${d}</p></div>`).join("")}</section>
      <section class="section home-schedule"><div class="home-upcoming"><div class="panel-head"><h2>Próximos bolos</h2></div><div class="grid cols3">${upcoming.slice(0,3).map(eventCard).join("") || empty("El siguiente escenario está por venir","Crea un bolo: su tablero aparecerá con todas las tareas de preparación.",btn("new-event","＋ Primer bolo","","primary"))}</div></div>${renderHomeCalendar()}</section>
      <section class="grid cols2 section"><div class="panel"><div class="panel-head"><h2>Tu siguiente paso</h2>${badge(mine.length + " pendientes","violet")}</div>${mine.slice(0,5).map(x=>`<div class="activity-row"><span class="activity-dot">✦</span><div><button class="ticket-title" data-action="edit-ticket" data-id="${x.id}">${esc(x.title)}</button><small>${esc(titleOf(item(x.boardId)))} · ${STATUS[x.status]}</small></div></div>`).join("") || `<p class="muted">No tienes tareas asignadas pendientes. Abre un tablero y elige tu próximo reto.</p>`}</div><div class="panel"><div class="panel-head"><h2>El pulso del equipo</h2>${badge("ACTIVIDAD","cyan")}</div>${state.activity.slice(0,5).map(activityRow).join("")}</div></section>`;
  }
  function activityRow(log) {
    const target = item(log.target);
    return `<div class="activity-row"><span class="activity-dot">•</span><div>${esc(member(log.actor))} · ${esc(log.action)}<small>${esc(titleOf(target))} · ${esc(dateTime(log.created))}</small></div></div>`;
  }
  function agendaEvents() {
    const current=today();
    const upcoming=e=>!['completed','cancelled'].includes(e.status)&&e.start.slice(0,10)>=current;
    return active('event').sort((a,b)=>{
      const first=upcoming(a),second=upcoming(b);
      if(first!==second)return first?-1:1;
      return (first?a.start.localeCompare(b.start):b.start.localeCompare(a.start))||a.id.localeCompare(b.id);
    });
  }
  function renderEvents() {
    return pageHead("LA GIRA, BIEN ATADA", "Bolos y calendario", "Funciones y ensayos del elenco, juntos en el calendario. Los ensayos se pueden confirmar desde Disponibilidad. Horarios de Madrid.",btn("new-event","＋ Crear bolo","","primary")) +
      `<div class="toolbar"><div class="segmented" aria-label="Vista de los bolos"><button type="button" data-action="events-calendar" class="${calendarMode === "calendar"?"active":""}">Calendario</button><button type="button" data-action="events-agenda" class="${calendarMode === "agenda"?"active":""}">Agenda</button></div><a class="button small" href="${BASE}api/calendar.ics">↓ Exportar calendario</a></div>` +
      (calendarMode === "agenda" ? `<div class="grid cols3">${agendaEvents().map(eventCard).join("") || empty("Todavía no hay bolos","Crea tu primera función y prepara el equipo.")}</div>` : renderCalendar());
  }
  function renderCalendar() {
    const year = month.getFullYear(), m = month.getMonth(), first = new Date(year,m,1), start = new Date(year,m,1 - (first.getDay()+6)%7);
    const events = active("event");
    const cells = Array.from({length:42},(_,i)=>{
      const date = new Date(start); date.setDate(date.getDate()+i);
      const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
      return `<div class="calendar-day ${date.getMonth() !== m ? "outside" : ""} ${day === today()?"today":""}"><button type="button" class="icon-button day-number" data-action="new-event-day" data-id="${day}" aria-label="Crear bolo el ${esc(niceDate(day))}">${date.getDate()}</button>${events.filter(x=>x.start.slice(0,10) === day).sort((a,b)=>a.start.localeCompare(b.start)).map(x=>`<button type="button" class="calendar-event ${x.status}${eventInactive(x) ? ' is-completed' : ''}" data-action="open-event" data-id="${x.id}">${esc(x.title)}<small>${hour(x.start)} · ${esc(x.venue || "Lugar pendiente")}</small></button>`).join("")}</div>`;
    });
    return `<div class="calendar"><div class="calendar-controls"><h2>${esc(new Intl.DateTimeFormat("es-ES",{month:"long",year:"numeric"}).format(month))}</h2><div class="actions"><label class="calendar-jump">Ir a mes <input type="month" id="calendar-month" value="${year}-${String(m+1).padStart(2,"0")}" aria-label="Elegir mes y año del calendario"></label>${btn("month-prev","←","","small")}${btn("month-today","Hoy","","small")}${btn("month-next","→","","small")}</div></div><div class="calendar-week">${["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"].map(x=>`<span>${x}</span>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div></div>`;
  }
  function renderBoards() {
    return pageHead("TODO EL EQUIPO, EN MARCHA", "Tareas", "Tableros para organizar ideas, desarrollo, ensayos y producción. Los tableros de cada bolo están en su ficha.",btn("new-board","＋ Nuevo tablero","","primary")+`<a class="button" href="#archive">↺ Archivo recuperable</a>`) +
      `<div class="grid cols3">${active("board").filter(x=>!x.eventId).map(x=>{const p=progress(x.id), title=boardTitle(x.title);return `<article class="panel board-card ${esc(x.color)}"><a class="board-card-link" href="#board/${esc(x.id)}" aria-label="Abrir tablero ${esc(title)}"><h2 class="board-title">${esc(title)}</h2><p class="muted">${esc(x.description)}</p><div class="summary">${p.done} de ${p.total} tareas · ${p.percent}% completado</div>${progressHtml(p)}<span class="board-enter" aria-hidden="true">Entrar al tablero ↗</span></a>${btn("edit-board","Editar tablero " + title,x.id,"board-edit")}</article>`;}).join("") || empty("Tu primer tablero","Crea un tablero y organiza las tareas del equipo.")}</div>`;
  }
  function renderBoard(id) {
    const board = item(id);
    if (!board || board.archived) return empty("Este tablero no está disponible","Puedes buscarlo en el archivo recuperable.",`<a class="button" href="#archive">Ir al archivo</a>`);
    const p = progress(id), tasks = tasksFor(id), labels = [...new Set(tasks.flatMap(x=>x.labels))].sort();
    return pageHead(board.eventId ? "PREPARACIÓN DEL BOLO" : "TABLERO DE TAREAS",boardTitle(board.title),`${p.done}/${p.total} tareas completadas · ${p.percent}% listo${board.description ? " · " + board.description : ""}`,
      (board.eventId ? `<a class="button" href="#event/${board.eventId}">Ficha del bolo</a>` : btn("edit-board","Editar tablero",id)) + btn("new-ticket","＋ Añadir tarea",id,"primary")) +
      `<div class="toolbar"><input type="search" id="board-search" aria-label="Buscar tareas" placeholder="Buscar título, descripción o etiqueta…" value="${esc(filters.search)}"><select id="board-mine" aria-label="Filtrar responsables">${option("","Todo el equipo",filters.mine)}${option("mine","Mis tareas",filters.mine)}${option("unassigned","Sin responsable",filters.mine)}</select><select id="board-label" aria-label="Filtrar etiquetas">${option("","Todas las etiquetas",filters.label)}${labels.map(x=>option(x,x,filters.label)).join("")}</select><select id="board-due" aria-label="Filtrar vencimiento">${option("","Todos los plazos",filters.due)}${option("late","Fuera de plazo",filters.due)}${option("urgent","Alta / urgente",filters.due)}</select></div>
      <div class="kanban" aria-label="Tablero de tareas: arrastra desde el asa o utiliza las flechas para mover entre columnas">${Object.entries(STATUS).map(([s,l])=>`<section class="column" data-status="${s}" aria-label="${l}"><div class="column-head"><span><i class="status-dot" aria-hidden="true"></i>${l}<span class="count">${tasks.filter(x=>x.status === s).length}</span></span><button type="button" class="icon-button" data-action="new-ticket-status" data-id="${id}" data-status="${s}" aria-label="Añadir tarea a ${l}">＋</button></div><div class="ticket-list">${tasks.filter(x=>x.status === s).sort((a,b)=>(a.position-b.position)||a.created.localeCompare(b.created)).map(ticketCard).join("")}</div><button type="button" class="add-ticket" data-action="new-ticket-status" data-id="${id}" data-status="${s}">＋ Añadir tarea</button></section>`).join("")}</div>`;
  }
  function ticketCard(ticket) {
    const checks = ticket.checklist?.length || 0;
    const statuses=Object.keys(STATUS),index=statuses.indexOf(ticket.status);
    const arrow=(target,direction)=>target?`<button type="button" class="ticket-move" data-action="ticket-move-${direction}" data-id="${esc(ticket.id)}" aria-label="Mover ${esc(ticket.title)} a ${STATUS[target]}" title="Mover a ${STATUS[target]}">${direction==='prev'?'←':'→'}</button>`:'';
    return `<article class="ticket ${ticket.priority === "urgent"?"urgent":""}" data-status="${esc(ticket.status)}" data-ticket="${esc(ticket.id)}" draggable="true">
      <div class="ticket-top"><button type="button" class="drag-handle" aria-label="Arrastrar ${esc(ticket.title)}" title="Arrastrar tarea">⠿</button><button type="button" class="ticket-title" data-action="edit-ticket" data-id="${esc(ticket.id)}">${esc(ticket.title)}</button>${btn("delete-ticket","Eliminar tarea " + ticket.title,ticket.id,"ticket-delete danger")}</div>
      <div class="ticket-tags">${ticket.labels.map(x=>badge(x,labelColor(x))).join("")}${["high","urgent"].includes(ticket.priority)?badge(PRIORITY[ticket.priority],"coral"):""}</div>
      ${ticket.status === "blocked" && ticket.blockedReason?`<p class="muted">⚑ ${esc(ticket.blockedReason.slice(0,120))}</p>`:""}${dependencyInfo(ticket)}
      <div class="ticket-assignees">${ticket.assignees.map(x=>`<span class="ticket-assignee"><span aria-hidden="true">${esc(initials(member(x)))}</span>${esc(member(x))}</span>`).join("")||'<span class="muted tiny">Sin responsable</span>'}</div>
      <div class="ticket-footer"><span class="due ${ticket.due && ticket.due < today() && ticket.status !== "done" ? "overdue" : ""}">${ticket.due?"◷ " + esc(niceDate(ticket.due,false)):""}${checks ? ` · ☑ ${ticket.checklist.filter(x=>x.done).length}/${checks}` : ""}</span><span class="ticket-moves">${arrow(statuses[index-1],'prev')}${arrow(statuses[index+1],'next')}</span></div></article>`;
  }
  function dependencyInfo(task) {
    const dependencies=(task.blockedBy || []).map(id=>item(id)), pending=dependencies.filter(t=>!t || t.status!=='done');
    const downstream=active('ticket').filter(t=>t.status!=='done' && (t.blockedBy || []).includes(task.id));
    const link=(t,label)=>t?`<a class="dependency-link" href="#board/${esc(t.boardId)}">${label} ${esc(t.title)}<small>${esc(boardTitle(item(t.boardId)?.title || 'Tablero archivado'))}${t.archived?' · archivada':''}</small></a>`:`<span class="dependency-link">⚠ Tarea eliminada: retira esta dependencia en la ficha</span>`;
    return `<div class="ticket-dependencies">${dependencies.map(t=>link(t,t?.status==='done'?'✓':'🔒')).join('')}${dependencies.length&&!pending.length&&task.status==='blocked'?'<span class="badge green">✓ Dependencias resueltas · puedes reanudar</span>':''}${downstream.map(t=>link(t,task.status==='done'?'✓ Permite reanudar:':'↗ Desbloquea:')).join('')}</div>`;
  }
  function dependencyEditor(t) {
    const ids=t.blockedBy || [], tasks=state.items.filter(x=>x.kind==='ticket' && x.id!==t.id && ((!x.archived && !item(x.boardId)?.archived) || ids.includes(x.id)));
    const groups=[...new Set(tasks.map(x=>x.boardId))];
    return `<details class="dependency-editor" ${ids.length?'open':''}><summary>🔗 Depende de otras tareas ${ids.length?'('+ids.length+')':''}</summary><p class="tiny">Puede ser de cualquier tablero. Mientras haya dependencias pendientes, esta tarea estará bloqueada. Al resolverse podrás reanudarla.</p><div class="dependency-options">${groups.map(id=>`<fieldset><legend>${esc(boardTitle(item(id)?.title || 'Tablero archivado'))}</legend>${tasks.filter(x=>x.boardId===id).map(x=>`<label class="check-option"><input type="checkbox" name="blockedBy" value="${esc(x.id)}" ${ids.includes(x.id)?'checked':''}><span>${esc(x.title)}<small>${STATUS[x.status]}${x.archived?' · archivada':''}</small></span></label>`).join('')}</fieldset>`).join('')}${ids.filter(id=>!item(id)).map(id=>`<label class="check-option"><input type="checkbox" name="blockedBy" value="${esc(id)}" checked>⚠ Tarea eliminada · desmarca para retirar el bloqueo</label>`).join('')}</div></details>`;
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
    const casts = ['blue','red','general'].map(team=>{
      const rows=event.cast.filter(c=>(TEAM_ROLES.has(c.role)?c.team:'general')===team);
      if(team==='general'&&!rows.length)return '';
      return `<div class="cast-group ${team}"><h3>${team==='blue'?'🔵 Equipo azul':team==='red'?'🔴 Equipo rojo':'✦ Equipo del espectáculo'}</h3><div class="team-row">${rows.map(c=>{const p=item(c.personId);return `<button type="button" class="cast-chip ${team} ${colors.className(p)}" data-action="edit-person" data-id="${esc(c.personId)}"><span class="cast-person-name"><span class="avatar" aria-hidden="true">${esc(initials(p?.name))}</span>${personLabel(c.personId,' '+(p?.name||'Ficha no disponible'))}</span><small>${esc(c.role)}</small></button>`;}).join('')||'<p class="muted">Elenco pendiente de asignar.</p>'}</div></div>`;
    }).join('');
    return `<div class="event-roadmap">` + pageHead("HOJA DE RUTA",event.title,`${niceDate(event.start)} · ${hour(event.start)} · ${EVENT_STATUS[event.status]}`,
      btn("edit-event",event.eventType === "rehearsal"?"Editar ensayo":"Editar bolo",event.id) + btn("show-calendar","▦ Ver en calendario",event.start.slice(0,10)) + btn("compose-event","◌ Comunicación al elenco",event.id) + btn("event-pdf","↓ Hoja de llamada PDF",event.id) + (event.historical ? "" : `<a class="button primary" href="#board/${event.boardId}">Abrir tareas ↗</a>`) + (event.eventType === "rehearsal" ? `<a class="button" href="#poll/${esc(event.sourcePollId)}">Ver disponibilidades</a>` : btn("new-poll-event","◷ Buscar fecha de ensayo",event.id))) +
      `<div class="event-sheet"><section class="event-info"><div class="info-tile"><small>⌖ Espacio</small><strong>${esc(event.venue || "Pendiente")}</strong><p class="muted">${esc(event.city)}</p></div><div class="info-tile"><small>◷ Función · Europe/Madrid</small><strong>${hour(event.start)}${event.end?" — " + hour(event.end):""}</strong><p class="muted">${esc(niceDate(event.start))}</p></div><div class="info-tile"><small>☀ Convocatoria del elenco</small><strong>${esc(dateTime(event.arrival))}</strong></div></section>
      ${event.eventType === "rehearsal" ? `<section class="panel event-prep-section"><p class="eyebrow">◷ ENSAYO DEL ELENCO</p><h2>Una fecha elegida entre todos</h2><p class="muted section">Añadido desde la encuesta de disponibilidad. Puedes editar el horario o cancelar el ensayo desde esta ficha. No se han creado tareas de producción.</p>${event.parentEventId?`<a class="button section" href="#event/${esc(event.parentEventId)}">Ver bolo asociado ↗</a>`:""}</section>` : event.historical ? `<section class="panel event-prep-section"><p class="eyebrow">MEMORIA DEL SHOW</p><h2>✦ Bolo realizado</h2><p class="muted section">El elenco y sus participaciones quedan registrados aquí. Sin tareas de preparación pendientes.</p></section>` : `<section class="panel event-prep-section"><div class="panel-head"><h2>Preparación</h2>${badge(p.percent + "% listo",p.percent === 100?"green":"gold")}</div><div class="summary muted">${p.done} de ${p.total} tareas completadas · ${blocks.length} bloqueadas</div>${progressHtml(p,"progress-gold")}${blocks.length?`<div class="section"><h3>Necesita ayuda</h3>${blocks.map(x=>`<div class="activity-row"><button type="button" class="ticket-title" data-action="edit-ticket" data-id="${x.id}">⚑ ${esc(x.title)}</button></div>`).join("")}</div>`:""}</section>`}
      <section class="panel event-cast-section"><div class="panel-head"><h2>🎭 Elenco y equipo</h2>${badge(event.cast.length + " participaciones","violet")}</div><div class="cast-groups">${casts}</div>${event.eventType==='rehearsal'||event.historical?'':castReadiness(event.cast)}${event.cast.length?'':`<p class="muted section">Añade el elenco desde Editar bolo. Las fichas se reutilizan en todas las funciones.</p>`}</section>
      ${inventory.eventPanel(event)}
      ${event.eventType === 'rehearsal' ? '' : `<section class="panel event-game-section"><div class="panel-head"><h2>🎮 Configuración del videojuego</h2>${btn('edit-event','Editar parámetros',event.id,'small')}</div>${window.ScribWorldGameConfig.summary(event,state.gameConfigSchema)}</section>`}
      ${event.eventType === 'rehearsal' ? '' : business.eventPanel(event)}
      <section class="panel event-notes-section"><h2>📌 Todo lo que hay que saber</h2><div class="section notes">${esc(event.description || "Sin notas de producción todavía.")}</div>${event.address?`<p class="section notes">⌖ ${esc(event.address)}</p>`:""}${event.ticketUrl?`<a class="button section" href="${esc(event.ticketUrl)}" target="_blank" rel="noopener noreferrer">Entradas / información ↗</a>`:""}<p class="print-only section">&lt;SCRI&gt; B · ${niceDate(today())} · Horario Europe/Madrid</p></section></div></div>`;
  }
  function renderPeople() {
    return pageHead("LAS PERSONAS QUE LO HACEN POSIBLE", "Elenco", "Una ficha por persona. Reutiliza sus datos y asigna un papel diferente en cada función.",btn("new-person","＋ Nueva persona","","primary")) +
      `<div class="toolbar"><input type="search" id="people-search" aria-label="Buscar en el elenco" placeholder="Buscar nombre o especialidad…"></div><div class="grid cols3">${active("person").sort((a,b)=>a.name.localeCompare(b.name,"es")).map(p=>`<article class="panel person-card ${colors.className(p)}" data-person="${esc(p.id)}"><a class="person-card-link" href="#person/${esc(p.id)}" aria-label="Ver ficha de ${esc(p.name)}">${personPhoto(p)}<div class="person-body"><h3>${personLabel(p.id)}</h3>${badge(`${p.participationCount || 0} ${(p.participationCount || 0) === 1 ? "bolo realizado" : "bolos realizados"}`,"gold")}${profile.roleTags(p.roles)}<p class="bio">${esc(p.bio)}</p><span class="person-enter">Ver ficha ↗</span></div></a>${profile.contacts(p,true)}</article>`).join("") || empty("Todo empieza por el equipo","Añade a las personas del elenco; podrás elegirlas al crear cada bolo.",btn("new-person","＋ Añadir persona","","primary"))}</div>`;
  }
  function personPhoto(p) {
    return p.image?`<img class="person-photo" src="${BASE}images/${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`:`<div class="person-placeholder" aria-hidden="true">${esc(initials(p.name))}</div>`;
  }
  function renderPerson(id) {
    const p=item(id);
    if(!p || p.kind!=='person' || p.archived)return empty('Ficha no disponible','Puedes volver al elenco.', '<a class="button" href="#people">← Elenco</a>');
    return pageHead('ELENCO · FICHA PERSONAL',p.name,'',`<a class="button" href="#people">← Elenco</a>${btn('edit-person','Editar ficha',p.id)}`)+
      `<article class="panel person-detail ${colors.className(p)}"><div class="person-detail-head">${personPhoto(p)}<div><h2>${personLabel(p.id)}</h2>${profile.roleTags(p.roles)}${badge(`${p.participationCount || 0} ${(p.participationCount || 0)===1?'bolo realizado':'bolos realizados'}`,'gold')}</div></div><div class="section">${profile.contacts(p)}</div>${p.bio?`<section class="section"><h2>Sobre ${esc(p.name.split(' ')[0])}</h2><p class="notes section">${esc(p.bio)}</p></section>`:''}<section class="section"><h2>Bolos y participaciones</h2>${personHistory(p)}</section>${business.personLink(p.id)}</article>`;
  }
  function renderTemplates() {
    return pageHead("NO VOLVER A EMPEZAR DE CERO","Plantillas de tareas","Al crear un bolo, se copian sus tareas en TO DO. Editar una plantilla no modifica funciones ya creadas.",btn("new-template","＋ Nueva plantilla","","primary")) +
      `<div class="grid cols3">${active("template").map(t=>`<article class="panel template-card"><p class="eyebrow">${t.id === "default-template" ? "TU LISTA ORIGINAL" : "LISTA PERSONALIZADA"}</p><h2>${esc(t.title)}</h2><p class="muted">${t.tasks.length} tareas · ${[...new Set(t.tasks.flatMap(x=>x.labels))].map(x=>esc(x)).join(" / ")}</p><div class="actions">${btn("edit-template","Ver / editar tareas",t.id)}${btn("duplicate-template","Duplicar",t.id,"small")}</div></article>`).join("")}</div>`;
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
    return pageHead("COORDINAR SIN PERDER EL TOQUE PERSONAL","Comunicación","Mensajes de WhatsApp personalizados para tu elenco, por persona o para todo el reparto.",btn("compose-message","＋ Preparar mensaje","","primary")) +
      `<div class="panel service-top"><div>${badge(whatsappStatus?.ready?"CONECTADO":"COMPROBAR CONEXIÓN",whatsappStatus?.ready?"green":"gold")}<p class="muted">${esc(whatsappStatus?.message || "Comprueba la conexión antes de enviar.")}</p></div>${btn("message-history","↻ Actualizar","","small")}</div><div class="notice section">Elige destinatarios, prepara el mensaje y envíalo desde la vista previa. Puedes enviar todos de una vez, sin confirmar cada tarjeta. Los teléfonos y mensajes permanecen en el espacio privado.</div><section class="section grid cols2">${messageHistory.map(d=>`<article class="panel"><p class="eyebrow">${d.expired?"VISTA PREVIA CADUCADA":"VISTA PREVIA"} · ${esc(dateTime(d.created))}</p><h3>${d.people.length} destinatarios${d.eventId?" · " + esc(titleOf(item(d.eventId))):""}</h3><p class="muted">${d.people.filter(p=>p.delivery.status === "sent").length} mensajes enviados</p>${btn("message-draft","Ver mensajes",d.id)}</article>`).join("") || empty("El siguiente mensaje empieza aquí","Prepararlo no envía nada. Puedes elegir un bolo o escribir a personas concretas.")}</section>`;
  }
  function messageRecipients(eventId, personId="") {
    const event=eventId?item(eventId):null;
    const people=active("person").filter(p=>!event || event.cast.some(c=>c.personId === p.id)).sort((a,b)=>a.name.localeCompare(b.name,"es"));
    const target=dialog.querySelector('#message-recipients');
    target.innerHTML=people.map(p=>`<label class="recipient-option"><input type="checkbox" name="people" value="${p.id}" ${!p.phone?"disabled":""} ${p.id===personId&&p.phone?"checked":""}><span><strong>${personLabel(p.id)}</strong><small>${p.phone?esc(profile.displayPhone(p.phone)):"Sin teléfono"}</small></span>${btn("edit-person","Ficha",p.id,"small")}</label>`).join("") || `<p class="muted">Este bolo no tiene elenco. Añádelo en su ficha primero.</p>`;
  }
  function openMessage(eventId="",personId="") {
    openDialog("message","Un mensaje para cada persona",`<form id="message-form"><div class="notice">Preparar la vista previa no envía nada. Después puedes enviar a una persona o a todos.</div>${field("Contexto del mensaje",select("eventId",{"":"Sin bolo · mensaje libre",...Object.fromEntries(active("event").map(e=>[e.id,niceDate(e.start,false)+" · "+e.title]))},eventId,'id="message-event"'))}<fieldset class="recipient-list"><legend>Destinatarios</legend><div id="message-recipients"></div></fieldset>${field("Mensaje personalizado",area("text",eventId?"Hola {nombre},\n\nTe escribimos por {bolo}, el {fecha} a las {hora} en {lugar}. Tu papel: {papel}.\n\n¡Nos vemos en el escenario!":"Hola {nombre},\n\n",'required maxlength="4000" rows="8"'),"Variables: {nombre}, {nombre_completo}, {bolo}, {fecha}, {hora}, {lugar}, {convocatoria}, {papel}.")}<p class="form-error" role="alert"></p><div class="form-footer"><span>Hasta 50 destinatarios. Mensajes individuales, nunca al grupo.</span><button class="button primary" type="submit">Ver vista previa →</button></div></form>`);
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
    messageHistory=[draft,...messageHistory.filter(d=>d.id!==draft.id)];
    openDialog("message","Mensajes personalizados",`<div class="notice">La vista previa caduca a los 15 minutos. Puedes enviar un mensaje o todos los pendientes. Cada envío se registra para evitar duplicados; un envío de resultado incierto no se repite automáticamente.</div><div class="message-preview-list">${draft.people.map((p,i)=>{
      const status=p.delivery?.status || "pending",available=status==="pending" && !draft.expired && !state.demo;
      return `<article class="panel message-preview"><div class="service-top"><div><h3>${personLabel(p.id,p.name)}</h3><small>${esc(p.phone)}</small></div>${badge(deliveryLabel(status),status==="sent"?"green":"gold")}</div><div class="message-bubble">${esc(p.text)}</div>${available?`<button type="button" class="button primary" data-action="send-message" data-id="${draft.id}" data-recipient="${i}">Enviar a ${esc(p.name.split(' ')[0])}</button>`:`<p class="hint">${state.demo?"Ensayo local: envío real bloqueado.":draft.expired&&status==="pending"?"Genera una nueva vista previa para enviar.":status==="unknown"||status==="sending"?"No repitas el envío sin comprobarlo antes en WhatsApp.":"Este mensaje ya no se enviará de nuevo."}</p>`}</article>`;
    }).join("")}</div><div class="actions section">${!state.demo&&!draft.expired&&draft.people.some(p=>!p.delivery||p.delivery.status==='pending')?btn('send-messages','Enviar todos los pendientes',draft.id,'primary'):''}${btn("close-dialog","Cerrar")}</div>`);
  }
  async function sendMessage(node) {
    if(saving)return;
    const label=node.innerHTML;saving=true;node.disabled=true;node.textContent='Enviando…';
    try {
      const result=await request("whatsapp/send",{draftId:node.dataset.id,recipient:Number(node.dataset.recipient),confirmed:true});
      await loadMessages();const draft=messageHistory.find(d=>d.id===node.dataset.id);if(draft)showMessagePreview(draft);
      toast(result.item.status === "sent"?"WhatsApp ha confirmado el envío.":"Envío no confirmado. Revísalo en WhatsApp antes de volver a enviar.");
    }catch(error){toast(error.message);}finally{saving=false;node.disabled=false;node.innerHTML=label;}
  }
  async function sendMessages(node) {
    if(saving||state.demo)return;
    const draft=messageHistory.find(d=>d.id===node.dataset.id);
    if(!draft||draft.expired)throw new Error('Actualiza la vista previa antes de enviar.');
    const pending=draft.people.map((p,i)=>({p,i})).filter(({p})=>!p.delivery||p.delivery.status==='pending');
    saving=true;const label=node.innerHTML;node.disabled=true;let sent=0;
    try {
      for(const {i} of pending){node.textContent=`Enviando ${sent+1}/${pending.length}…`;
        const result=await request('whatsapp/send',{draftId:draft.id,recipient:i});
        if(result.item.status!=='sent')throw new Error('Envío sin confirmar. Se ha detenido el lote: revisa WhatsApp antes de repetir.');
        sent++;
      }
      toast(`${sent} mensajes enviados.`);
    } catch(e){toast(e.message);}
    finally{saving=false;node.disabled=false;node.innerHTML=label;await loadMessages().catch(()=>{});const current=messageHistory.find(d=>d.id===draft.id);if(current)showMessagePreview(current);}
  }
  function renderArchive() {
    const archived = state.items.filter(x=>x.archived && !(x.kind === "board" && x.eventId) && !(x.kind === "ticket" && item(x.boardId)?.archived)).sort((a,b)=>b.updated.localeCompare(a.updated));
    return pageHead("NADA SE PIERDE POR ACCIDENTE", "Archivo recuperable", "Archivar un bolo también archiva su tablero y tareas. Recuperarlo los devuelve juntos.",state.user.role === "admin"?`<a class="button" href="${BASE}api/export.zip">↓ Copia completa ZIP</a>`:"") +
      `<section class="panel">${archived.map(x=>`<div class="archived-row"><div><strong>${x.kind==='person'?personLabel(x.id):esc(titleOf(x))}</strong><small>${KIND[x.kind]} · ${dateTime(x.updated)}</small></div><div class="actions">${btn("restore","Recuperar",x.id,"small")}${x.kind === "ticket" ? btn("delete-ticket","Eliminar tarea " + x.title,x.id,"danger") : ""}</div></div>`).join("") || empty("El archivo está vacío","Las fichas archivadas aparecerán aquí y se podrán recuperar.")}</section>`;
  }

  function openDialog(kind, title, html) {
    dialog.classList.remove('person-colored');
    for(const c of [...dialog.classList])if(c.startsWith('person-tone-'))dialog.classList.remove(c);
    document.querySelector("#dialog-title").textContent = title;
    document.querySelector("#dialog-kicker").textContent = KIND[kind]?.toUpperCase() || "BACKSTAGE";
    document.querySelector("#dialog-content").innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }
  function formShell(kind, object, body, extra = "") {
    return `<form id="edit-form" data-kind="${kind}" data-id="${esc(object.id || "")}" data-version="${object.version || 0}" data-request="${crypto.randomUUID()}">${body}<p class="form-error" role="alert"></p><div class="form-footer"><div class="actions">${kind!=='person' && object.id && object.id !== "default-template"?btn("archive", "Archivar",object.id,"small"):""}${kind === "ticket" && object.id ? btn("delete-ticket","Eliminar tarea",object.id,"danger") : ""}</div><div class="actions">${btn("close-dialog","Cancelar")}<button type="submit" class="button primary">Guardar ${KIND[kind].toLowerCase()}</button></div></div></form>${extra}`;
  }
  function openBoard(id) {
    const b = id ? item(id) : {title:"", description:"", color:"violet"};
    openDialog("board", id ? "Editar tablero" : "Nuevo tablero",formShell("board",b,
      field("Nombre del tablero",input("title",id ? boardTitle(b.title) : "","text",'required maxlength="240"')) + field("Para qué lo vamos a usar",area("description",b.description,'maxlength="15000"')) + field("Color",select("color",{violet:"Violeta",cyan:"Turquesa",coral:"Coral",gold:"Dorado"},b.color))));
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
      input("status",t.status,"hidden") + `<div class="form-row"><div class="field"><span>Columna</span>${badge(STATUS[t.status])}<small class="hint">Mueve la tarjeta en el tablero para cambiarla de columna.</small></div>${field("Prioridad",select("priority",PRIORITY,t.priority))}</div>` +
      `<div class="form-row">${field("Fecha límite",input("due",t.due,"date"))}${field("Etiquetas",input("labels",t.labels.join(", "),"text",'maxlength="800"'),"Separadas por comas")}</div>` +
      field("Si está bloqueada, ¿qué necesita?",area("blockedReason",t.blockedReason,'maxlength="2000"')) +
      dependencyInfo(t) + dependencyEditor(t) +
      `<div><p class="field">Responsables</p><div class="assignee-options">${state.members.map(m=>`<label class="check-option"><input type="checkbox" name="assignees" value="${esc(m.username)}" ${t.assignees.includes(m.username)?"checked":""}>${esc(m.name)}</label>`).join("")}</div></div>` +
      `<div><div class="panel-head"><h3>Checklist</h3>${btn("add-check","＋ Paso","","small")}</div><div class="checklist-editor">${t.checklist.map(checkRow).join("")}</div></div>`);
    openDialog("ticket",id ? "Dentro de la tarea" : "Nueva tarea",`<div class="editor-grid"><div>${form}</div><aside class="discussion"><h3>Conversación del equipo</h3><div id="comments">${id?commentsHtml(details.comments):`<p class="muted">Guarda la tarea para añadir comentarios.</p>`}</div>${id?`<form class="comment-form" data-id="${id}" data-request="${crypto.randomUUID()}">${field("Tu comentario",area("comment","",'required maxlength="10000" placeholder="Añade contexto, una decisión o un bloqueo…"'))}<p class="form-error" role="alert"></p><button type="submit" class="button">Enviar comentario</button></form><details><summary>Historial de la tarea</summary>${details.activity.map(activityRow).join("")}</details>`:""}</aside></div>`);
  }
  function commentsHtml(comments) {return comments.map(c=>`<div class="comment"><small><strong>${esc(member(c.author))}</strong> · ${dateTime(c.created)}</small>${esc(c.body)}</div>`).join("") || `<p class="muted">Aquí empieza la conversación.</p>`;}
  function castRow(c = {}) {
    const choices=state.items.filter(p=>p.kind === "person" && (!p.archived || p.id === c.personId));
    const teamRole=TEAM_ROLES.has(c.role),team=teamRole?c.team||'blue':'general';
    return `<div class="cast-editor-row${teamRole?'':' no-team'}"><select class="cast-person" aria-label="Persona del elenco">${option("","Selecciona persona",c.personId)}${choices.map(p=>option(p.id,p.name+(p.archived?" (archivado)":""),c.personId)).join("")}</select><select class="cast-role" aria-label="Papel en el bolo">${option("","Selecciona rol",c.role)}${profile.roleOptions(c.role)}</select><select class="cast-team" aria-label="Equipo" ${teamRole?'':'hidden disabled'}>${teamRole?option('blue','Azul',team)+option('red','Rojo',team):option('general','',team)}</select><button type="button" class="icon-button cast-remove" data-action="remove-row" aria-label="Quitar persona del bolo">×</button></div>`;
  }
  function castReadiness(cast) {
    return `<div class="cast-readiness"><h3>Reparto obligatorio</h3><div class="label-group">${REQUIRED_CAST.map(([role,team])=>{const ready=cast.some(c=>c.role===role&&(team==='general'||c.team===team));return badge((ready?'✓ ':'○ ')+role+(team==='general'?'':team==='blue'?' · azul':' · rojo'),ready?'green':'gold');}).join('')}</div></div>`;
  }
  function updateCastReadiness() {
    const pane=dialog.querySelector('#cast-readiness');if(!pane)return;
    const cast=[...dialog.querySelectorAll('.cast-editor-row')].filter(n=>n.querySelector('.cast-person').value).map(n=>({role:n.querySelector('.cast-role').value,team:n.querySelector('.cast-team').value}));
    pane.innerHTML=castReadiness(cast);
  }
  function openEvent(id, day) {
    const e = id ? item(id) : {title:"",start:day || today(),end:"",arrival:"",status:"pending",venue:"",city:"",address:"",description:"",ticketUrl:"",cast:[]};
    openDialog("event",id ? "Editar bolo" : "Un nuevo escenario",formShell("event",e,
      field("Nombre del bolo",input("title",e.title,"text",'required maxlength="240" placeholder="SCRIB · sala / festival"')) +
      `<div class="form-row">${field("Fecha del bolo",input("start",e.start.slice(0,10),"date", "required"))}${field("Hora · horario Madrid",input("startTime",e.start.length > 10 ? e.start.slice(11,16) : "","time"),"Déjala vacía si todavía está pendiente.")}</div>` +
      field("Fin (opcional; requiere hora de inicio)",input("end",localInput(e.end),"datetime-local")) +
      field("Convocatoria del elenco",input("arrival",localInput(e.arrival),"datetime-local"))+input('status',e.status,'hidden') +
      `<div class="form-row">${field("Espacio / sala",input("venue",e.venue,"text",'maxlength="200"'))}${field("Ciudad",input("city",e.city,"text",'maxlength="120"'))}</div>` + field("Dirección / instrucciones de llegada",input("address",e.address,"text",'maxlength="1000"')) +
      field("Entradas / información",input("ticketUrl",e.ticketUrl,"url",'placeholder="https://…" maxlength="2000"')) + field("Notas de producción",area("description",e.description,'maxlength="15000" placeholder="Acceso, necesidades de sala, contactos profesionales, ensayo…"')) +
      window.ScribWorldGameConfig.editor(e,state.gameConfigSchema) +
      (id ? '' : field("Plantilla de tareas iniciales",select("templateId",Object.fromEntries(active("template").map(t=>[t.id,`${t.title} · ${t.tasks.length} tareas`])),"default-template"),"Se copiarán automáticamente en TO DO al guardar.")) +
      `<div><div class="panel-head"><h3>Elenco de esta función</h3>${btn("add-cast","＋ Persona","","small")}</div><div id="cast-readiness">${castReadiness(e.cast)}</div><p class="hint">Puedes guardar un borrador y completar después los puestos que faltan.</p><div class="cast-editor">${e.cast.map(castRow).join("")}</div></div>`));
  }
  function openPerson(id) {
    const p = id ? item(id) : {name:"",roles:[],bio:"",instagram:"",website:"",otherSocial:"",image:""};
    if(p.archived){openDialog("person",p.name,`<div class="notice">Esta ficha está archivada. Se conserva en el reparto de sus funciones.</div><p class="notes">${esc(p.bio)}</p><div class="actions section">${btn("restore","Recuperar ficha",p.id,"primary")}${btn("close-dialog","Cerrar")}</div>` );colors.decorate(dialog,p);return;}
    openDialog("person",id ? p.name : "Una persona del equipo",formShell("person",p,
      `<div class="person-summary">${profile.roleTags(p.roles)}${profile.contacts(p)}</div>` +
      field("Nombre completo",input("name",p.name,"text",'required maxlength="160"')) + profile.roleEditor(p.roles) +
      input('color',p.color||'auto','hidden') +
      field("Teléfono",input("phone",p.phone || "","tel",'maxlength="40" placeholder="+34…" autocomplete="tel"')) +
      personHistory(p) +
      business.personLink(p.id) +
      field("Biografía / notas profesionales",area("bio",p.bio,'maxlength="5000"')) +
      field("Instagram",input("instagram",p.instagram,"text",'placeholder="@tu_usuario o https://instagram.com/…" maxlength="2000"')) + input('website',p.website||'','hidden') + input('otherSocial',p.otherSocial||'','hidden') +
      input("image",p.image,"hidden") + `<div class="upload-preview">${p.image?`<img src="${BASE}images/${p.image}" alt="Foto actual">`:""}${field("Foto de la ficha",'<input type="file" name="photo" accept="image/png,image/jpeg,image/webp">',"PNG, JPG o WebP, hasta 4 MB. Solo visible dentro del mundo autenticado.")}</div>`));
    colors.decorate(dialog,p);
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
      data.blockedBy = [...form.querySelectorAll('[name=blockedBy]:checked')].map(x=>x.value);
      data.checklist = [...form.querySelectorAll(".checklist-row")].map(row=>({text:row.querySelector(".check-text").value,done:row.querySelector(".check-done").checked}));
    } else if (form.dataset.kind === "person") {
      data.roles = [...form.querySelectorAll('[name=roles]:checked')].map(x=>x.value);
    } else if (form.dataset.kind === "inventory") {
      data.quantity = data.quantity === '' ? null : Number(data.quantity);
      data.imageReference = item(form.dataset.id)?.imageReference || false;
    } else if (form.dataset.kind === "event") {
      const gameConfig = window.ScribWorldGameConfig.read(form);
      if(gameConfig !== undefined)data.gameConfig = gameConfig;
      delete data.gameConfigEnabled;
      if(data.startTime)data.start += "T" + data.startTime;
      delete data.startTime;
      data.cast = [...form.querySelectorAll(".cast-editor-row")].map(row=>({personId:row.querySelector(".cast-person").value,role:row.querySelector(".cast-role").value,team:TEAM_ROLES.has(row.querySelector('.cast-role').value)?row.querySelector(".cast-team").value:'general'})).filter(c=>c.personId);
      if(data.cast.some(c=>!c.role))throw new Error('Elige el rol de cada persona del elenco.');
    } else if (form.dataset.kind === "template") {
      data.tasks = [...form.querySelectorAll(".template-row")].map(row=>({title:row.querySelector(".template-title").value,labels:splitValues(row.querySelector(".template-labels").value),description:row.querySelector(".template-description").value}));
    }
    if(['person','inventory'].includes(form.dataset.kind)){
      const file=data.photo;delete data.photo;
      if(file?.size){
        if(file.size>4*1024*1024)throw new Error('La imagen debe pesar menos de 4 MB.');
        const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo leer la foto.'));reader.readAsDataURL(file);});
        const result=await request('upload',{base64:encoded});data.image=result.item.image;
        form.querySelector('[name=image]').value=data.image;
        form.querySelector('[name=photo]').value='';
      }
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
  function askDelete(id) {
    const ticket = item(id);
    if (saving || !ticket || ticket.kind !== "ticket" || deleteDialog.open) return;
    pendingDelete = {id, version:ticket.version, requestId:crypto.randomUUID(), confirmed:true};
    document.querySelector("#delete-ticket-name").textContent = ticket.title;
    document.querySelector("#delete-error").textContent = "";
    deleteDialog.showModal();
  }
  async function confirmDelete() {
    if (saving || !pendingDelete || !deleteDialog.open) return;
    const operation = pendingDelete;
    saving = true;
    const buttons = [...deleteDialog.querySelectorAll("button")];
    buttons.forEach(b => {b.disabled = true;});
    try {
      const result = await request("delete-ticket", operation);
      if (result.item?.id !== operation.id || result.item?.deleted !== true) throw new Error("No se ha podido confirmar la eliminación. Comprueba el tablero antes de reintentar.");
      state.items = state.items.filter(x => x.id !== operation.id);
      deleteDialog.close();
      if (dialog.querySelector("#edit-form")?.dataset.id === operation.id) dialog.close();
      renderPage();
      toast("Tarea eliminada definitivamente, junto con sus comentarios.");
      try {await refresh(false); renderPage();}
      catch (_) {toast("Tarea eliminada. No se pudo actualizar el resto del tablero; recarga cuando vuelva la conexión.");}
    } catch (error) {
      document.querySelector("#delete-error").textContent = error.message;
    } finally {saving = false; buttons.forEach(b => {b.disabled = false;});}
  }
  deleteDialog.addEventListener("cancel", event => {if (saving) event.preventDefault();});
  deleteDialog.addEventListener("close", () => {pendingDelete = null;});
  async function action(node) {
    const {action:a,id,status} = node.dataset;
    if(await lighting.action(node))return;
    if(await business.action(node))return;
    if(await polls.action(node))return;
    if(await inventory.action(node))return;
    if(await library.action(node))return;
    if(await documents.action(node))return;
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
    else if(a === "message-history") {if(node.disabled)return;const label=node.innerHTML;node.disabled=true;node.textContent='Actualizando…';node.setAttribute('aria-busy','true');try{await loadMessages();renderPage();}finally{node.disabled=false;node.innerHTML=label;node.removeAttribute('aria-busy');}}
    else if(a === "message-draft") {await loadMessages();const draft=messageHistory.find(x=>x.id===id);if(draft)showMessagePreview(draft);}
    else if(a === "send-message")await sendMessage(node);
    else if(a === "send-messages")await sendMessages(node);
    else if(a === "event-pdf")await window.ScribExport(state,{kind:'event',id},node);
    else if(a === "new-template")openTemplate();
    else if(a === "edit-template")openTemplate(id);
    else if(a === "duplicate-template")openTemplate(id,true);
    else if(a === "close-dialog") {if(!saving)dialog.close();}
    else if(a === "add-check")dialog.querySelector(".checklist-editor").insertAdjacentHTML("beforeend",checkRow());
    else if(a === "add-cast")dialog.querySelector(".cast-editor").insertAdjacentHTML("beforeend",castRow());
    else if(a === "add-template-task")dialog.querySelector(".template-editor").insertAdjacentHTML("beforeend",templateRow());
    else if(a === "remove-row"){node.parentElement.remove();updateCastReadiness();}
    else if(a === "archive")await archive(id);
    else if(a === "restore")await archive(id,true);
    else if(a === "delete-ticket")askDelete(id);
    else if(a === "ticket-move-prev" || a === "ticket-move-next") {
      const task=item(id),statuses=Object.keys(STATUS),target=statuses[statuses.indexOf(task?.status)+(a.endsWith('prev')?-1:1)];
      if(task&&target) {
        await moveTicket(id,target);
        main.querySelector(`[data-ticket="${CSS.escape(id)}"] .ticket-title`)?.focus({preventScroll:true});
      }
    }
    else if(a === "confirm-delete")await confirmDelete();
    else if(a === "cancel-delete") {if(!saving)deleteDialog.close();}
    else if(a === "print")window.print();
    else if(a === "events-calendar" || a === "events-agenda") {calendarMode=a === "events-calendar"?"calendar":"agenda";renderPage();}
    else if(a === "month-next" || a === "month-prev") {month=new Date(month.getFullYear(),month.getMonth()+(a === "month-next"?1:-1),1);renderPage();}
    else if(a === "month-today") {month=new Date();renderPage();}
    else if(a === "home-month-next" || a === "home-month-prev") {
      const next = new Date(homeMonth+"-01T12:00:00Z");
      next.setUTCMonth(next.getUTCMonth()+(a === "home-month-next" ? 1 : -1));
      homeMonth=next.toISOString().slice(0,7);homeDay="";updateHomeCalendarFocus(a);
    }
    else if(a === "home-month-today") {homeDay=today();homeMonth=homeDay.slice(0,7);updateHomeCalendarFocus(a);}
    else if(a === "home-calendar-day" && homeCalendarDays(homeMonth).includes(id)) {
      homeDay=id;updateHomeCalendarFocus(a,id);
    }
  }
  document.addEventListener("click",event=>{const node=event.target.closest("[data-action]");if(node)action(node).catch(error=>toast(error.message));});
  document.addEventListener("submit",event=>{if(event.target.matches("#document-check-form")){event.preventDefault();documents.submit(event.target);}else if(event.target.matches("#inventory-export-form")){event.preventDefault();inventory.exportForm(event.target);}else if(event.target.matches("#edit-form,.comment-form")){event.preventDefault();saveForm(event.target);}else if(event.target.matches("#message-form")){event.preventDefault();previewMessage(event.target);}});
  document.addEventListener("change",event=>{
    const node=event.target;
    if(node.matches('.cast-role')){const row=node.closest('.cast-editor-row'),team=row.querySelector('.cast-team'),hasTeam=TEAM_ROLES.has(node.value);row.classList.toggle('no-team',!hasTeam);team.hidden=team.disabled=!hasTeam;team.innerHTML=hasTeam?option('blue','Azul',team.value)+option('red','Rojo',team.value):option('general','','general');updateCastReadiness();return;}
    if(node.matches('.cast-person,.cast-team')){updateCastReadiness();return;}
    if(node.id==='lighting-scope'){lighting.changeScope(node).catch(error=>toast(error.message));return;}
    if(lighting.input(node)){if(['x','y'].includes(node.dataset.lightingField)){const value=Number(node.value);if(Number.isFinite(value) && node.value!=='')node.value=String(Math.max(Number(node.min),Math.min(Number(node.max),value)));}return;}
    if(inventory.filter(node))return;
    if(node.matches("#calendar-month") && /^\d{4}-\d{2}$/.test(node.value)){month=new Date(Number(node.value.slice(0,4)),Number(node.value.slice(5,7))-1,1);renderPage();return;}
    if(node.id === "board-mine")filters.mine=node.value;
    if(node.id === "board-label")filters.label=node.value;
    if(node.id === "board-due")filters.due=node.value;
    if(node.id.startsWith("board-"))applyFilters();
    if(node.id === "message-event")messageRecipients(node.value);
  });
  document.addEventListener("input",event=>{
    if(lighting.input(event.target))return;
    if(event.target.id==='inventory-search'){inventory.filter(event.target);return;}
    if(event.target.id === "board-search"){filters.search=event.target.value;applyFilters();}
    if(event.target.id === "people-search")main.querySelectorAll("[data-person]").forEach(node=>{const p=item(node.dataset.person);node.hidden=![p.name,...p.roles].join(" ").toLowerCase().includes(event.target.value.toLowerCase());});
  });
  dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
  document.addEventListener('pointerdown',event=>lighting.pointerDown(event));
  document.addEventListener('pointermove',event=>lighting.pointerMove(event));
  document.addEventListener('pointerup',event=>lighting.pointerUp(event));
  document.addEventListener('pointercancel',event=>lighting.pointerUp(event));
  document.addEventListener('lostpointercapture',event=>lighting.pointerUp(event));
  document.addEventListener('keydown',event=>lighting.keydown(event));
  document.addEventListener('focusout',event=>lighting.focusout(event));
  window.addEventListener('beforeunload',event=>{if(lighting.hasDraft()){event.preventDefault();event.returnValue='';}});
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
    if(event.target.closest("select,input,[data-action]")){event.preventDefault();return;}
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
    if(state?.demo){health={server:null};updateHealthUI();return;}
    const probe = async url => {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
      try {const r=await fetch(url,{cache:"no-store",signal:controller.signal});return r.ok && !r.redirected ? await r.json() : null;}
      finally {clearTimeout(timer);}
    };
    const data=await probe("/api/scrib-health").catch(()=>null);
    health.server=data ? Boolean(data.ok ?? data.online ?? data.connected ?? data.status === "online") : false;
    updateHealthUI();
  }
  function updateHealthUI() {
    for(const [id,value,label] of [["server-health",health.server,"Servidor"]]){
      const node=document.getElementById(id);if(!node)continue;
      node.className="server-health " + (value===null?"is-checking":value?"is-online":"is-offline");
      node.textContent=state?.demo ? label + " · no consultado" : value===null ? "Comprobando " + label.toLowerCase() : value ? "● " + label + " activo" : "○ " + label + " no disponible";
    }
  }
  async function boot() {
    try {await refresh(false);renderPage();checkHealth().catch(()=>{});if(route()[0]==="messages")loadMessages().then(()=>{if(!dialog.open)renderPage();}).catch(error=>toast(error.message));}
    catch(error){main.innerHTML=empty("No se pudo abrir el backstage",error.message,`<a class="button" href="/scrib/">Volver a iniciar sesión</a>`);document.querySelector("#connection").textContent="○ Sin conexión";}
  }
  setInterval(async()=>{
    if(!state || document.hidden || saving || dragId || deleteDialog.open || (route()[0]==='lighting' && lighting.hasDraft()))return;
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
