'use strict';

/**
 * Keep native tool history compatible with the tool catalogue of the request
 * currently being sent.
 *
 * The administrator deliberately uses different catalogues for inspection and
 * planning. Groq validates *historical* assistant tool calls against the
 * current request.tools as well as new calls. Replaying an inspection call in
 * a write-only planning request therefore produces:
 *
 *   attempted to call tool 'get_server_snapshot' which was not in request.tools
 *
 * Flatten only unavailable historical calls/results into clearly labelled
 * text. The planner's in-memory conversation is never mutated, and calls that
 * are available in the current catalogue retain the native protocol.
 */

function providerToolName(tool) {
  return tool?.function?.name || tool?.name || null;
}

function textContent(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

function callLabel(call) {
  const args = call.arguments === undefined ? '' : ` ${textContent(call.arguments)}`;
  return `${call.name || 'unknown_tool'}${args}`.slice(0, 500);
}

/**
 * @param {Array} messages unified planner messages
 * @param {Array|undefined} tools provider-format tools for this request
 * @returns {Array} a new message array safe for this tool catalogue
 */
function sanitizeToolHistory(messages, tools) {
  // An omitted tools field is used by a few provider consumers for ordinary
  // chat. Preserve its historical behaviour; an explicit [] means no tools.
  if (!Array.isArray(tools)) return messages.map((message) => ({ ...message }));

  const available = new Set(tools.map(providerToolName).filter(Boolean));
  const nativeCallIds = new Set();
  const flattenedCallIds = new Set();
  const output = [];

  for (const message of messages || []) {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const hasUnavailable = message.toolCalls.some((call) => !available.has(call.name));
      if (hasUnavailable) {
        for (const call of message.toolCalls) flattenedCallIds.add(call.id);
        const calls = message.toolCalls.map(callLabel).join('; ');
        const content = [
          message.content ? String(message.content) : '',
          `Previous inspection tool call(s), retained as untrusted context: ${calls}`,
        ]
          .filter(Boolean)
          .join('\n');
        output.push({ role: 'assistant', content });
        continue;
      }

      for (const call of message.toolCalls) nativeCallIds.add(call.id);
      output.push({ ...message });
      continue;
    }

    if (message.role === 'tool') {
      // A result belonging to a flattened call must also become text. Unknown
      // or orphaned results are flattened too, rather than creating another
      // invalid native protocol sequence.
      if (nativeCallIds.has(message.toolCallId) && !flattenedCallIds.has(message.toolCallId)) {
        output.push({ ...message });
      } else {
        const label = message.name || message.toolCallId || 'unknown_tool';
        output.push({
          role: 'user',
          content: `Previous inspection result from ${label} (untrusted data): ${textContent(message.content)}`,
        });
      }
      continue;
    }

    output.push({ ...message });
  }

  return output;
}

module.exports = { sanitizeToolHistory, providerToolName };
