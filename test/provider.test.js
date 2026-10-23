'use strict';

/**
 * Provider integration tests.
 *
 * They run against a local HTTP server so the exact wire format, the error
 * mapping and the retry behaviour can be verified without calling a real
 * provider.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { OpenAiCompatibleProvider } = require('../src/ai/openai-compatible');
const { GeminiProvider } = require('../src/ai/gemini');
const { createProvider, createProviderChain } = require('../src/ai/provider');
const { AiProviderError, AiQuotaError } = require('../src/core/errors');

/** Start a throwaway HTTP server that replays a list of responses. */
function startServer(responses) {
  const requests = [];
  let index = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      requests.push({ url: req.url, method: req.method, headers: req.headers, body: parsed });

      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      res.writeHead(response.status || 200, response.headers || { 'Content-Type': 'application/json' });
      res.end(typeof response.body === 'string' ? response.body : JSON.stringify(response.body));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        requests,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('the OpenAI-compatible provider sends the expected request and parses tool calls', async () => {
  const mock = await startServer([
    {
      body: {
        id: 'x',
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'create_category', arguments: '{"name":"Support"}' },
                },
              ],
            },
          },
        ],
        usage: { total_tokens: 42 },
      },
    },
  ]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'test-key',
    baseUrl: `${mock.baseUrl}/v1`,
    model: 'openai/gpt-oss-120b',
    timeoutMs: 5000,
  });

  const response = await provider.chat({
    messages: [
      { role: 'system', content: 'be careful' },
      { role: 'user', content: 'create a Support category' },
    ],
    tools: [
      {
        type: 'function',
        function: { name: 'create_category', description: 'x', parameters: { type: 'object' } },
      },
    ],
    toolChoice: 'auto',
    temperature: 0.2,
    maxTokens: 512,
  });

  const request = mock.requests[0];
  assert.equal(request.method, 'POST');
  assert.match(request.url, /\/v1\/chat\/completions$/);
  assert.equal(request.headers.authorization, 'Bearer test-key');
  assert.equal(request.body.model, 'openai/gpt-oss-120b');
  assert.equal(request.body.messages[0].role, 'system');
  assert.equal(request.body.messages[1].content, 'create a Support category');
  assert.equal(request.body.tools[0].function.name, 'create_category');
  assert.equal(request.body.tool_choice, 'auto');
  assert.equal(request.body.max_tokens, 512);
  assert.equal(request.body.stream, false);

  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0].name, 'create_category');
  assert.deepEqual(response.toolCalls[0].arguments, { name: 'Support' });
  assert.equal(response.usage.total_tokens, 42);

  await mock.close();
});

test('a tool result is sent back in the tool role', async () => {
  const mock = await startServer([{ body: { choices: [{ message: { content: 'done' } }] } }]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'k',
    baseUrl: `${mock.baseUrl}/v1`,
    model: 'm',
    timeoutMs: 5000,
  });

  await provider.chat({
    messages: [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'call_1', name: 'list_channels', arguments: {} }],
      },
      { role: 'tool', toolCallId: 'call_1', content: JSON.stringify({ ok: true }) },
    ],
  });

  const body = mock.requests[0].body;
  assert.equal(body.messages[1].role, 'assistant');
  assert.equal(body.messages[1].tool_calls[0].function.name, 'list_channels');
  assert.equal(body.messages[2].role, 'tool');
  assert.equal(body.messages[2].tool_call_id, 'call_1');
  await mock.close();
});

test('a 429 becomes a quota error with the retry-after value', async () => {
  const mock = await startServer([
    { status: 429, headers: { 'retry-after': '30' }, body: { error: { message: 'rate limited' } } },
  ]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'k',
    baseUrl: `${mock.baseUrl}/v1`,
    model: 'm',
    timeoutMs: 5000,
  });

  await assert.rejects(
    () => provider.chat({ messages: [{ role: 'user', content: 'x' }] }),
    (err) => {
      assert.ok(err instanceof AiQuotaError);
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, 30);
      return true;
    },
  );
  await mock.close();
});

test('a 413 gives a free-tier size explanation without demanding an upgrade', async () => {
  const mock = await startServer([
    {
      status: 413,
      body: { error: { message: 'Request too large; upgrade to Dev Tier' } },
    },
  ]);
  const provider = new OpenAiCompatibleProvider({
    apiKey: 'k',
    baseUrl: mock.baseUrl,
    model: 'm',
    timeoutMs: 5000,
  });

  await assert.rejects(
    () => provider.chat({ messages: [{ role: 'user', content: 'x' }] }),
    (err) => {
      assert.ok(err instanceof AiProviderError);
      assert.equal(err.status, 413);
      assert.match(err.message, /free-tier token budget/);
      assert.doesNotMatch(err.message, /Dev Tier/);
      return true;
    },
  );
  assert.equal(mock.requests.length, 1, 'an oversized request must not be retried');
  await mock.close();
});

