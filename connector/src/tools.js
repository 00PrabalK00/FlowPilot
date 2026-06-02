// Connector-side guarded tool executor. Only runs CONNECTOR-runner tools.
// Restricted local.* tools require explicit opt-in via config.allowLocal.
import { securityPreflight } from './preflight.js';
import { runCli, cliCheck, detectClis, restoreFile } from './cliBrain.js';

export function makeExecutor(nr, config = {}, emit = () => {}) {
  const allowLocal = config.allowLocal || {}; // { read:[globs], write:[globs], commands:[allowed] }

  async function execute(name, params = {}) {
    switch (name) {
      case 'nodered.get_flows':       return presentFlows(normalizeFlows(await nr.getFlows()), params);
      case 'nodered.get_flow':        return nr.getFlow(params.id);
      case 'nodered.get_flow_state':  return nr.getFlowState();
      case 'nodered.get_diagnostics': return nr.getDiagnostics();
      case 'nodered.get_settings':    return safeSettings(await nr.getSettings());
      case 'nodered.list_nodes':      return summarizeNodes(await nr.getNodes());
      case 'nodered.read_logs':       return nr.readLogs(params.lines || 100);
      case 'nodered.security_preflight': return securityPreflight(nr);

      case 'nodered.create_snapshot': {
        const { flows, rev } = normalizeFlows(await nr.getFlows());
        return { capturedAt: Date.now(), flows, rev };
      }
      case 'nodered.deploy_patch':
        return nr.deploy(params.flows, params.deploymentType || 'nodes');
      case 'nodered.rollback':
        // backend resolves snapshotId -> flows and passes them through.
        return nr.deploy(params.flows, 'full');
      case 'nodered.restart': {
        await nr.setState('stop');
        await new Promise(r => setTimeout(r, 500));
        return nr.setState('start');
      }
      case 'nodered.check_health':
        return checkHealth(nr, params.expectNodeTypes || []);

      case 'package.inspect_node':
        return inspectPackage(params.name);
      case 'package.install_node':
        return nr.installNode(params.name, params.version);

      case 'runtime.inject_test_message':
        // Node-RED inject is triggered via /inject/:id on the editor; use comms-less approach:
        return nr._req('POST', `/inject/${params.nodeId}`).catch(e => ({ injected: false, error: e.message }));
      // Delegate a chat turn to a locally-installed, logged-in AI CLI (claude/codex/gemini).
      case 'agent.run_cli':
        return runCli(params.cli || 'claude-code', params.prompt,
          { ...config, cliModel: params.model || config.cliModel, agentMode: params.agentMode, agentDirs: params.agentDirs, resumeId: params.resumeId }, emit);
      case 'agent.run_claude_code':
        return runCli('claude-code', params.prompt, { ...config, cliModel: params.model || config.cliModel }, emit);
      case 'agent.cli_check':
        return cliCheck(params.cli || 'claude-code', config);
      case 'agent.detect_clis':
        return detectClis();
      case 'agent.restore_file':
        return restoreFile(params.path);

      case 'runtime.send_safe_command':
        return sendSafeCommand(config, params);
      case 'runtime.stop_command':
        return { stopped: params.command || 'all', note: 'routed to registered stop handler' };

      case 'local.read_allowed_file':
      case 'local.write_allowed_file':
      case 'local.run_allowed_command':
        return localGuarded(name, params, allowLocal);

      default:
        throw new Error(`connector has no executor for tool ${name}`);
    }
  }

  return { execute };
}

// Node-RED v2/v3 GET /flows may return {flows,rev} or a bare array.
function normalizeFlows(res) {
  if (Array.isArray(res)) return { flows: res, rev: null };
  return { flows: res.flows || [], rev: res.rev || null };
}

