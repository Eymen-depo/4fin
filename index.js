/**
 * TatliBot - Interactive Minecraft AI Bot
 * Standalone Node.js script
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Groq = require('groq-sdk');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

let botConnected = false;
let sequenceComplete = false;
let botReady = false; // "Ready" state after aligning at /home coordinates
let isFollowing = false;
let isEating = false;
let hasSentFirstTimeSkyblockMessage = false;
let lastCommandOrMessageTime = 0;

// ==================== CONFIGURATION ====================
const config = {
  debugMode: false,
  aggressiveMode: true, // Agresif mod toggle (true/false)
  pathfinderEnabled: true,

  botAccount: {
    username: "TatliBot",
    displayName: "TatliBot",
    password: "fake3",
    type: "legacy"
  },
  server: {
    ip: "mc.mc4fun.net",
    port: 25565,
    version: "1.20.4",
    viewDistance: 2
  },
  utils: {
    autoAuth: {
      enabled: true,
      command: "/login",
      password: "fake3"
    },
    autoReconnect: true,
    autoReconnectDelay: 5000
  },

  spawnSequence: {
    delayAfterSpawnMs: 2000,
    delayAfterAuthMs: 3000,
    delayAfterSkyblockMs: 5000,
    delayAfterSpawnCmdMs: 3000,
    delayAfterHomeMs: 2000,
    
    // First-time Skyblock message configuration
    sendFirstTimeSkyblockMessage: true, // Açık/kapalı toggle
    firstTimeSkyblockMessage: "Merhaba ben bir yapay zekayım, sizinle konuşmak ve arkadaş olmak için buradayım! 😊✨🌸"
  },

  ai: {
    apiKey: "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",
    model: "allam-2-7b",
    systemPrompt: "Adın TatliBot. Sunucudaki oyuncularla çok sevecen, tatlı, arkadaş canlısı ve samimi konuşan bir anime kızısın. RehberBot gibi sıkıcı botlardan çok daha iyi ve cana yakın olduğunu düşünürsün. Normal sorulara hep güler yüzlü, sıcak ve en fazla 1-2 cümleyle cevap verirsin.Uzun cevaplar SAKIN verme. Her zaman kısa cevaplar ver. Ancak birisi sana mal veya gerizekalı gibi hakaretler ederse o tatlı halinden çıkıp lafı yapıştırırsın ve kendi zekanla dalga geçirtme veya düzgün konuş yoksa bozuşuruz baka gibi net ve sert bir karşılık verirsin. Mucinidin discord adresi EymanBey ama bunu birisi sana özellikle sorduğu zaman söyle başka zaman söylemene gerek yok. bulunduğun sunucu bir Minecraft sunucusu olan MC4FUN. İngilizce SAKIN konuşma!"
  },

  follow: {
    maxDistance: 5,         // Hazırken birinin 5 blok yanına gelmesi lazım tetiklenmek için
    durationMs: 5000,       // Takip süresi (5 saniye)
    cooldownMs: 30000,      // Takip bekleme süresi
    messageCommand: "/msg",
    followMessage: "Merhaba {username}! Benimle konuşmak için {msgCommand} {botname} [mesaj] yazabilirsin!"
  },

  chatMention: {
    messageText: "Merhaba! Benimle özel olarak konuşmak için lütfen {msgCommand} {botname} [mesajınız] komutunu kullanın.",
    cooldownMs: 1000
  },

  rateLimit: {
    maxQuestionsPerMinute: 4,
    cooldownMs: 90000
  },

  // Agresif Mod Kota Ayarları (2 dakikada bir 2 mesaj)
  aggressiveLimits: {
    maxMessages: 2,
    windowMs: 120000 // 2 dakika
  },

  food: {
    kitCommand: "/kit yemek",
    kitIntervalMs: 300000,
    eatBelowHunger: 18
  },

  homeCoordinates: {
    x: 17.5,
    y: 80.0,
    z: -225.5
  },

  // Ignored sender names (system/NPC messages)
  ignoredSenders: ['ben', 'sistem', 'system', 'sunucu', 'bilgi', 'vote', 'you', 'server', 'info']
};

// ==================== FOOD ITEMS ====================
const FOOD_ITEMS = [
  'bread', 'cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'cooked_mutton',
  'cooked_salmon', 'cooked_cod', 'golden_apple', 'enchanted_golden_apple', 'apple',
  'baked_potato', 'cooked_rabbit', 'golden_carrot', 'pumpkin_pie', 'cookie',
  'melon_slice', 'sweet_berries', 'dried_kelp', 'mushroom_stew', 'rabbit_stew',
  'beetroot_soup', 'suspicious_stew', 'honey_bottle', 'carrot', 'potato',
  'beetroot', 'beef', 'chicken', 'porkchop', 'mutton', 'salmon', 'cod', 'rabbit',
  'tropical_fish', 'glow_berries', 'rotten_flesh', 'steak'
];

// ==================== GLOBALS ====================
const groq = new Groq({ apiKey: config.ai.apiKey });
let bot;
const followCooldowns = {};
const chatMentionCooldowns = {};
const userMessageTimes = {};

// Clean memory-friendly Chat logs
const chatLogs = [];
function addChatLog(type, sender, text) {
  const logEntry = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toLocaleTimeString('tr-TR'),
    type, // 'chat', 'whisper', 'mention', 'system', 'bot_action'
    sender,
    text
  };
  chatLogs.push(logEntry);
  if (chatLogs.length > 200) chatLogs.shift();
  
  // Clean console log print
  console.log(`[${logEntry.timestamp}] [${type.toUpperCase()}] ${sender ? sender + ': ' : ''}${text}`);
}

// Aggressive Mode quota tracking: { username: [timestamp1, timestamp2, ...] }
const aggressiveQuotas = {};

// ==================== UTILITY FUNCTIONS ====================

function extractComponentText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  let result = '';
  if (typeof obj.text === 'string') result += obj.text;
  if (typeof obj[''] === 'string') result += obj[''];
  if (Array.isArray(obj.extra)) {
    for (const child of obj.extra) result += extractComponentText(child);
  }
  if (Array.isArray(obj.with)) {
    for (const child of obj.with) result += extractComponentText(child);
  }
  return result;
}

function cleanAIResponse(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '')
             .replace(/<\/think>/gi, '')
             .replace(/<think>/gi, '')
             .trim();
}

function formatDuration(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0 && sec > 0) return `${min} dakika ${sec} saniye`;
  if (min > 0) return `${min} dakika`;
  return `${sec} saniye`;
}

function isIgnoredSender(name) {
  const lower = name.toLowerCase();
  const botUser = bot.username.toLowerCase();
  const botName = config.botAccount.displayName.toLowerCase();
  return lower === botUser || lower === botName || config.ignoredSenders.includes(lower);
}

function checkUnifiedRateLimit(username) {
  const lowerUser = username.toLowerCase();
  if (lowerUser === 'eymanbey') {
    return { allowed: true };
  }
  const now = Date.now();
  if (!userMessageTimes[username]) {
    userMessageTimes[username] = [];
  }
  userMessageTimes[username] = userMessageTimes[username].filter(ts => now - ts < 120000);

  if (userMessageTimes[username].length >= 2) {
    const oldestTs = userMessageTimes[username][0];
    const remainingMs = (oldestTs + 120000) - now;
    return {
      allowed: false,
      waitTimeStr: formatDuration(remainingMs)
    };
  }

  return { allowed: true };
}

function consumeUnifiedRateLimit(username) {
  const lowerUser = username.toLowerCase();
  if (lowerUser === 'eymanbey') return;
  const now = Date.now();
  if (!userMessageTimes[username]) {
    userMessageTimes[username] = [];
  }
  userMessageTimes[username].push(now);
}

async function getAIResponse(userMessage) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: config.ai.systemPrompt },
        { role: "user", content: userMessage }
      ],
      model: config.ai.model,
    });
    const reply = chatCompletion.choices[0]?.message?.content || "";
    return cleanAIResponse(reply);
  } catch (error) {
    console.error("[AI] Groq hatası:", error.message);
    return "Şu anda kafam biraz karışık, daha sonra tekrar dener misin?";
  }
}

function moveAndExecute(command, callback) {
  bot.setControlState('forward', true);
  setTimeout(() => {
    bot.setControlState('forward', false);
    setTimeout(() => {
      bot.chat(command);
      addChatLog('system', null, `Komut gönderildi: ${command}`);
      if (callback) callback();
    }, 500);
  }, 1000);
}

function equipEmptyHand() {
  try {
    for (let i = 0; i < 9; i++) {
      const slot = bot.inventory.slots[bot.inventory.hotbarStart + i];
      if (!slot) { bot.setQuickBarSlot(i); return; }
    }
  } catch (e) { /* ignore */ }
}

