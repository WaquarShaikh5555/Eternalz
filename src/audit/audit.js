'use strict';

/**
 * Audit logging.
 *
 * Every AI administration request produces a chain of audit entries:
 *
 *   requested -> confirmed | cancelled | expired -> executed | failed
 *
 * Entries are stored in the database and (when AI_AUDIT_CHANNEL_ID is set)
 * mirrored to a private channel. Credentials are never written and the
 * request text is truncated.
 */

const MAX_PROMPT = 2000;
const MAX_SUMMARY = 4000;

class AuditLogger {
  /**
   * @param {object} options
   * @param {object} options.storage
   * @param {object} options.config
   * @param {object} [options.client]
   * @param {object} [options.logger]
   */
  constructor(options) {
    this.storage = options.storage;
    this.config = options.config;
    this.client = options.client || null;
    this.logger = options.logger || null;
  }

  setClient(client) {
    this.client = client;
  }

  /**
   * Record an event.
   * @param {object} entry
   * @param {string} entry.guildId
   * @param {string} [entry.requesterId]
   * @param {string} entry.event
   * @param {string} [entry.prompt]
   * @param {object} [entry.summary]
   * @param {boolean} [entry.notify] mirror to the audit channel (default true)
   */
  async log(entry) {
    const row = {
      guildId: entry.guildId,
      requesterId: entry.requesterId || null,
      event: entry.event,
      prompt: entry.prompt ? String(entry.prompt).slice(0, MAX_PROMPT) : null,
      summary: entry.summary === undefined ? null : truncateSummary(entry.summary),
      createdAt: Date.now(),
    };

    try {
      await this.storage.addAudit(row);
    } catch (err) {
      this.logger?.error?.('audit: failed to persist entry', { reason: err.message });
    }

    if (entry.notify !== false) {
      await this.#notify(row);
    }

    this.logger?.info?.('audit', {
      guildId: row.guildId,
      requesterId: row.requesterId,
      event: row.event,
    });

    return row;
  }

  async #notify(row) {
    const channelId = this.config.aiAuditChannelId;
    if (!channelId || !this.client) return;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased?.() || channel.isDMBased?.()) return;
      const lines = [
        `**AI admin event:** \`${row.event}\``,
        `**Requester:** <@${row.requesterId || 'unknown'}>`,
        `**Time:** <t:${Math.floor(row.createdAt / 1000)}:R>`,
      ];
      if (row.prompt) lines.push(`**Request:** ${row.prompt.slice(0, 500)}`);
      if (row.summary) {
        lines.push('**Details:**');
        lines.push(`\`\`\`json\n${JSON.stringify(row.summary, null, 1).slice(0, 1800)}\n\`\`\``);
      }
      await channel.send({ content: lines.join('\n').slice(0, 2000) });
    } catch (err) {
      this.logger?.warn?.('audit: could not post to the audit channel', { reason: err.message });
    }
  }

  async list(guildId, limit = 25) {
    return this.storage.listAudit(guildId, limit);
  }
}

function truncateSummary(summary) {
  if (summary === null || summary === undefined) return null;
  if (typeof summary === 'string') return summary.slice(0, MAX_SUMMARY);
  try {
    const text = JSON.stringify(summary);
    if (text.length <= MAX_SUMMARY) return summary;
    return { truncated: true, preview: text.slice(0, MAX_SUMMARY) };
  } catch {
    return null;
  }
}

module.exports = { AuditLogger };
