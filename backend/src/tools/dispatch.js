// Tool dispatcher. Runs BACKEND tools locally; routes CONNECTOR tools through the tunnel.
// Implements the safe-deploy pipeline (sections 7 & 15) for nodered.deploy_patch.
import { TOOLS, Runner } from '@flowpilot/shared/tools';
import { EventType, makeEvent } from '@flowpilot/shared/events';
import { invokeConnector } from '../connectorHub.js';
import { Snapshots, Drafts } from '../store.js';
import { validateFlow } from '../validation/index.js';
import { generateFunctionNode } from './codegen.js';
import { lintFunctionCode } from '../validation/code.js';
import { diffFlows } from './diff.js';
import { redact } from '../redact.js';

export async function dispatchTool(ctx, tool, params = {}) {
  const def = TOOLS[tool];
  if (!def) throw new Error(`unknown tool ${tool}`);
  if (def.runner === Runner.BACKEND) return backendTool(ctx, tool, params);

  // CONNECTOR-runner tools (with orchestration wrappers)
  switch (tool) {
    case 'nodered.create_snapshot': {
      const { flows, rev } = await invokeConnector(ctx.workspaceId, 'nodered.get_flows', { view: 'full' });
      const snapshotId = Snapshots.create(ctx.workspaceId, flows, rev, 'manual snapshot');
      return { snapshotId, nodeCount: flows.length };
    }
    case 'nodered.deploy_patch':
      return deployPipeline(ctx, params);
    case 'nodered.rollback': {
      const snap = Snapshots.get(params.snapshotId);
      if (!snap) throw new Error(`snapshot ${params.snapshotId} not found`);
      ctx.emit(makeEvent(EventType.ROLLBACK_STARTED, { snapshotId: params.snapshotId }));
      const res = await invokeConnector(ctx.workspaceId, 'nodered.rollback', { flows: snap.flows });
      ctx.emit(makeEvent(EventType.ROLLBACK_COMPLETED, { snapshotId: params.snapshotId }));
      return res;
    }
    default:
      // plain pass-through to connector
      return invokeConnector(ctx.workspaceId, tool, params);
  }
}

async function backendTool(ctx, tool, params) {
  switch (tool) {
    case 'code.generate_function_node':
      return generateFunctionNode(params);
    case 'code.lint_javascript':
      return lintFunctionCode(params.code || '');
    case 'secret.redact_context':
      return { text: redact(params.text || '') };

    case 'flow.create_draft': {
      const flow = normalizePatchInput(params.flow);
      if (!Array.isArray(flow)) throw new Error('flow.create_draft requires flow to be an array of Node-RED nodes');
      assertValidFlowForDeploy(flow, 'draft', { allowExternalTabRefs: true });
      const draftId = Drafts.create(ctx.workspaceId, { name: params.name, intent: ctx.prompt, riskLevel: 'medium', flow });
      ctx.emit(makeEvent(EventType.FLOW_DRAFT_CREATED, { draftId, name: params.name, nodeCount: (flow || []).length }));
      return { draftId, name: params.name, nodeCount: (flow || []).length };
    }
    case 'flow.create_manual_control': {
      const flow = manualControlFlow(params);
      assertValidFlowForDeploy(flow, 'manual control draft');
      const name = params.name || 'Manual Control';
      const draftId = Drafts.create(ctx.workspaceId, { name, intent: ctx.prompt, riskLevel: 'low', flow });
      ctx.emit(makeEvent(EventType.FLOW_DRAFT_CREATED, { draftId, name, nodeCount: flow.length }));
      return { draftId, name, nodeCount: flow.length };
    }
    case 'flow.validate_draft': {
      const draft = Drafts.get(params.draftId);
      if (!draft) throw new Error('draft not found');
      let installedTypes = null;
      try {
        const nodes = await invokeConnector(ctx.workspaceId, 'nodered.list_nodes', {});
        installedTypes = nodes.flatMap(m => m.types || []);
      } catch { /* connector offline -> catalog pass downgrades to warnings */ }
      const validation = validateFlow(draft.flow, { installedTypes, allowExternalTabRefs: true });
      Drafts.setValidation(params.draftId, validation);
      ctx.emit(makeEvent(validation.ok ? EventType.FLOW_VALIDATION_PASSED : EventType.FLOW_VALIDATION_FAILED,
        { draftId: params.draftId, passes: validation.passes.map(p => ({ name: p.name, ok: p.ok, issues: p.issues.length })) }));
      return validation;
    }
    case 'flow.simulate': {
      const draft = Drafts.get(params.draftId);
      if (!draft) throw new Error('draft not found');
      const v = validateFlow(draft.flow, { testMessages: params.messages });
      return v.passes.find(p => p.name === 'runtime_simulation');
    }
    case 'flow.diff': {
      const draft = Drafts.get(params.draftId);
      if (!draft) throw new Error('draft not found');
      let current = [];
      try { current = (await invokeConnector(ctx.workspaceId, 'nodered.get_flows', { view: 'full' })).flows; } catch {}
      return diffFlows(current, draft.flow);
    }
    default:
      throw new Error(`no backend executor for ${tool}`);
  }
}