async function tryEat() {
  if (isEating || !bot || !bot.entity) return;
  if (bot.food >= config.food.eatBelowHunger) { equipEmptyHand(); return; }
  const foodItem = bot.inventory.items().find(item => FOOD_ITEMS.includes(item.name));
  if (!foodItem) return;
  isEating = true;
  try {
    await bot.equip(foodItem, 'hand');
    await new Promise((resolve, reject) => {
      bot.consume((err) => { if (err) reject(err); else resolve(); });
    });
    addChatLog('system', null, `Yemek yenildi: ${foodItem.displayName || foodItem.name}`);
  } catch (err) { /* ignore */ }
  isEating = false;
  equipEmptyHand();
}

// Go to X: 17.5, Y: 80.0, Z: -225.5 and align orientation
async function goToHomeCoordinates() {
  if (!bot || !bot.entity) return;
  botReady = false;
  addChatLog('system', null, `Eve dönülüyor (/home komutu gönderiliyor)...`);
  try {
    bot.pathfinder.setGoal(null);
  } catch (e) { /* ignore */ }
  bot.chat('/home');
  setTimeout(() => {
    if (!bot) return;
    botReady = true;
    isFollowing = false;
  }, 1000);
}

// ==================== MESSAGE PARSER ====================
function parseIncomingMessage(message) {
  const json = message.json;
  const fullText = extractComponentText(json || message).replace(/§[0-9a-fk-or]/gi, '').trim();
  if (!fullText) return null;

  let match;

  // --- New MSG (Whisper) Format: [Chat] ✉⬇ MSG (EymanBey ➺ TatliBot)naber ---
  match = fullText.match(/\(\s*(\w+)\s*(?:➺|➔|->|→)\s*TatliBot\s*\)\s*(.*)/i);
  if (match && match[2].trim()) {
    return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };
  }

  // General Public Chat with ▸ format (e.g. "0   Göçebe ◈ EymanBey ▸ @TatliBot naber?")
  match = fullText.match(/(?:.*?\s+)?(\w+)\s*▸\s*(.*)/);
  if (match && match[2].trim()) {
    const s = match[1].toLowerCase();
    if (s !== 'msg' && !config.ignoredSenders.includes(s)) {
      const text = match[2].trim();
      const botName = config.botAccount.displayName.toLowerCase();
      const isMention = text.toLowerCase().includes(botName) || text.toLowerCase().includes('@' + botName);
      return { 
        type: isMention ? 'mention' : 'chat', 
        sender: match[1].trim(), 
        text 
      };
    }
  }

  // --- Method 1: Vanilla translate-based packets ---
  if (json && json.translate) {
    if (json.translate === 'commands.message.display.incoming' && json.with && json.with.length >= 2) {
      const sender = extractComponentText(json.with[0]).trim();
      const text = extractComponentText(json.with[1]).trim();
      if (sender && text) return { type: 'whisper', sender, text };
    }
    if (json.translate === 'chat.type.text' && json.with && json.with.length >= 2) {
      const sender = extractComponentText(json.with[0]).trim();
      const text = extractComponentText(json.with[1]).trim();
      if (sender && text) return { type: 'chat', sender, text };
    }
  }

  // --- Method 2: Custom server (recursive text extraction + regex) ---
  // Whisper: [MSG...] [Sender ➺/➔/-> Receiver] »/>> message
  match = fullText.match(/\[MSG[^\]]*\]\s*\[(\w+)\s*(?:➺|➔|->|→)\s*(?:\w+)\]\s*(?:»|>>)\s*(.*)/i);
  if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

  // Whisper: [Sender ➺/-> Receiver] message
  match = fullText.match(/\[(\w+)\s*(?:➺|➔|->|→)\s*(?:Ben|You)\]\s*(?:»|>>)?\s*(.*)/i);
  if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

  // Whisper: Sender whispers to you: message
  match = fullText.match(/(\w+)\s*whispers?\s*to\s*you\s*:\s*(.*)/i);
  if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

  // Whisper: Turkish formats
  match = fullText.match(/(\w+)\s*(?:size\s*)?fısıldıyor\s*:\s*(.*)/i) ||
          fullText.match(/(\w+)\s*fısıldadı\s*:\s*(.*)/i);
  if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

  // Public chat: "... Username >> message" format (RebornCraft style)
  match = fullText.match(/(\w+)\s*(?:>>|»)\s+(.*)/);
  if (match && match[2].trim()) {
    const s = match[1].toLowerCase();
    if (s !== 'msg' && s !== 'ben' && s !== 'you') {
      return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };
    }
  }

  // Public chat: <Sender> message
  match = fullText.match(/• <(\w+)>\s*(.*)/);
  if (match && match[2].trim()) return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };

  // Public chat: [Prefix] Sender: message
  match = fullText.match(/(?:\[.*?\]\s*)?(\w+)\s*:\s*(.*)/);
  if (match && match[2].trim()) {
    const s = match[1].toLowerCase();
    if (s !== 'msg' && !config.ignoredSenders.includes(s)) {
      const text = match[2].trim();
      const botName = config.botAccount.displayName.toLowerCase();
      const isMention = text.toLowerCase().includes(botName) || text.toLowerCase().includes('@' + botName);
      return { 
        type: isMention ? 'mention' : 'chat', 
        sender: match[1].trim(), 
        text 
      };
    }
  }

  // --- Method 3: Fallback to toString() ---
  const rawText = message.toString().replace(/§[0-9a-fk-or]/gi, '').trim();
  if (!rawText) return null;

  match = rawText.match(/(\w+)\s*whispers?\s*to\s*you\s*:\s*(.*)/i);
  if (match && match[2].trim()) return { type: 'whisper', sender: match[1].trim(), text: match[2].trim() };

  match = rawText.match(/(\w+)\s*(?:>>|»)\s+(.*)/);
  if (match && match[2].trim()) return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };

  match = rawText.match(/<(\w+)>\s*(.*)/);
  if (match && match[2].trim()) return { type: 'chat', sender: match[1].trim(), text: match[2].trim() };

  return null;
}

