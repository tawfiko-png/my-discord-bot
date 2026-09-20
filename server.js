require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  getVoiceConnection 
} = require('@discordjs/voice');
const play = require('play-dl');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('--- STARTING SERVER INITIALIZATION ---');

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

// Storage
const serverLogs = [];
const serverModules = {};
const musicQueues = new Map(); // Store music queue for each guild

// Express Middleware & Static Files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

// REST API Routes
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

// Helper Function: Play Next Song in Queue
async function playNextSong(guildId, messageChannel) {
  const serverQueue = musicQueues.get(guildId);
  if (!serverQueue) return;

  if (serverQueue.songs.length === 0) {
    if (serverQueue.connection) serverQueue.connection.destroy();
    musicQueues.delete(guildId);
    return messageChannel.send('🎶 Queue finished. Left the voice channel.');
  }

  const currentSong = serverQueue.songs[0];

  try {
    const stream = await play.stream(currentSong.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });

    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);

    messageChannel.send(`🎶 Now playing: **${currentSong.title}**`);
  } catch (error) {
    console.error('Playback error:', error);
    messageChannel.send(`❌ Could not play **${currentSong.title}**. Skipping to next...`);
    serverQueue.songs.shift();
    playNextSong(guildId, messageChannel);
  }
}

// Discord Event Listeners
client.once('ready', () => {
  console.log(`✅ BOT IS ONLINE! Logged in as: ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} servers.`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Log message to dashboard
  serverLogs.push({
    guildId: message.guild.id,
    timestamp: new Date().toLocaleTimeString(),
    text: `[#${message.channel.name}] ${message.author.tag}: ${message.content}`
  });
  if (serverLogs.length > 100) serverLogs.shift();

  // Check if Music Module is Enabled on Dashboard
  if (!serverModules[message.guild.id]) {
    serverModules[message.guild.id] = { moderator: true, music: true, automod: false, utility: true, economy: false, welcome: true };
  }
  const isMusicEnabled = serverModules[message.guild.id].music;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // MUSIC COMMANDS
  if (['!play', '!p', '!skip', '!pause', '!resume', '!queue', '!stop'].includes(command)) {
    if (!isMusicEnabled) {
      return message.reply('❌ The **Music** module is disabled for this server via the Web Dashboard.');
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel && ['!play', '!p', '!skip', '!pause', '!resume', '!stop'].includes(command)) {
      return message.reply('❌ You must join a voice channel first!');
    }

    let serverQueue = musicQueues.get(message.guild.id);

    // Command: !play <search or URL>
    if (command === '!play' || command === '!p') {
      const query = args.join(' ');
      if (!query) return message.reply('❌ Please provide a song name or YouTube link! Usage: `!play song name`');

      try {
        const ytInfo = await play.search(query, { limit: 1 });
        if (!ytInfo || ytInfo.length === 0) {
          return message.reply('❌ No results found on YouTube.');
        }

        const song = { title: ytInfo[0].title, url: ytInfo[0].url };

        if (!serverQueue) {
          const queueConstruct = {
            voiceChannel: voiceChannel,
            textChannel: message.channel,
            connection: null,
            player: createAudioPlayer(),
            songs: [],
            playing: true
          };

          musicQueues.set(message.guild.id, queueConstruct);
          queueConstruct.songs.push(song);

          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
          });

          queueConstruct.connection = connection;

          // Event when player becomes idle -> play next
          queueConstruct.player.on(AudioPlayerStatus.Idle, () => {
            queueConstruct.songs.shift();
            playNextSong(message.guild.id, message.channel);
          });

          playNextSong(message.guild.id, message.channel);
        } else {
          serverQueue.songs.push(song);
          return message.reply(`✅ Added **${song.title}** to the queue! (Position #${serverQueue.songs.length})`);
        }
      } catch (err) {
        console.error('Play error:', err);
        return message.reply('❌ Failed to process music command.');
      }
    }

    // Command: !skip
    else if (command === '!skip') {
      if (!serverQueue || serverQueue.songs.length === 0) {
        return message.reply('❌ There are no songs to skip.');
      }
      message.reply('⏭️ Skipped current song.');
      serverQueue.player.stop(); // Triggers AudioPlayerStatus.Idle to play next
    }

    // Command: !pause
    else if (command === '!pause') {
      if (!serverQueue) return message.reply('❌ Nothing is playing.');
      serverQueue.player.pause();
      message.reply('⏸️ Paused the music.');
    }

    // Command: !resume
    else if (command === '!resume') {
      if (!serverQueue) return message.reply('❌ Nothing is paused.');
      serverQueue.player.unpause();
      message.reply('▶️ Resumed the music.');
    }

    // Command: !queue
    else if (command === '!queue') {
      if (!serverQueue || serverQueue.songs.length === 0) {
        return message.reply('🎵 The music queue is currently empty.');
      }
      let queueMessage = `🎶 **Current Queue:**\n`;
      serverQueue.songs.forEach((song, index) => {
        queueMessage += `${index === 0 ? '▶️ **Now Playing:**' : `**${index}.**`} ${song.title}\n`;
      });
      message.reply(queueMessage);
    }

    // Command: !stop
    else if (command === '!stop') {
      if (!serverQueue) return message.reply('❌ The bot is not playing music.');
      serverQueue.songs = [];
      if (serverQueue.connection) serverQueue.connection.destroy();
      musicQueues.delete(message.guild.id);
      message.reply('⏹️ Stopped playback, cleared queue, and left the voice channel.');
    }
  }
});

// Authentication and Gateway Login
const token = (process.env.DISCORD_TOKEN || '').replace(/[\r\n\t ]/g, '');

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

// Express Listener
app.listen(PORT, () => {
  console.log(`🚀 Dashboard listening on port ${PORT}`);
});
