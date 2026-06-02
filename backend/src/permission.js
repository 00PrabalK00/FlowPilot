// Permission engine (section 6 + 12). Every tool call passes through here.
// The agent PROPOSES; this engine + the user DECIDE.
import { TOOLS, Perm } from '@flowpilot/shared/tools';
import { RiskMinRole, roleAtLeast } from '@flowpilot/shared/risk';

export const Decision = { ALLOW: 'allow', APPROVAL: 'needs_approval', DENY: 'deny' };

// policy: { role, enabledRestricted:[toolNames], runtimeMode:'design'|'runtime' }
export function evaluate(toolName, policy = {}) {
  const t = TOOLS[toolName];
  if (!t) return { decision: Decision.DENY, reason: `unknown tool ${toolName}` };

  const role = policy.role || 'builder';

  // role must clear the risk floor
  const minRole = RiskMinRole[t.risk];
  if (!roleAtLeast(role, minRole)) {
    return { decision: Decision.DENY, reason: `risk '${t.risk}' needs role >= ${minRole}, have ${role}`, risk: t.risk };
  }

  // runtime control is gated behind runtime mode (section 5.6)
  const isRuntimeControl = toolName.startsWith('runtime.send') || toolName === 'runtime.stop_command';
  if (isRuntimeControl && policy.runtimeMode !== 'runtime') {
    return { decision: Decision.DENY, reason: 'runtime control disabled (design mode). Enable runtime mode explicitly.', risk: t.risk };
  }

  if (t.perm === Perm.RESTRICTED) {
    if (!(policy.enabledRestricted || []).includes(toolName)) {
      return { decision: Decision.DENY, reason: `restricted tool '${toolName}' not enabled by workspace policy`, risk: t.risk };
    }
    return { decision: Decision.APPROVAL, reason: 'restricted tool: strong approval required', risk: t.risk };
  }

  if (t.perm === Perm.APPROVAL) {
    return { decision: Decision.APPROVAL, reason: `risk ${t.risk}: user approval required`, risk: t.risk };
  }

  return { decision: Decision.ALLOW, risk: t.risk };
}
