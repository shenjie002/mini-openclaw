/**
 * Telegram Bot 模块
 * 
 * 配置步骤：
 * 1. @BotFather 创建机器人，获取 Token
 * 2. 将 Token 填入 .env
 * 3. 设置 Webhook 指向本服务
 * 
 * Webhook URL: https://你的域名/api/telegram/webhook
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

// Telegram 配置
const TELEGRAM_BOT_TOKEN = env.TEGRAM_BOT_TOKEN || '';
const TELEGRAM_SECRET = env.TEGRAM_SECRET || '';

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || '';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 会话存储
const TELEGRAM_SESSIONS_DIR = path.join(__dirname, 'data', 'telegram-sessions');

function ensureDir() {
  if (!fs.existsSync(TELEGRAM_SESSIONS_DIR)) {
    fs.mkdirSync(TELEGRAM_SESSIONS_DIR, { recursive: true });
  }
}

function loadSession(userId) {
  ensureDir();
  const file = path.join(TELEGRAM_SESSIONS_DIR, `${userId}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

function saveSession(userId, session) {
  ensureDir();
  const file = path.join(TELEGRAM_SESSIONS_DIR, `${userId}.json`);
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
    console.error('[Telegram] LLM调用失败:', error.message);
    return '抱歉，我现在有点累，暂时无法回复你...';
  }
}

async function sendMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  } catch (error) {
    console.error('[Telegram] 发送消息失败:', error.message);
  }
}

module.exports = function (app) {
  // Webhook 验证（可选）
  app.get('/api/telegram/setwebhook', async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.json({ error: 'TELEGRAM_BOT_TOKEN 未配置' });
    }

    const webhookUrl = req.query.url;
    if (!webhookUrl) {
      return res.json({ error: '请提供 webhook URL' });
    }

    try {
      const result = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
        url: webhookUrl
      });
      res.json(result.data);
    } catch (error) {
      res.json({ error: error.message });
    }
  });

  // Webhook 处理
  app.post('/api/telegram/webhook', async (req, res) => {
    // 验证secret（可选）
    if (TELEGRAM_SECRET) {
      const secret = req.headers['x-telegram-bot-api-secret-token'];
      if (secret !== TELEGRAM_SECRET) {
        console.log('[Telegram] Secret 验证失败');
        return res.send('ok');
      }
    }

    const message = req.body.message;
    if (!message || !message.text) {
      return res.send('ok');
    }

    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text;

    console.log(`[Telegram] 收到消息 from ${userId}: ${text.slice(0, 50)}`);

    // 异步处理回复
    (async () => {
      try {
        const reply = await generateReply(userId, text);
        await sendMessage(chatId, reply);
      } catch (error) {
        console.error('[Telegram] 处理消息失败:', error);
      }
    })();

    res.send('ok');
  });

  // 配置状态
  app.get('/api/telegram/config', (req, res) => {
    res.json({
      configured: !!TELEGRAM_BOT_TOKEN,
      token: TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.slice(0, 10) + '****' : ''
    });
  });

  console.log('[Telegram] Telegram Bot 模块已加载');
};
