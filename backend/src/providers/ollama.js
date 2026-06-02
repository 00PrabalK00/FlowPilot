// Local Ollama adapter (section 3, Mode 3). Uses its OpenAI-compatible endpoint.
// localhost:11434 has no auth by default — keep it bound locally / behind the connector.
import { openaiCompatChat } from './openai.js';

const BASE = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434') + '/v1';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1';

export async function ollamaChat(args) {
  return openaiCompatChat({ base: BASE, key: null, model: MODEL, ...args });
}
