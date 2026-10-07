module.exports = {
  apps: [{
    name: "SCRIB_WORLD",
    script: "/home/trescejas/dockers/scrib-world/server.py",
    interpreter: "/usr/bin/python3",
    cwd: "/home/trescejas/dockers/scrib-world",
    args: "--port 5124 --data /home/trescejas/dockers/scrib-world-data --users /home/trescejas/dockers/dashboard-auth/users.json",
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 10,
    time: true
  }]
};
