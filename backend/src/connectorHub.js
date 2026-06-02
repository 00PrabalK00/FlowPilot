// Manages connector tunnels. Backend -> connector tool invocation by callId.
import { randomUUID } from 'node:crypto';
import { Frame } from '@flowpilot/shared/events';
import { publish } from './eventBus.js';
import { FileChanges } from './store.js';

const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN || 'dev-connector-token';

const connectors = new Map(); // workspaceId -> { ws, info }
const pending = new Map();     // callId -> {resolve, reject, timer}

export function authConnector(req) {
  return req.headers['x-connector-token'] === CONNECTOR_TOKEN;
}

export function registerConnector(ws) {
  let workspaceId = null;

  ws.on('message', (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }

    if (frame.type === Frame.HELLO) {
      workspaceId = frame.workspaceId || 'default';
      connectors.set(workspaceId, { ws, info: frame });
      ws.send(JSON.stringify({ type: Frame.WELCOME }));
      publish(workspaceId, { type: 'connector.status', online: true, info: frame });
    } else if (frame.type === Frame.TOOL_RESULT) {
      const p = pending.get(frame.callId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(frame.callId);
        frame.ok ? p.resolve(frame.result) : p.reject(Object.assign(new Error(frame.error || 'tool failed'), { body: frame.body }));
      }
    } else if (frame.type === Frame.EVENT && workspaceId) {
      const ev = frame.event;
      if (ev?.type === 'file.changed' && ev.path) FileChanges.record(workspaceId, ev.path, ev.tool);
      publish(workspaceId, ev);
    } else if (frame.type === Frame.PONG) { /* keepalive */ }
  });

  ws.on('close', () => {
    if (workspaceId && connectors.get(workspaceId)?.ws === ws) {
      connectors.delete(workspaceId);
      publish(workspaceId, { type: 'connector.status', online: false });
    }
  });
}

export function isOnline(workspaceId) {
  return connectors.has(workspaceId);
}

export function connectorInfo(workspaceId) {
  return connectors.get(workspaceId)?.info || null;
}

export function invokeConnector(workspaceId, tool, params, timeoutMs = 30000) {
  const entry = connectors.get(workspaceId);
  if (!entry) return Promise.reject(new Error(`no connector online for workspace ${workspaceId}`));
  const callId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(callId);
      reject(new Error(`connector tool ${tool} timed out`));
    }, timeoutMs);
    pending.set(callId, { resolve, reject, timer });
    entry.ws.send(JSON.stringify({ type: Frame.TOOL_INVOKE, callId, tool, params }));
  });
}
