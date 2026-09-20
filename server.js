require('dotenv').config();
const express = require('express');
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

// In-Memory Storage
const serverLogs = [];
const serverModules = {}; 

// Middleware & Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// Direct Login Endpoint (Case-Insensitive & Whitespace Trimmed)
app.post('/api/login', (req, res) => {
  const user = (req.body.username || '').trim().toUpperCase();
  const pass = (req.body.password || '').trim();

  if (user === 'ADMIN' && pass === 'iscream@@2026') {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Direct Data Endpoints (No Session Lockouts)
app.get('/api/bot-info', (req, res) => {
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

app.get('/api/servers', (req, res) => {
  const guilds = client.guilds.cache.map(guild => ({
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL() || 'https://cdn.discordapp.com/embed/avatars/0.png',
    memberCount: guild.memberCount,
    ownerId: guild.ownerId
  }));
  res.json(guilds);
});

app.get('/api/server/:id', (req, res) => {
  const guild = client.guilds.cache.get(req.params.id);
  if (!guild) return res.status(404).json({ error: 'Server not found' });

  if (!serverModules[guild.id]) {
    serverModules[guild.id] = {
      moderator: true, music: true, automod: false, utility: true, economy: false, welcome: true
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

app.post('/api/server/:id/module', (req, res) => {
  const { moduleName, enabled } = req.body;
  const guildId = req.params.id;

  if (!serverModules[guildId]) {
    serverModules[guildId] = { moderator: true, music: true, automod: false, utility: true, economy: false, welcome: true };
  }

  serverModules[guildId][moduleName] = enabled;
  serverLogs.push({
    guildId,
    timestamp: new Date().toLocaleTimeString(),
    text: `Module [${moduleName.toUpperCase()}] updated to ${enabled ? 'ENABLED' : 'DISABLED'}`
  });

  res.json({ success: true, modules: serverModules[guildId] });
});

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot || !message.guild) return;
  serverLogs.push({
    guildId: message.guild.id,
    timestamp: new Date().toLocaleTimeString(),
    text: `[${message.channel.name}] ${message.author.tag}: ${message.content}`
  });
  if (serverLogs.length > 100) serverLogs.shift();
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`Dashboard listening on port ${PORT}`);
});
