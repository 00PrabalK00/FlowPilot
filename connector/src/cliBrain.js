// Bridge a chat turn to a locally-installed, logged-in AI CLI (Claude Code / Codex / Gemini).
// The CLI runs its own agent loop and controls Node-RED via the flowpilot MCP tools.
// Prompt is always sent via stdin (never an arg) -> no shell injection.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const MCP_SERVER = join(ROOT, 'mcp', 'src', 'server.js');
const IS_WIN = process.platform === 'win32';

// command name per CLI brain
const CLI_CMD = { 'claude-code': 'claude', 'codex-cli': 'codex', 'gemini-cli': 'gemini' };

export async function runCli(cli, prompt, config = {}) {
  if (!prompt || !prompt.trim()) return { ok: false, text: '(empty prompt)' };
  const cmd = config.cliCommand || CLI_CMD[cli] || 'claude';

  let args, parse = 'text';
  if (cli === 'codex-cli') {
    // Codex reads the prompt from stdin in exec mode; MCP comes from ~/.codex/config.toml (npm run mcp:register).
    args = ['exec', '-'];
  } else if (cli === 'gemini-cli') {
    // Gemini reads stdin; MCP from ~/.gemini/settings.json (npm run mcp:register).
    args = ['-p'];
  } else {
    // Claude Code: inline MCP config so it always has the flowpilot tools; only those tools pre-allowed.
    const cfg = { mcpServers: { flowpilot: { command: 'node', args: [MCP_SERVER], env: {
      FLOWPILOT_BACKEND: config.backendHttp || 'http://127.0.0.1:8787',
      FLOWPILOT_ROLE: config.cliRole || 'maintainer',
      FLOWPILOT_RUNTIME_MODE: config.runtimeMode || 'design'
    } } } };
    const cfgPath = join(mkdtempSync(join(tmpdir(), 'flowpilot-')), 'mcp.json');
    writeFileSync(cfgPath, JSON.stringify(cfg));
    args = ['-p', '--output-format', 'json', '--permission-mode', 'default',
      '--allowedTools', 'mcp__flowpilot', '--strict-mcp-config', '--mcp-config', cfgPath];
    parse = 'json';
    if (config.cliModel) args.push('--model', config.cliModel);
  }

  return new Promise((resolve) => {
    let out = '', err = '';
    const child = spawn(cmd, args, { cwd: ROOT, shell: IS_WIN });
    const killer = setTimeout(() => child.kill(), config.cliTimeoutMs || 280000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, text: `${cmd} not runnable: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (parse === 'json') {
        try { const j = JSON.parse(out); return resolve({ ok: !j.is_error, text: j.result ?? out.trim(), raw: j }); } catch {}
      }
      resolve({ ok: code === 0, text: out.trim() || err.trim() || `${cmd} exited ${code}` });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Connection test: does the CLI exist + respond to --version?
export function cliCheck(cli, config = {}) {
  const cmd = config.cliCommand || CLI_CMD[cli] || cli;
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, ['--version'], { shell: IS_WIN });
    const killer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'timeout' }); }, 8000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, error: `${cmd} not found: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(killer); resolve({ ok: code === 0, version: out.trim().split('\n')[0] }); });
  });
}

// back-compat
export const runClaudeCode = (prompt, config) => runCli('claude-code', prompt, config);
