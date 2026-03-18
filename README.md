# Mini OpenClaw Gateway

> 轻量级 AI 聊天网关，支持 WebSocket、HTTP API、企业微信、Telegram、Discord、飞书、钉钉

## 功能特性

- 🌐 **WebSocket API** - 实时双向通信
- 📡 **HTTP API** - 简单消息收发
- 💬 **企业微信接入** - 被动回复模式，可直接在微信里聊天
- 🤖 **LLM 集成** - 调用本地 LLM API 生成回复
- 💾 **会话记忆** - 自动保存对话历史

## 快速开始

### 1. 安装依赖

```bash
cd /xx/mini-openclaw
npm install
# 或
pnpm install
```

### 2. 配置环境变量

复制配置模板并修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# LLM 配置
LLM_BASE_URL=http://xx.xx.xx.xx:80/v1
LLM_API_KEY=你的APIKey
LLM_MODEL=claude-opus-4-6

# 服务端口
WS_PORT=18789
HTTP_PORT=18790

# 企业微信配置（可选）
WECOM_CORP_ID=你的企业ID
WECOM_SECRET=你的应用Secret
WECOM_AGENT_ID=你的AgentId
WECOM_TOKEN=回调Token
WECOM_ENCODING_AES_KEY=回调AESKey

# Telegram Bot 配置（可选）
TEGRAM_BOT_TOKEN=你的BotToken
TEGRAM_SECRET=你的Secret

# Discord Bot 配置（可选）
DISCORD_BOT_TOKEN=你的BotToken
DISCORD_PUBLIC_KEY=你的PublicKey
DISCORD_APPLICATION_ID=你的ApplicationId
DISCORD_GUILD_ID=你的服务器ID
```

### 3. 启动服务

```bash
node gateway.js
```

服务启动后会显示：

```
🚀 OpenClaw Gateway started on ws://localhost:18789
🌐 OpenClaw HTTP API started on http://localhost:18790
[WeCom] 企业微信被动回复已加载
```

## API 接口

### HTTP API

#### 发送消息（无会话）

```bash
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}
```

#### 创建会话

```bash
curl -X POST http://localhost:18790/api/sessions
# 返回: {"success":true,"sessionId":"xxx"}
```

#### 发送消息到会话

```bash
curl -X POST http://localhost:18790/api/sessions/:id/message \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}
```

#### 获取会话列表

```bash
curl http://localhost:18790/api/sessions
```

#### 获取会话详情

```bash
curl http://localhost:18790/api/sessions/:id
```

#### 健康检查

```bash
curl http://localhost:18790/health
```

### WebSocket API

```javascript
const ws = new WebSocket('ws://localhost:18789');

