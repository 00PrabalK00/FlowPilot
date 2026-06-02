// Server-side secret store. Keys live ONLY in the gitignored secrets/ folder.
// Rules: never return raw keys over the API, never log them.
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const DIR = process.env.FLOWPILOT_SECRETS_DIR || join(ROOT, 'secrets');
const FILE = join(DIR, 'providers.json');

mkdirSync(DIR, { recursive: true });

const DEFAULT = { selected: process.env.FLOWPILOT_PROVIDER || 'claude-code', providers: {} };

function load() {
  if (!existsSync(FILE)) return structuredClone(DEFAULT);
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return structuredClone(DEFAULT); }
}
function save(data) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
  try { chmodSync(FILE, 0o600); } catch {} // best-effort owner-only (no-op on Windows)
}

let state = load();

export function getSelected() {
  // env wins if explicitly set, else stored choice
  return process.env.FLOWPILOT_PROVIDER || state.selected || 'mock';
}
export function setSelected(name) { state.selected = name; save(state); }

// Returns { apiKey, model, baseUrl, url } — env vars override the stored value.
export function getProviderConfig(name) {
  const s = state.providers[name] || {};
  const env = {
    claude: { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_MODEL },
    openai: { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, baseUrl: process.env.OPENAI_BASE_URL },
    gemini: { apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, model: process.env.GEMINI_MODEL },
    ollama: { model: process.env.OLLAMA_MODEL, baseUrl: process.env.OLLAMA_URL }
  }[name] || {};
  return {
    apiKey: env.apiKey || s.apiKey || null,
    model: env.model || s.model || null,
    baseUrl: env.baseUrl || s.baseUrl || null
  };
}

export function setProviderConfig(name, { apiKey, model, baseUrl } = {}) {
  const cur = state.providers[name] || {};
  state.providers[name] = {
    ...cur,
    ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
  save(state);
}

export function clearProvider(name) { delete state.providers[name]; save(state); }

// SAFE status for the API/UI — NEVER includes the key itself.
export function status() {
  const names = ['claude', 'openai', 'gemini', 'ollama', 'mock'];
  return {
    selected: getSelected(),
    providers: names.map((name) => {
      const cfg = getProviderConfig(name);
      return {
        name,
        configured: name === 'mock' || name === 'ollama' ? true : !!cfg.apiKey,
        keyMasked: cfg.apiKey ? mask(cfg.apiKey) : null,
        fromEnv: name === 'claude' ? !!process.env.ANTHROPIC_API_KEY
          : name === 'openai' ? !!process.env.OPENAI_API_KEY
          : name === 'gemini' ? !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) : false,
        model: cfg.model || null
      };
    })
  };
}

function mask(k) { return k.length <= 8 ? '••••' : k.slice(0, 4) + '••••' + k.slice(-4); }
