// Shared approval gate. Used by both the API orchestrator and the CLI/MCP tool path,
// so high-risk actions wait for a human Approve/Deny in the UI before executing.
const pending = new Map(); // approvalId -> { resolve }

export function waitForApproval(approvalId, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(approvalId); resolve({ decision: 'denied', by: 'timeout' }); }, timeoutMs);
    pending.set(approvalId, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
  });
}

export function resolveApproval(approvalId, decision, by) {
  const p = pending.get(approvalId);
  if (!p) return false;
  pending.delete(approvalId);
  p.resolve({ decision, by });
  return true;
}
