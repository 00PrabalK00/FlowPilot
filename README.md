<p align="center">
  <img src="frontend/public/logo.png" alt="FlowPilot" width="120" />
</p>

<h1 align="center">FlowPilot — AI Control Plane for Node-RED</h1>

<p align="center"><b>Chat with Node-RED. Ship safe flows.</b><br/>
The AI assistant + control plane for production Node-RED: generate, validate, deploy, debug and roll back flows safely.</p>

Not a chatbot that spits out flow JSON. A **guarded live operator** that watches Node-RED,
drafts flows + function code, runs 5 validation passes, deploys safely behind approval, watches
runtime logs, and rolls back on failure.

## Demo

![FlowPilot demo](docs/assets/flowpilot-demo.gif)

> Core rule: the AI does **not** control Node-RED. It *proposes* actions. The permission engine
> decides what's allowed. The user approves dangerous actions. The connector executes bounded
> tools. Everything is audited.

## What is FlowPilot?

FlowPilot is an **AI assistant and control plane for Node-RED**. It reads your existing flows, drafts
new workflows, writes Function-node JavaScript, validates changes, shows a diff, requests approval,
deploys safely, watches runtime logs, and rolls back if the runtime becomes unhealthy. It works with
cloud AI, your logged-in **Claude Code / Codex / Gemini CLI** (via an MCP server), or **local models
through Ollama**.

## Why FlowPilot?

Node-RED is powerful, but production flows need safety. The Node-RED editor is unsecured by default if
exposed on a network — so an AI that *deploys* needs guardrails, not just generation. FlowPilot adds AI
flow generation with **validation, approval gates, audit logs, live telemetry, security preflight and
rollback**, through an **outbound-only local connector** so Node-RED never has to face the internet.

## Use cases

- **AI Node-RED workflow builder** — generate flows from a plain-English prompt
- **Node-RED AI assistant** — chat-based help inside your runtime
- **Node-RED flow generator** — JSON flow + Function-node code generation
- **Node-RED debugging assistant** — trace message paths, find broken nodes, suggest fixes
- **Node-RED MCP server** — give Claude Code / Codex / Gemini CLI bounded, guarded access to your flows
- **Local AI assistant for Node-RED** — privacy-first via Ollama, no keys, no cloud
- **Safe Node-RED deploy** — snapshot, validate, approve, deploy, health-check, auto-rollback
- **Robotics & IoT** — robot task queue, MQTT workflow generator, ROS2 ↔ Node-RED bridge

## Architecture

```
Browser UI (5 panels)
  └─ SSE/REST ─▶ Backend control plane ─▶ Permission engine ─▶ Tool layer
                       │                                            │
                       └─ outbound WS tunnel ◀──── Local connector ─┘
                                                        └─▶ Node-RED Admin API (official surface)
```

