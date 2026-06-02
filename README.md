# FlowPilot — Live Agentic Node-RED Control Plane

Not a chatbot that spits out flow JSON. A **guarded live operator** that watches Node-RED,
drafts flows + function code, runs 5 validation passes, deploys safely behind approval, watches
runtime logs, and rolls back on failure.

> Core rule: the AI does **not** control Node-RED. It *proposes* actions. The permission engine
> decides what's allowed. The user approves dangerous actions. The connector executes bounded
> tools. Everything is audited.

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

Keys live **server-side only** (Threat 8). Cloud providers receive **redacted** tool results
(secrets/IPs/emails/JWTs stripped — Threat 2 & 7); local/mock get raw context.

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
