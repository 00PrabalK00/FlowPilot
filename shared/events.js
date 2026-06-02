// Agent + runtime event stream contract (section 7).
// Frontend renders these as live action cards. Stream tool STATE, not just model text.

export const EventType = {
  AGENT_STARTED: 'agent.started',
  AGENT_THINKING: 'agent.thinking',
  AGENT_MESSAGE: 'agent.message',
  AGENT_DONE: 'agent.done',
  AGENT_ERROR: 'agent.error',

  TOOL_CALLED: 'tool.called',
  TOOL_COMPLETED: 'tool.completed',
  TOOL_FAILED: 'tool.failed',

  FLOW_DRAFT_CREATED: 'flow.draft.created',
  FLOW_VALIDATION_FAILED: 'flow.validation.failed',
  FLOW_VALIDATION_PASSED: 'flow.validation.passed',

  APPROVAL_REQUIRED: 'approval.required',
  APPROVAL_GRANTED: 'approval.granted',
  APPROVAL_DENIED: 'approval.denied',

  DEPLOY_STARTED: 'deploy.started',
  DEPLOY_COMPLETED: 'deploy.completed',
  DEPLOY_FAILED: 'deploy.failed',

  RUNTIME_ERROR_DETECTED: 'runtime.error.detected',
  RUNTIME_LOG: 'runtime.log',
  HEALTH_CHECK: 'health.check',

  FILE_CHANGED: 'file.changed',

  ROLLBACK_STARTED: 'rollback.started',
  ROLLBACK_COMPLETED: 'rollback.completed',

  CONNECTOR_STATUS: 'connector.status'
};

// Connector <-> backend control frames over the outbound WS tunnel.
export const Frame = {
  HELLO: 'hello',          // connector -> backend: identify + capabilities
  WELCOME: 'welcome',      // backend -> connector: ack
  TOOL_INVOKE: 'tool.invoke',   // backend -> connector: run a guarded tool
  TOOL_RESULT: 'tool.result',   // connector -> backend: result/error
  EVENT: 'event',          // either direction: an EventType payload
  PING: 'ping',
  PONG: 'pong'
};

export function makeEvent(type, data = {}) {
  return { type, ts: Date.now(), ...data };
}
