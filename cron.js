/**
 * 定时任务系统
 * 
 * 功能：
 * - 支持 cron 表达式
 * - 定时执行任务（调用 LLM、发送消息等）
 * - 持久化任务列表
 * - 任务执行日志
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// LLM 配置
const LLM_BASE_URL = env.LLM_BASE_URL || 'http://192.168.111.90:8016/v1';
const LLM_API_KEY = env.LLM_API_KEY || '';
const LLM_MODEL = env.LLM_MODEL || 'claude-opus-4-6';

// 任务存储目录
const CRON_DIR = path.join(__dirname, 'data', 'cron');
const CRON_LOG_DIR = path.join(__dirname, 'data', 'cron-logs');

// 确保目录存在
function ensureDirs() {
  if (!fs.existsSync(CRON_DIR)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
  }
  if (!fs.existsSync(CRON_LOG_DIR)) {
    fs.mkdirSync(CRON_LOG_DIR, { recursive: true });
  }
}

// 加载所有任务
function loadTasks() {
  ensureDirs();
  const tasksFile = path.join(CRON_DIR, 'tasks.json');
  if (fs.existsSync(tasksFile)) {
    return JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  }
  return [];
}

// 保存任务
function saveTasks(tasks) {
  ensureDirs();
  const tasksFile = path.join(CRON_DIR, 'tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
}

// 解析 cron 表达式
function parseCron(cronStr) {
  const parts = cronStr.split(' ');
  if (parts.length < 5) return null;
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    // 下次执行时间
    getNextRun() {
      const now = new Date();
      const next = new Date(now);
      
      // 简单实现：支持 * 和具体数值
      // 完整版需要更复杂的解析
      
      return next;
    }
  };
}

// 检查是否匹配当前时间
function matchesNow(cronStr) {
  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1;
  const dayOfWeek = now.getDay();
  
  const parts = cronStr.split(' ');
  if (parts.length < 5) return false;
  
  const [min, hr, dom, mon, dow] = parts;
  
  const match = (pattern, value) => {
    if (pattern === '*') return true;
    if (pattern.includes(',')) {
      return pattern.split(',').map(Number).includes(value);
    }
    if (pattern.includes('-')) {
      const [start, end] = pattern.split('-').map(Number);
      return value >= start && value <= end;
    }
    return parseInt(pattern) === value;
  };
  
  return (
    match(min, minute) &&
    match(hr, hour) &&
    match(dom, dayOfMonth) &&
    match(mon, month) &&
    match(dow, dayOfWeek)
  );
}

// 执行任务
async function executeTask(task) {
  console.log(`[Cron] 执行任务: ${task.id} - ${task.name}`);
  
  const logFile = path.join(CRON_LOG_DIR, `${task.id}.log`);
  const startTime = new Date().toISOString();
  
  try {
    let result = '';
    
    if (task.type === 'llm') {
      // 调用 LLM
      const axios = require('axios');
      const response = await axios.post(
        `${LLM_BASE_URL}/chat/completions`,
        {
          model: LLM_MODEL,
          messages: [
            { role: 'system', content: task.systemPrompt || '你是一个有用的AI助手' },
            { role: 'user', content: task.prompt || task.message }
          ],
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
      result = response.data.choices[0].message.content;
    } else if (task.type === 'http') {
      // HTTP 请求
      const axios = require('axios');
      const response = await axios({
        method: task.method || 'GET',
        url: task.url,
        data: task.body ? JSON.parse(task.body) : undefined,
        headers: { 'Content-Type': 'application/json' }
      });
      result = JSON.stringify(response.data);
    } else if (task.type === 'command') {
      // 执行命令
      const { exec } = require('child_process');
      result = await new Promise((resolve) => {
        exec(task.command, { timeout: 60000 }, (err, stdout, stderr) => {
          resolve(err ? `错误: ${err.message}` : (stdout || stderr));
        });
      });
    }
    
    const endTime = new Date().toISOString();
    const log = `[${startTime}] 开始\n[${endTime}] 完成\n结果: ${result.slice(0, 1000)}`;
    fs.writeFileSync(logFile, log);
    
    console.log(`[Cron] 任务完成: ${task.id}`);
    return { success: true, result };
    
  } catch (error) {
    const endTime = new Date().toISOString();
    const log = `[${startTime}] 开始\n[${endTime}] 错误\n错误: ${error.message}`;
    fs.writeFileSync(logFile, log);
    
    console.error(`[Cron] 任务失败: ${task.id}`, error.message);
    return { success: false, error: error.message };
  }
}

// 定时任务运行器
class CronRunner {
  constructor() {
    this.tasks = [];
    this.running = false;
    this.interval = null;
  }
  
  start() {
    if (this.running) return;
    
    this.tasks = loadTasks();
    this.running = true;
    
    // 每分钟检查一次
    this.interval = setInterval(() => this.check(), 60000);
    console.log(`[Cron] 定时任务系统已启动，共 ${this.tasks.length} 个任务`);
  }
  
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
    console.log('[Cron] 定时任务系统已停止');
  }
  
  check() {
    for (const task of this.tasks) {
      if (!task.enabled) continue;
      if (matchesNow(task.cron)) {
        executeTask(task);
      }
    }
  }
  
  addTask(task) {
    const id = Date.now().toString(36);
    const newTask = {
      id,
      name: task.name,
      type: task.type || 'llm',
      cron: task.cron,
      prompt: task.prompt || task.message || '',
      systemPrompt: task.systemPrompt || '',
      enabled: true,
      createdAt: new Date().toISOString()
    };
    
    this.tasks.push(newTask);
    saveTasks(this.tasks);
    
    console.log(`[Cron] 添加任务: ${id} - ${newTask.name}`);
    return newTask;
  }
  
  removeTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    saveTasks(this.tasks);
    console.log(`[Cron] 删除任务: ${id}`);
  }
  
  listTasks() {
    return this.tasks;
  }
  
  runTask(id) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      return executeTask(task);
    }
    return { success: false, error: '任务不存在' };
  }
}

const cronRunner = new CronRunner();

module.exports = function(app) {
  // 启动定时任务
  cronRunner.start();
  
  // API 接口
  
  // 列出所有任务
  app.get('/api/cron/list', (req, res) => {
    res.json({ success: true, tasks: cronRunner.listTasks() });
  });
  
  // 添加任务
  app.post('/api/cron/add', (req, res) => {
    const task = req.body;
    if (!task.name || !task.cron) {
      return res.json({ success: false, error: '缺少必要参数: name, cron' });
    }
    
    const newTask = cronRunner.addTask(task);
    res.json({ success: true, task: newTask });
  });
  
  // 删除任务
  app.delete('/api/cron/:id', (req, res) => {
    const { id } = req.params;
    cronRunner.removeTask(id);
    res.json({ success: true });
  });
  
  // 立即执行任务
  app.post('/api/cron/run/:id', async (req, res) => {
    const { id } = req.params;
    const result = await cronRunner.runTask(id);
    res.json({ success: true, result });
  });
  
  // 获取任务日志
  app.get('/api/cron/log/:id', (req, res) => {
    const { id } = req.params;
    const logFile = path.join(CRON_LOG_DIR, `${id}.log`);
    if (fs.existsSync(logFile)) {
      res.json({ success: true, log: fs.readFileSync(logFile, 'utf8') });
    } else {
      res.json({ success: false, error: '日志不存在' });
    }
  });
  
  // 停止/启动定时任务
  app.post('/api/cron/stop', (req, res) => {
    cronRunner.stop();
    res.json({ success: true });
  });
  
  app.post('/api/cron/start', (req, res) => {
    cronRunner.start();
    res.json({ success: true });
  });
  
  console.log('[Cron] 定时任务模块已加载');
};
