import React, { useEffect, useState } from 'react';
import { getProviders, saveProvider, testProvider, setAgentMode } from '../api.js';
import Icon from '../Icon.jsx';

// Settings: pick the brain (CLI login or API key) + Test connection.
const API_PROVIDERS = [
  { id: 'claude', label: 'Anthropic Claude', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…' }
];
const CLI_LABEL = { 'claude-code': 'Claude Code', 'codex-cli': 'Codex', 'gemini-cli': 'Gemini CLI' };
const CLI_MODELS = {
  'claude-code': ['', 'opus', 'sonnet', 'haiku'],
  'codex-cli': ['', 'gpt-5-codex', 'gpt-5', 'o3'],
  'gemini-cli': ['', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']
};

export default function Settings({ open, onClose, onSelected }) {
  const [status, setStatus] = useState(null);
  const [keys, setKeys] = useState({});
  const [models, setModels] = useState({});
  const [test, setTest] = useState({});
  const [dirs, setDirs] = useState('');

  useEffect(() => { if (open) getProviders().then((s) => { setStatus(s); setDirs((s.agent?.dirs || []).join('\n')); }); }, [open]);
  if (!open) return null;

  function saveAgent(mode) {
    const d = dirs.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    setAgentMode({ mode, dirs: d }).then((agent) => setStatus((s) => ({ ...s, agent })));
  }

  const selected = status?.selected;

  async function runTest(provider) {
    setTest((t) => ({ ...t, [provider]: { loading: true } }));
    const r = await testProvider({ provider, apiKey: keys[provider], model: models[provider] });
    setTest((t) => ({ ...t, [provider]: r }));
  }
  async function choose(provider, withKey) {
    const body = { provider, select: true };
    if (withKey) { body.apiKey = keys[provider]; if (models[provider]) body.model = models[provider]; }
    const s = await saveProvider(body);
    setStatus(s);
    onSelected?.(provider);
  }

  const Badge = ({ p }) => {
    const t = test[p];
    if (!t) return null;
    if (t.loading) return <span className="t-badge load"><Icon name="sync" spin /> testing…</span>;
    return <span className={`t-badge ${t.ok ? 'ok' : 'bad'}`}><Icon name={t.ok ? 'check' : 'x'} /> {t.ok ? (t.detail || 'ok') : (t.error || 'failed')}</span>;
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><b>Settings · Brain</b><button onClick={onClose}><Icon name="x" /></button></div>

        <div className="set-sec">Use your CLI login <span className="set-hint">(no API key — uses the subscription you're already signed into)</span></div>
        {(status?.cliBrains || []).map((c) => {
          const inst = status?.cliInstalled?.[c];
          const installed = inst?.ok;
          return (
            <div key={c} className={`set-row ${selected === c ? 'sel' : ''}`}>
              <span className="set-name">{CLI_LABEL[c] || c}</span>
              {installed
                ? <span className="set-saved" title={inst.version}>installed</span>
                : <span className="set-missing">not found</span>}
              <select className="set-modelsel" disabled={!installed}
                value={models[c] ?? status?.cliModels?.[c] ?? ''}
                onChange={(e) => { const m = e.target.value; setModels((x) => ({ ...x, [c]: m })); saveProvider({ provider: c, model: m }).then(setStatus); }}>
                {CLI_MODELS[c].map((m) => <option key={m} value={m}>{m || 'default model'}</option>)}
              </select>
              <Badge p={c} />
              <span className="set-acts">
                <button onClick={() => runTest(c)} disabled={!installed}>Test</button>
                <button className="set-use" onClick={() => choose(c)} disabled={!installed}>{selected === c ? 'Selected' : 'Use'}</button>
              </span>
            </div>
          );
        })}

        <div className="set-sec">Use an API key <span className="set-hint">(stored server-side in <code>secrets/</code>, never committed)</span></div>
        {API_PROVIDERS.map((p) => {
          const st = status?.providers?.find((x) => x.name === p.id);
          return (
            <div key={p.id} className={`set-row col ${selected === p.id ? 'sel' : ''}`}>
              <div className="set-row">
                <span className="set-name">{p.label}</span>
                {st?.configured && <span className="set-saved">{st.fromEnv ? 'env' : st.keyMasked}</span>}
                <Badge p={p.id} />
              </div>
              <div className="set-row">
                <input type="password" placeholder={st?.configured ? '•••• (saved — leave blank to keep)' : p.placeholder}
                  value={keys[p.id] || ''} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} />
                <input className="set-model" placeholder="model (optional)"
                  value={models[p.id] || ''} onChange={(e) => setModels((m) => ({ ...m, [p.id]: e.target.value }))} />
              </div>
              <div className="set-acts">
                <button onClick={() => saveProvider({ provider: p.id, apiKey: keys[p.id], model: models[p.id] }).then(setStatus)}>Save</button>
                <button onClick={() => runTest(p.id)}>Test</button>
                <button className="set-use" onClick={() => choose(p.id, true)}>{selected === p.id ? 'Selected' : 'Save & Use'}</button>
              </div>
            </div>
          );
        })}

        <div className="set-sec">Agent mode <span className="set-hint">(only applies to CLI brains)</span></div>
        <div className="set-row col">
          <label className="set-radio"><input type="radio" name="amode" checked={status?.agent?.mode !== 'full'} onChange={() => saveAgent('tools')} /> Node-RED tools only <span className="set-hint">— safe; cannot edit files</span></label>
          <label className="set-radio"><input type="radio" name="amode" checked={status?.agent?.mode === 'full'} onChange={() => saveAgent('full')} /> Full coding agent <span className="set-hint">— Edit/Write/Bash in allowed dirs; changes tracked + revertable</span></label>
          <textarea className="set-dirs" rows={3} placeholder="Allowed directories (one per line) the agent may edit&#10;e.g. D:\\Projects\\my-robot" value={dirs} onChange={(e) => setDirs(e.target.value)} />
          <button onClick={() => saveAgent(status?.agent?.mode || 'tools')}>Save dirs</button>
        </div>

        <div className="set-foot">Active brain: <b>{selected}</b> · agent: <b>{status?.agent?.mode || 'tools'}</b></div>
      </div>
    </div>
  );
}