// Safe deploy: snapshot -> merge patch -> deploy -> health -> auto-rollback on failure.
async function deployPipeline(ctx, params) {
  const draftId = params.draftId;
  const draft = draftId ? Drafts.get(draftId) : null;
  let patch = draft?.flow ? normalizePatchInput(draft.flow) : null;

  // Backward compatibility for older CLI sessions that saw the pre-fix MCP
  // schema and still send raw flows instead of draftId.
  if (!patch && (params.flows !== undefined || params.flow !== undefined)) {
    patch = normalizePatchInput(params.flows ?? params.flow);
  }

  if (draftId && !draft) throw new Error(`draft ${draftId} not found`);
  if (!Array.isArray(patch)) throw new Error('deploy_patch requires draftId, or a fallback flows array');
  assertValidFlowForDeploy(patch, 'patch', { allowExternalTabRefs: true });

  ctx.emit(makeEvent(EventType.DEPLOY_STARTED, { draftId }));

  // 1. snapshot current
  const cur = await invokeConnector(ctx.workspaceId, 'nodered.get_flows', { view: 'full' });
  const snapshotId = Snapshots.create(ctx.workspaceId, cur.flows, cur.rev, `pre-deploy ${draftId || 'inline-patch'}`);

  // 2. merge: append/replace draft nodes by id (single-tab patch on top of live config)
  const merged = mergeFlows(cur.flows, patch);
  assertValidFlowForDeploy(merged, 'merged flow');

  // 3. deploy (nodes deploymentType restarts only changed nodes)
  let deployRes;
  try {
    deployRes = await invokeConnector(ctx.workspaceId, 'nodered.deploy_patch',
      { flows: merged, deploymentType: params.deploymentType || 'nodes' });
  } catch (e) {
    ctx.emit(makeEvent(EventType.DEPLOY_FAILED, { error: e.message, snapshotId }));
    throw e;
  }

  // 4. health check; expect the draft's node types to be present
  const expectTypes = [...new Set(patch.map(n => n.type).filter(t => t !== 'tab'))];
  const health = await invokeConnector(ctx.workspaceId, 'nodered.check_health', { expectNodeTypes: expectTypes }).catch(e => ({ ok: false, error: e.message }));
  ctx.emit(makeEvent(EventType.HEALTH_CHECK, { health, snapshotId }));

  // 5. auto-rollback if unhealthy
  if (!health.ok) {
    ctx.emit(makeEvent(EventType.ROLLBACK_STARTED, { snapshotId, reason: 'health check failed' }));
    await invokeConnector(ctx.workspaceId, 'nodered.rollback', { flows: cur.flows }).catch(() => {});
    ctx.emit(makeEvent(EventType.ROLLBACK_COMPLETED, { snapshotId }));
    ctx.emit(makeEvent(EventType.DEPLOY_FAILED, { reason: 'auto-rolled-back', health, snapshotId }));
    if (draftId) Drafts.setStatus(draftId, 'rolled_back');
    return { deployed: false, rolledBack: true, snapshotId, health };
  }

  if (draftId) Drafts.setStatus(draftId, 'deployed');
  ctx.emit(makeEvent(EventType.DEPLOY_COMPLETED, { draftId, snapshotId, rev: deployRes.rev }));
  return { deployed: true, snapshotId, rev: deployRes.rev, health };
}

