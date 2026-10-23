'use strict';

/**
 * JSON file storage driver.
 *
 * A dependency-free fallback used when `node:sqlite` is unavailable (older
 * Node.js) or when STORAGE_DRIVER=json. Data is held in memory and flushed to
 * disk atomically (write temp file, then rename) so a crash cannot leave a
 * half-written file behind.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const EMPTY = { plans: {}, audit: [], settings: {} };

class JsonStore {
  constructor(options = {}) {
    this.file = options.file || path.join(process.cwd(), 'data', 'eternalz-store.json');
    this.logger = options.logger;
    this.data = structuredClone(EMPTY);
    this.writeQueue = Promise.resolve();
    this.closed = false;
  }

  get name() {
    return 'json';
  }

  async init() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        plans: parsed.plans || {},
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
        settings: parsed.settings || {},
      };
      this.logger?.info?.('storage: loaded json store', { file: this.file });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger?.warn?.('storage: could not read json store, starting empty', {
          file: this.file,
          reason: err.message,
        });
      }
      this.data = structuredClone(EMPTY);
      await this.flush();
    }
  }

  async flush() {
    if (this.closed) return;
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      const payload = JSON.stringify(this.data, null, 2);
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(tmp, payload, 'utf8');
      await fsp.rename(tmp, this.file);
    }).catch((err) => {
      this.logger?.error?.('storage: failed to persist json store', { reason: err.message });
    });
    return this.writeQueue;
  }

  async close() {
    await this.flush();
    this.closed = true;
  }

  // --- plans -------------------------------------------------------------
  async putPlan(plan) {
    this.data.plans[plan.id] = plan;
    await this.flush();
    return plan;
  }

  async getPlan(id) {
    const plan = this.data.plans[id];
    return plan ? structuredClone(plan) : null;
  }

  async updatePlan(id, patch) {
    const existing = this.data.plans[id];
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.data.plans[id] = updated;
    await this.flush();
    return structuredClone(updated);
  }

  async listPlans(guildId, limit = 20) {
    return Object.values(this.data.plans)
      .filter((p) => !guildId || p.guildId === guildId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((p) => structuredClone(p));
  }

  async deletePlan(id) {
    delete this.data.plans[id];
    await this.flush();
  }

  // --- audit -------------------------------------------------------------
  async addAudit(entry) {
    const row = { id: this.nextAuditId(), ...entry };
    this.data.audit.push(row);
    // Keep the on-disk log bounded so it cannot fill a small container.
    if (this.data.audit.length > 2000) {
      this.data.audit.splice(0, this.data.audit.length - 2000);
    }
    await this.flush();
    return row;
  }

  nextAuditId() {
    return this.data.audit.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1;
  }

  async listAudit(guildId, limit = 25) {
    return this.data.audit
      .filter((row) => !guildId || row.guildId === guildId)
      .slice(-limit)
      .reverse()
      .map((row) => structuredClone(row));
  }

  // --- settings ----------------------------------------------------------
  async getSetting(guildId, key) {
    const bucket = this.data.settings[guildId];
    if (!bucket) return null;
    const value = bucket[key];
    return value === undefined ? null : structuredClone(value);
  }

  async setSetting(guildId, key, value) {
    if (!this.data.settings[guildId]) this.data.settings[guildId] = {};
    this.data.settings[guildId][key] = value;
    await this.flush();
  }

  /** Synchronous best-effort flush for shutdown hooks. */
  flushSync() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      /* ignore */
    }
  }
}

module.exports = { JsonStore };
