import React, { useState } from 'react';
import { decideApproval } from '../api.js';

export default function ChatPanel({ messages, approvals, onSend, running }) {
  const [text, setText] = useState('Build me a robot task queue flow.');

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <section className="panel chat">
      <h3>Chat</h3>
      <div className="msgs">
        {messages.length === 0 && <div className="hint">Ask FlowPilot to build, modify, or debug a flow.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}><b>{m.role === 'user' ? 'You' : 'FlowPilot'}</b><div>{m.text}</div></div>
        ))}
        {approvals.map((a) => (
          <div key={a.id} className="approval">
            <div className="ahead">⚠ Approval required · <span className={`risk ${a.risk}`}>{a.risk}</span></div>
            <div className="atool">{a.tool}</div>
            <div className="areason">{a.reason}</div>
            <div className="abtns">
              <button className="approve" onClick={() => decideApproval(a.id, 'approved')}>Approve & Deploy</button>
              <button className="deny" onClick={() => decideApproval(a.id, 'denied')}>Deny</button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="composer">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe what you want…" disabled={running} />
        <button disabled={running}>Send</button>
      </form>
    </section>
  );
}
