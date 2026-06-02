// Anthropic Claude adapter. API key from server env only (Threat 8 — never client-side).
const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

export async function claudeChat({ system, messages, tools }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: messages.map(toAnthropic),
    tools: (tools || []).map(t => ({
      name: t.name.replace(/\./g, '__'),
      description: `${t.description} [risk:${t.risk}]`,
      input_schema: { type: 'object', properties: paramSchema(t.params), additionalProperties: true }
    }))
  };

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`);
  const data = await res.json();

  let text = '';
  const toolCalls = [];
  for (const block of data.content || []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name.replace(/__/g, '.'), params: block.input || {} });
  }
  return { text, toolCalls, raw: data };
}

function toAnthropic(m) {
  if (m.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: JSON.stringify(m.content).slice(0, 16000) }] };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return { role: 'assistant', content: [
      ...(m.text ? [{ type: 'text', text: m.text }] : []),
      ...m.toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name.replace(/\./g, '__'), input: tc.params }))
    ] };
  }
  return { role: m.role, content: m.text || m.content || '' };
}

function paramSchema(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const optional = String(v).endsWith('?');
    const t = String(v).replace('?', '');
    out[k] = { type: ['object', 'array', 'any'].includes(t) ? (t === 'array' ? 'array' : 'object') : (t === 'number' ? 'number' : 'string') };
    if (!optional) out[k].description = 'required';
  }
  return out;
}
