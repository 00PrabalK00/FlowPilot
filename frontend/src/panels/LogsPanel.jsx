import React, { useEffect, useRef } from 'react';

export default function LogsPanel({ logs }) {
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView(); }, [logs]);

  return (
    <section className="panel logs">
      <h3>Logs & Telemetry</h3>
      <div className="logbox">
        {logs.length === 0 && <div className="hint">Live Node-RED runtime logs / debug / status stream here.</div>}
        {logs.map((l, i) => {
          const d = l.detail || {};
          const lvl = (d.data?.type) || (l.type === 'runtime.error.detected' ? 'error' : (d.topic || 'log'));
          return (
            <div key={i} className={`logline ${/error/i.test(lvl) ? 'err' : ''}`}>
              <span className="lt">{new Date(l.ts).toLocaleTimeString()}</span>
              <span className="lv">{String(d.topic || lvl).slice(0, 18)}</span>
              <span className="lm">{fmt(d.data)}</span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </section>
  );
}
function fmt(data) {
  if (!data) return '';
  if (data.msg !== undefined) return typeof data.msg === 'object' ? JSON.stringify(data.msg) : String(data.msg);
  if (data.text) return data.text;
  return JSON.stringify(data).slice(0, 120);
}