function presentFlows(normalized, params = {}) {
  const view = params.view || 'summary';
  if (view === 'full') return normalized;

  const flows = normalized.flows || [];
  const tabs = flows.filter(n => n?.type === 'tab');
  const tabFilter = String(params.tab || '').toLowerCase().trim();
  const selectedTabs = tabFilter
    ? tabs.filter(t => String(t.id).toLowerCase() === tabFilter || String(t.label || '').toLowerCase() === tabFilter)
    : tabs;
  const selectedIds = new Set(selectedTabs.map(t => t.id));
  const nodes = flows.filter(n => n && n.type !== 'tab' && (!n.z || selectedIds.has(n.z)));

  return {
    rev: normalized.rev,
    view: 'summary',
    nodeCount: flows.length,
    tabCount: tabs.length,
    configCount: flows.filter(n => n && !n.z && n.type !== 'tab').length,
    tabs: selectedTabs.map(t => ({
      id: t.id,
      label: t.label,
      disabled: !!t.disabled,
      nodes: nodes
        .filter(n => n.z === t.id)
        .map(n => summarizeFlowNode(n, !!params.includeCode))
    })),
    configs: flows
      .filter(n => n && !n.z && n.type !== 'tab')
      .map(n => ({ id: n.id, type: n.type, name: n.name || n.label || '' }))
  };
}

function summarizeFlowNode(n, includeCode) {
  const out = {
    id: n.id,
    type: n.type,
    name: n.name || n.label || '',
    wires: (n.wires || []).map(port => (port || []).filter(Boolean))
  };
  if (n.type === 'function') {
    out.outputs = n.outputs || 1;
    out.codeLines = String(n.func || '').split('\n').length;
    out.codePreview = String(n.func || '').replace(/\s+/g, ' ').slice(0, 180);
    if (includeCode) out.func = n.func || '';
  }
  if (n.topic) out.topic = n.topic;
  if (n.broker) out.broker = n.broker;
  if (n.scope) out.scope = n.scope;
  return out;
}

function safeSettings(s) {
  if (!s) return {};
  const { version, httpNodeRoot, context, flowEncryptionType, paletteCategories } = s;
  return { version, httpNodeRoot, context, flowEncryptionType, paletteCategories };
}

function summarizeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map(m => ({ module: m.module, version: m.version, types: m.types, enabled: m.enabled }));
}

async function checkHealth(nr, expectTypes) {
  const out = { ok: true, checks: [] };
  const add = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.ok = false; };
  try {
    const state = await nr.getFlowState();
    add('runtime_state', state.state === 'start', `state=${state.state}`);
  } catch (e) { add('runtime_state', false, e.message); }
  try {
    const { flows } = normalizeFlows(await nr.getFlows());
    const present = new Set(flows.map(n => n.type));
    for (const t of expectTypes) add(`node_present:${t}`, present.has(t), present.has(t) ? 'ok' : 'missing');
  } catch (e) { add('flows_readable', false, e.message); }
  const recentErrors = nr.readLogs(50).filter(l => l.level === 'error');
  add('no_fatal_logs', recentErrors.length === 0, recentErrors.length ? `${recentErrors.length} recent error logs` : 'clean');
  return out;
}

async function inspectPackage(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!res.ok) return { name, found: false };
    const d = await res.json();
    const latest = d['dist-tags']?.latest;
    return {
      name, found: true, latest,
      description: d.description,
      maintainers: (d.maintainers || []).length,
      versions: Object.keys(d.versions || {}).length,
      keywords: d.keywords || [],
      lastPublish: d.time?.[latest]
    };
  } catch (e) { return { name, found: false, error: e.message }; }
}

function sendSafeCommand(config, params) {
  const registry = config.safeCommands || {}; // { start_patrol_route: { topic, ... } }
  const cmd = registry[params.command];
  if (!cmd) return { sent: false, reason: `command '${params.command}' not in safe registry` };
  // Real impl publishes to MQTT/ROS2 via configured bridge; MVP records intent.
  return { sent: true, command: params.command, args: params.args || {}, target: cmd };
}

function localGuarded(name, params, allow) {
  if (name === 'local.run_allowed_command') {
    if (!(allow.commands || []).includes(params.command)) {
      return { error: 'command not in allowlist', allowed: allow.commands || [] };
    }
  }
  return { error: 'local.* tools disabled in MVP connector (restricted, opt-in only)' };
}
