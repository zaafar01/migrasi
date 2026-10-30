module.exports = {
  apps: [
    {
      name: "pm-wa-utara",
      cwd: "/opt/pm-wa-bot/utara",
      script: "src/index.js",
      env: { NODE_ENV: "production" },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20
    },
    {
      name: "pm-wa-pesisir",
      cwd: "/opt/pm-wa-bot/pesisir",
      script: "src/index.js",
      env: { NODE_ENV: "production" },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20
    }
  ]
};
