// FlowPilot control plane: REST + SSE (to frontend) + WS (connector tunnel).
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import './db.js';
import { authConnector, registerConnector, isOnline, connectorInfo, invokeConnector } from './connectorHub.js';
import { subscribe } from './eventBus.js';
import { runAgent, resolveApproval } from './agent/orchestrator.js';
import { runCliChat } from './agent/cliBridge.js';
import { Snapshots, Drafts, Approvals, ToolCalls, audit } from './store.js';
import { dispatchTool } from './tools/dispatch.js';
import { evaluate, Decision } from './permission.js';
import { EventType, makeEvent } from '@flowpilot/shared/events';
import { TOOLS } from '@flowpilot/shared/tools';
import { status as providerStatus, setProviderConfig, setSelected, getProviderConfig, getSelected } from './secretStore.js';
import { getProvider } from './providers/index.js';
import { waitForApproval } from './approvalGate.js';

const CLI_BRAINS = new Set(['claude-code', 'codex-cli', 'gemini-cli']);

const PORT = process.env.PORT || 8787;
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const WS = process.env.WORKSPACE_DEFAULT || 'default';

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Live flows for the interactive canvas (read-only).
app.get('/api/flows', async (req, res) => {
  try { res.json(await invokeConnector(req.query.workspaceId || WS, 'nodered.get_flows', {})); }
  catch (e) { res.status(502).json({ error: e.message, flows: [] }); }
});

app.get('/api/connector/status', (req, res) => {
  const ws = req.query.workspaceId || WS;
  res.json({ online: isOnline(ws), info: connectorInfo(ws) });
});

// Start an agent run. Events stream over SSE; deploy pauses for approval.
app.post('/api/chat', async (req, res) => {
  const { prompt, provider, role = 'maintainer', runtimeMode = 'design', enabledRestricted = [], workspaceId = WS } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  // A CLI brain delegates the whole turn to the user's local login; otherwise use the API tool-loop.
  const chosen = provider || getSelected();
  if (CLI_BRAINS.has(chosen) || chosen === 'cli') {
    runCliChat({ workspaceId, prompt, cli: chosen === 'cli' ? 'claude-code' : chosen }).catch(() => {});
  } else {
    const policy = { role, runtimeMode, enabledRestricted };
    runAgent({ workspaceId, prompt, providerName: chosen, policy }).catch(() => {});
  }
  res.json({ ok: true, workspaceId });
});

// --- Provider settings (Settings page) ---
// GET status (never returns raw keys). CLI brains listed separately.
app.get('/api/providers', async (req, res) => {
  let cliInstalled = {};
  try { cliInstalled = await invokeConnector(req.query.workspaceId || WS, 'agent.detect_clis', {}, 12000); }
  catch { /* connector offline -> unknown */ }
  res.json({
    ...providerStatus(),
    cliBrains: [...CLI_BRAINS],
    cliInstalled,            // { 'claude-code': {ok,version}, ... }
    selected: getSelected()
  });
});

// Save an API key / model and/or select a provider.
app.post('/api/providers', (req, res) => {
  const { provider, apiKey, model, baseUrl, select } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'provider required' });
  if (apiKey !== undefined || model || baseUrl) setProviderConfig(provider, { apiKey, model, baseUrl });
  if (select) setSelected(provider);
  res.json({ ok: true, ...providerStatus() });
});

// Test connection. CLI brains -> check the binary via the connector. API providers -> tiny chat call.
app.post('/api/providers/test', async (req, res) => {
  const { provider, apiKey, model, workspaceId = WS } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'provider required' });
  try {
    if (CLI_BRAINS.has(provider)) {
      const r = await invokeConnector(workspaceId, 'agent.cli_check', { cli: provider });
      return res.json(r.ok ? { ok: true, detail: r.version || 'installed' } : { ok: false, error: r.error || 'not found' });
    }
    if (provider === 'mock') return res.json({ ok: true, detail: 'offline mock' });
    if (provider === 'ollama') {
      const base = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434');
      const r = await fetch(base + '/api/tags').catch(() => null);
      return res.json(r && r.ok ? { ok: true, detail: 'ollama reachable' } : { ok: false, error: 'ollama not reachable' });
    }
    // claude / openai / gemini: minimal ping using the submitted-or-stored key
    const cfg = getProviderConfig(provider);
    const out = await getProvider(provider).chat({
      system: 'Reply with the single word OK.',
      messages: [{ role: 'user', text: 'ping' }], tools: [],
      apiKey: apiKey || cfg.apiKey, model: model || cfg.model, baseUrl: cfg.baseUrl
    });
    res.json({ ok: true, detail: (out.text || '').slice(0, 40) || 'responded' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
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

// --- MCP bridge: lets a logged-in CLI (Claude Code / Codex / Gemini) call FlowPilot tools ---
// Tool catalog for the MCP server to advertise.
app.get('/api/tools', (_req, res) => {
  res.json(Object.entries(TOOLS).map(([name, t]) => ({ name, desc: t.desc, params: t.params, perm: t.perm, risk: t.risk })));
});

// Run a single guarded tool. Permission engine still enforces role/risk.
// The CLI itself is the human-in-the-loop approval (it prompts before each tool use).
app.post('/api/tool', async (req, res) => {
  const { tool, params = {}, role = 'maintainer', runtimeMode = 'design', enabledRestricted = [], workspaceId = WS } = req.body || {};
  if (!tool) return res.status(400).json({ error: 'tool required' });
  const dec = evaluate(tool, { role, runtimeMode, enabledRestricted });
  if (dec.decision === Decision.DENY) return res.status(403).json({ error: 'denied by policy', reason: dec.reason });

  const emit = (e) => publish(workspaceId, e);
  const ctx = { workspaceId, runId: null, prompt: '(cli-mcp)', emit };

  // High-risk tools from the CLI/MCP brain still wait for a human Approve/Deny in the UI.
  if (dec.decision === Decision.APPROVAL) {
    const approvalId = Approvals.create(null, workspaceId, tool, params, dec.risk);
    emit(makeEvent(EventType.APPROVAL_REQUIRED, { approvalId, tool, params, risk: dec.risk, reason: dec.reason, via: 'cli-mcp' }));
    const { decision, by } = await waitForApproval(approvalId);
    Approvals.decide(approvalId, decision, by);
    if (decision !== 'approved') {
      emit(makeEvent(EventType.APPROVAL_DENIED, { approvalId, tool }));
      return res.status(403).json({ ok: false, error: 'denied by user', reason: `awaiting-approval ${tool} -> ${decision}` });
    }
    emit(makeEvent(EventType.APPROVAL_GRANTED, { approvalId, tool }));
  }

  emit(makeEvent(EventType.TOOL_CALLED, { tool, params, risk: dec.risk, via: 'cli-mcp' }));
  try {
    const result = await dispatchTool(ctx, tool, params);
    ToolCalls.record(null, workspaceId, tool, params, true, result, null);
    audit(workspaceId, 'cli-mcp', 'tool', { tool, risk: dec.risk });
    emit(makeEvent(EventType.TOOL_COMPLETED, { tool, via: 'cli-mcp', summary: 'ok' }));
    res.json({ ok: true, result });
  } catch (e) {
    ToolCalls.record(null, workspaceId, tool, params, false, null, e.message);
    emit(makeEvent(EventType.TOOL_FAILED, { tool, error: e.message }));
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
