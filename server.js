require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('--- STARTING SERVER INITIALIZATION ---');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const serverLogs = [];
const serverModules = {};
const musicQueues = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

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
    serverModules[guild.id] = { moderator: true, music: true, automod: false, utility: true, economy: false, welcome: true };
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

function cleanTitle(title) {
  return title
    .replace(/[\(\[\{].*?(official\vert{}music\vert{}video\vert{}audio\vert{}lyric\vert{}hd\vert{}4k).*?[\)\]\}]/gi, '')
    .replace(/official music video|official video|official audio|lyric video/gi, '')
    .trim();
}

function extractYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function fetchYouTubeTitleViaOEmbed(videoId) {
  return new Promise((resolve) => {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    https.get(oembedUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.title || null);
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Resilient Stream Fetcher: Tries play-dl first, then falls back to @distube/ytdl-core
async function getAudioStream(song) {
  if (song.source === 'youtube') {
    try {
      const stream = ytdl(song.url, {
        filter: 'audioonly',
        highWaterMark: 1 << 25,
        quality: 'highestaudio'
      });
      return createAudioResource(stream);
    } catch (e) {
      console.log('ytdl-core failed, attempting play-dl fallback...');
      const playStream = await play.stream(song.url);
      return createAudioResource(playStream.stream, { inputType: playStream.type });
    }
  } else {
    // SoundCloud stream
    const playStream = await play.stream(song.url);
    return createAudioResource(playStream.stream, { inputType: playStream.type });
  }
}

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
    const resource = await getAudioStream(currentSong);
    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);

    messageChannel.send(`🎶 Now playing: **${currentSong.title}**`);
  } catch (error) {
    console.error('Playback error:', error);
    messageChannel.send(`❌ Error playing **${currentSong.title}**. Skipping to next...`);
    serverQueue.songs.shift();
    playNextSong(guildId, messageChannel);
  }
}

client.on('clientReady', async () => {
  console.log(`✅ BOT IS ONLINE! Logged in as: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  serverLogs.push({
    guildId: message.guild.id,
    timestamp: new Date().toLocaleTimeString(),
    text: `[#${message.channel.name}] ${message.author.tag}: ${message.content}`
  });
  if (serverLogs.length > 100) serverLogs.shift();

  if (!serverModules[message.guild.id]) {
    serverModules[message.guild.id] = { moderator: true, music: true, automod: false, utility: true, economy: false, welcome: true };
  }
  const isMusicEnabled = serverModules[message.guild.id].music;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (['!play', '!p', '!skip', '!pause', '!resume', '!queue', '!stop'].includes(command)) {
    if (!isMusicEnabled) {
      return message.reply('❌ The **Music** module is disabled for this server via the Web Dashboard.');
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel && ['!play', '!p', '!skip', '!pause', '!resume', '!stop'].includes(command)) {
      return message.reply('❌ You must join a voice channel first!');
    }

    let serverQueue = musicQueues.get(message.guild.id);

    if (command === '!play' || command === '!p') {
      let rawQuery = args.join(' ');
      if (!rawQuery) return message.reply('❌ Please provide a song name or link! Usage: `!play song name`');

      try {
        let songInfo = null;

        // 1. Direct YouTube Video Check
        const videoId = extractYouTubeVideoId(rawQuery);
        if (videoId) {
          const ytTitle = await fetchYouTubeTitleViaOEmbed(videoId);
          songInfo = {
            title: ytTitle || 'YouTube Track',
            url: `https://www.youtube.com/watch?v=${videoId}`,
            source: 'youtube'
          };
        }

        // 2. Text Search (YouTube Primary via play-dl / ytdl)
        if (!songInfo) {
          try {
            const ytResults = await play.search(rawQuery, { limit: 1 });
            if (ytResults && ytResults.length > 0) {
              songInfo = {
                title: ytResults[0].title,
                url: ytResults[0].url,
                source: 'youtube'
              };
            }
          } catch (e) {
            console.error('YouTube search error:', e.message);
          }
        }

        // 3. SoundCloud Search Fallback
        if (!songInfo) {
          try {
            const scResults = await play.search(rawQuery, { source: { soundcloud: 'tracks' }, limit: 1 });
            if (scResults && scResults.length > 0) {
              songInfo = {
                title: scResults[0].name,
                url: scResults[0].url,
                source: 'soundcloud'
              };
            }
          } catch (e) {
            console.error('SoundCloud search error:', e.message);
          }
        }

        if (!songInfo) {
          return message.reply(`❌ Could not find any audio stream for: **${rawQuery}**`);
        }

        if (!serverQueue) {
          const player = createAudioPlayer({
            behaviors: {
              noSubscriber: NoSubscriberBehavior.Play
            }
          });

          const queueConstruct = {
            voiceChannel: voiceChannel,
            textChannel: message.channel,
            connection: null,
            player: player,
            songs: [],
            playing: true
          };

          musicQueues.set(message.guild.id, queueConstruct);
          queueConstruct.songs.push(songInfo);

          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: true
          });

          queueConstruct.connection = connection;

          queueConstruct.player.on(AudioPlayerStatus.Idle, () => {
            queueConstruct.songs.shift();
            playNextSong(message.guild.id, message.channel);
          });

          queueConstruct.player.on('error', (err) => {
            console.error('Audio Player Error:', err.message);
            queueConstruct.songs.shift();
            playNextSong(message.guild.id, message.channel);
          });

          playNextSong(message.guild.id, message.channel);
        } else {
          serverQueue.songs.push(songInfo);
          return message.reply(`✅ Added **${songInfo.title}** to the queue! (Position #${serverQueue.songs.length})`);
        }
      } catch (err) {
        console.error('Play command error:', err);
        return message.reply('❌ Failed to process music command.');
      }
    }
    else if (command === '!skip') {
      if (!serverQueue || serverQueue.songs.length === 0) return message.reply('❌ No songs to skip.');
      message.reply('⏭️ Skipped current song.');
      serverQueue.player.stop();
    }
    else if (command === '!pause') {
      if (!serverQueue) return message.reply('❌ Nothing is playing.');
      serverQueue.player.pause();
      message.reply('⏸️ Paused music.');
    }
    else if (command === '!resume') {
      if (!serverQueue) return message.reply('❌ Nothing is paused.');
      serverQueue.player.unpause();
      message.reply('▶️ Resumed music.');
    }
    else if (command === '!queue') {
      if (!serverQueue || serverQueue.songs.length === 0) return message.reply('🎵 Queue is empty.');
      let msg = `🎶 **Current Queue:**\n`;
      serverQueue.songs.forEach((s, idx) => {
        msg += `${idx === 0 ? '▶️ **Now Playing:**' : `**${idx}.**`} ${s.title}\n`;
      });
      message.reply(msg);
    }
    else if (command === '!stop') {
      if (!serverQueue) return message.reply('❌ Bot is not playing music.');
      serverQueue.songs = [];
      if (serverQueue.connection) serverQueue.connection.destroy();
      musicQueues.delete(message.guild.id);
      message.reply('⏹️ Stopped and disconnected.');
    }
  }
});

const token = (process.env.DISCORD_TOKEN || '').replace(/[\r\n\t ]/g, '');
if (!token) {
  console.error('❌ DISCORD_TOKEN missing!');
} else {
  const rest = new REST({ version: '10' }).setToken(token);
  rest.get(Routes.user('@me'))
    .then(() => client.login(token))
    .catch(err => console.error(err));
}

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
