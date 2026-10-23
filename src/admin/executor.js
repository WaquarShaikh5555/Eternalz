'use strict';

/**
 * Plan execution.
 *
 * Rules that apply to every action:
 *   - authorisation is re-checked immediately before the first action
 *   - the target guild is re-checked
 *   - the bot's Discord permissions are re-checked inside each tool
 *   - transient failures are retried a bounded number of times
 *   - duplicate creates are skipped instead of failing
 *   - a success is only reported after Discord confirmed it
 *   - a failure never stops the remaining independent actions
 */

const { getTool } = require('../discord/tools');
const { missingToolPermissions, permissionFixHint } = require('../discord/permissions');
const { withRetry } = require('../core/retry');
const { toError } = require('../core/errors');

const DEFAULT_DELAY_MS = 350;
const DEFAULT_ATTEMPTS = 3;

/**
 * @param {object} options
 * @param {Array} options.actions validated plan actions
 * @param {object} options.ctx execution context (guild, actorMember, storage, ...)
 * @param {object} options.config
 * @param {Function} [options.authorize] re-check hook, called before each action
 * @param {object} [options.logger]
 * @param {number} [options.delayMs]
 * @returns {Promise<{succeeded: Array, failed: Array, skipped: Array, summary: string}>}
 */
async function executePlan(options) {
  const {
    actions = [],
    ctx,
    config,
    authorize,
    logger,
    delayMs = DEFAULT_DELAY_MS,
    attempts = DEFAULT_ATTEMPTS,
  } = options;

  const succeeded = [];
  const failed = [];
  const skipped = [];

  if (!config.aiWriteEnabled) {
    return {
      succeeded,
      failed,
      skipped: actions.map((action) => ({
        tool: action.tool,
        description: action.description,
        reason: 'AI write operations are currently disabled (AI_WRITE_ENABLED=false).',
      })),
      summary: 'No changes were made because AI write operations are disabled.',
      writesDisabled: true,
    };
  }

  let index = 0;
  for (const action of actions) {
    index += 1;
    const tool = getTool(action.tool);

    if (!tool) {
      skipped.push({ tool: action.tool, description: action.description, reason: 'tool is not allowed' });
      continue;
    }

    try {
      // Re-check authorisation immediately before acting.
      if (authorize) await authorize(action);

      // Fail fast when the bot is missing a Discord permission, so the user
      // gets an actionable message instead of a raw Discord 403.
      const missing = missingToolPermissions(ctx.guild, action.tool);
      if (missing.length) {
        throw new Error(
          `The bot is missing the following Discord permission(s): ${missing.join(', ')}. ` +
            permissionFixHint(ctx.guild, missing),
        );
      }

      // Only transient failures are retried - a permission error or an
      // unknown channel is reported straight away.
      const result = await withRetry(
        async () => {
          const outcome = await tool.execute(ctx, action.args);
          if (!outcome || outcome.ok === false) {
            throw new Error(outcome?.error || 'The tool reported a failure.');
          }
          return outcome;
        },
        {
          attempts,
          baseMs: 600,
          maxMs: 5000,
          onRetry: ({ attempt, delayMs: wait, error }) => {
            logger?.warn?.('admin: retrying action', {
              tool: action.tool,
              attempt,
              delayMs: Math.round(wait),
              reason: error.message,
            });
          },
        },
      );

      if (result.skipped) {
        skipped.push({
          tool: action.tool,
          description: action.description,
          reason: result.message || 'skipped',
        });
      } else {
        succeeded.push({
          tool: action.tool,
          description: action.description,
          message: result.message,
          data: result.data,
          reversal: result.reversal || null,
          note: result.note || null,
        });
        logger?.info?.('admin: action succeeded', { tool: action.tool });
      }
    } catch (err) {
      const error = toError(err);
      failed.push({
        tool: action.tool,
        description: action.description,
        error: error.message,
        code: error.code || null,
      });
      logger?.warn?.('admin: action failed', { tool: action.tool, reason: error.message });
    }

    // Gentle pacing so a burst of API calls never trips Discord's limits.
    if (index < actions.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { succeeded, failed, skipped, summary: buildSummary(succeeded, failed, skipped) };
}

/** Build an accurate summary - including partial failures. */
function buildSummary(succeeded, failed, skipped) {
  const parts = [];
  if (succeeded.length) {
    parts.push(`${succeeded.length} change${succeeded.length === 1 ? '' : 's'} applied`);
  }
  if (failed.length) {
    parts.push(`${failed.length} failed`);
  }
  if (skipped.length) {
    parts.push(`${skipped.length} skipped`);
  }
  if (!parts.length) return 'Nothing to do.';
  return parts.join(', ');
}

/**
 * Which permissions a whole plan needs that the bot does not have.
 * @returns {{missing: string[], hint: string}}
 */
function planPermissionGaps(guild, actions = []) {
  const missing = new Set();
  for (const action of actions) {
    for (const name of missingToolPermissions(guild, action.tool)) missing.add(name);
  }
  const list = [...missing];
  return { missing: list, hint: permissionFixHint(guild, list) };
}

module.exports = { executePlan, buildSummary, planPermissionGaps };
