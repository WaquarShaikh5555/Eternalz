'use strict';

/**
 * Storage factory.
 *
 * Chooses a driver based on STORAGE_DRIVER:
 *   auto   -> sqlite when `node:sqlite` is available, otherwise json
 *   sqlite -> sqlite (falls back to json with a warning if unavailable)
 *   json   -> json
 *
 * Both drivers implement the same interface, so the rest of the bot never
 * needs to know which one is active.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');

const { JsonStore } = require('./json-driver');
const { SqliteStore } = require('./sqlite-driver');

async function createStore(config, logger) {
  const driver = (config.storageDriver || 'auto').toLowerCase();
  const dataDir = config.dataDir;
  await fsp.mkdir(dataDir, { recursive: true });

  const sqliteFile = path.join(dataDir, 'eternalz.db');
  const sqliteAvailable = SqliteStore.isAvailable();

  if (driver === 'json' || !sqliteAvailable) {
    if (driver === 'sqlite' && !sqliteAvailable) {
      logger?.warn?.(
        'storage: node:sqlite is not available on this Node.js version - falling back to the json driver',
        { nodeVersion: process.version },
      );
    } else {
      logger?.info?.('storage: using json driver', { file: config.storageFile });
    }
    const store = new JsonStore({ file: config.storageFile, logger });
    await store.init();
    return store;
  }

  try {
    const store = new SqliteStore({ file: sqliteFile, logger });
    await store.init();
    return store;
  } catch (err) {
    logger?.error?.('storage: sqlite failed to start - falling back to json', {
      reason: err.message,
    });
    const store = new JsonStore({ file: config.storageFile, logger });
    await store.init();
    return store;
  }
}

module.exports = { createStore };
