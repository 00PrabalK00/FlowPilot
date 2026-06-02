#!/usr/bin/env node
// FlowPilot local connector. Opens OUTBOUND encrypted tunnel to the control plane,
// so Node-RED never needs to be exposed to the internet.
import WebSocket from 'ws';
import { NodeRedClient } from './nodered.js';
import { makeExecutor } from './tools.js';
import { Frame, makeEvent, EventType } from '@flowpilot/shared/events';

const CFG = {
  backendWs: process.env.FLOWPILOT_BACKEND_WS || 'ws://127.0.0.1:8787/connector',
  connectorToken: process.env.CONNECTOR_TOKEN || 'dev-connector-token',
  noderedUrl: process.env.NODERED_URL || 'http://127.0.0.1:1880',
  noderedToken: process.env.NODERED_TOKEN || null,
  workspaceId: process.env.WORKSPACE_ID || 'default',
  allowLocal: {},        // restricted tools off by default
  safeCommands: {}       // robotics safe-command registry
};

const nr = new NodeRedClient({ baseUrl: CFG.noderedUrl, token: CFG.noderedToken });
const exec = makeExecutor(nr, CFG);

let ws = null;
let connected = false;

function send(frame) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function connect() {
  ws = new WebSocket(CFG.backendWs, { headers: { 'x-connector-token': CFG.connectorToken } });

  ws.on('open', async () => {
    connected = true;
    let caps = { nodered: false };
    try { await nr.getSettings(); caps.nodered = true; } catch {}
    send({ type: Frame.HELLO, workspaceId: CFG.workspaceId, noderedUrl: CFG.noderedUrl, capabilities: caps });
    nr.connectComms();
    nr.onRuntimeEvent = (evt) => {
      const isErr = /error/i.test(evt.topic) || evt.data?.type === 'error';
      send({ type: Frame.EVENT, event: makeEvent(isErr ? EventType.RUNTIME_ERROR_DETECTED : EventType.RUNTIME_LOG, { detail: evt }) });
    };
    log(`connected to backend ${CFG.backendWs}; nodered=${caps.nodered}`);
  });

  ws.on('message', async (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.type === Frame.TOOL_INVOKE) await handleInvoke(frame);
    else if (frame.type === Frame.PING) send({ type: Frame.PONG });
    else if (frame.type === Frame.WELCOME) log('welcome from backend');
  });

  ws.on('close', () => { connected = false; log('disconnected; retrying in 3s'); setTimeout(connect, 3000); });
  ws.on('error', (e) => log(`ws error: ${e.message}`));
}

async function handleInvoke(frame) {
  const { callId, tool, params } = frame;
  try {
    const result = await exec.execute(tool, params || {});
    send({ type: Frame.TOOL_RESULT, callId, tool, ok: true, result });
  } catch (e) {
    send({ type: Frame.TOOL_RESULT, callId, tool, ok: false, error: e.message, body: e.body });
  }
}

function log(...a) { console.log('[connector]', ...a); }

connect();
process.on('SIGINT', () => { log('shutting down'); ws?.close(); process.exit(0); });
