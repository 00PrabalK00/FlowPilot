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
      const { flows, rev } = await invokeConnector(ctx.workspaceId, 'nodered.get_flows', {});
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
      const flow = params.flow;
      const draftId = Drafts.create(ctx.workspaceId, { name: params.name, intent: ctx.prompt, riskLevel: 'medium', flow });
      ctx.emit(makeEvent(EventType.FLOW_DRAFT_CREATED, { draftId, name: params.name, nodeCount: (flow || []).length }));
      return { draftId, name: params.name, nodeCount: (flow || []).length };
    }
    case 'flow.validate_draft': {
      const draft = Drafts.get(params.draftId);
      if (!draft) throw new Error('draft not found');
      let installedTypes = null;
      try {
        const nodes = await invokeConnector(ctx.workspaceId, 'nodered.list_nodes', {});
        installedTypes = nodes.flatMap(m => m.types || []);
      } catch { /* connector offline -> catalog pass downgrades to warnings */ }
      const validation = validateFlow(draft.flow, { installedTypes });
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
      try { current = (await invokeConnector(ctx.workspaceId, 'nodered.get_flows', {})).flows; } catch {}
      return diffFlows(current, draft.flow);
    }
    default:
      throw new Error(`no backend executor for ${tool}`);
  }
}

// Safe deploy: snapshot -> merge patch -> deploy -> health -> auto-rollback on failure.
async function deployPipeline(ctx, params) {
  const draft = Drafts.get(params.draftId);
  if (!draft) throw new Error('draft not found');

  ctx.emit(makeEvent(EventType.DEPLOY_STARTED, { draftId: params.draftId }));

  // 1. snapshot current
  const cur = await invokeConnector(ctx.workspaceId, 'nodered.get_flows', {});
  const snapshotId = Snapshots.create(ctx.workspaceId, cur.flows, cur.rev, `pre-deploy ${params.draftId}`);

  // 2. merge: append/replace draft nodes by id (single-tab patch on top of live config)
  const merged = mergeFlows(cur.flows, draft.flow);

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
  const expectTypes = [...new Set(draft.flow.map(n => n.type).filter(t => t !== 'tab'))];
  const health = await invokeConnector(ctx.workspaceId, 'nodered.check_health', { expectNodeTypes: expectTypes }).catch(e => ({ ok: false, error: e.message }));
  ctx.emit(makeEvent(EventType.HEALTH_CHECK, { health, snapshotId }));

  // 5. auto-rollback if unhealthy
  if (!health.ok) {
    ctx.emit(makeEvent(EventType.ROLLBACK_STARTED, { snapshotId, reason: 'health check failed' }));
    await invokeConnector(ctx.workspaceId, 'nodered.rollback', { flows: cur.flows }).catch(() => {});
    ctx.emit(makeEvent(EventType.ROLLBACK_COMPLETED, { snapshotId }));
    ctx.emit(makeEvent(EventType.DEPLOY_FAILED, { reason: 'auto-rolled-back', health, snapshotId }));
    Drafts.setStatus(params.draftId, 'rolled_back');
    return { deployed: false, rolledBack: true, snapshotId, health };
  }

  Drafts.setStatus(params.draftId, 'deployed');
  ctx.emit(makeEvent(EventType.DEPLOY_COMPLETED, { draftId: params.draftId, snapshotId, rev: deployRes.rev }));
  return { deployed: true, snapshotId, rev: deployRes.rev, health };
}

function mergeFlows(current, patch) {
  const byId = new Map(current.map(n => [n.id, n]));
  for (const n of patch) byId.set(n.id, n); // add or replace
  return [...byId.values()];
}
