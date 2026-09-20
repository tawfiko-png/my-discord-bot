require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// In-Memory Storage for Logs & Server Module Settings
const serverLogs = [];
const serverModules = {}; 

app.use(express.json());
app.use(cors());
app.use(session({
  secret: 'iscream_secret_key_2026',
  resave: false,
  saveUninitialized: true
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// API: Login Endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'ADMIN' && password === 'iscream@@2026') {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Middleware to protect routes
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// API: Get Real Bot & Global Stats
app.get('/api/bot-info', requireAuth, (req, res) => {
  if (!client.user) return res.status(503).json({ error: 'Bot not ready' });

  const totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  
  res.json({
    name: client.user.username,
    avatar: client.user.displayAvatarURL(),
    tag: client.user.tag,
    ping: Math.round(client.ws.ping),
    guildsCount: client.guilds.cache.size,
    totalMembers: totalMembers
  });
});

// API: Get Real Servers (Guilds) List
app.get('/api/servers', requireAuth, (req, res) => {
  const guilds = client.guilds.cache.map(guild => ({
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png',
    memberCount: guild.memberCount,
    ownerId: guild.ownerId
  }));
  res.json(guilds);
});

// API: Get Specific Server Details
app.get('/api/server/:id', requireAuth, async (req, res) => {
  const guild = client.guilds.cache.get(req.params.id);
  if (!guild) return res.status(404).json({ error: 'Server not found' });

  // Initialize modules for server if not present
  if (!serverModules[guild.id]) {
    serverModules[guild.id] = {
      moderator: true,
      music: true,
      automod: false,
      utility: true,
      economy: false,
      welcome: true
    };
  }

  res.json({
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png',
    memberCount: guild.memberCount,
    channelsCount: guild.channels.cache.size,
    rolesCount: guild.roles.cache.size,
    modules: serverModules[guild.id],
    logs: serverLogs.filter(log => log.guildId === guild.id)
  });
});

// API: Update Server Module Toggle
app.post('/api/server/:id/module', requireAuth, (req, res) => {
  const { moduleName, enabled } = req.body;
  const guildId = req.params.id;

  if (!serverModules[guildId]) {
    serverModules[guildId] = { moderator: true, music: true, automod: false, utility: true, economy: false, welcome: true };
  }

  serverModules[guildId][moduleName] = enabled;
  
  // Log event
  serverLogs.push({
    guildId,
    timestamp: new Date().toLocaleTimeString(),
    text: `Module [${moduleName.toUpperCase()}] updated to ${enabled ? 'ENABLED' : 'DISABLED'}`
  });

  res.json({ success: true, modules: serverModules[guildId] });
});

// Discord Bot Ready Event
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// Track Message Logs Real-Time
client.on('messageCreate', (message) => {
  if (message.author.bot || !message.guild) return;
  serverLogs.push({
    guildId: message.guild.id,
    timestamp: new Date().toLocaleTimeString(),
    text: `[${message.channel.name}] ${message.author.tag}: ${message.content}`
  });
  // Keep only the last 100 log entries
  if (serverLogs.length > 100) serverLogs.shift();
});

// Log into Discord
client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`Dashboard Server listening on http://localhost:${PORT}`);
});
