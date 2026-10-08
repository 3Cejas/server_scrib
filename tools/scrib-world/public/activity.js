"use strict";
(() => {
  // The always-on gateway owns power/activity. Local demos never keep production awake.
  if (location.hostname !== "sutura-gateway.ddns.net" || window.__suturaActivityPing) return;
  window.__suturaActivityPing = true;
  const ping = () => {
    if (document.visibilityState !== "visible") return;
    // No query, fragment, private board IDs or polling of the backend is needed.
    const url = "/_activity?visible=1&path=" + encodeURIComponent(location.pathname);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
      fetch(url, {method: "POST", cache: "no-store", keepalive: true}).catch(() => {});
    } catch (_) { /* A temporary network failure must not interrupt editing. */ }
  };
  ping();
  window.setInterval(ping, 45000);
  document.addEventListener("visibilitychange", ping);
})();
