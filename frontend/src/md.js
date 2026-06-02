import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

// Render LLM markdown to HTML, with a light sanitize pass (local tool; strips the obvious XSS vectors).
export function md(text) {
  let html = marked.parse(String(text || ''));
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}
