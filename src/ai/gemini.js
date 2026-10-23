'use strict';

/**
 * Google Gemini provider (native `generateContent` API).
 *
 * Gemini uses a different wire format from OpenAI: tool declarations are
 * `functionDeclarations`, calls come back as `functionCall` parts and results
 * are sent back as `functionResponse` parts. This adapter hides that
 * difference behind the same unified interface used by the OpenAI-compatible
 * provider, so the planner does not care which one is active.
 */

const { AiProviderError, AiQuotaError } = require('../core/errors');
const { withRetry } = require('../core/retry');
const { sanitizeToolHistory } = require('./message-history');

class GeminiProvider {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = String(options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
      .replace(/\/+$/, '');
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.label = options.label || 'gemini';
    this.logger = options.logger;
    this.kind = 'gemini';
    this.callCounter = 0;
  }

  get id() {
    return this.label;
  }

  toWireRequest(request) {
    const messages = sanitizeToolHistory(request.messages, request.tools);
    const system = messages.filter((m) => m.role === 'system');
    const contents = [];

    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: message.name || message.toolCallId,
                response: { result: message.content },
              },
            },
          ],
        });
        continue;
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        contents.push({
          role: 'model',
          parts: message.toolCalls.map((call) => ({
            functionCall: { name: call.name, args: call.arguments ?? {} },
          })),
        });
        continue;
      }
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(message.content ?? '') }],
      });
    }

    const payload = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      },
    };

    if (system.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: system.map((m) => m.content).join('\n\n') }],
      };
    }

    if (request.tools?.length) {
      payload.tools = [{ functionDeclarations: request.tools }];
      payload.toolConfig = {
        functionCallingConfig: { mode: request.toolChoice === 'none' ? 'NONE' : 'AUTO' },
      };
    }

    return payload;
  }

  async chat(request) {
    const payload = this.toWireRequest(request);
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;

    const data = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const onAbort = () => controller.abort();
        request.signal?.addEventListener?.('abort', onAbort, { once: true });
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
          request.signal?.removeEventListener?.('abort', onAbort);
        }
      },
      {
        attempts: 3,
        baseMs: 600,
        maxMs: 8000,
        signal: request.signal,
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

    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const toolCalls = [];
    let text = null;

    for (const part of parts) {
      if (part.functionCall) {
        this.callCounter += 1;
        toolCalls.push({
          id: `gemini_call_${this.callCounter}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      } else if (typeof part.text === 'string') {
        text = text ? `${text}\n${part.text}` : part.text;
      }
    }

    if (!toolCalls.length && !text) {
      throw new AiProviderError('The AI provider returned an empty response.', {
        provider: this.label,
      });
    }

    return {
      text,
      toolCalls,
      finishReason: candidate?.finishReason || null,
      usage: data?.usageMetadata || null,
      model: this.model,
    };
  }
}

function buildHttpError(response, parsed, provider) {
  const apiError = parsed?.error || {};
  const message = apiError.message || parsed?.raw?.slice?.(0, 300) || `HTTP ${response.status}`;
  const error = new AiProviderError(`AI provider error: ${message}`, {
    provider,
    status: response.status,
  });
  error.status = response.status;
  error.retryAfter = Number(response.headers.get('retry-after')) || undefined;
  error.provider = provider;

  if (response.status === 429 || response.status === 402) {
    const quota = new AiQuotaError(
      'The AI provider is rate limiting this account (free tier limit reached).',
      { provider, status: response.status },
    );
    quota.status = response.status;
    quota.retryAfter = error.retryAfter;
    return quota;
  }
  if (response.status === 404) {
    error.message = `The AI provider does not know the requested model. ${message}`;
  }
  return error;
}

module.exports = { GeminiProvider };
