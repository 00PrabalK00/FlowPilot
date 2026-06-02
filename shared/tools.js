import { Risk } from './risk.js';

// Permission classes (section 6).
export const Perm = {
  SAFE: 'safe',          // auto-allowed
  APPROVAL: 'approval',  // needs user approval
  RESTRICTED: 'restricted' // disabled unless workspace policy enables
};

// Where a tool runs.
export const Runner = {
  CONNECTOR: 'connector', // executed by local connector near Node-RED
  BACKEND: 'backend'      // executed in control plane (codegen, validation, storage)
};

// Central tool registry. The agent may only call tools listed here.
// params are documented for the model; backend re-validates.
export const TOOLS = {
  // ---- Node-RED (connector) ----
  'nodered.get_flows':      { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Read full active flow config (credentials stripped).', params: {} },
  'nodered.get_flow':       { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Read one flow tab by id.', params: { id: 'string' } },
  'nodered.get_flow_state': { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Runtime state (started/stopped).', params: {} },
  'nodered.get_diagnostics':{ perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Runtime diagnostics report.', params: {} },
  'nodered.get_settings':   { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Editor/runtime settings (safe subset).', params: {} },
  'nodered.list_nodes':     { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Installed node modules + node types.', params: {} },
  'nodered.read_logs':      { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Recent runtime logs buffer.', params: { lines: 'number?' } },
  'nodered.create_snapshot':{ perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Capture current flows as a restorable snapshot.', params: {} },
  'nodered.deploy_patch':   { perm: Perm.APPROVAL, risk: Risk.MEDIUM, runner: Runner.CONNECTOR, desc: 'Deploy a validated draft by id through snapshot, merge, health-check and rollback safeguards. Stops affected nodes.', params: { draftId: 'string', deploymentType: 'string?' } },
  'nodered.rollback':       { perm: Perm.APPROVAL, risk: Risk.MEDIUM, runner: Runner.CONNECTOR, desc: 'Restore a snapshot.', params: { snapshotId: 'string' } },
  'nodered.restart':        { perm: Perm.APPROVAL, risk: Risk.HIGH, runner: Runner.CONNECTOR, desc: 'Restart Node-RED runtime.', params: {} },
  'nodered.check_health':   { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Post-deploy health probe.', params: { expectNodeTypes: 'array?' } },
  'nodered.security_preflight': { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Check admin auth, https, exposed editor, dangerous nodes (Threat 3).', params: {} },

  // ---- Code (backend) ----
  'code.generate_function_node': { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Generate constrained Function node JS.', params: { spec: 'string', inputShape: 'object?' } },
  'code.lint_javascript':        { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Static checks: syntax, loops, forbidden APIs, secret leak.', params: { code: 'string' } },

  // ---- Flow draft + validation (backend) ----
  'flow.create_draft':   { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Persist a proposed flow as a draft.', params: { name: 'string', flow: 'object' } },
  'flow.create_manual_control': { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Create a draft Node-RED manual-control flow using symbolic command inject buttons.', params: { name: 'string?', commandTopic: 'string?', commands: 'array?' } },
  'flow.validate_draft': { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Run 5 validation passes against a draft.', params: { draftId: 'string' } },
  'flow.simulate':       { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Inject test messages, compare expected outputs.', params: { draftId: 'string', messages: 'array?' } },
  'flow.diff':           { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Diff a draft vs current live flows.', params: { draftId: 'string' } },

  // ---- Secrets (backend) ----
  'secret.create_reference': { perm: Perm.APPROVAL, risk: Risk.HIGH, runner: Runner.BACKEND, desc: 'Create SECRET_REF placeholder.', params: { name: 'string' } },
  'secret.redact_context':   { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.BACKEND, desc: 'Redact secrets/hosts/ips before model send.', params: { text: 'string' } },

  // ---- Packages (connector) ----
  'package.inspect_node': { perm: Perm.SAFE, risk: Risk.LOW, runner: Runner.CONNECTOR, desc: 'Inspect npm node package reputation/capabilities.', params: { name: 'string' } },
  'package.install_node': { perm: Perm.APPROVAL, risk: Risk.HIGH, runner: Runner.CONNECTOR, desc: 'Install an npm node package (review required).', params: { name: 'string', version: 'string?' } },

  // ---- Runtime control (connector) — robotics/IoT (section 5.6) ----
  'runtime.inject_test_message': { perm: Perm.APPROVAL, risk: Risk.MEDIUM, runner: Runner.CONNECTOR, desc: 'Inject a test message into a node.', params: { nodeId: 'string', payload: 'any' } },
  'runtime.send_safe_command':   { perm: Perm.APPROVAL, risk: Risk.HIGH, runner: Runner.CONNECTOR, desc: 'Send a registered safe command (symbolic mission, not raw velocity).', params: { command: 'string', args: 'object?' } },
  'runtime.stop_command':        { perm: Perm.APPROVAL, risk: Risk.HIGH, runner: Runner.CONNECTOR, desc: 'Stop / emergency-stop a running command.', params: { command: 'string?' } },

  // ---- Local system (connector) — OFF by default (restricted) ----
  'local.read_allowed_file':  { perm: Perm.RESTRICTED, risk: Risk.HIGH, runner: Runner.CONNECTOR, desc: 'Read a whitelisted local file.', params: { path: 'string' } },
  'local.write_allowed_file': { perm: Perm.RESTRICTED, risk: Risk.CRITICAL, runner: Runner.CONNECTOR, desc: 'Write a whitelisted local file.', params: { path: 'string', content: 'string' } },
  'local.run_allowed_command':{ perm: Perm.RESTRICTED, risk: Risk.CRITICAL, runner: Runner.CONNECTOR, desc: 'Run a whitelisted shell command.', params: { command: 'string' } }
};

// Build the tool-call schema list for an LLM provider (name/desc/params).
export function toolSpecsForModel(enabledNames = Object.keys(TOOLS)) {
  return enabledNames.map((name) => {
    const t = TOOLS[name];
    return { name, description: t.desc, params: t.params, risk: t.risk, perm: t.perm };
  });
}

export function isTool(name) {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}
