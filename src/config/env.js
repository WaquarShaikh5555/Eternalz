'use strict';

/**
 * Centralised environment configuration.
 *
 * Rules:
 *  - Secrets are read from the environment only. They are never logged, never
 *    serialised into a config dump, and never written to disk.
 *  - `describe()` returns a redacted, human-readable summary that is safe to
 *    print to a hosting console.
 *  - `validate()` reports missing/invalid configuration without revealing any
 *    secret value.
 */

const path = require('path');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return fallback;
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Accepts "123", "<@123>" and "123 456" style id lists. */
function toIdList(value) {
  if (!value) return [];
  return String(value)
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^<@!?/, '').replace(/>$/, ''))
    .filter((s) => /^\d{5,25}$/.test(s));
}

function clean(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).slice(0, max);
}

function build(raw = process.env) {
  const env = raw;

  const provider = (env.AI_PROVIDER || 'groq').trim().toLowerCase();
  const defaults = {
    groq: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-120b',
    },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
    },
    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash-lite',
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
  };
  const preset = defaults[provider] || defaults.groq;

  const config = {
    // --- Discord -------------------------------------------------------
    discordToken: env.DISCORD_TOKEN || env.BOT_TOKEN || env.TOKEN || '',
    discordClientId: env.DISCORD_CLIENT_ID || env.CLIENT_ID || '',
    discordGuildId: env.DISCORD_GUILD_ID || env.GUILD_ID || '',
    // 'global' keeps the historical behaviour; 'guild' registers instantly.
    commandScope: (env.COMMAND_SCOPE || 'global').trim().toLowerCase(),
    registerCommandsOnStart: toBool(env.REGISTER_COMMANDS_ON_START, true),

    // --- AI provider ---------------------------------------------------
    aiProvider: provider,
    aiBaseUrl: (env.AI_BASE_URL || preset.baseUrl).replace(/\/+$/, ''),
    aiApiKey: env.AI_API_KEY || '',
    aiModel: env.AI_MODEL || preset.model,
    // Optional comma-separated "provider:baseUrl:model" fallbacks.
    aiFallbacks: clean(env.AI_FALLBACK_PROVIDERS, 500),
    aiTimeoutMs: toInt(env.AI_TIMEOUT_MS, 60_000),
    aiMaxPlanningRounds: toInt(env.AI_MAX_PLANNING_ROUNDS, 1),
    aiMaxActions: toInt(env.AI_MAX_ACTIONS, 25),
    aiMaxOutputTokens: toInt(env.AI_MAX_OUTPUT_TOKENS, 512),
    aiTemperature: Number.parseFloat(env.AI_TEMPERATURE ?? '0.2'),

    // --- AI administration ---------------------------------------------
    aiAdminEnabled: toBool(env.AI_ADMIN_ENABLED, true),
    aiWriteEnabled: toBool(env.AI_WRITE_ENABLED, true),
    // Opt-in: configured user ids may also use /ai in guilds where they are
    // the owner or have Administrator / ManageGuild. Off by default.
    aiMultiGuild: toBool(env.AI_MULTI_GUILD, false),
    aiAdminUserIds: toIdList(env.AI_ADMIN_USER_IDS),
    aiAdminRoleIds: toIdList(env.AI_ADMIN_ROLE_IDS),
    aiAuditChannelId: env.AI_AUDIT_CHANNEL_ID || '',
    aiConfirmTimeoutMs: toInt(env.AI_CONFIRM_TIMEOUT_MS, 5 * 60_000),
    aiRequestCooldownMs: toInt(env.AI_REQUEST_COOLDOWN_MS, 10_000),
    aiMaxPromptLength: toInt(env.AI_MAX_PROMPT_LENGTH, 2000),

    // --- Storage --------------------------------------------------------
    storageDriver: (env.STORAGE_DRIVER || 'auto').trim().toLowerCase(),
    dataDir: env.DATA_DIR || path.join(process.cwd(), 'data'),
    storageFile: env.STORAGE_FILE || path.join(
      env.DATA_DIR || path.join(process.cwd(), 'data'),
      'eternalz-store.json',
    ),

    // --- Web ------------------------------------------------------------
    port: toInt(env.PORT, 3000),
    logLevel: (env.LOG_LEVEL || 'info').trim().toLowerCase(),
    nodeEnv: env.NODE_ENV || 'production',
  };

  return config;
}

