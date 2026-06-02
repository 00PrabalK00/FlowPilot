// Offline scripted "agent". Same chat() contract as real providers.
// Drives the Workflow-1 create-flow sequence deterministically so the whole
// control plane can be exercised end-to-end without an API key.
import { randomUUID } from 'node:crypto';

const order = [
  'nodered.security_preflight',
  'nodered.get_flows',
  'nodered.list_nodes',
  'code.generate_function_node',
  'flow.create_draft',
  'flow.validate_draft',
  'flow.diff',
  'nodered.deploy_patch',
  'nodered.check_health'
];

export async function mockChat({ messages }) {
  const done = collectDone(messages);
  const results = collectResults(messages);

  for (const tool of order) {
    if (done.has(tool)) continue;
    const params = buildParams(tool, results);
    if (params === SKIP) { done.add(tool); continue; }
    return {
      text: narrate(tool),
      toolCalls: [{ id: 'call_' + randomUUID().slice(0, 8), name: tool, params }]
    };
  }

  return { text: finalSummary(results), toolCalls: [] };
}

const SKIP = Symbol('skip');

function buildParams(tool, r) {
  switch (tool) {
    case 'nodered.security_preflight':
    case 'nodered.get_flows':
    case 'nodered.list_nodes':
    case 'nodered.check_health':
      return {};
    case 'code.generate_function_node':
      return { spec: 'Dequeue one robot task from flow context queue "tasks" and emit it as msg.payload; if empty, return null.', inputShape: { topic: 'tick' } };
    case 'flow.create_draft': {
      const code = r['code.generate_function_node']?.code || 'return msg;';
      return { name: 'Robot Task Queue', flow: robotTaskQueueFlow(code) };
    }
    case 'flow.validate_draft':
    case 'flow.diff': {
      const draftId = r['flow.create_draft']?.draftId;
      return draftId ? { draftId } : SKIP;
    }
    case 'nodered.deploy_patch': {
      const draftId = r['flow.create_draft']?.draftId;
      const validation = r['flow.validate_draft'];
      if (!draftId || !validation?.ok) return SKIP;
      return { draftId, deploymentType: 'nodes' };
    }
    default: return {};
  }
}

function narrate(tool) {
  const map = {
    'nodered.security_preflight': 'Checking your Node-RED security posture first.',
    'nodered.get_flows': 'Reading your existing flows.',
    'nodered.list_nodes': 'Checking installed nodes and available config nodes.',
    'code.generate_function_node': 'Writing the queue worker function.',
    'flow.create_draft': 'Drafting a new flow: Robot Task Queue (risk: medium, needs approval).',
    'flow.validate_draft': 'Running the 5 validation passes.',
    'flow.diff': 'Computing the JSON diff vs your live flows.',
    'nodered.deploy_patch': 'Ready to deploy. This needs your approval.',
    'nodered.check_health': 'Deployed — running post-deploy health checks.'
  };
  return map[tool] || '';
}

function finalSummary(r) {
  const health = r['nodered.check_health'];
  if (health) return `Done. Robot Task Queue is live. Health: ${health.ok ? 'OK' : 'DEGRADED'}. You can roll back any time from the snapshot taken before deploy.`;
  return 'Draft is ready and validated. Approve the deploy when you want it live.';
}

function collectDone(messages) {
  const set = new Set();
  for (const m of messages) if (m.role === 'tool' && m.toolName) set.add(m.toolName);
  return set;
}
function collectResults(messages) {
  const out = {};
  for (const m of messages) if (m.role === 'tool' && m.toolName) out[m.toolName] = m.content;
  return out;
}

// A real, valid Node-RED flow: MQTT-driven task queue with a worker tick.
export function robotTaskQueueFlow(dequeueCode) {
  const tab = 'tab_rtq';
  return [
    { id: tab, type: 'tab', label: 'Robot Task Queue', disabled: false },
    { id: 'mqtt_in_1', type: 'mqtt in', z: tab, name: 'task in', topic: 'robot/tasks/in', broker: 'broker_1', x: 140, y: 80, wires: [['fn_enqueue']] },
    { id: 'fn_enqueue', type: 'function', z: tab, name: 'enqueue', x: 340, y: 80,
      func: "let q = flow.get('tasks') || [];\nq.push(msg.payload);\nflow.set('tasks', q);\nnode.status({fill:'blue',text:q.length+' queued'});\nreturn null;",
      outputs: 1, wires: [[]] },
    { id: 'tick', type: 'inject', z: tab, name: 'worker tick', repeat: '5', topic: 'tick', x: 140, y: 180, wires: [['fn_dequeue']] },
    { id: 'fn_dequeue', type: 'function', z: tab, name: 'dequeue', x: 340, y: 180,
      func: dequeueCode, outputs: 1, wires: [['mqtt_out_1', 'dbg']] },
    { id: 'mqtt_out_1', type: 'mqtt out', z: tab, name: 'dispatch', topic: 'robot/tasks/dispatch', broker: 'broker_1', x: 560, y: 160, wires: [] },
    { id: 'dbg', type: 'debug', z: tab, name: 'dispatched', active: true, complete: 'payload', x: 560, y: 220, wires: [] },
    { id: 'broker_1', type: 'mqtt-broker', name: 'local broker', broker: '127.0.0.1', port: '1883', clientid: '', keepalive: '60', cleansession: true }
  ];
}
