/**
 * Discord Bot 模块
 * 
 * 配置步骤：
 * 1. 在 Discord Developer Portal 创建应用
 * 2. 创建 Bot，获取 Token
 * 3. 将 Token 填入 .env
 * 4. 生成邀请链接邀请机器人到服务器
 * 5. 设置 PUBLIC_KEY 和 APPLICATION_ID
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 读取 .env
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  return env;
}

const env = loadEnv();

// Discord 配置
const DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN || '';
const DISCORD_PUBLIC_KEY = env.DISCORD_PUBLIC_KEY || '';
const DISCORD_APPLICATION_ID = env.DISCORD_APPLICATION_ID || '';
const DISCORD_GUILD_ID = env.DISCORD_GUILD_ID || '';  // 可选，指定服务器

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || '';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 会话存储
const DISCORD_SESSIONS_DIR = path.join(__dirname, 'data', 'discord-sessions');

function ensureDir() {
  if (!fs.existsSync(DISCORD_SESSIONS_DIR)) {
    fs.mkdirSync(DISCORD_SESSIONS_DIR, { recursive: true });
  }
}

function loadSession(userId) {
  ensureDir();
  const file = path.join(DISCORD_SESSIONS_DIR, `${userId}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

function saveSession(userId, session) {
  ensureDir();
  const file = path.join(DISCORD_SESSIONS_DIR, `${userId}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2));
}

async function generateReply(userId, userMessage) {
  let session = loadSession(userId);
  if (!session) {
    session = {
      userId,
      messages: [
        { role: 'system', content: '你是一个友好的AI助手，请用简洁、有帮助的方式回复用户。' }
      ]
    };
  }

  session.messages.push({ role: 'user', content: userMessage });

  try {
    const response = await axios.post(
      `${LLM_BASE_URL}/chat/completions`,
      {
        model: LLM_MODEL,
        messages: session.messages,
        temperature: 0.7,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${LLM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );

    const reply = response.data.choices[0].message.content;
    session.messages.push({ role: 'assistant', content: reply });
    saveSession(userId, session);
    return reply;
  } catch (error) {
    console.error('[Discord] LLM调用失败:', error.message);
    return '抱歉，我现在有点累，暂时无法回复你...';
  }
}

async function sendMessage(channelId, content) {
  if (!DISCORD_BOT_TOKEN) return;

  try {
    await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      content: content
    }, {
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[Discord] 发送消息失败:', error.message);
  }
}

// 验证 Discord 请求
function verifyRequest(req, signature, timestamp) {
  if (!DISCORD_PUBLIC_KEY) return true;

  const body = JSON.stringify(req.body);
  const message = timestamp + body;
  const hmac = crypto.createHmac('sha256', DISCORD_PUBLIC_KEY);
  const digest = hmac.update(message).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

module.exports = function (app) {
  // Discord Interactive Endpoint 验证
  app.get('/api/discord/interactions', (req, res) => {
    res.send('');
  });

  // 处理 Interactions
  app.post('/api/discord/interactions', async (req, res) => {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    // 验证请求（生产环境建议开启）
    // if (!verifyRequest(req, signature, timestamp)) {
    //   return res.status(401).send('invalid request');
    // }

    const type = req.body.type;

    // PING
    if (type === 1) {
      return res.json({ type: 1 });
    }

    // MESSAGE COMPONENT (按钮等)
    if (type === 3) {
      // 处理按钮点击
      return res.json({ type: 5 });
    }

    // 消息类型（用户发送的消息）
    if (type === 2 || type === undefined) {
      const data = req.body.data;
      const channelId = req.body.channel_id;
      const userId = req.body.member?.user?.id || req.body.user?.id;

      // 获取消息内容
      let messageContent = '';
      if (data?.content) {
        messageContent = data.content;
      } else if (req.body.message?.content) {
        messageContent = req.body.message.content;
      }

      // 移除 @机器人 的提及
      const botId = DISCORD_APPLICATION_ID;
      messageContent = messageContent.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();

      if (!messageContent) {
        return res.json({ type: 5 });
      }

      console.log(`[Discord] 收到消息 from ${userId}: ${messageContent.slice(0, 50)}`);

      // 异步处理
      (async () => {
        try {
          const reply = await generateReply(userId, messageContent);

          // Discord 消息限制 2000 字符
          const chunks = reply.match(/.{1,1990}/g) || [];
          for (const chunk of chunks) {
            await sendMessage(channelId, chunk);
          }
        } catch (error) {
          console.error('[Discord] 处理消息失败:', error);
        }
      })();

      return res.json({ type: 5 });
    }

    res.json({ type: 5 });
  });

  // 配置状态
  app.get('/api/discord/config', (req, res) => {
    res.json({
      configured: !!DISCORD_BOT_TOKEN,
      token: DISCORD_BOT_TOKEN ? DISCORD_BOT_TOKEN.slice(0, 10) + '****' : '',
      applicationId: DISCORD_APPLICATION_ID ? DISCORD_APPLICATION_ID.slice(0, 8) + '****' : ''
    });
  });

  console.log('[Discord] Discord Bot 模块已加载');
};
