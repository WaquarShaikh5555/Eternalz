'use strict';

/**
 * Minimal structured logger.
 *
 * - Writes one line per event so a hosting console shows readable output.
 * - Redacts anything that looks like a secret.
 * - Never throws: logging must never break the bot.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|api[_-]?key|authorization|auth|credential|private[_-]?key|cookie|session[_-]?id|client[_-]?secret)/i;

/** Recursively replace secret-looking values with a redaction marker. */
function redact(value, depth = 0) {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Discord tokens / provider keys are long opaque strings.
    if (value.length > 32 && /^[A-Za-z0-9._\-]+$/.test(value)) return '[redacted]';
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      // A boolean or a number under a secret-looking key is a flag, not a
      // secret (e.g. `tokenConfigured: true`).
      const isFlag = val === null || typeof val === 'boolean' || typeof val === 'number';
      out[key] = SECRET_KEY_PATTERN.test(key) && !isFlag ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

function createLogger(options = {}) {
  const level = LEVELS[options.level] ?? LEVELS.info;
  const prefix = options.prefix || '';
  const sink = options.sink || ((line) => process.stdout.write(`${line}\n`));

  function emit(levelName, message, meta) {
    if ((LEVELS[levelName] ?? 99) > level) return;
    const ts = new Date().toISOString();
    let line = `${ts} [${levelName.toUpperCase()}]${prefix ? ` ${prefix}` : ''} ${message}`;
    if (meta !== undefined) {
      try {
        line += ` ${JSON.stringify(redact(meta))}`;
      } catch {
        line += ' [unserialisable meta]';
      }
    }
    try {
      sink(line);
    } catch {
      /* never let logging throw */
    }
  }

  return {
    error: (message, meta) => emit('error', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    info: (message, meta) => emit('info', message, meta),
    debug: (message, meta) => emit('debug', message, meta),
    child: (childPrefix) => createLogger({ ...options, prefix: `${prefix} ${childPrefix}`.trim(), sink }),
  };
}

module.exports = { createLogger, redact, LEVELS };