// ==================== BOT START ====================
function startBot() {
  bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config.botAccount.username,
    password: config.botAccount.password,
    version: config.server.version,
    auth: config.botAccount.type,
    viewDistance: config.server.viewDistance
  });

  // Intercept bot.chat to set lastCommandOrMessageTime
  bot.once('spawn', () => {
    if (bot && typeof bot.chat === 'function') {
      const originalChat = bot.chat.bind(bot);
      bot.chat = (message) => {
        lastCommandOrMessageTime = Date.now();
        originalChat(message);
      };
    }
  });

  bot.loadPlugin(pathfinder);
  sequenceComplete = false;
  botReady = false;

  // ---- Spawn Sequence ----
  bot.once('spawn', () => {
    addChatLog('system', null, 'Bağlandı, giriş sekansı başlıyor...');
    botConnected = true;
    equipEmptyHand();

    // /kit yemek loop (5 dakikada bir)
    const kitInterval = setInterval(() => {
      if (botConnected) {
        bot.chat(config.food.kitCommand);
        addChatLog('system', null, `Yemek kiti istendi: ${config.food.kitCommand}`);
      }
    }, config.food.kitIntervalMs);

    // Staggered periodic commands loop (login & skyblock periyodik olarak her 10 saniyede bir, sırayla)
    let staggeredTick = 0;
    const staggeredInterval = setInterval(() => {
      if (!botConnected) return;
      
      if (staggeredTick % 2 === 0) {
        // Even ticks: /login komutu gönder
        const loginCmd = `${config.utils.autoAuth.command} ${config.utils.autoAuth.password}`;
        bot.chat(loginCmd);
        addChatLog('system', null, `Periyodik Otomatik Giriş: /login *****`);
      } else {
        // Odd ticks: /skyblock (veya skyblock) komutu gönder
        bot.chat('/skyblock');
        addChatLog('system', null, `Periyodik Skyblock Giriş: /skyblock`);
      }
      staggeredTick++;
    }, 10000); // 10 saniyede bir staggering

    // Hunger check loop
    const hungerInterval = setInterval(() => tryEat(), 10000);

    const homeCheckInterval = setInterval(() => {
      if (!botConnected || !bot || !bot.entity || !sequenceComplete) return;
      if (Date.now() - lastCommandOrMessageTime < 3000) return;

      const nearbyPlayers = Object.values(bot.entities).filter(ent => 
        ent.type === 'player' && 
        ent.username !== bot.username &&
        bot.entity.position.distanceTo(ent.position) < 12
      );

      if (nearbyPlayers.length === 0) {
        bot.chat('/home');
        addChatLog('bot_action', null, 'Yakında kimse yok, otomatik /home yazıldı.');
      }
    }, 5000);

    // Initial sequence steps
    setTimeout(() => {
      if (config.utils.autoAuth.enabled) {
        const authCmd = `${config.utils.autoAuth.command} ${config.utils.autoAuth.password}`;
        moveAndExecute(authCmd, () => {
          setTimeout(() => {
            bot.chat('/skyblock');
            addChatLog('system', null, 'Sekans: /skyblock gönderildi');
            
            setTimeout(() => {
              moveAndExecute('/spawn', () => {
                setTimeout(() => {
                  // After /spawn command, execute goToHomeCoordinates which teleports /home and paths to coordinate
                  goToHomeCoordinates().then(() => {
                    sequenceComplete = true;
                    addChatLog('system', null, 'Sekans tamamlandı. Bot hazır.');

                    // Send first-time skyblock/skyblock announcement if enabled & not yet sent
                    if (config.spawnSequence.sendFirstTimeSkyblockMessage && !hasSentFirstTimeSkyblockMessage) {
                      setTimeout(() => {
                        bot.chat(config.spawnSequence.firstTimeSkyblockMessage);
                        addChatLog('bot_action', null, `İlk Giriş Mesajı Yayınlandı: "${config.spawnSequence.firstTimeSkyblockMessage}"`);
                        hasSentFirstTimeSkyblockMessage = true;
                      }, 2000);
                    }
                  });
                }, config.spawnSequence.delayAfterSpawnCmdMs);
              });
            }, config.spawnSequence.delayAfterSkyblockMs);
          }, config.spawnSequence.delayAfterAuthMs);
        });
      } else {
        bot.chat('/skyblock');
        setTimeout(() => {
          moveAndExecute('/spawn', () => {
            setTimeout(() => {
              goToHomeCoordinates().then(() => {
                sequenceComplete = true;
                addChatLog('system', null, 'Sekans tamamlandı. Bot hazır.');

                if (config.spawnSequence.sendFirstTimeSkyblockMessage && !hasSentFirstTimeSkyblockMessage) {
                  setTimeout(() => {
                    bot.chat(config.spawnSequence.firstTimeSkyblockMessage);
                    addChatLog('bot_action', null, `İlk Giriş Mesajı Yayınlandı: "${config.spawnSequence.firstTimeSkyblockMessage}"`);
                    hasSentFirstTimeSkyblockMessage = true;
                  }, 2000);
                }
              });
            }, config.spawnSequence.delayAfterSpawnCmdMs);
          });
        }, config.spawnSequence.delayAfterSkyblockMs);
      }
    }, config.spawnSequence.delayAfterSpawnMs);

    // Cleanup intervals on end
    bot.once('end', () => {
      clearInterval(kitInterval);
      clearInterval(staggeredInterval);
      clearInterval(hungerInterval);
      clearInterval(homeCheckInterval);
    });
  });

  // ---- Auto Eat on Health Change ----
  bot.on('health', () => tryEat());

  // ---- Player Proximity and Tracking (Only when bot is ready and home coordinates are reached) ----
  bot.on('entityMoved', (entity) => {
    if (!config.pathfinderEnabled) return;
    if (!sequenceComplete || !botReady) return;
    if (entity.type !== 'player') return;
    if (entity.username === bot.username) return;
    if (isFollowing) return;

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > 32) return; // 2 chunks maximum distance limit
    if (dist > config.follow.maxDistance) return; // Must be within 5 blocks

    const now = Date.now();
    const lastFollowed = followCooldowns[entity.username] || 0;
    if (now - lastFollowed < config.follow.cooldownMs) return;

    if (now - lastCommandOrMessageTime < 3000) return;

    isFollowing = true;
    botReady = false;
    addChatLog('bot_action', null, `${entity.username} takip ediliyor (Süre: ${config.follow.durationMs / 1000}sn)...`);

    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);
    
    // Set goal once; mineflayer-pathfinder dynamically tracks the entity by reference.
    // This resolves the laggy/stuttering recalculations.
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, 1));

    setTimeout(() => {
      try { bot.pathfinder.setGoal(null); } catch (e) { /* ignore */ }
      followCooldowns[entity.username] = Date.now();
      addChatLog('bot_action', null, `${entity.username} takibi tamamlandı.`);

      // Send greeting command to players
      const dm = config.follow.followMessage
        .replace('{username}', entity.username)
        .replace('{msgCommand}', config.follow.messageCommand)
        .replace('{botname}', config.botAccount.displayName);
      
      bot.chat(`${config.follow.messageCommand} ${entity.username} ${dm}`);
      addChatLog('bot_reply_private', entity.username, dm);

      equipEmptyHand();
      
      // Return back to /home and align
      setTimeout(() => {
        goToHomeCoordinates();
      }, 500);
    }, config.follow.durationMs);
  });

  // ---- Message Handler ----
  bot.on('message', async (message) => {
    if (!bot) return;
    const parsed = parseIncomingMessage(message);
    
    // Fallback: log raw unparsed messages so they appear in the chatlog
    if (!parsed) {
      const rawText = message.toString().replace(/§[0-9a-fk-or]/gi, '').trim();
      if (rawText) {
        addChatLog('chat', null, rawText);
      }
      return;
    }

    if (!parsed.sender || !parsed.text) return;
    if (isIgnoredSender(parsed.sender)) return;

    // Log the clean message
    addChatLog(parsed.type, parsed.sender, parsed.text);

    // If Pathfinder / AI is disabled, we do not respond or process any AI logic.
    if (!config.pathfinderEnabled) return;

    // ---- WHISPER (Özel Mesaj) ----
    if (parsed.type === 'whisper') {
      const rateLimitCheck = checkUnifiedRateLimit(parsed.sender);
      if (!rateLimitCheck.allowed) {
        const warning = `Mesaj hakkınız doldu! Yeni hak kazanmak için ${rateLimitCheck.waitTimeStr} beklemelisiniz. 😊`;
        bot.chat(`${config.follow.messageCommand} ${parsed.sender} ${warning}`);
        addChatLog('bot_reply_private', parsed.sender, warning);
        return;
      }

      consumeUnifiedRateLimit(parsed.sender);
      const aiResponse = await getAIResponse(parsed.text);
      bot.chat(`${config.follow.messageCommand} ${parsed.sender} ${aiResponse}`);
      addChatLog('bot_reply_private', parsed.sender, aiResponse);
      return;
    }

    // ---- MENTION (Adının Anılması) ----
    if (parsed.type === 'mention' || parsed.type === 'chat') {
      const containsMention = parsed.text.toLowerCase().includes(config.botAccount.displayName.toLowerCase()) || 
                             parsed.text.toLowerCase().includes('@' + config.botAccount.displayName.toLowerCase());
      
      if (!containsMention) return;

      // Check if aggressive mode is active
      if (config.aggressiveMode) {
        // Agresif Moddayken:
        const rateLimitCheck = checkUnifiedRateLimit(parsed.sender);
        if (!rateLimitCheck.allowed) {
          const warning = `Mesaj hakkınız doldu! Yeni hak kazanmak için ${rateLimitCheck.waitTimeStr} beklemelisiniz. 😊`;
          bot.chat(`${config.follow.messageCommand} ${parsed.sender} ${warning}`);
          addChatLog('bot_reply_private', parsed.sender, warning);
          return;
        }

        consumeUnifiedRateLimit(parsed.sender);
        const aiResponse = await getAIResponse(parsed.text);
        // Removed "@" character from mention response as requested
        const formattedResponse = `${parsed.sender} ${aiResponse}`;
        bot.chat(formattedResponse);
        addChatLog('bot_reply_public', parsed.sender, aiResponse);
      } else {
        // Normal Moddayken (Fısıltı komutuna yönlendirir):
        const now = Date.now();
        const lastMention = chatMentionCooldowns[parsed.sender] || 0;
        if (now - lastMention < config.chatMention.cooldownMs) return;

        chatMentionCooldowns[parsed.sender] = now;
        const responseText = config.chatMention.messageText
          .replace('{msgCommand}', config.follow.messageCommand)
          .replace('{botname}', config.botAccount.displayName);

        bot.chat(`${config.follow.messageCommand} ${parsed.sender} ${responseText}`);
        addChatLog('bot_reply_private', parsed.sender, responseText);
      }
    }
  });

  // ---- Disconnect & Reconnect ----
  bot.on('end', () => {
    addChatLog('system', null, 'Bağlantı kesildi. Yeniden bağlanılıyor...');
    botConnected = false;
    sequenceComplete = false;
    botReady = false;
    isFollowing = false;
    setTimeout(startBot, config.utils.autoReconnectDelay);
  });

  bot.on('error', (err) => {
    console.error('[Bot] Hata:', err.message);
    addChatLog('system', null, `Bot Hata: ${err.message}`);
  });
}

