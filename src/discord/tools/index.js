'use strict';

/**
 * Tool registry.
 *
 * This is the allowlist. The model can only ever request one of the tools
 * registered here; anything else is rejected before it reaches Discord.
 */

const { validate } = require('../../ai/validate');
const { ActionRejectedError } = require('../../core/errors');

const inspectTools = require('./inspect');
const channelTools = require('./channels');
const roleTools = require('./roles');
const messagingTools = require('./messaging');
const moderationTools = require('./moderation');
const communityTools = require('./community');

const ALL_TOOLS = [
  ...inspectTools,
  ...channelTools,
  ...roleTools,
  ...messagingTools,
  ...moderationTools,
  ...communityTools,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

const READ_TOOLS = ALL_TOOLS.filter((tool) => !tool.mutating);
const WRITE_TOOLS = ALL_TOOLS.filter((tool) => tool.mutating);

/** Names of every registered tool - used for logging and tests. */
function toolNames() {
  return ALL_TOOLS.map((tool) => tool.name);
}

function getTool(name) {
  return TOOLS_BY_NAME.get(name) || null;
}

/**
 * Validate a proposed tool call against the tool's strict schema.
 * @returns {{ok: boolean, args: object, errors: string[]}}
 */
function validateToolCall(name, rawArgs) {
  const tool = getTool(name);
  if (!tool) {
    return {
      ok: false,
      args: null,
      errors: [`Unknown tool "${name}". It is not in the allowlist.`],
    };
  }
  if (rawArgs !== undefined && rawArgs !== null && typeof rawArgs !== 'object') {
    return { ok: false, args: null, errors: [`Arguments for "${name}" must be an object.`] };
  }
  if (Array.isArray(rawArgs)) {
    return { ok: false, args: null, errors: [`Arguments for "${name}" must be an object, not an array.`] };
  }

  const result = validate(rawArgs ?? {}, tool.parameters, name);
  return { ok: result.ok, args: result.ok ? result.value : null, errors: result.errors };
}

/**
 * Convert tools into the OpenAI-compatible `tools` array.
 * @param {Array} tools
 */
function toProviderTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Convert tools into the Gemini `functionDeclarations` array.
 * @param {Array} tools
 */
function toGeminiDeclarations(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: cleanSchemaForGemini(tool.parameters),
  }));
}

/** Gemini rejects JSON Schema keywords it does not know - strip them. */
function cleanSchemaForGemini(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const clone = JSON.parse(JSON.stringify(schema));
  delete clone.additionalProperties;
  return clone;
}

module.exports = {
  ALL_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
  TOOLS_BY_NAME,
  toolNames,
  getTool,
  validateToolCall,
  toProviderTools,
  toGeminiDeclarations,
  ActionRejectedError,
};
