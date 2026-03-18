const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const browser = require('./browser');
const wecom = require('./wecom');
const telegram = require('./telegram');
const discord = require('./discord');
const feishu = require('./feishu');
const dingtalk = require('./dingtalk');

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

// 端口配置
const WS_PORT = parseInt(env.WS_PORT) || 18789;
const HTTP_PORT = parseInt(env.HTTP_PORT) || 18790;

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || '';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// Session 存储
const sessions = new Map();

// 数据目录
const DATA_DIR = path.join(__dirname, 'data', 'sessions');

// 确保目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 生成 UUID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 保存会话到文件
function saveSession(session) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

// 从文件加载会话
function loadSession(sessionId) {
  const filePath = path.join(DATA_DIR, `${sessionId}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

// 加载所有会话
function loadAllSessions() {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const session = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    sessions.set(session.id, session);
  }
}

// 初始化时加载所有会话
loadAllSessions();

const app = express();
app.use(express.json());

browser(app);
wecom(app);
telegram(app);
discord(app);
feishu(app);
dingtalk(app);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/sessions', (req, res) => {
  const allSessions = Array.from(sessions.values()).map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length
  }));
  res.json({ sessions: allSessions });
});

app.post('/api/sessions', (req, res) => {
  const sessionId = generateId();
  const now = new Date().toISOString();
  const session = {
    id: sessionId,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
  sessions.set(sessionId, session);
  saveSession(session);
  console.log('📝 Created session:', sessionId);
  res.json({ success: true, sessionId });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, session });
});

app.post('/api/sessions/:id/message', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const userMessage = req.body.message || req.body.content || req.body.text || '';
    console.log('📨 Received:', userMessage.substring(0, 100));

    const now = new Date().toISOString();
    const userMsg = { role: 'user', content: userMessage, timestamp: now };
    session.messages.push(userMsg);

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

    const llmReply = response.data.choices[0].message.content;
    console.log('📤 Sending response:', llmReply.substring(0, 100));

    const assistantMsg = { role: 'assistant', content: llmReply, timestamp: now };
    session.messages.push(assistantMsg);
    session.updatedAt = now;
    sessions.set(session.id, session);
    saveSession(session);

    res.json({
      success: true,
      message: llmReply,
      id: response.data.id
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/message', async (req, res) => {
  try {
    const userMessage = req.body.message || req.body.content || req.body.text || '';
    console.log('📨 Received:', userMessage.substring(0, 100));

    const response = await axios.post(
      `${LLM_BASE_URL}/chat/completions`,
      {
        model: LLM_MODEL,
        messages: [{ role: 'user', content: userMessage }],
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

    const llmReply = response.data.choices[0].message.content;
    console.log('📤 Sending response:', llmReply.substring(0, 100));

    res.json({
      success: true,
      message: llmReply,
      id: response.data.id
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(HTTP_PORT, () => {
  console.log(`🌐 OpenClaw HTTP API started on http://localhost:${HTTP_PORT}`);
});

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`🚀 OpenClaw Gateway started on ws://localhost:${WS_PORT}`);

wss.on('connection', async (ws) => {
  console.log('📥 Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const userMessage = data.message || data.content || data.text || '';

      console.log('📨 Received:', userMessage.substring(0, 100));

      // Call LLM API
      const response = await axios.post(
        `${LLM_BASE_URL}/chat/completions`,
        {
          model: LLM_MODEL,
          messages: [{ role: 'user', content: userMessage }],
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

      const llmReply = response.data.choices[0].message.content;
      console.log('📤 Sending response:', llmReply.substring(0, 100));

      ws.send(JSON.stringify({
        success: true,
        message: llmReply,
        id: response.data.id
      }));

    } catch (error) {
      console.error('❌ Error:', error.message);
      ws.send(JSON.stringify({
        success: false,
        error: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('📴 Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('⚠️ WebSocket error:', err.message);
  });
});
