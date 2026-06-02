import React, { useEffect, useState } from 'react';
import { getProviders, saveProvider, testProvider } from '../api.js';
import Icon from '../Icon.jsx';

// Settings: pick the brain (CLI login or API key) + Test connection.
const API_PROVIDERS = [
  { id: 'claude', label: 'Anthropic Claude', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-…' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza…' }
];
const CLI_LABEL = { 'claude-code': 'Claude Code', 'codex-cli': 'Codex', 'gemini-cli': 'Gemini CLI' };

export default function Settings({ open, onClose, onSelected }) {
  const [status, setStatus] = useState(null);
  const [keys, setKeys] = useState({});
  const [models, setModels] = useState({});
  const [test, setTest] = useState({});

  useEffect(() => { if (open) getProviders().then(setStatus); }, [open]);
  if (!open) return null;

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
        {(status?.cliBrains || []).map((c) => (
          <div key={c} className={`set-row ${selected === c ? 'sel' : ''}`}>
            <span className="set-name">{CLI_LABEL[c] || c}</span>
            <Badge p={c} />
            <span className="set-acts">
              <button onClick={() => runTest(c)}>Test</button>
              <button className="set-use" onClick={() => choose(c)}>{selected === c ? 'Selected' : 'Use'}</button>
            </span>
          </div>
        ))}

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

        <div className="set-foot">Active brain: <b>{selected}</b></div>
      </div>
    </div>
  );
}
