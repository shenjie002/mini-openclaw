/**
 * 钉钉机器人模块
 * 
 * 配置步骤：
 * 1. 钉钉群设置 → 智能群助手 → 添加机器人
 * 2. 选择"自定义机器人"，获取 Webhook URL
 * 3. 可设置安全设置：加签或关键词
 * 4. 将 Webhook URL 和密钥填入 .env
 * 
 * Webhook URL 格式: https://oapi.dingtalk.com/robot/send?access_token=xxx
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

// 钉钉配置
const DINGTALK_WEBHOOK_URL = env.DINGTALK_WEBHOOK_URL || '';
const DINGTALK_SECRET = env.DINGTALK_SECRET || '';  // 加签密钥（以 SEC 开头）

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || 'http://192.168.111.90:8016/v1';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 会话存储
const DINGTALK_SESSIONS_DIR = path.join(__dirname, 'data', 'dingtalk-sessions');

function ensureDir() {
  if (!fs.existsSync(DINGTALK_SESSIONS_DIR)) {
    fs.mkdirSync(DINGTALK_SESSIONS_DIR, { recursive: true });
  }
}

function loadSession(userId) {
  ensureDir();
  const file = path.join(DINGTALK_SESSIONS_DIR, `${userId}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

function saveSession(userId, session) {
  ensureDir();
  const file = path.join(DINGTALK_SESSIONS_DIR, `${userId}.json`);
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
    console.error('[钉钉] LLM调用失败:', error.message);
    return '抱歉，我现在有点累，暂时无法回复你...';
  }
}

// 生成加签签名
function generateSign(secret) {
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  const sign = hmac.digest('base64');
  
  return { timestamp: timestamp.toString(), sign: encodeURIComponent(sign) };
}

// 发送消息
async function sendMessage(content) {
  if (!DINGTALK_WEBHOOK_URL) return;

  try {
    let url = DINGTALK_WEBHOOK_URL;
    
    // 如果有加签密钥
    if (DINGTALK_SECRET) {
      const { timestamp, sign } = generateSign(DINGTALK_SECRET);
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}timestamp=${timestamp}&sign=${sign}`;
    }

    await axios.post(url, {
      msgtype: 'text',
      text: {
        content: content
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[钉钉] 发送消息失败:', error.message);
  }
}

module.exports = function(app) {
  // 钉钉回调处理
  app.post('/api/dingtalk/webhook', async (req, res) => {
    const { msgtype, text, conversationId, senderId } = req.body;

    if (msgtype !== 'text' || !text) {
      return res.send('ok');
    }

    const userId = senderId || conversationId || 'unknown';
    let messageText = text.content || '';
    
    // 移除换行符
    messageText = messageText.trim();

    if (!messageText) {
      return res.send('ok');
    }

    console.log(`[钉钉] 收到消息 from ${userId}: ${messageText.slice(0, 50)}`);

    // 异步处理回复
    (async () => {
      try {
        const reply = await generateReply(userId, messageText);
        await sendMessage(reply);
      } catch (error) {
        console.error('[钉钉] 处理消息失败:', error);
      }
    })();

    res.send('ok');
  });

  // 配置状态
  app.get('/api/dingtalk/config', (req, res) => {
    res.json({
      configured: !!DINGTALK_WEBHOOK_URL,
      webhookUrl: DINGTALK_WEBHOOK_URL ? DINGTALK_WEBHOOK_URL.slice(0, 40) + '****' : '',
      signConfigured: !!DINGTALK_SECRET
    });
  });

  console.log('[钉钉] 钉钉机器人模块已加载');
};
