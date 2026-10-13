import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, summarize, requiresReview } from '../server/store.mjs';
import { initialArgs, resolveSchema, toFormValues, parseFormArgs } from '../src/lib.js';

test('restart preserves evidence and marks unfinished work interrupted', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'reau-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(root),
    session = store.createSession({ title: 'Fixture' });
  const run = store.addRun(session.id, 'inspect_artifact', { path: '/fixture' });
  const result = {
    structuredContent: {
      evidence_id: 'ev_fixture',
      normalized_result: { statistics: { findings: 2 } },
      limitations: ['Static evidence only'],
    },
  };
  store.putResult(run.id, result);
  run.status = 'completed';
  const interrupted = store.addRun(session.id, 'binary_session', {});
  interrupted.status = 'running';
  session.messages.push({ role: 'assistant', text: 'Partial', status: 'running' });
  store.save();
  const restarted = new Store(root);
  assert.deepEqual(restarted.result(run.id), result);
  assert.equal(restarted.run(run.id).status, 'completed');
  assert.equal(restarted.run(interrupted.id).status, 'interrupted');
  assert.equal(restarted.session(session.id).messages[0].status, 'interrupted');
  assert.throws(() => restarted.resultPath('../../outside'), /not found/);
  if (process.platform !== 'win32')
    assert.equal(statSync(join(root, 'state.json')).mode & 0o777, 0o600);
});

test('unknown and destructive operations require review; static analysis can run directly', () => {
  for (const name of [
    'execute_code',
    'capture_electron_scenario',
    'extract_artifact',
    'export_analysis',
    'load_frida_script',
    'install_adb_package',
  ])
    assert.equal(requiresReview({ name }), true, name);
  assert.equal(
    requiresReview({
      name: 'inspect_something',
      annotations: { destructiveHint: true, readOnlyHint: true },
    }),
    true,
  );
  for (const name of ['analyze_javascript_application', 'inspect_packet_capture', 'binary_session'])
    assert.equal(requiresReview({ name }), false, name);
});

test('summaries retain evidence identity and limitations; full result remains untouched', () => {
  const result = {
    structuredContent: {
      evidence_id: 'ev_1',
      confidence: 'derived',
      limitations: ['Static only'],
      normalized_result: {
        graph: { nodes: [{}], edges: [] },
        limitations: ['Static only', 'Incomplete'],
        statistics: { findings: 2 },
      },
    },
  };
  const before = JSON.stringify(result),
    summary = summarize(result);
  assert.equal(summary.evidenceId, 'ev_1');
  assert.equal(summary.confidence, 'derived');
  assert.deepEqual(summary.graph, { nodes: 1, edges: 0 });
  assert.deepEqual(summary.limitations, ['Static only', 'Incomplete']);
  assert.equal(JSON.stringify(result), before);
  assert.equal(
    summarize({ isError: true, content: [{ type: 'text', text: 'Target unavailable' }] }).error,
    'Target unavailable',
  );
});

test('schema helpers resolve references and preserve defaults without inventing required values', () => {
  const inputSchema = {
    properties: {
      input_path: { type: 'string' },
      mode: { $ref: '#/$defs/mode' },
      count: { type: 'integer' },
      enabled: { type: 'boolean', default: false },
    },
    $defs: {
      mode: {
        anyOf: [
          { type: 'string', enum: ['summary', 'full'], default: 'summary' },
          { type: 'null' },
        ],
      },
    },
  };
  assert.equal(resolveSchema(inputSchema.properties.mode, inputSchema).type, 'string');
  assert.deepEqual(initialArgs({ inputSchema }, '/fixture'), {
    input_path: '/fixture',
    mode: 'summary',
    enabled: false,
  });
});

test('nullable tool defaults survive form/JSON switching without becoming strings or NaN', () => {
  const schema = {
    properties: {
      count: { anyOf: [{ type: 'integer' }, { type: 'null' }], default: null },
      filter: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
      fields: { type: 'array', items: { type: 'string' } },
    },
    required: ['fields'],
  };
  const values = toFormValues(initialArgs({ inputSchema: schema }, ''));
  assert.deepEqual(parseFormArgs(schema, values, false), { count: null, filter: null });
  assert.throws(() => parseFormArgs(schema, values), /fields is required/);
  assert.deepEqual(parseFormArgs(schema, { ...values, fields: '["ip.addr"]' }), {
    count: null,
    filter: null,
    fields: ['ip.addr'],
  });
});
