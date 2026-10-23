'use strict';

/**
 * SQLite storage driver built on Node's built-in `node:sqlite` module
 * (available from Node.js 22.5, unflagged from 23.4 / 24).
 *
 * Using the built-in module means there is **no native compilation and no
 * extra npm dependency**, which matters on small shared hosts where a native
 * build step may be unavailable.
 *
 * If `node:sqlite` cannot be loaded the driver reports `available === false`
 * and the storage factory falls back to the JSON driver.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_plans (
  id           TEXT PRIMARY KEY,
  guild_id     TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  actions      TEXT NOT NULL,
  risk         TEXT NOT NULL,
  reasons      TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  confirmed_at INTEGER,
  executed_at  INTEGER,
  result       TEXT,
  permission_gaps TEXT
);

CREATE TABLE IF NOT EXISTS ai_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  requester_id TEXT,
  event        TEXT NOT NULL,
  prompt       TEXT,
  summary      TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id    TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, key)
);

CREATE INDEX IF NOT EXISTS idx_ai_plans_guild ON ai_plans (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_guild ON ai_audit (guild_id, created_at DESC);
`;

class SqliteStore {
  /**
   * @param {object} options
   * @param {string} options.file path to the sqlite database file
   */
  constructor(options = {}) {
    this.file = options.file;
    this.logger = options.logger;
    this.db = null;
  }

  static isAvailable() {
    try {
      // eslint-disable-next-line global-require
      require('node:sqlite');
      return true;
    } catch {
      return false;
    }
  }

  get name() {
    return 'sqlite';
  }

  async init() {
    // eslint-disable-next-line global-require
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.#migrate();
    this.logger?.info?.('storage: sqlite store ready', { file: this.file });
  }

  /** Add columns that newer versions introduced, if they are missing. */
  #migrate() {
    const columns = this.db.prepare('PRAGMA table_info(ai_plans)').all();
    if (!columns.some((c) => c.name === 'permission_gaps')) {
      this.db.exec('ALTER TABLE ai_plans ADD COLUMN permission_gaps TEXT');
    }
  }

  async close() {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }

  // --- plans -------------------------------------------------------------
  async putPlan(plan) {
    this.db
      .prepare(
        `INSERT INTO ai_plans
          (id, guild_id, requester_id, prompt, actions, risk, reasons, status, created_at, expires_at, confirmed_at, executed_at, result, permission_gaps)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          prompt=excluded.prompt, actions=excluded.actions, risk=excluded.risk,
          reasons=excluded.reasons, status=excluded.status, expires_at=excluded.expires_at,
          confirmed_at=excluded.confirmed_at, executed_at=excluded.executed_at, result=excluded.result,
          permission_gaps=excluded.permission_gaps`,
      )
      .run(
        plan.id,
        plan.guildId,
        plan.requesterId,
        plan.prompt,
        JSON.stringify(plan.actions),
        plan.risk,
        JSON.stringify(plan.reasons || []),
        plan.status,
        plan.createdAt,
        plan.expiresAt,
        plan.confirmedAt ?? null,
        plan.executedAt ?? null,
        plan.result === undefined ? null : JSON.stringify(plan.result),
        plan.permissionGaps === undefined ? null : JSON.stringify(plan.permissionGaps),
      );
    return plan;
  }

  async getPlan(id) {
    const row = this.db.prepare('SELECT * FROM ai_plans WHERE id = ?').get(id);
    return row ? rowToPlan(row) : null;
  }

  async updatePlan(id, patch) {
    const existing = await this.getPlan(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.putPlan(merged);
    return merged;
  }

  async listPlans(guildId, limit = 20) {
    const rows = guildId
      ? this.db
          .prepare('SELECT * FROM ai_plans WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(guildId, limit)
      : this.db.prepare('SELECT * FROM ai_plans ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(rowToPlan);
  }

  async deletePlan(id) {
    this.db.prepare('DELETE FROM ai_plans WHERE id = ?').run(id);
  }

  // --- audit -------------------------------------------------------------
  async addAudit(entry) {
    const stmt = this.db.prepare(
      'INSERT INTO ai_audit (guild_id, requester_id, event, prompt, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const info = stmt.run(
      entry.guildId,
      entry.requesterId ?? null,
      entry.event,
      entry.prompt ?? null,
      entry.summary === undefined ? null : JSON.stringify(entry.summary),
      entry.createdAt ?? Date.now(),
    );
    return { id: Number(info.lastInsertRowid), ...entry };
  }

  async listAudit(guildId, limit = 25) {
    const rows = guildId
      ? this.db
          .prepare('SELECT * FROM ai_audit WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
          .all(guildId, limit)
      : this.db.prepare('SELECT * FROM ai_audit ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      requesterId: row.requester_id,
      event: row.event,
      prompt: row.prompt,
      summary: row.summary ? JSON.parse(row.summary) : null,
      createdAt: row.created_at,
    }));
  }

  // --- settings ----------------------------------------------------------
  async getSetting(guildId, key) {
    const row = this.db
      .prepare('SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?')
      .get(guildId, key);
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  async setSetting(guildId, key, value) {
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      )
      .run(guildId, key, JSON.stringify(value ?? null), Date.now());
  }
}

function rowToPlan(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    requesterId: row.requester_id,
    prompt: row.prompt,
    actions: safeParse(row.actions, []),
    risk: row.risk,
    reasons: safeParse(row.reasons, []),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at ?? null,
    executedAt: row.executed_at ?? null,
    result: row.result ? safeParse(row.result, null) : null,
    permissionGaps: row.permission_gaps ? safeParse(row.permission_gaps, null) : null,
  };
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

module.exports = { SqliteStore };
