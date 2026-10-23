'use strict';

/**
 * In-process rate limiter and cooldown helper.
 *
 * Used to protect the AI provider quota and to stop a single user from
 * spamming the /ai command. On Wispbyte the bot runs as a single process, so
 * an in-memory limiter is sufficient.
 */

class RateLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.limit] maximum hits per window
   * @param {number} [options.windowMs] window length
   */
  constructor(options = {}) {
    this.limit = options.limit ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.hits = new Map();
  }

  _prune(now) {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }

  /** Record a hit. Returns true when the caller is within the limit. */
  tryAcquire(key = 'global') {
    const now = Date.now();
    this._prune(now);
    const timestamps = this.hits.get(key) || [];
    if (timestamps.length >= this.limit) return false;
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }

  /** Milliseconds until the next slot frees up (0 when allowed). */
  retryAfterMs(key = 'global') {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter((t) => t > now - this.windowMs);
    if (timestamps.length < this.limit) return 0;
    return Math.max(0, timestamps[0] + this.windowMs - now);
  }

  reset() {
    this.hits.clear();
  }
}

/** Per-key cooldown: returns remaining seconds, or 0 when free. */
class Cooldown {
  constructor() {
    this.until = new Map();
  }

  /** @returns {number} remaining seconds (0 = ready) */
  remaining(key) {
    const until = this.until.get(key);
    if (!until) return 0;
    const left = until - Date.now();
    if (left <= 0) {
      this.until.delete(key);
      return 0;
    }
    return Math.ceil(left / 1000);
  }

  start(key, durationMs) {
    this.until.set(key, Date.now() + durationMs);
  }

  clear(key) {
    this.until.delete(key);
  }
}

module.exports = { RateLimiter, Cooldown };
