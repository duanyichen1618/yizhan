const { BrowserWindow } = require('electron');
const puppeteer = require('puppeteer');

function buildInjectSelectorScript() {
  return `
    (() => {
      if (window.__selectorPickingActive) {
        return Promise.resolve({ selector: '', reason: 'already-active' });
      }
      window.__selectorPickingActive = true;
      const getSelector = (el) => {
        if (!el) return '';
        if (el.id) return '#' + el.id;
        const parts = [];
        while (el && el.nodeType === 1 && parts.length < 5) {
          let name = el.nodeName.toLowerCase();
          if (el.className && typeof el.className === 'string') {
            const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (cls) name += '.' + cls;
          }
          parts.unshift(name);
          el = el.parentElement;
        }
        return parts.join(' > ');
      };

      const hoverBox = document.createElement('div');
      hoverBox.style.position = 'fixed';
      hoverBox.style.border = '2px solid #ff3b30';
      hoverBox.style.background = 'rgba(255, 59, 48, 0.1)';
      hoverBox.style.pointerEvents = 'none';
      hoverBox.style.zIndex = '2147483647';
      document.body.appendChild(hoverBox);

      const tooltip = document.createElement('div');
      tooltip.style.position = 'fixed';
      tooltip.style.padding = '4px 6px';
      tooltip.style.background = '#111';
      tooltip.style.color = '#fff';
      tooltip.style.font = '12px monospace';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.zIndex = '2147483647';
      document.body.appendChild(tooltip);

      return new Promise((resolve) => {
        const onMove = (e) => {
          const r = e.target.getBoundingClientRect();
          hoverBox.style.left = r.left + 'px';
          hoverBox.style.top = r.top + 'px';
          hoverBox.style.width = r.width + 'px';
          hoverBox.style.height = r.height + 'px';
          const selector = getSelector(e.target);
          tooltip.textContent = selector;
          tooltip.style.left = (e.clientX + 14) + 'px';
          tooltip.style.top = (e.clientY + 14) + 'px';
        };

        const onClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const selector = getSelector(e.target);
          navigator.clipboard.writeText(selector).catch(() => {});
          teardown();
          resolve({ selector });
        };

        const teardown = () => {
          window.removeEventListener('mousemove', onMove, true);
          window.removeEventListener('click', onClick, true);
          hoverBox.remove();
          tooltip.remove();
          window.__selectorPickingActive = false;
        };

        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('click', onClick, true);
      });
    })();
  `;
}

class MonitorManager {
  constructor(databaseService, logger) {
    this.databaseService = databaseService;
    this.logger = logger;
    this.pageRunners = new Map();
  }

  async stopAll() {
    const allStops = Array.from(this.pageRunners.values()).map((runner) => runner.stop());
    await Promise.allSettled(allStops);
    this.pageRunners.clear();
    this.logger('[网页监听] 已停止全部监听任务');
  }

  async runConfig(config) {
    await this.stopAll();

    for (const pageConfig of config.pages) {
      const runner = pageConfig.headless
        ? await this.createHeadlessRunner(pageConfig)
        : await this.createWindowRunner(pageConfig);

      this.pageRunners.set(pageConfig.id, runner);
      await runner.start();
    }
  }

  getRunner(pageId) {
    return this.pageRunners.get(pageId);
  }

  async pickSelector(pageId) {
    const runner = this.getRunner(pageId);
    if (!runner || !runner.window || runner.window.isDestroyed()) {
      throw new Error('该页面未运行，无法选择元素');
    }

    this.logger(`[元素选择器] 开始选择 pageId=${pageId}`);
    const result = await runner.window.webContents.executeJavaScript(buildInjectSelectorScript(), true);
    this.logger(`[元素选择器] 选择完成 ${result?.selector || ''}`);
    return result?.selector || '';
  }

