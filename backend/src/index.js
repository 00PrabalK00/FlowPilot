// FlowPilot control plane: REST + SSE (to frontend) + WS (connector tunnel).
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import './db.js';
import { authConnector, registerConnector, isOnline, connectorInfo } from './connectorHub.js';
import { subscribe } from './eventBus.js';
import { runAgent, resolveApproval } from './agent/orchestrator.js';
import { Snapshots, Drafts, Approvals } from './store.js';
import { dispatchTool } from './tools/dispatch.js';

const PORT = process.env.PORT || 8787;
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const WS = process.env.WORKSPACE_DEFAULT || 'default';

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/connector/status', (req, res) => {
  const ws = req.query.workspaceId || WS;
  res.json({ online: isOnline(ws), info: connectorInfo(ws) });
});

// Start an agent run. Events stream over SSE; deploy pauses for approval.
app.post('/api/chat', async (req, res) => {
  const { prompt, provider, role = 'maintainer', runtimeMode = 'design', enabledRestricted = [], workspaceId = WS } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const policy = { role, runtimeMode, enabledRestricted };
  runAgent({ workspaceId, prompt, providerName: provider, policy }).catch(() => {});
  res.json({ ok: true, workspaceId });
});

// Live event stream to the browser (SSE).
app.get('/api/events', (req, res) => {
  const ws = req.query.workspaceId || WS;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: hello\ndata: {"online":${isOnline(ws)}}\n\n`);
  const unsub = subscribe(ws, (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`));
  const ka = setInterval(() => res.write(': ka\n\n'), 15000);
  req.on('close', () => { clearInterval(ka); unsub(); });
});

app.get('/api/approvals', (req, res) => res.json(Approvals.listPending(req.query.workspaceId || WS)));
app.post('/api/approvals/:id/decide', (req, res) => {
  const ok = resolveApproval(req.params.id, req.body?.decision === 'approved' ? 'approved' : 'denied', req.body?.by || 'user');
  res.json({ ok });
});

app.get('/api/snapshots', (req, res) => res.json(Snapshots.list(req.query.workspaceId || WS)));
app.post('/api/rollback', async (req, res) => {
  const ws = req.body?.workspaceId || WS;
  const ctx = { workspaceId: ws, runId: null, emit: () => {} };
  try { res.json(await dispatchTool({ ...ctx, emit: makeEmit(ws) }, 'nodered.rollback', { snapshotId: req.body.snapshotId })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/drafts/:id', (req, res) => {
  const d = Drafts.get(req.params.id);
  d ? res.json(d) : res.status(404).json({ error: 'not found' });
});

import { publish } from './eventBus.js';
function makeEmit(ws) { return (e) => publish(ws, e); }

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/connector') {
    if (!authConnector(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => registerConnector(ws));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => console.log(`[backend] control plane on :${PORT} (provider=${process.env.FLOWPILOT_PROVIDER || 'mock'})`));
