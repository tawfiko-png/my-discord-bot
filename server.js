require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('--- STARTING SERVER INITIALIZATION ---');

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// Storage
const serverLogs = [];
const serverModules = {};

// Middleware & Static Files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

// API Routes
app.post('/api/login', (req, res) => {
  const user = (req.body.username || '').trim().toUpperCase();
  const pass = (req.body.password || '').trim();

  if (user === 'ADMIN' && pass === 'iscream@@2026') {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

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
  if (!client.user) return res.json([]);
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
  if (!client.user) return res.status(503).json({ error: 'Bot not ready' });
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

// Discord Event Listeners
client.once('ready', () => {
  console.log(`✅ BOT IS ONLINE! Logged in as: ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} servers.`);
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

// Authentication and Gateway Login
const token = (process.env.DISCORD_TOKEN || '').trim();

if (!token) {
  console.error('❌ CRITICAL ERROR: DISCORD_TOKEN is missing or empty!');
} else {
  console.log('--- TESTING DISCORD REST API ACCESS ---');
  const rest = new REST({ version: '10' }).setToken(token);

  rest.get(Routes.user('@me'))
    .then(user => {
      console.log(`✅ REST API SUCCESS! Authenticated as: ${user.username}#${user.discriminator || '0'}`);
      console.log('Connecting to Discord WebSocket Gateway...');
      return client.login(token);
    })
    .catch(err => {
      console.error('❌ DISCORD API / LOGIN ERROR:');
      console.error(err.message || err);
    });
}

// Single Express Listener
app.listen(PORT, () => {
  console.log(`🚀 Dashboard listening on port ${PORT}`);
});