test('a 401 is reported as a provider error and is not retried', async () => {
  const mock = await startServer([
    { status: 401, body: { error: { message: 'invalid api key' } } },
  ]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'k',
    baseUrl: `${mock.baseUrl}/v1`,
    model: 'm',
    timeoutMs: 5000,
  });

  await assert.rejects(
    () => provider.chat({ messages: [{ role: 'user', content: 'x' }] }),
    (err) => {
      assert.ok(err instanceof AiProviderError);
      assert.equal(err.status, 401);
      return true;
    },
  );
  assert.equal(mock.requests.length, 1, 'a 401 must not be retried');
  await mock.close();
});

test('a server error is retried and then succeeds', async () => {
  const mock = await startServer([
    { status: 503, body: { error: { message: 'unavailable' } } },
    { body: { choices: [{ message: { content: 'recovered' } }] } },
  ]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'k',
    baseUrl: `${mock.baseUrl}/v1`,
    model: 'm',
    timeoutMs: 5000,
  });

  const response = await provider.chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(response.text, 'recovered');
  assert.equal(mock.requests.length, 2);
  await mock.close();
});

test('an invalid JSON answer is reported instead of crashing', async () => {
  const mock = await startServer([{ body: 'not json at all' }]);

  const provider = new OpenAiCompatibleProvider({
    apiKey: 'k',
    baseUrl: `${mock.baseUrl}/v1`,
    model: 'm',
    timeoutMs: 5000,
  });

  await assert.rejects(
    () => provider.chat({ messages: [{ role: 'user', content: 'x' }] }),
    /no usable message/i,
  );
  await mock.close();
});

test('the Gemini provider uses the native wire format', async () => {
  const mock = await startServer([
    {
      body: {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'create_category', args: { name: 'Support' } } }],
            },
          },
        ],
        usageMetadata: { totalTokenCount: 11 },
      },
    },
  ]);

  const provider = new GeminiProvider({
    apiKey: 'gemini-key',
    baseUrl: `${mock.baseUrl}/v1beta`,
    model: 'gemini-2.5-flash-lite',
    timeoutMs: 5000,
  });

  const response = await provider.chat({
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'create a Support category' },
    ],
    tools: [{ name: 'create_category', description: 'x', parameters: { type: 'object' } }],
    toolChoice: 'auto',
  });

  const request = mock.requests[0];
  assert.match(request.url, /generateContent\?key=gemini-key$/);
  assert.ok(request.body.systemInstruction.parts[0].text.includes('rules'));
  assert.equal(request.body.contents[0].role, 'user');
  assert.equal(request.body.tools[0].functionDeclarations[0].name, 'create_category');
  assert.equal(request.body.toolConfig.functionCallingConfig.mode, 'AUTO');

  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0].name, 'create_category');
  assert.deepEqual(response.toolCalls[0].arguments, { name: 'Support' });
  await mock.close();
});

test('the provider factory refuses to build a provider without a key', () => {
  assert.throws(
    () => createProvider({ provider: 'groq', apiKey: '' }),
    /AI_API_KEY/,
  );
});

test('the provider factory builds a fallback chain', () => {
  const chain = createProviderChain(
    {
      aiProvider: 'groq',
      aiBaseUrl: 'https://api.groq.com/openai/v1',
      aiModel: 'openai/gpt-oss-120b',
      aiApiKey: 'k',
      aiTimeoutMs: 1000,
      aiFallbacks: 'openrouter|https://openrouter.ai/api/v1|openrouter/free',
    },
    null,
  );
  assert.equal(chain.length, 2);
  assert.equal(chain[0].id, 'groq');
  assert.equal(chain[1].id, 'openrouter');
  assert.equal(chain[1].model, 'openrouter/free');
});

test('the provider factory ignores a malformed fallback entry', () => {
  const chain = createProviderChain(
    {
      aiProvider: 'groq',
      aiBaseUrl: 'https://api.groq.com/openai/v1',
      aiModel: 'openai/gpt-oss-120b',
      aiApiKey: 'k',
      aiTimeoutMs: 1000,
      aiFallbacks: 'garbage',
    },
    null,
  );
  assert.equal(chain.length, 1);
});
