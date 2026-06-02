import React from 'react';
import Icon from '../Icon.jsx';

export default function ChangesModal({ open, draft, liveFlows = [], validation, onClose }) {
  if (!open) return null;
  const draftFlow = normalizeFlow(draft?.flow);
  const changes = summarizeChanges(draftFlow, liveFlows || []);
  const hasDraft = !!draft;

  return (
    <div className="modal-bg">
      <div className="modal changes-modal">
        <div className="modal-h">
          <b><Icon name="diff" size={15} /> Pending changes</b>
          <button onClick={onClose} title="Close"><Icon name="x" size={15} /></button>
        </div>

        {!hasDraft ? (
          <div className="hint">No pending draft.</div>
        ) : (
          <>
            <div className="change-summary">
              <span><b>{changes.added.length}</b> added</span>
              <span><b>{changes.modified.length}</b> modified</span>
              <span><b>{changes.code.length}</b> code</span>
              {validation && <span className={validation.ok ? 'ok' : 'fail'}>{validation.ok ? 'validation passed' : 'validation failed'}</span>}
            </div>

            <div className="change-sec">Node changes</div>
            <div className="change-list">
              {changes.nodes.length === 0 && <div className="hint">No node-level changes detected.</div>}
              {changes.nodes.map((c) => (
                <div key={`${c.kind}-${c.id}`} className={`change-row ${c.kind}`}>
                  <span className="change-kind">{c.kind}</span>
                  <span className="change-node">{c.type}</span>
                  <span className="change-name">{c.name || c.id}</span>
                  {c.fields.length > 0 && <span className="change-fields">{c.fields.join(', ')}</span>}
                </div>
              ))}
            </div>

            <div className="change-sec">Code changes</div>
            <div className="change-code-list">
              {changes.code.length === 0 && <div className="hint">No Function-node code changes detected.</div>}
              {changes.code.map((c) => (
                <div key={c.id} className="change-code">
                  <div className="change-code-h"><code>{c.name || c.id}</code> <span>{c.status}</span></div>
                  <div className="code-cols">
                    <pre>{c.before || '(new node)'}</pre>
                    <pre>{c.after || '(removed)'}</pre>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function summarizeChanges(draftFlow, liveFlows) {
  const liveById = new Map(liveFlows.map((n) => [n.id, n]));
  const nodes = [];
  const added = [];
  const modified = [];
  const code = [];

  for (const n of draftFlow) {
    if (!n || n.type === 'tab') continue;
    const prev = liveById.get(n.id);
    if (!prev) {
      const entry = { kind: 'add', id: n.id, type: n.type, name: n.name, fields: [] };
      nodes.push(entry);
      added.push(entry);
      if (n.type === 'function') code.push({ id: n.id, name: n.name, status: 'added', before: '', after: n.func || '' });
      continue;
    }
    const fields = changedFields(prev, n);
    if (fields.length > 0) {
      const entry = { kind: 'mod', id: n.id, type: n.type, name: n.name || prev.name, fields };
      nodes.push(entry);
      modified.push(entry);
      if (n.type === 'function' && prev.func !== n.func) {
        code.push({ id: n.id, name: n.name || prev.name, status: 'modified', before: prev.func || '', after: n.func || '' });
      }
    }
  }

  return { nodes, added, modified, code };
}

function normalizeFlow(flow) {
  if (Array.isArray(flow)) return flow;
  if (typeof flow === 'string') {
    try { return normalizeFlow(JSON.parse(flow)); } catch { return []; }
  }
  if (Array.isArray(flow?.flows)) return normalizeFlow(flow.flows);
  return [];
}

function changedFields(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = [];
  for (const k of keys) {
    if (k === 'x' || k === 'y') continue;
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push(k);
  }
  return out;
}