  async createWindowRunner(pageConfig) {
    let win = null;
    let interval = null;
    let webRequestHandler = null;
    let executingLogin = false;

    const doAutoLogin = async () => {
      if (!pageConfig.login?.enabled || !pageConfig.login?.auto || !win || win.isDestroyed()) {
        return;
      }
      if (executingLogin) {
        return;
      }
      executingLogin = true;

      try {
        const currentUrl = win.webContents.getURL();
        if (currentUrl.startsWith(pageConfig.url)) {
          return;
        }

        this.logger(`[自动登录] 开始执行 page=${pageConfig.name}`);
        const script = `(async () => {
          const cfg = ${JSON.stringify(pageConfig.login)};
          const click = (selector) => {
            if (!selector) return;
            const el = document.querySelector(selector);
            if (el) el.click();
          };
          const input = (selector, val) => {
            if (!selector) return;
            const el = document.querySelector(selector);
            if (el) {
              el.focus();
              el.value = val || '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          if (cfg.loginTypeSelector) click(cfg.loginTypeSelector);
          input(cfg.usernameSelector, cfg.username);
          input(cfg.passwordSelector, cfg.password);
          click(cfg.submitSelector);
        })();`;

        await win.webContents.executeJavaScript(script, true);
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.loadURL(pageConfig.url);
          }
        }, 10000);
      } catch (error) {
        this.logger(`[自动登录] 执行失败 ${error.message}`);
      } finally {
        executingLogin = false;
      }
    };

    const attachRequestListener = () => {
      if (webRequestHandler) {
        return;
      }

      webRequestHandler = async (details) => {
        try {
          for (const listener of pageConfig.listeners || []) {
            if (!details.url.includes(listener.urlKeyword)) {
              continue;
            }
            const headerValue = details.requestHeaders?.[listener.headerKey] || details.requestHeaders?.[listener.headerKey.toLowerCase()];
            if (!headerValue) {
              continue;
            }
            await this.databaseService.upsertCapturedHeader({
              key: listener.primaryKey,
              value: Array.isArray(headerValue) ? headerValue.join(',') : String(headerValue),
              pageId: pageConfig.id,
              listenerName: listener.name,
            });
            this.logger(`[监听命中] 页面=${pageConfig.name} 监听器=${listener.name} 主键=${listener.primaryKey}`);
          }
        } catch (error) {
          this.logger(`[监听错误] ${error.message}`);
        }
      };

      win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, webRequestHandler);
      this.logger(`[监听注册] 已注册请求监听 page=${pageConfig.name}`);
    };

    return {
      window: win,
      start: async () => {
        win = new BrowserWindow({
          width: 1180,
          height: 880,
          autoHideMenuBar: true,
          webPreferences: {
            devTools: true,
          },
        });
        this.logger(`[页面启动] 打开页面 ${pageConfig.name} - ${pageConfig.url}`);
        await win.loadURL(pageConfig.url);
        win.webContents.openDevTools({ mode: 'detach' });

        attachRequestListener();

        win.webContents.on('did-finish-load', () => {
          doAutoLogin();
        });

        const refreshMs = Math.max((pageConfig.refreshSeconds || 15) * 1000, 3000);
        interval = setInterval(() => {
          if (win && !win.isDestroyed()) {
            this.logger(`[页面刷新] ${pageConfig.name}`);
            win.webContents.reloadIgnoringCache();
          }
        }, refreshMs);
      },
      stop: async () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        if (win && !win.isDestroyed()) {
          win.close();
        }
      },
    };
  }

  async createHeadlessRunner(pageConfig) {
    let browser = null;
    let page = null;
    let interval = null;

    const runListeners = async (request) => {
      for (const listener of pageConfig.listeners || []) {
        if (!request.url().includes(listener.urlKeyword)) {
          continue;
        }
        const headers = request.headers();
        const value = headers[listener.headerKey.toLowerCase()];
        if (!value) {
          continue;
        }
        await this.databaseService.upsertCapturedHeader({
          key: listener.primaryKey,
          value: String(value),
          pageId: pageConfig.id,
          listenerName: listener.name,
        });
        this.logger(`[无头监听命中] 页面=${pageConfig.name} 监听器=${listener.name} 主键=${listener.primaryKey}`);
      }
    };

    const doAutoLogin = async () => {
      if (!pageConfig.login?.enabled || !pageConfig.login?.auto || !pageConfig.login?.headless) {
        return;
      }

      const current = page.url();
      if (current.startsWith(pageConfig.url)) {
        return;
      }

      const login = pageConfig.login;
      this.logger(`[无头自动登录] 执行 page=${pageConfig.name}`);
      if (login.loginTypeSelector) {
        await page.click(login.loginTypeSelector).catch(() => {});
      }
      if (login.usernameSelector) {
        await page.type(login.usernameSelector, login.username || '', { delay: 30 }).catch(() => {});
      }
      if (login.passwordSelector) {
        await page.type(login.passwordSelector, login.password || '', { delay: 30 }).catch(() => {});
      }
      if (login.submitSelector) {
        await page.click(login.submitSelector).catch(() => {});
      }

      await new Promise((resolve) => setTimeout(resolve, 10000));
      await page.goto(pageConfig.url, { waitUntil: 'networkidle2' });
    };

    return {
      start: async () => {
        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
        page.on('request', runListeners);
        await page.goto(pageConfig.url, { waitUntil: 'networkidle2' });

        interval = setInterval(async () => {
          try {
            this.logger(`[无头刷新] ${pageConfig.name}`);
            await page.reload({ waitUntil: 'networkidle2' });
            await doAutoLogin();
          } catch (error) {
            this.logger(`[无头刷新失败] ${error.message}`);
          }
        }, Math.max((pageConfig.refreshSeconds || 15) * 1000, 3000));
      },
      stop: async () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        if (browser) {
          await browser.close();
          browser = null;
        }
      },
    };
  }
}

module.exports = MonitorManager;
