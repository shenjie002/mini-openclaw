/**
 * 飞书机器人模块
 * 
 * 配置步骤：
 * 1. 飞书开放平台创建企业自建应用
 * 2. 获取 App ID 和 App Secret
 * 3. 配置应用权限：im:chat:readonly, im:message:send_as_bot, im:message:receive
 * 4. 发布应用并在群里添加机器人
 * 5. 获取 App ID、App Secret 填入 .env
 * 
 * Webhook 模式：也可以直接在群里添加"自定义机器人"，使用 Webhook URL
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

// 飞书配置（应用模式）
const FEISHU_APP_ID = env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = env.FEISHU_APP_SECRET || '';

// 飞书配置（Webhook 模式）
const FEISHU_WEBHOOK_URL = env.FEISHU_WEBHOOK_URL || '';

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || 'http://192.168.111.90:8016/v1';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 会话存储
const FEISHU_SESSIONS_DIR = path.join(__dirname, 'data', 'feishu-sessions');

let feishuAccessToken = '';
let feishuTokenExpireTime = 0;

function ensureDir() {
  if (!fs.existsSync(FEISHU_SESSIONS_DIR)) {
    fs.mkdirSync(FEISHU_SESSIONS_DIR, { recursive: true });
  }
}

function loadSession(userId) {
  ensureDir();
  const file = path.join(FEISHU_SESSIONS_DIR, `${userId}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

function saveSession(userId, session) {
  ensureDir();
  const file = path.join(FEISHU_SESSIONS_DIR, `${userId}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2));
}

async function getAccessToken() {
  if (feishuAccessToken && Date.now() < feishuTokenExpireTime) {
    return feishuAccessToken;
  }

  try {
    const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    });
    
    if (response.data.code === 0) {
      feishuAccessToken = response.data.tenant_access_token;
      feishuTokenExpireTime = Date.now() + (response.data.expire - 60) * 1000;
      return feishuAccessToken;
    }
  } catch (error) {
    console.error('[飞书] 获取 access_token 失败:', error.message);
  }
  return null;
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
    console.error('[飞书] LLM调用失败:', error.message);
    return '抱歉，我现在有点累，暂时无法回复你...';
  }
}

// 发送消息（应用模式）
async function sendMessageOpenAPI(openId, content) {
  const token = await getAccessToken();
  if (!token) return;

  try {
    await axios.post('https://open.feishu.cn/open-apis/im/v1/messages', {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text: content })
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[飞书] 发送消息失败:', error.message);
  }
}

// 发送消息（Webhook 模式）
async function sendMessageWebhook(content) {
  if (!FEISHU_WEBHOOK_URL) return;

  try {
    await axios.post(FEISHU_WEBHOOK_URL, {
      msg_type: 'text',
      content: JSON.stringify({ text: content })
    });
  } catch (error) {
    console.error('[飞书] Webhook 发送消息失败:', error.message);
  }
}

module.exports = function(app) {
  // 飞书回调 URL 验证
  app.get('/api/feishu/webhook', (req, res) => {
    const challenge = req.query.challenge;
    if (challenge) {
      res.json({ challenge: challenge });
    } else {
      res.send('ok');
    }
  });

  // 飞书回调处理
  app.post('/api/feishu/webhook', async (req, res) => {
    const { type, event, message } = req.body;

    // URL 验证
    if (type === 'url_verification') {
      return res.json({ challenge: req.body.challenge });
    }

    // 消息事件
    if (type === 'event_callback' && event === 'im.message') {
      const msgType = message?.msg_type;
      const content = message?.content;
      
      // 只处理文本消息
      if (msgType !== 'text') {
        return res.send('ok');
      }

      let text = '';
      try {
        text = JSON.parse(content).text || '';
      } catch (e) {
        text = content;
      }

      // 移除 @机器人 的内容
      text = text.replace(/<@.*?>/g, '').trim();
      
      if (!text) {
        return res.send('ok');
      }

      const userId = message?.open_id || message?.user_id || 'unknown';
      const chatId = message?.chat_id || '';

      console.log(`[飞书] 收到消息 from ${userId}: ${text.slice(0, 50)}`);

      // 异步处理回复
      (async () => {
        try {
          const reply = await generateReply(userId, text);
          
          // 根据配置选择发送方式
          if (FEISHU_WEBHOOK_URL) {
            await sendMessageWebhook(`<@${userId}> ${reply}`);
          } else if (FEISHU_APP_ID) {
            await sendMessageOpenAPI(userId, reply);
          }
        } catch (error) {
          console.error('[飞书] 处理消息失败:', error);
        }
      })();

      return res.send('ok');
    }

    res.send('ok');
  });

  // 配置状态
  app.get('/api/feishu/config', (req, res) => {
    res.json({
      configured: !!(FEISHU_APP_ID || FEISHU_WEBHOOK_URL),
      appId: FEISHU_APP_ID ? FEISHU_APP_ID.slice(0, 8) + '****' : '',
      webhookConfigured: !!FEISHU_WEBHOOK_URL
    });
  });

  console.log('[飞书] 飞书机器人模块已加载');
};
