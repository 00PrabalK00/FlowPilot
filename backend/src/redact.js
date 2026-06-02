// Secret/PII redaction (Threat 2, Threat 7 "redacted cloud" mode).
// Run over any context before it leaves for a cloud model.
const RULES = [
  [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, 'SECRET_REF_openai_key'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, 'SECRET_REF_slack_token'],
  [/("(?:password|secret|token|apikey|api_key|credential)"\s*:\s*)"[^"]+"/gi, '$1"SECRET_REF"'],
  [/\b(\d{1,3}\.){3}\d{1,3}\b/g, 'REDACTED_IP'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'REDACTED_EMAIL'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'SECRET_REF_jwt']
];

export function redact(text) {
  let out = String(text);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

// Deep-redact string values inside an object (for cloud-bound tool results).
export function redactObject(obj) {
  if (typeof obj === 'string') return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redactObject(v);
    return out;
  }
  return obj;
}
