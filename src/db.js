const path = require('path');
const sqlite3 = require('sqlite3').verbose();

class DatabaseService {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'inventory_sync.db');
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.db.serialize(() => {
          this.db.run(
            `CREATE TABLE IF NOT EXISTS captured_headers (
              key TEXT PRIMARY KEY,
              value TEXT,
              page_id TEXT,
              listener_name TEXT,
              updated_at TEXT
            )`,
          );
          this.db.run(
            `CREATE TABLE IF NOT EXISTS sync_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT,
              message TEXT,
              created_at TEXT
            )`,
            (createErr) => {
              if (createErr) {
                reject(createErr);
                return;
              }
              resolve();
            },
          );
        });
      });
    });
  }

  upsertCapturedHeader({ key, value, pageId, listenerName }) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO captured_headers (key, value, page_id, listener_name, updated_at)
                   VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
                   ON CONFLICT(key) DO UPDATE SET
                     value=excluded.value,
                     page_id=excluded.page_id,
                     listener_name=excluded.listener_name,
                     updated_at=datetime('now', 'localtime')`;
      this.db.run(sql, [key, value, pageId, listenerName], (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  listCapturedHeaders() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT key, value, page_id as pageId, listener_name as listenerName, updated_at as updatedAt FROM captured_headers ORDER BY updated_at DESC',
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        },
      );
    });
  }

  appendLog(type, message) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT INTO sync_log (type, message, created_at) VALUES (?, ?, datetime('now', 'localtime'))",
        [type, message],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        },
      );
    });
  }
}

module.exports = DatabaseService;
