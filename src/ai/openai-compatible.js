'use strict';

/**
 * OpenAI-compatible chat provider.
 *
 * Works with Groq, OpenRouter, OpenAI and any other service that speaks the
 * `/chat/completions` format with the standard `tools` parameter.
 *
 * Implemented directly on `fetch` (Node 18+) so the bot needs no additional
 * npm dependency and so timeouts / retries / error mapping stay under our
 * control.
 */

const { AiProviderError, AiQuotaError } = require('../core/errors');
const { withRetry } = require('../core/retry');
const { sanitizeToolHistory } = require('./message-history');

class OpenAiCompatibleProvider {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} options.baseUrl
   * @param {string} options.model
   * @param {number} [options.timeoutMs]
   * @param {string} [options.label]
   * @param {object} [options.logger]
   */
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.label = options.label || this.baseUrl;
    this.logger = options.logger;
    this.kind = 'openai-compatible';
  }

  get id() {
    return this.label;
  }

  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    // OpenRouter asks for attribution headers on free models.
    if (this.baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://github.com/WaquarShaikh5555/Eternalz';
      headers['X-Title'] = 'Eternalz AI Administrator';
    }
    return headers;
  }

  /**
   * Convert the unified message list into the OpenAI chat format.
   */
  toWireMessages(messages) {
    return messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? {}),
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? {}),
            },
          })),
        };
      }
      return { role: message.role, content: message.content ?? '' };
    });
  }

  /**
   * @param {object} request
   * @param {Array} request.messages unified messages
   * @param {Array} [request.tools] provider-format tool definitions
   * @param {string} [request.toolChoice] 'auto' | 'none'
   */
  async chat(request) {
    const messages = sanitizeToolHistory(request.messages, request.tools);
    const payload = {
      model: this.model,
      messages: this.toWireMessages(messages),
      temperature: request.temperature ?? 0.2,
      stream: false,
    };
    if (request.maxTokens) payload.max_tokens = request.maxTokens;
    if (request.tools?.length) {
      payload.tools = request.tools;
      payload.tool_choice = request.toolChoice || 'auto';
    }

    const data = await this.#post('/chat/completions', payload, request.signal);

    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new AiProviderError('The AI provider returned no usable message.', {
        provider: this.label,
      });
    }

    const toolCalls = (message.tool_calls || []).map((call) => ({
      id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: call.function?.name,
      arguments: safeJsonParse(call.function?.arguments),
    }));

    return {
      text: typeof message.content === 'string' ? message.content : null,
      toolCalls,
      finishReason: choice?.finish_reason || null,
      usage: data?.usage || null,
      model: data?.model || this.model,
    };
  }

  async #post(pathname, payload, signal) {
    const url = `${this.baseUrl}${pathname}`;
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const onAbort = () => controller.abort();
        signal?.addEventListener?.('abort', onAbort, { once: true });
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          const text = await response.text();
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { raw: text };
          }

          if (!response.ok) {
            throw buildHttpError(response, parsed, this.label);
          }
          return parsed;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
        }
      },
      {
        attempts: 3,
        baseMs: 500,
        maxMs: 8000,
        signal,
        onRetry: ({ attempt, delayMs, error }) => {
          this.logger?.warn?.('ai: retrying request', {
            provider: this.label,
            attempt,
            delayMs: Math.round(delayMs),
            reason: error.message,
          });
        },
      },
    );
  }
}

function buildHttpError(response, parsed, provider) {
  const message =
    parsed?.error?.message ||
    parsed?.message ||
    parsed?.raw?.slice?.(0, 300) ||
    `HTTP ${response.status}`;
  const error = new AiProviderError(`AI provider error: ${message}`, {
    provider,
    status: response.status,
  });
  error.status = response.status;
  error.retryAfter = Number(response.headers.get('retry-after')) || undefined;
  error.provider = provider;

  if (response.status === 402 || response.status === 429) {
    const quota = new AiQuotaError(
      response.status === 402
        ? 'The AI provider reports that your credit or free quota is exhausted.'
        : 'The AI provider is rate limiting this account (free tier limit reached).',
      { provider, status: response.status },
    );
    quota.status = response.status;
    quota.retryAfter = error.retryAfter;
    return quota;
  }
  if (response.status === 413) {
    error.message =
      'The AI request exceeded the provider\'s current free-tier token budget. Try a narrower request or wait for the per-minute window to reset; a paid upgrade is not required.';
  }
  if (response.status === 404) {
    error.message = `The AI provider does not know the model "${parsed?.error?.message || 'unknown'}".`;
  }
  return error;
}

function safeJsonParse(value) {
  if (value === undefined || value === null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { __unparsable: String(value).slice(0, 500) };
  }
}

module.exports = { OpenAiCompatibleProvider };
