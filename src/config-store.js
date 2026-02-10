const fs = require('fs');
const path = require('path');

class ConfigStore {
  constructor(userDataPath) {
    this.configPath = path.join(userDataPath, 'monitor-config.json');
  }

  getDefaultConfig() {
    return {
      autoRunAfterSeconds: 30,
      launchAtLogin: false,
      paused: false,
      pages: [],
    };
  }

  load() {
    if (!fs.existsSync(this.configPath)) {
      return this.getDefaultConfig();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return {
        ...this.getDefaultConfig(),
        ...parsed,
        pages: Array.isArray(parsed.pages) ? parsed.pages : [],
      };
    } catch (error) {
      console.error('[配置] 配置文件读取失败，回退默认配置', error);
      return this.getDefaultConfig();
    }
  }

  save(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
  }
}

module.exports = ConfigStore;
