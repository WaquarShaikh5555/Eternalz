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
    const providerCallIds = new Map();
    for (const message of messages) {
      const rawCalls = (message.geminiParts || []).filter((part) => part.functionCall);
      (message.toolCalls || []).forEach((call, index) => {
        const nativeId = call.providerCallId || rawCalls[index]?.functionCall?.id;
        if (nativeId) providerCallIds.set(call.id, nativeId);
      });
    }

    const appendContent = (role, parts) => {
      const previous = contents.at(-1);
      // Gemini groups parallel function responses into one user turn. Do not,
      // however, merge two separately signed model parts: thought signatures
      // belong to their exact original part and cannot be combined.
      const separatelySigned = role === 'model'
        && previous?.role === role
        && previous.parts.some((part) => part.thoughtSignature)
        && parts.some((part) => part.thoughtSignature);
      if (previous?.role === role && !separatelySigned) previous.parts.push(...parts);
      else contents.push({ role, parts });
    };

    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'tool') {
        const providerCallId = providerCallIds.get(message.toolCallId);
        appendContent('user', [
          {
            functionResponse: {
              name: message.name || message.toolCallId,
              ...(providerCallId ? { id: providerCallId } : {}),
              response: { result: message.content },
            },
          },
        ]);
        continue;
      }
      if (message.role === 'assistant') {
        const signedParts = normaliseModelParts(message.geminiParts);
        if (signedParts.length) {
          appendContent('model', signedParts);
          continue;
        }
        if (message.toolCalls?.length) {
          appendContent('model', message.toolCalls.map((call) => ({
            functionCall: {
              name: call.name,
              args: call.arguments ?? {},
              ...(call.providerCallId ? { id: call.providerCallId } : {}),
            },
            ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
          })));
          continue;
        }
      }
      appendContent(message.role === 'assistant' ? 'model' : 'user', [
        { text: String(message.content ?? '') },
      ]);
    }

    // Gemini rejects generateContent requests whose final content is a model
    // turn ("Requests ending with a model turn are not supported"). The
    // planner can legitimately finish inspection with prose before switching
    // to the write-tool catalogue, so terminate that sequence with an explicit
    // user continuation instead of sending an invalid request.
    if (contents.at(-1)?.role === 'model') {
      contents.push({
        role: 'user',
        parts: [{
          text: 'Continue with the current request. Call an appropriate available tool for a requested change, or answer briefly if no change is needed.',
        }],
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
        const providerCallId = typeof part.functionCall.id === 'string' && part.functionCall.id
          ? part.functionCall.id
          : null;
        toolCalls.push({
          // The unified planner always needs an id. Keep Gemini's native id
          // separately so locally generated fallback ids are never sent back
          // to Google as if the model had supplied them.
          id: providerCallId || `gemini_call_${this.callCounter}`,
          ...(providerCallId ? { providerCallId } : {}),
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
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
      // Keep the exact signed model parts for the next request. Rebuilding a
      // functionCall from only name/args loses Gemini 3/4 thought signatures.
      geminiParts: normaliseModelParts(parts),
      finishReason: candidate?.finishReason || null,
      usage: data?.usageMetadata || null,
      model: this.model,
    };
  }
}

/** Copy only model-part fields that are meaningful to this provider. */
function normaliseModelParts(parts) {
  if (!Array.isArray(parts)) return [];
  const output = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const copy = {};
    if (typeof part.text === 'string') copy.text = part.text;
    if (part.functionCall && typeof part.functionCall === 'object') {
      copy.functionCall = {
        name: part.functionCall.name,
        args: part.functionCall.args || {},
        ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
      };
    }
    if (typeof part.thoughtSignature === 'string' && part.thoughtSignature) {
      copy.thoughtSignature = part.thoughtSignature;
    }
    if (part.thought === true) copy.thought = true;
    if (copy.text !== undefined || copy.functionCall || copy.thoughtSignature || copy.thought) {
      output.push(copy);
    }
  }
  return output;
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
