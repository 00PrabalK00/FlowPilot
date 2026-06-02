// Node-RED Admin API client + live /comms subscription.
// Official control surface — we never touch the editor UI internals.
import WebSocket from 'ws';

export class NodeRedClient {
  constructor({ baseUrl, token } = {}) {
    this.baseUrl = (baseUrl || 'http://127.0.0.1:1880').replace(/\/$/, '');
    this.token = token || null; // bearer if adminAuth enabled
    this.logBuffer = [];        // ring buffer of runtime events
    this.maxLogs = 500;
    this.onRuntimeEvent = null; // callback(evt) for streaming
    this.comms = null;
  }

  _headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async _req(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: this._headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`Node-RED ${method} ${path} -> ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  // ---- reads ----
  getFlows()       { return this._req('GET', '/flows'); }            // returns {flows?,rev?} or array depending on Accept; v2 returns array
  getFlow(id)      { return this._req('GET', `/flow/${id}`); }
  getFlowState()   { return this._req('GET', '/flows/state'); }
  getDiagnostics() { return this._req('GET', '/diagnostics'); }
  getSettings()    { return this._req('GET', '/settings'); }
  getNodes()       { return this._req('GET', '/nodes'); }

  // ---- writes ----
  // deploymentType: 'full' | 'nodes' | 'flows'. Header drives Node-RED behavior.
  async deploy(flows, deploymentType = 'nodes') {
    const res = await fetch(this.baseUrl + '/flows', {
      method: 'POST',
      headers: this._headers({ 'Node-RED-Deployment-Type': deploymentType }),
      body: JSON.stringify(flows)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`deploy -> ${res.status}`); err.body = data; throw err;
    }
    return data; // { rev }
  }

  setState(state) { return this._req('POST', '/flows/state', { state }); } // 'start'|'stop'
  installNode(module, version) {
    return this._req('POST', '/nodes', version ? { module, version } : { module });
  }

  // ---- live runtime via /comms ws (debug, status, notifications) ----
  connectComms() {
    if (this.comms) return;
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/comms';
    const ws = new WebSocket(wsUrl);
    this.comms = ws;
    ws.on('open', () => {
      // subscribe to debug + status + notification topics
      const auth = this.token ? `,"auth":"${this.token}"` : '';
      for (const topic of ['debug', 'status/#', 'notification/#', 'event-log/#']) {
        ws.send(`[{"subscribe":"${topic}"${auth}}]`);
      }
      this._pushLog({ level: 'info', msg: 'comms connected' });
    });
    ws.on('message', (raw) => {
      let msgs;
      try { msgs = JSON.parse(raw.toString()); } catch { return; }
      for (const m of [].concat(msgs)) this._handleComms(m);
    });
    ws.on('close', () => { this.comms = null; setTimeout(() => this.connectComms(), 3000); });
    ws.on('error', () => {});
  }

  _handleComms(m) {
    if (!m || !m.topic) return;
    const evt = { topic: m.topic, data: m.data, ts: Date.now() };
    if (m.topic === 'debug') this._pushLog({ level: 'debug', node: m.data?.id, msg: m.data?.msg });
    else if (m.topic.startsWith('notification')) {
      const lvl = m.data?.type || (m.topic.includes('error') ? 'error' : 'info');
      this._pushLog({ level: lvl, msg: m.data?.text || m.topic, raw: m.data });
    } else if (m.topic.startsWith('status')) {
      if (m.data?.text || m.data?.fill) this._pushLog({ level: 'status', node: m.topic.split('/')[1], msg: m.data?.text, fill: m.data?.fill });
    }
    if (this.onRuntimeEvent) this.onRuntimeEvent(evt);
  }

  _pushLog(entry) {
    entry.ts = entry.ts || Date.now();
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogs) this.logBuffer.shift();
  }

  readLogs(lines = 100) {
    return this.logBuffer.slice(-lines);
  }
}
