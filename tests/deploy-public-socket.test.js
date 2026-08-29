const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("the gateway exposes SCRIB Socket.IO through its dedicated loopback tunnel", () => {
  const nginx = fs.readFileSync(path.join(root, "deploy/nginx-scrib-socket.conf"), "utf8");
  const service = fs.readFileSync(path.join(root, "deploy/sutura-scrib-tunnel.service"), "utf8");

  assert.match(nginx, /location \^~ \/socket\.io\//);
  assert.match(nginx, /proxy_pass https:\/\/127\.0\.0\.1:13000\/socket\.io\//);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /proxy_set_header Connection \$connection_upgrade/);
  assert.match(nginx, /auth_request \/_wake\/check/);
  assert.doesNotMatch(nginx, /authentik|forward-auth/);

  assert.match(service, /-L 127\.0\.0\.1:13000:127\.0\.0\.1:3000 servidor/);
  assert.match(service, /Restart=always/);
});
