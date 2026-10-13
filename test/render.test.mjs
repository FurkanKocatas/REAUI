import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { Rea } from '../server/rea.mjs';
import { unpack } from '../server/store.mjs';

const root = resolve(import.meta.dirname, '..'),
  engine = process.env.REA_ROOT || join(root, 'vendor/rea');
test(
  'all live REA schemas, connection status, and real application graph render in React',
  { skip: !existsSync(join(engine, 'dist/main.js')), timeout: 60000 },
  async (t) => {
    const vite = await createServer({
        root,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
      }),
      rea = new Rea(engine);
    t.after(async () => {
      await rea.closeAll();
      await vite.close();
    });
    const { ToolDialog, Connections, GraphView, ToolLibrary } =
      await vite.ssrLoadModule('/src/App.jsx');
    await rea.connect('render-test');
    const status = await rea.status('render-test');
    for (const tool of rea.tools) {
      const html = renderToStaticMarkup(
        React.createElement(ToolDialog, { tool, target: '/fixture', onClose() {}, onRun() {} }),
      );
      assert.ok(html.includes(tool.name), tool.name);
    }
    const connection = renderToStaticMarkup(
      React.createElement(Connections, {
        providers: [],
        engine: status,
        tools: rea.tools,
        boot: { root: engine },
        onRefresh() {},
      }),
    );
    assert.ok(connection.includes('ChatGPT Codex'));
    assert.ok(connection.includes('Claude Code'));
    const catalog = renderToStaticMarkup(
      React.createElement(ToolLibrary, { tools: rea.tools, availability: {}, onSelect() {} }),
    );
    assert.ok(catalog.includes('191 tools'));
    const result = unpack(
      await rea.call('render-test', 'analyze_javascript_application', {
        input_path: join(engine, 'tests/conformance/readiness/electron'),
      }),
    );
    const graph = renderToStaticMarkup(
      React.createElement(GraphView, { graph: result.normalized_result.graph }),
    );
    assert.ok(graph.includes('<line'));
    assert.ok(graph.includes('readiness'));
    assert.ok(graph.includes('Application relationship graph'));
  },
);
