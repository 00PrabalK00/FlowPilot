// Smoke tests for the pure guard logic (no sqlite / network / Node-RED needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, isTool, Perm } from '@flowpilot/shared/tools';
import { evaluate, Decision } from '../src/permission.js';
import { validateFlow } from '../src/validation/index.js';
import { lintFunctionCode } from '../src/validation/code.js';
import { generateFunctionNode } from '../src/tools/codegen.js';
import { diffFlows } from '../src/tools/diff.js';
import { manualControlFlow } from '../src/tools/dispatch.js';
import { redact, redactObject } from '../src/redact.js';

test('tool registry: known + unknown', () => {
  assert.ok(isTool('nodered.get_flows'));
  assert.ok(!isTool('nodered.nope'));
});

test('permission: safe read auto-allowed', () => {
  assert.equal(evaluate('nodered.get_flows', { role: 'builder' }).decision, Decision.ALLOW);
});

test('tool registry: get_flows supports compact summary reads', () => {
  assert.deepEqual(TOOLS['nodered.get_flows'].params, { view: 'string?', tab: 'string?', includeCode: 'boolean?' });
});

test('permission: deploy needs approval', () => {
  assert.equal(evaluate('nodered.deploy_patch', { role: 'maintainer' }).decision, Decision.APPROVAL);
});

test('tool registry: deploy_patch accepts draftId, not raw flows', () => {
  assert.deepEqual(TOOLS['nodered.deploy_patch'].params, { draftId: 'string', deploymentType: 'string?' });
});

test('tool registry: manual control draft function is available', () => {
  assert.ok(isTool('flow.create_manual_control'));
  assert.equal(TOOLS['flow.create_manual_control'].perm, Perm.SAFE);
});

test('permission: builder cannot reach high-risk', () => {
  assert.equal(evaluate('package.install_node', { role: 'builder' }).decision, Decision.DENY);
});

test('permission: restricted off by default', () => {
  assert.equal(evaluate('local.run_allowed_command', { role: 'owner' }).decision, Decision.DENY);
});

test('permission: runtime control blocked in design mode', () => {
  assert.equal(evaluate('runtime.send_safe_command', { role: 'admin', runtimeMode: 'design' }).decision, Decision.DENY);
  assert.equal(evaluate('runtime.send_safe_command', { role: 'admin', runtimeMode: 'runtime' }).decision, Decision.APPROVAL);
});

test('function lint: top-level return is legal (Node-RED wraps)', () => {
  assert.ok(lintFunctionCode('return msg;').ok);
});

test('function lint: forbids eval + network + secret log', () => {
  assert.ok(!lintFunctionCode('eval("x")').ok);
  assert.ok(!lintFunctionCode('fetch("http://x")').ok);
  assert.ok(!lintFunctionCode('node.warn("password=" + msg.password)').ok);
});

test('codegen: dequeue passes its own lint', () => {
  const g = generateFunctionNode({ spec: 'dequeue queue' });
  assert.ok(g.lint.ok);
});

test('validateFlow: clean minimal flow passes all 5 passes', () => {
  const flow = [
    { id: 't', type: 'tab', label: 'T' },
    { id: 'i', type: 'inject', z: 't', wires: [['f']] },
    { id: 'f', type: 'function', z: 't', func: 'return msg;', wires: [['d']] },
    { id: 'd', type: 'debug', z: 't', wires: [] }
  ];
  const r = validateFlow(flow);
  assert.ok(r.ok, JSON.stringify(r.passes.flatMap(p => p.issues)));
});

test('manual control flow validates and emits only symbolic commands', () => {
  const flow = manualControlFlow({ commandTopic: 'robot/manual/control', commands: ['stop', 'dock now'] });
  const r = validateFlow(flow);
  assert.ok(r.ok, JSON.stringify(r.passes.flatMap(p => p.issues)));
  assert.ok(flow.some((n) => n.type === 'mqtt out' && n.topic === 'robot/manual/control'));
  assert.ok(flow.some((n) => n.type === 'inject' && n.payload === 'dock_now'));
});

test('validateFlow: dangling wire + embedded secret fail', () => {
  const flow = [
    { id: 't', type: 'tab', label: 'T' },
    { id: 'i', type: 'inject', z: 't', wires: [['missing']] },
    { id: 'x', type: 'mqtt-broker', password: 'hunter2supersecret' }
  ];
  const r = validateFlow(flow);
  assert.ok(!r.ok);
});

test('validateFlow: patch drafts may reference existing tabs', () => {
  const patch = [
    { id: 'f2', type: 'function', z: 'existing_tab', func: 'return msg;', wires: [] }
  ];
  assert.ok(!validateFlow(patch).ok);
  assert.ok(validateFlow(patch, { allowExternalTabRefs: true }).ok);
});

test('validateFlow: malformed entries and missing ids fail cleanly', () => {
  const r = validateFlow([{ id: 't', type: 'tab' }, { type: 'inject', z: 't' }, null]);
  assert.ok(!r.ok);
  const ids = r.passes.flatMap(p => p.issues).map(i => i.id);
  assert.ok(ids.includes('missing_id'));
  assert.ok(ids.includes('invalid_node'));
});

test('diff: new tab reports added nodes + runtime impact', () => {
  const d = diffFlows([], [{ id: 'a', type: 'inject' }, { id: 'b', type: 'debug' }]);
  assert.equal(d.added.length, 2);
  assert.ok(d.runtimeImpact);
});

test('redact: strips keys/ip/email', () => {
  assert.ok(redact('key sk-ABCDEFGHIJKLMNOP123456').includes('SECRET_REF_openai_key'));
  const o = redactObject({ host: '10.0.0.5', who: 'a@b.com', deep: { k: 'sk-ABCDEFGHIJKLMNOP123456' } });
  assert.equal(o.host, 'REDACTED_IP');
  assert.equal(o.who, 'REDACTED_EMAIL');
  assert.ok(String(o.deep.k).includes('SECRET_REF'));
});
