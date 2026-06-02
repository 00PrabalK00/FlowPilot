import React, { useEffect, useRef, useState } from 'react';
import { subscribeEvents, startChat, getDraft, getSnapshots, rollback, getLiveFlows, getProviders, getFiles, restoreFile, deployDraft, resetChat } from './api.js';
import ChatPanel from './panels/ChatPanel.jsx';
import ActionStream from './panels/ActionStream.jsx';
import FlowCanvas from './panels/FlowCanvas.jsx';
import DiffPanel from './panels/DiffPanel.jsx';
import LogsPanel from './panels/LogsPanel.jsx';
import SidebarChat from './panels/SidebarChat.jsx';
import Settings from './panels/Settings.jsx';
import ChangesModal from './panels/ChangesModal.jsx';
import Icon from './Icon.jsx';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [pendingDraft, setPendingDraft] = useState(null);
  const seenDraft = useRef(null);
  const EMBED = new URLSearchParams(location.search).get('embed') === '1';
  const draftNodeCount = countDraftNodes(draft);

  useEffect(() => {
    const close = subscribeEvents((e) => {
      setEvents((p) => [...p, e]);
      route(e);
    });
    refreshSnapshots();
    refreshLiveFlows();
    refreshFiles();
    getProviders().then((p) => { if (p?.selected) setBrain(p.selected); }).catch(() => {});
    // when embedded in the Node-RED editor, receive the node selected in the real canvas
    const onMsg = (ev) => { if (ev.data?.type === 'flowpilot:select' && ev.data.node) setSelected(ev.data.node); };
    window.addEventListener('message', onMsg);
    return () => { close(); window.removeEventListener('message', onMsg); };
  }, []);

  function route(e) {
    switch (e.type) {
      case 'agent.started': setRunning(true); break;
      case 'agent.message': if (e.text) setMessages((p) => [...p, { role: 'assistant', text: e.text, ts: e.ts || Date.now() }]); break;
      case 'agent.done': case 'agent.error': setRunning(false); refreshSnapshots(); refreshLiveFlows(); break;
      case 'deploy.completed': setPendingDraft(null); refreshLiveFlows(); break;
      case 'rollback.completed': refreshLiveFlows(); break;
      case 'approval.required':
        setApprovals((p) => [...p, { id: e.approvalId, tool: e.tool, risk: e.risk, reason: e.reason, params: e.params }]); break;
      case 'approval.granted': case 'approval.denied':
        setApprovals((p) => p.filter((a) => a.id !== e.approvalId)); break;
      case 'flow.draft.created':
        setPendingDraft({ id: e.draftId, name: e.name, nodeCount: e.nodeCount });
        if (seenDraft.current !== e.draftId) { seenDraft.current = e.draftId; loadDraft(e.draftId); } break;
      case 'flow.validation.passed': case 'flow.validation.failed':
        setValidation({ ok: e.type.endsWith('passed'), passes: e.passes }); break;
      case 'runtime.log': case 'runtime.error.detected':
        setLogs((p) => [...p.slice(-300), { ...e }]); break;
      case 'file.changed': refreshFiles(); break;
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
  async function refreshFiles() { try { setFiles(await getFiles()); } catch {} }
  async function revertFile(path) { await restoreFile(path); refreshFiles(); }
  async function deployPending() { if (pendingDraft) await deployDraft(pendingDraft.id); }
  async function newChat() {
    await resetChat();
    setMessages([]); setEvents([]); setSelected(null); setPendingDraft(null); setDraft(null); setValidation(null); seenDraft.current = null;
    setChangesOpen(false);
  }

  async function send(text) {
    setMessages((p) => [...p, { role: 'user', text, ts: Date.now() }]);
    setDraft(null); setValidation(null); setApprovals([]); seenDraft.current = null;
    await startChat(text, { provider: brain });
  }

  // Click a node in the canvas -> it becomes chat context (with its tab/flow).
  function selectNode(node) { setSelected(node); }
  function tabOf(node) {
    const tab = liveFlows.find((n) => n.type === 'tab' && n.id === node?.z);
    return tab?.label || node?.z || null;
  }
  function sendAboutSelected(action) {
    if (!selected) return;
    const tab = tabOf(selected);
    const ref = `node "${selected.name || selected.type}" (type=${selected.type}, id=${selected.id}${tab ? `, in tab "${tab}"` : ''})`;
    const tpl = {
      explain: `Explain what ${ref} does in my Node-RED flow and how it connects.`,
      modify: `I want to modify ${ref}. `,
      delete: `Remove ${ref} from the flow safely (snapshot first, then deploy the patch).`
    }[action];
    if (action === 'modify') { /* let user finish typing */ return tpl; }
    send(tpl);
  }

  if (EMBED) {
    return (
      <>
        <SidebarChat
          messages={messages} events={events} approvals={approvals}
          online={online} running={running} brain={brain} files={files} onRevert={revertFile}
          onOpenSettings={() => setSettingsOpen(true)} onNewChat={newChat}
          onOpenChanges={() => setChangesOpen(true)}
          pendingDraft={pendingDraft} onDeploy={deployPending}
          selected={selected} onClearSelect={() => setSelected(null)}
          onAction={sendAboutSelected} onSend={send} />
        <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} onSelected={setBrain} />
        <ChangesModal open={changesOpen} draft={draft} liveFlows={liveFlows} validation={validation} onClose={() => setChangesOpen(false)} />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <img className="logo-img" src="/logo.png" alt="FlowPilot" />
        <span className="logo">FlowPilot</span>
        <span className="sub">Live Agentic Node-RED Control Plane</span>
        <button className={`changesbtn ${draft ? 'has' : ''}`} onClick={() => setChangesOpen(true)} title="Review pending changes">
          <Icon name="diff" /> Changes{draft ? ` (${draftNodeCount})` : ''}
        </button>
        <button className="brainbtn" onClick={() => setSettingsOpen(true)}><Icon name="gear" /> brain: {brain}</button>
        <span className={`badge ${online ? 'on' : 'off'}`}>{online ? '● connector online' : '○ connector offline'}</span>
        {running && <span className="badge run">agent working…</span>}
      </header>

      <div className="grid">
        <ChatPanel messages={messages} approvals={approvals} onSend={send} running={running}
          onOpenChanges={() => setChangesOpen(true)}
          selected={selected} onClearSelect={() => setSelected(null)} onAction={sendAboutSelected} />
        <ActionStream events={events} />
        <FlowCanvas draft={draft} liveFlows={liveFlows} selectedId={selected?.id} onSelect={selectNode} />
        <DiffPanel draft={draft} validation={validation} snapshots={snapshots} onRollback={(id) => rollback(id).then(refreshSnapshots)} />
        <LogsPanel logs={logs} />
      </div>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} onSelected={setBrain} />
      <ChangesModal open={changesOpen} draft={draft} liveFlows={liveFlows} validation={validation} onClose={() => setChangesOpen(false)} />
    </div>
  );
}

function countDraftNodes(draft) {
  const flow = normalizeFlow(draft?.flow);
  return flow.filter((n) => n?.type !== 'tab').length;
}

function normalizeFlow(flow) {
  if (Array.isArray(flow)) return flow;
  if (typeof flow === 'string') {
    try { return normalizeFlow(JSON.parse(flow)); } catch { return []; }
  }
  if (Array.isArray(flow?.flows)) return normalizeFlow(flow.flows);
  return [];
}
