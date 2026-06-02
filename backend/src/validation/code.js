// Function-node JS static checks (Pass 3) + constrained generation guard.
import vm from 'node:vm';

const FORBIDDEN = [
  { re: /\beval\s*\(/, id: 'eval', msg: 'eval() forbidden (unsafe dynamic execution).' },
  { re: /new\s+Function\s*\(/, id: 'new_function', msg: 'new Function() forbidden.' },
  { re: /\brequire\s*\(\s*['"](fs|child_process|net|dgram|http|https|cluster|os|vm)['"]/, id: 'forbidden_require', msg: 'require of sensitive core module forbidden.' },
  { re: /\bprocess\.(env|exit|kill|binding)/, id: 'process_access', msg: 'process.* access forbidden.' },
  { re: /\b(fetch|XMLHttpRequest)\s*\(/, id: 'network_call', msg: 'hidden network call forbidden in function node.' },
  { re: /\bglobal(This)?\b/, id: 'global_access', msg: 'global object access forbidden.' },
  { re: /while\s*\(\s*true\s*\)/, id: 'infinite_loop', msg: 'while(true) — unbounded loop risk.' },
  { re: /for\s*\(\s*;\s*;\s*\)/, id: 'infinite_loop', msg: 'for(;;) — unbounded loop risk.' }
];

const SECRET_LOG = /(node\.(warn|error|log)|console\.(log|warn|error))\s*\([^)]*(password|secret|token|apikey|api_key|credential)/i;

export function lintFunctionCode(code) {
  const issues = [];
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: true, issues, note: 'no code' };
  }

  // syntax check via vm compile (does not execute).
  // Node-RED wraps function-node code in a function body, so top-level `return` is legal — wrap to match.
  try {
    new vm.Script(`(async function(msg){\n${code}\n})`, { filename: 'function-node.js' });
  } catch (e) {
    issues.push({ severity: 'error', id: 'syntax', msg: `syntax error: ${e.message}` });
  }

  for (const f of FORBIDDEN) if (f.re.test(code)) issues.push({ severity: 'error', id: f.id, msg: f.msg });
  if (SECRET_LOG.test(code)) issues.push({ severity: 'error', id: 'secret_leak', msg: 'possible secret logged.' });

  // message shape sanity
  if (!/\breturn\b/.test(code) && !/node\.send\s*\(/.test(code)) {
    issues.push({ severity: 'warn', id: 'no_output', msg: 'function neither returns nor calls node.send(); produces no message.' });
  }

  const ok = !issues.some(i => i.severity === 'error');
  return { ok, issues };
}

// Minimal sandboxed run for simulation (Pass 5). Times out, no I/O.
export function runFunctionNode(code, msg) {
  const sent = [];
  const sandbox = {
    msg: structuredClone(msg ?? {}),
    node: {
      send: (m) => sent.push(m),
      warn: () => {}, error: () => {}, log: () => {}, status: () => {}
    },
    context: stubContext(), flow: stubContext(), global: stubContext(),
    RED: { util: { cloneMessage: (m) => structuredClone(m) } },
    Buffer
  };
  const wrapped = `(function(){ ${code}\n; if (typeof msg !== 'undefined') return msg; })()`;
  try {
    const result = vm.runInNewContext(wrapped, sandbox, { timeout: 1000 });
    if (result !== undefined) sent.push(result);
    return { ok: true, outputs: sent };
  } catch (e) {
    return { ok: false, error: e.message, outputs: sent };
  }
}

function stubContext() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v) };
}
