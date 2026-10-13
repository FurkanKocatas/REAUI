import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  createWriteStream,
  rmSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Store, unpack, summarize, requiresReview } from './store.mjs';
import { Rea } from './rea.mjs';
import { agentStatus, launchAgent } from './agents.mjs';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reaRoot = resolve(process.env.REA_ROOT || join(directory, 'vendor/rea'));
const dataRoot = resolve(process.env.REA_WORKBENCH_DATA || join(directory, '.data'));
const store = new Store(dataRoot),
  rea = new Rea(reaRoot);
const port = Number(process.env.PORT || 4318),
  host = '127.0.0.1';
const origin = `http://${host}:${port}`;
const browserToken = randomBytes(32).toString('hex'),
  bridgeToken = randomBytes(32).toString('hex');
const subscribers = new Set(),
  operations = new Map(),
  approvals = new Map(),
  agents = new Map();
let providerStatus = [],
  readinessError = null,
  vite;
const emit = (type, data) => {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of subscribers) {
    if (response.writableLength > 2 * 1024 * 1024) {
      response.end();
      subscribers.delete(response);
    } else response.write(message);
  }
};
const sameToken = (a, b) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (res, value, status = 200) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
};
const body = async (req) => {
  let bytes = 0,
    chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) throw error('Request exceeds 16 MiB', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw error('Invalid JSON');
  }
};

async function execute(run, { approved = false, agent = false } = {}) {
  const controller = new AbortController();
  operations.set(run.id, controller);
  try {
    await rea.connect(run.sessionId);
    const tool = rea.tools.find((t) => t.name === run.tool);
    if (!tool) throw error('Unknown REA tool: ' + run.tool);
    if (requiresReview(tool) && !approved) {
      if (!agent) throw error('Review this action before running it.');
      run.status = 'awaiting_approval';
      store.save();
      emit('run', run);
      await new Promise((yes, no) => {
        const cleanup = () => {
          clearTimeout(timeout);
          controller.signal.removeEventListener('abort', abort);
          approvals.delete(run.id);
        };
        const abort = () => {
          cleanup();
          no(new Error('Action cancelled'));
        };
        const timeout = setTimeout(() => {
          cleanup();
          no(new Error('Action review expired after 10 minutes'));
        }, 600000);
        approvals.set(run.id, (allow) => {
          cleanup();
          allow ? yes() : no(new Error('User declined this action'));
        });
        controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
      });
    }
    if (controller.signal.aborted) throw new Error('Action cancelled');
    run.status = 'running';
    store.save();
    emit('run', run);
    const result = await rea.call(run.sessionId, run.tool, run.args, controller.signal, (p) => {
      run.progress = [...run.progress.slice(-29), p];
      emit('run', run);
    });
    store.putResult(run.id, result);
    run.summary = summarize(result);
    run.status = result.isError ? 'failed' : 'completed';
    if (result.isError) run.error = run.summary.error;
    return result;
  } catch (e) {
    run.status = controller.signal.aborted ? 'cancelled' : 'failed';
    run.error = e.message;
    const result = { isError: true, content: [{ type: 'text', text: e.message }] };
    store.putResult(run.id, result);
    return result;
  } finally {
    operations.delete(run.id);
    run.finishedAt = new Date().toISOString();
    store.save();
    emit('run', run);
  }
}

