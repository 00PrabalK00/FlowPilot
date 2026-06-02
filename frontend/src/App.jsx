import React, { useEffect, useRef, useState } from 'react';
import { subscribeEvents, startChat, getDraft, getSnapshots, rollback } from './api.js';
import ChatPanel from './panels/ChatPanel.jsx';
import ActionStream from './panels/ActionStream.jsx';
import FlowCanvas from './panels/FlowCanvas.jsx';
import DiffPanel from './panels/DiffPanel.jsx';
import LogsPanel from './panels/LogsPanel.jsx';

export default function App() {
  const [events, setEvents] = useState([]);
  const [messages, setMessages] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [draft, setDraft] = useState(null);
  const [validation, setValidation] = useState(null);
  const [logs, setLogs] = useState([]);
  const [online, setOnline] = useState(false);
  const [running, setRunning] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const seenDraft = useRef(null);

  useEffect(() => {
    const close = subscribeEvents((e) => {
      setEvents((p) => [...p, e]);
      route(e);
    });
    refreshSnapshots();
    return close;
  }, []);

  function route(e) {
    switch (e.type) {
      case 'agent.started': setRunning(true); break;
      case 'agent.message': if (e.text) setMessages((p) => [...p, { role: 'assistant', text: e.text }]); break;
      case 'agent.done': case 'agent.error': setRunning(false); refreshSnapshots(); break;
      case 'approval.required':
        setApprovals((p) => [...p, { id: e.approvalId, tool: e.tool, risk: e.risk, reason: e.reason, params: e.params }]); break;
      case 'approval.granted': case 'approval.denied':
        setApprovals((p) => p.filter((a) => a.id !== e.approvalId)); break;
      case 'flow.draft.created':
        if (seenDraft.current !== e.draftId) { seenDraft.current = e.draftId; loadDraft(e.draftId); } break;
      case 'flow.validation.passed': case 'flow.validation.failed':
        setValidation({ ok: e.type.endsWith('passed'), passes: e.passes }); break;
      case 'runtime.log': case 'runtime.error.detected':
        setLogs((p) => [...p.slice(-300), { ...e }]); break;
      case 'connector.status': setOnline(!!e.online); break;
      default: break;
    }
  }

  async function loadDraft(id) {
    const d = await getDraft(id);
    if (d) { setDraft(d); setValidation(d.validation); }
  }
  async function refreshSnapshots() { try { setSnapshots(await getSnapshots()); } catch {} }

  async function send(text) {
    setMessages((p) => [...p, { role: 'user', text }]);
    setDraft(null); setValidation(null); setApprovals([]); seenDraft.current = null;
    await startChat(text);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">⬢ FlowPilot</span>
        <span className="sub">Live Agentic Node-RED Control Plane</span>
        <span className={`badge ${online ? 'on' : 'off'}`}>{online ? '● connector online' : '○ connector offline'}</span>
        {running && <span className="badge run">agent working…</span>}
      </header>

      <div className="grid">
        <ChatPanel messages={messages} approvals={approvals} onSend={send} running={running} />
        <ActionStream events={events} />
        <FlowCanvas draft={draft} />
        <DiffPanel draft={draft} validation={validation} snapshots={snapshots} onRollback={(id) => rollback(id).then(refreshSnapshots)} />
        <LogsPanel logs={logs} />
      </div>
    </div>
  );
}
