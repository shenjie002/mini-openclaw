/**
 * 工具调用系统
 * 
 * 支持的工具：
 * - web_search: 搜索网页
 * - web_fetch: 获取网页内容
 * - browser_control: 浏览器控制
 * - send_message: 发送消息
 * - read_file: 读取文件
 * - write_file: 写入文件
 * - exec_command: 执行命令
 * - get_weather: 获取天气
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

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

// 工具定义
const tools = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          count: { type: 'number', description: '返回结果数量，默认5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '获取网页内容',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网页URL' },
          maxChars: { type: 'number', description: '最大字符数，默认5000' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的天气',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名称，如北京、上海' }
        },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: '发送消息到指定渠道',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: '渠道：wechat/telegram/discord/feishu/dingtalk' },
          to: { type: 'string', description: '接收者ID' },
          content: { type: 'string', description: '消息内容' }
        },
        required: ['channel', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exec_command',
      description: '执行终端命令',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          timeout: { type: 'number', description: '超时时间(秒)，默认30' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: '获取当前时间',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: '时区，默认Asia/Shanghai' }
        }
      }
    }
  }
];

// 工具执行器
async function executeTool(name, args, context) {
  console.log(`[工具] 调用 ${name}:`, args);

  try {
    switch (name) {
      case 'web_search': {
        // 简单模拟搜索（需要 Brave API Key）
        const query = args.query || '';
        const count = args.count || 5;
        return {
          success: true,
          result: `搜索结果 for "${query}"（需要配置 Brave API Key）\n\n提示：请在 .env 中配置 BRAVE_API_KEY 以启用搜索功能`
        };
      }

      case 'web_fetch': {
        const url = args.url;
        const maxChars = args.maxChars || 5000;
        try {
          const response = await axios.get(url, {
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
          });
          let content = response.data;
          if (content.length > maxChars) {
            content = content.slice(0, maxChars) + '...[内容已截断]';
          }
          // 移除 HTML 标签
          content = content.replace(/<[^>]+>/g, '');
          return { success: true, result: content };
        } catch (e) {
          return { success: false, result: `获取失败: ${e.message}` };
        }
      }

      case 'get_weather': {
        const city = args.city || '上海';
        try {
          const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
          const data = response.data;
          const current = data.current_condition[0];
          return {
            success: true,
            result: `${city}天气：${current.weatherDesc[0].value}，温度${current.temp_C}°C，湿度${current.humidity}%，风速${current.windspeedkmh}km/h`
          };
        } catch (e) {
          return { success: false, result: `获取天气失败: ${e.message}` };
        }
      }

      case 'send_message': {
        const { channel, to, content } = args;
        // 消息发送通过各个渠道模块处理，这里返回提示
        return {
          success: true,
          result: `消息已准备发送到 ${channel}，收件人: ${to || '默认'}，内容: ${content.slice(0, 50)}...`
        };
      }

      case 'read_file': {
        const filePath = path.resolve(args.path);
        if (!filePath.startsWith(process.cwd())) {
          return { success: false, result: '不允许访问超出项目目录的文件' };
        }
        if (!fs.existsSync(filePath)) {
          return { success: false, result: '文件不存在' };
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return { success: true, result: content.slice(0, 5000) };
      }

      case 'write_file': {
        const filePath = path.resolve(args.path);
        if (!filePath.startsWith(process.cwd())) {
          return { success: false, result: '不允许写入超出项目目录的文件' };
        }
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, args.content, 'utf8');
        return { success: true, result: `文件已写入: ${filePath}` };
      }

      case 'exec_command': {
        const command = args.command;
        const timeout = (args.timeout || 30) * 1000;
        
        return new Promise((resolve) => {
          exec(command, { timeout, cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
              resolve({ success: false, result: `执行失败: ${error.message}` });
            } else {
              let result = stdout || stderr;
              if (result.length > 3000) {
                result = result.slice(0, 3000) + '\n...[输出已截断]';
              }
              resolve({ success: true, result });
            }
          });
        });
      }

      case 'get_time': {
        const timezone = args.timezone || 'Asia/Shanghai';
        const now = new Date().toLocaleString('zh-CN', { timeZone: timezone });
        return { success: true, result: `当前时间 (${timezone}): ${now}` };
      }

      default:
        return { success: false, result: `未知工具: ${name}` };
    }
  } catch (error) {
    return { success: false, result: `工具执行失败: ${error.message}` };
  }
}

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || 'http://192.168.111.90:8016/v1';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 带工具调用的 LLM 对话
async function chatWithTools(messages, context = {}) {
  const response = await axios.post(
    `${LLM_BASE_URL}/chat/completions`,
    {
      model: LLM_MODEL,
      messages,
      tools: tools,
      temperature: 0.7,
      max_tokens: 4000
    },
    {
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 180000
    }
  );

  const result = response.data.choices[0].message;
  
  // 如果有工具调用，执行工具并继续对话
  if (result.tool_calls && result.tool_calls.length > 0) {
    const toolResults = [];
    
    for (const toolCall of result.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);
      
      const toolResult = await executeTool(toolName, toolArgs, context);
      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        content: JSON.stringify(toolResult)
      });
    }
    
    // 将工具结果添加到消息中，继续对话
    const newMessages = [
      ...messages,
      result,
      ...toolResults
    ];
    
    // 递归调用直到没有工具调用
    return chatWithTools(newMessages, context);
  }
  
  return result.content;
}

module.exports = {
  tools,
  executeTool,
  chatWithTools
};
