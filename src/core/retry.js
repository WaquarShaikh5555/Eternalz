'use strict';

/**
 * Bounded retry with exponential backoff and jitter.
 *
 * Only transient failures are retried:
 *   - network errors (ECONNRESET, ETIMEDOUT, fetch failed, ...)
 *   - HTTP 408, 425, 429, 500, 502, 503, 504
 * A 4xx that is not 408/425/429 is a caller error and is never retried.
 */

const { toError } = require('./errors');

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  const message = err.message || String(err);
  return (
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|network/i.test(
      message,
    )
  );
}

function isRetryable(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err.code;
  if (typeof status === 'number' && status >= 100) {
    return RETRYABLE_STATUS.has(status);
  }
  if (status === 'ECONNRESET' || status === 'ETIMEDOUT' || status === 'EAI_AGAIN') return true;
  return isNetworkError(err);
}

/**
 * @param {Function} fn - async function to run
 * @param {object} [options]
 * @param {number} [options.attempts=3]
 * @param {number} [options.baseMs=400]
 * @param {number} [options.maxMs=8000]
 * @param {AbortSignal} [options.signal]
 * @param {(info:{attempt:number,delayMs:number,error:Error})=>void} [options.onRetry]
 */
async function withRetry(fn, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseMs = options.baseMs ?? 400;
  const maxMs = options.maxMs ?? 8000;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (raw) {
      const err = toError(raw);
      lastError = err;

      if (attempt === attempts || !isRetryable(err)) throw err;

      // A server-supplied Retry-After always wins over our own backoff.
      const retryAfterSeconds = Number(err.retryAfter ?? err.retryAfterSeconds);
      let delayMs;
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        delayMs = Math.min(maxMs, retryAfterSeconds * 1000);
      } else {
        // Full jitter prevents a thundering herd of parallel requests.
        delayMs = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) * (0.5 + Math.random() / 2);
      }

      options.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs, options.signal);
    }
  }

  throw lastError;
}

module.exports = { withRetry, sleep, isRetryable, isNetworkError, RETRYABLE_STATUS };
