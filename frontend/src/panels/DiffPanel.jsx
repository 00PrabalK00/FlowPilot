import React from 'react';

export default function DiffPanel({ draft, validation, snapshots, onRollback }) {
  const nodes = (draft?.flow || []).filter((n) => n.type !== 'tab');

  return (
    <section className="panel diff">
      <h3>Diff · Validation · Snapshots</h3>

      {draft ? (
        <>
          <div className="sub2">Added nodes ({nodes.length})</div>
          <ul className="difflist">
            {nodes.map((n) => <li key={n.id}><span className="add">+</span> {n.type} <em>{n.name || ''}</em></li>)}
          </ul>
        </>
      ) : <div className="hint">No draft yet.</div>}

      {validation && (
        <>
          <div className="sub2">Validation {validation.ok ? <span className="ok">PASSED</span> : <span className="fail">FAILED</span>}</div>
          <ul className="difflist">
            {(validation.passes || []).map((p) => (
              <li key={p.name}>
                {p.ok ? <span className="ok">✓</span> : <span className="fail">✗</span>} {p.name}
                {Array.isArray(p.issues) && p.issues.length > 0 && (
                  <ul className="issues">{p.issues.map((is, i) => <li key={i} className={is.severity}>{is.severity}: {is.msg}</li>)}</ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="sub2">Snapshots / Rollback</div>
      <ul className="difflist">
        {(snapshots || []).map((s) => (
          <li key={s.id}>
            <code>{s.id}</code> <em>{s.reason || ''}</em>
            <button className="rb" onClick={() => onRollback(s.id)}>Rollback</button>
          </li>
        ))}
        {(!snapshots || snapshots.length === 0) && <li className="hint">none</li>}
      </ul>
    </section>
  );
}
