import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';

const root = resolve(import.meta.dirname, '..'),
  engine = process.env.REA_ROOT || join(root, 'vendor/rea');
const available = existsSync(join(engine, 'dist/main.js'));
let child,
  base,
  token,
  data,
  session,
  run,
  log = '';
async function request(path, options = {}) {
  return fetch(base + '/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Workbench-Token': token, ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
async function json(path, options) {
  const r = await request(path, options);
  const body = await r.json();
  assert.ok(r.ok, JSON.stringify(body));
  return body;
}
async function poll(fn, limit = 20000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  throw Error('Timeout. ' + log.slice(-1500));
}

before(async () => {
  if (!available) return;
  const port = await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  base = 'http://127.0.0.1:' + port;
  data = mkdtempSync(join(tmpdir(), 'reau-api-'));
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      REA_ROOT: engine,
      REA_WORKBENCH_DATA: data,
      REA_CODEX_COMMAND: 'rea-test-no-codex',
      REA_CLAUDE_COMMAND: 'rea-test-no-claude',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));
  const boot = await poll(async () => {
    try {
      const r = await fetch(base + '/api/bootstrap');
      const b = await r.json();
      return b.ready ? b : false;
    } catch {
      return false;
    }
  });
  token = boot.token;
});
after(async () => {
  if (child) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((r) => child.once('exit', r)),
      delay(6000, undefined, { ref: false }),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (data) rmSync(data, { recursive: true, force: true });
});

test(
  'loopback API protects against unrelated websites and unauthenticated calls',
  { skip: !available },
  async () => {
    assert.equal((await fetch(base + '/api/tools')).status, 401);
    assert.equal(
      (await request('/tools', { headers: { Origin: 'https://unrelated.example' } })).status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(
        base + '/api/bootstrap',
        { headers: { Host: 'unrelated.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    assert.equal(
      (await request('/bridge', { method: 'POST', body: { method: 'tools/list' } })).status,
      401,
    );
    assert.equal(
      (await request('/tools', { headers: { 'X-Workbench-Token': 'é'.repeat(64) } })).status,
      401,
    );
    assert.equal((await fetch(base)).status, 200);
  },
);

test(
  'real catalog, analysis, persistence, export, and review gate',
  { skip: !available, timeout: 60000 },
  async () => {
    const catalog = await json('/tools');
    assert.ok(catalog.tools.length >= 190);
    assert.equal(new Set(catalog.tools.map((t) => t.name)).size, catalog.tools.length);
    assert.ok(catalog.tools.find((t) => t.name === 'analyze_javascript_application')?.inputSchema);
    session = await json('/sessions', {
      method: 'POST',
      body: {
        title: 'Integration fixture',
        target: join(engine, 'tests/conformance/readiness/electron'),
      },
    });
    assert.equal(
      (
        await request('/runs', {
          method: 'POST',
          body: { sessionId: session.id, tool: 'invented_tool', args: {} },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('/runs', {
          method: 'POST',
          body: { sessionId: session.id, tool: 'extract_artifact', args: {} },
        })
      ).status,
      409,
    );
    const status = await json('/status?session=' + session.id);
    assert.equal(status.open, false);
    run = await json('/runs', {
      method: 'POST',
      body: {
        sessionId: session.id,
        tool: 'analyze_javascript_application',
        args: { input_path: session.target },
      },
    });
    const finished = await poll(async () => {
      const b = await (await fetch(base + '/api/bootstrap')).json();
      const r = b.runs.find((r) => r.id === run.id);
      return ['completed', 'failed'].includes(r.status) ? r : false;
    });
    assert.equal(finished.status, 'completed', finished.error);
    assert.equal(finished.summary.statistics.relevant_files, 6);
    assert.ok(finished.summary.statistics.findings > 0);
    assert.ok(finished.summary.graph.nodes > 0);
    const result = await json('/runs/' + run.id + '/result');
    assert.ok(result.structuredContent.evidence_id);
    assert.ok(result.structuredContent.normalized_result.graph.edges.length > 0);
    const exported = await json('/sessions/' + session.id + '/export');
    assert.equal(exported.format, 'rea-workbench-investigation-v1');
    assert.deepEqual(exported.runs[0].result, result);
    await json('/sessions/' + session.id, {
      method: 'PATCH',
      body: { title: 'Renamed fixture', archived: true },
    });
    const b = await (await fetch(base + '/api/bootstrap')).json();
    assert.equal(b.sessions.find((s) => s.id === session.id).archived, true);
    assert.equal(
      (
        await request('/sessions/' + session.id + '/chat', {
          method: 'POST',
          body: { provider: 'claude', prompt: 'hello' },
        })
      ).status,
      409,
    );
    await json('/sessions/' + session.id + '/close-engine', { method: 'POST' });
  },
);

test(
  'local filesystem browse and uploaded contents stay under private data',
  { skip: !available },
  async () => {
    const listing = await json('/files?path=' + encodeURIComponent(root));
    assert.ok(listing.entries.some((e) => e.name === 'README.md'));
    const r = await fetch(base + '/api/upload', {
      method: 'POST',
      headers: {
        'X-Workbench-Token': token,
        'X-File-Name': encodeURIComponent('../../fixture.txt'),
      },
      body: 'fixture content',
    });
    assert.equal(r.status, 200);
    const file = await r.json();
    assert.ok(file.path.startsWith(join(data, 'uploads')));
    assert.equal(file.bytes, 15);
    assert.ok(file.path.endsWith('/fixture.txt'));
  },
);
