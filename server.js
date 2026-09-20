require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Store dashboard configurations
let botConfig = {
  status: 'online',
  activityType: 'PLAYING',
  activityText: 'Controlling via Web Dashboard',
  autoModEnabled: true,
  welcomeMessageEnabled: true,
};

// Discord Bot Events
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  updatePresence();
});

function updatePresence() {
  if (!client.user) return;
  const activityTypes = {
    PLAYING: ActivityType.Playing,
    STREAMING: ActivityType.Streaming,
    LISTENING: ActivityType.Listening,
    WATCHING: ActivityType.Watching,
    COMPETING: ActivityType.Competing,
  };

  client.user.setPresence({
    status: botConfig.status,
    activities: [
      {
        name: botConfig.activityText,
        type: activityTypes[botConfig.activityType] || ActivityType.Playing,
      },
    ],
  });
}

// REST API Endpoints for Web Dashboard

// Get bot status & stats
app.get('/api/stats', (req, res) => {
  const totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const totalGuilds = client.guilds.cache.size;

  res.json({
    online: client.isReady(),
    username: client.user ? client.user.tag : 'Offline',
    avatar: client.user ? client.user.displayAvatarURL() : '',
    guildsCount: totalGuilds,
    membersCount: totalMembers,
    ping: client.ws.ping,
    config: botConfig,
  });
});

// Update Presence (Status & Activity)
app.post('/api/presence', (req, res) => {
  const { status, activityType, activityText } = req.body;
  if (status) botConfig.status = status;
  if (activityType) botConfig.activityType = activityType;
  if (activityText !== undefined) botConfig.activityText = activityText;

  updatePresence();
  res.json({ success: true, config: botConfig });
});

// Send Announcement Embed to a specific channel
app.post('/api/announce', async (req, res) => {
  const { channelId, title, description, color } = req.body;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ error: 'Invalid text channel ID' });
    }

    const embed = new EmbedBuilder()
      .setTitle(title || 'Announcement')
      .setDescription(description || '')
      .setColor(color || '#5865F2')
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    res.json({ success: true, message: 'Announcement sent successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Express API Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 API Server listening on http://localhost:${PORT}`);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);