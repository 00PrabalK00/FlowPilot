import React, { useEffect, useRef } from 'react';

// Streams actual tool STATE (section 7) — not just model text.
const ICON = {
  'agent.started': '▶', 'agent.done': '✔', 'agent.error': '✖',
  'tool.called': '⚙', 'tool.completed': '✓', 'tool.failed': '✖',
  'flow.draft.created': '✎', 'flow.validation.passed': '✔', 'flow.validation.failed': '✖',
  'approval.required': '⚠', 'approval.granted': '✔', 'approval.denied': '✖',
  'deploy.started': '⇪', 'deploy.completed': '✔', 'deploy.failed': '✖',
  'health.check': '♥', 'rollback.started': '↶', 'rollback.completed': '✔',
  'connector.status': '🔌', 'runtime.error.detected': '✖'
};
const HIDE = new Set(['agent.message', 'runtime.log']);

export default function ActionStream({ events }) {
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView(); }, [events]);
  const shown = events.filter((e) => !HIDE.has(e.type));

  return (
    <section className="panel stream">
      <h3>Live Action Stream</h3>
      <div className="cards">
        {shown.map((e, i) => (
          <div key={i} className={`card ${sev(e.type)}`}>
            <span className="ic">{ICON[e.type] || '•'}</span>
            <span className="ty">{e.type}</span>
            <span className="dt">{detail(e)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}

function sev(t) {
  if (t.endsWith('failed') || t.endsWith('error.detected') || t === 'agent.error') return 'bad';
  if (t.endsWith('passed') || t.endsWith('completed') || t.endsWith('granted')) return 'good';
  if (t === 'approval.required') return 'warn';
  return '';
}
function detail(e) {
  return e.summary || e.tool || e.reason || e.text ||
    (e.health ? `health ${e.health.ok ? 'OK' : 'FAIL'}` : '') ||
    (e.online !== undefined ? (e.online ? 'online' : 'offline') : '') ||
    (e.passes ? e.passes.map((p) => `${p.name}:${p.ok ? '✓' : '✗'}`).join(' ') : '');
}
