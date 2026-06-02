import React from 'react';

// Lightweight Node-RED-style canvas from draft flow (x/y/wires).
// Drop-in upgrade path: swap this SVG for React Flow.
const W = 150, H = 34;

export default function FlowCanvas({ draft }) {
  const nodes = (draft?.flow || []).filter((n) => typeof n.x === 'number');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const config = (draft?.flow || []).filter((n) => n.type !== 'tab' && typeof n.x !== 'number');
  const tab = (draft?.flow || []).find((n) => n.type === 'tab');

  const wires = [];
  for (const n of nodes) (n.wires || []).forEach((port) => (port || []).forEach((t) => {
    if (byId.has(t)) wires.push([n, byId.get(t)]);
  }));

  const maxX = Math.max(200, ...nodes.map((n) => n.x + W + 40));
  const maxY = Math.max(160, ...nodes.map((n) => n.y + H + 40));

  return (
    <section className="panel canvas">
      <h3>Flow Preview {tab ? `· ${tab.label}` : ''}</h3>
      {!draft && <div className="hint">A drafted flow will render here before deploy.</div>}
      {draft && (
        <div className="canvas-scroll">
          <svg width={maxX} height={maxY}>
            {wires.map(([a, b], i) => (
              <path key={i} className="wire"
                d={`M${a.x + W},${a.y + H / 2} C${a.x + W + 40},${a.y + H / 2} ${b.x - 40},${b.y + H / 2} ${b.x},${b.y + H / 2}`} />
            ))}
            {nodes.map((n) => (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <rect className={`node t-${cls(n.type)}`} width={W} height={H} rx="5" />
                <text x={8} y={H / 2 + 4}>{n.name || n.type}</text>
              </g>
            ))}
          </svg>
          {config.length > 0 && (
            <div className="config-row">config: {config.map((c) => <span key={c.id} className="chip">{c.type} · {c.name || c.id}</span>)}</div>
          )}
        </div>
      )}
    </section>
  );
}
function cls(t) { return (t || '').replace(/[^a-z]/gi, ''); }
