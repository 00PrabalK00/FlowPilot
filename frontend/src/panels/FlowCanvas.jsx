import React, { useState, useEffect } from 'react';

// Interactive Node-RED-style canvas. Shows the draft if one exists, else your LIVE flows.
// Click a node -> it becomes chat context (talk about / modify / delete that element).
const W = 150, H = 34;

export default function FlowCanvas({ draft, liveFlows = [], selectedId, onSelect }) {
  const source = draft?.flow || liveFlows;
  const tabs = source.filter((n) => n.type === 'tab');
  const [activeTab, setActiveTab] = useState(null);

  useEffect(() => { if (tabs.length && !tabs.find((t) => t.id === activeTab)) setActiveTab(tabs[0].id); }, [source]);

  const tabId = activeTab || tabs[0]?.id;
  const nodes = source.filter((n) => n.z === tabId && typeof n.x === 'number');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const config = source.filter((n) => n.type !== 'tab' && typeof n.x !== 'number');

  const wires = [];
  for (const n of nodes) (n.wires || []).forEach((port) => (port || []).forEach((t) => {
    if (byId.has(t)) wires.push([n, byId.get(t)]);
  }));

  const maxX = Math.max(220, ...nodes.map((n) => n.x + W + 40));
  const maxY = Math.max(160, ...nodes.map((n) => n.y + H + 40));

  return (
    <section className="panel canvas">
      <h3>Flow {draft ? 'Preview (draft)' : '· live'} {tabs.length > 1 ? '' : tabs[0] ? `· ${tabs[0].label}` : ''}</h3>

      {tabs.length > 1 && (
        <div className="tabbar">
          {tabs.map((t) => (
            <button key={t.id} className={`tabchip ${t.id === tabId ? 'on' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label || t.id}</button>
          ))}
        </div>
      )}

      {source.length === 0 && <div className="hint">No flows yet. Ask FlowPilot to build one, or deploy a draft.</div>}

      {source.length > 0 && (
        <div className="canvas-scroll">
          <svg width={maxX} height={maxY}>
            {wires.map(([a, b], i) => (
              <path key={i} className="wire"
                d={`M${a.x + W},${a.y + H / 2} C${a.x + W + 40},${a.y + H / 2} ${b.x - 40},${b.y + H / 2} ${b.x},${b.y + H / 2}`} />
            ))}
            {nodes.map((n) => (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} className="nodewrap" onClick={() => onSelect?.(n)}>
                <rect className={`node t-${cls(n.type)} ${n.id === selectedId ? 'sel' : ''}`} width={W} height={H} rx="5" />
                <text x={8} y={H / 2 + 4}>{n.name || n.type}</text>
              </g>
            ))}
          </svg>
          {config.length > 0 && (
            <div className="config-row">config: {config.map((c) => (
              <span key={c.id} className={`chip ${c.id === selectedId ? 'sel' : ''}`} onClick={() => onSelect?.(c)}>{c.type} · {c.name || c.id}</span>
            ))}</div>
          )}
          <div className="canvas-hint">Tip: click any node to talk about it →</div>
        </div>
      )}
    </section>
  );
}
function cls(t) { return (t || '').replace(/[^a-z]/gi, ''); }
