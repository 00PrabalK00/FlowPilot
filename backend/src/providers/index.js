// Provider adapter layer (section 3). Normalized output:
//   { text, toolCalls: [{ id, name, params }] }
// Modes: bring-your-own-key (claude/openai), local (ollama), mock (offline e2e).
import { claudeChat } from './claude.js';
import { openaiChat } from './openai.js';
import { geminiChat } from './gemini.js';
import { ollamaChat } from './ollama.js';
import { mockChat } from './mock.js';

export function getProvider(name) {
  switch ((name || process.env.FLOWPILOT_PROVIDER || 'mock').toLowerCase()) {
    case 'claude':
    case 'anthropic': return { name: 'claude', chat: claudeChat };
    case 'openai':
    case 'codex':     return { name: 'openai', chat: openaiChat };
    case 'gemini':
    case 'google':    return { name: 'gemini', chat: geminiChat };
    case 'ollama':    return { name: 'ollama', chat: ollamaChat };
    case 'mock':
    default:          return { name: 'mock', chat: mockChat };
  }
}
