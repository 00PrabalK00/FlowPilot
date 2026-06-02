import React, { useState, useRef, useEffect } from 'react';
import { decideApproval } from '../api.js';
import { md } from '../md.js';
import Icon from '../Icon.jsx';

// Purpose-built chat UI for the Node-RED editor sidebar.
// One column: chat bubbles + inline tool activity + node context + approvals.

const ACTIVITY = {
  'tool.called': 'gear', 'tool.completed': 'check', 'tool.failed': 'x',
  'flow.draft.created': 'pencil', 'flow.validation.passed': 'check', 'flow.validation.failed': 'x',
  'deploy.started': 'rocket', 'deploy.completed': 'check', 'deploy.failed': 'x',
  'health.check': 'pulse', 'rollback.started': 'sync', 'rollback.completed': 'check',
  'approval.granted': 'check', 'approval.denied': 'x'
};

export default function SidebarChat({
  messages, events, approvals, online, running, brain, onOpenSettings,
  selected, onClearSelect, onAction, onSend
}) {
  const [text, setText] = useState('');
  const end = useRef(null);

  // merge chat bubbles + activity rows into one timeline
  const feed = [
    ...messages.map((m) => ({ kind: 'msg', ts: m.ts || 0, ...m })),
    ...events.filter((e) => ACTIVITY[e.type]).map((e) => ({ kind: 'act', ts: e.ts || 0, ...e }))
  ].sort((a, b) => a.ts - b.ts);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, events.length, approvals.length]);

  function submit(e) {
    e.preventDefault();
    if (!text.trim() || running) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <div className="sc">
      <header className="sc-bar">
        <img className="sc-logo" src="/logo.png" alt="" />
        <b className="sc-name">FlowPilot</b>
        <button className="sc-gear" onClick={onOpenSettings} title="Settings · brain">
          <Icon name="gear" size={15} /> <span className="sc-brainlbl">{brain}</span>
        </button>
        <span className={`sc-dot ${online ? 'on' : 'off'}`} title={online ? 'connector online' : 'connector offline'} />
      </header>

      <div className="sc-feed">
        {feed.length === 0 && (
          <div className="sc-empty">
            <p>Ask FlowPilot to build, explain, debug or change a Node-RED flow.</p>
            <p className="sc-tip">Tip: click a node in the canvas → it becomes the subject of your message.</p>
          </div>
        )}
        {feed.map((it, i) => it.kind === 'msg' ? (
          it.role === 'assistant'
            ? <div key={i} className="sc-msg assistant md" dangerouslySetInnerHTML={{ __html: md(it.text) }} />
            : <div key={i} className="sc-msg user">{it.text}</div>
        ) : (
          <div key={i} className={`sc-act ${sev(it.type)}`}>
            <span className="sc-ic"><Icon name={ACTIVITY[it.type]} /></span>
            <span className="sc-tool">{it.tool || it.type.replace(/\./g, ' ')}</span>
            <span className="sc-extra">{it.summary || (it.health ? `health ${it.health.ok ? 'OK' : 'FAIL'}` : '')}</span>
          </div>
        ))}

        {approvals.map((a) => (
          <div key={a.id} className="sc-appr">
            <div className="sc-appr-h"><Icon name="alert" /> Approve <code>{a.tool}</code> <span className={`risk ${a.risk}`}>{a.risk}</span></div>
            <div className="sc-appr-b">
              <button className="approve" onClick={() => decideApproval(a.id, 'approved')}>Approve</button>
              <button className="deny" onClick={() => decideApproval(a.id, 'denied')}>Deny</button>
            </div>
          </div>
        ))}

        {running && <div className="sc-act running"><span className="sc-ic"><Icon name="sync" spin /></span> working…</div>}
        <div ref={end} />
      </div>

      {selected && (
        <div className="sc-sel">
          <span className={`sc-seldot t-${(selected.type || '').replace(/[^a-z]/gi, '')}`} />
          <b>{selected.name || selected.type}</b>
          <span className="sc-seltype">{selected.type}</span>
          <button className="sc-selx" onClick={onClearSelect}>✕</button>
          <div className="sc-selacts">
            <button onClick={() => onAction('explain')}>Explain</button>
            <button onClick={() => { const t = onAction('modify'); if (t) setText(t); }}>Modify…</button>
            <button className="seldel" onClick={() => onAction('delete')}>Delete</button>
          </div>
        </div>
      )}

      <form className="sc-composer" onSubmit={submit}>
        <textarea rows={2} value={text} disabled={running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
          placeholder={selected ? `Ask about "${selected.name || selected.type}"…` : 'Message FlowPilot…  (Enter to send)'} />
        <button disabled={running} title="Send"><Icon name="send" size={16} /></button>
      </form>
    </div>
  );
}

function sev(t) {
  if (t.endsWith('failed') || t.endsWith('denied')) return 'bad';
  if (t.endsWith('passed') || t.endsWith('completed') || t.endsWith('granted')) return 'good';
  return '';
}