ws.onopen = () => {
  ws.send(JSON.stringify({ message: '你好' }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('回复:', data.message);
};
```

## 企业微信配置（可选）

如果你想通过企业微信接入聊天，需要完成以下配置：

### 1. 企业微信后台配置

1. 登录 https://work.weixin.qq.com/
2. 进入 **应用管理** → **创建自建应用**
3. 获取以下信息填入 `.env`：
   - **CorpID**: 我的企业 → 企业信息 → 企业ID
   - **Secret**: 应用详情页
   - **AgentId**: 应用详情页

4. 设置 **可信IP**（本机 IP 或 VPS 公网 IP）

5. 配置 **接收消息**：
   - **回调URL**: `http://[IP_ADDRESS]/api/wecom/callback`
   - **Token**: 填入 `.env` 中的 `WECOM_TOKEN`
   - **EncodingAESKey**: 填入 `.env` 中的 `WECOM_ENCODING_AES_KEY`

### 2. 重启服务

配置完成后重启：

```bash
node gateway.js
```

### 3. 测试

在企业微信应用里发送消息，应该能收到 AI 回复！

## Telegram Bot 配置（可选）

### 1. 创建机器人

1. 在 Telegram 搜索 @BotFather
2. 发送 `/newbot` 创建新机器人
3. 获取 Bot Token

### 2. 配置环境变量

```env
TEGRAM_BOT_TOKEN=你的BotToken
```

### 3. 设置 Webhook

需要公网域名（可用 ngrok 内网穿透）：

```bash
# 先启动服务
node gateway.js

# 然后设置 webhook（把 URL 换成你的公网地址）
curl "https://your-domain.com/api/telegram/setwebhook?url=https://your-domain.com/api/telegram/webhook"
```

### 4. 测试

在 Telegram 里给机器人发消息，应该能收到 AI 回复！

---

## Discord Bot 配置（可选）

### 1. 创建应用和机器人

1. 访问 https://discord.com/developers/applications
2. 创建新应用 → 创建机器人
3. 获取 **Token** (DISCORD_BOT_TOKEN)
4. 获取 **Public Key** (DISCORD_PUBLIC_KEY)
5. 获取 **Application ID** (DISCORD_APPLICATION_ID)

### 2. 邀请机器人

在 OAuth2 → URL Generator 中配置：
- scopes: `bot`
- permissions: `Send Messages`, `Read Message History`
- 生成邀请链接并加入服务器

### 3. 配置环境变量

```env
DISCORD_BOT_TOKEN=你的BotToken
DISCORD_PUBLIC_KEY=你的PublicKey
DISCORD_APPLICATION_ID=你的ApplicationId
```

### 4. 配置 Interactive Endpoint

在 Discord Developer Portal → Application → Interactive Endpoint：
- URL: `https://你的域名/api/discord/interactions`

### 5. 测试

在服务器里 @机器人 发消息，应该能收到 AI 回复！

---

## 飞书配置（可选）

### 方式一：自定义机器人 Webhook（简单）

1. 飞书群设置 → 添加机器人 → 选择"自定义机器人"
2. 复制 Webhook 地址
3. 配置环境变量：

```env
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/hook/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

4. 重启服务，群里发消息就能收到 AI 回复！

### 方式二：企业自建应用（功能多）

1. 访问 https://open.feishu.cn/ 创建企业自建应用
2. 获取 App ID 和 App Secret
3. 配置权限：
   - im:chat:readonly
   - im:message:send_as_bot
   - im:message:receive
4. 发布应用并在群里添加
5. 配置环境变量：

```env
FEISHU_APP_ID=cli_xxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 钉钉配置（可选）

1. 钉钉群设置 → 智能群助手 → 添加机器人
2. 选择"自定义机器人"
3. 可选：设置加签密钥或关键词
4. 复制 Webhook 地址
5. 配置环境变量：

```env
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxxxx
# 可选：加签密钥
DINGTALK_SECRET=SECxxxxxxxxxxxxxxxxxxxx
```

6. 重启服务，群里发消息就能收到 AI 回复！

---

## 项目结构

```
mini-openclaw/
├── .env              # 环境配置（需自行创建）
├── .env.example      # 配置模板
├── gateway.js        # 主入口
├── wecom.js          # 企业微信模块
├── telegram.js       # Telegram Bot 模块
├── discord.js       # Discord Bot 模块
├── feishu.js        # 飞书模块
├── dingtalk.js      # 钉钉模块
├── browser.js        # 浏览器控制模块
├── package.json      # 项目依赖
├── gateway.log       # 运行日志
└── data/
    ├── sessions/        # HTTP API 会话存储
    ├── wecom-sessions/ # 企业微信会话存储
    ├── telegram-sessions/ # Telegram 会话存储
    ├── discord-sessions/ # Discord 会话存储
    ├── feishu-sessions/ # 飞书会话存储
    └── dingtalk-sessions/ # 钉钉会话存储
```

## 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `LLM_BASE_URL` | 是 | http://192.168.111.90:8016/v1 | LLM API 地址 |
| `LLM_API_KEY` | 是 | - | LLM API Key |
| `LLM_MODEL` | 是 | claude-opus-4-6 | 使用的模型 |
| `WS_PORT` | 否 | 18789 | WebSocket 端口 |
| `HTTP_PORT` | 否 | 18790 | HTTP API 端口 |
| `WECOM_CORP_ID` | 否 | - | 企业微信 CorpID |
| `WECOM_SECRET` | 否 | - | 企业微信应用 Secret |
| `WECOM_AGENT_ID` | 否 | - | 企业微信应用 AgentId |
| `WECOM_TOKEN` | 否 | - | 回调验证 Token |
| `WECOM_ENCODING_AES_KEY` | 否 | - | 回调加密 Key |
| `TEGRAM_BOT_TOKEN` | 否 | - | Telegram Bot Token |
| `TEGRAM_SECRET` | 否 | - | Telegram Webhook Secret |
| `DISCORD_BOT_TOKEN` | 否 | - | Discord Bot Token |
| `DISCORD_PUBLIC_KEY` | 否 | - | Discord Public Key |
| `DISCORD_APPLICATION_ID` | 否 | - | Discord Application ID |
| `DISCORD_GUILD_ID` | 否 | - | Discord 服务器 ID |
| `FEISHU_APP_ID` | 否 | - | 飞书 App ID |
| `FEISHU_APP_SECRET` | 否 | - | 飞书 App Secret |
| `FEISHU_WEBHOOK_URL` | 否 | - | 飞书 Webhook URL |
| `DINGTALK_WEBHOOK_URL` | 否 | - | 钉钉 Webhook URL |
| `DINGTALK_SECRET` | 否 | - | 钉钉加签密钥 |
| `HTTP_PORT` | 否 | 18790 | HTTP API 端口 |
| `WECOM_CORP_ID` | 否 | - | 企业微信 CorpID |
| `WECOM_SECRET` | 否 | - | 企业微信应用 Secret |
| `WECOM_AGENT_ID` | 否 | - | 企业微信应用 AgentId |
| `WECOM_TOKEN` | 否 | - | 回调验证 Token |
| `WECOM_ENCODING_AES_KEY` | 否 | - | 回调加密 Key |

## 常见问题

### Q: 企业微信回调提示验证失败

A: 检查以下几点：
1. 确认 `.env` 里的 `WECOM_TOKEN` 和 `WECOM_ENCODING_AES_KEY` 与企业微信后台配置一致
2. 确认本机 IP 已加入"可信IP"列表
3. 如果是本地测试，需要使用内网穿透工具（如 ngrok、frp）暴露公网地址

### Q: 如何查看运行日志？

A: 查看 `gateway.log` 文件：

```bash
tail -f gateway.log
```

### Q: LLM 调用失败

A: 检查：
1. `LLM_BASE_URL` 是否可访问
2. `LLM_API_KEY` 是否正确
3. 查看 gateway.log 中的错误信息

## 许可证

MIT
