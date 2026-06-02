// 5 validation passes (section 10). Returns {ok, passes:[{name,ok,issues}]}.
import { lintFunctionCode, runFunctionNode } from './code.js';

const CORE_TYPES = new Set([
  'tab', 'subflow', 'group', 'comment',
  'inject', 'debug', 'function', 'change', 'switch', 'template', 'delay', 'trigger',
  'range', 'split', 'join', 'sort', 'batch', 'link in', 'link out', 'link call',
  'catch', 'status', 'complete', 'exec', 'file', 'file in', 'http in', 'http response',
  'http request', 'mqtt in', 'mqtt out', 'mqtt-broker', 'websocket in', 'websocket out',
  'tcp in', 'tcp out', 'tcp request', 'udp in', 'udp out', 'json', 'csv', 'html', 'xml',
  'yaml', 'rbe', 'tls-config', 'http proxy', 'mcp', 'json-config'
]);

const DANGEROUS_TYPES = new Set(['exec', 'file', 'tcp in', 'tcp out', 'tcp request', 'udp in', 'udp out', 'http request', 'websocket in', 'websocket out']);

export function validateFlow(flow, opts = {}) {
  const nodes = Array.isArray(flow) ? flow : (Array.isArray(flow?.flows) ? flow.flows : []);
  const installedTypes = opts.installedTypes ? new Set(opts.installedTypes) : null;
  const testMessages = opts.testMessages || [{ payload: 1 }];

  const passes = [
    pass1_schema(nodes),
    pass2_catalog(nodes, installedTypes),
    pass3_code(nodes),
    pass4_security(nodes),
    pass5_simulate(nodes, testMessages)
  ];

  const ok = passes.every(p => p.ok);
  return { ok, passes };
}

function pass1_schema(nodes) {
  const issues = [];
  const ids = new Set();
  const tabIds = new Set(nodes.filter(n => n && typeof n === 'object' && (n.type === 'tab' || n.type === 'subflow')).map(n => n.id));
  for (const [idx, n] of nodes.entries()) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      issues.push(err('invalid_node', `entry ${idx} is not a Node-RED node object`));
      continue;
    }
    if (!n.id) issues.push(err('missing_id', `node has no id (type=${n.type})`));
    if (!n.type) issues.push(err('missing_type', `node ${n.id} has no type`));
    if (ids.has(n.id)) issues.push(err('duplicate_id', `duplicate node id ${n.id}`));
    if (n.id) ids.add(n.id);
  }
  for (const n of nodes) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) continue;
    if (n.z && !tabIds.has(n.z)) issues.push(err('bad_tab_ref', `node ${n.id} z=${n.z} references missing tab`));
    for (const port of n.wires || []) {
      for (const target of port || []) {
        if (!ids.has(target)) issues.push(err('dangling_wire', `node ${n.id} wires to missing node ${target}`));
      }
    }
  }
  return mkPass('json_schema', issues);
}

function pass2_catalog(nodes, installed) {
  const issues = [];
  for (const n of nodes.filter(isNodeObject)) {
    const known = CORE_TYPES.has(n.type) || (installed && installed.has(n.type));
    if (!known) {
      issues.push((installed ? err : warn)('unknown_type', `node type '${n.type}' not in catalog${installed ? ' (not installed)' : ' (catalog unknown — connector offline)'}`));
    }
  }
  return mkPass('node_catalog', issues);
}

function pass3_code(nodes) {
  const issues = [];
  for (const n of nodes.filter(n => isNodeObject(n) && n.type === 'function')) {
    const r = lintFunctionCode(n.func || '');
    for (const i of r.issues) issues.push({ ...i, node: n.id });
  }
  return mkPass('code', issues);
}

function pass4_security(nodes) {
  const issues = [];
  for (const n of nodes.filter(isNodeObject)) {
    if (DANGEROUS_TYPES.has(n.type)) issues.push(warn('dangerous_node', `'${n.type}' node ${n.id} is high-risk; review.`));
    if (n.type === 'http in' && !n.url) issues.push(warn('http_no_url', `http-in ${n.id} has no url`));
    if (n.type === 'mqtt in' && /[#+]/.test(n.topic || '')) issues.push(warn('mqtt_wildcard', `mqtt-in ${n.id} uses wildcard topic '${n.topic}' (message-storm risk)`));
    // embedded credentials / secrets in plain fields
    const blob = JSON.stringify(n);
    if (/"(password|secret|token|apikey|api_key)"\s*:\s*"[^"]{3,}"/i.test(blob)) {
      issues.push(err('embedded_secret', `node ${n.id} appears to embed a secret literal; use a SECRET_REF + credentials store.`));
    }
    if (/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(n.url || n.server || '')) {
      issues.push(warn('external_url', `node ${n.id} points at external URL`));
    }
  }
  return mkPass('security', issues);
}

function pass5_simulate(nodes, messages) {
  const issues = [];
  const results = [];
  for (const n of nodes.filter(n => isNodeObject(n) && n.type === 'function')) {
    for (const msg of messages) {
      const r = runFunctionNode(n.func || '', msg);
      results.push({ node: n.id, input: msg, ...r });
      if (!r.ok) issues.push(err('sim_threw', `function ${n.id} threw on ${JSON.stringify(msg)}: ${r.error}`));
    }
  }
  const p = mkPass('runtime_simulation', issues);
  p.results = results;
  return p;
}

const err = (id, msg) => ({ severity: 'error', id, msg });
const warn = (id, msg) => ({ severity: 'warn', id, msg });
function mkPass(name, issues) {
  return { name, ok: !issues.some(i => i.severity === 'error'), issues };
}

function isNodeObject(n) {
  return !!n && typeof n === 'object' && !Array.isArray(n);
}
