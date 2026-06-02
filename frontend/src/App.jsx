import React, { useEffect, useRef, useState } from 'react';
import { subscribeEvents, startChat, getDraft, getSnapshots, rollback, getLiveFlows } from './api.js';
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
  const [liveFlows, setLiveFlows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [brain, setBrain] = useState('claude-code');
  const seenDraft = useRef(null);

  useEffect(() => {
    const close = subscribeEvents((e) => {
      setEvents((p) => [...p, e]);
      route(e);
    });
    refreshSnapshots();
    refreshLiveFlows();
    return close;
  }, []);

  function route(e) {
    switch (e.type) {
      case 'agent.started': setRunning(true); break;
      case 'agent.message': if (e.text) setMessages((p) => [...p, { role: 'assistant', text: e.text }]); break;
      case 'agent.done': case 'agent.error': setRunning(false); refreshSnapshots(); refreshLiveFlows(); break;
      case 'deploy.completed': case 'rollback.completed': refreshLiveFlows(); break;
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
  async function refreshLiveFlows() { try { const r = await getLiveFlows(); setLiveFlows(r.flows || []); } catch {} }

  async function send(text) {
    setMessages((p) => [...p, { role: 'user', text }]);
    setDraft(null); setValidation(null); setApprovals([]); seenDraft.current = null;
    await startChat(text, { provider: brain });
  }

  // Click a node in the canvas -> it becomes chat context.
  function selectNode(node) { setSelected(node); }
  function sendAboutSelected(action) {
    if (!selected) return;
    const ref = `node "${selected.name || selected.type}" (type=${selected.type}, id=${selected.id})`;
    const tpl = {
      explain: `Explain what ${ref} does in my Node-RED flow and how it connects.`,
      modify: `I want to modify ${ref}. `,
      delete: `Remove ${ref} from the flow safely (snapshot first, then deploy the patch).`
    }[action];
    if (action === 'modify') { /* let user finish typing */ return tpl; }
    send(tpl);
  }

  return (
    <div className="app">
      <header className="topbar">
        <img className="logo-img" src="/logo.png" alt="FlowPilot" />
        <span className="logo">FlowPilot</span>
        <span className="sub">Live Agentic Node-RED Control Plane</span>
        <label className="brainsel">brain&nbsp;
          <select value={brain} onChange={(e) => setBrain(e.target.value)}>
            <option value="claude-code">Claude Code (your login)</option>
            <option value="mock">Mock (offline demo)</option>
          </select>
        </label>
        <span className={`badge ${online ? 'on' : 'off'}`}>{online ? '● connector online' : '○ connector offline'}</span>
        {running && <span className="badge run">agent working…</span>}
      </header>

      <div className="grid">
        <ChatPanel messages={messages} approvals={approvals} onSend={send} running={running}
          selected={selected} onClearSelect={() => setSelected(null)} onAction={sendAboutSelected} />
        <ActionStream events={events} />
        <FlowCanvas draft={draft} liveFlows={liveFlows} selectedId={selected?.id} onSelect={selectNode} />
        <DiffPanel draft={draft} validation={validation} snapshots={snapshots} onRollback={(id) => rollback(id).then(refreshSnapshots)} />
        <LogsPanel logs={logs} />
      </div>
    </div>
  );
}
