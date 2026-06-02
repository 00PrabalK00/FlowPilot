// Flow JSON diff (Diff panel, section 2). Node-level added/changed/removed.
export function diffFlows(current = [], proposed = []) {
  const curMap = new Map(current.map(n => [n.id, n]));
  const propMap = new Map(proposed.map(n => [n.id, n]));

  const added = [], changed = [], removed = [];
  let credsTouched = false, funcChanged = false;

  for (const [id, node] of propMap) {
    if (!curMap.has(id)) { added.push(summary(node)); }
    else if (JSON.stringify(curMap.get(id)) !== JSON.stringify(node)) {
      changed.push(summary(node));
      if (node.type === 'function' && curMap.get(id).func !== node.func) funcChanged = true;
      if (/cred|password|secret|token/i.test(JSON.stringify(node))) credsTouched = true;
    }
  }
  // NOTE: proposed for a single-tab patch usually only ADDS; removed only if a full replace.
  for (const [id, node] of curMap) if (!propMap.has(id)) removed.push(summary(node));

  return {
    added, changed, removed,
    credentialsTouched: credsTouched,
    functionCodeChanged: funcChanged,
    runtimeImpact: added.length || changed.length || removed.length
      ? 'Deploying restarts affected nodes; live behavior in this tab is briefly interrupted.'
      : 'No changes.'
  };
}

function summary(n) {
  return { id: n.id, type: n.type, name: n.name || n.label || '' };
}
