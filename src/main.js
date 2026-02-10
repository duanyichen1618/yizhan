const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const DatabaseService = require('./db');
const ConfigStore = require('./config-store');
const MonitorManager = require('./monitor-manager');

let mainWindow;
let monitorWindow;
let tray;
let appConfig;
let autoRunTimer = null;

const configStore = new ConfigStore(app.getPath('userData'));
const dbService = new DatabaseService(app.getPath('userData'));
const monitorManager = new MonitorManager(dbService, (message) => {
  console.log(message);
  dbService.appendLog('monitor', message).catch(() => {});
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    monitorWindow.webContents.send('monitor:log', message);
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/main.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[托盘] 主窗口关闭改为隐藏');
    }
  });
}

function createMonitorWindow() {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    monitorWindow.focus();
    return;
  }

  monitorWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload-monitor.js'),
    },
  });

  monitorWindow.loadFile(path.join(__dirname, 'renderer/monitor.html'));
  monitorWindow.on('closed', () => {
    monitorWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('库存同步工具');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主页',
        click: () => mainWindow.show(),
      },
      {
        label: '打开网页监听',
        click: () => createMonitorWindow(),
      },
      {
        label: '退出',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => mainWindow.show());
}

function buildMenu() {
  const template = [
    {
      label: '功能',
      submenu: [
        { label: '库存同步主页', click: () => mainWindow.show() },
        { label: '网页监听', click: () => createMonitorWindow() },
      ],
    },
    {
      label: '调试',
      submenu: [
        {
          label: '开发者模式',
          click: () => {
            if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
            if (monitorWindow) monitorWindow.webContents.openDevTools({ mode: 'detach' });
            console.log('[调试] 已打开开发者工具');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupIpc() {
  ipcMain.handle('monitor:get-config', async () => appConfig);
  ipcMain.handle('monitor:save-config', async (_, nextConfig) => {
    appConfig = nextConfig;
    configStore.save(appConfig);
    app.setLoginItemSettings({ openAtLogin: !!appConfig.launchAtLogin });
    return { ok: true };
  });

  ipcMain.handle('monitor:run', async (_, config) => {
    appConfig = config;
    configStore.save(appConfig);
    await monitorManager.runConfig(appConfig);
    return { ok: true };
  });

  ipcMain.handle('monitor:pause', async () => {
    await monitorManager.stopAll();
    return { ok: true };
  });

  ipcMain.handle('monitor:pick-selector', async (_, pageId) => {
    const selector = await monitorManager.pickSelector(pageId);
    return { selector };
  });

  ipcMain.handle('db:list-captured', async () => dbService.listCapturedHeaders());
}

function startAutoRunCountdown() {
  let remaining = appConfig.autoRunAfterSeconds || 30;
  if (appConfig.paused) {
    console.log('[自动启动] 当前为暂停状态，跳过倒计时');
    return;
  }

  autoRunTimer = setInterval(async () => {
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.webContents.send('monitor:countdown', remaining);
    }
    if (remaining <= 0) {
      clearInterval(autoRunTimer);
      autoRunTimer = null;
      console.log('[自动启动] 倒计时结束，开始执行监听');
      await monitorManager.runConfig(appConfig);
      return;
    }
    remaining -= 1;
  }, 1000);
}

app.whenReady().then(async () => {
  appConfig = configStore.load();
  await dbService.init();
  createMainWindow();
  createTray();
  buildMenu();
  setupIpc();
  startAutoRunCountdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 托盘模式下保持运行
  }
});
