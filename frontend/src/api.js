const WS = 'default';

export async function startChat(prompt, { role = 'maintainer', provider = 'claude-code' } = {}) {
  await fetch('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, role, provider, workspaceId: WS })
  });
}

export async function decideApproval(id, decision) {
  await fetch(`/api/approvals/${id}/decide`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision })
  });
}

export async function getDraft(id) {
  const r = await fetch(`/api/drafts/${id}`);
  return r.ok ? r.json() : null;
}

export async function getSnapshots() {
  return (await fetch(`/api/snapshots?workspaceId=${WS}`)).json();
}

export async function getLiveFlows() {
  try { const r = await fetch(`/api/flows?workspaceId=${WS}`); return r.ok ? r.json() : { flows: [] }; }
  catch { return { flows: [] }; }
}

export async function rollback(snapshotId) {
  await fetch('/api/rollback', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshotId, workspaceId: WS })
  });
}

// SSE subscription. onEvent(evt). Returns close fn.
export function subscribeEvents(onEvent) {
  const es = new EventSource(`/api/events?workspaceId=${WS}`);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
  return () => es.close();
}
