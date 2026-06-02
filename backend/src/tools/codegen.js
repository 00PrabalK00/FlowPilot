// Constrained Function-node code generation (Workflow 4).
// Deterministic templates; the model picks which to request. Output is always linted.
import { lintFunctionCode } from '../validation/code.js';

export function generateFunctionNode({ spec = '', inputShape } = {}) {
  const s = spec.toLowerCase();
  let code, tests;

  if (s.includes('dequeue') || s.includes('queue')) {
    code = [
      "// dequeue one task from flow context queue 'tasks'",
      "const q = flow.get('tasks') || [];",
      "if (q.length === 0) { node.status({fill:'grey',text:'idle'}); return null; }",
      "const task = q.shift();",
      "flow.set('tasks', q);",
      "node.status({fill:'green',text:q.length+' left'});",
      "msg.payload = task;",
      "return msg;"
    ].join('\n');
    tests = [{ payload: 'tick' }];
  } else if (s.includes('enqueue')) {
    code = [
      "const q = flow.get('tasks') || [];",
      "q.push(msg.payload);",
      "flow.set('tasks', q);",
      "node.status({fill:'blue',text:q.length+' queued'});",
      "return null;"
    ].join('\n');
    tests = [{ payload: { id: 1 } }];
  } else {
    // safe pass-through default
    code = "// transform payload here\nreturn msg;";
    tests = [{ payload: 1 }];
  }

  const lint = lintFunctionCode(code);
  return { code, tests, inputShape: inputShape || null, lint };
}
