'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const { OpenAiCompatibleProvider } = require('../src/ai/openai-compatible');
const { GeminiProvider } = require('../src/ai/gemini');
const { sanitizeToolHistory } = require('../src/ai/message-history');
const { createPlan } = require('../src/ai/planner');
const { buildGuildSnapshot } = require('../src/discord/snapshot');
const { makeGuild } = require('./helpers/mock-discord');

const CONFIG = {
  aiMaxPlanningRounds: 1,
  aiMaxActions: 25,
  aiMaxOutputTokens: 512,
  aiTemperature: 0.2,
};

function responseWithTool(id, name, args) {
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
  };
}

/**
 * Simulate Groq's catalogue validation, not just a permissive HTTP echo.
 * The second request must not replay the inspection call while offering only
 * write tools. This is the exact phase transition used by /ai.
 */
test('read inspection history cannot invalidate a write-only planning request', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);

    if (requests.length === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseWithTool('inspect-1', 'get_server_snapshot', {})));
      return;
    }

    const available = new Set((payload.tools || []).map((tool) => tool.function.name));
    const unavailable = (payload.messages || [])
      .flatMap((message) => message.tool_calls || [])
      .find((call) => !available.has(call.function.name));
    if (unavailable) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: `Tool call validation failed: attempted to call tool '${unavailable.function.name}' which was not in request.tools`,
        },
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseWithTool('write-1', 'create_category', { name: 'Support' })));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address();
  const provider = new OpenAiCompatibleProvider({
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${port}`,
    model: 'test-model',
    timeoutMs: 5000,
  });
  const guild = makeGuild();
  const plan = await createPlan({
    provider,
    config: CONFIG,
    ctx: { guild, storage: {}, logger: null },
    prompt: 'Create a Support category',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].tool, 'create_category');
  assert.equal(requests.length, 2);
  const inspectionTools = requests[0].tools.map((tool) => tool.function.name);
  assert.ok(inspectionTools.includes('get_server_snapshot'));
  assert.ok(inspectionTools.includes('list_channels'));
  assert.ok(!inspectionTools.includes('create_category'));
  assert.ok(!requests[1].tools.some((tool) => tool.function.name === 'get_server_snapshot'));

  const historicalCalls = requests[1].messages.flatMap((message) => message.tool_calls || []);
  assert.equal(historicalCalls.length, 0, 'unavailable native calls must be flattened');
  assert.ok(!requests[1].messages.some((message) => message.role === 'tool'));
  assert.ok(requests[1].messages.some((message) => (
    message.role === 'user'
      && typeof message.content === 'string'
      && message.content.includes('get_server_snapshot')
      && message.content.includes('untrusted data')
  )));
});

test('available native tool exchanges remain native and the input is not mutated', () => {
  const tools = [
    { type: 'function', function: { name: 'get_server_snapshot' } },
    { type: 'function', function: { name: 'create_category' } },
  ];
  const messages = [
    { role: 'system', content: 'Rules' },
    { role: 'user', content: 'Inspect and improve the server' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'inspect-1', name: 'get_server_snapshot', arguments: {} }],
    },
    { role: 'tool', toolCallId: 'inspect-1', content: '{"channels":[]}' },
  ];
  const before = JSON.parse(JSON.stringify(messages));
  const result = sanitizeToolHistory(messages, tools);

  assert.deepEqual(result, messages);
  assert.equal(result[2].toolCalls[0].name, 'get_server_snapshot');
  assert.equal(result[3].role, 'tool');
  assert.deepEqual(messages, before);
});

test('Gemini also flattens a historical call absent from its current catalogue', () => {
  const provider = new GeminiProvider({ apiKey: 'test-key', model: 'test-model' });
  const request = {
    messages: [
      { role: 'system', content: 'Rules' },
      { role: 'user', content: 'Inspect and improve the server' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'inspect-1', name: 'get_server_snapshot', arguments: {} }],
      },
      { role: 'tool', toolCallId: 'inspect-1', content: '{"channels":[]}' },
    ],
    tools: [{ name: 'create_category', parameters: { type: 'object' } }],
  };

  const wire = provider.toWireRequest(request);
  const calls = wire.contents.flatMap((content) => content.parts)
    .filter((part) => part.functionCall);
  assert.equal(calls.length, 0);
  assert.ok(wire.contents.some((content) => content.parts.some((part) => (
    typeof part.text === 'string' && part.text.includes('get_server_snapshot')
  ))));
});