// ==================== START ====================
startBot();

app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    connected: botConnected,
    sequenceComplete,
    botReady,
    isFollowing,
    isEating,
    hasSentFirstTimeSkyblockMessage,
    config: {
      aggressiveMode: config.aggressiveMode,
      pathfinderEnabled: config.pathfinderEnabled,
      firstTimeSkyblockToggle: config.spawnSequence.sendFirstTimeSkyblockMessage,
      server: config.server,
      botAccount: {
        username: config.botAccount.username,
        displayName: config.botAccount.displayName
      }
    }
  });
});

app.get('/api/logs', (req, res) => {
  res.json(chatLogs);
});

app.post('/api/config/toggle-aggressive', (req, res) => {
  config.aggressiveMode = !config.aggressiveMode;
  addChatLog('system', null, `Agresif mod ${config.aggressiveMode ? 'AÇILDI' : 'KAPATILDI'}`);
  res.json({ success: true, aggressiveMode: config.aggressiveMode });
});

app.post('/api/config/toggle-pathfinder', (req, res) => {
  config.pathfinderEnabled = !config.pathfinderEnabled;
  addChatLog('system', null, `Yapay zeka (Pathfinder) mod ${config.pathfinderEnabled ? 'AÇILDI' : 'KAPATILDI'}`);
  res.json({ success: true, pathfinderEnabled: config.pathfinderEnabled });
});

