/**
 * 轻量级插件系统
 * 
 * 插件目录: ./plugins/
 * 插件结构:
 *   plugins/
 *   ├── my-plugin/
 *   │   ├── index.js      # 插件入口
 *   │   ├── manifest.json # 插件配置
 *   │   └── ...
 * 
 * manifest.json 格式:
 * {
 *   "name": "插件名称",
 *   "version": "1.0.0",
 *   "description": "插件描述",
 *   "author": "作者",
 *   "hooks": ["before_message", "after_message", "on_start", "on_stop"],
 *   "dependencies": {}
 * }
 */

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

// 插件目录
const PLUGINS_DIR = path.join(__dirname, 'plugins');

// 插件系统类
class PluginSystem {
  constructor() {
    this.plugins = new Map();
    this.hooks = {
      before_message: [],
      after_message: [],
      before_llm: [],
      after_llm: [],
      on_start: [],
      on_stop: [],
      on_tool_call: [],
      on_cron: []
    };
    this.api = null;
  }
  
  // 初始化 API
  initApi(gatewayApi) {
    this.api = {
      // 注册钩子
      registerHook: (event, handler) => {
        if (this.hooks[event]) {
          this.hooks[event].push(handler);
        }
      },
      
      // 发送消息
      sendMessage: (channel, to, content) => {
        // 通过网关发送消息
        console.log(`[Plugin] 发送消息到 ${channel}: ${content.slice(0, 50)}`);
        return { success: true };
      },
      
      // 调用 LLM
      callLLM: async (messages, options = {}) => {
        const axios = require('axios');
        const LLM_BASE_URL = env.LLM_BASE_URL || 'http://192.168.111.90:8016/v1';
        const LLM_API_KEY = env.LLM_API_KEY || '';
        const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';
        
        const response = await axios.post(
          `${LLM_BASE_URL}/chat/completions`,
          {
            model: options.model || LLM_MODEL,
            messages,
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 2000,
            ...options
          },
          {
            headers: {
              'Authorization': `Bearer ${LLM_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: options.timeout || 120000
          }
        );
        
        return response.data.choices[0].message.content;
      },
      
      // 获取配置
      getConfig: (key, defaultValue) => {
        return env[key] || defaultValue;
      },
      
      // 存储
      storage: {
        get: (key) => {
          const storageFile = path.join(PLUGINS_DIR, '.storage.json');
          if (fs.existsSync(storageFile)) {
            const data = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
            return data[key];
          }
          return null;
        },
        set: (key, value) => {
          const storageFile = path.join(PLUGINS_DIR, '.storage.json');
          let data = {};
          if (fs.existsSync(storageFile)) {
            data = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
          }
          data[key] = value;
          fs.writeFileSync(storageFile, JSON.stringify(data, null, 2));
        }
      },
      
      // 日志
      log: {
        info: (...args) => console.log('[Plugin]', ...args),
        warn: (...args) => console.warn('[Plugin]', ...args),
        error: (...args) => console.error('[Plugin]', ...args)
      }
    };
  }
  
  // 加载所有插件
  loadAll() {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      console.log('[Plugin] 插件目录已创建:', PLUGINS_DIR);
      return;
    }
    
    const entries = fs.readdirSync(PLUGINS_DIR);
    
    for (const entry of entries) {
      const pluginPath = path.join(PLUGINS_DIR, entry);
      const stat = fs.statSync(pluginPath);
      
      if (stat.isDirectory()) {
        this.loadPlugin(entry, pluginPath);
      }
    }
    
    console.log(`[Plugin] 已加载 ${this.plugins.size} 个插件`);
  }
  
  // 加载单个插件
  loadPlugin(name, pluginPath) {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const indexPath = path.join(pluginPath, 'index.js');
    
    if (!fs.existsSync(manifestPath)) {
      console.warn(`[Plugin] 插件 ${name} 缺少 manifest.json，跳过`);
      return;
    }
    
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      
      // 检查依赖
      if (manifest.dependencies) {
        for (const [dep, version] of Object.entries(manifest.dependencies)) {
          if (!this.plugins.has(dep)) {
            console.warn(`[Plugin] 插件 ${name} 依赖 ${dep} 未安装，跳过`);
            return;
          }
        }
      }
      
      // 加载插件代码
      let plugin = null;
      if (fs.existsSync(indexPath)) {
        plugin = require(indexPath);
      }
      
      // 初始化插件
      const pluginInstance = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        path: pluginPath,
        manifest,
        instance: plugin
      };
      
      // 注册钩子
      if (manifest.hooks && Array.isArray(manifest.hooks)) {
        for (const hook of manifest.hooks) {
          if (this.hooks[hook]) {
            // 插件可以提供一个函数，或者在钩子数组中指定
          }
        }
      }
      
      // 如果插件有 register 方法，调用它
      if (plugin && typeof plugin.register === 'function') {
        plugin.register(this.api, manifest);
      }
      
      this.plugins.set(name, pluginInstance);
      console.log(`[Plugin] 加载插件: ${manifest.name} v${manifest.version}`);
      
    } catch (error) {
      console.error(`[Plugin] 加载插件 ${name} 失败:`, error.message);
    }
  }
  
  // 触发钩子
  async triggerHook(event, data) {
    const handlers = this.hooks[event] || [];
    let result = data;
    
    for (const handler of handlers) {
      try {
        if (typeof handler === 'function') {
          result = await handler(result) || result;
        }
      } catch (error) {
        console.error(`[Plugin] 钩子 ${event} 执行失败:`, error.message);
      }
    }
    
    return result;
  }
  
  // 卸载插件
  unloadPlugin(name) {
    const plugin = this.plugins.get(name);
    if (plugin && typeof plugin.instance?.unload === 'function') {
      plugin.instance.unload(this.api);
    }
    this.plugins.delete(name);
    console.log(`[Plugin] 卸载插件: ${name}`);
  }
  
  // 列出插件
  listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author
    }));
  }
}

const pluginSystem = new PluginSystem();

module.exports = function(app) {
  // 初始化插件 API
  pluginSystem.initApi({});
  
  // 加载所有插件
  pluginSystem.loadAll();
  
  // 触发钩子（供其他模块调用）
  pluginSystem.triggerHook = pluginSystem.triggerHook.bind(pluginSystem);
  
  // API 接口
  
  // 列出插件
  app.get('/api/plugins/list', (req, res) => {
    res.json({ success: true, plugins: pluginSystem.listPlugins() });
  });
  
  // 加载插件
  app.post('/api/plugins/load/:name', (req, res) => {
    const { name } = req.params;
    const pluginPath = path.join(PLUGINS_DIR, name);
    
    if (!fs.existsSync(pluginPath)) {
      return res.json({ success: false, error: '插件不存在' });
    }
    
    pluginSystem.loadPlugin(name, pluginPath);
    res.json({ success: true });
  });
  
  // 卸载插件
  app.post('/api/plugins/unload/:name', (req, res) => {
    const { name } = req.params;
    pluginSystem.unloadPlugin(name);
    res.json({ success: true });
  });
  
  // 重新加载插件
  app.post('/api/plugins/reload', (req, res) => {
    pluginSystem.loadAll();
    res.json({ success: true });
  });
  
  // 创建示例插件
  app.post('/api/plugins/create', (req, res) => {
    const { name, description } = req.body;
    
    if (!name) {
      return res.json({ success: false, error: '缺少插件名称' });
    }
    
    const pluginPath = path.join(PLUGINS_DIR, name);
    if (fs.existsSync(pluginPath)) {
      return res.json({ success: false, error: '插件已存在' });
    }
    
    // 创建插件目录
    fs.mkdirSync(pluginPath, { recursive: true });
    
    // 创建 manifest.json
    const manifest = {
      name,
      version: '1.0.0',
      description: description || '这是一个新插件',
      author: 'mini-openclaw',
      hooks: ['on_start', 'on_stop']
    };
    fs.writeFileSync(
      path.join(pluginPath, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    
    // 创建示例代码
    const exampleCode = `/**
 * \${name} 插件
 */

module.exports = {
  // 注册插件
  register(api, manifest) {
    console.log(\`[Plugin] \${manifest.name} 已加载\`);
    
    // 注册钩子
    api.registerHook('on_start', () => {
      console.log('[Plugin] 插件启动');
    });
    
    api.registerHook('on_stop', () => {
      console.log('[Plugin] 插件停止');
    });
    
    // 注册消息处理钩子
    api.registerHook('before_message', async (message) => {
      console.log('[Plugin] 收到消息:', message);
      return message;
    });
    
    api.registerHook('after_message', async (reply) => {
      console.log('[Plugin] 发送回复:', reply);
      return reply;
    });
  },
  
  // 卸载插件
  unload(api) {
    console.log('[Plugin] 插件已卸载');
  }
};
`;
    fs.writeFileSync(path.join(pluginPath, 'index.js'), exampleCode);
    
    res.json({ success: true, path: pluginPath });
  });
  
  console.log('[Plugin] 插件系统已加载');
};

// 导出供其他模块使用
module.exports.pluginSystem = pluginSystem;