let cached = null;

/** Build (and memoise) the configuration. */
function getConfig() {
  if (!cached) cached = build();
  return cached;
}

/** Rebuild from an explicit environment (used by tests). */
function loadFrom(env) {
  cached = build(env);
  return cached;
}

/**
 * Validate configuration.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
function validate(config = getConfig()) {
  const errors = [];
  const warnings = [];

  if (!config.discordToken) {
    errors.push('DISCORD_TOKEN is not set (the bot cannot connect to Discord).');
  }
  if (!config.discordClientId) {
    errors.push('DISCORD_CLIENT_ID is not set (slash commands cannot be registered).');
  }
  if (!config.discordGuildId) {
    errors.push(
      'DISCORD_GUILD_ID is not set (a primary guild is required for AI administration).',
    );
  }
  if (!config.aiAdminUserIds.length) {
    warnings.push(
      'AI_ADMIN_USER_IDS is empty - the static allowlist is disabled; the primary owner and per-guild /add-admin grants can still use /ai.',
    );
  }
  if (config.aiMultiGuild && !config.aiAdminUserIds.length) {
    warnings.push(
      'AI_MULTI_GUILD=true has no static admin ids; use /add-admin in each other guild or configure AI_ADMIN_USER_IDS.',
    );
  }
  if (config.aiAdminEnabled) {
    if (!config.aiApiKey) {
      warnings.push(
        'AI_API_KEY is not set - the /ai command will report a setup error; all other bot features still work.',
      );
    }
    if (!['groq', 'openrouter', 'gemini', 'openai', 'custom'].includes(config.aiProvider)) {
      errors.push(`AI_PROVIDER "${config.aiProvider}" is not a supported provider.`);
    }
    if (config.aiProvider === 'gemini' && !config.aiApiKey) {
      errors.push('AI_API_KEY is required when AI_PROVIDER=gemini.');
    }
  }
  if (!['auto', 'sqlite', 'json'].includes(config.storageDriver)) {
    errors.push(`STORAGE_DRIVER "${config.storageDriver}" must be auto, sqlite or json.`);
  }
  if (!['global', 'guild'].includes(config.commandScope)) {
    errors.push(`COMMAND_SCOPE "${config.commandScope}" must be global or guild.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Redacted, log-safe configuration summary. Never includes secret values. */
function describe(config = getConfig()) {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    port: config.port,
    commandScope: config.commandScope,
    registerCommandsOnStart: config.registerCommandsOnStart,
    discord: {
      tokenConfigured: Boolean(config.discordToken),
      clientIdConfigured: Boolean(config.discordClientId),
      guildId: config.discordGuildId || null,
    },
    ai: {
      enabled: config.aiAdminEnabled,
      writesEnabled: config.aiWriteEnabled,
      provider: config.aiProvider,
      baseUrl: config.aiBaseUrl,
      model: config.aiModel,
      apiKeyConfigured: Boolean(config.aiApiKey),
      multiGuild: Boolean(config.aiMultiGuild),
      adminUserCount: config.aiAdminUserIds.length,
      adminRoleCount: config.aiAdminRoleIds.length,
      auditChannelConfigured: Boolean(config.aiAuditChannelId),
      maxActions: config.aiMaxActions,
      planningRounds: config.aiMaxPlanningRounds,
      maxOutputTokens: config.aiMaxOutputTokens,
    },
    storage: {
      driver: config.storageDriver,
      dataDir: config.dataDir,
    },
  };
}

module.exports = { getConfig, loadFrom, validate, describe, build };
