// Google Gemini adapter via its OpenAI-compatible endpoint (AI Studio key).
// Key is server-side only (Threat 8).
import { openaiCompatChat } from './openai.js';

const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

export async function geminiChat({ system, messages, tools, apiKey, model }) {
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  return openaiCompatChat({ base: BASE, key, model: model || MODEL, system, messages, tools });
}