function mergeFlows(current, patch) {
  const byId = new Map(current.map(n => [n.id, n]));
  for (const n of patch) byId.set(n.id, n); // add or replace
  return [...byId.values()];
}

function normalizePatchInput(input) {
  if (typeof input === 'string') {
    try { return normalizePatchInput(JSON.parse(input)); }
    catch { throw new Error('deploy_patch fallback flows string is not valid JSON'); }
  }
  if (input && typeof input === 'object' && Array.isArray(input.flows)) return normalizePatchInput(input.flows);
  return input;
}

export function manualControlFlow(params = {}) {
  const name = cleanLabel(params.name, 'Manual Control');
  const commandTopic = cleanTopic(params.commandTopic, 'manual/control');
  const commands = normalizeCommands(params.commands);
  const tab = 'tab_manual_control';
  const commandNodes = commands.map((command, idx) => ({
    id: `manual_${command.id}`,
    type: 'inject',
    z: tab,
    name: command.label,
    props: [
      { p: 'payload' },
      { p: 'topic', vt: 'str' }
    ],
    payload: command.value,
    payloadType: 'str',
    topic: commandTopic,
    x: 130,
    y: 80 + idx * 60,
    wires: [['fn_manual_control']]
  }));

  return [
    { id: tab, type: 'tab', label: name, disabled: false },
    { id: 'manual_note', type: 'comment', z: tab, name: 'Manual controls emit symbolic commands only; execution remains handled downstream.', x: 310, y: 30, wires: [] },
    ...commandNodes,
    {
      id: 'fn_manual_control',
      type: 'function',
      z: tab,
      name: 'build manual command',
      func: buildManualCommandFunction(commands),
      outputs: 1,
      x: 370,
      y: 140,
      wires: [['manual_out', 'manual_debug']]
    },
    { id: 'manual_out', type: 'mqtt out', z: tab, name: 'manual command out', topic: commandTopic, broker: 'manual_broker', x: 630, y: 110, wires: [] },
    { id: 'manual_debug', type: 'debug', z: tab, name: 'manual command', active: true, complete: 'payload', x: 630, y: 170, wires: [] },
    { id: 'manual_broker', type: 'mqtt-broker', name: 'local broker', broker: '127.0.0.1', port: '1883', clientid: '', keepalive: '60', cleansession: true }
  ];
}

function normalizeCommands(commands) {
  const raw = Array.isArray(commands) && commands.length ? commands : ['stop', 'start', 'pause', 'resume'];
  const seen = new Set();
  return raw.map((item) => {
    const value = typeof item === 'string' ? item : item?.command || item?.value || item?.id || '';
    const label = typeof item === 'object' && item?.label ? item.label : value;
    const safeValue = slug(value) || 'command';
    let id = safeValue;
    let suffix = 2;
    while (seen.has(id)) id = `${safeValue}_${suffix++}`;
    seen.add(id);
    return { id, value: safeValue, label: cleanLabel(label, safeValue) };
  });
}

function buildManualCommandFunction(commands) {
  const allowed = commands.map((c) => c.value);
  return [
    `const allowed = ${JSON.stringify(allowed)};`,
    "const command = String(msg.payload || '').trim();",
    "if (!allowed.includes(command)) {",
    "  node.status({ fill: 'red', shape: 'ring', text: 'blocked ' + command });",
    '  return null;',
    '}',
    'msg.payload = {',
    '  mode: "manual",',
    '  command,',
    '  requestedAt: new Date().toISOString()',
    '};',
    'node.status({ fill: "blue", shape: "dot", text: command });',
    'return msg;'
  ].join('\n');
}

function cleanLabel(value, fallback) {
  const label = String(value || fallback).replace(/[^\w .:/-]/g, '').trim();
  return label.slice(0, 80) || fallback;
}

function cleanTopic(value, fallback) {
  const topic = String(value || fallback).replace(/[^\w/.-]/g, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return topic || fallback;
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

function assertValidFlowForDeploy(flow, label, opts = {}) {
  const validation = validateFlow(flow, opts);
  if (validation.ok) return;
  const issues = validation.passes
    .flatMap(p => p.issues || [])
    .filter(i => i.severity === 'error')
    .map(i => i.msg || i.id)
    .filter(Boolean);
  throw new Error(`${label} validation failed: ${issues.slice(0, 5).join('; ') || 'invalid flow'}`);
}