async function api(req, res, url) {
  const path = url.pathname;
  if (path === '/api/bootstrap' && req.method === 'GET')
    return json(res, {
      token: browserToken,
      sessions: store.state.sessions,
      runs: store.state.runs,
      providers: providerStatus,
      toolCount: rea.tools.length,
      ready: rea.tools.length > 0,
      error: readinessError,
      root: reaRoot,
      dataRoot,
      defaultPath: join(homedir(), 'Documents'),
      samplePath: join(reaRoot, 'tests/conformance/readiness/electron'),
      settings: store.state.settings,
    });
  if (path === '/api/bridge') {
    if (!sameToken(req.headers.authorization?.replace(/^Bearer /, ''), bridgeToken))
      throw error('Invalid bridge token', 401);
    const input = await body(req);
    store.session(input.sessionId);
    await rea.connect(input.sessionId);
    if (input.method === 'tools/list') return json(res, { tools: rea.tools });
    if (input.method === 'tools/call') {
      if (!input.params || typeof input.params.name !== 'string') throw error('Tool name required');
      const run = store.addRun(
        input.sessionId,
        input.params.name,
        input.params.arguments || {},
        'agent',
      );
      emit('run', run);
      const onClose = () => {
        if (!res.writableEnded) operations.get(run.id)?.abort();
      };
      res.on('close', onClose);
      const result = await execute(run, { agent: true });
      res.off('close', onClose);
      return json(res, result);
    }
    throw error('Unknown bridge method');
  }
  const supplied =
    req.headers['x-workbench-token'] ||
    (path === '/api/events' ? url.searchParams.get('token') : null);
  if (!sameToken(supplied, browserToken)) throw error('Reload the dashboard to reconnect.', 401);
  if (path === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    subscribers.add(res);
    const interval = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => {
      clearInterval(interval);
      subscribers.delete(res);
    });
    return;
  }
  if (path === '/api/tools' && req.method === 'GET') {
    await rea.connect('catalog');
    return json(res, {
      tools: rea.tools.map((t) => ({
        ...t,
        outputSchema: undefined,
        requiresReview: requiresReview(t),
      })),
    });
  }
  if (path === '/api/providers' && req.method === 'GET') {
    providerStatus = await agentStatus();
    return json(res, providerStatus);
  }
  if (path === '/api/status' && req.method === 'GET') {
    const id = url.searchParams.get('session') || 'catalog';
    if (id !== 'catalog') store.session(id);
    return json(res, await rea.status(id));
  }
  if (path === '/api/files' && req.method === 'GET') {
    const selected = resolve(url.searchParams.get('path') || join(homedir(), 'Documents'));
    if (!statSync(selected).isDirectory()) throw error('Select a directory');
    const entries = readdirSync(selected, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      );
    return json(res, {
      path: selected,
      parent: dirname(selected),
      total: entries.length,
      entries: entries.slice(0, 500).map((d) => ({
        name: d.name,
        path: join(selected, d.name),
        directory: d.isDirectory(),
        symlink: d.isSymbolicLink(),
      })),
    });
  }
  if (path === '/api/upload' && req.method === 'POST') {
    const name = basename(decodeURIComponent(req.headers['x-file-name'] || 'artifact.bin')).replace(
      /[\x00-\x1f]/g,
      '_',
    );
    if (!name || name === '.' || name === '..') throw error('Invalid file name');
    const folder = join(dataRoot, 'uploads', randomBytes(12).toString('hex'));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const destination = join(folder, name);
    let bytes = 0;
    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk, enc, cb) {
            bytes += chunk.length;
            cb(
              bytes > 256 * 1024 * 1024
                ? error('Upload exceeds 256 MiB; select the local path instead', 413)
                : null,
              chunk,
            );
          },
        }),
        createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      );
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      throw e;
    }
    return json(res, { path: destination, bytes });
  }
  if (path === '/api/sessions' && req.method === 'POST') {
    const session = store.createSession(await body(req));
    emit('session', session);
    return json(res, session, 201);
  }
  const sessionMatch = path.match(
    /^\/api\/sessions\/([^/]+)(?:\/(chat|stop|export|close-engine))?$/,
  );
  if (sessionMatch) {
    const session = store.session(sessionMatch[1]),
      action = sessionMatch[2];
    if (!action && req.method === 'PATCH') {
      const input = await body(req);
      for (const key of ['title', 'target', 'model'])
        if (typeof input[key] === 'string')
          session[key] = input[key].slice(0, key === 'title' ? 120 : 4096);
      if (['codex', 'claude'].includes(input.provider)) session.provider = input.provider;
      if (typeof input.archived === 'boolean') session.archived = input.archived;
      session.updatedAt = new Date().toISOString();
      store.save();
      emit('session', session);
      return json(res, session);
    }
    if (action === 'chat' && req.method === 'POST') {
      if (agents.has(session.id))
        throw error('An agent is already responding in this investigation', 409);
      const input = await body(req);
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 50000)
        throw error('Enter a message under 50,000 characters');
      const provider = input.provider === 'claude' ? 'claude' : 'codex';
      const connection = providerStatus.find((p) => p.id === provider);
      if (!connection?.loggedIn)
        throw error(`Sign in to ${provider} first, then refresh Connections.`, 409);
      await rea.connect(session.id);
      const task = launchAgent({
        store,
        session,
        prompt: input.prompt,
        provider,
        model: typeof input.model === 'string' ? input.model : '',
        baseUrl: origin,
        bridgeToken,
        bridgePath: join(directory, 'server/bridge.mjs'),
        emit,
        onFinish: () => agents.delete(session.id),
      });
      agents.set(session.id, task);
      return json(res, { messageId: task.reply.id }, 202);
    }
    if (action === 'stop' && req.method === 'POST') {
      agents.get(session.id)?.cancel();
      for (const r of store.state.runs)
        if (r.sessionId === session.id && operations.has(r.id)) operations.get(r.id).abort();
      return json(res, { ok: true });
    }
    if (action === 'close-engine' && req.method === 'POST') {
      if (
        agents.has(session.id) ||
        store.state.runs.some((r) => r.sessionId === session.id && operations.has(r.id))
      )
        throw error('Stop running work before closing the engine', 409);
      await rea.close(session.id);
      return json(res, { ok: true });
    }
    if (action === 'export' && req.method === 'GET') {
      const runs = store.state.runs.filter((r) => r.sessionId === session.id);
      return json(res, {
        format: 'rea-workbench-investigation-v1',
        exportedAt: new Date().toISOString(),
        session,
        runs: runs.map((r) => ({
          ...r,
          result: existsSync(store.resultPath(r.id)) ? store.result(r.id) : null,
        })),
      });
    }
  }
  if (path === '/api/runs' && req.method === 'POST') {
    const input = await body(req);
    store.session(input.sessionId);
    await rea.connect(input.sessionId);
    const tool = rea.tools.find((t) => t.name === input.tool);
    if (!tool) throw error('Unknown REA tool');
    if (requiresReview(tool) && input.approved !== true)
      throw error('This action needs explicit review', 409);
    if (!input.args || typeof input.args !== 'object' || Array.isArray(input.args))
      throw error('Tool arguments must be an object');
    const run = store.addRun(input.sessionId, input.tool, input.args);
    emit('run', run);
    void execute(run, { approved: input.approved === true });
    return json(res, run, 202);
  }
  const runMatch = path.match(/^\/api\/runs\/([^/]+)(?:\/(result|cancel|review))?$/);
  if (runMatch) {
    const run = store.run(runMatch[1]);
    const action = runMatch[2];
    if (action === 'result' && req.method === 'GET') return json(res, store.result(run.id));
    if (action === 'cancel' && req.method === 'POST') {
      operations.get(run.id)?.abort();
      return json(res, { ok: true });
    }
    if (action === 'review' && req.method === 'POST') {
      const input = await body(req);
      const approve = approvals.get(run.id);
      if (!approve) throw error('This action is no longer waiting for review', 409);
      approve(input.allow === true);
      return json(res, { ok: true });
    }
  }
  throw error('Not found', 404);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // Loopback binding, exact Host and Origin checks, and separate UI/bridge tokens.
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return json(res, { error: 'Invalid Host' }, 403);
  if (req.headers.origin && !allowedHosts.some((h) => req.headers.origin === `http://${h}`))
    return json(res, { error: 'Cross-origin requests are not allowed' }, 403);
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw error('Method not allowed', 405);
    if (vite) return vite.middlewares(req, res);
    const dist = join(directory, 'dist'),
      requested = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!requested.startsWith(dist + '/') && requested !== dist) throw error('Invalid path', 403);
    let file =
      existsSync(requested) && statSync(requested).isFile() ? requested : join(dist, 'index.html');
    if (!existsSync(file)) throw error('Build the dashboard with npm run build first', 503);
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public,max-age=3600',
    });
    res.end(readFileSync(file));
  } catch (e) {
    json(res, { error: e.message }, e.status || 500);
  }
});
server.requestTimeout = 0;
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  vite = await createServer({
    root: directory,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
}
server.listen(port, host, () => console.log(`REA Workbench is running at ${origin}`));
void Promise.all([rea.connect('catalog'), agentStatus().then((p) => (providerStatus = p))])
  .then(() => emit('ready', { tools: rea.tools.length, providers: providerStatus }))
  .catch((e) => {
    readinessError = e.message;
    emit('error', { message: e.message });
  });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  for (const a of agents.values()) a.cancel();
  for (const c of operations.values()) c.abort();
  for (const res of subscribers) res.end();
  await rea.closeAll();
  await vite?.close();
  store.save();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