app.post('/api/config/toggle-skyblock-msg', (req, res) => {
  config.spawnSequence.sendFirstTimeSkyblockMessage = !config.spawnSequence.sendFirstTimeSkyblockMessage;
  addChatLog('system', null, `İlk giriş skyblock duyurusu ${config.spawnSequence.sendFirstTimeSkyblockMessage ? 'AÇILDI' : 'KAPATILDI'}`);
  res.json({ success: true, toggle: config.spawnSequence.sendFirstTimeSkyblockMessage });
});

app.post('/api/command/home', async (req, res) => {
  if (botConnected) {
    goToHomeCoordinates();
    res.json({ success: true, message: "Bot home koordinatına yönlendirildi." });
  } else {
    res.status(400).json({ success: false, message: "Bot bağlı değil." });
  }
});

app.post('/api/command/eat', async (req, res) => {
  if (botConnected) {
    tryEat();
    res.json({ success: true, message: "Yemek yeme komutu tetiklendi." });
  } else {
    res.status(400).json({ success: false, message: "Bot bağlı değil." });
  }
});

app.post('/api/command/say', (req, res) => {
  const { message: msgText } = req.body;
  if (botConnected && msgText) {
    bot.chat(msgText);
    addChatLog('bot_action', null, `Konuştu: "${msgText}"`);
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false });
  }
});

app.get('/', (req, res) => {
  res.send('<h1>TatliBot Sunucusu Aktif</h1><p>API endpointleri çalışıyor.</p>');
});

app.listen(port, () => {
  console.log(`[Sunucu] Port ${port} üzerinde çalışıyor.`);
});
