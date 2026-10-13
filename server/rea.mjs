import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { unpack } from './store.mjs';

export class Rea {
  constructor(root) { this.root = root; this.connections = new Map(); this.tools = []; this.initializing = new Map(); }
  async connect(id) {
    if (this.connections.has(id)) return this.connections.get(id);
    if (this.initializing.has(id)) return this.initializing.get(id);
    const promise = (async () => {
      const client = new Client({ name: 'rea-workbench', version: '0.1.0' });
      const transport = new StdioClientTransport({ command: process.execPath, args: [join(this.root, 'scripts/rea.mjs'), 'mcp'], cwd: this.root, env: { ...process.env, REA_LOG_LEVEL: 'silent', REA_MCP_MAX_RESPONSE_BYTES: String(64 * 1024 * 1024) }, stderr: 'pipe', maxBufferSize: 64 * 1024 * 1024 });
      try {
        await client.connect(transport);
        transport.stderr?.on('data', () => {});
        client.onclose = () => { if (this.connections.get(id) === client) this.connections.delete(id); };
        client.onerror = () => {};
        this.connections.set(id, client);
        if (!this.tools.length) {
          let cursor; do { const page = await client.listTools(cursor ? { cursor } : {}); this.tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
        }
        return client;
      } catch (error) { await client.close().catch(() => {}); throw error; }
    })();
    this.initializing.set(id, promise);
    try { return await promise; } finally { this.initializing.delete(id); }
  }
  async status(id = 'catalog') { const c = await this.connect(id); return unpack(await c.callTool({ name: 'binary_session', arguments: {} }, { timeout: 60000 })).result; }
  async call(id, name, args, signal, onprogress) {
    const c = await this.connect(id);
    return c.callTool({ name, arguments: args }, { signal, timeout: 30 * 60 * 1000, resetTimeoutOnProgress: true, onprogress });
  }
  async close(id) { const c = this.connections.get(id); this.connections.delete(id); await c?.close(); }
  async closeAll() { await Promise.allSettled([...this.connections.keys()].map(id => this.close(id))); }
}