- **shared/** — event-stream contract, tool registry (perm level + risk + runner), role/risk model.
- **connector/** — local agent near Node-RED. Wraps Admin API (`/flows`, `/flows/state`,
  `/diagnostics`, `/nodes`, `/settings`), subscribes to `/comms` for live debug/status/logs,
  runs a security preflight, and executes only the guarded tools the backend invokes. Opens an
  **outbound** WS so Node-RED never has to be exposed to the internet.
- **backend/** — Express + `ws` + `node:sqlite`. Connector tunnel, SSE event stream to the browser,
  agent orchestrator, permission engine, 5 validation passes, snapshot/draft/approval/audit storage,
  and the safe-deploy pipeline.
- **frontend/** — React + Vite. Five panels: Chat, Live Action Stream, Flow Canvas Preview,
  Diff / Validation / Snapshots, Logs & Telemetry. Streams tool **state**, not just model text.

## Run it

```bash
npm install                 # installs all workspaces

# 4 terminals (or background them):
npm run dev:nodered         # local Node-RED on :1880 (test target)
npm run dev:backend         # control plane on :8787   (FLOWPILOT_PROVIDER=mock by default)
npm run dev:connector       # tunnel: connector -> backend, talks to Node-RED
npm run dev:frontend        # UI on http://localhost:5173
```

Open http://localhost:5173 and send: **"Build me a robot task queue flow."**
You'll watch the agent read flows → check nodes → write the worker function → draft → validate →
diff → **wait for your approval** → deploy → health-check → (auto-rollback if unhealthy).

### AI providers (section 3)

Set env on the backend:

| Mode | Env |
|------|-----|
| Offline demo (default) | `FLOWPILOT_PROVIDER=mock` |
| Claude (BYO key) | `FLOWPILOT_PROVIDER=claude ANTHROPIC_API_KEY=...` |
| OpenAI / compatible | `FLOWPILOT_PROVIDER=openai OPENAI_API_KEY=...` |
| Local Ollama | `FLOWPILOT_PROVIDER=ollama OLLAMA_MODEL=llama3.1` |

Keys live **server-side only** (Threat 8) in the **gitignored `secrets/` folder** (or `backend/.env`,
also gitignored). Nothing secret is ever committed or returned over the API. Cloud providers receive
**redacted** tool results (secrets/IPs/emails/JWTs stripped — Threat 2 & 7); local/mock get raw context.

### Recommended: no keys — bridge your logged-in CLI via MCP

Don't want to paste keys? Use the Claude Code / Codex / Gemini CLI you're **already logged into** as the
brain. FlowPilot ships an **MCP server** that exposes its guarded Node-RED tools, so your CLI drives
Node-RED agentically — "like giving Claude Code a tool". No API keys; uses your existing subscription.

```bash
npm run dev            # start the stack first (backend must be up)
npm run mcp:register   # auto-adds to Claude Code; prints Codex/Gemini config to paste
```

Then open your CLI in this project and say: *"read my Node-RED flows"* or *"build a robot task queue flow"*.
Tool calls flow through the same permission engine + safe-deploy pipeline; your CLI's own per-tool
approval is the human-in-the-loop. Live activity still shows in the FlowPilot web UI, and flows render
in the **real Node-RED editor at http://localhost:1880** — so the web UI is optional, not a second place
you're forced to work.

- `FLOWPILOT_ROLE` (default `maintainer`) sets what risk level the CLI may reach.
- Restricted tools (shell/file) stay hidden unless `FLOWPILOT_ENABLE_RESTRICTED=tool.name,...`.
- Test the bridge without a CLI: `node mcp/src/server.js` (stdio).

### Use it inside the Node-RED editor (sidebar)

FlowPilot ships a **Node-RED editor plugin** so the chat lives *inside* the Node-RED editor at
`http://localhost:1880` — a **FlowPilot tab** (paper-plane icon) in the right sidebar. Select a node
in the real canvas and it becomes the chat context (Explain / Modify / Delete that element).

- `npm run dev` **auto-installs** the sidebar into the bundled dev Node-RED — nothing to do.
- For your **own** Node-RED: `npm run plugin:install [userDir]` (defaults to `~/.node-red`), then restart it.
- One-shot wiring (sidebar + MCP into your CLI): `npm run setup`.

The sidebar embeds the chat UI (`/?embed=1`), so your two surfaces are: the **real Node-RED canvas**
to see/edit flows, and the **FlowPilot tab** to talk to the agent — no separate website required.

## What's implemented (maps to the spec)

- **MVP 1** read-only agent: get_flows / list_nodes / diagnostics / settings / logs / security preflight.
- **MVP 2** draft generator: constrained function-node codegen, draft persistence, JSON diff, flow preview.
- **MVP 3** safe deploy: pre-deploy snapshot → single-tab merge patch → deploy → health check → **auto-rollback**.
- **Permission engine** (section 6/12): every tool gated by role-rank ≥ risk floor, perm class
  (safe/approval/restricted), and runtime-mode (design vs runtime control).
- **5 validation passes** (section 10): JSON schema, node catalog, function-code static checks
  (eval/loops/network/secret-leak), security scan (dangerous nodes, embedded secrets, mqtt wildcards,
  external URLs), and sandboxed runtime simulation (`node:vm`, 1s timeout).
- **Live event stream** (section 7) over SSE — tool state cards, not just text.
- **Audit** of runs, tool calls, approvals.
- **Prompt-injection defense** (Threat 1): system prompt treats flow text/logs/payloads as untrusted data.

Verified end-to-end against a real Node-RED: deploy lands an 8-node MQTT task-queue flow, snapshot
captured, rollback restores prior state.

## Roadmap (not yet built)

Multi-agent split (requirement/architect/validator/security/deploy/debugger sub-agents via LangGraph),
MCP tool exposure, cloud sandbox container per run, npm package reputation gating UI, robotics
runtime-control registry + e-stop integration, Postgres/Redis/object-store, SSO, billing, Git projects.

## Security notes

- Connector is **outbound-only**; Node-RED stays private.
- `local.*` (file/shell) tools are **restricted — off by default**; require explicit workspace policy.
- Runtime control (`runtime.send_*`) is blocked unless `runtimeMode: 'runtime'` is explicitly set.
- Preflight flags unsecured admin API, missing HTTPS on remote, and dangerous installed nodes (Threat 3).
