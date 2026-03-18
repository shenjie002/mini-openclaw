const puppeteer = require('puppeteer-core');

const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let browser = null;
let page = null;

// 启动浏览器
async function openBrowser(url) {
  if (browser) {
    await closeBrowser();
  }

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });

  return { success: true, url };
}

// 获取页面快照
async function getSnapshot() {
  if (!page) {
    return { success: false, error: 'No page opened' };
  }

  const screenshot = await page.screenshot({ encoding: 'base64' });
  const title = await page.title();
  const url = page.url();

  return {
    success: true,
    screenshot: `data:image/png;base64,${screenshot}`,
    title,
    url
  };
}

// 执行页面操作
async function act(action) {
  if (!page) {
    return { success: false, error: 'No page opened' };
  }

  const { type, selector, value, script } = action;

  switch (type) {
    case 'click':
      await page.click(selector);
      break;
    case 'type':
      await page.type(selector, value);
      break;
    case 'evaluate':
      const result = await page.evaluate(script);
      return { success: true, result };
    default:
      return { success: false, error: `Unknown action: ${type}` };
  }

  return { success: true };
}

// 关闭页面
async function closeBrowser() {
  if (page) {
    await page.close();
    page = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
  return { success: true };
}

// 导出路由处理函数
module.exports = (app) => {
  app.post('/api/browser/open', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, error: 'url is required' });
      }
      const result = await openBrowser(url);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/browser/snapshot', async (req, res) => {
    try {
      const result = await getSnapshot();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/browser/act', async (req, res) => {
    try {
      const action = req.body;
      if (!action.type) {
        return res.status(400).json({ success: false, error: 'action.type is required' });
      }
      const result = await act(action);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/browser/close', async (req, res) => {
    try {
      const result = await closeBrowser();
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
