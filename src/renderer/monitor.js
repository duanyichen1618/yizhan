const pageList = document.getElementById('pageList');
const logBox = document.getElementById('logBox');
const countdown = document.getElementById('countdown');
const addPageBtn = document.getElementById('addPageBtn');
const saveBtn = document.getElementById('saveBtn');
const runBtn = document.getElementById('runBtn');
const pauseBtn = document.getElementById('pauseBtn');

let config = {
  autoRunAfterSeconds: 30,
  launchAtLogin: false,
  paused: false,
  pages: [],
};

function createListener() {
  return {
    id: crypto.randomUUID(),
    name: '新监听器',
    urlKeyword: '',
    headerKey: '',
    primaryKey: '',
  };
}

function createPage() {
  return {
    id: crypto.randomUUID(),
    name: '新页面',
    url: '',
    refreshSeconds: 30,
    headless: false,
    listeners: [createListener()],
    login: {
      enabled: false,
      auto: false,
      headless: false,
      loginTypeSelector: '',
      usernameSelector: '',
      username: '',
      passwordSelector: '',
      password: '',
      submitSelector: '',
    },
  };
}

function updateField(page, path, value) {
  const keys = path.split('.');
  let target = page;
  while (keys.length > 1) {
    target = target[keys.shift()];
  }
  target[keys[0]] = value;
}

function bindInput(root, selector, onChange) {
  root.querySelectorAll(selector).forEach((el) => {
    el.addEventListener('change', onChange);
  });
}

function render() {
  pageList.innerHTML = '';

  config.pages.forEach((page) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="field"><label>页面名称</label><input data-field="name" value="${page.name}" /></div>
      <div class="field"><label>URL</label><input data-field="url" value="${page.url}" /></div>
      <div class="field"><label>刷新时间(秒)</label><input data-field="refreshSeconds" type="number" min="3" value="${page.refreshSeconds}" /></div>
      <div class="field"><label>页面无头模式</label><select data-field="headless"><option value="false">否</option><option value="true">是</option></select></div>
      <div class="sub-title">登录配置</div>
      <div class="field"><label>启用登录</label><select data-field="login.enabled"><option value="false">否</option><option value="true">是</option></select></div>
      <div class="field"><label>自动登录</label><select data-field="login.auto"><option value="false">否</option><option value="true">是</option></select></div>
      <div class="field"><label>登录无头模式</label><select data-field="login.headless"><option value="false">否</option><option value="true">是</option></select></div>
      <div class="field"><label>登录类型选择器</label><input data-field="login.loginTypeSelector" value="${page.login.loginTypeSelector}" /><button class="pick-btn" data-path="login.loginTypeSelector">选择器</button></div>
      <div class="field"><label>用户名选择器</label><input data-field="login.usernameSelector" value="${page.login.usernameSelector}" /><button class="pick-btn" data-path="login.usernameSelector">选择器</button></div>
      <div class="field"><label>用户名</label><input data-field="login.username" value="${page.login.username}" /></div>
      <div class="field"><label>密码选择器</label><input data-field="login.passwordSelector" value="${page.login.passwordSelector}" /><button class="pick-btn" data-path="login.passwordSelector">选择器</button></div>
      <div class="field"><label>密码</label><input data-field="login.password" type="password" value="${page.login.password}" /></div>
      <div class="field"><label>登录按钮选择器</label><input data-field="login.submitSelector" value="${page.login.submitSelector}" /><button class="pick-btn" data-path="login.submitSelector">选择器</button></div>
      <div class="sub-title">监听器配置</div>
      <div class="listeners"></div>
      <div class="actions">
        <button class="add-listener">新增监听器</button>
        <button class="run-page">确认并运行该页面</button>
        <button class="secondary remove-page">删除页面</button>
      </div>
    `;

    card.querySelectorAll('select').forEach((select) => {
      if (select.dataset.field === 'headless') select.value = String(page.headless);
      if (select.dataset.field === 'login.enabled') select.value = String(page.login.enabled);
      if (select.dataset.field === 'login.auto') select.value = String(page.login.auto);
      if (select.dataset.field === 'login.headless') select.value = String(page.login.headless);
    });

    bindInput(card, '[data-field]', (event) => {
      const field = event.target.dataset.field;
      const rawValue = event.target.value;
      let value = rawValue;
      if (rawValue === 'true' || rawValue === 'false') {
        value = rawValue === 'true';
      } else if (field === 'refreshSeconds') {
        value = Number(rawValue || 30);
      }
      updateField(page, field, value);
    });

    card.querySelector('.add-listener').addEventListener('click', () => {
      page.listeners.push(createListener());
      render();
    });

    card.querySelector('.remove-page').addEventListener('click', () => {
      config.pages = config.pages.filter((item) => item.id !== page.id);
      render();
    });

    card.querySelector('.run-page').addEventListener('click', async () => {
      await window.monitorApi.run({ ...config, pages: [page] });
      log(`[操作反馈] 页面 ${page.name} 已按新配置启动`);
    });

    card.querySelectorAll('.pick-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { selector } = await window.monitorApi.pickSelector(page.id);
        updateField(page, btn.dataset.path, selector);
        render();
        log(`[元素选择器] 已复制并填入 ${btn.dataset.path}: ${selector}`);
      });
    });

    const listenersDiv = card.querySelector('.listeners');
    page.listeners.forEach((listener) => {
      const row = document.createElement('div');
      row.className = 'listener-row';
      row.innerHTML = `
        <div class="field"><label>监听器名称</label><input data-k="name" value="${listener.name}" /></div>
        <div class="field"><label>请求URL关键词</label><input data-k="urlKeyword" value="${listener.urlKeyword}" /></div>
        <div class="field"><label>Header键名</label><input data-k="headerKey" value="${listener.headerKey}" /></div>
        <div class="field"><label>主键</label><input data-k="primaryKey" value="${listener.primaryKey}" /></div>
        <button class="danger remove-listener">删除监听器</button>
      `;
      row.querySelectorAll('input').forEach((input) => {
        input.addEventListener('change', (event) => {
          listener[event.target.dataset.k] = event.target.value;
        });
      });
      row.querySelector('.remove-listener').addEventListener('click', () => {
        page.listeners = page.listeners.filter((item) => item.id !== listener.id);
        render();
      });
      listenersDiv.appendChild(row);
    });

    pageList.appendChild(card);
  });
}

function log(text) {
  logBox.textContent = `${new Date().toLocaleTimeString()} ${text}\n${logBox.textContent}`;
}

addPageBtn.addEventListener('click', () => {
  config.pages.push(createPage());
  render();
});

saveBtn.addEventListener('click', async () => {
  await window.monitorApi.saveConfig(config);
  log('[操作反馈] 配置已保存到本地文件');
});

runBtn.addEventListener('click', async () => {
  await window.monitorApi.run(config);
  log('[操作反馈] 全部页面监听已启动');
});

pauseBtn.addEventListener('click', async () => {
  await window.monitorApi.pause();
  log('[操作反馈] 已暂停全部监听');
});

window.monitorApi.onLog((msg) => log(msg));
window.monitorApi.onCountdown((n) => {
  countdown.textContent = `自动运行倒计时：${n}s`;
});

(async () => {
  const loaded = await window.monitorApi.getConfig();
  config = loaded?.pages ? loaded : config;
  if (!config.pages.length) config.pages.push(createPage());
  render();
})();
