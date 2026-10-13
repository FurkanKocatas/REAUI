import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(join(root, 'results'), { recursive: true, mode: 0o700 });
    mkdirSync(join(root, 'workspaces'), { recursive: true, mode: 0o700 });
    const file = join(root, 'state.json');
    this.state = existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : { sessions: [], runs: [], settings: { provider: 'codex', model: '' } };
    for (const run of this.state.runs)
      if (['running', 'queued', 'awaiting_approval'].includes(run.status)) {
        run.status = 'interrupted';
        run.error = 'The workbench restarted before this run finished.';
      }
    for (const session of this.state.sessions)
      for (const m of session.messages)
        if (m.status === 'running') {
          m.status = 'interrupted';
          m.text += '\n\nThis response was interrupted by a server restart.';
        }
    this.save();
  }
  save() {
    const path = join(this.root, 'state.json');
    writeFileSync(path + '.tmp', JSON.stringify(this.state), { mode: 0o600 });
    renameSync(path + '.tmp', path);
  }
  createSession(input = {}) {
    const session = {
      id: randomUUID(),
      title: String(input.title || 'New investigation').slice(0, 120),
      target: String(input.target || ''),
      provider: input.provider === 'claude' ? 'claude' : 'codex',
      model: String(input.model || ''),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      archived: false,
    };
    this.state.sessions.unshift(session);
    this.save();
    return session;
  }
  session(id) {
    const s = this.state.sessions.find((s) => s.id === id);
    if (!s) throw Object.assign(new Error('Investigation not found'), { status: 404 });
    return s;
  }
  run(id) {
    const r = this.state.runs.find((r) => r.id === id);
    if (!r) throw Object.assign(new Error('Run not found'), { status: 404 });
    return r;
  }
  addRun(sessionId, tool, args, source = 'dashboard') {
    this.session(sessionId);
    const run = {
      id: randomUUID(),
      sessionId,
      tool,
      args,
      source,
      status: 'queued',
      startedAt: new Date().toISOString(),
      progress: [],
      summary: null,
    };
    this.state.runs.unshift(run);
    this.save();
    return run;
  }
  resultPath(id) {
    this.run(id);
    return join(this.root, 'results', id + '.json');
  }
  putResult(id, result) {
    writeFileSync(this.resultPath(id), JSON.stringify(result), { mode: 0o600 });
  }
  result(id) {
    return JSON.parse(readFileSync(this.resultPath(id), 'utf8'));
  }
  workspace(id) {
    this.session(id);
    const p = join(this.root, 'workspaces', id);
    mkdirSync(p, { recursive: true });
    return p;
  }
}

export function unpack(result) {
  if (result.structuredContent) return result.structuredContent;
  for (const c of result.content || [])
    if (c.type === 'text') {
      try {
        return JSON.parse(c.text);
      } catch {}
    }
  return result;
}
export function summarize(result) {
  const e = unpack(result),
    r = e.normalized_result || e.result || e;
  return {
    evidenceId: e.evidence_id || null,
    confidence: e.confidence || null,
    operation: e.operation || null,
    statistics: r.statistics || null,
    summary: r.summary || null,
    coverage: r.graph?.coverage || r.coverage || e.relationship_coverage || null,
    limitations: [...new Set([...(e.limitations || []), ...(r.limitations || [])])].slice(0, 12),
    graph: r.graph
      ? { nodes: r.graph.nodes?.length || 0, edges: r.graph.edges?.length || 0 }
      : null,
    error: result.isError
      ? e.user_message ||
        e.message ||
        r.message ||
        result.content?.find((c) => c.type === 'text')?.text ||
        'REA could not complete this operation'
      : null,
  };
}

export function requiresReview(tool) {
  if (tool.annotations?.destructiveHint === true) return true;
  if (
    /^(capture_.*scenario|observe_native_calls|instrument_with_frida|start_frida_session|load_frida_script|resume_frida_session|push_adb_file|install_adb_package|uninstall_adb_package|start_adb_app|start_adb_activity|stop_adb_app|extract_|recover_javascript_sources|export_)/.test(
      tool.name,
    )
  )
    return true;
  return (
    tool.annotations?.readOnlyHint !== true &&
    !/^(inspect_|analyze_|list_|search_|trace_|resolve_|read_|compare_|verify_|identify_|decode_|project_|get_|open_binary$|close_binary$|binary_session$|reconcile_|demangle_)/.test(
      tool.name,
    )
  );
}
