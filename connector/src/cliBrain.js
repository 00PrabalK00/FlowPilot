// Bridge a chat turn to a locally-installed, logged-in AI CLI (Claude Code / Codex / Gemini).
// The CLI runs its own agent loop and controls Node-RED via the flowpilot MCP tools.
// Prompt is always sent via stdin (never an arg) -> no shell injection.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeEvent, EventType } from '@flowpilot/shared/events';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const MCP_SERVER = join(ROOT, 'mcp', 'src', 'server.js');
const IS_WIN = process.platform === 'win32';

// command name per CLI brain
const CLI_CMD = { 'claude-code': 'claude', 'codex-cli': 'codex', 'gemini-cli': 'gemini' };

export async function runCli(cli, prompt, config = {}, emit = () => {}) {
  if (!prompt || !prompt.trim()) return { ok: false, text: '(empty prompt)' };
  const cmd = CLI_CMD[cli] || config.cliCommand || 'claude'; // per-CLI map wins over global override

  const model = config.cliModel;
  let args, parse = 'text';
  if (cli === 'codex-cli') {
    args = model ? ['exec', '--model', model, '-'] : ['exec', '-'];  // MCP from ~/.codex/config.toml
  } else if (cli === 'gemini-cli') {
    args = model ? ['-m', model, '-p'] : ['-p'];                     // MCP from ~/.gemini/settings.json
  } else {
    // Claude Code: inline MCP config; stream-json for live progress.
    const cfg = { mcpServers: { flowpilot: { command: 'node', args: [MCP_SERVER], env: {
      FLOWPILOT_BACKEND: config.backendHttp || 'http://127.0.0.1:8787',
      FLOWPILOT_ROLE: config.cliRole || 'maintainer',
      FLOWPILOT_RUNTIME_MODE: config.runtimeMode || 'design'
    } } } };
    const cfgPath = join(mkdtempSync(join(tmpdir(), 'flowpilot-')), 'mcp.json');
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const full = config.agentMode === 'full';
    args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (full) {
      // full coding agent: allow Edit/Write/Bash; file changes are tracked + revertable.
      args.push('--permission-mode', 'bypassPermissions', '--mcp-config', cfgPath);
    } else {
      // safe: only the flowpilot Node-RED tools.
      args.push('--permission-mode', 'default', '--allowedTools', 'mcp__flowpilot', '--strict-mcp-config', '--mcp-config', cfgPath);
    }
    for (const d of config.agentDirs || []) args.push('--add-dir', d);
    parse = 'stream';
    if (config.cliModel) args.push('--model', config.cliModel);
  }

  return new Promise((resolve) => {
    let out = '', err = '', buf = '', resultText = null, isErr = false;
    const child = spawn(cmd, args, { cwd: ROOT, shell: IS_WIN });
    const killer = setTimeout(() => child.kill(), config.cliTimeoutMs || 280000);

    child.stdout.on('data', (d) => {
      out += d;
      if (parse !== 'stream') return;
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        handleStream(obj, emit, (t, e) => { resultText = t; isErr = e; });
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, text: `${cmd} not runnable: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (parse === 'stream') return resolve({ ok: !isErr && code === 0, text: resultText || out.trim() || err.trim() || `exited ${code}` });
      resolve({ ok: code === 0, text: out.trim() || err.trim() || `${cmd} exited ${code}` });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Update']);

// Parse one stream-json line from Claude Code; emit live "thinking/doing" + file-change events.
function handleStream(obj, emit, setResult) {
  if (obj.type === 'assistant' && obj.message?.content) {
    for (const b of obj.message.content) {
      if (b.type === 'text' && b.text?.trim()) emit(makeEvent(EventType.AGENT_THINKING, { text: b.text.trim() }));
      else if (b.type === 'thinking' && b.thinking?.trim()) emit(makeEvent(EventType.AGENT_THINKING, { text: b.thinking.trim(), kind: 'thinking' }));
      else if (b.type === 'tool_use') {
        const name = String(b.name || '');
        emit(makeEvent(EventType.AGENT_THINKING, { text: `using ${name.replace(/^mcp__flowpilot__/, '')}`, kind: 'tool' }));
        const path = b.input?.file_path || b.input?.path || b.input?.notebook_path;
        if (FILE_TOOLS.has(name) && path) emit(makeEvent(EventType.FILE_CHANGED, { path, tool: name }));
      }
    }
  } else if (obj.type === 'result') {
    setResult(obj.result, !!obj.is_error);
  }
}

// Connection test: does the CLI exist + respond to --version?
export function cliCheck(cli, config = {}) {
  const cmd = CLI_CMD[cli] || config.cliCommand || cli; // per-CLI map wins over global override
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

// Revert a file the agent edited, via git (tracked -> checkout HEAD; untracked -> delete).
export function restoreFile(filePath) {
  const dir = dirname(filePath);
  const run = (args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', shell: IS_WIN }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const top = run(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { ok: false, error: 'not a git repo — cannot auto-revert this file' };
  const tracked = run(['ls-files', '--error-unmatch', filePath]).code === 0;
  if (tracked) {
    const r = run(['checkout', 'HEAD', '--', filePath]);
    return r.code === 0 ? { ok: true, action: 'restored to last commit' } : { ok: false, error: r.out.trim() };
  }
  try { unlinkSync(filePath); return { ok: true, action: 'deleted (was newly created)' }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Detect which AI CLIs are installed on this machine.
export async function detectClis() {
  const ids = ['claude-code', 'codex-cli', 'gemini-cli'];
  const out = {};
  await Promise.all(ids.map(async (id) => { out[id] = await cliCheck(id); }));
  return out;
}

// back-compat
export const runClaudeCode = (prompt, config) => runCli('claude-code', prompt, config);
