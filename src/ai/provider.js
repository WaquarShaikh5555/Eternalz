'use strict';

/**
 * Provider factory and fallback chain.
 *
 * A provider is anything with a `chat({ messages, tools, ... })` method that
 * resolves to `{ text, toolCalls }`. Two implementations ship with the bot
 * (OpenAI-compatible and Gemini); anything else that speaks the OpenAI
 * `/chat/completions` format works by changing AI_BASE_URL.
 */

const { OpenAiCompatibleProvider } = require('./openai-compatible');
const { GeminiProvider } = require('./gemini');
const { AiProviderError } = require('../core/errors');

/** Provider presets used when the matching environment variable is not set. */
const PRESETS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    kind: 'openai-compatible',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    kind: 'openai-compatible',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    kind: 'openai-compatible',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash-lite',
    kind: 'gemini',
  },
};

/**
 * @param {object} options
 * @param {string} options.provider provider id
 * @param {string} options.baseUrl
 * @param {string} options.model
 * @param {string} options.apiKey
 * @param {number} [options.timeoutMs]
 * @param {object} [options.logger]
 */
function createProvider(options) {
  const providerId = String(options.provider || 'groq').toLowerCase();
  const preset = PRESETS[providerId];
  const kind = options.kind || preset?.kind || 'openai-compatible';

  if (!options.apiKey) {
    throw new AiProviderError(
      `No API key configured for the "${providerId}" AI provider. Set AI_API_KEY.`,
      { provider: providerId },
    );
  }

  const common = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl || preset?.baseUrl,
    model: options.model || preset?.model,
    timeoutMs: options.timeoutMs,
    logger: options.logger,
    label: providerId,
  };

  if (kind === 'gemini') return new GeminiProvider(common);
  return new OpenAiCompatibleProvider(common);
}

/**
 * Parse one fallback entry.
 *
 * The format is `provider|baseUrl|model` (the base URL and the model are
 * optional) and several entries are separated by commas. A pipe is used
 * because a base URL contains colons.
 */
function parseFallbackEntry(entry) {
  const trimmed = String(entry || '').trim();
  if (!trimmed) return null;

  if (trimmed.includes('|')) {
    const [provider, baseUrl, model] = trimmed.split('|');
    if (!provider) return null;
    return { provider: provider.trim(), baseUrl: baseUrl?.trim(), model: model?.trim() };
  }

  // `provider:model` - the base URL comes from the provider preset.
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    return { provider: parts[0].trim(), baseUrl: undefined, model: parts[1].trim() };
  }
  if (parts.length >= 3) {
    const provider = parts[0].trim();
    const model = parts[parts.length - 1].trim();
    const baseUrl = parts.slice(1, parts.length - 1).join(':');
    return { provider, baseUrl, model };
  }
  return null;
}

/**
 * Build the primary provider plus an optional fallback chain.
 *
 * Fallbacks are declared as `provider|baseUrl|model` triples separated by
 * commas, e.g.
 *   AI_FALLBACK_PROVIDERS=openrouter|https://openrouter.ai/api/v1|openrouter/free
 * The API key of the primary provider is reused for fallbacks.
 */
function createProviderChain(config, logger) {
  const primary = createProvider({
    provider: config.aiProvider,
    baseUrl: config.aiBaseUrl,
    model: config.aiModel,
    apiKey: config.aiApiKey,
    timeoutMs: config.aiTimeoutMs,
    logger,
  });

  const chain = [primary];
  const raw = (config.aiFallbacks || '').trim();
  if (!raw) return chain;

  for (const entry of raw.split(',')) {
    const parsed = parseFallbackEntry(entry);
    if (!parsed) continue;
    try {
      chain.push(
        createProvider({
          provider: parsed.provider,
          baseUrl: parsed.baseUrl,
          model: parsed.model,
          apiKey: config.aiApiKey,
          timeoutMs: config.aiTimeoutMs,
          logger,
        }),
      );
    } catch (err) {
      logger?.warn?.('ai: ignoring invalid fallback provider', { entry, reason: err.message });
    }
  }

  return chain;
}

module.exports = { createProvider, createProviderChain, parseFallbackEntry, PRESETS };
