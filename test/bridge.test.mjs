import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('stdio MCP bridge forwards tools, identity, auth and errors without modifying evidence', async (t) => {
  const seen = [];
  const evidence = {
    structuredContent: { evidence_id: 'fixture_evidence' },
    content: [{ type: 'text', text: '{"evidence_id":"fixture_evidence"}' }],
  };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    seen.push({ auth: req.headers.authorization, path: req.url, ...message });
    res.setHeader('Content-Type', 'application/json');
    if (message.method === 'tools/list')
      res.end(
        JSON.stringify({
          tools: [
            {
              name: 'fixture_tool',
              description: 'Fixture only',
              inputSchema: { type: 'object', properties: { fail: { type: 'boolean' } } },
            },
          ],
        }),
      );
    else if (message.params.arguments?.fail) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: 'User declined this action' }));
    } else res.end(JSON.stringify(evidence));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const client = new Client({ name: 'bridge-test', version: '1' });
  t.after(async () => {
    await client.close();
    await new Promise((r) => server.close(r));
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('server/bridge.mjs')],
    env: {
      REA_WORKBENCH_URL: 'http://127.0.0.1:' + server.address().port,
      REA_WORKBENCH_BRIDGE_TOKEN: 'fixture-token',
      REA_WORKBENCH_SESSION: 'fixture-session',
    },
  });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, 'fixture_tool');
  assert.deepEqual(await client.callTool({ name: 'fixture_tool', arguments: {} }), evidence);
  await assert.rejects(
    () => client.callTool({ name: 'fixture_tool', arguments: { fail: true } }),
    /User declined/,
  );
  assert.ok(
    seen.every(
      (m) =>
        m.auth === 'Bearer fixture-token' &&
        m.sessionId === 'fixture-session' &&
        m.path === '/api/bridge',
    ),
  );
});
