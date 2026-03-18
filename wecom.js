/**
 * 企业微信被动回复 - 消息处理
 * 
 * 企业微信配置步骤：
 * 1. 登录企业微信管理后台 (https://work.weixin.qq.com/wework_admin/)
 * 2. 创建自建应用：应用管理 → 创建应用
 * 3. 设置接收消息的企业可信IP
 * 4. 配置"接收消息"回调URL指向本服务
 * 5. 获取 CorpID、Secret、AgentId
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 读取 .env 配置文件
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
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

// 企业微信配置 - 从环境变量读取
const WECOM_CONFIG = {
  corpId: env.WECOM_CORP_ID || 'YOUR_CORP_ID',
  secret: env.WECOM_SECRET || 'YOUR_SECRET',
  agentId: env.WECOM_AGENT_ID || 'YOUR_AGENT_ID',
  token: env.WECOM_TOKEN || 'YOUR_VERIFY_TOKEN',
  encodingAesKey: env.WECOM_ENCODING_AES_KEY || 'YOUR_AES_KEY',
};

// LLM 配置 - 从环境变量读取
const LLM_BASE_URL = env.LLM_BASE_URL || '';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 端口配置
const HTTP_PORT = parseInt(env.HTTP_PORT) || 18790;

// 会话存储
const sessions = new Map();
const DATA_DIR = path.join(__dirname, 'data', 'wecom-sessions');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveSession(session) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${session.userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

function loadSession(userId) {
  const filePath = path.join(DATA_DIR, `${userId}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

// 验证URL时的加密/解密
function getVerifyParams(msgSignature, timestamp, nonce, echostr) {
  const token = WECOM_CONFIG.token;
  const sortStr = [token, timestamp, nonce, echostr].sort().join('');
  const sha1 = crypto.createHash('sha1').update(sortStr).digest('hex');

  if (sha1 !== msgSignature) {
    return null;
  }

  // 解密echostr
  const aesKey = Buffer.from(WECOM_CONFIG.encodingAesKey + '=');
  try {
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
    let decrypted = cipher.update(echostr, 'base64', 'utf8');
    decrypted += cipher.final('utf8');
    const msg = decrypted.slice(26);
    const len = Buffer.from(msg.slice(0, 4), 'binary').readUInt32BE(0);
    return msg.slice(4, len + 4);
  } catch (e) {
    console.error('解密失败:', e);
    return null;
  }
}

// 解密消息
function decryptMessage(msgSignature, timestamp, nonce, encryptedMsg) {
  const token = WECOM_CONFIG.token;
  const sortStr = [token, timestamp, nonce, encryptedMsg].sort().join('');
  const sha1 = crypto.createHash('sha1').update(sortStr).digest('hex');

  if (sha1 !== msgSignature) {
    console.error('签名验证失败');
    return null;
  }

  const aesKey = Buffer.from(WECOM_CONFIG.encodingAesKey + '=');
  try {
    const cipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
    let decrypted = cipher.update(encryptedMsg, 'base64', 'utf8');
    decrypted += cipher.final('utf8');

    const msg = decrypted.slice(26);
    const len = Buffer.from(msg.slice(0, 4), 'binary').readUInt32BE(0);
    const xmlContent = msg.slice(4, len + 4);

    // 解析XML
    const result = {};
    const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/(\w+)>/g;
    let match;
    while ((match = regex.exec(xmlContent)) !== null) {
      result[match[1]] = match[2];
    }
    return result;
  } catch (e) {
    console.error('解密消息失败:', e);
    return null;
  }
}

// 加密消息
function encryptMessage(replyContent) {
  const aesKey = Buffer.from(WECOM_CONFIG.encodingAesKey + '=');
  const randomStr = crypto.randomBytes(16).toString('binary');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(replyContent.length, 0);
  const msg = randomStr + len + replyContent + WECOM_CONFIG.corpId;

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
  let encrypted = cipher.update(msg, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const token = WECOM_CONFIG.token;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).slice(2, 12);
  const signStr = [WECOM_CONFIG.token, timestamp, nonce, encrypted].sort().join('');
  const signature = crypto.createHash('sha1').update(signStr).digest('hex');

  return {
    encrypted,
    signature,
    timestamp,
    nonce,
  };
}

// 调用LLM生成回复
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
    saveSession(session);

    return reply;
  } catch (error) {
    console.error('LLM调用失败:', error.message);
    return '抱歉，我现在有点累，暂时无法回复你...';
  }
}

// 发送应用消息给用户
async function sendMessage(toUser, content) {
  // 先获取access_token
  const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WECOM_CONFIG.corpId}&corpsecret=${WECOM_CONFIG.secret}`;

  try {
    const tokenRes = await axios.get(tokenUrl);
    const accessToken = tokenRes.data.access_token;

    // 发送消息
    const msgUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
    const msgData = {
      touser: toUser,
      msgtype: 'text',
      agentid: WECOM_CONFIG.agentId,
      text: { content }
    };

    const sendRes = await axios.post(msgUrl, msgData);
    console.log('消息发送结果:', sendRes.data);
    return sendRes.data;
  } catch (error) {
    console.error('发送消息失败:', error.message);
    return { errcode: -1, errmsg: error.message };
  }
}

// 构建回复XML
function buildReplyXml(toUser, fromUser, content) {
  const encrypt = encryptMessage(content);

  return `<xml>
<Encrypt><![CDATA[${encrypt.encrypted}]]></Encrypt>
<MsgSignature><![CDATA[${encrypt.signature}]]></MsgSignature>
<TimeStamp>${encrypt.timestamp}</TimeStamp>
<Nonce><![CDATA[${encrypt.nonce}]]></Nonce>
</xml>`;
}

module.exports = function (app) {
  // 验证URL（企业微信首次配置时调用）
  app.get('/api/wecom/callback', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;

    console.log('收到验证请求:', { msg_signature, timestamp, nonce, echostr });

    const decrypted = getVerifyParams(msg_signature, timestamp, nonce, echostr);

    if (decrypted) {
      const encrypt = encryptMessage(decrypted);
      res.send(buildReplyXml(WECOM_CONFIG.corpId, WECOM_CONFIG.corpId, decrypted));
    } else {
      res.status(403).send('验证失败');
    }
  });

  // 接收消息
  app.post('/api/wecom/callback', async (req, res) => {
    const { msg_signature, timestamp, nonce } = req.query;
    const encryptedMsg = req.body.xml?.encrypt?.[0];

    console.log('收到消息:', { msg_signature, timestamp, nonce, encryptedMsg: encryptedMsg?.slice(0, 50) });

    if (!encryptedMsg) {
      return res.send('success');
    }

    // 解密消息
    const msg = decryptMessage(msg_signature, timestamp, nonce, encryptedMsg);

    if (!msg) {
      return res.send('success');
    }

    console.log('解密后消息:', msg);

    const fromUser = msg.FromUserName;
    const content = msg.Content;
    const msgType = msg.MsgType;

    // 只处理文本消息
    if (msgType !== 'text') {
      const reply = '暂只支持文字对话~';
      res.send(buildReplyXml(fromUser, WECOM_CONFIG.corpId, reply));
      return;
    }

    // 异步处理回复
    (async () => {
      try {
        const reply = await generateReply(fromUser, content);
        console.log('生成的回复:', reply.slice(0, 50));

        // 发送回复
        await sendMessage(fromUser, reply);
      } catch (error) {
        console.error('处理消息失败:', error);
      }
    })();

    // 立即返回success，避免企业微信重试
    res.send('success');
  });

  // 配置页面
  app.get('/api/wecom/config', (req, res) => {
    res.json({
      configured: WECOM_CONFIG.corpId !== 'YOUR_CORP_ID',
      config: {
        corpId: WECOM_CONFIG.corpId ? WECOM_CONFIG.corpId.slice(0, 4) + '****' : '',
        agentId: WECOM_CONFIG.agentId,
      }
    });
  });

  console.log('[WeCom] 企业微信被动回复已加载');
};
