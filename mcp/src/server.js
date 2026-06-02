#!/usr/bin/env node
// FlowPilot MCP server. Exposes the guarded Node-RED tools to any MCP client
// (Claude Code, Codex, Gemini CLI) so the CLI you already logged into can
// agentically control Node-RED. No API keys — the CLI is the brain.
//
// All tool calls go through the backend's permission engine + safe-deploy
// pipeline; the CLI's own per-tool approval is the human-in-the-loop.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BACKEND = process.env.FLOWPILOT_BACKEND || 'http://127.0.0.1:8787';
const ROLE = process.env.FLOWPILOT_ROLE || 'maintainer';
const RUNTIME_MODE = process.env.FLOWPILOT_RUNTIME_MODE || 'design';
const WORKSPACE = process.env.WORKSPACE_ID || 'default';
const ENABLED_RESTRICTED = (process.env.FLOWPILOT_ENABLE_RESTRICTED || '').split(',').filter(Boolean);

const log = (...a) => console.error('[flowpilot-mcp]', ...a); // MCP logs to stderr

async function fetchCatalog() {
  const res = await fetch(`${BACKEND}/api/tools`);
  if (!res.ok) throw new Error(`backend ${BACKEND} returned ${res.status}`);
  return res.json();
}

function zodShape(params = {}) {
  const shape = {};
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    const optional = s.endsWith('?');
    const t = s.replace('?', '');
    let zt = t === 'number' ? z.number()
      : t === 'string' ? z.string()
      : t === 'boolean' ? z.boolean()
      : z.any();
    shape[k] = optional ? zt.optional() : zt;
  }
  return shape;
}

async function callTool(toolName, args) {
  const res = await fetch(`${BACKEND}/api/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tool: toolName, params: args || {},
      role: ROLE, runtimeMode: RUNTIME_MODE, enabledRestricted: ENABLED_RESTRICTED, workspaceId: WORKSPACE
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, reason: data.reason };
  return data;
}

async function main() {
  let catalog;
  try { catalog = await fetchCatalog(); }
  catch (e) { log('cannot reach backend:', e.message, '— start it with `npm run dev` first.'); catalog = []; }

  const server = new McpServer({ name: 'flowpilot', version: '0.1.0' });

  // Skip restricted tools unless explicitly enabled (shell/file write stay off).
  const exposed = catalog.filter((t) => t.perm !== 'restricted' || ENABLED_RESTRICTED.includes(t.name));

  for (const t of exposed) {
    const mcpName = t.name.replace(/\./g, '_'); // dots -> underscores for client compat
    server.registerTool(
      mcpName,
      { title: t.name, description: `${t.desc} (risk: ${t.risk})`, inputSchema: zodShape(t.params) },
      async (args) => {
        const out = await callTool(t.name, args);
        return {
          isError: out.ok === false,
          content: [{ type: 'text', text: JSON.stringify(out.ok === false ? { error: out.error, reason: out.reason } : out.result, null, 2) }]
        };
      }
    );
  }

  log(`exposing ${exposed.length} tools as role=${ROLE} mode=${RUNTIME_MODE} -> ${BACKEND}`);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => { log('fatal:', e.message); process.exit(1); });
