'use strict';

/**
 * Full-stack integration test.
 *
 * A local HTTP server plays the role of the AI provider, the real
 * OpenAI-compatible provider talks to it, and the whole service pipeline
 * (authorise -> inspect -> plan -> execute -> report -> audit) runs against
 * the Discord mocks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OpenAiCompatibleProvider } = require('../src/ai/openai-compatible');
const { handleAdminRequest } = require('../src/admin/service');
const { JsonStore } = require('../src/storage/json-driver');
const { AuditLogger } = require('../src/audit/audit');
const { Cooldown, RateLimiter } = require('../src/core/rate-limiter');
const { makeGuild } = require('./helpers/mock-discord');

/** A fake provider server that answers with the given tool calls. */
function startProvider(responses) {
  const requests = [];
  let index = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        requests,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function toolCall(name, args, id = 'call_1') {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

test('a plain-language request becomes a real Discord change', async () => {
  const mock = await startProvider([
    // inspection round: the model looks at the channels first
    { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [toolCall('list_channels', {})] } }] },
    // inspection round: it is happy with what it saw
    { choices: [{ finish_reason: 'stop', message: { content: 'I can see the channels.' } }] },
    // planning round
    {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              toolCall('create_category', { name: 'Support' }, 'c1'),
              toolCall('create_channel', { name: 'tickets', category: 'Support' }, 'c2'),
            ],
          },
        },
      ],
    },
  ]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'test-key',
    baseUrl: mock.baseUrl,
    model: 'test-model',
    timeoutMs: 5000,
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-e2e-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();

  const config = {
    aiAdminEnabled: true,
    aiWriteEnabled: true,
    discordGuildId: 'guild-1',
    aiAdminUserIds: [],
    aiAdminRoleIds: [],
    aiApiKey: 'test-key',
    aiMaxActions: 25,
    aiMaxPlanningRounds: 3,
    aiTemperature: 0.2,
    aiRequestCooldownMs: 0,
    aiConfirmTimeoutMs: 300000,
    aiAuditChannelId: '',
  };
  const audit = new AuditLogger({ storage, config });

  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });

  const interaction = {
    user: { id: 'owner-1' },
    guild,
    options: {
      getString: (name) =>
        name === 'prompt' ? 'create a Support category with a tickets channel' : null,
      getBoolean: () => false,
    },
    async deferReply() {},
    async editReply() {},
    async reply() {},
  };

  const result = await handleAdminRequest({
    interaction,
    guild,
    config,
    storage,
    audit,
    logger: null,
    limiter: new RateLimiter({ limit: 10, windowMs: 60000 }),
    cooldown: new Cooldown(),
    provider,
  });

  assert.equal(result.kind, 'executed');
  assert.equal(result.report.succeeded.length, 2);
  assert.equal(result.report.failed.length, 0);

  // The changes really happened in the (mocked) server.
  const category = guild.channels.cache.find((c) => c.name === 'Support');
  assert.ok(category, 'the Support category should exist');
  const channel = guild.channels.cache.find((c) => c.name === 'tickets');
  assert.ok(channel, 'the tickets channel should exist');
  assert.equal(channel.parentId, category.id);

  // The model was called with the real server state and the tool allowlist.
  assert.ok(mock.requests.length >= 2);
  const firstRequest = mock.requests[0];
  assert.ok(firstRequest.tools.some((t) => t.function.name === 'list_channels'));
  assert.ok(!firstRequest.tools.some((t) => t.function.name === 'create_channel'));
  assert.match(firstRequest.messages[0].content, /discord_server_state/);

  const auditEntries = await storage.listAudit('guild-1', 10);
  assert.ok(auditEntries.some((e) => e.event === 'executed'));

  await storage.close();
  await mock.close();
});
