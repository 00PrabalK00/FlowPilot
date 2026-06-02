// OpenAI (and OpenAI-compatible) adapter. Bearer key from server env (Threat 8).
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

export async function openaiChat({ system, messages, tools, apiKey, model, baseUrl }) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return openaiCompatChat({ base: baseUrl || BASE, key, model: model || MODEL, system, messages, tools });
}

// shared by openai + local openai-compatible servers + ollama(openai mode)
export async function openaiCompatChat({ base, key, model, system, messages, tools }) {
  const msgs = [{ role: 'system', content: system }, ...messages.map(toOpenAI)];
  const body = {
    model,
    messages: msgs,
    tools: (tools || []).map(t => ({
      type: 'function',
      function: { name: t.name.replace(/\./g, '__'), description: `${t.description} [risk:${t.risk}]`,
        parameters: { type: 'object', properties: schema(t.params), additionalProperties: true } }
    }))
  };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`openai-compat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const choice = data.choices?.[0]?.message || {};
  const toolCalls = (choice.tool_calls || []).map(tc => ({
    id: tc.id, name: tc.function.name.replace(/__/g, '.'),
    params: safeParse(tc.function.arguments)
  }));
  return { text: choice.content || '', toolCalls, raw: data };
}

function toOpenAI(m) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: JSON.stringify(m.content).slice(0, 16000) };
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return { role: 'assistant', content: m.text || null,
      tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name.replace(/\./g, '__'), arguments: JSON.stringify(tc.params) } })) };
  }
  return { role: m.role, content: m.text || m.content || '' };
}

function schema(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const t = String(v).replace('?', '');
    out[k] = { type: t === 'array' ? 'array' : t === 'number' ? 'number' : ['object', 'any'].includes(t) ? 'object' : 'string' };
  }
  return out;
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
