// Register the FlowPilot MCP server with your locally-installed, already-logged-in CLIs.
// Claude Code: configured automatically via `claude mcp add`.
// Codex / Gemini: prints the exact config block to paste (we don't edit your configs for you).
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'mcp', 'src', 'server.js').replace(/\\/g, '/');
const env = { FLOWPILOT_BACKEND: 'http://127.0.0.1:8787', FLOWPILOT_ROLE: 'maintainer', FLOWPILOT_RUNTIME_MODE: 'design' };

const has = (c) => { try { execSync(`${process.platform === 'win32' ? 'where' : 'command -v'} ${c}`, { stdio: 'ignore' }); return true; } catch { return false; } };

console.log(`\nFlowPilot MCP server: node ${server}\n`);

// ---- Claude Code (auto) ----
if (has('claude')) {
  const envFlags = Object.entries(env).map(([k, v]) => `--env ${k}=${v}`).join(' ');
  const cmd = `claude mcp add flowpilot ${envFlags} -- node "${server}"`;
  try { execSync(cmd, { stdio: 'inherit' }); console.log('✓ Claude Code: added MCP server "flowpilot" (restart Claude Code / new session to use it)\n'); }
  catch { console.log(`! Claude Code present but add failed. Run manually:\n  ${cmd}\n`); }
} else {
  console.log('— Claude Code not found (skip)\n');
}

// ---- Codex (print) ----
console.log('Codex — add to ~/.codex/config.toml:\n');
console.log(`[mcp_servers.flowpilot]\ncommand = "node"\nargs = ["${server}"]\nenv = { FLOWPILOT_BACKEND = "${env.FLOWPILOT_BACKEND}", FLOWPILOT_ROLE = "${env.FLOWPILOT_ROLE}" }\n`);

// ---- Gemini CLI (print) ----
console.log('Gemini CLI — add to ~/.gemini/settings.json under "mcpServers":\n');
console.log(JSON.stringify({ mcpServers: { flowpilot: { command: 'node', args: [server], env } } }, null, 2));
console.log('\nThen: start the stack (npm run dev), open your CLI, and ask it to "list flowpilot tools" or "read my Node-RED flows".\n');
