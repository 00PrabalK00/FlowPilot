// Bridge a chat turn to the locally-installed, already-logged-in Claude Code CLI.
// We run `claude -p` headless, exposing ONLY the flowpilot MCP tools (no bash/edit),
// so Claude Code agentically drives Node-RED through the same guarded pipeline.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');                 // repo root
const MCP_SERVER = join(ROOT, 'mcp', 'src', 'server.js');
const IS_WIN = process.platform === 'win32';

export async function runClaudeCode(prompt, config = {}) {
  if (!prompt || !prompt.trim()) return { text: '(empty prompt)', ok: false };

  // Inline MCP config so Claude Code loads the flowpilot tools regardless of cwd.
  const cfg = {
    mcpServers: {
      flowpilot: {
        command: 'node',
        args: [MCP_SERVER],
        env: {
          FLOWPILOT_BACKEND: config.backendHttp || 'http://127.0.0.1:8787',
          FLOWPILOT_ROLE: config.cliRole || 'maintainer',
          FLOWPILOT_RUNTIME_MODE: config.runtimeMode || 'design'
        }
      }
    }
  };
  const dir = mkdtempSync(join(tmpdir(), 'flowpilot-'));
  const cfgPath = join(dir, 'mcp.json');
  writeFileSync(cfgPath, JSON.stringify(cfg));

  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'default',
    '--allowedTools', 'mcp__flowpilot',   // server-level allow; nothing else is pre-approved
    '--strict-mcp-config',
    '--mcp-config', cfgPath
  ];
  if (config.cliModel) args.push('--model', config.cliModel);

  return new Promise((resolve) => {
    let out = '', err = '';
    // shell:true resolves claude.cmd on Windows; prompt goes via stdin (never an arg) -> no injection.
    const child = spawn(config.cliCommand || 'claude', args, { cwd: ROOT, shell: IS_WIN });
    const killer = setTimeout(() => { child.kill(); }, config.cliTimeoutMs || 280000);

    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, text: `claude CLI not runnable: ${e.message}`, stderr: err }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      let text = out.trim();
      try {
        const j = JSON.parse(out);
        text = j.result ?? j.text ?? text;          // -p json => { result, ... }
        return resolve({ ok: !j.is_error, text, raw: j });
      } catch {
        resolve({ ok: code === 0, text: text || err || `claude exited ${code}`, stderr: err });
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
