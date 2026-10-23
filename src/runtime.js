'use strict';

/**
 * Shared runtime services.
 *
 * The bot's command handlers need a few long-lived objects (storage, audit
 * logger, AI provider, rate limiters). They are created once at start-up and
 * exposed here so that commands stay small and testable.
 */

const { createLogger } = require('./core/logger');
const { getConfig, validate, describe } = require('./config/env');
const { createStore } = require('./storage');
const { AuditLogger } = require('./audit/audit');
const { createProviderChain } = require('./ai/provider');
const { RateLimiter, Cooldown } = require('./core/rate-limiter');
const { expireStalePlans } = require('./admin/confirmation');

const runtime = {
  ready: false,
  config: null,
  logger: null,
  storage: null,
  audit: null,
  provider: null,
  providerChain: [],
  limiter: null,
  cooldown: null,
};

/**
 * Initialise everything the AI administration features need.
 * Failure here must never stop the bot from coming online: the ordinary
 * commands have to keep working even when the AI is not configured.
 */
/**
 * `node:sqlite` is still flagged as experimental on Node 22 and prints a
 * warning on every start. Hide just that warning - every other warning is
 * still shown.
 */
function silenceSqliteExperimentalWarning() {
  if (process.env.SHOW_SQLITE_WARNING === '1') return;
  const existing = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && /sqlite/i.test(warning.message)) return;
    for (const listener of existing) listener(warning);
  });
}

async function initRuntime(options = {}) {
  const config = options.config || getConfig();
  silenceSqliteExperimentalWarning();
  runtime.config = config;
  runtime.logger = createLogger({ level: config.logLevel, prefix: 'eternalz' });

  const validation = validate(config);
  for (const warning of validation.warnings) runtime.logger.warn(`startup: ${warning}`);
  for (const error of validation.errors) runtime.logger.error(`startup: ${error}`);

  runtime.storage = await createStore(config, runtime.logger);
  runtime.audit = new AuditLogger({
    storage: runtime.storage,
    config,
    logger: runtime.logger.child('audit'),
  });
  runtime.limiter = new RateLimiter({ limit: 8, windowMs: 60_000 });
  runtime.cooldown = new Cooldown();

  if (config.aiApiKey && config.aiAdminEnabled) {
    try {
      runtime.providerChain = createProviderChain(config, runtime.logger.child('ai'));
      runtime.provider = runtime.providerChain[0];
      runtime.logger.info('ai: provider ready', {
        provider: runtime.provider.id,
        model: runtime.provider.model,
        fallbacks: runtime.providerChain.length - 1,
      });
    } catch (err) {
      runtime.logger.error(`ai: could not create the provider - ${err.message}`);
      runtime.provider = null;
      runtime.providerChain = [];
    }
  } else {
    runtime.logger.warn(
      'ai: AI administration is not configured (AI_API_KEY missing or AI_ADMIN_ENABLED=false). All other bot features keep working.',
    );
  }

  try {
    const expired = await expireStalePlans(runtime.storage);
    if (expired > 0) runtime.logger.info(`admin: expired ${expired} stale plan(s)`);
  } catch (err) {
    runtime.logger.warn(`admin: could not expire stale plans - ${err.message}`);
  }

  runtime.ready = true;
  return runtime;
}

/** Attach the Discord client once it is logged in. */
function attachClient(client) {
  runtime.client = client;
  runtime.audit?.setClient(client);
}

async function shutdownRuntime() {
  try {
    await runtime.storage?.close();
  } catch {
    /* ignore */
  }
}

/** Redacted configuration summary (safe to log or show to an admin). */
function configSummary() {
  return describe(runtime.config || getConfig());
}

module.exports = { runtime, initRuntime, attachClient, shutdownRuntime, configSummary };
