module.exports = {
  apps: [
    {
      name: "pm-wa-bot-utara",
      cwd: "/root/pm-wa-bot/hitachi/pm-wa-bot-starter-v2/pm-wa-bot-utara",
      script: "src/index.js",
      interpreter: "node",
      autorestart: true,
      restart_delay: 3000,
      time: true
    },
    {
      name: "pm-wa-bot-pesisir",
      cwd: "/root/pm-wa-bot/hitachi/pm-wa-bot-starter-v2/pm-wa-bot-pesisir",
      script: "src/index.js",
      interpreter: "node",
      autorestart: true,
      restart_delay: 3000,
      time: true
    }
  ]
};
