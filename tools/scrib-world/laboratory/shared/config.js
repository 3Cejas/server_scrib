"use strict";
// Keep the existing Bolzano socket protocol, separate from the live show's muses.
const localHost = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
window.isProduction = !localHost.has(window.location.hostname);
window.SERVER_URL_PROD = "https://sutura-gateway.ddns.net";
window.SERVER_URL_DEV = "http://localhost:3000";
